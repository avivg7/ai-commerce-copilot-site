#!/usr/bin/env node
// npm run staging:replay -- --edge-ip <ip> ...   The runbook's HARD GATE (docs/cutover/runbook.md 1.5), as a tool: replay EVERY case of scripts/lib/redirect-matrix.mjs
// against a REAL edge on ANY host and report PASS/FAIL per case. It depends on nothing of the rehearsal: no loopback, no macOS, no fixture, no marker header that only the
// rehearsal's PHP server sends. Needs only Node >= 18 and a `curl` binary (>= 7.49 for --connect-to).
//
//   node scripts/staging-replay.mjs --edge-ip 203.0.113.10 --cacert ./staging-ca.pem          # canonical names are mapped to that IP, ports 80 and 443
//   node scripts/staging-replay.mjs --base https://10.0.0.5:8443 --http-port 8080 --insecure   # a staging edge on other ports (certificate not trusted: explicit flag)
//   node scripts/staging-replay.mjs --connect-to www.copilt.org:443:10.0.0.5:443 --connect-to copilt.org:443:10.0.0.5:443 --connect-to ...:80:...
//
// The requests keep the canonical names (Host + SNI = www.copilt.org / copilt.org); only the TCP connection goes to the edge, exactly like `curl --resolve` /
// `--connect-to`: no DNS, no /etc/hosts change, nothing about the public names is touched.
//
// Options
//   --edge-ip IP | --base URL | --connect-to H:P:IP:P (repeatable)   where the edge is (one of them is required)
//   --http-port N          with --base: the plain-http port of the edge (default 80)
//   --cacert FILE          trust this CA / self-signed certificate (the staging edge's `tls internal` root or the pre-issued chain)
//   --insecure             do NOT verify the certificate. Refused unless given explicitly; printed in the report header
//   --source public|operator   where THIS machine sits: `public` (default) = not in AICC_OPERATOR_CIDRS: operator-only cases are skipped and the 403s are expected;
//                          `operator` = inside the list: the operator cases run and the cases that need an outsider are skipped
//   --no-post              send only GET/HEAD/OPTIONS (skip every case whose method changes state, even the ones the edge answers with a redirect or 403)
//   --ci-fs expect-404|accept|auto   the edge's static volume: Linux is case-sensitive so /Pricing/ must 404 (default expect-404); `accept` = a case-insensitive
//                          volume is fine (macOS rehearsal host); `auto` = accept either answer and say which one it was
//   --location-port N      the staging edge sits on a non-standard port and puts it into absolute redirect targets (the rehearsal's high-port twin does): drop ":N" from Location
//                          before comparing. Never needed for an edge on 80/443 with the production template
//   --hsts N               expected Strict-Transport-Security max-age (default 300; includeSubDomains/preload are never accepted)
//   --no-sweep             skip the redirect sweep (66 paths x apex/www x http/https, at most one edge-made hop)
//   --timeout S            per request (default 30)      --json FILE   write the full result
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
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as M from "./lib/redirect-matrix.mjs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opts = (n) => { const out = []; argv.forEach((a, i) => { if (a === `--${n}`) out.push(argv[i + 1]); }); return out; };
const opt = (n, d) => opts(n)[0] ?? d;
if (flag("help") || flag("h") || argv.length === 0) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 40).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(argv.length ? 0 : 2); }

const timeout = Number(opt("timeout", 30));
const source = opt("source", "public");
const ciFs = opt("ci-fs", "expect-404");
const hsts = `max-age=${opt("hsts", "300")}`;
const insecure = flag("insecure");
const cacert = opt("cacert", "");
const noPost = flag("no-post");
const locPort = opt("location-port", "");
const normLoc = (l) => (locPort && l ? l.replace(new RegExp(`^(https?://[^/:]+):${locPort}(?=/|$)`), "$1") : l);
if (!["public", "operator"].includes(source)) { console.error("--source must be public or operator"); process.exit(2); }
if (!["expect-404", "accept", "auto"].includes(ciFs)) { console.error("--ci-fs must be expect-404, accept or auto"); process.exit(2); }
if (insecure && cacert) { console.error("use --cacert OR --insecure, not both"); process.exit(2); }
if (!insecure && cacert && !fs.existsSync(cacert)) { console.error(`--cacert ${cacert}: no such file`); process.exit(2); }

