#!/usr/bin/env node
// Comprobaciones previas a subir: todo lo que carga index.html existe y está en la caché offline (SHELL) del service worker.
const fs = require("fs");
const sw = fs.readFileSync("sw.js", "utf8");
const shell = [...sw.match(/const SHELL = \[(.*?)\];/s)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const idx = fs.readFileSync("index.html", "utf8");
const used = [...idx.matchAll(/<script src="([^"]+)"/g), ...idx.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]).filter((f) => !/^https?:/.test(f));
const errs = [];
for (const f of shell) if (f !== "./" && !fs.existsSync(f)) errs.push(`SHELL: no existe ${f}`);
for (const f of used) { if (!fs.existsSync(f)) errs.push(`index.html: no existe ${f}`); else if (!shell.includes(f) && f !== "config.js") errs.push(`falta en SHELL de sw.js: ${f}`); }
if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
console.log(`OK: ${used.length} archivos de la página y ${shell.length} en caché offline`);
