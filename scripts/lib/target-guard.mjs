// FAIL-CLOSED target guard for every staging / rehearsal runner (scripts/staging-replay.mjs, scripts/rehearsal/*, the rcurl wrapper).
//
// Why (owner, 2026-10-21): earlier malformed LOCAL requests accidentally reached the real public www.copilt.org. A runner that is merely "careful" can still send one stray request
// (a missing --resolve for a port, a redirect Location that points at a public name, a typo in a host). This module makes that impossible by construction:
//
//   * a runner cannot send anything without a TargetGuard, and a TargetGuard cannot be built without ALL of: an explicit staging host name, an explicit expected IP, an explicit port
//     and an explicit staging identity marker (--stage-id). Anything missing -> exit code 3, a clear message, NOTHING SENT.
//   * the guard builds the network call itself (curl with `-q --noproxy '*' --connect-to host:port:EXPECTED_IP:port --max-redirs 0 --proto =http,https`; Node sockets dialled at the
//     expected IP; a browser launched with a host-resolver allowlist and a route handler). The caller never supplies an address, so a request can only reach the expected IP.
//   * every request is checked BEFORE it is sent (assertRequest) and recorded in an egress audit (JSONL when AICC_GUARD_AUDIT_FILE is set).
//   * a request that changes state (anything but GET/HEAD/OPTIONS) is refused until the staging identity was positively verified in the same run: GET /.well-known/aicc-stage-identity
//     over the mapped connection must return {env, host, id} with env "staging" (the real staging host) or "rehearsal" (the Mac rehearsal edge), host = the staging host and id = --stage-id.
//     The PRODUCTION render of the edge never contains that route (test:redirects, test:target-guard).
//   * production names (www.copilt.org, copilt.org, api.copilt.org, any other *.copilt.org that is not stage*) are refused as the staging host. The ONLY way to talk to them is the separate
//     --production-readonly mode: GET/HEAD only, port 443, no state change possible.
//   * the macOS rehearsal maps the production NAMES to 127.0.0.1 (alias hosts). That is allowed only when the expected IP is loopback (`rehearsal` config): the guard dials 127.0.0.1 only and
//     never resolves those names, so nothing can leave the machine. A stage host may also serve the production names for an explicit "production topology check" (alias hosts on a stage IP);
//     that needs --alias-host and a verified identity, and the names are still never resolved.
//   * the OPERATOR TUNNEL (real staging host only): `operatorTunnel: { publicIp }` (CLI --operator-tunnel-of IP) describes an `ssh -L 127.0.0.1:<local>:127.0.0.1:8443` forward to the edge's loopback
//     operator listener. The expected IP is then loopback (the tunnel's local end) and --port is the LOCAL tunnel port, while every URL keeps the PUBLIC port :443 (WordPress's absolute URLs never carry
//     a port) and is mapped to the tunnel port by the connect-to / host-resolver rule. Nothing is loosened: the identity route must still answer {env:"staging", host, id=--stage-id} through the tunnel,
//     the public DNS answer of the staging host must still equal --operator-tunnel-of (a real public staging IP, never loopback or a known production address), the tunnel port must not be 443 or a QA/owner
//     fixture port, no alias hosts and no plain http.
//   * redirects are NEVER followed by curl; `follow` is implemented here hop by hop and refuses (and records a violation for) any hop that leaves the allowed host:port set.
//
// Exit code on any refusal: 3. Exported API is deliberately small; scripts/test-target-guard.mjs tests every refusal.
import { spawn, spawnSync } from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const EXIT_REFUSED = 3;
export const IDENTITY_PATH = "/.well-known/aicc-stage-identity";
export const PRODUCTION_NAMES = ["www.copilt.org", "copilt.org", "api.copilt.org"];
export const PRODUCTION_DOMAIN = "copilt.org";
/** 139.59.157.231 = the API droplet (api.copilt.org); the four GitHub Pages addresses = today's public www.copilt.org / copilt.org. */
export const KNOWN_PRODUCTION_IPS = ["139.59.157.231", "185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"];
export const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

export class GuardRefusal extends Error {
  constructor(code, message) { super(message); this.name = "GuardRefusal"; this.code = code; this.exitCode = EXIT_REFUSED; }
}
const refuse = (code, message) => { throw new GuardRefusal(code, message); };

/** Print the refusal and exit 3. Use as the top-level catch of every runner. */
export function exitRefused(e) {
  if (e instanceof GuardRefusal) {
    process.stderr.write(`GUARD REFUSED [${e.code}]: ${e.message}\nNothing was sent.\n`);
    process.exit(EXIT_REFUSED);
  }
  throw e;
}
/** Run a runner's main; a GuardRefusal anywhere ends the process with exit code 3. */
export async function guarded(main) { try { return await main(); } catch (e) { return exitRefused(e); } }

/* ------------------------------------------------------------------ names and addresses */
export const normHost = (h) => String(h || "").trim().toLowerCase().replace(/\.$/, "");
/** "production" (exact production name), "production-domain" (another *.copilt.org that is not stage*), "staging" (first label stage* / staging*), "other". */
export function classifyHost(h) {
  const x = normHost(h);
  if (PRODUCTION_NAMES.includes(x)) return "production";
  if (x === PRODUCTION_DOMAIN || x.endsWith("." + PRODUCTION_DOMAIN)) return /^(stage|staging)[a-z0-9-]*\./.test(x) ? "staging" : "production-domain";
  if (/^(stage|staging)[a-z0-9-]*\.[a-z0-9.-]+$/.test(x)) return "staging";
  return "other";
}
const v4mapped = (ip) => { const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); return m ? m[1] : ip; };
export const normIp = (ip) => v4mapped(String(ip || "").trim().replace(/^\[|\]$/g, "").toLowerCase());
export const isLoopbackIp = (ip) => { const x = normIp(ip); return /^127\./.test(x) || x === "::1"; };
export const isKnownProductionIp = (ip) => KNOWN_PRODUCTION_IPS.includes(normIp(ip));
const brackets = (ip) => (net.isIPv6(ip) ? `[${ip}]` : ip);

/** Split an absolute URL WITHOUT normalising it (dot-segments, double slashes and raw bytes must reach the edge as written). */
export function splitUrl(url) {
  const m = /^(https?):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/is.exec(String(url));
  if (!m) refuse("bad-url", `not an absolute http(s) URL: ${String(url).slice(0, 120)}`);
  const auth = m[2];
  if (auth.includes("@")) refuse("bad-url", `URL with userinfo is refused: ${auth}`);
  const hm = /^(\[[0-9a-f:.]+\]|[^:]*)(?::(\d*))?$/i.exec(auth);
  if (!hm || !hm[1]) refuse("bad-url", `cannot parse the authority of ${String(url).slice(0, 120)}`);
  return { scheme: m[1].toLowerCase(), host: normHost(hm[1].replace(/^\[|\]$/g, "")), port: hm[2] === undefined || hm[2] === "" ? null : Number(hm[2]), path: m[3] || "/", query: m[4] || "", hash: m[5] || "", raw: String(url), explicitPort: hm[2] !== undefined && hm[2] !== "" };
}

