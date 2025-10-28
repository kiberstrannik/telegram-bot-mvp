import express from "express";
import fetch from "node-fetch";
import Database from "better-sqlite3";

const router = express.Router();
const db = new Database("data.db");

// 🔑 Данные клиента Patreon из твоего Dashboard
const CLIENT_ID = process.env.PATREON_CLIENT_ID!;
const CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET!;
const REDIRECT_URI = "https://telegram-bot-mvp-il0f.onrender.com/patreon/callback";

// 1️⃣ Старт OAuth2 — перенаправление на авторизацию Patreon
router.get("/patreon/start", (req, res) => {
  const tgId = req.query.tg;
  if (!tgId) return res.status(400).send("Missing Telegram ID");

  const authUrl = new URL("https://www.patreon.com/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", "identity identity[email] memberships");
  authUrl.searchParams.set("state", tgId.toString());

  res.redirect(authUrl.toString());
});

// 2️⃣ Callback от Patreon после входа
router.get("/patreon/callback", async (req, res) => {
  try {
    const code = req.query.code as string;
    const tgId = req.query.state as string;
    if (!code || !tgId) return res.status(400).send("Missing data");

    // 🔁 Обмениваем code на токен
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
    const userRes = await fetch("https://www.patreon.com/api/oauth2/v2/identity?include=memberships&fields[email]=email,full_name", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData = await userRes.json();

    const email = userData.data?.attributes?.email;
    const name = userData.data?.attributes?.full_name;

    if (!email) return res.status(400).send("No email returned from Patreon");

    console.log(`✅ Patreon подключен: ${name} (${email}) для Telegram ID ${tgId}`);

    // 💾 Сохраняем в БД
    db.prepare("UPDATE users SET patreon_user_id = ?, patreon_status = ?, premium = 1 WHERE id = ?")
      .run(email, "active_patron", tgId);

    res.send(`<html><body><h2>✅ Patreon успешно подключен!</h2><p>Теперь можешь вернуться в Telegram-бота.</p></body></html>`);
  } catch (err) {
    console.error("❌ Ошибка в Patreon callback:", err);
    res.status(500).send("Server error");
  }
});

export default router;
