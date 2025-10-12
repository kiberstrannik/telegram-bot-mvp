import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
import {
  upsertUser,
  addMessage,
  getHistory,
  resetUser,
  isPremium,
  getMessageCount,
  getAgeVerified,
  updateCharacterField,
  getCharacterProfile,
} from "./db";

import type { CharacterProfile } from "./db";
import { generateSpicyReply, translateToRussian, summarizeHistory } from "./llm";

/* ===========================
   INIT BOT
   =========================== */
const token = process.env.BOT_TOKEN!;
if (!token) {
  throw new Error("❌ BOT_TOKEN отсутствует в .env");
}

const bot = new Bot(token);

const PAYWALL_LIMIT = 100;

/* ===========================
   HELPERS
   =========================== */
function actionKeyboard() {
  return new InlineKeyboard()
    .text("▶️ Продолжить", "continue")
    .row()
    .text("🌍 Создать новый мир", "new_world")
    .row()
    .text("🧠 Забыть последнее сообщение", "forget_last");
}

function ageKeyboard() {
  return new InlineKeyboard()
    .text("✅ Мне есть 18 лет", "age_yes")
    .row()
    .text("❌ Мне нет 18 лет", "age_no");
}

/* ===========================
   CHARACTER CREATION
   =========================== */
const creationSteps = [
  { key: "character_name", question: "🧙 Как зовут твоего персонажа?" },
  { key: "character_gender", question: "⚧ Укажи пол персонажа (м/ж/другое):" },
  { key: "character_age", question: "🎂 Сколько лет твоему персонажу?" },
  { key: "character_hair", question: "💇 Опиши цвет и длину волос:" },
  { key: "character_traits", question: "✨ Опиши несколько черт характера:" },
  { key: "character_preference", question: "💞 Кому симпатизирует твой персонаж? (мужчинам, женщинам, обоим, никому)" },
] as const;

const userState = new Map<number, number>();

const WELCOME_TEXT = `
🌌 Добро пожаловать в *Your World Simulator*.

Теперь, когда твой персонаж создан, можешь начать приключение:  
• Опиши, где ты находишься.  
• Что происходит вокруг?  
• С кем ты?  
Я продолжу историю от лица мира и других персонажей (можешь дополнять и сам развивать сюжет).

*Примеры команд:*  
• "Я просыпаюсь в таинственном лесу, окружённом высокими деревьями..."  
• "В таверне я встречаю загадочного незнакомца с тёмными глазами..."  
• "Вдруг небо затягивают тёмные тучи, и начинается гроза..."

*Советы по игре:*  
• Чем подробнее опишешь ситуацию, тем интереснее будет ответ.  
• Добавляй эмоции, ощущения и детали окружения.  
• Не бойся экспериментировать и вводить неожиданные повороты сюжета.

*Важно:*  
• Бот предназначен только для пользователей 18+.  

(Когда тапаешь по кнопке “Продолжить” — подожди 2–4 секунды 😉)
`;

/* ===========================
   START COMMAND
   =========================== */
bot.command("start", async (ctx) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  await upsertUser(userId, ctx.from.username, ctx.from.first_name, ctx.from.last_name);

  const ageStatus = await getAgeVerified(userId);
  if (ageStatus === -1) return ctx.reply("🚫 Доступ только для пользователей 18+.");
  if (ageStatus === 0) return ctx.reply("⚠️ Тебе уже есть 18 лет?", { reply_markup: ageKeyboard() });

  const char = (await getCharacterProfile(userId)) as CharacterProfile | null;
  if (!char || !char.character_name) {
    userState.set(userId, 0);
    return ctx.reply("🎭 Давай создадим твоего персонажа!\n" + creationSteps[0].question);
  }

  return ctx.reply(WELCOME_TEXT, { reply_markup: actionKeyboard() });
});

/* ===========================
   AGE VERIFICATION
   =========================== */
import Database from "better-sqlite3";
const db = new Database("data.db");

bot.callbackQuery("age_yes", async (ctx) => {
  const userId = ctx.from!.id;
  const stmt = db.prepare(`UPDATE users SET age_verified = 1 WHERE id = ?`);
  stmt.run(userId);

  await ctx.answerCallbackQuery({ text: "✅ Доступ разрешён!" });
  userState.set(userId, 0);
  await ctx.reply("🎭 Отлично! Теперь создадим твоего персонажа.\n🧙 Как его зовут?");
});

bot.callbackQuery("age_no", async (ctx) => {
  const userId = ctx.from!.id;
  const stmt = db.prepare(`UPDATE users SET age_verified = -1 WHERE id = ?`);
  stmt.run(userId);

  await ctx.answerCallbackQuery({ text: "🚫 Доступ запрещён." });
  await ctx.reply("Извини, но доступ к этому боту только для пользователей 18+ ❌");
});

/* ===========================
   CHARACTER CREATION FLOW
   =========================== */
