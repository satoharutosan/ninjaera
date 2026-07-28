import crypto from "crypto";
import type { DatabaseAdapter } from "../adapter.js";
import type { Migration } from "./runner.js";

async function columnExists(db: DatabaseAdapter, table: string, column: string): Promise<boolean> {
  const cols = await db.getColumns(table);
  return cols.some((c) => c.name === column);
}

async function addColumn(db: DatabaseAdapter, table: string, column: string, definition: string): Promise<void> {
  if (!(await db.tableExists(table))) return;
  if (await columnExists(db, table, column)) return;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function backfillPublicSlugs(db: DatabaseAdapter): Promise<void> {
  if (!(await db.tableExists("resources"))) return;
  const rows = await db.all<{ id: number }>(
    `SELECT id FROM resources WHERE public_slug IS NULL OR TRIM(public_slug) = ''`,
  );
  for (const row of rows) {
    let candidate = String(row.id);
    // Extremely unlikely collision with a custom slug; retry with a suffix if needed.
    let n = 0;
    while (await db.get(`SELECT 1 as x FROM resources WHERE public_slug = ? AND id != ?`, candidate, row.id)) {
      n += 1;
      candidate = `${row.id}-${crypto.randomBytes(2).toString("hex")}`;
      if (n > 8) {
        candidate = crypto.randomBytes(6).toString("hex");
        break;
      }
    }
    await db.run(
      `UPDATE resources SET public_slug = ?, public_slug_display = ? WHERE id = ?`,
      candidate,
      candidate,
      row.id,
    );
  }
}

/** Public direct-download identifier for resources (`/resources/public/:slug`). */
export const migration023: Migration = {
  id: "023_resource_public_slug",
  async upSqlite(db) {
    await addColumn(db, "resources", "public_slug", "TEXT");
    await addColumn(db, "resources", "public_slug_display", "TEXT");
    await backfillPublicSlugs(db);
    await db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_public_slug ON resources(public_slug)`,
    );
  },
  async upPostgres(db) {
    await addColumn(db, "resources", "public_slug", "TEXT");
    await addColumn(db, "resources", "public_slug_display", "TEXT");
    await backfillPublicSlugs(db);
    await db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_public_slug ON resources(public_slug)`,
    );
  },
};
