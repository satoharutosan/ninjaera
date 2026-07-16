import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type {
  DatabaseAdapter,
  DbColumnInfo,
  DbTableSummary,
  PreparedStatement,
  RunResult,
} from "../adapter.js";

export type SqliteProviderOptions = {
  dbPath: string;
};

export function createSqliteAdapter(opts: SqliteProviderOptions): DatabaseAdapter {
  const dir = path.dirname(opts.dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const raw = new Database(opts.dbPath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  function prepare(sql: string): PreparedStatement {
    const stmt = raw.prepare(sql);
    return {
      async get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined> {
        return stmt.get(...params) as T | undefined;
      },
      async all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]> {
        return stmt.all(...params) as T[];
      },
      async run(...params: unknown[]): Promise<RunResult> {
        const r = stmt.run(...params);
        return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
      },
    };
  }

  const adapter: DatabaseAdapter = {
    provider: "sqlite",
    engineLabel: "SQLite",

    async getVersion() {
      const row = raw.prepare("SELECT sqlite_version() as v").get() as { v: string };
      return row?.v || "unknown";
    },

    async getSizeBytes() {
      let size = 0;
      try {
        size += fs.statSync(opts.dbPath).size;
      } catch { /* */ }
      try {
        size += fs.statSync(`${opts.dbPath}-wal`).size;
      } catch { /* */ }
      return size;
    },

    prepare,

    async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      return prepare(sql).get<T>(...params);
    },

    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      return prepare(sql).all<T>(...params);
    },

    async run(sql: string, ...params: unknown[]) {
      return prepare(sql).run(...params);
    },

    async exec(sql: string) {
      raw.exec(sql);
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      // better-sqlite3 transactions are sync; bridge async work carefully.
      raw.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn();
        raw.exec("COMMIT");
        return result;
      } catch (e) {
        try { raw.exec("ROLLBACK"); } catch { /* */ }
        throw e;
      }
    },

    async listTables(): Promise<DbTableSummary[]> {
      const rows = raw.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name COLLATE NOCASE
      `).all() as { name: string }[];
      return rows.map((r) => {
        const count = (raw.prepare(`SELECT COUNT(*) as c FROM "${r.name.replace(/"/g, '""')}"`).get() as { c: number }).c;
        return { name: r.name, rowCount: count };
      });
    },

    async tableExists(name: string) {
      const row = raw.prepare(`
        SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ?
      `).get(name);
      return !!row;
    },

    async getColumns(table: string): Promise<DbColumnInfo[]> {
      const cols = raw.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as {
        name: string; type: string; notnull: number; dflt_value: string | null; pk: number;
      }[];
      return cols.map((c) => ({
        name: c.name,
        type: (c.type || "TEXT").toUpperCase(),
        notnull: c.notnull === 1,
        dfltValue: c.dflt_value,
        pk: c.pk > 0,
      }));
    },

    async close() {
      raw.close();
    },

    async nativeBackup(destPath: string) {
      raw.pragma("wal_checkpoint(TRUNCATE)");
      await raw.backup(destPath);
    },

    async checkpoint() {
      raw.pragma("wal_checkpoint(TRUNCATE)");
    },
  };

  // Expose raw handle for legacy sync paths during migration (SQLite only).
  (adapter as DatabaseAdapter & { __raw?: Database.Database }).__raw = raw;
  return adapter;
}

/** Access the underlying better-sqlite3 Database when provider is SQLite. */
export function getSqliteRaw(adapter: DatabaseAdapter): Database.Database | null {
  return (adapter as DatabaseAdapter & { __raw?: Database.Database }).__raw ?? null;
}
