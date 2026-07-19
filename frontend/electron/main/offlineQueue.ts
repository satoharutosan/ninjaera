/**
 * Persistent offline queue for safe-to-retry mutations (read receipts + reaction toggles).
 * Flushed automatically when the socket reconnects. Dedup keeps net effect and avoids
 * duplicate delivery:
 *   - read: only the latest per conversation is kept
 *   - reaction: two identical pending toggles cancel out (net no-op)
 *
 * Message bodies are intentionally NOT auto-queued here: the backend exposes no
 * idempotency key, so silently replaying a POST /messages could duplicate a message.
 * The composer surfaces a normal send failure instead (best-effort, documented).
 */
import { readQueue, writeQueue } from './store'
import { backendRequest } from './restProxy'
import type { QueueStatus } from '@shared-electron/ipc'

type ReadItem = { type: 'read'; conversationId: number; ts: number }
type ReactionItem = { type: 'reaction'; messageId: number; emoji: string; ts: number }
type QueueItem = ReadItem | ReactionItem

let items: QueueItem[] = []
let loaded = false
let online = false
let flushing = false
let statusSink: ((s: QueueStatus) => void) | null = null

function load(): void {
  if (loaded) return
  items = readQueue<QueueItem>()
  loaded = true
}

function persist(): void {
  writeQueue(items)
  emitStatus()
}

function emitStatus(): void {
  statusSink?.({ pending: items.length, online })
}

export function setStatusSink(fn: (s: QueueStatus) => void): void {
  statusSink = fn
  load()
  emitStatus()
}

export function setOnline(value: boolean): void {
  const changed = online !== value
  online = value
  if (changed) emitStatus()
  if (value) void flush()
}

export function enqueueRead(conversationId: number): void {
  load()
  items = items.filter((i) => !(i.type === 'read' && i.conversationId === conversationId))
  items.push({ type: 'read', conversationId, ts: Date.now() })
  persist()
  if (online) void flush()
}

export function enqueueReaction(messageId: number, emoji: string): void {
  load()
  const existingIdx = items.findIndex(
    (i) => i.type === 'reaction' && i.messageId === messageId && i.emoji === emoji,
  )
  if (existingIdx >= 0) {
    // Two identical toggles cancel — net no change.
    items.splice(existingIdx, 1)
  } else {
    items.push({ type: 'reaction', messageId, emoji, ts: Date.now() })
  }
  persist()
  if (online) void flush()
}

async function sendItem(item: QueueItem): Promise<'done' | 'retry'> {
  try {
    let res
    if (item.type === 'read') {
      res = await backendRequest('POST', `/api/conversations/${item.conversationId}/read`)
    } else {
      res = await backendRequest('POST', `/api/messages/${item.messageId}/reactions`, {
        emoji: item.emoji,
      })
    }
    if (res.ok) return 'done'
    // 4xx: won't succeed on retry — drop it. 5xx: retry later.
    return res.status >= 400 && res.status < 500 ? 'done' : 'retry'
  } catch {
    return 'retry'
  }
}

export async function flush(): Promise<void> {
  load()
  if (flushing || !online || items.length === 0) return
  flushing = true
  try {
    const remaining: QueueItem[] = []
    // Snapshot to preserve ordering while allowing new enqueues during flush.
    const snapshot = [...items]
    for (const item of snapshot) {
      const result = await sendItem(item)
      if (result === 'retry') remaining.push(item)
    }
    // Keep any items enqueued during flush that weren't in the snapshot.
    const newlyAdded = items.filter((i) => !snapshot.includes(i))
    items = [...remaining, ...newlyAdded]
    persist()
  } finally {
    flushing = false
  }
}

export function getStatus(): QueueStatus {
  load()
  return { pending: items.length, online }
}
