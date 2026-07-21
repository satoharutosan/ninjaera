/**
 * Runs electron-builder for production packaging.
 *
 * CSC_IDENTITY_AUTO_DISCOVERY=false skips automatic certificate discovery
 * (especially macOS keychain). Windows unsigned builds use
 * win.signtoolOptions.sign → scripts/windows-sign-skip.cjs (see electron-builder.yml).
 *
 * FUTURE Soft Future code signing:
 *   remove the windows-sign-skip hook, set WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD
 *   (or CSC_*), then rebuild. Optionally drop CSC_IDENTITY_AUTO_DISCOVERY=false.
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
