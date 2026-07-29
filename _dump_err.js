const fs = require("fs");
// Search for known issues: unique constraint, public_slug in INSERT
const admin = fs.readFileSync("F:/NINJA-ERA/Ninja_Era_Teams/backend/src/routes/admin.ts", "utf8");
console.log("has INSERT public_slug?", /INSERT INTO resources[\s\S]*?public_slug/.test(admin));
console.log("import resolve?", admin.includes("resolveResourcePublicSlug"));

// Check error handler
const err = fs.readFileSync("F:/NINJA-ERA/Ninja_Era_Teams/backend/src/middleware/errorHandler.ts", "utf8");
console.log(err.slice(0, 800));
