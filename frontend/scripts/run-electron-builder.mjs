/**
 * Runs electron-builder for production packaging.
 *
 * CSC_IDENTITY_AUTO_DISCOVERY=false is the supported way to skip automatic
 * certificate discovery (especially macOS keychain). Windows builds without
 * WIN_CSC_LINK / CSC_LINK remain unsigned; electron-builder may log
 * "no signing info identified, signing is skipped" — that is expected.
 *
 * FUTURE Soft Future code signing:
 *   set WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (or CSC_*), then rebuild.
 *   Optionally remove CSC_IDENTITY_AUTO_DISCOVERY=false once credentials exist.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const result = spawnSync("npx", ["electron-builder", ...args], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
