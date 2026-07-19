import { resolveSuperAdminEmail } from "../services/adminPermissions.js";

/**
 * Trusted public email providers allowed for new registrations and email changes.
 * Extend via env TRUSTED_EMAIL_DOMAINS (comma-separated) without code changes.
 *
 * Existing accounts with non-listed domains are unaffected (login continues).
 * Super Admin email (admin@ninjaera.com / SUPER_ADMIN_EMAIL) always bypasses this list.
 */
export const DEFAULT_TRUSTED_EMAIL_DOMAINS = [
  // Google
  "gmail.com",
  // Microsoft
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  // Yahoo
  "yahoo.com",
  "yahoo.co.jp",
  "yahoo.co.uk",
  "yahoo.ca",
  "yahoo.com.au",
  // Proton
  "proton.me",
  "protonmail.com",
  // Apple
  "icloud.com",
  "me.com",
  "mac.com",
  // AOL
  "aol.com",
  // Zoho
  "zoho.com",
  // Fastmail
  "fastmail.com",
  // Tutanota
  "tutanota.com",
  "tutamail.com",
] as const;

export const UNTRUSTED_EMAIL_PROVIDER_MESSAGE =
  "Registration is currently available only for trusted email providers (for example: Gmail, Outlook, Yahoo, Proton, iCloud, and other supported providers). Please use a supported email address.";

export const UNTRUSTED_EMAIL_PROVIDER_CODE = "UNTRUSTED_EMAIL_PROVIDER";

let cachedDomainSet: Set<string> | null = null;

function parseEnvDomains(): string[] {
  const raw = (process.env.TRUSTED_EMAIL_DOMAINS || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/** All approved domains (defaults + optional env extras). */
export function getTrustedEmailDomains(): Set<string> {
  if (cachedDomainSet) return cachedDomainSet;
  cachedDomainSet = new Set<string>([
    ...DEFAULT_TRUSTED_EMAIL_DOMAINS.map((d) => d.toLowerCase()),
    ...parseEnvDomains(),
  ]);
  return cachedDomainSet;
}

/** Test helper / hot-reload after env changes in the same process. */
export function resetTrustedEmailDomainCache(): void {
  cachedDomainSet = null;
}

export function extractEmailDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  const domain = normalized.slice(at + 1).replace(/^\.+/, "");
  return domain || null;
}

export function isExemptRegistrationEmail(email: string): boolean {
  return email.trim().toLowerCase() === resolveSuperAdminEmail();
}

/**
 * Whether an email may be used for registration / email change.
 * Super Admin address always returns true.
 */
export function isTrustedRegistrationEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (isExemptRegistrationEmail(normalized)) return true;
  const domain = extractEmailDomain(normalized);
  if (!domain) return false;
  return getTrustedEmailDomains().has(domain);
}

export type TrustedEmailCheck =
  | { ok: true; email: string; domain: string | null }
  | { ok: false; error: string; code: string };

/** Normalize + whitelist check for registration / email updates. */
export function assertTrustedRegistrationEmail(rawEmail: string): TrustedEmailCheck {
  const email = rawEmail.trim().toLowerCase();
  if (!email) {
    return { ok: false, error: "Email is required", code: "INVALID_EMAIL" };
  }
  if (isExemptRegistrationEmail(email)) {
    return { ok: true, email, domain: extractEmailDomain(email) };
  }
  if (!isTrustedRegistrationEmail(email)) {
    return {
      ok: false,
      error: UNTRUSTED_EMAIL_PROVIDER_MESSAGE,
      code: UNTRUSTED_EMAIL_PROVIDER_CODE,
    };
  }
  return { ok: true, email, domain: extractEmailDomain(email) };
}
