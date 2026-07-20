/**
 * Central backend URL configuration for the desktop client and dev tooling.
 * All networking services (REST, WebSocket, OAuth, uploads) resolve URLs from here.
 */

const trimSlash = (url: string): string => url.replace(/\/$/, '')

/** Default local backend used during development (`npm run desktop:dev`). */
export const DEFAULT_DEV_BACKEND_URL = 'http://localhost:3001'

/** Default hosted backend used in packaged production builds. */
export const DEFAULT_PROD_BACKEND_URL = 'https://ninjaera.up.railway.app'

/** User-facing message when the backend cannot be reached. Never include internal URLs. */
export const CONNECTION_ERROR_MESSAGE =
  'Unable to connect to the server. Please check your internet connection or try again later.'

export type RuntimeEnv = {
  /** Electron `app.isPackaged` — true for distributed executables. */
  isPackaged: boolean
}

function readDevBackendUrl(): string {
  return trimSlash(
    process.env.NINJA_BACKEND_URL_DEV
      || process.env.VITE_DEV_BACKEND_URL
      || DEFAULT_DEV_BACKEND_URL,
  )
}

function readProdBackendUrl(): string {
  return trimSlash(
    process.env.NINJA_BACKEND_URL_PROD
      || process.env.VITE_PROD_BACKEND_URL
      || DEFAULT_PROD_BACKEND_URL,
  )
}

/**
 * True when the desktop client should use production backend endpoints.
 * Packaged apps always use production; unpacked production builds use NODE_ENV.
 */
export function isProductionRuntime(env: RuntimeEnv): boolean {
  if (process.env.NINJA_BACKEND_URL) {
    return !/localhost|127\.0\.0\.1/i.test(process.env.NINJA_BACKEND_URL)
  }
  return env.isPackaged || process.env.NODE_ENV === 'production'
}

/** Resolve the active REST/WebSocket backend URL for the current runtime. */
export function resolveBackendUrl(env: RuntimeEnv): string {
  if (process.env.NINJA_BACKEND_URL) {
    return trimSlash(process.env.NINJA_BACKEND_URL)
  }
  return isProductionRuntime(env) ? readProdBackendUrl() : readDevBackendUrl()
}

/** Signup opens in the system browser — always points at the public website. */
export function resolveSignupUrl(): string {
  if (process.env.NINJA_SIGNUP_URL) return process.env.NINJA_SIGNUP_URL
  return `${readProdBackendUrl()}/#/signup`
}

/** Website origin used for OAuth callback interception. */
export function resolveWebsiteUrl(): string {
  return trimSlash(process.env.NINJA_WEBSITE_URL || readProdBackendUrl())
}

/** Dev-server proxy target (Vite / electron-vite). */
export function devProxyTarget(): string {
  return readDevBackendUrl()
}
