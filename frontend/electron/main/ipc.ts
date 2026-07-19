/** Registers all validated IPC handlers exposed to the renderer via the preload bridge. */
import { ipcMain, dialog, shell, session, app, BrowserWindow } from 'electron'
import { IPC, type AppInfo } from '@shared-electron/ipc'
import { BACKEND_URL, SIGNUP_URL } from './config'
import {
  getToken,
  getUser,
  setSession,
  clearSession,
  getSettings,
  saveSettings,
  resetSettings,
  type CachedUser,
} from './store'
import { connectSocket, disconnectSocket, emitSocket, getSocketStatus } from './socketManager'
import { enqueueRead, enqueueReaction, getStatus as getQueueStatus } from './offlineQueue'
import { showNotification } from './notifications'
import { checkForUpdates, quitAndInstall } from './updater'
import { startOAuth } from './oauth'
import { getMainWindow } from './window'
import type { NotifyPayload } from '@shared-electron/ipc'

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

function applySettingsSideEffects(): void {
  const s = getSettings()
  try {
    app.setLoginItemSettings({
      openAtLogin: s.general.launchAtStartup,
      openAsHidden: s.general.startMinimized,
    })
  } catch {
    /* unsupported platform */
  }
  const win = getMainWindow()
  if (win) {
    const devToolsOpen = win.webContents.isDevToolsOpened()
    if (s.advanced.developerMode && !devToolsOpen) win.webContents.openDevTools({ mode: 'detach' })
    else if (!s.advanced.developerMode && devToolsOpen) win.webContents.closeDevTools()
  }
}

export function registerIpc(): void {
  // ── Session ──
  ipcMain.on(IPC.tokenGetSync, (event) => {
    event.returnValue = getToken()
  })
  ipcMain.on(IPC.authSetSession, (_e, payload) => {
    if (!isObj(payload) || !isStr(payload.token)) return
    const user = isObj(payload.user) ? (payload.user as unknown as CachedUser) : null
    setSession(payload.token, user)
    connectSocket()
  })
  ipcMain.on(IPC.authClear, () => {
    clearSession()
    disconnectSocket()
  })
  ipcMain.handle(IPC.authGetUser, () => getUser())

  // ── Socket bridge ──
  ipcMain.on(IPC.socketConnect, () => connectSocket())
  ipcMain.on(IPC.socketDisconnect, () => disconnectSocket())
  ipcMain.on(IPC.socketEmit, (_e, payload) => {
    if (!isObj(payload) || !isStr(payload.event)) return
    emitSocket(payload.event, payload.data)
  })

  // ── Window controls ──
  ipcMain.on(IPC.windowMinimize, () => getMainWindow()?.minimize())
  ipcMain.on(IPC.windowMaximizeToggle, () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.windowClose, () => getMainWindow()?.close())
  ipcMain.handle(IPC.windowIsMaximized, () => getMainWindow()?.isMaximized() ?? false)

  // ── Settings ──
  ipcMain.handle(IPC.settingsGetAll, () => getSettings())
  ipcMain.handle(IPC.settingsSet, (_e, patch) => {
    if (!isObj(patch)) return getSettings()
    const merged = saveSettings(patch)
    applySettingsSideEffects()
    return merged
  })
  ipcMain.handle(IPC.settingsReset, () => {
    const fresh = resetSettings()
    applySettingsSideEffects()
    return fresh
  })

  // ── Notifications ──
  ipcMain.on(IPC.notify, (_e, payload) => {
    if (!isObj(payload) || !isStr(payload.title)) return
    void showNotification(payload as unknown as NotifyPayload)
  })

  // ── Offline queue ──
  ipcMain.on(IPC.queueEnqueueRead, (_e, conversationId) => {
    if (isNum(conversationId)) enqueueRead(conversationId)
  })
  ipcMain.on(IPC.queueEnqueueReaction, (_e, payload) => {
    if (isObj(payload) && isNum(payload.messageId) && isStr(payload.emoji)) {
      enqueueReaction(payload.messageId, payload.emoji)
    }
  })
  ipcMain.handle(IPC.queueStatus, () => getQueueStatus())

  // ── Downloads / storage / diagnostics ──
  ipcMain.handle(IPC.chooseDownloadDir, async () => {
    const win = getMainWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })
  ipcMain.handle(IPC.getCacheInfo, async () => {
    try {
      const size = await session.defaultSession.getCacheSize()
      return { bytes: size }
    } catch {
      return { bytes: 0 }
    }
  })
  ipcMain.handle(IPC.clearCache, async () => {
    try {
      await session.defaultSession.clearCache()
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })
  ipcMain.handle(IPC.openPath, async (_e, p) => {
    if (!isStr(p)) return { ok: false }
    const err = await shell.openPath(p)
    return { ok: !err, error: err || undefined }
  })
  ipcMain.handle(IPC.openExternal, async (_e, url) => {
    if (!isStr(url) || !/^https?:\/\//.test(url)) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  })
  ipcMain.handle(IPC.networkDiagnostics, async () => {
    const start = Date.now()
    try {
      const res = await fetch(`${BACKEND_URL}/api/health`, { method: 'GET' })
      return {
        ok: res.ok,
        status: res.status,
        latencyMs: Date.now() - start,
        socket: getSocketStatus(),
        backendUrl: BACKEND_URL,
      }
    } catch (err) {
      return {
        ok: false,
        status: 0,
        latencyMs: Date.now() - start,
        socket: getSocketStatus(),
        backendUrl: BACKEND_URL,
        error: String(err),
      }
    }
  })

  // ── Updater ──
  ipcMain.handle(IPC.updaterCheck, () => checkForUpdates(true))
  ipcMain.on(IPC.updaterQuitInstall, () => quitAndInstall())

  // ── OAuth ──
  ipcMain.handle(IPC.oauthStart, (event, provider) => {
    if (!isStr(provider)) return { error: 'Invalid provider' }
    const parent = BrowserWindow.fromWebContents(event.sender)
    return startOAuth(provider, parent)
  })

  // ── App meta ──
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    backendUrl: BACKEND_URL,
    signupUrl: SIGNUP_URL,
  }))
  ipcMain.on(IPC.relaunch, () => {
    app.relaunch()
    app.exit(0)
  })
}
