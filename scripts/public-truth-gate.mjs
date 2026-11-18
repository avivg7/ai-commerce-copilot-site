// npm run test:public-truth -- [--out <built export dir>] [--url <base url> --preset site|cp] [--alias <served-origin>=<canonical-origin>] [--probes none|static|edge] [--json file] | --self-test
//
// The PUBLIC-TRUTH GATE (round 3). The website goes live at https://www.copilt.org BEFORE commercial checkout opens: nothing a visitor or a crawler can read may look internal,
// unfinished, staged or untrue. This crawls a built Site export (--out) and/or a running origin (--url) in all four locales (en, he, es, ru) and FAILS on:
//   "(pending)", "Support details will be published before launch", legal-review-pending / draft labels, TODO / TBD / FIXME / lorem / "placeholder", launch-test language, test sentinels
//   (Example Ltd, support@example.test, 1 Example Street, Example Pay, example.test, localhost, 127.0.0.1, stage.copilt.org, "QA"), free-trial language, another platform named,
//   WordPress.org install claims, "AI Commerce Copilot (QA)" site titles, unsupported conversion / AOV percentages, "same category fallback" as AICC positioning, AI / semantic
//   cold-start claims, "Frequently Bought Together" as AICC's identity, noindex / staging markers, absolute stage / loopback / apex / http:// URLs, a missing or wrong canonical
//   (must be https://www.copilt.org + the page's own path), source maps and debug routes that answer, a blanket robots Disallow and off-origin sitemap URLs.
// It reports counts per route and per rule and exits 1 on any finding. `--self-test` proves every rule with a mutation (a clean page plus one injected defect each) and runs the
// crawler against a throwaway local server.
//
// Examples
//   npm run build  (production target: AICC_BASE_PATH="" SITE_URL=https://www.copilt.org)  &&  npm run test:public-truth -- --out out
//   npm run test:public-truth -- --url http://127.0.0.1:24812 --preset cp                                                           # the Control Plane fixture (its own origin is judged as https://www.copilt.org; --alias from=to overrides)
//   npm run test:public-truth -- --url https://www.copilt.org --preset site --probes edge                                            # the live site, read-only GETs
// The crawler only issues GET requests, follows no form and sends no credentials.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { analyzeDocument, robotsFindings, sitemapFindings, CANONICAL_ORIGIN, MUTATIONS, CLEAN_SAMPLES, cleanPage, wordingFindings } from "./lib/public-truth.mjs";

import { loadTs } from "./lib/load.mjs";
import { makeAttested } from "./lib/ea-attest.mjs";

// P37: the approved self-service strings (the `ss` block of the launch-offer packs, four languages, every extension step), longest first: a self-service build may say exactly these (see analyzeDocument).
const SS_PHRASES = await (async () => {
  const { getEaDictionary } = await loadTs("src/i18n/index.ts");
  const out = new Set();
  const walkStrings = (o) => (typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(walkStrings) : []);
  for (const l of ["en", "he", "es", "ru"]) for (const step of [0, 1, 2]) for (const v of walkStrings(getEaDictionary(l, step).ss)) { out.add(v); out.add(v.replace(/\u00a0/g, " ")); out.add(v.replace(/\{n\}/g, "3").replace(/\{n\}/g, "10")); }
  for (const l of ["en", "he", "es", "ru"]) for (const n of [3, 10]) out.add(getEaDictionary(l, 0).ss.plan.paidMany.replace("{n}", String(n)));
  return [...out].filter((x) => x.trim().length > 3).sort((a, b) => b.length - a.length);
})();

