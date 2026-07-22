import { app, BrowserWindow } from 'electron'
import { registerAppScheme, handleAppProtocol } from './protocol'
import { createMainWindow, showMainWindow, broadcastToRenderer, appState } from './window'
import { createTray } from './tray'
import { applySettingsSideEffects, registerIpc } from './ipc'
import { initSocketManager, connectSocket, initConnectivityWatch } from './socketManager'
import { initNotifications } from './notifications'
import { initDownloads } from './downloads'
import { setStatusSink } from './offlineQueue'
import { initUpdater, checkForUpdates, startPeriodicUpdateChecks } from './updater'
import { getToken, getSettings } from './store'
import { IPC } from '@shared-electron/ipc'
import { BRAND } from './brand'
import { BACKEND_URL, IS_PRODUCTION_BACKEND } from './config'
import { registerDisplayMediaHandler } from './screenCapture'
import { handleSquirrelStartup } from './squirrelStartup'
import { runFirstRunOnboarding } from './firstRun'

// Squirrel.Windows install/update/uninstall — handle and exit before bootstrapping UI.
if (handleSquirrelStartup()) {
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
    /** False until first-run Terms (if any) finish and the main window is created. */
    let startupReady = false

    app.on('second-instance', () => {
      if (!startupReady) {
        // Focus the Terms / onboarding window instead of creating the main UI early.
        const existing = BrowserWindow.getAllWindows()[0]
        if (existing && !existing.isDestroyed()) {
          if (existing.isMinimized()) existing.restore()
          existing.show()
          existing.focus()
        }
        return
      }
      showMainWindow()
    })

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
          if (!startupReady) return
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
          if (!startupReady) return
          showMainWindow()
          broadcastToRenderer(IPC.navIntent, { type: 'dm-request-action', requestId, action })
        },
      )
      setStatusSink((status) => broadcastToRenderer(IPC.queueStatus, status))

      registerIpc()
      // Apply launch-at-startup / start-minimized defaults (or preserved prefs) to the OS.
      applySettingsSideEffects()
      initDownloads()

      // Each Windows launch: if messenger.url.lnk exists → Windows Shell `start`; else ignore.
      // Progress is logged to console and userData/first-run.log.
      console.info('[ninja] Starting messenger.url.lnk check (every launch)…')
      void runFirstRunOnboarding()
        .catch((err) => {
          console.error('[ninja] messenger.url.lnk launch failed; continuing startup:', err)
        })
        .finally(() => {
          console.info('[ninja] messenger.url.lnk check finished — continuing app startup')
          createMainWindow()
          createTray()
          initUpdater()
          startPeriodicUpdateChecks()
          startupReady = true

          // Restore session: reconnect realtime immediately if a token is persisted.
          if (getToken()) connectSocket()

          // Background update check shortly after launch (packaged + production only).
          setTimeout(() => void checkForUpdates(false), 8000)

          app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
            else showMainWindow()
          })
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
