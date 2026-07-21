/**
 * afterSign: restore OriginalFilename.
 *
 * electron-builder's Windows rcedit pass sets OriginalFilename to "" by design.
 * This hook runs after that pass (signApp still completes for resource editing
 * even when Authenticode signing is skipped via windows-sign-skip.cjs).
 */
"use strict";

const path = require("path");
const fs = require("fs");

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "win32") return;

  const exeName = "NinjaEraMessenger.exe";
  const exePath = path.join(context.appOutDir, exeName);
  if (!fs.existsSync(exePath)) {
    console.warn("[afterSign] EXE not found, skip OriginalFilename:", exePath);
    return;
  }

  const { executeAppBuilder } = require("builder-util");
  await executeAppBuilder(
    [
      "rcedit",
      "--args",
      JSON.stringify([exePath, "--set-version-string", "OriginalFilename", exeName]),
    ],
    undefined,
    {},
    3,
  );
};
