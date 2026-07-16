import crypto from "crypto";
import { qGet, qRun } from "../db/query.js";
import { sanitizeUsernameHint } from "./username.js";

export type OAuthProvider = "google" | "github" | "discord";

export type OAuthProfile = {
  provider: OAuthProvider;
  providerUserId: string;
  email: string;
  displayName: string | null;
  usernameHint: string | null;
  avatarUrl: string | null;
};

const STATE_TTL_MS = 10 * 60 * 1000;

function env(name: string): string {
  return (process.env[name] || "").trim();
}

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === "google" || value === "github" || value === "discord";
}

export function oauthConfigured(provider: OAuthProvider): boolean {
  if (provider === "google") return Boolean(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));
  if (provider === "github") return Boolean(env("GITHUB_CLIENT_ID") && env("GITHUB_CLIENT_SECRET"));
  return Boolean(env("DISCORD_CLIENT_ID") && env("DISCORD_CLIENT_SECRET"));
}

export function oauthCallbackBase(): string {
  return (env("OAUTH_CALLBACK_BASE") || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, "");
}

export function frontendUrl(): string {
  return (env("FRONTEND_URL") || env("CORS_ORIGIN") || "http://localhost:5173").replace(/\/$/, "");
}

export function callbackUrl(provider: OAuthProvider): string {
  return `${oauthCallbackBase()}/api/auth/oauth/${provider}/callback`;
}

export async function createOAuthState(provider: OAuthProvider): Promise<string> {
  const state = crypto.randomBytes(24).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + STATE_TTL_MS).toISOString();
  await qRun("DELETE FROM oauth_states WHERE expires_at < ?", now.toISOString());
  await qRun(
    "INSERT INTO oauth_states (state, provider, created_at, expires_at) VALUES (?, ?, ?, ?)",
    state,
    provider,
    now.toISOString(),
    expires,
  );
  return state;
}

export async function consumeOAuthState(state: string, provider: OAuthProvider): Promise<boolean> {
  if (!state) return false;
  const row = await qGet<{ provider: string; expires_at: string }>(
    "SELECT provider, expires_at FROM oauth_states WHERE state = ?",
    state,
  );
  await qRun("DELETE FROM oauth_states WHERE state = ?", state);
  if (!row) return false;
  if (row.provider !== provider) return false;
  if (new Date(row.expires_at) < new Date()) return false;
  return true;
}

