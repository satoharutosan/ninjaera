import crypto from "crypto";
import bcrypt from "bcryptjs";
import type { Request } from "express";
import { qGet, qRun, qTransaction } from "../db/query.js";
import { bumpTokenVersion } from "../middleware/auth.js";
import { normalizeEmail } from "./emailVerification.js";
import {
  generateVerificationToken,
  hashSecret,
  mailConfigured,
  sendPasswordResetEmail,
  sendOAuthAccountReminderEmail,
  PASSWORD_RESET_TTL_MS,
  PASSWORD_RESET_RESEND_COOLDOWN_MS,
} from "./mail.js";
import { logActivitySync } from "./activityLog.js";

const GENERIC_OK =
  "If that email is registered with a password, you will receive a reset link shortly.";

/** In-memory rate limits (per process). Keys: ip / email. */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function allowRate(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cur = rateBuckets.get(key);
  if (!cur || cur.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (cur.count >= max) return false;
  cur.count += 1;
  return true;
}

function clientIp(req?: Request): string {
  if (!req) return "unknown";
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0]!.trim();
  return req.ip || "unknown";
}

export function validateNewPassword(password: string): string | null {
  if (typeof password !== "string") return "Password is required";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password.length > 128) return "Password is too long";
  if (!/[A-Za-z]/.test(password)) return "Password must include at least one letter";
  if (!/[0-9]/.test(password)) return "Password must include at least one number";
  return null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function requestPasswordReset(emailRaw: string, req?: Request): Promise<{ ok: true; message: string }> {
  const email = normalizeEmail(emailRaw);
  if (!email || !isValidEmail(email)) {
    const err = Object.assign(new Error("Enter a valid email address"), { status: 400 });
    throw err;
  }

  const ip = clientIp(req);
  if (!allowRate(`forgot:ip:${ip}`, 8, 60 * 60 * 1000)) {
    const err = Object.assign(new Error("Too many reset requests. Please try again later."), {
      status: 429,
      code: "RATE_LIMITED",
    });
    throw err;
  }
  if (!allowRate(`forgot:email:${email}`, 4, 60 * 60 * 1000)) {
    // Same generic message — do not reveal rate state for a specific inbox
    return { ok: true, message: GENERIC_OK };
  }

  const user = await qGet<{ id: number; email: string; username: string; password_hash: string | null }>(
    `SELECT id, email, username, password_hash FROM users
     WHERE email = ? AND is_npc = 0 AND is_deleted = 0`,
    email,
  );

  if (!user) {
    // Constant-ish delay to reduce timing oracle
    await sleep(40 + crypto.randomInt(40));
    return { ok: true, message: GENERIC_OK };
  }

  if (!user.password_hash) {
    // OAuth-only account — remind them without issuing a reset token
    if (mailConfigured()) {
      try {
        await sendOAuthAccountReminderEmail({ to: user.email, username: user.username });
      } catch (e) {
        console.error("[password-reset] OAuth reminder email failed", e);
      }
    }
    logActivitySync({
      req,
      userId: user.id,
      username: user.email,
      eventType: "password_reset_oauth_only",
      eventCategory: "authentication",
      description: "Password reset requested for OAuth-only account",
      result: "success",
    });
    return { ok: true, message: GENERIC_OK };
  }

  // Resend cooldown (reuse last token window by replacing)
  const last = await qGet<{ created_at: string }>(
    "SELECT created_at FROM password_reset_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    user.id,
  );
  if (last?.created_at) {
    const elapsed = Date.now() - new Date(last.created_at).getTime();
    if (elapsed < PASSWORD_RESET_RESEND_COOLDOWN_MS && Number.isFinite(elapsed)) {
      return { ok: true, message: GENERIC_OK };
    }
  }

  const rawToken = generateVerificationToken();
  const tokenHash = hashSecret(rawToken);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();

  await qRun("DELETE FROM password_reset_tokens WHERE user_id = ?", user.id);
  await qRun(
    `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at, used_at)
     VALUES (?, ?, ?, ?, NULL)`,
    tokenHash, user.id, expiresAt, createdAt,
  );

  try {
    await sendPasswordResetEmail({
      to: user.email,
      username: user.username,
      token: rawToken,
    });
  } catch (e) {
    await qRun("DELETE FROM password_reset_tokens WHERE token_hash = ?", tokenHash);
    throw e;
  }

  logActivitySync({
    req,
    userId: user.id,
    username: user.email,
    eventType: "password_reset_requested",
    eventCategory: "authentication",
    description: "Password reset email sent",
    result: "success",
  });

  return { ok: true, message: GENERIC_OK };
}

