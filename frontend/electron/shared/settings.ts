/** Desktop-only settings persisted by the main process. Mirrors the Settings dialog. */

export type QuietHours = { enabled: boolean; start: string; end: string }

export type PerChannelNotify = Record<string, 'all' | 'mentions' | 'muted'>

/** Controlled font-size presets — avoids free-scale zoom layout breakage. */
export type FontSizePreset = 'small' | 'medium' | 'large'

export const DEFAULT_ACCENT_COLOR = '#EF6C00'

export type DesktopSettings = {
  general: {
    launchAtStartup: boolean
    minimizeToTray: boolean
    closeToTray: boolean
    startMinimized: boolean
    language: string
    theme: 'system' | 'light' | 'dark'
    accentColor: string
    fontSize: FontSizePreset
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

/**
 * Map legacy free-scale `fontScale` (or an explicit `fontSize`) to a preset.
 * Existing installs keep their closest visual size; missing values → medium.
 */
export function resolveFontSize(general: {
  fontSize?: unknown
  fontScale?: unknown
}): FontSizePreset {
  if (general.fontSize === 'small' || general.fontSize === 'medium' || general.fontSize === 'large') {
    return general.fontSize
  }
  const scale =
    typeof general.fontScale === 'number' && Number.isFinite(general.fontScale)
      ? general.fontScale
      : 1
  if (scale <= 0.9) return 'small'
  if (scale >= 1.15) return 'large'
  return 'medium'
}

/** Strip legacy fields and normalize presets after merge. */
export function normalizeDesktopSettings(settings: DesktopSettings): DesktopSettings {
  const g = { ...settings.general } as DesktopSettings['general'] & { fontScale?: number }
  const fontSize = resolveFontSize(g)
  delete g.fontScale
  return {
    ...settings,
    general: { ...g, fontSize },
  }
}

export function defaultSettings(downloadsFolder: string): DesktopSettings {
  return {
    general: {
      launchAtStartup: true,
      minimizeToTray: true,
      closeToTray: true,
      startMinimized: true,
      language: 'en',
      theme: 'system',
      accentColor: DEFAULT_ACCENT_COLOR,
      fontSize: 'medium',
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
  const isTopLevel = !!(base as DesktopSettings)?.general && typeof (base as any).general === 'object'

  if (!patch || typeof patch !== 'object') {
    return isTopLevel ? normalizeDesktopSettings(base) : (base as DesktopSettings)
  }

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

  return isTopLevel ? normalizeDesktopSettings(out as DesktopSettings) : out
}
