#!/usr/bin/env node
// stage-remote.mjs: the REMOTE FIXTURE provider for browser-flows.mjs against the real Linux staging host (stage.copilt.org). It replaces what the Mac rehearsal gets from the local CP fixture
// (wp-cli, the captured-mail directory, the echo token) with the same operations done ON THE HOST, over SSH, and ONLY through ~/aicc-rehearsal/bin/stage-ssh (hard-wired to the staging Droplet;
// no other ssh command is ever built here).
//
//   node scripts/rehearsal/stage-remote.mjs seed    --cp-repo DIR [--apply]   copy the CP repo's idempotent bootstrap scripts to a temp dir under ~aicc, run them through `aicc-wp eval-file` (dry run unless --apply)
//   node scripts/rehearsal/stage-remote.mjs gate    --cp-repo DIR             the CP launch gate (check-launch-blockers.php) with AICC_PRODUCTION unset; prints its blockers, exit code kept
//   node scripts/rehearsal/stage-remote.mjs status                           users, products, gateways, legal versions, mail sink, leftover test data
//   node scripts/rehearsal/stage-remote.mjs cleanup                          delete every @example.test user and every sink mail addressed to one; remove the temp seed dir
//   node scripts/rehearsal/stage-remote.mjs tunnel open|close [--local-port N]
//
// HOW EACH SECRET IS HANDLED (documented because it was a hard requirement)
//   * Disposable customer passwords are generated in this process's memory. They reach the host ONLY on the stdin of the ssh channel (`aicc-wp user create ... --prompt=user_pass`, wp-cli reads the value from
//     STDIN): never an argv (so never in `ps` on the host or the Mac), never an environment variable, never a file, never a log. They exist in this process and in the browser form fields, nowhere else.
//   * The wp-admin password (/etc/aicc/secrets/wp-admin.pass, root-only) is read with `sudo cat` over ssh INTO MEMORY, typed into the login form, never printed or written.
//   * Password-reset mails: the host's mail sink writes /var/lib/aicc-cp/mail/*.eml (0600 aicc-cp). A small python3 program run with sudo ON THE HOST finds the newest mail for a recipient, decodes it and
//     returns ONLY {file, subject, to, links[]}; the links (which carry the reset key) live in this process's memory; the key is never printed (callers redact), the mail file is deleted afterwards.
//   * Everything else (usernames of test accounts, ids) is non-secret and may appear in results.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const STAGE_SSH = process.env.AICC_STAGE_SSH || path.join(os.homedir(), "aicc-rehearsal/bin/stage-ssh");
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`; // POSIX single-quote for the remote shell

/** Decode + extract links of the newest mail for a recipient. Runs on the host with sudo; prints one JSON line. argv: recipient since_epoch */
const MAIL_PY = String.raw`
import sys, os, re, json, email, email.policy, html, time
to_want = sys.argv[1].lower(); since = float(sys.argv[2]); subj_re = sys.argv[3] if len(sys.argv) > 3 else ""; d = "/var/lib/aicc-cp/mail"
best = None
for f in os.listdir(d):
    if not f.endswith(".eml"): continue
    p = os.path.join(d, f); m = os.stat(p).st_mtime
    if m < since: continue
    try: msg = email.message_from_binary_file(open(p, "rb"), policy=email.policy.default)
    except Exception: continue
    to = str(msg.get("To", "")).lower()
    if to_want not in to: continue
    if subj_re and not re.search(subj_re, str(msg.get("Subject", "")), re.I): continue
    if best is None or m > best[0]: best = (m, f, msg, to)
if not best: print(json.dumps({"found": False})); sys.exit(0)
m, f, msg, to = best
body = ""
for part in msg.walk():
    if part.get_content_type() in ("text/html", "text/plain"):
        try: body += part.get_content() + "\n"
        except Exception: pass