bot.on("message:text", async (ctx) => {
  if (!ctx.from) return;
  const chatId = ctx.from.id;
  const text = ctx.message.text.trim();

  if (userState.has(chatId)) {
    const step = userState.get(chatId)!;
    const current = creationSteps[step];
    await updateCharacterField(chatId, current.key, text);

    if (step + 1 < creationSteps.length) {
      userState.set(chatId, step + 1);
      return ctx.reply(creationSteps[step + 1].question);
    }

    userState.delete(chatId);
    const profile = (await getCharacterProfile(chatId)) as CharacterProfile | null;
    if (!profile) return ctx.reply("⚠️ Ошибка: не удалось получить профиль персонажа.");

    await ctx.reply(
      `✨ Персонаж создан!\n\n` +
        `Имя: *${profile?.character_name || "не указано"}*\n` +
        `Пол: *${profile?.character_gender || "не указано"}*\n` +
        `Возраст: *${profile?.character_age || "не указано"}*\n` +
        `Волосы: *${profile?.character_hair || "не указано"}*\n` +
        `Характер: *${profile?.character_traits || "не указано"}*\n` +
        `Кому симпатизирует: *${profile?.character_preference || "не указано"}*`,
      { parse_mode: "Markdown" }
    );
    return ctx.reply(WELCOME_TEXT, { reply_markup: actionKeyboard() });
  }

  const count = await getMessageCount(chatId);
  if (!(await isPremium(chatId)) && count >= PAYWALL_LIMIT)
    return ctx.reply(
      "⚠️ Лимит бесплатных сообщений исчерпан.\nЧтобы продолжить — оплатите доступ.",
      { reply_markup: new InlineKeyboard().text("💳 Оплатить", "buy_premium") }
    );

  await ctx.api.sendChatAction(ctx.chat.id, "typing");
  await addMessage(chatId, "user", text, text);

  let hist = await getHistory(chatId);
  if (hist.length > 12) {
    const oldPart = hist.slice(0, -8);
    const summary = await summarizeHistory(oldPart);
    hist = [{ role: "system", content: `[SUMMARY]: ${summary}` }, ...hist.slice(-8)];
  }

  const replyOriginal = await generateSpicyReply(text, hist, ctx.from.id);
  const replyTranslated = /[a-zA-Z]{4,}/.test(replyOriginal)
    ? await translateToRussian(replyOriginal)
    : replyOriginal;

  await addMessage(chatId, "assistant", replyOriginal, replyTranslated);
  const currentHistory = getHistory(chatId);
if ((await currentHistory).length > 20) {
  try {
    console.log("🌀 Сжимаем историю, чтобы избежать повторов и переполнения...");
    const summary = await summarizeHistory(await currentHistory);
    resetUser(chatId);
    addMessage(chatId, "system", `[РЕЗЮМЕ СЮЖЕТА]: ${summary}`);
    console.log("✅ История успешно сжата и обновлена.");
  } catch (err) {
    console.warn("⚠️ Ошибка при сжатии истории:", err);
  }
}
  await ctx.reply(replyTranslated, { reply_markup: actionKeyboard() });
});

/* ===========================
   CALLBACKS
   =========================== */
bot.callbackQuery("continue", async (ctx) => {
  const chatId = ctx.from!.id;
  let hist = await getHistory(chatId);
  hist = hist.filter((m, i, arr) => i === 0 || m.content !== arr[i - 1].content);

  if (hist.length > 12) {
    const oldPart = hist.slice(0, -8);
    const summary = await summarizeHistory(oldPart);
    hist = [{ role: "system", content: `[SUMMARY]: ${summary}` }, ...hist.slice(-8)];
  }

  await ctx.api.sendChatAction(chatId, "typing");

  hist.push({ role: "user", content: "[Продолжить сцену]" });

  const replyOriginal = await generateSpicyReply("[Продолжить сцену]", hist, chatId);
  const replyTranslated = /[a-zA-Z]{4,}/.test(replyOriginal)
    ? await translateToRussian(replyOriginal)
    : replyOriginal;

  const last = hist[hist.length - 1]?.content;
  if (last !== replyTranslated) {
    await addMessage(chatId, "assistant", replyOriginal, replyTranslated);
  }

  await ctx.reply(replyTranslated, { reply_markup: actionKeyboard() });
});

bot.callbackQuery("new_world", async (ctx) => {
  if (!ctx.from) return;
  await resetUser(ctx.from.id);
  userState.set(ctx.from.id, 0);
  await ctx.reply("🆕 Мир очищен!\n🎭 Давай создадим нового персонажа!\n" + creationSteps[0].question);
});

bot.callbackQuery("forget_last", async (ctx) => {
  await resetUser(ctx.from!.id);
  await ctx.reply("🧠 Последнее сообщение забыто.", { reply_markup: actionKeyboard() });
});

/* ===========================
   RUN BOT
   =========================== */
(async () => {
  console.log("🚀 Bot running on Render (Background Worker mode)");
  await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
  await bot.start();
})();
