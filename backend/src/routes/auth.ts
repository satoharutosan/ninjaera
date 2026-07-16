import { Router } from "express";
import bcrypt from "bcryptjs";
import { qGet, qRun } from "../db/query.js";
import { requireAuth, signTokenForUser, publicUser, optionalAuth, bumpTokenVersion } from "../middleware/auth.js";
import { rateLimit, clientIp, allowRateLimit } from "../middleware/rateLimit.js";
import { lookupGeo, saveUserLocation } from "../services/geoip.js";
import { logActivitySync } from "../services/activityLog.js";
import { setUserOnline, setUserOffline } from "../services/presence.js";
import { syncPublicChannels } from "../services/channels.js";
import {
  isUsernameTaken,
  validateUsernameForWrite,
  USERNAME_TAKEN_ERROR,
} from "../services/username.js";
import {
  findPendingByEmail,
  isUsernamePending,
  normalizeEmail,
  resendVerificationEmail,
  startEmailRegistration,
  verifyPendingByCode,
  verifyPendingByToken,
} from "../services/emailVerification.js";
import { requestPasswordReset, resetPasswordWithToken } from "../services/passwordReset.js";
import { consumeOAuthLoginCode } from "../services/oauth.js";

const router = Router();
const now = () => new Date().toISOString();

async function trackLogin(req: Parameters<typeof lookupGeo>[0], userId: number) {
  try {
    const geo = await lookupGeo(req);
    saveUserLocation(userId, geo);
  } catch { /* ignore geo failures */ }
}

function errStatus(e: unknown): number {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return 500;
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** Lightweight availability check for debounced client UX. */
router.get("/username-available", optionalAuth, async (req, res) => {
  const raw = typeof req.query.username === "string" ? req.query.username : "";
  let excludeId = req.user?.id;
  if (typeof req.query.excludeUserId === "string") {
    const n = Number(req.query.excludeUserId);
    if (Number.isFinite(n) && n > 0) excludeId = n;
  }
  const formatOnly = await validateUsernameForWrite(raw);
  if (!formatOnly.ok && formatOnly.status === 400) {
    res.json({ available: false, reason: "invalid", error: formatOnly.error });
    return;
  }
  const username = formatOnly.ok ? formatOnly.username : raw.trim();
  const taken = (await isUsernameTaken(username, excludeId)) || (await isUsernamePending(username));
  res.json({
    available: !taken,
    reason: taken ? "taken" : "ok",
    error: taken ? USERNAME_TAKEN_ERROR : null,
  });
});

/** Start email/password registration — sends verification email; account created only after verify. */
router.post("/register", rateLimit({
  keyFn: (req) => `register:ip:${clientIp(req)}`,
  max: 10,
  windowMs: 60 * 60 * 1000,
  message: "Too many registration attempts. Please try again later.",
}), async (req, res) => {
  const { email, username: rawUsername, password } = req.body;
  if (!email || !rawUsername || !password) {
    res.status(400).json({ error: "Email, username, and password are required" });
    return;
  }

  try {
    const result = await startEmailRegistration({
      email: String(email),
      username: String(rawUsername),
      password: String(password),
      req,
    });
    res.status(202).json({
      pending: true,
      email: result.email,
      message: "Check your email for a verification code to activate your account.",
      cooldownSeconds: result.cooldownSeconds,
    });
  } catch (e) {
    const status = errStatus(e);
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: errMessage(e, "Registration failed"),
    });
  }
});

router.post("/verify-email", rateLimit({
  keyFn: (req) => `verify:ip:${clientIp(req)}`,
  max: 30,
  windowMs: 60 * 60 * 1000,
}), async (req, res) => {
  const { email, code, token } = req.body as { email?: string; code?: string; token?: string };

  try {
    let userId: number;
    if (token) {
      ({ userId } = await verifyPendingByToken(String(token), req));
    } else if (email && code) {
      userId = await verifyPendingByCode(String(email), String(code), req);
    } else {
      res.status(400).json({ error: "Provide a verification code or link token" });
      return;
    }

    const user = await qGet<{ id: number; email: string; token_version?: number }>(
      "SELECT * FROM users WHERE id = ?",
      userId,
    );
    await trackLogin(req, userId);
    const jwt = signTokenForUser(user!);
    res.json({ token: jwt, user: await publicUser(user as never, userId), verified: true });
  } catch (e) {
    const status = errStatus(e);
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: errMessage(e, "Verification failed"),
    });
  }
});

router.post("/resend-verification", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  try {
    const result = await resendVerificationEmail(email, req);
    res.json({
      ok: true,
      message: "If a pending registration exists for that email, a new verification message has been sent.",
      cooldownSeconds: result.cooldownSeconds,
    });
  } catch (e) {
    const status = errStatus(e);
    const body: Record<string, unknown> = { error: errMessage(e, "Could not resend verification email") };
    if (e && typeof e === "object" && "retryAfter" in e) {
      body.retryAfter = (e as { retryAfter: number }).retryAfter;
    }
    res.status(status >= 400 && status < 600 ? status : 500).json(body);
  }
});

