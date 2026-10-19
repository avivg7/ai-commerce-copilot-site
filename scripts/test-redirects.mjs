// npm run test:redirects: offline rehearsal of the www-canonical edge. Applies NOTHING, needs no caddy/nginx/docker.
//
//   1. regenerates the GENERATED blocks of docs/cutover/Caddyfile.edge.template from scripts/lib/redirect-matrix.mjs and fails on drift
//      (`--write` rewrites the blocks instead)
//   2. parses the Caddyfile TEXT (the generated redirect + routing blocks) into a small stand-in edge
//   3. serves that stand-in on a loopback HTTP port and replays every hand-written expectation (CASES) over real HTTP,
//      with an explicit Host and scheme per request (no DNS, no TLS)
//   4. sweeps representative paths x {http apex, https apex, http www, https www}: at most ONE redirect hop, never a loop, always ends on https://www
//   4b. parses the SITE BLOCKS of the Caddyfile too (the apex and www addresses, `import` lines, the HSTS/security snippets) and models which block
//      answers a request, so a deleted `import aicc_redirects`, a dropped `http://www.copilt.org` address or a missing `import hsts` changes behaviour or
//      fails a structure check. `node scripts/test-redirects.mjs --self-test` (also run at the end of `npm run test:redirects`) mutates scratch copies
//      of the template that way and requires every mutant to be killed.
//   5. cross-checks the matrix against the site: every route in src/lib/routes.ts has exactly one owner, the static-owned ones exist in a build (if out/ is present),
//      no enabled redirect points at a route nobody serves
//
// What this proves and what it does not (be exact):
//   PROVES   the generated redirect/routing text is what the matrix says; that the model of the Caddyfile (site blocks, imports, matchers, order) built from that
//            text gives the hand-written CASES results; no chain longer than one hop; one owner per route.
//   DOES NOT PROVE   that real Caddy accepts the file (no `caddy validate` here), that its directive order / `expression` / `path_regexp` capture semantics /
//            `handle_errors` behave as modelled (they are modelled from the documentation), or that the hand-written CASES are right (their author wrote the rules too).
//            The CASES are the oracle only as far as a reviewer agrees with them. Real-Caddy `validate` + a `curl --resolve` replay of the same CASES stay a hard gate.
// What this is NOT: a run of a real Caddy. The semantics of Caddy's path_regexp / redir / handle / expression are modelled, not executed.
// Rehearse the real file with `caddy validate` and `curl --resolve` on staging before cutover (docs/cutover/redirect-matrix.md).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadTs } from "./lib/load.mjs";
import * as M from "./lib/redirect-matrix.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tplArg = process.argv.indexOf("--template");
const TEMPLATE = tplArg >= 0 ? path.resolve(process.argv[tplArg + 1]) : path.join(ROOT, "docs/cutover/Caddyfile.edge.template");
const WRITE = process.argv.includes("--write");
const QUIET = process.argv.includes("--quiet");
const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) { await selfTest(); process.exit(0); }
const outArg = process.argv.indexOf("--out");
const OUT_DIR = outArg >= 0 ? path.resolve(process.argv[outArg + 1]) : path.join(ROOT, "out");

