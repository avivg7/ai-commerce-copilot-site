// Shared paths, process helpers and an HTTP client for the AICC edge rehearsal (docs/cutover/rehearsal.md).
// Everything runtime-generated lives under REHEARSAL_HOME (default ~/aicc-rehearsal), never in a repo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { TargetGuard, buildConfig, installDnsGuard, loopbackFetch, loopbackCurl, loopbackConnect } from "../lib/target-guard.mjs";
export { loopbackFetch, loopbackCurl };

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
  stageIdFile: path.join(HOME, "run/stage-id"),
  fpmBase: path.join(HOME, "scratch-fpm"),
  fpmSocket: path.join(HOME, "scratch-fpm/aicc-cp.sock"),
  fpmScript: path.join(REPO, "scripts/rehearsal/fpm.sh"),
  wpRoot: path.join(HOME, "cp/wp"),
};
export const HOSTS = { www: "www.copilt.org", apex: "copilt.org" };
export const WP_UPSTREAM = "127.0.0.1:18982";
/** The OPTIONAL public-listener operator CIDR list. Since the operator listener (owner decision 2026-10-21) it is EMPTY by default everywhere. */
export const OPERATOR_DEFAULT = "";
/** The label the rehearsal edge's identity route reports as its host (never resolved, never dialled: the connection is always forced to 127.0.0.1). */
export const STAGE_REHEARSAL_HOST = "stage-rehearsal.copilt.org";
/** "proxy" = reverse_proxy to the php -S fixture (the original rehearsal); "fastcgi" = php_fastcgi over a unix socket to the scratch php-fpm (the Linux architecture). Env AICC_REHEARSAL_UPSTREAM. */
export const UPSTREAM_MODE = process.env.AICC_REHEARSAL_UPSTREAM === "fastcgi" ? "fastcgi" : "proxy";

/** Named edge instances. `edge` is the standing one on the real ports 80/443; others use high ports (public-source simulation, rollback). */
export const INSTANCES = {
  edge: { name: "edge", httpPort: 80, httpsPort: 443, admin: "127.0.0.1:12019", operatorPort: 18444, operatorCidrs: OPERATOR_DEFAULT },
  // the "public-source" twin: high ports, loopback only. Its optional CIDR list names an address nobody has, so no loopback client is an operator through the CIDR extra
  public: { name: "public", httpPort: 18080, httpsPort: 18443, admin: "127.0.0.1:12020", operatorPort: 18445, operatorCidrs: "192.0.2.1/32" },
  // the STAGE topology on this Mac (one public address, no apex): the same render the Linux staging host gets, with local certificates
  stage: { name: "stage", httpPort: 18200, httpsPort: 18463, admin: "127.0.0.1:12040", operatorPort: 18464, operatorCidrs: OPERATOR_DEFAULT, topology: "stage", stageHost: STAGE_REHEARSAL_HOST },
};

/** The rehearsal edge's identity id (what `--stage-id` must equal). Random, created once, stored under ~/aicc-rehearsal/run (never in a repo). */
export function stageId() {
  try { const v = fs.readFileSync(P.stageIdFile, "utf8").trim(); if (/^[0-9a-f]{24}$/.test(v)) return v; } catch { /* create */ }
  fs.mkdirSync(path.dirname(P.stageIdFile), { recursive: true });
  const v = crypto.randomBytes(12).toString("hex");
  fs.writeFileSync(P.stageIdFile, v + "\n", { mode: 0o600 });
  return v;
}

/**
 * The guard configuration of a rehearsal instance: the staging label host (never dialled by name), 127.0.0.1, the instance's ports, the rehearsal id, and, for the production-topology
 * instances, the production NAMES as aliases. The guard dials 127.0.0.1 only and never resolves these names, so nothing can leave the machine (docs/cutover/rehearsal.md "Fail-closed tooling").
 */
