import express from "express";
import axios from "axios";
import Database from "better-sqlite3";

const router = express.Router();
const db = new Database("data.db");

/* ===========================
   🔐 Patreon OAuth конфигурация
   =========================== */
const CLIENT_ID = process.env.PATREON_CLIENT_ID!;
const CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET!;
const REDIRECT_URI = "https://yourworldsimulator.onrender.com/patreon/callback";

/* ===========================
   1️⃣ Начало авторизации
   =========================== */
router.get("/patreon/start", (req, res) => {
  const tgId = req.query.tg; // Telegram user ID, передаётся из кнопки
  const url = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&scope=identity identity.memberships&state=${tgId}`;
  res.redirect(url);
});

/* ===========================
   2️⃣ Callback от Patreon
   =========================== */
router.get("/patreon/callback", async (req, res) => {
  const code = req.query.code as string;
  const tgId = req.query.state as string;

  if (!code || !tgId) {
    return res.status(400).send("Ошибка: отсутствует код авторизации.");
  }

  try {
    // 🚀 Обмен кода на access_token
    const tokenRes = await axios.post("https://www.patreon.com/api/oauth2/token", null, {
      params: {
        code,
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      },
    });

    const accessToken = tokenRes.data.access_token;
    console.log("✅ Patreon access token получен");

    // 📩 Получаем данные пользователя Patreon
    const userRes = await axios.get("https://www.patreon.com/api/oauth2/v2/identity?include=memberships", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const patreonUserId = userRes.data.data.id;
    const email = userRes.data.data.attributes.email;
    const memberships = userRes.data.included || [];

    const active = memberships.some(
      (m: any) => m.type === "member" && m.attributes.patron_status === "active_patron"
    );

    console.log(`👤 Patreon user ${patreonUserId} (${email}) — active=${active}`);

    // 💾 Сохраняем в базу
    db.prepare(
      "UPDATE users SET patreon_user_id = ?, patreon_status = ?, premium = ? WHERE id = ?"
    ).run(patreonUserId, active ? "active" : "inactive", active ? 1 : 0, tgId);

    // ✅ Ответ пользователю
    return res.send(`
      <html>
        <head><meta charset="utf-8"/><title>Patreon связка</title></head>
        <body style="font-family: sans-serif; text-align:center; margin-top:100px;">
          <h2>${active ? "💎 Связка успешно выполнена!" : "🔗 Аккаунт связан, но подписка не активна."}</h2>
          <p>Теперь можешь вернуться в Telegram и продолжить приключение.</p>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("❌ Ошибка при авторизации Patreon:", err.response?.data || err.message);
    return res.status(500).send("Ошибка при связывании Patreon.");
  }
});

/* ===========================
   3️⃣ Проверка статуса вручную (для тестов)
   =========================== */
router.get("/patreon/status/:tgId", (req, res) => {
  const tgId = req.params.tgId;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(tgId);
  if (!user) return res.status(404).send("Пользователь не найден.");
  res.json({
    tg_id: tgId,
    premium: user.premium,
    patreon_user_id: user.patreon_user_id,
    patreon_status: user.patreon_status,
  });
});

export default router;