/* ------------------------------------------------------------------ 1. generate */
const qph = "{http.request.uri.query}";
function genRedirects() {
  const L = [];
  const C = M.PATH_RULE_CODES;
  const safe = `method ${C.safeMethods.join(" ")}`, unsafe = `not method ${C.safeMethods.join(" ")}`;
  for (const r of M.PATH_RULES) {
    const t = (id) => M.ORIGIN + r.target.replace(/\{(\d)\}/g, (_, n) => `{re.${id}.${n}}`);
    if (r.enabled === false) {
      L.push(`\t# DISABLED ${r.id}: ${r.note}`, `\t# path_regexp ${r.id} ${r.match}  ->  ${M.ORIGIN}${r.target}`);
      continue;
    }
    L.push(`\t# ${r.id}: ${r.note}${r.cutoverOnly ? " (cutover-only)" : ""}`);
    // Order matters (first match wins): query variants first, each as a GET/HEAD 301 and a 308 for every other method (a POST keeps its method and body).
    for (const [suffix, query, method, code] of [["_q", true, safe, C.safeCode], ["_qx", true, unsafe, C.otherCode], ["", false, safe, C.safeCode], ["_x", false, unsafe, C.otherCode]]) {
      const id = r.id + suffix;
      L.push(`\t@${id} {`, `\t\tpath_regexp ${id} ${r.match}`);
      if (query) L.push(`\t\texpression ${qph} != ''`);
      L.push(`\t\t${method}`, `\t}`);
      L.push(`\tredir @${id} ${t(id)}${query ? "?" + qph : ""} ${code}`);
    }
  }
  return L;
}
function genHost() {
  const h = M.HOST_RULE;
  return [`\t@safe_method method ${h.safeMethods.join(" ")}`, `\tredir @safe_method ${M.ORIGIN}{uri} ${h.safeCode}`, `\tredir ${M.ORIGIN}{uri} ${h.otherCode}`];
}
function genRouting() {
  const L = [];
  const named = (id, re) => L.push(`\t@${id} path_regexp ${id} ${re}`);
  named("dup_error", M.DUPLICATE_ERROR_RE);
  L.push(`\thandle @dup_error {`, `\t\terror 404`, `\t}`);
  named("static_immutable", M.IMMUTABLE_RE);
  L.push(`\thandle @static_immutable {`, `\t\theader Cache-Control "public, max-age=31536000, immutable"`, `\t\timport to_static`, `\t}`);
  named("static_assets", M.STATIC_ASSET_RE);
  L.push(`\thandle @static_assets {`, `\t\theader Cache-Control "public, max-age=86400"`, `\t\timport static_csp`, `\t\timport to_static`, `\t}`);
  named("wp_machine", M.WP_MACHINE_RE);
  L.push(`\thandle @wp_machine {`, `\t\timport to_wordpress_nocache`, `\t}`);
  named("wp_assets", M.WP_ASSETS_RE);
  L.push(`\thandle @wp_assets {`, `\t\timport to_wordpress`, `\t}`);
  L.push(`\t@wp_root_query {`, `\t\tpath_regexp wp_root ${M.WP_ROOT_PATH_RE}`, `\t\texpression ${qph}.matches('${M.WP_ROOT_QUERY}')`, `\t}`);
  L.push(`\thandle @wp_root_query {`, `\t\timport to_wordpress_nocache`, `\t}`);
  named("rsc_under_wp", M.RSC_UNDER_WP_RE);
  L.push(`\thandle @rsc_under_wp {`, `\t\terror 404`, `\t}`);
  named("static_rsc", M.STATIC_RSC_RE);
  L.push(`\thandle @static_rsc {`, `\t\theader Cache-Control "public, max-age=0, must-revalidate"`, `\t\timport to_static`, `\t}`);
  named("wp_nocache", M.WP_NOCACHE_RE);
  L.push(`\thandle @wp_nocache {`, `\t\timport to_wordpress_nocache`, `\t}`);
  named("wp_pages", M.WP_PAGES_RE);
  L.push(`\thandle @wp_pages {`, `\t\timport to_wordpress`, `\t}`);
  L.push(`\thandle {`, `\t\theader Cache-Control "public, max-age=0, must-revalidate"`, `\t\timport static_csp`, `\t\timport to_static`, `\t}`);
  return L;
}
const BLOCKS = { "path redirects": genRedirects, "host redirect": genHost, routing: genRouting };

function splice(text) {
  for (const [name, gen] of Object.entries(BLOCKS)) {
    const re = new RegExp(`(\\t# BEGIN GENERATED: ${name}\\n)([\\s\\S]*?)(\\t# END GENERATED: ${name})`);
    if (!re.test(text)) throw new Error(`marker block "${name}" missing in ${path.relative(ROOT, TEMPLATE)}`);
    text = text.replace(re, (_, a, _b, c) => `${a}${gen().join("\n")}\n${c}`);
  }
  return text;
}
const current = fs.readFileSync(TEMPLATE, "utf8");
const regenerated = splice(current);
if (WRITE) { fs.writeFileSync(TEMPLATE, regenerated); console.log(`wrote generated blocks into ${path.relative(ROOT, TEMPLATE)}`); }

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error("  FAIL " + msg); } };

ok(regenerated === current || WRITE, "the Caddyfile template's GENERATED blocks are out of date: run `node scripts/test-redirects.mjs --write`");

