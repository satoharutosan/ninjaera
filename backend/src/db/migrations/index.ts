import { migration001 } from "./001_initial_schema.js";
import { migration002 } from "./002_legacy_columns.js";
import { migration003 } from "./003_site_content.js";
import { migration004 } from "./004_pending_email_delivery.js";
import { migration005 } from "./005_uploaded_assets.js";

export const allMigrations = [migration001, migration002, migration003, migration004, migration005];

export { runVersionedMigrations } from "./runner.js";
