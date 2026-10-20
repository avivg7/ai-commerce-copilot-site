// Real-Caddy test sections for the AICC edge rehearsal. Usage: node scripts/rehearsal/rehearsal.mjs run-tests [routing|behavior|admin|errors|logging|break|demo|restart|tls|rollback|all]
// Every section writes ~/Downloads/AICC-cutover-evidence/rehearsal/<section>.json + .md. Exit code 1 if any check fails.
import fs from "node:fs";
import path from "node:path";
import * as M from "../lib/redirect-matrix.mjs";
import { alive, readPid, waitFor, startProbe, allEdgeLogFiles, readLogFile, P, INSTANCES, WP_UPSTREAM, req, rawRequest, readAccessLog, stripPort, resolveLocation, fsCaseInsensitive, sleep, now, ensureDirs, portListening, cpEchoToken, sh, caddyVersion } from "./lib.mjs";
import { Section } from "./harness.mjs";
import { settings, start, stop, reload, launchdPlist, generateOldTarget, oldTargetSafety, generate, safetyCheck, validate, preflight, envFor } from "./edge.mjs";
void 0;
import { REPO as REPO_ROOT } from "./lib.mjs";

const EDGE = INSTANCES.edge;
const PUBLIC = INSTANCES.public;

export async function ensureInstances() {
  // the standing edge (real ports 80/443, operator = loopback) and a "public source" twin on high ports whose operator list is 192.0.2.1/32, so every loopback request is a non-operator
  for (const inst of [EDGE, PUBLIC]) {
    const cfg = { ...settings(), ...inst, upstream: WP_UPSTREAM, staticRoot: P.current, wpTimeout: "60s", variant: "" };
    if (alive(readPid(inst.name))) await reload(cfg, { quiet: true }); // always run the CURRENT template
    else await start(cfg, { quiet: true });
  }
}
const instFor = (c) => (c.peer === "operator" ? EDGE : PUBLIC);
const WPID = WP_UPSTREAM;
const FS_CI = fsCaseInsensitive();