export async function resetPasswordWithToken(
  rawToken: string,
  password: string,
  req?: Request,
): Promise<{ ok: true }> {
  const ip = clientIp(req);
  if (!allowRate(`reset:ip:${ip}`, 20, 60 * 60 * 1000)) {
    throw Object.assign(new Error("Too many attempts. Please try again later."), {
      status: 429,
      code: "RATE_LIMITED",
    });
  }

  const token = String(rawToken || "").trim();
  if (!token || token.length < 32) {
    throw Object.assign(new Error("Invalid or expired reset link"), {
      status: 400,
      code: "INVALID_TOKEN",
    });
  }

  const pwErr = validateNewPassword(password);
  if (pwErr) {
    throw Object.assign(new Error(pwErr), { status: 400, code: "WEAK_PASSWORD" });
  }

  const tokenHash = hashSecret(token);
  const row = await qGet<{ token_hash: string; user_id: number; expires_at: string; used_at: string | null }>(
    "SELECT token_hash, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?",
    tokenHash,
  );

  if (!row) {
    throw Object.assign(new Error("Invalid or expired reset link"), {
      status: 400,
      code: "INVALID_TOKEN",
    });
  }
  if (row.used_at) {
    throw Object.assign(new Error("This reset link has already been used"), {
      status: 400,
      code: "TOKEN_USED",
    });
  }
  if (new Date(row.expires_at) < new Date()) {
    await qRun("DELETE FROM password_reset_tokens WHERE token_hash = ?", tokenHash);
    throw Object.assign(new Error("This reset link has expired. Request a new one."), {
      status: 400,
      code: "TOKEN_EXPIRED",
    });
  }

  const user = await qGet<{ id: number; email: string; is_disabled: number; is_deleted: number }>(
    "SELECT id, email, is_disabled, is_deleted FROM users WHERE id = ?",
    row.user_id,
  );

  if (!user || user.is_deleted) {
    await qRun("DELETE FROM password_reset_tokens WHERE token_hash = ?", tokenHash);
    throw Object.assign(new Error("Invalid or expired reset link"), {
      status: 400,
      code: "INVALID_TOKEN",
    });
  }
  if (user.is_disabled) {
    throw Object.assign(new Error("This account is disabled. Contact support."), {
      status: 403,
      code: "ACCOUNT_DISABLED",
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  const ts = new Date().toISOString();

  await qTransaction(async () => {
    // Mark used first to block concurrent replay
    const marked = await qRun(
      `UPDATE password_reset_tokens SET used_at = ?
       WHERE token_hash = ? AND used_at IS NULL`,
      ts, tokenHash,
    );
    if (marked.changes !== 1) {
      throw Object.assign(new Error("This reset link has already been used"), {
        status: 400,
        code: "TOKEN_USED",
      });
    }
    await qRun(
      "UPDATE users SET password_hash = ?, updated_at = ?, email_verified = 1 WHERE id = ?",
      hash,
      ts,
      user.id,
    );
    await bumpTokenVersion(user.id);
    await qRun("DELETE FROM password_reset_tokens WHERE user_id = ?", user.id);
  });

  logActivitySync({
    req,
    userId: user.id,
    username: user.email,
    eventType: "password_reset_completed",
    eventCategory: "authentication",
    description: "Password reset completed; sessions invalidated",
    result: "success",
  });

  return { ok: true };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
