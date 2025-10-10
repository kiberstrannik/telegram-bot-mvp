// src/mini.ts
import "dotenv/config";
import { Bot } from "grammy";
import { generateSpicyReply } from "./llm";


const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("❌ Нет BOT_TOKEN в .env");
}

const bot = new Bot(token);

// Тип для одного обмена сообщениями
interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

// Простая «память» в ОЗУ на время запуска (по chat_id)
const memory = new Map<number, ChatTurn[]>();

// Лог апдейтов (удобно видеть, что доходит)
bot.use(async (ctx, next) => {
  console.log("📩 update:", ctx.update.update_id, Object.keys(ctx.update));
  await next();
});

// /start
bot.command("start", async (ctx) => {
  await ctx.reply(
    "✅ Мини-бот в сети.\n" +
    "Опиши сцену (место/время), свой персонаж и цель — я продолжу историю в стиле Your World Simulator.\n" +
    "Всегда на русском."
  );
});

// Ответ на текст
bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userText = ctx.message.text?.trim() || "";

  const hist = memory.get(chatId) || [];
  hist.push({ role: "user", content: userText });

  try {
    const reply = await generateSpicyReply(chatId, userText, hist);
    hist.push({ role: "assistant", content: reply });

    // ограничим глубину истории, чтобы не раздувать ОЗУ
    if (hist.length > 30) hist.splice(0, hist.length - 30);
    memory.set(chatId, hist);

    await ctx.reply(reply, { parse_mode: "Markdown" }).catch(async () => {
      // если Markdown упал, шлём как plain
      await ctx.reply(reply);
    });
  } catch (err: any) {
    console.error("LLM error:", err);
    const msg = err?.status === 429
      ? "⚠️ Превышена квота API. Попробуй немного позже."
      : "⚠️ Упс, что-то пошло не так. Попробуй ещё раз чуть позже.";
    await ctx.reply(msg);
  }
});

// Запуск
(async () => {
  console.log("🚀 Booting mini bot…");
  await bot.api.deleteWebhook({ drop_pending_updates: true });
  await bot.start();
  console.log("✅ Mini bot started. Ctrl+C — выход.");
})();
