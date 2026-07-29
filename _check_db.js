const Database = require("better-sqlite3");
const path = require("path");
const dbPath = path.resolve("F:/NINJA-ERA/Ninja_Era_Teams/backend/data/ninja-era.db");
const fs = require("fs");
if (!fs.existsSync(dbPath)) {
  console.log("missing", dbPath);
  process.exit(1);
}
const db = new Database(dbPath);
console.log("cols", db.prepare("PRAGMA table_info(resources)").all().map((c) => c.name).join(", "));
console.log("migrations", db.prepare("SELECT id FROM schema_migrations ORDER BY id").all().map((m) => m.id).join(", "));
console.log("count", db.prepare("SELECT COUNT(*) as c FROM resources").get());
try {
  console.log("slugs", db.prepare("SELECT id, public_slug, public_slug_display FROM resources LIMIT 5").all());
} catch (e) {
  console.log("slug query error", e.message);
}
