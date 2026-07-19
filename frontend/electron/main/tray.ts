/** System tray with the required menu. Only "Exit" fully terminates the app. */
import { Tray, Menu, nativeImage, app } from 'electron'
import path from 'path'
import { showMainWindow, quitApp, broadcastToRenderer } from './window'
import { checkForUpdates } from './updater'
import { IPC, type NavIntent } from '@shared-electron/ipc'
import { BRAND } from './brand'

let tray: Tray | null = null

function trayIcon() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(process.resourcesPath, 'logo.png'),
      ]
    : [
        path.join(app.getAppPath(), 'build', 'icon.ico'),
        path.join(app.getAppPath(), 'public', 'logo.png'),
      ]
  for (const iconPath of candidates) {
    const img = nativeImage.createFromPath(iconPath)
    if (!img.isEmpty()) return img.resize({ width: 18, height: 18 })
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
