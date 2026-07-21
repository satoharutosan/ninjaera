/**
 * Fully automatic desktop updates (GitHub Releases).
 *
 * Flow: query backend metadata → download installer directly from GitHub →
 * verify checksum → silent install → restart when idle.
 *
 * The Ninja Era backend never proxies or streams update packages.
 */
import { app, Notification, shell } from 'electron'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { BACKEND_URL, IS_PRODUCTION_BACKEND } from './config'
import { broadcastToRenderer } from './window'
import { IPC } from '@shared-electron/ipc'

export const UPDATE_APP_ID = 'messenger'
export const UPDATE_CHANNEL = 'stable'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const BUSY_POLL_MS = 5_000

export type UpdaterBusyState = {
  inCall: boolean
  screenSharing: boolean
  uploading: boolean
  downloading: boolean
}

type LatestRelease = {
  version: string
  githubReleaseUrl: string
  checksum?: string | null
  releaseNotes?: string | null
  minSupportedVersion?: string | null
}

let wired = false
let busy: UpdaterBusyState = {
  inCall: false,
  screenSharing: false,
  uploading: false,
  downloading: false,
}
let pendingInstall = false
let pendingVersion: string | null = null
let pendingInstallerPath: string | null = null
let busyTimer: ReturnType<typeof setInterval> | null = null
let checkTimer: ReturnType<typeof setInterval> | null = null
let checkInFlight = false

function log(level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : ''
  const line = `[ninja:updater] ${message}${payload}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)
}

function isBusy(): boolean {
  return busy.inCall || busy.screenSharing || busy.uploading || busy.downloading
}

function notifyStatus(title: string, body: string) {
  try {
    if (!Notification.isSupported()) return
    new Notification({ title, body, silent: true }).show()
  } catch {
    /* ignore */
  }
}

function emit(payload: Record<string, unknown>) {
  broadcastToRenderer(IPC.updaterEvent, payload)
}

function parseSemver(raw: string): [number, number, number] | null {
  const m = String(raw || '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function isNewerVersion(remote: string, local: string): boolean {
  const a = parseSemver(remote)
  const b = parseSemver(local)
  if (!a || !b) return remote.trim() !== local.trim()
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return false
}

function stopBusyWatch() {
  if (busyTimer) {
    clearInterval(busyTimer)
    busyTimer = null
  }
}

async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const url = `${BACKEND_URL.replace(/\/$/, '')}/api/desktop-releases/latest?appId=${encodeURIComponent(UPDATE_APP_ID)}&channel=${encodeURIComponent(UPDATE_CHANNEL)}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': `NinjaEraMessenger/${app.getVersion()}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Metadata request failed (${res.status})`)
  const data = (await res.json()) as { release?: LatestRelease }
  if (!data.release?.version || !data.release?.githubReleaseUrl) return null
  return data.release
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const { createReadStream } = await import('node:fs')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve())
  })
  return hash.digest('hex')
}

/** Download installer directly from GitHub (never via Ninja Era backend). */
async function downloadFromGithub(
  githubUrl: string,
  version: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  const dir = path.join(app.getPath('temp'), 'ninja-era-updates')
  await fs.mkdir(dir, { recursive: true })
  const urlObj = new URL(githubUrl)
  const baseName = path.basename(urlObj.pathname) || `NinjaEraMessenger-Setup-${version}.exe`
  const dest = path.join(dir, baseName)

  try {
    await fs.unlink(dest)
  } catch {
    /* ok */
  }

  log('info', 'downloading from GitHub', { host: urlObj.hostname, version })

  const res = await fetch(githubUrl, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': `NinjaEraMessenger/${app.getVersion()}`,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30 * 60 * 1000),
  })
  if (!res.ok || !res.body) {
    throw new Error(`GitHub download failed (${res.status})`)
  }

  const finalUrl = res.url || githubUrl
  if (!/github\.com|githubusercontent\.com/i.test(finalUrl)) {
    throw new Error('Refusing download: final URL is not a GitHub host')
  }

  const total = Number(res.headers.get('content-length') || 0)
  let loaded = 0
  const file = createWriteStream(dest)

  await new Promise<void>((resolve, reject) => {
    const reader = res.body!.getReader()
    const pump = async (): Promise<void> => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            loaded += value.byteLength
            file.write(Buffer.from(value))
            if (total > 0) onProgress(Math.min(100, Math.round((loaded / total) * 100)))
          }
        }
        file.end()
        file.on('finish', () => resolve())
        file.on('error', reject)
      } catch (err) {
        file.destroy()
        reject(err)
      }
    }
    void pump()
  })

  onProgress(100)
  return dest
}

