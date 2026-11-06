// npm run perf:check: reads the static export (out/) and enforces the JavaScript budgets.
//   first-load JS (gzip) per route <= 130 kB for content pages, <= 170 kB for pages that include the demo
//   (demo pages are measured as HTML-referenced scripts + the lazy demo chunk, i.e. the worst case once it loads).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ROOT } from "./lib/load.mjs";

const OUT = path.join(ROOT, "out");
const BUDGET_CONTENT = 130 * 1024;
const BUDGET_DEMO = 170 * 1024;
if (!fs.existsSync(OUT)) { console.error("out/ not found: run `npm run build` first"); process.exit(1); }

const gz = (file) => zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
const cache = new Map();
const size = (rel) => {
  const f = path.join(OUT, rel.replace(/^\/[^/]+(?=\/_next)/, "").replace(/^\//, ""));
  if (!cache.has(f)) cache.set(f, fs.existsSync(f) ? gz(f) : 0);
  return cache.get(f);
};

// Locate the lazy demo chunk(s): any chunk containing the demo's marker attribute.
const chunkDir = path.join(OUT, "_next/static/chunks");
const demoChunks = fs.readdirSync(chunkDir).filter((f) => f.endsWith(".js") && fs.readFileSync(path.join(chunkDir, f), "utf8").includes("aicc-fbt__widget"));
const demoBytes = demoChunks.reduce((n, f) => n + gz(path.join(chunkDir, f)), 0);

function* pages(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["_next", "brand-kit", "og", "fonts"].includes(e.name)) yield* pages(p); }
    else if (e.name === "index.html" || e.name === "404.html") yield p;
  }
}

const rows = [];
let fail = 0;
for (const file of pages(OUT)) {
  const html = fs.readFileSync(file, "utf8");
  // Module scripts only: the nomodule polyfill bundle is never fetched by current browsers.
  const srcs = new Set([...html.matchAll(/<script(?![^>]*noModule)[^>]+src="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/<link[^>]+rel="preload"[^>]+as="script"[^>]*href="([^"]+)"/g)) srcs.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"[^>]+rel="preload"[^>]+as="script"/g)) srcs.add(m[1]);
  const js = [...srcs].filter((s) => s.includes("/_next/")).reduce((n, s) => n + size(s.slice(s.indexOf("/_next"))), 0);
  const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].reduce((n, m) => n + size(m[1].slice(m[1].indexOf("/_next"))), 0);
  const fonts = (html.match(/rel="preload"[^>]+as="font"/g) || []).length;
  const hasDemo = html.includes("data-aicc-fbt");
  const total = js + (hasDemo ? demoBytes : 0);
  const budget = hasDemo ? BUDGET_DEMO : BUDGET_CONTENT;
  const ok = total <= budget && fonts <= 2;
  if (!ok) fail++;
  rows.push({ route: path.basename(file) === "404.html" ? "/404.html" : "/" + path.relative(OUT, path.dirname(file)).replace(/^\.$/, ""), js, demo: hasDemo ? demoBytes : 0, total, budget, css, fonts, ok });
}
rows.sort((a, b) => b.total - a.total);
const kb = (n) => (n / 1024).toFixed(1).padStart(6) + " kB";
console.log("route".padEnd(34), "html JS gz".padStart(10), "+demo".padStart(10), "total".padStart(10), "budget".padStart(8), "css gz".padStart(10), "font preloads");
for (const r of rows) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.route.padEnd(30)} ${kb(r.js)} ${r.demo ? kb(r.demo) : "      -  "} ${kb(r.total)} ${(r.budget / 1024).toFixed(0).padStart(5)} kB ${kb(r.css)}   ${r.fonts}`);
const max = rows.reduce((m, r) => (r.total > m.total ? r : m), rows[0]);
const maxContent = rows.filter((r) => !r.demo).reduce((m, r) => (r.total > m.total ? r : m), { total: 0, route: "-" });
console.log(`\ndemo chunk: ${demoChunks.join(", ") || "(not found)"} = ${kb(demoBytes)} gzip (lazy: requested when the demo nears the viewport)`);
console.log(`largest content page (no demo): ${maxContent.route} ${kb(maxContent.total)} of ${BUDGET_CONTENT / 1024} kB`);
console.log(`largest demo page: ${rows.filter((r) => r.demo).reduce((m, r) => (r.total > m.total ? r : m), { total: 0, route: "-" }).route} ${kb(rows.filter((r) => r.demo).reduce((m, r) => Math.max(m, r.total), 0))} of ${BUDGET_DEMO / 1024} kB`);
if (!demoChunks.length) { console.error("FAIL: demo chunk not found; cannot verify the demo budget"); process.exit(1); }
void max;
// Headroom (Production 21): the content-page budget is NOT raised, but the largest content page (the 404, which ships all four languages' strings) must keep at least 1.0 kB below it, so the next edit does not trip the gate by a few bytes.
const HEADROOM = BUDGET_CONTENT - maxContent.total;
console.log(`headroom of the largest content page: ${(HEADROOM / 1024).toFixed(2)} kB (must stay >= 1.00 kB)`);
if (HEADROOM < 1024) { console.error(`\nFAIL: ${maxContent.route} leaves ${(HEADROOM / 1024).toFixed(2)} kB under the ${BUDGET_CONTENT / 1024} kB content budget (need >= 1.00 kB): trim the page's JavaScript, do not raise the budget`); process.exit(1); }
if (fail) { console.error(`\nFAIL: ${fail} page(s) over budget`); process.exit(1); }
console.log(`PASS: ${rows.length} pages within budget`);
