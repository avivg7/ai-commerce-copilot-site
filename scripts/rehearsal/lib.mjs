// Shared paths, process helpers and an HTTP client for the AICC edge rehearsal (docs/cutover/rehearsal.md).
// Everything runtime-generated lives under REHEARSAL_HOME (default ~/aicc-rehearsal), never in a repo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const HOME = process.env.AICC_REHEARSAL_HOME || path.join(os.homedir(), "aicc-rehearsal");
export const P = {
  home: HOME,
  caddy: process.env.AICC_REHEARSAL_CADDY || path.join(HOME, "bin/caddy"),
  generated: path.join(HOME, "generated"),
  run: path.join(HOME, "run"),
  logs: path.join(HOME, "logs"),
  releases: path.join(HOME, "releases"),
  current: path.join(HOME, "releases/current"),
  caddyData: path.join(HOME, "caddy/data"),
  caddyConfig: path.join(HOME, "caddy/config"),
  mail: path.join(HOME, "mail"),
  evidence: path.join(os.homedir(), "Downloads/AICC-cutover-evidence/rehearsal"),
  rootCrt: path.join(HOME, "caddy/data/pki/authorities/local/root.crt"),
  template: path.join(REPO, "docs/cutover/Caddyfile.edge.template"),
  fiftyxx: path.join(REPO, "docs/cutover/50x.html"),
  cpFixture: path.join(REPO, "scripts/rehearsal/cp-fixture.sh"),
  cpBase: path.join(HOME, "cp"),
};
export const HOSTS = { www: "www.copilt.org", apex: "copilt.org" };
export const WP_UPSTREAM = "127.0.0.1:18982";
export const OPERATOR_DEFAULT = "127.0.0.1/32 ::1/128";

