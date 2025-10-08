import "dotenv/config";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import {
  upsertUser,
  addMessage,
  getHistory,
  resetUser,
  exportMessages,
  isPremium,
  setPremium,
  getMessageCount,
  setAgeVerified,
  getAgeVerified,
  updateCharacterField,
  getCharacterProfile,
} from "./db";

import type { Msg } from "./llm";
import { generateSpicyReply, translateToRussian, summarizeHistory } from "./llm";

const token = process.env.BOT_TOKEN!;
const bot = new Bot(token);

const PAYWALL_LIMIT = 100;
const SUMMARY_EVERY = 20;

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
] as const;

const userState = new Map<number, number>();

const WELCOME_TEXT = `
🌌 Добро пожаловать в *Your World Simulator*.

Теперь, когда твой персонаж создан, можешь начать приключение:  
• Опиши, где ты находишься.  
• Что происходит вокруг?  
• С кем ты?  
Я продолжу историю от лица мира и других персонажей.
`;

/* ===========================
   COMMANDS
   =========================== */
bot.command("start", async (ctx) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  await upsertUser(userId, ctx.from.username, ctx.from.first_name, ctx.from.last_name);

  const ageStatus = await getAgeVerified(userId);
  if (ageStatus === -1) return ctx.reply("🚫 Доступ только для пользователей 18+.");
  if (ageStatus === 0) return ctx.reply("⚠️ Тебе уже есть 18 лет?", { reply_markup: ageKeyboard() });

  const char = getCharacterProfile(userId);
  if (!char.character_name) {
    userState.set(userId, 0);
    return ctx.reply("🎭 Давай создадим твоего персонажа!\n" + creationSteps[0].question);
  }

  return ctx.reply(WELCOME_TEXT, { reply_markup: actionKeyboard() });
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
    updateCharacterField(chatId, current.key, text);

    if (step + 1 < creationSteps.length) {
      userState.set(chatId, step + 1);
      return ctx.reply(creationSteps[step + 1].question);
    }

    userState.delete(chatId);
    const profile = getCharacterProfile(chatId);
    await ctx.reply(
      `✨ Персонаж создан!\n\n` +
        `Имя: *${profile.character_name}*\n` +
        `Пол: *${profile.character_gender}*\n` +
        `Возраст: *${profile.character_age}*\n` +
        `Волосы: *${profile.character_hair}*\n` +
        `Характер: *${profile.character_traits}*`,
      { parse_mode: "Markdown" }
    );
    return ctx.reply(WELCOME_TEXT, { reply_markup: actionKeyboard() });
  }

  // === обычный диалог после создания ===
  const count = await getMessageCount(chatId);
  if (!(await isPremium(chatId)) && count >= PAYWALL_LIMIT)
    return ctx.reply(
      "⚠️ Лимит бесплатных сообщений исчерпан.\nЧтобы продолжить — оплатите доступ.",
      { reply_markup: new InlineKeyboard().text("💳 Оплатить", "buy_premium") }
    );

  await ctx.api.sendChatAction(ctx.chat.id, "typing");
  await addMessage(chatId, "user", text, text);

  let hist = await getHistory(chatId);
  if (hist.length % SUMMARY_EVERY === 0) {
    const summary = await summarizeHistory(hist);
    await addMessage(chatId, "system", `[SUMMARY]: ${summary}`);
    hist = await getHistory(chatId);
  }

  const replyOriginal = await generateSpicyReply(text, hist);
  const replyTranslated = /[a-zA-Z]{4,}/.test(replyOriginal)
    ? await translateToRussian(replyOriginal)
    : replyOriginal;

  await addMessage(chatId, "assistant", replyOriginal, replyTranslated);
  await ctx.reply(replyTranslated, { reply_markup: actionKeyboard() });
});

/* ===========================
   CALLBACKS
   =========================== */
bot.callbackQuery("continue", async (ctx) => {
  const hist = await getHistory(ctx.from!.id);
  const replyOriginal = await generateSpicyReply("", hist);
  const replyTranslated = /[a-zA-Z]{4,}/.test(replyOriginal)
    ? await translateToRussian(replyOriginal)
    : replyOriginal;
  await addMessage(ctx.from!.id, "assistant", replyOriginal, replyTranslated);
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
   RUN
   =========================== */
(async () => {
  console.log("🚀 Bot running with character creation + 18+ check + paywall");
  await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
  await bot.start();
})();
