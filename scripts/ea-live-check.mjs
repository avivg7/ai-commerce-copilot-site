// npm run ea:live -- <origin> --step <0|1|2> [--mode open|announce] [--max-age 300] [--pages /,/pricing/,/he/pricing/]
// The post-deploy check of an Early Access build (Production 21, runbook docs/cutover/early-access.md section 7b). Read-only: plain GET requests to the origin you name.
//  * every page must be served with a Cache-Control that lets a browser or CDN revalidate soon: `no-cache`, `no-store`, or a max-age of at most --max-age seconds (default 300). No Cache-Control at all fails
//    (a browser then applies heuristic freshness to an old Last-Modified): a cached page of the INITIAL build flips to "Early Access has ended" at the initial end although access is extended;
//  * the served page must carry the END clause of the step you expect (`Date.now()>=<end of that step>)...data-ea-over`), and must NOT carry the end clause of a different step; the extra
//    requests-closed clause of an extended OPEN page (the initial cutoff, `data-ea-closed`) is expected and is not an end clause.
// Exit 0 = pass. Run it from the owner's machine against the live origin after the extended deploy and purge; use AICC_EA_HTML_NOCACHE_CONFIRMED=yes for launch:check afterwards.
import { loadTs } from "./lib/load.mjs";

const args = process.argv.slice(2);
const origin = args.find((a) => /^https?:\/\//.test(a));
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
if (!origin) { console.error("usage: node scripts/ea-live-check.mjs <origin> --step <0|1|2> [--mode open|announce] [--max-age 300] [--pages /,/pricing/]"); process.exit(2); }
const step = Number(opt("step", "0"));
const maxAge = Number(opt("max-age", "300"));
const pages = opt("pages", "/,/pricing/,/he/pricing/,/es/,/ru/pricing/").split(",");
if (![0, 1, 2].includes(step)) { console.error("--step must be 0, 1 or 2"); process.exit(2); }
const ea = await loadTs("src/lib/earlyAccess.ts");
const ends = [ea.EA_CUTOFF_UTC_MS, ...ea.EA_EXTENSION_STEPS];
const problems = [];
/** The directives of a Cache-Control value that make a copy go stale soon: true when it is safe for this purpose. */
function cacheIsShort(value, limit = 300) {
  if (!value) return false;
  const d = value.toLowerCase().split(",").map((x) => x.trim());
  if (d.includes("no-store") || d.includes("no-cache")) return true;
  const age = (name) => { const m = d.find((x) => x.startsWith(`${name}=`)); return m ? Number(m.split("=")[1]) : null; };
  const a = age("max-age"), sa = age("s-maxage");
  if (a === null && sa === null) return false;
  return (a === null || a <= limit) && (sa === null || sa <= limit);
}
for (const p of pages) {
  const url = origin.replace(/\/$/, "") + p;
  let res, body;
  try { res = await fetch(url, { redirect: "manual" }); body = await res.text(); } catch (e) { problems.push(`${url}: could not be fetched (${e.message})`); continue; }
  if (res.status !== 200) { problems.push(`${url}: HTTP ${res.status}`); continue; }
  const cc = res.headers.get("cache-control");
  if (!cacheIsShort(cc, maxAge)) problems.push(`${url}: Cache-Control is ${cc ? JSON.stringify(cc) : "missing"}: HTML must be no-cache/no-store or max-age <= ${maxAge} s for the extension window`);
  // The step of a served page is identified by the END clause of its head script (the clause that sets data-ea-over). An extended OPEN page ALSO carries the initial cutoff, in its
  // requests-closed clause (data-ea-closed): that is not "a step-0 page" (Production 21 review R7-F1), so only the over-clause counts.
  const overClause = (e) => `Date.now()>=${e})document.documentElement.setAttribute("data-ea-over"`;
  if (!body.includes(overClause(ends[step]))) problems.push(`${url}: the served page does not carry the end clause of step ${step} (end ${ends[step]}): a stale or different build is being served`);
  for (const [n, e] of ends.entries()) if (n !== step && body.includes(overClause(e))) problems.push(`${url}: the served page carries the end clause of step ${n} (end ${e}), not step ${step}`);
  console.log(`  ${p}: HTTP 200, Cache-Control ${cc ?? "(none)"}`);
}
if (problems.length) { console.error("FAIL ea:live"); problems.forEach((x) => console.error("  - " + x)); process.exit(1); }
console.log(`PASS ea:live: every page revalidates soon and serves the step ${step} build`);
