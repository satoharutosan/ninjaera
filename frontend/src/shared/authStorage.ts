/** Auth credential storage — localStorage (Stay signed in) vs sessionStorage (browser session only). */

export const AUTH_TOKEN_KEY = "ninja-era-token";
export const AUTH_USER_KEY = "ninja-era-user";
/** "1" = survive browser restart; "0" = current browser session only */
export const AUTH_PERSIST_KEY = "ninja-era-auth-persist";
export const REMEMBERED_EMAIL_KEY = "ninja-era-remembered-email";

export type CachedAuthUser = {
  id: number;
  username: string;
  email?: string;
  avatarUrl?: string | null;
  [key: string]: unknown;
};

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch { /* private mode */ }
}

function lsRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch { /* private mode */ }
}

function ssGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function ssSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch { /* private mode */ }
}

function ssRemove(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch { /* private mode */ }
}

export function isAuthPersistent(): boolean {
  const v = lsGet(AUTH_PERSIST_KEY);
  if (v == null) return true;
  return v === "1";
}

export function setAuthPersistent(persist: boolean) {
  lsSet(AUTH_PERSIST_KEY, persist ? "1" : "0");
}

function readTokenFromStores(): string | null {
  if (isAuthPersistent()) {
    return lsGet(AUTH_TOKEN_KEY) ?? ssGet(AUTH_TOKEN_KEY);
  }
  return ssGet(AUTH_TOKEN_KEY) ?? lsGet(AUTH_TOKEN_KEY);
}

function readUserRawFromStores(): string | null {
  if (isAuthPersistent()) {
    return lsGet(AUTH_USER_KEY) ?? ssGet(AUTH_USER_KEY);
  }
  return ssGet(AUTH_USER_KEY) ?? lsGet(AUTH_USER_KEY);
}

export function getStoredToken(): string | null {
  return readTokenFromStores();
}

export function getCachedUser(): CachedAuthUser | null {
  try {
    const raw = readUserRawFromStores();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAuthUser;
    if (!parsed || typeof parsed.id !== "number" || !parsed.username) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function persistAuthSession(token: string, user: CachedAuthUser | null, persist: boolean) {
  setAuthPersistent(persist);
  lsRemove(AUTH_TOKEN_KEY);
  lsRemove(AUTH_USER_KEY);
  ssRemove(AUTH_TOKEN_KEY);
  ssRemove(AUTH_USER_KEY);

  if (persist) {
    lsSet(AUTH_TOKEN_KEY, token);
    if (user) lsSet(AUTH_USER_KEY, JSON.stringify(user));
  } else {
    ssSet(AUTH_TOKEN_KEY, token);
    if (user) ssSet(AUTH_USER_KEY, JSON.stringify(user));
  }
}

export function setStoredToken(token: string | null, persist = isAuthPersistent()) {
  if (!token) {
    clearAuthCredentials();
    return;
  }
  persistAuthSession(token, getCachedUser(), persist);
}

export function setCachedUser(user: CachedAuthUser | null) {
  if (!user) {
    lsRemove(AUTH_USER_KEY);
    ssRemove(AUTH_USER_KEY);
    return;
  }
  const raw = JSON.stringify(user);
  if (isAuthPersistent()) {
    lsSet(AUTH_USER_KEY, raw);
    ssRemove(AUTH_USER_KEY);
  } else {
    ssSet(AUTH_USER_KEY, raw);
    lsRemove(AUTH_USER_KEY);
  }
}

/** Clears token + user cache. Keeps Stay-signed-in preference and remembered email. */
export function clearAuthCredentials() {
  lsRemove(AUTH_TOKEN_KEY);
  lsRemove(AUTH_USER_KEY);
  ssRemove(AUTH_TOKEN_KEY);
  ssRemove(AUTH_USER_KEY);
}

/** @deprecated use clearAuthCredentials */
export function clearAuthStorage() {
  clearAuthCredentials();
}

export function getRememberedEmail(): string {
  return lsGet(REMEMBERED_EMAIL_KEY) || "";
}

export function setRememberedEmail(email: string | null) {
  const v = (email || "").trim();
  if (v) lsSet(REMEMBERED_EMAIL_KEY, v);
  else lsRemove(REMEMBERED_EMAIL_KEY);
}