/* ------------------------------------------------------------------ configuration */
/**
 * @param {object} c
 *   stageHost            REQUIRED. Non-production name starting with stage or staging (or, with productionReadonly, a production name).
 *   stageIp              REQUIRED (not in productionReadonly). Where every connection goes. Never a known production address.
 *   port                 REQUIRED. The https port at stageIp (443 on the real host, a high port on the Mac).
 *   httpPort             optional. The plain-http port (needed to test http:// redirects).
 *   stageId              REQUIRED (not in productionReadonly). Must equal the id the edge's identity route returns.
 *   aliasHosts           optional. Further names dialled at stageIp (the production names in a topology check / the rehearsal).
 *   rehearsal            true only for the Mac rehearsal: stageIp must be loopback, DNS is never consulted, identity env is "rehearsal".
 *   identityVia          optional. The name used for the identity request (default: stageHost, then each alias).
 *   identityScheme       "https" (default) or "http" (loopback only, used by the unit tests).
 *   allowDnsMismatch     pre-DNS testing: continue although public/system resolution of stageHost differs from stageIp (identity is still required).
 *   productionReadonly   the separate read-only mode for the real production names: GET/HEAD only.
 *   cacert / insecure    TLS trust for the curl calls.
 *   resolver             injectable (name) => Promise<string[]> for the DNS check (tests).
 *   extraAllowedIps      additional dial addresses (the rehearsal's LAN-listener test): must be local interface addresses.
 *   auditFile            JSONL path (default env AICC_GUARD_AUDIT_FILE).
 *   spawn / spawnSync    injectable for tests (nothing may be sent on a refusal).
 */
export function buildConfig(c = {}) {
  const cfg = { ...c };
  cfg.productionReadonly = !!c.productionReadonly;
  const host = normHost(c.stageHost);
  if (!host) refuse("missing-host", "no staging host name (--stage-host / AICC_STAGE_HOST): the guard never defaults a target");
  cfg.stageHost = host;
  const port = Number(c.port);
  if (c.port === undefined || c.port === null || c.port === "" || !Number.isInteger(port) || port < 1 || port > 65535) refuse("missing-port", `no valid explicit port (--port / AICC_STAGE_PORT): got '${c.port ?? ""}'`);
  cfg.port = port;
  if (c.httpPort !== undefined && c.httpPort !== null && c.httpPort !== "") {
    const hp = Number(c.httpPort);
    if (!Number.isInteger(hp) || hp < 1 || hp > 65535) refuse("missing-port", `invalid --http-port '${c.httpPort}'`);
    cfg.httpPort = hp;
  } else cfg.httpPort = null;
  cfg.aliasHosts = [...new Set((c.aliasHosts || []).map(normHost).filter(Boolean))];
  cfg.identityScheme = c.identityScheme === "http" ? "http" : "https";
  cfg.extraAllowedIps = (c.extraAllowedIps || []).map(normIp);
  if (cfg.productionReadonly) {
    if (classifyHost(host) !== "production") refuse("production-readonly-host", `--production-readonly is for the real production names only (${PRODUCTION_NAMES.join(", ")}); '${host}' is not one`);
    if (cfg.port !== 443) refuse("url-port-mismatch", "--production-readonly talks to port 443 only");
    if (cfg.aliasHosts.length) refuse("production-readonly-alias", "--production-readonly takes no alias hosts");
    cfg.stageIp = null; cfg.stageId = null; cfg.httpPort = null;
    return cfg;
  }
  const kind = classifyHost(host);
  if (kind === "production") refuse("production-host", `'${host}' is a PRODUCTION name. The staging tooling never talks to it (use --production-readonly for GET/HEAD only).`);
  if (kind === "production-domain") refuse("production-host", `'${host}' is under the production domain ${PRODUCTION_DOMAIN} but is not a stage*/staging* name: refused.`);
  if (kind !== "staging") refuse("not-a-staging-name", `'${host}' is not recognisably a staging name (the first label must start with stage or staging, e.g. stage.copilt.org)`);
  if (c.stageIp === undefined || c.stageIp === null || String(c.stageIp).trim() === "") refuse("missing-ip", "no expected IP (--stage-ip / AICC_STAGE_IP): without it there is no connect-to mapping, and an unmapped name would be resolved through public DNS");
  const ip = normIp(c.stageIp);
  if (!net.isIP(ip)) refuse("invalid-ip", `'${c.stageIp}' is not an IP address`);
  if (/^(0\.0\.0\.0|::|::0)$/.test(ip) || /^(22[4-9]|2[3-5]\d)\./.test(ip)) refuse("invalid-ip", `${ip} is not a unicast destination`);
  if (isKnownProductionIp(ip)) refuse("known-production-ip", `${ip} is a known PRODUCTION / public-site address (the API droplet or GitHub Pages): never a staging target`);
  cfg.stageIp = ip;
  if (c.stageId === undefined || c.stageId === null || String(c.stageId).trim() === "") refuse("missing-marker", "no staging identity marker (--stage-id / AICC_STAGE_ID): the guard cannot prove it is talking to the staging host");
  if (!/^[A-Za-z0-9_-]{8,}$/.test(String(c.stageId))) refuse("missing-marker", "the staging identity marker must be 8+ characters of [A-Za-z0-9_-]");
  cfg.stageId = String(c.stageId);
  for (const a of cfg.aliasHosts) {
    if (net.isIP(a)) refuse("alias-host", `alias host '${a}' is an IP address`);
    if (a === host) continue;
    const ak = classifyHost(a);
    if (ak === "production" && !(c.rehearsal || c.aliasProductionNames)) refuse("alias-host", `alias '${a}' is a production name; production names may be served by a stage IP only with an explicit alias-production-names / --alias-host opt-in, or by the loopback rehearsal`);
    if (a === "api.copilt.org") refuse("alias-host", "api.copilt.org is never an alias: it is not served by this edge");
    if (ak === "production-domain") refuse("alias-host", `alias '${a}' is an unknown name under ${PRODUCTION_DOMAIN}`);
  }
  if (c.operatorTunnel) {
    const t = c.operatorTunnel;
    const pub = normIp(t.publicIp);
    if (c.rehearsal) refuse("operator-tunnel", "an operator tunnel is for the real staging host, not for a rehearsal config");
    if (!net.isIP(pub) || isLoopbackIp(pub) || /^(0\.0\.0\.0|::|::0)$/.test(pub) || /^(22[4-9]|2[3-5]\d)\./.test(pub)) refuse("operator-tunnel", `--operator-tunnel-of must be the staging host's public unicast IP (got '${t.publicIp ?? ""}')`);
    if (isKnownProductionIp(pub)) refuse("known-production-ip", `${pub} is a known PRODUCTION / public-site address: never the public end of an operator tunnel`);
    if (!isLoopbackIp(ip)) refuse("operator-tunnel", `an operator tunnel dials its LOCAL end: the expected IP must be loopback (got ${ip})`);
    if (cfg.port === 443 || cfg.port < 1024 || QA_PORTS(cfg.port)) refuse("operator-tunnel", `the tunnel's local port ${cfg.port} must be an unprivileged port that is not 443 and not a QA / owner-fixture port`);
    if (cfg.httpPort) refuse("operator-tunnel", "the operator listener serves https only: no --http-port");
    if (cfg.aliasHosts.length) refuse("operator-tunnel", "an operator tunnel takes no alias hosts");
    if (cfg.identityScheme !== "https") refuse("operator-tunnel", "the operator tunnel identity check is https only");
    cfg.operatorTunnel = { publicIp: pub };
  }
  if (c.rehearsal) {
    if (!isLoopbackIp(ip)) refuse("known-production-ip", `a rehearsal config must dial loopback only (got ${ip})`);
    cfg.rehearsal = true; cfg.identityEnv = "rehearsal";
  } else { cfg.rehearsal = false; cfg.identityEnv = "staging"; }
  if (cfg.identityScheme === "http" && !isLoopbackIp(ip)) refuse("scheme-not-allowed", "plain-http identity is allowed on loopback only");
  return cfg;
}

