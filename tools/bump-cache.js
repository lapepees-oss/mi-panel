#!/usr/bin/env node
// Sube en 1 el número de caché del service worker (cloudspace-vNN) para que los navegadores descarguen la versión nueva.
const fs = require("fs");
const s = fs.readFileSync("sw.js", "utf8");
const m = s.match(/cloudspace-v(\d+)/);
if (!m) { console.error("No encuentro la versión de caché en sw.js"); process.exit(1); }
const next = Number(m[1]) + 1;
fs.writeFileSync("sw.js", s.replace(/cloudspace-v\d+/, "cloudspace-v" + next));
console.log("Caché: v" + m[1] + " → v" + next);
