/** Shared database adapter types for SQLite and PostgreSQL. */

export type DatabaseProviderName = "sqlite" | "postgres";

export type RunResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

export type DbColumnInfo = {
  name: string;
  type: string;
  notnull: boolean;
  dfltValue: string | null;
  pk: boolean;
};

export type DbTableSummary = {
  name: string;
  rowCount: number;
};

export interface PreparedStatement {
  get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<RunResult>;
}

export interface DatabaseAdapter {
  readonly provider: DatabaseProviderName;
  /** Human-readable engine label for admin UI. */
  readonly engineLabel: string;
  /** Engine version string when available. */
  getVersion(): Promise<string>;
  /** Approximate on-disk / reported size in bytes (best-effort). */
  getSizeBytes(): Promise<number>;

  prepare(sql: string): PreparedStatement;
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  /** List user tables (excludes system catalogs). */
  listTables(): Promise<DbTableSummary[]>;
  tableExists(name: string): Promise<boolean>;
  getColumns(table: string): Promise<DbColumnInfo[]>;

  /** Close connections / file handles. */
  close(): Promise<void>;

  /** Native backup helpers (provider-specific). */
  nativeBackup?(destPath: string): Promise<void>;
  /** SQLite-only: WAL checkpoint. */
  checkpoint?(): Promise<void>;
}

/** Convert `?` placeholders to `$1..$n` for PostgreSQL. */
export function toPostgresParams(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Light SQL portability rewrites for common SQLite idioms.
 * Complex statements should already use portable SQL.
 */
export function rewriteSqlForPostgres(sql: string): string {
  let s = sql;
  // INSERT OR IGNORE INTO t (...) VALUES (...) → ON CONFLICT DO NOTHING
  s = s.replace(
    /\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi,
    "INSERT INTO",
  );
  if (/\bINSERT\s+INTO\b/i.test(s) && /\bOR\s+IGNORE\b/i.test(sql) && !/\bON\s+CONFLICT\b/i.test(s)) {
    s = s.replace(/;?\s*$/, " ON CONFLICT DO NOTHING");
  }
  // SQLite AUTOINCREMENT is not valid in PG DDL (handled in migrations).
  s = s.replace(/\bAUTOINCREMENT\b/gi, "");
  // COLLATE NOCASE is SQLite-only — approximate with LOWER(...) when used in ORDER BY.
  s = s.replace(/\bORDER\s+BY\s+([a-zA-Z0-9_."]+)\s+COLLATE\s+NOCASE\b/gi, "ORDER BY LOWER($1)");
  return s;
}
