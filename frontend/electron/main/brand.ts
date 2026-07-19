/** Brand constants for main-process UI (tray, window, notifications, AppUserModelId). */
export const BRAND = {
  /** Product / window title shown to users. */
  name: 'Ninja Era Messenger',
  /** Short mark used where space is tight (tray tooltip can use full name). */
  shortName: 'Ninja Era',
  company: 'Soft Future',
  copyright: 'Copyright (c) 2026 Soft Future. All rights reserved.',
  description: 'Official desktop messaging application for Ninja Era.',
  /** Windows AppUserModelID — keeps taskbar grouping / toast attribution consistent. */
  appUserModelId: 'com.softfuture.ninjaera.messenger',
} as const
