import { dbAsync } from "../db/index.js";

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Columns never returned or writable via the admin console. */
const SENSITIVE_COLUMNS = new Set([
  "password_hash",
  "password",
  "token",
  "secret",
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "oauth_state",
  "code_verifier",
  "token_version",
  "code_hash",
  "token_hash",
  "api_key",
]);

/** Privilege / authz columns — readable but not writable via console. */
const PRIVILEGE_COLUMNS = new Set([
  "is_admin",
  "is_team_member",
  "is_disabled",
  "is_deleted",
  "email_verified",
]);

/** Tables never exposed in the console (system / ephemeral auth state). */
const HIDDEN_TABLES = new Set([
  "sqlite_sequence",
  "sqlite_stat1",
  "oauth_states",
  "schema_migrations",
  "password_reset_tokens",
  "pending_registrations",
]);

export type DbColumnInfo = {
  name: string;
  type: string;
  notnull: boolean;
  dfltValue: string | null;
  pk: boolean;
  sensitive: boolean;
};

export type DbTableSummary = {
  name: string;
  rowCount: number;
};

function assertSafeIdent(name: string, label = "identifier"): string {
  if (!IDENT.test(name)) throw new Error(`Invalid ${label}`);
  return name;
}

function quoteIdent(name: string): string {
  return `"${assertSafeIdent(name).replace(/"/g, '""')}"`;
}

export function isSensitiveColumn(name: string): boolean {
  const n = name.toLowerCase();
  if (SENSITIVE_COLUMNS.has(n) || PRIVILEGE_COLUMNS.has(n)) return true;
  if (n.includes("password")) return true;
  if (n.endsWith("_hash")) return true;
  if (n.endsWith("_secret")) return true;
  if (n.endsWith("_token") && n !== "push_token") return true;
  return false;
}

export async function listManageableTables(): Promise<DbTableSummary[]> {
  const tables = await dbAsync.listTables();
  return tables
    .filter((t) => !HIDDEN_TABLES.has(t.name))
    .map((t) => ({ name: t.name, rowCount: t.rowCount }));
}

export async function ensureTableAllowed(table: string): Promise<string> {
  const name = assertSafeIdent(table, "table");
  if (HIDDEN_TABLES.has(name)) throw new Error("Table is not accessible");
  const exists = await dbAsync.tableExists(name);
  if (!exists) throw new Error("Table not found");
  return name;
}

export async function getTableColumns(table: string): Promise<DbColumnInfo[]> {
  const name = await ensureTableAllowed(table);
  const cols = await dbAsync.getColumns(name);
  return cols.map((c) => ({
    name: c.name,
    type: (c.type || "TEXT").toUpperCase(),
    notnull: c.notnull,
    dfltValue: c.dfltValue,
    pk: c.pk,
    sensitive: isSensitiveColumn(c.name),
  }));
}

async function writableColumns(table: string): Promise<DbColumnInfo[]> {
  const cols = await getTableColumns(table);
  return cols.filter((c) => !c.sensitive && !(c.pk && c.type.includes("INT")));
}

async function primaryKeyColumns(table: string): Promise<DbColumnInfo[]> {
  const cols = await getTableColumns(table);
  return cols.filter((c) => c.pk);
}

function maskRow(row: Record<string, unknown>, columns: DbColumnInfo[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    if (col.sensitive) {
      out[col.name] = row[col.name] == null || row[col.name] === "" ? null : "••••••••";
      continue;
    }
    out[col.name] = row[col.name];
  }
  return out;
}

export type ListRowsParams = {
  table: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  search?: string;
  columnFilters?: Record<string, string>;
};

export async function listTableRows(params: ListRowsParams) {
  const table = await ensureTableAllowed(params.table);
  const columns = await getTableColumns(table);
  const colNames = new Set(columns.map((c) => c.name));
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 50));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const vals: unknown[] = [];

  const search = (params.search || "").trim();
  if (search) {
    const searchable = columns.filter((c) => !c.sensitive);
    if (searchable.length) {
      where.push(`(${searchable.map((c) => `CAST(${quoteIdent(c.name)} AS TEXT) LIKE ?`).join(" OR ")})`);
      for (let i = 0; i < searchable.length; i++) vals.push(`%${search}%`);
    }
  }

  if (params.columnFilters) {
    for (const [key, raw] of Object.entries(params.columnFilters)) {
      if (!colNames.has(key) || isSensitiveColumn(key)) continue;
      const v = String(raw ?? "").trim();
      if (!v) continue;
      where.push(`CAST(${quoteIdent(key)} AS TEXT) LIKE ?`);
      vals.push(`%${v}%`);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  let orderSql = "";
  const sortBy = params.sortBy && colNames.has(params.sortBy) ? params.sortBy : null;
  const pkCols = columns.filter((c) => c.pk);
  if (sortBy && !isSensitiveColumn(sortBy)) {
    const dir = params.sortDir === "asc" ? "ASC" : "DESC";
    orderSql = `ORDER BY ${quoteIdent(sortBy)} ${dir}`;
  } else if (pkCols[0]) {
    orderSql = `ORDER BY ${quoteIdent(pkCols[0].name)} DESC`;
  }

  const totalRow = await dbAsync.get<{ c: number }>(
    `SELECT COUNT(*) as c FROM ${quoteIdent(table)} ${whereSql}`,
    ...vals,
  );
  const total = Number(totalRow?.c ?? 0);
  const rows = await dbAsync.all<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdent(table)} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    ...vals,
    limit,
    offset,
  );

  return {
    table,
    columns,
    rows: rows.map((r) => maskRow(r, columns)),
    total,
    page,
    limit,
    primaryKey: pkCols.map((c) => c.name),
  };
}

