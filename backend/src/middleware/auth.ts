import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { db, type UserRow } from "../db/index.js";

import { isUserActive } from "./admin.js";
import { touchPresence } from "../services/presence.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export type AuthPayload = { userId: number; email: string };

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function publicUser(user: UserRow, viewerId?: number) {
  const settings = db.prepare("SELECT public_profile FROM user_settings WHERE user_id = ?").get(user.id) as { public_profile: number } | undefined;
  const isPublic = settings?.public_profile !== 0;
  const isSelf = viewerId === user.id;

  return {
    id: user.id,
    email: isSelf ? user.email : undefined,
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
    isAdmin: (user as UserRow & { is_admin?: number }).is_admin === 1,
    isTeamMember: (user as UserRow & { is_team_member?: number }).is_team_member === 1,
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.token;

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const payload = verifyToken(token);
    const user = getUserById(payload.userId);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    if (!isUserActive(user)) {
      res.status(403).json({ error: "Account is disabled" });
      return;
    }
    req.user = user;
    req.auth = payload;
    touchPresence(user.id);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.token;
  if (token) {
    try {
      const payload = verifyToken(token);
      const user = getUserById(payload.userId);
      if (user) {
        req.user = user;
        req.auth = payload;
      }
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
