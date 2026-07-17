import { migration001 } from "./001_initial_schema.js";
import { migration002 } from "./002_legacy_columns.js";
import { migration003 } from "./003_site_content.js";
import { migration004 } from "./004_pending_email_delivery.js";
import { migration005 } from "./005_uploaded_assets.js";
import { migration006 } from "./006_message_indexes.js";
import { migration007 } from "./007_link_files.js";

export const allMigrations = [migration001, migration002, migration003, migration004, migration005, migration006, migration007];

export { runVersionedMigrations } from "./runner.js";
