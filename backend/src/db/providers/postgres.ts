import pg from "pg";
import type {
  DatabaseAdapter,
  DbColumnInfo,
  DbTableSummary,
  PreparedStatement,
  RunResult,
} from "../adapter.js";
import { rewriteSqlForPostgres, toPostgresParams } from "../adapter.js";

const { Pool } = pg;

export type PostgresProviderOptions = {
  connectionString: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  max?: number;
};

type TxCapable = DatabaseAdapter & {
  __txClient?: pg.PoolClient;
  __pool: pg.Pool;
};

export function createPostgresAdapter(opts: PostgresProviderOptions): DatabaseAdapter {
  const pool = new Pool({
    connectionString: opts.connectionString,
    ssl: opts.ssl,
    max: opts.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });

  pool.on("error", (err) => {
    console.error("[postgres] idle client error:", err.message);
  });

  const adapter: TxCapable = {
    provider: "postgres",
    engineLabel: "PostgreSQL",
    __pool: pool,

    async getVersion() {
      const client = adapter.__txClient || pool;
      const r = await client.query("SELECT version() as v");
      const v = String(r.rows[0]?.v || "unknown");
      const m = v.match(/PostgreSQL\s+([\d.]+)/i);
      return m?.[1] || v.slice(0, 80);
    },

    async getSizeBytes() {
      try {
        const r = await pool.query("SELECT pg_database_size(current_database()) as s");
        return Number(r.rows[0]?.s || 0);
      } catch {
        return 0;
      }
    },

    prepare(sql: string): PreparedStatement {
      return {
        async get<T = Record<string, unknown>>(...params: unknown[]) {
          return adapter.get<T>(sql, ...params);
        },
        async all<T = Record<string, unknown>>(...params: unknown[]) {
          return adapter.all<T>(sql, ...params);
        },
        async run(...params: unknown[]): Promise<RunResult> {
          return adapter.run(sql, ...params);
        },
      };
    },

    async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      const client = adapter.__txClient || pool;
      const text = toPostgresParams(rewriteSqlForPostgres(sql));
      const r = await client.query(text, params);
      return (r.rows[0] as T) || undefined;
    },

    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      const client = adapter.__txClient || pool;
      const text = toPostgresParams(rewriteSqlForPostgres(sql));
      const r = await client.query(text, params);
      return r.rows as T[];
    },

    async run(sql: string, ...params: unknown[]) {
      const client = adapter.__txClient || pool;
      let text = rewriteSqlForPostgres(sql);
      const upper = text.trim().toUpperCase();
      if (upper.startsWith("INSERT") && !/\bRETURNING\b/i.test(text)) {
        text = text.replace(/;?\s*$/, "") + " RETURNING id";
      }
      text = toPostgresParams(text);
      const r = await client.query(text, params);
      const id = r.rows?.[0]?.id;
      return {
        changes: r.rowCount ?? 0,
        lastInsertRowid: id != null ? Number(id) : 0,
      };
    },

    async exec(sql: string) {
      const client = adapter.__txClient || pool;
      await client.query(sql);
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const prev = adapter.__txClient;
      adapter.__txClient = client;
      try {
        await client.query("BEGIN");
        try {
          const result = await fn();
          await client.query("COMMIT");
          return result;
        } catch (e) {
          try { await client.query("ROLLBACK"); } catch { /* */ }
          throw e;
        }
      } finally {
        adapter.__txClient = prev;
        client.release();
      }
    },

    async listTables(): Promise<DbTableSummary[]> {
      const r = await pool.query(`
        SELECT tablename as name
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `);
      const out: DbTableSummary[] = [];
      for (const row of r.rows as { name: string }[]) {
        const c = await pool.query(`SELECT COUNT(*)::int as c FROM "${row.name.replace(/"/g, '""')}"`);
        out.push({ name: row.name, rowCount: Number(c.rows[0]?.c || 0) });
      }
      return out;
    },

    async tableExists(name: string) {
      const r = await pool.query(`
        SELECT 1 FROM pg_catalog.pg_tables
        WHERE schemaname = 'public' AND tablename = $1
      `, [name]);
      return r.rows.length > 0;
    },

    async getColumns(table: string): Promise<DbColumnInfo[]> {
      const r = await pool.query(`
        SELECT
          a.attname as name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
          a.attnotnull as notnull,
          pg_get_expr(ad.adbin, ad.adrelid) as dflt,
          CASE WHEN EXISTS (
            SELECT 1 FROM pg_constraint c
            WHERE c.conrelid = a.attrelid AND a.attnum = ANY (c.conkey) AND c.contype = 'p'
          ) THEN true ELSE false END as pk
        FROM pg_attribute a
        JOIN pg_class cl ON cl.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE n.nspname = 'public'
          AND cl.relname = $1
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY a.attnum
      `, [table]);
      return (r.rows as { name: string; type: string; notnull: boolean; dflt: string | null; pk: boolean }[]).map((c) => ({
        name: c.name,
        type: (c.type || "text").toUpperCase(),
        notnull: !!c.notnull,
        dfltValue: c.dflt,
        pk: !!c.pk,
      }));
    },

    async close() {
      await pool.end();
    },
  };

  return adapter;
}
