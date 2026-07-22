/**
 * Fully automatic desktop updates (GitHub Releases).
 *
 * Flow: query backend metadata → download installer directly from GitHub →
 * verify checksum → silent install → restart when idle.
 *
 * Background schedule: one startup check (non-blocking) + hourly checks.
 * Single scheduler instance; survives tray hide, sleep/resume, and network blips.
 * The Ninja Era backend never proxies or streams update packages.
 */
import { app, Notification, shell, powerMonitor } from 'electron'
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

/** Hourly background checks after the startup pass. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000
/** Let window/tray/auth/sockets settle before the first check. */
const STARTUP_CHECK_DELAY_MS = 8_000
const BUSY_POLL_MS = 5_000
/** Ignore overlapping resume ticks within this window of a completed check. */
const MIN_CHECK_GAP_MS = 30_000

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
let schedulerStarted = false
let powerMonitorWired = false
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
let startupTimer: ReturnType<typeof setTimeout> | null = null
let checkInFlight = false
let lastCheckFinishedAt = 0

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

function classifyUpdateError(err: unknown): { kind: string; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (/abort|timeout|timed out/i.test(message)) return { kind: 'timeout', message }
  if (/enotfound|getaddrinfo|dns/i.test(lower)) return { kind: 'dns', message }
  if (/network|fetch failed|econnreset|econnrefused|socket/i.test(lower)) {
    return { kind: 'network', message }
  }
  if (/github/i.test(lower)) return { kind: 'github', message }
  if (/checksum|tamper/i.test(lower)) return { kind: 'checksum', message }
  if (/metadata|manifest|json/i.test(lower)) return { kind: 'manifest', message }
  if (/enospc|space/i.test(lower)) return { kind: 'disk', message }
  if (/eacces|eperm|permission/i.test(lower)) return { kind: 'permission', message }
  return { kind: 'unknown', message }
}

function stopBusyWatch() {
  if (busyTimer) {
    clearInterval(busyTimer)
    busyTimer = null
  }
}

async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const url = `${BACKEND_URL.replace(/\/$/, '')}/api/desktop-releases/latest?appId=${encodeURIComponent(UPDATE_APP_ID)}&channel=${encodeURIComponent(UPDATE_CHANNEL)}`
  log('info', 'Update server contacted', { url: url.replace(/\?.*/, '?…') })
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': `NinjaEraMessenger/${app.getVersion()}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Metadata request failed (${res.status})`)
  let data: { release?: LatestRelease }
  try {
    data = (await res.json()) as { release?: LatestRelease }
  } catch {
    throw new Error('Version manifest invalid (JSON parse failed)')
  }
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

  log('info', 'Downloading update', { host: urlObj.hostname, version })

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

  try {
    await new Promise<void>((resolve, reject) => {
      const reader = res.body!.getReader()
      const pump = async (): Promise<void> => {
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
              loaded += value.byteLength
              const ok = file.write(Buffer.from(value))
              if (!ok) {
                await new Promise<void>((r) => file.once('drain', r))
              }
              if (total > 0) onProgress(Math.min(100, Math.round((loaded / total) * 100)))
            }
          }
          file.once('finish', () => resolve())
          file.once('error', reject)
          file.end()
        } catch (err) {
          file.destroy()
          reject(err)
        }
      }
      void pump()
    })
  } catch (err) {
    await fs.unlink(dest).catch(() => {})
    throw err
  }

  onProgress(100)
  log('info', 'Download completed', { bytes: loaded, path: dest })
  return dest
}