/** Named edge instances. `edge` is the standing one on the real ports 80/443; others use high ports (public-source simulation, rollback). */
export const INSTANCES = {
  edge: { name: "edge", httpPort: 80, httpsPort: 443, admin: "127.0.0.1:12019", operatorCidrs: OPERATOR_DEFAULT },
  public: { name: "public", httpPort: 18080, httpsPort: 18443, admin: "127.0.0.1:12020", operatorCidrs: "192.0.2.1/32" },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => Number(process.hrtime.bigint() / 1000000n);
export function ensureDirs() {
  for (const d of [P.generated, P.run, P.logs, P.releases, P.caddyData, P.caddyConfig, P.mail, P.evidence]) fs.mkdirSync(d, { recursive: true });
  fs.chmodSync(P.caddyData, 0o700);
}
export function readPid(name) { try { return Number(fs.readFileSync(path.join(P.run, `${name}.pid`), "utf8").trim()); } catch { return 0; } }
export function alive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
export function portListening(port, host = "127.0.0.1") { return new Promise((r) => { const s = net.connect({ port, host }); s.setTimeout(800); s.on("connect", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); s.on("timeout", () => { s.destroy(); r(false); }); }); }
export async function waitFor(fn, ms = 20000, step = 100) { const t0 = now(); while (now() - t0 < ms) { if (await fn()) return now() - t0; await sleep(step); } return -1; }

/** The URL a client uses for `https://www.copilt.org/x` on an instance (adds the instance port when it is not 80/443). */
export function urlFor(inst, url) {
  const m = /^(https?):\/\/([^/?#]+)(.*)$/s.exec(url);
  if (!m) throw new Error(`not an absolute URL: ${url}`);
  const port = m[1] === "https" ? inst.httpsPort : inst.httpPort;
  const std = m[1] === "https" ? 443 : 80;
  return `${m[1]}://${m[2]}${port === std ? "" : ":" + port}${m[3]}`;
}
/** Strip an instance port back out of a Location so it compares with the production-shaped expectation. */
export function stripPort(inst, loc) { return loc ? loc.replace(new RegExp(`^(https?://[^/:]+):(${inst.httpPort}|${inst.httpsPort})(?=/|$)`), "$1") : loc; }

function parseHeaderBlock(text) {
  const blocks = text.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b));
  const last = blocks[blocks.length - 1] || "";
  const lines = last.split(/\r?\n/);
  const status = Number((/^HTTP\/\S+\s+(\d{3})/.exec(lines[0]) || [])[1] || 0);
  const headers = {}, raw = [];
  for (const l of lines.slice(1)) { const i = l.indexOf(":"); if (i < 0) continue; const k = l.slice(0, i).toLowerCase(); const v = l.slice(i + 1).trim(); raw.push([l.slice(0, i), v]); (headers[k] ||= []).push(v); }
  return { status, headers, raw, proto: (/^(HTTP\/\S+)/.exec(lines[0]) || [])[1], blocks: blocks.length };
}
/**
 * One request through a real edge instance with curl. Never follows redirects unless follow=true. Resolves the rehearsal names to 127.0.0.1 for THIS process only
 * (--resolve; no /etc/hosts, no DNS) and trusts the rehearsal root CA (--cacert). `url` is written as production would see it (https://www.copilt.org/...).
 */
export async function req(inst, url, o = {}) {
  const args = ["-sS", "--path-as-is", "-D", "-", "-o", o.head ? "/dev/null" : o.bodyFile || "-", "--max-time", String(o.timeout || 30), "--cacert", P.rootCrt];
  for (const h of Object.values(HOSTS)) for (const port of [inst.httpsPort, inst.httpPort]) args.push("--resolve", `${h}:${port}:${o.connectIp || "127.0.0.1"}`);
  if (o.ipv6) args.push("-6");
  if (o.http === "1.1") args.push("--http1.1"); else if (o.http === "2") args.push("--http2"); else args.push("--http1.1");
  if (o.head) args.push("-I");
  if (o.method && !o.head) args.push("-X", o.method);
  // On a high-port instance curl would send `Host: www.copilt.org:18443`; WordPress then "canonicalises" it away and loops. Send the production-shaped Host.
  const hm = /^https?:\/\/([^/?#:]+)/.exec(url);
  if (hm && !Object.keys(o.headers || {}).some((k) => k.toLowerCase() === "host") && ((url.startsWith("https") ? inst.httpsPort !== 443 : inst.httpPort !== 80))) args.push("-H", `Host: ${hm[1]}`);
  for (const [k, v] of Object.entries(o.headers || {})) args.push("-H", `${k}: ${v}`);
  if (o.cookie) args.push("-H", `Cookie: ${o.cookie}`);
  if (o.body !== undefined) args.push("--data-binary", o.body);
  if (o.follow) args.push("-L", "--max-redirs", "5");
  if (o.compressed) args.push("--compressed");
  if (o.extra) args.push(...o.extra);
  args.push("-w", "\n__CURL__%{http_code} %{time_total} %{size_download} %{http_version} %{num_redirects} %{url_effective} %{remote_ip}");
  args.push(urlFor(inst, url));
  const t0 = now();
  let out = "";
  try { const r = await execFileP("curl", args, { maxBuffer: 256 * 1024 * 1024, encoding: "buffer" }); out = r.stdout.toString("latin1"); } catch (e) { if (e.stdout && e.stdout.length) out = e.stdout.toString("latin1"); else return { status: 0, error: String(e.message).slice(0, 300), headers: {}, ms: now() - t0, body: "" }; }
  const i = out.lastIndexOf("\n__CURL__");
  const meta = (out.slice(i + 9) || "").split(" ");
  const pre = out.slice(0, i);
  const sep = pre.search(/\r?\n\r?\n(?!HTTP\/)/);
  // with -o - the body follows the last header block
  let headText = pre, body = "";
  const all = pre.split(/\r?\n\r?\n/);
  let k = 0; while (k < all.length && /^HTTP\//.test(all[k])) k++;
  headText = all.slice(0, k).join("\r\n\r\n"); body = all.slice(k).join("\r\n\r\n");
  void sep;
  const h = parseHeaderBlock(headText);
  return { ...h, body, ms: Math.round(Number(meta[1]) * 1000) || now() - t0, bytes: Number(meta[2]), httpVersion: meta[3], redirects: Number(meta[4]), effective: meta[5], remoteIp: meta[6], reqId: (h.headers["x-request-id"] || [])[0] };
}

/** A raw TLS (or plain) request: exact bytes on the wire, for malformed/smuggling-style inputs that curl would repair. Resolves with the response text. */
export function rawRequest(inst, text, { secure = true, servername = HOSTS.www, timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    let buf = "";
    const done = (extra) => resolve({ text: buf, ...extra });
    const onConnect = (s) => { s.write(text); };
    const s = secure ? tls.connect({ host: "127.0.0.1", port: inst.httpsPort, servername, ca: fs.readFileSync(P.rootCrt), ALPNProtocols: ["http/1.1"] }, () => onConnect(s)) : net.connect({ host: "127.0.0.1", port: inst.httpPort }, () => onConnect(s));
    s.setTimeout(timeout, () => { s.destroy(); done({ timedOut: true }); });
    s.on("data", (d) => { buf += d.toString("latin1"); });
    s.on("end", () => done({ ended: true }));
    s.on("close", () => done({ closed: true }));
    s.on("error", (e) => done({ error: e.code || String(e.message) }));
  });
}

/**
 * Parse the JSON access logs of EVERY instance into a Map(request_id -> entry): logs/aicc-edge*.log (the standing edge) and logs/<instance>/aicc-edge*.log (the others),
 * including files already rolled by Caddy (aicc-edge-<timestamp>.log and .log.gz). Review F12: the owner proof used to read one shared file and turned into
 * "no log entry" for every case after the first 20 MiB roll.
 */
export function readAccessLog() {
  const m = new Map(), all = [];
  const dirs = [P.logs, ...fs.readdirSync(P.logs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(P.logs, e.name))];
  for (const d of dirs) {
    for (const f of fs.readdirSync(d).filter((x) => /^aicc-edge.*\.log(\.gz)?$/.test(x)).sort()) {
      const full = path.join(d, f);
      const text = f.endsWith(".gz") ? spawnSync("gunzip", ["-c", full], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).stdout : fs.readFileSync(full, "utf8");
      for (const l of text.split("\n")) { if (!l.trim()) continue; try { const j = JSON.parse(l); all.push(j); if (j.request_id) m.set(j.request_id, j); } catch { /* partial line */ } }
    }
  }
  return { map: m, all };
}
export function sh(cmd, args, o = {}) { const r = spawnSync(cmd, args, { encoding: "utf8", ...o }); return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), stdout: r.stdout || "" }; }
export function caddyVersion() { return execFileSync(P.caddy, ["version"], { encoding: "utf8" }).trim(); }
export function cpEchoToken() { return fs.readFileSync(path.join(P.cpBase, "echo-token"), "utf8").trim(); }
export function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }
export function md5(s) { return execFileSync("md5", ["-q"], { input: s, encoding: "utf8" }).trim(); }

