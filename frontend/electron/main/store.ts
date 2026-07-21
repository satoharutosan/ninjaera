/**
 * Dependency-free persistence for the main process:
 *  - session: JWT + cached user, encrypted with OS-backed safeStorage when available
 *  - settings: desktop settings JSON
 *  - queue: offline action queue JSON
 */
import { app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import { defaultSettings, mergeSettings, type DesktopSettings } from '@shared-electron/settings'

const userDataDir = () => app.getPath('userData')
const SESSION_FILE = () => path.join(userDataDir(), 'ninja-session.bin')
const USER_FILE = () => path.join(userDataDir(), 'ninja-user.json')
const SETTINGS_FILE = () => path.join(userDataDir(), 'ninja-settings.json')
const QUEUE_FILE = () => path.join(userDataDir(), 'ninja-queue.json')
/** First-run / onboarding docs (Terms, etc.). Survives settings reset; cleared on clean reinstall. */
const ONBOARDING_FILE = () => path.join(userDataDir(), 'ninja-onboarding.json')

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
  } catch {
    /* best-effort */
  }
}

// ── Session (token + user) ────────────────────────────────────────────────────

export type CachedUser = { id: number; username: string; avatarUrl?: string | null; [k: string]: unknown }

let cachedToken: string | null | undefined
let cachedUser: CachedUser | null | undefined

export function getToken(): string | null {
  if (cachedToken !== undefined) return cachedToken
  try {
    const file = SESSION_FILE()
    if (!fs.existsSync(file)) {
      cachedToken = null
      return null
    }
    const raw = fs.readFileSync(file)
    if (safeStorage.isEncryptionAvailable()) {
      cachedToken = safeStorage.decryptString(raw)
    } else {
      // Fallback: file stored a plain "raw:" prefixed token when encryption is unavailable.
      const text = raw.toString('utf8')
      cachedToken = text.startsWith('raw:') ? text.slice(4) : null
    }
  } catch {
    cachedToken = null
  }
  return cachedToken ?? null
}

export function setSession(token: string | null, user: CachedUser | null): void {
  cachedToken = token
  cachedUser = user
  try {
    if (!token) {
      if (fs.existsSync(SESSION_FILE())) fs.rmSync(SESSION_FILE())
      if (fs.existsSync(USER_FILE())) fs.rmSync(USER_FILE())
      return
    }
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(token)
      : Buffer.from(`raw:${token}`, 'utf8')
    fs.mkdirSync(userDataDir(), { recursive: true })
    fs.writeFileSync(SESSION_FILE(), data)
    if (user) writeJson(USER_FILE(), user)
  } catch {
    /* best-effort */
  }
}

export function getUser(): CachedUser | null {
  if (cachedUser !== undefined) return cachedUser
  cachedUser = readJson<CachedUser | null>(USER_FILE(), null)
  return cachedUser
}

export function clearSession(): void {
  setSession(null, null)
}

// ── Settings ──────────────────────────────────────────────────────────────────

let settingsCache: DesktopSettings | null = null

export function getSettings(): DesktopSettings {
  if (settingsCache) return settingsCache
  const base = defaultSettings(app.getPath('downloads'))
  const persisted = readJson<Partial<DesktopSettings>>(SETTINGS_FILE(), {})
  settingsCache = mergeSettings(base, persisted)
  return settingsCache
}

export function saveSettings(patch: Partial<DesktopSettings> | Record<string, unknown>): DesktopSettings {
  const merged = mergeSettings(getSettings(), patch as Partial<DesktopSettings>)
  settingsCache = merged
  writeJson(SETTINGS_FILE(), merged)
  return merged
}

export function resetSettings(): DesktopSettings {
  const fresh = defaultSettings(app.getPath('downloads'))
  settingsCache = fresh
  writeJson(SETTINGS_FILE(), fresh)
  return fresh
}

// ── Offline queue persistence ─────────────────────────────────────────────────

export function readQueue<T>(): T[] {
  return readJson<T[]>(QUEUE_FILE(), [])
}

export function writeQueue<T>(items: T[]): void {
  writeJson(QUEUE_FILE(), items)
}

// ── Onboarding / first-run documents ──────────────────────────────────────────
// Separate from settings so "Reset settings" does not re-prompt Terms after updates.
// Cleared when userData is removed (clean reinstall).

export type OnboardingDocRecord = {
  /** Document content version last acknowledged/viewed. */
  version: number
  viewedAt: string
}

export type OnboardingState = {
  /** Map of document id → last viewed version metadata. */
  viewed: Record<string, OnboardingDocRecord>
}

let onboardingCache: OnboardingState | null = null

export function getOnboardingState(): OnboardingState {
  if (onboardingCache) return onboardingCache
  const persisted = readJson<Partial<OnboardingState>>(ONBOARDING_FILE(), {})
  onboardingCache = {
    viewed:
      persisted.viewed && typeof persisted.viewed === 'object' && !Array.isArray(persisted.viewed)
        ? persisted.viewed
        : {},
  }
  return onboardingCache
}

export function markOnboardingDocViewed(docId: string, version: number): OnboardingState {
  const state = getOnboardingState()
  state.viewed[docId] = { version, viewedAt: new Date().toISOString() }
  onboardingCache = state
  writeJson(ONBOARDING_FILE(), state)
  return state
}

/** True when this document id has already been viewed at the given (or any) version. */
export function hasViewedOnboardingDoc(docId: string, version?: number): boolean {
  const record = getOnboardingState().viewed[docId]
  if (!record) return false
  if (version === undefined) return true
  return record.version >= version
}
