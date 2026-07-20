/**
 * Main-process Socket.IO client. Owning the socket here means realtime stays
 * connected while the window is hidden in the tray, and there is no browser CORS.
 * Server events are fanned out to the renderer over IPC; renderer emits are
 * forwarded to the backend. Conversation joins are tracked and replayed on reconnect.
 */
import { app, net, powerMonitor } from 'electron'
import { io, type Socket } from 'socket.io-client'
import { BACKEND_URL } from './config'
import { getToken } from './store'
import { IPC, type SocketStatus } from '@shared-electron/ipc'
import { setOnline } from './offlineQueue'

let socket: Socket | null = null
let status: SocketStatus = 'disconnected'
let everConnected = false
let connectivityWatchStarted = false
let onlinePollTimer: ReturnType<typeof setInterval> | null = null
const joinedConversations = new Set<number>()
const pendingEmits: Array<{ event: string; payload: unknown }> = []
const MAX_PENDING_EMITS = 64

let broadcast: (channel: string, payload: unknown) => void = () => {}

function isDevLog(): boolean {
  return !app.isPackaged
}

function log(tag: string, message: string, extra?: unknown): void {
  if (!isDevLog()) return
  if (extra !== undefined) console.info(`[${tag}] ${message}`, extra)
  else console.info(`[${tag}] ${message}`)
}

export function initSocketManager(send: (channel: string, payload: unknown) => void): void {
  broadcast = send
}

function setStatus(next: SocketStatus): void {
  if (status === next) return
  status = next
  broadcast(IPC.socketStatus, status)
  setOnline(next === 'connected')
  log('SOCKET', `status → ${next}`)
}

export function getSocketStatus(): SocketStatus {
  return status
}

function isAuthConnectError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '').toLowerCase()
  return (
    msg.includes('invalid token') ||
    msg.includes('authentication required') ||
    msg.includes('invalid user') ||
    msg.includes('jwt')
  )
}

function flushPendingEmits(): void {
  if (!socket?.connected || !pendingEmits.length) return
  const queued = pendingEmits.splice(0, pendingEmits.length)
  for (const item of queued) {
    socket.emit(item.event, item.payload)
  }
}

function replayJoins(): void {
  if (!socket?.connected) return
  for (const convId of joinedConversations) {
    socket.emit('join:conversation', convId)
  }
  log('RECONNECT', `replayed ${joinedConversations.size} conversation join(s)`)
}

function bindSocketLifecycle(s: Socket): void {
  s.on('connect', () => {
    const wasReconnect = everConnected
    everConnected = true
    setStatus('connected')
    log(wasReconnect ? 'RECONNECT' : 'SOCKET', wasReconnect ? 'reconnected' : 'connected')
    // Always refresh auth payload for the next handshake.
    const token = getToken()
    if (token) s.auth = { token }
    replayJoins()
    flushPendingEmits()
    if (wasReconnect) {
      broadcast(IPC.socketReconnected, { at: Date.now() })
    }
  })

  s.on('disconnect', (reason) => {
    log('SOCKET', `disconnected (${reason})`)
    setStatus('disconnected')
  })

  s.io.on('reconnect_attempt', (attempt) => {
    setStatus('reconnecting')
    log('RECONNECT', `attempt #${attempt}`)
    const token = getToken()
    if (token) s.auth = { token }
  })

  s.io.on('reconnect_failed', () => {
    // Infinity attempts — this should not fire, but keep status honest.
    log('RECONNECT', 'reconnect_failed (will keep trying)')
    setStatus('disconnected')
  })

  s.on('connect_error', (err) => {
    log('SOCKET', `connect_error: ${String((err as Error)?.message || err)}`)
    if (isAuthConnectError(err)) {
      log('AUTH', 'socket auth rejected — stopping retries')
      s.io.reconnection(false)
      setStatus('disconnected')
      broadcast(IPC.socketAuthInvalid, {
        reason: String((err as Error)?.message || 'Invalid token'),
      })
      return
    }
    if (everConnected) setStatus('reconnecting')
    else setStatus('connecting')
  })

  // Fan out every server event to the renderer (single listener — no duplicates on reconnect).
  s.onAny((event: string, ...args: unknown[]) => {
    broadcast(IPC.socketEvent, { event, data: args.length <= 1 ? args[0] : args })
  })
}

/** Soft nudge: refresh token auth and connect if a session exists. */
export function nudgeSocketReconnect(reason = 'nudge'): void {
  const token = getToken()
  if (!token) return
  log('RECONNECT', `nudge (${reason})`)
  connectSocket()
  if (socket && !socket.connected) {
    // Force a fresh attempt when Socket.IO is waiting on a long backoff.
    try {
      socket.connect()
    } catch {
      /* ignore */
    }
  }
}

export function connectSocket(): void {
  const token = getToken()
  if (!token) {
    log('AUTH', 'connectSocket skipped — no token')
    return
  }

  if (socket) {
    socket.auth = { token }
    socket.io.reconnection(true)
    if (!socket.connected) {
      setStatus(everConnected ? 'reconnecting' : 'connecting')
      socket.connect()
    }
    return
  }

  everConnected = false
  setStatus('connecting')
  log('SOCKET', `connecting → ${BACKEND_URL}`)
  socket = io(BACKEND_URL, {
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    randomizationFactor: 0.5,
    timeout: 20000,
  })

  bindSocketLifecycle(socket)
}

export function emitSocket(event: string, payload: unknown): void {
  if (event === 'join:conversation' && typeof payload === 'number') {
    joinedConversations.add(payload)
  } else if (event === 'leave:conversation' && typeof payload === 'number') {
    joinedConversations.delete(payload)
  }
  if (socket?.connected) {
    socket.emit(event, payload)
    return
  }
  if (pendingEmits.length >= MAX_PENDING_EMITS) pendingEmits.shift()
  pendingEmits.push({ event, payload })
  if (socket && !socket.connected) {
    socket.connect()
  }
}

export function disconnectSocket(): void {
  joinedConversations.clear()
  pendingEmits.length = 0
  everConnected = false
  if (socket) {
    socket.removeAllListeners()
    socket.io.removeAllListeners()
    socket.disconnect()
    socket = null
  }
  setStatus('disconnected')
  log('SOCKET', 'disconnected (session cleared)')
}

/**
 * OS / network recovery: resume from sleep, online transitions, and periodic
 * catch-up while the app stays open in the tray.
 */
export function initConnectivityWatch(): void {
  if (connectivityWatchStarted) return
  connectivityWatchStarted = true

  try {
    powerMonitor.on('resume', () => nudgeSocketReconnect('power-resume'))
    powerMonitor.on('unlock-screen', () => nudgeSocketReconnect('unlock-screen'))
  } catch {
    /* unsupported platform */
  }

  let lastOnline = net.isOnline()
  onlinePollTimer = setInterval(() => {
    const online = net.isOnline()
    if (online && !lastOnline) {
      log('REALTIME', 'network online')
      nudgeSocketReconnect('network-online')
    } else if (!online && lastOnline) {
      log('REALTIME', 'network offline')
      setStatus('disconnected')
    } else if (online && getToken() && status !== 'connected') {
      nudgeSocketReconnect('online-poll')
    }
    lastOnline = online
  }, 8_000)
}

export function stopConnectivityWatch(): void {
  if (onlinePollTimer) {
    clearInterval(onlinePollTimer)
    onlinePollTimer = null
  }
  connectivityWatchStarted = false
}