/** CLI/env -> raw config. Consumes the guard flags and returns the remaining arguments untouched. */
export function parseGuardArgs(argv, env = process.env) {
  const rest = [], out = { aliasHosts: [] };
  const take = (i) => argv[i + 1];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : null;
    const name = eq ? eq[0] : a;
    const val = () => (eq ? eq[1] : take(i));
    const adv = () => { if (!eq) i++; };
    if (name === "--stage-host") { out.stageHost = val(); adv(); }
    else if (name === "--stage-ip") { out.stageIp = val(); adv(); }
    else if (name === "--port") { out.port = val(); adv(); }
    else if (name === "--http-port") { out.httpPort = val(); adv(); }
    else if (name === "--stage-id") { out.stageId = val(); adv(); }
    else if (name === "--alias-host") { out.aliasHosts.push(val()); adv(); }
    else if (name === "--identity-via") { out.identityVia = val(); adv(); }
    else if (name === "--identity-scheme") { out.identityScheme = val(); adv(); }
    else if (name === "--allow-dns-mismatch") out.allowDnsMismatch = true;
    else if (name === "--production-readonly") out.productionReadonly = true;
    else if (name === "--alias-production-names") out.aliasProductionNames = true;
    else if (name === "--operator-tunnel-of") { out.operatorTunnel = { publicIp: val() }; adv(); } // --port is then the tunnel's LOCAL port; see the header comment
    else if (name === "--loopback-rehearsal") out.rehearsal = true; // the Mac rehearsal edges answer env "rehearsal"; allowed only with a loopback --stage-ip
    else rest.push(a);
  }
  const e = (k) => (env[k] !== undefined && env[k] !== "" ? env[k] : undefined);
  out.stageHost ??= e("AICC_STAGE_HOST"); out.stageIp ??= e("AICC_STAGE_IP"); out.port ??= e("AICC_STAGE_PORT"); out.httpPort ??= e("AICC_STAGE_HTTP_PORT"); out.stageId ??= e("AICC_STAGE_ID");
  return { raw: out, rest };
}

/* ------------------------------------------------------------------ the guard */
const CURL_FORBIDDEN = new Set(["--resolve", "--connect-to", "-x", "--proxy", "--preproxy", "--proxy-user", "-U", "-L", "--location", "--location-trusted", "--max-redirs", "-K", "--config", "--interface", "--dns-servers", "--dns-interface", "--dns-ipv4-addr", "--dns-ipv6-addr", "--doh-url", "--unix-socket", "--abstract-unix-socket", "--haproxy-protocol", "--socks4", "--socks4a", "--socks5", "--socks5-hostname", "--next", "-:", "--url", "--proto", "--proto-default", "--proto-redir", "--noproxy", "--alt-svc", "--hsts", "-q", "--disable"]);

/** The https port a URL must carry. Normally the configured port; through an operator tunnel the URL keeps the PUBLIC port 443 and the configured (local) port is only where the connection is dialled. */
const urlPortHttps = (cfg) => (cfg.operatorTunnel ? 443 : cfg.port);

export class TargetGuard {
  constructor(cfg, { shared } = {}) {
    this.cfg = cfg;
    this.audit = shared?.audit ?? [];
    this.violations = shared?.violations ?? [];
    this.counters = shared?.counters ?? { checked: 0, allowed: 0, refused: 0, browserChecked: 0, browserBlocked: 0, byDest: {} };
    this.auditFile = cfg.auditFile ?? process.env.AICC_GUARD_AUDIT_FILE ?? null;
    this.identity = { verified: false, via: null, at: null };
    this._spawn = cfg.spawn ?? spawn;
    this._spawnSync = cfg.spawnSync ?? spawnSync;
    this._seq = 0;
  }
  static create(raw) { return new TargetGuard(buildConfig(raw)); }

  /** A sibling guard for another port of the same host (the operator listener, a high-port twin). Shares the audit; identity must be verified on it separately. */
  derive(over) { const g = new TargetGuard(buildConfig({ ...this.cfg, ...over, aliasHosts: over.aliasHosts ?? this.cfg.aliasHosts }), { shared: { audit: this.audit, violations: this.violations, counters: this.counters } }); return g; }

  get allowedHosts() { return [this.cfg.stageHost, ...this.cfg.aliasHosts]; }
  get readonly() { return this.cfg.productionReadonly; }
  dialIpFor() { return this.cfg.productionReadonly ? null : this.cfg.stageIp; }

