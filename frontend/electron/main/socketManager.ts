/**
 * Main-process Socket.IO client. Owning the socket here means realtime stays
 * connected while the window is hidden in the tray, and there is no browser CORS.
 * Server events are fanned out to the renderer over IPC; renderer emits are
 * forwarded to the backend. Conversation joins are tracked and replayed on reconnect.
 */
import { io, type Socket } from 'socket.io-client'
import { BACKEND_URL } from './config'
import { getToken } from './store'
import { IPC, type SocketStatus } from '@shared-electron/ipc'
import { setOnline } from './offlineQueue'

let socket: Socket | null = null
let status: SocketStatus = 'disconnected'
const joinedConversations = new Set<number>()
let broadcast: (channel: string, payload: unknown) => void = () => {}

export function initSocketManager(send: (channel: string, payload: unknown) => void): void {
  broadcast = send
}

function setStatus(next: SocketStatus): void {
  status = next
  broadcast(IPC.socketStatus, status)
  setOnline(next === 'connected')
}

export function getSocketStatus(): SocketStatus {
  return status
}

export function connectSocket(): void {
  const token = getToken()
  if (!token) return

  if (socket) {
    socket.auth = { token }
    if (!socket.connected) {
      setStatus('connecting')
      socket.connect()
    }
    return
  }

  setStatus('connecting')
  socket = io(BACKEND_URL, {
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
  })

  socket.on('connect', () => {
    setStatus('connected')
    // Replay conversation subscriptions after a reconnect.
    for (const convId of joinedConversations) {
      socket?.emit('join:conversation', convId)
    }
  })

  socket.on('disconnect', () => setStatus('disconnected'))
  socket.io.on('reconnect_attempt', () => setStatus('connecting'))
  socket.on('connect_error', () => {
    /* auto-retry via reconnection */
  })

  // Fan out every server event to the renderer.
  socket.onAny((event: string, ...args: unknown[]) => {
    broadcast(IPC.socketEvent, { event, data: args.length <= 1 ? args[0] : args })
  })
}

export function emitSocket(event: string, payload: unknown): void {
  if (event === 'join:conversation' && typeof payload === 'number') {
    joinedConversations.add(payload)
  } else if (event === 'leave:conversation' && typeof payload === 'number') {
    joinedConversations.delete(payload)
  }
  if (socket && socket.connected) {
    socket.emit(event, payload)
  } else if (socket) {
    socket.once('connect', () => socket?.emit(event, payload))
  }
}

export function disconnectSocket(): void {
  joinedConversations.clear()
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
  setStatus('disconnected')
}