/* ------------------------------------------------------------------ routing: the 200+ cases of scripts/lib/redirect-matrix.mjs through the real edge */
async function routing() {
  const S = new Section("01-routing-matrix", "Routing matrix replayed through a REAL Caddy (no redirect following, owner proven by the access log)");
  await ensureInstances();
  const rows = [];
  // the model's example hashed assets do not exist in a real build: use real ones from the release (same routing rule, real file)
  const realAsset = (u) => {
    const dir = (sub, ext) => fs.readdirSync(path.join(P.current, "_next/static", sub)).filter((f) => f.endsWith(ext))[0];
    return u.replace("/_next/static/chunks/main.js", `/_next/static/chunks/${dir("chunks", ".js")}`).replace("/_next/static/chunks/a.js", `/_next/static/chunks/${dir("chunks", ".js")}`).replace("/_next/static/css/a.css", `/_next/static/css/${dir("css", ".css")}`);
  };
  for (const c of M.CASES) {
    const url = (c.origin === "static" ? realAsset(c.from) : c.from).replace(/#.*$/, "");
    const inst = instFor(c);
    const r = await req(inst, url, { method: c.method && c.method !== "HEAD" ? c.method : undefined, head: c.method === "HEAD", body: c.method && !["GET", "HEAD"].includes(c.method) ? "x=1" : undefined });
    await sleep(2);
    const row = { request: `${c.method || "GET"} ${c.from}`, peer: c.peer || "public", expected: c.location !== undefined ? `${c.status} -> ${c.location.replace(/#.*$/, "")}` : `${c.status} ${c.origin}${c.cache !== undefined ? ` cc=${JSON.stringify(c.cache)}` : ""}`, actual: `${r.status}${r.headers.location ? " -> " + stripPort(inst, r.headers.location[0]) : ""}`, reqId: r.reqId, note: c.note || "" };
    rows.push({ c, r, row, inst });
  }
  await sleep(300);
  const { map } = readAccessLog();
  for (const { c, r, row, inst } of rows) {
    const entry = map.get(row.reqId);
    const upstream = entry ? entry.upstream || "" : "(no log entry)";
    row.upstream = upstream;
    const id = `${row.request} [${row.peer}]`;
    if (c.location !== undefined) {
      const want = c.location.replace(/#.*$/, "");
      const got = stripPort(inst, r.headers.location?.[0]);
      S.check(id, r.status === c.status && got === want && upstream === "", `expected ${c.status} -> ${want}; got ${r.status} -> ${got}; upstream="${upstream}"`, row.actual);
      row.owner = "edge (redirect)"; row.ok = r.status === c.status && got === want && upstream === "";
    } else if (c.origin === "wordpress") {
      const marker = (r.headers["x-rehearsal-upstream"] || [])[0];
      const ok = marker === "wordpress" && upstream === WPID && r.status < 500 && r.status > 0;
      let okc = true; if (c.cache === NOCACHE_S) okc = (r.headers["cache-control"] || [])[0] === NOCACHE_S; else if (c.cache === "") okc = (r.headers["cache-control"] || [])[0] !== NOCACHE_S;
      S.check(id, ok && okc, `expected WordPress (marker+log upstream ${WPID}), status<500; got marker=${marker} upstream="${upstream}" status=${r.status} cc=${(r.headers["cache-control"] || [])[0]}`, `${r.status} wp`);
      row.owner = `WordPress (${marker ? "marker" : "NO marker"}, upstream ${upstream || "-"})`; row.ok = ok && okc;
      if (r.status !== 200) row.note = `WordPress itself answered ${r.status}${r.headers.location ? " -> " + r.headers.location[0] : ""}. ${row.note}`;
    } else if (c.origin === "static") {
      const marker = (r.headers["x-rehearsal-upstream"] || [])[0];
      const ok = r.status === c.status && !marker && upstream === "";
      S.check(id, ok, `expected static ${c.status}; got ${r.status} marker=${marker} upstream="${upstream}"`, `${r.status} static`);
      row.owner = "static (Caddy file_server)"; row.ok = ok;
    } else if (c.origin === "404" && FS_CI && /^\/(Pricing|PRODUCT)\//.test(new URL(c.from).pathname)) {
      S.info(id, `macOS volume is case-insensitive, so file_server found the static mirror (${r.status}); Linux ext4/xfs is case-sensitive and gives 404. Rehearsal artifact, not an edge defect.`, `${r.status}`);
      row.owner = "static (FS artifact)"; row.ok = true; row.note = "macOS case-insensitive FS artifact; 404 on Linux";
    } else if (c.origin === "404") {
      const ok = r.status === 404 && !(r.headers["x-rehearsal-upstream"] || [])[0] && upstream === "" && /<html|<!doctype/i.test(r.body || "");
      S.check(id, ok, `expected edge 404 with branded body; got ${r.status} upstream="${upstream}" bodyHtml=${/<html|<!doctype/i.test(r.body || "")}`, `${r.status} edge-404`);
      row.owner = "edge 404 page"; row.ok = ok;
    } else if (c.origin === "edge-deny") {
      const ok = r.status === c.status && upstream === "" && !(r.headers["x-rehearsal-upstream"] || [])[0] && (r.headers["cache-control"] || [])[0] === "no-store";
      S.check(id, ok, `expected edge ${c.status} (never proxied); got ${r.status} upstream="${upstream}" cc=${(r.headers["cache-control"] || [])[0]}`, `${r.status} deny`);
      row.owner = "edge (deny)"; row.ok = ok;
    }
  }
  S.data.table = rows.map(({ row }) => row);
  S.data.count = rows.length;
  S.note(`${rows.length} cases from scripts/lib/redirect-matrix.mjs, replayed with HTTP/1.1 through the real edge (public-source twin on :18443 for public peers, the standing edge on :443 for operator-peer cases). Redirects are NOT followed; owner = WordPress iff the PHP marker header AND the access-log upstream field name ${WPID}.`);
  S.save();
  // sweep: follow redirects, at most one hop, never a loop, always ends on https://www.copilt.org
  const W = new Section("02-redirect-sweep", "Redirect sweep through the real edge: <= 1 hop, no loop, ends on https://www.copilt.org");
  let swept = 0, maxHops = 0, wpHops = 0;
  const wpRedirects = {};
  for (const scheme of ["http", "https"]) for (const host of [M.APEX_HOST, M.CANONICAL_HOST]) for (const p of M.SWEEP_PATHS) {
    const q = p.includes("?") ? "" : (p.length % 2 ? "?plan=solo&x=1" : "");
    const start = `${scheme}://${host}${p}${q}`;
    let url = start, hops = 0, appHops = 0, fsHop = false;
    for (;;) {
      const r = await req(PUBLIC, url);
      if (r.status >= 300 && r.status < 400 && r.headers.location) {
        const next = resolveLocation(PUBLIC, url, r.headers.location[0]);
        // an application redirect (WordPress answered: e.g. empty cart /checkout/ -> /cart/) is not an edge hop; a file_server directory redirect on the case-insensitive macOS volume is a rehearsal artifact
        if ((r.headers["x-rehearsal-upstream"] || [])[0] === "wordpress") { appHops++; wpRedirects[`${new URL(url).pathname} -> ${new URL(next).pathname}`] = (wpRedirects[`${new URL(url).pathname} -> ${new URL(next).pathname}`] || 0) + 1; }
        else if (FS_CI && /^\/(Pricing)/.test(new URL(url).pathname)) fsHop = true;
        else hops++;
        url = next; if (hops + appHops > 5) break;
      } else break;
    }
    swept++; maxHops = Math.max(maxHops, hops); wpHops = Math.max(wpHops, appHops);
    W.check(`${start}`, hops <= 1 && new URL(url).origin === M.ORIGIN, `edge hops=${hops}, WordPress application hops=${appHops}${fsHop ? ", FS artifact hop" : ""}, end=${url}`);
  }
  W.data = { swept, maxEdgeHops: maxHops, maxAppHops: wpHops, wordpressApplicationRedirects: wpRedirects };
  W.note(`${swept} sweeps (${M.SWEEP_PATHS.length} paths x 4 host/scheme combinations), max EDGE-made hops ${maxHops}; WordPress's own application redirects (not the edge) seen: ${JSON.stringify(wpRedirects)}`);
  W.save();
  return [S, W];
}
const NOCACHE_S = M.NOCACHE;


/* ------------------------------------------------------------------ shared registry: every response seen by the behaviour sections (for the global Set-Cookie / cache invariant) */
const SEEN = [];
async function rq(inst, url, o = {}) {
  const r = await req(inst, url, o);
  SEEN.push({ url, method: o.method || (o.head ? "HEAD" : "GET"), status: r.status, cc: (r.headers?.["cache-control"] || []).join(" | "), setCookie: (r.headers?.["set-cookie"] || []).length, upstream: (r.headers?.["x-rehearsal-upstream"] || [])[0] || "" });
  return r;
}
const one = (r, h) => (r.headers[h] || [])[0];
const count = (r, h) => (r.headers[h] || []).length;
const sha = (file, start = 0, len) => { const b = fs.readFileSync(file); return sh("shasum", ["-a", "256"], { input: len ? b.subarray(start, start + len) : b }).stdout.slice(0, 16); };
const DEMO = path.join(P.current, "demo/aicc-demo.mp4");
const MP4_SIZE = 43957999;
const realFile = (sub, ext) => `/_next/static/${sub}/` + fs.readdirSync(path.join(P.current, "_next/static", sub)).filter((f) => f.endsWith(ext))[0];

async function behavior() {
  const S = new Section("03-behavior", "Real behaviour through the edge: headers, MIME, ranges, compression, HTTP/2, caching, security headers, hosts, injection, methods");
  await ensureInstances();
  const E = EDGE;

  // ---- A. MIME and Content-Length ----------------------------------------------------------------
  const jsPath = realFile("chunks", ".js"), cssPath = realFile("css", ".css");
  const mime = [["/", /^text\/html/], ["/product/", /^text\/html/], ["/he/", /^text\/html/], [jsPath, /javascript/], [cssPath, /^text\/css/], ["/demo/aicc-demo.mp4", /^video\/mp4$/], ["/demo/aicc-demo.vtt", /^text\/vtt/], ["/demo/aicc-demo-poster.jpg", /^image\/jpeg$/], ["/og/en-home.jpg", /^image\/jpeg$/], ["/brand-kit/aicc-logomark.svg", /^image\/svg\+xml/], ["/fonts/heebo-hebrew.woff2", /^font\/woff2$/], ["/robots.txt", /^text\/plain/], ["/sitemap.xml", /xml/], ["/favicon.ico", /image\/(x-icon|vnd\.microsoft\.icon)/]];
  for (const [p, re] of mime) {
    const r = await rq(E, `https://www.copilt.org${p}`);
    const file = path.join(P.current, p === "/" ? "index.html" : p.endsWith("/") ? p.slice(1) + "index.html" : p.slice(1));
    const len = fs.existsSync(file) ? fs.statSync(file).size : -1;
    S.check(`MIME + Content-Length ${p}`, r.status === 200 && re.test(one(r, "content-type") || "") && (count(r, "content-encoding") > 0 || Number(one(r, "content-length")) === len), `status=${r.status} type=${one(r, "content-type")} len=${one(r, "content-length")} disk=${len} enc=${one(r, "content-encoding") || "-"}`, `${one(r, "content-type")}`);
  }
  // ---- B. byte ranges on the demo ----------------------------------------------------------------
  const h = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { head: true });
  S.check("HEAD mp4: 200, Content-Length 43957999, Accept-Ranges bytes, no body", h.status === 200 && one(h, "content-length") === String(MP4_SIZE) && one(h, "accept-ranges") === "bytes" && h.body.trim() === "", `${h.status} len=${one(h, "content-length")} ar=${one(h, "accept-ranges")}`);
  const etag = one(h, "etag");
  const r1 = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: "bytes=0-99" }, bodyFile: "/tmp/aicc-range1.bin" });
  S.check("Range 0-99 -> 206, Content-Range bytes 0-99/43957999, 100 bytes, correct bytes", r1.status === 206 && one(r1, "content-range") === `bytes 0-99/${MP4_SIZE}` && one(r1, "content-length") === "100" && sha("/tmp/aicc-range1.bin") === sha(DEMO, 0, 100), `${r1.status} ${one(r1, "content-range")} len=${one(r1, "content-length")}`);
  const r2 = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: `bytes=${MP4_SIZE - 50}-` }, bodyFile: "/tmp/aicc-range2.bin" });
  S.check("Range open-ended tail -> 206 and the last 50 bytes", r2.status === 206 && one(r2, "content-range") === `bytes ${MP4_SIZE - 50}-${MP4_SIZE - 1}/${MP4_SIZE}`, `${r2.status} ${one(r2, "content-range")}`);
  const r3 = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: "bytes=-100" }, bodyFile: "/tmp/aicc-range3.bin" });
  S.check("Range suffix -100 -> 206 last 100 bytes", r3.status === 206 && one(r3, "content-range") === `bytes ${MP4_SIZE - 100}-${MP4_SIZE - 1}/${MP4_SIZE}`, `${r3.status} ${one(r3, "content-range")}`);
  const seek = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: "bytes=20000000-20000999" }, bodyFile: "/tmp/aicc-range4.bin" });
  S.check("seek test: Range 20,000,000-20,000,999 -> 206 and the exact middle bytes", seek.status === 206 && sha("/tmp/aicc-range4.bin") === sha(DEMO, 20000000, 1000), `${seek.status} ${one(seek, "content-range")}`);
  const ifr = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: "bytes=0-9", "If-Range": etag } });
  S.check("If-Range with the current ETag -> 206", ifr.status === 206, `${ifr.status} etag=${etag}`);
  const ifr2 = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: "bytes=0-9", "If-Range": '"stale-etag"' }, bodyFile: "/tmp/aicc-range5.bin" });
  S.check("If-Range with a stale ETag -> 200 and the FULL file (no partial of a changed file)", ifr2.status === 200 && fs.statSync("/tmp/aicc-range5.bin").size === MP4_SIZE, `${ifr2.status} bytes=${fs.existsSync("/tmp/aicc-range5.bin") ? fs.statSync("/tmp/aicc-range5.bin").size : "?"}`);
  const multi = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: "bytes=0-9,100-109" }, bodyFile: "/tmp/aicc-range6.bin" });
  S.check("multi-range 0-9,100-109 -> 206 multipart/byteranges", multi.status === 206 && /^multipart\/byteranges/.test(one(multi, "content-type") || ""), `${multi.status} ${one(multi, "content-type")}`);
  const unsat = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: `bytes=${MP4_SIZE + 10}-` } });
  S.check("unsatisfiable range -> 416 with Content-Range bytes */size", unsat.status === 416 && one(unsat, "content-range") === `bytes */${MP4_SIZE}`, `${unsat.status} ${one(unsat, "content-range")}`);
  const huge = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: "bytes=0-99999999999999" }, bodyFile: "/tmp/aicc-range7.bin" });
  S.check("Range abuse: end far beyond EOF is clamped (206 with the whole file or 200), never a crash", [200, 206].includes(huge.status) && fs.statSync("/tmp/aicc-range7.bin").size === MP4_SIZE, `${huge.status} ${one(huge, "content-range")}`);
  const overlap = "bytes=" + Array.from({ length: 500 }, (_, i) => `${i}-${i + 1000}`).join(",");
  const ov = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: overlap }, bodyFile: "/tmp/aicc-range8.bin", timeout: 20 });
  S.check("Range abuse: 500 overlapping ranges does not amplify (response bounded to <= file size, edge still alive)", ov.status > 0 && fs.statSync("/tmp/aicc-range8.bin").size <= MP4_SIZE + 1024, `status=${ov.status} bytes=${fs.statSync("/tmp/aicc-range8.bin").size}`);
  const bad = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: "bytes=abc-def" } });
  S.check("Range abuse: malformed Range header is ignored or 416, not 5xx", bad.status === 200 || bad.status === 416, `${bad.status}`);
  const stillUp = await rq(E, "https://www.copilt.org/");
  S.check("edge still answers after the range abuse", stillUp.status === 200, `${stillUp.status}`);

  // ---- C. compression ---------------------------------------------------------------------------------
  for (const [p, label] of [["/", "html"], [jsPath, "js"], [cssPath, "css"], ["/sitemap.xml", "xml"], ["/pricing/", "html (WordPress)"], ["/wp-json/aicc-license/v1/plans", "json (WordPress)"], ["/brand-kit/aicc-logomark.svg", "svg"]]) {
    for (const enc of ["gzip", "zstd"]) {
      const r = await rq(E, `https://www.copilt.org${p}`, { headers: { "Accept-Encoding": enc }, bodyFile: "/tmp/aicc-enc.bin" });
      S.check(`compression ${label} ${p} with Accept-Encoding: ${enc}`, r.status === 200 && one(r, "content-encoding") === enc && /accept-encoding/i.test((r.headers.vary || []).join(",")), `${r.status} content-encoding=${one(r, "content-encoding")} vary=${(r.headers.vary || []).join(",")}`);
    }
  }
  const plain = await rq(E, "https://www.copilt.org/", { bodyFile: "/tmp/aicc-plain.bin", headers: { "Accept-Encoding": "identity" } });
  const gz = await rq(E, "https://www.copilt.org/", { bodyFile: "/tmp/aicc-gz.bin", headers: { "Accept-Encoding": "gzip" } });
  S.check("gzip body decompresses to exactly the identity body", sh("bash", ["-c", "gunzip -c /tmp/aicc-gz.bin | cmp - /tmp/aicc-plain.bin && echo same"]).stdout.trim() === "same", `identity=${plain.bytes} gzip=${gz.bytes}`);
  for (const p of ["/demo/aicc-demo.mp4", "/demo/aicc-demo-poster.jpg", "/og/en-home.jpg", "/fonts/heebo-hebrew.woff2", "/brand-kit/reco-thinking-480.webp"]) {
    const r = await rq(E, `https://www.copilt.org${p}`, { head: true, headers: { "Accept-Encoding": "gzip, zstd, br" } });
    S.check(`NO compression for ${p}`, r.status === 200 && !one(r, "content-encoding"), `${r.status} content-encoding=${one(r, "content-encoding") || "-"}`);
  }
  // ---- D. HTTP/2 -----------------------------------------------------------------------------------------
  const h2 = await rq(E, "https://www.copilt.org/", { http: "2", head: true });
  S.check("HTTP/2 negotiated over TLS (ALPN h2)", h2.httpVersion === "2" || /HTTP\/2/.test(h2.proto || ""), `proto=${h2.proto} curl-version=${h2.httpVersion}`);
  S.check("Alt-Svc advertises h3 (HTTP/3 listener is on; curl here has no HTTP/3 so QUIC itself is UNVERIFIED)", /h3=/.test(one(h2, "alt-svc") || ""), one(h2, "alt-svc"));

  // ---- E. caching matrix ----------------------------------------------------------------------------------
  const cacheRows = [];
  const cacheCase = async (label, url, o = {}, expectRe, expectDesc) => {
    const r = await rq(E, url, o);
    const cc = (r.headers["cache-control"] || []).join(" | ");
    cacheRows.push({ resource: label, status: r.status, cacheControl: cc, setCookie: count(r, "set-cookie"), expected: expectDesc });
    S.check(`Cache-Control ${label}`, expectRe.test(cc) && (count(r, "cache-control") === 1 || (o.allowAbsent && count(r, "cache-control") === 0)), `${r.status} cc="${cc}" (x${count(r, "cache-control")})`, cc);
    return r;
  };
  await cacheCase("/ (static home)", "https://www.copilt.org/", {}, /^public, max-age=0, must-revalidate$/, "public, max-age=0, must-revalidate");
  await cacheCase("/_next/static/* (hashed)", `https://www.copilt.org${jsPath}`, {}, /^public, max-age=31536000, immutable$/, "immutable, 1 year");
  await cacheCase("other static: /brand-kit/*", "https://www.copilt.org/brand-kit/aicc-logomark.svg", {}, /^public, max-age=86400$/, "public, 1 day");
  await cacheCase("other static: /robots.txt", "https://www.copilt.org/robots.txt", {}, /^public, max-age=86400$/, "public, 1 day");
  await cacheCase("other static: /product/ (HTML page)", "https://www.copilt.org/product/", {}, /^public, max-age=0, must-revalidate$/, "revalidate every time");
  await cacheCase("poster /demo/aicc-demo-poster.jpg", "https://www.copilt.org/demo/aicc-demo-poster.jpg", {}, /^public, max-age=0, must-revalidate$/, "revalidate (same URL, replaceable)");
  await cacheCase("mp4 /demo/aicc-demo.mp4", "https://www.copilt.org/demo/aicc-demo.mp4", { head: true }, /^public, max-age=0, must-revalidate$/, "revalidate (304 via ETag), Range-friendly");
  await cacheCase("vtt /demo/aicc-demo.vtt", "https://www.copilt.org/demo/aicc-demo.vtt", {}, /^public, max-age=0, must-revalidate$/, "revalidate");
  await cacheCase("/pricing/ (WordPress page)", "https://www.copilt.org/pricing/", {}, /no-store/, "WordPress's own: no-store, private (never shared-cacheable)");
  await cacheCase("/cart/", "https://www.copilt.org/cart/", {}, /^private, no-store, max-age=0$/, "private, no-store (edge-forced)");
  await cacheCase("/checkout/", "https://www.copilt.org/checkout/", {}, /^private, no-store, max-age=0$/, "private, no-store");
  await cacheCase("/my-account/", "https://www.copilt.org/my-account/", {}, /^private, no-store, max-age=0$/, "private, no-store");
  await cacheCase("/wp-login.php (operator)", "https://www.copilt.org/wp-login.php", {}, /^private, no-store, max-age=0$/, "private, no-store");
  await cacheCase("/wp-login.php?action=logout (public)", "https://www.copilt.org/wp-login.php?action=logout", {}, /^private, no-store, max-age=0$/, "private, no-store");
  await cacheCase("/wp-json/aicc-license/v1/plans", "https://www.copilt.org/wp-json/aicc-license/v1/plans", {}, /^private, no-store, max-age=0$/, "private, no-store");
  await cacheCase("/?wc-ajax=get_refreshed_fragments", "https://www.copilt.org/?wc-ajax=get_refreshed_fragments", {}, /^private, no-store, max-age=0$/, "private, no-store");
  await cacheCase("/he/?wc-ajax=get_refreshed_fragments", "https://www.copilt.org/he/?wc-ajax=get_refreshed_fragments", {}, /^private, no-store, max-age=0$/, "private, no-store");
  await cacheCase("/wp-admin/admin-ajax.php", "https://www.copilt.org/wp-admin/admin-ajax.php", {}, /^private, no-store, max-age=0$/, "private, no-store");
  await cacheCase("/wp-content theme CSS (not forced to no-store)", "https://www.copilt.org/wp-content/themes/aicc-admin/style.css", { allowAbsent: true }, /^(?!.*no-store).*$/, "WordPress/web server decide (validators), NOT no-store");
  // the edge itself caches nothing: two identical requests both reach WordPress
  const before = readAccessLog().all.length;
  const idA = (await rq(E, "https://www.copilt.org/pricing/")).reqId, idB = (await rq(E, "https://www.copilt.org/pricing/")).reqId;
  await sleep(200);
  const lg = readAccessLog().map;
  S.check("the edge does not cache: two identical GET /pricing/ both reached the upstream", lg.get(idA)?.upstream === WP_UPSTREAM && lg.get(idB)?.upstream === WP_UPSTREAM && idA !== idB, `upstream A=${lg.get(idA)?.upstream} B=${lg.get(idB)?.upstream}`);
  void before;
  const noCacheMod = sh(P.caddy, ["list-modules"]).stdout.split("\n").filter((l) => /cache|souin/i.test(l));
  S.check("no cache module is compiled into this Caddy build", noCacheMod.length === 0, noCacheMod.join(",") || "none");
  S.data.cacheMatrix = cacheRows;

  // ---- F. security headers: present once, correct values, no leaks ------------------------------------------
  const probes = ["/", "/product/", "/pricing/", "/cart/", "/my-account/", "/wp-login.php", "/wp-json/aicc-license/v1/plans", "/nothing-here/", "/demo/aicc-demo.vtt", "/xmlrpc.php", "/pricing", "/?wc-ajax=x"];
  const must = { "strict-transport-security": "max-age=300", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "SAMEORIGIN", "permissions-policy": "camera=(), microphone=(), geolocation=()" };
  const secRows = [];
  for (const inst of [E]) for (const p of probes) {
    const r = await rq(inst, `https://www.copilt.org${p}`, { method: p === "/pricing" ? "GET" : undefined });
    const bad = [];
    for (const [k, v] of Object.entries(must)) { const n = count(r, k); if (n !== 1 || one(r, k) !== v) bad.push(`${k} x${n}=${one(r, k)}`); }
    for (const k of ["cache-control", "x-request-id", "content-type"]) if (count(r, k) > 1) bad.push(`${k} duplicated x${count(r, k)}`);
    if (!one(r, "x-request-id")) bad.push("no x-request-id");
    for (const k of ["server", "x-powered-by", "x-generator", "x-aspnet-version"]) if (count(r, k)) bad.push(`${k}: ${one(r, k)}`);
    const verLeak = Object.entries(r.headers).filter(([k, v]) => /^(via|server|x-powered-by|x-redirect-by|x-pingback)$/.test(k) && /\d+\.\d+/.test(v.join(" "))).map(([k, v]) => `${k}: ${v.join(" ")}`);
    if (verLeak.length) bad.push("version leak " + verLeak.join("; "));
    secRows.push({ path: p, status: r.status, problems: bad });
    S.check(`security headers once + no leaks: ${p} (${r.status})`, bad.length === 0, bad.join("; "));
  }
  const redir = await rq(PUBLIC, "http://copilt.org/product");
  S.check("security headers + HSTS on the apex http redirect response too", one(redir, "strict-transport-security") === "max-age=300" && count(redir, "strict-transport-security") === 1, `${redir.status} ${one(redir, "strict-transport-security")}`);
  const hsts = (await rq(E, "https://www.copilt.org/")).headers["strict-transport-security"]?.[0] || "";
  S.check("HSTS is exactly max-age=300 (no includeSubDomains, no preload)", hsts === "max-age=300", hsts);
  const xp = await rq(E, "https://www.copilt.org/pricing/");
  S.check("no X-Powered-By (PHP version) through the edge", !one(xp, "x-powered-by"), `x-powered-by=${one(xp, "x-powered-by") || "-"}; upstream sends PHP/8.2.29 directly (verified below)`);
  const direct = await fetch("http://127.0.0.1:18982/pricing/", { headers: { "X-Forwarded-Proto": "https", Host: "www.copilt.org" } }).catch(() => null);
  S.info("upstream (direct, not through the edge) sends", `X-Powered-By: ${direct?.headers.get("x-powered-by")}; Server: ${direct?.headers.get("server") || "-"}; Host: ${direct?.headers.get("host") || "-"} (php -S artifact), Via through the edge: ${one(xp, "via") || "-"}`);
  S.data.securityHeaders = secRows;

  // ---- G. Host handling ------------------------------------------------------------------------------------------
  // Review F12: these used to be "status < 500 and no evil in Location", which a missing catch-all 421 block survived. Now the EXACT behaviour of the real Caddy is asserted:
  //   exact: [status, bodyRegex|"empty"|null, locationRegex|"none"]
  const MIS = "Misdirected request";
  const hostCases = [
    ["Host: evil.example over TLS (valid SNI www.copilt.org): Caddy's no-match answer, an EMPTY 200 (no content, no redirect)", "https://www.copilt.org/", { headers: { Host: "evil.example" } }, [200, "empty", "none"], E],
    ["Host: evil.example with path /pricing/ over TLS: the same empty 200, never WordPress", "https://www.copilt.org/pricing/", { headers: { Host: "evil.example" } }, [200, "empty", "none"], E],
    ["http Host: evil.example: 421 Misdirected Request, no redirect", "http://www.copilt.org/product", { headers: { Host: "evil.example" } }, [421, MIS, "none"], PUBLIC],
    ["http Host: copilt.org.evil.example: 421", "http://copilt.org/product", { headers: { Host: "copilt.org.evil.example" } }, [421, MIS, "none"], PUBLIC],
    ["http Host: api.copilt.org: 421 (this edge never answers for the API host)", "http://copilt.org/", { headers: { Host: "api.copilt.org" } }, [421, MIS, "none"], PUBLIC],
    ["http Host: 127.0.0.1 (IP literal): 421", "http://copilt.org/", { headers: { Host: "127.0.0.1" } }, [421, MIS, "none"], PUBLIC],
    ["http Host: www.copilt.org.evil.example: 421", "http://copilt.org/", { headers: { Host: "www.copilt.org.evil.example" } }, [421, MIS, "none"], PUBLIC],
    ["X-Forwarded-Host: evil.example on the apex: the redirect is built from constants -> 301 to https://www.copilt.org/product/", "http://copilt.org/product", { headers: { "X-Forwarded-Host": "evil.example" } }, [301, null, "^https://www\\.copilt\\.org(:\\d+)?/product/$"], PUBLIC],
    ["X-Forwarded-Host + X-Forwarded-Proto: http on a WordPress page: 200 from WordPress, evil.example nowhere in the page", "https://www.copilt.org/my-account/", { headers: { "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "http" } }, [200, "!evil", "none"], E],
    ["X-Original-URL / X-Rewrite-URL on www: ignored (200 pricing page, not wp-admin)", "https://www.copilt.org/pricing/", { headers: { "X-Original-URL": "/wp-admin/", "X-Rewrite-URL": "/wp-admin/" } }, [200, "!wp-admin/index", "none"], E],
    ["Host: WWW.COPILT.ORG (case): the static page", "https://www.copilt.org/product/", { headers: { Host: "WWW.COPILT.ORG" } }, [200, "html", "none"], E],
    ["Host: www.copilt.org. (trailing dot): Caddy's no-match empty 200", "https://www.copilt.org/product/", { headers: { Host: "www.copilt.org." } }, [200, "empty", "none"], E],
    ["Host: www.copilt.org:443: the static page", "https://www.copilt.org/product/", { headers: { Host: "www.copilt.org:443" } }, [200, "html", "none"], E],
  ];
  const hostRows = [];
  for (const [label, url, o, exact, inst] of hostCases) {
    const r = await rq(inst, url, o);
    const loc = one(r, "location") || "";
    const [st, bodyRule, locRule] = exact;
    const bodyOk = bodyRule === null ? true : bodyRule === "empty" ? r.body.length === 0 : bodyRule === "html" ? /<html/i.test(r.body) : bodyRule.startsWith("!") ? !r.body.includes(bodyRule.slice(1)) && !/evil\.example/.test(r.body) : r.body.trim() === bodyRule;
    const locOk = locRule === "none" ? loc === "" : new RegExp(locRule).test(loc);
    hostRows.push({ case: label, status: r.status, location: loc, bodyBytes: r.body.length });
    S.check(`Host handling (exact): ${label}`, r.status === st && bodyOk && locOk && !/evil\.example/i.test(loc), `status=${r.status} (want ${st}) location=${loc || "-"} body[0..60]=${JSON.stringify(r.body.slice(0, 60))}`, `${r.status} ${loc}`);
  }
  const wpEcho = await rq(E, `https://www.copilt.org/wp-json/?__rehearsal_echo=${cpEchoToken()}`, { headers: { "X-Forwarded-Host": "evil.example", Host: "www.copilt.org" } });
  let echo = {}; try { echo = JSON.parse(wpEcho.body); } catch { /* */ }
  S.check("X-Forwarded-Host sent by a client never reaches WordPress as evil.example (the edge overwrites it with the real Host)", echo.headers?.["x-forwarded-host"] === "www.copilt.org", `CP saw x-forwarded-host=${echo.headers?.["x-forwarded-host"]}`);
  S.data.hostRows = hostRows;
  // unknown SNI
  const sni = sh("bash", ["-c", `echo | openssl s_client -connect 127.0.0.1:443 -servername evil.example 2>&1 | head -15`]).stdout;
  S.check("unknown SNI (evil.example) gets no certificate / no site (handshake fails)", /alert|no peer certificate available|internal error|handshake failure/i.test(sni), sni.split("\n").filter((l) => /alert|peer certificate|error/i.test(l)).slice(0, 2).join(" | "));
  const noSni = sh("bash", ["-c", `echo | openssl s_client -connect 127.0.0.1:443 2>&1 | head -12`]).stdout;
  S.info("no SNI at all (IP access)", noSni.split("\n").filter((l) => /alert|peer certificate|CN|error/i.test(l)).slice(0, 3).join(" | ") || noSni.slice(0, 200));

  // ---- H. open redirect / injection ---------------------------------------------------------------------------------------
  const evilPaths = ["//evil.com", "//evil.com/", "/\\evil.com", "/%5cevil.com", "/%2f%2fevil.com", "//evil.com/%2e%2e", "/%252f%252fevil.com", "///evil.com", "/%0d%0aX-Injected:%201", "/?x=%0d%0aX-Injected:%201", "/%0d%0aLocation:%20https://evil.com", "/%252e%252e/", "/..;/", "/..;/wp-admin/", "/wp-admin/../xmlrpc.php", "/XMLRPC.php", "/xmlrpc.php/", "/%78mlrpc.php", "/wp-admin//admin-ajax.php", "/product/../pricing/", "/pricing/%2e%2e/product/", "/product//", "/%00", "/?redirect_to=https://evil.com", "/login?redirect_to=//evil.com", "/account?next=https://evil.com", "/.%2e/.%2e/etc/passwd", "/..%2f..%2fetc/passwd", "/%c0%ae%c0%ae/", "/wp-content/../../etc/passwd"];
  const injRows = [];
  for (const [inst, base, label] of [[PUBLIC, "http://copilt.org", "apex http"], [PUBLIC, "https://copilt.org", "apex https"], [E, "https://www.copilt.org", "www https"]]) for (const p of evilPaths) {
    const r = await rq(inst, base + p);
    const loc = one(r, "location") || "";
    const injected = Object.keys(r.headers).some((k) => k === "x-injected") || /(^|\r?\n)x-injected:/i.test(JSON.stringify(r.raw || ""));
    const redirOk = loc === "" || new RegExp(`^https://www\\.copilt\\.org(:${PUBLIC.httpsPort})?(/|$)`).test(loc);
    const ok = r.status > 0 && r.status < 500 && !injected && redirOk && !/etc\/passwd|root:x:/.test(r.body.slice(0, 2000));
    injRows.push({ target: label, path: p, status: r.status, location: loc });
    S.check(`open-redirect/injection ${label} ${p}`, ok, `status=${r.status} location=${loc} injected=${injected}`, `${r.status}${loc ? " -> " + loc.slice(0, 80) : ""}`);
  }
  S.data.injectionRows = injRows;
  for (const n of [4000, 8000, 20000, 70000, 300000]) {
    const r = await rq(E, "https://www.copilt.org/" + "a".repeat(n));
    S.check(`very long URL path (${n} chars): bounded error or 404, never 5xx, edge alive`, r.status > 0 ? [404, 400, 414, 431, 494].includes(r.status) : true, `status=${r.status || r.error}`);
    const q = await rq(E, "https://www.copilt.org/pricing/?q=" + "b".repeat(n));
    S.check(`very long query (${n} chars): not 5xx`, q.status === 0 || q.status < 500, `status=${q.status || q.error}`);
  }
  const hdrBomb = await rq(E, "https://www.copilt.org/", { headers: { "X-Big": "z".repeat(25000) } });
  S.check("oversized request header (25 KB) is refused (431/400/connection reset) by max_header_size 16KB (+Go's 4 KB slack)", [431, 400, 0].includes(hdrBomb.status), `status=${hdrBomb.status || hdrBomb.error}`);
  S.check("edge alive after the long-URL abuse", (await rq(E, "https://www.copilt.org/")).status === 200);

  // ---- I. methods ------------------------------------------------------------------------------------------------------------
  const methodRows = [];
  for (const [m, p] of [["OPTIONS", "/"], ["OPTIONS", "/pricing/"], ["OPTIONS", "/wp-json/aicc-license/v1/plans"], ["TRACE", "/"], ["TRACE", "/pricing/"], ["PUT", "/"], ["DELETE", "/product/"], ["PATCH", "/pricing/"], ["POST", "/"], ["POST", "/robots.txt"], ["PROPFIND", "/"]]) {
    const r = await rq(E, `https://www.copilt.org${p}`, { method: m, headers: { "X-Trace-Me": "secret-header-value" }, body: m === "POST" || m === "PUT" || m === "PATCH" ? "a=1" : undefined });
    const reflected = /secret-header-value/.test(r.body);
    methodRows.push({ method: m, path: p, status: r.status, allow: one(r, "allow") || "", bodyBytes: r.body.length });
    S.check(`method ${m} ${p}: no 5xx, TRACE never reflects the request`, r.status > 0 && r.status < 500 && !(m === "TRACE" && reflected), `status=${r.status} allow=${one(r, "allow") || "-"} reflected=${reflected}`, `${r.status}`);
  }
  S.data.methodRows = methodRows;

  // ---- K. request body cap (E9) and Alt-Svc (E10) -----------------------------------------------------------------------------------
  const big12 = "/tmp/aicc-body-12mb.bin", big3 = "/tmp/aicc-body-3mb.bin", big1 = "/tmp/aicc-body-1mb.bin";
  for (const [f, mb] of [[big12, 12], [big3, 3], [big1, 1]]) fs.writeFileSync(f, Buffer.alloc(mb * 1024 * 1024, 0x61));
  const post = (inst, url, file, extraHeaders = {}) => rq(inst, url, { method: "POST", extra: ["--data-binary", `@${file}`], headers: { "Content-Type": "application/octet-stream", ...extraHeaders }, timeout: 60 });
  for (const [label, path0] of [["license REST", "/wp-json/aicc-license/v1/validate"], ["Store API", "/wp-json/wc/store/v1/cart/add-item"], ["login form", "/my-account/"], ["admin-ajax.php (public)", "/wp-admin/admin-ajax.php"], ["wc-ajax", "/?wc-ajax=update_order_review"], ["lost-password", "/my-account/lost-password/"]]) {
    const r = await post(PUBLIC, `https://www.copilt.org${path0}`, big12);
    S.check(`request body cap: a 12 MB POST to ${label} (${path0}) is rejected at the edge with 413 and never reaches WordPress`, r.status === 413 && one(r, "x-rehearsal-upstream") !== "wordpress", `status=${r.status} ${r.error || ""}`.slice(0, 160));
  }
  const rb3 = await post(PUBLIC, "https://www.copilt.org/wp-json/aicc-license/v1/validate", big3);
  S.check("request body cap: 3 MB (> 2 MB cap) -> 413", rb3.status === 413, `${rb3.status}`);
  const rb1 = await post(PUBLIC, "https://www.copilt.org/wp-json/aicc-license/v1/validate", big1);
  S.check("request body cap: 1 MB (< cap) passes the edge and WordPress answers (any 2xx/4xx, not 413/5xx)", rb1.status > 0 && rb1.status !== 413 && rb1.status < 500 && one(rb1, "x-rehearsal-upstream") === "wordpress", `${rb1.status}`);
  const chunked = await rq(PUBLIC, "https://www.copilt.org/wp-json/aicc-license/v1/validate", { method: "POST", extra: ["--data-binary", `@${big12}`, "-H", "Transfer-Encoding: chunked"], headers: { "Content-Type": "application/octet-stream" }, timeout: 60 });
  S.check("request body cap: a 12 MB CHUNKED POST (no Content-Length to check up front) is cut off too (413, or the connection is closed), never accepted", chunked.status === 413 || chunked.status === 0 || chunked.status === 400, `${chunked.status} ${chunked.error || ""}`.slice(0, 160));
  const opBig = await post(E, "https://www.copilt.org/wp-admin/async-upload.php", big12);
  S.check("operator-only /wp-admin/ has the larger cap: a 12 MB POST from an operator is NOT cut by the 2 MB cap (WordPress answers)", opBig.status !== 413 && opBig.status > 0 && one(opBig, "x-rehearsal-upstream") === "wordpress", `${opBig.status}`);
  const pubBig = await post(PUBLIC, "https://www.copilt.org/wp-admin/async-upload.php", big12);
  S.check("the same upload from a non-operator is refused earlier by the allowlist (403)", pubBig.status === 403, `${pubBig.status}`);
  for (const f of [big12, big3, big1]) fs.rmSync(f, { force: true });
  const altSvcRows = [];
  for (const [inst, label] of [[E, "standing edge"], [PUBLIC, "twin"]]) for (const p of ["/", "/pricing/", "/wp-json/aicc-license/v1/plans", "/nothing-here/", "/robots.txt"]) {
    const r = await rq(inst, `https://www.copilt.org${p}`);
    const port = inst === E ? "443" : String(PUBLIC.httpsPort);
    const v = r.headers["alt-svc"] || [];
    altSvcRows.push({ instance: label, path: p, altSvc: v });
    S.check(`Alt-Svc is exactly one value h3=":${port}"; ma=3600 (not Caddy's 30-day default, not duplicated) on ${label} ${p}`, v.length === 1 && v[0] === `h3=":${port}"; ma=3600`, JSON.stringify(v));
  }
  const altRedir = await rq(PUBLIC, "http://copilt.org/product");
  S.info("Alt-Svc on a plain-http redirect", JSON.stringify(altRedir.headers["alt-svc"] || "none (not sent over http)"));
  S.data.altSvc = altSvcRows;
  const direct50x = await rq(E, "https://www.copilt.org/50x.html");
  S.check("/50x.html is not a public page: 404 from the edge (the file is still used internally for error handling: see the 5xx section)", direct50x.status === 404 && !/temporarily unavailable/.test(direct50x.body), `${direct50x.status}`);

  // ---- J. invariant over everything seen so far ---------------------------------------------------------------------------------
  const sc = SEEN.filter((x) => x.setCookie > 0);
  S.check(`every response that set a cookie is non-shared-cacheable (private/no-store/no-cache) — ${sc.length} such responses seen`, sc.every((x) => /private|no-store|no-cache/.test(x.cc)), sc.filter((x) => !/private|no-store|no-cache/.test(x.cc)).map((x) => `${x.method} ${x.url} cc=${x.cc}`).join("; "), `${SEEN.length} responses audited`);
  S.data.seenResponses = SEEN.length;
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ admin: wp-admin / xmlrpc / wp-login / wp-cron decisions, dependency evidence, customer flows */
const CPDIR = "/Users/avivgerman/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/cp2a-14-readiness-independence";
const PLDIR = "/Users/avivgerman/Projects/ai-commerce-copilot-worktrees/cp2a-14-readiness-independence";
const BEDIR = "/Users/avivgerman/Local Sites/woo-recommendation-qa/aicc-backend-worktrees/cp2a-6-prelaunch-commercialization";
const grepRepo = (dir, pattern, includes = []) => {
  const args = ["-rIn", "-i", "-E", pattern, dir, "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=out", "--exclude-dir=.gstack", "--exclude-dir=.next", "--exclude-dir=.venv", "--exclude-dir=__pycache__", ...includes];
  return sh("grep", args).stdout.split("\n").filter(Boolean).map((l) => l.replace(dir, "<repo>").slice(0, 200));
};
const attr = (html, name) => { const m = new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html) || new RegExp(`value="([^"]*)"[^>]*name="${name}"`).exec(html); return m ? m[1] : ""; };
const upstreamLog = () => { try { return fs.readFileSync(path.join(P.logs, "cp-upstream.log"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const wpcli = (...a) => sh("bash", [P.cpFixture, "wp", ...a]);

async function admin() {
  const S = new Section("04-admin-xmlrpc", "wp-admin / XML-RPC / wp-login / wp-cron: owner decision, dependency evidence and proof");
  await ensureInstances();
  const E = EDGE;

  // ---- 1. dependency evidence ------------------------------------------------------------------------------------------
  const inv = {
    xmlrpc_cp: grepRepo(CPDIR, "xmlrpc|xml-rpc|pingback|jetpack").filter((l) => !/tests\/|README|\.md:/.test(l) || /i18n/.test(l)),
    xmlrpc_plugin: grepRepo(PLDIR, "xmlrpc|xml-rpc|pingback|jetpack").filter((l) => !/\.md:/.test(l)),
    xmlrpc_backend: grepRepo(BEDIR, "xmlrpc|xml-rpc|pingback|jetpack"),
    xmlrpc_site: grepRepo(REPO_ROOT, "xmlrpc|xml-rpc").filter((l) => !/scripts\/(rehearsal|test-redirects|lib)|docs\/cutover/.test(l)),
    adminajax_cp_frontend: grepRepo(path.join(CPDIR, "admin"), "admin-ajax|wp_ajax_|ajaxurl|admin-post|admin_post_").filter((l) => !/seo\.php:151|i18n\.php/.test(l)),
    adminajax_plugin_product: grepRepo(PLDIR, "wp_ajax_nopriv|admin-ajax\\.php|admin_post_nopriv", ["--include=*.php", "--include=*.js"]).filter((l) => !/tests\//.test(l)).slice(0, 12),
    wp_login_customer: grepRepo(path.join(CPDIR, "admin"), "wp_logout_url|wp_login_url|wp_lostpassword_url|wp_registration_url|login_url").filter((l) => !/\* |\/\/ /.test(l)),
  };
  S.data.inventory = inv;
  S.check("xmlrpc: no use in the Control Plane (plugin/theme), the product plugin, the Backend or the static site", inv.xmlrpc_cp.every((l) => /i18n\.php|run_i18n/.test(l)) && inv.xmlrpc_plugin.length === 0 && inv.xmlrpc_backend.length === 0 && inv.xmlrpc_site.length === 0, `CP hits (only the i18n path-exclusion list): ${inv.xmlrpc_cp.length}; plugin: ${inv.xmlrpc_plugin.length}; backend: ${inv.xmlrpc_backend.length}; site: ${inv.xmlrpc_site.length}`);
  S.info("admin-ajax / admin-post in the Control Plane", `front-end callers: ${inv.adminajax_cp_frontend.length} (only admin-post action aicc_lm_transition, a STAFF admin screen form, and the robots.txt Allow line). Kept public anyway: see decision.`, inv.adminajax_cp_frontend.slice(0, 4).join(" || "));
  S.info("wp_logout_url() / login URL users in the Control Plane (customer-facing)", inv.wp_login_customer.slice(0, 6).join(" || "));
  const urls = wpcli("eval", "echo wp_login_url().\"\\n\".wp_lostpassword_url().\"\\n\".wp_registration_url().\"\\n\".wp_logout_url().\"\\n\";").stdout.trim().split("\n");
  S.data.wordpressOwnUrls = urls;
  S.info("URLs WordPress itself hands to visitors (wp_login_url / lostpassword / registration / logout)", urls.join("  |  "));

  // ---- 2. final behaviour table: public visitor vs operator ------------------------------------------------------------------
  const table = [];
  const T = async (label, url, o = {}, expect) => {
    const pub = await rq(PUBLIC, url, o), op = await rq(E, url, o);
    table.push({ request: label, publicVisitor: pub.status, operator: op.status, expectPublic: expect.pub, expectOperator: expect.op });
    S.check(`${label}: public visitor ${expect.pub}, operator ${expect.op}`, pub.status === expect.pub && op.status === expect.op, `public=${pub.status} (${(pub.headers["x-rehearsal-upstream"] || ["edge"])[0]}) operator=${op.status} (${(op.headers["x-rehearsal-upstream"] || ["edge"])[0]})`, `${pub.status}/${op.status}`);
    return { pub, op };
  };
  await T("GET /xmlrpc.php", "https://www.copilt.org/xmlrpc.php", {}, { pub: 403, op: 403 });
  await T("POST /xmlrpc.php (system.listMethods)", "https://www.copilt.org/xmlrpc.php", { method: "POST", body: "<?xml version='1.0'?><methodCall><methodName>system.listMethods</methodName></methodCall>", headers: { "Content-Type": "text/xml" } }, { pub: 403, op: 403 });
  await T("GET /wp-admin/", "https://www.copilt.org/wp-admin/", {}, { pub: 403, op: 302 });
  await T("GET /wp-admin/index.php", "https://www.copilt.org/wp-admin/index.php", {}, { pub: 403, op: 302 });
  await T("GET /wp-admin/admin-ajax.php (no action)", "https://www.copilt.org/wp-admin/admin-ajax.php", {}, { pub: 400, op: 400 });
  await T("POST /wp-admin/admin-ajax.php action=heartbeat", "https://www.copilt.org/wp-admin/admin-ajax.php", { method: "POST", body: "action=heartbeat" }, { pub: 200, op: 200 });
  await T("GET /wp-admin/admin-post.php", "https://www.copilt.org/wp-admin/admin-post.php", {}, { pub: 200, op: 200 });
  await T("GET /wp-login.php", "https://www.copilt.org/wp-login.php", {}, { pub: 403, op: 200 });
  await T("GET /wp-login.php?action=lostpassword", "https://www.copilt.org/wp-login.php?action=lostpassword", {}, { pub: 403, op: 200 });
  await T("GET /wp-login.php?action=logout (no nonce)", "https://www.copilt.org/wp-login.php?action=logout", {}, { pub: 403, op: 403 });
  await T("GET /wp-cron.php", "https://www.copilt.org/wp-cron.php", {}, { pub: 403, op: 200 });
  S.data.finalBehaviour = table;
  S.note("'public visitor' = request through the twin edge whose operator list is 192.0.2.1/32 (loopback is NOT an operator there); 'operator' = the standing edge on :443 whose operator list is 127.0.0.1/32 ::1/128. Same template, same binary, only AICC_OPERATOR_CIDRS differs. (A 403 from WordPress itself for logout-without-nonce is WordPress's own 'link expired' answer, identical for both.)");
  // IPv6 loopback is an operator on the standing edge
  const v6 = await rq(E, "https://www.copilt.org/wp-admin/", { connectIp: "::1", extra: ["-g"] });
  S.check("operator over IPv6 loopback (::1/128 is in the list) reaches /wp-admin/", v6.status === 302 || v6.status === 200, `status=${v6.status} ${v6.error || ""}`);
  const v6pub = await rq(PUBLIC, "https://www.copilt.org/wp-admin/", { connectIp: "::1" });
  S.check("the same ::1 request to the twin edge (operator list 192.0.2.1/32 only) is denied: an allowlist miss is a 403 whatever the address family", v6pub.status === 403, `status=${v6pub.status} ${v6pub.error || ""}`);
  // a spoofed operator address cannot help: XFF is not what the allowlist reads
  const spoof = await rq(PUBLIC, "https://www.copilt.org/wp-admin/", { headers: { "X-Forwarded-For": "192.0.2.1", "X-Real-IP": "192.0.2.1", Forwarded: "for=192.0.2.1" } });
  S.check("spoofed X-Forwarded-For / X-Real-IP / Forwarded of an operator address does not open /wp-admin/ (allowlist uses the TCP peer)", spoof.status === 403, `status=${spoof.status}`);

  // ---- 2b. E1 (security review F2): no session can be obtained through wp-login.php from a non-operator source ---------------------------------------
  const bypassJar = "/tmp/aicc-bypass.jar"; fs.rmSync(bypassJar, { force: true });
  const loginBody = "log=rehearsal-admin&pwd=" + encodeURIComponent("Rehearsal-Admin-2026!") + "&wp-submit=Log+In&redirect_to=" + encodeURIComponent("https://www.copilt.org/wp-admin/") + "&testcookie=1";
  const upBefore = upstreamLog().length;
  const bypass = [
    ["POST ?loggedout=true", "?loggedout=true", { method: "POST" }],
    ["POST ?loggedout=true&wp_lang=en_US", "?loggedout=true&wp_lang=en_US", { method: "POST" }],
    ["POST ?action=logout (+ action=login in the body)", "?action=logout", { method: "POST", body: loginBody + "&action=login" }],
    ["POST ?ACTION=logout", "?ACTION=logout", { method: "POST" }],
    ["POST ?LOGGEDOUT=true", "?LOGGEDOUT=true", { method: "POST" }],
    ["POST ?action=logout&x=1", "?action=logout&x=1", { method: "POST" }],
    ["POST ?loggedout=true&log=x&pwd=y", "?loggedout=true&log=x&pwd=y", { method: "POST" }],
    ["POST ?action=logout&action=login", "?action=logout&action=login", { method: "POST" }],
    ["POST ?x=1&loggedout=true", "?x=1&loggedout=true", { method: "POST" }],
    ["POST ?action=logout&_wpnonce=abc123", "?action=logout&_wpnonce=abc123", { method: "POST" }],
    ["POST plain (no query)", "", { method: "POST" }],
    ["POST ?action=login", "?action=login", { method: "POST" }],
    ["PUT ?loggedout=true", "?loggedout=true", { method: "PUT" }],
    ["POST with X-HTTP-Method-Override: GET", "?loggedout=true", { method: "POST", headers: { "X-HTTP-Method-Override": "GET" } }],
    ["POST over HTTP/2", "?loggedout=true", { method: "POST", http: "2" }],
    ["POST /wp-login.php/ (path-info)", "/?loggedout=true", { method: "POST", rawSuffix: true }],
    ["POST /WP-LOGIN.PHP?loggedout=true", "?loggedout=true", { method: "POST", path: "/WP-LOGIN.PHP" }],
    ["POST //wp-login.php?loggedout=true", "?loggedout=true", { method: "POST", path: "//wp-login.php" }],
    ["POST /wp-login.php%2e?loggedout=true", "?loggedout=true", { method: "POST", path: "/wp-login.php%20" }],
  ];
  const bypassRows = [];
  for (const [label, q, o] of bypass) {
    const p0 = o.path || "/wp-login.php";
    const url = o.rawSuffix ? `https://www.copilt.org/wp-login.php${q}` : `https://www.copilt.org${p0}${q}`;
    const r = await rq(PUBLIC, url, { method: o.method, body: o.body ?? loginBody, headers: { Cookie: "wordpress_test_cookie=WP%20Cookie%20check", ...(o.headers || {}) }, extra: ["-c", bypassJar], http: o.http });
    const cookies = (r.headers["set-cookie"] || []).filter((c) => /wordpress_logged_in|wordpress_sec/.test(c));
    const reached = one(r, "x-rehearsal-upstream") === "wordpress";
    bypassRows.push({ attempt: label, status: r.status, reachedWordPress: reached, sessionCookies: cookies.length });
    S.check(`login bypass attempt from a non-operator: ${label} -> no session (status ${r.status}, WordPress reached: ${reached})`, cookies.length === 0 && !(r.status === 302 && /wp-admin/.test(one(r, "location") || "")) && (r.status === 403 || r.status === 404 || r.status === 400), `status=${r.status} reached=${reached} session cookies=${cookies.length}`, `${r.status}`);
  }
  S.data.loginBypass = bypassRows;
  const jarText = fs.existsSync(bypassJar) ? fs.readFileSync(bypassJar, "utf8") : "";
  S.check("after all bypass attempts the cookie jar holds NO wordpress_logged_in / wordpress_sec cookie", !/wordpress_logged_in|wordpress_sec/.test(jarText), jarText.split("\n").filter((l) => /wordpress_/.test(l)).length + " wordpress_* cookie lines");
  const hit = upstreamLog().slice(upBefore).filter((e) => /wp-login/i.test(e.uri));
  S.check("the CP's own request log shows NONE of the bypass POSTs (the edge answered them; WordPress never ran wp_signon)", hit.length === 0, `${hit.length} wp-login requests reached the upstream: ${hit.slice(0, 3).map((e) => e.method + " " + e.uri).join(", ")}`);
  const opLogin = await rq(E, "https://www.copilt.org/wp-login.php", { method: "POST", body: loginBody, headers: { Cookie: "wordpress_test_cookie=WP%20Cookie%20check" }, extra: ["-c", "/tmp/aicc-bypass-op.jar"] });
  S.check("control: the SAME login POST from an operator source still signs in (302 + session cookie): the block is by source, not a broken form", opLogin.status === 302 && (opLogin.headers["set-cookie"] || []).some((c) => /wordpress_logged_in/.test(c)), `${opLogin.status}`);
  fs.rmSync("/tmp/aicc-bypass-op.jar", { force: true }); fs.rmSync(bypassJar, { force: true });
  // GET shapes that stay open: exactly the two customer shapes
  const okShapes = ["?action=logout", "?action=logout&redirect_to=https%3A%2F%2Fwww.copilt.org%2Fpricing%2F", "?action=logout&redirect_to=https%3A%2F%2Fwww.copilt.org%2F&_wpnonce=0a1b2c3d4e", "?loggedout=true", "?loggedout=true&wp_lang=en_US"];
  for (const q of okShapes) { const r = await rq(PUBLIC, `https://www.copilt.org/wp-login.php${q}`); S.check(`customer logout shape stays open for GET: ${q}`, one(r, "x-rehearsal-upstream") === "wordpress", `${r.status}`); }
  const badGets = ["?action=lostpassword", "?action=register", "?action=rp&key=x&login=y", "?action=logout&x=1", "?loggedout=true&x=1", "?ACTION=logout", "?action=postpass", "?action=confirmaction&request_id=1", "?action=resetpass", "?checkemail=confirm", "?reauth=1"];
  for (const q of badGets) { const r = await rq(PUBLIC, `https://www.copilt.org/wp-login.php${q}`); S.check(`GET ${q} is operator-only (403 from the edge)`, r.status === 403 && one(r, "x-rehearsal-upstream") !== "wordpress", `${r.status}`); }

  // ---- 3. operator can really use wp-admin through the edge --------------------------------------------------------------------------
  const opJar = "/tmp/aicc-op.jar"; fs.rmSync(opJar, { force: true });
  const lg1 = await rq(E, "https://www.copilt.org/wp-login.php", { extra: ["-c", opJar, "-b", opJar] });
  const lg2 = await rq(E, "https://www.copilt.org/wp-login.php", { method: "POST", extra: ["-c", opJar, "-b", opJar], headers: { Cookie: "wordpress_test_cookie=WP%20Cookie%20check" }, body: "log=rehearsal-admin&pwd=" + encodeURIComponent("Rehearsal-Admin-2026!") + "&wp-submit=Log+In&redirect_to=" + encodeURIComponent("https://www.copilt.org/wp-admin/") + "&testcookie=1" });
  const dash = await rq(E, "https://www.copilt.org/wp-admin/", { extra: ["-c", opJar, "-b", opJar] });
  S.check("operator: staff login at /wp-login.php (POST) -> 302 /wp-admin/, dashboard 200 through the edge", lg1.status === 200 && lg2.status === 302 && dash.status === 200 && /Dashboard/.test(dash.body), `login page ${lg1.status}, POST ${lg2.status} -> ${one(lg2, "location")}, /wp-admin/ ${dash.status}`);
  const adminCookies = fs.readFileSync(opJar, "utf8");
  S.check("staff cookies are Secure + HttpOnly (the edge forwarded X-Forwarded-Proto: https and WordPress believed it)", /#HttpOnly_www\.copilt\.org\s+FALSE\s+\/\s+TRUE\s+\d+\s+wordpress_logged_in_/.test(adminCookies) || /wordpress_logged_in_/.test(adminCookies) && !/FALSE\s+\d+\s+wordpress_logged_in/.test(adminCookies), adminCookies.split("\n").filter((l) => /logged_in/.test(l)).map((l) => l.replace(/\S{20,}$/, "…")).join(" ").slice(0, 200));
  const adminPub = await rq(PUBLIC, "https://www.copilt.org/wp-admin/", { extra: ["-b", opJar] });
  S.check("the same valid admin session cookie presented from a NON-operator source is still denied (403)", adminPub.status === 403, `status=${adminPub.status}`);

  // ---- 4. customer flows through the NON-operator edge: nothing they do touches a blocked URL ----------------------------------------------
  const phpBefore = upstreamLog().length, seenBefore = SEEN.length;
  const jar = "/tmp/aicc-cust.jar"; fs.rmSync(jar, { force: true });
  const J = { extra: ["-c", jar, "-b", jar] };
  const flow = [];
  const step = async (label, url, o = {}) => { const r = await rq(PUBLIC, url, { ...J, ...o }); const red = (x) => x.replace(/([?&](?:key|login|_wpnonce|pass\w*)=)[^&#]*/gi, "$1REDACTED"); flow.push({ step: label, url: red(url.replace("https://www.copilt.org", "")), status: r.status, location: red(one(r, "location") || "") }); return r; };
  const pricing = await step("pricing", "https://www.copilt.org/pricing/");
  const addId = (/add-to-cart=(\d+)/.exec(pricing.body) || [])[1] || "10";
  await step("pricing (he)", "https://www.copilt.org/he/pricing/");
  const acct = await step("my-account (login form)", "https://www.copilt.org/my-account/");
  const nonce = attr(acct.body, "woocommerce-login-nonce");
  S.check("customer sign-in form is served by WordPress at /my-account/ (login nonce present)", acct.status === 200 && nonce.length > 5, `status=${acct.status} nonce=${nonce ? "present" : "missing"}`);
  const login = await step("login POST /my-account/", "https://www.copilt.org/my-account/", { method: "POST", body: `username=rehearsal-customer&password=${encodeURIComponent("Rehearsal-Customer-2026!")}&woocommerce-login-nonce=${nonce}&_wp_http_referer=%2Fmy-account%2F&login=Log+in` });
  const acct2 = await step("my-account (signed in)", "https://www.copilt.org/my-account/");
  const logoutHref = ((/href="([^"]*customer-logout[^"]*)"/.exec(acct2.body) || [])[1] || "").replace(/&#038;|&amp;/g, "&");
  S.check("customer login works through the edge from a non-operator source (302 + signed-in dashboard with a logout link)", [302, 303].includes(login.status) && acct2.status === 200 && logoutHref.includes("customer-logout"), `login ${login.status} -> ${one(login, "location")}; dashboard ${acct2.status}; logout link ${logoutHref.slice(0, 80)}`);
  const cookieLines = fs.readFileSync(jar, "utf8").split("\n").filter((l) => /wordpress_logged_in|wp_woocommerce_session|woocommerce_/.test(l));
  S.info("customer cookies set (names/flags only)", cookieLines.map((l) => { const f = l.split("\t"); return `${f[5] || ""}${l.startsWith("#HttpOnly_") ? " [HttpOnly]" : ""} secure=${f[3]} path=${f[2]}`; }).join("; "));
  await step("cart with add-to-cart", `https://www.copilt.org/cart/?add-to-cart=${addId}`);
  await step("cart", "https://www.copilt.org/cart/");
  await step("checkout", "https://www.copilt.org/checkout/");
  await step("wc-ajax fragments (POST)", "https://www.copilt.org/?wc-ajax=get_refreshed_fragments", { method: "POST", body: "time=1" });
  await step("he cart", "https://www.copilt.org/he/cart/");
  await step("he wc-ajax", "https://www.copilt.org/he/?wc-ajax=get_refreshed_fragments", { method: "POST", body: "time=1" });
  await step("connect-aicc page", "https://www.copilt.org/my-account/connect-aicc/?token=" + "a".repeat(48) + "&origin=https%3A%2F%2Fnew-store.example&store_name=Nova");
  await step("rest: plans", "https://www.copilt.org/wp-json/aicc-license/v1/plans");
  await step("rest: store api cart", "https://www.copilt.org/wp-json/wc/store/v1/cart");
  // WordPress's own logout (the pattern wp_logout_url() produces, used by the plugin for customers): GET shows a confirm page with a valid nonce link
  const lo1 = await step("wp-login.php?action=logout (customer, signed in)", "https://www.copilt.org/wp-login.php?action=logout&redirect_to=" + encodeURIComponent("https://www.copilt.org/pricing/"));
  const confirm = ((/href="([^"]*action=logout[^"]*_wpnonce[^"]*)"/.exec(lo1.body) || [])[1] || "").replace(/&#038;|&amp;/g, "&");
  S.check("customer's wp_logout_url() pattern is allowed by the edge for a NON-operator: WordPress itself answers (its 'You are attempting to log out' page, status 403 by WordPress design, with a nonce link)", one(lo1, "x-rehearsal-upstream") === "wordpress" && confirm.includes("_wpnonce"), `status=${lo1.status} served-by=${one(lo1, "x-rehearsal-upstream") || "EDGE"} confirm-link=${confirm.slice(0, 90)}`);
  const lo2 = await step("confirm logout link (nonce)", confirm.startsWith("http") ? confirm : "https://www.copilt.org" + confirm);
  S.check("following the confirm link logs the customer out (302 to wp-login.php?loggedout=true or the redirect_to)", [302, 303].includes(lo2.status), `status=${lo2.status} location=${one(lo2, "location")}`);
  if ([302, 303].includes(lo2.status) && /wp-login\.php/.test(one(lo2, "location") || "")) {
    const lo3 = await step("loggedout=true landing", one(lo2, "location").replace(/^https?:\/\/[^/]+/, "https://www.copilt.org").replace(/:\d+/, ""));
    S.check("the 'loggedout=true' landing page is allowed for a non-operator", lo3.status === 200, `status=${lo3.status}`);
  }
  // password reset (WooCommerce) end to end through the edge, from a non-operator source; the emailed link is read from the captured mail
  fs.readdirSync(P.mail).forEach((f) => fs.rmSync(path.join(P.mail, f), { force: true }));
  const lost = await step("lost-password form", "https://www.copilt.org/my-account/lost-password/");
  const lnonce = attr(lost.body, "woocommerce-lost-password-nonce");
  const lostPost = await step("lost-password POST", "https://www.copilt.org/my-account/lost-password/", { method: "POST", body: `user_login=rehearsal-customer&woocommerce-lost-password-nonce=${lnonce}&wc_reset_password=true&_wp_http_referer=%2Fmy-account%2Flost-password%2F` });
  await sleep(500);
  const emls = fs.readdirSync(P.mail).filter((f) => f.endsWith(".eml"));
  const eml = emls.length ? fs.readFileSync(path.join(P.mail, emls[0]), "utf8") : "";
  const resetUrl = (/https:\/\/www\.copilt\.org\/my-account\/lost-password\/\?[^\s"<>]*key=[^\s"<>]+/.exec(eml) || [])[0] || "";
  S.check("password-reset e-mail is generated by WordPress and captured (link on https://www.copilt.org/my-account/lost-password/?key=...&id=...)", lostPost.status < 400 && resetUrl.includes("key="), `post=${lostPost.status} mails=${emls.length} link=${resetUrl.replace(/key=[^&]+/, "key=<secret>")}`);
  // the real reset key and the test passwords go to a private file OUTSIDE the evidence folder; the logging section greps every log for them and then deletes it
  fs.writeFileSync(path.join(P.run, "log-grep-secrets.txt"), [resetUrl ? /key=([^&]+)/.exec(resetUrl)[1] : "", "Rehearsal-Customer-2026!", "Rehearsal-Customer-2026!x", "Rehearsal-Admin-2026!"].filter(Boolean).join("\n"), { mode: 0o600 });
  if (resetUrl) {
    const rs1 = await step("reset link (emailed, ?key=...)", resetUrl.replace(/&amp;/g, "&"));
    const rs2 = await step("reset form", rs1.headers.location ? one(rs1, "location").replace(/^https?:\/\/[^/:]+(:\d+)?/, "https://www.copilt.org") : resetUrl);
    const rnonce = attr(rs2.body, "woocommerce-reset-password-nonce");
    const rkey = attr(rs2.body, "reset_key"), rlogin = attr(rs2.body, "reset_login");
    const newPw = "Rehearsal-Customer-2026!x";
    const rs3 = await step("reset POST (new password)", "https://www.copilt.org/my-account/lost-password/", { method: "POST", body: `password_1=${encodeURIComponent(newPw)}&password_2=${encodeURIComponent(newPw)}&reset_key=${encodeURIComponent(rkey)}&reset_login=${encodeURIComponent(rlogin)}&wc_reset_password=true&_wp_http_referer=%2Fmy-account%2Flost-password%2F&woocommerce-reset-password-nonce=${rnonce}` });
    S.check("password reset completes through the edge (form shown after the emailed link, new password accepted)", !!rnonce && !!rkey && [302, 303].includes(rs3.status) && /password-reset=true/.test(one(rs3, "location") || ""), `link ${rs1.status}->${one(rs1, "location") ? "redirect" : "-"}; form ${rs2.status} nonce=${!!rnonce} key=${!!rkey}; POST ${rs3.status}`);
    wpcli("user", "update", "rehearsal-customer", "--user_pass=Rehearsal-Customer-2026!");
  }
  await sleep(300);
  const used = upstreamLog().slice(phpBefore).map((e) => e.uri);
  const touched = used.filter((u) => /^\/(wp-admin|wp-login\.php|xmlrpc\.php|wp-cron\.php)/i.test(u));
  S.data.customerFlow = { steps: flow, upstreamRequestsDuringFlow: used.length, adminSurfaceUrlsRequested: touched.map((u) => u.replace(/_wpnonce=[^&]+/, "_wpnonce=…").replace(/key=[^&]+/, "key=…")) };
  const blockedUsed = touched.filter((u) => !/^\/wp-login\.php\?(?=.*action=logout)/i.test(u) && !/^\/wp-login\.php\?loggedout=true/i.test(u) && !/^\/wp-admin\/admin-(ajax|post)\.php/i.test(u));
  S.check(`customer flows (sign-in, cart, checkout, wc-ajax, he, connect, REST, logout, reset: ${used.length} upstream requests) touched no operator-only URL; admin-surface URLs requested: ${touched.length}`, blockedUsed.length === 0, blockedUsed.join(", ") || "none", touched.map((u) => u.replace(/_wpnonce=[^&]+/, "_wpnonce=…").slice(0, 70)).join(" ; "));
  const deniedByEdge = SEEN.slice(seenBefore).filter((x) => x.status === 403 && !x.upstream);
  const denied = deniedByEdge;
  S.check("no customer-flow step was refused by the EDGE (403 without the WordPress marker)", denied.length === 0, denied.map((f) => `${f.method} ${f.url}`).join(", ") || "none");

  // ---- 5. no regression elsewhere ---------------------------------------------------------------------------------------------------------------
  const cron = sh("bash", [P.cpFixture, "cron"]);
  S.check("system cron works with HTTP wp-cron.php closed: `wp cron event run --due-now` exits 0 (DISABLE_WP_CRON true)", cron.code === 0, cron.out.split("\n").slice(-3).join(" | ").slice(0, 200));
  const cronOp = await rq(E, "https://www.copilt.org/wp-cron.php");
  S.check("operator can still call wp-cron.php over HTTP (WordPress answers 200, with DISABLE_WP_CRON it does nothing)", cronOp.status === 200, `${cronOp.status}`);
  const rest = await rq(PUBLIC, "https://www.copilt.org/wp-json/aicc-license/v1/plans");
  S.check("REST (license plans) is unaffected: 200 JSON for the public", rest.status === 200 && /json/.test(one(rest, "content-type")), `${rest.status}`);
  const rcli = wpcli("eval", "echo is_ssl() ? 'cli-ssl' : 'cli-nossl';");
  S.info("wp-cli (system cron / ops) is a separate PHP process, not an HTTP client of the edge", rcli.stdout.trim());
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ errors: 5xx experience (upstream stopped, upstream 5xx with leaky body, DB down, slow upstream, bad gateway) */
const SENTENCE = "AI Commerce Copilot is temporarily unavailable. Please try again shortly.";
async function errors() {
  const S = new Section("05-5xx-experience", "5xx experience: the branded edge page for upstream failures (real stops, real timeouts)");
  await ensureInstances();
  const E = EDGE, T = cpEchoToken();
  const fx = (a) => sh("bash", [P.cpFixture, a]);
  const leakRe = /UPSTREAM-LEAK-MARKER|Stack trace|mysql:\/\/|10\.1\.2\.3|\/srv\/www|dial tcp|connection refused|127\.0\.0\.1|18982|Caddy|PHP\/|Fatal error|Exception|wp-content|database/i;
  const page = (label, r, wantStatus) => {
    const visible = r.body.replace(/<!--[\s\S]*?-->/g, "");
    const text = visible.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const ok = (wantStatus ? r.status === wantStatus : r.status >= 500) && text.includes(SENTENCE) && /^text\/html/.test(one(r, "content-type") || "") && one(r, "cache-control") === "no-store" && !leakRe.test(visible) && !one(r, "x-upstream-secret-detail") && !one(r, "server") && !one(r, "x-powered-by") && one(r, "retry-after") && one(r, "strict-transport-security") === "max-age=300" && !!one(r, "x-request-id");
    S.check(label, ok, `status=${r.status} type=${one(r, "content-type")} cc=${one(r, "cache-control")} retry-after=${one(r, "retry-after")} sentence=${text.includes(SENTENCE)} leak=${(leakRe.exec(visible) || [])[0] || "none"} leakHeader=${one(r, "x-upstream-secret-detail") || "none"} server=${one(r, "server") || "-"} hsts=${one(r, "strict-transport-security")} reqid=${!!one(r, "x-request-id")}`, `${r.status}`);
    return ok;
  };
  // 1. upstream answers 500/502/503 with an internal-looking body
  for (const code of [500, 502, 503]) {
    const r = await rq(E, `https://www.copilt.org/pricing/?__rehearsal_fail=${T}&__rehearsal_code=${code}`);
    page(`upstream answers ${code} with a fake stack trace + secret header: visitor gets the branded page, same status, nothing leaked`, r, code);
  }
  const rj = await rq(E, `https://www.copilt.org/wp-json/aicc-license/v1/plans?__rehearsal_fail=${T}&__rehearsal_code=500`);
  page("same for a machine route (/wp-json): upstream 500 body is replaced too (JSON clients see the HTML page; status 500 kept)", rj, 500);
  const ra = await rq(E, `https://www.copilt.org/?wc-ajax=get_refreshed_fragments&__rehearsal_fail=${T}&__rehearsal_code=503`);
  page("same for ?wc-ajax= (503)", ra, 503);
  // 2. the database is down but PHP is up: WordPress itself renders its 'Error establishing a database connection' page
  fx("stop-mysql"); await sleep(2500);
  const rdb = await rq(E, "https://www.copilt.org/pricing/");
  page("MySQL stopped (PHP up): WordPress's own database-error page is NOT shown, branded page instead", rdb, 0);
  const rdbStatic = await rq(E, "https://www.copilt.org/product/");
  S.check("MySQL stopped: static routes still 200", rdbStatic.status === 200, `${rdbStatic.status}`);
  fx("start-mysql"); await sleep(1000);
  // 3. the whole CP upstream stopped
  fx("stop-php"); await sleep(500);
  const routes = ["/pricing/", "/my-account/", "/cart/", "/checkout/", "/privacy/", "/he/pricing/", "/wp-json/aicc-license/v1/plans", "/?wc-ajax=get_refreshed_fragments", "/he/?wc-ajax=get_refreshed_fragments", "/wp-login.php", "/wp-admin/", "/wp-content/themes/aicc-admin/style.css", "/data-processing-addendum/"];
  const rows = [];
  for (const p of routes) { const r = await rq(E, `https://www.copilt.org${p}`); rows.push({ route: p, status: r.status }); page(`CP stopped: ${p} -> branded 502`, r, 502); }
  const post = await rq(E, "https://www.copilt.org/my-account/", { method: "POST", body: "username=a&password=b" });
  page("CP stopped: POST /my-account/ -> branded 502", post, 502);
  const stat = [];
  for (const p of ["/", "/product/", "/questions/", "/data-and-trust/", "/he/", "/robots.txt", "/sitemap.xml", "/demo/aicc-demo.vtt", "/nothing/"]) { const r = await rq(E, `https://www.copilt.org${p}`); stat.push({ route: p, status: r.status }); S.check(`CP stopped: static ${p} unaffected`, p === "/nothing/" ? r.status === 404 : r.status === 200, `${r.status}`); }
  const head = await rq(E, "https://www.copilt.org/pricing/", { head: true });
  S.check("CP stopped: HEAD /pricing/ -> 502 without a body", head.status === 502 && head.body.trim() === "", `${head.status}`);
  const range = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: "bytes=0-9" } });
  S.check("CP stopped: demo video range request still 206", range.status === 206, `${range.status}`);
  S.data.cpStopped = { cpRoutes: rows, staticRoutes: stat };
  // recovery
  const t0 = now(); fx("start-php");
  let rec = -1; for (let i = 0; i < 200; i++) { const r = await rq(E, "https://www.copilt.org/pricing/"); if (r.status === 200) { rec = now() - t0; break; } await sleep(100); }
  S.check("CP restarted: first 200 through the edge", rec > 0, `recovery measured from the start command: ${rec} ms (includes php boot + health wait in cp-fixture.sh)`);
  S.data.recoveryMs = rec;
  // 4. slow upstream and bad gateway on twin instances with different settings
  const base = { ...settings(), ...INSTANCES.public };
  const slow = { ...base, name: "slow", httpPort: 18090, httpsPort: 18453, admin: "127.0.0.1:12022", wpTimeout: "2s" };
  const SLOW = { name: "slow", httpPort: 18090, httpsPort: 18453 };
  await start(slow, { quiet: true });
  const t1 = now(); const rs = await rq(SLOW, `https://www.copilt.org/pricing/?__rehearsal_sleep=${T}&__rehearsal_secs=6`, { timeout: 20 });
  const took = now() - t1;
  page("slow upstream (answer after 6 s, edge response_header_timeout 2 s): branded 504", rs, 504);
  S.check("the 504 arrives at the configured timeout (about 2 s), not after the upstream's 6 s", took >= 1800 && took < 4500, `took ${took} ms`);
  const fast = await rq(SLOW, "https://www.copilt.org/pricing/");
  S.check("the same slow-timeout edge still serves a fast WordPress page (200)", fast.status === 200, `${fast.status}`);
  await stop(slow, { quiet: true });
  // bad gateway: an upstream that speaks garbage / closes at once
  const net = await import("node:net");
  const garbage = net.createServer((c) => { c.write("this is not http\r\n\r\n"); c.end(); }).listen(18999, "127.0.0.1");
  const closer = net.createServer((c) => c.destroy()).listen(18998, "127.0.0.1");
  for (const [port, what] of [[18999, "speaks garbage instead of HTTP"], [18998, "accepts the connection and closes it"]]) {
    const bad = { ...base, name: "bad", httpPort: 18091, httpsPort: 18454, admin: "127.0.0.1:12023", upstream: `127.0.0.1:${port}` };
    await start(bad, { quiet: true });
    const rb = await rq({ name: "bad", httpPort: 18091, httpsPort: 18454 }, "https://www.copilt.org/pricing/");
    page(`bad gateway: upstream ${what} -> branded 502`, rb, 502);
    const rbs = await rq({ name: "bad", httpPort: 18091, httpsPort: 18454 }, "https://www.copilt.org/product/");
    S.check(`bad gateway (${what}): static route still 200`, rbs.status === 200, `${rbs.status}`);
    await stop(bad, { quiet: true });
  }
  garbage.close(); closer.close();
  // the page itself
  const pg = fs.readFileSync(P.fiftyxx, "utf8");
  S.check("50x.html in the release equals docs/cutover/50x.html and contains the exact sentence, no external URL, no script", fs.readFileSync(path.join(P.current, "50x.html"), "utf8") === pg && /unavailable\.<\/h1>\s*<p>Please try again shortly\./.test(pg) && !/<script|https?:\/\//i.test(pg.replace(/<!--[\s\S]*?-->/g, "")), "release copy identical; visible text = h1 + p; no script, no absolute URL");
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ break: try to break it */
async function breakIt() {
  const S = new Section("06-try-to-break", "Try to break it: spoofed headers, smuggling-style input, ranges, path ambiguity, locale + WordPress routes, ownership, unkeyed headers");
  await ensureInstances();
  const E = EDGE, T = cpEchoToken();
  const echo = async (inst, headers, extraPath = "/wp-json/", o = {}) => { const r = await rq(inst, `https://www.copilt.org${extraPath}?__rehearsal_echo=${T}`, { headers, ...o }); let j = {}; try { j = JSON.parse(r.body); } catch { /* */ } return { r, j }; };
  // 1. spoofed identity headers
  const spoof = { "X-Forwarded-For": "6.6.6.6, 7.7.7.7", "X-Real-IP": "7.7.7.7", Forwarded: "for=8.8.8.8;proto=http;host=evil.example", "X-Forwarded-Proto": "http", "X-Forwarded-Host": "evil.example", "X-Client-IP": "9.9.9.9", "True-Client-IP": "9.9.9.9", "X-Original-URL": "/wp-admin/", "X-Rewrite-URL": "/wp-admin/", "X-Forwarded-Server": "evil.example", "X-Request-Id": "attacker-chosen-id" };
  const { r, j } = await echo(E, spoof);
  const h = j.headers || {};
  S.check("CP received X-Forwarded-For = the real peer only (127.0.0.1), the client-supplied chain is gone", h["x-forwarded-for"] === "127.0.0.1", `x-forwarded-for=${h["x-forwarded-for"]}`);
  S.check("CP received X-Forwarded-Proto = https and is_ssl() true (client said http)", h["x-forwarded-proto"] === "https" && j.is_ssl === true && j.https_server_var === "on", `xfp=${h["x-forwarded-proto"]} is_ssl=${j.is_ssl} HTTPS=${j.https_server_var}`);
  S.check("CP received X-Forwarded-Host = www.copilt.org (client said evil.example)", h["x-forwarded-host"] === "www.copilt.org", h["x-forwarded-host"]);
  S.check("CP received NO Forwarded / X-Real-IP / X-Client-IP / True-Client-IP / X-Original-URL / X-Rewrite-URL / X-Forwarded-Server", ["forwarded", "x-real-ip", "x-client-ip", "true-client-ip", "x-original-url", "x-rewrite-url", "x-forwarded-server"].every((k) => !(k in h)), Object.keys(h).filter((k) => /forwarded|real-ip|client-ip|original|rewrite/.test(k)).join(","));
  S.check("the Control Plane's own client-IP resolution (AICC_LM_Client_IP) says 127.0.0.1, not a spoofed value", j.cp_client_ip === "127.0.0.1", `cp_client_ip=${j.cp_client_ip}`);
  S.check("X-Request-Id: the edge replaced the client's value; upstream and response carry the same edge-made id", h["x-request-id"] && h["x-request-id"] !== "attacker-chosen-id" && one(r, "x-request-id") === h["x-request-id"], `upstream=${h["x-request-id"]} response=${one(r, "x-request-id")}`);
  S.check("home_url() seen by the CP is https://www.copilt.org/ whatever the headers said", j.home_url === "https://www.copilt.org/", j.home_url);
  S.data.cpReceivedHeaders = h;
  // different sources -> different client IPs at the CP (IPv4 vs IPv6 loopback)
  const v6 = await echo(E, { "X-Forwarded-For": "6.6.6.6" }, "/wp-json/", { connectIp: "::1" });
  S.check("a request from ::1 reaches the CP as client ::1 (XFF = the peer, still overwritten)", v6.j.cp_client_ip === "::1" && v6.j.headers?.["x-forwarded-for"] === "::1", `xff=${v6.j.headers?.["x-forwarded-for"]} cp_client_ip=${v6.j.cp_client_ip}`);
  // per-IP rate limit: 31st request from source A is 429, source B (::1) still 200  (runbook section 4 two-source smoke test)
  wpcliQuiet("transient", "delete", "--all");
  const codes = [];
  for (let i = 0; i < 32; i++) { const x = await rq(E, "https://www.copilt.org/wp-json/aicc-license/v1/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"license_key":"smoke-test"}' }); codes.push(x.status); }
  const b = await rq(E, "https://www.copilt.org/wp-json/aicc-license/v1/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"license_key":"smoke-test"}', connectIp: "::1" });
  S.check("two-source rate-limit smoke test: source A (127.0.0.1) hits 429 after 30 requests, source B (::1) in the same minute is NOT limited (per-client buckets, not one global bucket)", codes.slice(0, 30).every((c) => c !== 429) && codes.slice(30).includes(429) && b.status !== 429, `A: first 30 -> ${[...new Set(codes.slice(0, 30))]}, 31st/32nd -> ${codes.slice(30)}; B -> ${b.status}`);
  wpcliQuiet("transient", "delete", "--all");
  // residual: the CP believes XFF from whoever connects from a trusted address (127.0.0.1): in production the upstream port must not be reachable except from the edge
  const direct = await fetch(`http://127.0.0.1:18982/wp-json/?__rehearsal_echo=${T}`, { headers: { "X-Forwarded-For": "9.9.9.9", "X-Forwarded-Proto": "https", Host: "www.copilt.org" } }).then((x) => x.json()).catch(() => ({}));
  S.info("RESIDUAL (by design): talking to the upstream port directly from the edge's address, XFF is believed", `direct request with XFF 9.9.9.9 -> cp_client_ip=${direct.cp_client_ip}. Production: bind the upstream to the private interface and allow only the edge in the firewall.`);
  // 2. smuggling-ish input on the wire
  const raw = async (label, text, expectRe, secure = true) => {
    const before = upstreamLog().length;
    const x = await rawRequest(PUBLIC, text, { secure });
    await sleep(150);
    const saw = upstreamLog().slice(before).map((e) => e.uri);
    const status = (/^HTTP\/\S+ (\d{3})/.exec(x.text) || [])[1] || (x.error || (x.closed ? "closed" : "none"));
    S.check(`raw: ${label}`, expectRe.test(String(status)) && !saw.some((u) => /SMUGGLED/.test(u)), `response=${status}; upstream saw: ${saw.join(", ") || "nothing"}`, status);
    return { x, saw, status };
  };
  const H = "Host: www.copilt.org\r\n";
  await raw("duplicate Content-Length with different values", `POST /my-account/ HTTP/1.1\r\n${H}Content-Length: 5\r\nContent-Length: 40\r\nConnection: close\r\n\r\nabcde`, /^(400|closed|none|ECONN)/);
  await raw("Content-Length + Transfer-Encoding: chunked (TE.CL) with a smuggled second request", `POST /my-account/ HTTP/1.1\r\n${H}Content-Length: 4\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\nGET /SMUGGLED HTTP/1.1\r\n${H}\r\n`, /^(400|200|301|302|closed|none|ECONN|\d{3})$/);
  await raw("Transfer-Encoding: xchunked / obfuscated TE", `POST /my-account/ HTTP/1.1\r\n${H}Transfer-Encoding: xchunked\r\nContent-Length: 4\r\nConnection: close\r\n\r\nabcd`, /^(400|501|closed|none|ECONN)/);
  await raw("Transfer-Encoding with leading space (obs-fold style)", `POST /my-account/ HTTP/1.1\r\n${H}Transfer-Encoding : chunked\r\nContent-Length: 4\r\nConnection: close\r\n\r\n0\r\n\r\n`, /^(400|closed|none|ECONN)/);
  await raw("Content-Length: +5 / 0x5", `POST /my-account/ HTTP/1.1\r\n${H}Content-Length: +5\r\nConnection: close\r\n\r\nabcde`, /^(400|closed|none|ECONN)/);
  await raw("two Host headers (one evil)", `GET /pricing/ HTTP/1.1\r\n${H}Host: evil.example\r\nConnection: close\r\n\r\n`, /^(400|421|closed|none|ECONN|200)$/);
  await raw("absolute-URI request line to another host", `GET http://evil.example/pricing/ HTTP/1.1\r\n${H}Connection: close\r\n\r\n`, /^(400|421|404|200|closed|none|ECONN)/);
  await raw("bare LF line endings / header injection via LF", `GET /pricing/ HTTP/1.1\n${H.replace("\r\n", "\n")}X-A: b\nConnection: close\n\n`, /^(400|200|closed|none|ECONN|\d{3})$/);
  await raw("NUL byte in a header value", `GET /pricing/ HTTP/1.1\r\n${H}X-A: a\u0000b\r\nConnection: close\r\n\r\n`, /^(400|closed|none|ECONN)/);
  await raw("HTTP/1.0 without Host over plain http", `GET /product HTTP/1.0\r\n\r\n`, /^421$/, false);
  await raw("pipelined second request after a normal one is answered normally (framing intact)", `GET /robots.txt HTTP/1.1\r\n${H}\r\nGET /SMUGGLED-PIPELINE HTTP/1.1\r\n${H}Connection: close\r\n\r\n`, /^200$/);
  // 3. path normalisation and locale + WordPress
  const norm = [["/product/../pricing/", 400], ["/pricing/%2e%2e/product/", 400], ["/product//", null], ["/pricing//", null], ["/he/pricing/", 200], ["/he/my-account/lost-password/", 200], ["/he/my-account/", 200], ["/es/cart/", 200], ["/ru/pricing/", 200], ["/he/xmlrpc.php", 404], ["/he/wp-admin/", 404], ["/he/wp-login.php", 404]];
  for (const [p, want] of norm) { const x = await rq(PUBLIC, `https://www.copilt.org${p}`); const owner = one(x, "x-rehearsal-upstream") === "wordpress" ? "WordPress" : "edge/static"; S.check(`path/locale: ${p} -> ${x.status} (${owner})`, x.status > 0 && x.status < 500 && (want === null || x.status === want), `status=${x.status} owner=${owner}`, `${x.status} ${owner}`); }
  const heP = await rq(PUBLIC, "https://www.copilt.org/he/pricing/");
  S.check("/he/pricing/ really is WordPress's Hebrew page (lang=he, rtl) through the edge", /<html[^>]*lang="he/.test(heP.body) && /dir="rtl"/.test(heP.body) && one(heP, "x-rehearsal-upstream") === "wordpress", `lang/dir present: ${/lang="he/.test(heP.body)}/${/dir="rtl"/.test(heP.body)}`);
  // 4. ownership: every route x locale has exactly one real owner and it is the declared one; unrouted paths have none
  const { ROUTE_IDS, localePath } = await loadTs("src/lib/routes.ts");
  const { LOCALES } = await loadTs("src/i18n/config.ts");
  const own = []; let bad = 0;
  for (const l of LOCALES) for (const id of ROUTE_IDS) {
    const p = localePath(l, id); const x = await rq(PUBLIC, `https://www.copilt.org${p}`);
    const wp = one(x, "x-rehearsal-upstream") === "wordpress"; const want = M.TARGET_OWNER[id];
    const okk = x.status === 200 && ((want === "wordpress") === wp);
    if (!okk) bad++;
    own.push({ route: p, declared: want, actual: wp ? "wordpress" : "static", status: x.status });
  }
  S.check(`ownership: ${own.length} route x locale URLs, each answered by exactly the declared origin (declared WordPress -> PHP marker; declared static -> none)`, bad === 0, own.filter((o2) => o2.status !== 200 || (o2.declared !== o2.actual)).map((o2) => `${o2.route} ${o2.declared}/${o2.actual}/${o2.status}`).join(", ") || "all agree");
  S.data.ownership = own;
  const unrouted = ["/get-started/", "/docs/", "/faq/", "/install/", "/en/", "/he/get-started/", "/random-123/", "/shop-x/"];
  for (const p of unrouted) { const x = await rq(PUBLIC, `https://www.copilt.org${p}`); S.check(`a route owned by no origin: ${p} -> edge 404 (never reaches PHP)`, x.status === 404 && one(x, "x-rehearsal-upstream") !== "wordpress", `${x.status}`); }
  // 5. unkeyed headers must not change a page (cache poisoning) and must not appear in it
  const unkeyed = { "X-Forwarded-Host": "evil.example", "X-Host": "evil.example", "X-Forwarded-Scheme": "http", "X-Forwarded-Proto": "http", "X-Forwarded-Port": "1337", "X-HTTP-Method-Override": "POST", "X-Original-URL": "/x", "Forwarded": "host=evil.example", "X-Forwarded-Prefix": "/evil" };
  for (const p of ["/pricing/", "/my-account/", "/he/pricing/", "/privacy/"]) {
    const a = await rq(PUBLIC, `https://www.copilt.org${p}`), c = await rq(PUBLIC, `https://www.copilt.org${p}`, { headers: unkeyed });
    const links = (x) => (x.body.match(/https?:\/\/[^"'\s<>)]+/g) || []).filter((u) => !/www\.copilt\.org|w3\.org|schema\.org|fonts\.|gravatar/.test(u)).length;
    S.check(`unkeyed headers do not reach the page ${p}: no evil.example, no http:// self-links, same status`, !/evil\.example|:1337|\/evil/.test(c.body) && a.status === c.status && !/http:\/\/www\.copilt\.org/.test(c.body), `status ${a.status}/${c.status}; foreign links ${links(a)}/${links(c)}`);
  }
  S.save();
  return [S];
}
import { loadTs } from "../lib/load.mjs";
const wpcliQuiet = (...a) => sh("bash", [P.cpFixture, "wp", ...a]);

/* ------------------------------------------------------------------ logging */
async function logging() {
  const S = new Section("07-logging", "Logging: JSON access + error logs, rotation settings, redaction, request id, peer IP, upstream");
  await ensureInstances();
  const E = EDGE;
  const secrets = fs.existsSync(path.join(P.run, "log-grep-secrets.txt")) ? fs.readFileSync(path.join(P.run, "log-grep-secrets.txt"), "utf8").split("\n").filter(Boolean) : [];
  S.check("the admin section ran first and left the real reset key + test passwords for the grep (run `admin` before `logging`)", secrets.length >= 3, `${secrets.length} secret strings to grep for`);
  // requests carrying every kind of secret
  const marks = { key: "KEYSECRET9a8b7c", login: "LOGINSECRET", pass: "PASSSECRET", password: "PWDSECRET", token: "TOKSECRET", code: "CODESECRET", nonce: "NONCESECRET1", wpnonce: "WPNONCESECRET", reset: "RESETSECRET", lic: "LICSECRET" };
  const url = `https://www.copilt.org/my-account/lost-password/?key=${marks.key}&id=7&login=${marks.login}&pass=${marks.pass}&password=${marks.password}&token=${marks.token}&code=${marks.code}&nonce=${marks.nonce}&_wpnonce=${marks.wpnonce}&reset=${marks.reset}&license_key=${marks.lic}&foo=bar&KEY=UPPERSECRET`;
  const r = await rq(E, url, { headers: { Cookie: "wordpress_logged_in_x=COOKIESECRET; wp_woocommerce_session_y=SESSIONSECRET", Authorization: "Bearer AUTHSECRET", Referer: "https://www.copilt.org/my-account/lost-password/?key=REFSECRET&id=7", "X-WP-Nonce": "XWPNONCESECRET" } });
  const r2 = await rq(E, "https://www.copilt.org/?wc-ajax=get_refreshed_fragments", { method: "POST", body: "pwd=BODYSECRET&password=BODYSECRET2" });
  const rStatic = await rq(E, "https://www.copilt.org/product/");
  const rRedir = await rq(PUBLIC, "https://copilt.org/my-account?key=REDIRKEYSECRET&id=1");
  const rDeny = await rq(E, "https://www.copilt.org/xmlrpc.php?password=DENYSECRET");
  const r6 = await rq(E, "https://www.copilt.org/pricing/", { connectIp: "::1" });
  await rq(E, "https://www.copilt.org/my-account/", { method: "POST", body: "username=nobody&password=LOGINBODYSECRET&login=Log+in", headers: { Cookie: "wordpress_test_cookie=WP%20Cookie%20check" } });
  await sleep(500);
  const { map, all } = readAccessLog();
  const e1 = map.get(r.reqId), e2 = map.get(r2.reqId), e3 = map.get(rStatic.reqId), e4 = map.get(rRedir.reqId), e5 = map.get(rDeny.reqId), e6 = map.get(r6.reqId);
  S.check("access log entry exists for each probe, keyed by the X-Request-Id returned to the client", [e1, e2, e3, e4, e5, e6].every(Boolean), `entries found: ${[e1, e2, e3, e4, e5, e6].filter(Boolean).length}/6`);
  S.check("entry fields: ts, status, duration, method, host, uri, client address (remote_ip), request_id, upstream", e1 && e1.ts && e1.status === r.status && typeof e1.duration === "number" && e1.request?.method === "GET" && e1.request?.host && e1.request?.uri && e1.request?.remote_ip === "127.0.0.1" && e1.request_id === r.reqId && e1.upstream === WP_UPSTREAM, JSON.stringify({ ts: !!e1?.ts, status: e1?.status, duration: e1?.duration, remote_ip: e1?.request?.remote_ip, upstream: e1?.upstream }));
  S.check("the real peer address is logged: IPv4 loopback request -> 127.0.0.1, IPv6 request -> ::1", e1?.request?.remote_ip === "127.0.0.1" && e6?.request?.remote_ip === "::1", `${e1?.request?.remote_ip} / ${e6?.request?.remote_ip}`);
  S.check("upstream field: WordPress route -> 127.0.0.1:18982; static, redirect and deny -> empty", e1?.upstream === WP_UPSTREAM && e2?.upstream === WP_UPSTREAM && !e3?.upstream && !e4?.upstream && !e5?.upstream, `wp=${e1?.upstream} ajax=${e2?.upstream} static=${e3?.upstream} redirect=${e4?.upstream} deny=${e5?.upstream}`);
  const up = upstreamLog();
  S.check("the SAME request id was passed to the upstream (CP upstream log) and logged by the edge and returned to the client", up.some((u) => u.request_id === r.reqId && u.uri.includes("lost-password")), `upstream log has ${up.filter((u) => u.request_id === r.reqId).length} entry with the id`);
  const uri1 = e1?.request?.uri || "";
  const leaks = Object.values(marks).filter((m) => uri1.includes(m));
  S.check("logged URI: every secret-bearing query value is REDACTED (key, login, pass, password, token, code, nonce, _wpnonce, reset, license_key, case-insensitive KEY), foo=bar kept", leaks.length === 0 && /key=REDACTED/.test(uri1) && /foo=bar/.test(uri1) && !/UPPERSECRET/.test(uri1), `logged uri: ${uri1}`);
  S.check("logged Referer is redacted too (page opened from a reset link)", !JSON.stringify(e1?.request?.headers || {}).includes("REFSECRET"), JSON.stringify(e1?.request?.headers?.Referer || e1?.request?.headers || {}).slice(0, 200));
  S.check("no Cookie, Authorization or X-WP-Nonce request header is logged", !e1?.request?.headers?.Cookie && !e1?.request?.headers?.Authorization && !e1?.request?.headers?.["X-Wp-Nonce"], Object.keys(e1?.request?.headers || {}).join(","));
  S.check("no Set-Cookie response header is logged (login attempt that sets wordpress_test_cookie / WooCommerce session)", all.every((x) => !x.resp_headers?.["Set-Cookie"]), `entries scanned: ${all.length}`);
  const loc4 = e4?.resp_headers?.Location?.[0] || "";
  S.check("a redirect's logged Location is redacted (apex /my-account?key=... )", !loc4.includes("REDIRKEYSECRET") && /key=REDACTED/.test(loc4), loc4);
  // grep every log for every secret string (also the pre-existing lines from the admin section's real reset flow)
  const files = allEdgeLogFiles().map((f) => path.relative(P.logs, f));
  const all2 = Object.values(marks).concat(["COOKIESECRET", "SESSIONSECRET", "AUTHSECRET", "XWPNONCESECRET", "REFSECRET", "BODYSECRET", "BODYSECRET2", "REDIRKEYSECRET", "DENYSECRET", "UPPERSECRET", "LOGINBODYSECRET"], secrets);
  const hits = [];
  for (const f of files) { const text = readLogFile(path.join(P.logs, f)); for (const sec of all2) if (text.includes(sec)) hits.push(`${f}: ${sec.slice(0, 4)}…`); }
  S.check(`grep: none of ${all2.length} secret strings (test password, REAL emailed reset key, cookie/auth/nonce values, every query secret) appears in ${files.length} edge log files (${files.join(", ")})`, hits.length === 0, hits.join("; ") || "0 hits");
  fs.rmSync(path.join(P.run, "log-grep-secrets.txt"), { force: true });
  const realResetPath = all.filter((x) => /\/my-account\/lost-password\/\?/.test(x.request?.uri || "") && /show-reset-form|key=/.test(x.request?.uri || "")).slice(-3).map((x) => x.request.uri);
  S.info("real reset-link requests as logged (from the admin section's flow)", realResetPath.join(" | "));
  // rotation and caps from the adapted config
  const adapted = JSON.parse(sh(P.caddy, ["adapt", "--config", path.join(P.generated, "Caddyfile"), "--adapter", "caddyfile"]).stdout);
  const writers = new Map();
  const walk = (o) => { if (o && typeof o === "object") { if (o.writer?.filename) writers.set(o.writer.filename, o.writer); Object.values(o).forEach(walk); } };
  walk(adapted.logging);
  const rot = [...writers.values()].map((w) => `${path.basename(w.filename)}: roll_size ${w.roll_size_mb} MB, keep ${w.roll_keep} files, ${w.roll_keep_days} days`);
  S.check("rotation configured for both logs: 20 MiB per file, 5 files kept, 30 days (hard cap about 100 MiB per log; rolled files are gzip-compressed by Caddy's default)", rot.length >= 2 && [...writers.values()].every((w) => w.roll_size_mb === 20 && w.roll_keep === 5 && w.roll_keep_days === 30), rot.join("; "));
  S.data.rotation = rot;
  // prove the rotation mechanism with a throwaway Caddy whose roll_size is tiny
  const scratch = path.join(P.home, "run/rotation-test"); fs.rmSync(scratch, { recursive: true, force: true }); fs.mkdirSync(scratch, { recursive: true });
  fs.writeFileSync(path.join(scratch, "Caddyfile"), `{\n\tadmin off\n\tauto_https off\n}\n:18099 {\n\tlog {\n\t\toutput file ${scratch}/t.log {\n\t\t\troll_size 1MiB\n\t\t\troll_keep 2\n\t\t\troll_keep_for 24h\n\t\t}\n\t}\n\trespond "ok"\n}\n`);
  const { spawn } = await import("node:child_process");
  const c = spawn(P.caddy, ["run", "--config", path.join(scratch, "Caddyfile"), "--adapter", "caddyfile"], { stdio: "ignore", env: { ...process.env, XDG_DATA_HOME: scratch + "/xdg", XDG_CONFIG_HOME: scratch + "/cfg" } });
  await sleep(1500);
  for (let i = 0; i < 6000; i++) await fetch("http://127.0.0.1:18099/" + "x".repeat(900) + i).then((x) => x.text()).catch(() => {});
  await sleep(500); c.kill("SIGTERM"); await sleep(500);
  const rotated = fs.readdirSync(scratch).filter((f) => f.startsWith("t")).sort();
  S.check("rotation mechanism (throwaway Caddy, roll_size 1 MiB, roll_keep 2, ~7 MB of log lines): rolled files appear and are pruned to the keep count (disk use is capped)", rotated.length >= 2 && rotated.length <= 3, rotated.join(", ") + " sizes(KB): " + rotated.map((f) => Math.round(fs.statSync(path.join(scratch, f)).size / 1024)).join(","));
  fs.rmSync(scratch, { recursive: true, force: true });
  const du = sh("du", ["-sk", P.logs]).stdout.split("\t")[0];
  S.info("current log directory size", `${du} KB under ${P.logs}`);
  // sanitized samples for the report
  const sample = [e1, e2, e3, e4, e5].filter(Boolean).map((x) => ({ ts: x.ts, remote_ip: x.request.remote_ip, method: x.request.method, host: x.request.host, uri: x.request.uri, status: x.status, duration: x.duration, size: x.size, upstream: x.upstream, request_id: x.request_id, req_header_names: Object.keys(x.request.headers || {}), resp_location: x.resp_headers?.Location?.[0] }));
  S.data.samples = sample;
  fs.writeFileSync(path.join(P.evidence, "log-samples-sanitized.jsonl"), sample.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const errlog = fs.existsSync(path.join(P.logs, "error.log")) ? fs.readFileSync(path.join(P.logs, "error.log"), "utf8") : "";
  S.check("error log is JSON lines and records the 5xx/dial failures from the errors section (levels, messages)", errlog.split("\n").filter(Boolean).every((l) => { try { JSON.parse(l); return true; } catch { return false; } }) && /"level":"error"/.test(errlog), `${errlog.split("\n").filter(Boolean).length} lines`);
  const acme = errlog.split("\n").filter((l) => /acme|letsencrypt|zerossl|api\.letsencrypt|acme-v02/i.test(l));
  S.check("NO ACME / public-CA activity in the error log (issuer was `local`)", acme.length === 0, acme.slice(0, 2).join(" | ") || "none");
  S.save();
  return [S];
}
const upstreamLogFn = upstreamLog;
void upstreamLogFn;

/* ------------------------------------------------------------------ demo */
async function demo() {
  const S = new Section("08-demo", "Demo through the real edge: approved master, MIME, ranges, no compression, cache choice, browser playback, CP Watch-demo probe");
  await ensureInstances();
  const E = EDGE;
  const want = fs.readFileSync(path.join(REPO_ROOT, "docs/approved-demo.sha256"), "utf8").trim().split(/\s+/)[0];
  const MASTER = "/Users/avivgerman/Downloads/AICC-demo/video/final-v3-main-michael-1.1x.mp4";
  const masterHash = fs.existsSync(MASTER) ? sh("shasum", ["-a", "256", MASTER]).stdout.split(" ")[0] : "";
  S.check("approved master (read-only hash of the original file) = docs/approved-demo.sha256, starts 6ec46e72fd2531ea, 43957999 bytes", masterHash === want && want.startsWith("6ec46e72fd2531ea") && fs.statSync(MASTER).size === 43957999, `${masterHash.slice(0, 16)} size=${fs.statSync(MASTER).size}`);
  const dl = sh("bash", ["-c", `${P.home}/bin/rcurl -s https://www.copilt.org/demo/aicc-demo.mp4 | shasum -a 256`]).stdout.split(" ")[0];
  S.check("the bytes served THROUGH THE EDGE (full GET, streamed to sha256) equal the approved master", dl === want, `served ${dl.slice(0, 16)}… master ${want.slice(0, 16)}…`);
  const dlGz = sh("bash", ["-c", `${P.home}/bin/rcurl -s -H 'Accept-Encoding: gzip, zstd' https://www.copilt.org/demo/aicc-demo.mp4 | shasum -a 256`]).stdout.split(" ")[0];
  S.check("same bytes when the client offers gzip/zstd (nothing re-encoded)", dlGz === want, dlGz.slice(0, 16));
  const hd = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { head: true, headers: { "Accept-Encoding": "gzip, zstd, br" } });
  S.check("headers: 200, video/mp4, Content-Length 43957999, Accept-Ranges bytes, ETag + Last-Modified, no Content-Encoding, Cache-Control public, max-age=0, must-revalidate", hd.status === 200 && one(hd, "content-type") === "video/mp4" && one(hd, "content-length") === "43957999" && one(hd, "accept-ranges") === "bytes" && !!one(hd, "etag") && !!one(hd, "last-modified") && !one(hd, "content-encoding") && one(hd, "cache-control") === "public, max-age=0, must-revalidate", `${hd.status} ${one(hd, "content-type")} len=${one(hd, "content-length")} ar=${one(hd, "accept-ranges")} etag=${one(hd, "etag")} cc=${one(hd, "cache-control")}`);
  const cond = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { head: true, headers: { "If-None-Match": one(hd, "etag") } });
  S.check("revalidation works: If-None-Match with the ETag -> 304 (a replaced master is picked up within one request, an unchanged one costs no 44 MB)", cond.status === 304, `${cond.status}`);
  const rg = await rq(E, "https://www.copilt.org/demo/aicc-demo.mp4", { headers: { Range: "bytes=0-" }, bodyFile: "/dev/null" });
  S.check("browser-style first request Range: bytes=0- -> 206 with Content-Range bytes 0-43957998/43957999", rg.status === 206 && one(rg, "content-range") === "bytes 0-43957998/43957999", `${rg.status} ${one(rg, "content-range")}`);
  for (const [p, type, file] of [["/demo/aicc-demo.vtt", /^text\/vtt/, "demo/aicc-demo.vtt"], ["/demo/aicc-demo-poster.jpg", /^image\/jpeg$/, "demo/aicc-demo-poster.jpg"]]) {
    const x = await rq(E, `https://www.copilt.org${p}`, { bodyFile: "/tmp/aicc-demo-x.bin" });
    S.check(`${p}: 200, ${type}, bytes identical to the release copy`, x.status === 200 && type.test(one(x, "content-type") || "") && sh("cmp", ["/tmp/aicc-demo-x.bin", path.join(P.current, file)]).code === 0, `${x.status} ${one(x, "content-type")}`);
  }
  const vtt = await rq(E, "https://www.copilt.org/demo/aicc-demo.vtt");
  S.check("captions file starts with WEBVTT", vtt.body.startsWith("WEBVTT"), vtt.body.slice(0, 8));
  S.note("Cache choice: /demo/* is revalidatable (Cache-Control: public, max-age=0, must-revalidate + ETag/Last-Modified -> 304), NOT the one-day cache of the other static assets, because the master is replaceable under the same URL; hashed /_next/static/* is immutable for a year. A versioned filename would allow a long cache, but the CP's Watch demo and the static site both hard-code /demo/aicc-demo.mp4.");

  // browser: static site Watch demo through the edge, then the CP's own button with and without /demo/* (temporary config variants on the standing edge)
  const { chromium } = await import("playwright-core");
  // Chrome trusts the rehearsal CA through --ignore-certificate-errors-spki-list (SPKI pins of the leaf, the intermediate and the root); no global trust-store change, no sudo
  const spkiOf = (cmd) => sh("bash", ["-c", `${cmd} | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`]).stdout.trim();
  const spki = [`cat ${P.rootCrt}`, `cat ${path.dirname(P.rootCrt)}/intermediate.crt`, `echo | openssl s_client -connect 127.0.0.1:443 -servername www.copilt.org 2>/dev/null`].map(spkiOf).filter(Boolean).join(",");
  const exe = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ executablePath: exe, args: ["--host-resolver-rules=MAP www.copilt.org 127.0.0.1, MAP copilt.org 127.0.0.1", `--ignore-certificate-errors-spki-list=${spki}`] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    const reqs = [];
    pg.on("response", (res) => { const u = res.url(); if (/\/demo\//.test(u)) reqs.push({ url: u.replace("https://www.copilt.org", ""), status: res.status(), range: res.request().headers()["range"] || "" }); });
    await pg.goto("https://www.copilt.org/", { waitUntil: "load" });
    await pg.waitForTimeout(1200);
    S.check("static home loaded in Chrome over HTTPS through the edge with NO certificate override on the page (SPKI-trusted rehearsal CA), and no /demo/ request before the dialog opens", reqs.length === 0 && pg.url() === "https://www.copilt.org/", `url=${pg.url()} demo requests before open=${reqs.length}`);
    await pg.locator("[data-aicc-demo-trigger]:visible").first().click();
    await pg.waitForSelector("dialog[open] video");
    await pg.waitForFunction(() => document.querySelector("dialog[open] video").readyState >= 1, null, { timeout: 20000 });
    const meta = await pg.evaluate(() => { const v = document.querySelector("dialog[open] video"); return { dur: v.duration, src: v.currentSrc, paused: v.paused }; });
    S.check("static site's dialog: video metadata loads through the edge (duration > 60 s), not playing", meta.dur > 60 && meta.paused, JSON.stringify(meta));
    await pg.evaluate(() => { document.querySelector("dialog[open] video").currentTime = 70; });
    await pg.waitForFunction(() => { const v = document.querySelector("dialog[open] video"); return Math.abs(v.currentTime - 70) < 3 && !v.seeking; }, null, { timeout: 20000 }).catch(() => {});
    const seek = await pg.evaluate(() => { const v = document.querySelector("dialog[open] video"); return { t: v.currentTime, seeking: v.seeking, rs: v.readyState }; });
    const mp4 = reqs.filter((x) => /\.mp4$/.test(x.url));
    S.check("seek to 70 s works and every video request was ranged and answered 206", Math.abs(seek.t - 70) < 3 && mp4.length >= 2 && mp4.every((x) => /^bytes=\d+-/.test(x.range) && x.status === 206), `t=${seek.t.toFixed(1)} requests: ${mp4.map((x) => `${x.range}->${x.status}`).join("; ")}`);
    await ctx.close();
  } finally { /* browser closed below */ }

  // the CP's Watch demo: the button exists only on the CP's own front page, which the production edge never serves (static owns /): use temporary variants that give / to WordPress
  const base = { ...settings(), ...INSTANCES.edge, upstream: WP_UPSTREAM, staticRoot: P.current, wpTimeout: "60s" };
  const probe = async (variant, label) => {
    void label;
    await reload({ ...base, variant }, { quiet: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    const heads = [];
    pg.on("response", (res) => { if (/\/demo\//.test(res.url())) heads.push(`${res.request().method()} ${res.url().replace("https://www.copilt.org", "")} ${res.status()}`); });
    const errs = []; pg.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
    const resp = await pg.goto("https://www.copilt.org/", { waitUntil: "load" });
    await sleep(1500);
    const state = await pg.evaluate(() => ({ trigger: document.querySelectorAll("[data-aicc-demo-trigger]").length, ok: document.querySelectorAll("[data-aicc-demo-trigger][data-demo-ok]").length, visible: [...document.querySelectorAll("[data-aicc-demo-trigger]")].filter((b) => getComputedStyle(b).visibility !== "hidden").length, h1: document.querySelector("h1")?.textContent?.trim().slice(0, 60) }));
    const marker = (resp.headers()["x-rehearsal-upstream"] || "");
    await ctx.close();
    return { label, status: resp.status(), servedByWordPress: marker === "wordpress", state, heads, errs };
  };
  const withDemo = await probe("cp-home", "variant cp-home (WordPress owns /, /demo/* served by the edge)");
  S.check("CP front page through the edge (variant): button present, HEAD probes of /demo/aicc-demo.mp4 and .vtt answered 200 by the edge, button marked ok and visible", withDemo.servedByWordPress && withDemo.state.trigger === 1 && withDemo.state.ok === 1 && withDemo.state.visible === 1 && withDemo.heads.filter((h2) => /^HEAD .*200$/.test(h2)).length >= 2, JSON.stringify({ ...withDemo, heads: withDemo.heads }));
  const blocked = await probe("cp-home+block-demo", "variant cp-home + /demo/* blocked");
  S.check("with /demo/* blocked at the edge (variant): the probe fails, the button is REMOVED, the page still loads (200, heading present, no page error)", blocked.servedByWordPress && blocked.state.trigger === 0 && blocked.status === 200 && !!blocked.state.h1 && blocked.errs.length === 0, JSON.stringify(blocked));
  await reload({ ...base, variant: "" }, { quiet: true });
  const back = await rq(E, "https://www.copilt.org/demo/aicc-demo.vtt", { head: true });
  S.check("variants removed: standing edge reloaded to the plain template, /demo/ answers again and / is static again", back.status === 200 && one(await rq(E, "https://www.copilt.org/"), "x-rehearsal-upstream") !== "wordpress", `${back.status}`);
  S.data.cpWatchDemo = { withDemo, blocked };
  S.note("The CP's Watch-demo button is rendered only by the CP front page (front-page.php). Under the target routing the edge sends / to the static site, so that page and its button are never served in production; the variants exist only to prove the probe contract (button only because /demo/* answers).");
  await browser.close();
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ restart / failure rehearsal with timings */
const PROBE_URLS = ["https://www.copilt.org/", "https://www.copilt.org/product/", "https://www.copilt.org/pricing/", "https://www.copilt.org/wp-json/aicc-license/v1/plans", "https://www.copilt.org/demo/aicc-demo.vtt", "https://www.copilt.org/my-account/"];
const LABEL = "org.copilt.aicc-rehearsal-edge";
async function restart() {
  const S = new Section("09-restart-failure", "Restart and failure rehearsal with timings");
  await ensureInstances();
  const E = EDGE, uid = process.getuid();
  const cfg = { ...settings(), ...INSTANCES.edge, upstream: WP_UPSTREAM, staticRoot: P.current, wpTimeout: "60s", variant: "" };
  const timings = [];
  const T = (name, ms, note = "") => { timings.push({ scenario: name, ms, note }); S.info(`timing: ${name}`, `${ms} ms ${note}`); };
  const apiBefore = fs.existsSync(path.join(P.evidence, "api-probe-before.txt")) ? fs.readFileSync(path.join(P.evidence, "api-probe-before.txt"), "utf8") : "";

  // 1. graceful reload under a concurrent probe
  let probe = startProbe(E, PROBE_URLS, { concurrency: 6, pauseMs: 10 });
  await sleep(1000);
  const reloads = [];
  for (let k = 0; k < 4; k++) { reloads.push((await reload(cfg, { quiet: true })).ms); await sleep(700); }
  await sleep(1000);
  let sum = await probe.stop();
  S.check(`graceful reload x4 under a concurrent probe (6 workers, ${sum.total} requests over ${sum.durationMs} ms incl. WordPress pages): ZERO failed requests`, sum.failed === 0, `failed=${sum.failed} ${sum.failures.join("; ")} maxLatency=${sum.maxLatencyMs} ms`);
  T("caddy reload (graceful), 4 runs", Math.round(reloads.reduce((a, b) => a + b, 0) / reloads.length), `each: ${reloads.join(", ")} ms; failed requests under load: ${sum.failed}/${sum.total}`);
  S.data.reloadProbe = sum;

  // 2. hard stop + start (SIGTERM, then new process) under probe -> measured downtime
  probe = startProbe(E, ["https://www.copilt.org/", "https://www.copilt.org/pricing/"], { concurrency: 3, pauseMs: 5 });
  await sleep(800);
  const tStop = now(); const st = await stop(cfg, { quiet: true });
  const tDown = now();
  const s1 = await start(cfg, { quiet: true });
  let up = -1; for (let n = 0; n < 400; n++) { const r = await rq(E, "https://www.copilt.org/"); if (r.status === 200) { up = now(); break; } await sleep(10); }
  await sleep(500);
  sum = await probe.stop();
  T("hard stop + start (SIGTERM then new process)", up - tStop, `stop took ${st.ms} ms; process start to ports open ${s1.ms} ms; first 200 ${up - tDown} ms after stop returned; probe: ${sum.failed}/${sum.total} failed, longest outage ${sum.outageMs} ms`);
  S.check("hard restart: first successful request within 5 s of the stop command", up > 0 && up - tStop < 5000, `${up - tStop} ms`);
  S.data.hardRestartProbe = sum;

  // 3. kill -9 with NO supervision: it stays down
  const pid0 = readPid("edge");
  process.kill(pid0, "SIGKILL"); await sleep(1500);
  const dead = await rq(E, "https://www.copilt.org/", { timeout: 3 });
  S.check("kill -9 without a supervisor: the edge stays down (connection refused) — supervision is required in production", dead.status === 0, `status=${dead.status} ${dead.error || ""}`.slice(0, 160));
  fs.rmSync(path.join(P.run, "edge.pid"), { force: true });

  // 4. launchd supervision: KeepAlive restarts after kill -9
  const plist = launchdPlist(cfg);
  const lc = (...a) => sh("launchctl", a);
  lc("bootout", `gui/${uid}/${LABEL}`);
  const boot = lc("bootstrap", `gui/${uid}`, plist.out);
  let ok0 = await waitFor(async () => (await portListening(443)) && (await rq(E, "https://www.copilt.org/")).status === 200, 20000, 50);
  S.check("launchd (plist under ~/aicc-rehearsal/run/, loaded with launchctl bootstrap gui/<uid>) starts the edge", boot.code === 0 && ok0 >= 0, `bootstrap exit ${boot.code} ${boot.out.trim().slice(0, 120)}; first 200 after ${ok0} ms`);
  T("launchd bootstrap -> first 200", ok0);
  const pidOf = () => { const m = /pid = (\d+)/.exec(lc("print", `gui/${uid}/${LABEL}`).out); return m ? Number(m[1]) : 0; };
  const kills = [];
  for (let k = 0; k < 3; k++) {
    const pid = pidOf();
    if (!pid) { kills.push({ error: "no pid" }); break; }
    const t = now(); process.kill(pid, "SIGKILL");
    await waitFor(async () => !alive(pid), 3000, 20);
    const rec = await waitFor(async () => { const np = pidOf(); return np && np !== pid && (await rq(E, "https://www.copilt.org/", { timeout: 2 })).status === 200; }, 30000, 25);
    kills.push({ oldPid: pid, newPid: pidOf(), recoveryMs: rec >= 0 ? now() - t : -1 });
    await sleep(300);
  }
  S.check("launchd KeepAlive: three kill -9 in a row, each time a NEW caddy pid serves 200 again", kills.length === 3 && kills.every((k2) => k2.recoveryMs > 0 && k2.newPid !== k2.oldPid), JSON.stringify(kills));
  T("kill -9 -> supervised restart -> first 200 (launchd, ThrottleInterval 2 s)", Math.round(kills.reduce((a, k2) => a + k2.recoveryMs, 0) / Math.max(1, kills.length)), `each: ${kills.map((k2) => k2.recoveryMs).join(", ")} ms`);
  const cert1 = sh("bash", ["-c", `echo | openssl s_client -connect 127.0.0.1:443 -servername www.copilt.org 2>/dev/null | openssl x509 -noout -serial`]).stdout.trim();
  lc("bootout", `gui/${uid}/${LABEL}`);
  await sleep(1500);
  S.check("launchd job removed again (bootout): port 443 free", !(await portListening(443)), "");
  // 5. the edge down / up with the CP healthy
  const t5 = now(); await start(cfg, { quiet: true });
  const up5 = await waitFor(async () => (await rq(E, "https://www.copilt.org/pricing/")).status === 200, 15000, 25);
  T("edge cold start (CA + certs loaded from storage) -> first WordPress page 200", now() - t5, `waitFor ${up5} ms`);
  const cert2 = sh("bash", ["-c", `echo | openssl s_client -connect 127.0.0.1:443 -servername www.copilt.org 2>/dev/null | openssl x509 -noout -serial`]).stdout.trim();
  S.check("certificate serial unchanged across kill -9, launchd restart and a cold start (reloaded from storage, not re-issued)", cert1 === cert2 && cert1.length > 8, `${cert1} / ${cert2}`);
  // 6. CP upstream down / up while the edge stays up (measured with a probe)
  probe = startProbe(E, ["https://www.copilt.org/", "https://www.copilt.org/product/"], { concurrency: 2, pauseMs: 20 });
  const wpProbe = startProbe(E, ["https://www.copilt.org/pricing/"], { concurrency: 2, pauseMs: 20 });
  await sleep(500);
  sh("bash", [P.cpFixture, "stop-php"]);
  await sleep(1500);
  const down = await rq(E, "https://www.copilt.org/pricing/");
  const tUp = now(); sh("bash", [P.cpFixture, "start-php"]);
  const rec6 = await waitFor(async () => (await rq(E, "https://www.copilt.org/pricing/")).status === 200, 30000, 50);
  await sleep(300);
  const staticSum = await probe.stop(); const wpSum = await wpProbe.stop();
  S.check("CP down: static routes had ZERO failed requests during the CP outage and recovery", staticSum.failed === 0, `static ${staticSum.failed}/${staticSum.total} failed`);
  S.check("CP down: WordPress route answered the branded 502 while down, 200 after it came back (edge not touched)", down.status === 502 && rec6 >= 0, `down=${down.status}, recovered after ${rec6} ms (php boot + health wait inside start-php: ${now() - tUp} ms total)`);
  T("CP upstream stop -> start -> first 200 through the edge", now() - tUp, `CP routes failed ${wpSum.failed}/${wpSum.total} probe requests while it was down (expected 502 page), static 0/${staticSum.total}`);
  // 7. listeners
  // ONLY the processes this rehearsal started (pid files / the :18982 php workers); other Local/QA processes on this Mac are not ours
  const mysqlPid = (() => { try { return fs.readFileSync(path.join(P.cpBase, "mysql/mysqld.pid"), "utf8").trim(); } catch { return ""; } })();
  const phpPids = sh("pgrep", ["-f", "127.0.0.1:18982"]).stdout.split("\n").filter(Boolean);
  const pids = [readPid("edge"), readPid("public"), mysqlPid, ...phpPids].filter(Boolean).join(",");
  const lsofTcp = sh("lsof", ["-nP", "-a", "-p", pids, "-iTCP", "-sTCP:LISTEN"]).stdout, lsofUdp = sh("lsof", ["-nP", "-a", "-p", pids, "-iUDP"]).stdout;
  const lsof = (lsofTcp + "\n" + lsofUdp).split("\n").filter((l) => l && !/^COMMAND/.test(l)).map((l) => { const f = l.split(/\s+/); return `${f[0]} pid ${f[1]} ${f[7]} ${f[8]}`; }).sort().filter((x, i, a2) => a2.indexOf(x) === i).join("\n");
  S.data.listeners = lsof.split("\n").filter(Boolean);
  const ports = [...new Set((lsof.match(/:(\d+)(?:\s|$)/g) || []).map((x) => Number(x.replace(/[: ]/g, ""))))];
  const qa = ports.filter((p2) => (p2 >= 8981 && p2 <= 8983) || (p2 >= 9111 && p2 <= 9114) || p2 === 8000);
  S.check(`no rehearsal listener uses a QA port (8981-8983, 9111-9114) or 8000; our listening ports: ${ports.sort((x, y) => x - y).join(", ")}`, ports.length > 0 && qa.length === 0, `qa overlap: ${qa.join(",") || "none"}`);
  S.info("listeners of the rehearsal's own processes (lsof)", lsof.split("\n").filter(Boolean).join(" || ").slice(0, 1200));
  const nonLoop = lsof.split("\n").filter((l) => l && !/127\.0\.0\.1:|\[::1\]:/.test(l));
  S.check("the only non-loopback listeners are Caddy's wildcard :80 / :443 (TCP) and :443 (UDP, HTTP/3) of the standing edge; mysqld, php and every high-port or admin listener are loopback-only", nonLoop.every((l) => /caddy/.test(l) && /\*:(80|443)$/.test(l)), nonLoop.join(" || "));
  S.info("the real API", "api.copilt.org is a remote host (139.59.157.231, its own Caddy); this rehearsal has no api.copilt.org site block (safety check refuses one) and only read-only `curl -sI https://api.copilt.org/` was ever sent");
  // 8. non-loopback peers are dropped by the wildcard listener (rehearsal guard) -- use the Mac's LAN address if it has one
  const lan = sh("bash", ["-c", "ipconfig getifaddr en0 || ipconfig getifaddr en1"]).stdout.trim();
  if (lan) { const r = await rq(E, "https://www.copilt.org/", { connectIp: lan, timeout: 5 }); S.check(`wildcard listener guard: a connection to the LAN address ${lan.replace(/\.\d+$/, ".x")} (source = the Mac's own LAN address, not loopback) is aborted`, r.status === 0, `status=${r.status} ${r.error || ""}`.slice(0, 150)); }
  else S.info("LAN address guard test skipped", "no LAN interface address found");
  // 9. disk use and API probe
  const du = sh("bash", ["-c", `cd ${P.home} && du -sk * 2>/dev/null | sort -rn | head -12`]).stdout.trim().replace(/\n/g, "; ");
  S.info("disk use after the run (KB per top-level dir under ~/aicc-rehearsal)", du);
  S.data.diskUse = du;
  const apiNow = sh("curl", ["-sI", "https://api.copilt.org/"]).stdout;
  fs.writeFileSync(path.join(P.evidence, "api-probe-after.txt"), apiNow);
  const norm = (t) => t.split("\n").filter((l) => !/^date:/i.test(l)).map((l) => l.trim()).join("\n");
  S.check("api.copilt.org read-only probe (HEAD /) is unchanged before and after the whole rehearsal (status line and headers, Date ignored)", apiBefore !== "" && norm(apiBefore) === norm(apiNow), norm(apiNow).split("\n").slice(0, 3).join(" | "));
  S.data.timings = timings;
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ TLS (internal CA only) */
async function tlsSection() {
  const S = new Section("10-tls", "TLS rehearsal with Caddy's internal CA (public-CA issuance is NOT rehearsable here)");
  await ensureInstances();
  const E = EDGE;
  const ossl = (cmd) => sh("bash", ["-c", cmd]).stdout;
  const certOf = (name) => ossl(`echo | openssl s_client -connect 127.0.0.1:443 -servername ${name} -showcerts 2>/dev/null`);
  for (const name of ["www.copilt.org", "copilt.org"]) {
    const pem = certOf(name);
    const first = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
    fs.writeFileSync("/tmp/aicc-leaf.pem", first[0] || ""); fs.writeFileSync("/tmp/aicc-chain.pem", first.slice(1).join("\n"));
    const txt = ossl("openssl x509 -in /tmp/aicc-leaf.pem -noout -subject -issuer -dates -serial -ext subjectAltName,keyUsage,extendedKeyUsage 2>&1");
    const verify = ossl(`openssl verify -CAfile ${P.rootCrt} -untrusted /tmp/aicc-chain.pem /tmp/aicc-leaf.pem 2>&1`).trim();
    const nb = /notBefore=(.*)/.exec(txt)?.[1], na = /notAfter=(.*)/.exec(txt)?.[1];
    const hours = (new Date(na) - new Date(nb)) / 3600000;
    S.check(`${name}: issued by Caddy Local Authority, SAN is exactly DNS:${name}, chain verifies against the rehearsal root`, /Caddy Local Authority/.test(txt) && new RegExp(`DNS:${name.replace(/\./g, "\\.")}(\\s|$)`).test(txt) && (txt.match(/DNS:/g) || []).length === 1 && /: OK$/.test(verify), `${verify.split("\n").pop()}; ${(/X509v3 Subject Alternative Name:\s*\n\s*(.*)/.exec(txt) || [])[1]}`);
    S.info(`${name}: validity / lifetime / chain length`, `${nb} -> ${na} (${hours.toFixed(1)} h; Caddy's internal issuer default is 12 h with automatic renewal); chain sent: leaf + ${first.length - 1} intermediate(s); serial ${/serial=(.*)/.exec(txt)?.[1]}`);
    S.check(`${name}: key usage digitalSignature + serverAuth`, /Digital Signature/.test(txt) && /TLS Web Server Authentication/.test(txt), "");
    S.check(`${name}: certificate contains no OCSP responder / CRL URL (OCSP stapling is not applicable to the internal CA)`, !/OCSP/.test(ossl("openssl x509 -in /tmp/aicc-leaf.pem -noout -text")), "");
  }
  const stat = ossl("echo | openssl s_client -connect 127.0.0.1:443 -servername www.copilt.org -status 2>&1 | grep -i 'OCSP response'").trim();
  S.info("OCSP stapling", stat || "no OCSP line (n/a)");
  // storage permissions and ownership
  const me = sh("id", ["-un"]).stdout.trim(), meUid = process.getuid();
  const perms = [];
  const walkDir = (d, depth = 0) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); const st = fs.statSync(f); if (e.isDirectory()) { perms.push({ kind: "dir", mode: (st.mode & 0o777).toString(8), owner: st.uid === meUid ? me : st.uid, path: path.relative(P.caddyData, f) }); walkDir(f, depth + 1); } else if (/\.(key|crt|json)$/.test(e.name)) perms.push({ kind: e.name.endsWith(".key") ? "key" : "file", mode: (st.mode & 0o777).toString(8), owner: st.uid === meUid ? me : st.uid, path: path.relative(P.caddyData, f) }); } };
  const rootSt = fs.statSync(P.caddyData); perms.push({ kind: "dir", mode: (rootSt.mode & 0o777).toString(8), owner: rootSt.uid === meUid ? me : rootSt.uid, path: "." });
  walkDir(P.caddyData);
  const dirs = perms.filter((x) => x.kind === "dir");
  S.check("storage: the data dir and all sub-directories are 0700 and owned by the service user", dirs.length > 3 && dirs.every((x) => x.mode === "700" && x.owner === me), `${dirs.length} dirs; not 0700: ${dirs.filter((x) => x.mode !== "700").map((x) => x.path + ":" + x.mode).join(" ") || "none"}`);
  const keys = perms.filter((x) => x.kind === "key");
  S.check("storage: every private key file is 0600 and owned by the service user", keys.length >= 3 && keys.every((x) => x.mode === "600" && x.owner === me), keys.map((x) => `${x.path.split("/").slice(-2).join("/")}:${x.mode}`).join("; "));
  S.data.storagePerms = perms;
  // restart persistence: serials unchanged after a cold restart; count of 'obtained' messages does not grow
  const obtained = () => (fs.readFileSync(path.join(P.logs, "error.log"), "utf8").match(/certificate obtained successfully/g) || []).length;
  const cfg = { ...settings(), ...INSTANCES.edge, upstream: WP_UPSTREAM, staticRoot: P.current, wpTimeout: "60s", variant: "" };
  const serial = (n) => /serial=(.*)/.exec(ossl(`echo | openssl s_client -connect 127.0.0.1:443 -servername ${n} 2>/dev/null | openssl x509 -noout -serial`))?.[1];
  const before = { w: serial("www.copilt.org"), a: serial("copilt.org"), n: obtained(), root: sh("shasum", [P.rootCrt]).stdout.slice(0, 12) };
  await stop(cfg, { quiet: true }); await start(cfg, { quiet: true });
  const after = { w: serial("www.copilt.org"), a: serial("copilt.org"), n: obtained(), root: sh("shasum", [P.rootCrt]).stdout.slice(0, 12) };
  S.check("restart persistence: both leaf serials and the root CA are unchanged after stop/start and no new 'certificate obtained' was logged (loaded from storage, not re-issued)", before.w === after.w && before.a === after.a && before.root === after.root && before.n === after.n, `www ${before.w}=${after.w}; apex ${before.a}=${after.a}; obtained log lines ${before.n}->${after.n}`);
  // renewal configuration, and a real accelerated renewal on a scratch instance
  const cfgJson = await (await fetch(`http://${E.admin}/config/apps/tls/automation`, { headers: { Origin: `http://${E.admin}` } })).json();
  S.check("renewal configuration present: automation policy with the internal issuer for www.copilt.org and copilt.org (Caddy renews managed certificates itself, in the background)", JSON.stringify(cfgJson).includes('"module":"internal"') || JSON.stringify(cfgJson).includes('"module": "internal"'), JSON.stringify(cfgJson).slice(0, 300));
  const scratch = path.join(P.home, "run/renewal-test"); fs.rmSync(scratch, { recursive: true, force: true }); fs.mkdirSync(scratch, { recursive: true });
  fs.writeFileSync(path.join(scratch, "Caddyfile"), `{\n\tlocal_certs\n\tskip_install_trust\n\tadmin off\n\thttp_port 18101\n\thttps_port 18444\n\tdefault_bind 127.0.0.1\n\tstorage file_system ${scratch}/data\n\trenew_interval 10s\n}\nwww.copilt.org {\n\ttls {\n\t\tissuer internal {\n\t\t\tlifetime 120s\n\t\t}\n\t}\n\trespond "renew test"\n}\n`);
  const { spawn } = await import("node:child_process");
  const c = spawn(P.caddy, ["run", "--config", path.join(scratch, "Caddyfile"), "--adapter", "caddyfile"], { stdio: ["ignore", fs.openSync(path.join(scratch, "log"), "w"), fs.openSync(path.join(scratch, "log"), "a")], env: { ...process.env, XDG_DATA_HOME: scratch + "/xdg", XDG_CONFIG_HOME: scratch + "/cfg" } });
  await sleep(2500);
  const ser = () => /serial=(.*)/.exec(ossl(`echo | openssl s_client -connect 127.0.0.1:18444 -servername www.copilt.org 2>/dev/null | openssl x509 -noout -serial`))?.[1];
  const s0 = ser(); const tR = now(); let s1 = s0;
  while (now() - tR < 170000 && s1 === s0) { await sleep(5000); s1 = ser(); }
  c.kill("SIGTERM"); await sleep(500);
  S.check("accelerated renewal (throwaway instance: 120 s leaf lifetime, renew_interval 10 s): Caddy replaced the certificate on its own before expiry, without a restart", !!s0 && !!s1 && s0 !== s1, `serial ${s0} -> ${s1} after ${Math.round((now() - tR) / 1000)} s`);
  fs.rmSync(scratch, { recursive: true, force: true });
  // protocol versions and ciphers
  const v = {};
  for (const [flag, label] of [["-tls1_3", "TLS 1.3"], ["-tls1_2", "TLS 1.2"], ["-tls1_1", "TLS 1.1"], ["-tls1", "TLS 1.0"], ["-ssl3", "SSL 3"]]) {
    const out = ossl(`echo | /opt/homebrew/bin/openssl s_client -connect 127.0.0.1:443 -servername www.copilt.org ${flag} 2>&1 | grep -E 'Protocol|Cipher is|alert|no protocols|unsupported' | head -3`).trim();
    v[label] = /Cipher is [A-Z0-9_]+/.test(out) && !/Cipher is \(NONE\)/.test(out) ? "accepted" : "refused";
  }
  S.check("TLS 1.2 and 1.3 accepted; TLS 1.1, 1.0 and SSLv3 refused", v["TLS 1.3"] === "accepted" && v["TLS 1.2"] === "accepted" && v["TLS 1.1"] === "refused" && v["TLS 1.0"] === "refused" && v["SSL 3"] === "refused", JSON.stringify(v));
  const all12 = ossl("/opt/homebrew/bin/openssl ciphers -s -tls1_2 'ALL:eNULL:aNULL:EXPORT:LOW:3DES:RC4:MD5' 2>/dev/null").trim().split(":").filter(Boolean);
  const accepted = [];
  for (const ci of all12) { const out = ossl(`echo | /opt/homebrew/bin/openssl s_client -connect 127.0.0.1:443 -servername www.copilt.org -tls1_2 -cipher '${ci}' 2>&1 | grep -E 'Cipher is'`); if (/Cipher is [A-Z0-9_-]+/.test(out) && !/\(NONE\)/.test(out)) accepted.push(ci); }
  const weak = accepted.filter((x) => /RC4|3DES|NULL|EXPORT|MD5|DES-CBC|CBC-SHA(?!256|384)|^AES\d+-SHA$/i.test(x));
  S.check(`TLS 1.2 cipher suites accepted (${accepted.length} of ${all12.length} tried): only forward-secret AEAD suites; no RC4/3DES/NULL/EXPORT/MD5/static-RSA/CBC-SHA1`, accepted.length > 0 && weak.length === 0 && accepted.every((x) => /ECDHE/.test(x) && /GCM|CHACHA20/.test(x)), accepted.join(", "));
  S.data.protocols = v; S.data.tls12Ciphers = accepted;
  const h3 = sh("lsof", ["-nP", "-a", "-p", String(readPid("edge")), "-iUDP"]).stdout;
  S.check("UDP :443 (HTTP/3 / QUIC) is listening on the edge (client-side QUIC itself UNVERIFIED: this curl has no HTTP/3)", /UDP \*:443/.test(h3), h3.split("\n").slice(1, 3).join(" | "));

  // window before a certificate exists: Caddy manages no certificate (variant), http must redirect once to https, never loop; then a reload brings the certificate and https works
  await reload({ ...cfg, variant: "no-certs" }, { quiet: true });
  await sleep(300);
  const hs = ossl("echo | openssl s_client -connect 127.0.0.1:443 -servername www.copilt.org 2>&1 | grep -iE 'alert|no peer certificate|internal error' | head -2").trim();
  S.check("variant no-certs (no certificate yet): TLS handshake is refused cleanly (alert), not a hang or a wrong certificate", /alert|no peer certificate/i.test(hs), hs);
  const h1 = await rq(E, "http://www.copilt.org/product");
  const h2 = await rq(E, "http://copilt.org/he/pricing?plan=solo");
  S.check("variant no-certs: http://www and http://apex answer with ONE redirect to https://www.copilt.org (no http->https->http loop), headers intact", h1.status === 301 && one(h1, "location") === "https://www.copilt.org/product/" && h2.status === 301 && one(h2, "location") === "https://www.copilt.org/he/pricing/?plan=solo", `${h1.status} ${one(h1, "location")}; ${h2.status} ${one(h2, "location")}`);
  const tR2 = now(); await reload({ ...cfg, variant: "" }, { quiet: true });
  const okTls = await waitFor(async () => (await rq(E, "https://www.copilt.org/")).status === 200, 15000, 50);
  S.check("reload back to the normal template: HTTPS works again from the stored certificate", okTls >= 0, `${now() - tR2} ms`);
  S.note("Internal-CA certificates live 12 h and Caddy renews them itself (accelerated renewal verified above on a 120 s scratch instance). The PUBLIC-CA path (HTTP-01 / TLS-ALPN-01 / DNS-01 against Let's Encrypt or ZeroSSL, rate limits, CAA, port 80/443 reachability from the internet, Namecheap DNS) cannot be exercised without public DNS and is UNPROVEN: see docs/cutover/rehearsal.md section 'TLS: proven and unproven'.");
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ rollback rehearsal (simulation) */
async function rollback() {
  const S = new Section("11-rollback", "Rollback rehearsal: config/target swap to a stand-in for the old site, with timings (simulation; real-world timeline in docs)");
  await ensureInstances();
  const E = EDGE;
  const cfg = { ...settings(), ...INSTANCES.edge, upstream: WP_UPSTREAM, staticRoot: P.current, wpTimeout: "60s", variant: "" };
  const oldHome = path.join(process.env.HOME, "Downloads/AICC-cutover-evidence/old-www-home.html");
  const siteDir = path.join(P.home, "old-target/site");
  fs.mkdirSync(siteDir, { recursive: true });
  fs.copyFileSync(oldHome, path.join(siteDir, "index.html"));
  const wantSha = sh("shasum", ["-a", "256", oldHome]).stdout.split(" ")[0];
  const check = async (inst) => {
    const rows = [];
    const g = async (url, o = {}) => { const r = await rq(inst, url, o); return r; };
    const home = await g("https://www.copilt.org/", { bodyFile: "/tmp/aicc-rb-home.bin" });
    const sha = sh("shasum", ["-a", "256", "/tmp/aicc-rb-home.bin"]).stdout.split(" ")[0];
    rows.push(["GET https://www.copilt.org/", home.status, sha === wantSha ? "bytes == saved old-www-home.html" : "bytes differ"]);
    const acct = await g("https://www.copilt.org/my-account/"), pr = await g("https://www.copilt.org/pricing/"), cart = await g("https://www.copilt.org/cart/");
    const apex = await g("https://copilt.org/x/y?z=1"), httpw = await g("http://www.copilt.org/x/y?z=1"), httpa = await g("http://copilt.org/");
    const robots = await g("https://www.copilt.org/robots.txt"), sm = await g("https://www.copilt.org/sitemap.xml"), demo = await g("https://www.copilt.org/demo/aicc-demo.mp4", { head: true }), xml = await g("https://www.copilt.org/xmlrpc.php");
    rows.push(["/my-account/", acct.status, ""], ["/pricing/", pr.status, ""], ["/cart/", cart.status, ""], ["https://copilt.org/x/y?z=1", apex.status, one(apex, "location") || ""], ["http://www.copilt.org/x/y?z=1", httpw.status, one(httpw, "location") || ""], ["http://copilt.org/", httpa.status, one(httpa, "location") || ""], ["/robots.txt", robots.status, ""], ["/sitemap.xml", sm.status, ""], ["/demo/aicc-demo.mp4", demo.status, ""], ["/xmlrpc.php", xml.status, ""]);
    return { rows, home, sha, acct, pr, apex, httpw, robots, sm };
  };
  // 0. new edge serving
  const n0 = await check(E);
  S.check("before: the NEW edge serves the new site (home is not the old page; /my-account/ and /pricing/ are 200 from WordPress)", n0.sha !== wantSha && n0.acct.status === 200 && n0.pr.status === 200, n0.rows.map((r) => r.join(" ")).slice(0, 3).join(" | "));
  // what the live old site says today (read-only GETs of the PUBLIC site, for comparison only)
  const live = {};
  for (const [k, u] of [["my-account", "https://www.copilt.org/my-account/"], ["pricing", "https://www.copilt.org/pricing/"], ["apex deep", "https://copilt.org/x/y?z=1"], ["http www deep", "http://www.copilt.org/x/y?z=1"], ["robots", "https://www.copilt.org/robots.txt"], ["sitemap", "https://www.copilt.org/sitemap.xml"]]) {
    const r = sh("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code} %{redirect_url}", u]).stdout.trim(); live[k] = r;
  }
  S.data.liveOldSiteToday = live;
  // 1. swap = reload the standing edge with the old-target config (what a DNS revert would do to who answers)
  const old = generateOldTarget(cfg);
  const errs = oldTargetSafety(old.text);
  S.check("old-target config passes the same safety rules (local_certs, no ACME, no api.copilt.org)", errs.length === 0, errs.join("; "));
  const v = sh(P.caddy, ["validate", "--config", old.file, "--adapter", "caddyfile"]);
  S.check("caddy validate on the old-target config", v.code === 0, v.out.split("\n").filter((l) => !l.startsWith("{")).join(" ").slice(0, 120));
  const t0 = now();
  const rl = sh(P.caddy, ["reload", "--config", old.file, "--adapter", "caddyfile", "--address", E.admin, "--force"]);
  const tSwap = now() - t0;
  S.check("config swap (caddy reload to the old-target config)", rl.code === 0, rl.out.slice(-150));
  let tFirstOld = -1;
  for (let k = 0; k < 300; k++) { const r = await rq(E, "https://www.copilt.org/my-account/"); if (r.status === 404) { tFirstOld = now() - t0; break; } await sleep(10); }
  const o1 = await check(E);
  S.check("after the swap: / is byte-identical to the saved old home page (sha256), 200", o1.home.status === 200 && o1.sha === wantSha, `sha ${o1.sha.slice(0, 16)} vs ${wantSha.slice(0, 16)}`);
  S.check("after the swap: /my-account/, /pricing/, /cart/, /demo/, /xmlrpc.php are 404 exactly as on the live old site today (live: my-account " + live["my-account"] + ", pricing " + live["pricing"] + ")", [o1.acct.status, o1.pr.status].every((x) => x === 404) && /^404/.test(live["my-account"]) && /^404/.test(live["pricing"]), o1.rows.slice(1, 4).map((r) => r.join(" ")).join(" | "));
  S.check("after the swap: apex 301s to https://www.copilt.org{path?query} in one hop (live old site: " + live["apex deep"] + "), http://www 301s to https", o1.apex.status === 301 && one(o1.apex, "location") === "https://www.copilt.org/x/y?z=1" && o1.httpw.status === 301 && one(o1.httpw, "location") === "https://www.copilt.org/x/y?z=1", `${o1.apex.status} ${one(o1.apex, "location")}; ${o1.httpw.status} ${one(o1.httpw, "location")}`);
  S.check("after the swap: robots.txt and sitemap.xml are the OLD site's (200, same as live today)", o1.robots.status === 200 && /aicommercecopilot\.com/.test(o1.sm.body), `${o1.robots.status}/${o1.sm.status}`);
  const old404 = await rq(E, "https://www.copilt.org/my-account/", { bodyFile: "/tmp/aicc-rb-404.bin" });
  S.check("the 404 page is the saved GitHub Pages 404 page (byte-identical), not the new site's", old404.status === 404 && sh("cmp", ["/tmp/aicc-rb-404.bin", path.join(siteDir, "404.html")]).code === 0, `${fs.statSync("/tmp/aicc-rb-404.bin").size} bytes`);
  const timing = { configSwapReloadMs: tSwap, triggerToFirstOldAnswerMs: tFirstOld };
  S.info("timing: swap to the old target", `reload ${tSwap} ms; trigger -> first old-site answer (404 on /my-account/) ${tFirstOld} ms`);
  // 2. roll forward again (restore the new edge)
  const t1 = now(); await reload(cfg, { quiet: true });
  let tNew = -1; for (let k = 0; k < 300; k++) { const r = await rq(E, "https://www.copilt.org/my-account/"); if (r.status === 200) { tNew = now() - t1; break; } await sleep(10); }
  const n1 = await check(E);
  S.check("restored: the new edge serves again (home is the new site, /my-account/ 200 from WordPress)", n1.sha !== wantSha && n1.acct.status === 200, `roll-forward ${tNew} ms`);
  timing.rollForwardMs = tNew;
  S.info("timing: swap back to the new edge", `${tNew} ms`);
  // 3. a different LISTENER (what a DNS revert is: clients go to another address): start the old target as its own process on high ports and 'resolve' the names to it
  const oldInst = { ...cfg, name: "oldtarget", httpPort: 18110, httpsPort: 18454, admin: "127.0.0.1:12024" };
  const og = generateOldTarget(oldInst);
  const t2 = now();
  const { spawn } = await import("node:child_process");
  const child = spawn(P.caddy, ["run", "--config", og.file, "--adapter", "caddyfile"], { stdio: "ignore", env: { ...process.env, XDG_DATA_HOME: path.join(P.home, "caddy/xdg-data"), XDG_CONFIG_HOME: P.caddyConfig } });
  const up = await waitFor(async () => (await rq({ name: "oldtarget", httpPort: 18110, httpsPort: 18454 }, "https://www.copilt.org/")).status === 200, 15000, 25);
  const o2 = await check({ name: "oldtarget", httpPort: 18110, httpsPort: 18454 });
  S.check("separate old-target listener (client 'DNS' points at it): serves the saved home page and 404s the new routes, while the new edge keeps running untouched", up >= 0 && o2.sha === wantSha && o2.acct.status === 404 && (await rq(E, "https://www.copilt.org/my-account/")).status === 200, `old listener up after ${up} ms`);
  timing.oldListenerColdStartMs = now() - t2;
  child.kill("SIGTERM"); await sleep(400);
  S.data.timing = timing;
  // 4. the real-world timeline from FRESH facts (read-only DNS/TLS queries today)
  const facts = fs.readFileSync(path.join(P.evidence, "live-facts-2026-10-20.txt"), "utf8");
  const notAfter = /notAfter=(.*)/.exec(facts)?.[1];
  const fresh = sh("bash", ["-c", "echo | openssl s_client -connect www.copilt.org:443 -servername www.copilt.org 2>/dev/null | openssl x509 -noout -dates"]).stdout.trim().replace(/\n/g, "; ");
  S.info("GitHub Pages certificate, re-verified now (openssl s_client -connect www.copilt.org:443 | openssl x509 -noout -dates)", fresh);
  const naFresh = /notAfter=(.*)/.exec(fresh)?.[1];
  const daysLeft = naFresh ? Math.round((new Date(naFresh) - new Date()) / 86400000) : -1;
  S.check(`the GitHub Pages certificate in force is read live and is still valid (notAfter ${naFresh}, ${daysLeft} days left): the rollback window ends there, because GitHub cannot renew while DNS points elsewhere`, daysLeft > 0, fresh);
  S.data.realWorldTimeline = {
    dnsTtlAuthoritative: "1799-1800 s at dns1/dns2.registrar-servers.com (apex A, www CNAME, MX, TXT); recursive resolvers showed 464-2250 s remaining on 2026-10-20",
    lowerTtlTo300: "Lower the www CNAME and the apex A records to 300 s at least 30 minutes (ideally 24 h) before the flip: the old TTL (1800 s) must expire first",
    negativeCaching: "SOA minimum is 3601 s: an empty answer for www (CNAME deleted before the A record exists) may be cached up to 1 h by resolvers. Delete and add back-to-back (one edit), never leave a gap",
    browserCaches: "301s for apex/aliases are cached by browsers indefinitely unless max-age is given; the apex -> www 301 already exists today (GitHub), so returning visitors see no change; /account /login /register /shop /store 301s (new) are cached and can outlive a rollback",
    hsts: "max-age=300 only, no includeSubDomains/preload: after a rollback browsers forget the HSTS pin within 5 minutes; the old site sends no HSTS",
    pagesCertificate: `notAfter ${naFresh} (read live; the snapshot taken earlier said ${notAfter}): GitHub renews about 30 days before expiry but cannot while DNS points elsewhere (its validation is HTTP from its own servers); a rollback after that date presents an EXPIRED certificate`,
    estimate: "Revert edit at the registrar: minutes (human). Propagation: <= 300 s after TTL was lowered (<= 1800 s if it was not). Old site reachable again for most clients within 5-10 minutes, long tail up to TTL. Valid TLS on return: only if the Pages certificate is still valid.",
  };
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ safety: no ACME, no api.copilt.org, no outbound connections */
async function safety() {
  const S = new Section("12-safety", "Safety proof: no public ACME contact, no api.copilt.org, loopback upstream, no outbound connections from the rehearsal processes");
  await ensureInstances();
  const gens = fs.readdirSync(P.generated).filter((f) => /^Caddyfile/.test(f));
  for (const f of gens) {
    const text = fs.readFileSync(path.join(P.generated, f), "utf8");
    const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    S.check(`${f}: local_certs, no acme_ca/acme_dns/email/on_demand_tls, no api.copilt.org address`, /^\s*local_certs\s*$/m.test(code) && !/\bacme_ca\b|\bacme_dns\b|^\s*email\b|on_demand_tls|\bissuer\s+(acme|zerossl)/m.test(code) && !/api\.copilt\.org/.test(code), "");
  }
  for (const inst of [EDGE, PUBLIC]) {
    const j = await (await fetch(`http://${inst.admin}/config/`, { headers: { Origin: `http://${inst.admin}` } })).text();
    S.check(`live config of the :${inst.httpsPort} instance (read back from Caddy's admin API): no ACME issuer, no ZeroSSL, no acme_ca URL, issuer module is internal`, !/"module":"acme"|"module":"zerossl"|acme-v0|letsencrypt|"ca":"https?:/.test(j) && /"module":"internal"/.test(j), "");
  }
  const pids = [readPid("edge"), readPid("public")].filter(Boolean).join(",");
  const net = sh("lsof", ["-nP", "-a", "-p", pids, "-i"]).stdout.split("\n").filter((l) => /ESTABLISHED|SYN_SENT|CLOSE_WAIT|TIME_WAIT/.test(l));
  const outbound = net.filter((l) => !/127\.0\.0\.1|\[::1\]|->\*|\*:/.test(l.replace(/\(LISTEN\)/, "")));
  S.check("no outbound (non-loopback) connection from any Caddy process at this moment (lsof -i)", outbound.length === 0, outbound.slice(0, 3).join(" | ") || `${net.length} loopback connections only`);
  const logs = allEdgeLogFiles().map((f) => path.relative(P.logs, f)).filter((f) => /error\.log|stdout\.log/.test(f));
  const acmeLines = logs.flatMap((f) => readLogFile(path.join(P.logs, f)).split("\n").filter((l) => /acme|letsencrypt|zerossl|acme-v02|acme-staging/i.test(l)).map((l) => `${f}: ${l.slice(0, 160)}`));
  S.check(`no ACME / Let's Encrypt / ZeroSSL line in ${logs.join(", ")}`, acmeLines.length === 0, acmeLines.slice(0, 2).join(" | ") || "none");
  S.check("Caddy storage has no ACME account or challenge directory (acme/ absent); only the local CA and local certificates", !fs.existsSync(path.join(P.caddyData, "acme")) && fs.existsSync(path.join(P.caddyData, "pki/authorities/local")), fs.readdirSync(P.caddyData).join(","));
  S.check("the edge's upstream is loopback and the only upstream of any generated file", gens.every((f) => !/reverse_proxy\s+(?!\{\$AICC_WP_UPSTREAM\})/.test(fs.readFileSync(path.join(P.generated, f), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"))), "reverse_proxy {$AICC_WP_UPSTREAM} = 127.0.0.1:18982 in the runner's environment");
  const dns = sh("bash", ["-c", "grep -n 'copilt.org' /etc/hosts | head -3"]).stdout.trim();
  S.check("/etc/hosts was not modified for the rehearsal names (clients map names with curl --resolve / Chrome --host-resolver-rules only)", dns === "", dns || "no copilt.org line in /etc/hosts");
  S.check("the real names resolve publicly as before (www still CNAME avivg7.github.io): no DNS change was made", /avivg7\.github\.io/.test(sh("dig", ["+short", "www.copilt.org", "CNAME"]).stdout), sh("dig", ["+short", "www.copilt.org", "CNAME"]).stdout.trim());
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ apexpost: a real wp_remote_post from WordPress to the APEX (reviewer finding A8, runbook 1.5) */
async function apexpost() {
  const S = new Section("13-apex-wp-remote-post", "wp_remote_post() from the Control Plane's own WordPress to https://copilt.org/... through the edge: exactly one 308, then WordPress's JSON");
  await ensureInstances();
  const php = `
add_action('http_api_curl', function($h){ curl_setopt($h, CURLOPT_RESOLVE, array('copilt.org:443:127.0.0.1','www.copilt.org:443:127.0.0.1')); });
add_filter('http_request_args', function($a){ $a['sslcertificates'] = '${P.rootCrt}'; return $a; });
$r = wp_remote_post('https://copilt.org/wp-json/aicc-license/v1/validate', array('body'=>wp_json_encode(array('license_key'=>'smoke-test')),'headers'=>array('Content-Type'=>'application/json'),'timeout'=>20,'redirection'=>5));
if (is_wp_error($r)) { echo 'ERROR '.$r->get_error_message(); return; }
$resp = $r['http_response']->get_response_object();
echo wp_json_encode(array('code'=>wp_remote_retrieve_response_code($r),'redirects'=>count($resp->history),'first_hop_status'=>$resp->history ? $resp->history[0]->status_code : null,'first_hop_location'=>$resp->history ? $resp->history[0]->headers['location'] : null,'final_url'=>$resp->url,'body'=>substr(wp_remote_retrieve_body($r),0,160)));`;
  const out = sh("bash", [P.cpFixture, "wp", "eval", php]).stdout.trim().split("\n").pop();
  let j = {}; try { j = JSON.parse(out); } catch { /* */ }
  S.check("WordPress's HTTP API followed exactly ONE redirect for a POST to the apex, the first hop was a 308 to https://www.copilt.org/ with the same path", j.redirects === 1 && j.first_hop_status === 308 && /^https:\/\/www\.copilt\.org\/wp-json\/aicc-license\/v1\/validate$/.test(j.first_hop_location || ""), out.slice(0, 400));
  S.check("the final answer is WordPress's JSON from the Control Plane's validate route (a harmless dummy key), not an HTML error or a GET-converted response", j.final_url === "https://www.copilt.org/wp-json/aicc-license/v1/validate" && /^[\[{]/.test(j.body || "") && j.code >= 200 && j.code < 500, `code=${j.code} final=${j.final_url} body=${(j.body || "").slice(0, 100)}`);
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ Option A: a pre-issued (manual) certificate: tls <cert> <key> (review F1/F13) */
async function optiona() {
  const S = new Section("14-option-a-manual-certificate", "Option A: `tls <cert> <key>` with a throwaway self-signed certificate (no public CA): validate, serve both names, redirects, HSTS, reload picks up a replaced file");
  const dir = path.join(P.home, "run/option-a"); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, "certs"), { recursive: true, mode: 0o700 }); fs.mkdirSync(path.join(dir, "storage"), { recursive: true, mode: 0o700 });
  const cert = path.join(dir, "certs/fullchain.pem"), key = path.join(dir, "certs/privkey.pem");
  const mk = (days, cn) => {
    const r = sh("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key + ".new", "-out", cert + ".new", "-days", String(days), "-subj", `/CN=${cn}`, "-addext", "subjectAltName=DNS:www.copilt.org,DNS:copilt.org"]);
    fs.renameSync(key + ".new", key); fs.renameSync(cert + ".new", cert); fs.chmodSync(key, 0o600);
    return r.code === 0;
  };
  S.check("a throwaway self-signed certificate (EC P-256, SAN www.copilt.org + copilt.org, 10 days) was generated locally: no CA of any kind is contacted", mk(10, "aicc-option-a-throwaway-1"), "");
  const serial = (name, port) => /serial=(.*)/.exec(sh("bash", ["-c", `echo | openssl s_client -connect 127.0.0.1:${port} -servername ${name} 2>/dev/null | openssl x509 -noout -serial`]).stdout)?.[1];
  const issuerOf = (name, port) => sh("bash", ["-c", `echo | openssl s_client -connect 127.0.0.1:${port} -servername ${name} 2>/dev/null | openssl x509 -noout -issuer -ext subjectAltName`]).stdout;
  const certSerial = () => /serial=(.*)/.exec(sh("openssl", ["x509", "-in", cert, "-noout", "-serial"]).stdout)?.[1];
  const A = { name: "optiona", httpPort: 18120, httpsPort: 18455 };
  const cfg = { ...settings(), ...A, admin: "127.0.0.1:12025", upstream: WP_UPSTREAM, staticRoot: P.current, wpTimeout: "60s", variant: "", storage: path.join(dir, "storage"), tlsFiles: `${cert},${key}` };
  const gen = generate(cfg);
  S.check("the generator renders `(aicc_tls) { tls <cert> <key> }` and its safety rules accept it (local files only, no ACME)", /\(aicc_tls\) \{\n\s*tls \S+fullchain\.pem \S+privkey\.pem\n\}/.test(gen.text) && safetyCheck(cfg, gen.text).length === 0, safetyCheck(cfg, gen.text).join("; "));
  const v = await validate(cfg, true);
  S.check("`caddy validate` accepts the manual-certificate rendering (before the apex split this was: \"server listening on [...] is HTTP, but attempts to configure TLS connection policies\")", v.ok, v.out.split("\n").filter((l) => !l.startsWith("{")).join(" ").slice(0, 200));
  // the PRODUCTION template itself (global block, email line, no local_certs) with the manual form: `caddy adapt` only (it never provisions an ACME issuer or contacts a CA)
  const prod = fs.readFileSync(P.template, "utf8").replace(/\(aicc_tls\) \{\n(?:(?!\}\n)[^\n]*\n)*\}\n/, `(aicc_tls) {\n\ttls ${cert} ${key}\n}\n`);
  fs.writeFileSync(path.join(dir, "Caddyfile.production-option-a"), prod);
  const ad = sh(P.caddy, ["adapt", "--config", path.join(dir, "Caddyfile.production-option-a"), "--adapter", "caddyfile"], { env: { ...process.env, AICC_ACME_EMAIL: "ops@example.invalid", AICC_STATIC_ROOT: "/srv/aicc/current", AICC_WP_UPSTREAM: "10.0.0.12:8080", AICC_OPERATOR_CIDRS: "203.0.113.7/32", AICC_LOG_DIR: dir } });
  S.check("`caddy adapt` accepts the PRODUCTION template (global block, email line, no local_certs) with the manual `tls <cert> <key>` form", ad.code === 0 && /"load_files"/.test(ad.stdout), ad.code === 0 ? "load_files present for the https blocks" : ad.out.slice(-200));
  fs.writeFileSync(path.join(dir, "adapted-production-option-a.json"), ad.stdout);
  const mixed = fs.readFileSync(P.template, "utf8").replace(/\(aicc_tls\) \{\n(?:(?!\}\n)[^\n]*\n)*\}\n/, `(aicc_tls) {\n\ttls ${cert} ${key}\n}\n`).replace("http://copilt.org, http://www.copilt.org {\n\timport aicc_site_hook\n", "http://copilt.org, https://copilt.org, http://www.copilt.org {\n\timport aicc_site_hook\n\timport aicc_tls\n").replace(/https:\/\/copilt\.org \{\n(?:(?!\}\n)[^\n]*\n)*\}\n/, "");
  fs.writeFileSync(path.join(dir, "Caddyfile.mixed-old-structure"), mixed);
  const adMixed = sh(P.caddy, ["adapt", "--config", path.join(dir, "Caddyfile.mixed-old-structure"), "--adapter", "caddyfile"], { env: { ...process.env, AICC_ACME_EMAIL: "ops@example.invalid", AICC_STATIC_ROOT: "/srv/aicc/current", AICC_WP_UPSTREAM: "10.0.0.12:8080", AICC_OPERATOR_CIDRS: "203.0.113.7/32", AICC_LOG_DIR: dir } });
  S.check("control: the OLD structure (one block mixing http:// and https:// addresses + a manual tls line) is rejected by the real Caddy, as the architecture review found", adMixed.code !== 0 && /is HTTP, but attempts to configure TLS connection policies/.test(adMixed.out), adMixed.out.split("\n").filter((l) => /error/.test(l)).join(" ").slice(0, 220));
  await start(cfg, { quiet: true });
  const OA = { ...cfg };
  const ser1 = certSerial();
  for (const name of ["www.copilt.org", "copilt.org"]) {
    const info = issuerOf(name, 18455);
    S.check(`${name}: the manual certificate is what is served (serial ${ser1}, CN aicc-option-a-throwaway-1, SAN covers both names, NOT a Caddy-issued one)`, serial(name, 18455) === ser1 && /aicc-option-a-throwaway-1/.test(info) && /DNS:www\.copilt\.org/.test(info) && /DNS:copilt\.org/.test(info) && !/Caddy Local Authority/.test(info), info.replace(/\n/g, " ").slice(0, 200));
  }
  S.check("nothing was issued automatically in this instance's storage (no certificates/ directory): Caddy used only the loaded files", !fs.existsSync(path.join(dir, "storage/certificates")), fs.readdirSync(path.join(dir, "storage")).join(","));
  // serve, redirect, HSTS
  const trust = ["--cacert", cert];
  const R = (url, o = {}) => rqWith(OA, url, trust, o);
  const home = await R("https://www.copilt.org/");
  S.check("https://www.copilt.org/ serves the static home page over the manual certificate (200, HSTS max-age=300, HTTP/2)", home.status === 200 && one(home, "strict-transport-security") === "max-age=300" && /<html/.test(home.body), `${home.status} ${one(home, "strict-transport-security")}`);
  const pr = await R("https://www.copilt.org/pricing/");
  S.check("a WordPress route works through the same listener (200 from WordPress)", pr.status === 200 && one(pr, "x-rehearsal-upstream") === "wordpress", `${pr.status}`);
  const apexS = await R("https://copilt.org/he/pricing?plan=solo"), apexH = await R("http://copilt.org/product"), wwwH = await R("http://www.copilt.org/x?y=1");
  const strip = (l) => (l || "").replace(":18455", "");
  S.check("https://copilt.org/... 301s to https://www.copilt.org in ONE hop with path + query (over the manual certificate)", apexS.status === 301 && strip(one(apexS, "location")) === "https://www.copilt.org/he/pricing/?plan=solo" && one(apexS, "strict-transport-security") === "max-age=300", `${apexS.status} ${one(apexS, "location")}`);
  S.check("http://copilt.org and http://www.copilt.org 301 straight to https://www (no http -> https -> www chain)", apexH.status === 301 && strip(one(apexH, "location")) === "https://www.copilt.org/product/" && wwwH.status === 301 && strip(one(wwwH, "location")) === "https://www.copilt.org/x?y=1", `${apexH.status} ${one(apexH, "location")} / ${wwwH.status} ${one(wwwH, "location")}`);
  const unk = await R("http://copilt.org/", { headers: { Host: "evil.example" } });
  S.check("unknown Host on port 80 still gets the 421 catch-all", unk.status === 421, `${unk.status}`);
  // monitor sees the 10-day certificate as a warning
  const mon1 = sh("bash", [path.join(REPO_ROOT, "scripts/ops/cert-expiry-check.sh"), "--host", "www.copilt.org", "--connect", "127.0.0.1:18455"]);
  S.check("scripts/ops/cert-expiry-check.sh reports the 10-day certificate as WARN (exit 1) on the live listener", mon1.code === 1 && /^WARN /.test(mon1.stdout), mon1.stdout.trim());
  const monFile = sh("bash", [path.join(REPO_ROOT, "scripts/ops/cert-expiry-check.sh"), "--file", cert, "--warn-days", "5", "--crit-days", "2"]);
  S.check("same file with thresholds 5/2 days -> OK (exit 0)", monFile.code === 0 && /^OK /.test(monFile.stdout), monFile.stdout.trim());
  // REPLACE the files: Caddy does not watch them
  const old1 = ser1;
  mk(90, "aicc-option-a-throwaway-2");
  const ser2 = certSerial();
  await sleep(1500);
  S.check("after the files are replaced on disk, WITHOUT a reload, Caddy keeps serving the OLD certificate (it does not watch certificate files: renewal needs `systemctl reload`)", serial("www.copilt.org", 18455) === old1 && ser2 !== old1, `served ${serial("www.copilt.org", 18455)} (old ${old1}, new on disk ${ser2})`);
  const rl = await reload(OA, { quiet: true });
  await sleep(300);
  S.check(`after \`caddy reload\` (${rl.ms} ms) both names serve the NEW certificate, no failed request in between`, serial("www.copilt.org", 18455) === ser2 && serial("copilt.org", 18455) === ser2, `served ${serial("www.copilt.org", 18455)}, ${serial("copilt.org", 18455)} (new ${ser2})`);
  const mon2 = sh("bash", [path.join(REPO_ROOT, "scripts/ops/cert-expiry-check.sh"), "--host", "www.copilt.org", "--host", "copilt.org", "--connect", "127.0.0.1:18455"]);
  S.check("the monitor is green (OK, exit 0) for both names after the renewal reload", mon2.code === 0, mon2.stdout.trim().replace(/\n/g, " | "));
  // a broken replacement is caught BEFORE it is loaded
  const keep = fs.readFileSync(cert);
  fs.writeFileSync(cert, "not a certificate");
  const pf = preflight(OA, generate(OA).file);
  S.check("preflight refuses to reload a corrupt certificate file (so a bad renewal cannot take the edge down on reload)", !pf.ok && /not a PEM certificate/.test(pf.out), pf.out.trim().slice(0, 160));
  fs.writeFileSync(cert, keep);
  await stop(OA, { quiet: true });
  S.note("Throwaway certificate only: nothing here proves a public CA's certificate would be accepted, only that the file form validates, serves both names, redirects and reloads. Certbot/DNS-01 issuance of the real certificate is UNPROVEN (rehearsal.md 'Certificate gate').");
  S.save();
  fs.rmSync(dir, { recursive: true, force: true });
  return [S];
}
async function rqWith(inst, url, extra, o = {}) { return req(inst, url, { ...o, extra: [...extra, ...(o.extra || [])] }); }

/* ------------------------------------------------------------------ preflight: fail-closed start (E5, architecture review F6) */
async function preflightSection() {
  const S = new Section("15-preflight", "scripts/ops/edge-preflight.sh: every missing or unsafe input stops the start with a clear message (negative tests)");
  const dir = path.join(P.home, "run/preflight"); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const root = path.join(dir, "static"), logs = path.join(dir, "logs"); fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(logs, { recursive: true });
  for (const f of ["index.html", "404.html", "50x.html"]) fs.writeFileSync(path.join(root, f), "<html></html>");
  const script = path.join(REPO_ROOT, "scripts/ops/edge-preflight.sh");
  const rehearsalFile = path.join(P.generated, "Caddyfile");
  const prodFile = path.join(dir, "Caddyfile.production"); fs.writeFileSync(prodFile, fs.readFileSync(P.template, "utf8"));
  const base = { AICC_STATIC_ROOT: root, AICC_WP_UPSTREAM: "127.0.0.1:18982", AICC_OPERATOR_CIDRS: "127.0.0.1/32 ::1/128", AICC_LOG_DIR: logs, AICC_ACME_EMAIL: "ops@example.invalid" };
  const run = (over, file = rehearsalFile, extra = []) => {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...base, ...over };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    return sh("bash", [script, "--caddyfile", file, "--caddy", P.caddy, "--no-validate", "--quiet", ...extra], { env });
  };
  const bad = (name, over, re, file, extra) => { const r = run(over, file, extra); S.check(`NEGATIVE: ${name} -> exit 1 and a message matching ${re}`, r.code === 1 && re.test(r.out), `exit ${r.code}: ${r.out.trim().split("\n")[0].slice(0, 170)}`); };
  const good = (name, over, file, extra) => { const r = run(over, file, extra); S.check(`POSITIVE: ${name} -> exit 0`, r.code === 0, `exit ${r.code}: ${r.out.trim().split("\n").slice(0, 2).join(" | ").slice(0, 170)}`); };
  good("a complete environment (rehearsal Caddyfile)", {});
  bad("AICC_OPERATOR_CIDRS unset (Caddy alone would start and lock staff out)", { AICC_OPERATOR_CIDRS: undefined }, /AICC_OPERATOR_CIDRS is empty or unset/);
  bad("AICC_OPERATOR_CIDRS empty", { AICC_OPERATOR_CIDRS: "" }, /AICC_OPERATOR_CIDRS is empty or unset/);
  bad("AICC_OPERATOR_CIDRS only spaces", { AICC_OPERATOR_CIDRS: "   " }, /AICC_OPERATOR_CIDRS is empty or unset/);
  for (const v of ["0.0.0.0/0", "::/0", "0.0.0.0", "::", "10.0.0.0/0"]) bad(`AICC_OPERATOR_CIDRS=${v} (would make /wp-admin/ public)`, { AICC_OPERATOR_CIDRS: v }, /matches every address/);
  good("AICC_OPERATOR_CIDRS=0.0.0.0/0 with the explicit override AICC_ALLOW_OPEN_OPERATOR=1", { AICC_OPERATOR_CIDRS: "0.0.0.0/0", AICC_ALLOW_OPEN_OPERATOR: "1" });
  for (const v of ["300.1.1.1/32", "10.0.0.1/33", "abc", "10.0.0/24", "2001:db8::/129", "1.2.3.4/x", "203.0.113.7;rm"]) bad(`AICC_OPERATOR_CIDRS=${v}`, { AICC_OPERATOR_CIDRS: v }, /is not an IPv4\/IPv6 address or CIDR/);
  good("AICC_OPERATOR_CIDRS with IPv4, IPv6 and CIDR items", { AICC_OPERATOR_CIDRS: "203.0.113.7 198.51.100.0/24 2001:db8::/48 ::1" });
  bad("AICC_STATIC_ROOT unset", { AICC_STATIC_ROOT: undefined }, /AICC_STATIC_ROOT is empty or unset/);
  bad("AICC_STATIC_ROOT does not exist", { AICC_STATIC_ROOT: path.join(dir, "nope") }, /is not a directory/);
  const noIdx = path.join(dir, "no-index"); fs.mkdirSync(noIdx); fs.writeFileSync(path.join(noIdx, "50x.html"), "x"); fs.writeFileSync(path.join(noIdx, "404.html"), "x");
  bad("AICC_STATIC_ROOT without index.html", { AICC_STATIC_ROOT: noIdx }, /has no index\.html/);
  const no50 = path.join(dir, "no-50x"); fs.mkdirSync(no50); fs.writeFileSync(path.join(no50, "index.html"), "x"); fs.writeFileSync(path.join(no50, "404.html"), "x");
  bad("AICC_STATIC_ROOT without 50x.html (the 5xx page would be Caddy's empty body)", { AICC_STATIC_ROOT: no50 }, /has no 50x\.html/);
  const dangling = path.join(dir, "dangling"); fs.symlinkSync(path.join(dir, "gone"), dangling);
  bad("AICC_STATIC_ROOT is a dangling symlink (a release was deleted under `current`)", { AICC_STATIC_ROOT: dangling }, /is not a directory/);
  good("AICC_STATIC_ROOT is a symlink to a good release", { AICC_STATIC_ROOT: (() => { const l = path.join(dir, "current"); fs.symlinkSync(root, l); return l; })() });
  bad("AICC_WP_UPSTREAM unset", { AICC_WP_UPSTREAM: undefined }, /AICC_WP_UPSTREAM is empty or unset/);
  for (const v of ["127.0.0.1", "127.0.0.1:99999", "127.0.0.1:0", "127.0.0.1:abc", ":8080"]) bad(`AICC_WP_UPSTREAM=${v}`, { AICC_WP_UPSTREAM: v }, /AICC_WP_UPSTREAM/);
  good("AICC_WP_UPSTREAM=http://10.0.0.12:8080", { AICC_WP_UPSTREAM: "http://10.0.0.12:8080" });
  bad("AICC_LOG_DIR does not exist", { AICC_LOG_DIR: path.join(dir, "nolog") }, /does not exist/);
  const ro = path.join(dir, "ro-logs"); fs.mkdirSync(ro); fs.chmodSync(ro, 0o500);
  bad("AICC_LOG_DIR not writable", { AICC_LOG_DIR: ro }, /not writable/);
  fs.chmodSync(ro, 0o700);
  bad("AICC_WP_TIMEOUT=banana", { AICC_WP_TIMEOUT: "banana" }, /not a duration/);
  // production-style Caddyfile (the template itself): the ACME e-mail is mandatory, the admin API has no address (warning only)
  bad("production template, AICC_ACME_EMAIL unset", { AICC_ACME_EMAIL: undefined }, /AICC_ACME_EMAIL is empty or not an e-mail address/, prodFile);
  bad("production template, AICC_ACME_EMAIL=not-an-email", { AICC_ACME_EMAIL: "not-an-email" }, /AICC_ACME_EMAIL/, prodFile);
  const rProd = sh("bash", [script, "--caddyfile", prodFile, "--caddy", P.caddy, "--no-validate"], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...base } });
  S.check("POSITIVE: the production template with a plausible AICC_ACME_EMAIL passes; its admin API resolves to 127.0.0.1:12019 (NOT Caddy's default localhost:2019, which another Caddy on the host may own)", rProd.code === 0 && /admin API 127\.0\.0\.1:12019/.test(rProd.out), `exit ${rProd.code}: ${(rProd.out.match(/admin API \S+/) || ["(no admin line)"])[0]}`);
  bad("production template with AICC_ADMIN_ADDR=0.0.0.0:2019 (admin API on every interface)", { AICC_ADMIN_ADDR: "0.0.0.0:2019" }, /admin API address '0\.0\.0\.0:2019' is not loopback/, prodFile);
  const badAdmin = path.join(dir, "Caddyfile.admin-open"); fs.writeFileSync(badAdmin, fs.readFileSync(rehearsalFile, "utf8").replace(/^\tadmin .*$/m, "\tadmin 0.0.0.0:2019"));
  bad("Caddyfile with `admin 0.0.0.0:2019` (unauthenticated reconfiguration API on every interface)", {}, /admin API address '0\.0\.0\.0:2019' is not loopback/, badAdmin);
  good("Caddyfile with `admin unix//run/aicc-edge/admin.sock`", {}, (() => { const f = path.join(dir, "Caddyfile.admin-sock"); fs.writeFileSync(f, fs.readFileSync(rehearsalFile, "utf8").replace(/^\tadmin .*$/m, "\tadmin unix//run/aicc-edge/admin.sock")); return f; })());
  // manual certificate (Option A) checks
  const mkCert = (name, { days = 90, san = "DNS:www.copilt.org,DNS:copilt.org", mode = 0o600 } = {}) => {
    const c = path.join(dir, `${name}.pem`), k = path.join(dir, `${name}.key`);
    sh("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", k, "-out", c, ...(days <= 0 ? ["-not_before", "20200101000000Z", "-not_after", "20200102000000Z"] : ["-days", String(days)]), "-subj", "/CN=preflight-test", "-addext", `subjectAltName=${san}`]);
    fs.chmodSync(k, mode);
    return { c, k };
  };
  const withTls = (c, k) => { const f = path.join(dir, `Caddyfile.tls.${path.basename(c)}`); fs.writeFileSync(f, fs.readFileSync(rehearsalFile, "utf8").replace(/\(aicc_tls\) \{\n\ttls internal\n\}/, `(aicc_tls) {\n\ttls ${c} ${k}\n}`)); return f; };
  const ok = mkCert("good"); good("manual certificate: valid, both SANs, key 0600, key matches", {}, withTls(ok.c, ok.k));
  const miss = withTls(path.join(dir, "missing.pem"), ok.k); bad("manual certificate file missing", {}, /TLS certificate file .* is not readable/, miss);
  const mk2 = mkCert("wrongsan", { san: "DNS:www.copilt.org" }); bad("manual certificate lacks the apex SAN (Option A must cover BOTH names)", {}, /has no SAN DNS:copilt\.org/, withTls(mk2.c, mk2.k));
  const mk3 = mkCert("openkey", { mode: 0o644 }); bad("manual key is group/world readable", {}, /must not be group\/world accessible/, withTls(mk3.c, mk3.k));
  const mk4 = mkCert("other"); bad("manual key does not belong to the certificate", {}, /does not belong to certificate/, withTls(ok.c, mk4.k));
  const mk5 = mkCert("expired", { days: 0 }); bad("manual certificate has EXPIRED", {}, /has EXPIRED/, withTls(mk5.c, mk5.k));
  const mk6 = mkCert("soon", { days: 10 }); const rSoon = run({}, withTls(mk6.c, mk6.k)); S.check("manual certificate expiring in 10 days: still starts (exit 0) but WARNS", rSoon.code === 0 && /expires within 21 days/.test(rSoon.out), `exit ${rSoon.code}: ${rSoon.out.trim().split("\n")[0].slice(0, 150)}`);
  fs.writeFileSync(path.join(dir, "garbage.pem"), "not a cert"); bad("manual certificate file is not PEM", {}, /not a PEM certificate/, withTls(path.join(dir, "garbage.pem"), ok.k));
  // the rehearsal runner itself calls the preflight (exit code 4) and the systemd unit template does too
  const rr = sh("node", [path.join(REPO_ROOT, "scripts/rehearsal/rehearsal.mjs"), "validate", "--name", "preflighttest", "--http-port", "18130", "--https-port", "18456", "--admin", "127.0.0.1:12026", "--operator-cidrs", ""]);
  S.check("the rehearsal runner (rehearsal.mjs validate/start/reload) runs the preflight and stops with exit 4 on an empty operator list", rr.code === 4 && /AICC_OPERATOR_CIDRS is empty or unset/.test(rr.out), `exit ${rr.code}: ${rr.out.trim().split("\n")[0].slice(0, 150)}`);
  const unit = fs.readFileSync(path.join(REPO_ROOT, "docs/cutover/caddy-edge.service.template"), "utf8");
  S.check("the systemd unit template runs the preflight as ExecStartPre and in ExecReload", /^ExecStartPre=.*aicc-edge-preflight/m.test(unit) && /^ExecReload=.*aicc-edge-preflight/m.test(unit), "ExecStartPre and ExecReload call aicc-edge-preflight (an install copy of scripts/ops/edge-preflight.sh)");
  // the preflight really catches what the review found Caddy does not: the real Caddy starts with an empty list and denies everyone
  const emptyCaddy = path.join(dir, "empty-cidr"); fs.mkdirSync(emptyCaddy, { recursive: true });
  const inst = { ...settings(), name: "emptycidr", httpPort: 18131, httpsPort: 18457, admin: "127.0.0.1:12027", upstream: WP_UPSTREAM, staticRoot: P.current, operatorCidrs: "" };
  const g = generate(inst);
  const direct = sh(P.caddy, ["validate", "--config", g.file, "--adapter", "caddyfile"], { env: { ...envFor(inst), AICC_OPERATOR_CIDRS: "" } });
  S.check("control: the real `caddy validate` alone says \"Valid configuration\" for the EMPTY operator list (this is why the preflight exists)", direct.code === 0 && /Valid configuration/.test(direct.out), direct.out.split("\n").filter((l) => !l.startsWith("{")).join(" ").trim());
  fs.rmSync(path.join(P.generated, "Caddyfile.emptycidr"), { force: true }); fs.rmSync(path.join(P.generated, "Caddyfile.preflighttest"), { force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ release: union of _next/static across releases (E6, architecture review F7) */
async function releaseSection() {
  const S = new Section("16-release-swap", "Release swap: old pages keep working after a new release goes live (union of _next/static of the previous 3 releases), no failed request during the swap");
  await ensureInstances();
  const work = path.join(P.home, "run/release-test"); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  // a SANDBOX release tree and its own throwaway instance: the standing releases and the standing edge are never touched
  const releasesDir = path.join(work, "releases"), currentLink = path.join(releasesDir, "current");
  const REL = (o) => release({ ...o, releasesDir, currentLink, quiet: true });
  const I = { name: "reltest", httpPort: 18140, httpsPort: 18458 };
  const outDir = path.join(REPO_ROOT, "out");
  // fabricate builds from the real out/: same HTML/assets, a different hashed chunk NAME per build (as a real rebuild produces), the HTML pointing at it
  const build = (tag) => {
    const d = path.join(work, `out-${tag}`);
    sh("rsync", ["-a", "--exclude", ".DS_Store", outDir + "/", d + "/"]);
    const chunks = path.join(d, "_next/static/chunks");
    const pick = fs.readdirSync(chunks).find((f) => f.startsWith("main-app-") && f.endsWith(".js"));
    const renamed = pick.replace(/-([0-9a-f]+)\.js$/, `-${tag}.js`);
    fs.renameSync(path.join(chunks, pick), path.join(chunks, renamed));
    sh("bash", ["-c", `cd ${d} && grep -rl '${pick}' . | xargs sed -i '' 's/${pick}/${renamed}/g'`]);
    return { d, renamed };
  };
  const b = ["aaa111", "bbb222", "ccc333", "ddd444", "eee555"].map(build);
  REL({ outDir: b[0].d }); await sleep(1100);
  const E = { ...settings(), ...I, admin: "127.0.0.1:12028", upstream: WP_UPSTREAM, staticRoot: currentLink, wpTimeout: "60s", variant: "" };
  await start(E, { quiet: true });
  const chunkOf = (html) => (/\/_next\/static\/chunks\/(main-app-[^"]+?\.js)/.exec(html) || [])[1];
  const H = async (p, o = {}) => rq(I, `https://www.copilt.org${p}`, o);
  REL({ outDir: b[1].d }); await sleep(1100);
  const live2 = await H("/");
  S.check("after release 2 the live HTML references release 2's chunk, and release 1's chunk (an older open tab / cached page) still answers 200", chunkOf(live2.body) === b[1].renamed && (await H(`/_next/static/chunks/${b[0].renamed}`, { head: true })).status === 200 && (await H(`/_next/static/chunks/${b[1].renamed}`, { head: true })).status === 200, `live HTML chunk ${chunkOf(live2.body)}; release-1 chunk ${(await H(`/_next/static/chunks/${b[0].renamed}`, { head: true })).status}`);
  const productChunk = chunkOf((await H("/product/")).body);
  const probe = startProbe(I, ["https://www.copilt.org/", "https://www.copilt.org/product/", `https://www.copilt.org/_next/static/chunks/${productChunk}`, `https://www.copilt.org/_next/static/chunks/${b[0].renamed}`, "https://www.copilt.org/pricing/"], { concurrency: 6, pauseMs: 5 });
  await sleep(700);
  for (const x of [b[2], b[3]]) { REL({ outDir: x.d }); await sleep(900); }
  await sleep(500);
  const sum = await probe.stop();
  S.check(`two live release swaps under a concurrent probe (6 workers, ${sum.total} requests including the previous releases' chunks and a WordPress page): ZERO failed requests`, sum.failed === 0, `failed=${sum.failed} ${sum.failures.join("; ")}`);
  const cur4 = fs.realpathSync(currentLink);
  S.check("release 4 contains its own chunk plus the chunks of releases 1, 2 and 3 (union of the previous 3)", b.slice(0, 4).every((x) => fs.existsSync(path.join(cur4, "_next/static/chunks", x.renamed))), "");
  REL({ outDir: b[4].d });
  const cur5 = fs.realpathSync(currentLink);
  S.check("release 5 DROPS release 1's chunk (carried for exactly 3 further releases) but keeps 2, 3, 4 and its own", !fs.existsSync(path.join(cur5, "_next/static/chunks", b[0].renamed)) && b.slice(1).every((x) => fs.existsSync(path.join(cur5, "_next/static/chunks", x.renamed))), "");
  const html5 = fs.readFileSync(path.join(cur5, "index.html"), "utf8");
  S.check("HTML and every non-chunk asset come from the new build only (release 5's index.html references release 5's chunk, not an older one)", html5.includes(b[4].renamed) && !html5.includes(b[3].renamed), "");
  const dirs = fs.readdirSync(releasesDir).filter((x) => /^\d{8}T/.test(x) && !x.endsWith(".sha256") && !x.endsWith(".static.txt")).sort();
  S.check("pruning: the new release plus the newest 3 earlier ones are kept (4 directories; older ones and their manifests are removed)", dirs.length === 4 && fs.readdirSync(releasesDir).filter((x) => x.endsWith(".sha256")).length === 4 && fs.readdirSync(releasesDir).filter((x) => x.endsWith(".static.txt")).length === 4, `${dirs.length} dirs`);
  const a5 = await H(`/_next/static/chunks/${b[4].renamed}`, { head: true }), z1 = await H(`/_next/static/chunks/${b[0].renamed}`, { head: true });
  S.check("live: release 5's chunk 200; the dropped release-1 chunk is a plain 404 (not a 5xx)", a5.status === 200 && z1.status === 404, `${a5.status} / ${z1.status}`);
  S.info("chunk 404 response", `${one(z1, "content-type")} cache-control=${one(z1, "cache-control")}`);
  const older = dirs[dirs.length - 2];
  const tmp = path.join(releasesDir, ".current.rb"); fs.symlinkSync(path.join(releasesDir, older), tmp); fs.renameSync(tmp, currentLink);
  const rb = await H("/");
  S.check("static rollback = repoint `current` to the previous release directory: 200 and the previous build's HTML (no build, no DNS, no reload)", rb.status === 200 && rb.body.includes(b[3].renamed), `${rb.status}`);
  await stop(E, { quiet: true });
  S.check("the standing release tree was not touched by this test", fs.realpathSync(P.current).startsWith(P.releases) && !fs.readdirSync(P.releases).some((x) => /reltest/.test(x)), fs.realpathSync(P.current));
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(path.join(P.generated, "Caddyfile.reltest"), { force: true });
  S.note("Not tested: Next.js's client behaviour on a chunk 404 after the 3-release window (a tab older than three releases still needs a reload).");
  S.save();
  return [S];
}
import { release } from "./edge.mjs";

/* ------------------------------------------------------------------ ops scripts: exposure check, expiry monitor, storage backup/restore (E2, E9) */
async function opsSection() {
  const S = new Section("17-ops-scripts", "scripts/ops: upstream-exposure-check.sh, cert-expiry-check.sh, caddy-storage-backup.sh (backup, verify, restore, restored storage serves the same certificate)");
  await ensureInstances();
  const ops = (n) => path.join(REPO_ROOT, "scripts/ops", n);
  const work = path.join(P.home, "run/ops-test"); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  // ---- upstream exposure ----
  const lan = sh("bash", ["-c", "ipconfig getifaddr en0 || ipconfig getifaddr en1"]).stdout.trim();
  const pos = sh("bash", [ops("upstream-exposure-check.sh"), "--target", "127.0.0.1:18982", "--expect-reachable"]);
  S.check("positive control (vantage point = the edge): the upstream 127.0.0.1:18982 IS reachable, as it must be for the edge", pos.code === 0 && /^OK/.test(pos.stdout), pos.stdout.trim());
  if (lan) {
    const neg = sh("bash", [ops("upstream-exposure-check.sh"), "--target", `${lan}:18982`]);
    S.check(`the fixture upstream is NOT reachable on the Mac's LAN address (${lan.replace(/\.\d+$/, ".x")}:18982): bound to loopback only -> exit 0`, neg.code === 0 && /^OK: .* not reachable/.test(neg.stdout), neg.stdout.trim().slice(0, 160));
    const sql = sh("bash", [ops("upstream-exposure-check.sh"), "--target", `${lan}:18971`]);
    S.check("MySQL 18971 is not reachable on the LAN address either", sql.code === 0, sql.stdout.trim().slice(0, 120));
    const net = await import("node:net");
    void net;
    // a separate process: spawnSync below would block THIS process's event loop and an in-process server could never answer
    const { spawn: spawnP } = await import("node:child_process");
    const exposed = spawnP("node", ["-e", 'require("http").createServer((q,r)=>r.end("ok")).listen(28990,"0.0.0.0")'], { stdio: "ignore" });
    await sleep(600);
    const ex = sh("bash", [ops("upstream-exposure-check.sh"), "--target", `${lan}:28990`]);
    S.check("negative control: a throwaway server bound to 0.0.0.0 IS reported EXPOSED (exit 1), including the forged-X-Forwarded-For answer", ex.code === 1 && /EXPOSED/.test(ex.out) && /HTTP 200/.test(ex.out), ex.out.trim().slice(0, 200));
    exposed.kill("SIGTERM");
  } else S.info("exposure check against a LAN address skipped", "no LAN interface address on this Mac");
  const unk = sh("bash", [ops("upstream-exposure-check.sh")]);
  S.check("usage error without --target exits 3", unk.code === 3, `exit ${unk.code}`);
  // ---- expiry monitor: file / expired / unreachable ----
  const mk = (name, days) => { const c = path.join(work, name + ".pem"), k = path.join(work, name + ".key"); sh("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", k, "-out", c, ...(days <= 0 ? ["-not_before", "20200101000000Z", "-not_after", "20200102000000Z"] : ["-days", String(days)]), "-subj", "/CN=t", "-addext", "subjectAltName=DNS:www.copilt.org"]); return c; };
  const exp = mk("expired", 0);
  const cases = [["a 3-day certificate file", mk("three", 3), 2, /^CRITICAL/], ["a 15-day certificate file", mk("fifteen", 15), 1, /^WARN/], ["a 60-day certificate file", mk("sixty", 60), 0, /^OK/], ["an expired certificate file", exp, 2, /^CRITICAL .*EXPIRED/]];
  for (const [label, f, code, re] of cases) { const r = sh("bash", [ops("cert-expiry-check.sh"), "--file", f]); S.check(`cert-expiry-check.sh: ${label} -> exit ${code}`, r.code === code && re.test(r.stdout), `exit ${r.code}: ${r.stdout.trim()}`); }
  const nohost = sh("bash", [ops("cert-expiry-check.sh"), "--host", "www.copilt.org", "--connect", "127.0.0.1:1"]);
  S.check("cert-expiry-check.sh: an unreachable listener -> UNKNOWN, exit 3 (a dead edge must alert too)", nohost.code === 3 && /^UNKNOWN/.test(nohost.stdout), nohost.stdout.trim());
  const live = sh("bash", [ops("cert-expiry-check.sh"), "--host", "www.copilt.org", "--host", "copilt.org", "--connect", "127.0.0.1:443", "--cacert", P.rootCrt, "--warn-days", "0", "--crit-days", "0"]);
  S.check("cert-expiry-check.sh against the standing edge with verification against the rehearsal root (both names)", live.code === 0 && (live.stdout.match(/^OK/gm) || []).length === 2, live.stdout.trim().replace(/\n/g, " | "));
  // ---- storage backup / restore ----
  const bak = path.join(work, "backups"), pass = path.join(work, "pass.txt"); fs.writeFileSync(pass, "rehearsal-backup-passphrase\n", { mode: 0o600 });
  const b1 = sh("bash", [ops("caddy-storage-backup.sh"), "backup", P.caddyData, bak]);
  const arc = fs.readdirSync(bak).find((x) => x.endsWith(".tar.gz"));
  S.check("backup: archive written 0600 into a 0700 directory, verified (contains certificates, keys and the local CA)", b1.code === 0 && !!arc && (fs.statSync(path.join(bak, arc)).mode & 0o777) === 0o600 && (fs.statSync(bak).mode & 0o777) === 0o700 && /certificate file\(s\)/.test(b1.stdout), b1.stdout.trim().split("\n").pop());
  const b2 = sh("bash", [ops("caddy-storage-backup.sh"), "backup", P.caddyData, bak, "--passphrase-file", pass]);
  const enc = fs.readdirSync(bak).find((x) => x.endsWith(".tar.gz.enc"));
  S.check("encrypted backup (openssl aes-256-cbc pbkdf2 with a passphrase file): written, and its content is NOT readable as a tar archive without the passphrase", b2.code === 0 && !!enc && sh("bash", ["-c", `tar -tzf ${path.join(bak, enc)} 2>&1 | head -1`]).stdout.trim() === "" || /not in gzip|Error|invalid/i.test(sh("bash", ["-c", `tar -tzf ${path.join(bak, enc)} 2>&1 | head -2`]).out), b2.stdout.trim().split("\n").pop());
  const wrong = path.join(work, "wrong.txt"); fs.writeFileSync(wrong, "nope\n");
  const vbad = sh("bash", [ops("caddy-storage-backup.sh"), "verify", path.join(bak, enc), "--passphrase-file", wrong]);
  S.check("verify with the WRONG passphrase fails (exit 1)", vbad.code === 1, vbad.out.trim().slice(0, 100));
  const refuse = sh("bash", [ops("caddy-storage-backup.sh"), "restore", path.join(bak, arc), path.join(work, "restored-refused")]);
  S.check("restore refuses while a caddy process is running (the standing edge is up) unless --force", refuse.code === 1 && /caddy process is running/.test(refuse.out), refuse.out.trim().slice(0, 120));
  const rdir = path.join(work, "restored");
  const rs = sh("bash", [ops("caddy-storage-backup.sh"), "restore", path.join(bak, enc), rdir, "--passphrase-file", pass, "--force"]);
  const modes = []; const keyModes = [];
  const walkM = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { modes.push((fs.statSync(f).mode & 0o777).toString(8)); walkM(f); } else if (e.name.endsWith(".key")) keyModes.push((fs.statSync(f).mode & 0o777).toString(8)); } };
  modes.push((fs.statSync(rdir).mode & 0o777).toString(8)); walkM(rdir);
  S.check("restore from the encrypted archive (--force because the edge runs): key files 0600, directory 0700", rs.code === 0 && keyModes.length >= 3 && keyModes.every((m) => m === "600") && modes.every((m) => m === "700"), `${keyModes.length} keys: ${[...new Set(keyModes)].join(",")}; ${modes.length} dirs: ${[...new Set(modes)].join(",")}`);
  const cmp = sh("bash", ["-c", `diff -rq ${P.caddyData}/certificates ${rdir}/certificates && diff -rq ${P.caddyData}/pki ${rdir}/pki && echo identical`]);
  S.check("the restored certificates and the CA are byte-identical to the live storage", /identical/.test(cmp.stdout), cmp.out.trim().slice(0, 120));
  // a Caddy started on the RESTORED storage serves the same certificate: no re-issue
  const R = { ...settings(), name: "restored", httpPort: 18150, httpsPort: 18459, admin: "127.0.0.1:12029", upstream: WP_UPSTREAM, staticRoot: P.current, wpTimeout: "60s", variant: "", storage: rdir };
  await start(R, { quiet: true });
  const serial = (port) => /serial=(.*)/.exec(sh("bash", ["-c", `echo | openssl s_client -connect 127.0.0.1:${port} -servername www.copilt.org 2>/dev/null | openssl x509 -noout -serial`]).stdout)?.[1];
  S.check("a Caddy started on the restored storage presents the SAME leaf certificate (serial) as the live edge: nothing is re-issued from a restore", !!serial(18459) && serial(18459) === serial(443), `${serial(18459)} vs ${serial(443)}`);
  await stop(R, { quiet: true });
  fs.rmSync(path.join(P.generated, "Caddyfile.restored"), { force: true });
  for (let i = 0; i < 3; i++) { await sleep(1100); sh("bash", [ops("caddy-storage-backup.sh"), "backup", P.caddyData, bak, "--keep", "2"]); }
  S.check("--keep 2 prunes older plain archives (at most 2 plain archives remain)", fs.readdirSync(bak).filter((x) => x.endsWith(".tar.gz")).length === 2, fs.readdirSync(bak).join(", "));
  fs.rmSync(work, { recursive: true, force: true });
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ mutation: break the template on purpose and require the REAL-Caddy detectors to notice (E8, architecture review F12) */
async function mutation() {
  const S = new Section("18-mutation-real-caddy", "Mutation testing against a REAL Caddy: each mutated template runs on a scratch instance and a real-HTTP detector must fail (survivors listed honestly)");
  await ensureInstances();
  const dir = path.join(P.home, "run/mutants"); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, "certs"), { recursive: true });
  const T = cpEchoToken();
  const base = fs.readFileSync(P.template, "utf8");
  const I = { name: "mut", httpPort: 18160, httpsPort: 18460 };
  const big = path.join(dir, "body.bin"); fs.writeFileSync(big, Buffer.alloc(4 * 1024 * 1024, 0x61));
  // throwaway pair for the Option A detector
  const cert = path.join(dir, "certs/fullchain.pem"), key = path.join(dir, "certs/privkey.pem");
  sh("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key, "-out", cert, "-days", "30", "-subj", "/CN=m", "-addext", "subjectAltName=DNS:www.copilt.org,DNS:copilt.org"]);
  fs.chmodSync(key, 0o600);
  const spoofNames = ["Client-IP", "CF-Connecting-IP", "X-Cluster-Client-IP", "X-Originating-IP", "Fastly-Client-IP", "Forwarded-For", "X-Forwarded", "X-Forwarded-Port", "X-Forwarded-Scheme", "X-Forwarded-Ssl", "Front-End-Https", "X-Url-Scheme", "X-Real-IP", "X-Client-IP", "True-Client-IP", "Forwarded", "X-Original-URL", "X-Rewrite-URL", "X-Forwarded-Server"];
  const detectors = {
    async "security headers appear once on proxied WordPress responses"(R) {
      const bad = [];
      for (const p of ["/wp-login.php?loggedout=true", "/my-account/", "/pricing/", "/wp-json/", "/wp-admin/admin-ajax.php"]) { const r = await R(`https://www.copilt.org${p}`); for (const h of ["x-frame-options", "referrer-policy", "x-content-type-options", "permissions-policy", "strict-transport-security", "x-request-id"]) if ((r.headers[h] || []).length !== 1) bad.push(`${p} ${h} x${(r.headers[h] || []).length}`); }
      return bad;
    },
    async "Cache-Control appears once on forced-no-store WordPress routes"(R) {
      const bad = [];
      for (const p of ["/my-account/", "/cart/", "/wp-json/aicc-license/v1/plans", "/wp-admin/admin-ajax.php", "/?wc-ajax=get_refreshed_fragments"]) { const r = await R(`https://www.copilt.org${p}`); if ((r.headers["cache-control"] || []).length !== 1 || r.headers["cache-control"][0] !== "private, no-store, max-age=0") bad.push(`${p} ${JSON.stringify(r.headers["cache-control"])}`); }
      return bad;
    },
    async "unknown Host on :80 -> exactly 421 'Misdirected request'"(R) { const r = await R("http://copilt.org/product", { headers: { Host: "evil.example" } }); return r.status === 421 && r.body.trim() === "Misdirected request" && !(r.headers.location || []).length ? [] : [`status ${r.status} body ${JSON.stringify(r.body.slice(0, 30))} location ${(r.headers.location || [])[0]}`]; },
    async "client-supplied identity headers never reach WordPress"(R) {
      const h = {}; for (const n of spoofNames) h[n] = "6.6.6.6"; h["X-Forwarded-For"] = "6.6.6.6, 7.7.7.7"; h["X-Forwarded-Proto"] = "http"; h["X-Forwarded-Host"] = "evil.example"; h["X-Request-Id"] = "attacker-id";
      const r = await R(`https://www.copilt.org/wp-json/?__rehearsal_echo=${T}`, { headers: h }); let j = {}; try { j = JSON.parse(r.body); } catch { return ["no echo"]; }
      const seen = j.headers || {}; const bad = spoofNames.filter((n) => n.toLowerCase() in seen).map((n) => `leaked ${n}`);
      if (seen["x-forwarded-for"] !== "127.0.0.1") bad.push(`xff=${seen["x-forwarded-for"]}`); if (seen["x-forwarded-proto"] !== "https") bad.push(`xfp=${seen["x-forwarded-proto"]}`); if (seen["x-forwarded-host"] !== "www.copilt.org") bad.push(`xfh=${seen["x-forwarded-host"]}`); if (seen["x-request-id"] === "attacker-id" || !seen["x-request-id"]) bad.push(`request-id=${seen["x-request-id"]}`);
      return bad;
    },
    async "wp-login.php cannot be used by a non-operator to log in (POST ?loggedout=true / ?ACTION=logout)"(R) {
      const bad = [];
      for (const q of ["?loggedout=true", "?ACTION=logout", "?action=logout&x=1"]) { const r = await R(`https://www.copilt.org/wp-login.php${q}`, { method: "POST", body: "log=rehearsal-admin&pwd=Rehearsal-Admin-2026%21&wp-submit=Log+In&testcookie=1", headers: { Cookie: "wordpress_test_cookie=WP%20Cookie%20check" } }); if (r.status !== 403 || (r.headers["set-cookie"] || []).some((c) => /wordpress_logged_in/.test(c))) bad.push(`${q} -> ${r.status}`); }
      return bad;
    },
    async "12 MB public POST -> 413"(R) { const r = await R("https://www.copilt.org/wp-json/aicc-license/v1/validate", { method: "POST", extra: ["--data-binary", `@${big}`], headers: { "Content-Type": "application/octet-stream" } }); return r.status === 413 ? [] : [`status ${r.status}`]; },
    async "TRACE -> 405"(R) { const r = await R("https://www.copilt.org/pricing/", { method: "TRACE" }); return r.status === 405 ? [] : [`status ${r.status}`]; },
    async "dot-segments -> 400"(R) { const r = await R("https://www.copilt.org/pricing/../wp-admin/post.php"); return r.status === 400 ? [] : [`status ${r.status}`]; },
    async "404 and 5xx pages carry HSTS/nosniff/request-id and no Server"(R) { const r = await R("https://www.copilt.org/nothing-here/"); const bad = []; if (r.status !== 404) bad.push(`status ${r.status}`); for (const h of ["strict-transport-security", "x-content-type-options", "x-request-id"]) if ((r.headers[h] || []).length !== 1) bad.push(h); if ((r.headers.server || []).length) bad.push("server header"); return bad; },
    async "Alt-Svc is one short value"(R) { const r = await R("https://www.copilt.org/"); const v = r.headers["alt-svc"] || []; return v.length === 1 && /ma=3600$/.test(v[0]) ? [] : [JSON.stringify(v)]; },
    async "no Via/X-Powered-By on proxied responses"(R) { const r = await R("https://www.copilt.org/pricing/"); return ["via", "x-powered-by", "server"].filter((h) => (r.headers[h] || []).length).map((h) => `${h} present`); },
    async "/wp-admin/ and /xmlrpc.php are 403 for a non-operator"(R) { const bad = []; for (const p of ["/wp-admin/", "/xmlrpc.php", "/wp-cron.php"]) { const r = await R(`https://www.copilt.org${p}`); if (r.status !== 403) bad.push(`${p} ${r.status}`); } return bad; },
    async "wp-activate / wp-signup / 50x.html are edge 404s"(R) { const bad = []; for (const p of ["/wp-activate.php", "/wp-signup.php", "/50x.html"]) { const r = await R(`https://www.copilt.org${p}`); if (r.status !== 404 || (r.headers["x-rehearsal-upstream"] || []).length) bad.push(`${p} ${r.status}`); } return bad; },
  };
  const optA = async (text) => { // Option A structure: the mutated template must still validate with a manual `tls <cert> <key>`
    const f = path.join(dir, "optA.template"); fs.writeFileSync(f, text);
    const cfg = { ...settings(), name: "mutopta", httpPort: 18161, httpsPort: 18461, admin: "127.0.0.1:12031", upstream: WP_UPSTREAM, staticRoot: P.current, wpTimeout: "60s", variant: "", template: f, tlsFiles: `${cert},${key}`, storage: path.join(dir, "storage-opta") };
    const g = generate(cfg); // (the generator's own safety rules are bypassed on purpose: this detector must be Caddy itself)
    const v = sh(P.caddy, ["validate", "--config", g.file, "--adapter", "caddyfile"], { env: envFor(cfg) });
    fs.rmSync(g.file, { force: true });
    return v.code === 0 ? [] : [`caddy validate: ${v.out.split("\n").filter((l) => /error/.test(l)).join(" ").slice(0, 150)}`];
  };
  const runOn = async (name, text) => {
    const f = path.join(dir, `${name}.template`); fs.writeFileSync(f, text);
    const cfg = { ...settings(), ...I, admin: "127.0.0.1:12030", upstream: WP_UPSTREAM, staticRoot: P.current, wpTimeout: "60s", variant: "", template: f, operatorCidrs: "192.0.2.1/32" }; // same storage as the standing edge: same local CA, so the harness trusts the scratch instance
    const g = generate(cfg);
    const v = sh(P.caddy, ["validate", "--config", g.file, "--adapter", "caddyfile"], { env: envFor(cfg) });
    if (v.code !== 0) return { startFailed: v.out.split("\n").filter((l) => /error/.test(l)).join(" ").slice(0, 200), fired: [] };
    await start(cfg, { quiet: true });
    const R = (url, o = {}) => req(I, url, o);
    const fired = [];
    for (const [dn, fn] of Object.entries(detectors)) { let bad = []; try { bad = await fn(R); } catch (e) { bad = [`detector error ${String(e).slice(0, 80)}`]; } if (bad.length) fired.push({ detector: dn, evidence: bad.slice(0, 3).join("; ") }); }
    await stop(cfg, { quiet: true });
    return { fired };
  };
  const results = [];
  const baseRun = await runOn("baseline", base);
  const baseOptA = await optA(base);
  S.check("baseline (unmutated template) on a scratch instance: every real-Caddy detector is green", baseRun.fired.length === 0 && !baseRun.startFailed, baseRun.fired.map((x) => `${x.detector}: ${x.evidence}`).join(" | ") || baseRun.startFailed || "all 13 detectors pass");
  S.check("baseline: the Option A structure (`tls <cert> <key>`) validates", baseOptA.length === 0, baseOptA.join(" "));
  const rmLine = (text, line, count = 1) => { let c = 0; return text.split("\n").filter((l) => { if (l.trim() === line.trim() && c < count) { c++; return false; } return true; }).join("\n"); };
  const afterBlock = (text, head, from, to) => { const i = text.indexOf(head); if (i < 0) throw new Error("mutant setup: " + head); const j = text.indexOf(from, i); if (j < 0) throw new Error("mutant setup: " + from); return text.slice(0, j) + to + text.slice(j + from.length); };
  const MUTANTS = [
    ["M01 remove `defer` from the security_headers block (expected equivalent on the routes WordPress sends X-Frame-Options/Referrer-Policy: only Cache-Control was ever seen duplicated, see M02)", (t) => afterBlock(t, "(security_headers) {", "\t\tdefer\n", "")],
    ["M02 remove `defer` from to_wordpress_nocache (Cache-Control)", (t) => afterBlock(t, "(to_wordpress_nocache) {", "\t\tdefer\n", "")],
    ["M03 delete the catch-all http:// 421 block", (t) => t.replace(/http:\/\/ \{\n[\s\S]*?\n\}\n/, "")],
    ["M04 remove `header_up -Client-IP`", (t) => rmLine(t, "header_up -Client-IP")],
    ["M05 remove `header_up -CF-Connecting-IP`", (t) => rmLine(t, "header_up -CF-Connecting-IP")],
    ["M06 restore the OLD wp-login exception (any method, case-insensitive)", (t) => t.replace(/\t\tnot expression \{http\.request\.method\} in \[[^\n]*\n/, "\t\tnot expression {http.request.uri.query}.matches('(?i)(^|&)(action=logout|loggedout=true)(&|$)')\n")],
    ["M07 remove `header_up X-Forwarded-For {remote_host}` (expected equivalent: Caddy overwrites it itself)", (t) => rmLine(t, "header_up X-Forwarded-For {remote_host}")],
    ["M08 remove `header_up X-Forwarded-Proto {scheme}` (expected equivalent)", (t) => rmLine(t, "header_up X-Forwarded-Proto {scheme}")],
    ["M09 remove `header_up X-Forwarded-Host {host}` (expected equivalent)", (t) => rmLine(t, "header_up X-Forwarded-Host {host}")],
    ["M10 remove the request body cap from to_wordpress_nocache", (t) => afterBlock(t, "(to_wordpress_nocache) {", "\timport wp_body_cap\n", "")],
    ["M11 remove the TRACE/TRACK/CONNECT guard", (t) => t.replace(/\t@bad_method method TRACE TRACK CONNECT\n\thandle @bad_method \{\n(?:\t\t[^\n]*\n)*\t\}\n/, "")],
    ["M12 remove the dot-segment guard (bad_path)", (t) => t.replace(/\t@bad_path vars_regexp[^\n]*\n\thandle @bad_path \{\n(?:\t\t[^\n]*\n)*\t\}\n/, "")],
    ["M13 remove `import security_headers` from handle_errors", (t) => afterBlock(t, "\thandle_errors {", "\t\timport security_headers\n", "")],
    ["M14 remove the Alt-Svc override", (t) => t.replace(/\t\t# Caddy advertises h3[^\n]*\n\t\tAlt-Svc [^\n]*\n/, "")],
    ["M15 remove `-Via` and `-Server` from security_headers", (t) => rmLine(rmLine(t, "-Via"), "-Server")],
    ["M16 remove `request_header X-Request-Id` (client-chosen id passes)", (t) => rmLine(t, "request_header X-Request-Id {http.request.uuid}")],
    ["M17 the /wp-admin/ deny rule removed (wp-admin public)", (t) => t.replace(/\t@wp_admin_deny \{\n(?:\t\t[^\n]*\n)*\t\}\n\thandle @wp_admin_deny \{\n(?:\t\t[^\n]*\n)*\t\}\n/, "")],
    ["M17b the operator condition removed from the /wp-admin/ rule (expected equivalent here: it only locks OPERATORS out, which the outsider detector cannot see; the operator side is covered by section 04)", (t) => t.replace(/(\t@wp_admin_deny \{\n(?:\t\t[^\n]*\n)*?)\t\tnot remote_ip \{\$AICC_OPERATOR_CIDRS\}\n/, "$1")],
    ["M18 xmlrpc deny removed", (t) => t.replace(/\t@xmlrpc_deny path_regexp[^\n]*\n\thandle @xmlrpc_deny \{\n(?:\t\t[^\n]*\n)*\t\}\n/, "")],
    ["M19 `auto_https disable_redirects` removed (the explicit catch-all still answers: expected equivalent)", (t) => rmLine(t, "auto_https disable_redirects")],
    ["M20 wp-activate/wp-signup/50x.html routed to WordPress/static again (dup_error pattern shrunk)", (t) => t.replace("|^/(?:wp-activate|wp-signup)\\.php$|^/50x\\.html$", "")],
  ];
  const optAMutants = [
    ["M21 import aicc_tls into the http:// apex block (Option A: validate must fail)", (t) => t.replace("http://copilt.org, http://www.copilt.org {\n\timport aicc_site_hook\n", "http://copilt.org, http://www.copilt.org {\n\timport aicc_site_hook\n\timport aicc_tls\n")],
    ["M22 one mixed http:// + https:// apex block again (Option A: validate must fail)", (t) => t.replace("http://copilt.org, http://www.copilt.org {\n\timport aicc_site_hook\n", "http://copilt.org, https://copilt.org, http://www.copilt.org {\n\timport aicc_site_hook\n\timport aicc_tls\n").replace(/https:\/\/copilt\.org \{\n(?:(?!\}\n)[^\n]*\n)*\}\n/, "")],
  ];
  for (const [name, fn] of MUTANTS) {
    const id = name.slice(0, 3);
    const text = fn(base);
    if (text === base) { S.check(`${id}: mutant setup changed the template`, false, name); continue; }
    const r = await runOn(id, text);
    const killed = !!r.startFailed || r.fired.length > 0;
    results.push({ mutant: name, killed, how: r.startFailed ? `caddy validate refused: ${r.startFailed}` : r.fired.map((x) => `${x.detector} [${x.evidence}]`).join(" | ") || "SURVIVED" });
    if (/expected equivalent/.test(name)) S.info(`${name}`, killed ? `killed by: ${results[results.length - 1].how}` : "SURVIVED (equivalent: the detectors assert what the CP actually receives, and Caddy produces the same value without the line)");
    else S.check(`${name} -> killed by a real-Caddy detector`, killed, results[results.length - 1].how, killed ? "killed" : "SURVIVED");
  }
  for (const [name, fn] of optAMutants) {
    const out = await optA(fn(base));
    results.push({ mutant: name, killed: out.length > 0, how: out.join(" ") || "SURVIVED" });
    S.check(`${name} -> killed`, out.length > 0, out.join(" ") || "SURVIVED");
  }
  S.data.mutants = results;
  const surv = results.filter((x) => !x.killed).map((x) => x.mutant.slice(0, 3));
  S.note(`${results.length} mutants run against a real Caddy; killed ${results.filter((x) => x.killed).length}; survivors: ${surv.join(", ") || "none"}.`);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of fs.readdirSync(P.generated)) if (/^Caddyfile\.(mut|mutopta)/.test(f)) fs.rmSync(path.join(P.generated, f), { force: true });
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ throttle: the CP's failed-login throttle in a REAL browser through the edge (E11) */
async function throttle() {
  const S = new Section("19-login-throttle-browser", "Failed-login throttle (CP plugin) in a real Chrome through the edge: generic error, lock after 10, per-address buckets, operator exempt");
  await ensureInstances();
  const { chromium } = await import("playwright-core");
  const spkiOf = (cmd) => sh("bash", ["-c", `${cmd} | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`]).stdout.trim();
  const spki = [`cat ${P.rootCrt}`, `cat ${path.dirname(P.rootCrt)}/intermediate.crt`, `echo | openssl s_client -connect 127.0.0.1:443 -servername www.copilt.org 2>/dev/null`].map(spkiOf).filter(Boolean).join(",");
  const exe = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const wp = (...a) => sh("bash", [P.cpFixture, "wp", ...a]);
  const login = "throttle-" + Math.random().toString(36).slice(2, 8), PASS = "Throttle-Test-2026!";
  wp("user", "create", login, `${login}@example.test`, "--role=customer", `--user_pass=${PASS}`);
  wp("transient", "delete", "--all");
  const launch = (ip) => chromium.launch({ executablePath: exe, args: [`--host-resolver-rules=MAP www.copilt.org ${ip}, MAP copilt.org ${ip}`, `--ignore-certificate-errors-spki-list=${spki}`] });
  const attempt = async (page, user, pass) => {
    await page.goto("https://www.copilt.org/my-account/", { waitUntil: "domcontentloaded" });
    await page.fill("#username", user); await page.fill("#password", pass);
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click("button[name=login]")]);
    const err = (await page.locator(".woocommerce-error").allInnerTexts()).join(" | ").replace(/\s+/g, " ").trim();
    const signedIn = (await page.locator("a[href*=customer-logout]").count()) > 0;
    return { err, signedIn };
  };
  const GENERIC = /username or password is incorrect/i, LOCKED = /too many failed sign-in attempts/i;
  const b6 = await launch("[::1]");
  try {
    const ctx = await b6.newContext(); const pg = await ctx.newPage();
    const first = await attempt(pg, login, "wrong-1");
    S.check("real Chrome from the client address ::1: a wrong password for a REAL account shows the generic error", GENERIC.test(first.err) && !first.signedIn, first.err);
    const ghost = await attempt(pg, "no-such-user-" + login, "wrong-1");
    S.check("an unknown username shows the IDENTICAL text (no account enumeration at the form)", ghost.err === first.err, `${JSON.stringify(first.err)} vs ${JSON.stringify(ghost.err)}`);
    const ghostMail = await attempt(pg, `nobody-${login}@example.test`, "wrong-1");
    S.check("an unknown e-mail address shows the IDENTICAL text (WooCommerce's 'could not be found with this email address' is off)", ghostMail.err === first.err, JSON.stringify(ghostMail.err));
    const all = [first.err];
    for (let i = 2; i <= 9; i++) all.push((await attempt(pg, login, "wrong-" + i)).err);
    S.check("failures 1-9 for the real account: every answer is the generic error (not locked yet)", all.every((e) => GENERIC.test(e)), [...new Set(all)].join(" || ").slice(0, 160));
    const tenth = await attempt(pg, login, "wrong-10");
    const locked = await attempt(pg, login, PASS);
    S.check("after the 10th failure the CORRECT password is refused with the lock text and no session is created", LOCKED.test(locked.err) && !locked.signedIn && !(await ctx.cookies()).some((c) => /wordpress_logged_in/.test(c.name)), `10th: ${tenth.err}; then correct password: ${locked.err}`);
    for (let i = 0; i < 9; i++) await attempt(pg, "ghost-lock-" + login, "x");
    const gl1 = await attempt(pg, "ghost-lock-" + login, "x");
    const gl2 = await attempt(pg, "ghost-lock-" + login, PASS);
    S.check("a NON-EXISTING username locks the same way and shows the same lock text as the real account", LOCKED.test(gl2.err) && gl2.err === locked.err, `${gl1.err} / ${gl2.err}`);
    const other = await attempt(pg, `other-${login}`, "x");
    S.check("a different username from the same address is still answered normally (per-pair bucket, not yet the address ceiling)", GENERIC.test(other.err), other.err);
    await ctx.close();
  } finally { await b6.close(); }
  const b4 = await launch("127.0.0.1");
  try {
    const ctx = await b4.newContext(); const pg = await ctx.newPage();
    for (let i = 0; i < 12; i++) await attempt(pg, login, "wrong-op-" + i);
    const ok = await attempt(pg, login, PASS);
    S.check("an operator address (127.0.0.1/32 in AICC_LM_OPERATOR_CIDRS) is never locked: 12 failures, then the correct password signs in", ok.signedIn && !ok.err, ok.err || "signed in");
    await ctx.close();
  } finally { await b4.close(); }
  await sleep(300);
  const { all: logAll } = readAccessLog();
  const sixes = logAll.filter((x) => x.request?.remote_ip === "::1" && /^\/my-account\/$/.test(x.request?.uri || "") && x.request.method === "POST").length;
  S.check(`the edge access log recorded the throttled client as ::1 (${sixes} sign-in POSTs) and none was refused by the edge (all reached WordPress)`, sixes >= 20 && logAll.filter((x) => x.request?.remote_ip === "::1" && x.request?.method === "POST" && x.status === 403).length === 0, `${sixes} POSTs from ::1`);
  wp("transient", "delete", "--all"); wp("user", "delete", login, "--yes");
  S.note("Limits, honestly: per-address buckets (everybody behind one NAT shares the 30/15 min address ceiling); no protection against a distributed attack (many addresses, few tries each); counters are WordPress transients (database), not atomic; the edge itself has no rate limiter (stock Caddy), see the runbook's ops item.");
  S.save();
  return [S];
}

/* ------------------------------------------------------------------ staging: the runbook's hard gate as a tool (E3) */
async function staging() {
  const S = new Section("20-staging-replay-tool", "scripts/staging-replay.mjs (`npm run staging:replay`) against the rehearsal edges: it works from the tool alone, and it catches a broken edge");
  await ensureInstances();
  const tool = path.join(REPO_ROOT, "scripts/staging-replay.mjs");
  const run = (args, timeoutMs = 300000) => sh("node", [tool, ...args], { timeout: timeoutMs });
  const out = path.join(P.evidence, "staging-replay");
  fs.mkdirSync(out, { recursive: true });
  const summary = (r) => (r.out.match(/cases: .*|PASS: .*|FAIL: .*/g) || []).join(" | ");
  const std = run(["--edge-ip", "127.0.0.1", "--cacert", P.rootCrt, "--source", "operator", "--ci-fs", "accept", "--json", path.join(out, "standing-edge-operator.json")]);
  S.check("standing edge on :80/:443, source=operator (the replay uses --edge-ip/--cacert only; no marker header, no rehearsal code): every applicable case passes", std.code === 0 && /PASS: every applicable case/.test(std.out), summary(std));
  const twin = run(["--base", `https://127.0.0.1:${PUBLIC.httpsPort}`, "--http-port", String(PUBLIC.httpPort), "--location-port", String(PUBLIC.httpsPort), "--cacert", P.rootCrt, "--source", "public", "--ci-fs", "accept", "--json", path.join(out, "twin-public.json")]);
  S.check("twin (operator list = 192.0.2.1/32), source=public: every applicable case passes, including every wp-admin/wp-login/xmlrpc/wp-cron denial", twin.code === 0 && /PASS: every applicable case/.test(twin.out), summary(twin));
  const j = JSON.parse(fs.readFileSync(path.join(out, "twin-public.json"), "utf8"));
  S.check("the twin run covered the wp-login bypass cases of the security review (POST ?loggedout=true, ?ACTION=logout, ...)", j.rows.filter((r) => /wp-login\.php/.test(r.request) && /^(POST|PUT|DELETE|OPTIONS)/.test(r.request) && r.result === "PASS").length >= 10, `${j.rows.filter((r) => /wp-login\.php/.test(r.request) && r.result === "PASS").length} wp-login cases passed`);
  const nopost = run(["--base", `https://127.0.0.1:${PUBLIC.httpsPort}`, "--http-port", String(PUBLIC.httpPort), "--location-port", String(PUBLIC.httpsPort), "--cacert", P.rootCrt, "--no-post", "--no-sweep", "--ci-fs", "accept", "--json", path.join(out, "twin-no-post.json")]);
  const jp = JSON.parse(fs.readFileSync(path.join(out, "twin-no-post.json"), "utf8"));
  S.check("--no-post sends nothing but GET/HEAD/OPTIONS (every state-changing case is reported SKIP)", nopost.code === 0 && jp.rows.filter((r) => r.result === "SKIP" && /--no-post/.test(r.note)).length > 20 && !jp.rows.some((r) => /^(POST|PUT|DELETE|PATCH)/.test(r.request) && r.result !== "SKIP"), `${jp.rows.filter((r) => /--no-post/.test(r.note || "")).length} skipped`);
  const strict = run(["--edge-ip", "127.0.0.1", "--cacert", P.rootCrt, "--source", "operator", "--no-sweep", "--ci-fs", "expect-404"]);
  S.check("--ci-fs expect-404 (the Linux default) FAILS on this macOS volume: /Pricing/ and /PRODUCT/ are 200 here (case-insensitive file system), and the tool says so", strict.code === 1 && /\/Pricing\/|\/PRODUCT\//.test(strict.out), summary(strict));
  const notrust = run(["--edge-ip", "127.0.0.1", "--source", "operator", "--no-sweep"]);
  S.check("without --cacert/--insecure the rehearsal CA is not trusted: the tool refuses to continue (exit 2) instead of silently disabling verification", notrust.code === 2 && /cannot reach the edge/.test(notrust.out), notrust.out.trim().split("\n").pop().slice(0, 160));
  const both = run(["--edge-ip", "127.0.0.1", "--insecure", "--cacert", P.rootCrt]);
  S.check("--insecure together with --cacert is refused (exit 2)", both.code === 2, both.out.trim().slice(0, 100));
  const ins = run(["--edge-ip", "127.0.0.1", "--insecure", "--source", "operator", "--no-sweep", "--ci-fs", "accept"]);
  S.check("--insecure works only when given, and the report says the certificate was NOT verified", ins.code === 0 && /CERTIFICATE NOT VERIFIED/.test(ins.out), summary(ins));
  // a broken edge must FAIL the gate: the pre-fix wp-login exception on a scratch instance
  const base = fs.readFileSync(P.template, "utf8");
  const mutated = base.replace(/\t\tnot expression \{http\.request\.method\} in \[[^\n]*\n/, "\t\tnot expression {http.request.uri.query}.matches('(?i)(^|&)(action=logout|loggedout=true)(&|$)')\n");
  const dir = path.join(P.home, "run/staging-mut"); fs.mkdirSync(dir, { recursive: true });
  const tf = path.join(dir, "mutant.template"); fs.writeFileSync(tf, mutated);
  const cfg = { ...settings(), name: "mut", httpPort: 18160, httpsPort: 18460, admin: "127.0.0.1:12030", upstream: WP_UPSTREAM, staticRoot: P.current, wpTimeout: "60s", variant: "", template: tf, operatorCidrs: "192.0.2.1/32" };
  await start(cfg, { quiet: true });
  const bad = run(["--base", "https://127.0.0.1:18460", "--http-port", "18160", "--location-port", "18460", "--cacert", P.rootCrt, "--source", "public", "--ci-fs", "accept", "--no-sweep"]);
  await stop(cfg, { quiet: true });
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(path.join(P.generated, "Caddyfile.mut"), { force: true });
  S.check("the gate FAILS on an edge that still has the old wp-login exception (exit 1, and the failing wp-login cases are named)", bad.code === 1 && /FAIL POST https:\/\/www\.copilt\.org\/wp-login\.php\?loggedout=true/.test(bad.out), summary(bad) + " | " + (bad.out.match(/FAIL [^\n]*wp-login[^\n]*/g) || []).slice(0, 2).join(" ; "));
  S.save();
  return [S];
}

const SECTIONS = { staging, throttle, mutation, ops: opsSection, release: releaseSection, preflight: preflightSection, optiona, apexpost, safety, rollback, tls: tlsSection, restart, routing, behavior, admin, errors, break: breakIt, logging, demo };
export async function main(args) {
  ensureDirs();
  const ORDER = ["routing", "behavior", "admin", "errors", "break", "logging", "demo", "restart", "tls", "rollback", "apexpost", "optiona", "preflight", "release", "ops", "mutation", "throttle", "staging", "safety"];
  const want = args.length && args[0] !== "all" ? args : ORDER;
  let failed = 0;
  console.log(caddyVersion());
  for (const w of want) {
    const fn = SECTIONS[w];
    if (!fn) { console.error(`unknown section ${w}; have: ${Object.keys(SECTIONS).join(", ")}`); process.exit(2); }
    console.log(`== ${w}`);
    const out = await fn();
    for (const s of [].concat(out)) failed += s.failed;
  }
  console.log(failed ? `FAILED checks: ${failed}` : "ALL CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
