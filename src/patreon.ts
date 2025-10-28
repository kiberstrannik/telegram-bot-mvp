// src/patreon.ts
import express, { Request, Response } from "express";
import axios from "axios";
import Database from "better-sqlite3";

const router = express.Router();
const db = new Database("data.db");

const CLIENT_ID = process.env.PATREON_CLIENT_ID!;
const CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET!;
const REDIRECT_URI = "https://yourworldsimulator.onrender.com/patreon/callback";

// Шаг 1: начало авторизации
router.get("/patreon/start", (req: Request, res: Response) => {
  const tgId = req.query.tg;
  if (!tgId) return res.status(400).send("Missing tg parameter");

  const authUrl = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=identity%20campaigns.members`;
  res.redirect(authUrl);
});

// Шаг 2: колбэк от Patreon
router.get("/patreon/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) return res.status(400).send("Missing code");

  try {
    // Обмен кода на токен
    const tokenRes = await axios.post("https://www.patreon.com/api/oauth2/token", null, {
      params: {
        grant_type: "authorization_code",
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      },
    });

    const accessToken = tokenRes.data.access_token;

    // Получаем данные пользователя Patreon
    const userRes = await axios.get("https://www.patreon.com/api/oauth2/v2/identity", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const user = userRes.data.data;
    const patreonId = user.id;
    const email = user.attributes.email;

    db.prepare("UPDATE users SET patreon_user_id = ?, patreon_status = 'active', premium = 1 WHERE email = ?")
      .run(patreonId, email);

    res.send(`
      <html>
        <body style="font-family:sans-serif;text-align:center;margin-top:50px;">
          <h2>💎 Patreon успешно привязан!</h2>
          <p>Теперь можешь вернуться в Telegram и продолжить приключение 🚀</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ Patreon callback error:", err);
    res.status(500).send("Ошибка при авторизации Patreon");
  }
});

export default router;
