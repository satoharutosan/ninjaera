/**
 * Thin query helpers that work on both providers.
 * Prefer these over raw better-sqlite3 for new / migrated code.
 */
import { db, dbAsync } from "./index.js";
import type { RunResult } from "./adapter.js";

export async function qGet<T = Record<string, unknown>>(
  sql: string,
  ...params: unknown[]
): Promise<T | undefined> {
  if (dbAsync.provider === "sqlite") {
    return db.prepare(sql).get(...params) as T | undefined;
  }
  return dbAsync.get<T>(sql, ...params);
}

export async function qAll<T = Record<string, unknown>>(
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  if (dbAsync.provider === "sqlite") {
    return db.prepare(sql).all(...params) as T[];
  }
  return dbAsync.all<T>(sql, ...params);
}

export async function qRun(sql: string, ...params: unknown[]): Promise<RunResult> {
  if (dbAsync.provider === "sqlite") {
    const r = db.prepare(sql).run(...params);
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
  }
  return dbAsync.run(sql, ...params);
}

export async function qExec(sql: string): Promise<void> {
  if (dbAsync.provider === "sqlite") {
    db.exec(sql);
    return;
  }
  await dbAsync.exec(sql);
}

export async function qTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return dbAsync.transaction(fn);
}

export function isSqlite(): boolean {
  return dbAsync.provider === "sqlite";
}

export function isPostgres(): boolean {
  return dbAsync.provider === "postgres";
}
