import zlib from "zlib";
import type { DatabaseAdapter, DbColumnInfo } from "../adapter.js";
import { quoteIdent } from "./util.js";
import { PORTABLE_BACKUP_FORMAT, type PortableBackup } from "./portable.js";

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;
/** Cap decompressed portable backup size to mitigate gzip bombs (256 MiB). */
const MAX_PORTABLE_JSON_BYTES = 256 * 1024 * 1024;

/** Gunzips (if needed) and structurally validates a portable backup buffer. */
export function validatePortableBackup(buf: Buffer): PortableBackup {
  let json: Buffer;
  if (buf.length >= 2 && buf[0] === GZIP_MAGIC_0 && buf[1] === GZIP_MAGIC_1) {
    try {
      json = zlib.gunzipSync(buf, { maxOutputLength: MAX_PORTABLE_JSON_BYTES });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/maxOutputLength|too large|memory/i.test(msg)) {
        throw new Error("Backup expands beyond the allowed size limit");
      }
      throw new Error("Backup file is gzip-tagged but could not be decompressed");
    }
  } else {
    if (buf.length > MAX_PORTABLE_JSON_BYTES) {
      throw new Error("Backup exceeds the allowed size limit");
    }
    json = buf;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json.toString("utf8"));
  } catch {
    throw new Error("Backup file is not valid JSON");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { format?: unknown }).format !== PORTABLE_BACKUP_FORMAT
  ) {
    throw new Error("Not a recognized Ninja Era portable backup file");
  }

  const backup = parsed as PortableBackup;
  if (typeof backup.schemaVersion !== "string" || !backup.schemaVersion) {
    throw new Error("Backup is missing a schema version");
  }
  if (!backup.tables || typeof backup.tables !== "object") {
    throw new Error("Backup has no table data");
  }
  if (!Array.isArray(backup.tableOrder)) {
    throw new Error("Backup is missing table order metadata");
  }

  return backup;
}

export type RestorePortableOptions = {
  /** Delete existing rows before inserting (default true). */
  clearExisting?: boolean;
};

/** Best-effort reset of a PostgreSQL sequence after inserting rows with explicit ids. */
async function resetPostgresSequence(dbAsync: DatabaseAdapter, table: string, column: string): Promise<void> {
  try {
    const t = table.replace(/'/g, "''");
    const c = column.replace(/'/g, "''");
    await dbAsync.exec(`
      SELECT setval(
        pg_get_serial_sequence('${t}', '${c}'),
        COALESCE((SELECT MAX(${quoteIdent(column)}) FROM ${quoteIdent(table)}), 1),
        (SELECT MAX(${quoteIdent(column)}) FROM ${quoteIdent(table)}) IS NOT NULL
      )
    `);
  } catch {
    /* column has no owned sequence (or setval isn't applicable) — nothing to do */
  }
}

/**
 * Restores a portable backup into the CURRENT provider's database.
 * Caller is responsible for taking a safety backup first.
 */
export async function restorePortableBackup(
  dbAsync: DatabaseAdapter,
  backup: PortableBackup,
  options: RestorePortableOptions = {},
): Promise<void> {
  const clearExisting = options.clearExisting !== false;

  const existingTables = new Set((await dbAsync.listTables()).map((t) => t.name));
  const backupTableNames = Object.keys(backup.tables);
  const orderedFromBackup = backup.tableOrder.filter((t) => backupTableNames.includes(t));
  for (const t of backupTableNames) {
    if (!orderedFromBackup.includes(t)) orderedFromBackup.push(t);
  }
  // Only restore tables that exist in the current schema — tolerates
  // cross-provider restores where the target schema differs slightly.
  const restoreOrder = orderedFromBackup.filter((t) => existingTables.has(t));

  const currentColumns = new Map<string, DbColumnInfo[]>();
  for (const table of restoreOrder) {
    currentColumns.set(table, await dbAsync.getColumns(table));
  }

  if (dbAsync.provider === "sqlite") {
    // SQLite forbids toggling `foreign_keys` while a transaction is open.
    await dbAsync.exec("PRAGMA foreign_keys = OFF");
  }

  try {
    await dbAsync.transaction(async () => {
      if (dbAsync.provider === "postgres") {
        await dbAsync.exec("SET LOCAL session_replication_role = 'replica'");
      }

      if (clearExisting) {
        for (const table of [...restoreOrder].reverse()) {
          await dbAsync.run(`DELETE FROM ${quoteIdent(table)}`);
        }
      }

      for (const table of restoreOrder) {
        const entry = backup.tables[table];
        if (!entry || !entry.rows.length) continue;
        const validColNames = new Set((currentColumns.get(table) || []).map((c) => c.name));
        const columns = entry.columns.filter((c) => validColNames.has(c));
        if (!columns.length) continue;

        const placeholders = `(${columns.map(() => "?").join(", ")})`;
        let insertSql = `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) VALUES ${placeholders}`;
        if (dbAsync.provider === "postgres") {
          // Skip the adapter's default "RETURNING id" fallback (not every
          // table has an "id" column) — we don't need the inserted id here.
          insertSql += " RETURNING 1";
        }
        for (const row of entry.rows) {
          const vals = columns.map((c) => (row[c] === undefined ? null : row[c]));
          await dbAsync.run(insertSql, ...vals);
        }
      }

      if (dbAsync.provider === "postgres") {
        for (const table of restoreOrder) {
          for (const col of currentColumns.get(table) || []) {
            if (col.pk && col.type.toUpperCase().includes("INT")) {
              await resetPostgresSequence(dbAsync, table, col.name);
            }
          }
        }
      }
    });
  } finally {
    if (dbAsync.provider === "sqlite") {
      await dbAsync.exec("PRAGMA foreign_keys = ON");
    }
  }
}
