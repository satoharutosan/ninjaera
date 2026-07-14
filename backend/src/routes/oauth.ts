import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "../db/index.js";
import { signToken } from "../middleware/auth.js";
import { lookupGeo, saveUserLocation } from "../services/geoip.js";
import { logActivitySync } from "../services/activityLog.js";
import { setUserOnline } from "../services/presence.js";
import { syncPublicChannels } from "../services/channels.js";
import {
  type OAuthProvider,
  type OAuthProfile,
  isOAuthProvider,
  oauthConfigured,
  createOAuthState,
  consumeOAuthState,
  getAuthorizeUrl,
  exchangeCodeForProfile,
  generateUniqueUsername,
  frontendUrl,
} from "../services/oauth.js";

const router = Router();
const now = () => new Date().toISOString();

async function trackLogin(req: Parameters<typeof lookupGeo>[0], userId: number) {
  try {
    const geo = await lookupGeo(req);
    saveUserLocation(userId, geo);
  } catch { /* ignore geo failures */ }
}

function redirectWithError(res: import("express").Response, message: string) {
  const url = `${frontendUrl()}/#/oauth-callback?error=${encodeURIComponent(message)}`;
  res.redirect(url);
}

function redirectWithToken(res: import("express").Response, token: string) {
  const url = `${frontendUrl()}/#/oauth-callback?token=${encodeURIComponent(token)}`;
  res.redirect(url);
}

function findUserByProvider(provider: OAuthProvider, providerUserId: string) {
  return db.prepare(`
    SELECT u.* FROM users u
    INNER JOIN user_oauth_providers p ON p.user_id = u.id
    WHERE p.provider = ? AND p.provider_user_id = ? AND u.is_npc = 0
  `).get(provider, providerUserId) as {
    id: number;
    email: string;
    username: string;
    avatar_url: string | null;
    is_disabled?: number;
    is_deleted?: number;
  } | undefined;
}

function findUserByEmail(email: string) {
  return db.prepare("SELECT * FROM users WHERE email = ? AND is_npc = 0").get(email) as {
    id: number;
    email: string;
    username: string;
    avatar_url: string | null;
    is_disabled?: number;
    is_deleted?: number;
  } | undefined;
}

function linkProvider(userId: number, provider: OAuthProvider, providerUserId: string) {
  const existing = db.prepare(
    "SELECT id, user_id FROM user_oauth_providers WHERE provider = ? AND provider_user_id = ?",
  ).get(provider, providerUserId) as { id: number; user_id: number } | undefined;

  if (existing) {
    if (existing.user_id !== userId) {
      throw new Error("This social account is already linked to another user");
    }
    return;
  }

  const sameProvider = db.prepare(
    "SELECT id FROM user_oauth_providers WHERE user_id = ? AND provider = ?",
  ).get(userId, provider);
  if (sameProvider) {
    db.prepare("UPDATE user_oauth_providers SET provider_user_id = ?, linked_at = ? WHERE user_id = ? AND provider = ?")
      .run(providerUserId, now(), userId, provider);
    return;
  }

  db.prepare(
    "INSERT INTO user_oauth_providers (user_id, provider, provider_user_id, linked_at) VALUES (?, ?, ?, ?)",
  ).run(userId, provider, providerUserId, now());
}

