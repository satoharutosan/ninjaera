const fs = require("fs");
const t = fs.readFileSync("F:/NINJA-ERA/Ninja_Era_Teams/backend/src/routes/admin.ts", "utf8");
// Find router.use requireAdmin
const lines = t.split(/\n/);
for (let i = 0; i < Math.min(250, lines.length); i++) {
  if (/requireAdmin|router\.use|resourceFileUpload|multerSizeLimit/.test(lines[i])) {
    console.log(String(i + 1).padStart(4), lines[i]);
  }
}
console.log("---");
// End of POST handler
const i = t.indexOf('router.post("/resources"');
const j = t.indexOf('router.patch("/resources/:id"');
console.log(t.slice(i + 2500, j));