export function rehearsalConfig(nameOrInst = "edge", { operator = false } = {}) {
  const inst = typeof nameOrInst === "object" ? nameOrInst : INSTANCES[nameOrInst];
  if (!inst) throw new Error(`unknown rehearsal instance ${nameOrInst}; have ${Object.keys(INSTANCES).join(", ")}`);
  const operatorPort = operatorPortOf(inst);
  const stage = inst.topology === "stage";
  return {
    rehearsal: true,
    stageHost: STAGE_REHEARSAL_HOST,
    stageIp: "127.0.0.1",
    port: operator ? operatorPort : inst.httpsPort,
    httpPort: operator ? null : inst.httpPort,
    stageId: stageId(),
    aliasHosts: stage ? [] : [HOSTS.www, HOSTS.apex],
    identityVia: stage ? STAGE_REHEARSAL_HOST : HOSTS.www,
    cacert: inst.cacert || P.rootCrt,
    auditFile: auditFileFor(),
  };
}
/** The egress audit (JSONL, one record per checked request). Default ~/aicc-rehearsal/logs/guard-audit.jsonl, rolled over at 20 MB; AICC_GUARD_AUDIT_FILE overrides it (a final proof run uses a fresh file). */
function auditFileFor() {
  if (process.env.AICC_GUARD_AUDIT_FILE) return process.env.AICC_GUARD_AUDIT_FILE;
  const f = path.join(P.logs, "guard-audit.jsonl");
  try { if (fs.statSync(f).size > 20 * 1024 * 1024) fs.renameSync(f, f + ".1"); } catch { /* none yet */ }
  return f;
}
const GUARDS = new Map();
/** The (memoised) TargetGuard for an instance's public or operator listener. Identity is verified once per process and listener. */
export function guardFor(inst, { operator = false } = {}) {
  const key = `${inst.name}:${inst.httpsPort}:${operator ? "op" : "pub"}`;
  if (!GUARDS.has(key)) { const g = new TargetGuard(buildConfig(rehearsalConfig(inst, { operator }))); GUARDS.set(key, g); installOnce(g); }
  return GUARDS.get(key);
}
let DNS_GUARD_INSTALLED = false;
function installOnce(g) { if (!DNS_GUARD_INSTALLED) { DNS_GUARD_INSTALLED = true; installDnsGuard(g); } }
/** All guards created in this process (final egress report). */
export const allGuards = () => [...GUARDS.values()];
const IDENT = new Map();
/** Verify the identity of an instance's public (and operator) listener NOW, while it is healthy; later config swaps (no-certs windows, the old-target stand-in) do not re-verify. */
export async function verifyInstance(inst, { operator = true } = {}) { await verified(guardFor(inst)); if (operator) await verified(guardFor(inst, { operator: true })); }
async function verified(g) { if (!IDENT.has(g)) IDENT.set(g, g.ensureIdentity()); try { await IDENT.get(g); } catch (e) { IDENT.delete(g); throw e; } return g; }

/**
 * The loopback operator listener's port of an instance: an EXPLICIT one (--operator-port), else the named standing instance's (edge 18444, public 18445, stage 18464), else its https port + 1000.
 * A scratch instance built with `{...INSTANCES.public, name: "slow"}` therefore never inherits the twin's operator port.
 */
export const operatorPortOf = (s) => (s.operatorPortExplicit ? s.operatorPort : INSTANCES[s.name]?.operatorPort ?? s.httpsPort + 1000);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => Number(process.hrtime.bigint() / 1000000n);
export function ensureDirs() {
  for (const d of [P.generated, P.run, P.logs, P.releases, P.caddyData, P.caddyConfig, P.mail, P.evidence]) fs.mkdirSync(d, { recursive: true });
  fs.chmodSync(P.caddyData, 0o700);
}
export function readPid(name) { try { return Number(fs.readFileSync(path.join(P.run, `${name}.pid`), "utf8").trim()); } catch { return 0; } }
export function alive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
export function portListening(port, host = "127.0.0.1") { return new Promise((r) => { const s = loopbackConnect(port, host); s.setTimeout(800); s.on("connect", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); s.on("timeout", () => { s.destroy(); r(false); }); }); }
export async function waitFor(fn, ms = 20000, step = 100) { const t0 = now(); while (now() - t0 < ms) { if (await fn()) return now() - t0; await sleep(step); } return -1; }

