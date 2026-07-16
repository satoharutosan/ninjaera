import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import type { UserRow } from "../db/index.js";
import { qGet, qRun } from "../db/query.js";

import { isUserActive } from "./admin.js";
import { touchPresence } from "../services/presence.js";
import { DELETED_USER_DISPLAY_NAME, isDeletedUser, toDisplayUser } from "../services/deletedUser.js";

const isProd = () => (process.env.NODE_ENV || "").toLowerCase() === "production";

const WEAK_SECRETS = new Set([
  "",
  "dev-secret-change-me",
  "changeme",
  "secret",
  "jwt-secret",
  "your-secret-here",
]);

function resolveJwtSecret(): string {
  const raw = (process.env.JWT_SECRET || "").trim();
  if (isProd()) {
    if (!raw || WEAK_SECRETS.has(raw.toLowerCase()) || raw.length < 32) {
      throw new Error(
        "FATAL: JWT_SECRET must be set to a strong value (≥32 chars) in production. Refusing to start.",
      );
    }
    return raw;
  }
  if (!raw) {
    console.warn("[auth] JWT_SECRET not set — using insecure dev fallback. Never deploy like this.");
    return "dev-secret-change-me";
  }
  return raw;
}

const JWT_SECRET = resolveJwtSecret();

export type AuthPayload = {
  userId: number;
  email: string;
  /** Session generation — must match users.token_version */
  tv?: number;
};

type UserAuthRow = UserRow & {
  is_admin?: number;
  is_team_member?: number;
  token_version?: number | null;
};

function userTokenVersion(user: UserAuthRow): number {
  return Number(user.token_version ?? 0) || 0;
}

/**
 * Session JWTs.
 * Production: finite expiry required (default 7d unless JWT_EXPIRES_IN is set to a finite value).
 * Development: may use "never" for convenience; set JWT_EXPIRES_IN to override.
 */
export function signToken(payload: { userId: number; email: string; tv?: number }): string {
  const tv = payload.tv ?? 0;
  const body: AuthPayload = { userId: payload.userId, email: payload.email, tv };
  const raw = (process.env.JWT_EXPIRES_IN || "").trim().toLowerCase();

  if (isProd()) {
    const expiresIn = (!raw || raw === "never" || raw === "0" || raw === "none")
      ? "7d"
      : raw;
    if (expiresIn === "never" || expiresIn === "0" || expiresIn === "none") {
      throw new Error("JWT_EXPIRES_IN=never is not allowed in production");
    }
    return jwt.sign(body, JWT_SECRET, { expiresIn: expiresIn as jwt.SignOptions["expiresIn"] });
  }

  if (!raw || raw === "never" || raw === "0" || raw === "none") {
    return jwt.sign(body, JWT_SECRET);
  }
  return jwt.sign(body, JWT_SECRET, { expiresIn: raw as jwt.SignOptions["expiresIn"] });
}

