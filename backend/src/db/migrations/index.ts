import { migration001 } from "./001_initial_schema.js";
import { migration002 } from "./002_legacy_columns.js";
import { migration003 } from "./003_site_content.js";
import { migration004 } from "./004_pending_email_delivery.js";
import { migration005 } from "./005_uploaded_assets.js";
import { migration006 } from "./006_message_indexes.js";
import { migration007 } from "./007_link_files.js";
import { migration008 } from "./008_link_file_access_geo.js";
import { migration009 } from "./009_channel_sort_order.js";
import { migration010 } from "./010_user_mood.js";
import { migration011 } from "./011_participant_hidden_at.js";
import { migration012 } from "./012_external_download_urls.js";
import { migration013 } from "./013_game_file_size_unit.js";

export const allMigrations = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009, migration010, migration011, migration012, migration013];

export { runVersionedMigrations } from "./runner.js";
