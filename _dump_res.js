const fs = require("fs");
const t = fs.readFileSync("F:/NINJA-ERA/Ninja_Era_Teams/backend/src/routes/admin.ts", "utf8");
const i = t.indexOf('router.post("/resources"');
console.log(t.slice(i, i + 3200));
console.log("\n--- PATCH ---\n");
const j = t.indexOf('router.patch("/resources/:id"');
console.log(t.slice(j, j + 2200));