/** Issue a session JWT for an existing user row. */
export function signTokenForUser(user: { id: number; email: string; token_version?: number | null }): string {
  return signToken({
    userId: user.id,
    email: user.email,
    tv: Number(user.token_version ?? 0) || 0,
  });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

export async function getUserById(id: number): Promise<UserAuthRow | undefined> {
  return qGet<UserAuthRow>("SELECT * FROM users WHERE id = ?", id);
}

/** Invalidate all existing JWTs for a user (logout, password change, admin force-logout, etc.). */
export async function bumpTokenVersion(userId: number): Promise<number> {
  await qRun(`
    UPDATE users
    SET token_version = COALESCE(token_version, 0) + 1, updated_at = ?
    WHERE id = ?
  `, new Date().toISOString(), userId);
  const row = await qGet<{ token_version: number }>("SELECT token_version FROM users WHERE id = ?", userId);
  return Number(row?.token_version ?? 0) || 0;
}

export async function publicUser(user: UserRow, viewerId?: number) {
  const u = user as UserAuthRow;
  const deleted = isDeletedUser(u);
  const isSelf = viewerId === user.id;

  // Soft-deleted accounts: never expose real identity / PII to other clients
  if (deleted) {
    return {
      id: user.id,
      email: undefined,
      hasPassword: undefined,
      username: DELETED_USER_DISPLAY_NAME,
      avatarUrl: null,
      gender: undefined,
      dateOfBirth: undefined,
      country: undefined,
      city: undefined,
      status: "Offline",
      bio: "",
      memberSince: undefined,
      village: undefined,
      clan: undefined,
      level: 1,
      rank: undefined,
      isNpc: false,
      isAdmin: false,
      isTeamMember: false,
      isDeleted: true as const,
    };
  }

  const settings = await qGet<{ public_profile: number }>(
    "SELECT public_profile FROM user_settings WHERE user_id = ?",
    user.id,
  );
  const isPublic = settings?.public_profile !== 0;

  return {
    id: user.id,
    email: isSelf ? user.email : undefined,
    // Actual account state, not provider inference — drives adaptive password UI
    hasPassword: isSelf ? Boolean(user.password_hash) : undefined,
    username: user.username,
    avatarUrl: user.avatar_url,
    gender: (isSelf || isPublic) ? user.gender : undefined,
    dateOfBirth: (isSelf || isPublic) ? user.date_of_birth : undefined,
    country: (isSelf || isPublic) ? user.country : undefined,
    city: (isSelf || isPublic) ? user.city : undefined,
    status: user.status || "Online",
    bio: user.bio ?? "",
    memberSince: user.member_since,
    village: user.village,
    clan: user.clan,
    level: user.level,
    rank: user.rank,
    isNpc: user.is_npc === 1,
    isAdmin: u.is_admin === 1,
    isTeamMember: u.is_team_member === 1,
    isDeleted: false as const,
  };
}

/** Resolve a user id to safe display fields (works if missing or soft-deleted). */
export async function resolvePublicDisplayUser(userId: number, viewerId?: number) {
  const row = await getUserById(userId);
  if (!row) {
    const t = toDisplayUser(null, userId);
    return {
      id: t.id,
      username: t.username,
      avatarUrl: t.avatarUrl,
      isDeleted: true as const,
      status: "Offline",
      bio: "",
      level: 1,
      isNpc: false,
      isAdmin: false,
      isTeamMember: false,
    };
  }
  return await publicUser(row, viewerId);
}

function attachAuth(req: Request, user: UserAuthRow, payload: AuthPayload) {
  req.user = user;
  req.auth = payload;
  touchPresence(user.id);
}

async function resolveAuthUser(token: string): Promise<{ user: UserAuthRow; payload: AuthPayload } | null> {
  const payload = verifyToken(token);
  const user = await getUserById(payload.userId);
  if (!user) return null;
  if (!isUserActive(user)) return null;
  // Reject tokens issued before the latest password change / forced invalidation.
  // Missing tv (legacy tokens) are accepted once, then clients re-login naturally
  // only when version was bumped — treat missing tv as 0.
  const expected = userTokenVersion(user);
  const got = Number(payload.tv ?? 0) || 0;
  if (got !== expected) return null;
  return { user, payload };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.token;

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const resolved = await resolveAuthUser(token);
    if (!resolved) {
      // Distinguish disabled vs invalid without leaking which
      const payload = (() => {
        try { return verifyToken(token); } catch { return null; }
      })();
      if (payload) {
        const user = await getUserById(payload.userId);
        if (user && !isUserActive(user)) {
          res.status(403).json({ error: "Account is disabled" });
          return;
        }
      }
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    attachAuth(req, resolved.user, resolved.payload);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.token;
  if (token) {
    try {
      const resolved = await resolveAuthUser(token);
      if (resolved) attachAuth(req, resolved.user, resolved.payload);
    } catch { /* ignore */ }
  }
  next();
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
      auth?: AuthPayload;
    }
  }
}
