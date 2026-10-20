// npm run seo:check: a static audit of the BUILT site (out/): canonical, hreflang, sitemap, robots, Open Graph, icons, structured data,
// and "no wrong origin anywhere" (apex, http, localhost, staging, GitHub Pages). Reads files only; run a build first:
//   AICC_BASE_PATH="" SITE_URL=https://www.copilt.org npm run build && npm run seo:check
// Options: --dir <out dir> (default out)   --origin <https://www.copilt.org>   --warnings (also print warnings)   --json
//          --mutate  also prove, on a scratch COPY of the build, that the whole audit fails when an Offer/price block is injected (negative control)
// Purchasable-price JSON-LD (Offer / AggregateOffer / offers / price / priceCurrency) is a build error while NEXT_PUBLIC_AICC_STRUCTURED_OFFERS is not "on"
// (owner decision: none until real public checkout is live). The scanner is also self-tested on every run against the real built home page.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditBuild, DEFAULT_ORIGIN, scanPriceSchema, structuredOffersOn } from "./lib/seo-audit.mjs";

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(root, arg("dir", "out"));
const origin = arg("origin", process.env.SEO_EXPECTED_ORIGIN || DEFAULT_ORIGIN);

const OFFER_BLOCK = '"offers":[{"@type":"Offer","name":"Solo","price":"99","priceCurrency":"USD"}]';
const AGG_BLOCK = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"x","offers":{"@type":"AggregateOffer","lowPrice":"99","highPrice":"499","priceCurrency":"USD"}}</script>';
/** Mutated copies of a real built page that carry price schema; each must be flagged by the scanner. */
const mutantsOf = (html) => [
  ["offers injected into SoftwareApplication", html.replace('"@type":"SoftwareApplication"', `"@type":"SoftwareApplication",${OFFER_BLOCK}`)],
  ["AggregateOffer block appended", html.replace("</body>", `${AGG_BLOCK}</body>`)],
  ["bare priceCurrency in the Organization block", html.replace('"@type":"Organization"', '"@type":"Organization","priceCurrency":"USD"')],
];

const { issues, stats } = auditBuild({ outDir, origin });
const errors = issues.filter((i) => i.level === "error");
const warns = issues.filter((i) => i.level === "warn");
if (args.includes("--json")) { console.log(JSON.stringify({ stats, issues }, null, 2)); process.exit(errors.length ? 1 : 0); }
console.log(`seo-check: ${outDir}`);
console.log(`  expected origin ${origin}; ${stats.pages ?? 0} pages, ${stats.errorPages ?? 0} error pages, ${stats.textFilesScanned ?? 0} text files scanned, ${stats.internalRefs ?? 0} internal references resolved, ${stats.handedToWordPress ?? 0} references handed to WordPress (${(stats.handedPaths || []).join(", ") || "none"})`);
for (const i of errors.slice(0, 80)) console.error(`  ERROR ${i.where}: ${i.msg}`);
if (errors.length > 80) console.error(`  ... and ${errors.length - 80} more errors`);
if (args.includes("--warnings")) for (const i of warns) console.log(`  warn  ${i.where}: ${i.msg}`);
else if (warns.length) console.log(`  ${warns.length} warning(s) (use --warnings to list)`);
console.log(`  purchasable-price JSON-LD switch NEXT_PUBLIC_AICC_STRUCTURED_OFFERS: ${structuredOffersOn() ? "ON (Offer/price schema allowed)" : "OFF (no Offer/price schema may be published)"}`);

// Negative control, every run: the scanner must stay silent on the real home page and must fire on each mutant of it (a scanner that never fires proves nothing).
let controlFail = 0;
const homeFile = path.join(outDir, "index.html");
if (fs.existsSync(homeFile)) {
  const home = fs.readFileSync(homeFile, "utf8");
  const base = scanPriceSchema(home);
  if (!structuredOffersOn() && base.length) { console.error(`  CONTROL FAIL: the real home page already carries price schema: ${base.join(", ")}`); controlFail++; }
  let fired = 0;
  const mutants = mutantsOf(home);
  for (const [name, html] of mutants) {
    if (html === home) { console.error(`  CONTROL FAIL: mutant "${name}" did not change the page (the control is stale)`); controlFail++; continue; }
    if (scanPriceSchema(html).length) fired++; else { console.error(`  CONTROL FAIL: mutant "${name}" was NOT detected`); controlFail++; }
  }
  console.log(`  negative control: price-schema scanner fired on ${fired}/${mutants.length} mutants of the built home page`);
} else console.log("  negative control skipped (no out/index.html)");

// Full-pipeline mutation (--mutate): copy the build (without media), inject price schema into one page, run the WHOLE audit, require new price-schema errors.
if (args.includes("--mutate") && !structuredOffersOn() && fs.existsSync(homeFile)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicc-seo-mutate-"));
  try {
    fs.cpSync(outDir, tmp, { recursive: true, filter: (src) => !/\.(mp4|webm)$/i.test(src) });
    const isPrice = (i) => i.level === "error" && /purchasable-price schema/.test(i.msg);
    const before = auditBuild({ outDir: tmp, origin }).issues.filter(isPrice).length;
    const mutated = path.join(tmp, "index.html");
    fs.writeFileSync(mutated, mutantsOf(fs.readFileSync(mutated, "utf8"))[0][1]);
    const after = auditBuild({ outDir: tmp, origin }).issues.filter(isPrice);
    if (before !== 0 || after.length === 0) { console.error(`  MUTATION FAIL: price-schema errors before=${before} after=${after.length} (expected 0 then >0)`); controlFail++; }
    else console.log(`  mutation (scratch copy ${tmp}): whole audit went from 0 to ${after.length} price-schema error(s) after injecting an Offer block: it FAILS as required`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
if (controlFail) { console.error(`FAIL: ${controlFail} negative-control failure(s): the price-schema check cannot be trusted`); process.exit(1); }

if (errors.length) { console.error(`FAIL: ${errors.length} error(s)`); process.exit(1); }
console.log("PASS: every built page, the sitemap and robots.txt use the canonical origin; no apex, http, localhost, staging or GitHub Pages reference");
