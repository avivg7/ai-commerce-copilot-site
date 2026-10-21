// npm run test:target-guard: every refusal of the fail-closed target guard (scripts/lib/target-guard.mjs), proven with NOTHING sent.
//
//   A  module refusals: missing marker / host / ip / port, production names, known production IPs, wrong port, URL without port, DNS mismatch, mapping absent / wrong,
//      destructive method before identity, --production-readonly with POST ... each asserts the refusal CODE and that no curl process was started
//   B  CLI refusals: scripts/rehearsal/rcurl and scripts/staging-replay.mjs exit 3 with a message; a fake `curl` first on PATH records any invocation and must stay untouched
//   C  mock-server behaviour on loopback: identity verified / mismatched / absent / unreachable; state-changing request refused before identity and accepted after;
//      a redirect to a public host is NOT followed (one curl process only; a violation is recorded)
//   D  browser guard: allowed / blocked URLs, the route handler aborts and records, the launch arguments contain the allowlist resolver
//   E  repo invariants: the production build, the committed template and the production render contain NO stage identity route; every runner uses the guard;
//      no script sends curl/fetch/https to a production name outside the explicit allowlist below
//   F  positive: against the local rehearsal edge with the clearly staging-named alias stage-rehearsal.copilt.org (skipped, and said so, when no rehearsal edge is running)
// Everything here is local: no public DNS lookup of a production name, no request to a non-loopback address.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as G from "./lib/target-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REH = path.join(ROOT, "scripts/rehearsal");
let checks = 0, failures = 0, skipped = 0;
const results = [];
const ok = (cond, msg, detail = "") => { checks++; results.push({ ok: !!cond, msg }); if (!cond) { failures++; console.error(`  FAIL ${msg}${detail ? "\n       " + String(detail).slice(0, 400) : ""}`); } return !!cond; };
const skip = (msg) => { skipped++; console.log(`  SKIP ${msg}`); };
const group = (name) => console.log(`== ${name}`);
const spy = () => { const calls = []; return { calls, spawn: (...a) => { calls.push(["spawn", ...a]); throw new Error("spawn must not be called"); }, spawnSync: (...a) => { calls.push(["spawnSync", ...a]); throw new Error("spawnSync must not be called"); } }; };
const GOOD = { stageHost: "stage.copilt.org", stageIp: "203.0.113.10", port: 443, stageId: "0123456789abcdef0123" };
/** Build a guard with the spy and assert that building or using it refuses with `code` and starts no process. */
const refusesBuild = (name, cfg, code) => {
  const s = spy();
  let err = null;
  try { const g = new G.TargetGuard(G.buildConfig({ ...cfg, spawn: s.spawn, spawnSync: s.spawnSync })); err = g; } catch (e) { err = e; }
  ok(err instanceof G.GuardRefusal && err.code === code && err.exitCode === 3 && s.calls.length === 0, `${name} -> refused [${code}], exit code 3, no process started`, err instanceof Error ? `${err.name}/${err.code}: ${err.message}` : "NOT refused");
};
const guardWith = (over = {}) => { const s = spy(); const g = new G.TargetGuard(G.buildConfig({ ...GOOD, ...over, spawn: s.spawn, spawnSync: s.spawnSync })); return { g, s }; };
const refusesReq = (name, over, req, code, verified = true) => {
  const { g, s } = guardWith(over);
  if (verified) g.identity = { verified: true, via: "test", at: Date.now() };
  let err = null;
  try { g.curlArgs(typeof req === "string" ? { url: req } : req); } catch (e) { err = e; }
  ok(err instanceof G.GuardRefusal && err.code === code && s.calls.length === 0, `${name} -> refused [${code}], nothing sent`, err ? `${err.code}: ${err.message}` : "NOT refused");
  ok(g.audit.some((a) => a.decision === "refuse" && a.code === code), `${name}: the refusal is in the egress audit`);
};

/* ================================================================== A. module refusals */
group("A. module refusals (no process may start)");
refusesBuild("missing staging host", { ...GOOD, stageHost: "" }, "missing-host");
refusesBuild("missing expected IP", { ...GOOD, stageIp: undefined }, "missing-ip");
refusesBuild("blank expected IP", { ...GOOD, stageIp: "  " }, "missing-ip");
refusesBuild("missing port", { ...GOOD, port: undefined }, "missing-port");
refusesBuild("port 0", { ...GOOD, port: 0 }, "missing-port");
refusesBuild("port 70000", { ...GOOD, port: 70000 }, "missing-port");
refusesBuild("port not a number", { ...GOOD, port: "https" }, "missing-port");
refusesBuild("missing staging identity marker (--stage-id)", { ...GOOD, stageId: undefined }, "missing-marker");
refusesBuild("empty staging identity marker", { ...GOOD, stageId: "" }, "missing-marker");
refusesBuild("too-short identity marker", { ...GOOD, stageId: "abc" }, "missing-marker");
for (const h of ["www.copilt.org", "copilt.org", "api.copilt.org", "WWW.COPILT.ORG", "www.copilt.org.", "api.copilt.org."]) refusesBuild(`public production name '${h}' as the staging host`, { ...GOOD, stageHost: h }, "production-host");
refusesBuild("another name under the production domain (blog.copilt.org)", { ...GOOD, stageHost: "blog.copilt.org" }, "production-host");
refusesBuild("a name that is not recognisably a staging name (example.com)", { ...GOOD, stageHost: "example.com" }, "not-a-staging-name");
for (const ip of ["139.59.157.231", "185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153", "::ffff:139.59.157.231"]) refusesBuild(`known production address ${ip} as the expected IP`, { ...GOOD, stageIp: ip }, "known-production-ip");
// security review L5: every notation of a production address, and every non-canonical form, is refused BEFORE anything is sent
for (const [why, ip] of [["hex IPv4-mapped IPv6 (the review's PoC)", "::ffff:8b3b:9de7"], ["bracketed hex IPv4-mapped IPv6", "[::ffff:8b3b:9de7]"], ["upper-case hex IPv4-mapped IPv6", "::FFFF:8B3B:9DE7"], ["expanded IPv4-mapped IPv6", "0:0:0:0:0:ffff:8b3b:9de7"],
  ["IPv4-compatible IPv6", "::8b3b:9de7"], ["NAT64 64:ff9b::/96", "64:ff9b::8b3b:9de7"], ["NAT64 dotted tail", "64:ff9b::139.59.157.231"], ["6to4 2002:8b3b:9de7::/48", "2002:8b3b:9de7::1"],
  ["GitHub Pages IPv6 2606:50c0:8000::153", "2606:50c0:8000::153"], ["GitHub Pages IPv6 8001::153", "2606:50c0:8001::153"], ["GitHub Pages IPv6 8003::153", "2606:50c0:8003::153"], ["any address of the GitHub Pages /46", "2606:50c0:8002:abcd::1"],
  ["GitHub Pages IPv4 mapped in hex", "::ffff:b9c7:6c99"]]) refusesBuild(`${why}: ${ip}`, { ...GOOD, stageIp: ip }, "known-production-ip");
for (const [why, ip] of [["leading-zero octet (glibc reads it as octal 139.59.157.231)", "139.073.157.231"], ["leading zeros everywhere", "0139.0059.0157.0231"], ["hex dotted notation", "0x8b.0x3b.0x9d.0xe7"], ["single decimal integer 2336496103", "2336496103"], ["single hex integer", "0x8b3b9de7"],
  ["octal integer", "021316716747"], ["short form 139.59.40423", "139.59.40423"], ["three octets", "139.59.157"], ["trailing dot", "139.59.157.231."], ["leading dot", ".139.59.157.231"], ["an octet above 255", "139.59.157.256"], ["whitespace around", " 192.0.2.7"], ["IPv6 zone id", "fe80::1%en0"],
  ["a CIDR", "192.0.2.0/24"], ["a URL", "http://192.0.2.7"], ["Teredo (obfuscated embedded IPv4)", "2001:0:4136:e378:8000:63bf:74c4:620"], ["an IPv4-mapped form of a harmless address (non-canonical target)", "::ffff:192.0.2.7"], ["NAT64 of a harmless address", "64:ff9b::c000:207"]])
  refusesBuild(`non-canonical / embedded form (${why}): '${ip}'`, { ...GOOD, stageIp: ip }, "invalid-ip");
