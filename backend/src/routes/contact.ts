import { Router } from "express";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { optionalAuth } from "../middleware/auth.js";
import { lookupGeo } from "../services/geoip.js";
import { emitToAdmins } from "../services/realtime.js";

const router = Router();
const now = () => new Date().toISOString();

router.post("/", optionalAuth, async (req, res) => {
  const { name, email, subject, category, message } = req.body;
  if (!name || !email || !subject || !category || !message) {
    res.status(400).json({ error: "All fields are required" });
    return;
  }

  const ts = now();
  const userId = req.user?.id ?? null;
  const guestIdentifier = userId ? null : uuid();

  let ipAddress: string | null = null;
  let country: string | null = null;
  let countryCode: string | null = null;
  try {
    const geo = await lookupGeo(req);
    ipAddress = geo.ip;
    country = geo.countryName;
    countryCode = geo.countryCode;
  } catch { /* ignore geo failures */ }

  const result = db.prepare(`
    INSERT INTO contact_tickets (
      name, email, subject, category, message, status, created_at,
      user_id, guest_identifier, ip_address, country, country_code,
      is_read, reply_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, 0, 'pending', ?)
  `).run(name, email, subject, category, message, ts, userId, guestIdentifier, ipAddress, country, countryCode, ts);

  emitToAdmins("admin:contact", { contactId: result.lastInsertRowid });
  emitToAdmins("admin:stats", {});

  res.status(201).json({ ok: true, message: "Message sent successfully", id: result.lastInsertRowid });
});

export default router;
