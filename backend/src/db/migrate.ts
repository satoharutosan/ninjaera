import { dbAsync } from "./index.js";
import { allMigrations, runVersionedMigrations } from "./migrations/index.js";

/** Apply versioned schema migrations for the active provider. */
export async function runAllMigrations() {
  await runVersionedMigrations(dbAsync, allMigrations);
}
