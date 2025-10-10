// src/llm.ts
import "dotenv/config";
// @ts-ignore — библиотека без TS-типов
// @ts-ignore
import translate from "@vitalets/google-translate-api";
import GPT3Tokenizer from "gpt3-tokenizer";
import { getCharacterProfile } from "./db";

/* ===========================
   CONSTANTS
   =========================== */
const MAX_PARAGRAPHS = 2;
const MAX_TOKENS_CONTEXT = 4096;

/** Message format */
export type Msg = { role: "system" | "user" | "assistant"; content: string };

/* ===========================
   MODEL CONFIG
   =========================== */
const OR_KEY = process.env.OPENROUTER_API_KEY || "";
const SITE_URL = process.env.SITE_URL || "http://localhost";
const BOT_TITLE = process.env.BOT_TITLE || "YourWorldSimulator";

/* ===========================
   SYSTEM PROMPT
   =========================== */
const SYSTEM_PROMPT = `
Ты — рассказчик и партнёр по ролевой игре.  
Ты ведёшь историю от третьего лица, создавая атмосферу, эмоции и ощущение присутствия.    
Пиши строго на русском языке. Не используй английские слова, даже частично.  
Если встречаешь английские слова — переводи их естественно и красиво.

📜 Стиль письма:
• Художественный, эмоциональный, с живым ритмом и атмосферой.  
• Используй язык ощущений: дыхание, взгляд, движения, ритм, касание, паузы.  
• Передавай страсть, страх, нежность или напряжение через **действия и ощущения**, а не прямые слова.  
• Можно писать чувственно, но изящно.  
• Заверши текст лёгким "крючком" — фразой, жестом или взглядом, зовущим к продолжению.

📖 Технический стиль:
• Не пересказывай прошлое.  
• Пиши 1–2 абзаца (до 10 предложений).  
• Если пользователь пишет от первого лица — это его персонаж.  
• Не приписывай реплики или эмоции пользователю от себя.

🎭 Контекст:
Если указано, кому персонаж симпатизирует (например: мужчинам, женщинам, обоим, никому) — строго соблюдай это.
Не создавай романтические сцены с персонажами, которые не соответствуют предпочтениям игрока.  
Реагируй естественно: если персонаж симпатизирует мужчинам — сцены с мужчинами могут быть романтичными,
а с женщинами — только дружескими или нейтральными.  
Если “обоим” — допускается любое взаимодействие, если “никому” — избегай романтических намёков.

Не ломай характер персонажа и не заставляй его вести себя против собственных предпочтений.  
Если сцена подразумевает близость — пиши чувственно и атмосферно.  
`.trim();

/* ===========================
   HELPERS
   =========================== */
const tokenizer = new GPT3Tokenizer({ type: "gpt3" });

function clipHistory(history: Msg[], maxTokens = MAX_TOKENS_CONTEXT): Msg[] {
  const out: Msg[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const tokens = tokenizer.encode(msg.content).bpe.length;
    if (used + tokens > maxTokens) break;
    out.unshift(msg);
    used += tokens;
  }

  // ограничиваем количество сообщений до 50
  if (out.length > 50) out.splice(0, out.length - 50);
  return out;
}

