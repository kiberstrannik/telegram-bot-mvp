// src/llm.ts
import "dotenv/config";
// @ts-ignore — библиотека без TS-типов
import * as translateModule from "@vitalets/google-translate-api";
const translate = (translateModule as any).default || translateModule;

import GPT3Tokenizer from "gpt3-tokenizer";
import { getCharacterProfile } from "./db";

/* ===========================
   CONSTANTS
   =========================== */
const MAX_PARAGRAPHS = 2;
const MAX_TOKENS_CONTEXT = 4096;

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
Если сцена предполагает диалог — пиши реплики в кавычках.  
Если персонаж говорит сам с собой — выделяй это курсивом.  
Если сцена интимная — пиши естественно, чувственно и атмосферно, избегая пошлости.  
Если момент близости уже описан, переходи к эмоциональному послевкусию или новому событию:  
например, "Позже, лёжа рядом..." или "Утро принесло тишину и странное чувство покоя".

📜 Стиль письма:
• Художественный, эмоциональный, с живым ритмом.  
• Заверши текст лёгким крючком — фразой, взглядом, намёком на продолжение.

📖 Правила:
• Не пересказывай прошлое.  
• Не повторяй сцены, которые уже происходили.  
• Если действие уже описано — переходи к следующему моменту.  
• Пиши 1–2 абзаца (до 10 предложений).  
• Если пользователь пишет от первого лица — это его персонаж.  
• Не приписывай эмоции пользователю от себя.

🎭 Контекст:
Если указано, кому персонаж симпатизирует (например: мужчинам, женщинам, обоим, никому) — строго соблюдай это.
Не создавай романтические сцены, не соответствующие предпочтениям персонажа.
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
  if (out.length > 50) out.splice(0, out.length - 50);
  return out;
}

function limitParagraphs(text: string, max = MAX_PARAGRAPHS): string {
  if (!text) return text;
  const parts = text.trim().split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  return parts.slice(0, max).join("\n\n");
}

/* ===========================
   SIMILARITY (ANTI-LOOP)
   =========================== */
function similarityRatio(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  const aLen = a.length;
  const bLen = b.length;

  for (let i = 0; i <= aLen; i++) matrix[i] = [i];
  for (let j = 0; j <= bLen; j++) matrix[0][j] = j;

  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      if (a[i - 1] === b[j - 1]) matrix[i][j] = matrix[i - 1][j - 1];
      else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1
        );
      }
    }
  }
  return matrix[aLen][bLen];
}

/* ===========================
   OPENROUTER REQUEST
   =========================== */
async function callOpenRouterOnce(
  model: string,
  messages: Msg[],
  params: any,
  timeoutMs = 40000
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

/* ===========================
   MAIN GENERATOR
   =========================== */
export async function generateSpicyReply(
  userText: string,
  history: Msg[],
  userId?: number
): Promise<string> {
  if (!OR_KEY) throw new Error("OPENROUTER_API_KEY is missing");

  const clipped = clipHistory(history);
  const shortHistory = clipped.slice(-12); // чуть длиннее контекст

  // 🧩 Загрузка профиля персонажа
  let charProfileText = "";
  if (userId) {
    try {
      const profile = await getCharacterProfile(userId);
      if (profile?.character_name) {
        charProfileText = `
[ПЕРСОНАЖ]
Имя: ${profile.character_name}
Пол: ${profile.character_gender}
Возраст: ${profile.character_age}
Раса: ${profile.character_race || "человек"}
Кому симпатизирует: ${profile.character_preference || "не указано"}
⚠️ Правила:
• Пол персонажа строго фиксирован — не изменяй его и используй правильные местоимения, окончания и обращение.
• Раса персонажа строго фиксирована и не должна изменяться.
• Если персонаж не человек, добавляй в повествование детали, соответствующие его расе (повадки, мировосприятие, речь).
• Симпатии персонажа фиксированы: создавай романтические или интимные сцены только с теми, к кому он испытывает симпатию.
• Если симпатия указана как “никому” — избегай любых романтических взаимодействий.
`.trim();
      }
    } catch (e) {
      console.warn("⚠️ Не удалось получить профиль персонажа:", e);
    }
  }

  const isContinue =
    !userText || userText.trim() === "" || userText.includes("[Продолжить");

  // 🎭 Определяем фазу — обычная или интимная
  const isIntimate = /поцеловал|прикоснулся|разделась|тело|страсть|поцелуй|ласк|возбуж|желание|вождел/i.test(userText);

  const phaseHint = isIntimate
    ? "Сцена становится интимной — опиши естественно, с акцентом на эмоции и ощущения. " +
      "Если момент близости уже был описан, не повторяй его, а плавно переведи повествование к послевкусию или новому событию. "
    : "";

  const directive: Msg = {
    role: "user",
    content:
      phaseHint +
      (isContinue
        ? "Продолжи сцену естественно, основываясь на предыдущих событиях. " +
          "Не повторяй уже написанное. Добавь новое развитие, эмоции или реакцию. " +
          "Если действие исчерпано — переходи к следующему моменту. Пиши 1–2 абзаца."
        : "Продолжи историю, реагируя на действия игрока. " +
          "Опиши естественное развитие событий. Пиши 1–2 абзаца."),
  };

  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(charProfileText ? [{ role: "system" as "system", content: charProfileText }] : []),
    ...shortHistory,
    directive,
  ];

  const gen = {
    temperature: 0.9,
    top_p: 0.92,
    max_tokens: 2600,
    frequency_penalty: 0.25,
    presence_penalty: 0.2,
  };

  const models = [
  "anthracite-org/magnum-v4-72b",
  "sao10k/l3-lunaris-8b",
  "gpt-4o-mini",
  "qwen2.5-14b-instruct",
];

  for (const model of models) {
    try {
      console.log(`🎯 Используется модель: ${model}`);
      const reply = await callOpenRouterOnce(model, messages, gen);
      console.log(`✅ Ответ от модели ${model}`);

      const cleaned = reply
        .replace(/[a-zA-Z]+/g, "")
        .replace(/!{2,}/g, "!")
        .replace(/\s{2,}/g, " ")
        .trim();

      const limited = limitParagraphs(cleaned, 2);

      // 🔁 Проверка на повтор
      if (history.length > 0) {
        const lastMsg = history[history.length - 1]?.content || "";
        const similarity = similarityRatio(limited, lastMsg);
        if (similarity > 0.8) {
          console.log("⚠️ Обнаружен повтор сцены. Принудительная смена направления.");
          return "Сцена изменилась — дыхание времени уносит героев дальше. " +
                 "Добавь новую деталь, ощущение или действие, чтобы история продолжилась.";
        }
      }

      return limited;
    } catch (e) {
      console.warn(`⚠️ Модель ${model} недоступна:`, (e as Error).message);
    }
  }

  throw new Error("❌ Все модели недоступны.");
}

/* ===========================
   TRANSLATOR
   =========================== */
export async function translateToRussian(text: string): Promise<string> {
  if (!text || text.trim().length === 0) return text;
  try {
    const res = await translate(text, { to: "ru" });
    return res.text?.trim() || text;
  } catch {
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