ok(G.ipVerdict("139.59.157.231").prod === true && G.ipVerdict("192.0.2.7").prod === false && G.ipVerdict("2001:db8::1").ok === true && G.ipVerdict("2606:50c0:8004::1").prod === false, "ipVerdict: production flagged, documentation addresses and the address next to the GitHub /46 are not");
ok(G.isKnownProductionIp("::ffff:8b3b:9de7") && G.isKnownProductionIp("[2606:50c0:8001::153]") && G.isKnownProductionIp("2002:8b3b:9de7::") && !G.isKnownProductionIp("192.0.2.7"), "isKnownProductionIp sees the embedded and IPv6 forms");
refusesBuild("expected IP is not an IP", { ...GOOD, stageIp: "stage.copilt.org" }, "invalid-ip");
refusesBuild("expected IP 0.0.0.0", { ...GOOD, stageIp: "0.0.0.0" }, "invalid-ip");
refusesBuild("a production name as an alias without the opt-in", { ...GOOD, aliasHosts: ["www.copilt.org"] }, "alias-host");
refusesBuild("api.copilt.org as an alias (even with the opt-in)", { ...GOOD, aliasHosts: ["api.copilt.org"], aliasProductionNames: true }, "alias-host");
refusesBuild("a rehearsal config with a non-loopback IP", { ...GOOD, rehearsal: true }, "known-production-ip");
refusesBuild("plain-http identity on a non-loopback IP", { ...GOOD, identityScheme: "http" }, "scheme-not-allowed");
refusesBuild("--production-readonly with a non-production host", { productionReadonly: true, stageHost: "stage.copilt.org", port: 443 }, "production-readonly-host");
refusesBuild("--production-readonly on another port", { productionReadonly: true, stageHost: "www.copilt.org", port: 8443 }, "url-port-mismatch");
// request-level refusals (config is valid, identity "verified" unless stated)
refusesReq("URL without an explicit port", {}, "https://stage.copilt.org/pricing/", "url-no-port");
refusesReq("URL with a different port", {}, "https://stage.copilt.org:8443/pricing/", "url-port-mismatch");
refusesReq("http URL when no http port was configured", {}, "http://stage.copilt.org:80/", "scheme-not-allowed");
refusesReq("http URL on the wrong http port", { httpPort: 80 }, "http://stage.copilt.org:8080/", "url-port-mismatch");
for (const u of ["https://www.copilt.org:443/", "https://copilt.org:443/", "https://api.copilt.org:443/", "http://www.copilt.org:80/"]) refusesReq(`request to the public production URL ${u}`, { httpPort: 80 }, u, "production-host");
refusesReq("request to an unrelated host", {}, "https://example.com:443/", "url-host-not-allowed");
refusesReq("request to a stage-looking host that was not named", {}, "https://stage2.copilt.org:443/", "url-host-not-allowed");
refusesReq("userinfo in the URL", {}, "https://user@stage.copilt.org:443/", "bad-url");
refusesReq("a relative URL", {}, "/pricing/", "bad-url");
for (const m of ["POST", "PUT", "PATCH", "DELETE"]) refusesReq(`${m} before the identity was verified`, {}, { url: "https://stage.copilt.org:443/x", method: m }, "destructive-before-identity", false);
refusesReq("even a GET before the identity was verified", {}, "https://stage.copilt.org:443/", "identity-not-verified", false);
for (const o of ["--resolve", "--connect-to", "-x", "--proxy", "-L", "--location", "-K", "--config", "--next", "--max-redirs", "--interface", "--unix-socket", "--url", "--noproxy", "--proto"]) refusesReq(`curl option ${o}`, {}, { url: "https://stage.copilt.org:443/", extra: [o, "x"] }, "forbidden-curl-option");
refusesReq("a bundled short option containing -L", {}, { url: "https://stage.copilt.org:443/", extra: ["-sSL"] }, "forbidden-curl-option");
refusesReq("a second URL smuggled in the extra arguments (public production name)", {}, { url: "https://stage.copilt.org:443/", extra: ["https://www.copilt.org:443/"] }, "production-host");
refusesReq("a dial-address override outside a rehearsal config", {}, { url: "https://stage.copilt.org:443/", dialIp: "127.0.0.1" }, "mapping-not-allowed".replace("mapping-not-allowed", "mapping-mismatch"));
// --production-readonly
{
  const s = spy();
  const g = new G.TargetGuard(G.buildConfig({ productionReadonly: true, stageHost: "www.copilt.org", port: 443, spawn: s.spawn, spawnSync: s.spawnSync }));
  for (const m of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) { let e = null; try { g.curlArgs({ url: "https://www.copilt.org:443/", method: m }); } catch (x) { e = x; } ok(e?.code === "production-readonly-method" && s.calls.length === 0, `--production-readonly: ${m} is refused [production-readonly-method], nothing sent`, e ? e.code : "NOT refused"); }
  for (const u of ["http://www.copilt.org:80/", "https://www.copilt.org/", "https://www.copilt.org:8443/", "https://copilt.org:443/", "https://api.copilt.org:443/"]) { let e = null; try { g.curlArgs({ url: u, method: "GET" }); } catch (x) { e = x; } ok(e instanceof G.GuardRefusal && s.calls.length === 0, `--production-readonly: ${u} is refused (${e?.code}), nothing sent`); }
  for (const m of ["GET", "HEAD"]) { let args = null, e = null; try { args = g.curlArgs({ url: "https://www.copilt.org:443/robots.txt", method: m, head: m === "HEAD" }); } catch (x) { e = x; } ok(args && !args.includes("--connect-to") && args.includes("--noproxy") && args.includes("-q") && args[0] === "-q", `--production-readonly: ${m} https://www.copilt.org:443/ is the only allowed shape (curl -q --noproxy '*', no state change possible)`, e?.message); }
}
// DNS
{
  const { g, s } = guardWith({ resolver: async () => ["198.51.100.7"] });
  let e = null; try { await g.ensureIdentity(); } catch (x) { e = x; }
  ok(e?.code === "dns-mismatch" && s.calls.length === 0, "DNS mismatch (public resolution differs from the expected IP) -> refused [dns-mismatch], nothing sent", e ? e.code : "NOT refused");
  const n = guardWith({ resolver: async () => { const x = new Error("ENOTFOUND"); x.code = "ENOTFOUND"; throw x; } });
  e = null; try { await n.g.ensureIdentity(); } catch (x) { e = x; }
  ok(e?.code === "dns-mismatch" && n.s.calls.length === 0, "the staging host does not resolve at all (pre-DNS) -> refused [dns-mismatch] without --allow-dns-mismatch", e ? e.code : "NOT refused");
  const a = guardWith({ resolver: async () => [], allowDnsMismatch: true });
  e = null; try { await a.g.ensureIdentity(); } catch (x) { e = x; }
  ok(e?.code === "identity-unreachable" || e?.code === "identity-absent" || e?.message?.includes("spawn"), "--allow-dns-mismatch passes the DNS gate but the identity is STILL required (nothing but the identity probe is attempted)", e ? `${e.code || e.name}: ${e.message}`.slice(0, 160) : "NOT required");
  ok(a.g.audit.some((r) => r.kind === "dns" && r.allowDnsMismatch === true), "the DNS exception is recorded in the audit");
  const m = guardWith({ resolver: async () => ["203.0.113.10"] });
  e = null; try { await m.g.verifyDns(); } catch (x) { e = x; }
  ok(!e, "DNS that matches the expected IP passes the DNS gate", e?.message);
}
// mappings
ok((() => { try { G.assertMappings([], { expectedIp: "203.0.113.10", required: ["stage.copilt.org:443"] }); return false; } catch (e) { return e.code === "mapping-absent"; } })(), "no connect-to/resolve mapping for a needed host:port -> refused [mapping-absent]");
ok((() => { try { G.assertMappings(["stage.copilt.org:443:198.51.100.9:443"], { expectedIp: "203.0.113.10" }); return false; } catch (e) { return e.code === "mapping-mismatch"; } })(), "a connect-to that points to any other address -> refused [mapping-mismatch]");
ok((() => { try { G.assertMappings(["www.copilt.org:443:139.59.157.231"], { expectedIp: "127.0.0.1" }); return false; } catch (e) { return e.code === "mapping-mismatch"; } })(), "a --resolve to the production address -> refused [mapping-mismatch]");
ok((() => { try { return G.assertMappings(["stage.copilt.org:443:203.0.113.10:443", "stage.copilt.org:80:203.0.113.10"], { expectedIp: "203.0.113.10", required: ["stage.copilt.org:443"] }); } catch { return false; } })(), "mappings that all point at the expected IP and cover the needed host:port are accepted");
// the guard always supplies its own mapping and a safe curl line
{
  const { g } = guardWith({ httpPort: 80 });
  g.identity = { verified: true };
  const a = g.curlArgs({ url: "https://stage.copilt.org:443/pricing/", method: "GET" });
  ok(a[0] === "-q" && a.includes("--noproxy") && a[a.indexOf("--noproxy") + 1] === "*" && a.includes("--max-redirs") && a[a.indexOf("--max-redirs") + 1] === "0" && a.includes("--proto") && a[a.indexOf("--proto") + 1] === "=http,https", "curl line: -q first (no .curlrc), --noproxy '*', --max-redirs 0, --proto =http,https");
  ok(a.includes("--connect-to") && a[a.indexOf("--connect-to") + 1] === "stage.copilt.org:443:203.0.113.10:443", "curl line: the guard's own --connect-to maps the name to the expected IP and port");
  const two = g.curlArgs({ url: "https://stage.copilt.org:443/", method: "GET", extra: ["http://stage.copilt.org:80/second"] });
  ok(two.filter((x) => x === "--connect-to").length === 2 && two.includes("stage.copilt.org:80:203.0.113.10:80") && two.includes("stage.copilt.org:443:203.0.113.10:443"), "curl line: a SECOND url in the arguments is checked and mapped to the expected IP too (an unmapped name would be resolved through DNS)", two.join(" ").slice(0, 200));
  const h = g.curlArgs({ url: "http://stage.copilt.org:80/", method: "GET" });
  ok(h[h.indexOf("--connect-to") + 1] === "stage.copilt.org:80:203.0.113.10:80", "curl line: the http port is mapped too");
  const v6 = guardWith({ stageIp: "2001:db8::10" }); v6.g.identity = { verified: true };
  ok(v6.g.curlArgs({ url: "https://stage.copilt.org:443/" }).includes("stage.copilt.org:443:[2001:db8::10]:443"), "curl line: an IPv6 expected address is bracketed");
}

