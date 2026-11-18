// Geometry + a11y checks of the prototype: no horizontal overflow, no clipping inside cards / panel / band, desktop rows aligned, 44px targets, axe-core (incl. colour contrast).
//   PATH=/opt/homebrew/opt/node@22/bin:$PATH node --no-warnings design/p40/geometry.mjs [--axe] [--quick]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { launch } from "../../scripts/lib/browser.mjs";
import { LANGS, STATES } from "./render.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const WIDTHS = [320, 375, 390, 430, 768, 1024, 1440, 1920];
const QUICK = process.argv.includes("--quick");
const withAxe = process.argv.includes("--axe");
const SCALES = [100, 125, 200];
const b = await launch();
let fails = 0, checks = 0;
const report = [];
const measure = () => {
  const out = [];
  const R = (el) => el.getBoundingClientRect();
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1) out.push(`page overflows horizontally: scrollWidth ${doc.scrollWidth} > ${doc.clientWidth}`);
  for (const root of document.querySelectorAll(".aicc-pricing__head, .aicc-tier, .aicc-launch, .aicc-pband")) {
    const rr = R(root);
    if (root.scrollWidth > root.clientWidth + 1) out.push(`${root.className.split(" ")[0]} scrollWidth ${root.scrollWidth} > clientWidth ${root.clientWidth}`);
    if (root.scrollHeight > root.clientHeight + 1) out.push(`${root.className.split(" ")[0]} scrollHeight ${root.scrollHeight} > clientHeight ${root.clientHeight}`);
    for (const el of root.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.display === "inline" && el.children.length === 0 && false) continue;
      const r = R(el);
      if (r.width === 0 && r.height === 0) continue;
      if (el.classList.contains("aicc-sr-only")) continue;
      if (r.left < rr.left - 1 || r.right > rr.right + 1) out.push(`${el.className || el.tagName} sticks out of ${root.className.split(" ")[0]} horizontally (${Math.round(r.left - rr.left)}, ${Math.round(r.right - rr.right)})`);
      if (cs.display !== "inline" && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) out.push(`${el.className || el.tagName} content wider than its box (${el.scrollWidth} > ${el.clientWidth})`);
    }
  }
  // text lines inside nodes must not exceed the card: check every text node's range
  for (const root of document.querySelectorAll(".aicc-pricing__head, .aicc-tier, .aicc-launch, .aicc-pband")) {
    const rr = R(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width && (r.left < rr.left - 1 || r.right > rr.right + 1)) out.push(`text "${n.textContent.trim().slice(0, 30)}" outside ${root.className.split(" ")[0]}`);
    }
  }
  // touch targets
  for (const a of document.querySelectorAll(".aicc-pricing a, .aicc-pband a")) { const r = R(a); if (r.height < 44 - 0.5 || r.width < 44) out.push(`target ${a.textContent.trim().slice(0, 20)} is ${Math.round(r.width)}x${Math.round(r.height)} (<44)`); }
  // desktop rows aligned
  const tiers = [...document.querySelectorAll(".aicc-tiers > .aicc-tier")];
  if (tiers.length === 3 && innerWidth >= 62 * parseFloat(getComputedStyle(doc).fontSize)) {
    for (const sel of [".aicc-tier__name", ".aicc-tier__cap", ".aicc-tier__price", ".aicc-tier__free", ".aicc-pcta", ".aicc-tier__incl"]) {
      const ys = tiers.map((t) => t.querySelector(sel)).filter(Boolean).map((e) => Math.round(R(e).top));
      if (ys.length && Math.max(...ys) - Math.min(...ys) > 1) out.push(`rows misaligned for ${sel}: ${ys.join(",")}`);
    }
    const bots = tiers.map((t) => Math.round(R(t).bottom)); const tops = tiers.map((t) => Math.round(R(t).top));
    out.push(`INFO cards top ${tops.join(",")} bottom ${bots.join(",")} h ${tiers.map((t) => Math.round(R(t).height)).join(",")}`);
  }
  return out;
};
for (const lang of LANGS) for (const state of STATES) {
  for (const w of QUICK ? [320, 768, 1440] : WIDTHS) for (const sc of (w === 320 || w === 390) && !QUICK ? SCALES : [100]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(pathToFileURL(path.join(HERE, "out", `${lang}__${state}.html`)).href);
    if (sc !== 100) await p.evaluate((t) => { document.documentElement.style.fontSize = t + "%"; }, sc);
    await p.evaluate(() => document.fonts.ready);
    const res = await p.evaluate(measure);
    checks++;
    const real = res.filter((x) => !x.startsWith("INFO"));
    if (real.length) { fails++; report.push(`FAIL ${lang} ${state} w${w} t${sc}: ${[...new Set(real)].slice(0, 6).join(" | ")}`); }
    if (w === 1440 && sc === 100 && state === "off") report.push(`${lang} ${state}: ${res.find((x) => x.startsWith("INFO"))}`);
    if (withAxe && sc === 100 && (w === 390 || w === 1440)) {
      await p.evaluate(AXE);
      const ax = await p.evaluate(async () => { const r = await axe.run(document, { rules: { "page-has-heading-one": { enabled: false } }, runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] } }); return { v: r.violations.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.html.slice(0, 80)).join(" ; ")}`), inc: r.incomplete.map((v) => v.id) }; });
      checks++;
      if (ax.v.length) { fails++; report.push(`AXE ${lang} ${state} w${w}: ${ax.v.join(" || ")}`); }
      if (ax.inc.length && w === 1440 && state === "off") report.push(`axe incomplete ${lang}: ${ax.inc.join(",")}`);
    }
    await ctx.close();
  }
}
await b.close();
console.log(report.join("\n"));
console.log(`\n${checks} checks, ${fails} failing`);
process.exit(fails ? 1 : 0);
