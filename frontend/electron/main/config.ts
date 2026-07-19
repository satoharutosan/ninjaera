/** Runtime configuration for the desktop client. */

export const BACKEND_URL = (process.env.NINJA_BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '')

/** Website signup page (hash-routed SPA). Opened in the system browser. */
export const SIGNUP_URL = process.env.NINJA_SIGNUP_URL || 'https://ninjaera.up.railway.app/#/signup'

/** Base used to intercept the OAuth callback redirect (the website origin). */
export const WEBSITE_URL = (process.env.NINJA_WEBSITE_URL || 'https://ninjaera.up.railway.app').replace(/\/$/, '')

/** Custom privileged scheme that serves the renderer and same-origin API proxy. */
export const APP_SCHEME = 'app'
export const APP_HOST = 'ninja'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

/** Request path prefixes proxied to the backend (everything else is a static asset). */
export const PROXY_PREFIXES = ['/api', '/uploads', '/externals']