router.post("/login", rateLimit({
  keyFn: (req) => `login:ip:${clientIp(req)}`,
  max: 30,
  windowMs: 15 * 60 * 1000,
  message: "Too many login attempts from this network. Please try again later.",
}), async (req, res) => {
  const { email: rawEmail, password } = req.body;
  if (!rawEmail || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const email = normalizeEmail(String(rawEmail));

  const emailLimit = allowRateLimit(`login:email:${email}`, 12, 15 * 60 * 1000);
  if (!emailLimit.ok) {
    res.setHeader("Retry-After", String(emailLimit.retryAfterSec));
    res.status(429).json({
      error: "Too many login attempts for this account. Please try again later.",
      code: "RATE_LIMITED",
      retryAfter: emailLimit.retryAfterSec,
    });
    return;
  }

  const pending = await findPendingByEmail(email);
  if (pending) {
    if (!bcrypt.compareSync(password, pending.password_hash)) {
      logActivitySync({ req, userId: null, username: email, eventType: "login_failed", eventCategory: "authentication", description: `Failed login attempt for ${email}`, result: "failure" });
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    logActivitySync({
      req,
      userId: null,
      username: email,
      eventType: "login_denied",
      eventCategory: "authentication",
      description: "Login denied: email not verified",
      result: "failure",
      metadata: { email },
    });
    res.status(403).json({
      error: "Please verify your email address before signing in.",
      code: "EMAIL_NOT_VERIFIED",
      email,
    });
    return;
  }

  const user = await qGet<{
    id: number;
    email: string;
    password_hash: string;
    is_disabled?: number;
    is_deleted?: number;
    email_verified?: number;
  }>("SELECT * FROM users WHERE email = ? AND is_npc = 0", email);

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
  if (user.email_verified === 0) {
    logActivitySync({
      req,
      userId: user.id,
      username: user.email,
      eventType: "login_denied",
      eventCategory: "authentication",
      description: "Login denied: email not verified",
      result: "failure",
    });
    res.status(403).json({
      error: "Please verify your email address before signing in.",
      code: "EMAIL_NOT_VERIFIED",
      email: user.email,
    });
    return;
  }

  await trackLogin(req, user.id);
  const ts = now();
  await qRun("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", ts, ts, user.id);
  setUserOnline(user.id);
  syncPublicChannels(user.id);
  logActivitySync({ req, userId: user.id, username: user.email, eventType: "login", eventCategory: "authentication", description: "User logged in", affectedObject: `user:${user.id}` });

  const token = signTokenForUser(user);
  const full = await qGet("SELECT * FROM users WHERE id = ?", user.id);
  res.json({ token, user: await publicUser(full as never, user.id) });
});

router.post("/logout", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  setUserOffline(userId);
  await bumpTokenVersion(userId);
  logActivitySync({ req, userId, eventType: "logout", eventCategory: "authentication", description: "User logged out" });
  res.json({ ok: true });
});

/** Exchange a one-time OAuth login code for a session JWT (no JWT in URL). */
router.post("/oauth/exchange", rateLimit({
  keyFn: (req) => `oauth-exchange:ip:${clientIp(req)}`,
  max: 20,
  windowMs: 15 * 60 * 1000,
}), async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!code) {
    res.status(400).json({ error: "Missing OAuth code" });
    return;
  }
  try {
    const userId = await consumeOAuthLoginCode(code);
    if (!userId) {
      res.status(401).json({ error: "Invalid or expired OAuth code" });
      return;
    }
    const user = await qGet("SELECT * FROM users WHERE id = ?", userId);
    if (!user) {
      res.status(401).json({ error: "Invalid or expired OAuth code" });
      return;
    }
    const token = signTokenForUser(user as { id: number; email: string; token_version?: number | null });
    res.json({ token, user: await publicUser(user as never, userId) });
  } catch (e) {
    res.status(500).json({ error: errMessage(e, "OAuth exchange failed") });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: await publicUser(req.user!, req.user!.id) });
});

router.post("/forgot-password", rateLimit({
  keyFn: (req) => `forgot:ip:${clientIp(req)}`,
  max: 10,
  windowMs: 60 * 60 * 1000,
}), async (req, res) => {
  try {
    const result = await requestPasswordReset(String(req.body?.email ?? ""), req);
    res.json(result);
  } catch (e) {
    const status = errStatus(e);
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: errMessage(e, "Could not process password reset"),
      code: e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : undefined,
    });
  }
});

router.post("/reset-password", rateLimit({
  keyFn: (req) => `reset:ip:${clientIp(req)}`,
  max: 20,
  windowMs: 60 * 60 * 1000,
}), async (req, res) => {
  try {
    const result = await resetPasswordWithToken(String(req.body?.token ?? ""), String(req.body?.password ?? ""), req);
    res.json(result);
  } catch (e) {
    const status = errStatus(e);
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: errMessage(e, "Could not reset password"),
      code: e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : undefined,
    });
  }
});

export default router;
