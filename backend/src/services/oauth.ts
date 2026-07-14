import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "../db/index.js";

export type OAuthProvider = "google" | "microsoft" | "discord";

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
  return value === "google" || value === "microsoft" || value === "discord";
}

export function oauthConfigured(provider: OAuthProvider): boolean {
  if (provider === "google") return Boolean(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));
  if (provider === "microsoft") return Boolean(env("MICROSOFT_CLIENT_ID") && env("MICROSOFT_CLIENT_SECRET"));
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

export function createOAuthState(provider: OAuthProvider): string {
  const state = crypto.randomBytes(24).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + STATE_TTL_MS).toISOString();
  db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(now.toISOString());
  db.prepare("INSERT INTO oauth_states (state, provider, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    state,
    provider,
    now.toISOString(),
    expires,
  );
  return state;
}

export function consumeOAuthState(state: string, provider: OAuthProvider): boolean {
  if (!state) return false;
  const row = db.prepare("SELECT provider, expires_at FROM oauth_states WHERE state = ?").get(state) as
    | { provider: string; expires_at: string }
    | undefined;
  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
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

  if (provider === "microsoft") {
    const clientId = encodeURIComponent(env("MICROSOFT_CLIENT_ID"));
    const scope = encodeURIComponent("openid profile email User.Read");
    const tenant = env("MICROSOFT_TENANT") || "common";
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${st}&response_mode=query`;
  }

  const clientId = encodeURIComponent(env("DISCORD_CLIENT_ID"));
  const scope = encodeURIComponent("identify email");
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${st}&prompt=consent`;
}

async function exchangeCode(
  tokenUrl: string,
  body: Record<string, string>,
): Promise<{ access_token: string; token_type?: string }> {
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Failed to exchange OAuth code");
  }
  return { access_token: data.access_token, token_type: data.token_type };
}

function sanitizeUsernameBase(raw: string): string {
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[^\w\-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return cleaned || "ShadowNinja";
}

export function generateUniqueUsername(hint: string | null | undefined): string {
  const base = sanitizeUsernameBase(hint || "ShadowNinja");
  const exists = db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(base);
  if (!exists) return base;

  for (let i = 2; i < 10000; i++) {
    const candidate = `${base}_${i}`.slice(0, 32);
    const taken = db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(candidate);
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

async function fetchMicrosoftProfile(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
    givenName?: string;
  };
  if (!res.ok || !data.id) throw new Error("Failed to fetch Microsoft profile");

  const email = (data.mail || data.userPrincipalName || "").toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("Microsoft account did not provide an email address");
  }

  let avatarUrl: string | null = null;
  try {
    const photoRes = await fetch("https://graph.microsoft.com/v1.0/me/photo/$value", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (photoRes.ok) {
      const buf = Buffer.from(await photoRes.arrayBuffer());
      const ctype = photoRes.headers.get("content-type") || "image/jpeg";
      const ext = ctype.includes("png") ? ".png" : ctype.includes("gif") ? ".gif" : ".jpg";
      const uploadDir = process.env.UPLOAD_DIR || "./uploads";
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filename = `ms-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      fs.writeFileSync(path.join(uploadDir, filename), buf);
      avatarUrl = `/uploads/${filename}`;
    }
  } catch {
    /* photo optional */
  }

  return {
    provider: "microsoft",
    providerUserId: data.id,
    email,
    displayName: data.displayName || data.givenName || null,
    usernameHint: data.displayName || data.givenName || email.split("@")[0],
    avatarUrl,
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

  if (provider === "microsoft") {
    const tenant = env("MICROSOFT_TENANT") || "common";
    const tokens = await exchangeCode(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      code,
      client_id: env("MICROSOFT_CLIENT_ID"),
      client_secret: env("MICROSOFT_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    return fetchMicrosoftProfile(tokens.access_token);
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