function limitParagraphs(text: string, max = MAX_PARAGRAPHS): string {
  if (!text) return text;
  const parts = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.slice(0, max).join("\n\n");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function expoBackoffDelay(attempt: number, base = 800, cap = 6000) {
  const exp = Math.min(cap, base * 2 ** (attempt - 1));
  const jitter = Math.random() * 0.3 + 0.85;
  return Math.floor(exp * jitter);
}

/* ===========================
   AUTO-CLEANUP FUNCTION
   =========================== */
async function ruCleanup(text: string): Promise<string> {
  let t = text;

  // быстрые замены
  const quickFixes: Array<[RegExp, string]> = [
    [/\bсможу\b/gi, "смогу"],
    [/\bщас\b/gi, "сейчас"],
    [/\bчо\b/gi, "что"],
    [/\bотнеперелся\b/gi, "отшатнулся"],
    [/\btonight\b/gi, "сегодня вечером"],
    [/\btoday\b/gi, "сегодня"],
    [/\btomorrow\b/gi, "завтра"],
    [/\bhi\b/gi, "привет"],
    [/\bhello\b/gi, "привет"],
    [/\bokay\b/gi, "ладно"],
  ];
  for (const [re, repl] of quickFixes) t = t.replace(re, repl);

  // если есть латиница — перевести
  if (/[A-Za-z]/.test(t)) {
    try {
      const res = await translate(t, { to: "ru" });
      if (res.text && res.text.trim()) t = res.text.trim();
    } catch {}
  }

  // спеллчекер Яндекс
  try {
    const url =
      "https://speller.yandex.net/services/spellservice.json/checkText?lang=ru&options=516&text=" +
      encodeURIComponent(t);
    const r = await fetch(url);
    const arr = (await r.json()) as Array<{ pos: number; len: number; s: string[] }>;
    if (Array.isArray(arr) && arr.length) {
      let offset = 0;
      for (const e of arr) {
        if (!e.s?.length) continue;
        const best = e.s[0];
        const start = e.pos + offset;
        const end = start + e.len;
        t = t.slice(0, start) + best + t.slice(end);
        offset += best.length - e.len;
      }
    }
  } catch {}

  return t.replace(/\s{2,}/g, " ").trim();
}

/* ===========================
   OPENROUTER REQUEST
   =========================== */
async function callOpenRouterOnce(
  model: string,
  messages: Msg[],
  params: any,
  timeoutMs = 45000
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;

  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OR_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": SITE_URL,
        "X-Title": BOT_TITLE,
      },
      body: JSON.stringify({ model, messages, ...params }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : null;

  if (!res.ok) {
    const apiMsg = data?.error?.message || data?.message;
    throw new Error(`OpenRouter HTTP ${res.status}: ${apiMsg || raw}`);
  }

  const txt = data?.choices?.[0]?.message?.content?.trim();
  if (!txt) throw new Error("Empty OpenRouter response");
  return txt;
}

async function withRetries<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: any;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      if (i < tries) await sleep(expoBackoffDelay(i));
    }
  }
  throw last;
}

/* ===========================
   MAIN GENERATOR
   =========================== */