/* ================================================================== B. CLI refusals with a fake curl */
group("B. CLI refusals (a fake curl on PATH must never be started)");
const shim = fs.mkdtempSync(path.join(os.tmpdir(), "aicc-guard-shim-"));
const shimLog = path.join(shim, "curl.log");
fs.writeFileSync(path.join(shim, "curl"), `#!/bin/sh\necho "$@" >> "${shimLog}"\nexit 7\n`, { mode: 0o755 });
const envShim = { PATH: `${shim}:${process.env.PATH}`, HOME: process.env.HOME, AICC_GUARD_AUDIT_FILE: path.join(shim, "audit.jsonl") };
const cli = (file, args, extraEnv = {}) => spawnSync(process.execPath, [path.join(ROOT, file), ...args], { encoding: "utf8", env: { ...envShim, ...extraEnv }, timeout: 60000 });
const refusedCli = (name, file, args, re, extraEnv) => {
  fs.rmSync(shimLog, { force: true });
  const r = cli(file, args, extraEnv);
  ok(r.status === 3 && re.test(r.stderr) && /Nothing was sent/.test(r.stderr) && !fs.existsSync(shimLog), `${name} -> exit 3, message ${re}, curl never started`, `exit ${r.status}: ${(r.stderr || r.stdout).split("\n")[0].slice(0, 200)}${fs.existsSync(shimLog) ? " CURL WAS STARTED: " + fs.readFileSync(shimLog, "utf8").slice(0, 200) : ""}`);
};
const RC = "scripts/rehearsal/rcurl.mjs", SR = "scripts/staging-replay.mjs";
const base = ["--stage-host", "stage.copilt.org", "--stage-ip", "203.0.113.10", "--port", "443", "--stage-id", "0123456789abcdef0123"];
const without = (flag) => { const a = [...base]; const i = a.indexOf(flag); a.splice(i, 2); return a; };
for (const [file, tag] of [[RC, "rcurl"], [SR, "staging-replay"]]) {
  const url = file === RC ? ["https://stage.copilt.org:443/"] : ["--no-sweep", "--no-port-probe"];
  refusedCli(`${tag}: missing --stage-id (identity marker)`, file, [...without("--stage-id"), ...url], /\[missing-marker\]/);
  refusedCli(`${tag}: missing --stage-ip (no mapping)`, file, [...without("--stage-ip"), ...url], /\[missing-ip\]/);
  refusedCli(`${tag}: missing --port`, file, [...without("--port"), ...url], /\[missing-port\]/);
  refusedCli(`${tag}: missing --stage-host`, file, [...without("--stage-host"), ...url], /\[missing-host\]/);
  for (const h of ["www.copilt.org", "copilt.org", "api.copilt.org"]) refusedCli(`${tag}: --stage-host ${h}`, file, ["--stage-host", h, ...without("--stage-host"), ...url], /\[production-host\]/);
  for (const ip of ["139.59.157.231", "185.199.108.153", "185.199.111.153"]) refusedCli(`${tag}: --stage-ip ${ip} (a production address)`, file, ["--stage-ip", ip, ...without("--stage-ip"), ...url], /\[known-production-ip\]/);
  refusedCli(`${tag}: environment variables only, nothing set`, file, url, /\[missing-host\]/);
}
refusedCli("rcurl: URL without a port", RC, [...base, "https://stage.copilt.org/"], /\[url-no-port\]/, {});
refusedCli("rcurl: URL with another port", RC, [...base, "https://stage.copilt.org:8443/"], /\[url-port-mismatch\]/);
refusedCli("rcurl: a public production URL on a staging config", RC, [...base, "https://www.copilt.org:443/"], /\[(production-host|identity-not-verified)\]/);
refusedCli("rcurl: --production-readonly with POST", RC, ["--production-readonly", "--stage-host", "www.copilt.org", "--port", "443", "-X", "POST", "-d", "a=b", "https://www.copilt.org:443/"], /\[production-readonly-method\]/);
refusedCli("rcurl: --production-readonly with DELETE", RC, ["--production-readonly", "--stage-host", "www.copilt.org", "--port", "443", "-X", "DELETE", "https://www.copilt.org:443/x"], /\[production-readonly-method\]/);
refusedCli("rcurl: --production-readonly without an explicit port in the URL", RC, ["--production-readonly", "--stage-host", "www.copilt.org", "--port", "443", "https://www.copilt.org/"], /\[url-no-port\]/);
refusedCli("rcurl: -L (follow redirects)", RC, [...base, "-L", "https://stage.copilt.org:443/"], /\[forbidden-curl-option\]/);
refusedCli("rcurl: a proxy", RC, [...base, "-x", "http://127.0.0.1:9", "https://stage.copilt.org:443/"], /\[forbidden-curl-option\]/);
refusedCli("rcurl: --resolve to another address", RC, [...base, "--resolve", "stage.copilt.org:443:198.51.100.9", "https://stage.copilt.org:443/"], /\[mapping-mismatch\]/);
refusedCli("rcurl: --connect-to to another address", RC, [...base, "--connect-to", "stage.copilt.org:443:198.51.100.9:443", "https://stage.copilt.org:443/"], /\[mapping-mismatch\]/);
refusedCli("rcurl: --config file", RC, [...base, "--config", "/dev/null", "https://stage.copilt.org:443/"], /\[forbidden-curl-option\]/);
refusedCli("rcurl: an unknown option", RC, [...base, "--some-unknown-option", "https://stage.copilt.org:443/"], /\[forbidden-curl-option\]/);
refusedCli("rcurl: DNS mismatch (a .invalid staging name never resolves)", RC, ["--stage-host", "stage-dns-test.invalid", "--stage-ip", "203.0.113.10", "--port", "443", "--stage-id", "0123456789abcdef0123", "https://stage-dns-test.invalid:443/"], /\[dns-mismatch\]/);
refusedCli("staging-replay: DNS mismatch (a .invalid staging name never resolves)", SR, ["--stage-host", "stage-dns-test.invalid", "--stage-ip", "203.0.113.10", "--port", "443", "--stage-id", "0123456789abcdef0123", "--no-sweep"], /\[dns-mismatch\]/);
for (const old of [["--edge-ip", "203.0.113.10"], ["--base", "https://203.0.113.10:443"], ["--connect-to", "www.copilt.org:443:203.0.113.10:443"]]) refusedCli(`staging-replay: the old hand-written mapping flag ${old[0]}`, SR, [...old], /\[mapping-absent\]/);
// --allow-dns-mismatch: passes the DNS gate and then STILL needs the identity (the fake curl answers nothing -> unreachable); one identity probe is the only thing started
{
  fs.rmSync(shimLog, { force: true });
  const r = cli(RC, ["--stage-host", "stage-dns-test.invalid", "--stage-ip", "203.0.113.10", "--port", "443", "--stage-id", "0123456789abcdef0123", "--allow-dns-mismatch", "https://stage-dns-test.invalid:443/"]);
  const calls = fs.existsSync(shimLog) ? fs.readFileSync(shimLog, "utf8").split("\n").filter(Boolean) : [];
  ok(r.status === 3 && /\[identity-unreachable\]/.test(r.stderr) && calls.length === 1 && /aicc-stage-identity/.test(calls[0]) && /--connect-to stage-dns-test\.invalid:443:203\.0\.113\.10:443/.test(calls[0]), "--allow-dns-mismatch: the only thing started is ONE identity probe, mapped by the guard to the expected IP; the run then refuses (exit 3)", `exit ${r.status} calls=${calls.length}: ${calls[0] || ""}`.slice(0, 300));
  fs.rmSync(shimLog, { force: true });
}
// the production-readonly GET is the one request that may leave: the fake curl records its exact shape
{
  fs.rmSync(shimLog, { force: true });
  const r = cli(RC, ["--production-readonly", "--stage-host", "www.copilt.org", "--port", "443", "-I", "https://www.copilt.org:443/robots.txt"]);
  const calls = fs.existsSync(shimLog) ? fs.readFileSync(shimLog, "utf8").split("\n").filter(Boolean) : [];
  ok(calls.length === 1 && /^-q --noproxy \* /.test(calls[0]) && !/--connect-to/.test(calls[0]) && /https:\/\/www\.copilt\.org:443\/robots\.txt$/.test(calls[0]) && !/ -X /.test(calls[0]) && /(^| )-I( |$)/.test(calls[0]), "--production-readonly -I: exactly one HEAD-shaped curl for the named URL (no -X, no body, no proxy, no .curlrc)", calls[0] || `exit ${r.status} ${r.stderr}`);
  fs.rmSync(shimLog, { force: true });
}

