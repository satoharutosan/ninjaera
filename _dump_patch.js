const fs = require("fs");
const admin = fs.readFileSync("F:/NINJA-ERA/Ninja_Era_Teams/backend/src/routes/admin.ts", "utf8");
const i = admin.indexOf('router.patch("/resources/:id"');
const j = admin.indexOf('router.delete("/resources/:id"');
const patch = admin.slice(i, j);
console.log(patch);
