// npm run test:link-resolution (P39): NO broken links in a built export. Every <a href> of every HTML page must resolve:
//   * an internal path (/x/, /he/x/, with or without ?query and #hash) to a page of THIS export, or to a Control-Plane-served route of the production edge (the allow-list is WP_PAGES_RE of scripts/lib/redirect-matrix.mjs, the
//     same regular expression that generates docs/cutover/Caddyfile.edge.template: pricing, privacy, terms, refund-policy, data-processing-addendum, accessibility, cart, checkout, my-account, start, product-category, shop, product/<x>);
//   * an absolute https://www.copilt.org/... URL under the same two rules (an export page or a route of that allow-list); no other origin except mailto: and the brand's own hosts is allowed;
//   * a #fragment to an element id that exists on the target page (the target is the export page, or the same page); fragments of Control-Plane-served pages are not checked (their HTML is not in this export);
//   * assets (/_next, /brand-kit, /fonts, /og, /demo, files with an extension) to an existing file.
//   It also lists which Control Plane routes are linked, so the allow-list use is explicit.
//   node scripts/test-link-resolution.mjs --dir <export> [--no-start]    (--no-start: assert that NO link to the Control Plane /start/ page exists: the default coming_soon build)
import fs from "node:fs";
import path from "node:path";
import { WP_PAGES_RE } from "./lib/redirect-matrix.mjs";
import { edgeLegalProblems, LEGAL_ROUTES } from "./lib/edge-legal.mjs";
import { ROOT } from "./lib/load.mjs";

const args = process.argv.slice(2);
const DIR = args.includes("--dir") ? path.resolve(args[args.indexOf("--dir") + 1]) : null;
const NO_START = args.includes("--no-start");
if (!DIR) { console.error("usage: --dir <export> [--no-start]"); process.exit(2); }
const LOC = "(?:/(?:he|es|ru))?";
const WP = new RegExp(WP_PAGES_RE.replace(/\$\{LOC\}/g, LOC), "i");
const ORIGIN = "https://www.copilt.org";
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const htmlFiles = walk(DIR).filter((f) => f.endsWith(".html") && !/\/(_next|brand-kit|demo)\//.test(f));
const ids = new Map();
const idsOf = (file) => { if (!ids.has(file)) ids.set(file, new Set([...fs.readFileSync(file, "utf8").matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))); return ids.get(file); };
const decode = (t) => t.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
const bad = [], cpRoutes = new Map(); let links = 0;
const pageFile = (p) => { const a = path.join(DIR, p.replace(/^\//, ""), "index.html"); return fs.existsSync(a) ? a : null; };
for (const f of htmlFiles) {
  const rel = path.relative(DIR, f), here = f;
  const raw = fs.readFileSync(f, "utf8");
  for (const m of raw.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)) {
    const href = decode(m[1]); links++;
    if (/^(mailto|tel):/.test(href)) continue;
    let u;
    if (/^https?:/.test(href)) { if (!href.startsWith(ORIGIN + "/") && href !== ORIGIN) { bad.push(`${rel}: external origin ${href}`); continue; } u = href.slice(ORIGIN.length) || "/"; }
    else if (href.startsWith("#")) { if (href.length > 1 && !idsOf(here).has(decodeURIComponent(href.slice(1)))) bad.push(`${rel}: #${href.slice(1)} has no target on the page`); continue; }
    else if (href.startsWith("/")) u = href;
    else { bad.push(`${rel}: relative or odd href ${href}`); continue; }
    const [pp, frag] = [u.split(/[?#]/)[0], (u.split("#")[1] || "")];
    if (/^\/(_next|brand-kit|og|fonts|demo)\//.test(pp) || /\.[a-z0-9]{2,5}$/i.test(pp)) { if (!fs.existsSync(path.join(DIR, pp))) bad.push(`${rel}: missing file ${pp}`); continue; }
    const target = pp === "/" ? path.join(DIR, "index.html") : pageFile(pp);
    if (target) { if (frag && !idsOf(target).has(decodeURIComponent(frag))) bad.push(`${rel}: ${pp}#${frag} has no target element`); continue; }
    if (WP.test(pp)) { const k = pp.replace(/^\/(he|es|ru)\//, "/"); cpRoutes.set(k, (cpRoutes.get(k) || 0) + 1); continue; }
    bad.push(`${rel}: ${href} resolves to no export page and to no Control Plane route of the edge allow-list`);
  }
}
// P39 round 2 (H1): this export carries older drafts of the legal pages that live does NOT serve: the edge template must still route them (all languages) to WordPress
{
  const tpl = path.join(ROOT, "docs/cutover/Caddyfile.edge.template");
  const ep = fs.existsSync(tpl) ? edgeLegalProblems(fs.readFileSync(tpl, "utf8")) : ["docs/cutover/Caddyfile.edge.template not found"];
  for (const x of ep) bad.push(`edge template: ${x}`);
  console.log(`edge template: the @wp_pages matcher routes ${LEGAL_ROUTES.join(", ")} (en, he, es, ru) to WordPress: ${ep.length ? "NO" : "yes"}`);
}
const startLinks = [...cpRoutes.keys()].filter((k) => /^\/start(\/|$)/.test(k));
console.log(`${htmlFiles.length} pages, ${links} links checked`);
console.log(`Control Plane routes linked (allow-list WP_PAGES_RE of scripts/lib/redirect-matrix.mjs): ${[...cpRoutes].map(([k, n]) => `${k} x${n}`).join(", ") || "none"}`);
if (NO_START && startLinks.length) bad.push(`the default (coming_soon) build links to the Control Plane /start/ page ${startLinks.join(", ")}: it may be a 404`);
if (bad.length) { console.error(`FAIL test:link-resolution (${bad.length})\n  ` + [...new Set(bad)].slice(0, 40).join("\n  ")); process.exit(1); }
console.log(`PASS test:link-resolution: no broken link${NO_START ? ", no link to /start/" : ""}`);
