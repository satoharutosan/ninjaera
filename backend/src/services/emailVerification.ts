import crypto from "crypto";
import bcrypt from "bcryptjs";
import { qGet, qRun } from "../db/query.js";
import {
  EMAIL_RESEND_COOLDOWN_MS,
  EMAIL_VERIFY_TTL_MS,
  generateVerificationCode,
  generateVerificationToken,
  hashSecret,
  sendVerificationEmail,
} from "./mail.js";
import { validateUsernameForWrite, isUsernameTaken } from "./username.js";
import { validateNewPassword } from "./passwordReset.js";
import { setUserOnline } from "./presence.js";
import { syncPublicChannels } from "./channels.js";
import { logActivitySync } from "./activityLog.js";
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
};

function safeEqualDigest(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

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
  await qRun("DELETE FROM pending_registrations WHERE expires_at < ?", new Date().toISOString());
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
  return {
    code,
    token,
    codeHash: hashSecret(code),
    tokenHash: hashSecret(token),
    expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS).toISOString(),
    sentAt: new Date().toISOString(),
  };
}

export async function startEmailRegistration(input: {
  email: string;
  username: string;
  password: string;
  req?: Request;
}): Promise<{ email: string; cooldownSeconds: number }> {
  await purgeExpiredPendingRegistrations();

  const email = normalizeEmail(input.email);
  if (!isEmailFormatValid(email)) {
    throw Object.assign(new Error("Please enter a valid email address"), { status: 400 });
  }

  const usernameCheck = await validateUsernameForWrite(input.username);
  if (!usernameCheck.ok) {
    throw Object.assign(new Error(usernameCheck.error), { status: usernameCheck.status });
  }
  const username = usernameCheck.username;

  const pwErr = validateNewPassword(input.password);
  if (pwErr) {
    throw Object.assign(new Error(pwErr), { status: 400 });
  }

  const existingUser = await qGet("SELECT id FROM users WHERE email = ? AND is_npc = 0", email);
  if (existingUser) {
    throw Object.assign(new Error("An account with this email already exists"), { status: 409 });
  }

  if ((await isUsernameTaken(username)) || (await isUsernamePending(username, email))) {
    throw Object.assign(new Error("This username is already in use. Please choose a different username."), { status: 409 });
  }

  if (!checkRateLimit(`register:${email}`, 5, 15 * 60_000)) {
    throw Object.assign(new Error("Too many registration attempts. Please try again later."), { status: 429 });
  }

  const secrets = issueSecrets();
  const passwordHash = bcrypt.hashSync(input.password, 10);

  await qRun("DELETE FROM pending_registrations WHERE email = ?", email);
  await qRun(`
    INSERT INTO pending_registrations (
      email, username, password_hash, code_hash, token_hash, expires_at, last_sent_at, attempt_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `,
    email,
    username,
    passwordHash,
    secrets.codeHash,
    secrets.tokenHash,
    secrets.expiresAt,
    secrets.sentAt,
    secrets.sentAt,
  );

  try {
    await sendVerificationEmail({
      to: email,
      username,
      code: secrets.code,
      token: secrets.token,
    });
  } catch (e) {
    await qRun("DELETE FROM pending_registrations WHERE email = ?", email);
    throw Object.assign(
      new Error("We could not send the verification email. Please try again shortly."),
      { status: 503, cause: e },
    );
  }

  if (input.req) {
    logActivitySync({
      req: input.req,
      userId: null,
      username,
      eventType: "register_pending",
      eventCategory: "authentication",
      description: `Email verification started for ${email}`,
      metadata: { email },
    });
  }

  return { email, cooldownSeconds: Math.ceil(EMAIL_RESEND_COOLDOWN_MS / 1000) };
}

