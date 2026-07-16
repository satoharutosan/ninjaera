import { migration001 } from "./001_initial_schema.js";
import { migration002 } from "./002_legacy_columns.js";
import { migration003 } from "./003_site_content.js";

export const allMigrations = [migration001, migration002, migration003];

export { runVersionedMigrations } from "./runner.js";
