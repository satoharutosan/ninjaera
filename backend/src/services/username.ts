import { qGet } from "../db/query.js";

/** Allowed username characters: letters, digits, underscore only. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

export const USERNAME_FORMAT_ERROR =
  "Username may contain only letters, numbers, and underscores.";

export const USERNAME_TAKEN_ERROR =
  "This username is already in use. Please choose a different username.";

export const USERNAME_REQUIRED_ERROR = "Username is required";

const MAX_USERNAME_LENGTH = 32;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Format check only — does not trim surrounding spaces (spaces are invalid). */
export function validateUsernameFormat(username: string): string | null {
  if (!username) return USERNAME_REQUIRED_ERROR;
  if (username.length > MAX_USERNAME_LENGTH) {
    return `Username must be at most ${MAX_USERNAME_LENGTH} characters.`;
  }
  if (!USERNAME_PATTERN.test(username)) return USERNAME_FORMAT_ERROR;
  return null;
}

export async function isUsernameTaken(username: string, excludeUserId?: number): Promise<boolean> {
  const lower = normalizeUsername(username);
  if (excludeUserId != null) {
    return !!(await qGet(
      "SELECT 1 FROM users WHERE LOWER(username) = ? AND id != ?",
      lower, excludeUserId,
    ));
  }
  return !!(await qGet("SELECT 1 FROM users WHERE LOWER(username) = ?", lower));
}

export type UsernameWriteResult =
  | { ok: true; username: string }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Validate format + case-insensitive uniqueness.
 * Preserves the caller's capitalization (only trims ends for empty-check; then format
 * forbids internal whitespace — we trim leading/trailing so " Foo " → "Foo").
 */
export async function validateUsernameForWrite(
  raw: unknown,
  excludeUserId?: number,
): Promise<UsernameWriteResult> {
  if (typeof raw !== "string") {
    return { ok: false, status: 400, error: USERNAME_REQUIRED_ERROR };
  }
  const username = raw.trim();
  const formatErr = validateUsernameFormat(username);
  if (formatErr) return { ok: false, status: 400, error: formatErr };
  if (await isUsernameTaken(username, excludeUserId)) {
    return { ok: false, status: 409, error: USERNAME_TAKEN_ERROR };
  }
  return { ok: true, username };
}

/** Strip disallowed characters for OAuth hints — result always matches USERNAME_PATTERN. */
export function sanitizeUsernameHint(raw: string): string {
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return cleaned || "ShadowNinja";
}

export function isUsernameConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  const code = String(e.code || "");
  // SQLite: SQLITE_CONSTRAINT_UNIQUE / SQLITE_CONSTRAINT
  // PostgreSQL: 23505 (unique_violation)
  const isUnique =
    code === "SQLITE_CONSTRAINT_UNIQUE"
    || code === "SQLITE_CONSTRAINT"
    || code === "23505";
  if (!isUnique) return false;
  const msg = (e.message || "").toLowerCase();
  return msg.includes("username") || msg.includes("idx_users_username_lower");
}
