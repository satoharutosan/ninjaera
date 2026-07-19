import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared-electron/ipc'
import type {
  AppInfo,
  NavIntent,
  NotifyPayload,
  QueueStatus,
  SocketStatus,
  OAuthResult,
} from '@shared-electron/ipc'
import type { DesktopSettings } from '@shared-electron/settings'

// ── Session token, synced synchronously at load so api.ts getToken() works immediately ──
let currentToken: string | null = ipcRenderer.sendSync(IPC.tokenGetSync) ?? null

// ── Socket event fan-out (mirrors realtime.ts listener registry) ──
type Handler = (data: unknown) => void
const socketListeners = new Map<string, Set<Handler>>()

ipcRenderer.on(IPC.socketEvent, (_e, payload: { event: string; data: unknown }) => {
  const set = socketListeners.get(payload.event)
  if (!set) return
  for (const handler of set) {
    try {
      handler(payload.data)
    } catch {
      /* isolate handler errors */
    }
  }
})

function subscribe<T>(channel: string, handler: (data: T) => void): () => void {
  const wrapped = (_e: unknown, data: T) => handler(data)
  ipcRenderer.on(channel, wrapped as never)
  return () => ipcRenderer.removeListener(channel, wrapped as never)
}

const api = {
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
    relaunch: () => ipcRenderer.send(IPC.relaunch),
    isDesktop: true as const,
  },

  auth: {
    getToken: (): string | null => currentToken,
    setSession: (token: string, user: unknown) => {
      currentToken = token
      ipcRenderer.send(IPC.authSetSession, { token, user })
    },
    clear: () => {
      currentToken = null
      ipcRenderer.send(IPC.authClear)
    },
    getUser: (): Promise<unknown> => ipcRenderer.invoke(IPC.authGetUser),
  },

  socket: {
    connect: () => ipcRenderer.send(IPC.socketConnect),
    disconnect: () => ipcRenderer.send(IPC.socketDisconnect),
    emit: (event: string, data: unknown) => ipcRenderer.send(IPC.socketEmit, { event, data }),
    on: (event: string, handler: Handler): (() => void) => {
      if (!socketListeners.has(event)) socketListeners.set(event, new Set())
      const set = socketListeners.get(event)!
      set.add(handler)
      return () => set.delete(handler)
    },
    onStatus: (handler: (s: SocketStatus) => void) => subscribe(IPC.socketStatus, handler),
  },

  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    maximizeToggle: () => ipcRenderer.send(IPC.windowMaximizeToggle),
    close: () => ipcRenderer.send(IPC.windowClose),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),
    onMaximizedChanged: (handler: (v: boolean) => void) =>
      subscribe(IPC.windowMaximizedChanged, handler),
  },

  settings: {
    getAll: (): Promise<DesktopSettings> => ipcRenderer.invoke(IPC.settingsGetAll),
    set: (patch: Partial<DesktopSettings>): Promise<DesktopSettings> =>
      ipcRenderer.invoke(IPC.settingsSet, patch),
    reset: (): Promise<DesktopSettings> => ipcRenderer.invoke(IPC.settingsReset),
    onChanged: (handler: (s: DesktopSettings) => void) => subscribe(IPC.settingsChanged, handler),
  },

  notify: (payload: NotifyPayload) => ipcRenderer.send(IPC.notify, payload),

  queue: {
    enqueueRead: (conversationId: number) => ipcRenderer.send(IPC.queueEnqueueRead, conversationId),
    enqueueReaction: (messageId: number, emoji: string) =>
      ipcRenderer.send(IPC.queueEnqueueReaction, { messageId, emoji }),
    status: (): Promise<QueueStatus> => ipcRenderer.invoke(IPC.queueStatus),
    onStatus: (handler: (s: QueueStatus) => void) => subscribe(IPC.queueStatus, handler),
  },

  nav: {
    onIntent: (handler: (intent: NavIntent) => void) => subscribe(IPC.navIntent, handler),
  },

  downloads: {
    chooseDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.chooseDownloadDir),
  },

  storage: {
    cacheInfo: (): Promise<{ bytes: number }> => ipcRenderer.invoke(IPC.getCacheInfo),
    clearCache: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.clearCache),
  },

  shell: {
    openPath: (p: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.openPath, p),
    openExternal: (url: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.openExternal, url),
  },

  diagnostics: {
    network: (): Promise<{
      ok: boolean
      status: number
      latencyMs: number
      socket: SocketStatus
      backendUrl: string
      error?: string
    }> => ipcRenderer.invoke(IPC.networkDiagnostics),
  },

  updater: {
    check: (): Promise<void> => ipcRenderer.invoke(IPC.updaterCheck),
    quitAndInstall: () => ipcRenderer.send(IPC.updaterQuitInstall),
    onEvent: (handler: (e: { type: string; [k: string]: unknown }) => void) =>
      subscribe(IPC.updaterEvent, handler),
  },

  oauth: {
    start: (provider: 'google' | 'github' | 'discord'): Promise<OAuthResult> =>
      ipcRenderer.invoke(IPC.oauthStart, provider),
  },
}

contextBridge.exposeInMainWorld('ninja', api)

export type NinjaBridge = typeof api
