// Writes design/p40/out/<lang>__<state>.html (+ __strike) and design/p40/prototype.html (an index).
//   PATH=/opt/homebrew/opt/node@22/bin:$PATH node --no-warnings design/p40/build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGS, STATES, page } from "./render.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
fs.mkdirSync(OUT, { recursive: true });
const files = [];
for (const lang of LANGS) {
  for (const state of STATES) { const f = `${lang}__${state}.html`; fs.writeFileSync(path.join(OUT, f), page({ lang, state })); files.push(f); }
  const f = `${lang}__off__strike.html`; fs.writeFileSync(path.join(OUT, f), page({ lang, state: "off", strike: true })); files.push(f);
}
const li = files.map((f) => `<li><a href="out/${f}">${f.replace(".html", "")}</a></li>`).join("\n");
fs.writeFileSync(path.join(HERE, "prototype.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>P40 pricing prototype</title>
<style>body{font:16px/1.5 system-ui;margin:2rem;max-width:60rem}ul{columns:3}a{color:#1d4ed8}</style></head><body>
<h1>P40 pricing prototype</h1><p>Static pages rendered by design/p40/build.mjs with the real brand kit CSS (brand/aicc-brand.css). Language x state. The strike pages show the feature-gated variant (never public).</p>
<ul>${li}</ul></body></html>
`);
console.log(`design/p40: ${files.length} pages written`);
