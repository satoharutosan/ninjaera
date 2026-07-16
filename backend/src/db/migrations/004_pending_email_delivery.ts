import type { DatabaseAdapter } from "../adapter.js";
import type { Migration } from "./runner.js";

const COLUMNS: Array<{ name: string; definition: string }> = [
  { name: "email_status", definition: "TEXT DEFAULT 'queued'" },
  { name: "email_error", definition: "TEXT" },
  { name: "email_queued_at", definition: "TEXT" },
  { name: "last_email_attempt_at", definition: "TEXT" },
  { name: "email_sent_at", definition: "TEXT" },
];

async function columnExists(db: DatabaseAdapter, table: string, column: string): Promise<boolean> {
  const cols = await db.getColumns(table);
  return cols.some((c) => c.name === column);
}

async function addColumn(db: DatabaseAdapter, table: string, column: string, definition: string): Promise<void> {
  if (await columnExists(db, table, column)) return;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function addPendingEmailDeliveryColumns(db: DatabaseAdapter) {
  for (const c of COLUMNS) {
    await addColumn(db, "pending_registrations", c.name, c.definition);
  }
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pending_reg_email_status ON pending_registrations(email_status);
  `);
}

export const migration004: Migration = {
  id: "004_pending_email_delivery",
  async upSqlite(db) {
    await addPendingEmailDeliveryColumns(db);
  },
  async upPostgres(db) {
    await addPendingEmailDeliveryColumns(db);
  },
};