function runInstallerAndQuit(installerPath: string) {
  log('info', 'Installing update — Restarting application', { installerPath })
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
  log('info', 'Installing update and restarting', { version: pendingVersion, reason })
  emit({ type: 'installing', version: pendingVersion })
  notifyStatus('Installing update…', 'Ninja Era Messenger will restart automatically.')
  pendingInstall = false
  stopBusyWatch()
  try {
    runInstallerAndQuit(pendingInstallerPath)
  } catch (err) {
    const classified = classifyUpdateError(err)
    log('error', 'install failed', classified)
    emit({ type: 'error', message: classified.message })
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
  log('info', 'Desktop updater ready', {
    appId: UPDATE_APP_ID,
    channel: UPDATE_CHANNEL,
    backend: BACKEND_URL,
    version: app.getVersion(),
    packaged: app.isPackaged,
  })
}

async function runUpdatePipeline(notifyNoUpdate: boolean, reason: string): Promise<void> {
  emit({ type: 'checking' })
  const current = app.getVersion()
  log('info', 'Checking current version', { current, reason })

  const release = await fetchLatestRelease()
  if (!release) {
    log('info', 'No update available')
    emit({ type: 'not-available' })
    return
  }

  log('info', 'Latest version', { current, latest: release.version })

  if (!isNewerVersion(release.version, current)) {
    log('info', 'No update available', { current, remote: release.version })
    emit({ type: 'not-available' })
    return
  }

  if (release.minSupportedVersion && isNewerVersion(release.minSupportedVersion, current)) {
    log('warn', 'current version below minSupportedVersion — still attempting update', {
      current,
      min: release.minSupportedVersion,
    })
  }

  log('info', 'Update found', { version: release.version, url: release.githubReleaseUrl })
  emit({ type: 'available', version: release.version })
  notifyStatus('Downloading update…', `Version ${release.version} is downloading from GitHub.`)

  setUpdaterBusyState({ downloading: true })
  let installerPath: string
  try {
    installerPath = await downloadFromGithub(release.githubReleaseUrl, release.version, (percent) => {
      if (percent === 0 || percent === 100 || percent % 25 === 0) {
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

/**
 * Silent / manual update check. Safe to call repeatedly; overlaps are skipped.
 * Failures never disable future scheduled checks.
 */
export async function checkForUpdates(notifyNoUpdate = false, reason = 'manual'): Promise<void> {
  if (!app.isPackaged) {
    log('info', 'Update check skipped — unpackaged build', { reason })
    emit({
      type: notifyNoUpdate ? 'not-available' : 'dev-skip',
      message: 'Updates are only checked in packaged builds.',
    })
    return
  }
  if (!IS_PRODUCTION_BACKEND) {
    log('info', 'Update check skipped — non-production backend', { reason })
    emit({
      type: notifyNoUpdate ? 'not-available' : 'dev-skip',
      message: 'Updates are enabled for production deployments only.',
    })
    return
  }
  if (checkInFlight) {
    log('info', 'Update check already in flight — skipping', { reason })
    return
  }
  checkInFlight = true
  try {
    initUpdater()
    await runUpdatePipeline(notifyNoUpdate, reason)
  } catch (err) {
    const classified = classifyUpdateError(err)
    if (classified.kind === 'github') log('error', 'GitHub unavailable', classified)
    else if (classified.kind === 'timeout') log('error', 'Connection timeout', classified)
    else if (classified.kind === 'network' || classified.kind === 'dns') {
      log('warn', 'Network unavailable — will retry on next schedule', classified)
    } else if (classified.kind === 'manifest') log('error', 'Version manifest invalid', classified)
    else log('error', 'Update check failed', classified)
    emit({ type: 'error', message: classified.message })
    // Do not disable the scheduler — next hourly / resume tick retries.
  } finally {
    checkInFlight = false
    lastCheckFinishedAt = Date.now()
  }
}

function runScheduledCheck(reason: 'startup' | 'hourly' | 'resume'): void {
  if (reason === 'hourly') log('info', 'Hourly update check started')
  else if (reason === 'startup') log('info', 'Startup update check started')
  else log('info', 'Scheduler resumed — update check started')

  // Resume can fire close to an interval tick; avoid hammering the network.
  if (reason === 'resume' && lastCheckFinishedAt && Date.now() - lastCheckFinishedAt < MIN_CHECK_GAP_MS) {
    log('info', 'Resume check skipped — recent check', {
      agoMs: Date.now() - lastCheckFinishedAt,
    })
    return
  }

  void checkForUpdates(false, reason)
}

function wirePowerMonitor(): void {
  if (powerMonitorWired) return
  powerMonitorWired = true
  try {
    powerMonitor.on('resume', () => {
      log('info', 'Scheduler resumed after sleep/wake')
      const due =
        !lastCheckFinishedAt || Date.now() - lastCheckFinishedAt >= CHECK_INTERVAL_MS
      if (due) runScheduledCheck('resume')
      else log('info', 'Post-resume hourly check not yet due')
    })
  } catch (err) {
    log('warn', 'powerMonitor resume hook unavailable', { error: String(err) })
  }
}

/**
 * Single background scheduler: delayed startup check + hourly interval.
 * Idempotent — window/tray/socket/login churn must not create extra timers.
 */
export function startBackgroundUpdateScheduler(): void {
  if (schedulerStarted) {
    log('info', 'Update scheduler already running — not duplicating')
    return
  }
  schedulerStarted = true
  initUpdater()

  if (!app.isPackaged) {
    log('info', 'Update scheduler idle — unpackaged build')
    return
  }
  if (!IS_PRODUCTION_BACKEND) {
    log('info', 'Update scheduler idle — non-production backend')
    return
  }

  log('info', 'Update scheduler armed', {
    startupDelayMs: STARTUP_CHECK_DELAY_MS,
    intervalMs: CHECK_INTERVAL_MS,
  })

  wirePowerMonitor()

  if (!startupTimer) {
    startupTimer = setTimeout(() => {
      startupTimer = null
      runScheduledCheck('startup')
    }, STARTUP_CHECK_DELAY_MS)
    // Do not keep the process alive solely for the startup delay.
    startupTimer.unref?.()
  }

  if (!checkTimer) {
    checkTimer = setInterval(() => {
      runScheduledCheck('hourly')
    }, CHECK_INTERVAL_MS)
    // Interval must keep the process alive while tray-resident — do not unref.
  }
}

/** @deprecated Use startBackgroundUpdateScheduler — kept for call-site compatibility. */
export function startPeriodicUpdateChecks(): void {
  startBackgroundUpdateScheduler()
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
