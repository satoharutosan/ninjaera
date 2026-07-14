import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { requireAuth, signToken, publicUser } from "../middleware/auth.js";
import { lookupGeo, saveUserLocation } from "../services/geoip.js";
import { logActivitySync } from "../services/activityLog.js";
import { setUserOnline, setUserOffline } from "../services/presence.js";
import { syncPublicChannels } from "../services/channels.js";

const router = Router();
const now = () => new Date().toISOString();

async function trackLogin(req: Parameters<typeof lookupGeo>[0], userId: number) {
  try {
    const geo = await lookupGeo(req);
    saveUserLocation(userId, geo);
  } catch { /* ignore geo failures */ }
}

router.post("/register", async (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) {
    res.status(400).json({ error: "Email, username, and password are required" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const ts = now();

  const result = db.prepare(`
    INSERT INTO users (email, username, password_hash, member_since, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(email, username, hash, ts.slice(0, 10), ts, ts);

  const userId = result.lastInsertRowid as number;
  db.prepare("INSERT INTO user_settings (user_id) VALUES (?)").run(userId);

  const registrationOrder = (db.prepare(`
    SELECT COUNT(*) as c FROM users WHERE is_npc = 0 AND id <= ?
  `).get(userId) as { c: number }).c;
  const globalRank = 1200 + registrationOrder;

  db.prepare(`
    INSERT INTO game_stats (
      user_id, missions_complete, pvp_wins, playtime_hours, legendary_items,
      ninjutsu, taijutsu, genjutsu, senjutsu, kenjutsu, global_rank
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)
  `).run(userId, globalRank);

  await trackLogin(req, userId);
  setUserOnline(userId);
  syncPublicChannels(userId);

  logActivitySync({ req, userId, username, eventType: "register", eventCategory: "authentication", description: `User registered: ${username}`, affectedObject: `user:${userId}` });

  const token = signToken({ userId, email });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  res.status(201).json({ token, user: publicUser(user as never, userId) });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ? AND is_npc = 0").get(email) as {
    id: number; email: string; password_hash: string; is_disabled?: number; is_deleted?: number;
  } | undefined;

  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    logActivitySync({ req, userId: user?.id ?? null, username: email, eventType: "login_failed", eventCategory: "authentication", description: `Failed login attempt for ${email}`, result: "failure" });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  if (user.is_disabled === 1 || user.is_deleted === 1) {
    logActivitySync({ req, userId: user.id, username: user.email, eventType: "login_denied", eventCategory: "security", description: "Login denied: account disabled", result: "failure" });
    res.status(403).json({ error: "Account is disabled" });
    return;
  }

  await trackLogin(req, user.id);
  const ts = now();
  db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, user.id);
  setUserOnline(user.id);
  syncPublicChannels(user.id);
  logActivitySync({ req, userId: user.id, username: user.email, eventType: "login", eventCategory: "authentication", description: "User logged in", affectedObject: `user:${user.id}` });

  const token = signToken({ userId: user.id, email: user.email });
  const full = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  res.json({ token, user: publicUser(full as never, user.id) });
});

router.post("/logout", requireAuth, (req, res) => {
  setUserOffline(req.user!.id);
  logActivitySync({ req, userId: req.user!.id, eventType: "logout", eventCategory: "authentication", description: "User logged out" });
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!, req.user!.id) });
});

router.post("/forgot-password", (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const user = db.prepare("SELECT id FROM users WHERE email = ? AND is_npc = 0").get(email) as { id: number } | undefined;
  if (user) {
    const token = uuid();
    const expires = new Date(Date.now() + 3600000).toISOString();
    db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(user.id);
    db.prepare("INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, user.id, expires);
    console.log(`[password-reset] token for ${email}: ${token}`);
  }

  res.json({ ok: true, message: "If that email exists, a reset link has been sent." });
});

router.post("/reset-password", (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    res.status(400).json({ error: "Token and password are required" });
    return;
  }

  const row = db.prepare("SELECT * FROM password_reset_tokens WHERE token = ?").get(token) as {
    user_id: number; expires_at: string;
  } | undefined;

  if (!row || new Date(row.expires_at) < new Date()) {
    res.status(400).json({ error: "Invalid or expired token" });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, now(), row.user_id);
  db.prepare("DELETE FROM password_reset_tokens WHERE token = ?").run(token);
  res.json({ ok: true });
});

export default router;
