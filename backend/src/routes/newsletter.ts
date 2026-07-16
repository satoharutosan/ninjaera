import { Router } from "express";
import { qRun } from "../db/query.js";
import { rateLimit, clientIp } from "../middleware/rateLimit.js";

const router = Router();
const now = () => new Date().toISOString();

router.post("/subscribe", rateLimit({
  keyFn: (req) => `newsletter:ip:${clientIp(req)}`,
  max: 10,
  windowMs: 60 * 60 * 1000,
}), async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  try {
    await qRun("INSERT INTO newsletter_subscribers (email, subscribed_at) VALUES (?, ?)", email, now());
    res.status(201).json({ ok: true, message: "Subscribed successfully" });
  } catch {
    res.status(409).json({ error: "Email already subscribed" });
  }
});

export default router;