export async function generateSpicyReply(
  userText: string,
  history: Msg[],
  userId?: number
): Promise<string> {
  if (!OR_KEY) throw new Error("OPENROUTER_API_KEY is missing");

  // ✂️ Сжимаем историю до лимита токенов
  const clipped = clipHistory(history);

  // 🧩 Загружаем профиль персонажа
  type CharacterProfile = {
    character_name?: string;
    character_gender?: string;
    character_age?: string;
    character_hair?: string;
    character_traits?: string;
    character_preference?: string;
  };

  let charProfileText = "";
  if (userId) {
    try {
      const profile = (await getCharacterProfile(userId)) as CharacterProfile;
      if (profile?.character_name) {
        charProfileText = `
[ПЕРСОНАЖ]
Имя: ${profile.character_name}
Пол: ${profile.character_gender}
Возраст: ${profile.character_age}
Волосы: ${profile.character_hair}
Черты характера: ${profile.character_traits}
Кому симпатизирует: ${profile.character_preference || "не указано"}
`;
      }
    } catch (e) {
      console.warn("⚠️ Не удалось получить профиль персонажа:", e);
    }
  }

  // 🧭 Определяем тип запроса — "Продолжить" или новое действие
  const isContinue = !userText || userText.trim() === "" || userText.includes("[Продолжить");

  // 💬 Формируем общую системную инструкцию
  const directive: Msg = {
    role: "user",
    content: isContinue
      ? "Продолжи сцену естественно, основываясь на предыдущих событиях. " +
        "Сохрани стиль, эмоции и атмосферу. Не повторяй предыдущий текст. " +
        "Добавь развитие действия, новое ощущение или реплику. 1–2 абзаца."
      : "Продолжи историю, реагируя на слова и действия игрока. " +
        "Отвечай от лица мира или других персонажей. Используй максимум 1–2 абзаца.",
  };

  // 🧠 Формируем финальный запрос для LLM
  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: "Отвечай строго на русском языке. Не используй английские слова." },

    ...(charProfileText ? [{ role: "system" as const, content: charProfileText.trim() }] : []),

    {
      role: "system",
      content: `
⚠️ Учитывай романтические предпочтения персонажа. 
Если персонаж симпатизирует мужчинам — романтические сцены только с мужчинами. 
Если женщинам — только с женщинами. 
Если обоим — возможны любые сцены. 
Если никому — избегай романтических ситуаций.
Не ломай характер и не повторяй предыдущие сцены.
      `.trim(),
    },

    ...clipped,
    directive,

    {
      role: "user",
      content: isContinue
        ? "Продолжи сцену естественно, не повторяя прошлое. " +
          "Добавь действие, диалог или эмоциональный штрих, который логично вытекает из предыдущего момента."
        : `Это реплика или действие игрока. Считай, что её произносит его персонаж. 
Игрок написал: "${userText.slice(0, 4000)}". 
Продолжи повествование, опиши реакцию мира или других персонажей, 
но не меняй смысл сказанного пользователем.`,
    },
  ];

  // ⚙️ Настройки генерации
  const gen = {
    temperature: isContinue ? 0.62 : 0.72, // чуть меньше для “continue” — плавнее
    top_p: 0.9,
    max_tokens: 2800,
    frequency_penalty: 0.55,
    presence_penalty: 0.25,
  };

  // 🧩 Приоритет моделей
  const models = [
    "anthracite-org/magnum-v4-72b",
    "sao10k/l3-lunaris-8b",
    "qwen2.5-14b-instruct",
    "gpt-4o-mini",
  ];

  let lastErr: any = null;
  let reply: string | null = null;

  for (const model of models) {
    try {
      console.log(`🎯 Используется модель: ${model}`);
      reply = await withRetries(() => callOpenRouterOnce(model, messages, gen));
      console.log(`✅ Ответ от модели ${model}`);

      // 🧹 Автоочистка и исправление опечаток
      const cleaned = reply
        .replace(/\bсможу\b/gi, "смогу")
        .replace(/\bщас\b/gi, "сейчас")
        .replace(/\bчо\b/gi, "что")
        .replace(/\btonight\b/gi, "сегодня вечером")
        .replace(/\bhi\b/gi, "привет")
        .replace(/\bhello\b/gi, "привет")
        .replace(/[a-zA-Z]+/g, "") // чистим случайные англ. слова
        .replace(/\s{2,}/g, " ")
        .trim();

      return limitParagraphs(cleaned, 2);
    } catch (e) {
      console.warn(`⚠️ Модель ${model} недоступна:`, (e as Error).message);
      lastErr = e;
    }
  }

  if (!reply) throw lastErr || new Error("❌ Все модели недоступны.");
  return limitParagraphs(reply, 2);
}


/* ===========================
   GOOGLE TRANSLATOR
   =========================== */
export async function translateToRussian(text: string): Promise<string> {
  if (!text || text.trim().length === 0) return text;

  try {
    const res = await translate(text, { to: "ru" });
    if (res.text && res.text.trim().length > 0) return res.text.trim();
    console.warn("⚠️ Google Translate вернул пустой результат, возвращаю оригинал");
    return text;
  } catch (e) {
    console.error("❌ Ошибка Google Translate:", e);
    return text;
  }
}

/* ===========================
   SUMMARIZER
   =========================== */
export async function summarizeHistory(history: Msg[]): Promise<string> {
  const messages: Msg[] = [
    {
      role: "system",
      content:
        "Ты сценарист. Кратко перескажи последние события (2 предложения), сохрани атмосферу и персонажей.",
    },
    { role: "user", content: history.map((m) => m.content).join("\n") },
  ];

  const gen = { temperature: 0.3, top_p: 0.8, max_tokens: 300 };

  try {
    return await callOpenRouterOnce("gpt-4o-mini", messages, gen);
  } catch {
    return "Краткое резюме недоступно.";
  }
}
