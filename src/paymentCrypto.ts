import "dotenv/config";
import express, { Request, Response } from "express";
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
   1️⃣ Страница старта оплаты
   =========================== */
router.get("/payment/start", (req: Request, res: Response) => {
  res.send(`
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>Оплата Premium — YourWorldSimulator</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #0e0f14;
            color: #e8e8e8;
            text-align: center;
            margin-top: 100px;
          }
          a {
            background: #007aff;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 8px;
            font-size: 18px;
          }
          a:hover {
            background: #005ecc;
          }
        </style>
      </head>
      <body>
        <h1>💎 Оплата Premium</h1>
        <p>Выберите способ оплаты для разблокировки всех возможностей мира YourWorldSimulator.</p>
        <a href="/payment/success">💳 Оплатить картой / CryptoCloud</a>
      </body>
    </html>
  `);
});

/* ===========================
   2️⃣ Создание ссылки оплаты
   =========================== */
export async function createPayment(userId: number, amount = 5) {
  try {
    const res = await axios.post(
      `${BASE_URL}/invoice/create`,
      {
        shop_id: CRYPTOCLOUD_SHOP_ID,
        amount,
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

    const payUrl = res.data?.pay_url || res.data?.result?.link;
    if (!payUrl) throw new Error("Не удалось получить ссылку оплаты");

    return payUrl;
  } catch (err: any) {
    console.error("❌ Ошибка при создании ссылки оплаты:", err.response?.data || err.message);
    throw err;
  }
}

/* ===========================
   3️⃣ Callback от CryptoCloud
   =========================== */
router.post("/callback", async (req: Request, res: Response) => {
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
   4️⃣ Страницы успеха / ошибки
   =========================== */
router.get("/payment/success", (req: Request, res: Response) => {
  res.send(`
    <html>
      <head><meta charset="utf-8"/><title>Оплата успешна</title></head>
      <body style="text-align:center; font-family:sans-serif; margin-top:100px;">
        <h2>✅ Оплата прошла успешно!</h2>
        <p>Теперь вы можете вернуться в Telegram и продолжить приключение.</p>
      </body>
    </html>
  `);
});

router.get("/payment/fail", (req: Request, res: Response) => {
  res.send(`
    <html>
      <head><meta charset="utf-8"/><title>Ошибка оплаты</title></head>
      <body style="text-align:center; font-family:sans-serif; margin-top:100px;">
        <h2>❌ Оплата не прошла.</h2>
        <p>Попробуйте снова или выберите другой способ оплаты.</p>
      </body>
    </html>
  `);
});

export default router;
