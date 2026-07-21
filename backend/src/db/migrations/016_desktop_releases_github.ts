import type { DatabaseAdapter } from "../adapter.js";
import type { Migration } from "./runner.js";

async function columnExists(db: DatabaseAdapter, table: string, column: string): Promise<boolean> {
  if (!(await db.tableExists(table))) return false;
  const cols = await db.getColumns(table);
  return cols.some((c) => c.name === column);
}

async function addColumn(db: DatabaseAdapter, table: string, column: string, definition: string): Promise<void> {
  if (!(await db.tableExists(table))) return;
  if (await columnExists(db, table, column)) return;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export const migration016: Migration = {
  id: "016_desktop_releases_github",
  async upSqlite(db) {
    await addColumn(db, "desktop_releases", "github_release_url", "TEXT");
  },
  async upPostgres(db) {
    await addColumn(db, "desktop_releases", "github_release_url", "TEXT");
    try {
      await db.exec(`ALTER TABLE desktop_releases ALTER COLUMN package_filename DROP NOT NULL`);
    } catch { /* already nullable */ }
    try {
      await db.exec(`ALTER TABLE desktop_releases ALTER COLUMN package_url DROP NOT NULL`);
    } catch { /* */ }
    try {
      await db.exec(`ALTER TABLE desktop_releases ALTER COLUMN sha1 DROP NOT NULL`);
    } catch { /* */ }
    try {
      await db.exec(`ALTER TABLE desktop_releases ALTER COLUMN sha256 DROP NOT NULL`);
    } catch { /* */ }
  },
};
