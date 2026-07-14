import type { Request, Response, NextFunction } from "express";
import type { UserRow } from "../db/index.js";

export function isAdmin(user: UserRow): boolean {
  return (user as UserRow & { is_admin?: number }).is_admin === 1;
}

export function isTeamMember(user: UserRow): boolean {
  return (user as UserRow & { is_team_member?: number }).is_team_member === 1;
}

export function isUserActive(user: UserRow): boolean {
  const u = user as UserRow & { is_disabled?: number; is_deleted?: number };
  return u.is_disabled !== 1 && u.is_deleted !== 1;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!isUserActive(req.user)) {
    res.status(403).json({ error: "Account is disabled" });
    return;
  }
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  next();
}