// P40: a struck-through plan price is a finding unless the pricing-claims approval is attested (the same rule and reference as `launch:check` and the release gate)
const STRIKE_APPROVED = await (async () => { const { eaRefIsPlaceholder } = await loadTs("src/lib/earlyAccess.ts"); return makeAttested(process.env, eaRefIsPlaceholder)(process.env.AICC_EA_STRIKE_COUNSEL_APPROVED); })();

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);
const LOCALES = ["", "he/", "es/", "ru/"];
const SITE_PATHS = ["", "product/", "pricing/", "questions/", "data-and-trust/", "privacy/", "terms/", "refund-policy/", "accessibility/"];
const CP_PATHS = ["pricing/", "privacy/", "terms/", "refund-policy/", "data-processing-addendum/", "accessibility/", "cart/", "checkout/", "my-account/", "my-account/lost-password/", "shop/"];
/** Pages that are legitimately noindex (transactional and account pages, error pages). */
const NOINDEX_OK = [/^(?:\/(?:he|es|ru))?\/(?:cart|checkout|my-account)(?:\/|$)/, /^(?:\/(?:he|es|ru))?\/request-access(?:\/|$)/, /^\/(?:404|_not-found|50x)(?:\.html|\/|$)/];
const noindexAllowed = (p) => NOINDEX_OK.some((re) => re.test(p));
/** Canonical may point at the page a redirect lands on (/checkout/ -> /cart/) or at the account root (WooCommerce endpoints). */
const isErrorPath = (p) => /(^|\/)(404|_not-found|50x)(\.html|\/|$)/.test(p);

/** Per-document analysis with the fixture origin rewritten to the canonical one. */
function scanHtml(html, pathname, { alias, status = 200, finalPath = null }) {
  let body = html;
  if (alias) body = body.split(alias.from).join(alias.to);
  const effective = finalPath || pathname;
  const ctx = {
    origin: CANONICAL_ORIGIN, pathname: effective, status, noindexAllowed: noindexAllowed(effective), isError: status >= 400 || isErrorPath(pathname),
    canonicalAlternatives: /\/my-account\//.test(effective) ? [CANONICAL_ORIGIN + effective.replace(/(\/my-account\/).*/, "$1")] : [],
    ssPhrases: SS_PHRASES, strikeApproved: STRIKE_APPROVED,
  };
  return analyzeDocument(body, ctx);
}

const results = []; // { route, source, findings: [{id, where, why, snippet}] }
const add = (route, source, findings) => results.push({ route, source, findings });

