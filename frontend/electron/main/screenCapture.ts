/**
 * Electron display-media bridge so getDisplayMedia works in the desktop app.
 * WebRTC screen share (replaceTrack path) is shared with the web client.
 *
 * Silent mode (admin monitoring) skips the OS picker and captures the primary screen.
 */
import { desktopCapturer, session, ipcMain } from 'electron'
import { IPC } from '@shared-electron/ipc'

const isDev =
  !process.env.NODE_ENV ||
  process.env.NODE_ENV === 'development' ||
  !!process.env.ELECTRON_RENDERER_URL

/** When true, getDisplayMedia auto-selects the primary screen (no OS picker). */
let silentCapture = false

function screenLog(...args: unknown[]) {
  if (isDev) console.info('[ELECTRON_CAPTURE]', ...args)
}

function applyDisplayMediaHandler() {
  const useSystemPicker =
    !silentCapture && (process.platform === 'win32' || process.platform === 'darwin')

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        })
        screenLog('display-media request', {
          silentCapture,
          useSystemPicker,
          platform: process.platform,
          sourceCount: sources.length,
        })

        const screenSource = sources.find((s) => s.id.startsWith('screen:')) ?? sources[0]
        if (!screenSource) {
          screenLog('no screen sources available — denying')
          callback({})
          return
        }

        screenLog('granting video source', { id: screenSource.id, name: screenSource.name })
        callback({ video: screenSource })
      } catch (err) {
        console.error('[ELECTRON_CAPTURE] handler failed', err)
        callback({})
      }
    },
    { useSystemPicker },
  )

  screenLog('display-media handler registered', { silentCapture, useSystemPicker })
}

export function setSilentDisplayMedia(enabled: boolean) {
  silentCapture = !!enabled
  applyDisplayMediaHandler()
}

export function registerDisplayMediaHandler() {
  applyDisplayMediaHandler()

  ipcMain.handle(IPC.displayMediaSetSilent, (_e, enabled: boolean) => {
    setSilentDisplayMedia(!!enabled)
    return { ok: true, silent: silentCapture }
  })
}
