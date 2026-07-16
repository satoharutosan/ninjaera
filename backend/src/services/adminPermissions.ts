import type { Response } from "express";
import type { UserRow } from "../db/index.js";

/** Single authoritative Super Admin identity — no DB role column. */
export const SUPER_ADMIN_EMAIL = "admin@ninjaera.com";

type EmailLike = { email?: string | null };
type AdminLike = { is_admin?: number; isAdmin?: boolean };

export function isSuperAdmin(user: EmailLike | UserRow): boolean {
  const email = (user.email || "").trim().toLowerCase();
  return email === SUPER_ADMIN_EMAIL.toLowerCase();
}

/** The Super Admin account itself — immutable by anyone. */
export function isProtectedAccount(user: EmailLike | UserRow): boolean {
  return isSuperAdmin(user);
}

export function isAdministrator(user: AdminLike): boolean {
  if ("is_admin" in user && user.is_admin !== undefined) return user.is_admin === 1;
  if ("isAdmin" in user && user.isAdmin !== undefined) return !!user.isAdmin;
  return false;
}

/** Whether an administrator may edit/disable/delete the target user. */
export function canManageTargetUser(actor: UserRow, target: EmailLike & AdminLike): boolean {
  if (isProtectedAccount(target)) return false;
  if (isAdministrator(target) && !isSuperAdmin(actor)) return false;
  return true;
}

/** Whether the target may appear in bulk-selection / bulk-delete. */
export function canSelectTargetUser(actor: UserRow, target: EmailLike & AdminLike): boolean {
  return canManageTargetUser(actor, target);
}

export function denyUnlessSuperAdmin(actor: UserRow, res: Response): boolean {
  if (!isSuperAdmin(actor)) {
    res.status(403).json({ error: "Super Administrator access required" });
    return true;
  }
  return false;
}
