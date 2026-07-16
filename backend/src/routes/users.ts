import { Router } from "express";
import bcrypt from "bcryptjs";
import { qGet, qAll, qRun } from "../db/query.js";
import { requireAuth, publicUser, optionalAuth, bumpTokenVersion, signToken } from "../middleware/auth.js";
import { touchPresence, setUserStatus, emitPresenceUpdate } from "../services/presence.js";
import {
  isUsernameConstraintError,
  validateUsernameForWrite,
  USERNAME_TAKEN_ERROR,
} from "../services/username.js";
import { validateNewPassword } from "../services/passwordReset.js";
import { logActivitySync } from "../services/activityLog.js";
import { deleteStoredUrl } from "../storage/index.js";
import { createMemoryUploader, persistMulterFile } from "../storage/multerUpload.js";
import { validateUpload } from "../services/uploadValidation.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();
const now = () => new Date().toISOString();

const upload = createMemoryUploader({ limits: { fileSize: 5 * 1024 * 1024 } });

router.get("/me", requireAuth, async (req, res) => {
  const user = req.user!;
  const settings = await qGet<{
    email_notif: number; push_notif: number; two_fa: number; public_profile: number;
  }>("SELECT * FROM user_settings WHERE user_id = ?", user.id);
  const stats = await qGet("SELECT * FROM game_stats WHERE user_id = ?", user.id);

  res.json({
    user: await publicUser(user, user.id),
    settings: {
      emailNotif: settings!.email_notif === 1,
      pushNotif: settings!.push_notif === 1,
      twoFA: settings!.two_fa === 1,
      publicProfile: settings!.public_profile === 1,
    },
    stats,
  });
});

router.patch("/me", requireAuth, async (req, res) => {
  const { username, gender, dateOfBirth, country, city, status, bio, village, clan } = req.body;
  const fields: string[] = [];
  const values: unknown[] = [];

  if (username !== undefined) {
    const check = await validateUsernameForWrite(username, req.user!.id);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    fields.push("username = ?");
    values.push(check.username);
  }
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
    try {
      await qRun(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, ...values);
    } catch (err) {
      if (isUsernameConstraintError(err)) {
        res.status(409).json({ error: USERNAME_TAKEN_ERROR });
        return;
      }
      throw err;
    }
  }

  if (statusChanging) {
    await setUserStatus(req.user!.id, String(status));
  } else if (fields.length > 0) {
    emitPresenceUpdate(req.user!.id);
  }

  const updated = await qGet("SELECT * FROM users WHERE id = ?", req.user!.id);
  res.json({ user: await publicUser(updated as never, req.user!.id) });
});

router.post("/me/avatar", requireAuth, rateLimit({
  keyFn: (req) => `avatar:${req.user!.id}`,
  max: 10,
  windowMs: 60 * 60 * 1000,
}), upload.single("avatar"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const validated = validateUpload({
    kind: "avatar",
    originalName: req.file.originalname,
    declaredMime: req.file.mimetype,
    buffer: req.file.buffer,
    size: req.file.size,
  });
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const previous = await qGet<{ avatar_url: string | null }>(
    "SELECT avatar_url FROM users WHERE id = ?",
    req.user!.id,
  );
  const stored = await persistMulterFile(req.file, "avatar", { contentType: validated.contentType });
  await qRun("UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?", stored.url, now(), req.user!.id);
  if (previous?.avatar_url && previous.avatar_url !== stored.url) {
    await deleteStoredUrl(previous.avatar_url);
  }
  emitPresenceUpdate(req.user!.id);
  res.json({ avatarUrl: stored.url });
});

/** Brute-force guard for current-password verification (per user, in-process). */
const pwAttempts = new Map<number, { count: number; resetAt: number }>();
const PW_ATTEMPT_MAX = 5;
const PW_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function pwAttemptAllowed(userId: number): boolean {
  const cur = pwAttempts.get(userId);
  if (!cur || cur.resetAt <= Date.now()) return true;
  return cur.count < PW_ATTEMPT_MAX;
}

function pwAttemptFailed(userId: number) {
  const cur = pwAttempts.get(userId);
  if (!cur || cur.resetAt <= Date.now()) {
    pwAttempts.set(userId, { count: 1, resetAt: Date.now() + PW_ATTEMPT_WINDOW_MS });
    return;
  }
  cur.count += 1;
}

/**
 * Change or create the local password.
 * - Account WITH a password: requires and verifies currentPassword.
 * - Account WITHOUT a password (OAuth-only): creates one; currentPassword not required.
 * Backend enforces this from actual account state (password_hash), never the client.
 */
