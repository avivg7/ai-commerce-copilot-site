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
// Renders: the committed template is the PRODUCTION topology. `npm run test:redirects` also RENDERS the stage topology (scripts/lib/edge-render.mjs) and replays the retargeted
// matrix against that render in a child run (`--template <render> --stage-host <host>`), checks the production render has no identity route, and mutates both.
//
// What this proves and what it does not (be exact):
//   PROVES   the generated redirect/routing text is what the matrix says; that the model of the Caddyfile (site blocks, imports, matchers, order) built from that
//            text gives the hand-written CASES results; no chain longer than one hop; one owner per route.
//   DOES NOT PROVE   that real Caddy accepts the file (no `caddy validate` here), that its directive order / `expression` / `path_regexp` capture semantics /
//            `handle_errors` behave as modelled (they are modelled from the documentation), or that the hand-written CASES are right (their author wrote the rules too).
//            The CASES are the oracle only as far as a reviewer agrees with them. Real-Caddy `validate` + a `curl --resolve` replay of the same CASES stay a hard gate.
// What this is NOT: a run of a real Caddy. The semantics of Caddy's path_regexp / redir / handle / expression are modelled, not executed.
// The real binary has now been run against this file (2026-10-20): `node scripts/rehearsal/rehearsal.mjs run-tests` replays the same CASES through Caddy 2.11.7
// (docs/cutover/rehearsal.md lists every place the model disagreed with the real thing and what changed). Keep both: this one is the fast offline gate, that one the truth.
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
const stageArg = process.argv.indexOf("--stage-host");
/** Child mode: the template given with --template is a STAGE render for this literal host (generated blocks are not re-checked against the production text). */
const STAGE_HOST = stageArg >= 0 ? process.argv[stageArg + 1] : null;
const CANON = STAGE_HOST || M.CANONICAL_HOST;
const ORIGIN_L = `https://${CANON}`;
const CASES = STAGE_HOST ? M.retargetCases(M.CASES, STAGE_HOST) : M.CASES;
const OPERATOR_SITE_ADDR = `${CANON}:{$AICC_OPERATOR_PORT:8443}`;
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
function genRouting(operator = false) {
  const L = [];
  const named = (id, re) => L.push(`\t@${id} path_regexp ${id} ${re}`);
  const deny = (id, code, text) => L.push(`\thandle @${id} {`, `\t\theader Cache-Control "no-store"`, `\t\trespond "${text}" ${code}`, `\t}`);
  const OPS = "{$AICC_OPERATOR_CIDRS}";
  // The operator listener tells PHP so with a FastCGI parameter written by the edge: the arguments of `import to_wordpress*` travel to the php_fastcgi block of (wp_proxy_fastcgi). The public listener passes none.
  const ENV = operator ? " env AICC_EDGE_LISTENER operator" : "";
  // `vars_regexp` on {http.request.uri.path} sees the path AS SENT (decoded, not cleaned); Caddy's path/path_regexp matchers see a CLEANED path (real-run finding, see rehearsal.md)
  L.push(`\t@bad_path vars_regexp bad_path {http.request.uri.path} ${M.BAD_PATH_RE}`);
  deny("bad_path", 400, "Bad request");
  L.push(`\t@bad_method method TRACE TRACK CONNECT`);
  deny("bad_method", 405, "Method not allowed");
  named("xmlrpc_deny", M.XMLRPC_RE);
  deny("xmlrpc_deny", 403, "Forbidden");
  if (!operator) {
    // PUBLIC listener: the three operator surfaces are denied (an OPTIONAL AICC_OPERATOR_CIDRS list, empty by default, is the only other way in)
    L.push(`\t@wp_cron_deny {`, `\t\tpath_regexp wp_cron_deny ${M.WP_CRON_RE}`, `\t\tnot remote_ip ${OPS}`, `\t}`);
    deny("wp_cron_deny", 403, "Forbidden");
    L.push(`\t@wp_admin_deny {`, `\t\tpath_regexp wp_admin_deny ${M.WP_ADMIN_RE}`, `\t\tnot path_regexp wp_admin_public ${M.WP_ADMIN_PUBLIC_RE}`, `\t\tnot remote_ip ${OPS}`, `\t}`);
    deny("wp_admin_deny", 403, "Forbidden");
    L.push(`\t@wp_login_deny {`, `\t\tpath_regexp wp_login_deny ${M.WP_LOGIN_RE}`, `\t\tnot expression {http.request.method} in [${M.WP_LOGIN_PUBLIC_METHODS.map((x) => `'${x}'`).join(",")}] && {http.request.uri.path} == '${M.WP_LOGIN_PUBLIC_PATH}' && {http.request.uri.query}.matches('${M.WP_LOGIN_PUBLIC_QUERY}')`, `\t\tnot remote_ip ${OPS}`, `\t}`);
    deny("wp_login_deny", 403, "Forbidden");
  }
  // Linux/stage architecture: PHP only through WordPress's entry points; private files of WordPress's trees are never served. Both listeners.
  L.push(`\t@php_direct {`, `\t\tpath_regexp php_direct ${M.PHP_DENY_RE}`, `\t\tnot path_regexp php_entry ${M.PHP_ENTRY_RE}`, `\t}`);
  L.push(`\thandle @php_direct {`, `\t\terror 404`, `\t}`);
  named("wp_hidden", M.WP_HIDDEN_RE);
  L.push(`\thandle @wp_hidden {`, `\t\terror 404`, `\t}`);
  // security review B, F-11: Apache-only protections do not exist under Caddy (dotfiles, WooCommerce private dirs, dumps/backups/archives/keys). Both listeners.
  L.push(`\t@dotfile_deny {`, `\t\tpath_regexp dotfile_deny ${M.DOTFILE_RE}`, `\t\tnot path_regexp dotfile_ok ${M.DOTFILE_PUBLIC_RE}`, `\t}`, `\thandle @dotfile_deny {`, `\t\terror 404`, `\t}`);
  for (const [id, re] of [["wp_private_dirs", M.WP_PRIVATE_DIRS_RE], ["sensitive_ext", M.SENSITIVE_EXT_RE]]) { named(id, re); L.push(`\thandle @${id} {`, `\t\terror 404`, `\t}`); }
  // everything of /wp-admin/ that is still here is an operator (or the public admin-ajax/admin-post): operators may upload big files, the public routes keep the 2 MB cap
  L.push(`\t@wp_admin_big {`, `\t\tpath_regexp wp_admin_big ${M.WP_ADMIN_RE}`, `\t\tnot path_regexp wp_admin_big_public ${M.WP_ADMIN_PUBLIC_RE}`, `\t}`);
  L.push(`\thandle @wp_admin_big {`, `\t\timport to_wordpress_admin${ENV}`, `\t}`);
  named("dup_error", M.DUPLICATE_ERROR_RE);
  L.push(`\thandle @dup_error {`, `\t\terror 404`, `\t}`);
  if (!operator) {
    // REST API index (review H-4): public listener only; the operator listener keeps /wp-json/ for wp-admin. Namespaced routes are not matched.
    named("wp_rest_index_path", M.WP_REST_INDEX_PATH_RE);
    L.push(`\thandle @wp_rest_index_path {`, `\t\terror 404`, `\t}`);
    L.push(`\t@wp_rest_index_query {`, `\t\texpression ${qph}.matches('${M.WP_REST_INDEX_QUERY}')`, `\t}`);
    L.push(`\thandle @wp_rest_index_query {`, `\t\terror 404`, `\t}`);
  }
  named("static_immutable", M.IMMUTABLE_RE);
  L.push(`\thandle @static_immutable {`, `\t\theader Cache-Control "public, max-age=31536000, immutable"`, `\t\timport to_static`, `\t}`);
  named("static_demo", M.STATIC_DEMO_RE);
  L.push(`\thandle @static_demo {`, `\t\theader Cache-Control "public, max-age=0, must-revalidate"`, `\t\timport static_csp`, `\t\timport to_static`, `\t}`);
  named("static_assets", M.STATIC_ASSET_RE);
  L.push(`\thandle @static_assets {`, `\t\theader Cache-Control "public, max-age=86400"`, `\t\timport static_csp`, `\t\timport to_static`, `\t}`);
  named("wp_machine", M.WP_MACHINE_RE);
  L.push(`\thandle @wp_machine {`, `\t\timport to_wordpress_nocache${ENV}`, `\t}`);
  named("wp_assets", M.WP_ASSETS_RE);
  L.push(`\thandle @wp_assets {`, `\t\timport to_wordpress${ENV}`, `\t}`);
  L.push(`\t@wp_root_query {`, `\t\tpath_regexp wp_root ${M.WP_ROOT_PATH_RE}`, `\t\texpression ${qph}.matches('${M.WP_ROOT_QUERY}')`, `\t}`);
  L.push(`\thandle @wp_root_query {`, `\t\timport to_wordpress_nocache${ENV}`, `\t}`);
  named("rsc_under_wp", M.RSC_UNDER_WP_RE);
  L.push(`\thandle @rsc_under_wp {`, `\t\terror 404`, `\t}`);
  named("static_rsc", M.STATIC_RSC_RE);
  L.push(`\thandle @static_rsc {`, `\t\theader Cache-Control "public, max-age=0, must-revalidate"`, `\t\timport to_static`, `\t}`);
  named("wp_nocache", M.WP_NOCACHE_RE);
  L.push(`\thandle @wp_nocache {`, `\t\timport to_wordpress_nocache${ENV}`, `\t}`);
  named("wp_pages", M.WP_PAGES_RE);
  L.push(`\thandle @wp_pages {`, `\t\timport to_wordpress${ENV}`, `\t}`);
  L.push(`\thandle {`, `\t\theader Cache-Control "public, max-age=0, must-revalidate"`, `\t\timport static_csp`, `\t\timport to_static`, `\t}`);
  return L;
}
const BLOCKS = { "path redirects": genRedirects, "host redirect": genHost, routing: () => genRouting(false), "routing operator": () => genRouting(true) };

