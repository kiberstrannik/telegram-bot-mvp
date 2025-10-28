// src/paymentCrypto.ts
import express from "express";
import { Request, Response } from "express";
const router = express.Router();

// Заглушка — без платежей
router.get("/payment/start", (req: Request, res: Response) => {
  res.send("💎 Платежная система временно недоступна. Используй Patreon для поддержки проекта ❤️");
});

export default router;
