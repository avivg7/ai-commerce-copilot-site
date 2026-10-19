// npm run seo:check: a static audit of the BUILT site (out/): canonical, hreflang, sitemap, robots, Open Graph, icons, structured data,
// and "no wrong origin anywhere" (apex, http, localhost, staging, GitHub Pages). Reads files only; run a build first:
//   AICC_BASE_PATH="" SITE_URL=https://www.copilt.org npm run build && npm run seo:check
// Options: --dir <out dir> (default out)   --origin <https://www.copilt.org>   --warnings (also print warnings)   --json
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditBuild, DEFAULT_ORIGIN } from "./lib/seo-audit.mjs";

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(root, arg("dir", "out"));
const origin = arg("origin", process.env.SEO_EXPECTED_ORIGIN || DEFAULT_ORIGIN);

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
if (errors.length) { console.error(`FAIL: ${errors.length} error(s)`); process.exit(1); }
console.log("PASS: every built page, the sitemap and robots.txt use the canonical origin; no apex, http, localhost, staging or GitHub Pages reference");
