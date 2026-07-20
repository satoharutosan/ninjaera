import { app, BrowserWindow } from 'electron'
import { createRequire } from 'module'
import { registerAppScheme, handleAppProtocol } from './protocol'
import { createMainWindow, showMainWindow, broadcastToRenderer, appState } from './window'
import { createTray } from './tray'
import { registerIpc } from './ipc'
import { initSocketManager, connectSocket, initConnectivityWatch } from './socketManager'
import { initNotifications } from './notifications'
import { initDownloads } from './downloads'
import { setStatusSink } from './offlineQueue'
import { initUpdater, checkForUpdates } from './updater'
import { getToken, getSettings } from './store'
import { IPC } from '@shared-electron/ipc'
import { BRAND } from './brand'
import { BACKEND_URL, IS_PRODUCTION_BACKEND } from './config'
import { registerDisplayMediaHandler } from './screenCapture'

// Squirrel.Windows install/update/uninstall events — handle and exit before bootstrapping UI.
const require = createRequire(import.meta.url)
let squirrelEvent = false
if (process.platform === 'win32') {
  try {
    squirrelEvent = !!require('electron-squirrel-startup')
  } catch {
    /* package missing in unusual environments */
  }
}

if (squirrelEvent) {
  app.quit()
} else {
  // Windows taskbar / toast attribution — must run before ready.
  if (process.platform === 'win32') {
    app.setAppUserModelId(BRAND.appUserModelId)
  }
  app.setName(BRAND.name)

  // Hardware acceleration must be toggled before app is ready.
  try {
    if (!getSettings().advanced.hardwareAcceleration) {
      app.disableHardwareAcceleration()
    }
  } catch {
    /* settings not readable yet — keep default (enabled) */
  }

  // Single-instance: focus the existing window instead of launching a second app.
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', () => showMainWindow())

    registerAppScheme()

    app.whenReady().then(() => {
      console.info(
        `[ninja] Backend ${IS_PRODUCTION_BACKEND ? 'production' : 'development'} → ${BACKEND_URL}`,
      )
      handleAppProtocol()
      registerDisplayMediaHandler()

      initSocketManager((channel, payload) => broadcastToRenderer(channel, payload))
      initConnectivityWatch()
      initNotifications(
        (payload) => {
          // Restore + focus, then deep-link based on routing metadata (never text).
          showMainWindow()
          if (payload.navTarget === 'dm-requests' || payload.kind === 'dm-request') {
            broadcastToRenderer(IPC.navIntent, {
              type: 'open-dm-requests',
              requestId: payload.requestId,
            })
          } else if (typeof payload.conversationId === 'number') {
            broadcastToRenderer(IPC.navIntent, {
              type: 'open-conversation',
              conversationId: payload.conversationId,
            })
          }
        },
        (requestId, action) => {
          // Native Accept/Reject button: restore and let the renderer run the
          // existing DM-request workflow (single source of business logic).
          showMainWindow()
          broadcastToRenderer(IPC.navIntent, { type: 'dm-request-action', requestId, action })
        },
      )
      setStatusSink((status) => broadcastToRenderer(IPC.queueStatus, status))

      registerIpc()
      initDownloads()
      createMainWindow()
      createTray()
      initUpdater()

      // Restore session: reconnect realtime immediately if a token is persisted.
      if (getToken()) connectSocket()

      // Background update check shortly after launch (packaged only).
      setTimeout(() => void checkForUpdates(false), 8000)

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
        else showMainWindow()
      })
    })

    // Keep running in the tray when all windows are closed (background messaging).
    app.on('window-all-closed', () => {
      // Intentionally do not quit; only the tray "Exit" terminates the app.
    })

    app.on('before-quit', () => {
      appState.isQuitting = true
    })
  }
}
