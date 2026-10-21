#!/usr/bin/env node
// npm run staging:replay -- --stage-host stage.copilt.org --stage-ip <ip> --port 443 --stage-id <id> [...]
// The runbook's HARD GATE (docs/cutover/runbook.md 1.5), as a tool: replay EVERY case of scripts/lib/redirect-matrix.mjs against a REAL edge and report PASS/FAIL per case. It depends on
// nothing of the rehearsal: no loopback, no macOS, no fixture, no marker header that only the rehearsal's PHP server sends. Needs only Node >= 18 and a `curl` binary.
//
// FAIL CLOSED (scripts/lib/target-guard.mjs; `npm run test:target-guard` proves every refusal). The tool will not send a single request unless it was given, explicitly, ALL of:
//   --stage-host H    the staging host name (stage.copilt.org). A production name (www/apex/api.copilt.org, or any other *.copilt.org that is not stage*) is refused: exit 3.
//   --stage-ip IP     where every connection goes (the guard builds the --connect-to mapping itself; the name is never resolved for the connection). A known production address is refused.
//   --port N          the https port at that IP (443 on the real host). --http-port N adds the plain-http port (needed for the http:// cases; without it they are SKIPPED).
//   --stage-id ID     the staging identity marker. The tool first GETs https://H:N/.well-known/aicc-stage-identity over the mapped connection and requires {"env":"staging","host":H,"id":ID};
//                     anything else (absent, other host, other id) is refused. Until that succeeds no state-changing request (POST/PUT/PATCH/DELETE) is ever sent.
//   public DNS for H must equal --stage-ip, else exit 3 unless --allow-dns-mismatch (pre-DNS testing: connections are still forced to the IP and the identity is still required).
// Nothing is ever followed off the staging host: curl never follows redirects, and the redirect sweep refuses (exit 3) a hop that leaves the allowed host:port set.
//
// WHAT IS REPLAYED. Default = the STAGE topology: the matrix retargeted to the staging host (one canonical host, no apex; apex cases are reported as not applicable). With
// `--alias-host www.copilt.org --alias-host copilt.org --alias-production-names` the production NAMES are served by the stage IP (a "production topology check": render
// `scripts/ops/render-edge.mjs --mode production --check-build`, which uses `tls internal`); the names are only ever Host/SNI values for the forced connection, NEVER resolved. In that mode
// state-changing cases are sent only because the identity was verified (use --no-post to skip them). The macOS rehearsal uses `--rehearsal edge|public|stage` (127.0.0.1, its own id).
//
//   node scripts/staging-replay.mjs --stage-host stage.copilt.org --stage-ip 203.0.113.10 --port 443 --http-port 80 --stage-id 9f3c...        # the real staging host (public CA certificate)
//   node scripts/staging-replay.mjs --stage-host stage.copilt.org --stage-ip 203.0.113.10 --port 443 --stage-id 9f3c... --allow-dns-mismatch   # before DNS exists
//   node scripts/staging-replay.mjs --rehearsal public                                                                                       # the Mac twin (production topology, local CA)
//   node scripts/staging-replay.mjs --stage-host stage.copilt.org --stage-ip 127.0.0.1 --port 443 --source operator --stage-id ...           # through the SSH tunnel to the operator listener
//
// Options
//   --cacert FILE          trust this CA / self-signed certificate (the rehearsal's `tls internal` root; a real staging host uses the system trust store)
//   --insecure             do NOT verify the certificate. Refused unless given explicitly; printed in the report header
//   --source public|operator   where THIS machine sits: `public` (default) = the public listener: operator-only cases are skipped and the 403s are expected;
//                          `operator` = this machine reaches the LOOPBACK OPERATOR LISTENER (SSH tunnel; --port is the tunnel's local port): the operator cases run, http:// and apex
//                          cases (not served there) and the public denials of the operator surfaces are skipped
//   --no-post              send only GET/HEAD/OPTIONS (skip every case whose method changes state, even the ones the edge answers with a redirect or 403)
//   --ci-fs expect-404|accept|auto   the edge's static volume: Linux is case-sensitive so /Pricing/ must 404 (default expect-404); `accept` = a case-insensitive
//                          volume is fine (macOS rehearsal host); `auto` = accept either answer and say which one it was
//   --location-port N      the edge puts a non-standard port into absolute redirect targets (the rehearsal's high-port twin does): drop ":N" from Location before comparing
//   --hsts N               expected Strict-Transport-Security max-age (default 300; includeSubDomains/preload are never accepted)
//   --no-sweep             skip the redirect sweep (66 paths x host/scheme combinations, at most one edge-made hop)
//   --no-port-probe        skip the exposure probe (TCP connect to the operator port, the admin API, fastcgi/MySQL/Redis ports on the stage IP: all must be closed from here)
//   --timeout S            per request (default 30)      --json FILE   write the full result      --audit FILE   append the guard's egress audit (JSONL)
//
// HOW THE ORIGIN IS PROVEN WITHOUT ANY FIXTURE HEADER (see docs/cutover/runbook.md 1.5): WordPress answers are recognised by markers a real WordPress install sends, and the
// static origin by the markers the EDGE adds to static answers:
//   WordPress  any of: `Link: <...>; rel="https://api.w.org/"` (front-end and REST responses), `X-Redirect-By: WordPress`, `Expires: Wed, 11 Jan 1984 05:00:00 GMT`
//              (nocache_headers(): wp-login, admin-ajax, wp-cron, the account pages), a `Set-Cookie` named wordpress_* / wp_woocommerce_* / woocommerce_*, a REST error body
//              {"code":"rest_...","data":{"status":...}}, `X-WP-Total`/`X-WP-TotalPages`.
//   static     NO WordPress marker AND (the edge's `Content-Security-Policy-Report-Only` header, or the immutable year-long Cache-Control of /_next/static/, or the
//              validators + Accept-Ranges of a file_server answer).
//   edge       a redirect, a 4xx/5xx the edge made itself (no WordPress marker, `Cache-Control: no-store`), the branded 404.
// A response that carries a WordPress marker where static was expected (or the reverse) is a FAIL. Weakness, stated: a WordPress route that returns NONE of the markers (a bare
// `0` from admin-ajax.php without nocache headers) is reported as "WordPress (weak: no marker)" and counts as a pass only for routes the matrix marks as machine endpoints.
import fs from "node:fs";
import net from "node:net";
import * as M from "./lib/redirect-matrix.mjs";
import { TargetGuard, buildConfig, parseGuardArgs, guarded, installDnsGuard, EXIT_REFUSED } from "./lib/target-guard.mjs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opts = (n) => { const out = []; argv.forEach((a, i) => { if (a === `--${n}`) out.push(argv[i + 1]); else if (a.startsWith(`--${n}=`)) out.push(a.slice(n.length + 3)); }); return out; };
const opt = (n, d) => opts(n)[0] ?? d;
if (flag("help") || flag("h") || argv.length === 0) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 49).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(argv.length ? 0 : 2); }
for (const old of ["edge-ip", "base", "connect-to"]) if (flag(old) || opts(old).length) { process.stderr.write(`GUARD REFUSED [mapping-absent]: --${old} is gone: the target guard builds the connect-to mapping itself from --stage-host/--stage-ip/--port (a hand-written mapping is how a request once reached the real public site).\nNothing was sent.\n`); process.exit(EXIT_REFUSED); }

