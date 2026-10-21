// rcurl: a curl that cannot send what it should not. Every URL passes the target guard (scripts/lib/target-guard.mjs) BEFORE curl runs; the guard, not the caller, supplies the
// connect-to mapping, so there is no way to "forget" a --resolve and fall through to public DNS.
//
//   rcurl --rehearsal [edge|public|stage] [curl options] https://www.copilt.org:443/pricing/       # the Mac rehearsal (names -> 127.0.0.1; ports from the instance)
//   rcurl --stage-host stage.copilt.org --stage-ip 203.0.113.10 --port 443 --stage-id <id> [--http-port 80] [curl options] https://stage.copilt.org:443/
//   rcurl --production-readonly --stage-host www.copilt.org --port 443 -I https://www.copilt.org:443/      # GET/HEAD to the real site: the ONLY way to reach a production name
//
// Rules (each is a refusal with exit code 3 and nothing sent): every URL needs an explicit port; hosts other than the staging host (and --alias-host names) are refused; production names
// are refused unless --production-readonly (GET/HEAD only); state-changing methods are refused until the identity route has proved the server is the staging host with the id you gave;
// redirects are never followed (-L is refused); proxies, --resolve/--connect-to to any other address, --config and --next are refused. A user-supplied --resolve/--connect-to is checked
// against the expected IP and then replaced by the guard's own mapping. Environment fallbacks: AICC_STAGE_HOST, AICC_STAGE_IP, AICC_STAGE_PORT, AICC_STAGE_HTTP_PORT, AICC_STAGE_ID.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { TargetGuard, buildConfig, parseGuardArgs, assertMappings, guarded, GuardRefusal, installDnsGuard } from "../lib/target-guard.mjs";
import { rehearsalConfig } from "./lib.mjs";

const NOARG = new Set(["-s", "-S", "-i", "-I", "-v", "-k", "-g", "-f", "--compressed", "--http1.1", "--http2", "--path-as-is", "--silent", "--show-error", "--include", "--head", "--verbose", "--insecure", "--globoff", "--fail", "--tlsv1.2", "--tlsv1.3", "-4", "-6", "--ipv4", "--ipv6"]);
const WITHARG = new Set(["-X", "--request", "-H", "--header", "-d", "--data", "--data-binary", "--data-raw", "--data-urlencode", "-o", "--output", "-D", "--dump-header", "-w", "--write-out", "-m", "--max-time", "--connect-timeout", "-b", "--cookie", "-c", "--cookie-jar", "-A", "--user-agent", "-e", "--referer", "-r", "--range", "--cacert", "--tls-max", "--retry"]);
const MAP_OPTS = new Set(["--resolve", "--connect-to"]);

await guarded(async () => {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 14).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(argv.length ? 0 : 2); }
  let rehearsal = null;
  const pre = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--rehearsal") { const nx = argv[i + 1]; if (nx && !nx.startsWith("-") && !/^[a-z]+:\/\//i.test(nx)) { rehearsal = nx; i++; } else rehearsal = "edge"; } else pre.push(argv[i]);
  }
  const { raw, rest } = parseGuardArgs(pre);
  const base = rehearsal ? rehearsalConfig(rehearsal) : {};
  const cfg = buildConfig({ ...base, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))), aliasHosts: [...(base.aliasHosts || []), ...raw.aliasHosts] });
  const g = new TargetGuard(cfg);
  installDnsGuard(g);
  const extra = [], mappings = [], urls = [];
  let method = null, head = false, hasData = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(a)) { urls.push(a); continue; }
    const flag = a.startsWith("--") && a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
    if (MAP_OPTS.has(flag)) { mappings.push(a.includes("=") ? a.slice(a.indexOf("=") + 1) : rest[++i]); continue; }
    if (NOARG.has(flag) || (/^-[sSivkgf]{2,}$/.test(a))) { if (a === "-I" || a === "--head" || /^-[a-zA-Z]*I[a-zA-Z]*$/.test(a)) head = true; extra.push(a); continue; }
    if (WITHARG.has(flag)) {
      const val = a.includes("=") && a.startsWith("--") ? a.slice(a.indexOf("=") + 1) : rest[++i];
      if (flag === "-X" || flag === "--request") method = String(val).toUpperCase();
      if (/^(-d|--data|--data-binary|--data-raw|--data-urlencode)$/.test(flag)) hasData = true;
      extra.push(a.includes("=") && a.startsWith("--") ? a : flag, ...(a.includes("=") && a.startsWith("--") ? [] : [val]));
      continue;
    }
    throw new GuardRefusal("forbidden-curl-option", `curl option '${a}' is not in rcurl's allowlist (rcurl refuses what it cannot prove safe; use staging-replay or add the option to scripts/rehearsal/rcurl.mjs deliberately)`);
  }
  if (!urls.length) throw new GuardRefusal("bad-url", "no URL given");
  if (!g.readonly) {
    const need = urls.map((u) => { const m = /^(https?):\/\/(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?/i.exec(u); return m && m[3] ? `${m[2].toLowerCase()}:${m[3]}` : null; }).filter(Boolean);
    if (mappings.length) assertMappings(mappings, { expectedIp: cfg.stageIp, required: [] });
    void need;
  } else if (mappings.length) throw new GuardRefusal("mapping-mismatch", "--production-readonly takes no --resolve/--connect-to");
  const m = method || (head ? "HEAD" : hasData ? "POST" : "GET");
  for (const u of urls) g.precheck(u, m); // URL shape, host, port and method are checked before any DNS lookup or identity probe
  await g.ensureIdentity();
  let code = 0;
  for (const u of urls) {
    const args = g.curlArgs({ url: u, method: m, extra, userOutput: true, timeout: 60, cacert: cfg.cacert, pathAsIs: true });
    const r = spawnSync("curl", args, { stdio: "inherit", env: g._env() });
    if (r.status) code = r.status;
  }
  process.exit(code);
});
