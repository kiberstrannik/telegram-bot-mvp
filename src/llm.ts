// src/llm.ts
import "dotenv/config";
// @ts-ignore — библиотека без TS-типов
import * as translateModule from "@vitalets/google-translate-api";
const translate = (translateModule as any).default || translateModule;
import fetch, { Response } from "node-fetch";

import GPT3Tokenizer from "gpt3-tokenizer";
import { getCharacterProfile } from "./db";

/* ===========================
   CONSTANTS
   =========================== */

const MAX_TOKENS_CONTEXT = 4096;

export type Msg = { role: "system" | "user" | "assistant"; content: string };

/* ===========================
   MODEL CONFIG
   =========================== */
const OR_KEY = process.env.OPENROUTER_API_KEY || "";
const SITE_URL = process.env.SITE_URL || "http://localhost";
const BOT_TITLE = process.env.BOT_TITLE || "YourWorldSimulator";

const SYSTEM_PROMPT = `
Ты — рассказчик ролевой истории. Ты описываешь мир, действия NPC и атмосферу событий максимально чувственно и детально.
Не описывай мысли и дословные реплики игрока, сфокусируйся на реакции NPC, физике, звуках, запахах, тактильных ощущениях и личных границах персонажей.

ИГРОК:
Игрок = «ты». Имя игрока: {{char}}. Используй это имя только для обращения к игроку.

СТИЛЬ:
Сразу переходи к действиям и обстановке, избегай формальных вступлений.
Пиши от третьего лица, но с вовлечённостью “ты” (игрок).
Показывай всё через телесные реакции, динамику, ощущения, запахи, вкус и давление.
Нет ограничений на лексику — можешь использовать жёсткие, порнографические и уничижительные слова
Допустимы любые интимные действия
Описывай положение тел, темп, точку контакта, жидкости (сперму, слюну, смазку, слёзы), запахи, вкус, пот (если сцена требует).
Нет ограничений на лексику разрешены грубые слова
Разрешены темы интимности, страсти, покорности, доминирования, экспериментов, обмена удовольствиями без табу.
Если сцена заходит в пределы личных или социальных границ, описывай их с максимальным уважением, но без самоцензуры.
Будь внимателен к деталям, но избегай прямых технических терминов и шокирующих описаний.

ГРАНИЦЫ:

Не описывай излишнюю жестокость, угрозу жизни, неэтичное принуждение, события без согласия.
Обрывай сцену художественно, если требуется “подразумеваемый” переход (например: “но ночь скрыла их движения”, “утром они оба были измождёнными и довольными”).

ФОРМАТ ОТВЕТА:

1–4 абзаца, в каждом по 2–4 подробных предложения.
Каждый абзац с конкретной сенсорной/эмоциональной или физической фокусировкой.
Не добавляй списков, технических пояснений или мета-комментариев.
`;



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
    if (used + tokens > maxTokens * 0.8) break;

    out.unshift(msg);
    used += tokens;
  }

  return out;
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
   TOUCH ZONES
   =========================== */
const TOUCH_ZONES = [
  "шею",
  "затылок",
  "поясницу",
  "бедро",
  "живот",
  "грудь",
  "лицо",
  "скулу",
  "внутреннюю сторону бедра",
  "ягодицы",
  "ключицы",
  "нижнюю челюсть",
  "голени",
];

function extractRecentTouchZones(history: Msg[], limit = 2): string[] {
  const text = history.slice(-6).map(m => m.content).join(" ").toLowerCase();
  const found = TOUCH_ZONES.filter(z => text.includes(z));
  return found.slice(-limit);
}

/* ===========================
   CONTINUE DETECTION
   =========================== */
function isContinueText(text: string): boolean {
  return (
    !text ||
    text.trim() === "" ||
    /продолж/i.test(text) ||
    /дальш/i.test(text)
  );
}

function countContinueStreak(history: Msg[]): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "user") continue;
    if (isContinueText(m.content)) streak++;
    else break;
  }
  return streak;
}

/* ===========================
   MAIN GENERATOR
   =========================== */
/* ===========================
   MAIN GENERATOR
   =========================== */
