/**
 * Invokes electron-builder with signing auto-discovery disabled.
 * Pair with electron-builder.yml `win.sign` no-op for an intentional unsigned build.
 *
 * FUTURE: when Soft Future code signing is ready, you may remove the
 * CSC_IDENTITY_AUTO_DISCOVERY=false assignment below (credentials via WIN_CSC_*),
 * and remove `win.signtoolOptions.sign: ./scripts/skip-windows-sign.cjs`
 * from electron-builder.yml.
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
