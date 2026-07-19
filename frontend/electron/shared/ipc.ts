/**
 * Single source of truth for IPC channel names and payload shapes shared
 * between the Electron main process and the preload bridge.
 */

export const IPC = {
  // Auth / session (synchronous token read at preload load)
  tokenGetSync: 'ninja:token:get-sync',
  authSetSession: 'ninja:auth:set-session',
  authClear: 'ninja:auth:clear',
  authGetUser: 'ninja:auth:get-user',

  // Socket bridge
  socketConnect: 'ninja:socket:connect',
  socketDisconnect: 'ninja:socket:disconnect',
  socketEmit: 'ninja:socket:emit',
  socketEvent: 'ninja:socket:event', // main -> renderer (fan-out of server events)
  socketStatus: 'ninja:socket:status', // main -> renderer connection status

  // Window controls
  windowMinimize: 'ninja:window:minimize',
  windowMaximizeToggle: 'ninja:window:maximize-toggle',
  windowClose: 'ninja:window:close',
  windowIsMaximized: 'ninja:window:is-maximized',
  windowMaximizedChanged: 'ninja:window:maximized-changed', // main -> renderer

  // Settings
  settingsGetAll: 'ninja:settings:get-all',
  settingsSet: 'ninja:settings:set',
  settingsReset: 'ninja:settings:reset',
  settingsChanged: 'ninja:settings:changed', // main -> renderer

  // Notifications
  notify: 'ninja:notify:show',
  notifyClicked: 'ninja:notify:clicked', // main -> renderer (openConversation)

  // Navigation intents from tray / notifications
  navIntent: 'ninja:nav:intent', // main -> renderer ("open-settings" | "logout" | "open-conversation")

  // Offline queue
  queueStatus: 'ninja:queue:status', // main -> renderer
  queueEnqueueRead: 'ninja:queue:enqueue-read',
  queueEnqueueReaction: 'ninja:queue:enqueue-reaction',

  // Downloads / cache / diagnostics
  chooseDownloadDir: 'ninja:downloads:choose-dir',
  getCacheInfo: 'ninja:storage:cache-info',
  clearCache: 'ninja:storage:clear-cache',
  openPath: 'ninja:shell:open-path',
  openExternal: 'ninja:shell:open-external',
  networkDiagnostics: 'ninja:diag:network',

  // Updater
  updaterCheck: 'ninja:updater:check',
  updaterQuitInstall: 'ninja:updater:quit-install',
  updaterEvent: 'ninja:updater:event', // main -> renderer

  // OAuth
  oauthStart: 'ninja:oauth:start', // returns { code } | { error }

  // App meta
  appInfo: 'ninja:app:info',
  relaunch: 'ninja:app:relaunch',
} as const

export type SocketStatus = 'connected' | 'disconnected' | 'connecting'

export type NotifyPayload = {
  title: string
  body: string
  /** Absolute or app-relative URL used to render the avatar as the notification icon. */
  iconUrl?: string | null
  /** Conversation to open on click. */
  conversationId?: number
  /** Distinguishes categories so mute/quiet-hours rules can be applied. */
  kind?: 'dm' | 'channel' | 'mention' | 'call' | 'call-missed' | 'dm-request' | 'generic'
  /** Silences the OS notification sound when true. */
  silent?: boolean
  timestamp?: number
  // ── Routing metadata for reliable deep-linking (never rely on display text) ──
  /** Conversation kind for the target (independent of notification `kind`). */
  conversationType?: 'dm' | 'channel'
  /** Author of the triggering message. */
  senderId?: number
  /** Triggering message id (when applicable). */
  messageId?: number
  /** Pending DM request id (when applicable). */
  requestId?: number
  /** Where a click should navigate. Defaults to opening the conversation. */
  navTarget?: 'conversation' | 'dm-requests'
}

export type QueueStatus = {
  pending: number
  online: boolean
}

export type NavIntent =
  | { type: 'open-conversation'; conversationId: number }
  | { type: 'open-dm-requests'; requestId?: number }
  | { type: 'dm-request-action'; requestId: number; action: 'accept' | 'reject' }
  | { type: 'open-settings' }
  | { type: 'logout' }
  | { type: 'check-updates' }

export type OAuthResult = { code: string } | { error: string }

export type AppInfo = {
  version: string
  platform: NodeJS.Platform
  isPackaged: boolean
  backendUrl: string
  signupUrl: string
}