  /* ---------- audit */
  _record(e) {
    const rec = { t: new Date().toISOString(), seq: ++this._seq, pid: process.pid, ...e };
    this.audit.push(rec);
    if (this.audit.length > 20000) this.audit.splice(0, 5000);
    const key = `${rec.host || "-"}:${rec.port || "-"}->${rec.dialIp || "(public DNS: read-only)"}`;
    if (rec.decision === "allow" && rec.purpose !== "precheck" && rec.purpose !== "identity-verified" && rec.kind !== "dns") { this.counters.allowed++; this.counters.byDest[key] = (this.counters.byDest[key] || 0) + 1; } else if (rec.decision === "refuse") this.counters.refused++;
    if (this.auditFile) { try { fs.appendFileSync(this.auditFile, JSON.stringify(rec) + "\n"); } catch { /* audit must never break a run */ } }
    return rec;
  }
  _violation(rec) { this.violations.push(rec); }
  summary() {
    const sent = this.audit.filter((a) => a.decision === "allow" && a.kind !== "browser");
    const off = sent.filter((a) => a.dialIp && a.dialIp !== this.cfg.stageIp && !this.cfg.extraAllowedIps.includes(a.dialIp));
    return { checked: this.counters.checked, allowed: this.counters.allowed, refused: this.counters.refused, browserChecked: this.counters.browserChecked, browserBlocked: this.counters.browserBlocked, violations: this.violations.length, offTargetSends: off.length, destinations: this.counters.byDest };
  }

