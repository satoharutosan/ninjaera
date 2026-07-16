import zlib from "zlib";
import type { DatabaseAdapter, DatabaseProviderName } from "../adapter.js";
import { allMigrations } from "../migrations/index.js";
import { quoteIdent } from "./util.js";

/** Tables never included in a portable export (system / ephemeral auth state). */
export const PORTABLE_EXCLUDED_TABLES = new Set(["oauth_states", "schema_migrations"]);

export const PORTABLE_BACKUP_FORMAT = "ninja-era-portable-v1" as const;

export type PortableBackupTable = {
  columns: string[];
  rows: Record<string, unknown>[];
};

export type PortableBackup = {
  format: typeof PORTABLE_BACKUP_FORMAT;
  schemaVersion: string;
  sourceProvider: DatabaseProviderName;
  generatedAt: string;
  tables: Record<string, PortableBackupTable>;
  tableOrder: string[];
};

export function currentSchemaVersion(): string {
  const last = allMigrations[allMigrations.length - 1];
  if (!last) return "000";
  return last.id.split("_")[0] || "000";
}

/** Foreign-key dependency graph: table -> set of tables it references. */
async function getForeignKeyDependencies(
  dbAsync: DatabaseAdapter,
  tableNames: Set<string>,
): Promise<Map<string, Set<string>>> {
  const deps = new Map<string, Set<string>>();
  for (const t of tableNames) deps.set(t, new Set());

  if (dbAsync.provider === "sqlite") {
    for (const t of tableNames) {
      let rows: { table: string }[] = [];
      try {
        rows = await dbAsync.all<{ table: string }>(`PRAGMA foreign_key_list(${quoteIdent(t)})`);
      } catch {
        rows = [];
      }
      for (const r of rows) {
        if (r.table && r.table !== t && tableNames.has(r.table)) deps.get(t)!.add(r.table);
      }
    }
  } else {
    const rows = await dbAsync.all<{ table_name: string; ref_table: string }>(`
      SELECT cl.relname AS table_name, clf.relname AS ref_table
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_class clf ON clf.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'
    `);
    for (const r of rows) {
      if (r.table_name !== r.ref_table && tableNames.has(r.table_name) && tableNames.has(r.ref_table)) {
        deps.get(r.table_name)!.add(r.ref_table);
      }
    }
  }
  return deps;
}

/** Topologically sorts tables so referenced (parent) tables come before dependents. */
export function topoSortTables(tableNames: string[], deps: Map<string, Set<string>>): string[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const t of tableNames) {
    inDegree.set(t, 0);
    dependents.set(t, []);
  }
  for (const t of tableNames) {
    for (const dep of deps.get(t) || []) {
      if (!dependents.has(dep)) continue;
      inDegree.set(t, (inDegree.get(t) || 0) + 1);
      dependents.get(dep)!.push(t);
    }
  }

  const order: string[] = [];
  const seen = new Set<string>();
  let queue = tableNames.filter((t) => (inDegree.get(t) || 0) === 0).sort();

  while (queue.length) {
    queue.sort();
    const t = queue.shift()!;
    if (seen.has(t)) continue;
    seen.add(t);
    order.push(t);
    for (const dep of dependents.get(t) || []) {
      inDegree.set(dep, (inDegree.get(dep) || 0) - 1);
      if ((inDegree.get(dep) || 0) <= 0 && !seen.has(dep)) queue.push(dep);
    }
  }
  // Any tables left (FK cycles) are appended in their original order.
  for (const t of tableNames) if (!seen.has(t)) order.push(t);
  return order;
}

const ROW_CHUNK = 1000;

async function fetchAllRows(
  dbAsync: DatabaseAdapter,
  table: string,
  columns: string[],
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const orderCol = columns[0];
  let offset = 0;
  for (;;) {
    const chunk = await dbAsync.all<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdent(table)} ${orderCol ? `ORDER BY ${quoteIdent(orderCol)}` : ""} LIMIT ? OFFSET ?`,
      ROW_CHUNK,
      offset,
    );
    rows.push(...chunk);
    if (chunk.length < ROW_CHUNK) break;
    offset += ROW_CHUNK;
  }
  return rows;
}

/** Builds a provider-agnostic JSON snapshot of all user data, gzip-compressed. */
export async function exportPortableBackup(dbAsync: DatabaseAdapter): Promise<Buffer> {
  const allTables = await dbAsync.listTables();
  const tableNames = allTables.map((t) => t.name).filter((n) => !PORTABLE_EXCLUDED_TABLES.has(n));
  const nameSet = new Set(tableNames);

  const deps = await getForeignKeyDependencies(dbAsync, nameSet);
  const tableOrder = topoSortTables(tableNames, deps);

  const tables: Record<string, PortableBackupTable> = {};
  for (const table of tableOrder) {
    const columns = (await dbAsync.getColumns(table)).map((c) => c.name);
    const rows = await fetchAllRows(dbAsync, table, columns);
    tables[table] = { columns, rows };
  }

  const backup: PortableBackup = {
    format: PORTABLE_BACKUP_FORMAT,
    schemaVersion: currentSchemaVersion(),
    sourceProvider: dbAsync.provider,
    generatedAt: new Date().toISOString(),
    tables,
    tableOrder,
  };

  const json = JSON.stringify(backup);
  return zlib.gzipSync(Buffer.from(json, "utf8"));
}
