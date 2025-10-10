// src/llm.ts
import "dotenv/config";
// @ts-ignore — библиотека без TS-типов
import translate from "@vitalets/google-translate-api";
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
Пиши строго на русском языке. Не используй английские слова.  
Текст — художественный, атмосферный, с эмоциями и ощущениями.  
1–2 абзаца, без пересказа прошлого.  
Соблюдай характер и романтические предпочтения персонажа.
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
  return out.slice(-50); // ограничение на 50 сообщений
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

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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

    const raw = await res.text();
    const data = raw ? JSON.parse(raw) : null;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${data?.error?.message || raw}`);

    const txt = data?.choices?.[0]?.message?.content?.trim();
    if (!txt) throw new Error("Empty response from OpenRouter");
    return txt;
  } finally {
    clearTimeout(timeout);
  }
}

async function withRetries<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: any;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
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

  const clipped = clipHistory(history);

  // 🧩 Профиль персонажа
  let charProfileText = "";
  if (userId) {
    try {
      const profile = await getCharacterProfile(userId);
      if (profile && profile.character_name) {
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

  const isContinue =
    !userText || userText.trim() === "" || userText.includes("[Продолжить");

  const directive: Msg = {
    role: "user",
    content: isContinue
      ? "Продолжи сцену естественно, основываясь на предыдущих событиях. Не повторяй прошлое."
      : "Продолжи историю, реагируя на действия игрока, от лица мира и других персонажей.",
  };

  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: "Пиши строго на русском языке." },
    ...(charProfileText ? [{ role: "system", content: charProfileText.trim() }] : []),
    ...clipped,
    directive,
  ];

  const gen = {
    temperature: isContinue ? 0.62 : 0.72,
    top_p: 0.9,
    max_tokens: 2800,
    frequency_penalty: 0.55,
    presence_penalty: 0.25,
  };

  const models = [
    "anthracite-org/magnum-v4-72b",
    "sao10k/l3-lunaris-8b",
    "qwen2.5-14b-instruct",
    "gpt-4o-mini",
  ];

  let reply: string | null = null;
  let lastErr: any = null;

  for (const model of models) {
    try {
      console.log(`🎯 Используется модель: ${model}`);
      reply = await withRetries(() => callOpenRouterOnce(model, messages, gen));
      console.log(`✅ Ответ от модели ${model}`);
      break;
    } catch (e: any) {
      console.warn(`⚠️ Ошибка модели ${model}:`, e.message);
      lastErr = e;
    }
  }

  if (!reply) throw lastErr || new Error("❌ Все модели недоступны.");

  // 🧹 Пост-обработка
  const cleaned = reply
    .replace(/[a-zA-Z]+/g, "") // убираем латиницу
    .replace(/\s{2,}/g, " ")
    .trim();

  return limitParagraphs(cleaned, 2);
}

/* ===========================
   TRANSLATION
   =========================== */
export async function translateToRussian(text: string): Promise<string> {
  if (!text || !text.trim()) return text;
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
      content: "Ты сценарист. Сократи последние события (2 предложения), сохрани атмосферу.",
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
