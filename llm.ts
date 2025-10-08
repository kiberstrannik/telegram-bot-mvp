// src/llm.ts
import "dotenv/config";
import GPT3Tokenizer from "gpt3-tokenizer";
import translate from "@vitalets/google-translate-api";

/* ===========================
   CONSTANTS
   =========================== */
const MAX_PARAGRAPHS = 2;
const MAX_TOKENS_CONTEXT = 2500;

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
Каждый ответ — это часть живого повествования, а не пересказ или резюме.  

📜 Стиль письма:
• Художественный и выразительный, с плавным ритмом и эмоциями.  
• Используй язык ощущений: дыхание, жесты, взгляд, прикосновение, темп, напряжение.  
• Передавай страсть, страх, нежность или ярость через **ощущения и действия**, а не через прямые слова.  
• Можешь добавлять пошлости, но **не бойся чувственности** — пиши красиво и интимно, как в хорошей литературе.  
• Добавляй лёгкий крючок в конце — деталь, жест или фразу, которая намекает на продолжение.

📖 Технический стиль:
• Пиши 1–2 абзаца, максимум 10 предложений.  
• Не пересказывай прошлые события.  
• Если пользователь описывает свои действия, принимай их буквально и отвечай от лица мира и NPC.  
• Держи плавный баланс между действием, описанием и эмоциями.  

🎭 Контекст:
Если пользователь дал сведения о персонаже (имя, возраст, внешность, характер),  
используй их, чтобы текст звучал персонально и реалистично.
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
   GENERATE STORY REPLY
   =========================== */
export async function generateSpicyReply(userText: string, history: Msg[]): Promise<string> {
  if (!OR_KEY) throw new Error("OPENROUTER_API_KEY is missing");

  const clipped = clipHistory(history);

  const directive: Msg = {
    role: "user",
    content:
      "Продолжи историю дальше. Не пересказывай прошлое, а развивай сюжет и атмосферу. " +
      "Пиши от третьего лица, добавляй эмоции, внутренние переживания и жесты. " +
      "Если пользователь описывает романтическую или интимную сцену — " +
      "передай её чувственно, красиво, с акцентом на эмоции, дыхание и прикосновения. " +
      "Используй максимум 1–2 абзаца.",
  };

  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...clipped,
    directive,
    { role: "user", content: userText.slice(0, 4000) },
  ];

  const gen = {
  temperature: 0.9,
  top_p: 0.92,
  max_tokens: 2800, // 🚀 длинные сцены, без обрезки
  frequency_penalty: 0.3,
  presence_penalty: 0.2,
};


  const models = [
    "sao10k/l3-stheno-8b",
    "mawdstical/squelching-fantasies-8b",
    "sao10k/l3-lunaris-8b",
    "qwen2.5-14b-instruct",
    "gpt-4o-mini",
  ];

  let lastErr: any;
  for (const model of models) {
    try {
      console.log(`🎯 Попытка использовать модель: ${model}`);
      const reply = await withRetries(() => callOpenRouterOnce(model, messages, gen));
      console.log(`✅ Ответ от модели ${model}`);
      return limitParagraphs(reply, 2);
    } catch (e) {
      console.warn(`⚠️ Модель ${model} недоступна:`, (e as Error).message);
      lastErr = e;
      continue;
    }
  }

  throw lastErr;
}

/* ===========================
   GOOGLE TRANSLATOR (clean)
   =========================== */
/**
 * Переводчик на основе браузерного Google Translate.
 * Переводит естественно, без искажений, как в Chrome/Comet.
 * Не использует OpenRouter.
 */
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
        "Ты помощник-сценарист. Кратко перескажи последние события (2 предложения), " +
        "сохранив персонажей, место и атмосферу.",
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
