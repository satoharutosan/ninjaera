/**
 * Intentional no-op Windows Authenticode sign hook for unsigned local/CI builds.
 *
 * electron-builder 25 always enters the signtool path when signAndEditExecutable
 * is enabled (needed for rcedit metadata/icon). Without CSC_LINK it would warn:
 *   "no signing info identified, signing is skipped"
 * Wiring this hook makes unsigned builds an explicit configuration choice instead.
 *
 * Also brands helper EXEs that electron-builder copies from vendor templates and
 * only "signs" (never icon-stamps) during packaging:
 *   - resources/elevate.exe     (NSIS elevation helper — afterSign is too early)
 *   - Update.exe                (Squirrel.Windows installer engine — owns the
 *                               splash/taskbar while Setup.exe runs)
 *   - *stub*.exe                (Squirrel execution stubs)
 *
 * Without embedded icons, Windows shows the generic EXE glyph on the taskbar.
 *
 * When Soft Future provides a code signing certificate:
 *   1. Remove win.signtoolOptions.sign from electron-builder.yml
 *   2. Set WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (or CSC_LINK / CSC_KEY_PASSWORD)
 *   3. Optionally set forceCodeSigning: true in release CI
 *   4. Keep this branding step (or move it) so helpers still get icon.ico
 */
"use strict";

const path = require("path");
const { brandWindowsExecutable, resolveIconPath } = require("./brand-windows-exe.cjs");

/** @type {Set<string>} */
const brandedOnce = new Set();

function helperBrandSpec(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base === "elevate.exe") {
    return {
      originalFilename: "elevate.exe",
      fileDescription: "Ninja Era Messenger elevation helper",
    };
  }
  if (base === "update.exe") {
    return {
      originalFilename: "Update.exe",
      fileDescription: "Ninja Era Messenger installer",
    };
  }
  // Squirrel temp stubs: "1-stub.exe", "StubExecutable.exe", etc.
  if (base.includes("stub") && base.endsWith(".exe")) {
    return {
      originalFilename: path.basename(filePath),
      fileDescription: "Ninja Era Messenger",
    };
  }
  return null;
}

module.exports = async function skipWindowsSign(configuration, packager) {
  if (configuration && configuration.cscInfo) {
    throw new Error(
      "A Windows code signing certificate is configured, but win.signtoolOptions.sign " +
        "still points at scripts/windows-sign-skip.cjs. Remove that sign hook so " +
        "electron-builder can sign with the certificate.",
    );
  }

  const filePath = configuration && configuration.path;
  const spec = filePath ? helperBrandSpec(filePath) : null;
  if (spec) {
    const projectDir =
      (packager && packager.projectDir) || path.join(__dirname, "..");
    const iconPath = resolveIconPath(projectDir);
    const key = path.resolve(filePath);
    // Sign may run once per hash algorithm — brand only the first time per path.
    if (!brandedOnce.has(key)) {
      brandedOnce.add(key);
      await brandWindowsExecutable(filePath, iconPath, spec);
    }
  }
  // Intentionally unsigned until Soft Future provides a certificate.
};
