import path from "path";
import { fileURLToPath } from "url";
import type { DatabaseAdapter, DatabaseProviderName } from "./adapter.js";
import { createSqliteAdapter } from "./providers/sqlite.js";
import { createPostgresAdapter } from "./providers/postgres.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveDatabaseProvider(): DatabaseProviderName {
  const raw = (process.env.DATABASE_PROVIDER || "sqlite").trim().toLowerCase();
  if (raw === "postgres" || raw === "postgresql" || raw === "pg") return "postgres";
  return "sqlite";
}

export function resolveSqlitePath(): string {
  if (process.env.DATABASE_PATH) return path.resolve(process.env.DATABASE_PATH);
  return path.resolve(__dirname, "../../data/ninja-era.db");
}

export function resolveDataDirectory(): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  // Prefer parent of DATABASE_PATH when set, else backend/data
  if (process.env.DATABASE_PATH) return path.dirname(path.resolve(process.env.DATABASE_PATH));
  return path.resolve(__dirname, "../../data");
}

function resolvePostgresSsl(): boolean | { rejectUnauthorized: boolean } | undefined {
  const flag = (process.env.DATABASE_SSL || "").trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  if (flag === "true" || flag === "1" || flag === "require") {
    return { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" };
  }
  // Railway / managed PG typically need SSL
  const url = process.env.DATABASE_URL || "";
  if (/railway|render\.com|amazonaws|neon\.tech|supabase/i.test(url)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

/** Create the active database adapter from environment configuration. */
export function createDatabaseAdapter(): DatabaseAdapter {
  const provider = resolveDatabaseProvider();

  if (provider === "postgres") {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_PROVIDER=postgres requires DATABASE_URL to be set.",
      );
    }
    return createPostgresAdapter({
      connectionString,
      ssl: resolvePostgresSsl(),
      max: Number(process.env.DATABASE_POOL_MAX) || 10,
    });
  }

  return createSqliteAdapter({ dbPath: resolveSqlitePath() });
}
