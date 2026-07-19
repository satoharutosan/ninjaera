/**
 * Dual-database entrypoint.
 *
 * - `db` — sync better-sqlite3 Database when DATABASE_PROVIDER=sqlite (default).
 *           Existing routes/services continue to work unchanged on SQLite.
 * - `dbAsync` — portable async DatabaseAdapter (SQLite or PostgreSQL).
 *               Prefer this for new code and for PostgreSQL deployments.
 *
 * When DATABASE_PROVIDER=postgres, `db` is a sync-looking Proxy that throws
 * with a clear message if legacy sync APIs are used without migration.
 * Use `dbAsync` / repositories instead.
 */
import "../loadEnv.js";
import type Database from "better-sqlite3";
import type { DatabaseAdapter } from "./adapter.js";
import { createDatabaseAdapter, resolveDataDirectory, resolveSqlitePath } from "./factory.js";
import { getSqliteRaw } from "./providers/sqlite.js";

export type { DatabaseAdapter, DatabaseProviderName, RunResult, PreparedStatement } from "./adapter.js";
export { resolveDatabaseProvider, resolveSqlitePath, resolveDataDirectory } from "./factory.js";
export { getSqliteRaw } from "./providers/sqlite.js";

/** Portable async adapter — works for both SQLite and PostgreSQL. */
export const dbAsync: DatabaseAdapter = createDatabaseAdapter();

export const dataDirectory = resolveDataDirectory();
export const dbPath = dbAsync.provider === "sqlite" ? resolveSqlitePath() : "";

function createPostgresSyncShim(): Database.Database {
  const err = () => {
    throw new Error(
      "Sync db.* APIs are SQLite-only. With DATABASE_PROVIDER=postgres, use dbAsync (await dbAsync.get/all/run) or repositories.",
    );
  };
  return new Proxy({} as Database.Database, {
    get(_t, prop) {
      if (prop === "prepare") {
        return () => ({
          get: err,
          all: err,
          run: err,
        });
      }
      if (prop === "exec" || prop === "pragma" || prop === "transaction" || prop === "backup" || prop === "close") {
        return err;
      }
      return undefined;
    },
  });
}

/**
 * Sync database handle.
 * SQLite: real better-sqlite3 Database.
 * PostgreSQL: proxy that throws — migrate callers to dbAsync.
 */
export const db: Database.Database =
  (getSqliteRaw(dbAsync) as Database.Database | null) ?? createPostgresSyncShim();

export type UserRow = {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  avatar_url: string | null;
  gender: string;
  date_of_birth: string | null;
  country: string;
  city: string | null;
  status: string;
  bio: string;
  mood: string;
  member_since: string;
  village: string;
  clan: string;
  level: number;
  rank: string;
  is_npc: number;
  created_at: string;
  updated_at: string;
};

/** Schema bootstrap is handled by versioned migrations. */
export async function initSchema() {
  /* no-op — see runAllMigrations */
}
