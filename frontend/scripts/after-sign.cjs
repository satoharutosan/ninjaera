/**
 * afterSign: brand the main app EXE and the NSIS elevation helper.
 *
 * electron-builder copies `elevate.exe` (Johannes Passing) into
 * resources/elevate.exe with NO icon resources. Windows then shows the
 * generic executable glyph whenever that helper owns a taskbar button
 * (elevation / per-machine install paths). Re-embed icon.ico + Soft Future
 * VERSIONINFO so every PE that can appear on the taskbar is branded.
 *
 * Also restores OriginalFilename on the main EXE (electron-builder clears it).
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { brandWindowsExecutable, resolveIconPath } = require("./brand-windows-exe.cjs");

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "win32") return;

  const iconPath = resolveIconPath(context.packager.projectDir);
  if (!fs.existsSync(iconPath)) {
    console.warn("[afterSign] build/icon.ico missing — taskbar may show default icon:", iconPath);
  }

  const exeName = "NinjaEraMessenger.exe";
  const exePath = path.join(context.appOutDir, exeName);
  await brandWindowsExecutable(exePath, iconPath, { originalFilename: exeName });

  // Elevation helper packaged into resources/ (and into the NSIS payload).
  const elevatePath = path.join(context.appOutDir, "resources", "elevate.exe");
  if (fs.existsSync(elevatePath)) {
    await brandWindowsExecutable(elevatePath, iconPath, {
      originalFilename: "elevate.exe",
      fileDescription: "Ninja Era Messenger elevation helper",
    });
  } else {
    console.info("[afterSign] elevate.exe not present (packElevateHelper skipped) — ok");
  }
};