function createOAuthUser(profile: OAuthProfile): number {
  const ts = now();
  const username = generateUniqueUsername(profile.usernameHint);
  const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 10);

  const result = db.prepare(`
    INSERT INTO users (email, username, password_hash, avatar_url, member_since, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile.email,
    username,
    passwordHash,
    profile.avatarUrl || null,
    ts.slice(0, 10),
    ts,
    ts,
  );

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

  linkProvider(userId, profile.provider, profile.providerUserId);
  return userId;
}

async function completeOAuthLogin(
  req: import("express").Request,
  res: import("express").Response,
  profile: OAuthProfile,
) {
  let user = findUserByProvider(profile.provider, profile.providerUserId);
  let isNewUser = false;

  if (!user) {
    const byEmail = findUserByEmail(profile.email);
    if (byEmail) {
      if (byEmail.is_disabled === 1 || byEmail.is_deleted === 1) {
        logActivitySync({
          req,
          userId: byEmail.id,
          username: byEmail.username,
          eventType: "login_denied",
          eventCategory: "security",
          description: `OAuth ${profile.provider} login denied: account disabled`,
          result: "failure",
          metadata: { provider: profile.provider },
        });
        redirectWithError(res, "Account is disabled");
        return;
      }
      try {
        linkProvider(byEmail.id, profile.provider, profile.providerUserId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Account linking failed";
        logActivitySync({
          req,
          userId: byEmail.id,
          username: byEmail.username,
          eventType: "login_failed",
          eventCategory: "authentication",
          description: msg,
          result: "failure",
          metadata: { provider: profile.provider },
        });
        redirectWithError(res, msg);
        return;
      }
      user = byEmail;
    } else {
      const userId = createOAuthUser(profile);
      isNewUser = true;
      user = findUserByEmail(profile.email)!;
      if (!user) {
        redirectWithError(res, "Failed to create account");
        return;
      }
    }
  }

  if (user.is_disabled === 1 || user.is_deleted === 1) {
    logActivitySync({
      req,
      userId: user.id,
      username: user.username,
      eventType: "login_denied",
      eventCategory: "security",
      description: `OAuth ${profile.provider} login denied: account disabled`,
      result: "failure",
      metadata: { provider: profile.provider },
    });
    redirectWithError(res, "Account is disabled");
    return;
  }

  await trackLogin(req, user.id);
  const ts = now();
  db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, user.id);
  setUserOnline(user.id);
  syncPublicChannels(user.id);

  const providerLabel = profile.provider.charAt(0).toUpperCase() + profile.provider.slice(1);
  if (isNewUser) {
    logActivitySync({
      req,
      userId: user.id,
      username: user.username,
      eventType: "register",
      eventCategory: "authentication",
      description: `User registered via ${providerLabel}: ${user.username}`,
      affectedObject: `user:${user.id}`,
      metadata: { provider: profile.provider },
    });
  }
  logActivitySync({
    req,
    userId: user.id,
    username: user.username,
    eventType: "login",
    eventCategory: "authentication",
    description: `User logged in via ${providerLabel}`,
    affectedObject: `user:${user.id}`,
    metadata: { provider: profile.provider },
  });

  const token = signToken({ userId: user.id, email: user.email });
  redirectWithToken(res, token);
}

router.get("/oauth/:provider", (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  if (!isOAuthProvider(provider)) {
    res.status(400).json({ error: "Unsupported OAuth provider" });
    return;
  }
  if (!oauthConfigured(provider)) {
    redirectWithError(res, `${provider.charAt(0).toUpperCase() + provider.slice(1)} sign-in is not configured`);
    return;
  }

  const state = createOAuthState(provider);
  res.redirect(getAuthorizeUrl(provider, state));
});

router.get("/oauth/:provider/callback", async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  if (!isOAuthProvider(provider)) {
    redirectWithError(res, "Unsupported OAuth provider");
    return;
  }

  const errorParam = typeof req.query.error === "string" ? req.query.error : null;
  if (errorParam) {
    const desc = typeof req.query.error_description === "string"
      ? req.query.error_description
      : "Access was denied by the provider";
    logActivitySync({
      req,
      eventType: "login_failed",
      eventCategory: "authentication",
      description: `OAuth ${provider} denied: ${desc}`,
      result: "failure",
      metadata: { provider, error: errorParam },
    });
    redirectWithError(res, desc);
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code) {
    redirectWithError(res, "Missing authorization code");
    return;
  }
  if (!consumeOAuthState(state, provider)) {
    redirectWithError(res, "Invalid or expired OAuth session. Please try again.");
    return;
  }

  try {
    const profile = await exchangeCodeForProfile(provider, code);
    await completeOAuthLogin(req, res, profile);
  } catch (e) {
    const message = e instanceof Error ? e.message : "OAuth authentication failed";
    console.error(`[oauth/${provider}]`, e);
    logActivitySync({
      req,
      eventType: "login_failed",
      eventCategory: "authentication",
      description: `OAuth ${provider} failed: ${message}`,
      result: "failure",
      metadata: { provider },
    });
    redirectWithError(res, message);
  }
});

export default router;