// ---- directory mode ---------------------------------------------------------------------------------------------------------------------------------
const RSC_RULES = new Set(["pending-marker", "published-before-launch", "sentinel-value", "loopback-or-stage-text", "todo-tbd", "draft-label"]);
export function scanDir(dir, { origin = CANONICAL_ORIGIN } = {}) {
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else found.push(p); } };
  walk(dir);
  const rel = (p) => path.relative(dir, p).split(path.sep).join("/");
  for (const f of found.sort()) {
    const r = rel(f);
    if (r.endsWith(".html")) {
      const pathname = r === "index.html" ? "/" : r.endsWith("/index.html") ? "/" + r.slice(0, -"index.html".length) : "/" + r;
      add(pathname, "html", scanHtml(fs.readFileSync(f, "utf8"), pathname, {}));
    } else if (r.endsWith(".map")) {
      add("/" + r, "file", [{ id: "source-map-file", where: "markup", why: "a source map file is part of the export", snippet: r }]);
    } else if (/\.(js|css)$/.test(r)) {
      const t = fs.readFileSync(f, "utf8");
      const fnd = [];
      if (/sourceMappingURL=/.test(t)) fnd.push({ id: "source-map-reference", where: "markup", why: "a sourceMappingURL reference in a public asset", snippet: "sourceMappingURL" });
      for (const re of [/Example Ltd|support@example\.test|1 Example Street|Example Pay\b/, /stage[a-z0-9-]*\.copilt\.org/]) { const m = t.match(re); if (m) fnd.push({ id: "sentinel-value", where: "markup", why: "a test sentinel or stage host inside a public asset", snippet: m[0] }); }
      if (fnd.length) add("/" + r, "asset", fnd);
    } else if (r.endsWith(".txt") && r !== "robots.txt") {
      const t = fs.readFileSync(f, "utf8").replace(/\\u0026/g, "&");
      const fnd = wordingFindings(t.replace(/\\n/g, "\n").replace(/\\"/g, '"')).filter((x) => RSC_RULES.has(x.id)).map((x) => ({ ...x, where: "rsc" }));
      if (fnd.length) add("/" + r, "rsc", fnd);
    } else if (r === "robots.txt") add("/robots.txt", "robots", robotsFindings(fs.readFileSync(f, "utf8"), origin).map((x) => ({ ...x, where: "markup" })));
    else if (r === "sitemap.xml") add("/sitemap.xml", "sitemap", sitemapFindings(fs.readFileSync(f, "utf8"), origin).map((x) => ({ ...x, where: "markup" })));
    else if (r.startsWith(".well-known/") && /stage-identity/.test(r)) add("/" + r, "file", [{ id: "stage-marker", where: "markup", why: "a staging identity file is part of the export", snippet: r }]);
  }
}

// ---- URL mode ---------------------------------------------------------------------------------------------------------------------------------------
const STATIC_PROBES = [
  { path: "/.git/config", bad: (r) => r.status === 200 && /\[core\]/.test(r.body) },
  { path: "/.env", bad: (r) => r.status === 200 && /^[A-Z_]+=/m.test(r.body) },
  { path: "/_next/webpack-hmr", bad: (r) => r.status === 200 },
  { path: "/__nextjs_original-stack-frame", bad: (r) => r.status === 200 && !/text\/html/.test(r.type) },
  { path: "/.well-known/aicc-stage-identity", bad: (r) => r.status === 200 },
];
const EDGE_PROBES = [
  { path: "/wp-json/", bad: (r) => r.status === 200 },
  { path: "/wp-json/wp/v2/users", bad: (r) => r.status === 200 },
  { path: "/xmlrpc.php", bad: (r) => r.status === 200 || r.status === 405 },
  { path: "/wp-content/debug.log", bad: (r) => r.status === 200 },
  { path: "/wp-config.php.bak", bad: (r) => r.status === 200 },
  { path: "/readme.html", bad: (r) => r.status === 200 },
  { path: "/wp-admin/install.php", bad: (r) => r.status === 200 && !/text\/html/.test(r.type) },
];
async function get(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { redirect: "manual", headers: { "user-agent": "aicc-public-truth-gate/1" } });
  const body = await res.text().catch(() => "");
  return { status: res.status, type: res.headers.get("content-type") || "", location: res.headers.get("location") || "", robots: res.headers.get("x-robots-tag") || "", body };
}
export async function scanUrl(base, { paths, alias, probes = "none", fetchImpl = fetch } = {}) {
  base = base.replace(/\/+$/, "");
  const aliasObj = alias ? { from: alias.from.replace(/\/+$/, ""), to: alias.to.replace(/\/+$/, "") } : null;
  const assets = new Set();
  for (const p of paths) {
    let url = base + p, hops = 0, r;
    for (; hops < 5; hops++) {
      r = await get(url, fetchImpl);
      if (r.status >= 300 && r.status < 400 && r.location) { url = new URL(r.location, url).toString(); continue; }
      break;
    }
    const finalPath = new URL(url).pathname;
    if (r.status >= 400) {
      add(p, "http", [{ id: "http-error", where: "markup", why: `the route answers HTTP ${r.status} (a public route must not 4xx / 5xx)`, snippet: `${r.status} ${p}` }]);
      continue;
    }
    if (!/html/.test(r.type)) { add(p, "http", [{ id: "not-html", where: "markup", why: "a page route did not answer HTML", snippet: r.type }]); continue; }
    const f = scanHtml(r.body, p, { alias: aliasObj, status: r.status, finalPath: finalPath !== p ? finalPath : null });
    if (/noindex/i.test(r.robots) && !noindexAllowed(finalPath)) f.push({ id: "noindex", where: "markup", why: "an X-Robots-Tag noindex header on a page that must be indexable", snippet: r.robots });
    add(p + (finalPath !== p ? ` -> ${finalPath}` : ""), "http", f);
    for (const m of r.body.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)) assets.add(new URL(m[1].replace(aliasObj ? aliasObj.to : "\u0000", base), base + "/").pathname);
  }
  for (const [robotsPath, fn] of [["/robots.txt", robotsFindings], ["/sitemap.xml", sitemapFindings]]) {
    const r = await get(base + robotsPath, fetchImpl);
    if (r.status === 200) add(robotsPath, "http", fn(aliasObj ? r.body.split(aliasObj.from).join(aliasObj.to) : r.body, CANONICAL_ORIGIN).map((x) => ({ ...x, where: "markup" })));
  }
  if (probes !== "none") {
    const list = probes === "edge" ? [...STATIC_PROBES, ...EDGE_PROBES] : STATIC_PROBES;
    for (const pr of list) {
      const r = await get(base + pr.path, fetchImpl).catch(() => ({ status: 0, type: "", body: "" }));
      if (pr.bad(r)) add(pr.path, "probe", [{ id: "debug-route-reachable", where: "markup", why: `a debug / internal route answers HTTP ${r.status}`, snippet: pr.path }]);
    }
    let n = 0;
    for (const a of assets) {
      if (n++ > 12) break;
      const r = await get(base + a, fetchImpl).catch(() => null);
      if (r && r.status === 200 && /sourceMappingURL=/.test(r.body)) add(a, "probe", [{ id: "source-map-reference", where: "markup", why: "a public asset references a source map", snippet: a }]);
      const m = await get(base + a + ".map", fetchImpl).catch(() => null);
      if (m && m.status === 200 && !/text\/html/.test(m.type)) add(a + ".map", "probe", [{ id: "source-map-file", where: "markup", why: "a source map is reachable", snippet: a + ".map" }]);
    }
  }
}

