import pg from "pg";
import type {
  DatabaseAdapter,
  DbColumnInfo,
  DbTableSummary,
  PreparedStatement,
  RunResult,
} from "../adapter.js";
import { rewriteSqlForPostgres, toPostgresParams } from "../adapter.js";

const { Pool, types } = pg;

// BIGINT/BIGSERIAL (OID 20) arrive as strings by default — coerce to number so
// call auth, socket rooms, and message IDs compare correctly with JS numbers.
// Safe while primary keys stay within Number.MAX_SAFE_INTEGER.
types.setTypeParser(types.builtins.INT8, (v) => {
  if (v == null) return v;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
});

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

  /**
   * Cache of "does this table have an `id` column" so we only append
   * `RETURNING id` to INSERTs that can actually satisfy it. Tables like
   * `oauth_states` (PK = state), `password_reset_tokens` (PK = token_hash),
   * `user_settings`/`game_stats`/`user_locations` (PK = user_id) and all
   * composite-PK tables have no `id` column — appending RETURNING id there
   * raises: `column "id" does not exist`.
   */
  const hasIdColumnCache = new Map<string, boolean>();

  function insertTargetTable(sql: string): string | null {
    const m = sql.match(/INSERT\s+INTO\s+"?([A-Za-z_][A-Za-z0-9_$]*)"?/i);
    return m?.[1]?.toLowerCase() ?? null;
  }

  async function tableHasIdColumn(client: pg.Pool | pg.PoolClient, table: string): Promise<boolean> {
    const cached = hasIdColumnCache.get(table);
    if (cached !== undefined) return cached;
    const r = await client.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = 'id'
        LIMIT 1`,
      [table],
    );
    const has = r.rows.length > 0;
    hasIdColumnCache.set(table, has);
    return has;
  }

  /**
   * Turn opaque Postgres errors into actionable diagnostics. Common schema
   * problems (missing column / table) are logged with the offending SQL and a
   * suggested cause, then re-thrown so callers still see the failure.
   */
  function describeAndRethrow(err: unknown, sql: string, params: unknown[]): never {
    const e = err as { code?: string; message?: string; table?: string; column?: string };
    const schemaCodes: Record<string, string> = {
      "42703": "undefined_column — a query referenced a column the table does not have (schema mismatch / migration not applied)",
      "42P01": "undefined_table — the table does not exist (migration not executed)",
      "42P07": "duplicate_table — table already exists",
      "23505": "unique_violation — duplicate key",
      "23503": "foreign_key_violation — referenced row missing",
      "23502": "not_null_violation — required column was null",
    };
    if (e?.code && schemaCodes[e.code]) {
      console.error("[postgres] query failed —", schemaCodes[e.code]);
      console.error(`[postgres]   code: ${e.code}`);
      if (e.table) console.error(`[postgres]   table: ${e.table}`);
      if (e.column) console.error(`[postgres]   column: ${e.column}`);
      console.error(`[postgres]   sql: ${sql.replace(/\s+/g, " ").trim().slice(0, 300)}`);
      console.error(`[postgres]   params: ${JSON.stringify(params).slice(0, 200)}`);
    }
    throw err;
  }

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
      try {
        const r = await client.query(text, params);
        return (r.rows[0] as T) || undefined;
      } catch (err) {
        return describeAndRethrow(err, sql, params);
      }
    },

    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
      const client = adapter.__txClient || pool;
      const text = toPostgresParams(rewriteSqlForPostgres(sql));
      try {
        const r = await client.query(text, params);
        return r.rows as T[];
      } catch (err) {
        return describeAndRethrow(err, sql, params);
      }
    },

    async run(sql: string, ...params: unknown[]) {
      const client = adapter.__txClient || pool;
      let text = rewriteSqlForPostgres(sql);
      const upper = text.trim().toUpperCase();
      // Only request the generated key back when the target table actually has
      // an `id` column, mirroring SQLite's lastInsertRowid without breaking
      // inserts into tables keyed by something other than `id`.
      if (upper.startsWith("INSERT") && !/\bRETURNING\b/i.test(text)) {
        const table = insertTargetTable(text);
        if (table && (await tableHasIdColumn(client, table))) {
          text = text.replace(/;?\s*$/, "") + " RETURNING id";
        }
      }
      text = toPostgresParams(text);
      try {
        const r = await client.query(text, params);
        const rawId = r.rows?.[0]?.id;
        const numId = rawId != null ? Number(rawId) : NaN;
        return {
          changes: r.rowCount ?? 0,
          lastInsertRowid: Number.isFinite(numId) ? numId : 0,
        };
      } catch (err) {
        return describeAndRethrow(err, sql, params);
      }
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
