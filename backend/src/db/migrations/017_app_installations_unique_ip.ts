import type { Migration } from "./runner.js";

/**
 * Deduplicate app installations by (app_id, ip_address) and add updated_at.
 * Replaces UNIQUE(app_id, installation_id) with UNIQUE(app_id, ip_address)
 * (partial for non-empty IPs). Null/empty IPs keep a soft uniqueness on
 * (app_id, installation_id) via a separate unique index where IP is missing.
 */
export const migration017: Migration = {
  id: "017_app_installations_unique_ip",
  async upSqlite(db) {
    await db.exec(`ALTER TABLE app_installations ADD COLUMN updated_at TEXT`);
    await db.exec(`UPDATE app_installations SET updated_at = created_at WHERE updated_at IS NULL`);

    // Keep the newest row per (app_id, ip); delete older duplicates.
    await db.exec(`
      DELETE FROM app_installations
      WHERE id NOT IN (
        SELECT MAX(id) FROM app_installations
        WHERE ip_address IS NOT NULL AND TRIM(ip_address) != ''
        GROUP BY app_id, ip_address
      )
      AND ip_address IS NOT NULL AND TRIM(ip_address) != ''
    `);

    // Drop old unique on (app_id, installation_id) by rebuilding the table
    // (SQLite cannot DROP CONSTRAINT on inline UNIQUE easily).
    await db.exec(`
      CREATE TABLE app_installations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id TEXT NOT NULL,
        app_name TEXT,
        app_version TEXT,
        build_version TEXT,
        release_channel TEXT,
        installation_id TEXT NOT NULL,
        user_id INTEGER,
        username TEXT,
        user_role TEXT,
        is_anonymous INTEGER NOT NULL DEFAULT 1,
        ip_address TEXT,
        country TEXT,
        country_code TEXT,
        operating_system TEXT,
        platform TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        user_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    await db.exec(`
      INSERT INTO app_installations_new (
        id, app_id, app_name, app_version, build_version, release_channel, installation_id,
        user_id, username, user_role, is_anonymous,
        ip_address, country, country_code, operating_system, platform, status, user_agent,
        created_at, updated_at
      )
      SELECT
        id, app_id, app_name, app_version, build_version, release_channel, installation_id,
        user_id, username, user_role, is_anonymous,
        ip_address, country, country_code, operating_system, platform, status, user_agent,
        created_at, COALESCE(updated_at, created_at)
      FROM app_installations;
    `);
    await db.exec(`DROP TABLE app_installations`);
    await db.exec(`ALTER TABLE app_installations_new RENAME TO app_installations`);

    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_app_installations_app_ip
        ON app_installations(app_id, ip_address)
        WHERE ip_address IS NOT NULL AND TRIM(ip_address) != '';
    `);
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_app_installations_app_iid_no_ip
        ON app_installations(app_id, installation_id)
        WHERE ip_address IS NULL OR TRIM(ip_address) = '';
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_installations_app ON app_installations(app_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_installations_created ON app_installations(created_at)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_installations_updated ON app_installations(updated_at)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_installations_user ON app_installations(user_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_installations_status ON app_installations(status)`);
  },
  async upPostgres(db) {
    await db.exec(`ALTER TABLE app_installations ADD COLUMN IF NOT EXISTS updated_at TEXT`);
    await db.exec(`UPDATE app_installations SET updated_at = created_at WHERE updated_at IS NULL`);

    await db.exec(`
      DELETE FROM app_installations a
      USING app_installations b
      WHERE a.app_id = b.app_id
        AND a.ip_address IS NOT NULL AND TRIM(a.ip_address) != ''
        AND b.ip_address IS NOT NULL AND TRIM(b.ip_address) != ''
        AND a.ip_address = b.ip_address
        AND a.id < b.id
    `);

    await db.exec(`
      ALTER TABLE app_installations DROP CONSTRAINT IF EXISTS app_installations_app_id_installation_id_key
    `);
    // Also try common auto-named unique constraint
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_app_installations_app_ip
        ON app_installations(app_id, ip_address)
        WHERE ip_address IS NOT NULL AND TRIM(ip_address) != ''
    `);
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_app_installations_app_iid_no_ip
        ON app_installations(app_id, installation_id)
        WHERE ip_address IS NULL OR TRIM(ip_address) = ''
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_installations_updated ON app_installations(updated_at)`);
  },
};