const timeout = Number(opt("timeout", 30));
const source = opt("source", "public");
const ciFs = opt("ci-fs", "expect-404");
const hsts = `max-age=${opt("hsts", "300")}`;
const insecure = flag("insecure");
const cacertArg = opt("cacert", "");
const noPost = flag("no-post");
const rehearsalLib = opt("rehearsal", "") ? await import("./rehearsal/lib.mjs") : null;
// the rehearsal edge puts its own https port into absolute redirect targets (a high-port instance); drop it before comparing
const locPort = opt("location-port", rehearsalLib && rehearsalLib.INSTANCES[opt("rehearsal", "")] && rehearsalLib.INSTANCES[opt("rehearsal", "")].httpsPort !== 443 ? String(rehearsalLib.INSTANCES[opt("rehearsal", "")].httpsPort) : "");
const normLoc = (l) => (locPort && l ? l.replace(new RegExp(`^(https?://[^/:]+):${locPort}(?=/|$)`), "$1") : l);
if (!["public", "operator"].includes(source)) { console.error("--source must be public or operator"); process.exit(2); }
if (!["expect-404", "accept", "auto"].includes(ciFs)) { console.error("--ci-fs must be expect-404, accept or auto"); process.exit(2); }
if (insecure && cacertArg) { console.error("use --cacert OR --insecure, not both"); process.exit(2); }
if (!insecure && cacertArg && !fs.existsSync(cacertArg)) { console.error(`--cacert ${cacertArg}: no such file`); process.exit(2); }

