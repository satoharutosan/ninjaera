import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { DatabaseAdapter } from "../adapter.js";

function runProcess(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(
          `"${cmd}" is not installed or not on PATH. Use a portable backup/restore instead, ` +
          `or install the PostgreSQL client tools to enable native backups.`,
        ));
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

/**
 * Creates a native, provider-specific backup on disk.
 * - SQLite: uses the adapter's built-in `.backup()` (via better-sqlite3).
 * - PostgreSQL: shells out to `pg_dump` (plain SQL dump), if available.
 */
export async function createNativeBackup(dbAsync: DatabaseAdapter, destPath: string): Promise<void> {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (dbAsync.provider === "sqlite") {
    if (!dbAsync.nativeBackup) throw new Error("Native SQLite backup is not available on this adapter");
    await dbAsync.nativeBackup(destPath);
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set; cannot run pg_dump");

  await runProcess("pg_dump", [
    "-d", connectionString,
    "--no-owner",
    "--no-privileges",
    "-f", destPath,
  ]);
}

/**
 * Restores a native PostgreSQL SQL dump via `psql`. Throws a clear error
 * (suggesting a portable restore) if the client tools are unavailable.
 */
export async function restoreNativePostgresDump(sourcePath: string): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set; cannot run psql");

  await runProcess("psql", [
    "-d", connectionString,
    "-v", "ON_ERROR_STOP=1",
    "-f", sourcePath,
  ]);
}