/** The URL a client uses for `https://www.copilt.org/x` on an instance. The port is ALWAYS explicit (the guard refuses a URL without one): the instance's https/http port, or the operator listener's. */
export function urlFor(inst, url, { operator = false } = {}) {
  const m = /^(https?):\/\/([^/?#]+)(.*)$/s.exec(url);
  if (!m) throw new Error(`not an absolute URL: ${url}`);
  const port = operator ? operatorPortOf(inst) : m[1] === "https" ? inst.httpsPort : inst.httpPort;
  return `${m[1]}://${m[2].replace(/:\d+$/, "")}:${port}${m[3]}`;
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
 * One request through a real edge instance with curl, THROUGH THE TARGET GUARD (scripts/lib/target-guard.mjs): the guard supplies the connect-to mapping to 127.0.0.1, checks the URL
 * (explicit port, allowed host), refuses state-changing methods until the rehearsal identity route has been verified, and never lets curl follow a redirect. `url` is written as production
 * would see it (https://www.copilt.org/...); `operator: true` sends it to the instance's loopback OPERATOR listener instead (the SSH-tunnel path).
 */
export async function req(inst, url, o = {}) {
  let g;
  // a listener that is not up yet (restart / failure rehearsals poll for it) is "no answer", not a refusal: nothing was sent but the identity probe's TCP connect to loopback. Absent / wrong identity still throws.
  try { g = await verified(guardFor(inst, { operator: !!o.operator })); } catch (e) { if (e?.code === "identity-unreachable") return { status: 0, error: `identity probe: ${e.message.slice(0, 160)}`, headers: {}, ms: 0, body: "" }; throw e; }
  const full = urlFor(inst, url, { operator: !!o.operator });
  const headers = { ...(o.headers || {}) };
  // On a high-port instance (or the operator listener) curl would send `Host: www.copilt.org:18443`; WordPress then "canonicalises" it away and loops. Send the production-shaped Host.
  const hm = /^https?:\/\/([^/?#:]+)/.exec(url);
  const odd = o.operator || (url.startsWith("https") ? inst.httpsPort !== 443 : inst.httpPort !== 80);
  if (hm && odd && !Object.keys(headers).some((k) => k.toLowerCase() === "host")) headers.Host = hm[1];
  if (o.cookie) headers.Cookie = o.cookie;
  const spec = { url: full, method: o.head ? "HEAD" : o.method || "GET", head: !!o.head, headers, body: o.body, bodyFile: o.bodyFile, timeout: o.timeout || 30, http: o.http === "2" ? "2" : "1.1", ipv6: !!o.ipv6, compressed: !!o.compressed, extra: o.extra, dialIp: o.connectIp, writeOut: "\n__CURL__%{http_code} %{time_total} %{size_download} %{http_version} %{num_redirects} %{url_effective} %{remote_ip}" };
  const t0 = now();
  let r;
  try { r = o.follow ? await g.followAsync(spec, { max: 5 }) : await g.curlAsync(spec); } catch (e) { if (e?.name === "GuardRefusal") throw e; return { status: 0, error: String(e.message).slice(0, 300), headers: {}, ms: now() - t0, body: "" }; }
  if (r.status === 0 && !r.stdout.length) return { status: 0, error: r.error, headers: {}, ms: now() - t0, body: "" };
  const out = r.stdout.toString("latin1");
  const i = out.lastIndexOf("\n__CURL__");
  const meta = (i >= 0 ? out.slice(i + 9) : "").split(" ");
  const pre = i >= 0 ? out.slice(0, i) : out;
  const all = pre.split(/\r?\n\r?\n/);
  let k = 0; while (k < all.length && /^HTTP\//.test(all[k])) k++;
  const headText = all.slice(0, k).join("\r\n\r\n"), body = all.slice(k).join("\r\n\r\n");
  const h = parseHeaderBlock(headText);
  return { ...h, body, ms: Math.round(Number(meta[1]) * 1000) || now() - t0, bytes: Number(meta[2]), httpVersion: meta[3], redirects: o.follow ? r.redirects : Number(meta[4]), effective: o.follow ? r.effective : meta[5], remoteIp: meta[6], reqId: (h.headers["x-request-id"] || [])[0] };
}

/** A raw TLS (or plain) request: exact bytes on the wire, for malformed/smuggling-style inputs that curl would repair. Resolves with the response text. The connection is dialled by the guard (127.0.0.1 only). */
export async function rawRequest(inst, text, { secure = true, servername = HOSTS.www, timeout = 5000, operator = false } = {}) {
  const g = await verified(guardFor(inst, { operator }));
  const method = (/^([A-Z]+) /.exec(text) || [])[1] || "GET";
  const port = operator ? operatorPortOf(inst) : secure ? inst.httpsPort : inst.httpPort;
  const so = g.socketOptions(`${secure ? "https" : "http"}://${servername}:${port}/`, { method });
  return new Promise((resolve) => {
    let buf = "";
    const done = (extra) => resolve({ text: buf, ...extra });
    const onConnect = (s) => { s.write(text); };
    const s = secure ? tls.connect({ host: so.host, port: so.port, servername: so.servername, ca: fs.readFileSync(P.rootCrt), ALPNProtocols: ["http/1.1"] }, () => onConnect(s)) : net.connect({ host: so.host, port: so.port }, () => onConnect(s));
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
  const g = guardFor(inst);
  const ready = verified(g);
  const one = (u) => new Promise((resolve) => {
    const url = new URL(u);
    const start = now();
    ready.then(() => {
      let so;
      try { so = g.socketOptions(`https://${url.hostname}:${inst.httpsPort}/`, { method: "GET" }); } catch (e) { return resolve({ t: start - t0, ms: now() - start, status: 0, err: e.code || "guard", url: u }); }
      const r = https.request({ host: so.host, port: so.port, servername: so.servername, method: "GET", path: url.pathname + url.search, headers: hostHeader ? { Host: url.hostname } : {}, agent, timeout: timeoutMs }, (res) => { res.resume(); res.on("end", () => resolve({ t: start - t0, ms: now() - start, status: res.statusCode, url: u })); });
      r.on("timeout", () => { r.destroy(); resolve({ t: start - t0, ms: now() - start, status: 0, err: "timeout", url: u }); });
      r.on("error", (e) => resolve({ t: start - t0, ms: now() - start, status: 0, err: e.code || String(e.message).slice(0, 40), url: u }));
      r.end();
    }, (e) => resolve({ t: start - t0, ms: now() - start, status: 0, err: e.code || "identity", url: u }));
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
