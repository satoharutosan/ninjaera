/** Routes file downloads to the configured folder, or prompts when asked. */
import { session } from 'electron'
import path from 'path'
import { getSettings } from './store'
import { showNotification } from './notifications'

export function initDownloads(): void {
  session.defaultSession.on('will-download', (_event, item) => {
    const s = getSettings()
    const suggested = path.join(s.downloads.folder, item.getFilename())
    if (s.downloads.askBeforeDownload) {
      // Not setting a save path makes Electron show the native Save dialog.
      item.setSaveDialogOptions({ defaultPath: suggested })
    } else {
      item.setSavePath(suggested)
    }
    item.once('done', (_e, state) => {
      if (state === 'completed') {
        void showNotification({
          title: 'Download complete',
          body: item.getFilename(),
          kind: 'generic',
          silent: true,
        })
      }
    })
  })
}
