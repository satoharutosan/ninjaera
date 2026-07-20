import { Router } from "express";
import { v4 as uuid } from "uuid";
import { qRun } from "../db/query.js";
import { optionalAuth } from "../middleware/auth.js";
import { rateLimit, clientIp } from "../middleware/rateLimit.js";
import { lookupGeo } from "../services/geoip.js";
import { createAdminSystemNotification } from "../services/adminNotifications.js";
import { emitToAdmins, scheduleAdminStatsRefresh } from "../services/realtime.js";

const router = Router();
const now = () => new Date().toISOString();

router.post("/", optionalAuth, rateLimit({
  keyFn: (req) => `contact:ip:${clientIp(req)}`,
  max: 8,
  windowMs: 60 * 60 * 1000,
}), async (req, res) => {
  const { name, email, subject, category, message } = req.body;
  if (!name || !email || !subject || !category || !message) {
    res.status(400).json({ error: "All fields are required" });
    return;
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: "Please enter a valid email address" });
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

  const result = await qRun(`
    INSERT INTO contact_tickets (
      name, email, subject, category, message, status, created_at,
      user_id, guest_identifier, ip_address, country, country_code,
      is_read, reply_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, 0, 'pending', ?)
  `, name, email, subject, category, message, ts, userId, guestIdentifier, ipAddress, country, countryCode, ts);

  emitToAdmins("admin:contact", { contactId: result.lastInsertRowid });
  scheduleAdminStatsRefresh();
  await createAdminSystemNotification({
    title: "New Contact Message",
    body: `${name} — ${subject}`,
    source: "Contact",
    page: "contacts",
    notifType: "contact",
    metadata: { contactId: result.lastInsertRowid, email },
  });

  res.status(201).json({ ok: true, message: "Message sent successfully", id: result.lastInsertRowid });
});

export default router;
