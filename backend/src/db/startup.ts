/**
 * Database startup: diagnostics, automatic migrations, and schema validation.
 *
 * On boot this module:
 *  1. Logs the active provider and engine version.
 *  2. Reports applied vs. pending migrations.
 *  3. Runs any pending migrations automatically (idempotent).
 *  4. Verifies every required table exists.
 *  5. Aborts startup with a clear, actionable error if the schema is incomplete.
 *
 * Works identically for SQLite and PostgreSQL through the shared adapter.
 */
import { dbAsync } from "./index.js";
import { allMigrations, runVersionedMigrations } from "./migrations/index.js";
import { qAll } from "./query.js";

/**
 * Tables the application requires to function. Derived from the versioned
 * migrations; kept explicit so a partially-applied migration is caught loudly
 * instead of surfacing later as a runtime "relation does not exist" error.
 */
const REQUIRED_TABLES = [
  "users",
  "user_settings",
  "game_stats",
  "achievements",
  "inventory_items",
  "notifications",
  "notification_reads",
  "conversations",
  "conversation_participants",
  "messages",
  "message_reactions",
  "blocks",
  "reports",
  "contact_tickets",
  "contact_replies",
  "newsletter_subscribers",
  "job_postings",
  "job_applications",
  "app_installations",
  "desktop_releases",
  "team_members",
  "resources",
  "characters",
  "password_reset_tokens",
  "user_locations",
  "dm_requests",
  "dm_contacts",
  "game_downloads",
  "activity_logs",
  "user_oauth_providers",
  "oauth_states",
  "admin_action_audits",
  "pending_registrations",
  "uploaded_assets",
];

async function appliedMigrationIds(): Promise<Set<string>> {
  const exists = await dbAsync.tableExists("schema_migrations");
  if (!exists) return new Set();
  try {
    const rows = await qAll<{ id: string }>("SELECT id FROM schema_migrations");
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}

async function missingTables(): Promise<string[]> {
  const missing: string[] = [];
  for (const t of REQUIRED_TABLES) {
    if (!(await dbAsync.tableExists(t))) missing.push(t);
  }
  return missing;
}

/**
 * Initialize the database: diagnostics → migrate → validate.
 * Throws if the schema cannot be brought to a complete state.
 */
export async function initializeDatabase(): Promise<void> {
  const provider = dbAsync.provider;
  let version = "unknown";
  try {
    version = await dbAsync.getVersion();
  } catch {
    /* version is best-effort */
  }

  console.log("[db] ==============================================");
  console.log(`[db] provider: ${provider} (${dbAsync.engineLabel})`);
  console.log(`[db] version:  ${version}`);

  const before = await appliedMigrationIds();
  const known = allMigrations.map((m) => m.id);
  const pending = known.filter((id) => !before.has(id));
  console.log(`[db] migrations known:   ${known.length} [${known.join(", ")}]`);
  console.log(`[db] migrations applied: ${before.size}`);
  console.log(
    pending.length
      ? `[db] migrations pending: ${pending.length} [${pending.join(", ")}]`
      : "[db] migrations pending: none",
  );

  try {
    await runVersionedMigrations(dbAsync, allMigrations);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[db] migration run FAILED:", msg);
    throw new Error(`Database migration failed (${provider}): ${msg}`);
  }

  const after = await appliedMigrationIds();
  const schemaVersion = known.filter((id) => after.has(id)).pop() || "none";
  console.log(`[db] schema version: ${schemaVersion}`);

  const missing = await missingTables();
  if (missing.length) {
    console.error("[db] SCHEMA VALIDATION FAILED — required tables missing:");
    for (const t of missing) console.error(`[db]   - ${t}`);
    console.error("[db] Suggested cause: a migration did not execute or failed partway.");
    console.error("[db] The server will not start with an incomplete schema.");
    console.log("[db] ==============================================");
    throw new Error(
      `Schema validation failed (${provider}): missing tables [${missing.join(", ")}]`,
    );
  }

  console.log(`[db] schema validation: OK (${REQUIRED_TABLES.length} required tables present)`);
  console.log("[db] ==============================================");
}
