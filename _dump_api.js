const fs = require("fs");
const t = fs.readFileSync("F:/NINJA-ERA/Ninja_Era_Teams/frontend/src/app/api.ts", "utf8");
const i = t.indexOf("createResource:");
console.log(t.slice(i, i + 600));

// Check form upload helper
const j = t.indexOf("uploadForm");
console.log("\nuploadForm refs", (t.match(/uploadForm|FormData|multipart/g) || []).slice(0, 20));
const k = t.indexOf("function requestForm") >= 0 ? t.indexOf("function requestForm") : t.indexOf("requestFormData");
console.log("\nform helper idx", k);
if (k >= 0) console.log(t.slice(k, k + 800));

// Look for how FormData posts work
const m = t.indexOf("onUploadProgress");
console.log("\n--- around upload ---\n", t.slice(Math.max(0, m - 200), m + 400));
