import type { Response } from "express";
import type { UserRow } from "../db/index.js";

/**
 * Super Admin is identified by email (not a DB role column).
 * Override with SUPER_ADMIN_EMAIL in production so Railway bootstrap matches.
 */
export function resolveSuperAdminEmail(): string {
  const fromEnv = (process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
  if (fromEnv) return fromEnv;
  return "admin@ninjaera.com";
}

/** @deprecated Prefer resolveSuperAdminEmail() — kept for callers that need a constant-ish value. */
export const SUPER_ADMIN_EMAIL = resolveSuperAdminEmail();

type EmailLike = { email?: string | null };
type AdminLike = { is_admin?: number; isAdmin?: boolean };

export function isSuperAdmin(user: EmailLike | UserRow): boolean {
  const email = (user.email || "").trim().toLowerCase();
  return email === resolveSuperAdminEmail();
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
