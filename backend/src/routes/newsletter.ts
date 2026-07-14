import { Router } from "express";
import { db } from "../db/index.js";

const router = Router();
const now = () => new Date().toISOString();

router.post("/subscribe", (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  try {
    db.prepare("INSERT INTO newsletter_subscribers (email, subscribed_at) VALUES (?, ?)").run(email, now());
    res.status(201).json({ ok: true, message: "Subscribed successfully" });
  } catch {
    res.status(409).json({ error: "Email already subscribed" });
  }
});

export default router;
