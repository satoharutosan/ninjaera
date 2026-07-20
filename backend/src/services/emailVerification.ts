import crypto from "crypto";
import bcrypt from "bcryptjs";
import { qGet, qRun, qTransaction } from "../db/query.js";
import {
  EMAIL_RESEND_COOLDOWN_MS,
  EMAIL_VERIFY_TTL_MS,
  generateVerificationCode,
  generateVerificationToken,
  hashSecret,
  mailConfigured,
  sendVerificationEmail,
} from "./mail.js";
import { validateUsernameForWrite, isUsernameTaken } from "./username.js";
import { validateNewPassword } from "./passwordReset.js";
import { setUserOnline } from "./presence.js";
import { syncPublicChannels } from "./channels.js";
import { logActivitySync } from "./activityLog.js";
import { assertTrustedRegistrationEmail } from "../config/trustedEmailProviders.js";
import { lookupGeo, saveUserLocation, resolveProfileCountryName } from "./geoip.js";
import type { Request } from "express";

export type PendingRegistration = {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  code_hash: string;
  token_hash: string;
  expires_at: string;
  last_sent_at: string;
  attempt_count: number;
  created_at: string;
  email_status?: "queued" | "sending" | "sent" | "failed";
  email_error?: string | null;
  email_queued_at?: string | null;
  last_email_attempt_at?: string | null;
  email_sent_at?: string | null;
};

type AppError = Error & {
  status?: number;
  code?: string;
  retryAfter?: number;
};

function authError(message: string, status: number, code: string, extra: Record<string, unknown> = {}): AppError {
  return Object.assign(new Error(message), { status, code, ...extra });
}

