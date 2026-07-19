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

/** Discord-style custom status text (mood), separate from presence enum. */
export const migration010: Migration = {
  id: "010_user_mood",
  async upSqlite(db) {
    await addColumn(db, "users", "mood", "TEXT NOT NULL DEFAULT ''");
  },
  async upPostgres(db) {
    await addColumn(db, "users", "mood", "TEXT NOT NULL DEFAULT ''");
  },
};