export async function resendVerificationEmail(emailRaw: string, req?: Request): Promise<{ cooldownSeconds: number }> {
  await purgeExpiredPendingRegistrations();
  const email = normalizeEmail(emailRaw);
  const pending = await findPendingByEmail(email);
  if (!pending) {
    // Do not reveal whether email exists
    return { cooldownSeconds: Math.ceil(EMAIL_RESEND_COOLDOWN_MS / 1000) };
  }

  if (!checkRateLimit(`resend:${email}`, 8, 60 * 60_000)) {
    throw Object.assign(new Error("Too many resend requests. Please try again later."), { status: 429 });
  }

  const lastSent = new Date(pending.last_sent_at).getTime();
  const wait = EMAIL_RESEND_COOLDOWN_MS - (Date.now() - lastSent);
  if (wait > 0) {
    throw Object.assign(
      new Error(`Please wait ${Math.ceil(wait / 1000)} seconds before requesting another email.`),
      { status: 429, retryAfter: Math.ceil(wait / 1000) },
    );
  }

  console.info(`[mail] verification email resend requested for=${email}`);

  const secrets = issueSecrets();
  await qRun(`
    UPDATE pending_registrations
    SET code_hash = ?, token_hash = ?, expires_at = ?, last_sent_at = ?, attempt_count = 0
    WHERE email = ?
  `, secrets.codeHash, secrets.tokenHash, secrets.expiresAt, secrets.sentAt, email);

  await sendVerificationEmail({
    to: email,
    username: pending.username,
    code: secrets.code,
    token: secrets.token,
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

  return { cooldownSeconds: Math.ceil(EMAIL_RESEND_COOLDOWN_MS / 1000) };
}

async function createUserFromPending(pending: PendingRegistration, req?: Request): Promise<number> {
  const ts = new Date().toISOString();
  const result = await qRun(`
    INSERT INTO users (
      email, username, password_hash, member_since, created_at, updated_at, email_verified, email_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `, pending.email, pending.username, pending.password_hash, ts.slice(0, 10), ts, ts, ts);

  const userId = Number(result.lastInsertRowid);
  await qRun("INSERT INTO user_settings (user_id) VALUES (?)", userId);

  const registrationOrder = (await qGet<{ c: number }>(`
    SELECT COUNT(*) as c FROM users WHERE is_npc = 0 AND id <= ?
  `, userId))!.c;
  const globalRank = 1200 + registrationOrder;

  await qRun(`
    INSERT INTO game_stats (
      user_id, missions_complete, pvp_wins, playtime_hours, legendary_items,
      ninjutsu, taijutsu, genjutsu, senjutsu, kenjutsu, global_rank
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)
  `, userId, globalRank);

  await qRun("DELETE FROM pending_registrations WHERE id = ?", pending.id);

  setUserOnline(userId);
  syncPublicChannels(userId);

  if (req) {
    logActivitySync({
      req,
      userId,
      username: pending.username,
      eventType: "register",
      eventCategory: "authentication",
      description: `User registered: ${pending.username}`,
      affectedObject: `user:${userId}`,
    });
  }

  return userId;
}

export async function verifyPendingByCode(emailRaw: string, codeRaw: string, req?: Request): Promise<number> {
  await purgeExpiredPendingRegistrations();
  const email = normalizeEmail(emailRaw);
  const code = String(codeRaw || "").trim();

  if (!/^\d{6}$/.test(code)) {
    throw Object.assign(new Error("Enter the 6-digit verification code"), { status: 400 });
  }

  if (!checkRateLimit(`verify:${email}`, 12, 15 * 60_000)) {
    throw Object.assign(new Error("Too many verification attempts. Please try again later."), { status: 429 });
  }

  const pending = await findPendingByEmail(email);
  if (!pending) {
    throw Object.assign(new Error("Invalid or expired verification code"), { status: 400 });
  }
  if (new Date(pending.expires_at) < new Date()) {
    await qRun("DELETE FROM pending_registrations WHERE id = ?", pending.id);
    throw Object.assign(new Error("This verification code has expired. Please request a new one."), { status: 400 });
  }

  const codeHash = hashSecret(code);
  if (!safeEqualDigest(codeHash, pending.code_hash)) {
    await qRun("UPDATE pending_registrations SET attempt_count = attempt_count + 1 WHERE id = ?", pending.id);
    throw Object.assign(new Error("Invalid or expired verification code"), { status: 400 });
  }

  return createUserFromPending(pending, req);
}

export async function verifyPendingByToken(tokenRaw: string, req?: Request): Promise<{ userId: number; email: string }> {
  await purgeExpiredPendingRegistrations();
  const token = String(tokenRaw || "").trim();
  if (!token || token.length < 32) {
    throw Object.assign(new Error("Invalid or expired verification link"), { status: 400 });
  }

  if (!checkRateLimit(`verify-token:${token.slice(0, 16)}`, 20, 15 * 60_000)) {
    throw Object.assign(new Error("Too many verification attempts. Please try again later."), { status: 429 });
  }

  const tokenHash = hashSecret(token);
  const pending = await qGet<PendingRegistration>("SELECT * FROM pending_registrations WHERE token_hash = ?", tokenHash);

  if (!pending) {
    throw Object.assign(new Error("Invalid or expired verification link"), { status: 400 });
  }
  if (new Date(pending.expires_at) < new Date()) {
    await qRun("DELETE FROM pending_registrations WHERE id = ?", pending.id);
    throw Object.assign(new Error("This verification link has expired. Please request a new one."), { status: 400 });
  }

  const userId = await createUserFromPending(pending, req);
  return { userId, email: pending.email };
}