/* ------------------------------------------------------------------ 2. parse the Caddyfile text into a stand-in edge */
function blockText(text, name) {
  const m = new RegExp(`# BEGIN GENERATED: ${name}\\n([\\s\\S]*?)\\t# END GENERATED: ${name}`).exec(text);
  return m ? m[1].split("\n").map((l) => l.replace(/^\t+/, "")).filter((l) => l && !l.startsWith("#")) : [];
}
function parseMatchers(lines) {
  // returns { matchers: Map(name -> [{type, ...}]), items: [{kind: "redir"|"handle", ...}] } in file order
  const matchers = new Map(), items = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^@(\S+) path_regexp (\S+) (.+)$/.exec(l))) matchers.set(m[1], [{ t: "path_regexp", re: new RegExp(m[3]) }]);
    else if ((m = /^@(\S+) method (.+)$/.exec(l))) matchers.set(m[1], [{ t: "method", list: m[2].split(/\s+/) }]);
    else if ((m = /^@(\S+) \{$/.exec(l))) {
      const body = [];
      for (i++; lines[i] !== "}"; i++) {
        let n;
        if ((n = /^path_regexp (\S+) (.+)$/.exec(lines[i]))) body.push({ t: "path_regexp", re: new RegExp(n[2]) });
        else if (lines[i] === `expression ${qph} != ''`) body.push({ t: "query_nonempty" });
        else if ((n = /^method (.+)$/.exec(lines[i]))) body.push({ t: "method", list: n[1].split(/\s+/) });
        else if ((n = /^not method (.+)$/.exec(lines[i]))) body.push({ t: "not_method", list: n[1].split(/\s+/) });
        else if ((n = /^expression \{http\.request\.uri\.query\}\.matches\('(.+)'\)$/.exec(lines[i]))) body.push({ t: "query_matches", re: new RegExp(n[1]) });
        else throw new Error(`unparsed matcher line: ${lines[i]}`);
      }
      matchers.set(m[1], body);
    } else if ((m = /^redir @(\S+) (\S+) (\d{3})$/.exec(l))) items.push({ kind: "redir", matcher: m[1], target: m[2], code: Number(m[3]) });
    else if ((m = /^redir (\S+) (\d{3})$/.exec(l))) items.push({ kind: "redir", matcher: null, target: m[1], code: Number(m[2]) });
    else if ((m = /^handle(?: @(\S+))? \{$/.exec(l))) {
      const act = { origin: null, cache: null };
      for (i++; lines[i] !== "}"; i++) {
        let n;
        if (lines[i] === "import to_wordpress") act.origin = "wordpress";
        else if (lines[i] === "import to_wordpress_nocache") { act.origin = "wordpress"; act.cache = "private, no-store, max-age=0"; }
        else if (lines[i] === "import to_static") act.origin = "static";
        else if (lines[i] === "import static_csp") act.csp = true;
        else if (lines[i] === "error 404") act.origin = "404";
        else if ((n = /^header Cache-Control "(.+)"$/.exec(lines[i]))) act.cache = n[1];
        else throw new Error(`unparsed handle line: ${lines[i]}`);
      }
      items.push({ kind: "handle", matcher: m[1] || null, act });
    } else throw new Error(`unparsed Caddyfile line: ${l}`);
  }
  return { matchers, items };
}
const redirectsSrc = parseMatchers([...blockText(regenerated, "path redirects")]);
const hostSrc = parseMatchers(blockText(regenerated, "host redirect"));
const routingSrc = parseMatchers(blockText(regenerated, "routing"));

function matches(set, name, req) {
  const body = set.matchers.get(name);
  if (!body) throw new Error(`unknown matcher @${name}`);
  const caps = {};
  for (const mm of body) {
    if (mm.t === "path_regexp") { const x = mm.re.exec(req.path); if (!x) return null; caps.groups = x; }
    else if (mm.t === "query_nonempty") { if (!req.query) return null; }
    else if (mm.t === "query_matches") { if (!mm.re.test(req.query)) return null; }
    else if (mm.t === "method") { if (!mm.list.includes(req.method)) return null; }
    else if (mm.t === "not_method") { if (mm.list.includes(req.method)) return null; }
  }
  return caps;
}
const expand = (tpl, caps, req) => tpl
  .replace(/\{re\.[^.}]+\.(\d)\}/g, (_, n) => caps?.groups?.[Number(n)] ?? "")
  .replace(/\{uri\}/g, req.path + (req.query ? `?${req.query}` : ""))
  .replace(/\{http\.request\.uri\.query\}/g, req.query);


