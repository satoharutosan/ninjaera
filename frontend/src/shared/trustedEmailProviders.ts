/**
 * Mirrors backend/src/config/trustedEmailProviders.ts for client-side UX.
 * Server always enforces the same rules — never rely on this alone.
 */

export const DEFAULT_TRUSTED_EMAIL_DOMAINS = [
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.jp",
  "yahoo.co.uk",
  "yahoo.ca",
  "yahoo.com.au",
  "proton.me",
  "protonmail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "zoho.com",
  "fastmail.com",
  "tutanota.com",
  "tutamail.com",
] as const;

/** Keep in sync with backend SUPER_ADMIN_EMAIL default. */
export const SUPER_ADMIN_EMAIL_EXEMPT = "admin@ninjaera.com";

export const UNTRUSTED_EMAIL_PROVIDER_MESSAGE =
  "Registration is currently available only for trusted email providers (for example: Gmail, Outlook, Yahoo, Proton, iCloud, and other supported providers). Please use a supported email address.";

const DOMAIN_SET = new Set(DEFAULT_TRUSTED_EMAIL_DOMAINS.map((d) => d.toLowerCase()));

export function extractEmailDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  return normalized.slice(at + 1).replace(/^\.+/, "") || null;
}

export function isTrustedRegistrationEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === SUPER_ADMIN_EMAIL_EXEMPT) return true;
  const domain = extractEmailDomain(normalized);
  if (!domain) return false;
  return DOMAIN_SET.has(domain);
}
