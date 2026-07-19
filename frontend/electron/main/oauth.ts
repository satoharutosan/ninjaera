/**
 * Desktop OAuth without backend changes: open the backend's OAuth start URL in a
 * child window, let the provider + backend complete the flow, then intercept the
 * redirect to the website's #/oauth-callback?code=... and extract the one-time code.
 * The renderer exchanges it via POST /api/auth/oauth/exchange.
 */
import { BrowserWindow } from 'electron'
import { BACKEND_URL } from './config'
import type { OAuthResult } from '@shared-electron/ipc'

const VALID_PROVIDERS = new Set(['google', 'github', 'discord'])

function extractCode(rawUrl: string): string | null {
  if (!rawUrl.includes('oauth-callback')) return null
  try {
    // Code may live in the search (?code=) or in the hash query (#/oauth-callback?code=).
    const url = new URL(rawUrl)
    const fromSearch = url.searchParams.get('code')
    if (fromSearch) return fromSearch
    const hash = url.hash || ''
    const qIndex = hash.indexOf('?')
    if (qIndex >= 0) {
      const params = new URLSearchParams(hash.slice(qIndex + 1))
      return params.get('code')
    }
    return null
  } catch {
    const match = rawUrl.match(/[?&#]code=([^&]+)/)
    return match ? decodeURIComponent(match[1]) : null
  }
}

export function startOAuth(provider: string, parent: BrowserWindow | null): Promise<OAuthResult> {
  if (!VALID_PROVIDERS.has(provider)) {
    return Promise.resolve({ error: 'Unsupported provider' })
  }

  return new Promise<OAuthResult>((resolve) => {
    let settled = false
    const finish = (result: OAuthResult) => {
      if (settled) return
      settled = true
      resolve(result)
      if (!authWindow.isDestroyed()) authWindow.close()
    }

    const authWindow = new BrowserWindow({
      width: 520,
      height: 680,
      parent: parent ?? undefined,
      modal: !!parent,
      autoHideMenuBar: true,
      title: 'Sign in',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'oauth-flow',
      },
    })

    const onNavigate = (_e: Electron.Event, url: string) => {
      const code = extractCode(url)
      if (code) finish({ code })
    }

    authWindow.webContents.on('will-redirect', onNavigate)
    authWindow.webContents.on('will-navigate', onNavigate)
    authWindow.webContents.on('did-navigate', onNavigate)

    authWindow.on('closed', () => {
      if (!settled) resolve({ error: 'Sign-in window closed' })
      settled = true
    })

    void authWindow.loadURL(`${BACKEND_URL}/api/auth/oauth/${provider}`)
  })
}
