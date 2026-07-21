/**
 * Intentional no-op Windows sign hook for unsigned local/CI builds.
 *
 * electron-builder 25 always enters the signtool path when signAndEditExecutable
 * is enabled (needed for rcedit metadata/icon). Without CSC_LINK it would warn:
 *   "no signing info identified, signing is skipped"
 * Wiring this hook makes unsigned builds an explicit configuration choice instead.
 *
 * Resource editing (rcedit) and afterSign still run; only Authenticode signing is skipped.
 *
 * When Soft Future provides a code signing certificate:
 *   1. Remove win.signtoolOptions.sign from electron-builder.yml
 *   2. Set WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (or CSC_LINK / CSC_KEY_PASSWORD)
 *   3. Optionally set forceCodeSigning: true in release CI
 */
"use strict";

module.exports = async function skipWindowsSign(configuration) {
  if (configuration && configuration.cscInfo) {
    throw new Error(
      "A Windows code signing certificate is configured, but win.signtoolOptions.sign " +
        "still points at scripts/windows-sign-skip.cjs. Remove that sign hook so " +
        "electron-builder can sign with the certificate.",
    );
  }
  // Intentionally unsigned until Soft Future provides a certificate.
};