// ---- report -----------------------------------------------------------------------------------------------------------------------------------------
function report(label) {
  const byRule = new Map();
  let total = 0, bad = 0;
  for (const r of results) {
    if (r.findings.length) bad++;
    for (const f of r.findings) { total++; byRule.set(f.id, (byRule.get(f.id) || 0) + 1); }
  }
  console.log(`public-truth gate (${label}): ${results.length} route(s)/file(s) scanned, ${bad} with findings, ${total} finding(s)`);
  for (const r of results) {
    if (!r.findings.length) continue;
    console.log(`  ${r.route}  [${r.findings.length}]`);
    const seen = new Set();
    for (const f of r.findings) { const k = f.id + f.snippet; if (seen.has(k)) continue; seen.add(k); console.log(`     - ${f.id}: ${f.snippet}`); }
  }
  if (byRule.size) { console.log("  by rule: " + [...byRule].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ")); }
  const bySource = {};
  for (const r of results) { const b = (bySource[r.source] ||= { scanned: 0, withFindings: 0, findings: 0 }); b.scanned++; if (r.findings.length) b.withFindings++; b.findings += r.findings.length; }
  console.log("  by source: " + Object.entries(bySource).map(([k, v]) => `${k}: ${v.withFindings}/${v.scanned} with findings (${v.findings})`).join("; "));
  return { scanned: results.length, withFindings: bad, total, byRule: Object.fromEntries(byRule), bySource };
}

// ---- self test ---------------------------------------------------------------------------------------------------------------------------------------
async function selfTest() {
  let passed = 0, failed = 0;
  const check = (name, ok, detail = "") => { if (ok) passed++; else { failed++; console.error(`FAIL: ${name}${detail ? " :: " + detail : ""}`); } };
  const ctx = { origin: CANONICAL_ORIGIN, pathname: "/pricing/", status: 200, noindexAllowed: false, isError: false };
  const base = cleanPage();
  const baseFindings = analyzeDocument(base, ctx);
  check("the clean sample page has no finding (a rule that fires on it is broken)", baseFindings.length === 0, JSON.stringify(baseFindings.slice(0, 3)));
  for (const [name, mutate, want] of MUTATIONS) {
    const html = mutate(base);
    check(`mutation changes the page: ${name}`, html !== base);
    const f = analyzeDocument(html, ctx);
    check(`mutation caught: ${name} -> ${want}`, f.some((x) => x.id === want), `got [${f.map((x) => x.id).join(", ")}]`);
  }
  for (const s of CLEAN_SAMPLES) { const f = wordingFindings(s); check(`clean sentence passes: ${s.slice(0, 60)}`, f.length === 0, JSON.stringify(f)); }
  // P37 self-service: the approved free-trial strings pass ONLY on a page that carries the self-service marker; anything else free-trial-like is still caught
  {
    const ssPage = (extra, marked = true) => { const h = cleanPage({ extraBody: extra }); return marked ? h.replace('<html lang="en"', '<html lang="en" data-ss-mode="on"') : h; };
    const c = { ...ctx, ssPhrases: SS_PHRASES };
    check("self-service P40: the pack's free-trial title and lede pass on a marked page", analyzeDocument(ssPage('<a href="https://www.copilt.org/start/">Get started free</a><h2>Try it free on one store.</h2><p>The launch trial is free and needs no payment method. Choose the plan you expect to buy later: it is only your preference.</p><p>The trial covers 1 store, whichever plan you choose. A staging site counts as a store.</p>'), c).length === 0, JSON.stringify(analyzeDocument(ssPage('<h2>Try it free on one store.</h2>'), c)));
    check("self-service: the same words on an UNMARKED page are caught", analyzeDocument(ssPage('<h2>Try it free on one store.</h2>', false), c).some((x) => x.id === "free-trial"));
    check("self-service: a trial length on a marked page is caught", analyzeDocument(ssPage("<p>Start your 14-day free trial today.</p>"), c).some((x) => x.id === "free-trial"));
    check("self-service: 'try it free' on a marked page is caught", analyzeDocument(ssPage("<p>Try it free.</p>"), c).some((x) => x.id === "free-trial"));
    check("self-service: 'free for 30 days' on a marked page is caught", analyzeDocument(ssPage("<p>Use AICC free for 30 days.</p>"), c).some((x) => x.id === "free-trial"));
    // P39: the owner-required claims (two dates, no automatic conversion, "opens soon") pass ONLY as the pack's exact strings
    check("self-service P39: the pack's registration / end / no-conversion / opens-soon strings pass on a marked page", analyzeDocument(ssPage("<p>Free trial opens soon</p><p>No automatic conversion to a paid plan. Continuing is your decision.</p><p>Registration closes</p><p>Dec 24, 2026 at 00:00 UTC</p><p>Launch trial: 1 store</p>"), c).length === 0, JSON.stringify(analyzeDocument(ssPage("<p>Free trial opens soon</p><p>No automatic conversion to a paid plan. Continuing is your decision.</p>"), c)));
    check("self-service P39: the same sentences on an UNMARKED page are caught", analyzeDocument(ssPage("<p>Free trial opens soon</p>", false), c).some((x) => x.id === "free-trial"));
    check("self-service P39: a loose trial deadline claim on a marked page is caught", analyzeDocument(ssPage("<p>Free trial ends soon, register by Dec 24.</p>"), c).some((x) => x.id === "free-trial"));
    check("self-service: without ssPhrases a marked page gets no allowance", analyzeDocument(ssPage('<a href="https://www.copilt.org/start/">Start free trial</a>'), ctx).some((x) => x.id === "free-trial"));
  }
  // P40: the struck-price finding is cleared only by the attested approval (ctx.strikeApproved), never by anything on the page
  {
    const struck = cleanPage({ extraBody: '<p class="aicc-tier__price aicc-tier__price--strike" data-ss-price="strike"><s class="aicc-tier__amount"><bdi>$99</bdi></s></p>' });
    check("strike: a struck price is a finding by default", analyzeDocument(struck, ctx).some((x) => x.id === "strike-price"));
    check("strike: ... and is cleared only when the approval is attested (ctx.strikeApproved)", !analyzeDocument(struck, { ...ctx, strikeApproved: true }).some((x) => x.id === "strike-price"));
    check("strike: a stylesheet that only names the class is not a struck price", !analyzeDocument(cleanPage({ extraHead: "<style>.aicc-tier__price--strike .aicc-tier__amount{text-decoration:line-through}</style>" }), ctx).some((x) => x.id === "strike-price"));
  }
  // noindex is allowed on transactional pages, not on the pricing page
  const noidx = base.replace("</head>", '<meta name="robots" content="noindex, nofollow"></head>');
  check("noindex is allowed on /cart/", analyzeDocument(noidx.replace(/\/pricing\//g, "/cart/"), { ...ctx, pathname: "/cart/", noindexAllowed: true }).every((x) => x.id !== "noindex"));
  // robots / sitemap
  check("robots: blanket Disallow caught", robotsFindings("User-agent: *\nDisallow: /\n").some((x) => x.id === "robots-blanket-disallow"));
  check("robots: stage sitemap caught", robotsFindings("User-agent: *\nAllow: /\nSitemap: https://stage.copilt.org/sitemap.xml\n").some((x) => x.id === "robots-sitemap-origin"));
  check("robots: clean passes", robotsFindings(`User-agent: *\nAllow: /\nSitemap: ${CANONICAL_ORIGIN}/sitemap.xml\n`).length === 0);
  check("sitemap: off-origin URL caught", sitemapFindings("<urlset><url><loc>https://copilt.org/x/</loc></url></urlset>").length === 1);
  check("sitemap: clean passes", sitemapFindings(`<urlset><url><loc>${CANONICAL_ORIGIN}/x/</loc></url></urlset>`).length === 0);
  // directory mode
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "aicc-truth-"));
  try {
    fs.mkdirSync(path.join(tmp, "pricing"), { recursive: true }); fs.mkdirSync(path.join(tmp, "terms"), { recursive: true }); fs.mkdirSync(path.join(tmp, "_next/static"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "pricing/index.html"), base);
    fs.writeFileSync(path.join(tmp, "terms/index.html"), cleanPage({ canonicalPath: "/terms/", extraBody: "<p>Operated by (pending)</p>" }));
    fs.writeFileSync(path.join(tmp, "_next/static/app.js"), "var a=1;\n//# sourceMappingURL=app.js.map");
    fs.writeFileSync(path.join(tmp, "_next/static/app.js.map"), "{}");
    fs.writeFileSync(path.join(tmp, "robots.txt"), "User-agent: *\nDisallow: /\n");
    results.length = 0;
    scanDir(tmp);
    const ids = (route) => results.filter((r) => r.route === route).flatMap((r) => r.findings.map((f) => f.id));
    check("dir mode: the clean page is clean", ids("/pricing/").length === 0, ids("/pricing/").join(","));
    check("dir mode: (pending) caught on /terms/", ids("/terms/").includes("pending-marker"));
    check("dir mode: source map file + reference caught", ids("/_next/static/app.js.map").includes("source-map-file") && ids("/_next/static/app.js").includes("source-map-reference"));
    check("dir mode: blanket robots Disallow caught", ids("/robots.txt").includes("robots-blanket-disallow"));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  // url mode against a throwaway server (also proves the alias rewrite: the served origin is 127.0.0.1, the canonical is www.copilt.org)
  const srv = http.createServer((req, res) => {
    const origin = `http://127.0.0.1:${srv.address().port}`;
    const send = (code, type, body, extra = {}) => { res.writeHead(code, { "content-type": type, ...extra }); res.end(body); };
    if (req.url === "/pricing/") return send(200, "text/html", cleanPage().replace(CANONICAL_ORIGIN, origin));
    if (req.url === "/terms/") return send(200, "text/html", cleanPage({ canonicalPath: "/terms/", extraBody: '<script src="/a.js"></script><p>Governing law: TBD</p>' }).replace(CANONICAL_ORIGIN, origin), { "x-robots-tag": "noindex" });
    if (req.url === "/a.js") return send(200, "application/javascript", "x=1\n//# sourceMappingURL=a.js.map");
    if (req.url === "/a.js.map") return send(200, "application/json", "{}");
    if (req.url === "/.git/config") return send(200, "text/plain", "[core]\n");
    if (req.url === "/robots.txt") return send(200, "text/plain", `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
    return send(404, "text/plain", "not found");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const base2 = `http://127.0.0.1:${srv.address().port}`;
    results.length = 0;
    await scanUrl(base2, { paths: ["/pricing/", "/terms/", "/missing/"], alias: { from: base2, to: CANONICAL_ORIGIN }, probes: "static" });
    const ids = (route) => results.filter((r) => r.route === route).flatMap((r) => r.findings.map((f) => f.id));
    check("url mode: the clean page passes under the alias rewrite", ids("/pricing/").length === 0, ids("/pricing/").join(","));
    check("url mode: TBD + X-Robots-Tag noindex caught on /terms/", ids("/terms/").includes("todo-tbd") && ids("/terms/").includes("noindex"));
    check("url mode: a 404 route is a finding", ids("/missing/").includes("http-error"));
    check("url mode: a reachable /.git/config is a finding", ids("/.git/config").includes("debug-route-reachable"));
    check("url mode: a source map reference + reachable .map are findings", ids("/a.js").includes("source-map-reference") && ids("/a.js.map").includes("source-map-file"));
    check("url mode: robots.txt sitemap line is rewritten by the alias and passes", ids("/robots.txt").length === 0, ids("/robots.txt").join(","));
  } finally { srv.close(); }
  console.log(`public-truth-gate self-test: ${passed} passed, ${failed} failed (${MUTATIONS.length} mutations, ${CLEAN_SAMPLES.length} clean samples)`);
  process.exit(failed ? 1 : 0);
}

// ---- main ---------------------------------------------------------------------------------------------------------------------------------------------
if (has("self-test")) await selfTest();
const out = arg("out"), url = arg("url");
if (!out && !url) { console.error("usage: public-truth-gate.mjs --out <dir> | --url <base> [--preset site|cp] [--alias from=to] [--probes none|static|edge] [--json file] | --self-test"); process.exit(2); }
if (out) {
  if (!fs.existsSync(out)) { console.error(`no such directory: ${out}`); process.exit(2); }
  scanDir(path.resolve(out));
}
if (url) {
  const preset = arg("preset", "site");
  const rel = (arg("paths") ? arg("paths").split(",") : (preset === "cp" ? CP_PATHS : SITE_PATHS)).map((p) => p.replace(/^\/+/, ""));
  const paths = LOCALES.flatMap((l) => rel.map((p) => "/" + l + p));
  const al = arg("alias");
  // A copy served from another origin (a local server, a fixture) is judged as if it were served from the canonical origin: its own origin is rewritten to https://www.copilt.org before the rules run.
  const alias = al ? { from: al.split("=")[0], to: al.split("=")[1] || CANONICAL_ORIGIN } : (url.replace(/\/+$/, "") !== CANONICAL_ORIGIN ? { from: url.replace(/\/+$/, ""), to: CANONICAL_ORIGIN } : null);
  // --connect-to <ip>: judge the REAL public origin on a host public DNS does not point at yet (the DARK production host, before the DNS cutover): connect to this IP, keep the Host/SNI, accept the dark edge's internal CA
  const ip = arg("connect-to");
  const fetchVia = ip ? (u, o = {}) => new Promise((resolve, reject) => {
    const x = new URL(u);
    const req = https.request({ host: x.hostname, port: x.port || 443, path: x.pathname + x.search, method: "GET", headers: o.headers || {}, servername: x.hostname, rejectUnauthorized: false, lookup: (h, opt, cb) => (opt && opt.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)) }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => { const b = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: { get: (k) => { const v = res.headers[k.toLowerCase()]; return Array.isArray(v) ? v.join(", ") : v ?? null; } }, text: async () => b.toString("utf8") }); });
    });
    req.on("error", reject); req.setTimeout(30000, () => req.destroy(new Error("timeout"))); req.end();
  }) : fetch;
  await scanUrl(url, { paths, alias, probes: arg("probes", "none"), fetchImpl: fetchVia });
}
const summary = report(out && url ? `${out} + ${url}` : out || url);
if (arg("json")) fs.writeFileSync(arg("json"), JSON.stringify({ summary, results: results.filter((r) => r.findings.length) }, null, 1));
if (!summary.scanned) { console.error("FAIL: nothing was scanned"); process.exit(1); }
process.exit(summary.total ? 1 : 0);
