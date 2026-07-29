const fs = require("fs");
const admin = fs.readFileSync("F:/NINJA-ERA/Ninja_Era_Teams/backend/src/routes/admin.ts", "utf8");
const i = admin.indexOf('router.post("/resources"');
const j = admin.indexOf('router.patch("/resources/:id"');
const post = admin.slice(i, j);
const insertMatch = post.match(/INSERT INTO resources \([^)]+\)/);
console.log("INSERT cols:", insertMatch && insertMatch[0]);
console.log("UPDATE public_slug in post?", post.includes("UPDATE resources SET public_slug"));
