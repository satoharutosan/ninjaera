import type { DatabaseAdapter } from "../adapter.js";

export type Migration = {
  id: string;
  /** Apply on SQLite (and used as fallback). */
  upSqlite: (db: DatabaseAdapter) => Promise<void>;
  /** Apply on PostgreSQL. */
  upPostgres: (db: DatabaseAdapter) => Promise<void>;
};

async function ensureMigrationsTable(db: DatabaseAdapter) {
  if (db.provider === "postgres") {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
  }
}

export async function runVersionedMigrations(db: DatabaseAdapter, migrations: Migration[]) {
  await ensureMigrationsTable(db);

  for (const m of migrations) {
    const exists = await db.get<{ id: string }>("SELECT id FROM schema_migrations WHERE id = ?", m.id);
    if (exists) continue;

    console.log(`[db] applying migration ${m.id} (${db.provider})`);
    if (db.provider === "postgres") {
      await m.upPostgres(db);
    } else {
      await m.upSqlite(db);
    }
    const ts = new Date().toISOString();
    await db.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", m.id, ts);
  }
}
