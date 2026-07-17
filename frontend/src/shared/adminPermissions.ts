/** Single authoritative Super Admin identity — mirrors backend adminPermissions.ts */
export const SUPER_ADMIN_EMAIL = "admin@ninjaera.com";

export const PROTECTED_ACCOUNT_TOOLTIP = "This account is protected and cannot be modified.";

type EmailLike = { email?: string | null };
type AdminLike = { isAdmin?: boolean };

export function isSuperAdmin(user: EmailLike | null | undefined): boolean {
  if (!user?.email) return false;
  return user.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

export function isProtectedAccount(user: EmailLike | null | undefined): boolean {
  return isSuperAdmin(user) || isSuperAdminEmail(user?.email);
}

export function isAdministrator(user: AdminLike | null | undefined): boolean {
  return !!user?.isAdmin;
}

export function canManageTargetUser(
  actor: EmailLike | null | undefined,
  target: (EmailLike & AdminLike) | null | undefined,
): boolean {
  if (!target) return false;
  if (isProtectedAccount(target)) return false;
  if (isAdministrator(target) && !isSuperAdmin(actor)) return false;
  return true;
}

export function canSelectTargetUser(
  actor: EmailLike | null | undefined,
  target: (EmailLike & AdminLike) | null | undefined,
): boolean {
  return canManageTargetUser(actor, target);
}

export type AdminSection = "dashboard" | "users" | "notifications" | "contacts" | "channels" | "applications" | "resources" | "game-downloads" | "messaging-history" | "activity-logs" | "database" | "about-our-story" | "link-file-management";

/** Order matches Super Admin sidebar grouping (bottom of nav). */
const SUPER_ADMIN_ONLY_SECTIONS: AdminSection[] = ["database", "messaging-history", "link-file-management"];

export function isSuperAdminOnlySection(section: AdminSection): boolean {
  return SUPER_ADMIN_ONLY_SECTIONS.includes(section);
}

export function canAccessAdminSection(
  actor: EmailLike | null | undefined,
  section: AdminSection,
): boolean {
  if (isSuperAdminOnlySection(section)) return isSuperAdmin(actor);
  return true;
}
