/** Runtime configuration for the desktop client. */
import { app } from 'electron'
import {
  isProductionRuntime,
  resolveBackendUrl,
  resolveSignupUrl,
  resolveWebsiteUrl,
} from '@shared-electron/backendEnv'

const runtime = { isPackaged: app.isPackaged }

/** Active backend origin for REST, WebSocket, OAuth, and protocol proxy. */
export const BACKEND_URL = resolveBackendUrl(runtime)

/** Website signup page (hash-routed SPA). Opened in the system browser. */
export const SIGNUP_URL = resolveSignupUrl()

/** Base used to intercept the OAuth callback redirect (the website origin). */
export const WEBSITE_URL = resolveWebsiteUrl()

/** Whether the client is using production backend endpoints. */
export const IS_PRODUCTION_BACKEND = isProductionRuntime(runtime)

/** Custom privileged scheme that serves the renderer and same-origin API proxy. */
export const APP_SCHEME = 'app'
export const APP_HOST = 'ninja'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

/** Request path prefixes proxied to the backend (everything else is a static asset). */
export const PROXY_PREFIXES = ['/api', '/uploads', '/externals']