links = [html.unescape(x) for x in re.findall(r'href="([^"]+)"', body)]
links += [html.unescape(x) for x in re.findall(r'https?://[^\s<>")]+', body)]
seen = []; [seen.append(x) for x in links if x not in seen]
print(json.dumps({"found": True, "file": f, "subject": str(msg.get("Subject", "")), "to": to, "links": seen, "ctype": msg.get_content_type(), "bytes": os.stat(os.path.join(d, f)).st_size}))
`;

export class StageRemote {
  constructor({ ctl } = {}) {
    if (!fs.existsSync(STAGE_SSH)) throw new Error(`stage-ssh not found at ${STAGE_SSH}`);
    this.ctl = ctl || path.join(os.tmpdir(), `aicc-stage-ctl-${process.pid}-${crypto.randomBytes(3).toString("hex")}`);
    this.tunnels = new Map();
    this.mailFiles = new Set();
    this.userIds = new Set();
    this.mux = false;
  }
  /** Open our OWN multiplexed ssh master (the persistent session S0 of the operator is not touched). */
  start() {
    if (this.mux) return;
    // stdio "ignore": a backgrounded (-f) ssh keeps inherited pipes open, which would make spawnSync wait for ever
    const r = spawnSync(STAGE_SSH, ["-o", "ControlMaster=yes", "-o", `ControlPath=${this.ctl}`, "-o", "ControlPersist=600", "-N", "-f"], { stdio: "ignore", timeout: 30000 });
    if (r.status !== 0) throw new Error(`could not open the ssh master (exit ${r.status})`);
    this.mux = true;
  }
  _opts() { return this.mux ? ["-o", `ControlPath=${this.ctl}`, "-o", "ControlMaster=no"] : []; }
  /** Run a remote command string. input (string) goes to the remote stdin. Returns {code, out, err}. */
  exec(cmd, { input, timeout = 60000 } = {}) {
    const r = spawnSync(STAGE_SSH, [...this._opts(), cmd], { input, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024 });
    return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
  }
  async execAsync(cmd, { input, timeout = 60000 } = {}) {
    return new Promise((resolve) => {
      const p = spawn(STAGE_SSH, [...this._opts(), cmd], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "", err = ""; const t = setTimeout(() => p.kill("SIGKILL"), timeout);
      p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
      p.stdin.end(input ?? "");
    });
  }
  /** aicc-wp = wp-cli as the CP's PHP user against the active release (read the wrapper: it never runs as root). `secrets` are scrubbed from everything returned (wp-cli's --prompt echoes the value it read). */
  wp(args, { input, timeout = 90000, secrets = [] } = {}) {
    const r = this.exec(`aicc-wp ${args.map(q).join(" ")}`, { input, timeout });
    const scrub = (t) => secrets.reduce((a, s) => (s ? a.split(s).join("***") : a), t);
    return { code: r.code, out: scrub(r.out), err: scrub(r.err) };
  }
  /** wp eval of a PHP snippet (no <?php tag). Only non-secret code goes through here: it is an argv on the host. */
  evalPhp(code, { timeout = 90000 } = {}) { return this.exec(`aicc-wp eval ${q(code)}`, { timeout }); }

  /* ---------------------------------------------------------------- disposable users */
  /** Create a customer. The password is passed on STDIN to wp-cli's --prompt=user_pass. Returns the numeric id. */
  createUser(login, email, password) {
    const r = this.wp(["user", "create", login, email, "--role=customer", "--prompt=user_pass", "--porcelain"], { input: password + "\n", secrets: [password] });
    const id = (r.out.trim().split("\n").pop() || "").trim(); // wp-cli echoes the prompted command first (scrubbed above); --porcelain prints the id last
    if (r.code !== 0 || !/^\d+$/.test(id)) throw new Error(`could not create test user ${login}: exit ${r.code} ${r.err.replace(/\s+/g, " ").slice(0, 200)}`);
    this.userIds.add(id);
    return id;
  }
  setPassword(id, password) {
    const r = this.wp(["user", "update", String(id), "--prompt=user_pass"], { input: password + "\n", secrets: [password] });
    if (r.code !== 0) throw new Error(`could not set a test password for user ${id}: ${r.err.replace(/\s+/g, " ").slice(0, 160)}`);
  }
  userField(email, field) { const r = this.wp(["user", "get", email, `--field=${field}`]); return r.code === 0 ? (r.out.trim().split("\n").pop() || "") : ""; }
  trackUser(id) { if (/^\d+$/.test(String(id))) this.userIds.add(String(id)); }
  deleteUsers(ids = [...this.userIds]) {
    let n = 0;
    for (const id of ids) { const r = this.wp(["user", "delete", String(id), "--yes"]); if (r.code === 0) n++; this.userIds.delete(String(id)); }
    return n;
  }
  /** Every user that is a test account (@example.test). */
  listTestUsers() {
    const r = this.wp(["user", "list", "--search=*@example.test", "--search-columns=user_email", "--field=ID"]);
    return r.code === 0 ? r.out.split("\n").map((l) => l.trim()).filter((l) => /^\d+$/.test(l)) : [];
  }

  /* ---------------------------------------------------------------- mail sink */
  /** Newest mail for `to` received since `sinceMs` (epoch ms). Retries until found or the timeout. Returns {file, subject, links} or null. */
  async waitMail(to, sinceMs, { timeout = 25000, subjectRe } = {}) {
    const t0 = Date.now(); const b64 = Buffer.from(MAIL_PY).toString("base64");
    while (Date.now() - t0 < timeout) {
      const r = await this.execAsync(`sudo -n python3 -c "$(echo ${b64} | base64 -d)" ${q(to)} ${((sinceMs - 5000) / 1000).toFixed(0)} ${q(subjectRe ? subjectRe.source : "")}`, { timeout: 20000 });
      try {
        const j = JSON.parse(r.out.trim().split("\n").pop() || "{}");
        if (j.found) { this.mailFiles.add(j.file); return j; }
      } catch { /* retry */ }
      await new Promise((res) => setTimeout(res, 1200));
    }
    return null;
  }
  deleteMail(files = [...this.mailFiles]) {
    let n = 0;
    for (const f of files) { if (!/^[0-9TZ-]+-[0-9a-f]+\.eml$/.test(f)) continue; const r = this.exec(`sudo -n rm -f -- /var/lib/aicc-cp/mail/${f}`); if (r.code === 0) n++; this.mailFiles.delete(f); }
    return n;
  }
  /** Remove every sink mail addressed to a test address, or mentioning a test login (bf-<tag>-<runid>; WordPress also mails the ADMIN a "Password Changed" notice per reset), and return how many were removed. */
  purgeTestMail() {
    const r = this.exec(`sudo -n bash -c 'n=0; for f in /var/lib/aicc-cp/mail/*.eml; do [ -e "$f" ] || continue; if grep -i -q -E "^To:.*@example\\.test|user: bf-[a-z0-9-]+-[0-9a-f]{6}" "$f"; then rm -f -- "$f"; n=$((n+1)); fi; done; echo $n'`);
    return Number(r.out.trim()) || 0;
  }
  mailDirCount() { const r = this.exec("sudo -n bash -c 'ls -1 /var/lib/aicc-cp/mail | wc -l'"); return Number(r.out.trim()) || 0; }

  /* ---------------------------------------------------------------- secrets read into memory only */
  adminCredentials() {
    const r = this.exec("sudo -n cat /etc/aicc/secrets/wp-admin.pass");
    if (r.code !== 0 || !r.out.trim()) throw new Error("could not read the operator password from the host");
    return { login: "aicc-stage-admin", password: r.out.replace(/\r?\n$/, "") };
  }

  /* ---------------------------------------------------------------- tunnels (our own, loopback on both ends) */
  openTunnel(localPort, remotePort = 8443) {
    if (this.tunnels.has(localPort)) return;
    if (!Number.isInteger(localPort) || localPort < 1024 || localPort === 443 || (localPort >= 8981 && localPort <= 8983) || (localPort >= 9111 && localPort <= 9114)) throw new Error(`refusing local tunnel port ${localPort}`);
    const busy = spawnSync("lsof", ["-nP", `-iTCP:${localPort}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    if ((busy.stdout || "").trim()) throw new Error(`local port ${localPort} is already in use`);
    const ctl = `${this.ctl}-t${localPort}`;
    const r = spawnSync(STAGE_SSH, ["-N", "-f", "-M", "-S", ctl, "-o", "ExitOnForwardFailure=yes", "-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`], { stdio: "ignore", timeout: 30000 });
    if (r.status !== 0) throw new Error(`could not open the tunnel (exit ${r.status})`);
    this.tunnels.set(localPort, ctl);
  }
  closeTunnel(localPort) {
    const ctl = this.tunnels.get(localPort);
    if (!ctl) return;
    spawnSync(STAGE_SSH, ["-S", ctl, "-O", "exit"], { stdio: "ignore", timeout: 15000 });
    this.tunnels.delete(localPort);
  }
  closeAll() {
    if (this.echo) { try { this.stopEcho(); } catch { /* best effort */ } }
    for (const p of [...this.tunnels.keys()]) this.closeTunnel(p);
    if (this.mux) { spawnSync(STAGE_SSH, ["-o", `ControlPath=${this.ctl}`, "-O", "exit"], { stdio: "ignore", timeout: 15000 }); this.mux = false; }
  }

  /* ---------------------------------------------------------------- throwaway echo instance (section 9: client IP / forged headers) */
  /**
   * A THROWAWAY second Caddy on the host, as the edge's own user (aicc-edge) in a transient systemd unit with memory/CPU caps and a hard 30-minute lifetime, listening on 127.0.0.1:<hostPort> ONLY (never public),
   * with TLS from its own `tls internal` CA (no ACME, no trust-store install, admin API off, storage in its temp dir). It uses the LIVE edge's `wp_proxy_fastcgi` snippet VERBATIM (extracted from
   * /etc/aicc-edge/Caddyfile at start time) in front of the SAME PHP-FPM pool socket, but serves ONE tiny PHP script (echo.php, from a temp dir that is not a release dir) instead of WordPress.
   * It also answers the stage identity route so the fail-closed guard can verify it through the tunnel. Everything is removed by stopEcho().
   * What it proves and what it cannot: see browser-flows.mjs section 9 (REMOTE).
   */
  startEcho({ stageHost, stageId, hostPort = 18481 }) {
    if (!/^[a-z0-9.-]+$/.test(stageHost) || !/^[A-Za-z0-9_-]{8,}$/.test(stageId) || !(hostPort > 18000 && hostPort < 19000)) throw new Error("bad echo parameters");
    const tag = crypto.randomBytes(4).toString("hex");
    const D = `/tmp/aicc-s9-${tag}`;
    const unit = `aicc-s9-echo-${tag}`;
    const echoPhp = [
      "<?php",
      "header('Content-Type: application/json'); header('Cache-Control: no-store');",
      "$h = []; foreach ($_SERVER as $k => $v) { if (strpos($k, 'HTTP_') === 0) { $h[strtolower(str_replace('_', '-', substr($k, 5)))] = $v; } }",
      "$fw = []; foreach ($_SERVER as $k => $v) { if (preg_match('/FORWARD|REAL_IP|CLIENT|^VIA$/i', $k)) { $fw[$k] = $v; } }",
      "echo json_encode(['remote_addr' => $_SERVER['REMOTE_ADDR'] ?? null, 'https_server_var' => $_SERVER['HTTPS'] ?? null, 'request_scheme' => $_SERVER['REQUEST_SCHEME'] ?? null, 'server_port' => $_SERVER['SERVER_PORT'] ?? null,",
      "  'host' => $_SERVER['HTTP_HOST'] ?? null, 'server_name' => $_SERVER['SERVER_NAME'] ?? null, 'sapi' => PHP_SAPI, 'php' => PHP_VERSION, 'script' => $_SERVER['SCRIPT_FILENAME'] ?? null,",
      "  'headers' => $h, 'getallheaders' => function_exists('getallheaders') ? getallheaders() : null, 'server_vars_matching_forward_real_client_via' => $fw]);",
      "",
    ].join("\n");
    const lines = [
      "set -eu",
      `D=${D}`,
      'mkdir -p "$D/docroot" "$D/data" "$D/config"',
      "cat > \"$D/docroot/echo.php\" <<'PHPEOF'",
      echoPhp + "PHPEOF",
      "SNIP=$(awk '/^\\(wp_proxy_fastcgi\\) \\{/{p=1} p{print} p&&/^\\}/{exit}' /etc/aicc-edge/Caddyfile)",
      '[ -n "$SNIP" ] || { echo "snippet not found" >&2; exit 3; }',
      'printf \'%s\\n\' "$SNIP" > "$D/snippet.txt"',
      '{',
      '  printf \'{\\n\\tadmin off\\n\\tauto_https disable_redirects\\n\\tskip_install_trust\\n\\tstorage file_system %s\\n\\tservers {\\n\\t\\tprotocols h1 h2\\n\\t\\tstrict_sni_host on\\n\\t}\\n}\\n\' "$D/data"',
      '  printf \'%s\\n\' "$SNIP"',
      `  printf '${stageHost}:${hostPort} {\\n\\tbind 127.0.0.1\\n\\ttls internal\\n\\t@aicc_id path /.well-known/aicc-stage-identity\\n\\thandle @aicc_id {\\n\\t\\theader Content-Type "application/json"\\n\\t\\theader Cache-Control "no-store"\\n\\t\\trespond \`{"env":"staging","host":"${stageHost}","id":"${stageId}"}\` 200\\n\\t}\\n\\thandle {\\n\\t\\timport wp_proxy_fastcgi\\n\\t}\\n}\\n'`,
      '} > "$D/Caddyfile"',
      'chmod -R a+rX "$D"; chmod 0755 "$D" "$D/docroot"',
      'AICC_WP_ROOT="$D/docroot" XDG_DATA_HOME="$D/data" XDG_CONFIG_HOME="$D/config" /usr/local/bin/caddy validate --config "$D/Caddyfile" --adapter caddyfile >/dev/null 2>"$D/validate.err" || { cat "$D/validate.err" >&2; exit 4; }',
      'rm -rf "$D/data" "$D/config"; mkdir -p "$D/data" "$D/config"', // validate (run as root) may have created storage files owned by root
      'chown -R aicc-edge:aicc-edge "$D/data" "$D/config"',
      `systemd-run --quiet --unit=${unit} --collect --uid=aicc-edge --gid=aicc-edge --property=MemoryMax=96M --property=CPUQuota=30% --property=RuntimeMaxSec=1800 --property=NoNewPrivileges=yes \\`,
      '  --setenv=AICC_WP_ROOT="$D/docroot" --setenv=XDG_DATA_HOME="$D/data" --setenv=XDG_CONFIG_HOME="$D/config" --setenv=GOMEMLIMIT=64MiB \\',
      "  /usr/local/bin/caddy run --config \"$D/Caddyfile\" --adapter caddyfile",
      `for i in $(seq 1 40); do ss -ltn | grep -q "127.0.0.1:${hostPort} " && break; sleep 0.25; done`,
      `ss -ltn | grep "127.0.0.1:${hostPort} " >/dev/null || { journalctl -u ${unit} --no-pager -n 15 >&2; exit 5; }`,
      `echo "READY $D ${unit}"`,
      "",
    ];
    const r = this.exec(`sudo -n bash -c "$(echo ${Buffer.from(lines.join("\n")).toString("base64")} | base64 -d)"`, { timeout: 90000 }); // script as an argument: nothing on stdin for a child command to swallow
    if (r.code !== 0 || !/READY /.test(r.out)) {
      this.echo = { dir: D, unit, hostPort }; // make sure a half-started instance is removed
      try { this.stopEcho(); } catch { /* best effort */ }
      throw new Error(`could not start the throwaway echo instance: ${r.err.replace(/\s+/g, " ").slice(0, 300)}`);
    }
    this.echo = { dir: D, unit, hostPort };
    return { ...this.echo };
  }
  /** Public root + intermediate certificates of the throwaway CA (to pin them in curl / Chrome). */
  echoCerts() {
    if (!this.echo) throw new Error("no echo instance");
    const out = {};
    for (const [k, f] of [["root", "root.crt"], ["intermediate", "intermediate.crt"]]) { const r = this.exec(`sudo -n cat ${this.echo.dir}/data/pki/authorities/local/${f}`); if (r.code === 0 && r.out.includes("BEGIN CERTIFICATE")) out[k] = r.out; }
    return out;
  }
  echoStatus() {
    if (!this.echo) return null;
    const r = this.exec(`systemctl show ${this.echo.unit} -p ActiveState -p MemoryCurrent -p MainPID 2>&1; ss -ltn | grep ':${this.echo.hostPort} '; sudo -n ls -la ${this.echo.dir}/docroot 2>&1 | tail -n +2`);
    return r.out;
  }
  /** Stop the unit and remove every file; verifies nothing is left. Returns {unitGone, dirGone, portClosed}. */
  stopEcho() {
    if (!this.echo) return null;
    const { dir, unit, hostPort } = this.echo;
    const r = this.exec(`sudo -n bash -c 'systemctl stop ${unit} 2>/dev/null; systemctl reset-failed ${unit} 2>/dev/null; rm -rf -- ${dir}; sleep 0.5; echo unit=$(systemctl is-active ${unit} 2>&1 | head -1); echo dir=$( [ -e ${dir} ] && echo present || echo gone ); echo port=$(ss -ltn | grep -c ":${hostPort} ")'`);
    this.echo = null;
    return { raw: r.out.replace(/\n/g, " ").trim(), unitGone: /unit=(inactive|unknown|failed)/.test(r.out), dirGone: /dir=gone/.test(r.out), portClosed: /port=0/.test(r.out) };
  }

  /* ---------------------------------------------------------------- seed scripts (the CP repo's own idempotent bootstrap) */
  /** Copy <cpRepo>/scripts to a fresh temp dir under ~aicc (the immutable release does not ship scripts/). Returns the remote dir. */
  pushScripts(cpRepo) {
    const src = path.join(cpRepo, "scripts");
    if (!fs.existsSync(path.join(src, "bootstrap-commercial-products.php"))) throw new Error(`no bootstrap script under ${src}`);
    const dir = `/tmp/aicc-seed-${crypto.randomBytes(4).toString("hex")}`; // /tmp, not ~aicc (0750): the CP's PHP user (aicc-cp) must be able to read the scripts
    const tar = spawnSync("tar", ["-C", src, "--exclude", ".DS_Store", "--exclude", "i18n", "--exclude", "a11y", "-cf", "-", "."], { maxBuffer: 64 * 1024 * 1024 });
    if (tar.status !== 0) throw new Error("tar failed");
    const r = spawnSync(STAGE_SSH, [...this._opts(), `mkdir -p ${dir} && tar -xf - -C ${dir} && chmod -R go-w,a+rX ${dir} && ls ${dir}`], { input: tar.stdout, encoding: "utf8", timeout: 60000 });
    if (r.status !== 0) throw new Error(`push failed: ${r.stderr.slice(0, 200)}`);
    this.seedDir = dir;
    return dir;
  }
  removeScripts() { if (this.seedDir && /^\/tmp\/aicc-seed-[0-9a-f]{8}$/.test(this.seedDir)) { this.exec(`rm -rf -- ${this.seedDir}`); this.seedDir = null; } }
  /** Run a pushed script through wp-cli. aicc-wp goes through sudo (env_reset), so an environment variable cannot be handed over: putenv() inside the same PHP process does it instead. */
  evalFile(remoteFile, env = {}) {
    const put = Object.entries(env).map(([k, v]) => `putenv(${JSON.stringify(`${k}=${v}`)});`).join(" ");
    return this.exec(`aicc-wp eval ${q(`${put} require ${JSON.stringify(remoteFile)};`)}`, { timeout: 180000 });
  }
}

