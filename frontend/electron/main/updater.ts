/**
 * Auto-update scaffold via electron-updater: checks, downloads in the background,
 * and prompts before restarting. Update events are forwarded to the renderer.
 * No-ops in development / unpackaged builds.
 */
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { broadcastToRenderer } from './window'
import { IPC } from '@shared-electron/ipc'

const { autoUpdater } = electronUpdater

let wired = false

export function initUpdater(): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () =>
    broadcastToRenderer(IPC.updaterEvent, { type: 'checking' }),
  )
  autoUpdater.on('update-available', (info) =>
    broadcastToRenderer(IPC.updaterEvent, { type: 'available', version: info.version }),
  )
  autoUpdater.on('update-not-available', () =>
    broadcastToRenderer(IPC.updaterEvent, { type: 'not-available' }),
  )
  autoUpdater.on('download-progress', (p) =>
    broadcastToRenderer(IPC.updaterEvent, { type: 'progress', percent: Math.round(p.percent) }),
  )
  autoUpdater.on('update-downloaded', (info) =>
    broadcastToRenderer(IPC.updaterEvent, { type: 'downloaded', version: info.version }),
  )
  autoUpdater.on('error', (err) =>
    broadcastToRenderer(IPC.updaterEvent, { type: 'error', message: String(err?.message || err) }),
  )
}

export async function checkForUpdates(notifyNoUpdate = false): Promise<void> {
  if (!app.isPackaged) {
    broadcastToRenderer(IPC.updaterEvent, {
      type: notifyNoUpdate ? 'not-available' : 'dev-skip',
      message: 'Updates are only checked in packaged builds.',
    })
    return
  }
  try {
    initUpdater()
    await autoUpdater.checkForUpdates()
  } catch (err) {
    broadcastToRenderer(IPC.updaterEvent, { type: 'error', message: String(err) })
  }
}

export function quitAndInstall(): void {
  try {
    autoUpdater.quitAndInstall()
  } catch {
    /* ignore */
  }
}
