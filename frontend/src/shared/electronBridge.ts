/**
 * Typed accessor for the Electron preload bridge (`window.ninja`).
 * Returns undefined in the web app, so all reused modules stay backward compatible.
 */

export type NinjaSocketStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting'

export type NinjaNotifyPayload = {
  title: string
  body: string
  iconUrl?: string | null
  conversationId?: number
  kind?: 'dm' | 'channel' | 'mention' | 'call' | 'call-missed' | 'dm-request' | 'generic'
  silent?: boolean
  timestamp?: number
  conversationType?: 'dm' | 'channel'
  senderId?: number
  messageId?: number
  requestId?: number
  navTarget?: 'conversation' | 'dm-requests'
}

export type NinjaNavIntent =
  | { type: 'open-conversation'; conversationId: number }
  | { type: 'open-dm-requests'; requestId?: number }
  | { type: 'dm-request-action'; requestId: number; action: 'accept' | 'reject' }
  | { type: 'open-settings' }
  | { type: 'logout' }
  | { type: 'check-updates' }

export type NinjaOAuthResult = { code: string } | { error: string }

export type NinjaAppInfo = {
  version: string
  platform: string
  isPackaged: boolean
  isProductionBackend: boolean
  backendUrl: string
  signupUrl: string
}

/** Structural type of the subset of the bridge consumed by the renderer. */
export interface NinjaBridgeApi {
  app: {
    isDesktop: true
    info: () => Promise<NinjaAppInfo>
    relaunch: () => void
  }
  auth: {
    getToken: () => string | null
    setSession: (token: string, user: unknown) => void
    clear: () => void
    getUser: () => Promise<unknown>
  }
  socket: {
    connect: () => void
    disconnect: () => void
    emit: (event: string, data: unknown) => void
    getStatus: () => Promise<NinjaSocketStatus>
    on: (event: string, handler: (data: unknown) => void) => () => void
    onStatus: (handler: (s: NinjaSocketStatus) => void) => () => void
    onReconnected: (handler: () => void) => () => void
    onAuthInvalid: (handler: (payload: { reason?: string }) => void) => () => void
  }
  window: {
    minimize: () => void
    maximizeToggle: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizedChanged: (handler: (v: boolean) => void) => () => void
  }
  settings: {
    getAll: () => Promise<Record<string, any>>
    set: (patch: Record<string, any>) => Promise<Record<string, any>>
    reset: () => Promise<Record<string, any>>
    onChanged: (handler: (s: Record<string, any>) => void) => () => void
  }
  notify: (payload: NinjaNotifyPayload) => void
  queue: {
    enqueueRead: (conversationId: number) => void
    enqueueReaction: (messageId: number, emoji: string) => void
    status: () => Promise<{ pending: number; online: boolean }>
    onStatus: (handler: (s: { pending: number; online: boolean }) => void) => () => void
  }
  nav: {
    onIntent: (handler: (intent: NinjaNavIntent) => void) => () => void
  }
  downloads: { chooseDir: () => Promise<string | null> }
  storage: {
    cacheInfo: () => Promise<{ bytes: number }>
    clearCache: () => Promise<{ ok: boolean }>
  }
  shell: {
    openPath: (p: string) => Promise<{ ok: boolean; error?: string }>
    openExternal: (url: string) => Promise<{ ok: boolean }>
  }
  diagnostics: {
    network: () => Promise<{
      ok: boolean
      status: number
      latencyMs: number
      socket: NinjaSocketStatus
      backendUrl: string
      error?: string
    }>
  }
  updater: {
    check: () => Promise<void>
    quitAndInstall: () => void
    onEvent: (handler: (e: { type: string; [k: string]: unknown }) => void) => () => void
  }
  oauth: {
    start: (provider: 'google' | 'github' | 'discord') => Promise<NinjaOAuthResult>
  }
}

declare global {
  interface Window {
    ninja?: NinjaBridgeApi
  }
}

export function getNinja(): NinjaBridgeApi | undefined {
  return typeof window !== 'undefined' ? window.ninja : undefined
}

export const isDesktop = (): boolean => !!getNinja()?.app?.isDesktop
