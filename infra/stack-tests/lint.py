#!/usr/bin/env python3
"""infra:lint -- static checks for the stack provisioning files (stdlib only, Python 3.9+).

Checks (each failure is printed with the file):
  syntax      `bash -n` on every shell script; `php -l` on the wp-config template's rendered form is covered by test_provision.sh
  hygiene     every executable script has `set -euo pipefail` (sourced libraries and the three test runners are exempt, with the reason printed)
  root        scripts that change the host refuse to run as non-root (an `id -u` check)
  dry-run     scripts that change state have a --dry-run option
  denylist    scripts that take a target host contain the production-address deny list (139.59.157.231) and the production-key refusal
  secrets     no private keys, tokens, passwords or long hex strings in the files (pins/known checksums whitelisted); no public IPv4 literals other than the deny list
  units       a systemd unit linter (NOT `systemd-analyze verify`, which does not exist on macOS and was NOT run): sections, known keys, required keys,
              ExecStart paths that map to files in this repo or to known system binaries, OnFailure/Unit/Wants/After targets, users that the installer creates,
              ReadWritePaths directories that the installer creates, timers pointing at services, memory budget arithmetic
  budget      the 2 GiB memory budget: pool + MySQL + Caddy ceilings against the unit limits
ShellCheck is run by lint.sh when it is installed (it is on the authoring Mac: 0.11.0); it is never installed by these scripts.
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INFRA = os.environ.get("AICC_LINT_INFRA") or os.path.join(ROOT, "infra")      # tests point this at a mutated copy
if os.environ.get("AICC_LINT_INFRA"):
    ROOT = os.path.dirname(INFRA)
MINE = ["provision", "systemd", "backup", "release", "php", "mysql", "fail2ban", "logrotate", "stack-tests"]
fails = []
checks = 0


def fail(f, msg):
    fails.append("%s: %s" % (os.path.relpath(f, ROOT) if f.startswith(ROOT) else f, msg))


def ok():
    global checks
    checks += 1


def files(exts=None):
    out = []
    for d in MINE:
        for dp, dns, fns in os.walk(os.path.join(INFRA, d)):
            dns[:] = [x for x in dns if x not in ("node_modules", "__pycache__")]
            for n in fns:
                if exts is None or n.endswith(exts):
                    out.append(os.path.join(dp, n))
    return sorted(out)


def read(p):
    return open(p, encoding="utf-8", errors="replace").read()


# ---------------------------------------------------------------------------------------------------------------------------------------------------
SH = [p for p in files(".sh")]
# files that are sourced libraries or test runners (tests deliberately continue after a failing command, so they use `set -uo pipefail`)
EXEMPT_SET_E = {
    "lib/common.sh": "sourced library", "lib/ip-guard.sh": "sourced library", "lib/ssh-session.sh": "sourced library", "lib/release-common.sh": "sourced library", "lib/backup-common.sh": "sourced library", "lib/t.sh": "sourced test harness",
    "test_provision.sh": "test runner (must continue after a failing assertion)", "test_promote.sh": "test runner (must continue after a failing assertion)", "test_plugin_publish.sh": "test runner (must continue after a failing assertion)", "test_release.sh": "test runner (must continue after a failing assertion)",
    "test_backup.sh": "test runner (must continue after a failing assertion)", "test_lint.sh": "test runner (must continue after a failing assertion)", "run-all.sh": "runs every suite even when one fails", "test_ubuntu.sh": "test runner (cleans up through a trap, must report every failure)", "ubuntu-inner.sh": "test runner inside the container (must continue after a failing assertion)",
    "verify-droplet.sh": "pre-existing stage-1 script (read-only verifier that reports every failure), not changed here",
    "aicc-security-updates.sh": "records the exit code of each step (list refresh, upgrade) and ALWAYS writes the status file for AICC Ops, then fails the unit itself; -e would skip the status write",
    "render-cloud-init.sh": "pre-existing",
}
print("== syntax ==")
for p in SH:
    r = subprocess.run(["bash", "-n", p], capture_output=True, text=True)
    if r.returncode != 0:
        fail(p, "bash -n: " + r.stderr.strip()[:200])
    else:
        ok()
for p in files(".py"):
    r = subprocess.run([sys.executable, "-c", "import ast,sys; ast.parse(open(sys.argv[1]).read())", p], capture_output=True, text=True)
    if r.returncode != 0:
        fail(p, "python syntax: " + r.stderr.strip()[-200:])
    else:
        ok()

print("== hygiene: set -euo pipefail ==")
for p in SH:
    rel = os.path.relpath(p, INFRA)
    key = next((k for k in EXEMPT_SET_E if rel.endswith(k)), None)
    if key:
        continue
    if not re.search(r"(?m)^set -euo pipefail\s*$", read(p)):
        fail(p, "missing `set -euo pipefail`")
    else:
        ok()
exempt_report = sorted(set(EXEMPT_SET_E))

print("== root requirement ==")
NEEDS_ROOT = ["provision/install-stack.sh", "provision/harden-stage2.sh", "provision/harden-stage3.sh", "provision/stage2-verify-second-session.sh", "provision/create-staging-db.sh", "provision/render-wp-config.sh",
              "backup/aicc-backup.sh", "backup/aicc-restore-test.sh", "release/activate-release.sh", "release/rollback-release.sh"]
for rel in NEEDS_ROOT:
    p = os.path.join(INFRA, rel); s = read(p)
    if not re.search(r"id -u", s) or not re.search(r"(?i)must run as root|run with sudo|require_root", s):
        fail(p, "no non-root refusal (`id -u` check with a clear message)")
    else:
        ok()
# every script that touches the target host from the Mac must NOT be root-only but must refuse the production target
print("== dry-run ==")
NEEDS_DRY = NEEDS_ROOT + ["release/deploy-release.sh", "release/build-cp-release.sh", "release/build-site-release.sh", "backup/pull-offhost.sh", "provision/operator-tunnel.sh", "provision/push-bundle.sh"]
for rel in NEEDS_DRY:
    p = os.path.join(INFRA, rel)
    if "--dry-run" not in read(p):
        fail(p, "no --dry-run option")
    else:
        ok()
print("== production deny list ==")
NEEDS_DENY = ["release/deploy-release.sh", "backup/pull-offhost.sh", "provision/operator-tunnel.sh", "provision/push-bundle.sh", "provision/lib/common.sh"]
for rel in NEEDS_DENY:
    p = os.path.join(INFRA, rel); s = read(p)
    if "139.59.157.231" not in s:
        fail(p, "production API IP 139.59.157.231 not in the deny list")
    elif rel != "provision/lib/common.sh" and "aicc_digitalocean_prod" not in s:
        fail(p, "no refusal of the production key")
    else:
        ok()
for rel in ["release/deploy-release.sh", "backup/pull-offhost.sh", "provision/operator-tunnel.sh", "provision/push-bundle.sh"]:
    p = os.path.join(INFRA, rel); s = read(p)
    for name in ("www.copilt.org", "api.copilt.org"):
        if name not in s:
            fail(p, "production hostname %s not refused" % name)
        else:
            ok()
for p in SH:
    for i, line in enumerate(read(p).splitlines(), 1):
        if "aicc_digitalocean_prod" in line and not re.search(r"(?i)refus|deny|never|case|production|PRODKEY|prod key|echo|#", line):
            fail(p, "line %d mentions the production key outside a refusal: %s" % (i, line.strip()[:100]))

print("== production wp-config template: usable ONLY through the gated renderer (architecture review B-3, Phase 2B) ==")
prod_tpl = os.path.join(INFRA, "provision/wp-config.production.template.php")
if not os.path.exists(prod_tpl):
    fail(prod_tpl, "missing: the production configuration path must stay recorded and tested")
else:
    t = read(prod_tpl)
    code = re.sub(r"(?m)^\s*//.*$", "", re.sub(r"(?s)/\*.*?\*/", "", t))
    for needle, why in (("AICC_TEMPLATE: production", "the production marker the renderer requires"),
                        ("define( 'WP_ENVIRONMENT_TYPE', 'production' )", "production environment type"),
                        ("define( 'WP_HOME', 'https://www.copilt.org' )", "the production home URL"), ("define( 'WP_SITEURL', 'https://www.copilt.org' )", "the production site URL"),
                        ("define( 'AICC_ENTITLEMENT_WEBHOOK_URL', 'https://api.copilt.org/", "the https webhook URL on the API host"),
                        ("define( 'WP_ACCESSIBLE_HOSTS', 'api.copilt.org' )", "WP_ACCESSIBLE_HOSTS exactly the API host"), ("define( 'WP_HTTP_BLOCK_EXTERNAL', true )", "external requests blocked"),
                        ("define( 'DISALLOW_FILE_MODS', true )", "immutable code"), ("define( 'DISABLE_WP_CRON', true )", "system cron only"), ("define( 'WP_DEBUG', false )", "debug off"),
                        ("define( 'FORCE_SSL_ADMIN', true )", "admin over TLS"), ("localhost:/run/mysqld/mysqld.sock", "database over the unix socket"),
                        ("'@@AICC_ENTITLEMENT_WEBHOOK_SECRET@@'", "webhook secret comes from the renderer"), ("'@@AICC_ACTIVATION_PROOF_SECRET@@'", "activation proof secret comes from the renderer")):
        if needle not in t:
            fail(prod_tpl, "lost %s (%s)" % (needle, why))
        else:
            ok()
    if re.search(r"(?i)stage\.copilt|staging|stage_", code):
        fail(prod_tpl, "a staging value appears in the production template's code")
    else:
        ok()
    if re.search(r"AICC_LM_ALLOW_DEV_SECRET_BOOTSTRAP|AICC_LM_TEST_FIXTURE", code):
        fail(prod_tpl, "the dev secret bootstrap / test fixture constants must never be defined")
    if re.search(r"define\( '(AUTH|SECURE_AUTH|LOGGED_IN|NONCE)_(KEY|SALT)', '[A-Za-z0-9]{16,}'", t) or re.search(r"define\( '(DB_PASSWORD|AICC_[A-Z_]*SECRET)', '(?!@@)[^']{8,}'", t):
        fail(prod_tpl, "a secret-looking value is committed in the production template")
    if os.access(prod_tpl, os.X_OK):
        fail(prod_tpl, "the template must not be executable")
    # nothing may use it except the renderer: scripts, units, installers never reference it (docs and tests may)
    for q in files():
        rel = os.path.relpath(q, INFRA)
        if q == prod_tpl or rel.startswith("stack-tests/") or q.endswith((".md",)):
            continue
        if "wp-config.production" in read(q) and rel not in ("provision/render-wp-config.sh", "provision/wp-config.stage.template.php", "release/deploy-release.sh"):
            fail(q, "references the production wp-config template: only provision/render-wp-config.sh may")
    rw = read(os.path.join(INFRA, "provision/render-wp-config.sh"))
    for needle, why in (("--confirm-production", "an explicit confirmation flag"), ("AICC_ENV=production", "the host-identity gate"), ("never generated", "owner-provided shared secrets"),
                        ("AICC_TEMPLATE: production", "the template marker check"), ("a staging host can never receive", "the staging-host refusal")):
        if needle not in rw:
            fail(os.path.join(INFRA, "provision/render-wp-config.sh"), "production gate lost: %s (%s)" % (needle, why))
        else:
            ok()
    dr = read(os.path.join(INFRA, "release/deploy-release.sh"))
    if "wp-config.production" not in dr or "never shipped in a release" not in dr:
        fail(os.path.join(INFRA, "release/deploy-release.sh"), "must refuse an artifact that carries a wp-config template")
    else:
        ok()
print("== secrets and addresses ==")
SECRET_RES = [
    ("private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")), ("AWS key", re.compile(r"AKIA[0-9A-Z]{16}")), ("token", re.compile(r"(gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[0-9A-Za-z-]{10,}|sk_live_[0-9A-Za-z]{16,})")),
    ("DigitalOcean token", re.compile(r"dop_v1_[0-9a-f]{20,}")), ("password with a value", re.compile(r"(?i)\b(?:password|passwd|secret)\s*[:=]\s*['\"][^'\"$@%<{ ]{6,}['\"]")),
    ("Authorization header value", re.compile(r"(?i)bearer\s+[A-Za-z0-9._-]{20,}")),
]
HEX_RE = re.compile(r"\b[0-9a-f]{40,}\b")
# checksums that are meant to be in the repo: pins and the tests that assert them (WordPress, WooCommerce, WP-CLI, Caddy, the stage-id used by tests)
ALLOWED_HEX = {
    "163b5bf217dad76a823432d8c01598ab3dc3f15cbdd69067b98f5a6ddf05c1c4",
    "d2a09acb6a15e3b9c471d72557753c266d6f41a79ed19bfe04cbfe49e283b2a5", "491a78c7676b15dffcc69130c6054b8f49228a91", "6e58fc3ba9b18d1c9aee6b0227d3c3c09e4fe2c1332823bd2e0ac54ffcff64a9",
    "ce34ddd838f7351d6759068d09793f26755463b4a4610a5a5c0a97b68220d85c",
    "be928f6b8ca1e8dfb9d2f4b75a13aa4aee0896f8a9a0a1c45cd5d2c98605e6172e6d014dda2e27f88c98befc16c040cbb2bd1bfa121510ea5cdf5f6a30fe8832",
    "a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7",
}
IP_RE = re.compile(r"\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b")
OK_IP_PREFIX = ("127.", "169.254.", "139.073.", "0.0.0.0", "10.", "192.168.", "203.0.113.", "198.51.100.", "192.0.2.", "139.59.157.231", "157.230.110.211", "206.189.248.204", "185.199.10", "185.199.11", "255.", "1.2.3.4", "1.1.1.1")
for p in files():
    if p.endswith(("lint.py", "test_lint.sh")):      # these two contain the strings they are testing for (planted secrets, addresses)
        continue
    s = read(p)
    for label, rx in SECRET_RES:
        m = rx.search(s)
        if m:
            fail(p, "%s: %s" % (label, m.group(0)[:40]))
    for m in HEX_RE.finditer(s):
        if m.group(0) not in ALLOWED_HEX:
            fail(p, "unexpected long hex string (secret?): %s..." % m.group(0)[:16])
    for m in IP_RE.finditer(s):
        a = m.group(0)
        if not a.startswith(OK_IP_PREFIX) and all(int(x) <= 255 for x in m.groups()) and not re.match(r"^\d+\.\d+\.\d+\.0$", a):
            # version strings like 2.11.7.0 or "8.0.4.1" are not addresses; accept only 4-part numbers preceded by a non-version context
            ctx = s[max(0, m.start() - 12):m.start()]
            if not re.search(r"(?i)(version|v|php|mysql|caddy|wp-cli|ubuntu|[0-9]\.)\s*$", ctx):
                fail(p, "public-looking IPv4 literal: " + a)
ok()

# ---------------------------------------------------------------------------------------------------------------------------------------------------
print("== systemd units (custom linter; `systemd-analyze verify` was NOT run) ==")
SYS = os.path.join(INFRA, "systemd")
installer = read(os.path.join(INFRA, "provision/install-stack.sh"))
# host path -> repo file, derived from the installer so the two cannot drift
host_paths = {}
for m in re.finditer(r'install_file\s+"\$\{?(INFRA|ops)\}?/([^"]+)"\s+"\$\{?(SBIN|LIB_DIR)\}?/([^"]+)"', installer):
    src = m.group(2) if m.group(1) == "INFRA" else "../scripts/ops/" + m.group(2)
    host_paths[("/usr/local/sbin" if m.group(3) == "SBIN" else "/usr/local/lib/aicc") + "/" + m.group(4)] = src
for m in re.finditer(r'ensure_symlink\s+"\$LIB_DIR/([^"]+)"\s+"\$SBIN/([^"]+)"', installer):
    host_paths["/usr/local/sbin/" + m.group(2)] = "lib/" + m.group(1)
host_paths["/usr/local/sbin/aicc-wp"] = "(generated by install-stack.sh step wpcli)"
SYSTEM_BIN = {"/usr/bin/php", "/usr/local/bin/wp", "/usr/local/bin/caddy", "/usr/sbin/php-fpm8.3", "/usr/bin/systemctl", "/bin/true"}
created_users = set(re.findall(r"ensure_system_user\s+(\S+)", installer))
created_dirs = set(re.findall(r'ensure_dir\s+\S+\s+\S+\s+"?([^\s"]+)"?', installer))
created_dirs |= {"/var/lib/aicc-cp/" + d for d in ("tmp", "sessions", "mail", "wp-cli")} | {"/srv/aicc/site", "/srv/aicc/cp"}
VALID_KEYS = {
    "Unit": {"Description", "Documentation", "After", "Before", "Wants", "Requires", "Conflicts", "OnFailure", "ConditionPathExists", "StartLimitIntervalSec", "StartLimitBurst"},
    "Service": {"Type", "User", "Group", "DynamicUser", "EnvironmentFile", "Environment", "WorkingDirectory", "ExecStartPre", "ExecStart", "ExecStartPost", "ExecReload", "ExecStop",
                "TimeoutStartSec", "TimeoutStopSec", "Restart", "RestartSec", "LimitNOFILE", "TasksMax", "MemoryHigh", "MemoryMax", "IPAddressDeny", "IPAddressAllow", "AmbientCapabilities", "CapabilityBoundingSet",
                "NoNewPrivileges", "UMask", "StateDirectory", "StateDirectoryMode", "LogsDirectory", "LogsDirectoryMode", "ProtectSystem", "ProtectHome", "PrivateTmp", "PrivateDevices",
                "ProtectKernelTunables", "ProtectKernelModules", "ProtectKernelLogs", "ProtectControlGroups", "ProtectClock", "ProtectHostname", "ProtectProc", "RestrictAddressFamilies",
                "RestrictNamespaces", "RestrictRealtime", "RestrictSUIDSGID", "LockPersonality", "SystemCallArchitectures", "SystemCallFilter", "ReadOnlyPaths", "ReadWritePaths",
                "Nice", "IOSchedulingClass", "IOSchedulingPriority", "CPUSchedulingPolicy", "OOMScoreAdjust", "RuntimeDirectory", "RuntimeDirectoryMode", "RuntimeDirectoryPreserve"},
    "Timer": {"OnCalendar", "OnBootSec", "OnUnitActiveSec", "OnUnitInactiveSec", "AccuracySec", "RandomizedDelaySec", "Persistent", "Unit"},
    "Install": {"WantedBy", "RequiredBy", "Alias", "Also"},
}


def parse_unit(path):
    sec = None; data = {}
    for n, raw in enumerate(read(path).splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith(("#", ";")):
            continue
        m = re.match(r"^\[(\w+)\]$", line)
        if m:
            sec = m.group(1); data.setdefault(sec, []); continue
        if sec is None:
            fail(path, "line %d outside any section" % n); continue
        if "=" not in line:
            fail(path, "line %d is not Key=Value: %s" % (n, line[:60])); continue
        k, v = line.split("=", 1)
        data[sec].append((k.strip(), v.strip(), n))
    return data


def vals(d, sec, key):
    return [v for (k, v, _) in d.get(sec, []) if k == key]


units = {}
for n in sorted(os.listdir(SYS)):
    if n.endswith((".service", ".timer")):
        units[n] = parse_unit(os.path.join(SYS, n))
dropins = {}
for dp, dns, fns in os.walk(os.path.join(SYS, "overrides")):
    for n in fns:
        dropins[os.path.relpath(os.path.join(dp, n), os.path.join(SYS, "overrides"))] = parse_unit(os.path.join(dp, n))

def mem(v):
    m = re.fullmatch(r"(\d+)([MG])", v)
    return int(m.group(1)) * (1024 if m.group(2) == "G" else 1) if m else None

for name, d in list(units.items()) + [("dropin:" + k, v) for k, v in dropins.items()]:
    path = os.path.join(SYS, name) if not name.startswith("dropin:") else os.path.join(SYS, "overrides", name[7:])
    for sec, items in d.items():
        if sec not in VALID_KEYS:
            fail(path, "unknown section [%s]" % sec); continue
        for (k, v, ln) in items:
            if k not in VALID_KEYS[sec]:
                fail(path, "line %d: unknown/misplaced key %s= in [%s]" % (ln, k, sec))
    ok()
    if name.endswith(".service") and not name.startswith("dropin:"):
        if "Service" not in d or not vals(d, "Service", "ExecStart"):
            fail(path, "no [Service] ExecStart=")
        typ = (vals(d, "Service", "Type") or ["simple"])[0]
        if typ not in ("oneshot", "notify", "simple", "forking"):
            fail(path, "unexpected Type=" + typ)
        if "@" not in name and "Install" not in d and typ != "oneshot":
            fail(path, "long-running service without [Install]")
        for key in ("ExecStart", "ExecStartPre", "ExecStartPost", "ExecReload"):
            for v in vals(d, "Service", key):
                exe = re.sub(r"^[-+!@:]+", "", v).split()[0]
                if exe in SYSTEM_BIN:
                    continue
                if exe in host_paths:
                    repo = host_paths[exe]
                    target = os.path.join(INFRA, repo) if not repo.startswith(("lib/", "(")) else None
                    if repo.startswith("lib/"):
                        target = os.path.join(INFRA, "backup" if "backup" in repo else "release", repo[4:].split("/", 1)[1] if "/" in repo[4:] else repo[4:])
                    if target and not os.path.exists(target) and not os.path.exists(os.path.join(ROOT, repo)):
                        fail(path, "%s maps to %s which does not exist" % (exe, repo))
                else:
                    fail(path, "%s= executable %s is neither installed by install-stack.sh nor a known system binary" % (key, exe))
        for v in vals(d, "Unit", "OnFailure"):
            tpl = re.sub(r"@.*\.service$", "@.service", v)
            if tpl not in units:
                fail(path, "OnFailure=%s: template unit %s not found" % (v, tpl))
        for u in vals(d, "Service", "User") + vals(d, "Service", "Group"):
            if u not in created_users and u not in ("root", "adm"):
                fail(path, "User/Group %s is not created by install-stack.sh" % u)
        for key in ("ReadWritePaths", "ReadOnlyPaths"):
            for v in vals(d, "Service", key):
                for pth in v.split():
                    opt = pth.startswith("-"); pth = pth.lstrip("-")
                    if not opt and pth not in created_dirs and not pth.startswith(("/var/lib/aicc-edge", "/var/log/aicc-edge")):
                        fail(path, "%s=%s: the installer does not create this directory (the unit would fail to start with a namespace error)" % (key, pth))
        for v in vals(d, "Service", "EnvironmentFile"):
            if v.lstrip("-") != "/etc/aicc-edge/edge.env":
                fail(path, "EnvironmentFile %s is not the file edge-env installs" % v)
        for key in ("MemoryHigh", "MemoryMax"):
            for v in vals(d, "Service", key):
                if mem(v) is None:
                    fail(path, "%s=%s is not NNNM/NNNG" % (key, v))
    if name.endswith(".timer"):
        if not any(vals(d, "Timer", k) for k in ("OnCalendar", "OnBootSec", "OnUnitActiveSec")):
            fail(path, "timer without a trigger")
        for u in vals(d, "Timer", "Unit"):
            if u not in units:
                fail(path, "Unit=%s does not exist" % u)
        if "Install" not in d or "timers.target" not in vals(d, "Install", "WantedBy"):
            fail(path, "timer must be WantedBy=timers.target")
        for cal in vals(d, "Timer", "OnCalendar"):
            if not re.fullmatch(r"(?:\*-\*-\* )?(?:\*|\d{2}):(?:\*|\d{2}):\d{2}(?: UTC)?|\*:0/\d{1,2}|hourly|daily|minutely", cal):
                fail(path, "OnCalendar=%s: unexpected form" % cal)
# explicit expectations from the brief
def expect(cond, f, msg):
    if cond: ok()
    else: fail(f, msg)
sv = units.get("aicc-edge.service", {})
expect("php8.3-fpm.service" in " ".join(vals(sv, "Unit", "After")), "aicc-edge.service", "must be After=php8.3-fpm.service (boot order mysql -> php-fpm -> caddy)")
expect("Restart=on-failure" in ["Restart=" + v for v in vals(sv, "Service", "Restart")], "aicc-edge.service", "Restart=on-failure missing")
expect(bool(vals(sv, "Service", "LimitNOFILE")) and bool(vals(sv, "Service", "MemoryMax")) and bool(vals(sv, "Service", "MemoryHigh")), "aicc-edge.service", "LimitNOFILE/MemoryMax/MemoryHigh required")
expect(any("preflight" in v for v in vals(sv, "Service", "ExecStartPre")), "aicc-edge.service", "ExecStartPre must run the edge preflight")
expect(any("/etc/aicc-edge/Caddyfile" in v for v in vals(sv, "Service", "ExecStart")), "aicc-edge.service", "must use /etc/aicc-edge/Caddyfile")
expect("mysql.service" in " ".join(vals(dropins.get("php8.3-fpm.service.d/aicc.conf", {}), "Unit", "After")), "overrides/php8.3-fpm.service.d/aicc.conf", "php-fpm must be After=mysql.service")
cron = units.get("aicc-wp-cron.service", {})
expect(vals(cron, "Service", "Nice") == ["10"] and vals(cron, "Service", "MemoryMax") == ["256M"] and vals(cron, "Service", "User") == ["aicc-cp"], "aicc-wp-cron.service", "Nice=10, MemoryMax=256M, User=aicc-cp required")
expect(any("cron event run --due-now" in v for v in vals(cron, "Service", "ExecStart")), "aicc-wp-cron.service", "must run `wp cron event run --due-now`")
bk = units.get("aicc-backup.service", {})
expect(vals(bk, "Service", "Nice") == ["19"] and vals(bk, "Service", "IOSchedulingClass") == ["idle"] and vals(bk, "Service", "MemoryMax") == ["256M"], "aicc-backup.service", "Nice=19, IOSchedulingClass=idle, MemoryMax=256M required")
expect(any(":17:00 UTC" in v for v in vals(units.get("aicc-backup.timer", {}), "Timer", "OnCalendar")), "aicc-backup.timer", "hourly (minute 17 UTC) required: the on-host RPO is about one hour")
# architecture review H-2/H-4: every 2 minutes (2.3 CPU-s per run on the single vCPU); AICC Ops wc_cron_stale (1 h) and the docs assume that cadence
expect(vals(units.get("aicc-wp-cron.timer", {}), "Timer", "OnCalendar") == ["*:0/2"], "aicc-wp-cron.timer", "OnCalendar=*:0/2 (every 2 minutes) required")
expect(vals(units.get("aicc-wp-cron.timer", {}), "Timer", "Persistent") == ["false"], "aicc-wp-cron.timer", "Persistent=false required (missed minutes are not replayed)")
expect("aicc-notify-failure@.service" in units, "aicc-notify-failure@.service", "template missing")
ok()

print("== local trust boundary of the PHP user (security review M1) ==")
fpm_main = dropins.get("php8.3-fpm.service.d/aicc.conf", {})
fpm_sb = dropins.get("php8.3-fpm.service.d/20-aicc-sandbox.conf", {})
for label, d in (("php8.3-fpm drop-in aicc.conf", fpm_main), ("aicc-wp-cron.service", units.get("aicc-wp-cron.service", {}))):
    deny = " ".join(vals(d, "Service", "IPAddressDeny")); allow = " ".join(vals(d, "Service", "IPAddressAllow"))
    expect(all(x in deny for x in ("127.0.0.0/8", "::1/128", "169.254.0.0/16")), label, "IPAddressDeny must cover 127.0.0.0/8, ::1/128 and 169.254.0.0/16 (Caddy admin API, operator listener, AICC Ops, cloud metadata)")
    expect(allow.split() == ["127.0.0.53/32"], label, "IPAddressAllow must be exactly the resolver stub 127.0.0.53/32 (never 127.0.0.1 or the metadata address)")
sb = {k for items in fpm_sb.values() for (k, _v, _l) in items}
for key in ("NoNewPrivileges", "ProtectSystem", "ReadWritePaths", "PrivateTmp", "ProtectHome", "CapabilityBoundingSet", "RestrictSUIDSGID", "LockPersonality", "ProtectKernelTunables"):
    expect(key in sb, "php8.3-fpm.service.d/20-aicc-sandbox.conf", "%s is required" % key)
expect(vals(fpm_sb, "Service", "ProtectSystem") == ["strict"] and vals(fpm_sb, "Service", "NoNewPrivileges") == ["yes"], "php8.3-fpm.service.d/20-aicc-sandbox.conf", "ProtectSystem=strict and NoNewPrivileges=yes required")
expect(not ({"MemoryDenyWriteExecute", "SystemCallFilter"} & sb), "php8.3-fpm.service.d/20-aicc-sandbox.conf", "MemoryDenyWriteExecute / SystemCallFilter are deliberately absent (PCRE JIT, untested filters)")
caps = " ".join(vals(fpm_sb, "Service", "CapabilityBoundingSet"))
expect(set(caps.split()) <= {"CAP_SETUID", "CAP_SETGID", "CAP_CHOWN", "CAP_FOWNER", "CAP_DAC_OVERRIDE", "CAP_KILL"} and "CAP_SETUID" in caps and "CAP_SETGID" in caps, "php8.3-fpm.service.d/20-aicc-sandbox.conf", "CapabilityBoundingSet must be the minimal master set (SETUID SETGID CHOWN FOWNER DAC_OVERRIDE KILL)")
wpcfg = read(os.path.join(INFRA, "provision/wp-config.stage.template.php"))
m_ = re.search(r"define\( 'WP_ACCESSIBLE_HOSTS', '([^']*)' \)", wpcfg)
expect(bool(m_) and not re.search(r"localhost|127\.0\.0\.1|::1", m_.group(1)), "provision/wp-config.stage.template.php", "WP_ACCESSIBLE_HOSTS must not contain localhost / 127.0.0.1 (SSRF to Caddy's admin API)")

print("== memory budget (2 GiB host) ==")
pool = read(os.path.join(INFRA, "php/aicc-pool.conf"))
maxch = int(re.search(r"(?m)^pm\.max_children\s*=\s*(\d+)", pool).group(1))
memlim = int(re.search(r"memory_limit\]\s*=\s*(\d+)M", pool).group(1))
opc = int(re.search(r"opcache\.memory_consumption\s*=\s*(\d+)", read(os.path.join(INFRA, "php/90-aicc-fpm.ini"))).group(1))
bp = int(re.search(r"(?m)^innodb_buffer_pool_size\s*=\s*(\d+)M", read(os.path.join(INFRA, "mysql/99-aicc.cnf"))).group(1))
maxconn = int(re.search(r"(?m)^max_connections\s*=\s*(\d+)", read(os.path.join(INFRA, "mysql/99-aicc.cnf"))).group(1))
php_worst = maxch * memlim + opc + 30
def memval(d, key):
    v = vals(d, "Service", key)
    r = mem(v[0]) if v else None
    if r is None:
        fail("budget", "%s missing or malformed in a unit" % key)
        return 10 ** 6
    return r
php_unit = memval(dropins["php8.3-fpm.service.d/aicc.conf"], "MemoryMax")
my_unit = memval(dropins["mysql.service.d/aicc.conf"], "MemoryMax")
caddy_unit = memval(sv, "MemoryMax")
php_high = memval(dropins["php8.3-fpm.service.d/aicc.conf"], "MemoryHigh")
my_high = memval(dropins["mysql.service.d/aicc.conf"], "MemoryHigh")
caddy_high = memval(sv, "MemoryHigh")
gm = re.search(r"GOMEMLIMIT=(\d+)MiB", " ".join(vals(sv, "Service", "Environment")))
gomem = int(gm.group(1)) if gm else None
my_est = bp + maxconn * 3 + 150   # pool + worst-case per-connection buffers (~3 MiB) + InnoDB/dictionary/log buffers and server overhead
print("   PHP-FPM worst case %d MiB (%d x %dM + %dM OPcache + 30M master) vs unit MemoryMax %d MiB" % (php_worst, maxch, memlim, opc, php_unit))
print("   MySQL estimated peak %d MiB (pool %d + %d conn x 3 + 150) vs unit MemoryMax %d MiB" % (my_est, bp, maxconn, my_unit))
print("   MemoryHigh sum %d MiB + ~300 MiB OS/cache floor = %d MiB of 2048 (AICC Ops MemoryHigh 48M and the transient wp-cron/backup runs come on top of that; see infra/README.md)" % (php_high + my_high + caddy_high, php_high + my_high + caddy_high + 300))
for cond, msg in ((php_worst <= php_unit, "PHP-FPM worst case exceeds its own MemoryMax"), (my_est <= my_unit, "MySQL estimate exceeds its MemoryMax"),
                  (php_high + my_high + caddy_high + 300 <= 2048, "sum of MemoryHigh + OS floor exceeds 2 GiB"), (bp == 192 and maxconn == 30, "MySQL numbers differ from the brief (192M / 30)"),
                  (maxch == 3 and memlim == 192, "pool numbers differ from the brief (3 children / 192M)"),
                  # architecture review M-1: Caddy was MEASURED at PSS 247 MB / RSS 258 MB under load; a MemoryHigh below that makes the kernel reclaim the unit's memory all the time
                  (caddy_high >= 320, "aicc-edge MemoryHigh is below Caddy's measured footprint (PSS up to 247 MB, RSS 258 MB): must be >= 320M"),
                  (caddy_unit >= 450 and caddy_unit > caddy_high, "aicc-edge MemoryMax must be >= 450M and above MemoryHigh"),
                  (gomem is not None and gomem < caddy_high, "aicc-edge GOMEMLIMIT must stay below MemoryHigh (the Go heap target; the runtime has non-heap memory too)")):
    expect(cond, "budget", msg)

print()
print("exempt from `set -euo pipefail` (reason): " + "; ".join("%s (%s)" % (k, EXEMPT_SET_E[k]) for k in exempt_report))
print("lint: %d checks passed, %d problem(s)" % (checks, len(fails)))
for f in fails:
    print("LINT FAIL " + f)
sys.exit(1 if fails else 0)