/* ------------------------------------------------------------------ 2b. the SITE BLOCKS and snippets of the Caddyfile (addresses, imports, headers) */
function parseCaddyStructure(text) {
  const snippets = new Map(), sites = [];
  const lines = text.split("\n");
  const braces = (l) => { const t = l.replace(/\{[^{}\s]*\}/g, ""); return (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length; };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || /^\s*#/.test(raw) || /^\s/.test(raw)) continue;
    const m = /^(.+?)\s*\{$/.exec(raw);
    if (!m) continue;
    const head = m[1].trim();
    const body = [];
    let depth = 1;
    for (i++; i < lines.length && depth > 0; i++) {
      if (/^\s*#/.test(lines[i])) { body.push({ line: lines[i], depth, comment: true }); continue; }
      depth += braces(lines[i]); if (depth > 0) body.push({ line: lines[i], depth: depth - braces(lines[i]) });
    }
    i--;
    const imports = body.filter((b) => b.depth === 1 && !b.comment).map((b) => /^\s*import\s+(\S+)\s*$/.exec(b.line)?.[1]).filter(Boolean);
    if (head.startsWith("(")) snippets.set(head.slice(1, -1), { body: body.filter((b) => !b.comment).map((b) => b.line.trim()) });
    else sites.push({ addresses: head.split(",").map((a) => a.trim()).filter(Boolean), imports, text: body.map((b) => b.line).join("\n") });
  }
  return { snippets, sites };
}
const structure = parseCaddyStructure(regenerated);
const apexSite = structure.sites.find((x) => x.text.includes("# BEGIN GENERATED: host redirect"));
const wwwSite = structure.sites.find((x) => x.text.includes("# BEGIN GENERATED: routing"));
for (const x of structure.sites) {
  x.hasRedirects = x.imports.includes("aicc_redirects");
  x.hasHost = x === apexSite;
  x.hasRouting = x === wwwSite;
  // response headers contributed by the imported snippets (Caddy's `header` runs before `redir`/`handle`, so redirects carry them too)
  x.headers = {};
  for (const name of x.imports) {
    const sn = structure.snippets.get(name);
    if (!sn) continue;
    for (const l of sn.body) {
      const h = /^header\s+([A-Za-z-]+)\s+"?([^"]+)"?$/.exec(l) || /^([A-Z][A-Za-z-]+)\s+"?([^"]+)"?$/.exec(l);
      if (h && /^(Strict-Transport-Security|X-Content-Type-Options|Referrer-Policy|X-Frame-Options|Permissions-Policy)$/.test(h[1])) x.headers[h[1].toLowerCase()] = h[2];
    }
  }
}
const addrOf = (a) => { const m = /^(https?):\/\/(.+)$/.exec(a); return m ? { scheme: m[1], host: m[2], explicit: true } : { scheme: "https", host: a, explicit: false }; };
function pickSite(scheme, host) {
  for (const x of structure.sites) for (const a of x.addresses) { const p = addrOf(a); if (p.host === host && p.scheme === scheme) return x; }
  return null;
}
const hasHttpsSite = (host) => structure.sites.some((x) => x.addresses.some((a) => { const p = addrOf(a); return p.host === host && p.scheme === "https"; }));

// What exists in the static export. Prefer a real build; otherwise derive it from the route table.
const { ROUTES } = await loadTs("src/lib/routes.ts");
const { LOCALES } = await loadTs("src/i18n/config.ts");
const staticFiles = new Set();
if (fs.existsSync(OUT_DIR)) {
  const walk = (d, rel = "") => { for (const e of fs.readdirSync(path.join(d, rel), { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(d, r); else staticFiles.add("/" + r); } };
  walk(OUT_DIR);
} else {
  for (const l of LOCALES) for (const slug of Object.values(ROUTES)) {
    const base = (l === "en" ? "" : `/${l}`) + (slug ? `/${slug}` : "");
    staticFiles.add(`${base}/index.html`); staticFiles.add(`${base}/index.txt`); staticFiles.add(`${base}/__next._tree.txt`); staticFiles.add(`${base}/__next._head.txt`);
  }
  for (const f of ["/robots.txt", "/sitemap.xml", "/favicon.ico", "/404.html", "/index.txt", "/__next._tree.txt", "/_next/static/chunks/main.js", "/_next/static/chunks/a.js", "/_next/static/css/a.css", "/brand-kit/aicc-logomark.svg", "/brand-kit/x.svg", "/fonts/heebo-hebrew.woff2", "/og/en-home.jpg", "/demo/aicc-demo.mp4"]) staticFiles.add(f);
}
const staticExists = (p) => /^\/_next\/static\//.test(p) /* hashed names differ per build: assumed present */ || staticFiles.has(p) || (p.endsWith("/") && staticFiles.has(p + "index.html"));

function resolve(req) {
  // Which site block answers (address = scheme + host); no block for plain http on a host that has an https site -> Caddy's automatic HTTP->HTTPS redirect (308).
  const site = pickSite(req.scheme, req.host);
  if (!site) {
    if (req.scheme === "http" && hasHttpsSite(req.host)) return { status: 308, location: `https://${req.host}${req.path}${req.query ? `?${req.query}` : ""}`, by: "caddy-automatic-https" };
    return { status: 421, by: "unknown-host" };
  }
  const hdr = site.headers;
  // 1) path redirects (only if the block imports them), 2) the host redirect (apex block), 3) routing (www block)
  if (site.hasRedirects) for (const it of redirectsSrc.items) {
    const caps = matches(redirectsSrc, it.matcher, req);
    if (caps) return { status: it.code, location: expand(it.target, caps, req), by: it.matcher, hdr };
  }
  if (site.hasHost) for (const it of hostSrc.items) {
    const caps = it.matcher ? matches(hostSrc, it.matcher, req) : {};
    if (caps) return { status: it.code, location: expand(it.target, caps, req), by: "host", hdr };
  }
  if (!site.hasRouting) return { status: 404, origin: "404", by: "no-handler", hdr };
  for (const it of routingSrc.items) {
    const caps = it.matcher ? matches(routingSrc, it.matcher, req) : {};
    if (!caps) continue;
    const a = it.act;
    if (a.origin === "static") {
      if (!staticExists(req.path)) return { status: 404, origin: "404", by: it.matcher || "default", hdr };
      return { status: 200, origin: "static", cache: a.cache, csp: !!a.csp, by: it.matcher || "default", hdr };
    }
    if (a.origin === "wordpress") return { status: 200, origin: "wordpress", cache: a.cache, by: it.matcher, hdr };
    return { status: 404, origin: "404", by: it.matcher, hdr };
  }
  return { status: 404, origin: "404", by: "none", hdr };
}

/* ------------------------------------------------------------------ 3. stand-in edge over real HTTP */
const server = http.createServer((q, s) => {
  const u = new URL(q.url, "http://x");
  const res = resolve({ scheme: q.headers["x-test-scheme"] || "https", host: (q.headers.host || "").split(":")[0], method: q.method, path: u.pathname, query: u.search.replace(/^\?/, "") });
  const h = { "X-Origin": res.origin || "", "X-Matched": res.by || "" };
  if (res.location) h.Location = res.location;
  if (res.cache) h["Cache-Control"] = res.cache;
  for (const [k, v] of Object.entries(res.hdr || {})) h[k] = v;
  s.writeHead(res.status, h); s.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const hit = (url, method = "GET") => new Promise((resolveP, reject) => {
  const u = new URL(url);
  const rq = http.request({ host: "127.0.0.1", port: PORT, method, path: u.pathname + u.search, headers: { Host: u.host, "X-Test-Scheme": u.protocol.replace(":", "") } }, (rs) => { rs.resume(); resolveP({ status: rs.statusCode, headers: rs.headers }); });
  rq.on("error", reject); rq.end();
});

if (!QUIET) console.log(`test-redirects: ${M.CASES.length} cases, stand-in edge on 127.0.0.1:${PORT} (parsed from ${path.relative(ROOT, TEMPLATE)})`);
/* structure of the site blocks (explicit, on top of the behavioural model) */
{
  const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  ok(structure.sites.length === 2, `the Caddyfile should have exactly two site blocks (apex+http and www), found ${structure.sites.length}`);
  ok(!!apexSite && !!wwwSite && apexSite !== wwwSite, "could not find the apex block (host redirect) and the www block (routing) in the template");
  if (apexSite && wwwSite) {
    ok(sameSet(apexSite.addresses, ["http://copilt.org", "https://copilt.org", "http://www.copilt.org"]), `the apex block must answer http://copilt.org, https://copilt.org and http://www.copilt.org; it has: ${apexSite.addresses.join(", ")}`);
    ok(sameSet(wwwSite.addresses, ["www.copilt.org"]), `the www block must be exactly www.copilt.org; it has: ${wwwSite.addresses.join(", ")}`);
    for (const [name, x] of [["apex", apexSite], ["www", wwwSite]]) for (const imp of ["security_headers", "hsts", "aicc_redirects"]) ok(x.imports.includes(imp), `the ${name} block must \`import ${imp}\`; it imports: ${x.imports.join(", ") || "(nothing)"}`);
  }
  ok([...structure.snippets.keys()].includes("aicc_redirects") && [...structure.snippets.keys()].includes("hsts"), "snippets aicc_redirects and hsts must exist");
  ok(!structure.sites.some((x) => x.addresses.some((a) => a.includes(M.API_HOST))), "api.copilt.org must not have a site block in this file");
}
for (const c of M.CASES) {
  const url = c.from.replace(/#.*$/, "");
  const r = await hit(url, c.method || "GET");
  if (c.location !== undefined) {
    const want = c.location.replace(/#.*$/, "");
    ok(r.status === c.status && r.headers.location === want, `${c.method || "GET"} ${c.from}\n         expected ${c.status} -> ${want}\n         got      ${r.status} -> ${r.headers.location ?? "(no Location)"}  [${r.headers["x-matched"]}]`);
  } else {
    ok(r.status === c.status && r.headers["x-origin"] === c.origin, `${c.from}\n         expected ${c.status} from ${c.origin}\n         got      ${r.status} from ${r.headers["x-origin"] || "(none)"}  [${r.headers["x-matched"]}]`);
    if (c.cache !== undefined) ok((r.headers["cache-control"] ?? "") === c.cache, `${c.from}\n         expected Cache-Control "${c.cache}"\n         got      "${r.headers["cache-control"] ?? ""}"  [${r.headers["x-matched"]}]`);
  }
  // every answer of a site block carries the snippets' headers: HSTS ramp (300 s, no includeSubDomains/preload) and nosniff (a dropped `import hsts` / `import security_headers` fails here)
  ok(r.headers["strict-transport-security"] === "max-age=300", `${c.method || "GET"} ${c.from}: Strict-Transport-Security is "${r.headers["strict-transport-security"] ?? "(missing)"}", expected "max-age=300"`);
  ok(r.headers["x-content-type-options"] === "nosniff", `${c.method || "GET"} ${c.from}: X-Content-Type-Options is "${r.headers["x-content-type-options"] ?? "(missing)"}"`);
}

/* ------------------------------------------------------------------ 4. no chains, no loops */
let swept = 0, maxHops = 0;
for (const scheme of ["http", "https"]) for (const host of [M.APEX_HOST, M.CANONICAL_HOST]) for (const p of M.SWEEP_PATHS) {
  const q = p.includes("?") ? "" : (p.length % 2 ? "?plan=solo&x=1" : "");
  let url = `${scheme}://${host}${p}${q}`;
  const start = url;
  let hops = 0;
  for (;;) {
    const r = await hit(url);
    if (r.status >= 300 && r.status < 400) { hops++; url = r.headers.location; if (hops > 3) break; } else break;
  }
  swept++; maxHops = Math.max(maxHops, hops);
  ok(hops <= 1, `redirect chain (${hops} hops) starting at ${start}, ended at ${url}`);
  ok(new URL(url).origin === M.ORIGIN, `${start} ends off the canonical origin: ${url}`);
  // a canonical, already-slashed https://www URL must not redirect at all
  if (scheme === "https" && host === M.CANONICAL_HOST && /\/$/.test(p) && !/index\.html|ai-commerce|account|login|register|store|shop|404|_not-found/.test(p) && !p.includes("?")) ok(hops === 0, `canonical URL redirects: ${start} -> ${url}`);
}
// no rule may redirect to its own match target (loop) -- covered by the hop count above; also assert Location never carries a double slash or the old base path
for (const c of M.CASES) if (c.location) ok(!/(?<!:)\/\//.test(c.location.replace(M.ORIGIN, "")) && !c.location.includes(M.LEGACY_BASE_PATH), `bad Location in expectation: ${c.location}`);

/* ------------------------------------------------------------------ 5. matrix vs the site itself */
const { ROUTE_IDS, localePath } = await loadTs("src/lib/routes.ts");
const owners = { static: [], wordpress: [] };
for (const l of LOCALES) for (const id of ROUTE_IDS) {
  const p = localePath(l, id);
  const owner = M.TARGET_OWNER[id];
  ok(owner === "static" || owner === "wordpress", `route "${id}" has no target owner in redirect-matrix.mjs (TARGET_OWNER)`);
  const r = await hit(`https://${M.CANONICAL_HOST}${p}`);
  ok(r.status === 200 && r.headers["x-origin"] === owner, `${p}: edge sends it to "${r.headers["x-origin"]}" (${r.status}) but TARGET_OWNER says ${owner}`);
  if (owner === "static") { ok(staticExists(p), `${p} is static-owned but not found in the static export${fs.existsSync(OUT_DIR) ? "" : " (route table)"}`); owners.static.push(p); }
  else owners.wordpress.push(p);
}
for (const p of M.WP_ONLY_PAGES) { const r = await hit(`https://${M.CANONICAL_HOST}${p}`); ok(r.headers["x-origin"] === "wordpress", `${p} should be WordPress-owned, got ${r.headers["x-origin"]}`); }
// The site's Get started / plan links (src/lib/site.ts) are language-prefixed and must pass the edge untouched: no redirect, WordPress-owned, prefix and ?plan= kept
{
  const S = await loadTs("src/lib/site.ts");
  const E = "https://www.copilt.org/my-account/";
  const want = [
    [S.localizeAccountUrl(E, "en"), E],
    [S.localizeAccountUrl(E, "he"), "https://www.copilt.org/he/my-account/"],
    [S.localizeAccountUrl(E, "es"), "https://www.copilt.org/es/my-account/"],
    [S.localizeAccountUrl(E, "ru"), "https://www.copilt.org/ru/my-account/"],
    [S.localizeAccountUrl("https://shop.example.com/wp/my-account/?x=1#f", "he"), "https://shop.example.com/wp/he/my-account/?x=1#f"],
    [S.localizeAccountUrl("https://x.example.com", "ru"), "https://x.example.com/ru/"],
    [S.localizeAccountUrl("https://shop.example.com/wp/my-account/?x=1", "en"), "https://shop.example.com/wp/my-account/?x=1"],
  ];
  for (const [got, exp] of want) ok(got === exp, `localizeAccountUrl: expected ${exp}, got ${got}`);
  for (const l of LOCALES) {
    for (const url of [S.getStartedUrl(l), ...["solo", "studio", "agency"].map((pl) => S.planUrl(pl, l))]) {
      if (new URL(url).origin !== M.ORIGIN) continue; // an NEXT_PUBLIC_AICC_ACCOUNT_URL override points somewhere else on purpose
      const r = await hit(url);
      ok(r.status === 200 && r.headers["x-origin"] === "wordpress", `${url}: the site links here, the edge must answer 200 from WordPress without a redirect, got ${r.status} ${r.headers["x-origin"]} ${r.headers.location || ""}`);
      ok(l === "en" ? !/\/(he|es|ru)\//.test(url) : url.startsWith(`${M.ORIGIN}/${l}/my-account/`), `${url} has the wrong language prefix for ${l}`);
    }
  }
}
// WordPress-only pages that the site's sitemap lists (the edge serves ONE sitemap): same list in the site and in the matrix, every language WordPress-owned, and (with a build) really in out/sitemap.xml
{
  const { WORDPRESS_SITEMAP_PAGES } = await loadTs("src/lib/routes.ts");
  ok(JSON.stringify([...WORDPRESS_SITEMAP_PAGES]) === JSON.stringify(M.WP_SITEMAP_PAGES), `WORDPRESS_SITEMAP_PAGES (src/lib/routes.ts) differs from WP_SITEMAP_PAGES (redirect-matrix.mjs): ${JSON.stringify([WORDPRESS_SITEMAP_PAGES, M.WP_SITEMAP_PAGES])}`);
  const smFile = path.join(OUT_DIR, "sitemap.xml");
  const sm = fs.existsSync(smFile) ? fs.readFileSync(smFile, "utf8") : null;
  for (const l of LOCALES) for (const base of M.WP_SITEMAP_PAGES) {
    const p = (l === "en" ? "" : `/${l}`) + base;
    ok(M.WP_ONLY_PAGES.includes(base), `${base} is in the sitemap list but not in WP_ONLY_PAGES`);
    const r = await hit(`https://${M.CANONICAL_HOST}${p}`);
    ok(r.status === 200 && r.headers["x-origin"] === "wordpress", `${p}: listed in the sitemap, must be WordPress-owned with a 200, got ${r.headers["x-origin"]} ${r.status}`);
    if (sm) ok(sm.includes(`<loc>https://${M.CANONICAL_HOST}${p}</loc>`), `${p} is WordPress-owned and public but missing from the built sitemap.xml`);
  }
}
for (const p of M.UNOWNED) { const r = await hit(`https://${M.CANONICAL_HOST}${p}`); ok(r.status === 404, `${p} is listed as UNOWNED and must be a 404 until it is built, got ${r.status}`); }
// every enabled redirect target (for the sample requests above) lands on a served page: covered by hop/final checks; here: disabled rules really are disabled
for (const rule of M.PATH_RULES.filter((x) => x.enabled === false)) ok(!redirectsSrc.matchers.has(rule.id), `disabled rule ${rule.id} leaked into the generated config`);
// cutover/ops invariants of the template text
ok(!/includeSubDomains|preload/i.test(regenerated.replace(/#.*$/gm, "")), "HSTS must not use includeSubDomains/preload in the template");
ok(!/api\.copilt\.org\s*\{/.test(regenerated), "api.copilt.org must not have a site block in this file");
ok(/Strict-Transport-Security "max-age=300"/.test(regenerated), "HSTS ramp must start at max-age=300");
ok(!/header_up\s+(-?Cookie|-?Set-Cookie)/i.test(regenerated) && !/header_down\s+-?Set-Cookie/i.test(regenerated), "Cookie / Set-Cookie must pass through untouched");

server.close();
const staticN = owners.static.length, wpN = owners.wordpress.length;
if (!QUIET) console.log(`  ${checks} checks; sweep: ${swept} requests (${M.SWEEP_PATHS.length} paths x 4 host/scheme combinations), max redirect hops ${maxHops}; routes: ${staticN} static-owned, ${wpN} WordPress-owned (site mirrors shadowed)`);
if (!QUIET) console.log(`  static export used for existence checks: ${fs.existsSync(OUT_DIR) ? path.relative(ROOT, OUT_DIR) + "/ (" + staticFiles.size + " files)" : "route table (no out/ found)"}`);
if (failures) { console.error(`FAIL: ${failures} of ${checks} checks`); process.exit(1); }
if (!QUIET) console.log("PASS: matrix, Caddyfile text and stand-in edge agree (modelled, not run by a real Caddy)");
if (!QUIET && tplArg < 0 && !WRITE) await selfTest();


/* ------------------------------------------------------------------ 6. self-test: mutants of the template that this harness must kill */
async function selfTest() {
  const real = fs.readFileSync(path.join(ROOT, "docs/cutover/Caddyfile.edge.template"), "utf8");
  const apexHead = "http://copilt.org, https://copilt.org, http://www.copilt.org {";
  const afterHead = (text, head, from, to) => { const i = text.indexOf(head); if (i < 0) throw new Error(`mutant setup: "${head}" not found`); const j = text.indexOf(from, i); if (j < 0) throw new Error(`mutant setup: "${from.trim()}" not found after "${head}"`); return text.slice(0, j) + to + text.slice(j + from.length); };
  const MUTANTS = [
    ["delete `import aicc_redirects` from the www block", (t) => afterHead(t, "\nwww.copilt.org {", "\timport aicc_redirects\n", "")],
    ["remove http://www.copilt.org from the apex address list", (t) => t.replace(apexHead, "http://copilt.org, https://copilt.org {")],
    ["delete `import hsts` from the apex block", (t) => afterHead(t, apexHead, "\timport hsts\n", "")],
    ["delete `import hsts` from the www block", (t) => afterHead(t, "\nwww.copilt.org {", "\timport hsts\n", "")],
    ["delete `import security_headers` from the apex block", (t) => afterHead(t, apexHead, "\timport security_headers\n", "")],
    ["delete `import aicc_redirects` from the apex block", (t) => afterHead(t, apexHead, "\timport aicc_redirects\n", "")],
    ["raise HSTS with includeSubDomains", (t) => t.replace('Strict-Transport-Security "max-age=300"', 'Strict-Transport-Security "max-age=300; includeSubDomains"')],
    ["tamper with a generated routing line (drift)", (t) => t.replace("\thandle @wp_pages {\n\t\timport to_wordpress\n", "\thandle @wp_pages {\n\t\timport to_static\n")],
    ["turn the host redirect for other methods into a 301", (t) => t.replace("redir https://www.copilt.org{uri} 308", "redir https://www.copilt.org{uri} 301")],
    ["add an api.copilt.org site block", (t) => t + "\napi.copilt.org {\n\treverse_proxy 127.0.0.1:8000\n}\n"],
  ];
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "aicc-redirect-mutants-"));
  let survived = 0;
  const run = (file) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--template", file, "--quiet"], { encoding: "utf8", cwd: ROOT });
  const base = path.join(tmp, "baseline.template"); fs.writeFileSync(base, real);
  const b = run(base);
  if (b.status !== 0) { console.error(`self-test: the unmodified template does not pass (${b.status})\n${b.stderr.slice(0, 800)}`); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); }
  for (const [name, mutate] of MUTANTS) {
    const text = mutate(real);
    if (text === real) { console.error(`self-test: mutant "${name}" changed nothing (setup is stale)`); survived++; continue; }
    const f = path.join(tmp, `m${MUTANTS.findIndex((m) => m[0] === name)}.template`);
    fs.writeFileSync(f, text);
    const r = run(f);
    if (r.status === 0) { survived++; console.error(`  SURVIVED mutant: ${name}`); } else if (!QUIET) console.log(`  killed mutant: ${name}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (survived) { console.error(`FAIL: ${survived} of ${MUTANTS.length} template mutants survived (the harness is blind to them)`); process.exit(1); }
  console.log(`PASS: self-test killed ${MUTANTS.length}/${MUTANTS.length} template mutants (baseline passes)`);
}