// ---- where the edge is --------------------------------------------------------------------------------------------------------------------------
const HOSTS = [M.CANONICAL_HOST, M.APEX_HOST];
const connect = [];
if (opt("edge-ip")) { for (const h of HOSTS) for (const p of [80, 443]) connect.push(`${h}:${p}:${opt("edge-ip")}:${p}`); }
else if (opt("base")) {
  const u = new URL(opt("base"));
  const httpsPort = u.port || "443", httpPort = opt("http-port", "80");
  for (const h of HOSTS) { connect.push(`${h}:443:${u.hostname}:${httpsPort}`); connect.push(`${h}:80:${u.hostname}:${httpPort}`); }
}
for (const c of opts("connect-to")) connect.push(c);
if (!connect.length) { console.error("say where the edge is: --edge-ip IP, --base URL or --connect-to H:P:IP:P"); process.exit(2); }
if (!insecure && !cacert && connect.some((c) => /^(\d+\.){3}\d+$/.test(c.split(":")[2] || ""))) console.error("note: no --cacert and no --insecure: the system trust store is used (right for a pre-issued public-CA certificate, wrong for tls internal)");
const curlVersion = spawnSync("curl", ["--version"], { encoding: "utf8" });
if (curlVersion.status !== 0) { console.error("curl is required"); process.exit(2); }