export function getAuthorizeUrl(provider: OAuthProvider, state: string): string {
  const redirectUri = encodeURIComponent(callbackUrl(provider));
  const st = encodeURIComponent(state);

  if (provider === "google") {
    const clientId = encodeURIComponent(env("GOOGLE_CLIENT_ID"));
    const scope = encodeURIComponent("openid email profile");
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${st}&access_type=online&prompt=select_account`;
  }

  if (provider === "github") {
    const clientId = encodeURIComponent(env("GITHUB_CLIENT_ID"));
    const scope = encodeURIComponent("read:user user:email");
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${st}&allow_signup=true`;
  }

  const clientId = encodeURIComponent(env("DISCORD_CLIENT_ID"));
  const scope = encodeURIComponent("identify email");
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${st}&prompt=consent`;
}

async function exchangeCode(
  tokenUrl: string,
  body: Record<string, string>,
  acceptJson = true,
): Promise<{ access_token: string; token_type?: string }> {
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(acceptJson ? { Accept: "application/json" } : {}),
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
    message?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || data.message || "Failed to exchange OAuth code");
  }
  return { access_token: data.access_token, token_type: data.token_type };
}

function sanitizeUsernameBase(raw: string): string {
  return sanitizeUsernameHint(raw);
}

export async function generateUniqueUsername(hint: string | null | undefined): Promise<string> {
  const base = sanitizeUsernameBase(hint || "ShadowNinja");
  const exists = await qGet("SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)", base);
  if (!exists) return base;

  for (let i = 2; i < 10000; i++) {
    const candidate = `${base}_${i}`.slice(0, 32);
    const taken = await qGet("SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)", candidate);
    if (!taken) return candidate;
  }
  return `${base}_${crypto.randomBytes(3).toString("hex")}`;
}

async function fetchGoogleProfile(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    given_name?: string;
    picture?: string;
  };
  if (!res.ok || !data.sub) throw new Error("Failed to fetch Google profile");
  if (!data.email) throw new Error("Google account did not provide an email address");
  if (data.email_verified !== true) {
    throw new Error("Google email is not verified. Please verify your Google account email and try again.");
  }

  const hint = data.name || data.given_name || data.email.split("@")[0];
  return {
    provider: "google",
    providerUserId: data.sub,
    email: data.email.toLowerCase(),
    displayName: data.name || data.given_name || null,
    usernameHint: hint,
    avatarUrl: data.picture || null,
  };
}

async function resolveGitHubEmail(accessToken: string, fallback: string | null | undefined): Promise<string> {
  if (fallback && fallback.includes("@")) return fallback.toLowerCase();

  const res = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Ninja-Era-OAuth",
    },
  });
  const emails = (await res.json().catch(() => [])) as {
    email?: string;
    primary?: boolean;
    verified?: boolean;
  }[];

  if (!Array.isArray(emails) || !emails.length) {
    throw new Error("GitHub account did not provide an email address");
  }

  const verifiedPrimary = emails.find((e) => e.verified && e.primary && e.email);
  const verifiedAny = emails.find((e) => e.verified && e.email);
  const primary = emails.find((e) => e.primary && e.email);
  const chosen = verifiedPrimary || verifiedAny || primary || emails[0];
  if (!chosen?.email) throw new Error("GitHub account did not provide an email address");
  if (chosen.verified === false) throw new Error("GitHub email is not verified");
  return chosen.email.toLowerCase();
}

async function fetchGitHubProfile(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Ninja-Era-OAuth",
    },
  });
  const data = (await res.json().catch(() => ({}))) as {
    id?: number;
    login?: string;
    name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
  };
  if (!res.ok || data.id == null) throw new Error("Failed to fetch GitHub profile");

  const email = await resolveGitHubEmail(accessToken, data.email);
  const usernameHint = data.login || data.name || email.split("@")[0];

  return {
    provider: "github",
    providerUserId: String(data.id),
    email,
    displayName: data.name || data.login || null,
    usernameHint,
    avatarUrl: data.avatar_url || null,
  };
}

async function fetchDiscordProfile(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    username?: string;
    global_name?: string | null;
    email?: string | null;
    verified?: boolean;
    avatar?: string | null;
  };
  if (!res.ok || !data.id) throw new Error("Failed to fetch Discord profile");
  if (!data.email) throw new Error("Discord account did not provide an email address");
  if (data.verified === false) throw new Error("Discord email is not verified");

  const avatarUrl = data.avatar
    ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=256`
    : null;

  return {
    provider: "discord",
    providerUserId: data.id,
    email: data.email.toLowerCase(),
    displayName: data.global_name || data.username || null,
    usernameHint: data.global_name || data.username || data.email.split("@")[0],
    avatarUrl,
  };
}

export async function exchangeCodeForProfile(provider: OAuthProvider, code: string): Promise<OAuthProfile> {
  const redirectUri = callbackUrl(provider);

  if (provider === "google") {
    const tokens = await exchangeCode("https://oauth2.googleapis.com/token", {
      code,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    return fetchGoogleProfile(tokens.access_token);
  }

  if (provider === "github") {
    const tokens = await exchangeCode("https://github.com/login/oauth/access_token", {
      code,
      client_id: env("GITHUB_CLIENT_ID"),
      client_secret: env("GITHUB_CLIENT_SECRET"),
      redirect_uri: redirectUri,
    });
    return fetchGitHubProfile(tokens.access_token);
  }

  const tokens = await exchangeCode("https://discord.com/api/oauth2/token", {
    code,
    client_id: env("DISCORD_CLIENT_ID"),
    client_secret: env("DISCORD_CLIENT_SECRET"),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  return fetchDiscordProfile(tokens.access_token);
}

/** One-time login codes exchanged via POST — never put JWTs in the URL. */
const OAUTH_LOGIN_CODE_TTL_MS = 2 * 60 * 1000;
const oauthLoginCodes = new Map<string, { userId: number; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [code, row] of oauthLoginCodes) {
    if (row.expiresAt <= now) oauthLoginCodes.delete(code);
  }
}, 60_000).unref?.();

export function createOAuthLoginCode(userId: number): string {
  const code = crypto.randomBytes(32).toString("base64url");
  oauthLoginCodes.set(code, { userId, expiresAt: Date.now() + OAUTH_LOGIN_CODE_TTL_MS });
  return code;
}

export async function consumeOAuthLoginCode(code: string): Promise<number | null> {
  if (!code) return null;
  const row = oauthLoginCodes.get(code);
  oauthLoginCodes.delete(code);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) return null;
  return row.userId;
}
