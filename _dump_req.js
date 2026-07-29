const fs = require("fs");
const t = fs.readFileSync("F:/NINJA-ERA/Ninja_Era_Teams/frontend/src/app/api.ts", "utf8");
const i = t.indexOf("async function request");
const i2 = t.indexOf("function request");
const start = i >= 0 ? i : i2;
console.log("start", start);
console.log(t.slice(start, start + 1500));

// Also xhr upload path
const x = t.indexOf("XMLHttpRequest");
console.log("\n--- XHR ---\n", t.slice(x - 100, x + 1200));
