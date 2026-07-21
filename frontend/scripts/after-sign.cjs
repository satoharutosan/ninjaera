/**
 * afterSign: restore OriginalFilename and re-embed the Windows app icon.
 *
 * electron-builder's Windows rcedit pass sets OriginalFilename to "" by design.
 * Re-applying icon.ico here guards against a missing/stale EXE icon that would
 * show the default Electron glyph in the taskbar, Alt+Tab, and shortcuts.
 */
"use strict";

const path = require("path");
const fs = require("fs");

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "win32") return;

  const exeName = "NinjaEraMessenger.exe";
  const exePath = path.join(context.appOutDir, exeName);
  if (!fs.existsSync(exePath)) {
    console.warn("[afterSign] EXE not found, skip rcedit:", exePath);
    return;
  }

  const iconPath = path.join(context.packager.projectDir, "build", "icon.ico");
  if (!fs.existsSync(iconPath)) {
    console.warn("[afterSign] build/icon.ico missing — taskbar may show default icon:", iconPath);
  }

  const { executeAppBuilder } = require("builder-util");
  const rceditArgs = [exePath, "--set-version-string", "OriginalFilename", exeName];
  if (fs.existsSync(iconPath)) {
    rceditArgs.push("--set-icon", iconPath);
  }

  await executeAppBuilder(
    ["rcedit", "--args", JSON.stringify(rceditArgs)],
    undefined,
    {},
    3,
  );
};