function safeEqualDigest(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const EMAIL_RESEND_MAX_PER_HOUR = Number(process.env.EMAIL_RESEND_MAX_PER_HOUR) || 8;

/**
 * Feature flag — set EMAIL_VERIFICATION_REQUIRED=true to restore the pending-email
 * verification workflow. Default is off so signup creates accounts immediately.
 */
export function isEmailVerificationRequired(): boolean {
  const v = (process.env.EMAIL_VERIFICATION_REQUIRED || "false").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const row = rateBuckets.get(key);
  if (!row || row.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (row.count >= limit) return false;
  row.count += 1;
  return true;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmailFormatValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function purgeExpiredPendingRegistrations() {
  const expired = await qRun("DELETE FROM pending_registrations WHERE expires_at < ?", new Date().toISOString());
  if (expired.changes > 0) {
    console.info(`[verification] expired pending registrations purged count=${expired.changes}`);
  }
}

export async function findPendingByEmail(email: string): Promise<PendingRegistration | undefined> {
  return qGet<PendingRegistration>("SELECT * FROM pending_registrations WHERE email = ?", normalizeEmail(email));
}

export async function isUsernamePending(username: string, excludeEmail?: string): Promise<boolean> {
  const lower = username.trim().toLowerCase();
  if (excludeEmail) {
    return !!(await qGet(
      "SELECT 1 FROM pending_registrations WHERE LOWER(username) = ? AND email != ? AND expires_at >= ?",
      lower, normalizeEmail(excludeEmail), new Date().toISOString(),
    ));
  }
  return !!(await qGet(
    "SELECT 1 FROM pending_registrations WHERE LOWER(username) = ? AND expires_at >= ?",
    lower, new Date().toISOString(),
  ));
}

function issueSecrets() {
  const code = generateVerificationCode();
  const token = generateVerificationToken();
  const now = new Date().toISOString();
  return {
    code,
    token,
    codeHash: hashSecret(code),
    tokenHash: hashSecret(token),
    expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS).toISOString(),
    issuedAt: now,
  };
}

function sanitizeDeliveryError(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 220);
  return String(err).slice(0, 220);
}

function queueVerificationEmail(opts: {
  email: string;
  username: string;
  code: string;
  token: string;
  tokenHash: string;
  reason: "registration" | "resend";
}): "queued" | "failed" {
  if (!mailConfigured()) {
    const message = "Email delivery is not configured";
    void qRun(`
      UPDATE pending_registrations
      SET email_status = 'failed',
          email_error = ?,
          last_email_attempt_at = ?
      WHERE email = ? AND token_hash = ?
    `, message, new Date().toISOString(), opts.email, opts.tokenHash).catch((err) => {
      console.error("[verification] failed to persist unconfigured email status", {
        email: opts.email,
        error: sanitizeDeliveryError(err),
      });
    });
    console.error("[verification] email delivery unavailable", {
      email: opts.email,
      reason: opts.reason,
      code: "EMAIL_SERVICE_UNAVAILABLE",
    });
    return "failed";
  }

  const queuedAt = new Date().toISOString();
  void qRun(`
    UPDATE pending_registrations
    SET email_status = 'queued',
        email_error = NULL,
        email_queued_at = ?,
        last_email_attempt_at = NULL,
        email_sent_at = NULL
    WHERE email = ?
  `, queuedAt, opts.email).catch((err) => {
    console.error("[verification] failed to mark email queued", { email: opts.email, error: sanitizeDeliveryError(err) });
  });

  console.info(`[verification] email queued email=${opts.email} reason=${opts.reason}`);

  setTimeout(() => {
    void (async () => {
      const attemptAt = new Date().toISOString();
      try {
        const current = await qGet<{ token_hash: string }>(
          "SELECT token_hash FROM pending_registrations WHERE email = ?",
          opts.email,
        );
        if (!current || current.token_hash !== opts.tokenHash) {
          console.info(`[verification] skipped superseded email task email=${opts.email} reason=${opts.reason}`);
          return;
        }
        await qRun(`
          UPDATE pending_registrations
          SET email_status = 'sending',
              last_email_attempt_at = ?,
              email_error = NULL
          WHERE email = ?
        `, attemptAt, opts.email);
        console.info(`[verification] email send started email=${opts.email} reason=${opts.reason}`);

        await sendVerificationEmail({
          to: opts.email,
          username: opts.username,
          code: opts.code,
          token: opts.token,
        });

        await qRun(`
          UPDATE pending_registrations
          SET email_status = 'sent',
              email_error = NULL,
              email_sent_at = ?
          WHERE email = ? AND token_hash = ?
        `, new Date().toISOString(), opts.email, opts.tokenHash);
        console.info(`[verification] email sent email=${opts.email} reason=${opts.reason}`);
      } catch (err) {
        const message = sanitizeDeliveryError(err);
        await qRun(`
          UPDATE pending_registrations
          SET email_status = 'failed',
              email_error = ?
          WHERE email = ? AND token_hash = ?
        `, message, opts.email, opts.tokenHash).catch((updateErr) => {
          console.error("[verification] failed to persist email delivery failure", {
            email: opts.email,
            error: sanitizeDeliveryError(updateErr),
          });
        });
        console.error("[verification] email delivery failed", {
          email: opts.email,
          reason: opts.reason,
          error: message,
        });
      }
    })();
  }, 0).unref?.();
  return "queued";
}

export async function verificationStatus(emailRaw: string): Promise<{
  pending: boolean;
  email: string;
  status: "queued" | "sending" | "sent" | "failed" | "none";
  cooldownSeconds: number;
  expiresAt: string | null;
  canResend: boolean;
}> {
  await purgeExpiredPendingRegistrations();
  const email = normalizeEmail(emailRaw);
  const pending = await findPendingByEmail(email);
  if (!pending) {
    return { pending: false, email, status: "none", cooldownSeconds: 0, expiresAt: null, canResend: false };
  }
  const lastSent = new Date(pending.last_sent_at).getTime();
  const waitMs = Math.max(0, EMAIL_RESEND_COOLDOWN_MS - (Date.now() - lastSent));
  const cooldownSeconds = Math.ceil(waitMs / 1000);
  return {
    pending: true,
    email,
    status: pending.email_status || "queued",
    cooldownSeconds,
    expiresAt: pending.expires_at,
    canResend: cooldownSeconds <= 0,
  };
}

export type RegistrationStartResult =
  | {
      pending: true;
      email: string;
      cooldownSeconds: number;
      emailStatus: "queued" | "failed";
    }
  | {
      pending: false;
      email: string;
      userId: number;
    };

export async function startEmailRegistration(input: {
  email: string;
  username: string;
  password: string;
  req?: Request;
}): Promise<RegistrationStartResult> {
  console.info("[verification] registration request received");
  await purgeExpiredPendingRegistrations();

  const email = normalizeEmail(input.email);
  if (!isEmailFormatValid(email)) {
    throw authError("Please enter a valid email address", 400, "INVALID_EMAIL");
  }

  const trust = assertTrustedRegistrationEmail(email);
  if (!trust.ok) {
    throw authError(trust.error, 400, trust.code);
  }

  const usernameCheck = await validateUsernameForWrite(input.username);
  if (!usernameCheck.ok) {
    throw authError(usernameCheck.error, usernameCheck.status, "INVALID_USERNAME");
  }
  const username = usernameCheck.username;

  const pwErr = validateNewPassword(input.password);
  if (pwErr) {
    throw authError(pwErr, 400, "INVALID_PASSWORD");
  }

  const existingUser = await qGet("SELECT id FROM users WHERE email = ? AND is_npc = 0", email);
  if (existingUser) {
    throw authError("An account with this email already exists", 409, "EMAIL_ALREADY_EXISTS");
  }

  if ((await isUsernameTaken(username)) || (await isUsernamePending(username, email))) {
    throw authError(
      "This username is already in use. Please choose a different username.",
      409,
      "USERNAME_ALREADY_EXISTS",
    );
  }

  if (!checkRateLimit(`register:${email}`, 5, 15 * 60_000)) {
    throw authError("Too many registration attempts. Please try again later.", 429, "RATE_LIMITED");
  }

  const passwordHash = bcrypt.hashSync(input.password, 10);

  // Instant account creation when verification is disabled (default).
  if (!isEmailVerificationRequired()) {
    const userId = await createUserDirectly({
      email,
      username,
      passwordHash,
      req: input.req,
    });
    return { pending: false, email, userId };
  }

  const secrets = issueSecrets();
  console.info(`[verification] verification secret material generated email=${email}`);

  await qTransaction(async () => {
    await qRun("DELETE FROM pending_registrations WHERE email = ?", email);
    await qRun(`
      INSERT INTO pending_registrations (
        email, username, password_hash, code_hash, token_hash, expires_at, last_sent_at, attempt_count, created_at,
        email_status, email_error, email_queued_at, last_email_attempt_at, email_sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'queued', NULL, ?, NULL, NULL)
    `,
      email,
      username,
      passwordHash,
      secrets.codeHash,
      secrets.tokenHash,
      secrets.expiresAt,
      secrets.issuedAt,
      secrets.issuedAt,
      secrets.issuedAt,
    );
  });

  console.info(`[verification] pending account created email=${email} username=${username}`);
  const emailStatus = queueVerificationEmail({
    email,
    username,
    code: secrets.code,
    token: secrets.token,
    tokenHash: secrets.tokenHash,
    reason: "registration",
  });

  if (input.req) {
    logActivitySync({
      req: input.req,
      userId: null,
      username,
      eventType: "register_pending",
      eventCategory: "authentication",
      description: `Pending email verification created for ${email}`,
      metadata: { email },
    });
  }

  return {
    pending: true,
    email,
    cooldownSeconds: Math.ceil(EMAIL_RESEND_COOLDOWN_MS / 1000),
    emailStatus,
  };
}

/** Create a verified user immediately (used when EMAIL_VERIFICATION_REQUIRED=false). */
async function createUserDirectly(opts: {
  email: string;
  username: string;
  passwordHash: string;
  req?: Request;
}): Promise<number> {
  const ts = new Date().toISOString();
  const geo = opts.req ? await lookupGeo(opts.req) : null;
  const country = geo ? resolveProfileCountryName(geo) : "Unknown";

  const userId = await qTransaction(async () => {
    // Clear any leftover pending row for this email
    await qRun("DELETE FROM pending_registrations WHERE email = ?", opts.email);

    const result = await qRun(`
      INSERT INTO users (
        email, username, password_hash, country, member_since, created_at, updated_at, email_verified, email_verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `, opts.email, opts.username, opts.passwordHash, country, ts.slice(0, 10), ts, ts, ts);

    const id = Number(result.lastInsertRowid);
    await qRun("INSERT INTO user_settings (user_id) VALUES (?)", id);

    const registrationOrder = (await qGet<{ c: number }>(`
      SELECT COUNT(*) as c FROM users WHERE is_npc = 0 AND id <= ?
    `, id))!.c;
    const globalRank = 1200 + registrationOrder;

    await qRun(`
      INSERT INTO game_stats (
        user_id, missions_complete, pvp_wins, playtime_hours, legendary_items,
        ninjutsu, taijutsu, genjutsu, senjutsu, kenjutsu, global_rank
      ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)
    `, id, globalRank);

    return id;
  });

  setUserOnline(userId);
  syncPublicChannels(userId);

  if (geo) {
    await saveUserLocation(userId, geo);
  }

  if (opts.req) {
    logActivitySync({
      req: opts.req,
      userId,
      username: opts.username,
      eventType: "register",
      eventCategory: "authentication",
      description: `User registered: ${opts.username}`,
      affectedObject: `user:${userId}`,
      geo: geo ?? undefined,
    });
  }

  return userId;
}

export async function resendVerificationEmail(emailRaw: string, req?: Request): Promise<{
  cooldownSeconds: number;
  emailStatus: "queued" | "failed";
}> {
  await purgeExpiredPendingRegistrations();
  const email = normalizeEmail(emailRaw);
  const pending = await findPendingByEmail(email);
  if (!pending) {
    // Do not reveal whether email exists
    return { cooldownSeconds: Math.ceil(EMAIL_RESEND_COOLDOWN_MS / 1000), emailStatus: "queued" };
  }

  if (!checkRateLimit(`resend:${email}`, EMAIL_RESEND_MAX_PER_HOUR, 60 * 60_000)) {
    throw authError("Too many resend requests. Please try again later.", 429, "RATE_LIMITED");
  }

  const lastSent = new Date(pending.last_sent_at).getTime();
  const wait = EMAIL_RESEND_COOLDOWN_MS - (Date.now() - lastSent);
  if (wait > 0) {
    throw authError(
      `Please wait ${Math.ceil(wait / 1000)} seconds before requesting another email.`,
      429,
      "VERIFICATION_COOLDOWN",
      { retryAfter: Math.ceil(wait / 1000) },
    );
  }

  console.info(`[verification] resend requested email=${email}`);

  const secrets = issueSecrets();
  await qRun(`
    UPDATE pending_registrations
    SET code_hash = ?,
        token_hash = ?,
        expires_at = ?,
        last_sent_at = ?,
        attempt_count = 0,
        email_status = 'queued',
        email_error = NULL,
        email_queued_at = ?,
        last_email_attempt_at = NULL,
        email_sent_at = NULL
    WHERE email = ?
  `, secrets.codeHash, secrets.tokenHash, secrets.expiresAt, secrets.issuedAt, secrets.issuedAt, email);

  console.info(`[verification] new verification secret material generated email=${email}`);
  const emailStatus = queueVerificationEmail({
    email,
    username: pending.username,
    code: secrets.code,
    token: secrets.token,
    tokenHash: secrets.tokenHash,
    reason: "resend",
  });

  if (req) {
    logActivitySync({
      req,
      userId: null,
      username: pending.username,
      eventType: "register_resend",
      eventCategory: "authentication",
      description: `Verification email resent to ${email}`,
      metadata: { email },
    });
  }

  return { cooldownSeconds: Math.ceil(EMAIL_RESEND_COOLDOWN_MS / 1000), emailStatus };
}

async function createUserFromPending(pending: PendingRegistration, req?: Request): Promise<number> {
  const ts = new Date().toISOString();
  const geo = req ? await lookupGeo(req) : null;
  const country = geo ? resolveProfileCountryName(geo) : "Unknown";

  const userId = await qTransaction(async () => {
    const result = await qRun(`
      INSERT INTO users (
        email, username, password_hash, country, member_since, created_at, updated_at, email_verified, email_verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `, pending.email, pending.username, pending.password_hash, country, ts.slice(0, 10), ts, ts, ts);

    const id = Number(result.lastInsertRowid);
    await qRun("INSERT INTO user_settings (user_id) VALUES (?)", id);

    const registrationOrder = (await qGet<{ c: number }>(`
      SELECT COUNT(*) as c FROM users WHERE is_npc = 0 AND id <= ?
    `, id))!.c;
    const globalRank = 1200 + registrationOrder;

    await qRun(`
      INSERT INTO game_stats (
        user_id, missions_complete, pvp_wins, playtime_hours, legendary_items,
        ninjutsu, taijutsu, genjutsu, senjutsu, kenjutsu, global_rank
      ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)
    `, id, globalRank);

    await qRun("DELETE FROM pending_registrations WHERE id = ?", pending.id);
    return id;
  });

  setUserOnline(userId);
  syncPublicChannels(userId);

  if (geo) {
    await saveUserLocation(userId, geo);
  }

  if (req) {
    logActivitySync({
      req,
      userId,
      username: pending.username,
      eventType: "register",
      eventCategory: "authentication",
      description: `User registered: ${pending.username}`,
      affectedObject: `user:${userId}`,
      geo: geo ?? undefined,
    });
  }

  return userId;
}

export async function verifyPendingByCode(emailRaw: string, codeRaw: string, req?: Request): Promise<number> {
  await purgeExpiredPendingRegistrations();
  const email = normalizeEmail(emailRaw);
  const code = String(codeRaw || "").trim();

  if (!/^\d{6}$/.test(code)) {
    throw authError("Enter the 6-digit verification code", 400, "INVALID_VERIFICATION_CODE");
  }

  if (!checkRateLimit(`verify:${email}`, 12, 15 * 60_000)) {
    throw authError("Too many verification attempts. Please try again later.", 429, "RATE_LIMITED");
  }

  const pending = await findPendingByEmail(email);
  if (!pending) {
    throw authError("Invalid or expired verification code", 400, "INVALID_VERIFICATION_CODE");
  }
  if (new Date(pending.expires_at) < new Date()) {
    await qRun("DELETE FROM pending_registrations WHERE id = ?", pending.id);
    console.info(`[verification] verification expired email=${email}`);
    throw authError("This verification code has expired. Please request a new one.", 400, "VERIFICATION_EXPIRED");
  }

  const codeHash = hashSecret(code);
  if (!safeEqualDigest(codeHash, pending.code_hash)) {
    await qRun("UPDATE pending_registrations SET attempt_count = attempt_count + 1 WHERE id = ?", pending.id);
    throw authError("Invalid or expired verification code", 400, "INVALID_VERIFICATION_CODE");
  }

  const userId = await createUserFromPending(pending, req);
  console.info(`[verification] verification completed email=${email} userId=${userId}`);
  return userId;
}

export async function verifyPendingByToken(tokenRaw: string, req?: Request): Promise<{ userId: number; email: string }> {
  await purgeExpiredPendingRegistrations();
  const token = String(tokenRaw || "").trim();
  if (!token || token.length < 32) {
    throw authError("Invalid or expired verification link", 400, "INVALID_VERIFICATION_LINK");
  }

  if (!checkRateLimit(`verify-token:${token.slice(0, 16)}`, 20, 15 * 60_000)) {
    throw authError("Too many verification attempts. Please try again later.", 429, "RATE_LIMITED");
  }

  const tokenHash = hashSecret(token);
  const pending = await qGet<PendingRegistration>("SELECT * FROM pending_registrations WHERE token_hash = ?", tokenHash);

  if (!pending) {
    throw authError("Invalid or expired verification link", 400, "INVALID_VERIFICATION_LINK");
  }
  if (new Date(pending.expires_at) < new Date()) {
    await qRun("DELETE FROM pending_registrations WHERE id = ?", pending.id);
    console.info(`[verification] verification link expired email=${pending.email}`);
    throw authError("This verification link has expired. Please request a new one.", 400, "VERIFICATION_EXPIRED");
  }

  const userId = await createUserFromPending(pending, req);
  console.info(`[verification] verification completed email=${pending.email} userId=${userId}`);
  return { userId, email: pending.email };
}
