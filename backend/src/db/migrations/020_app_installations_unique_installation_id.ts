import type { Migration } from "./runner.js";

/**
 * Restore uniqueness on installation_id (one row per desktop install).
 * Replaces migration 017's unique-(app_id, ip) model that created duplicates
 * whenever the same install appeared from a new IP.
 */
export const migration020: Migration = {
  id: "020_app_installations_unique_installation_id",
  async upSqlite(db) {
    // Drop IP-based uniqueness from 017 (ignore if already gone).
    await db.exec(`DROP INDEX IF EXISTS idx_app_installations_app_ip`);
    await db.exec(`DROP INDEX IF EXISTS idx_app_installations_app_iid_no_ip`);

    // Keep the newest row per installation_id; delete older duplicates.
    await db.exec(`
      DELETE FROM app_installations
      WHERE id IN (
        SELECT a.id
        FROM app_installations a
        INNER JOIN app_installations b
          ON a.installation_id = b.installation_id
         AND (
           COALESCE(a.updated_at, a.created_at) < COALESCE(b.updated_at, b.created_at)
           OR (
             COALESCE(a.updated_at, a.created_at) = COALESCE(b.updated_at, b.created_at)
             AND a.id < b.id
           )
         )
      )
    `);

    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_app_installations_installation_id
        ON app_installations(installation_id)
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_installations_ip ON app_installations(ip_address)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_installations_updated ON app_installations(updated_at)`);
  },
  async upPostgres(db) {
    await db.exec(`DROP INDEX IF EXISTS idx_app_installations_app_ip`);
    await db.exec(`DROP INDEX IF EXISTS idx_app_installations_app_iid_no_ip`);

    // Drop leftover UNIQUE(app_id, installation_id) from 014 if still present.
    await db.exec(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'app_installations'::regclass
            AND contype = 'u'
            AND pg_get_constraintdef(oid) LIKE '%installation_id%'
        ) THEN
          EXECUTE (
            SELECT 'ALTER TABLE app_installations DROP CONSTRAINT ' || quote_ident(conname)
            FROM pg_constraint
            WHERE conrelid = 'app_installations'::regclass
              AND contype = 'u'
              AND pg_get_constraintdef(oid) LIKE '%installation_id%'
            LIMIT 1
          );
        END IF;
      END $$;
    `);

    await db.exec(`
      DELETE FROM app_installations a
      USING app_installations b
      WHERE a.installation_id = b.installation_id
        AND (
          COALESCE(a.updated_at, a.created_at) < COALESCE(b.updated_at, b.created_at)
          OR (
            COALESCE(a.updated_at, a.created_at) = COALESCE(b.updated_at, b.created_at)
            AND a.id < b.id
          )
        )
    `);

    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_app_installations_installation_id
        ON app_installations(installation_id)
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_installations_ip ON app_installations(ip_address)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_installations_updated ON app_installations(updated_at)`);
  },
};