function splice(text) {
  for (const [name, gen] of Object.entries(BLOCKS)) {
    const re = new RegExp(`(\\t# BEGIN GENERATED: ${name}\\n)([\\s\\S]*?)(\\t# END GENERATED: ${name})`);
    if (!re.test(text)) throw new Error(`marker block "${name}" missing in ${path.relative(ROOT, TEMPLATE)}`);
    text = text.replace(re, (_, a, _b, c) => `${a}${gen().join("\n")}\n${c}`);
  }
  return text;
}
const current = fs.readFileSync(TEMPLATE, "utf8");
const regenerated = STAGE_HOST ? current : splice(current);
if (WRITE) { fs.writeFileSync(TEMPLATE, regenerated); console.log(`wrote generated blocks into ${path.relative(ROOT, TEMPLATE)}`); }

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error("  FAIL " + msg); } };

ok(regenerated === current || WRITE, "the Caddyfile template's GENERATED blocks are out of date: run `node scripts/test-redirects.mjs --write`");

/* ------------------------------------------------------------------ 2. parse the Caddyfile text into a stand-in edge */
function blockText(text, name) {
  const m = new RegExp(`# BEGIN GENERATED: ${name}\\n([\\s\\S]*?)\\t# END GENERATED: ${name}`).exec(text);
  return m ? m[1].split("\n").map((l) => l.replace(/^\t+/, "")).filter((l) => l && !l.startsWith("#")) : [];
}
// Caddy's path / path_regexp matchers see a CLEANED path: dot-segments resolved and slashes merged (observed with the real binary; the first model assumed otherwise)
const cleanPath = (p) => { const n = path.posix.normalize(p); return p.endsWith("/") && !n.endsWith("/") ? n + "/" : n; };
const mkRe = (src) => (src.startsWith("(?i)") ? new RegExp(src.slice(4), "i") : new RegExp(src));
function parseMatchers(lines) {
  // returns { matchers: Map(name -> [{type, ...}]), items: [{kind: "redir"|"handle", ...}] } in file order
  const matchers = new Map(), items = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^@(\S+) vars_regexp (\S+) \{http\.request\.uri\.path\} (.+)$/.exec(l))) matchers.set(m[1], [{ t: "raw_path_regexp", re: mkRe(m[3]) }]);
    else if ((m = /^@(\S+) path_regexp (\S+) (.+)$/.exec(l))) matchers.set(m[1], [{ t: "path_regexp", re: mkRe(m[3]) }]);
    else if ((m = /^@(\S+) method (.+)$/.exec(l))) matchers.set(m[1], [{ t: "method", list: m[2].split(/\s+/) }]);
    else if ((m = /^@(\S+) \{$/.exec(l))) {
      const body = [];
      for (i++; lines[i] !== "}"; i++) {
        let n;
        if ((n = /^path_regexp (\S+) (.+)$/.exec(lines[i]))) body.push({ t: "path_regexp", re: mkRe(n[2]) });
        else if ((n = /^not path_regexp (\S+) (.+)$/.exec(lines[i]))) body.push({ t: "not_path_regexp", re: mkRe(n[2]) });
        else if (lines[i] === "not remote_ip {$AICC_OPERATOR_CIDRS}") body.push({ t: "not_operator" });
        else if ((n = /^not expression \{http\.request\.method\} in \[([^\]]+)\] && \{http\.request\.uri\.path\} == '([^']+)' && \{http\.request\.uri\.query\}\.matches\('(.+)'\)$/.exec(lines[i]))) body.push({ t: "not_login_public", methods: n[1].split(",").map((x) => x.replace(/'/g, "")), path: n[2], re: mkRe(n[3]) });
        else if ((n = /^not expression \{http\.request\.uri\.query\}\.matches\('(.+)'\)$/.exec(lines[i]))) body.push({ t: "not_query_matches", re: mkRe(n[1]) });
        else if (lines[i] === `expression ${qph} != ''`) body.push({ t: "query_nonempty" });
        else if ((n = /^method (.+)$/.exec(lines[i]))) body.push({ t: "method", list: n[1].split(/\s+/) });
        else if ((n = /^not method (.+)$/.exec(lines[i]))) body.push({ t: "not_method", list: n[1].split(/\s+/) });
        else if ((n = /^expression \{http\.request\.uri\.query\}\.matches\('(.+)'\)$/.exec(lines[i]))) body.push({ t: "query_matches", re: mkRe(n[1]) });
        else throw new Error(`unparsed matcher line: ${lines[i]}`);
      }
      matchers.set(m[1], body);
    } else if ((m = /^redir @(\S+) (\S+) (\d{3})$/.exec(l))) items.push({ kind: "redir", matcher: m[1], target: m[2], code: Number(m[3]) });
    else if ((m = /^redir (\S+) (\d{3})$/.exec(l))) items.push({ kind: "redir", matcher: null, target: m[1], code: Number(m[2]) });
    else if ((m = /^handle(?: @(\S+))? \{$/.exec(l))) {
      const act = { origin: null, cache: null };
      for (i++; lines[i] !== "}"; i++) {
        let n;
        if ((n = /^import (to_wordpress(?:_admin|_nocache)?)( env AICC_EDGE_LISTENER operator)?$/.exec(lines[i]))) {
          act.origin = "wordpress"; act.listenerEnv = Boolean(n[2]);
          if (n[1] !== "to_wordpress") act.cache = "private, no-store, max-age=0";
        }
        else if (lines[i] === "import to_static") act.origin = "static";
        else if (lines[i] === "import static_csp") act.csp = true;
        else if (lines[i] === "error 404") act.origin = "404";
        else if ((n = /^respond "([^"]*)" (\d{3})$/.exec(lines[i]))) { act.origin = "deny"; act.status = Number(n[2]); }
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
const routingOpSrc = parseMatchers(blockText(regenerated, "routing operator"));

function matches(set, name, req) {
  const body = set.matchers.get(name);
  if (!body) throw new Error(`unknown matcher @${name}`);
  const caps = {};
  for (const mm of body) {
    if (mm.t === "raw_path_regexp") { if (!mm.re.test(req.path)) return null; }
    else if (mm.t === "path_regexp") { const x = mm.re.exec(req.cleanPath ?? req.path); if (!x) return null; caps.groups = x; }
    else if (mm.t === "query_nonempty") { if (!req.query) return null; }
    else if (mm.t === "query_matches") { if (!mm.re.test(req.query)) return null; }
    else if (mm.t === "not_path_regexp") { if (mm.re.test(req.cleanPath ?? req.path)) return null; }
    else if (mm.t === "not_query_matches") { if (mm.re.test(req.query)) return null; }
    else if (mm.t === "not_login_public") { if (mm.methods.includes(req.method) && req.path === mm.path && mm.re.test(req.query)) return null; }
    else if (mm.t === "not_operator") { if (req.operatorCidr) return null; }
    else if (mm.t === "method") { if (!mm.list.includes(req.method)) return null; }
    else if (mm.t === "not_method") { if (mm.list.includes(req.method)) return null; }
  }
  return caps;
}
const expand = (tpl, caps, req) => tpl
  .replace(/\{re\.[^.}]+\.(\d)\}/g, (_, n) => caps?.groups?.[Number(n)] ?? "")
  .replace(/\{uri\}/g, (req.rawPath ?? req.path) + (req.query ? `?${req.query}` : ""))
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
    const imports = body.filter((b) => b.depth === 1 && !b.comment).map((b) => /^\s*import\s+(\S+)(?:\s+\S+)*\s*$/.exec(b.line)?.[1]).filter(Boolean);
    if (head.startsWith("(")) snippets.set(head.slice(1, -1), { body: body.filter((b) => !b.comment).map((b) => b.line.trim()) });
    else sites.push({ addresses: head.split(",").map((a) => a.trim()).filter(Boolean), imports, text: body.map((b) => b.line).join("\n") });
  }
  return { snippets, sites };
}
const structure = parseCaddyStructure(regenerated);
// imports, followed through snippets that import other snippets (apex_site imports edge_log, security_headers, hsts, aicc_redirects)
// aicc_error_pages is a LEAF: the imports inside its handle_errors apply to error responses only, they must not count as the site block's own headers
const allImportsOf = (names, seen = new Set()) => { for (const n of names) { if (seen.has(n)) continue; seen.add(n); const sn = structure.snippets.get(n); if (sn && n !== "aicc_error_pages") allImportsOf(sn.body.map((l) => /^import\s+(\S+)(?:\s+\S+)*$/.exec(l)?.[1]).filter(Boolean), seen); } return seen; };
for (const x of structure.sites) x.allImports = [...allImportsOf(x.imports)];
const apexSites = structure.sites.filter((x) => x.allImports.includes("apex_site"));
const apexSite = apexSites[0]; // the http:// block (the https one is checked separately)
const apexHttpsSite = apexSites.find((x) => x.addresses.some((a) => a.startsWith("https://")));
const apexHttpSite = apexSites.find((x) => x.addresses.every((a) => a.startsWith("http://")));
const wwwSite = structure.sites.find((x) => x.text.includes("# BEGIN GENERATED: routing\n"));
const opSite = structure.sites.find((x) => x.text.includes("# BEGIN GENERATED: routing operator\n"));
for (const x of structure.sites) {
  x.hasRedirects = x.allImports.includes("aicc_redirects");
  x.hasHost = apexSites.includes(x);
  x.hasRouting = x === wwwSite || x === opSite;
  x.routing = x === opSite ? routingOpSrc : routingSrc;
  // response headers contributed by the imported snippets (Caddy's `header` runs before `redir`/`handle`, so redirects carry them too)
  x.headers = {};
  for (const name of x.allImports) {
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
  // The OPERATOR listener is a different socket (127.0.0.1:8443): only it answers a request that arrived there, whatever the Host header says; a public request never reaches it.
  const site = req.operator ? (req.host === CANON ? opSite : null) : pickSite(req.scheme, req.host);
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
  for (const it of site.routing.items) {
    const caps = it.matcher ? matches(site.routing, it.matcher, req) : {};
    if (!caps) continue;
    const a = it.act;
    if (a.origin === "static") {
      if (!staticExists(req.path)) return { status: 404, origin: "404", by: it.matcher || "default", hdr };
      return { status: 200, origin: "static", cache: a.cache, csp: !!a.csp, by: it.matcher || "default", hdr };
    }
    if (a.origin === "deny") return { status: a.status, origin: "edge-deny", cache: a.cache, by: it.matcher, hdr };
    if (a.origin === "wordpress") return { status: 200, origin: "wordpress", cache: a.cache, by: it.matcher, hdr };
    return { status: 404, origin: "404", by: it.matcher, hdr };
  }
  return { status: 404, origin: "404", by: "none", hdr };
}

/* ------------------------------------------------------------------ 3. stand-in edge over real HTTP */
const server = http.createServer((q, s) => {
  const [rawPath, ...qs] = q.url.split("?");
  const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  const res = resolve({ scheme: q.headers["x-test-scheme"] || "https", host: (q.headers.host || "").split(":")[0], method: q.method, path: dec(rawPath), cleanPath: cleanPath(dec(rawPath)), rawPath, query: qs.join("?"), operator: q.headers["x-test-peer"] === "operator", operatorCidr: q.headers["x-test-peer"] === "cidr" });
  const h = { "X-Origin": res.origin || "", "X-Matched": res.by || "" };
  if (res.location) h.Location = res.location;
  if (res.cache) h["Cache-Control"] = res.cache;
  for (const [k, v] of Object.entries(res.hdr || {})) h[k] = v;
  s.writeHead(res.status, h); s.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const hit = (url, method = "GET", peer = "public") => new Promise((resolveP, reject) => {
  // NOT `new URL(url)`: the WHATWG parser would normalise dot-segments (`/a/../b`) before they are sent, and the edge must see them as written.
  const m = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/.exec(url);
  const rq = http.request({ host: "127.0.0.1", port: PORT, method, path: (m[3] || "/") + (m[4] || ""), headers: { Host: m[2], "X-Test-Scheme": m[1], "X-Test-Peer": peer } }, (rs) => { rs.resume(); resolveP({ status: rs.statusCode, headers: rs.headers }); });
  rq.on("error", reject); rq.end();
});

if (!QUIET) console.log(`test-redirects: ${CASES.length} cases, stand-in edge on 127.0.0.1:${PORT} (parsed from ${path.relative(ROOT, TEMPLATE)})`);
/* structure of the site blocks (explicit, on top of the behavioural model) */
{
  const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const code = regenerated.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const snip = (n) => (structure.snippets.get(n)?.body || []);
  const snipText = (n) => snip(n).join("\n");
  if (STAGE_HOST) ok(structure.sites.length === 4, `the STAGE render should have four site blocks (http://${CANON}, the http:// 421 catch-all, ${CANON}, the operator listener), found ${structure.sites.length}`);
  else ok(structure.sites.length === 5, `the Caddyfile should have exactly five site blocks (http:// apex+www, https://copilt.org, the catch-all http:// that answers unknown Hosts with 421, www, and the loopback operator listener), found ${structure.sites.length}`);
  // review F1 (architecture): a "tls <cert> <key>" line in a block that also has http:// addresses is rejected by caddy validate, so aicc_tls may only be imported by blocks whose addresses are all https
  for (const x of structure.sites) if (x.allImports.includes("aicc_tls")) ok(x.addresses.every((a) => !a.startsWith("http://")), `aicc_tls is imported by a block with an http:// address (${x.addresses.join(", ")}): "tls <file> <file>" would fail caddy validate`);
  if (!STAGE_HOST) {
    ok(!!apexHttpSite && !!apexHttpsSite && sameSet(apexHttpSite.addresses, ["http://copilt.org", "http://www.copilt.org"]) && sameSet(apexHttpsSite.addresses, ["https://copilt.org"]), `the apex must be split into http://copilt.org, http://www.copilt.org (no TLS) and https://copilt.org (imports aicc_tls); found: ${apexSites.map((x) => x.addresses.join(" ")).join(" | ")}`);
    ok(!!apexHttpsSite && apexHttpsSite.allImports.includes("aicc_tls"), "https://copilt.org must import aicc_tls");
  } else {
    ok(!!apexHttpSite && sameSet(apexHttpSite.addresses, [`http://${CANON}`]) && !apexHttpsSite, `the stage render must have only the http://${CANON} redirect block (no apex https block); found: ${apexSites.map((x) => x.addresses.join(" ")).join(" | ")}`);
  }
  ok(structure.sites.some((x) => x.addresses.length === 1 && x.addresses[0] === "http://" && /respond "Misdirected request" 421/.test(x.text)), "the catch-all http:// block (421) is missing: unknown Hosts on port 80 would be redirected to https://<attacker host>");
  ok(/^\s*auto_https disable_redirects\s*$/m.test(regenerated), "global option `auto_https disable_redirects` is missing (Caddy would 308 any Host on port 80 to https://<that Host>)");
  ok(/handle_errors \{\s*(?:#[^\n]*\n\s*)*import security_headers\s*\n\s*import hsts/.test(regenerated), "handle_errors must import security_headers and hsts (error pages do not inherit the site block's header directives)");
  ok(!!apexSite && !!wwwSite && !apexSites.includes(wwwSite), "could not find the apex/http blocks (import apex_site) and the canonical block (routing) in the template");
  if (apexSite && wwwSite) {
    ok(sameSet(wwwSite.addresses, [CANON]), `the canonical block must be exactly ${CANON}; it has: ${wwwSite.addresses.join(", ")}`);
    ok(wwwSite.allImports.includes("aicc_tls"), "the canonical block must import aicc_tls");
    for (const [name, x] of [["apex http", apexHttpSite], ["apex https", apexHttpsSite], ["canonical", wwwSite], ["operator", opSite]]) if (x) for (const imp of ["security_headers", "hsts", "aicc_redirects"]) ok(x.allImports.includes(imp), `the ${name} block must import ${imp} (directly or through apex_site); it imports: ${x.allImports.join(", ") || "(nothing)"}`);
    ok([...structure.snippets.keys()].includes("apex_site"), "snippet apex_site must exist");
  }
  ok([...structure.snippets.keys()].includes("aicc_redirects") && [...structure.snippets.keys()].includes("hsts"), "snippets aicc_redirects and hsts must exist");
  // ---- the OPERATOR LISTENER (owner decision 2026-10-21): loopback only, same host name, same certificate, the three operator surfaces served there and denied on the public listener
  ok(!!opSite && sameSet(opSite.addresses, [OPERATOR_SITE_ADDR]), `the operator listener block must be exactly ${OPERATOR_SITE_ADDR}; found: ${opSite ? opSite.addresses.join(", ") : "(none)"}`);
  if (opSite) {
    ok(/^\s*bind 127\.0\.0\.1\s*$/m.test(opSite.text), "the operator listener must `bind 127.0.0.1` (loopback only): nothing on the internet may be able to open a connection to it");
    ok(opSite.allImports.includes("aicc_tls"), "the operator listener must import aicc_tls (same host name, same certificate)");
    ok(opSite.allImports.includes("aicc_operator_guard") && opSite.allImports.includes("aicc_error_pages") && opSite.allImports.includes("edge_log"), "the operator listener must import aicc_operator_guard, aicc_error_pages and edge_log");
    ok(/import edge_log operator\s*$/m.test(opSite.text), "the operator listener's access log must say listener=operator (import edge_log operator)");
    ok(opSite.addresses.every((a) => !a.startsWith("http://")), "the operator listener is an https address");
  }
  // Caddy compiles every matcher regexp with Go RE2: look-ahead / look-behind / back-references are a LOAD ERROR that only a real Caddy reports (found by the F-11 real-Caddy run)
  const re2Bad = regenerated.split("\n").filter((l) => !/^\s*#/.test(l) && /(?:path_regexp|vars_regexp|header_regexp)\s/.test(l) && /\(\?(?:=|!|<=|<!)/.test(l));
  ok(re2Bad.length === 0, `matcher regexps must be RE2-compatible (no look-ahead/look-behind): ${re2Bad.slice(0, 2).join(" | ")}`);
  ok((code.match(/^\s*bind\s/gm) || []).length === 1, "exactly one `bind` in the template (the operator listener's 127.0.0.1); the public listeners use the host's addresses");
  ok(/@aicc_op_not_loopback not remote_ip 127\.0\.0\.1 ::1\s*\n\s*abort @aicc_op_not_loopback/.test(snipText("aicc_operator_guard")), "aicc_operator_guard must abort every peer that is not loopback");
  const opRouting = regenerated.split("# BEGIN GENERATED: routing operator\n")[1]?.split("# END GENERATED: routing operator")[0] || "";
  const pubRouting = regenerated.split("# BEGIN GENERATED: routing\n")[1]?.split("# END GENERATED: routing")[0] || "";
  for (const n of ["wp_cron_deny", "wp_admin_deny", "wp_login_deny"]) { ok(pubRouting.includes(`@${n}`), `the PUBLIC routing must deny with @${n}`); ok(!opRouting.includes(`@${n}`), `the OPERATOR routing must not contain @${n} (that is what the listener is for)`); }
  for (const n of ["bad_path", "bad_method", "xmlrpc_deny", "php_direct", "wp_hidden", "dotfile_deny", "wp_private_dirs", "sensitive_ext", "wp_admin_big"]) { ok(pubRouting.includes(`@${n}`) && opRouting.includes(`@${n}`), `both routing blocks must contain @${n}`); }
  ok(!/(wp_cron_deny|wp_admin_deny|wp_login_deny)/.test(opRouting), "no public deny rule may leak into the operator routing");
  // ---- stage identity: empty in the committed (production) text, never in production
  if (!STAGE_HOST) {
    ok(snip("aicc_stage_identity").filter((l) => l && !l.startsWith("#")).length === 0, "the committed template's (aicc_stage_identity) snippet must be EMPTY: the production build never contains the identity route");
    ok(!/aicc-stage-identity/.test(code), "the committed template must not contain the stage identity path in code");
    ok(snip("aicc_stage_robots").filter((l) => l && !l.startsWith("#")).length === 0 && !/X-Robots-Tag/.test(code), "the committed template's (aicc_stage_robots) snippet must be EMPTY (only the staging host is noindex)");
  }
  // ---- HTTP/3 off, metrics private
  ok(/^\s*protocols h1 h2\s*$/m.test(code), "global `servers { protocols h1 h2 }` (HTTP/3 off) is missing");
  ok(/^\s*strict_sni_host on\s*$/m.test(code), "global `servers { strict_sni_host on }` is missing (a foreign Host over a valid SNI would get Caddy's empty 200)");
  ok(!/^\s*(Alt-Svc\s+")/m.test(code) && /^\s*-Alt-Svc\s*$/m.test(snipText("security_headers")), "no Alt-Svc value may be set and security_headers must remove one (-Alt-Svc)");
  ok(/^\s*metrics\s*$/m.test(regenerated.split("# BEGIN GLOBAL OPTIONS")[1]?.split("# END GLOBAL OPTIONS")[0] || ""), "global option `metrics` must be enabled in the global options");
  ok(!structure.sites.some((x) => /^\s*metrics\b/m.test(x.text)) && ![...structure.snippets.values()].some((sn) => sn.body.some((l) => /^\s*(metrics)\b/.test(l))), "no site, handle or snippet may route `metrics` (it is served by the loopback admin API only)");
  ok(/^\s*admin \{\$AICC_ADMIN_ADDR:127\.0\.0\.1:12019\}\s*$/m.test(code), "the admin API must default to 127.0.0.1:12019");
  ok(/^\s*acme_ca \{\$AICC_ACME_CA:https:\/\/acme-v02\.api\.letsencrypt\.org\/directory\}\s*$/m.test(code), "the ACME CA must default to Let's Encrypt production");
  // ---- access log (architecture review H-5): an ALLOW-LIST. The whole header maps are deleted; only the listed headers come back through log_append; retention 50 MiB x 10
  {
    const lg = snipText("edge_log");
    const REQ_OK = ["User-Agent", "Referer", "Accept-Language", "Content-Type", "Content-Length", "Range", "If-None-Match", "Sec-Fetch-Site"];   // Sec-Fetch-Site added deliberately for F-09 (browser-set, non-secret: same-origin|same-site|cross-site|none)
    const RESP_OK = ["Content-Type", "Content-Length", "Content-Encoding", "Cache-Control", "Location", "Content-Range"];
    ok(/^request>headers delete$/m.test(lg) && /^resp_headers delete$/m.test(lg), "edge_log must delete `request>headers` and `resp_headers` WHOLE (allow-list posture: a header nobody thought of must not reach the log)");
    const reqUsed = [...lg.matchAll(/\{http\.request\.header\.([A-Za-z-]+)\}/g)].map((m) => m[1]);
    const respUsed = [...lg.matchAll(/\{http\.response\.header\.([A-Za-z-]+)\}/g)].map((m) => m[1]);
    ok(sameSet(reqUsed, REQ_OK), `edge_log may log exactly these request headers ${REQ_OK.join(", ")}; it logs: ${reqUsed.join(", ")}`);
    ok(sameSet(respUsed, RESP_OK), `edge_log may log exactly these response headers ${RESP_OK.join(", ")}; it logs: ${respUsed.join(", ")}`);
    ok(!/\{http\.(?:request|response)\.(?:header|cookie)\.(?:cookie|set-cookie|authorization|proxy-authorization|x-wp-nonce|nonce|cart-token|cart-hash|user-id|x-api-key|x-csrf[a-z-]*|x-forwarded-[a-z-]+)\}/i.test(lg), "edge_log must not log a secret-bearing header by placeholder");
    ok(/^req_referer regexp "\(\?i\)/m.test(lg) && /^resp_location regexp "\(\?i\)/m.test(lg) && /^request>uri regexp "\(\?i\)/m.test(lg), "edge_log must redact secret-bearing query values in the URI, the Referer and the Location");
    ok(/roll_size 50MiB/.test(lg) && /roll_keep 10\b/.test(lg) && /roll_keep_for 720h/.test(lg), "edge_log rotation must be 50 MiB x 10 files, 30 days (about 500 MiB cap: a 20 MiB x 5 cap held about one hour of history under load)");
    const glob = regenerated.split("# BEGIN GLOBAL OPTIONS")[1]?.split("# END GLOBAL OPTIONS")[0] || "";
    ok(/format filter \{[\s\S]*?request>headers delete[\s\S]*?request>uri regexp "\(\?i\)/.test(glob.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")), "the global (error) log must delete request>headers and redact the URI too: Caddy writes the whole request into an error entry");
  }
  // ---- the WordPress origin forms
  ok(/^\s*import wp_proxy_fastcgi \{args\[:\]\}\s*$/m.test(snipText("wp_proxy")), "the committed (wp_proxy) selector must import the fastcgi form (the Linux target) and pass its arguments on (the operator listener's env parameter)");
  const fcgi = snipText("wp_proxy_fastcgi");
  ok(/php_fastcgi \{\$AICC_PHP_FPM_SOCKET:unix\/\/run\/php\/aicc-cp\.sock\}/.test(fcgi) && /root \* \{\$AICC_WP_ROOT\}/.test(fcgi) && /^file_server$/m.test(fcgi), "wp_proxy_fastcgi must be php_fastcgi on the unix socket with root {$AICC_WP_ROOT} and a file_server");
  ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+|localhost:\d+/.test(fcgi), "wp_proxy_fastcgi must not contain an HTTP upstream address (unix socket only)");
  ok(/resolve_root_symlink/.test(fcgi), "wp_proxy_fastcgi must resolve the docroot symlink (opcache across release switches)");
  for (const pat of ["X-Forwarded-*", "X-Remote-*", "X-Client-*", "X-Real-*", "X-Original-*", "X-Rewrite-*", "X-Custom-IP-*", "X-HTTP-Method-Override"]) ok(new RegExp(`^header_up -${pat.replace(/[*]/g, "\\*")}$`, "m").test(fcgi), `wp_proxy_fastcgi must strip the whole header family ${pat} (security review I1: deny-lists of single names rot)`);
  // AICC_EDGE_LISTENER: the Control Plane accepts `AICC_EDGE_LISTENER=operator` (a FastCGI parameter) as ONE of its three operator signals for privileged-role sign-in. It must be set by the edge on the
  // OPERATOR listener's php_fastcgi ONLY, never on the public listener, and no client header may be able to fake it.
  {
    const code = (txt) => txt.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    const opR = code(regenerated.split("# BEGIN GENERATED: routing operator\n")[1]?.split("# END GENERATED: routing operator")[0] || "");
    const pubR = code(regenerated.split("# BEGIN GENERATED: routing\n")[1]?.split("# END GENERATED: routing\n")[0] || "");
    const imports = (t) => t.split("\n").map((l) => l.trim()).filter((l) => /^import to_wordpress/.test(l));
    ok(opR.length > 100 && pubR.length > 100, "AICC_EDGE_LISTENER: both generated routing blocks must be found");
    ok(imports(opR).length >= 4 && imports(opR).every((l) => /^import to_wordpress(?:_admin|_nocache)? env AICC_EDGE_LISTENER operator$/.test(l)), `every WordPress import of the OPERATOR routing must pass \`env AICC_EDGE_LISTENER operator\` (${imports(opR).join(" | ")})`);
    ok(imports(pubR).length >= 3 && imports(pubR).every((l) => /^import to_wordpress(?:_admin|_nocache)?$/.test(l)), `the PUBLIC routing must import the WordPress snippets WITHOUT arguments (${imports(pubR).join(" | ")})`);
    ok(!/AICC_EDGE_LISTENER/.test(pubR), "the PUBLIC routing block must not mention AICC_EDGE_LISTENER at all");
    const all = code(regenerated);
    ok(all.split("\n").filter((l) => /AICC_EDGE_LISTENER/.test(l)).every((l) => /^\s*import to_wordpress(?:_admin|_nocache)? env AICC_EDGE_LISTENER operator$/.test(l)), "AICC_EDGE_LISTENER may appear in the Caddyfile only as the argument of an operator-routing `import to_wordpress*` (never as a literal env line of a shared snippet, never on the public listener)");
    const fcb = code(snipText("wp_proxy_fastcgi"));
    ok(/^\s*\{args\[:\]\}\s*$/m.test(fcb.split("php_fastcgi")[1]?.split("file_server")[0] || ""), "the php_fastcgi block of wp_proxy_fastcgi must expand the snippet arguments ({args[:]}) - the only way the operator listener's env parameter reaches PHP");
    ok(/^\s*header_up -Aicc-\*\s*$/m.test(fcb), "wp_proxy_fastcgi must strip the Aicc-* request-header family (a client cannot forge the Control Plane's edge signal)");
    for (const n of ["to_wordpress", "to_wordpress_nocache", "to_wordpress_admin"]) ok((structure.snippets.get(n)?.body || []).some((l) => l.trim() === "import wp_proxy {args[:]}"), `snippet ${n} must pass its arguments to wp_proxy`);
    ok(/^\s*import wp_proxy_fastcgi \{args\[:\]\}\s*$/m.test(code(snipText("wp_proxy"))), "wp_proxy must pass its arguments to the fastcgi form");
  }
  // request body cap (E9): every PUBLIC WordPress route is capped at 2 MB; only the operator-only /wp-admin/ route may take more
  for (const n of ["to_wordpress", "to_wordpress_nocache"]) ok(structure.snippets.get(n)?.body.includes("import wp_body_cap"), `snippet ${n} must import wp_body_cap (public WordPress routes have a request body cap)`);
  ok(/request_body \{\s*max_size 2MB\s*\}/.test((structure.snippets.get("wp_body_cap")?.body || []).join("\n").replace(/\n+/g, " ")) || (structure.snippets.get("wp_body_cap")?.body || []).join(" ").includes("max_size 2MB"), "wp_body_cap must set max_size 2MB");
  ok(!structure.snippets.get("to_wordpress_admin")?.body.includes("import wp_body_cap") && (structure.snippets.get("to_wordpress_admin")?.body || []).join(" ").includes("max_size 64MB"), "to_wordpress_admin (operator-only /wp-admin/) has its own, larger cap");
  ok(!structure.sites.some((x) => x.addresses.some((a) => a.includes(M.API_HOST))), "api.copilt.org must not have a site block in this file");
  // ---- renders (scripts/lib/edge-render.mjs): every mode renders, with the invariants asserted by the renderer itself; the production render has no identity route
  if (!STAGE_HOST) {
    const R = await import("./lib/edge-render.mjs");
    const t0 = R.readTemplate(TEMPLATE);
    for (const [label, o] of [["production", { mode: "production" }], ["stage", { mode: "stage" }], ["stage (literal host)", { mode: "stage", host: "stage.copilt.org" }], ["rehearsal production topology, fastcgi", { mode: "rehearsal", tls: "internal", identity: "rehearsal" }], ["rehearsal production topology, proxy", { mode: "rehearsal", tls: "internal", upstream: "proxy", identity: "rehearsal" }], ["rehearsal stage topology", { mode: "rehearsal", topology: "stage", host: "stage-rehearsal.copilt.org", tls: "internal", identity: "rehearsal" }]]) {
      let r = null, err = "";
      try { r = R.render(t0, o); } catch (e) { err = e.message; }
      ok(!!r, `render ${label} failed: ${err}`);
      if (!r) continue;
      const c = r.text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
      if (o.mode === "production") ok(r.text === t0 && !/aicc-stage-identity/.test(c), "the production render must be the committed template text, unchanged, with no identity route");
      if (o.mode === "stage") ok(/aicc-stage-identity/.test(c) && /\{\$AICC_STAGE_ID\}/.test(c) && /"env":"staging"/.test(c), "the stage render must contain the identity route (env staging, id from AICC_STAGE_ID)");
      if (o.mode === "stage") ok(/X-Robots-Tag "noindex, nofollow, noarchive"/.test(c), "the stage render must send X-Robots-Tag noindex on every response (the staging host is never indexable)");
      if (o.mode === "production") ok(!/X-Robots-Tag/.test(c), "the production render must not send X-Robots-Tag");
      // architecture review H-6: a live file must not say "nothing is live" / "NOT APPLIED"; the status banner (line 2) is true for the render
      if (o.mode === "stage") ok(r.text.split("\n")[1].startsWith("# RENDERED FOR THE STAGE HOST") && !/Nothing here is live|NOT APPLIED/i.test(r.text.split("\n").slice(0, 6).join("\n")), "the stage render's status banner (line 2) must say it is the stage render that runs on the staging host, never 'nothing is live'");
      if (o.mode === "rehearsal") ok(r.text.split("\n")[1].startsWith("# RENDERED FOR THE macOS REHEARSAL"), "the rehearsal render's banner must say so");
      if (o.mode === "production") ok(!/Nothing here is live|NOT APPLIED/i.test(r.text.split("\n").slice(0, 6).join("\n")), "the committed template's status banner must not claim that nothing is live (the stage render of it is)");
      if (o.mode === "stage") ok(!/\blocal_certs\b|tls internal/.test(c) && /acme_ca/.test(c) && /^\s*email /m.test(c), "the stage render must use automatic public-CA HTTPS (no local_certs, no tls internal, email + acme_ca present)");
      if (o.topology === "stage" || o.mode === "stage") ok(!/www\.copilt\.org|(^|[\s,/])copilt\.org\b/m.test(c), `the ${label} render must not mention the production hosts in code`);
    }
    ok((() => { try { R.render(t0, { mode: "production", identity: "staging" }); return false; } catch { return true; } })(), "the renderer must refuse an identity route in the production render");
    ok((() => { try { R.render(t0, { mode: "stage", tls: "internal" }); return false; } catch { return true; } })(), "the renderer must refuse tls internal in a stage render");
    ok((() => { try { R.render(t0, { mode: "stage", upstream: "proxy" }); return false; } catch { return true; } })(), "the renderer must refuse reverse_proxy in a stage render");
    // the STAGE render is replayed through the same model with the retargeted matrix (child run; the literal host keeps the model simple)
    const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "aicc-stage-render-"));
    const f = path.join(tmp, "stage.Caddyfile");
    fs.writeFileSync(f, R.render(t0, { mode: "stage", host: "stage.copilt.org" }).text);
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--template", f, "--stage-host", "stage.copilt.org", "--quiet"], { encoding: "utf8", cwd: ROOT });
    fs.rmSync(tmp, { recursive: true, force: true });
    ok(child.status === 0, `the stage render does not pass the model (retargeted matrix):\n${(child.stderr || "").split("\n").slice(0, 12).join("\n")}`);
  }
}
for (const c of CASES) {
  const url = c.from.replace(/#.*$/, "");
  const r = await hit(url, c.method || "GET", c.peer || "public");
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
for (const scheme of ["http", "https"]) for (const host of STAGE_HOST ? [CANON] : [M.APEX_HOST, M.CANONICAL_HOST]) for (const p of M.SWEEP_PATHS) {
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
  ok(new URL(url).origin === ORIGIN_L, `${start} ends off the canonical origin: ${url}`);
  // a canonical, already-slashed https://www URL must not redirect at all
  if (scheme === "https" && host === CANON && /\/$/.test(p) && !/index\.html|ai-commerce|account|login|register|store|shop|404|_not-found/.test(p) && !p.includes("?")) ok(hops === 0, `canonical URL redirects: ${start} -> ${url}`);
}
// no rule may redirect to its own match target (loop) -- covered by the hop count above; also assert Location never carries a double slash or the old base path
for (const c of CASES) if (c.location) ok(!/(?<!:)\/\//.test(c.location.replace(ORIGIN_L, "")) && !c.location.includes(M.LEGACY_BASE_PATH), `bad Location in expectation: ${c.location}`);

/* ------------------------------------------------------------------ 5. matrix vs the site itself */
const { ROUTE_IDS, localePath } = await loadTs("src/lib/routes.ts");
const owners = { static: [], wordpress: [] };
for (const l of LOCALES) for (const id of ROUTE_IDS) {
  const p = localePath(l, id);
  const owner = M.TARGET_OWNER[id];
  ok(owner === "static" || owner === "wordpress", `route "${id}" has no target owner in redirect-matrix.mjs (TARGET_OWNER)`);
  const r = await hit(`https://${CANON}${p}`);
  ok(r.status === 200 && r.headers["x-origin"] === owner, `${p}: edge sends it to "${r.headers["x-origin"]}" (${r.status}) but TARGET_OWNER says ${owner}`);
  if (owner === "static") { ok(staticExists(p), `${p} is static-owned but not found in the static export${fs.existsSync(OUT_DIR) ? "" : " (route table)"}`); owners.static.push(p); }
  else owners.wordpress.push(p);
}
for (const p of M.WP_ONLY_PAGES) { const r = await hit(`https://${CANON}${p}`); ok(r.headers["x-origin"] === "wordpress", `${p} should be WordPress-owned, got ${r.headers["x-origin"]}`); }
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
      if (new URL(url).origin !== ORIGIN_L) continue; // an NEXT_PUBLIC_AICC_ACCOUNT_URL override points somewhere else on purpose
      const r = await hit(url);
      ok(r.status === 200 && r.headers["x-origin"] === "wordpress", `${url}: the site links here, the edge must answer 200 from WordPress without a redirect, got ${r.status} ${r.headers["x-origin"]} ${r.headers.location || ""}`);
      ok(l === "en" ? !/\/(he|es|ru)\//.test(url) : url.startsWith(`${ORIGIN_L}/${l}/my-account/`), `${url} has the wrong language prefix for ${l}`);
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
    const r = await hit(`https://${CANON}${p}`);
    ok(r.status === 200 && r.headers["x-origin"] === "wordpress", `${p}: listed in the sitemap, must be WordPress-owned with a 200, got ${r.headers["x-origin"]} ${r.status}`);
    if (sm) ok(sm.includes(`<loc>https://${M.CANONICAL_HOST}${p}</loc>`) || STAGE_HOST, `${p} is WordPress-owned and public but missing from the built sitemap.xml`);
  }
}
for (const p of M.UNOWNED) { const r = await hit(`https://${CANON}${p}`); ok(r.status === 404, `${p} is listed as UNOWNED and must be a 404 until it is built, got ${r.status}`); }
// every enabled redirect target (for the sample requests above) lands on a served page: covered by hop/final checks; here: disabled rules really are disabled
for (const rule of M.PATH_RULES.filter((x) => x.enabled === false)) ok(!redirectsSrc.matchers.has(rule.id), `disabled rule ${rule.id} leaked into the generated config`);
// cutover/ops invariants of the template text
ok(!/includeSubDomains|preload/i.test(regenerated.replace(/#.*$/gm, "")), "HSTS must not use includeSubDomains/preload in the template");
ok(!/api\.copilt\.org\s*\{/.test(regenerated), "api.copilt.org must not have a site block in this file");
ok(/Strict-Transport-Security "max-age=300"/.test(regenerated), "HSTS ramp must start at max-age=300");
{
  const body = (n) => (structure.snippets.get(n)?.body || []).join("\n");
  const STRIP = ["Forwarded", "X-Real-IP", "X-Client-IP", "True-Client-IP", "Client-IP", "CF-Connecting-IP", "X-Cluster-Client-IP", "X-Originating-IP", "Fastly-Client-IP", "Forwarded-For", "X-Forwarded", "X-Forwarded-Port", "X-Forwarded-Scheme", "X-Forwarded-Ssl", "Front-End-Https", "X-Url-Scheme", "X-Forwarded-Server", "X-Original-URL", "X-Rewrite-URL"];
  // reverse_proxy form (rehearsal fallback): strips the list and OVERWRITES X-Forwarded-For/-Proto/-Host with edge-made values
  for (const h of STRIP) ok(new RegExp(`header_up\\s+-${h}\\s*$`, "m").test(body("wp_proxy_http")), `the reverse_proxy WordPress snippet must strip the client-supplied ${h} header (header_up -${h}); the browser rehearsal showed it reaching the Control Plane`);
  ok(/header_up X-Forwarded-For \{remote_host\}/.test(body("wp_proxy_http")) && /header_up X-Forwarded-Proto \{scheme\}/.test(body("wp_proxy_http")) && /header_up X-Forwarded-Host \{host\}/.test(body("wp_proxy_http")), "reverse_proxy form: X-Forwarded-For/-Proto/-Host must be OVERWRITTEN with edge-made values");
  // php_fastcgi form (Linux): PHP gets REMOTE_ADDR and HTTPS from Caddy, so EVERY forwarding/identity header is removed, X-Forwarded-For/-Proto/-Host and Via included (measured with a real php-fpm: Forwarded, X-Real-IP, Client-IP and Via from the client reached PHP unchanged without these lines)
  for (const h of [...STRIP, "X-Forwarded-For", "X-Forwarded-Proto", "X-Forwarded-Host", "Via"]) ok(new RegExp(`header_up\\s+-${h}\\s*$`, "m").test(body("wp_proxy_fastcgi")), `the php_fastcgi WordPress snippet must strip the client-supplied ${h} header (header_up -${h}): it must never reach PHP as HTTP_*`);
  ok(!/header_up\s+X-Forwarded/i.test(body("wp_proxy_fastcgi")), "the php_fastcgi form must not SET any X-Forwarded-* header (PHP reads REMOTE_ADDR and HTTPS; AICC_LM_TRUSTED_PROXIES stays empty)");
  ok(!/trusted_proxies/.test(regenerated.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")), "trusted_proxies must not be set on the public edge (a client-supplied X-Forwarded-For would be believed)");
}
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
  const apexHead = "http://copilt.org, http://www.copilt.org {";
  const apexSnippet = "(apex_site) {";
  const afterHead = (text, head, from, to) => { const i = text.indexOf(head); if (i < 0) throw new Error(`mutant setup: "${head}" not found`); const j = text.indexOf(from, i); if (j < 0) throw new Error(`mutant setup: "${from.trim()}" not found after "${head}"`); return text.slice(0, j) + to + text.slice(j + from.length); };
  const MUTANTS = [
    ["delete `import aicc_redirects` from the www block", (t) => afterHead(t, "\nwww.copilt.org {", "\timport aicc_redirects\n", "")],
    ["remove http://www.copilt.org from the apex address list", (t) => t.replace(apexHead, "http://copilt.org {")],
    ["delete `import hsts` from the apex snippet", (t) => afterHead(t, apexSnippet, "\timport hsts\n", "")],
    ["delete `import hsts` from the www block", (t) => afterHead(t, "\nwww.copilt.org {", "\timport hsts\n", "")],
    ["delete `import security_headers` from the apex snippet", (t) => afterHead(t, apexSnippet, "\timport security_headers\n", "")],
    ["delete `import aicc_redirects` from the apex snippet", (t) => afterHead(t, apexSnippet, "\timport aicc_redirects\n", "")],
    ["import aicc_tls into the http:// apex block (breaks `tls <file> <file>`: architecture review F1)", (t) => t.replace(apexHead + "\n\timport aicc_site_hook\n", apexHead + "\n\timport aicc_site_hook\n\timport aicc_tls\n")],
    ["merge the apex back into one mixed http:// + https:// block (F1)", (t) => t.replace(apexHead, "http://copilt.org, https://copilt.org, http://www.copilt.org {\n\timport aicc_tls")],
    ["restore the old wp-login exception (any method, case-insensitive; security review F2)", (t) => t.replace(/\t\tnot expression \{http\.request\.method\} in \[[^\n]*\n/, "\t\tnot expression {http.request.uri.query}.matches('(?i)(^|&)(action=logout|loggedout=true)(&|$)')\n")],
    ["drop the request body cap from to_wordpress (E9)", (t) => afterHead(t, "(to_wordpress) {", "\timport wp_body_cap\n", "")],
    ["raise HSTS with includeSubDomains", (t) => t.replace('Strict-Transport-Security "max-age=300"', 'Strict-Transport-Security "max-age=300; includeSubDomains"')],
    ["tamper with a generated routing line (drift)", (t) => t.replace("\thandle @wp_pages {\n\t\timport to_wordpress\n", "\thandle @wp_pages {\n\t\timport to_static\n")],
    ["turn the host redirect for other methods into a 301", (t) => t.replace("redir https://www.copilt.org{uri} 308", "redir https://www.copilt.org{uri} 301")],
    ["add an api.copilt.org site block", (t) => t + "\napi.copilt.org {\n\treverse_proxy 127.0.0.1:8000\n}\n"],
    // added after the real-Caddy rehearsal (each is a defect the real binary showed or would show)
    ["delete `import security_headers` from handle_errors (error pages lost HSTS/nosniff/X-Request-Id and leaked Server)", (t) => afterHead(t, "\thandle_errors {", "\t\timport security_headers\n", "")],
    ["remove `auto_https disable_redirects` (any Host on :80 would be 308'd to https://<attacker host>)", (t) => t.replace("\tauto_https disable_redirects\n", "")],
    ["delete the catch-all http:// block (unknown Hosts on :80)", (t) => t.replace(/http:\/\/ \{\n[\s\S]*?\n\}\n/, "")],
    ["let public visitors into /wp-admin/ (drop the operator condition; generated drift)", (t) => t.replace("\t\tpath_regexp wp_admin_deny (?i)^/wp-admin(?:/|$)\n\t\tnot path_regexp wp_admin_public (?i)^/wp-admin/(?:admin-ajax|admin-post)\\.php$\n\t\tnot remote_ip {$AICC_OPERATOR_CIDRS}\n", "\t\tpath_regexp wp_admin_deny (?i)^/wp-admin(?:/|$)\n\t\tnot path_regexp wp_admin_public (?i)^/wp-admin/(?:admin-ajax|admin-post)\\.php$\n")],
    // ---- Linux/stage architecture (round 5): operator listener, php_fastcgi, HTTP/3 off, private metrics, identity, PHP entry points
    ["operator listener binds the wildcard address (bind 0.0.0.0)", (t) => t.replace("\tbind 127.0.0.1\n", "\tbind 0.0.0.0\n")],
    ["operator listener loses its bind line (listens on every address)", (t) => t.replace("\tbind 127.0.0.1\n", "")],
    ["operator listener loses the non-loopback guard", (t) => afterHead(t, "{$AICC_OPERATOR_PORT:8443} {", "\timport aicc_operator_guard\n", "")],
    ["operator listener loses its certificate import (different certificate/none)", (t) => afterHead(t, "{$AICC_OPERATOR_PORT:8443} {", "\timport aicc_tls\n", "")],
    ["operator listener becomes a plain http address", (t) => t.replace("www.copilt.org:{$AICC_OPERATOR_PORT:8443} {", "http://www.copilt.org:{$AICC_OPERATOR_PORT:8443} {")],
    ["public routing loses the wp-login deny (generated drift)", (t) => t.replace(/\t@wp_login_deny \{[\s\S]*?\thandle @wp_login_deny \{[\s\S]*?\t\}\n/, "")],
    ["operator routing loses the PHP entry-point rule (generated drift)", (t) => { const i = t.indexOf("# BEGIN GENERATED: routing operator"); const a = t.indexOf("\t@php_direct {", i); const b = t.indexOf("\thandle @php_direct {", a); const c = t.indexOf("\t}\n", b) + 3; return t.slice(0, a) + t.slice(c) ; }],
    ["operator routing gets a public deny rule back (drift)", (t) => t.replace("# BEGIN GENERATED: routing operator\n", "# BEGIN GENERATED: routing operator\n\t@wp_admin_deny path /wp-admin/*\n\thandle @wp_admin_deny {\n\t\theader Cache-Control \"no-store\"\n\t\trespond \"Forbidden\" 403\n\t}\n")],
    ["Caddy advertises HTTP/3 again (Alt-Svc set)", (t) => t.replace("\t\t-Alt-Svc\n", "\t\tAlt-Svc \"h3=\\\":443\\\"; ma=3600\"\n")],
    ["HTTP/3 turned on (protocols line removed)", (t) => t.replace("\t\tprotocols h1 h2\n", "")],
    ["metrics disabled", (t) => t.replace("\tmetrics\n", "")],
    ["X-Robots-Tag noindex leaks into the committed (production) template", (t) => t.replace("(aicc_stage_robots) {\n}", '(aicc_stage_robots) {\n\theader X-Robots-Tag "noindex"\n}')],
    ["strict_sni_host removed (foreign Host over a valid SNI gets an empty 200)", (t) => t.replace("\t\tstrict_sni_host on\n", "")],
    ["metrics routed on the public site (handle /metrics { metrics })", (t) => t.replace("\timport aicc_stage_identity\n\n\t# WordPress admin surface", "\timport aicc_stage_identity\n\thandle /metrics {\n\t\tmetrics\n\t}\n\n\t# WordPress admin surface")],
    ["the admin API default leaves loopback", (t) => t.replace("{$AICC_ADMIN_ADDR:127.0.0.1:12019}", "{$AICC_ADMIN_ADDR::2019}")],
    ["fastcgi snippet stops stripping Forwarded", (t) => afterHead(t, "(wp_proxy_fastcgi) {", "\t\theader_up -Forwarded\n", "")],
    ["fastcgi snippet stops stripping X-Forwarded-For (a forged XFF would reach PHP)", (t) => afterHead(t, "(wp_proxy_fastcgi) {", "\t\theader_up -X-Forwarded-For\n", "")],
    ["fastcgi snippet stops stripping Client-IP", (t) => afterHead(t, "(wp_proxy_fastcgi) {", "\t\theader_up -Client-IP\n", "")],
    ["fastcgi snippet stops stripping Via", (t) => afterHead(t, "(wp_proxy_fastcgi) {", "\t\theader_up -Via\n", "")],
    ["fastcgi upstream becomes a TCP address (HTTP/fastcgi port on the network)", (t) => t.replace("{$AICC_PHP_FPM_SOCKET:unix//run/php/aicc-cp.sock}", "{$AICC_PHP_FPM_SOCKET:127.0.0.1:9000}")],
    ["fastcgi snippet sets X-Forwarded-For again (XFF-trust dependency)", (t) => afterHead(t, "(wp_proxy_fastcgi) {", "\t\theader_up -X-Forwarded-For\n", "\t\theader_up X-Forwarded-For {remote_host}\n")],
    ["wp_proxy selector points at the http proxy in the committed text", (t) => t.replace("(wp_proxy) {\n\timport wp_proxy_fastcgi {args[:]}\n}", "(wp_proxy) {\n\timport wp_proxy_http\n}")],
    ["the stage identity route leaks into the committed (production) template", (t) => t.replace("(aicc_stage_identity) {\n}", "(aicc_stage_identity) {\n\t@aicc_stage_identity path /.well-known/aicc-stage-identity\n\thandle @aicc_stage_identity {\n\t\trespond \"x\" 200\n\t}\n}")],
    ["trusted_proxies added to the public edge", (t) => t.replace("\tauto_https disable_redirects\n", "\tauto_https disable_redirects\n\tservers {\n\t\ttrusted_proxies static private_ranges\n\t}\n")],
    ["the PHP entry-point whitelist is widened to any wp-content file (generated drift)", (t) => t.replace("not path_regexp php_entry ^/(?:index|wp-login|wp-cron)", "not path_regexp php_entry ^/(?:wp-content/.*|index|wp-login|wp-cron)")],
    ["php_fastcgi stops resolving the docroot symlink", (t) => t.replace("\t\tresolve_root_symlink\n", "")],
    // ---- architecture review fix round (H-4, F4): REST API index
    ["REST index: the public path rule is removed (generated drift)", (t) => t.replace(/\t@wp_rest_index_path path_regexp [^\n]*\n\thandle @wp_rest_index_path \{\n\t\terror 404\n\t\}\n/, "")],
    ["REST index: the public ?rest_route=/ rule is removed (generated drift)", (t) => t.replace(/\t@wp_rest_index_query \{\n[^\n]*\n\t\}\n\thandle @wp_rest_index_query \{\n\t\terror 404\n\t\}\n/, "")],
    ["REST index: the path rule is widened to every /wp-json/ route (namespaced REST breaks; generated drift)", (t) => t.replace("wp_rest_index_path ^(/(?:he|es|ru))?/wp-json/?$", "wp_rest_index_path ^(/(?:he|es|ru))?/wp-json(?:/.*)?$")],
    ["REST index: the operator listener gets the public 404 too (wp-admin discovery breaks; generated drift)", (t) => t.replace("# BEGIN GENERATED: routing operator\n", "# BEGIN GENERATED: routing operator\n\t@wp_rest_index_path path_regexp wp_rest_index_path ^(/(?:he|es|ru))?/wp-json/?$\n\thandle @wp_rest_index_path {\n\t\terror 404\n\t}\n")],
    // ---- architecture review fix round (H-5, F1): access-log allow-list
    ["access log: restore the deny-list (only X-Wp-Nonce deleted; Store API headers leak)", (t) => t.replace("\t\t\t\trequest>headers delete\n\t\t\t\tresp_headers delete\n\t\t\t\treq_referer", "\t\t\t\trequest>headers>X-Wp-Nonce delete\n\t\t\t\treq_referer")],
    ["access log: log the Cart-Token request header again", (t) => t.replace("\tlog_append req_range {http.request.header.Range}\n", "\tlog_append req_range {http.request.header.Range}\n\tlog_append req_cart_token {http.request.header.Cart-Token}\n")],
    ["access log: log the X-Wp-Nonce response header", (t) => t.replace("\tlog_append resp_location {http.response.header.Location}\n", "\tlog_append resp_location {http.response.header.Location}\n\tlog_append resp_nonce {http.response.header.X-Wp-Nonce}\n")],
    ["access log: the Referer is logged unredacted", (t) => t.replace(/\t\t\t\treq_referer regexp [^\n]*\n/, "")],
    ["access log: retention back to 20 MiB x 5", (t) => t.replace("roll_size 50MiB\n\t\t\troll_keep 10\n", "roll_size 20MiB\n\t\t\troll_keep 5\n")],
    ["error log: request>headers no longer deleted (a 502 entry carries every request header)", (t) => afterHead(t, "# BEGIN GLOBAL OPTIONS", "\t\t\t\trequest>headers delete\n", "")],
    ["fastcgi snippet stops stripping the X-Remote-* family (X-Remote-Addr reaches PHP; security review I1)", (t) => afterHead(t, "(wp_proxy_fastcgi) {", "\t\theader_up -X-Remote-*\n", "")],
    ["wp_hidden loses the dependency-manifest rule (installed.json / composer.json public again; security review L4)", (t) => t.replace("composer\\.(?:json|lock)|installed\\.json|", "")],
    ["F-11: the dotfile deny is removed from both routing blocks", (t) => t.replace(/\t@dotfile_deny \{\n(?:\t\t[^\n]*\n)*\t\}\n\thandle @dotfile_deny \{\n(?:\t\t[^\n]*\n)*\t\}\n/g, "")],
    ["F-11: the dotfile deny also blocks /.well-known/ (ACME / security.txt would break)", (t) => t.replace(/\t\tnot path_regexp dotfile_ok [^\n]*\n/g, "")],
    ["F-11: WooCommerce private upload dirs are no longer denied", (t) => t.replace("uploads/(?:woocommerce_uploads|wc-logs)|", "")],
    ["F-11: archives/dumps are no longer in the sensitive-extension deny", (t) => t.replace("sql|dump|bak|old|orig|swp|log|gz|tgz|tar|zip|7z|rar|bz2|xz|env", "log|env")],
    // ---- AICC_EDGE_LISTENER (operator signal for the Control Plane's privileged sign-in)
    ["AICC_EDGE_LISTENER: the PUBLIC routing passes the operator env too (every visitor would look like an operator; generated drift)", (t) => t.replace("\thandle @wp_pages {\n\t\timport to_wordpress\n", "\thandle @wp_pages {\n\t\timport to_wordpress env AICC_EDGE_LISTENER operator\n")],
    ["AICC_EDGE_LISTENER: the env line is hard-coded in the shared php_fastcgi block (both listeners set it)", (t) => afterHead(t, "(wp_proxy_fastcgi) {", "\t\theader_up -X-HTTP-Method\n", "\t\theader_up -X-HTTP-Method\n\t\tenv AICC_EDGE_LISTENER operator\n")],
    ["AICC_EDGE_LISTENER: the operator routing forgets the env on /wp-admin/ (generated drift)", (t) => t.replace("\t\timport to_wordpress_admin env AICC_EDGE_LISTENER operator\n", "\t\timport to_wordpress_admin\n")],
    ["AICC_EDGE_LISTENER: the operator routing forgets the env on wp-login / machine paths (generated drift)", (t) => { const i = t.indexOf("# BEGIN GENERATED: routing operator"); return t.slice(0, i) + t.slice(i).replace("\t\timport to_wordpress_nocache env AICC_EDGE_LISTENER operator\n", "\t\timport to_wordpress_nocache\n"); }],
    ["AICC_EDGE_LISTENER: to_wordpress_nocache stops passing its arguments (the env never reaches php_fastcgi)", (t) => afterHead(t, "(to_wordpress_nocache) {", "\timport wp_proxy {args[:]}\n", "\timport wp_proxy\n")],
    ["AICC_EDGE_LISTENER: wp_proxy stops passing its arguments", (t) => t.replace("(wp_proxy) {\n\timport wp_proxy_fastcgi {args[:]}\n}", "(wp_proxy) {\n\timport wp_proxy_fastcgi\n}")],
    ["AICC_EDGE_LISTENER: the php_fastcgi block no longer expands the arguments", (t) => afterHead(t, "(wp_proxy_fastcgi) {", "\t\t{args[:]}\n", "")],
    ["AICC_EDGE_LISTENER: the Aicc-* request header family is no longer stripped", (t) => afterHead(t, "(wp_proxy_fastcgi) {", "\t\theader_up -Aicc-*\n", "")],
    ["the ACME CA default is no longer Let's Encrypt production", (t) => t.replace("https://acme-v02.api.letsencrypt.org/directory", "https://acme.zerossl.com/v2/DV90")],
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
