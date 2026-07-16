/** Mirrors backend username rules for client-side UX. Backend remains authoritative. */

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

export function validateUsernameFormat(username: string): string | null {
  const value = username.trim();
  if (!value) return USERNAME_REQUIRED_ERROR;
  if (value.length > MAX_USERNAME_LENGTH) {
    return `Username must be at most ${MAX_USERNAME_LENGTH} characters.`;
  }
  if (!USERNAME_PATTERN.test(value)) return USERNAME_FORMAT_ERROR;
  return null;
}

/** Returns trimmed username on success, or an error message. */
export function validateUsernameClient(raw: string): { ok: true; username: string } | { ok: false; error: string } {
  const username = raw.trim();
  const err = validateUsernameFormat(username);
  if (err) return { ok: false, error: err };
  return { ok: true, username };
}