const WP_EXPIRES = "Wed, 11 Jan 1984 05:00:00 GMT";
function curl(url, { method = "GET", head = false, body, headers = {} } = {}) {
  const tmp = path.join(os.tmpdir(), `staging-replay-${process.pid}-${Math.random().toString(36).slice(2)}.body`);
  const args = ["-sS", "--path-as-is", "-D", "-", "-o", head ? "/dev/null" : tmp, "--max-time", String(timeout), "--http1.1"];
  for (const c of connect) args.push("--connect-to", c);
  if (insecure) args.push("-k"); else if (cacert) args.push("--cacert", cacert);
  if (head) args.push("-I"); else if (method !== "GET") args.push("-X", method);
  if (body !== undefined) args.push("--data-binary", body);
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  args.push(url);
  const r = spawnSync("curl", args, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  let txt = r.stdout ? r.stdout.toString("latin1") : "";
  const blocks = txt.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b));
  const hb = blocks[blocks.length - 1] || "";
  const lines = hb.split(/\r?\n/);
  const status = Number((/^HTTP\/\S+\s+(\d{3})/.exec(lines[0]) || [])[1] || 0);
  const h = {};
  for (const l of lines.slice(1)) { const i = l.indexOf(":"); if (i > 0) (h[l.slice(0, i).toLowerCase()] ||= []).push(l.slice(i + 1).trim()); }
  let b = "";
  if (!head && fs.existsSync(tmp)) { b = fs.readFileSync(tmp, "utf8").slice(0, 200000); fs.rmSync(tmp, { force: true }); }
  return { status, h, body: b, err: status === 0 ? (r.stderr || "").toString().trim().slice(0, 200) : "" };
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
const home = curl("https://www.copilt.org/");
const jsPath = (/\/_next\/static\/chunks\/[^"' ]+?\.js/.exec(home.body) || [])[0] || null;
const cssPath = (/\/_next\/static\/css\/[^"' ]+?\.css/.exec(home.body) || [])[0] || null;
if (home.status === 0) { console.error(`cannot reach the edge: ${home.err}`); process.exit(2); }
const sub = (u) => u.replace("/_next/static/chunks/main.js", jsPath || "/_next/static/chunks/main.js").replace("/_next/static/chunks/a.js", jsPath || "/_next/static/chunks/a.js").replace("/_next/static/css/a.css", cssPath || "/_next/static/css/a.css");

const rows = [];
let pass = 0, fail = 0, skipped = 0;
const record = (r) => { rows.push(r); if (r.result === "PASS") pass++; else if (r.result === "FAIL") fail++; else skipped++; if (r.result === "FAIL") console.error(`  FAIL ${r.request}\n       expected ${r.expected}\n       got      ${r.actual} [${r.evidence}]`); };
const OPERATOR_PATH = /^\/(wp-admin|wp-login\.php|wp-cron\.php)/i;

for (const c of M.CASES) {
  const url = sub(c.from.replace(/#.*$/, ""));
  const method = c.method || "GET";
  const path0 = new URL(url).pathname;
  const request = `${method} ${c.from}`;
  const wantLoc = c.location !== undefined ? sub(c.location.replace(/#.*$/, "")) : undefined;
  const expected = c.location !== undefined ? `${c.status} -> ${wantLoc}` : `${c.status} ${c.origin}${c.cache !== undefined ? ` cc=${JSON.stringify(c.cache)}` : ""}`;
  if (c.peer === "operator" && source !== "operator") { record({ request, expected, actual: "-", evidence: "", result: "SKIP", note: "needs a source inside AICC_OPERATOR_CIDRS (--source operator)" }); continue; }
  if (c.origin === "edge-deny" && c.peer !== "operator" && OPERATOR_PATH.test(path0) && source === "operator") { record({ request, expected, actual: "-", evidence: "", result: "SKIP", note: "an operator source is not denied here (--source public)" }); continue; }
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
  for (const bad of ["server", "x-powered-by", "via"]) if (r.status && (r.h[bad] || []).length) { ok = false; evidence += ` | leaks ${bad}: ${r.h[bad][0]}`; }
  record({ request, expected, actual, evidence, result: ok ? "PASS" : "FAIL" });
}

// ---- sweep: at most one EDGE-made redirect hop, never a loop, always ends on https://www.copilt.org ------------------------------------------------------------
let swept = 0, maxHops = 0;
const appRedirects = {};
if (!flag("no-sweep")) {
  for (const scheme of ["http", "https"]) for (const host of [M.APEX_HOST, M.CANONICAL_HOST]) for (const p of M.SWEEP_PATHS) {
    const q = p.includes("?") ? "" : (p.length % 2 ? "?plan=solo&x=1" : "");
    const start = `${scheme}://${host}${p}${q}`;
    let url = start, edgeHops = 0, loopGuard = 0;
    for (;;) {
      const r = curl(url);
      if (r.status >= 300 && r.status < 400 && one(r, "location")) {
        const next = new URL(normLoc(one(r, "location")), url).href;
        if (wordpressMarker(r)) { appRedirects[`${new URL(url).pathname} -> ${new URL(next).pathname}`] = (appRedirects[`${new URL(url).pathname} -> ${new URL(next).pathname}`] || 0) + 1; }
        else if (ciFs !== "expect-404" && /^\/Pricing/.test(new URL(url).pathname)) { /* case-insensitive volume: file_server's own directory redirect */ }
        else edgeHops++;
        url = next; if (++loopGuard > 6) break;
      } else break;
    }
    swept++; maxHops = Math.max(maxHops, edgeHops);
    const okSweep = edgeHops <= 1 && new URL(url).origin === M.ORIGIN;
    if (!okSweep) record({ request: `sweep ${start}`, expected: "<= 1 edge hop, ends on https://www.copilt.org", actual: `${edgeHops} edge hops, ended on ${url}`, evidence: "", result: "FAIL" });
  }
  if (!rows.some((r) => r.request.startsWith("sweep "))) { pass++; }
}

// ---- report -------------------------------------------------------------------------------------------------------------------------------------------------
const total = rows.length;
console.log(`staging-replay: ${M.CASES.length} matrix cases against the edge (${connect.length / 1} connect-to mappings, source=${source}${insecure ? ", CERTIFICATE NOT VERIFIED (--insecure)" : cacert ? `, CA ${cacert}` : ", system trust store"}${noPost ? ", --no-post" : ""}, ci-fs=${ciFs}, hsts ${hsts})`);
const caseRows = rows.filter((r) => !r.request.startsWith("sweep "));
console.log(`  cases: ${caseRows.filter((r) => r.result === "PASS").length} PASS, ${caseRows.filter((r) => r.result === "FAIL").length} FAIL, ${caseRows.filter((r) => r.result === "SKIP").length} SKIP`);
if (!flag("no-sweep")) console.log(`  sweep: ${swept} requests (${M.SWEEP_PATHS.length} paths x 4 host/scheme combinations), max edge-made hops ${maxHops}${Object.keys(appRedirects).length ? `; WordPress's own redirects (not the edge): ${JSON.stringify(appRedirects)}` : ""}${rows.some((r) => r.request.startsWith("sweep ")) ? " -> FAILURES above" : " -> ok"}`);
for (const r of rows.filter((x) => x.result === "SKIP").slice(0, 3)) console.log(`  skipped e.g.: ${r.request} (${r.note})`);
if (opt("json")) fs.writeFileSync(opt("json"), JSON.stringify({ when: new Date().toISOString(), source, ciFs, hsts, insecure, connect, counts: { pass, fail, skipped, swept, maxEdgeHops: maxHops }, rows }, null, 2));
console.log(fail ? `FAIL: ${fail} of ${total} checks` : `PASS: every applicable case behaves as the matrix says (${caseRows.filter((r) => r.result === "PASS").length} passed, ${caseRows.filter((r) => r.result === "SKIP").length} skipped for this source)`);
process.exit(fail ? 1 : 0);