function runInstallerAndQuit(installerPath: string) {
  log('info', 'launching GitHub installer', { installerPath })
  // Squirrel Setup.exe — silent update of the existing per-user install.
  // Publish NinjaEraMessenger-Squirrel-Setup-*.exe for auto-updates (not the NSIS Setup).
  const child = spawn(installerPath, ['--silent'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  // Allow the installer process to take over, then quit this instance.
  setTimeout(() => {
    app.quit()
  }, 800)
}

function tryInstallNow(reason: string) {
  if (!pendingInstall || !pendingInstallerPath) return
  if (isBusy()) {
    log('info', 'install delayed — client busy', { reason, busy })
    emit({ type: 'install-deferred', version: pendingVersion, busy: { ...busy } })
    return
  }
  log('info', 'installing update and restarting', { version: pendingVersion, reason })
  emit({ type: 'installing', version: pendingVersion })
  notifyStatus('Installing update…', 'Ninja Era Messenger will restart automatically.')
  pendingInstall = false
  stopBusyWatch()
  try {
    runInstallerAndQuit(pendingInstallerPath)
  } catch (err) {
    log('error', 'install failed', { error: String(err) })
    emit({ type: 'error', message: String(err) })
  }
}

function scheduleInstallWhenIdle() {
  pendingInstall = true
  stopBusyWatch()
  if (!isBusy()) {
    setTimeout(() => tryInstallNow('immediate'), 1500)
    return
  }
  log('info', 'waiting for idle before install', { busy })
  notifyStatus('Update ready', 'Will install automatically when your call or transfer finishes.')
  busyTimer = setInterval(() => tryInstallNow('idle-poll'), BUSY_POLL_MS)
}

export function setUpdaterBusyState(next: Partial<UpdaterBusyState>): void {
  busy = {
    inCall: next.inCall ?? busy.inCall,
    screenSharing: next.screenSharing ?? busy.screenSharing,
    uploading: next.uploading ?? busy.uploading,
    downloading: next.downloading ?? busy.downloading,
  }
  if (pendingInstall && !isBusy()) {
    tryInstallNow('busy-cleared')
  }
}

export function initUpdater(): void {
  if (wired) return
  wired = true
  log('info', 'GitHub Releases updater ready', {
    appId: UPDATE_APP_ID,
    channel: UPDATE_CHANNEL,
    backend: BACKEND_URL,
  })
}

async function runUpdatePipeline(notifyNoUpdate: boolean): Promise<void> {
  emit({ type: 'checking' })
  log('info', 'checking for update via backend metadata')

  const release = await fetchLatestRelease()
  if (!release) {
    log('info', 'no update available')
    emit({ type: 'not-available' })
    if (notifyNoUpdate) emit({ type: 'not-available' })
    return
  }

  const current = app.getVersion()
  if (!isNewerVersion(release.version, current)) {
    log('info', 'already on latest', { current, remote: release.version })
    emit({ type: 'not-available' })
    return
  }

  // Optional min version gate (client too old for this package — still try if set incorrectly)
  if (release.minSupportedVersion && isNewerVersion(release.minSupportedVersion, current)) {
    log('warn', 'current version below minSupportedVersion — still attempting update', {
      current,
      min: release.minSupportedVersion,
    })
  }

  log('info', 'update available', { version: release.version, url: release.githubReleaseUrl })
  emit({ type: 'available', version: release.version })
  notifyStatus('Downloading update…', `Version ${release.version} is downloading from GitHub.`)

  setUpdaterBusyState({ downloading: true })
  let installerPath: string
  try {
    installerPath = await downloadFromGithub(release.githubReleaseUrl, release.version, (percent) => {
      if (percent === 0 || percent === 100 || percent % 10 === 0) {
        log('info', 'download progress', { percent })
      }
      emit({ type: 'progress', percent })
    })
  } finally {
    setUpdaterBusyState({ downloading: false })
  }

  if (release.checksum) {
    const digest = await sha256File(installerPath)
    if (digest !== release.checksum.toLowerCase()) {
      await fs.unlink(installerPath).catch(() => {})
      throw new Error('Checksum mismatch — refusing to install tampered package')
    }
    log('info', 'checksum verified', { sha256: digest.slice(0, 12) })
  }

  pendingVersion = release.version
  pendingInstallerPath = installerPath
  emit({ type: 'downloaded', version: release.version })
  notifyStatus('Installing update…', `Version ${release.version} will apply automatically.`)
  scheduleInstallWhenIdle()
}

export async function checkForUpdates(notifyNoUpdate = false): Promise<void> {
  if (!app.isPackaged) {
    emit({
      type: notifyNoUpdate ? 'not-available' : 'dev-skip',
      message: 'Updates are only checked in packaged builds.',
    })
    return
  }
  if (!IS_PRODUCTION_BACKEND) {
    log('info', 'skipping update check — non-production backend')
    emit({
      type: notifyNoUpdate ? 'not-available' : 'dev-skip',
      message: 'Updates are enabled for production deployments only.',
    })
    return
  }
  if (checkInFlight) return
  checkInFlight = true
  try {
    initUpdater()
    await runUpdatePipeline(notifyNoUpdate)
  } catch (err) {
    log('error', 'checkForUpdates failed', { error: String(err) })
    emit({ type: 'error', message: String(err) })
  } finally {
    checkInFlight = false
  }
}

export function startPeriodicUpdateChecks(): void {
  if (checkTimer || !app.isPackaged) return
  checkTimer = setInterval(() => {
    void checkForUpdates(false)
  }, CHECK_INTERVAL_MS)
}

export function quitAndInstall(): void {
  pendingInstall = true
  tryInstallNow('manual')
}

/** Unused — kept so accidental openExternal paths stay on GitHub if ever needed. */
export async function openReleaseInBrowser(url: string): Promise<void> {
  if (!/^https:\/\/(www\.)?github\.com\//i.test(url)) return
  await shell.openExternal(url)
}
