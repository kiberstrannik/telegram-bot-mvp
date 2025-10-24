// src/paymentCrypto.ts
import "dotenv/config";
import express from "express";
import axios from "axios";
import Database from "better-sqlite3";

const router = express.Router();
router.use(express.json());

/* ===========================
   🔐 Конфигурация
   =========================== */
const CRYPTOCLOUD_API_KEY = process.env.CRYPTOCLOUD_API_KEY!;
const CRYPTOCLOUD_SHOP_ID = process.env.CRYPTOCLOUD_SHOP_ID!;
const BASE_URL = "https://api.cryptocloud.plus/v1";
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || "my_secret_key";

const db = new Database("data.db");

/* ===========================
   1️⃣ Создание ссылки на оплату
   =========================== */
export async function createPayment(userId: number, amount = 5) {
  try {
    const res = await axios.post(
      `${BASE_URL}/invoice/create`,
      {
        shop_id: CRYPTOCLOUD_SHOP_ID,
        amount: amount,
        currency: "USDT_TRC20",
        order_id: `${userId}_${Date.now()}`,
        description: "Premium-доступ в YourWorldSimulator на 30 дней",
        lifetime: 3600,
      },
      {
        headers: {
          Authorization: `Token ${CRYPTOCLOUD_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Ответ CryptoCloud:", res.data);

    // ✅ Исправление — ссылка теперь берётся из pay_url
    const payUrl = res.data?.pay_url || res.data?.result?.link;
    if (!payUrl) throw new Error("Не удалось получить ссылку оплаты");

    return payUrl;
  } catch (err: any) {
    console.error("❌ Ошибка при создании ссылки оплаты:", err.response?.data || err.message);
    throw err;
  }
}

/* ===========================
   2️⃣ Обработка уведомления (callback от CryptoCloud)
   =========================== */
/* ===========================
   2️⃣ Обработка уведомления (webhook)
   =========================== */
router.post("/callback", express.json(), async (req, res) => {
  try {
    console.log("📩 Получен callback от CryptoCloud:", req.body);
        const receivedSecret = req.headers["x-secret-key"] || req.body.secret;
    if (CALLBACK_SECRET && receivedSecret && receivedSecret !== CALLBACK_SECRET) {
      console.warn("❌ Неверный секретный ключ в callback");
      return res.status(403).json({ ok: false, error: "Invalid secret" });
    }


    const { status, order_id } = req.body;

    if (status === "paid" && order_id) {
      const userId = parseInt(order_id.split("_")[0]);
      console.log(`💰 Пользователь ${userId} успешно оплатил Premium.`);

      const db = require("better-sqlite3")("data.db");
      db.prepare("UPDATE users SET premium = 1 WHERE id = ?").run(userId);

      console.log(`✅ Premium активирован для пользователя ${userId}`);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("⚠️ Ошибка при обработке callback:", err);
    res.status(500).json({ ok: false });
  }
});


/* ===========================
   3️⃣ Пометка пользователя как Premium
   =========================== */
function markUserAsPremium(userId: number) {
  try {
    db.prepare("UPDATE users SET premium = 1 WHERE id = ?").run(userId);
    console.log(`⭐ Premium активирован для пользователя ${userId}`);
  } catch (err) {
    console.error("❌ Ошибка при обновлении премиум-статуса:", err);
  }
}

/* ===========================
   4️⃣ (опционально) Страницы успеха / ошибки
   =========================== */
router.get("/payment/success", (req, res) => {
  res.send("✅ Оплата прошла успешно! Можешь вернуться в Telegram и продолжить приключение.");
});

router.get("/payment/fail", (req, res) => {
  res.send("❌ Оплата не прошла. Попробуй ещё раз или выбери другой способ.");
});

export default router;
