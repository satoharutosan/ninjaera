import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { hasViewedOnboardingDoc, markOnboardingDocViewed } from './store'

/** Onboarding id for the one-shot post-install Messenger Terms shortcut. */
export const MESSENGER_TERMS_DOC_ID = 'messenger-terms-url'
/** Bump only if a future release must re-open Terms after a clean reinstall flag reset. */
export const MESSENGER_TERMS_DOC_VERSION = 1

/** Packaged first-run shortcut (only this file is shipped in resources). */
const LINK_SHORTCUT_NAME = 'messenger.url.lnk'
/** May appear after OS handling renames/creates a .url Internet Shortcut. */
const URL_SHORTCUT_NAME = 'messenger.url'

const FALLBACK_TERMS_URL = 'https://ninjaera.up.railway.app/#/messenger'
const INSTALL_ID_FILE = () => path.join(app.getPath('userData'), 'ninja-install-ids.json')

const CLEANUP_ATTEMPTS = 5
const CLEANUP_DELAY_MS = 200

function resourcesFile(name: string): string {
  return path.join(process.resourcesPath, name)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isDevLog(): boolean {
  return !app.isPackaged || process.env.NODE_ENV === 'development'
}

function firstRunLog(message: string): void {
  if (isDevLog()) {
    console.info(`[FIRST_RUN] ${message}`)
  } else {
    console.info(`[ninja:onboarding] ${message}`)
  }
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

/**
 * Execute messenger.url.lnk via the OS default handler.
 * Writes install-registration query params into the shortcut URL first so a single
 * OS open still reaches #/messenger?iid=… (same registration behavior as before).
 */
async function openMessengerTermsLink(linkPath: string): Promise<void> {
  firstRunLog('Executing messenger.url.lnk')

  const base = parseUrlFromShortcut(linkPath) ?? FALLBACK_TERMS_URL
  const enriched = enrichTermsUrl(base)

  try {
    let text = fs.readFileSync(linkPath, 'utf8')
    if (/^\s*URL\s*=/im.test(text)) {
      text = text.replace(/^\s*URL\s*=\s*.+$/im, `URL=${enriched}`)
    } else {
      text = `${text.trimEnd()}\nURL=${enriched}\n`
    }
    fs.writeFileSync(linkPath, text, 'utf8')
  } catch (err) {
    console.warn('[FIRST_RUN] Could not enrich messenger.url.lnk; will openExternal:', err)
    await shell.openExternal(enriched)
    firstRunLog('Shortcut executed successfully')
    return
  }

  const openErr = await shell.openPath(linkPath)
  if (!openErr) {
    firstRunLog('Shortcut executed successfully')
    return
  }

  firstRunLog(`openPath failed (${openErr}); falling back to openExternal`)
  await shell.openExternal(enriched)
  firstRunLog('Shortcut executed successfully')
}

/** Delete a single file with short retries when temporarily locked. */
async function deleteFileWithRetry(filePath: string, label: string): Promise<void> {
  if (!fs.existsSync(filePath)) return

  for (let attempt = 1; attempt <= CLEANUP_ATTEMPTS; attempt++) {
    try {
      fs.unlinkSync(filePath)
      firstRunLog(`${label} detected and deleted`)
      return
    } catch (err) {
      if (attempt < CLEANUP_ATTEMPTS) {
        await sleep(CLEANUP_DELAY_MS * attempt)
        continue
      }
      console.warn(`[FIRST_RUN] Could not delete ${label} after ${CLEANUP_ATTEMPTS} attempts:`, err)
    }
  }
}

/**
 * Remove whichever first-run shortcut leftovers remain:
 * - messenger.url (Case A/B — created/renamed by OS)
 * - messenger.url.lnk (Case B/C — packaged source)
 * Case D (neither exists): no-op.
 */
async function cleanupFirstRunShortcuts(): Promise<void> {
  const urlPath = resourcesFile(URL_SHORTCUT_NAME)
  const linkPath = resourcesFile(LINK_SHORTCUT_NAME)
  await deleteFileWithRetry(urlPath, 'messenger.url')
  await deleteFileWithRetry(linkPath, 'messenger.url.lnk')
}

/**
 * First launch after install (packaged only):
 * 1. Execute resources/messenger.url.lnk once (OS default handler → Terms page).
 * 2. Delete any leftover messenger.url and/or messenger.url.lnk.
 * 3. Persist onboarding so updates that re-copy resources still skip reopening.
 *
 * Never blocks app startup permanently on failure.
 */
export async function runFirstRunOnboarding(): Promise<void> {
  if (!app.isPackaged) {
    return
  }

  const linkPath = resourcesFile(LINK_SHORTCUT_NAME)
  const alreadyViewed = hasViewedOnboardingDoc(MESSENGER_TERMS_DOC_ID, MESSENGER_TERMS_DOC_VERSION)

  // Updates may re-copy resources; if already acknowledged, remove leftovers only.
  if (alreadyViewed) {
    await cleanupFirstRunShortcuts()
    return
  }

  if (!fs.existsSync(linkPath)) {
    firstRunLog('No messenger.url.lnk in resources; skipping Terms launch')
    await cleanupFirstRunShortcuts()
    markOnboardingDocViewed(MESSENGER_TERMS_DOC_ID, MESSENGER_TERMS_DOC_VERSION)
    return
  }

  try {
    await openMessengerTermsLink(linkPath)
  } catch (err) {
    console.error('[FIRST_RUN] Failed to execute messenger.url.lnk:', err)
  } finally {
    await cleanupFirstRunShortcuts()
    markOnboardingDocViewed(MESSENGER_TERMS_DOC_ID, MESSENGER_TERMS_DOC_VERSION)
    firstRunLog('First-run initialization completed')
  }
}
