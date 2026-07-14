import { Router } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../db/index.js";
import { requireAuth, publicUser, optionalAuth } from "../middleware/auth.js";
import { touchPresence, setUserStatus, emitPresenceUpdate } from "../services/presence.js";

const router = Router();
const now = () => new Date().toISOString();

const uploadDir = process.env.UPLOAD_DIR || "./uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

router.get("/me", requireAuth, (req, res) => {
  const user = req.user!;
  const settings = db.prepare("SELECT * FROM user_settings WHERE user_id = ?").get(user.id) as {
    email_notif: number; push_notif: number; two_fa: number; public_profile: number;
  };
  const stats = db.prepare("SELECT * FROM game_stats WHERE user_id = ?").get(user.id);

  res.json({
    user: publicUser(user, user.id),
    settings: {
      emailNotif: settings.email_notif === 1,
      pushNotif: settings.push_notif === 1,
      twoFA: settings.two_fa === 1,
      publicProfile: settings.public_profile === 1,
    },
    stats,
  });
});

router.patch("/me", requireAuth, (req, res) => {
  const { username, gender, dateOfBirth, country, city, status, bio, village, clan } = req.body;
  const fields: string[] = [];
  const values: unknown[] = [];

  if (username !== undefined) { fields.push("username = ?"); values.push(username); }
  if (gender !== undefined) { fields.push("gender = ?"); values.push(gender); }
  if (dateOfBirth !== undefined) { fields.push("date_of_birth = ?"); values.push(dateOfBirth); }
  if (country !== undefined) { fields.push("country = ?"); values.push(country); }
  if (city !== undefined) { fields.push("city = ?"); values.push(city); }
  if (bio !== undefined) { fields.push("bio = ?"); values.push(bio); }
  if (village !== undefined) { fields.push("village = ?"); values.push(village); }
  if (clan !== undefined) { fields.push("clan = ?"); values.push(clan); }

  const statusChanging = status !== undefined;

  if (fields.length === 0 && !statusChanging) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  if (fields.length > 0) {
    fields.push("updated_at = ?");
    values.push(now(), req.user!.id);
    db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  if (statusChanging) {
    setUserStatus(req.user!.id, String(status));
  } else if (fields.length > 0) {
    emitPresenceUpdate(req.user!.id);
  }

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user!.id);
  res.json({ user: publicUser(updated as never, req.user!.id) });
});

router.post("/me/avatar", requireAuth, upload.single("avatar"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const url = `/uploads/${req.file.filename}`;
  db.prepare("UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?").run(url, now(), req.user!.id);
  emitPresenceUpdate(req.user!.id);
  res.json({ avatarUrl: url });
});

router.patch("/me/password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password are required" });
    return;
  }
  if (!req.user!.password_hash || !bcrypt.compareSync(currentPassword, req.user!.password_hash)) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, now(), req.user!.id);
  res.json({ ok: true });
});

router.patch("/me/settings", requireAuth, (req, res) => {
  const { emailNotif, pushNotif, twoFA, publicProfile } = req.body;
  const updates: string[] = [];
  const values: unknown[] = [];

  if (emailNotif !== undefined) { updates.push("email_notif = ?"); values.push(emailNotif ? 1 : 0); }
  if (pushNotif !== undefined) { updates.push("push_notif = ?"); values.push(pushNotif ? 1 : 0); }
  if (twoFA !== undefined) { updates.push("two_fa = ?"); values.push(twoFA ? 1 : 0); }
  if (publicProfile !== undefined) { updates.push("public_profile = ?"); values.push(publicProfile ? 1 : 0); }

  if (updates.length === 0) {
    res.status(400).json({ error: "No settings to update" });
    return;
  }

  values.push(req.user!.id);
  db.prepare(`UPDATE user_settings SET ${updates.join(", ")} WHERE user_id = ?`).run(...values);
  res.json({ ok: true });
});

router.get("/me/stats", requireAuth, (req, res) => {
  const stats = db.prepare("SELECT * FROM game_stats WHERE user_id = ?").get(req.user!.id);
  const activities = db.prepare("SELECT description, created_at as createdAt FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 10").all(req.user!.id);
  res.json({ stats, activities });
});

router.get("/me/achievements", requireAuth, (req, res) => {
  const items = db.prepare("SELECT title, description, icon, earned_at as earnedAt FROM achievements WHERE user_id = ? ORDER BY earned_at DESC").all(req.user!.id);
  res.json({ achievements: items });
});

router.get("/me/inventory", requireAuth, (req, res) => {
  const items = db.prepare("SELECT name, rarity, quantity, icon FROM inventory_items WHERE user_id = ?").all(req.user!.id);
  res.json({ inventory: items });
});

router.get("/:id", optionalAuth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(req.params.id)) as never;
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user: publicUser(user, req.user?.id) });
});

router.post("/:id/block", requireAuth, (req, res) => {
  const blockedId = Number(req.params.id);
  if (blockedId === req.user!.id) {
    res.status(400).json({ error: "Cannot block yourself" });
    return;
  }
  db.prepare("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(req.user!.id, blockedId, now());
  res.json({ ok: true });
});

router.delete("/:id/block", requireAuth, (req, res) => {
  db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").run(req.user!.id, Number(req.params.id));
  res.json({ ok: true });
});

router.post("/me/presence", requireAuth, (req, res) => {
  touchPresence(req.user!.id);
  emitPresenceUpdate(req.user!.id);
  res.json({ ok: true });
});

export default router;
