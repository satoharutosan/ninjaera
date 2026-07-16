/**
 * @deprecated Replaced by versioned migrations (see ./migrations/index.ts + ./migrate.ts).
 * This legacy ad-hoc sync migrator is no longer invoked at startup. Kept as a
 * no-op stub so any stray import doesn't break the build/runtime.
 */
import { runAllMigrations } from "./migrate.js";

/** No-op — use `runAllMigrations` from `./migrate.js` instead. */
export async function runMigrations() {
  await runAllMigrations();
}
