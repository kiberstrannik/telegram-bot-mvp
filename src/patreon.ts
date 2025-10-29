import express from "express";
import fetch from "node-fetch";
import Database from "better-sqlite3";

const router = express.Router();
const db = new Database("data.db");

// 🔑 OAuth данные из Render Environment
const CLIENT_ID = process.env.PATREON_CLIENT_ID!;
const CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET!;
const REDIRECT_URI = "https://telegram-bot-mvp-il0f.onrender.com/patreon/callback";

/* ========================================
   1️⃣ Старт OAuth2 — редирект на Patreon
======================================== */
router.get("/patreon/start", (req, res) => {
  const tgId = req.query.tg;
  if (!tgId) return res.status(400).send("❌ Missing Telegram ID");

  const authUrl = new URL("https://www.patreon.com/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", "identity identity[email] memberships");
  authUrl.searchParams.set("state", tgId.toString());

  console.log(`🔗 OAuth redirect для TG ${tgId}`);
  res.redirect(authUrl.toString());
});

/* ========================================
   2️⃣ Callback — обмен code → access_token
======================================== */
router.get("/patreon/callback", async (req, res) => {
  try {
    const code = req.query.code as string;
    const tgId = req.query.state as string;
    if (!code || !tgId) return res.status(400).send("❌ Missing data");

    console.log(`🎯 Patreon callback для TG ${tgId}`);

    // 🔁 Получаем токен
    const tokenRes = await fetch("https://www.patreon.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error("❌ Ошибка получения токена:", tokenData);
      return res.status(500).send("OAuth error");
    }

    // 👤 Запрашиваем данные пользователя
    const userRes = await fetch(
      "https://www.patreon.com/api/oauth2/v2/identity?include=memberships&fields[email]=email,full_name",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const userData = await userRes.json();
    const email = userData.data?.attributes?.email || "unknown";
    const name = userData.data?.attributes?.full_name || "Unknown";

    console.log(`✅ Patreon подключен: ${name} (${email}) для Telegram ID ${tgId}`);

    // 💾 Активируем premium (без новых колонок)
    db.prepare("UPDATE users SET premium = 1 WHERE id = ?").run(tgId);
    console.log(`💎 Premium активирован для Telegram ID ${tgId}`);

    // 🧠 Можно позже сохранить email в отдельную таблицу связей, если нужно

    // 🖥 Отображаем пользователю подтверждение
    res.send(`
      <html>
        <body style="font-family:sans-serif;text-align:center;margin-top:50px;">
          <h2>✅ Patreon успешно подключен!</h2>
          <p>Теперь можешь вернуться в Telegram-бота.</p>
          <p style="opacity:0.6;">TG ID: ${tgId}<br>Email: ${email}</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ Ошибка в Patreon callback:", err);
    res.status(500).send("Server error");
  }
});

export default router;