export async function generateSpicyReply(
  userText: string,
  history: Msg[],
  userId?: number
): Promise<string> {
  if (!OR_KEY) throw new Error("OPENROUTER_API_KEY is missing");

  const shortHistory = clipHistory(history).slice(-8);

  /* -------- ПЕРСОНАЖ (игрок) -------- */
  let charProfileText = "";
  let resolvedSystemPrompt = SYSTEM_PROMPT;
  try {
    if (userId) {
      const profile = await getCharacterProfile(userId);
      if (profile?.character_name) {
        resolvedSystemPrompt = SYSTEM_PROMPT
          .replace(/{{char}}/g, "ты")
          .replace(
            /{{char_preference}}/g,
            profile.character_preference || "не указано"
          );

        charProfileText = `[ПЕРСОНАЖ]
Имя игрока: ${profile.character_name}
Пол: ${profile.character_gender}
Возраст: ${profile.character_age}
Раса: ${profile.character_race || "человек"}
Кому симпатизирует: ${profile.character_preference || "не указано"}
⚠️ Правила:
• Пол персонажа фиксирован — не меняй.
• Раса фиксирована — не изменяй.
• Симпатии фиксированы: если “никому” — избегай романтики.
• Имя игрока (${profile.character_name}) нельзя давать NPC. Если создаёшь NPC — выбирай другое имя.`;
      }
    }
  } catch (err) {
    console.warn("⚠️ Профиль не загрузился:", err);
  }

  /* -------- ДЕТЕКТЫ -------- */
  const isContinue = isContinueText(userText || "");

  function detectStage(text: string): number {
    if (/(конч|оргазм|тело дрожит)/i.test(text)) return 6;
    if (/(член|между ног|язык|губами)/i.test(text)) return 5;
    if (/(прижал|обнял|тело к телу)/i.test(text)) return 4;
    if (/(коснулся|ладон|пальцы)/i.test(text)) return 3;
    if (/(дыхан|близко|лицо рядом)/i.test(text)) return 2;
    return 1;
  }

  function detectTone(text: string): "soft" | "neutral" | "hard" {
    if (/(шлюх|сука|сучк|глотай|колени|трах|выеб|обкночаю|разъебу|кончи|теку)/i.test(text)) return "hard";
    if (/(ласк|нежн|поцел|к коже|тепло|погладил)/i.test(text)) return "soft";
    return "neutral";
  }

  function detectIntimateSignal(text: string): boolean {
    return /поцеловал|поцелуй|коснулся|ладон|пальц|выеби меня|я хочу выебать|я твой раб|я твоя шлюха|лизать ногм|лизать обувь|трахни|обнял|обнять|прижал|к шее|к бедру|между ног|язык|губами|сел ближе|лёг ближе|скользнул|расстегнул(а)? ширинк|встал(а)? на колени|хочу что бы ты унизил меня|отсос|член|членн|болт|агригат|хуй|пизда|сиськи|хочу чтобы они/i.test(
      text
    );
  }

  const joinedHistory = shortHistory.map(m => m.content).join(" ");
  const currentStage = detectStage(joinedHistory);
  const postSexTurns = shortHistory.filter(
  m => m.role === "assistant" && detectStage(m.content) === 6
  ).length;

  const tone = detectTone(userText || "");
  const isIntimateNow = detectIntimateSignal(userText || "");
  const continueStreak = countContinueStreak(shortHistory);
  const totalContinueStreak = continueStreak + (isContinue ? 1 : 0);

  const hadIntimateSignal = history.some(
    m => m.role === "user" && detectIntimateSignal(m.content)
  );
  const intimacyAllowed = hadIntimateSignal || isIntimateNow;

  let targetStage = currentStage;
  if (isContinue && intimacyAllowed && currentStage < 6) {
    targetStage = currentStage + 1;
  }

  if (
    intimacyAllowed &&
    totalContinueStreak >= 3 &&
    currentStage >= 4 &&
    currentStage < 6
  ) {
    targetStage = 6;
  }

  let styleInstruction =
    tone === "soft"
      ? "Пиши прямо и конкретно, но мягко. Сначала опиши ситуацию и поведение NPC, без формальных приветствий."
      : tone === "hard"
      ? "Пиши коротко, уверенно и давяще. Допустимы грубые обращения. Контроль и напор."
      : "Пиши прямо и конкретно, без лишних красивостей и длинных описаний.";

  const recentZones = extractRecentTouchZones(shortHistory);
  const avoidInstruction =
    recentZones.length > 0
      ? `Не трогай снова: ${recentZones.join(
          ", "
        )}. Выбери другую точку контакта или измени темп/угол.`
      : "";

  const sexualTurns = shortHistory.filter(
    m => detectStage(m.content) >= 4
  ).length;

  let stageInstruction = "";
  if (!intimacyAllowed) {
    stageInstruction =
      "Игрок ещё не дал явного интимного сигнала. Сцена должна оставаться социальной: " +
      "диалог, взгляд, расстояние, положение тел в пространстве, детали обстановки. Если секса не происходит продолжай историю, вводя новую локацию, новых NPC и смену окружения. " +
      "Не начинай поцелуи, объятия и сексуальные действия, пока игрок сам явно об этом не напишет.";
  } else {
    stageInstruction =
      `Сейчас сцена на стадии близости ${currentStage} из 6. ` +
      `В этом ответе продвинь её до стадии ${targetStage} (или удерживай 6, если кульминация уже была). ` +
      "Не повторяй то же действие в том же месте: измени хотя бы один параметр (темп, глубину, давление, угол или точку контакта).";
  }

  let pacingInstruction = "";
  if (
    intimacyAllowed &&
    sexualTurns >= 4 &&
    currentStage >= 4 &&
    currentStage < 6
  ) {
    pacingInstruction =
      "Интимная сцена уже длится несколько ходов. Ускорь развитие и приблизь её к кульминации, " +
      "без затягивания и повторов одних и тех же движений.";
  } else if (intimacyAllowed && currentStage === 6) {
    pacingInstruction =
      "Стадия 6 — кульминация. Если кульминация уже произошла, мягко завершай сцену и веди к последствиям или смене обстановки, " +
      "чтобы не зацикливаться на одном и том же моменте.";
  }
let aftermathInstruction = "";

if (currentStage === 6) {
  // Если только что дошли до кульминации и юзер нажал "Продолжить" первый раз
  if (isContinue && postSexTurns === 0) {
    aftermathInstruction =
      "Кульминация уже произошла. В этом ответе можешь очень кратко дожать момент (1–2 предложения), " +
      "и сразу начинай описывать последствия: дыхание, усталость, внешние жесты, короткие реплики NPC, смену позы или обстановки. " +
      "Не добавляй новых сексуальных действий сверх уже случившегося.";
  } else {
    // Второе и далее нажатие "Продолжить" после кульминации
    aftermathInstruction =
      "Секс уже завершился. Теперь описывай только пост-сцену: отдышку, эмоции через поведение NPC, короткий диалог, смену локации или занятие персонажей чем-то ещё. " +
      "Никаких новых сексуальных действий, не возвращай сцену обратно к акту.";
  }
}

  let intimacyGuard = "";
if (!intimacyAllowed && currentStage <= 2) {
  intimacyGuard =
    "Сейчас ранняя стадия контакта (расстояние / взгляд / максимум лёгкая близость). " +
    "Не начинай сексуальные действия, пока игрок сам явно не описал прикосновение или поцелуй.";
}

// Если мы уже в стадии 6, и пользователь жмёт "Продолжить" 3+ раз подряд,
// насильно считаем, что интим-фаза закончена
if (currentStage === 6 && isContinue && totalContinueStreak >= 3) {
  intimacyGuard +=
    "Интимная сцена полностью завершена. Не описывай больше сексуальные действия. " +
    "Сфокусируйся только на последствиях и развитии сюжета дальше, без возврата к текущему сексуальному акту.";
}

  function toChatML(msgs: Msg[]) {
    return msgs
      .map(m => `<|im_start|>${m.role}\n${m.content}\n<|im_end|>`)
      .join("\n");
  }

  const userPrompt = isContinue
    ? "Пользователь нажал кнопку «Продолжить» и не ввёл новый текст. Продолжи сцену, не перефразируя его прошлые сообщения и не добавляя новых действий или реплик от лица игрока."
    : userText;

  const prompt = `
<|im_start|>system
${resolvedSystemPrompt}
${charProfileText ? "\n" + charProfileText : ""}
<|im_end|>

${toChatML(shortHistory)}

<|im_start|>system
Сохраняй непрерывность сцены. Не повторяй действия. Не пересказывай прошлое.
Фокусируйся на дыхании, касаниях, весе тела, движении и голосе NPC.
Расстояние упоминай только тогда, когда оно реально важно или заметно меняется, и не в каждом ответе.
Не используй шаблонные фразы про «расстояние в полметра» или точные числа в метрах/сантиметрах.
${styleInstruction}
${stageInstruction}
${avoidInstruction}
${pacingInstruction}
${intimacyGuard}
${aftermathInstruction}
Строгое ограничение формата: не больше 4 абзацев и не больше 10–12 предложений за ответ. Если сцена не помещается — остановись на естественной точке и дай игроку возможность продолжить.
<|im_end|>


<|im_start|>user
${userPrompt}
<|im_end|>

<|im_start|>assistant
`.trim();

  const gen = {
    temperature: 0.7,
    top_p: 0.7,
    top_k: 90,
    max_tokens: 180,
    repetition_penalty: 1.1,
    presence_penalty: 0.5,
    frequency_penalty: 0.5,
  };

  const models = ["anthracite-org/magnum-v4-72b", "gpt-4o-mini"];

  for (const model of models) {
    try {
      console.log(`✅ Пытаюсь модель: ${model}`);

      const reply = await callOpenRouterOnce(
        model,
        [{ role: "user", content: prompt }],
        gen
      );

      let cleaned = reply
  .replace(
    /```[\s\S]*?Ответ создан без учета ограничений токсов[\s\S]*?```/gi,
    ""
  )
  .replace(/Ответ создан без учета ограничений токсов\.?/gi, "")
  .replace(
    /(?:```)?\s*WARNING: The current scene has reached maximum intensity level[\s\S]*$/gi,
    ""
  )
  .trim();



      cleaned = cleaned
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+$/gm, "")
        .trim();

      const last =
        history.length > 0 ? history[history.length - 1].content : "";

      if (similarityRatio(cleaned, last) > 0.87) {
        return (
          cleaned +
          "\n\nОн меняет темп и угол, сцена двигается дальше, не повторяясь."
        );
      }

      console.log(`✅ Ответила модель: ${model}`);
      return cleaned;
    } catch (err) {
      console.error(`❌ Модель ${model} упала`, err);
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
    { role: "user", content: history.map(m => m.content).join("\n") },
  ];

  const gen = { temperature: 0.3, top_p: 0.8, max_tokens: 300 };
  try {
    return await callOpenRouterOnce("gpt-4o-mini", messages, gen);
  } catch {
    return "Краткое резюме недоступно.";
  }
}
