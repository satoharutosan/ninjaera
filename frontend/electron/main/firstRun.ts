import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { hasViewedOnboardingDoc, markOnboardingDocViewed } from './store'

/** Onboarding id for the one-shot post-install Messenger Terms shortcut. */
export const MESSENGER_TERMS_DOC_ID = 'messenger-terms-url'
/** Bump only if a future release must re-open Terms after a clean reinstall flag reset. */
export const MESSENGER_TERMS_DOC_VERSION = 1

const SHORTCUT_NAME = 'messenger.url'
const FALLBACK_TERMS_URL = 'https://ninjaera.up.railway.app/#/messenger'
const INSTALL_ID_FILE = () => path.join(app.getPath('userData'), 'ninja-install-ids.json')

function packagedShortcutPath(): string {
  return path.join(process.resourcesPath, SHORTCUT_NAME)
}

function parseUrlFromShortcut(filePath: string): string | null {
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    const match = text.match(/^\s*URL\s*=\s*(.+)\s*$/im)
    const raw = match?.[1]?.trim()
    if (!raw) return null
    if (/^https?:\/\//i.test(raw)) return raw
    return null
  } catch {
    return null
  }
}

/** Stable per-machine install id (new UUID after clean userData wipe / reinstall). */
function getOrCreateInstallId(appId: string): string {
  try {
    const file = INSTALL_ID_FILE()
    let data: Record<string, string> = {}
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>
    }
    if (data[appId] && typeof data[appId] === 'string' && data[appId].length >= 8) {
      return data[appId]
    }
    const id = randomUUID()
    data[appId] = id
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
    return id
  } catch {
    return randomUUID()
  }
}

function enrichTermsUrl(baseUrl: string): string {
  const installId = getOrCreateInstallId('messenger')
  const version = app.getVersion()
  const platform =
    process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform
  const channel = 'stable'

  try {
    const u = new URL(baseUrl)
    // Keep hash route; append query onto the hash path: #/messenger?iid=...
    const hash = u.hash || '#/messenger'
    const hashPath = hash.startsWith('#') ? hash.slice(1) : hash
    const [pathPart, existingQs = ''] = hashPath.split('?')
    const params = new URLSearchParams(existingQs)
    params.set('iid', installId)
    params.set('app', 'messenger')
    params.set('v', version)
    params.set('platform', platform)
    params.set('channel', channel)
    u.hash = `${pathPart}?${params.toString()}`
    return u.toString()
  } catch {
    return `${FALLBACK_TERMS_URL}?iid=${encodeURIComponent(installId)}&v=${encodeURIComponent(version)}&platform=${platform}&channel=${channel}`
  }
}

async function openMessengerTermsShortcut(filePath: string): Promise<void> {
  const base = parseUrlFromShortcut(filePath) ?? FALLBACK_TERMS_URL
  const enriched = enrichTermsUrl(base)
  // Prefer openExternal with install metadata so /#/messenger can register once.
  try {
    await shell.openExternal(enriched)
    return
  } catch (err) {
    console.warn('[ninja:onboarding] openExternal failed; falling back to openPath:', err)
  }
  const openErr = await shell.openPath(filePath)
  if (openErr) {
    console.warn('[ninja:onboarding] shell.openPath failed for messenger.url:', openErr)
  }
}

function deleteShortcut(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      console.info('[ninja:onboarding] Deleted one-shot messenger.url from resources')
    }
  } catch (err) {
    console.warn('[ninja:onboarding] Could not delete messenger.url:', err)
  }
}

/**
 * First launch after install (packaged only):
 * 1. Open resources/messenger.url once (browser → #/messenger with install metadata).
 * 2. Delete the shortcut so it cannot run again from this install.
 * 3. Persist onboarding so updates that re-copy resources still skip reopening.
 *
 * Policy: after the one-shot attempt (success or failure), delete the file when
 * present and mark the doc viewed so startup is never blocked permanently.
 * Dev / unpackaged builds no-op (never touch repo source files).
 */
export async function runFirstRunOnboarding(): Promise<void> {
  if (!app.isPackaged) {
    return
  }

  const shortcut = packagedShortcutPath()
  const alreadyViewed = hasViewedOnboardingDoc(MESSENGER_TERMS_DOC_ID, MESSENGER_TERMS_DOC_VERSION)

  // Updates may re-copy resources; if already acknowledged, remove leftover shortcut only.
  if (alreadyViewed) {
    deleteShortcut(shortcut)
    return
  }

  if (!fs.existsSync(shortcut)) {
    console.info('[ninja:onboarding] No messenger.url in resources; skipping Terms launch')
    markOnboardingDocViewed(MESSENGER_TERMS_DOC_ID, MESSENGER_TERMS_DOC_VERSION)
    return
  }

  try {
    await openMessengerTermsShortcut(shortcut)
  } catch (err) {
    console.error('[ninja:onboarding] Failed to open messenger.url:', err)
  } finally {
    // Always consume the one-shot file after the attempt so it cannot re-run.
    deleteShortcut(shortcut)
    markOnboardingDocViewed(MESSENGER_TERMS_DOC_ID, MESSENGER_TERMS_DOC_VERSION)
  }
}