function coerceValue(col: DbColumnInfo, raw: unknown): unknown {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") {
    if (col.notnull && col.dfltValue == null && !col.pk) {
      throw new Error(`Column "${col.name}" is required`);
    }
    return null;
  }
  const t = col.type.toUpperCase();
  if (t.includes("INT")) {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`Column "${col.name}" must be an integer`);
    return Math.trunc(n);
  }
  if (t.includes("REAL") || t.includes("FLOAT") || t.includes("DOUBLE") || t.includes("NUMERIC") || t.includes("DECIMAL")) {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`Column "${col.name}" must be a number`);
    return n;
  }
  return String(raw);
}

export async function insertTableRow(table: string, data: Record<string, unknown>) {
  const name = await ensureTableAllowed(table);
  const cols = (await getTableColumns(name)).filter((c) => !c.sensitive);
  // Skip autoincrement PK when omitted so the database can assign the id.
  const fields: string[] = [];
  const vals: unknown[] = [];
  for (const col of cols) {
    if (col.pk && col.type.includes("INT") && (data[col.name] === undefined || data[col.name] === null || data[col.name] === "")) {
      continue;
    }
    if (data[col.name] === undefined && !col.notnull) continue;
    if (data[col.name] === undefined && col.dfltValue != null) continue;
    fields.push(col.name);
    vals.push(coerceValue(col, data[col.name]));
  }
  if (!fields.length) throw new Error("No writable fields provided");

  const pkCols = cols.filter((c) => c.pk).map((c) => c.name);
  let sql = `INSERT INTO ${quoteIdent(name)} (${fields.map(quoteIdent).join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`;
  if (dbAsync.provider === "postgres") {
    // Avoid the adapter's default "RETURNING id" fallback, which assumes an
    // "id" column that not every table has (e.g. tables keyed by user_id).
    sql += pkCols.length ? ` RETURNING ${pkCols.map(quoteIdent).join(", ")}` : " RETURNING 1";
  }
  const result = await dbAsync.run(sql, ...vals);
  return { ok: true as const, id: Number(result.lastInsertRowid) || 0, changes: result.changes };
}

export async function updateTableRow(table: string, pk: Record<string, unknown>, data: Record<string, unknown>) {
  const name = await ensureTableAllowed(table);
  const columns = await getTableColumns(name);
  const pks = await primaryKeyColumns(name);
  if (!pks.length) throw new Error("Table has no primary key; updates are not supported");

  const whereParts: string[] = [];
  const whereVals: unknown[] = [];
  for (const col of pks) {
    if (pk[col.name] === undefined || pk[col.name] === null) {
      throw new Error(`Missing primary key "${col.name}"`);
    }
    whereParts.push(`${quoteIdent(col.name)} = ?`);
    whereVals.push(pk[col.name]);
  }

  const sets: string[] = [];
  const setVals: unknown[] = [];
  for (const col of columns) {
    if (col.sensitive || col.pk) continue;
    if (!(col.name in data)) continue;
    sets.push(`${quoteIdent(col.name)} = ?`);
    setVals.push(coerceValue(col, data[col.name]));
  }
  if (!sets.length) throw new Error("No fields to update");

  const result = await dbAsync.run(
    `UPDATE ${quoteIdent(name)} SET ${sets.join(", ")} WHERE ${whereParts.join(" AND ")}`,
    ...setVals,
    ...whereVals,
  );

  if (result.changes === 0) throw new Error("Row not found");
  return { ok: true as const, changes: result.changes };
}

export async function deleteTableRows(table: string, keys: Record<string, unknown>[]) {
  const name = await ensureTableAllowed(table);
  const pks = await primaryKeyColumns(name);
  if (!pks.length) throw new Error("Table has no primary key; deletes are not supported");
  if (!keys.length) throw new Error("No rows selected");

  const changes = await dbAsync.transaction(async () => {
    let total = 0;
    for (const row of keys) {
      const whereParts: string[] = [];
      const whereVals: unknown[] = [];
      for (const col of pks) {
        if (row[col.name] === undefined || row[col.name] === null) {
          throw new Error(`Missing primary key "${col.name}"`);
        }
        whereParts.push(`${quoteIdent(col.name)} = ?`);
        whereVals.push(row[col.name]);
      }
      const r = await dbAsync.run(`DELETE FROM ${quoteIdent(name)} WHERE ${whereParts.join(" AND ")}`, ...whereVals);
      total += r.changes;
    }
    return total;
  });

  return { ok: true as const, changes };
}

export { writableColumns };