/** Resolve a Location against the URL that produced it (production-shaped, port stripped). */
export function resolveLocation(inst, from, loc) {
  const l = stripPort(inst, loc);
  if (/^https?:\/\//.test(l)) return l;
  const u = new URL(from);
  return new URL(l, `${u.protocol}//${u.host}${u.pathname}${u.search}`).href;
}
/** Is the volume holding the release directory case-insensitive (APFS default)? Production (Linux) is case-sensitive. */
export function fsCaseInsensitive() {
  const d = P.home;
  const f = path.join(d, ".CaseProbe"); fs.writeFileSync(f, "x"); const r = fs.existsSync(path.join(d, ".caseprobe")); fs.rmSync(f); return r;
}

/** A light concurrent prober: workers request the given URLs in a loop through a real edge until stop(); returns per-request records and outage windows. */
import https from "node:https";
export function startProbe(inst, urls, { concurrency = 4, pauseMs = 15, timeoutMs = 4000, hostHeader = true } = {}) {
  const ca = fs.readFileSync(P.rootCrt);
  const agent = new https.Agent({ ca, keepAlive: false });
  const recs = [];
  let running = true, i = 0;
  const t0 = now();
  const one = (u) => new Promise((resolve) => {
    const url = new URL(u);
    const start = now();
    const r = https.request({ host: "127.0.0.1", port: inst.httpsPort, servername: url.hostname, method: "GET", path: url.pathname + url.search, headers: hostHeader ? { Host: url.hostname } : {}, agent, timeout: timeoutMs }, (res) => { res.resume(); res.on("end", () => resolve({ t: start - t0, ms: now() - start, status: res.statusCode, url: u })); });
    r.on("timeout", () => { r.destroy(); resolve({ t: start - t0, ms: now() - start, status: 0, err: "timeout", url: u }); });
    r.on("error", (e) => resolve({ t: start - t0, ms: now() - start, status: 0, err: e.code || String(e.message).slice(0, 40), url: u }));
    r.end();
  });
  const workers = Array.from({ length: concurrency }, async () => { while (running) { const u = urls[i++ % urls.length]; recs.push(await one(u)); await sleep(pauseMs); } });
  return {
    t0,
    async stop() {
      running = false; await Promise.all(workers);
      const bad = recs.filter((r) => r.status === 0 || r.status >= 500);
      const sorted = [...recs].sort((a, b) => a.t - b.t);
      // an outage window = from the first failure to the next success that STARTED after it
      let outage = 0; let firstFail = null;
      for (const r of sorted) { if (r.status === 0 || r.status >= 500) { if (firstFail === null) firstFail = r.t; } else if (firstFail !== null && r.t >= firstFail) { outage = Math.max(outage, r.t - firstFail); firstFail = null; } }
      if (firstFail !== null) outage = Math.max(outage, sorted[sorted.length - 1].t - firstFail);
      return { total: recs.length, failed: bad.length, failures: bad.slice(0, 8).map((r) => `${r.url} ${r.status || r.err} @${r.t}ms`), maxLatencyMs: Math.max(0, ...recs.map((r) => r.ms)), outageMs: outage, durationMs: now() - t0 };
    },
  };
}

/** Every edge log file (access, error, stdout), all instances, rolled files included; the CP fixture's own logs (cp-*) excluded. */
export function allEdgeLogFiles() {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(log|gz)$/.test(e.name) && !/^cp-/.test(e.name)) out.push(f); } };
  walk(P.logs);
  return out;
}
export const readLogFile = (f) => (f.endsWith(".gz") ? spawnSync("gunzip", ["-c", f], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).stdout : fs.readFileSync(f, "utf8"));