// ---- the guard: everything below sends through it ------------------------------------------------------------------------------------------------------
const { guard, cfg } = await guarded(async () => {
  const rehearsalName = opt("rehearsal", "");
  const { raw } = parseGuardArgs(argv);
  let base = {};
  if (rehearsalName) { const { rehearsalConfig } = rehearsalLib; base = rehearsalConfig(rehearsalName, { operator: source === "operator" }); }
  const merged = { ...base, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))), aliasHosts: [...(base.aliasHosts || []), ...raw.aliasHosts] };
  merged.cacert = insecure ? undefined : cacertArg || base.cacert || undefined;
  merged.insecure = insecure;
  if (opt("audit")) merged.auditFile = opt("audit");
  const cfg = buildConfig(merged);
  const guard = new TargetGuard(cfg);
  installDnsGuard(guard);
  await guard.ensureIdentity();
  return { guard, cfg };
});
const STAGE_TOPOLOGY = !cfg.aliasHosts.includes(M.CANONICAL_HOST);
const CANON = STAGE_TOPOLOGY ? cfg.stageHost : M.CANONICAL_HOST;
const ORIGIN_R = `https://${CANON}`;
// The STAGE build is noindex by design: build-site-release.sh removes sitemap.xml and serves a disallow-all robots.txt, so the sitemap is expected to be a static 404 on the staging host
// (the production topology keeps the 200 case).
const CASES = STAGE_TOPOLOGY ? M.retargetCases(M.CASES, cfg.stageHost).map((c) => (/^https:\/\/[^/]+\/sitemap\.xml$/.test(c.from) ? { ...c, status: 404, note: "stage build has no sitemap (noindex)" } : c)) : M.CASES;
const notApplicable = M.CASES.length - CASES.length;
const withPort = (u) => u.replace(/^(https?):\/\/(\[[^\]]+\]|[^/?#:]+)(?::\d+)?/i, (_, sch, h) => `${sch}://${h}:${sch.toLowerCase() === "https" ? cfg.port : cfg.httpPort ?? 80}`);
const stdPort = (u) => (/^https/i.test(u) ? cfg.port === 443 : cfg.httpPort === 80);
const insecureHdr = insecure ? ", CERTIFICATE NOT VERIFIED (--insecure)" : "";

const WP_EXPIRES = "Wed, 11 Jan 1984 05:00:00 GMT";
function curl(url, { method = "GET", head = false, body, headers = {} } = {}) {
  const hm = /^https?:\/\/([^/?#:]+)/.exec(url);
  const h = { ...headers };
  // the edge (and WordPress) must see the production-shaped Host even when the connection goes to a non-standard port
  if (hm && !stdPort(url) && !Object.keys(h).some((k) => k.toLowerCase() === "host")) h.Host = hm[1];
  const isHttp = /^http:/i.test(url);
  if (isHttp && !cfg.httpPort) return { status: 0, h: {}, body: "", err: "plain http was not configured (--http-port)", skipped: true };
  const r = guard.curlSync({ url: withPort(url), method, head, body, headers: h, timeout, http: "1.1" });
  const hdrs = {};
  const lines = (r.headerText.split(/\r?\n\r?\n/).pop() || "").split(/\r?\n/);
  for (const l of lines.slice(1)) { const i = l.indexOf(":"); if (i > 0) (hdrs[l.slice(0, i).toLowerCase()] ||= []).push(l.slice(i + 1).trim()); }
  return { status: r.status, h: hdrs, body: (r.body || "").slice(0, 200000), err: r.status === 0 ? r.error : "" };
}
const one = (r, k) => (r.h[k] || [])[0];

function wordpressMarker(r) {
  const link = (r.h.link || []).join(" ");
  if (/rel="?https:\/\/api\.w\.org\/"?/i.test(link)) return "Link rel=api.w.org";
  if (/wordpress/i.test(one(r, "x-redirect-by") || "")) return "X-Redirect-By: WordPress";
  if (one(r, "expires") === WP_EXPIRES) return "Expires 1984 (nocache_headers)";
  if ((r.h["set-cookie"] || []).some((c) => /^(wordpress_|wp-|wp_|woocommerce_)/i.test(c))) return "WordPress/WooCommerce cookie";
  if (r.h["x-wp-total"] || r.h["x-wp-totalpages"]) return "X-WP-Total";
  if (/^\s*\{\s*"code"\s*:\s*"rest_/.test(r.body) || /^\s*\{"valid"/.test(r.body)) return "REST JSON body";
  return "";
}
function staticMarker(r) {
  if (one(r, "content-security-policy-report-only")) return "edge CSP-Report-Only (static handler)";
  if (/immutable/.test(one(r, "cache-control") || "") && one(r, "etag")) return "immutable + ETag (/_next/static/)";
  if (one(r, "etag") && one(r, "last-modified") && one(r, "accept-ranges") === "bytes") return "file_server validators";
  return "";
}

// ---- the substitution of model-only asset names (a real build has hashed names) ------------------------------------------------------------------------------
const home = curl(`${ORIGIN_R}/`);
const jsPath = (/\/_next\/static\/chunks\/[^"' ]+?\.js/.exec(home.body) || [])[0] || null;
const cssPath = (/\/_next\/static\/css\/[^"' ]+?\.css/.exec(home.body) || [])[0] || null;
if (home.status === 0) { console.error(`cannot reach the edge: ${home.err}`); process.exit(2); }
const sub = (u) => u.replace("/_next/static/chunks/main.js", jsPath || "/_next/static/chunks/main.js").replace("/_next/static/chunks/a.js", jsPath || "/_next/static/chunks/a.js").replace("/_next/static/css/a.css", cssPath || "/_next/static/css/a.css");

const rows = [];
let pass = 0, fail = 0, skipped = 0;
const record = (r) => { rows.push(r); if (r.result === "PASS") pass++; else if (r.result === "FAIL") fail++; else skipped++; if (r.result === "FAIL") console.error(`  FAIL ${r.request}\n       expected ${r.expected}\n       got      ${r.actual} [${r.evidence}]`); };
const OPERATOR_PATH = /^\/(wp-admin|wp-login\.php|wp-cron\.php)/i;

for (const c of CASES) {
  const url = sub(c.from.replace(/#.*$/, ""));
  const method = c.method || "GET";
  const path0 = new URL(url).pathname;
  const request = `${method} ${c.from}`;
  const wantLoc = c.location !== undefined ? sub(c.location.replace(/#.*$/, "")) : undefined;
  const expected = c.location !== undefined ? `${c.status} -> ${wantLoc}` : `${c.status} ${c.origin}${c.cache !== undefined ? ` cc=${JSON.stringify(c.cache)}` : ""}`;
  if (c.peer === "operator" && source !== "operator") { record({ request, expected, actual: "-", evidence: "", result: "SKIP", note: "needs the loopback operator listener (--source operator, through the SSH tunnel)" }); continue; }
  if (/^http:/i.test(url) && (!cfg.httpPort || source === "operator")) { record({ request, expected, actual: "-", evidence: "", result: "SKIP", note: source === "operator" ? "the operator listener serves https only" : "plain http was not configured (--http-port)" }); continue; }
  if (source === "operator" && new URL(url).hostname !== CANON) { record({ request, expected, actual: "-", evidence: "", result: "SKIP", note: "the operator listener serves the canonical host only" }); continue; }
  if (c.origin === "edge-deny" && c.peer !== "operator" && OPERATOR_PATH.test(path0) && source === "operator") { record({ request, expected, actual: "-", evidence: "", result: "SKIP", note: "the operator listener does not deny the operator surfaces (--source public checks the denials)" }); continue; }
  if (noPost && !["GET", "HEAD", "OPTIONS"].includes(method)) { record({ request, expected, actual: "-", evidence: "", result: "SKIP", note: "--no-post" }); continue; }
  const isFile = /\.(mp4|webm)$/.test(path0);
  const r = curl(url, { method: method === "HEAD" || (isFile && method === "GET") ? "GET" : method, head: method === "HEAD" || (isFile && method === "GET"), body: !["GET", "HEAD", "OPTIONS"].includes(method) ? "x=1" : undefined });
  const wp = wordpressMarker(r), st = staticMarker(r);
  const loc = normLoc(one(r, "location"));
  const cc = one(r, "cache-control") || "";
  let ok = false, actual = `${r.status}${loc ? " -> " + loc : ""}`, evidence = "";
  const hstsOk = (r.h["strict-transport-security"] || []).length === 1 && r.h["strict-transport-security"][0] === hsts;
  if (r.status === 0) { ok = false; evidence = r.err; }
  else if (c.location !== undefined) {
    ok = r.status === c.status && loc === wantLoc && !wp; evidence = wp ? `WordPress answered a redirect the edge should make (${wp})` : "edge redirect";
  } else if (c.origin === "wordpress") {
    const machine = /^\/(wp-admin\/admin-(ajax|post)\.php|wp-cron\.php|wp-json|wp-login\.php)|wc-ajax|wc-api|rest_route/.test(path0 + (new URL(url).search || ""));
    // WordPress's own files (wp-content, wp-includes) carry no WordPress header when a web server serves them: they are WordPress's because the static origin has no such file (it would 404) and the edge's static handler (CSP-Report-Only) did not answer
    const wpFile = /^\/(wp-content|wp-includes)\//.test(path0) && r.status === 200 && !one(r, "content-security-policy-report-only");
    ok = r.status > 0 && r.status < 500 && !!(wp || wpFile || (machine && !st && r.status !== 404 && r.status !== 403 && r.status !== 421));
    evidence = wp ? `WordPress (${wp})` : wpFile ? "WordPress file (200, not the static handler)" : machine ? "WordPress (weak: no marker)" : `NO WordPress marker${st ? `, static marker: ${st}` : ""}`;
    if (c.cache === M.NOCACHE) ok = ok && cc === M.NOCACHE; else if (c.cache === "") ok = ok && cc !== M.NOCACHE;
  } else if (c.origin === "static") {
    ok = r.status === c.status && !wp && !!(st || r.status === 200);
    evidence = wp ? `WordPress marker on a static route (${wp})` : st ? `static (${st})` : "static (no marker, no WordPress marker)";
    if (c.cache !== undefined && c.cache !== "") ok = ok && cc === c.cache;
  } else if (c.origin === "404") {
    const ciArtifact = /^\/(Pricing|PRODUCT)\//.test(path0) && r.status === 200 && !wp;
    if (ciArtifact && ciFs !== "expect-404") { ok = true; evidence = "case-insensitive static volume answered 200 (accepted by --ci-fs)"; }
    else { ok = r.status === 404 && !wp && (!c.cache || cc === c.cache); evidence = wp ? `WordPress answered (${wp})` : "edge/static 404"; }
  } else if (c.origin === "edge-deny") {
    ok = r.status === c.status && !wp && cc === "no-store"; evidence = wp ? `WordPress answered (${wp}): the edge did not block it` : "edge answer";
  }
  if (r.status && !hstsOk && !(r.status >= 300 && r.status < 400 && false)) { ok = false; evidence += ` | Strict-Transport-Security is ${JSON.stringify(r.h["strict-transport-security"] || null)}, expected exactly ${hsts}`; }
  if (r.status && !(r.h["x-content-type-options"] || []).includes("nosniff")) { ok = false; evidence += " | X-Content-Type-Options: nosniff missing"; }
  for (const bad of ["server", "x-powered-by", "via", "alt-svc"]) if (r.status && (r.h[bad] || []).length) { ok = false; evidence += ` | leaks ${bad}: ${r.h[bad][0]}`; }
  if (STAGE_TOPOLOGY && r.status && !(r.h["x-robots-tag"] || []).some((v) => /noindex/i.test(v))) { ok = false; evidence += " | X-Robots-Tag noindex missing (the staging host must never be indexable)"; }
  if (r.status && /(^|\n)# (HELP|TYPE) (caddy|go|process)_/.test(r.body || "")) { ok = false; evidence += " | PROMETHEUS METRICS TEXT on a public route"; }
  record({ request, expected, actual, evidence, result: ok ? "PASS" : "FAIL" });
}

// ---- sweep: at most one EDGE-made redirect hop, never a loop, always ends on https://www.copilt.org ------------------------------------------------------------
let swept = 0, maxHops = 0;
const appRedirects = {}, leftHost = {};
const allowedNext = (u) => { try { return guard.allowedHosts.includes(new URL(u).hostname.toLowerCase()); } catch { return false; } };
if (!flag("no-sweep") && source !== "operator") {
  for (const scheme of cfg.httpPort ? ["http", "https"] : ["https"]) for (const host of STAGE_TOPOLOGY ? [CANON] : [M.APEX_HOST, M.CANONICAL_HOST]) for (const p of M.SWEEP_PATHS) {
    const q = p.includes("?") ? "" : (p.length % 2 ? "?plan=solo&x=1" : "");
    const start = `${scheme}://${host}${p}${q}`;
    let url = start, edgeHops = 0, loopGuard = 0, stoppedOffHost = null;
    for (;;) {
      const r = curl(url);
      if (r.status >= 300 && r.status < 400 && one(r, "location")) {
        const next = new URL(normLoc(one(r, "location")), url).href;
        const wpMade = !!wordpressMarker(r);
        // NEVER follow a hop that leaves the allowed host set (the guard would refuse it and end the run): WordPress's own canonical redirect to its home URL is noted, an EDGE-made one is a defect
        if (!allowedNext(next)) { stoppedOffHost = { next, wpMade }; if (wpMade) leftHost[`${new URL(url).pathname} -> ${new URL(next).origin}`] = (leftHost[`${new URL(url).pathname} -> ${new URL(next).origin}`] || 0) + 1; break; }
        if (wpMade) { appRedirects[`${new URL(url).pathname} -> ${new URL(next).pathname}`] = (appRedirects[`${new URL(url).pathname} -> ${new URL(next).pathname}`] || 0) + 1; }
        else if (ciFs !== "expect-404" && /^\/Pricing/.test(new URL(url).pathname)) { /* case-insensitive volume: file_server's own directory redirect */ }
        else edgeHops++;
        url = next; if (++loopGuard > 6) break;
      } else break;
    }
    swept++; maxHops = Math.max(maxHops, edgeHops);
    const okSweep = stoppedOffHost ? stoppedOffHost.wpMade && edgeHops <= 1 : edgeHops <= 1 && new URL(url).origin === ORIGIN_R;
    if (!okSweep) record({ request: `sweep ${start}`, expected: `<= 1 edge hop, ends on ${ORIGIN_R}`, actual: stoppedOffHost ? `an EDGE redirect to ${stoppedOffHost.next} (not followed)` : `${edgeHops} edge hops, ended on ${url}`, evidence: "", result: "FAIL" });
  }
  if (!rows.some((r) => r.request.startsWith("sweep "))) { pass++; }
}

// ---- exposure probe: from HERE (the public vantage point) the operator port, the admin API and every backend port of the stage IP must be closed ------------------------------------
const probe = [];
if (!flag("no-port-probe") && !cfg.rehearsal && source === "public" && !/^127\./.test(cfg.stageIp)) {
  for (const port of [8443, 12019, 2019, 9000, 9001, 3306, 5432, 6379, 11211, 8080, 18982, 8000]) {
    const open = await new Promise((resolve) => { const sk = net.connect({ host: cfg.stageIp, port }); sk.setTimeout(3000); sk.on("connect", () => { sk.destroy(); resolve(true); }); sk.on("timeout", () => { sk.destroy(); resolve(false); }); sk.on("error", () => resolve(false)); });
    probe.push({ port, open });
    guard._record({ kind: "tcp-probe", purpose: "exposure-probe", method: "-", host: cfg.stageIp, port, dialIp: cfg.stageIp, decision: "allow", open });
    record({ request: `TCP connect ${cfg.stageIp}:${port} from this machine`, expected: "closed or filtered", actual: open ? "OPEN" : "closed/filtered", evidence: port === 8443 ? "the operator listener is loopback-only" : "not a public port", result: open ? "FAIL" : "PASS" });
  }
}

// ---- report -------------------------------------------------------------------------------------------------------------------------------------------------
const total = rows.length;
const gs = guard.summary();
console.log(`staging-replay: ${CASES.length} matrix cases${notApplicable ? ` (${notApplicable} apex-host cases not applicable to the stage topology)` : ""} against ${cfg.stageHost} (${STAGE_TOPOLOGY ? "stage topology" : "production topology via alias hosts"}) at ${cfg.stageIp}:${cfg.port}${cfg.httpPort ? `/${cfg.httpPort}` : ""} [${cfg.rehearsal ? "rehearsal, " : ""}identity ${guard.identity.verified ? "VERIFIED via " + guard.identity.via : "NOT verified"}], source=${source}${insecureHdr}${!insecure && cfg.cacert ? `, CA ${cfg.cacert}` : !insecure ? ", system trust store" : ""}${noPost ? ", --no-post" : ""}, ci-fs=${ciFs}, hsts ${hsts}`);
console.log(`  egress audit: ${gs.checked} requests checked, ${gs.allowed} allowed, ${gs.refused} refused, ${gs.violations} violation(s), ${gs.offTargetSends} send(s) to an address other than ${cfg.stageIp}`);
const caseRows = rows.filter((r) => !r.request.startsWith("sweep ") && !r.request.startsWith("TCP connect"));
console.log(`  cases: ${caseRows.filter((r) => r.result === "PASS").length} PASS, ${caseRows.filter((r) => r.result === "FAIL").length} FAIL, ${caseRows.filter((r) => r.result === "SKIP").length} SKIP`);
if (!flag("no-sweep") && source !== "operator") console.log(`  sweep: ${swept} requests (${M.SWEEP_PATHS.length} paths x ${STAGE_TOPOLOGY ? 1 : 2} host(s) x ${cfg.httpPort ? 2 : 1} scheme(s)), max edge-made hops ${maxHops}${Object.keys(appRedirects).length ? `; WordPress's own redirects (not the edge): ${JSON.stringify(appRedirects)}` : ""}${Object.keys(leftHost).length ? `; WordPress redirects to ANOTHER host, NOT followed (home/siteurl differs from ${cfg.stageHost}): ${Object.keys(leftHost).length} distinct` : ""}${rows.some((r) => r.request.startsWith("sweep ")) ? " -> FAILURES above" : " -> ok"}`);
if (probe.length) console.log(`  exposure probe: ${probe.length} ports on ${cfg.stageIp}, ${probe.filter((x) => x.open).length} open (must be 0)`);
for (const r of rows.filter((x) => x.result === "SKIP").slice(0, 3)) console.log(`  skipped e.g.: ${r.request} (${r.note})`);
if (opt("json")) fs.writeFileSync(opt("json"), JSON.stringify({ when: new Date().toISOString(), source, ciFs, hsts, insecure, topology: STAGE_TOPOLOGY ? "stage" : "production", stageHost: cfg.stageHost, stageIp: cfg.stageIp, port: cfg.port, identity: guard.identity, guard: gs, counts: { pass, fail, skipped, swept, maxEdgeHops: maxHops }, leftHost, probe, rows }, null, 2));
if (guard.violations.length) { console.error(`GUARD: ${guard.violations.length} egress violation(s) during this run`); process.exit(EXIT_REFUSED); }
console.log(fail ? `FAIL: ${fail} of ${total} checks` : `PASS: every applicable case behaves as the matrix says (${caseRows.filter((r) => r.result === "PASS").length} passed, ${caseRows.filter((r) => r.result === "SKIP").length} skipped for this source)`);
process.exit(fail ? 1 : 0);