/* ================================================================== C. mock server on loopback */
group("C. mock server: identity, ordering of state changes, redirects");
const mock = { mode: "ok", hits: [], redirectTo: "https://www.copilt.org/pricing/" };
const server = http.createServer((q, s) => {
  mock.hits.push(`${q.method} ${q.url}`);
  if (q.url === G.IDENTITY_PATH) {
    if (mock.mode === "absent") { s.writeHead(404); return s.end("nope"); }
    if (mock.mode === "html") { s.writeHead(200, { "content-type": "text/html" }); return s.end("<html>hello</html>"); }
    const id = mock.mode === "wrong-id" ? "ffffffffffffffffffff" : "0123456789abcdef0123";
    const host = mock.mode === "wrong-host" ? "stage-other.example.test" : "stage-mock.example.test";
    const env = mock.mode === "wrong-env" ? "production" : "rehearsal";
    s.writeHead(200, { "content-type": "application/json" }); return s.end(JSON.stringify({ env, host, id }));
  }
  if (q.url === "/redir") { s.writeHead(302, { location: mock.redirectTo }); return s.end(); }
  if (q.url === "/redir-same") { s.writeHead(302, { location: "/landed" }); return s.end(); }
  if (q.url === "/redir-port") { s.writeHead(302, { location: "http://stage-mock.example.test:1/x" }); return s.end(); }
  s.writeHead(200, { "content-type": "text/plain" }); s.end(q.method === "POST" ? "posted" : "ok " + q.url);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const mockCfg = (over = {}) => ({ rehearsal: true, stageHost: "stage-mock.example.test", stageIp: "127.0.0.1", port, httpPort: port, stageId: "0123456789abcdef0123", identityScheme: "http", ...over });
const mk = (over) => { const real = [];  const g = new G.TargetGuard(G.buildConfig(mockCfg(over))); const sp = g._spawn; g._spawn = (...a) => { real.push(a); return sp(...a); }; g._real = real; return g; };
const U = (p) => `http://stage-mock.example.test:${port}${p}`;
{
  mock.mode = "ok"; mock.hits = [];
  const g = mk();
  let e = null; try { await g.curlAsync({ url: U("/x"), method: "POST", body: "a=b" }); } catch (x) { e = x; }
  ok(e?.code === "destructive-before-identity" && g._real.length === 0 && mock.hits.length === 0, "mock: POST before the identity was verified -> refused [destructive-before-identity]; the server saw nothing", e?.code);
  const id = await g.ensureIdentity();
  ok(id.verified && mock.hits.length === 1 && mock.hits[0] === `GET ${G.IDENTITY_PATH}`, "mock: identity verified by ONE GET of /.well-known/aicc-stage-identity (env, host and id all match)", mock.hits.join(" | "));
  const r = await g.curlAsync({ url: U("/x"), method: "POST", body: "a=b" });
  ok(r.status === 200 && r.body === "posted", "mock: the same POST is sent after the identity was verified", `${r.status} ${r.body}`);
  const hd = await g.curlAsync({ url: U("/x"), method: "HEAD", head: true });
  ok(hd.status === 200, "mock: HEAD works after identity");
}
for (const [mode, code, label] of [["wrong-id", "identity-mismatch", "a different id (some other server on that address)"], ["wrong-host", "identity-mismatch", "a different host name in the identity"], ["wrong-env", "identity-mismatch", "env 'production' where 'rehearsal'/'staging' is required"], ["absent", "identity-absent", "no identity route (404)"], ["html", "identity-absent", "a 200 that is not JSON (some unrelated web server)"]]) {
  mock.mode = mode; mock.hits = [];
  const g = mk();
  let e = null; try { await g.ensureIdentity(); } catch (x) { e = x; }
  ok(e?.code === code, `mock identity: ${label} -> refused [${code}]`, e ? e.code : "NOT refused");
  let e2 = null; try { await g.curlAsync({ url: U("/x"), method: "POST", body: "a=b" }); } catch (x) { e2 = x; }
  ok(e2 instanceof G.GuardRefusal && mock.hits.every((h) => h === `GET ${G.IDENTITY_PATH}`), `mock identity: ${label} -> the following POST is refused too and the server only ever saw the identity probe`, mock.hits.join(" | "));
}
{
  const dead = net.createServer(); await new Promise((r) => dead.listen(0, "127.0.0.1", r)); const dp = dead.address().port; await new Promise((r) => dead.close(r));
  const g = new G.TargetGuard(G.buildConfig(mockCfg({ port: dp, httpPort: dp })));
  let e = null; try { await g.ensureIdentity(); } catch (x) { e = x; }
  ok(e?.code === "identity-unreachable", "mock identity: nothing listening on the expected port -> refused [identity-unreachable]", e?.code);
}
// redirect to a public host is not followed
{
  mock.mode = "ok"; mock.hits = [];
  const g = mk();
  await g.ensureIdentity();
  const before = g._real.length;
  let e = null;
  try { await g.followAsync({ url: U("/redir"), method: "GET" }); } catch (x) { e = x; }
  ok(e?.code === "redirect-off-host" && g._real.length - before === 1, "redirect mid-run to the PUBLIC www.copilt.org: not followed [redirect-off-host]; exactly one request was made, the second hop was never started", `${e?.code} curl runs: ${g._real.length - before}`);
  ok(g.violations.length === 1 && g.violations[0].code === "redirect-off-host" && /www\.copilt\.org/.test(g.violations[0].reason), "the off-host redirect is recorded as a VIOLATION in the audit (the runner must exit 3)", JSON.stringify(g.violations[0] || {}).slice(0, 200));
  ok(mock.hits.filter((h) => h.startsWith("GET /redir")).length === 1 && !mock.hits.some((h) => /pricing/.test(h)), "the mock server never saw a request for the redirect target");
  // a plain curl (no follow) returns the 302 as DATA and does not follow it
  const plain = await g.curlAsync({ url: U("/redir"), method: "GET" });
  ok(plain.status === 302 && /location: https:\/\/www\.copilt\.org\/pricing\//i.test(plain.headerText), "a plain request returns the 302 and its Location as data (curl never follows: --max-redirs 0)");
  const same = await g.followAsync({ url: U("/redir-same"), method: "GET" });
  ok(same.status === 200 && same.redirects === 1 && /landed/.test(same.body), "a same-host redirect IS followed hop by hop (each hop passes the guard again)", `${same.status} hops=${same.redirects}`);
  let e3 = null; try { await g.followAsync({ url: U("/redir-port"), method: "GET" }); } catch (x) { e3 = x; }
  ok(e3?.code === "redirect-off-host", "a redirect to the same host on another port is refused too [redirect-off-host]", e3?.code);
  ok(g.summary().violations === 2 && g.summary().offTargetSends === 0, "the guard's egress summary: 2 violations (both refused), 0 sends to any address but the expected one", JSON.stringify(g.summary()).slice(0, 200));
}
server.close();

/* ================================================================== D. browser guard */
group("D. browser guard");
{
  const g = new G.TargetGuard(G.buildConfig({ rehearsal: true, stageHost: "stage-rehearsal.copilt.org", stageIp: "127.0.0.1", port: 443, httpPort: 80, stageId: "0123456789abcdef0123", aliasHosts: ["www.copilt.org", "copilt.org"] }));
  for (const [u, want] of [["https://www.copilt.org/pricing/", true], ["https://copilt.org/x", true], ["https://stage-rehearsal.copilt.org/", true], ["http://www.copilt.org/", true], ["data:text/plain,hi", true], ["blob:https://www.copilt.org/abc", true], ["about:blank", true], ["https://api.copilt.org/", false], ["https://example.com/", false], ["https://www.copilt.org:8443/", false], ["https://1.2.3.4/", false], ["https://127.0.0.1:18982/", false], ["https://www.copilt.org.evil.example/", false], ["https://fonts.googleapis.com/css", false], ["ftp://www.copilt.org/", false], ["wss://www.copilt.org/ws", true], ["wss://evil.example/ws", false]]) ok(g.browserAllows(u) === want, `browserAllows(${u}) === ${want}`);
  const args = g.browserArgs();
  ok(args.some((a) => /^--host-resolver-rules=MAP stage-rehearsal\.copilt\.org 127\.0\.0\.1, MAP www\.copilt\.org 127\.0\.0\.1, MAP copilt\.org 127\.0\.0\.1, MAP \* ~NOTFOUND$/.test(a)), "browser launch args: allowlist resolver MAPs only the named hosts to the expected IP and sends every other name to NOTFOUND", args.find((a) => /host-resolver/.test(a)));
  ok(args.includes("--proxy-server=http://127.0.0.1:9") && args.some((a) => /^--proxy-bypass-list=/.test(a)), "browser launch args: a black-hole proxy catches literal addresses, the mapped names bypass it");
  const handlers = [];
  const fakeCtx = { route: async (pat, fn) => handlers.push([pat, fn]), on() {} };
  let violated = null;
  await g.guardBrowser(fakeCtx, { onViolation: (r) => { violated = r; } });
  const h = handlers[0][1];
  const mkRoute = (url, method = "GET") => { const o = { continued: false, aborted: null, request: () => ({ url: () => url, method: () => method }), continue: () => { o.continued = true; }, abort: (why) => { o.aborted = why; } }; return o; };
  const good = mkRoute("https://www.copilt.org/pricing/"); h(good);
  ok(good.continued && !good.aborted, "route handler: a request to the mapped host continues");
  const badr = mkRoute("https://tracker.example/pixel.gif"); h(badr);
  ok(!badr.continued && badr.aborted === "blockedbyclient" && violated?.code === "egress-violation" && g.violations.length === 1, "route handler: a request that leaves the allowed hosts is ABORTED, recorded as a violation, and the runner is notified", JSON.stringify(violated || {}).slice(0, 160));
  const pub = mkRoute("https://api.copilt.org/v1/x", "POST"); h(pub);
  ok(pub.aborted === "blockedbyclient" && g.violations.length === 2, "route handler: a POST to the public API host is aborted too");
  ok(g.summary().browserBlocked === 2 && g.summary().browserChecked === 3, "browser egress audit counts: 3 checked, 2 blocked", JSON.stringify(g.summary()).slice(0, 160));
}

/* ================================================================== D2. operator tunnel (real staging host, SSH -L to the loopback operator listener) */
group("D2. operator tunnel: the URL keeps :443, the connection is dialled at 127.0.0.1:<local tunnel port>");
{
  const TUN = { stageHost: "stage.copilt.org", stageIp: "127.0.0.1", port: 18443, stageId: "0123456789abcdef0123", operatorTunnel: { publicIp: "203.0.113.10" } };
  const mkT = (over = {}) => { const s = spy(); return { g: new G.TargetGuard(G.buildConfig({ ...TUN, ...over, spawn: s.spawn, spawnSync: s.spawnSync })), s }; };
  ok((() => { try { mkT(); return true; } catch { return false; } })(), "a valid operator-tunnel config builds (loopback expected IP, local port 18443, public IP 203.0.113.10)");
  refusesBuild("tunnel: the public end is a known production address", { ...TUN, operatorTunnel: { publicIp: "139.59.157.231" } }, "known-production-ip");
  refusesBuild("tunnel: the public end is a GitHub Pages address", { ...TUN, operatorTunnel: { publicIp: "185.199.108.153" } }, "known-production-ip");
  refusesBuild("tunnel: hex IPv4-mapped public end", { ...TUN, operatorTunnel: { publicIp: "::ffff:8b3b:9de7" } }, "known-production-ip");
  refusesBuild("tunnel: leading-zero public end", { ...TUN, operatorTunnel: { publicIp: "139.073.157.231" } }, "invalid-ip");
  refusesBuild("tunnel: the public end is loopback", { ...TUN, operatorTunnel: { publicIp: "127.0.0.1" } }, "operator-tunnel");
  refusesBuild("tunnel: the public end is missing", { ...TUN, operatorTunnel: {} }, "operator-tunnel");
  refusesBuild("tunnel: the public end is multicast", { ...TUN, operatorTunnel: { publicIp: "224.0.0.1" } }, "operator-tunnel");
  refusesBuild("tunnel: the dialled end is not loopback", { ...TUN, stageIp: "203.0.113.10" }, "operator-tunnel");
  refusesBuild("tunnel: local port 443", { ...TUN, port: 443 }, "operator-tunnel");
  refusesBuild("tunnel: privileged local port 80", { ...TUN, port: 80 }, "operator-tunnel");
  for (const qp of [8981, 8982, 8983, 9111, 9112, 9113, 9114]) refusesBuild(`tunnel: local port ${qp} (QA / owner fixture)`, { ...TUN, port: qp }, "operator-tunnel");
  refusesBuild("tunnel: an http port", { ...TUN, httpPort: 80 }, "operator-tunnel");
  refusesBuild("tunnel: an alias host", { ...TUN, aliasHosts: ["stage2.copilt.org"] }, "operator-tunnel");
  refusesBuild("tunnel: combined with a rehearsal config", { ...TUN, rehearsal: true }, "operator-tunnel");
  refusesBuild("tunnel: plain-http identity", { ...TUN, identityScheme: "http" }, "operator-tunnel");
  for (const h of ["www.copilt.org", "copilt.org", "api.copilt.org"]) refusesBuild(`tunnel: the production name ${h} as the host`, { ...TUN, stageHost: h }, "production-host");
  refusesBuild("tunnel: a missing stage id", { ...TUN, stageId: undefined }, "missing-marker");
  // requests: the URL must carry the PUBLIC port 443; the local tunnel port in a URL is refused
  { const { g, s } = mkT(); g.identity = { verified: true, via: "test", at: Date.now() };
    const args = g.curlArgs({ url: "https://stage.copilt.org:443/wp-admin/" });
    const ct = args[args.indexOf("--connect-to") + 1];
    ok(ct === "stage.copilt.org:443:127.0.0.1:18443" && s.calls.length === 0, "tunnel: https://stage.copilt.org:443/... is dialled at 127.0.0.1:18443 (--connect-to stage.copilt.org:443:127.0.0.1:18443)", ct);
    ok(args.filter((a) => a === "--connect-to").length === 1 && !args.includes("-L") && args.includes("--max-redirs"), "tunnel: exactly one connect-to mapping, redirects still never followed by curl");
    let e = null; try { g.curlArgs({ url: "https://stage.copilt.org:18443/wp-admin/" }); } catch (x) { e = x; }
    ok(e?.code === "url-port-mismatch", "tunnel: a URL carrying the local tunnel port (:18443) is refused [url-port-mismatch]: only the public :443 form is valid", e?.code);
    let e2 = null; try { g.curlArgs({ url: "https://www.copilt.org:443/" }); } catch (x) { e2 = x; }
    ok(e2?.code === "production-host", "tunnel: https://www.copilt.org:443/ is refused [production-host]", e2?.code);
    let e3 = null; try { g.curlArgs({ url: "http://stage.copilt.org:80/" }); } catch (x) { e3 = x; }
    ok(e3?.code === "scheme-not-allowed", "tunnel: plain http is refused [scheme-not-allowed]", e3?.code);
    const sock = g.socketOptions("https://stage.copilt.org:443/wp-login.php");
    ok(sock.host === "127.0.0.1" && sock.port === 18443 && sock.servername === "stage.copilt.org", "tunnel: a raw socket dials 127.0.0.1:18443 with SNI stage.copilt.org", JSON.stringify(sock));
    const fresh = mkT().g;
    let e4 = null; try { fresh.curlArgs({ url: "https://stage.copilt.org:443/wp-admin/" }); } catch (x) { e4 = x; }
    ok(e4?.code === "identity-not-verified", "tunnel: nothing but the identity probe is sent before the identity is verified [identity-not-verified]", e4?.code);
    let e5 = null; try { fresh.curlArgs({ url: "https://stage.copilt.org:443/wp-login.php", method: "POST" }); } catch (x) { e5 = x; }
    ok(e5?.code === "destructive-before-identity", "tunnel: a POST before the identity is verified is refused [destructive-before-identity]", e5?.code);
  }
  // DNS: the PUBLIC address of the host is what must match, not the loopback end
  { const mkD = (addrs) => { const s = spy(); return new G.TargetGuard(G.buildConfig({ ...TUN, resolver: async () => addrs, spawn: s.spawn, spawnSync: s.spawnSync })); };
    const okR = await mkD(["203.0.113.10"]).verifyDns();
    ok(okR.match === true, "tunnel DNS: the host resolves to the declared public IP -> accepted");
    let e = null; try { await mkD(["198.51.100.7"]).verifyDns(); } catch (x) { e = x; }
    ok(e?.code === "dns-mismatch" && /203\.0\.113\.10/.test(e.message), "tunnel DNS: the host resolves to another address -> refused [dns-mismatch] naming the expected public IP", e?.message?.slice(0, 160));
    let e2 = null; try { await mkD(["127.0.0.1"]).verifyDns(); } catch (x) { e2 = x; }
    ok(e2?.code === "dns-mismatch", "tunnel DNS: a host that resolves to loopback is NOT accepted just because the dialled end is loopback", e2?.code);
  }
  // browser: the page URL keeps :443 (WordPress's absolute URLs), the resolver maps it to the tunnel port; the local port itself is not a valid page URL
  { const { g } = mkT();
    for (const [u, want] of [["https://stage.copilt.org/wp-admin/", true], ["https://stage.copilt.org:443/wp-login.php", true], ["https://stage.copilt.org:18443/", false], ["https://stage.copilt.org:8443/", false], ["http://stage.copilt.org/", false], ["https://www.copilt.org/", false], ["https://api.copilt.org/", false], ["https://127.0.0.1:18443/", false], ["data:text/plain,x", true]]) ok(g.browserAllows(u) === want, `tunnel browserAllows(${u}) === ${want}`);
    const a = g.browserArgs();
    ok(a.some((x) => x === "--host-resolver-rules=MAP stage.copilt.org 127.0.0.1:18443, MAP * ~NOTFOUND"), "tunnel browser args: MAP stage.copilt.org 127.0.0.1:18443, everything else NOTFOUND", a.find((x) => /host-resolver/.test(x)));
  }
  // CLI flag
  { const { raw } = G.parseGuardArgs(["--stage-host", "stage.copilt.org", "--stage-ip", "127.0.0.1", "--port", "18443", "--stage-id", "0123456789abcdef0123", "--operator-tunnel-of", "203.0.113.10"], {});
    ok(raw.operatorTunnel?.publicIp === "203.0.113.10" && raw.port === "18443", "parseGuardArgs reads --operator-tunnel-of IP");
    // existing non-tunnel behaviour is unchanged: the same loopback config WITHOUT the tunnel flag keeps requiring the DNS answer to be the (loopback) expected IP and the URL port to be the configured one
    const s = spy(); const plain = new G.TargetGuard(G.buildConfig({ stageHost: "stage.copilt.org", stageIp: "127.0.0.1", port: 18443, stageId: "0123456789abcdef0123", resolver: async () => ["203.0.113.10"], spawn: s.spawn, spawnSync: s.spawnSync }));
    let e = null; try { await plain.verifyDns(); } catch (x) { e = x; }
    ok(e?.code === "dns-mismatch", "control: a loopback expected IP WITHOUT --operator-tunnel-of is still refused when public DNS says something else [dns-mismatch]", e?.code);
    plain.identity = { verified: true, via: "t", at: Date.now() };
    let e2 = null; try { plain.curlArgs({ url: "https://stage.copilt.org:443/" }); } catch (x) { e2 = x; }
    ok(e2?.code === "url-port-mismatch", "control: without the tunnel flag a :443 URL on a :18443 config is still refused [url-port-mismatch]", e2?.code);
  }
}

/* ================================================================== E. repo invariants */
group("E. repo invariants");
{
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", ".next", ".git"].includes(e.name)) continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else out.push(f); } return out; };
  // 1. the production build (out/) and everything that feeds it never contain the stage identity
  const outDir = path.join(ROOT, "out"), pubDir = path.join(ROOT, "public");
  const hit = (dir) => (fs.existsSync(dir) ? walk(dir).filter((f) => { try { const st = fs.statSync(f); if (st.size > 20 * 1024 * 1024) return /aicc-stage-identity/.test(f); return /aicc-stage-identity/.test(f) || (/\.(html|txt|json|js|xml|map|css)$/.test(f) && fs.readFileSync(f, "utf8").includes("aicc-stage-identity")); } catch { return false; } }) : null);
  const ho = hit(outDir), hp = hit(pubDir);
  ok(ho === null ? (skip("out/ is not built: the production-build scan is skipped"), true) : ho.length === 0, "the production static build (out/) contains no aicc-stage-identity file or reference", (ho || []).join(", "));
  ok(hp === null || hp.length === 0, "public/ (the source of the build) contains no aicc-stage-identity file", (hp || []).join(", "));
  ok(!fs.existsSync(path.join(outDir, ".well-known/aicc-stage-identity")) && !fs.existsSync(path.join(pubDir, ".well-known/aicc-stage-identity")), "no .well-known/aicc-stage-identity file in out/ or public/");
  // 2. the committed template and the production render
  const R = await import("./lib/edge-render.mjs");
  const tpl = R.readTemplate();
  const code = (t) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  ok(!/aicc-stage-identity/.test(code(tpl)), "the committed (production) template contains no identity route");
  ok(R.render(tpl, { mode: "production" }).text === tpl && !/aicc-stage-identity/.test(code(R.render(tpl, { mode: "production" }).text)), "the production render is the committed template and has no identity route");
  ok(/aicc-stage-identity/.test(code(R.render(tpl, { mode: "stage" }).text)), "the stage render DOES have the identity route (control)");
  ok((() => { try { R.render(tpl, { mode: "production", identity: "staging" }); return false; } catch { return true; } })(), "the renderer refuses to add an identity route to the production render");
  const ops = fs.existsSync(path.join(ROOT, "scripts/ops/render-edge.mjs")) ? spawnSync(process.execPath, [path.join(ROOT, "scripts/ops/render-edge.mjs"), "--mode", "production"], { encoding: "utf8" }) : null;
  ok(!ops || (ops.status === 0 && !/aicc-stage-identity/.test(code(ops.stdout))), "scripts/ops/render-edge.mjs --mode production prints a Caddyfile without the identity route", ops ? ops.stderr.slice(0, 200) : "");
  // 3. every runner goes through the guard
  const usesGuard = (rel) => { const t = fs.readFileSync(path.join(ROOT, rel), "utf8"); return /target-guard\.mjs/.test(t) || /from "\.\/lib\.mjs"/.test(t); };
  const libText = fs.readFileSync(path.join(REH, "lib.mjs"), "utf8");
  ok(/target-guard\.mjs/.test(libText) && /guardFor\(inst/.test(libText) && /socketOptions/.test(libText) && /curlAsync|followAsync/.test(libText), "scripts/rehearsal/lib.mjs (req, rawRequest, startProbe: every rehearsal request) goes through the target guard");
  for (const rel of ["scripts/staging-replay.mjs", "scripts/rehearsal/rcurl.mjs", "scripts/rehearsal/browser-flows.mjs", "scripts/rehearsal/run-tests.mjs", "scripts/rehearsal/edge.mjs"]) ok(usesGuard(rel), `${rel} imports the target guard (directly or through scripts/rehearsal/lib.mjs)`);
  for (const rel of ["scripts/rehearsal/stage-load.mjs"]) ok(usesGuard(rel), `${rel} imports the target guard (its load requests all go through guard.curlAsync)`);
  // the remote-stage adapter and the sampler reach the host ONLY through ~/aicc-rehearsal/bin/stage-ssh (hard-wired to the staging Droplet): no ssh/scp/rsync of their own, no production address or key, no network call
  for (const rel of ["scripts/rehearsal/stage-remote.mjs", "scripts/rehearsal/stage-sampler.mjs"]) {
    const t = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    ok(!/\b(spawn|spawnSync|execFile|execFileSync|exec|execSync)\(\s*["'`](ssh|scp|sftp|rsync)["'`]/.test(t) && /STAGE_SSH/.test(t) && /aicc-rehearsal\/bin\/stage-ssh/.test(t), `${rel} runs remote commands only through stage-ssh (no direct ssh/scp/rsync process)`);
    ok(!/139\.59\.157\.231|aicc_digitalocean_prod|api\.copilt\.org|\bwww\.copilt\.org|[^.\w]copilt\.org/.test(t) && !/\bfetch\(|https?\.(get|request)\(|curl /.test(t.replace(/`[^`]*`/g, "")), `${rel} contains no production address/key/name and sends no HTTP request of its own`);
  }
  { const t = fs.readFileSync(path.join(REH, "stage-remote.mjs"), "utf8");
    ok(/localPort < 1024/.test(t) && /localPort === 443/.test(t) && /9111/.test(t) && /8981/.test(t), "stage-remote.mjs refuses a tunnel on a privileged port, 443 and the owner's QA / fixture ports (8981-8983, 9111-9114)");
    ok(/--prompt=user_pass/.test(t) && !/--user_pass=/.test(t.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")), "stage-remote.mjs hands test passwords to wp-cli only through --prompt=user_pass on stdin (never --user_pass=<value> on a command line)"); }
  const bf = fs.readFileSync(path.join(REH, "browser-flows.mjs"), "utf8");
  ok(/guardBrowser\(/.test(bf) && /browserArgs\(/.test(bf), "browser-flows.mjs installs the browser egress guard (route handler + host-resolver allowlist)");
  ok(/installDnsGuard/.test(fs.readFileSync(path.join(ROOT, "scripts/staging-replay.mjs"), "utf8")) && /installDnsGuard/.test(libText), "the DNS tripwire (production names are never resolved in a run) is installed by staging-replay and the rehearsal library");
  const cpfx = fs.readFileSync(path.join(REH, "cp-fixture.sh"), "utf8"), fpmsh = fs.readFileSync(path.join(REH, "fpm.sh"), "utf8");
  ok(/egress-guard\.php/.test(cpfx) && /loopback-only\.sb/.test(cpfx) && /fixture-router\.php/.test(cpfx) && /egress-guard\.php/.test(fpmsh) && /loopback-only\.sb/.test(fpmsh), "the fixture's PHP (php -S through fixture-router.php, wp-cli, php-fpm) starts with the WordPress egress guard and under the loopback-only sandbox profile");
  ok(/WP_Error\( 'aicc_egress_blocked'/.test(fs.readFileSync(path.join(REH, "egress-guard.php"), "utf8")) && /\(deny network-outbound/.test(fs.readFileSync(path.join(REH, "loopback-only.sb"), "utf8")), "egress-guard.php answers non-allowed hosts with a WP_Error and loopback-only.sb denies every non-loopback outbound connect");
  ok(fs.statSync(path.join(REH, "rcurl")).mode & 0o111, "scripts/rehearsal/rcurl is executable (the repo replacement for ~/aicc-rehearsal/bin/rcurl)");
  // 4. no raw network call to a production name in scripts/ (the guard module itself, this test and the explicit read-only readers below are the only exceptions)
  const READERS = new Set([
    "scripts/visual-contract.mjs", "scripts/shots-aa.mjs", "scripts/shots-brand.mjs",          // load the LIVE site (AICC_LEGACY_URL) in a browser as the visual reference: read-only GET page loads, run by hand
    "scripts/launch-check.mjs",                                                                  // fetch(AICC_CHECKOUT_URL) only when the owner passes a URL
    "scripts/ops/cert-expiry-check.sh",                                                          // the production certificate monitor: a TLS handshake to --host, read-only, run from outside
    "scripts/seo-check.mjs", "scripts/lib/seo-audit.mjs", "scripts/interaction-test.mjs",      // mention the origin as data (canonical URLs), no network call
    "scripts/lib/redirect-matrix.mjs", "scripts/test-redirects.mjs", "scripts/lib/edge-render.mjs", "scripts/lib/target-guard.mjs", "scripts/test-target-guard.mjs",
  ]);
  const NET = /\bcurl\b[^\n]*https?:\/\/[^\s'"`]*copilt\.org|\bfetch\(\s*[`"'][^`"']*copilt\.org|https?\.(request|get)\([^)]*copilt\.org|tls\.connect\([^)]*copilt\.org|s_client[^\n]*copilt\.org|\bopenssl s_client\b[^\n]*-connect [a-z.]*copilt/;
  ok(["curl -s https://www.copilt.org/x", 'await fetch("https://api.copilt.org/v1")', "https.get('https://www.copilt.org/')", "echo | openssl s_client -connect www.copilt.org:443", "curl -sI https://api.copilt.org/"].every((l) => NET.test(l) && /copilt\.org/.test(l)), "control: the scan's pattern does detect curl / fetch / https.get / s_client against a production name");
  const offenders = [];
  for (const f of walk(path.join(ROOT, "scripts"))) {
    const rel = path.relative(ROOT, f);
    if (!/\.(mjs|sh|js)$/.test(f) && !/rcurl$/.test(f)) continue;
    if (READERS.has(rel)) continue;
    const text = fs.readFileSync(f, "utf8");
    text.split("\n").forEach((l, i) => { if (/^\s*(\/\/|#)/.test(l)) return; if (NET.test(l) && /copilt\.org/.test(l) && !/127\.0\.0\.1|rcurl|loopback|productionReadonlyGuard|production-readonly|page\.evaluate|S\.info\(|S\.note\(/.test(l)) offenders.push(`${rel}:${i + 1}: ${l.trim().slice(0, 140)}`); });
  }
  ok(offenders.length === 0, "no script sends curl / fetch / https / s_client to a production name outside the explicit read-only allowlist", offenders.slice(0, 6).join("\n       "));
  // 5. the old unguarded wrapper is not referenced any more
  const old = [];
  for (const f of walk(path.join(ROOT, "scripts"))) { if (/test-target-guard|rcurl(\.mjs)?$/.test(f)) continue; const t = fs.readFileSync(f, "utf8"); if (t.split("\n").some((l) => !/^\s*(\/\/|#|\*)/.test(l) && /bin\/rcurl/.test(l))) old.push(path.relative(ROOT, f)); }
  ok(old.length === 0, "nothing in scripts/ still calls the old ~/aicc-rehearsal/bin/rcurl wrapper (it sends anything it is given)", old.join(", "));
}

/* ================================================================== F. positive: the local rehearsal edge with the staging-named alias */
group("F. positive against the local rehearsal edge (stage-rehearsal.copilt.org -> 127.0.0.1)");
{
  const L = await import("./rehearsal/lib.mjs");
  const live = fs.existsSync(L.P.caddy) && fs.existsSync(L.P.rootCrt) && (await L.portListening(L.INSTANCES.edge.httpsPort));
  if (!live) skip("no rehearsal edge is running on this machine (node scripts/rehearsal/rehearsal.mjs start): the positive tests need it");
  else {
    const raw = L.rehearsalConfig("edge");
    const g = new G.TargetGuard(G.buildConfig(raw));
    ok(raw.stageHost === "stage-rehearsal.copilt.org" && G.classifyHost(raw.stageHost) === "staging", "the rehearsal's staging label is a clearly staging-named alias (stage-rehearsal.copilt.org)");
    const idn = await g.ensureIdentity();
    ok(idn.verified && idn.env === "rehearsal", `the rehearsal edge proves its identity (env rehearsal, host ${raw.stageHost}, id matched) via ${idn.via}`);
    const r = await g.curlAsync({ url: "https://www.copilt.org:443/robots.txt", method: "GET", cacert: L.P.rootCrt });
    ok(r.status === 200 && /User-agent/i.test(r.body), "GET https://www.copilt.org:443/robots.txt through the guard (name -> 127.0.0.1, local CA) answers 200", String(r.status));
    const post = await g.curlAsync({ url: "https://www.copilt.org:443/wp-login.php?loggedout=true", method: "POST", body: "x=1", cacert: L.P.rootCrt });
    ok(post.status === 403, "a POST is sent only after the identity was verified, and the edge's own rule answers it (403)", String(post.status));
    const f = await g.followAsync({ url: "https://copilt.org:443/pricing?x=1", method: "GET", cacert: L.P.rootCrt });
    ok(f.status === 200 && f.redirects === 1 && /^https:\/\/www\.copilt\.org:443\/pricing\/\?x=1$/.test(f.effective), "an apex redirect is followed hop by hop inside the allowed host set (apex -> www, 1 hop)", `${f.status} hops=${f.redirects} ${f.effective}`);
    const wrong = new G.TargetGuard(G.buildConfig({ ...raw, stageId: "ffffffffffffffffffffffff" }));
    let e = null; try { await wrong.ensureIdentity(); } catch (x) { e = x; }
    ok(e?.code === "identity-mismatch", "the same edge with the WRONG --stage-id is refused [identity-mismatch]", e?.code);
    const sum = g.summary();
    ok(sum.violations === 0 && sum.offTargetSends === 0 && Object.keys(sum.destinations).every((k) => /->127\.0\.0\.1$/.test(k)), "egress audit of the positive run: 0 violations, every send went to 127.0.0.1", JSON.stringify(sum.destinations).slice(0, 200));
    // rcurl end to end
    const rc = spawnSync(path.join(REH, "rcurl"), ["--rehearsal", "edge", "-s", "-o", "/dev/null", "-w", "%{http_code}", "https://www.copilt.org:443/robots.txt"], { encoding: "utf8" });
    ok(rc.status === 0 && rc.stdout.trim() === "200", "scripts/rehearsal/rcurl --rehearsal edge works end to end", `${rc.status} ${rc.stdout} ${rc.stderr.slice(0, 120)}`);
  }
}

fs.rmSync(shim, { recursive: true, force: true });
console.log(`\ntest-target-guard: ${checks} checks, ${failures} failed, ${skipped} skipped`);
if (failures) { console.error(`FAIL: ${failures} of ${checks} checks`); process.exit(1); }
console.log("PASS: every refusal of the fail-closed target guard holds, with nothing sent");
