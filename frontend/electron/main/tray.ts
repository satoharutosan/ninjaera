/** System tray with the required menu. Only "Exit" fully terminates the app. */
import { Tray, Menu, nativeImage, app } from 'electron'
import path from 'path'
import { showMainWindow, quitApp, broadcastToRenderer } from './window'
import { checkForUpdates } from './updater'
import { IPC, type NavIntent } from '@shared-electron/ipc'
import { BRAND } from './brand'

let tray: Tray | null = null

/**
 * White Telegram-style tray glyph (transparent bg). Kept separate from
 * build/icon.ico so the EXE / window / installer icons stay unchanged.
 */
function trayIcon() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'tray-icon.ico'),
        path.join(process.resourcesPath, 'tray-icon.png'),
      ]
    : [
        path.join(app.getAppPath(), 'build', 'tray-icon.ico'),
        path.join(app.getAppPath(), 'build', 'tray-icon.png'),
      ]
  for (const iconPath of candidates) {
    const img = nativeImage.createFromPath(iconPath)
    if (img.isEmpty()) continue
    // Prefer the native multi-size .ico; only resize PNG fallbacks for tray DPI.
    if (iconPath.toLowerCase().endsWith('.png')) {
      return img.resize({ width: 32, height: 32, quality: 'best' })
    }
    return img
  }
  return nativeImage.createEmpty()
}

function sendIntent(intent: NavIntent): void {
  showMainWindow()
  broadcastToRenderer(IPC.navIntent, intent)
}

export function createTray(): Tray {
  if (tray) return tray
  tray = new Tray(trayIcon())
  tray.setToolTip(BRAND.name)

  const menu = Menu.buildFromTemplate([
    { label: `Open ${BRAND.name}`, click: () => showMainWindow() },
    { label: 'Settings', click: () => sendIntent({ type: 'open-settings' }) },
    { label: 'Check for Updates', click: () => void checkForUpdates(true) },
    { type: 'separator' },
    { label: 'Log Out', click: () => sendIntent({ type: 'logout' }) },
    { type: 'separator' },
    { label: 'Exit', click: () => quitApp() },
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
