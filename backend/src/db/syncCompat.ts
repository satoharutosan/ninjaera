/**
 * Sync better-sqlite3–compatible facade used when DATABASE_PROVIDER=sqlite.
 * Allows existing routes/services to keep using db.prepare().get/all/run without
 * a full rewrite, while the async DatabaseAdapter remains the portable API.
 *
 * When DATABASE_PROVIDER=postgres, this module is not used — callers must use
 * the async adapter (`await db.get/all/run`).
 */
import type Database from "better-sqlite3";
import type { DatabaseAdapter } from "./adapter.js";
import { getSqliteRaw } from "./providers/sqlite.js";

export type SyncDatabase = Database.Database;

/**
 * Returns the underlying better-sqlite3 Database when the active provider is SQLite.
 * Returns null for PostgreSQL.
 */
export function tryGetSyncSqlite(adapter: DatabaseAdapter): SyncDatabase | null {
  return getSqliteRaw(adapter);
}

/**
 * Require sync SQLite access. Throws if PostgreSQL is active.
 * Prefer migrating call sites to the async adapter.
 */
export function requireSyncSqlite(adapter: DatabaseAdapter): SyncDatabase {
  const raw = getSqliteRaw(adapter);
  if (!raw) {
    throw new Error(
      "This code path requires SQLite (sync). Set DATABASE_PROVIDER=sqlite or migrate to the async DatabaseAdapter API.",
    );
  }
  return raw;
}
