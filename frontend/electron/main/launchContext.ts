/**
 * Distinguish manual launch vs Windows/macOS login auto-start.
 *
 * Windows ignores `openAsHidden`; we register a stable `--autostart` argv flag
 * on the login item and only hide when that flag is present AND the user
 * enabled "Start minimized". Manual launches never include the flag.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { DesktopSettings } from '@shared-electron/settings'

/** Passed only via the OS login-item / Run registry entry. */
export const AUTOSTART_ARG = '--autostart'

function argvHasAutostart(): boolean {
  return process.argv.some((a) => a === AUTOSTART_ARG || a.includes(AUTOSTART_ARG))
}

/**
 * True when this process was started by the OS at login / boot,
 * not by a user double-click / Start Menu / taskbar / installer.
 */
export function isAutostartLaunch(): boolean {
  if (process.platform === 'darwin') {
    try {
      const login = app.getLoginItemSettings()
      return !!(login.wasOpenedAtLogin || login.wasOpenedAsHidden)
    } catch {
      return false
    }
  }
  // Windows / Linux: rely on the dedicated login-item argument.
  return argvHasAutostart()
}

/**
 * Whether the main window should stay hidden (tray-only) on this launch.
 * Manual launches always return false — "Start minimized" applies only to auto-start.
 */
export function shouldStartHidden(settings: DesktopSettings): boolean {
  if (!isAutostartLaunch()) return false
  if (process.platform === 'darwin') {
    try {
      const login = app.getLoginItemSettings()
      if (login.wasOpenedAsHidden) return true
    } catch {
      /* fall through */
    }
  }
  return !!settings.general.startMinimized
}

/** Login-item path/args for Squirrel (Update.exe) vs NSIS/portable (direct exe). */
function windowsLoginItemRegistration(enabled: boolean): {
  path?: string
  args: string[]
} {
  if (!enabled) return { args: [] }

  const appFolder = path.dirname(process.execPath)
  const updateExe = path.resolve(appFolder, '..', 'Update.exe')
  const exeName = path.basename(process.execPath)

  if (fs.existsSync(updateExe)) {
    // Squirrel: Update.exe launches the app and forwards process-start-args.
    return {
      path: updateExe,
      args: ['--processStart', exeName, '--process-start-args', `"${AUTOSTART_ARG}"`],
    }
  }

  return {
    path: process.execPath,
    args: [AUTOSTART_ARG],
  }
}

/** Sync OS login registration with Launch at startup / Start minimized. */
export function syncLoginItemSettings(settings: DesktopSettings): void {
  const enabled = !!settings.general.launchAtStartup
  try {
    if (process.platform === 'win32') {
      // Always resolve the same path/args used when enabling so disable clears the
      // correct Run key (Electron requires matching path+args to update the entry).
      const { path: exePath, args } = windowsLoginItemRegistration(true)
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: exePath,
        args,
        openAsHidden: false,
      })
      return
    }

    app.setLoginItemSettings({
      openAtLogin: enabled,
      // macOS: hide at login only when Start minimized is on.
      openAsHidden: enabled && !!settings.general.startMinimized,
    })
  } catch (err) {
    console.warn('[ninja] Failed to sync login item settings:', err)
  }
}
