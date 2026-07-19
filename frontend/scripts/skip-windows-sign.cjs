/**
 * Explicit Windows code-signing no-op for electron-builder.
 *
 * Using a custom `win.sign` hook (instead of omitting credentials) tells
 * electron-builder that signing is intentionally disabled — it will not search
 * the Windows certificate store or CSC_* / WIN_CSC_* environment variables, and
 * it will not emit the "no signing info identified" warning.
 *
 * Executable metadata (Product Name, Company, Copyright, Version, Icon) is still
 * written by electron-builder via `signAndEditExecutable` (rcedit/resedit).
 *
 * ── Enabling real code signing later ─────────────────────────────────────────
 * 1. Obtain a Soft Future Windows code-signing certificate (.pfx / OV / EV).
 * 2. Set environment variables (preferred — do not commit secrets):
 *      WIN_CSC_LINK=<path-or-base64-of-pfx>   (or CSC_LINK)
 *      WIN_CSC_KEY_PASSWORD=<pfx-password>    (or CSC_KEY_PASSWORD)
 * 3. In electron-builder.yml under `win.signtoolOptions:`:
 *      - Remove (or comment out) `sign: ./scripts/skip-windows-sign.cjs`
 *      - Keep `signAndEditExecutable: true`
 *      - Optionally set top-level `forceCodeSigning: true` so CI fails if signing breaks
 * 4. Rebuild with `npm run desktop:dist:win`
 *
 * No application source changes are required when activating signing.
 */
"use strict";

module.exports = async function skipWindowsSign(_configuration, _packager) {
  // Intentionally empty — unsigned production build by design.
  // Note: electron-builder may still print "signing with signtool.exe" before
  // calling this hook. That log line does not mean a certificate was used or
  // that signtool.exe was invoked — this function is the entire "sign" step.
};
