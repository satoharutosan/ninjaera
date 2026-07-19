/** Native OS notifications with avatar icons, settings gating, and click-to-open. */
import { Notification, nativeImage, net, app } from 'electron'
import path from 'path'
import { BACKEND_URL } from './config'
import { getSettings } from './store'
import { IPC, type NotifyPayload } from '@shared-electron/ipc'

type ClickHandler = (payload: NotifyPayload) => void
type ActionHandler = (requestId: number, action: 'accept' | 'reject') => void

let onClick: ClickHandler = () => {}
let onAction: ActionHandler = () => {}

export function initNotifications(clickHandler: ClickHandler, actionHandler: ActionHandler): void {
  onClick = clickHandler
  onAction = actionHandler
}

function withinQuietHours(now = new Date()): boolean {
  const q = getSettings().notifications.quietHours
  if (!q.enabled) return false
  const [sh, sm] = q.start.split(':').map(Number)
  const [eh, em] = q.end.split(':').map(Number)
  const cur = now.getHours() * 60 + now.getMinutes()
  const start = sh * 60 + sm
  const end = eh * 60 + em
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end
}

/** Returns whether the OS notification should be shown for this payload. */
function allowed(payload: NotifyPayload): boolean {
  const n = getSettings().notifications
  if (!n.enabled || n.muteAll) return false
  // Calls always ring through (unless globally muted above).
  const isCall = payload.kind === 'call' || payload.kind === 'call-missed'
  if (n.mentionOnly && !isCall && payload.kind !== 'mention') return false
  if (withinQuietHours() && !isCall) return false
  return true
}

function fallbackIcon() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(process.resourcesPath, 'logo.png'),
      ]
    : [
        path.join(app.getAppPath(), 'build', 'icon.ico'),
        path.join(app.getAppPath(), 'public', 'logo.png'),
      ]
  for (const iconPath of candidates) {
    const img = nativeImage.createFromPath(iconPath)
    if (!img.isEmpty()) return img
  }
  return undefined
}

async function resolveIcon(iconUrl?: string | null) {
  if (!iconUrl) return fallbackIcon()
  try {
    const url = iconUrl.startsWith('http') ? iconUrl : `${BACKEND_URL}${iconUrl}`
    const res = await net.fetch(url)
    if (!res.ok) return fallbackIcon()
    const buf = Buffer.from(await res.arrayBuffer())
    const img = nativeImage.createFromBuffer(buf)
    return img.isEmpty() ? fallbackIcon() : img
  } catch {
    return fallbackIcon()
  }
}

export async function showNotification(payload: NotifyPayload): Promise<void> {
  if (!Notification.isSupported()) return
  if (!allowed(payload)) return
  const settings = getSettings()
  const preview = settings.notifications.preview
  const icon = await resolveIcon(payload.iconUrl)

  // Native action buttons for actionable DM requests. Supported on macOS (and some
  // Linux notification servers); ignored on platforms without action support, where
  // the click handler falls back to opening the in-app DM Requests panel.
  const isDmRequest = payload.kind === 'dm-request' && typeof payload.requestId === 'number'
  const notification = new Notification({
    title: payload.title,
    body: preview ? payload.body : 'New message',
    icon,
    silent: payload.silent ?? !settings.notifications.sound,
    timeoutType: 'default',
    actions: isDmRequest
      ? [
          { type: 'button', text: 'Accept' },
          { type: 'button', text: 'Reject' },
        ]
      : undefined,
  })

  notification.on('click', () => onClick(payload))
  if (isDmRequest) {
    notification.on('action', (_event, index) => {
      onAction(payload.requestId as number, index === 0 ? 'accept' : 'reject')
    })
  }
  notification.show()
}

export { IPC }
