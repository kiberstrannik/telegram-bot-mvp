// src/index.ts
import "dotenv/config";
import path from "path";
import { Bot, InlineKeyboard } from "grammy";
import paymentRouter from "./paymentCrypto";
import Database from "better-sqlite3";
import express, { Request, Response } from "express";

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
   EXPRESS SERVER
   =========================== */
const app = express();

// ✅ Раздаём HTML-страницы (если public внутри src)
app.use(express.static(path.join(process.cwd(), "src/public")));

// ✅ Маршрут платежей (теперь заглушка)
app.use("/", paymentRouter);

app.get("/", (req: Request, res: Response) => {
  res.send("🌐 YourWorldSimulator онлайн. Webhook активен.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Express сервер запущен на порту ${PORT}`)
);

/* ===========================
   TELEGRAM BOT INIT
   =========================== */
const token = process.env.BOT_TOKEN!;
if (!token) throw new Error("❌ BOT_TOKEN отсутствует в .env");

const bot = new Bot(token);
const ADMIN_GROUP_ID = -1003218588633;
const PAYWALL_LIMIT = 10;
const db = new Database("data.db");

/* ===========================
   ADMIN COMMANDS
   =========================== */
bot.command("resetpremium", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return ctx.reply("⚠️ Ошибка: не удалось определить ID пользователя.");

  const ADMIN_ID = 448157054;
  if (userId !== ADMIN_ID) return ctx.reply("⛔ У тебя нет прав использовать эту команду.");

  const user = db.prepare("SELECT premium FROM users WHERE id = ?").get(userId);
  const currentStatus = user?.premium === 1;
  const newStatus = currentStatus ? 0 : 1;

  db.prepare("UPDATE users SET premium = ? WHERE id = ?").run(newStatus, userId);

  ctx.reply(newStatus ? "💎 Premium активирован вручную." : "🚫 Premium отключён вручную.");
  console.log(`🔁 Premium для ${userId} изменён на: ${newStatus}`);
});

bot.command("whoami", async (ctx) => {
  const user = ctx.from;
  if (!user) return ctx.reply("⚠️ Ошибка: не удалось получить данные пользователя.");
  await ctx.reply(
    `👤 Твой Telegram ID: *${user.id}*\nИмя: *${user.first_name || "-"}*\nЮзернейм: *@${user.username || "нет"}*`,
    { parse_mode: "Markdown" }
  );
});

bot.command("setpremium", async (ctx) => {
  const adminId = ctx.from?.id;
  const ADMIN_ID = 448157054;
  if (adminId !== ADMIN_ID) return ctx.reply("⛔ У тебя нет прав использовать эту команду.");

  const args = ctx.message?.text?.split(" ").filter(Boolean);
  if (!args || args.length < 3)
    return ctx.reply("⚙️ Использование: /setpremium <user_id> <on|off>");

  const targetId = Number(args[1]);
  const action = args[2].toLowerCase();
  if (isNaN(targetId)) return ctx.reply("❌ Неверный ID пользователя.");

  const newStatus = action === "on" ? 1 : 0;
  const userExists = db.prepare("SELECT id FROM users WHERE id = ?").get(targetId);
  if (!userExists) return ctx.reply("⚠️ Пользователь с таким ID не найден в базе.");

  db.prepare("UPDATE users SET premium = ? WHERE id = ?").run(newStatus, targetId);
  ctx.reply(newStatus ? `💎 Premium активирован для ${targetId}.` : `🚫 Premium отключён для ${targetId}.`);
  console.log(`🔧 Premium для ${targetId} изменён на ${newStatus}`);
});

bot.command("privacy", async (ctx) => {
  await ctx.reply("🛡 Политика конфиденциальности: https://yourworldsimulator.onrender.com/privacy.html");
});

bot.command("terms", async (ctx) => {
  await ctx.reply("📜 Условия использования: https://yourworldsimulator.onrender.com/terms.html");
});

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
  { key: "character_race", question: "🧬 К какой расе принадлежит твой персонаж?" },
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

*Важно:* Бот предназначен только для пользователей 18+.  
(Когда тапаешь по кнопке “Продолжить” — подожди 2–4 секунды 😉)
`;

/* ===========================
   START COMMAND
   =========================== */
bot.command("start", async (ctx) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;

  const existingUser = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!existingUser) {
    console.log("🆕 Новый пользователь:", ctx.from);
    await bot.api.sendMessage(
      ADMIN_GROUP_ID,
      `🆕 *Новый пользователь!*\nИмя: *${ctx.from.first_name || "-"}*\nUsername: @${ctx.from.username || "нет"}\nID: \`${userId}\``,
      { parse_mode: "Markdown" }
    );
  }

  await upsertUser(userId, ctx.from.username, ctx.from.first_name, ctx.from.last_name);

  const ageStatus = await getAgeVerified(userId);
  if (ageStatus === -1) return ctx.reply("🚫 Доступ только для пользователей 18+.");
  if (ageStatus === 0)
    return ctx.reply("⚠️ Тебе уже есть 18 лет?", { reply_markup: ageKeyboard() });

  const char = (await getCharacterProfile(userId)) as CharacterProfile | null;
  if (!char || !char.character_name) {
    userState.set(userId, 0);
    return ctx.reply("🎭 Давай создадим твоего персонажа!\n" + creationSteps[0].question);
  }

  await ctx.reply(WELCOME_TEXT);
  setTimeout(() => {
    ctx.reply("Теперь можешь выбрать действие 👇", { reply_markup: actionKeyboard() });
  }, 2000);
});

