/**
 * Shared Windows PE branding via electron-builder's bundled rcedit.
 * Used by afterSign (app + elevate helper) and afterAllArtifactBuild (Setup.exe).
 */
"use strict";

const path = require("path");
const fs = require("fs");

const PRODUCT_NAME = "Ninja Era Messenger";
const COMPANY_NAME = "Soft Future";
const FILE_DESCRIPTION = "Official desktop messaging application for Ninja Era.";

/**
 * @param {string} exePath absolute path to .exe
 * @param {string} iconPath absolute path to .ico (may be missing)
 * @param {{ originalFilename?: string, fileDescription?: string }} [opts]
 */
async function brandWindowsExecutable(exePath, iconPath, opts = {}) {
  if (!fs.existsSync(exePath)) {
    console.warn("[brand-exe] missing, skip:", exePath);
    return false;
  }

  const { executeAppBuilder } = require("builder-util");
  const originalFilename = opts.originalFilename || path.basename(exePath);
  const fileDescription = opts.fileDescription || FILE_DESCRIPTION;

  const rceditArgs = [
    exePath,
    "--set-version-string",
    "ProductName",
    PRODUCT_NAME,
    "--set-version-string",
    "CompanyName",
    COMPANY_NAME,
    "--set-version-string",
    "FileDescription",
    fileDescription,
    "--set-version-string",
    "InternalName",
    originalFilename.replace(/\.exe$/i, ""),
    "--set-version-string",
    "OriginalFilename",
    originalFilename,
    "--set-version-string",
    "LegalCopyright",
    "Copyright (c) 2026 Soft Future. All rights reserved.",
  ];

  if (iconPath && fs.existsSync(iconPath)) {
    rceditArgs.push("--set-icon", iconPath);
  } else {
    console.warn("[brand-exe] icon missing — EXE may show generic taskbar icon:", iconPath);
  }

  await executeAppBuilder(["rcedit", "--args", JSON.stringify(rceditArgs)], undefined, {}, 3);
  console.info("[brand-exe] branded:", path.basename(exePath));
  return true;
}

function resolveIconPath(projectDir) {
  return path.join(projectDir, "build", "icon.ico");
}

module.exports = {
  brandWindowsExecutable,
  resolveIconPath,
  PRODUCT_NAME,
  COMPANY_NAME,
  FILE_DESCRIPTION,
};