  /* ---------- the check every request passes BEFORE it is sent */
  /**
   * @param {{method:string,url:string,purpose?:"identity"|"request"|"redirect",kind?:string}} r
   * @returns {{scheme,host,port,dialIp}} what the request will be allowed to do
   */
  assertRequest(r) {
    const method = String(r.method || "GET").toUpperCase();
    const purpose = r.purpose || "request";
    let u;
    const rec = { kind: r.kind || "curl", purpose, method, url: String(r.url).replace(/([?&](?:key|token|pass|password|pwd|nonce|_wpnonce|login)=)[^&#]*/gi, "$1REDACTED").slice(0, 300) };
    this.counters.checked++;
    try {
      u = splitUrl(r.url);
      rec.host = u.host; rec.port = u.port;
      const cfg = this.cfg;
      if (!/^[A-Z]+$/.test(method)) refuse("bad-method", `invalid method '${method}'`);
      if (cfg.productionReadonly) {
        if (!SAFE_METHODS.slice(0, 2).includes(method)) refuse("production-readonly-method", `${method} to a production name: --production-readonly allows GET and HEAD only`);
        if (u.scheme !== "https") refuse("scheme-not-allowed", "--production-readonly: https only");
        if (u.host !== cfg.stageHost) refuse("url-host-not-allowed", `--production-readonly: host ${u.host} is not ${cfg.stageHost}`);
        if (u.port !== 443) refuse(u.port === null ? "url-no-port" : "url-port-mismatch", `--production-readonly: the URL must carry the explicit port :443 (got ${u.port === null ? "none" : u.port})`);
        rec.dialIp = null; rec.decision = "allow";
        return { scheme: u.scheme, host: u.host, port: u.port, dialIp: null };
      }
      if (!this.allowedHosts.includes(u.host)) {
        const k = classifyHost(u.host);
        refuse(k === "production" || k === "production-domain" ? "production-host" : "url-host-not-allowed", `${u.host} is not an allowed host for this run (allowed: ${this.allowedHosts.join(", ")})${k === "production" ? "; it is a PRODUCTION name" : ""}`);
      }
      if (u.port === null) refuse("url-no-port", `the URL has no explicit port: ${u.raw.slice(0, 120)} (every URL must say :${u.scheme === "https" ? cfg.port : cfg.httpPort ?? "<port>"} so a missing mapping can never fall back to the default port and to public DNS)`);
      const want = u.scheme === "https" ? urlPortHttps(cfg) : cfg.httpPort;
      if (u.scheme === "http" && !cfg.httpPort && !(cfg.identityScheme === "http" && (purpose === "identity" || purpose === "precheck"))) refuse("scheme-not-allowed", "plain http was not configured (--http-port)");
      const wantPort = u.scheme === "http" && cfg.identityScheme === "http" && (purpose === "identity" || purpose === "precheck") && !cfg.httpPort ? cfg.port : want;
      if (u.port !== wantPort) refuse("url-port-mismatch", `${u.scheme}:// port ${u.port} is not the expected ${wantPort}`);
      let dialIp = cfg.stageIp;
      if (r.dialIp && normIp(r.dialIp) !== dialIp) {
        // a per-request override (the rehearsal's IPv6-loopback and own-LAN-address tests): loopback addresses or an address of THIS machine, rehearsal configs only
        const o = normIp(r.dialIp);
        if (!(cfg.rehearsal && (isLoopbackIp(o) || localInterfaceIps().includes(o)))) refuse("mapping-mismatch", `dial address ${o} is not the expected IP ${dialIp} (overrides exist only for this machine's own addresses in a rehearsal config)`);
        dialIp = o;
      }
      if (isKnownProductionIp(dialIp)) refuse("known-production-ip", `${dialIp} is a known production address`);
      rec.dialIp = dialIp;
      const safe = SAFE_METHODS.includes(method);
      if (purpose !== "identity" && purpose !== "precheck") {
        if (!this.identity.verified) refuse(safe ? "identity-not-verified" : "destructive-before-identity", `${method} ${u.host}:${u.port} refused: the staging identity was not verified in this run (call ensureIdentity() first${safe ? "" : "; state-changing requests are never sent before that"})`);
      }
      rec.decision = "allow";
      const dialPort = cfg.operatorTunnel && u.scheme === "https" ? cfg.port : u.port; // the tunnel's LOCAL port; the URL keeps :443
      rec.dialPort = dialPort;
      return { scheme: u.scheme, host: u.host, port: u.port, dialIp, dialPort };
    } catch (e) {
      if (e instanceof GuardRefusal) {
        rec.decision = "refuse"; rec.code = e.code; rec.reason = e.message.slice(0, 300);
        const r2 = this._record(rec);
        if (["redirect-off-host", "egress-violation"].includes(e.code)) this._violation(r2);
        throw e;
      }
      throw e;
    } finally {
      if (rec.decision === "allow") this._record(rec);
    }
  }

  /** Check a URL and method against the config WITHOUT the identity requirement and without sending anything: run it for every URL before any DNS lookup or identity probe. */
  precheck(url, method = "GET") { return this.assertRequest({ method, url, purpose: "precheck", kind: "precheck" }); }

  /* ---------- DNS / identity */
  async verifyDns() {
    const cfg = this.cfg;
    if (cfg.productionReadonly || cfg.rehearsal) return { skipped: true };
    const resolver = cfg.resolver ?? (async (name) => (await dns.promises.lookup(name, { all: true })).map((a) => a.address));
    let addrs = [];
    try { addrs = (await resolver(cfg.stageHost)).map(normIp); } catch (e) { addrs = []; this._dnsErr = e.code || e.message; }
    const expected = cfg.operatorTunnel ? cfg.operatorTunnel.publicIp : cfg.stageIp; // through an operator tunnel the PUBLIC address of the host is what DNS must say
    const match = addrs.includes(expected);
    const rec = { kind: "dns", purpose: "dns", method: "-", host: cfg.stageHost, port: null, dialIp: null, decision: match ? "allow" : cfg.allowDnsMismatch ? "allow" : "refuse", resolved: addrs, expected, allowDnsMismatch: !!cfg.allowDnsMismatch };
    if (!match) {
      if (!cfg.allowDnsMismatch) { rec.code = "dns-mismatch"; rec.reason = `system/public DNS for ${cfg.stageHost} is [${addrs.join(", ") || "no answer"}], expected ${expected}`; this._record(rec); refuse("dns-mismatch", `${rec.reason}. Abort. (Pre-DNS testing needs the explicit --allow-dns-mismatch; it still forces every connection to ${cfg.stageIp} and still needs a verified identity.)`); }
      rec.note = "pre-DNS testing: explicit --allow-dns-mismatch; connections are forced to the expected IP and the identity is still required";
    }
    this._record(rec);
    return { match, resolved: addrs };
  }

  /** GET the identity route over the mapped connection; {env, host, id} must match. Sets identity.verified. */
  async ensureIdentity() {
    if (this.identity.verified) return this.identity;
    const cfg = this.cfg;
    if (cfg.productionReadonly) { this.identity = { verified: true, via: "production-readonly", at: Date.now() }; return this.identity; }
    await this.verifyDns();
    const scheme = cfg.identityScheme;
    const via = [cfg.identityVia, cfg.stageHost, ...cfg.aliasHosts].filter(Boolean);
    const seen = [];
    for (const name of [...new Set(via)]) {
      const url = `${scheme}://${name}:${scheme === "https" ? urlPortHttps(cfg) : cfg.httpPort ?? cfg.port}${IDENTITY_PATH}`;
      const r = await this._curl({ url, method: "GET", timeout: 15, purpose: "identity" }, { async: true });
      if (r.status === 0) { seen.push(`${name}: no response (${(r.error || "").slice(0, 120)})`); continue; }
      if (r.status !== 200) { seen.push(`${name}: HTTP ${r.status}`); continue; }
      let j = null;
      try { j = JSON.parse(r.body); } catch { seen.push(`${name}: 200 but not JSON`); continue; }
      const wantEnv = cfg.identityEnv;
      if (j && j.env === wantEnv && j.host === cfg.stageHost && j.id === cfg.stageId) {
        this.identity = { verified: true, via: name, at: Date.now(), env: j.env };
        this._record({ kind: "identity", purpose: "identity-verified", method: "GET", host: name, port: cfg.port, dialIp: cfg.stageIp, decision: "allow", env: j.env });
        return this.identity;
      }
      const why = !j || typeof j !== "object" ? "not an object" : j.env !== wantEnv ? `env '${j.env}' != '${wantEnv}'` : j.host !== cfg.stageHost ? `host '${j.host}' != '${cfg.stageHost}'` : "id does not match --stage-id";
      this._record({ kind: "identity", purpose: "identity-mismatch", method: "GET", host: name, port: cfg.port, dialIp: cfg.stageIp, decision: "refuse", code: "identity-mismatch", reason: why });
      refuse("identity-mismatch", `the server at ${cfg.stageIp}:${cfg.port} answered the identity route but it is NOT the staging host you named (${why}). Refusing everything.`);
    }
    const allNone = seen.length && seen.every((x) => /no response/.test(x));
    refuse(allNone ? "identity-unreachable" : "identity-absent", `could not verify the staging identity at ${cfg.stageIp}:${cfg.port} (${seen.join("; ")}). The identity route /.well-known/aicc-stage-identity must answer {env:"${cfg.identityEnv}",host:"${cfg.stageHost}",id:<--stage-id>}. Nothing but that probe was sent.`);
  }

  /* ---------- curl */
  /** Build (and check) the curl argument vector for a request spec. Throws GuardRefusal before anything exists to be sent. */
  _deny(code, message, spec) {
    const rec = this._record({ kind: "curl", purpose: "request", method: String(spec?.method || "GET").toUpperCase(), host: (() => { try { return splitUrl(spec.url).host; } catch { return "?"; } })(), port: null, dialIp: null, decision: "refuse", code, reason: message.slice(0, 300) });
    this.counters.checked++;
    void rec;
    refuse(code, message);
  }
  curlArgs(spec) {
    const method = String(spec.method || "GET").toUpperCase();
    const a = this.assertRequest({ method: spec.head ? "HEAD" : method, url: spec.url, purpose: spec.purpose || "request", kind: "curl", dialIp: spec.dialIp });
    const args = ["-q", "--noproxy", "*", "-sS", "--max-redirs", "0", "--proto", "=http,https", "--max-time", String(spec.timeout || 30)];
    if (spec.pathAsIs !== false) args.push("--path-as-is");
    const mapped = new Set();
    if (a.dialIp) { args.push("--connect-to", `${a.host}:${a.port}:${brackets(a.dialIp)}:${a.dialPort ?? a.port}`); mapped.add(`${a.host}:${a.port}`); }
    const extra = spec.extra || [];
    for (let i = 0; i < extra.length; i++) {
      const x = String(extra[i]);
      const flag = x.startsWith("--") && x.includes("=") ? x.slice(0, x.indexOf("=")) : x;
      if (CURL_FORBIDDEN.has(flag)) this._deny("forbidden-curl-option", `curl option ${flag} is not allowed (the guard supplies the mapping, the proxy policy and the redirect policy)`, spec);
      if (/^-[A-Za-z]{2,}$/.test(x) && /[xLKU:q]/.test(x)) this._deny("forbidden-curl-option", `curl option bundle ${x} contains a forbidden option (x, L, K, U, q, :)`, spec);
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(x)) { const prev = String(extra[i - 1] || ""); if (!/^(-d|--data|--data-binary|--data-raw|--data-urlencode|-H|--header|-e|--referer|-F|--form|-w|--write-out|-A|--user-agent)$/.test(prev)) {
          // a second URL in the arguments is a second request: checked like the first AND mapped to the expected IP like the first (an unmapped name would be resolved through DNS)
          const b = this.assertRequest({ method, url: x, purpose: spec.purpose || "request", kind: "curl-extra-url", dialIp: spec.dialIp });
          if (b.dialIp && !mapped.has(`${b.host}:${b.port}`)) { args.push("--connect-to", `${b.host}:${b.port}:${brackets(b.dialIp)}:${b.dialPort ?? b.port}`); mapped.add(`${b.host}:${b.port}`); }
        } }
      args.push(x);
    }
    if (spec.insecure ?? this.cfg.insecure) args.push("-k"); else if (spec.cacert ?? this.cfg.cacert) args.push("--cacert", spec.cacert ?? this.cfg.cacert);
    args.push(spec.http === "2" ? "--http2" : "--http1.1");
    if (!spec.userOutput) {
      if (spec.dump !== false) args.push("-D", spec.dump || "-");
      args.push("-o", spec.head ? "/dev/null" : spec.bodyFile || "-");
      if (spec.head) args.push("-I"); else if (method !== "GET") args.push("-X", method);
    }
    if (spec.ipv6) args.push("-6");
    for (const [k, v] of Object.entries(spec.headers || {})) args.push("-H", `${k}: ${v}`);
    if (spec.body !== undefined) args.push("--data-binary", spec.body);
    if (spec.compressed) args.push("--compressed");
    if (spec.writeOut) args.push("-w", spec.writeOut);
    args.push(spec.url);
    return args;
  }
  _env() { return { ...process.env, http_proxy: "", https_proxy: "", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", all_proxy: "", NO_PROXY: "*", no_proxy: "*", CURL_HOME: os.tmpdir() }; }
  /** Check, then run curl. `opts.async` returns a Promise. Result: { status, headersRaw (string), body (string, latin1), stdout (Buffer), stderr, error }. */
  _curl(spec, { async } = {}) {
    const args = this.curlArgs(spec);
    const parse = (stdout, stderr, code) => {
      const txt = stdout.toString("latin1");
      const blocks = txt.split(/\r?\n\r?\n/);
      let k = 0; while (k < blocks.length && /^HTTP\//.test(blocks[k])) k++;
      const head = blocks.slice(0, k).join("\r\n\r\n");
      const body = blocks.slice(k).join("\r\n\r\n");
      const last = blocks.slice(0, k).pop() || "";
      const status = Number((/^HTTP\/\S+\s+(\d{3})/.exec(last) || [])[1] || 0);
      return { status, headerText: head, body: spec.head ? "" : body, stdout, stderr: String(stderr || ""), code, error: status === 0 ? String(stderr || "").trim().slice(0, 300) : "" };
    };
    if (!async) { const r = this._spawnSync("curl", args, { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, env: this._env() }); return parse(r.stdout || Buffer.alloc(0), (r.stderr || "").toString(), r.status); }
    return new Promise((resolve) => {
      const p = this._spawn("curl", args, { env: this._env() });
      const out = [], err = [];
      p.stdout.on("data", (d) => out.push(d)); p.stderr.on("data", (d) => err.push(d));
      p.on("error", (e) => resolve({ status: 0, headerText: "", body: "", stdout: Buffer.alloc(0), stderr: String(e.message), code: -1, error: String(e.message) }));
      p.on("close", (code) => resolve(parse(Buffer.concat(out), Buffer.concat(err).toString(), code)));
    });
  }
  curlSync(spec) { return this._curl(spec, { async: false }); }
  curlAsync(spec) { return this._curl(spec, { async: true }); }

  /**
   * Follow redirects HOP BY HOP: every Location is resolved against the current URL and passes assertRequest again; a hop that leaves the allowed host:port set is refused and
   * recorded as a VIOLATION (the run must end with exit code 3).
   */
  async followAsync(spec, { max = 5 } = {}) {
    let url = spec.url, hops = 0, r;
    for (;;) {
      r = await this.curlAsync({ ...spec, url });
      const loc = (/^location:\s*(.+)$/im.exec(r.headerText || "") || [])[1]?.trim();
      if (r.status >= 300 && r.status < 400 && loc) {
        const next = withDefaultPort(resolveAgainst(url, loc));
        try { this.assertRequest({ method: "GET", url: next, purpose: "redirect", kind: "redirect-hop" }); } catch (e) {
          if (e instanceof GuardRefusal) { const v = this._record({ kind: "redirect", purpose: "redirect-off-host", method: "GET", host: safeHost(next), port: null, dialIp: null, decision: "refuse", code: "redirect-off-host", reason: `a redirect to ${next.slice(0, 200)} was NOT followed: it leaves the staging host/port set`, from: url.slice(0, 200) }); this._violation(v); refuse("redirect-off-host", v.reason); }
          throw e;
        }
        url = next; spec = { ...spec, method: [301, 302, 303].includes(r.status) ? "GET" : spec.method, body: [301, 302, 303].includes(r.status) ? undefined : spec.body };
        if (++hops > max) break;
        continue;
      }
      break;
    }
    r.redirects = hops; r.effective = url;
    return r;
  }

  /** --production-readonly only: the notBefore/notAfter of the certificate the real site presents (a TLS handshake and nothing else; no HTTP request is made). */
  productionTlsDates() {
    if (!this.cfg.productionReadonly) refuse("raw-socket-readonly", "certificate probes of a production name exist only in --production-readonly mode");
    this.assertRequest({ method: "HEAD", url: `https://${this.cfg.stageHost}:443/`, purpose: "request", kind: "tls-probe" });
    const sc = this._spawnSync("bash", ["-c", `echo | openssl s_client -connect ${this.cfg.stageHost}:443 -servername ${this.cfg.stageHost} 2>/dev/null | openssl x509 -noout -dates`], { encoding: "utf8" });
    return String(sc.stdout || "").trim().replace(/\n/g, "; ");
  }

  /* ---------- sockets (raw TLS / http probes) */
  /** Options for tls.connect / https.request that dial the expected IP with the right SNI. The request line/target host is checked first. */
  socketOptions(url, { method = "GET", purpose = "request", dialIp } = {}) {
    const a = this.assertRequest({ method, url, purpose, kind: "socket", dialIp });
    if (!a.dialIp) refuse("raw-socket-readonly", "raw sockets are not available in --production-readonly mode");
    return { host: a.dialIp, port: a.dialPort ?? a.port, servername: a.host, scheme: a.scheme, hostHeader: a.host };
  }

  /* ---------- the browser */
  /** True if a URL a browser wants to load stays inside the allowed host:port set (the effective port of an https URL without a port is the configured https port when it is 443). */
  browserAllows(url) {
    let u; try { u = new URL(url); } catch { return false; }
    if (["data:", "blob:", "about:"].includes(u.protocol)) return true;
    if (!["https:", "http:", "wss:", "ws:"].includes(u.protocol)) return false;
    const host = normHost(u.hostname.replace(/^\[|\]$/g, ""));
    if (!this.allowedHosts.includes(host)) return false;
    const https = u.protocol === "https:" || u.protocol === "wss:";
    const eff = Number(u.port || (https ? 443 : 80));
    return eff === (https ? urlPortHttps(this.cfg) : this.cfg.httpPort);
  }
  /** Chromium launch arguments: allowlist resolver (everything else NOTFOUND), black-hole proxy for literal addresses, no background traffic. */
  browserArgs({ port, ip: ipOverride } = {}) {
    let ip = this.cfg.stageIp;
    if (!ip) refuse("raw-socket-readonly", "no browser in --production-readonly mode");
    if (ipOverride && normIp(ipOverride) !== ip) {
      const o = normIp(ipOverride);
      if (!(this.cfg.rehearsal && (isLoopbackIp(o) || localInterfaceIps().includes(o)))) refuse("mapping-mismatch", `browser address ${o} is not the expected IP ${ip}`);
      ip = o;
    }
    const dialPort = port ?? this.cfg.port;
    const maps = this.allowedHosts.map((h) => `MAP ${h} ${brackets(ip)}${dialPort !== 443 ? ":" + dialPort : ""}`);
    return [
      `--host-resolver-rules=${[...maps, "MAP * ~NOTFOUND"].join(", ")}`,
      // anything that is NOT a mapped name (a literal public IP in a URL) goes to a black hole that refuses the connection; the mapped names bypass it
      "--proxy-server=http://127.0.0.1:9",
      `--proxy-bypass-list=${this.allowedHosts.join(";")}`,
      // Chrome's own background activity (measured with --log-net-log under a deny-by-default sandbox): host names such as accounts.google.com / update.googleapis.com / content-autofill.googleapis.com
      // are looked up and fail at the NOTFOUND rule above (no DNS query, no connection); the one thing that still reaches the kernel is Chrome's IPv6 reachability probe, a UDP connect() to
      // [2001:4860:4860::8888]:443 (route check, no datagram is sent; the sandbox log shows it as a denied network-outbound). These features are switched off where Chrome allows it.
      "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-pings", "--disable-domain-reliability", "--disable-client-side-phishing-detection", "--disable-default-apps", "--no-default-browser-check", "--safebrowsing-disable-auto-update", "--disable-breakpad", "--disable-search-engine-choice-screen",
      "--disable-features=DnsOverHttps,CertificateTransparencyComponentUpdater,OptimizationHints,OptimizationGuideModelDownloading,MediaRouter,Translate,AutofillServerCommunication,NetworkTimeServiceQuerying,SafeBrowsingEnhancedProtection,PrivacySandboxSettings4,InterestFeedContentSuggestions,BackgroundSync,HeavyAdIntervention,GlobalMediaControls,DialMediaRouteProvider,CrashReporting",
    ];
  }
  /** Install the route handler on a Playwright context (or page): block and record every request that is not allowed. onViolation(rec) lets the runner abort the run. */
  async guardBrowser(ctxOrPage, { onViolation } = {}) {
    await ctxOrPage.route("**/*", (route) => {
      const url = route.request().url();
      this.counters.browserChecked++;
      if (this.browserAllows(url)) return route.continue();
      this.counters.browserBlocked++;
      const rec = this._record({ kind: "browser", purpose: "egress", method: route.request().method(), host: safeHost(url), port: null, url: url.slice(0, 300), dialIp: null, decision: "refuse", code: "egress-violation", reason: `the browser tried to load ${url.slice(0, 200)}, which is outside ${this.allowedHosts.join(", ")}` });
      this._violation(rec);
      try { onViolation?.(rec); } catch { /* the runner decides */ }
      return route.abort("blockedbyclient");
    });
    if (typeof ctxOrPage.on === "function") ctxOrPage.on("websocket", (ws) => { if (!this.browserAllows(ws.url())) { const rec = this._record({ kind: "browser", purpose: "egress-websocket", method: "WS", host: safeHost(ws.url()), url: ws.url().slice(0, 300), decision: "refuse", code: "egress-violation", reason: "websocket outside the allowed hosts" }); this._violation(rec); onViolation?.(rec); } });
  }
}

/** A Location without a port means the scheme's DEFAULT port: make that explicit so the guard checks what a client would really connect to. */
function withDefaultPort(url) {
  try { const u = splitUrl(url); if (u.port !== null) return url; return url.replace(/^(https?:\/\/)(\[[^\]]+\]|[^/?#:]+)/i, (_, a, h) => `${a}${h}:${u.scheme === "https" ? 443 : 80}`); } catch { return url; }
}
const safeHost = (u) => { try { return new URL(u).hostname; } catch { return "?"; } };
export function resolveAgainst(base, loc) {
  if (/^https?:\/\//i.test(loc)) return loc;
  const b = splitUrl(base);
  const hostport = `${b.host.includes(":") ? `[${b.host}]` : b.host}${b.port ? ":" + b.port : ""}`;
  if (loc.startsWith("//")) return `${b.scheme}:${loc}`;
  if (loc.startsWith("/")) return `${b.scheme}://${hostport}${loc}`;
  const dir = b.path.replace(/[^/]*$/, "");
  return `${b.scheme}://${hostport}${dir}${loc}`;
}

/* ------------------------------------------------------------------ user-supplied mappings (rcurl / legacy flags) */
/**
 * `--connect-to H:P:IP:P` or `--resolve H:P:IP` strings from a human. Every one must point at the expected IP; the list must cover each required host:port. Anything else is refused.
 */
export function assertMappings(mappings, { expectedIp, required = [] }) {
  const covered = new Set();
  for (const m of mappings || []) {
    const p = String(m).split(":");
    const ip = normIp(p.length >= 4 && !m.includes("[") ? p[2] : (/\[([^\]]+)\]/.exec(m) || [])[1] || p[2]);
    if (!ip || ip !== normIp(expectedIp)) refuse("mapping-mismatch", `mapping '${m}' points to ${ip || "?"}, not to the expected IP ${expectedIp}`);
    covered.add(`${normHost(p[0])}:${p[1]}`);
  }
  for (const r of required) if (!covered.has(r)) refuse("mapping-absent", `no connect-to/resolve mapping for ${r}: a name without a mapping is resolved through public DNS`);
  return true;
}

/** The ONLY way for a tool to talk to a real production name: GET/HEAD, port 443, explicit opt-in by the caller (rehearsal runners gate it behind AICC_REHEARSAL_PRODUCTION_READONLY=1). */
export function productionReadonlyGuard(host, extra = {}) { return new TargetGuard(buildConfig({ productionReadonly: true, stageHost: host, port: 443, ...extra })); }

/** Local interface addresses (the rehearsal's LAN-listener test may dial one of them). */
export function localInterfaceIps() {
  return Object.values(os.networkInterfaces()).flat().filter(Boolean).map((i) => normIp(i.address));
}

/* ------------------------------------------------------------------ loopback helpers for fixtures (php -S, the admin API, scratch servers) */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const QA_PORTS = (p) => (p >= 8981 && p <= 8983) || (p >= 9111 && p <= 9114) || p === 8982 || p === 8000;
/** Throws unless the URL is plain loopback (127.0.0.1 / localhost / ::1) and not a QA/owner-fixture port. */
export function assertLoopbackUrl(url) {
  const u = splitUrl(url);
  if (!LOOPBACK_HOSTS.has(u.host)) refuse("egress-violation", `'${u.host}' is not a loopback address (this helper reaches fixtures on this machine only)`);
  if (u.port !== null && QA_PORTS(u.port)) refuse("egress-violation", `port ${u.port} belongs to the QA / owner fixtures and is never used by the rehearsal tooling`);
  return u;
}
/** fetch() to a loopback fixture. */
export async function loopbackFetch(url, init) { assertLoopbackUrl(url); return fetch(url, init); }
/** curl to a loopback fixture (replaces `curl -H 'Host: www.copilt.org' http://127.0.0.1:18982/...` in shell strings). Returns {status, headerText, body}. */
export function loopbackCurl(url, { headers = {}, method = "GET", body, head = false, timeout = 15 } = {}) {
  assertLoopbackUrl(url);
  const args = ["-q", "--noproxy", "*", "-sS", "--max-time", String(timeout), "--max-redirs", "0", "--proto", "=http,https", "-D", "-", "-o", head ? "/dev/null" : "-"];
  if (head) args.push("-I"); else if (method !== "GET") args.push("-X", method);
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  if (body !== undefined) args.push("--data-binary", body);
  args.push(url);
  const r = spawnSync("curl", args, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  const txt = (r.stdout || Buffer.alloc(0)).toString("latin1");
  const blocks = txt.split(/\r?\n\r?\n/); let k = 0; while (k < blocks.length && /^HTTP\//.test(blocks[k])) k++;
  const headerText = blocks.slice(0, k).join("\r\n\r\n");
  const last = blocks.slice(0, k).pop() || "";
  return { status: Number((/^HTTP\/\S+\s+(\d{3})/.exec(last) || [])[1] || 0), headerText, body: blocks.slice(k).join("\r\n\r\n") };
}
/** A raw loopback TCP connection (port probes of the rehearsal's own listeners). */
export function loopbackConnect(port, host = "127.0.0.1") { assertLoopbackUrl(`http://${host.includes(":") ? `[${host}]` : host}:${port}/`); return net.connect({ port, host }); }

/**
 * Node-level DNS tripwire for a staging run: any attempt to resolve a PRODUCTION name from this process (a stray fetch/https.get) is refused and recorded as a violation.
 * (curl children never resolve: every name is `--connect-to`-mapped to an IP. Chromium has its own resolver allowlist, see browserArgs.)
 */
export function installDnsGuard(guard) {
  if (guard.readonly) return () => {};
  const origLookup = dns.lookup, origPromises = dns.promises.lookup;
  const check = (host) => {
    const k = classifyHost(String(host || ""));
    if (k === "production" || k === "production-domain") {
      const rec = guard._record({ kind: "dns", purpose: "dns-production-name", method: "-", host: String(host), port: null, dialIp: null, decision: "refuse", code: "egress-violation", reason: `this run tried to resolve the production name ${host} through DNS` });
      guard._violation(rec);
      return new GuardRefusal("egress-violation", rec.reason);
    }
    return null;
  };
  dns.lookup = function (host, ...rest) { const e = check(host); if (e) { const cb = rest.find((x) => typeof x === "function"); if (cb) return void process.nextTick(cb, e); throw e; } return origLookup.call(dns, host, ...rest); };
  dns.promises.lookup = function (host, ...rest) { const e = check(host); if (e) return Promise.reject(e); return origPromises.call(dns.promises, host, ...rest); };
  return () => { dns.lookup = origLookup; dns.promises.lookup = origPromises; };
}

/* ------------------------------------------------------------------ audit report (final proof) */
export function readAuditFile(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
/** Summarise a JSONL audit: how many requests were checked/allowed/refused, to which destinations, any violation, and whether anything went to a name or address outside the allowed set. */
export function auditReport(records, { allowedIps = ["127.0.0.1", "::1"], productionNames = PRODUCTION_NAMES } = {}) {
  const sends = records.filter((r) => r.decision === "allow" && ["curl", "curl-extra-url", "identity", "socket", "redirect-hop"].includes(r.kind));
  const offIp = sends.filter((r) => r.dialIp && !allowedIps.includes(r.dialIp));
  const readonly = sends.filter((r) => r.dialIp === null && r.purpose !== "dns");
  const prodDirect = readonly.filter((r) => productionNames.includes(r.host));
  const viol = records.filter((r) => ["redirect-off-host", "egress-violation"].includes(r.code));
  const dests = {};
  for (const r of sends) dests[`${r.host}:${r.port} -> ${r.dialIp ?? "(public DNS)"}`] = (dests[`${r.host}:${r.port} -> ${r.dialIp ?? "(public DNS)"}`] || 0) + 1;
  return { total: records.length, sends: sends.length, refusals: records.filter((r) => r.decision === "refuse").length, violations: viol.length, offTargetSends: offIp.length, publicDnsSends: readonly.length, productionDirect: prodDirect.length, destinations: dests, refusalCodes: records.filter((r) => r.decision === "refuse").reduce((m, r) => ((m[r.code] = (m[r.code] || 0) + 1), m), {}) };
}

/* ------------------------------------------------------------------ CLI: node scripts/lib/target-guard.mjs --audit-report FILE */
import { fileURLToPath } from "node:url";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--audit-report");
  if (i < 0) { console.log("usage: node scripts/lib/target-guard.mjs --audit-report FILE.jsonl"); process.exit(2); }
  const rep = auditReport(readAuditFile(process.argv[i + 1]));
  console.log(JSON.stringify(rep, null, 2));
  process.exit(rep.offTargetSends || rep.violations || rep.productionDirect ? 3 : 0);
}