router.patch("/me/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  const user = req.user!;
  const hasPassword = Boolean(user.password_hash);

  if (typeof newPassword !== "string" || !newPassword) {
    res.status(400).json({ error: "New password is required" });
    return;
  }
  const policyError = validateNewPassword(newPassword);
  if (policyError) {
    res.status(400).json({ error: policyError, code: "WEAK_PASSWORD" });
    return;
  }

  if (hasPassword) {
    if (typeof currentPassword !== "string" || !currentPassword) {
      res.status(400).json({ error: "Current password is required" });
      return;
    }
    if (!pwAttemptAllowed(user.id)) {
      res.status(429).json({
        error: "Too many incorrect attempts. Try again in a few minutes.",
        code: "RATE_LIMITED",
      });
      return;
    }
    if (!bcrypt.compareSync(currentPassword, user.password_hash!)) {
      pwAttemptFailed(user.id);
      logActivitySync({
        req,
        userId: user.id,
        username: user.email,
        eventType: "password_change_denied",
        eventCategory: "authentication",
        description: "Password change denied: incorrect current password",
        result: "failure",
      });
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    if (bcrypt.compareSync(newPassword, user.password_hash!)) {
      res.status(400).json({ error: "New password must be different from the current password" });
      return;
    }
    pwAttempts.delete(user.id);
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await qRun("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", hash, now(), user.id);
  const tv = await bumpTokenVersion(user.id);
  // Re-issue a session for this client; other devices stay logged out
  const token = signToken({
    userId: user.id,
    email: user.email,
    tv,
  });
  logActivitySync({
    req,
    userId: user.id,
    username: user.email,
    eventType: hasPassword ? "password_changed" : "password_created",
    eventCategory: "authentication",
    description: hasPassword
      ? "Password changed; other sessions invalidated"
      : "Local password created for OAuth account; email/password sign-in enabled",
    result: "success",
  });
  res.json({ ok: true, token, hasPassword: true, created: !hasPassword });
});

router.patch("/me/settings", requireAuth, async (req, res) => {
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
  await qRun(`UPDATE user_settings SET ${updates.join(", ")} WHERE user_id = ?`, ...values);
  res.json({ ok: true });
});

router.get("/me/stats", requireAuth, async (req, res) => {
  const stats = await qGet("SELECT * FROM game_stats WHERE user_id = ?", req.user!.id);
  const activities = await qAll(
    "SELECT description, created_at as createdAt FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 10",
    req.user!.id,
  );
  res.json({ stats, activities });
});

router.get("/me/achievements", requireAuth, async (req, res) => {
  const items = await qAll(
    "SELECT title, description, icon, earned_at as earnedAt FROM achievements WHERE user_id = ? ORDER BY earned_at DESC",
    req.user!.id,
  );
  res.json({ achievements: items });
});

router.get("/me/inventory", requireAuth, async (req, res) => {
  const items = await qAll(
    "SELECT name, rarity, quantity, icon FROM inventory_items WHERE user_id = ?",
    req.user!.id,
  );
  res.json({ inventory: items });
});

router.get("/:id", optionalAuth, async (req, res) => {
  const user = await qGet("SELECT * FROM users WHERE id = ?", Number(req.params.id)) as never;
  if (!user) {
    // Missing row — still return a tombstone so clients never crash on profile open
    res.json({
      user: {
        id: Number(req.params.id),
        username: "Deleted User",
        avatarUrl: null,
        status: "Offline",
        bio: "",
        level: 1,
        isNpc: false,
        isAdmin: false,
        isTeamMember: false,
        isDeleted: true,
      },
    });
    return;
  }
  res.json({ user: await publicUser(user, req.user?.id) });
});

router.post("/:id/block", requireAuth, async (req, res) => {
  const blockedId = Number(req.params.id);
  if (blockedId === req.user!.id) {
    res.status(400).json({ error: "Cannot block yourself" });
    return;
  }
  await qRun(
    "INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)",
    req.user!.id, blockedId, now(),
  );
  res.json({ ok: true });
});

router.delete("/:id/block", requireAuth, async (req, res) => {
  await qRun("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?", req.user!.id, Number(req.params.id));
  res.json({ ok: true });
});

router.post("/me/presence", requireAuth, (req, res) => {
  touchPresence(req.user!.id);
  emitPresenceUpdate(req.user!.id);
  res.json({ ok: true });
});

export default router;