/* ------------------------------------------------------------------ CLI */
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);
const clean = (s) => s.split("\n").filter((l) => !/^(PHP |Deprecated:|Warning:|Notice:)/.test(l)).join("\n").trim();

async function cli() {
  const cmd = argv[0];
  const R = new StageRemote(); R.start();
  try {
    if (cmd === "seed") {
      const repo = opt("cp-repo"); if (!repo) throw new Error("--cp-repo DIR is required");
      const apply = flag("apply");
      const dir = R.pushScripts(repo);
      console.log(`scripts copied to ${dir} (immutable release untouched); mode: ${apply ? "APPLY" : "dry run"}`);
      try {
        for (const [file, envName] of [["bootstrap-commercial-products.php", "AICC_BOOTSTRAP_APPLY"], ["configure-account-required-checkout.php", "AICC_ACCOUNT_POLICY_APPLY"], ["seed-legal-documents.php", "AICC_LEGAL_SEED_APPLY"]]) {
          const r = R.evalFile(`${dir}/${file}`, apply ? { [envName]: "1" } : {});
          console.log(`\n== ${file} (exit ${r.code})\n${clean(r.out)}${r.err.trim() ? "\n[stderr] " + clean(r.err).slice(0, 400) : ""}`);
        }
      } finally { if (!flag("keep")) R.removeScripts(); }
    } else if (cmd === "gate") {
      const repo = opt("cp-repo"); if (!repo) throw new Error("--cp-repo DIR is required");
      const dir = R.pushScripts(repo);
      try {
        const r = R.evalFile(`${dir}/check-launch-blockers.php`);
        console.log(clean(r.out)); if (r.err.trim()) console.error(clean(r.err).slice(0, 600));
        console.log(`\nlaunch gate exit code: ${r.code} (AICC_PRODUCTION unset: the gate reports but does not enforce)`);
      } finally { R.removeScripts(); }
    } else if (cmd === "status") {
      const php = `global $wpdb; $p=$wpdb->prefix;
echo "users: ".count_users()['total_users']."\\n";
$t=get_users(['search'=>'*@example.test','search_columns'=>['user_email'],'fields'=>['ID','user_login']]); echo "test users (@example.test): ".count($t)."\\n";
echo "products: ".implode(', ', array_map(function($i){$pr=wc_get_product($i);return $i.':'.$pr->get_name().' $'.$pr->get_price();}, wc_get_products(['limit'=>-1,'return'=>'ids','status'=>'any'])))."\\n";
foreach (WC()->payment_gateways()->payment_gateways() as $id=>$g) { echo "gateway $id enabled=".$g->enabled."\\n"; }
foreach (['woocommerce_enable_guest_checkout','woocommerce_enable_myaccount_registration','woocommerce_enable_signup_and_login_from_checkout'] as $o) echo "$o=".get_option($o)."\\n";
echo "sessions rows: ".$wpdb->get_var("SELECT COUNT(*) FROM {$p}woocommerce_sessions")."\\n";
echo "orders (any status): ".count(wc_get_orders(['limit'=>-1,'status'=>array_keys(wc_get_order_statuses())]))."\\n";
echo "checkout-draft orders: ".count(wc_get_orders(['limit'=>-1,'status'=>['checkout-draft']]))."\\n";`;
      const r = R.evalPhp(php); console.log(clean(r.out)); if (r.code !== 0) console.error(clean(r.err).slice(0, 400));
      console.log(`mail sink files: ${R.mailDirCount()}`);
    } else if (cmd === "cleanup") {
      const ids = R.listTestUsers();
      const n = R.deleteUsers(ids);
      console.log(`deleted ${n} of ${ids.length} @example.test users; removed ${R.purgeTestMail()} test mail file(s); mail sink now holds ${R.mailDirCount()} file(s)`);
    } else if (cmd === "tunnel") {
      const port = Number(opt("local-port", "19443"));
      if (argv[1] === "open") { R.openTunnel(port); console.log(`tunnel 127.0.0.1:${port} -> host 127.0.0.1:8443 (control socket ${R.tunnels.get(port)})`); R.mux = false; /* leave the tunnel running: exit without closing it */ return; }
      if (argv[1] === "close") { R.tunnels.set(port, opt("ctl", "")); R.closeTunnel(port); console.log("tunnel closed"); }
    } else { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 18).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); }
  } finally { if (!(cmd === "tunnel" && argv[1] === "open")) R.closeAll(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