/* ===========================
   GAME LOGIC
   =========================== */
bot.on("message:text", async (ctx, next) => {
  if (ctx.message.text.startsWith("/")) return;
  await next();
});

// 💬 Основная игровая логика
bot.on("message:text", async (ctx) => {
  if (!ctx.from) return;
  const chatId = ctx.from.id;
  const text = ctx.message.text.trim();

  // Создание персонажа
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
      `✨ Персонаж создан!\n\nИмя: *${profile.character_name || "не указано"}*\nПол: *${profile.character_gender || "не указано"}*\nВозраст: *${profile.character_age || "не указано"}*\nРаса: *${profile.character_race || "не указано"}*\nКому симпатизирует: *${profile.character_preference || "не указано"}*`,
      { parse_mode: "Markdown" }
    );

    return ctx.reply(WELCOME_TEXT);
  }

  const count = await getMessageCount(chatId);

  if (count === 2 && !(await isPremium(chatId))) {
    const payKeyboard = new InlineKeyboard().url(
      "💎 Поддержать на Patreon",
      "https://www.patreon.com/cw/YouWorldSimulator"
    );
    return ctx.reply(
      "✨ Хочешь продолжить приключение без ограничений?\n💎 Поддержи проект на Patreon и получи Premium-доступ!",
      { reply_markup: payKeyboard, parse_mode: "Markdown" }
    );
  }

  if (!(await isPremium(chatId)) && count >= PAYWALL_LIMIT)
    return ctx.reply(
      "⚠️ Лимит бесплатных сообщений исчерпан.\nЧтобы продолжить — поддержи проект на Patreon ❤️\n" +
        "Это поможет развивать *YourWorldSimulator* и добавлять новые миры!",
      {
        reply_markup: new InlineKeyboard().url(
          "💎 Поддержать на Patreon",
          "https://www.patreon.com/cw/YouWorldSimulator"
        ),
      }
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
  await ctx.reply(replyTranslated, { reply_markup: actionKeyboard() });
});

/* ===========================
   RENDER START
   =========================== */
(async () => {
  console.log("🚀 Bot running on Render (Background Worker mode)");

  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Начать заново" },
      { command: "privacy", description: "Политика конфиденциальности" },
      { command: "terms", description: "Условия использования" },
      { command: "resetpremium", description: "Переключить Premium вручную" },
      { command: "whoami", description: "Показать мой Telegram ID" },
    ]);

    if (process.env.NODE_ENV === "production") {
      await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
      await bot.start();
      console.log("✅ Бот запущен на Render");
    } else {
      console.log("💻 Локальный режим — убедись, что бот на Render приостановлен.");
      await bot.start();
      console.log("✅ Бот запущен локально");
    }
  } catch (err) {
    console.error("❌ Ошибка запуска бота:", err);
  }
})();
