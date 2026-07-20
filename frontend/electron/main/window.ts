/** Main window lifecycle: frameless, secure, close-to-tray. */
import { BrowserWindow, app, shell, nativeImage } from 'electron'
import path from 'path'
import { APP_ORIGIN } from './config'
import { getSettings } from './store'
import { IPC } from '@shared-electron/ipc'
import { BRAND } from './brand'

let mainWindow: BrowserWindow | null = null
export const appState = { isQuitting: false }

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function resolveWindowIcon(): Electron.NativeImage | undefined {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(process.resourcesPath, 'logo.png'),
      ]
    : [
        path.join(app.getAppPath(), 'build', 'icon.ico'),
        path.join(app.getAppPath(), 'public', 'logo.png'),
      ]
  for (const p of candidates) {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) return img
  }
  return undefined
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

  const preload = path.join(__dirname, '../preload/index.mjs')
  const startMinimized = getSettings().general.startMinimized
  const icon = resolveWindowIcon()

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    show: false,
    frame: false,
    backgroundColor: '#141218',
    titleBarStyle: 'hidden',
    title: BRAND.name,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: true,
    },
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`)
  }

  mainWindow.once('ready-to-show', () => {
    if (startMinimized) {
      if (getSettings().general.minimizeToTray) mainWindow?.hide()
      else mainWindow?.minimize()
    } else {
      mainWindow?.show()
    }
  })

  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = new Set([
      "media",
      "display-capture",
      "notifications",
      "clipboard-sanitized-write",
    ])
    callback(allowed.has(permission))
  })

  // Open external links (target=_blank / window.open) in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Block in-page navigation away from the app origin (defense in depth).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith(APP_ORIGIN) || (devUrl ? url.startsWith(devUrl) : false)
    if (!allowed) {
      event.preventDefault()
      if (url.startsWith('http')) void shell.openExternal(url)
    }
  })

  const emitMaximized = () => {
    mainWindow?.webContents.send(IPC.windowMaximizedChanged, mainWindow.isMaximized())
  }
  mainWindow.on('maximize', emitMaximized)
  mainWindow.on('unmaximize', emitMaximized)

  mainWindow.on('close', (event) => {
    if (!appState.isQuitting && getSettings().general.closeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // "Minimize to tray": hide the window (removing its taskbar button) on minimize.
  mainWindow.on('minimize', () => {
    if (!appState.isQuitting && getSettings().general.minimizeToTray) {
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

export function showMainWindow(): void {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  // Soft reconnect nudge when restoring from tray (socket may have been idle).
  try {
    // Lazy import avoids circular deps with socketManager <-> window.
    void import('./socketManager').then((m) => m.nudgeSocketReconnect('show-window'))
  } catch {
    /* ignore */
  }
}

export function broadcastToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

export function quitApp(): void {
  appState.isQuitting = true
  app.quit()
}
