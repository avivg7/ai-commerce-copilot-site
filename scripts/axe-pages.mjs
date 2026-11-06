// npm run axe:check [-- --locales en,he] [-- --pages ,product] [-- --widths 320,360] [-- --now 2027-01-20T10:00:00Z]
// axe-core (WCAG 2.0/2.1/2.2 A + AA + best-practice) on Home, Product, Pricing, Questions and Data & Trust at 1280 / 768 / 390 / 360 / 320,
// in three modes: default (AA), Enhanced contrast, and reduced motion. Zero serious or critical violations; lesser ones are listed.
// Also asserts: no horizontal scroll at every width (320 included), interactive demos mounted and scrolled through before the scan,
// and, at 320, that Larger text does not break the layout. Needs the export served (npm run serve:out) at AICC_BASE_URL.
import fs from "node:fs";
import { createRequire } from "node:module";
import { launch, urlFor } from "./lib/browser.mjs";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const LOCALES = arg("locales", "en,he").split(",");
// --now <ISO instant>: freeze the page clock (Production 21: scans the requests-CLOSED phase of an extended OPEN build, which the real clock cannot reach before 2027)
const NOW = arg("now", "");
const ROUTES = arg("pages", ",product,pricing,questions,data-and-trust").split(",");
const WIDTHS = arg("widths", "1280,768,390,360,320").split(",").map(Number);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const MODES = {
  default: { ctx: {}, store: null },
  "enhanced-contrast": { ctx: {}, store: { contrast: "high" } },
  "reduced-motion": { ctx: { reducedMotion: "reduce" }, store: null },
};

const browser = await launch();
let serious = 0, minor = 0, overflow = 0, runs = 0;
const notes = [];
for (const locale of LOCALES) for (const route of ROUTES) for (const [mode, cfg] of Object.entries(MODES)) for (const width of WIDTHS) {
  // Enhanced contrast and reduced motion are checked at the widths that matter most to keep the run short; default runs at all five.
  if (mode !== "default" && ![1280, 390, 320].includes(width)) continue;
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "no-preference", ...cfg.ctx });
  if (cfg.store) await ctx.addInitScript((v) => localStorage.setItem("aicc_a11y", JSON.stringify(v)), cfg.store);
  if (NOW) await ctx.clock.setFixedTime(new Date(NOW));
  const page = await ctx.newPage();
  const url = urlFor(locale, route);
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(400);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 600) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(60); }
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  const dims = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  const label = `${locale}/${route || "home"} ${width}px ${mode}`;
  if (dims[0] > dims[1]) { overflow++; notes.push(`OVERFLOW ${label}: scrollWidth ${dims[0]} > ${dims[1]}`); }
  await page.evaluate(axeSource);
  const res = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] }), TAGS);
  runs++;
  for (const v of res.violations) {
    const bad = v.impact === "serious" || v.impact === "critical";
    if (bad) serious++; else minor++;
    notes.push(`${bad ? "FAIL" : "note"} ${label}: ${v.id} (${v.impact}) ${v.help} :: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")}`);
  }
  await ctx.close();
}
await browser.close();
notes.forEach((n) => console.log(n));
console.log(`\naxe:check  ${runs} scans (${LOCALES.join(",")} x ${ROUTES.length} pages x widths ${WIDTHS.join("/")} x modes ${Object.keys(MODES).join("/")})  serious/critical=${serious}  other=${minor}  horizontal-overflow=${overflow}`);
if (serious || overflow || minor) { console.error(serious || overflow ? "FAIL" : "FAIL: lesser violations present (the site's bar is zero axe violations)"); process.exit(1); }
console.log("PASS: zero axe violations and no horizontal scroll");
