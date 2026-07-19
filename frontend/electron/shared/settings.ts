/** Desktop-only settings persisted by the main process. Mirrors the Settings dialog. */

export type QuietHours = { enabled: boolean; start: string; end: string }

export type PerChannelNotify = Record<string, 'all' | 'mentions' | 'muted'>

export type DesktopSettings = {
  general: {
    launchAtStartup: boolean
    minimizeToTray: boolean
    closeToTray: boolean
    startMinimized: boolean
    language: string
    theme: 'system' | 'light' | 'dark'
    accentColor: string
    fontScale: number
    compactMode: boolean
  }
  notifications: {
    enabled: boolean
    preview: boolean
    sound: boolean
    mentionOnly: boolean
    muteAll: boolean
    quietHours: QuietHours
    perChannel: PerChannelNotify
  }
  calls: {
    cameraId: string
    microphoneId: string
    speakerId: string
    echoCancellation: boolean
    noiseSuppression: boolean
    autoGainControl: boolean
    screenShareIncludeAudio: boolean
    screenSharePreferCurrentTab: boolean
  }
  downloads: {
    folder: string
    askBeforeDownload: boolean
    autoDownloadMedia: boolean
  }
  privacy: {
    onlineStatusVisible: boolean
    readReceipts: boolean
    typingIndicators: boolean
    lastSeen: boolean
  }
  advanced: {
    hardwareAcceleration: boolean
    developerMode: boolean
  }
}

export function defaultSettings(downloadsFolder: string): DesktopSettings {
  return {
    general: {
      launchAtStartup: false,
      minimizeToTray: true,
      closeToTray: true,
      startMinimized: false,
      language: 'en',
      theme: 'system',
      accentColor: '#6750A4',
      fontScale: 1,
      compactMode: false,
    },
    notifications: {
      enabled: true,
      preview: true,
      sound: true,
      mentionOnly: false,
      muteAll: false,
      quietHours: { enabled: false, start: '22:00', end: '08:00' },
      perChannel: {},
    },
    calls: {
      cameraId: 'default',
      microphoneId: 'default',
      speakerId: 'default',
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      screenShareIncludeAudio: false,
      screenSharePreferCurrentTab: false,
    },
    downloads: {
      folder: downloadsFolder,
      askBeforeDownload: false,
      autoDownloadMedia: true,
    },
    privacy: {
      onlineStatusVisible: true,
      readReceipts: true,
      typingIndicators: true,
      lastSeen: true,
    },
    advanced: {
      hardwareAcceleration: true,
      developerMode: false,
    },
  }
}

/** Deep-merges persisted partials over defaults so new fields always exist. */
export function mergeSettings(
  base: DesktopSettings,
  patch: Partial<DesktopSettings> | Record<string, unknown> | null | undefined,
): DesktopSettings {
  if (!patch || typeof patch !== 'object') return base
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = (base as any)[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      out[key] = mergeSettings(current, value as any)
    } else if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}
