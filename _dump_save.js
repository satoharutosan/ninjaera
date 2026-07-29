const fs = require("fs");
const t = fs.readFileSync("F:/NINJA-ERA/Ninja_Era_Teams/frontend/src/features/admin/AdminPage.tsx", "utf8");
const i = t.indexOf("const saveResourceUpload");
console.log(t.slice(i, i + 2200));
console.log("\n==== MODAL SLUG / APP ====\n");
const j = t.indexOf("Public download ID");
console.log(t.slice(j - 400, j + 900));
