import { Bot } from "grammy";
import "dotenv/config";

(async () => {
  const bot = new Bot(process.env.BOT_TOKEN!);
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    console.log("✅ Webhook и polling сброшены.");
  } catch (err) {
    console.error("❌ Ошибка сброса:", err);
  }
})();

