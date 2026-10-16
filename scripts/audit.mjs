// npm run audit: axe-core (WCAG 2.2 A/AA rule tags) + structural checks on EVERY page in EVERY locale at 360 and 1280 wide,
// and a horizontal-overflow assertion at 360, 390, 768 and 1280. Needs the export served (npm run serve:out) at AICC_BASE_URL.
//   node scripts/audit.mjs [--fast]   (--fast: only 360 and 1280, skips 390/768 overflow-only passes)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { launch, urlFor, LOCALES, ROUTES } from "./lib/browser.mjs";
import { ROOT } from "./lib/load.mjs";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const WIDTHS = process.argv.includes("--fast") ? [360, 1280] : [360, 390, 768, 1280];
const AXE_WIDTHS = [360, 1280];

const browser = await launch();
const summary = [];
let totalViolations = 0;
let overflowFails = 0;
let structFails = 0;

const ONLY = (process.env.AUDIT_LOCALES || "").split(",").filter(Boolean);
for (const locale of LOCALES.filter((l) => !ONLY.length || ONLY.includes(l))) {
  for (const route of ROUTES) {
    const url = urlFor(locale, route);
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "no-preference" });
      const page = await ctx.newPage();
      const consoleErrors = [];
      page.on("pageerror", (e) => consoleErrors.push(String(e)));
      page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
      await page.goto(url, { waitUntil: "load" });
      await page.waitForTimeout(500);
      // Scroll through so lazy content (the demo) is present before auditing.
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < h; y += 700) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(40); }
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, 0));

      const dims = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      const overflow = dims[0] > dims[1];
      if (overflow) overflowFails++;

      let violations = [];
      if (AXE_WIDTHS.includes(width)) {
        await page.evaluate(axeSource);
        const res = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] }), TAGS);
        violations = res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(" ") + " :: " + (n.failureSummary || "").split("\n").slice(1, 3).join(" | ")) }));
        totalViolations += violations.length;
      }

      const struct = await page.evaluate(() => {
        const out = [];
        const root = document.documentElement;
        if (!root.lang) out.push("html lang missing");
        if (!["ltr", "rtl"].includes(root.dir)) out.push("html dir missing");
        if (document.querySelectorAll("h1").length !== 1) out.push(`h1 count = ${document.querySelectorAll("h1").length}`);
        const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];
        let prev = 0;
        for (const el of hs) { const lv = +el.tagName[1]; if (prev && lv > prev + 1) out.push(`heading jump h${prev} -> h${lv}: "${el.textContent.trim().slice(0, 40)}"`); prev = lv; }
        if (document.querySelectorAll("main").length !== 1) out.push("main landmark count != 1");
        if (!document.querySelector("header")) out.push("no header landmark");
        if (!document.querySelector("footer")) out.push("no footer landmark");
        if (!document.querySelector('a[href="#main"]')) out.push("no skip link");
        for (const img of document.images) {
          if (!img.getAttribute("width") || !img.getAttribute("height")) out.push(`img without width/height: ${img.src.slice(-40)}`);
          if (!img.hasAttribute("alt")) out.push(`img without alt: ${img.src.slice(-40)}`);
        }
        const eager = [...document.images].filter((i) => i.loading !== "lazy" && !i.closest("header") && !i.closest("footer"));
        if (eager.length > 1) out.push(`${eager.length} non-lazy content images (hero should be the only one)`);
        const links = [...document.querySelectorAll("a")].filter((a) => !a.textContent.trim() && !a.getAttribute("aria-label"));
        if (links.length) out.push(`${links.length} link(s) without a name`);
        const small = [...document.querySelectorAll("button, summary, [role=switch], input:not([type=hidden]), select, textarea, nav a, .aicc-btn, .aicc-chips a, .aicc-footer a")]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 43.5 || r.width < 43.5) && getComputedStyle(e).visibility !== "hidden"; })
          .filter((e) => !e.closest("[hidden]"))
          // A checkbox inside a <label> is operated through the whole label (>= 44px): the label is the target.
          .filter((e) => { const l = e.tagName === "INPUT" && e.closest("label"); if (!l) return true; const r = l.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; });
        if (small.length) out.push(`${small.length} control(s) under 44px: ${small.slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${(e.className || "").toString().split(" ")[0]} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`).join(", ")}`);
        const tiny = [...document.querySelectorAll("body *")].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12.5);
        if (tiny.length) out.push(`${tiny.length} text node(s) under 12.5px`);
        return out;
      });
      if (AXE_WIDTHS.includes(width)) structFails += struct.length ? 1 : 0;

      summary.push({ locale, route: route || "home", width, overflow, scrollWidth: dims[0], innerWidth: dims[1], axe: violations, struct: AXE_WIDTHS.includes(width) ? struct : undefined, consoleErrors });
      await ctx.close();
    }
  }
}
await browser.close();

const outDir = path.join(ROOT, ".audit");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "audit.json"), JSON.stringify(summary, null, 2));

const pages = summary.length;
console.log(`audit  ${LOCALES.length} locales x ${ROUTES.length} pages x ${WIDTHS.length} widths = ${pages} page loads`);
console.log(`axe violations (rule tags ${TAGS.join(", ")}): ${totalViolations}`);
console.log(`horizontal overflow failures: ${overflowFails}   pages with structural findings: ${structFails}`);
for (const s of summary) {
  const bits = [];
  if (s.overflow) bits.push(`OVERFLOW ${s.scrollWidth}>${s.innerWidth}`);
  for (const v of s.axe) bits.push(`axe:${v.id}(${v.impact}) x${v.nodes.length} ${v.nodes[0]}`);
  for (const t of s.struct ?? []) bits.push(`struct: ${t}`);
  for (const c of s.consoleErrors) bits.push(`console: ${c.slice(0, 120)}`);
  if (bits.length) console.log(`- ${s.locale}/${s.route} @${s.width}\n    ${bits.join("\n    ")}`);
}
process.exit(totalViolations || overflowFails || structFails ? 1 : 0);
