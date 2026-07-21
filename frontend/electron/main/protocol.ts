/**
 * Custom privileged `app://` scheme.
 *  - Serves the built renderer (SPA) from out/renderer.
 *  - Proxies /api, /uploads, /externals to the backend server-side (no browser CORS),
 *    injecting the stored Bearer token.
 * This keeps the reused `api.ts` (relative `/api`) and `<img src="/uploads/..">` unchanged.
 */
import { protocol, net, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { CONNECTION_ERROR_MESSAGE } from '@shared-electron/backendEnv'
import { APP_SCHEME, APP_ORIGIN, BACKEND_URL, PROXY_PREFIXES } from './config'
import { getToken } from './store'

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

const CSP = [
  "default-src 'self' app:",
  "script-src 'self' 'unsafe-inline' app:",
  "style-src 'self' 'unsafe-inline' app: https://fonts.googleapis.com",
  "font-src 'self' app: https://fonts.gstatic.com data:",
  "img-src 'self' app: data: blob: https:",
  "media-src 'self' app: data: blob: mediastream: https:",
  "connect-src 'self' app: https: wss:",
  "frame-src 'none'",
].join('; ')

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ])
}

function isProxied(pathname: string): boolean {
  return PROXY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function rendererDir(): string {
  // Packaged: resources/app.asar/out/renderer ; dev build: <root>/out/renderer
  return path.join(app.getAppPath(), 'out', 'renderer')
}

function safeFilePath(pathname: string): string | null {
  const dir = rendererDir()
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '')
  if (rel === '' || rel.endsWith('/')) rel += 'index.html'
  const resolved = path.join(dir, rel)
  // Prevent path traversal outside the renderer dir.
  if (!resolved.startsWith(dir)) return null
  return resolved
}

export function handleAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    const pathname = url.pathname

    // ── Proxy backend paths (server-side, no CORS) ──
    if (isProxied(pathname)) {
      const target = `${BACKEND_URL}${pathname}${url.search}`
      const headers = new Headers(request.headers)
      headers.delete('host')
      headers.delete('origin')
      const token = getToken()
      if (token) headers.set('Authorization', `Bearer ${token}`)
      try {
        const proxied = new Request(target, {
          method: request.method,
          headers,
          body: request.body,
          // @ts-expect-error Node/Electron fetch streaming flag
          duplex: 'half',
          redirect: 'follow',
        })
        return await net.fetch(proxied)
      } catch {
        return new Response(JSON.stringify({ error: CONNECTION_ERROR_MESSAGE, offline: true }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // ── Serve renderer assets (SPA fallback to index.html) ──
    let filePath = safeFilePath(pathname)
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(rendererDir(), 'index.html')
    }
    try {
      const data = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const contentType = MIME[ext] || 'application/octet-stream'
      const headers: Record<string, string> = { 'Content-Type': contentType }
      if (ext === '.html') headers['Content-Security-Policy'] = CSP
      return new Response(data, { status: 200, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

export { APP_ORIGIN }
