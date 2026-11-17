#!/usr/bin/env bash
# Tests of the AICC_ENTITLEMENT_WEBHOOK_SECRET ROTATION TOOL: the Mac orchestrator infra/provision/rotate-webhook-secret.sh, the Control Plane host tool infra/provision/host/aicc-rotate-webhook-secret (+ webhook-probe.php)
# and the API host tool infra/provision/host/aicc-rotate-webhook-secret-api, against a LOCAL SIMULATION of BOTH hosts. No network, no real host, no real secret: the two "secrets" are recognisable canaries.
# The simulation lives in a temp directory: two root prefixes (the CP host and the API host), a fake `ssh` that dispatches to the right prefix, fake sudo / systemctl / docker / logger / aicc-wp / hostname, the REAL wp-config
# renderer (render-wp-config.sh) on the CP side, php for the probe script, and a fake BACKEND (a small python HTTP server) that re-reads the env file at its simulated restart and verifies the HMAC exactly like
# app/routers/entitlement_webhook.py (same domain tag, same check order, same error codes). A fake OUTBOX delivers events with the CP's rendered secret, so "no event is lost" is checked, not claimed.
#   A  plan changes NOTHING (every file of both hosts hashed before and after) and prints the steps
#   B  the successful rotation: probes, fingerprints, journals, modes, other env lines byte-identical, drain, bystander; idempotent re-run; finalize; registry; verify; rollback boundary
#   C  every partial failure (kill -9 at every stage of every host mutation, a failing restart / health / render / reload / probe / drain) followed by resume or rollback, with the invariants
#   D  gates: host identity, deploy window, flock, bystander, env-file shape, API tool install (sha256), seams, harness-only flags
#   E  secret hygiene: canary scans of every output, log, journal, temp tree and the process list (pseudo terminal poller), static rules on the three scripts
# Run: bash infra/stack-tests/test_p38_rotation.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; INFRA="$REPO/infra"; PROV="$INFRA/provision"
T_SUITE="p38-rotation"; . "$HERE/lib/t.sh"
ROT="$PROV/rotate-webhook-secret.sh"; CPTOOL="$PROV/host/aicc-rotate-webhook-secret"; APITOOL="$PROV/host/aicc-rotate-webhook-secret-api"; PROBEPHP="$PROV/host/webhook-probe.php"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ap38r.XXXX")"; TMP="$(cd "$TMP" && pwd -P)"; trap 'kill "${SRVPID:-0}" 2>/dev/null; wait "${SRVPID:-0}" 2>/dev/null; rm -rf "$TMP"' EXIT
for tool in php python3 jq ssh-keygen shasum curl; do command -v "$tool" >/dev/null 2>&1 || { echo "need $tool"; exit 2; }; done
mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }
OLD="$(printf '0123456789abcdef%.0s' 1 2 3 4)"      # canary: the EXPOSED secret (64 hex; built from pieces so that no 64-hex literal sits in the repo)
NEW="$(printf 'fedcba9876543210%.0s' 1 2 3 4)"      # canary: the generated one (the seam makes `prepare` use it so it can be hunted)
STAGEID="3e897286ce82e55f4d866acf0d526a5f"; APIHOST="api.copilt.org"; OFU="$(id -un):$(id -gn)"
# a direct python3 first in PATH: a version-manager shim (pyenv) costs ~0.3 s per start and the rotation starts python hundreds of times
REALPY="$(python3 -c 'import sys; print(sys.executable)')"; mkdir -p "$TMP/pybin"; ln -s "$REALPY" "$TMP/pybin/python3"; BASEPATH="$TMP/pybin:$PATH"
CP="$TMP/cp"; API="$TMP/api"; FAKE="$TMP/fake"; FLAGS="$TMP/flags"; LOGS="$TMP/logs"; DRV="$TMP/drv"; HOMED="$TMP/home"; ROTSTATE="$TMP/rotstate"; REC="$LOGS/records.log"
mkdir -p "$FAKE" "$LOGS" "$DRV" "$HOMED/.ssh"
printf '%s' "$NEW" > "$TMP/new-secret.file"; chmod 600 "$TMP/new-secret.file"

# ---- the helpers used by the tests ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
cat > "$FAKE/h.py" <<'PY'
import fcntl, hashlib, os, re, stat, sys, time
FPT = b"aicc-webhook-secret-fingerprint-v1\n"
cmd = sys.argv[1]
if cmd == "fp":
    print(hashlib.sha256(FPT + sys.argv[2].encode()).hexdigest()[:16])
elif cmd == "snap":      # every file and directory under the given roots: relative path, type, mode, content hash
    for root in sys.argv[2:]:
        for dp, dn, fn in os.walk(root):
            dn.sort()
            for d in dn:
                p = os.path.join(dp, d)
                print(os.path.relpath(p, root), "D", "%o" % stat.S_IMODE(os.lstat(p).st_mode))
            for f in sorted(fn):
                p = os.path.join(dp, f)
                st = os.lstat(p)
                print(os.path.relpath(p, root), "F", "%o" % stat.S_IMODE(st.st_mode), hashlib.sha256(open(p, "rb").read()).hexdigest() if stat.S_ISREG(st.st_mode) else "link")
elif cmd == "envmask":   # the env file with the one secret line masked (to prove every other byte is unchanged)
    data = open(sys.argv[2], "rb").read().split(b"\n")
    sys.stdout.buffer.write(b"\n".join(b"ENTITLEMENT_WEBHOOK_SECRET=<MASKED>" if l.startswith(b"ENTITLEMENT_WEBHOOK_SECRET=") else l for l in data))
elif cmd == "cfgmask":   # the rendered wp-config with the secret constant masked
    for l in open(sys.argv[2]).read().split("\n"):
        print(re.sub(r"^(define\( 'AICC_ENTITLEMENT_WEBHOOK_SECRET', ')[^']*(' \);)$", r"\1<MASKED>\2", l))
elif cmd == "lock":      # hold an exclusive flock until killed
    fd = os.open(sys.argv[2], os.O_RDWR | os.O_CREAT, 0o600)
    fcntl.flock(fd, fcntl.LOCK_EX)
    print("locked", flush=True)
    time.sleep(120)
PY
cat > "$FAKE/backend.py" <<'PY'
# the fake BACKEND: re-reads the env file only when "restarted"; verifies the webhook exactly like app/routers/entitlement_webhook.py
import hashlib, hmac, json, os, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer
PORT, ENVF, FLAGS = int(sys.argv[1]), sys.argv[2], sys.argv[3]
TAG = b"aicc-entitlement-webhook-v1\n"; FPT = b"aicc-webhook-secret-fingerprint-v1\n"
S = {"secret": b"", "orig": b"", "events": {}, "seq": {}, "restarts": 0, "reqs": {}}
def fp(b): return hashlib.sha256(FPT + b).hexdigest()[:16]
def flag(n): return os.path.exists(os.path.join(FLAGS, n))
def flagval(n, d=""):
    try: return open(os.path.join(FLAGS, n)).read().strip()
    except OSError: return d
def load():
    s = b""
    try:
        for line in open(ENVF, "rb").read().split(b"\n"):
            if line.startswith(b"ENTITLEMENT_WEBHOOK_SECRET="): s = line.split(b"=", 1)[1]
    except OSError: pass
    S["secret"] = s
def count(code, err): k = "%d:%s" % (code, err); S["reqs"][k] = S["reqs"].get(k, 0) + 1
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj, err="-"):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
        if self.path.startswith("/v1/"): count(code, err)
    def err(self, code, e): self.send(code, {"detail": {"error": e}}, e)
    def do_GET(self):
        if self.path == "/health":
            bad = flag("down") or (flag("backend-broken-new") and S["secret"] != S["orig"])
            if bad: return self.send(503, {"status": "error"})
            return self.send(200, {"status": "ok", "database": "connected", "version": "1.0", "build": flagval("build", "a" * 40), "entitlement_mode": flagval("mode", "enforced")})
        if self.path == "/__info":
            return self.send(200, {"loaded_fp": fp(S["secret"]), "restarts": S["restarts"], "events": sorted(S["events"]), "reqs": S["reqs"]})
        self.send(404, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n)
        if self.path == "/__restart":
            time.sleep(float(flagval("restart-delay", "0"))); load(); S["restarts"] += 1; return self.send(200, {})
        if self.path == "/__reset":
            load(); S["orig"] = S["secret"]; S["events"] = {}; S["seq"] = {}; S["restarts"] = 0; S["reqs"] = {}; return self.send(200, {})
        if self.path != "/v1/internal/entitlement/webhook": return self.send(404, {})
        if not S["secret"]: return self.err(503, "entitlement_webhook_not_configured")
        ts, sig = self.headers.get("X-AICC-Webhook-Timestamp"), self.headers.get("X-AICC-Webhook-Signature")
        if not ts or not sig: return self.err(401, "webhook_signature_missing")
        try: t = int(ts)
        except ValueError: return self.err(400, "webhook_timestamp_malformed")
        if abs(int(time.time()) - t) > 300: return self.err(401, "webhook_timestamp_out_of_window")
        secrets_ok = [S["secret"]] + ([S["orig"]] if flag("also-accept-old") else [])
        if not any(hmac.compare_digest(hmac.new(s, TAG + str(t).encode() + b"\n" + raw, hashlib.sha256).hexdigest(), sig) for s in secrets_ok): return self.err(401, "webhook_signature_invalid")
        try:
            p = json.loads(raw); assert all(isinstance(p[k], str) for k in ("event_id", "activation_ref", "license_ref", "status")) and isinstance(p["sequence"], int)
        except Exception: return self.err(400, "webhook_payload_malformed")
        if p["event_id"] in S["events"]: return self.send(200, {"received": True, "applied": False, "reason": "duplicate_event_id"}, "dup")
        S["events"][p["event_id"]] = p["sequence"]
        applied = p["sequence"] > S["seq"].get(p["activation_ref"], 0)
        if applied: S["seq"][p["activation_ref"]] = p["sequence"]
        return self.send(200, {"received": True, "applied": applied}, "applied" if applied else "stale")
load(); S["orig"] = S["secret"]
HTTPServer.allow_reuse_address = True
HTTPServer(("127.0.0.1", PORT), H).serve_forever()
PY
cat > "$FAKE/dispatcher.py" <<'PY'
# the fake OUTBOX + dispatcher of the Control Plane: signs with the secret the RENDERED wp-config defines, delivers to the fake Backend, 401 = a failed attempt (never a drop), 8 attempts = exhausted
import hashlib, hmac, json, os, re, sys, time, urllib.error, urllib.request
OB, CFG, URL, FLAGS = os.environ["FAKE_OUTBOX"], os.environ["FAKE_CP_CONFIG"], os.environ["FAKE_BACKEND_URL"], os.environ["FAKE_FLAGS"]
def load():
    try: return json.load(open(OB))
    except OSError: return {"events": [], "next": 1}
def save(d): json.dump(d, open(OB, "w"))
def secret():
    m = re.search(rb"(?m)^define\( 'AICC_ENTITLEMENT_WEBHOOK_SECRET', '([^']*)' \);", open(CFG, "rb").read()); return m.group(1)
d = load(); cmd = sys.argv[1]
if cmd == "enqueue":
    for _ in range(int(sys.argv[2])):
        i = d["next"]; d["next"] += 1
        d["events"].append({"event_id": "evt-%04d" % i, "activation_ref": "act-1", "license_ref": "lic-1", "status": "active", "plan": "trial", "expires_at": 2000000000, "sequence": i,
                            "attempts": 7 if sys.argv[3] == "exhaust" else 0, "delivered": False, "exhausted": False, "hold": sys.argv[3] == "held"})
    save(d)
elif cmd == "run":
    if os.path.exists(os.path.join(FLAGS, "outbox-stuck")): sys.exit(0)
    s = secret()
    for e in d["events"]:
        if e["delivered"] or e["exhausted"] or e["hold"]: continue
        body = json.dumps({k: e[k] for k in ("event_id", "activation_ref", "license_ref", "status", "plan", "expires_at", "sequence")}, separators=(",", ":")).encode()
        ts = int(time.time()); sig = hmac.new(s, b"aicc-entitlement-webhook-v1\n" + str(ts).encode() + b"\n" + body, hashlib.sha256).hexdigest()
        req = urllib.request.Request(URL + "/v1/internal/entitlement/webhook", data=body, method="POST", headers={"X-AICC-Webhook-Timestamp": str(ts), "X-AICC-Webhook-Signature": sig, "Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=10); e["delivered"] = True
        except urllib.error.HTTPError:
            e["attempts"] += 1
            if e["attempts"] >= 8: e["exhausted"] = True
    save(d)
elif cmd == "health":
    ev = d["events"]
    print(json.dumps({"license_outbox": {"available": True, "pending": sum(1 for e in ev if not e["delivered"] and not e["exhausted"]), "exhausted": sum(1 for e in ev if e["exhausted"]), "oldest_pending_age_seconds": 7}}))
PY
cat > "$FAKE/wp-wrapper.php" <<'PHP'
<?php
// a stand-in for `wp eval-file`: the constant comes from the RENDERED wp-config, the dispatcher class signs exactly like the real one, HTTP goes only to the local fake Backend
define( 'ABSPATH', '/' );
$cfg = file_get_contents( getenv( 'FAKE_CP_CONFIG' ) );
if ( preg_match( "/^define\( 'AICC_ENTITLEMENT_WEBHOOK_SECRET', '([^']*)' \);/m", $cfg, $m ) ) { define( 'AICC_ENTITLEMENT_WEBHOOK_SECRET', $m[1] ); }
class AICC_LM_Entitlement_Dispatcher { public static function sign( $body, $timestamp, $secret ) { return hash_hmac( 'sha256', "aicc-entitlement-webhook-v1\n" . $timestamp . "\n" . $body, $secret ); } }
class WP_Error {}
function is_wp_error( $x ) { return $x instanceof WP_Error; }
function wp_safe_remote_post( $url, $a ) {
	if ( 0 !== strpos( $url, 'http://127.0.0.1:' ) ) { fwrite( STDERR, "fake wp: refusing a non-local URL\n" ); return new WP_Error(); }
	$h = ''; foreach ( $a['headers'] as $k => $v ) { $h .= "$k: $v\r\n"; }
	$ctx = stream_context_create( array( 'http' => array( 'method' => 'POST', 'header' => $h, 'content' => $a['body'], 'ignore_errors' => true, 'timeout' => 10 ) ) );
	$b = @file_get_contents( $url, false, $ctx );
	if ( false === $b ) { return new WP_Error(); }
	preg_match( '/ (\d{3})/', $http_response_header[0], $mm );
	return array( 'code' => (int) $mm[1], 'body' => $b );
}
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_retrieve_body( $r ) { return $r['body']; }
$args = array_slice( $argv, 2 );
require $argv[1];
PHP
cat > "$FAKE/ctl.py" <<'PY'
import sys, urllib.request
try:
    urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:%s/%s" % (sys.argv[1], sys.argv[2]), data=b"", method="POST"), timeout=30).read()
except Exception as e:
    sys.stderr.write("ctl failed: %s\n" % type(e).__name__); sys.exit(1)
PY
PORT="$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
BURL="http://127.0.0.1:$PORT"
HP() { python3 -I "$FAKE/h.py" "$@"; }
fp16() { HP fp "$1"; }
FPOLD="$(fp16 "$OLD")"; FPNEW="$(fp16 "$NEW")"
flag_set() { printf '%s\n' "${2:-1}" > "$FLAGS/$1"; }
ctl() { python3 -I "$FAKE/ctl.py" "$PORT" "$1"; }
be_info() { curl -s --max-time 5 "$BURL/__info"; }
be_fp() { be_info | jq -r .loaded_fp; }
be_restarts() { be_info | jq -r .restarts; }
be_events() { be_info | jq -r '.events|join(",")'; }
be_req() { be_info | jq -r --arg k "$1" '.reqs[$k] // 0'; }
outbox() { python3 -I "$FAKE/dispatcher.py" health | jq -r '.license_outbox|"\(.pending)/\(.exhausted)"'; }
ENVBAK=""

# ---- the fake hosts ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
# every fake command logs to $LOGS (outside the host prefixes, so a "nothing changed" hash of the hosts is not disturbed by the fakes' own logs)
mkfake() { # <dir> <host>
  local d="$1" h="$2"
  mkdir -p "$d"
  cat > "$d/sudo" <<'EOF'
#!/bin/bash
while [ $# -gt 0 ]; do case "$1" in -u|-g|-h) shift 2 ;; -*) shift ;; *) break ;; esac; done
exec "$@"
EOF
  cat > "$d/logger" <<EOF
#!/bin/bash
{ printf 'LOGGER'; printf ' [%s]' "\$@"; printf '\n'; } >> "$LOGS/journal.log"
EOF
  cat > "$d/sha256sum" <<EOF
#!/bin/bash
if [ -e "$FLAGS/bad-sha" ]; then echo "\$(printf '0%.0s' \$(seq 64))  -"; exit 0; fi
exec shasum -a 256 "\$@"
EOF
}
mkfake_cp() {
  local d="$TMP/cpbin"; mkfake "$d" cp
  cat > "$d/systemctl" <<EOF
#!/bin/bash
echo "cp systemctl \$*" >> "$LOGS/cp-systemctl.log"
case "\$1 \$2" in
  "is-active php8.3-fpm") echo active; exit 0 ;;
  "reload php8.3-fpm") f="$FLAGS/fail-reload"; if [ -e "\$f" ] && [ "\$(cat "\$f")" -gt 0 ]; then echo \$(( \$(cat "\$f") - 1 )) > "\$f"; echo "Job for php8.3-fpm.service failed (fake)" >&2; exit 1; fi; exit 0 ;;
esac
exit 0
EOF
  cat > "$d/aicc-render-wp-config" <<EOF
#!/bin/bash
echo "render \$*" >> "$LOGS/render.log"
cmp=0; for a in "\$@"; do [ "\$a" != "--compare" ] || cmp=1; done
# the failure matrix does not need the real (slow) comparison on every preflight: section A, B and the shape cases use it; the others set this flag
if [ "\$cmp" = 1 ] && [ -e "$FLAGS/fast-compare" ]; then echo "IDENTICAL (fixture fast path)"; exit 0; fi
f="$FLAGS/fail-render"
if [ "\$cmp" = 0 ] && [ -e "\$f" ] && [ "\$(cat "\$f")" -gt 0 ]; then echo \$(( \$(cat "\$f") - 1 )) > "\$f"; echo "REFUSED: fake render failure" >&2; exit 1; fi
exec env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --out "$CP/srv/aicc/shared/wp-config.php" --secrets-dir "$CP/etc/aicc/secrets" --mail-dir "$CP/etc/aicc-mail" --plugin-release-dir "$CP/rel" --owner-facts-file "$CP/etc/aicc/owner-facts.env" --owner "$OFU" "\$@"
EOF
  cat > "$d/aicc-wp" <<EOF
#!/bin/bash
[ ! -e "$FLAGS/aicc-wp-down" ] || { echo "aicc-wp: fake failure" >&2; exit 1; }
export FAKE_OUTBOX="$TMP/outbox.json" FAKE_CP_CONFIG="$CP/srv/aicc/shared/wp-config.php" FAKE_BACKEND_URL="$BURL" FAKE_FLAGS="$FLAGS"
case "\$1 \$2" in
  "aicc-mail health") python3 "$FAKE/dispatcher.py" run; python3 "$FAKE/dispatcher.py" health ;;       # every health read is also a cron tick
  "eval-file "*) shift; f="\$1"; shift; exec php "$FAKE/wp-wrapper.php" "\$f" "\$@" ;;
  *) echo "fake aicc-wp: unexpected \$*" >&2; exit 2 ;;
esac
EOF
  chmod 755 "$d"/*
}
mkfake_api() {
  local d="$TMP/apibin"; mkfake "$d" api
  cat > "$d/hostname" <<'EOF'
#!/bin/bash
echo api.copilt.org
EOF
  cat > "$d/chown" <<'EOF'
#!/bin/bash
exit 0        # the fixture runs as the calling user: root:root cannot be set (the modes are real, the owner is the user)
EOF
  cat > "$d/systemctl" <<EOF
#!/bin/bash
echo "api systemctl \$*" >> "$LOGS/api-systemctl.log"
export FAKE_OUTBOX="$TMP/outbox.json" FAKE_CP_CONFIG="$CP/srv/aicc/shared/wp-config.php" FAKE_BACKEND_URL="$BURL" FAKE_FLAGS="$FLAGS"
case "\$1 \$2" in
  "is-active aicc-backend") [ ! -e "$FLAGS/unit-inactive" ] && { echo active; exit 0; } || { echo inactive; exit 3; } ;;
  "cat aicc-backend") if [ -e "$FLAGS/unit-no-envfile" ]; then printf '[Service]\nExecStart=/usr/bin/docker run --rm --name aicc-backend --network host aicc-backend:fake\n'; else printf '[Service]\nExecStart=/usr/bin/docker run --rm --name aicc-backend --network host --env-file /etc/aicc/backend.env aicc-backend:fake\n'; fi; exit 0 ;;
  "restart aicc-backend")
    f="$FLAGS/restart-fail"; if [ -e "\$f" ] && [ "\$(cat "\$f")" -gt 0 ]; then echo \$(( \$(cat "\$f") - 1 )) > "\$f"; echo "Job for aicc-backend.service failed (fake)" >&2; exit 1; fi
    python3 "$FAKE/ctl.py" "$PORT" __restart || exit 1
    if [ -e "$FLAGS/bystander-restart" ]; then echo "running|none|2026-11-17T19:30:00.000000000Z" > "$API/docker/nourishvik-care"; fi
    if [ -e "$FLAGS/window-events" ]; then python3 "$FAKE/dispatcher.py" enqueue "\$(cat "$FLAGS/window-events")" "\$(cat "$FLAGS/window-mode" 2>/dev/null || echo normal)"; fi
    python3 "$FAKE/dispatcher.py" run      # the cron fires inside the window: the CP still signs with the OLD secret
    exit 0 ;;
esac
exit 0
EOF
  cat > "$d/docker" <<EOF
#!/bin/bash
echo "docker \$*" >> "$LOGS/docker.log"
[ "\$1" = inspect ] || { echo "fake docker: only inspect is allowed (the bystander is read-only)" >&2; exit 2; }
n="\${@: -1}"; [ -f "$API/docker/\$n" ] || { echo "No such object: \$n" >&2; exit 1; }
cat "$API/docker/\$n"
EOF
  chmod 755 "$d"/*
}
mkfake_cp; mkfake_api
cat > "$TMP/fakessh" <<EOF
#!/bin/bash
# fake ssh: records its argv, picks the host by destination, rewrites the absolute host paths under that host's prefix, runs the REMOTE command locally with the host's fake commands first in PATH
set -u
dest=""; cmd=""; opts=()
while [ \$# -gt 0 ]; do case "\$1" in -i|-o|-F) opts+=("\$1" "\$2"); shift 2 ;; -*) opts+=("\$1"); shift ;; *) dest="\$1"; shift; cmd="\$*"; break ;; esac; done
case "\$dest" in aicc@157.230.110.211) h=cp; pfx="$CP"; bin="$TMP/cpbin" ;; aicc@139.59.157.231) h=api; pfx="$API"; bin="$TMP/apibin" ;; *) echo "fake ssh: unexpected destination \$dest" >&2; exit 255 ;; esac
{ printf 'SSH host=%s dest=%s\n' "\$h" "\$dest"; printf 'SSHOPT %s=%s\n' "\$h" "\${opts[*]}"; printf 'SSHCMD %s=%s\n' "\$h" "\$cmd"; } >> "$REC"
[ ! -e "$FLAGS/ssh-down-\$h" ] || { echo "fake ssh: connection refused" >&2; exit 255; }
cmd="\${cmd//\\/etc\\//\$pfx/etc/}"; cmd="\${cmd//\\/usr\\/local\\/sbin\\//\$pfx/usr/local/sbin/}"; cmd="\${cmd//127.0.0.1:8000/127.0.0.1:$PORT}"
env PATH="\$bin:$BASEPATH" AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="\$pfx" AICC_TEST_BACKEND_URL="$BURL" AICC_TEST_HOSTNAME="$APIHOST" AICC_TEST_NEW_SECRET_FILE="\${AICC_TEST_NEW_SECRET_FILE:-}" AICC_TEST_NO_FSYNC="\${AICC_TEST_NO_FSYNC:-}" bash -c "\$cmd"
EOF
chmod 755 "$TMP/fakessh"
ssh-keygen -q -t ed25519 -N '' -f "$TMP/hostkey" -C fake-host
printf '157.230.110.211 %s\n139.59.157.231 %s\n' "$(cut -d' ' -f1,2 "$TMP/hostkey.pub")" "$(cut -d' ' -f1,2 "$TMP/hostkey.pub")" > "$HOMED/.ssh/known_hosts_aicc_prod"
printf 'fake operator key file, not a key\n' > "$HOMED/.ssh/aicc_cp_prod_operator"; printf 'fake api key file, not a key\n' > "$HOMED/.ssh/aicc_digitalocean_prod"; chmod 600   # the production operator identities (fake files) "$HOMED/.ssh/"aicc_*

# ---- the world ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
ENV_ORIG_TEXT=$'# Backend environment (fixture)\nDATABASE_URL=postgresql://aicc:fixture-db-pass@127.0.0.1:5432/aicc_prod\nACTIVATION_PROOF_SECRET_CURRENT=canary-activation-proof-FIXTURE-NOT-A-SECRET-0001\nACTIVATION_PROOF_KID_CURRENT=kid-2026-11\nENTITLEMENT_WEBHOOK_SECRET=__OLD__\nINTERNAL_JOBS_BEARER_TOKEN=canary-internal-jobs-token-111111111111111111111111\n\nENTITLEMENT_MODE_NOTE=unrelated line after a blank line\n'
write_env() { printf '%s' "${ENV_ORIG_TEXT//__OLD__/$OLD}" > "$API/etc/aicc/backend.env"; chmod 640 "$API/etc/aicc/backend.env"; }
reset_world() {
  rm -rf "$CP" "$API" "$FLAGS" "$ROTSTATE" "$TMP/outbox.json"; mkdir -p "$FLAGS"
  mkdir -p "$CP/etc/aicc/secrets" "$CP/etc/aicc-mail" "$CP/srv/aicc/shared" "$CP/rel" "$CP/usr/local/sbin" "$CP/usr/local/lib/aicc" "$CP/var/lib/aicc"
  chmod 700 "$CP/etc/aicc/secrets"; chmod 750 "$CP/etc/aicc-mail" "$CP/rel"
  printf 'AICC_ENV=production\nAICC_HOSTNAME=www.copilt.org\nAICC_HOST_ROLE=control-plane-edge\nAICC_STAGE_ID=%s\n' "$STAGEID" > "$CP/etc/aicc-stage-identity"
  printf 'golden_db_pass_0001\n' > "$CP/etc/aicc/secrets/db-cp.pass"
  { for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT; do printf '%s=SALTVALUE_%s\n' "$k" "$k"; done; } > "$CP/etc/aicc/secrets/wp-secrets.env"
  printf '%s' "$OLD" > "$CP/etc/aicc/secrets/entitlement-webhook.secret"; printf 'PROOF-test-0123456789-0123456789-abcdefgh\n' > "$CP/etc/aicc/secrets/activation-proof.secret"; chmod 600 "$CP/etc/aicc/secrets/"*
  cp "$CPTOOL" "$CP/usr/local/sbin/aicc-rotate-webhook-secret"; chmod 755 "$CP/usr/local/sbin/aicc-rotate-webhook-secret"; cp "$PROBEPHP" "$CP/usr/local/lib/aicc/webhook-probe.php"; chmod 644 "$CP/usr/local/lib/aicc/webhook-probe.php"
  if [ -s "$TMP/wp-config.cache" ]; then cp "$TMP/wp-config.cache" "$CP/srv/aicc/shared/wp-config.php"; chmod 640 "$CP/srv/aicc/shared/wp-config.php"
  else PATH="$TMP/cpbin:$BASEPATH" "$TMP/cpbin/aicc-render-wp-config" --env production --confirm-production >/dev/null 2>&1 || echo "FIXTURE: the first render failed"; cp "$CP/srv/aicc/shared/wp-config.php" "$TMP/wp-config.cache"; fi
  : > "$LOGS/render.log"
  mkdir -p "$API/etc/aicc" "$API/usr/local/sbin" "$API/docker" "$API/var/lib/aicc"; write_env
  echo "running|none|2026-11-17T01:02:03.123456789Z" > "$API/docker/nourishvik-care"
  ctl __reset || echo "FIXTURE: the fake backend did not reset"
  python3 "$FAKE/dispatcher.py" enqueue 2 held 2>/dev/null || { FAKE_OUTBOX="$TMP/outbox.json" FAKE_CP_CONFIG="$CP/srv/aicc/shared/wp-config.php" FAKE_BACKEND_URL="$BURL" FAKE_FLAGS="$FLAGS" python3 "$FAKE/dispatcher.py" enqueue 2 held; }
  : > "$LOGS/journal.log"; : > "$REC"; : > "$LOGS/api-systemctl.log"; : > "$LOGS/cp-systemctl.log"
  ENV_ORIG_MASKED="$(HP envmask "$API/etc/aicc/backend.env")"; CFG_ORIG_MASKED="$(HP cfgmask "$CP/srv/aicc/shared/wp-config.php")"
  cp "$CP/srv/aicc/shared/wp-config.php" "$TMP/wp-config.orig"; cp "$API/etc/aicc/backend.env" "$TMP/backend.env.orig"
}
export FAKE_OUTBOX="$TMP/outbox.json" FAKE_CP_CONFIG="$CP/srv/aicc/shared/wp-config.php" FAKE_BACKEND_URL="$BURL" FAKE_FLAGS="$FLAGS"
python3 -I "$FAKE/backend.py" "$PORT" "$API/etc/aicc/backend.env" "$FLAGS" > "$LOGS/backend.out" 2>&1 &
SRVPID=$!
mkdir -p "$API/etc/aicc" "$FLAGS"; write_env
for i in $(seq 1 50); do curl -s --max-time 1 "$BURL/__info" >/dev/null 2>&1 && break; sleep 0.1; done
reset_world

LOGN=0; R_OUT=""; R_RC=0
ROT_COMMON="--confirm-production --ignore-window --poll-interval 0.2 --drain-timeout 2 --health-timeout 3 --api-hostname $APIHOST --backend-url $BURL"
rot() { # rot <subcommand> [args]: the owner script on the fake hosts; the whole output is in R_OUT (and in a log file that the leak scans read)
  local sub="$1"; shift; local e v lf
  e=(env -i "PATH=$BASEPATH" "HOME=$HOMED" "TERM=xterm" "TMPDIR=$TMP" AICC_TEST_HARNESS=1 "AICC_TEST_SSH=$TMP/fakessh" "AICC_ROT_STATE_DIR=$ROTSTATE")
  for v in AICC_TEST_KILL_AT AICC_TEST_UTC_HHMM AICC_TEST_NEW_SECRET_FILE AICC_TEST_SHORT_WRITE AICC_TEST_NO_FSYNC; do [ -z "${!v:-}" ] || e+=("$v=${!v}"); done
  LOGN=$((LOGN + 1)); lf="$LOGS/$(printf '%03d' "$LOGN").log"
  local common="$ROT_COMMON"; [ "${ROT_NOWIN:-0}" != 1 ] || common="${common/--ignore-window/}"
  R_OUT="$("${e[@]}" bash "$ROT" "$sub" $common "$@" 2>&1 </dev/null)"; R_RC=$?
  printf '%s\n' "$R_OUT" > "$lf"
  [ -z "${ROT_DEBUG:-}" ] || { printf -- '---- rot %s %s (rc %s)\n%s\n' "$sub" "$*" "$R_RC" "$R_OUT"; }
}
export AICC_TEST_NEW_SECRET_FILE="$TMP/new-secret.file"

# ---- state readers (the test's own, independent of the tools) ------------------------------------------------------------------------------------------------------------------------------
cp_live_fp() { [ -f "$CP/etc/aicc/secrets/entitlement-webhook.secret" ] && fp16 "$(tr -d ' \n' < "$CP/etc/aicc/secrets/entitlement-webhook.secret")"; }
cp_cfg_fp() { local v; v="$(sed -n "s/^define( 'AICC_ENTITLEMENT_WEBHOOK_SECRET', '\([^']*\)' );\$/\1/p" "$CP/srv/aicc/shared/wp-config.php")"; fp16 "$v"; }
api_env_fp() { local v; v="$(sed -n 's/^ENTITLEMENT_WEBHOOK_SECRET=//p' "$API/etc/aicc/backend.env")"; fp16 "$v"; }
world() { # "old" / "new" / the four fingerprints when mixed: CP file, CP rendered config, API env file, the secret the running Backend loaded
  local a b c d; a="$(cp_live_fp)"; b="$(cp_cfg_fp)"; c="$(api_env_fp)"; d="$(be_fp)"
  if [ "$a$b$c$d" = "$FPOLD$FPOLD$FPOLD$FPOLD" ]; then echo old; elif [ "$a$b$c$d" = "$FPNEW$FPNEW$FPNEW$FPNEW" ]; then echo new; else echo "mixed(cp=$a cfg=$b env=$c backend=$d)" | sed "s/$FPOLD/OLD/g; s/$FPNEW/NEW/g"; fi
}
no_temps() { [ -z "$(find "$CP" "$API" -name '.*.new.*' 2>/dev/null)" ]; }
secret_whole() { [ "$(wc -c < "$1" | tr -d ' ')" = 64 ] && grep -Eq '^[0-9a-f]{64}$' "$1"; }
INV_FAILS=""
# the invariants after ANY step: files whole, modes and owners preserved, every other env line byte-identical, no partial file, no temp file after a successful run
invariants() {
  local name="$1" bad="" f
  secret_whole "$CP/etc/aicc/secrets/entitlement-webhook.secret" || bad="$bad cp-live-not-whole"
  [ "$(mode "$CP/etc/aicc/secrets/entitlement-webhook.secret")" = 600 ] || bad="$bad cp-live-mode"
  for f in "$CP"/etc/aicc/secrets/entitlement-webhook.secret.next-* "$CP"/etc/aicc/secrets/entitlement-webhook.secret.prev-* "$CP"/etc/aicc/secrets/entitlement-webhook.secret.retired-*; do
    [ -e "$f" ] || continue; secret_whole "$f" || bad="$bad partial:$(basename "$f")"; [ "$(mode "$f")" = 600 ] || bad="$bad mode:$(basename "$f")"
  done
  [ "$(mode "$API/etc/aicc/backend.env")" = 640 ] || bad="$bad env-mode"
  [ "$(HP envmask "$API/etc/aicc/backend.env")" = "$ENV_ORIG_MASKED" ] || bad="$bad env-other-lines-changed"
  [ "$(grep -c '^ENTITLEMENT_WEBHOOK_SECRET=' "$API/etc/aicc/backend.env")" = 1 ] || bad="$bad env-secret-lines"
  grep -Eq '^ENTITLEMENT_WEBHOOK_SECRET=[0-9a-f]{64}$' "$API/etc/aicc/backend.env" || bad="$bad env-secret-shape"
  [ "$(HP cfgmask "$CP/srv/aicc/shared/wp-config.php")" = "$CFG_ORIG_MASKED" ] || bad="$bad config-other-lines-changed"
  [ "$(mode "$CP/srv/aicc/shared/wp-config.php")" = 640 ] || bad="$bad config-mode"
  for f in "$API"/etc/aicc/backend.env.pre-webhook-rotation-*; do [ -e "$f" ] || continue; [ "$(mode "$f")" = 640 ] || bad="$bad backup-mode"; [ "$(HP envmask "$f")" = "$ENV_ORIG_MASKED" ] || bad="$bad backup-lines"; done
  for f in "$API"/etc/aicc/webhook-rotation/*/next.secret; do [ -e "$f" ] || continue; secret_whole "$f" || bad="$bad staged-partial"; [ "$(mode "$f")" = 600 ] || bad="$bad staged-mode"; done
  [ -z "$(find "$CP/etc/aicc/secrets" "$API/etc/aicc" -name '.*.new.*' -size +0 2>/dev/null | head -1)" ] || [ "${ALLOW_TEMP:-0}" = 1 ] || bad="$bad temp-file-left"
  [ -z "$bad" ] && t_pass "$name: invariants hold (files whole, modes/owners, other env/config lines byte-identical)" || t_bad "$name: invariants BROKEN:$bad"
}
ID_NOW() { sed -n 's/^new rotation id: //p' <<< "$R_OUT" | head -1; }
journal_has() { grep -q "$2" "$1/var/lib/aicc/webhook-rotation/$3.state" 2>/dev/null; }

echo "== A. plan changes NOTHING =="
SNAP0="$(HP snap "$CP" "$API" | shasum -a 256)"
rot plan
t_eq "plan exits 0" "$R_RC" "0"
t_contains "...says PLAN OK and that nothing was changed" "$R_OUT" "PLAN OK: every preflight passed. Nothing was changed."
t_contains "...verifies BOTH host identities first" "$R_OUT" "Control Plane identity verified: production, www.copilt.org"
t_contains "...(API host)" "$R_OUT" "API host identity verified: api.copilt.org, aicc-backend active, /health ok"
t_contains "...runs the CP preflight (render compare, outbox)" "$R_OUT" "ok: a render reproduces the live wp-config byte for byte"
t_contains "...runs the API preflight from this checkout without installing it" "$R_OUT" "ok: exactly one ENTITLEMENT_WEBHOOK_SECRET line, 64 hex"
t_contains "...prints the outbox baseline" "$R_OUT" "OUTBOX pending=2 exhausted=0"
t_contains "...prints the exact steps and the honest window statement" "$R_OUT" "FROM STEP 6 TO 7 THE HOSTS DISAGREE"
t_contains "...(NOT ATOMIC, NOT LOSSY)" "$R_OUT" "NOT ATOMIC, NOT LOSSY"
t_contains "...announces what the API tool install would do" "$R_OUT" "not installed: run would install it root:root 0755"
t_eq "...EVERY file and directory of BOTH hosts (path, mode, content hash) is identical before and after" "$(HP snap "$CP" "$API" | shasum -a 256)" "$SNAP0"
t_eq "...the Backend was not restarted and no event was delivered" "$(be_restarts)/$(be_events)" "0/"
t_eq "...the world is still the old secret everywhere" "$(world)" "old"
t_not_contains "...no secret in the plan output" "$R_OUT" "$OLD"
rot plan --dry-run; t_eq "plan --dry-run (the alias) is accepted" "$R_RC" "0"
t_eq "...and the bystander was only inspected (docker calls are all 'inspect')" "$(grep -vc '^docker inspect' "$LOGS/docker.log" || true)" "0"
t_ok "...no state directory or journal was created on either host" bash -c "[ ! -e '$CP/var/lib/aicc/webhook-rotation' ] && [ ! -e '$API/var/lib/aicc/webhook-rotation' ]"
rot plan --dry-run --preflight-cmd /nonexistent; t_contains "--preflight-cmd must be an executable file" "$R_OUT" "--preflight-cmd must be an executable"
rot run --finalize --id 2026111; t_contains "a malformed --id is refused before any connection" "$R_OUT" "--id must look like"

echo "== B. the successful rotation =="
flag_set window-events 2
rot run
t_eq "run exits 0" "$R_RC" "0"
RID="$(ID_NOW)"
t_ok "...it printed the new rotation id (UTC time)" bash -c "[[ '$RID' =~ ^[0-9]{8}T[0-9]{6}Z\$ ]]"
t_contains "...ends with READY TO FINALIZE and the finalize command" "$R_OUT" "READY TO FINALIZE: id $RID"
t_contains "...says plainly that it is NOT atomic and why events survive" "$R_OUT" "NOT ATOMIC: for about"
t_contains "...(durable outbox, event_id primary key, strictly increasing sequence)" "$R_OUT" "durable outbox, event_id primary key, strictly increasing sequence"
t_contains "...and that the old secret is NOT yet retired" "$R_OUT" "The old secret is NOT yet retired"
t_contains "...all ten phases ran" "$R_OUT" "phase 10/10: bystander + Backend build unchanged"
t_contains "...the fingerprints were compared, not the secrets" "$R_OUT" "fingerprints equal: $FPNEW"
t_eq "...CP file, CP rendered wp-config, API env and the RUNNING Backend all hold the NEW secret" "$(world)" "new"
t_eq "...the Backend was restarted exactly once" "$(be_restarts)" "1"
t_contains "...probe-new on the CP (the RUNNING constant, through the PHP probe script) passed" "$R_OUT" "probe-new: PASS status=400 error=webhook_payload_malformed constant_fp=$FPNEW"
t_contains "...probe-old from the CP host: the old secret is rejected with 401 webhook_signature_invalid" "$R_OUT" "probe-old: PASS status=401 error=webhook_signature_invalid (the Backend rejects the previous secret, fp $FPOLD)"
t_contains "...probe-old and probe-new on the API host (local cross-check)" "$R_OUT" "[API] probe-new: PASS status=400"
t_eq "...the Backend saw malformed-body probes (400) and rejected old-secret probes (401) and applied NO probe as an event" "$(be_req 400:webhook_payload_malformed | awk '{print ($1>=3)}')/$(be_req 401:webhook_signature_invalid | awk '{print ($1>=3)}')" "1/1"
t_eq "...an event queued in the window was delivered after the promote, exactly once, none lost (the 2 held baseline events stay pending)" "$(be_events)/$(outbox)" "evt-0003,evt-0004/2/0"
t_contains "...the outbox drain was checked against the baseline" "$R_OUT" "outbox: pending=2 (baseline 2) exhausted=0"
t_contains "...the bystander is reported unchanged" "$R_OUT" "bystander nourishvik-care: unchanged (StartedAt 2026-11-17T01:02:03.123456789Z, running)"
t_contains "...and the Backend build and mode" "$R_OUT" "Backend build aaaaaaaaaaaa and entitlement_mode enforced: unchanged"
t_eq "...the bystander state file was never written (docker is only inspected)" "$(cat "$API/docker/nourishvik-care")" "running|none|2026-11-17T01:02:03.123456789Z"
invariants "after the rotation"
t_ok "...the old secret is preserved on the CP as .prev-ID (root 0600), the new one is live, .next is gone (renamed)" bash -c "[ \"\$(cat '$CP/etc/aicc/secrets/entitlement-webhook.secret.prev-$RID')\" = '$OLD' ] && [ ! -e '$CP/etc/aicc/secrets/entitlement-webhook.secret.next-$RID' ] && [ \"\$(cat '$CP/etc/aicc/secrets/entitlement-webhook.secret')\" = '$NEW' ]"
t_ok "...the COMPLETE env copy exists with the original bytes (the old secret and every other secret), mode 640" bash -c "cmp '$TMP/backend.env.orig' '$API/etc/aicc/backend.env.pre-webhook-rotation-$RID' && [ \"\$(stat -f '%Lp' '$API/etc/aicc/backend.env.pre-webhook-rotation-$RID' 2>/dev/null || stat -c '%a' '$API/etc/aicc/backend.env.pre-webhook-rotation-$RID')\" = 640 ]"
t_eq "...the new env differs from the original in EXACTLY one line (the secret line)" "$(diff "$TMP/backend.env.orig" "$API/etc/aicc/backend.env" | grep -c '^[<>]')" "2"
t_ok "...the staged copy on the API host is root 0600 and holds the new secret" bash -c "[ \"\$(cat '$API/etc/aicc/webhook-rotation/$RID/next.secret')\" = '$NEW' ] && [ \"\$(stat -f '%Lp' '$API/etc/aicc/webhook-rotation/$RID/next.secret' 2>/dev/null || stat -c '%a' '$API/etc/aicc/webhook-rotation/$RID/next.secret')\" = 600 ]"
t_ok "...the rendered wp-config differs from the original ONLY in the secret constant" bash -c "diff <(python3 -I '$FAKE/h.py' cfgmask '$TMP/wp-config.orig') <(python3 -I '$FAKE/h.py' cfgmask '$CP/srv/aicc/shared/wp-config.php')"
t_ok "...php -l accepts the rendered config" php -l "$CP/srv/aicc/shared/wp-config.php"
t_contains "...php-fpm was reloaded and the render ran with the production flags" "$(cat "$LOGS/cp-systemctl.log" "$LOGS/render.log")" "render --env production --confirm-production"
t_contains "...the CP journal has the phases with UTC times and no secret" "$(cat "$CP/var/lib/aicc/webhook-rotation/$RID.state")" "phase=promoted"
t_contains "...(prepared with the baseline)" "$(cat "$CP/var/lib/aicc/webhook-rotation/$RID.state")" "baseline_pending=2"
t_contains "...the API journal has the baseline, staged, applied" "$(cat "$API/var/lib/aicc/webhook-rotation/$RID.state")" "phase=applied"
t_ok "...state files are mode 0600" bash -c "[ \"\$(stat -f '%Lp' '$CP/var/lib/aicc/webhook-rotation/$RID.state' 2>/dev/null || stat -c '%a' '$CP/var/lib/aicc/webhook-rotation/$RID.state')\" = 600 ]"
t_contains "...the audit lines went to the journal (action, id, phase, fingerprint PREFIXES)" "$(cat "$LOGS/journal.log")" "action=promote id=$RID phase=promoted"
t_contains "...with 8-character fingerprint prefixes only" "$(cat "$LOGS/journal.log")" "next_fp_prefix=${FPNEW:0:8}"
t_not_contains "...never a full fingerprint" "$(cat "$LOGS/journal.log")" "$FPNEW"
t_ok "...nothing is retired yet: no registry on either host" bash -c "[ ! -e '$CP/etc/aicc/webhook-secret-retired.fp' ] && [ ! -e '$API/etc/aicc/webhook-secret-retired.fp' ]"
SNAPA="$(HP snap "$CP" "$API" | shasum -a 256)"; RESTARTS_A="$(be_restarts)"
# idempotent re-run
rot run
t_eq "run again: exit 0 and a NO-OP that says so" "$R_RC" "0"
t_contains "...NO-OP: rotation $RID already promoted" "$R_OUT" "NO-OP: rotation $RID reached phase 'promoted'"
t_eq "...nothing changed on either host" "$(HP snap "$CP" "$API" | shasum -a 256)" "$SNAPA"
rot run --id "$RID"
t_eq "run --id $RID (an explicit continue) exits 0, reaches READY TO FINALIZE again" "$R_RC/$(printf '%s' "$R_OUT" | grep -c 'READY TO FINALIZE')" "0/1"
t_eq "...with NO second Backend restart and the secrets unchanged" "$(be_restarts)/$(world)" "$RESTARTS_A/new"
t_contains "...the apply step noticed the Backend already runs the new secret" "$R_OUT" "the running Backend already accepts the new secret: no restart needed"
t_contains "...the CP promote said already promoted" "$R_OUT" "already promoted: id=$RID"
invariants "after the idempotent re-run"
rot verify
t_eq "verify (before finalize) exits 0" "$R_RC" "0"
t_contains "...VERIFY OK" "$R_OUT" "VERIFY OK: same secret on both hosts"
t_contains "...notes that the old secret is not retired yet" "$R_OUT" "promoted but NOT finalized"
# finalize
rot finalize --id "$RID"
t_eq "finalize exits 0" "$R_RC" "0"
t_contains "...retires the old fingerprint on both hosts" "$R_OUT" "finalized: id=$RID previous secret fp=$FPOLD is RETIRED"
t_eq "...the registry on BOTH hosts holds <fp16> <UTC> <id>" "$(awk '{print $1" "$3}' "$CP/etc/aicc/webhook-secret-retired.fp")/$(awk '{print $1" "$3}' "$API/etc/aicc/webhook-secret-retired.fp")" "$FPOLD $RID/$FPOLD $RID"
t_ok "...the registries are root 0600 and hold no secret" bash -c "[ \"\$(stat -f '%Lp' '$CP/etc/aicc/webhook-secret-retired.fp' 2>/dev/null || stat -c '%a' '$CP/etc/aicc/webhook-secret-retired.fp')\" = 600 ] && ! grep -q '$OLD' '$CP/etc/aicc/webhook-secret-retired.fp' '$API/etc/aicc/webhook-secret-retired.fp'"
t_ok "...the CP renamed .prev to .retired and KEPT it; the env copy on the API host is kept" bash -c "[ ! -e '$CP/etc/aicc/secrets/entitlement-webhook.secret.prev-$RID' ] && [ \"\$(cat '$CP/etc/aicc/secrets/entitlement-webhook.secret.retired-$RID')\" = '$OLD' ] && [ -e '$API/etc/aicc/backend.env.pre-webhook-rotation-$RID' ]"
t_contains "...ends with VERIFY OK" "$R_OUT" "VERIFY OK"
invariants "after finalize"
rot finalize --id "$RID"; t_eq "finalize again is an idempotent no-op" "$R_RC/$(printf '%s' "$R_OUT" | grep -c 'VERIFY OK')" "0/1"
rot run; t_contains "run after finalize is a NO-OP (rotated less than 24 h ago)" "$R_OUT" "NO-OP: rotation $RID reached phase 'finalized'"
rot rollback --id "$RID"
t_eq "rollback after finalize is REFUSED (exit 1)" "$R_RC" "1"
t_contains "...naming the retired (exposed) secret and the explicit flag" "$R_OUT" "FINALIZED: its old secret is RETIRED"
t_eq "...and nothing changed" "$(world)" "new"
echo "-- B2. verify catches a backup restore of the retired secret --"
cp "$API/etc/aicc/backend.env" "$TMP/env.good"; cp "$CP/etc/aicc/secrets/entitlement-webhook.secret" "$TMP/cpsec.good"
cp "$API/etc/aicc/backend.env.pre-webhook-rotation-$RID" "$API/etc/aicc/backend.env"; ctl __restart
rot verify
t_eq "restoring the OLD backend.env (and restarting) makes verify FAIL" "$R_RC" "1"
t_contains "...RETIRED_SECRET_IN_USE" "$R_OUT" "VERIFY FAILED: RETIRED_SECRET_IN_USE"
t_contains "...and the API tool says so itself" "$R_OUT" "RETIRED_SECRET_IN_USE: the Backend's env file holds a RETIRED secret"
t_contains "...and the fingerprint mismatch with the Control Plane" "$R_OUT" "FINGERPRINT_MISMATCH"
rot status; t_eq "status fails loudly too (exit 1)" "$R_RC" "1"; t_contains "...naming RETIRED_SECRET_IN_USE" "$R_OUT" "RETIRED_SECRET_IN_USE"
cp "$TMP/env.good" "$API/etc/aicc/backend.env"; ctl __restart
printf '%s' "$OLD" > "$CP/etc/aicc/secrets/entitlement-webhook.secret"; chmod 600 "$CP/etc/aicc/secrets/entitlement-webhook.secret"
rot verify
t_eq "restoring the OLD CP secret file alone (config still new) fails verify" "$R_RC" "1"
t_contains "...RETIRED_SECRET_IN_USE from the Control Plane" "$R_OUT" "RETIRED_SECRET_IN_USE: the live secret of the Control Plane is a RETIRED secret"
t_contains "...and CONFIG_MISMATCH (the rendered wp-config still holds the new one)" "$R_OUT" "CONFIG_MISMATCH"
cp "$TMP/cpsec.good" "$CP/etc/aicc/secrets/entitlement-webhook.secret"; chmod 600 "$CP/etc/aicc/secrets/entitlement-webhook.secret"
rot verify; t_eq "after putting the good files back verify passes again" "$R_RC" "0"
echo "-- B3. the explicit, documented reinstatement of a retired secret --"
rot rollback --id "$RID" --i-reinstate-a-retired-secret
t_eq "rollback --i-reinstate-a-retired-secret is allowed" "$R_RC" "0"
t_contains "...with a loud warning on both hosts" "$R_OUT" "A RETIRED SECRET (fp $FPOLD) WAS REINSTATED ON THE CONTROL PLANE BY YOUR EXPLICIT DECISION"
t_contains "...(Backend)" "$R_OUT" "A RETIRED SECRET (fp $FPOLD) WAS REINSTATED ON THE BACKEND"
t_contains "...journalled as reinstated" "$(cat "$CP/var/lib/aicc/webhook-rotation/$RID.state")" "phase=reinstated"
t_eq "...the world is old again (consistent)" "$(world)" "old"
rot verify; t_eq "...and verify keeps failing RETIRED_SECRET_IN_USE until a new rotation" "$R_RC/$(printf '%s' "$R_OUT" | grep -c 'VERIFY FAILED: RETIRED_SECRET_IN_USE')" "1/1"
t_eq "...the registry still holds the entry (it removes nothing)" "$(wc -l < "$CP/etc/aicc/webhook-secret-retired.fp" | tr -d ' ')/$(wc -l < "$API/etc/aicc/webhook-secret-retired.fp" | tr -d ' ')" "1/1"


export AICC_TEST_NO_FSYNC=1       # from here on the fixture skips fsync (section B ran with the real calls)
# ---- helpers for the failure matrix ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
KILL=""
cptool_raw() { env "PATH=$TMP/cpbin:$BASEPATH" AICC_TEST_HARNESS=1 "AICC_ROOT_PREFIX=$CP" "AICC_TEST_NEW_SECRET_FILE=$TMP/new-secret.file" "AICC_TEST_BACKEND_URL=$BURL" "AICC_TEST_NO_FSYNC=${AICC_TEST_NO_FSYNC:-}" ${KILL:+"AICC_TEST_KILL_AT=$KILL"} python3 -I "$CP/usr/local/sbin/aicc-rotate-webhook-secret" "$@" --expect-stage-id "$STAGEID" 2>/dev/null; }
cptool() { local o rc; o="$(env "PATH=$TMP/cpbin:$BASEPATH" AICC_TEST_HARNESS=1 "AICC_ROOT_PREFIX=$CP" "AICC_TEST_NEW_SECRET_FILE=$TMP/new-secret.file" "AICC_TEST_BACKEND_URL=$BURL" "AICC_TEST_NO_FSYNC=${AICC_TEST_NO_FSYNC:-}" ${KILL:+"AICC_TEST_KILL_AT=$KILL"} python3 -I "$CP/usr/local/sbin/aicc-rotate-webhook-secret" "$@" --expect-stage-id "$STAGEID" 2>&1)"; rc=$?; printf '%s\n' "$o" | grep -v 'TEST HARNESS ACTIVE'; return $rc; }
apitool() { local o rc; o="$(env "PATH=$TMP/apibin:$BASEPATH" AICC_TEST_HARNESS=1 "AICC_ROOT_PREFIX=$API" "AICC_TEST_BACKEND_URL=$BURL" "AICC_TEST_HOSTNAME=$APIHOST" "AICC_TEST_NO_FSYNC=${AICC_TEST_NO_FSYNC:-}" ${KILL:+"AICC_TEST_KILL_AT=$KILL"} python3 -I "$APITOOL" "$@" --expect-hostname "$APIHOST" --health-timeout 5 2>&1)"; rc=$?; printf '%s\n' "$o" | grep -v 'TEST HARNESS ACTIVE'; return $rc; }
killed() { { "$@"; } 2>/dev/null; }      # a process that kills itself makes the shell print "Killed": not wanted in the test log
cpurl() { printf -- '--backend-url %s' "$BURL"; }
stage_new() { printf '%s\n' "$NEW" | apitool stage --id "$1"; }
events_ok() { # every event that is not deliberately held is delivered exactly once and the Backend has exactly those: none lost, none twice
  python3 -I -c '
import json, sys, urllib.request
d = json.load(open(sys.argv[1])); info = json.load(urllib.request.urlopen(sys.argv[2]))
want = sorted(e["event_id"] for e in d["events"] if e["delivered"]); got = info["events"]
lost = [e["event_id"] for e in d["events"] if not e["hold"] and not e["delivered"]]
print("ok" if (want == got and not lost) else "MISMATCH want=%s got=%s lost=%s" % (want, got, lost))' "$TMP/outbox.json" "$BURL/__info"
}
release_held() { python3 -I -c '
import json, sys
d = json.load(open(sys.argv[1]))
for e in d["events"]:
    e["hold"] = False if e["event_id"] not in ("evt-0001", "evt-0002") else e["hold"]
json.dump(d, open(sys.argv[1], "w"))' "$TMP/outbox.json"; }
recover_resume() { # <name>
  rot resume --id "$RID"
  t_eq "$1: resume exits 0" "$R_RC" "0"
  t_contains "...READY TO FINALIZE" "$R_OUT" "READY TO FINALIZE: id $RID"
  t_eq "...CP file, CP config, API env and the running Backend all hold the NEW secret" "$(world)" "new"
  t_eq "...no event is lost or delivered twice" "$(events_ok)" "ok"
  invariants "$1 after resume"
  [ "${VERIFY_AFTER:-0}" != 1 ] || { rot verify; t_eq "...verify passes" "$R_RC" "0"; }
}
recover_rollback() { # <name>
  rot rollback --id "$RID"
  t_eq "$1: rollback exits 0" "$R_RC" "0"
  t_contains "...states in capitals that the EXPOSED secret is back in service and the rotation must be re-run" "$R_OUT" "THE OLD SECRET IS BACK IN SERVICE ON BOTH HOSTS, AND THAT SECRET IS THE EXPOSED ONE. THE ROTATION IS NOT DONE: RE-RUN"
  t_eq "...CP file, CP config, API env and the running Backend all hold the OLD secret again" "$(world)" "old"
  t_eq "...no event is lost or delivered twice" "$(events_ok)" "ok"
  invariants "$1 after rollback"
  t_eq "...nothing was deleted: the env copy exists when the Backend was touched, the .prev file exists when the CP was promoted, and the staged/prepared secrets are still there" "$(kept_ok)" "kept"
}
failed_in() { # <name> <phase>
  t_eq "$1: exit 1" "$R_RC" "1"
  t_contains "...names the phase" "$R_OUT" "FAILED in phase: $2"
  t_contains "...says whether anything live changed" "$R_OUT" "Live change so far:"
  t_contains "...and prints the exact next command" "$R_OUT" "--confirm-production --id"
}
kept_ok() { # a journalled change always leaves its backup behind
  local r=kept
  if grep -q 'phase=apply-begin' "$API/var/lib/aicc/webhook-rotation/$RID.state" 2>/dev/null; then [ -e "$API/etc/aicc/backend.env.pre-webhook-rotation-$RID" ] || r="env-copy-missing"; fi
  if grep -q 'phase=promote-begin' "$CP/var/lib/aicc/webhook-rotation/$RID.state" 2>/dev/null; then [ -e "$CP/etc/aicc/secrets/entitlement-webhook.secret.prev-$RID" ] || r="$r prev-missing"; fi
  [ -e "$API/etc/aicc/webhook-rotation/$RID/next.secret" ] || ! grep -q 'phase=staged' "$API/var/lib/aicc/webhook-rotation/$RID.state" 2>/dev/null || r="$r staged-missing"
  echo "$r"
}
newscn() { reset_world; flag_set window-events 2; flag_set fast-compare; RID=""; }
getrid() { RID="$(ID_NOW)"; }

echo "== C0. every host mutation is atomic: kill -9 at every stage (host tools, direct) =="
R1="20261117T190000Z"
for st in cp_after_journal cp_prepare_after_create cp_prepare_after_write cp_prepare_after_fsync cp_prepare_after_rename; do
  reset_world; KILL=$st killed cptool prepare --id "$R1" >/dev/null; rc=$?
  t_ok "prepare killed at $st: the process was really killed" test "$rc" != 0
  t_eq "...the LIVE secret is untouched (whole, old)" "$(cat "$CP/etc/aicc/secrets/entitlement-webhook.secret")" "$OLD"
  if [ "$st" = cp_prepare_after_rename ]; then t_ok "...the new secret file is COMPLETE" secret_whole "$CP/etc/aicc/secrets/entitlement-webhook.secret.next-$R1"; else t_ok "...no next file exists (never a partial one)" test ! -e "$CP/etc/aicc/secrets/entitlement-webhook.secret.next-$R1"; fi
  t_ok "...any stale temp file is mode 0400 or 0600" bash -c "for f in '$CP'/etc/aicc/secrets/.*.new.*; do [ -e \"\$f\" ] || continue; m=\$(stat -f '%Lp' \"\$f\" 2>/dev/null || stat -c '%a' \"\$f\"); [ \"\$m\" = 400 ] || [ \"\$m\" = 600 ] || exit 1; done"
  out="$(cptool prepare --id "$R1")"; rc=$?
  t_eq "...the next prepare succeeds" "$rc" "0"
  t_ok "...it swept the stale temp file and left a whole 0600 next file" bash -c "[ -z \"\$(ls -A '$CP/etc/aicc/secrets' | grep '\.new\.')\" ]"
  t_ok "...(whole)" secret_whole "$CP/etc/aicc/secrets/entitlement-webhook.secret.next-$R1"
done
for st in api_stage_after_create api_stage_after_write api_stage_after_fsync api_stage_after_rename; do
  reset_world; KILL=$st killed stage_new "$R1" >/dev/null; rc=$?
  t_ok "stage killed at $st: really killed" test "$rc" != 0
  if [ "$st" = api_stage_after_rename ]; then t_ok "...the staged file is COMPLETE" secret_whole "$API/etc/aicc/webhook-rotation/$R1/next.secret"; else t_ok "...no staged file (never a partial one)" test ! -e "$API/etc/aicc/webhook-rotation/$R1/next.secret"; fi
  t_eq "...backend.env untouched" "$(cmp -s "$TMP/backend.env.orig" "$API/etc/aicc/backend.env" && echo same)" "same"
  out="$(stage_new "$R1")"; t_ok "...a later stage succeeds, swept the temp and leaves one whole file" bash -c "secret_whole() { [ \"\$(wc -c < \"\$1\" | tr -d ' ')\" = 64 ]; }; secret_whole '$API/etc/aicc/webhook-rotation/$R1/next.secret' && [ -z \"\$(ls -A '$API/etc/aicc/webhook-rotation/$R1' | grep '\.new\.')\" ]"
done
for st in cp_prev_after_create cp_prev_after_write cp_prev_after_fsync cp_prev_after_rename cp_after_prev cp_after_rename cp_after_render cp_after_reload; do
  reset_world; cptool prepare --id "$R1" >/dev/null; KILL=$st killed cptool promote --id "$R1" --backend-already-restarted >/dev/null; rc=$?
  t_ok "promote killed at $st: really killed" test "$rc" != 0
  t_ok "...the live secret is whole: the old one or the new one, never a mix" bash -c "v=\$(cat '$CP/etc/aicc/secrets/entitlement-webhook.secret'); [ \"\$v\" = '$OLD' ] || [ \"\$v\" = '$NEW' ]"
  case "$st" in cp_prev_*|cp_after_prev) t_eq "...(before the rename the live secret is still the OLD one)" "$(cat "$CP/etc/aicc/secrets/entitlement-webhook.secret")" "$OLD" ;; *) t_eq "...(after the rename it is the NEW one)" "$(cat "$CP/etc/aicc/secrets/entitlement-webhook.secret")" "$NEW" ;; esac
  [ ! -e "$CP/etc/aicc/secrets/entitlement-webhook.secret.prev-$R1" ] || t_ok "...a .prev file is COMPLETE when it exists" secret_whole "$CP/etc/aicc/secrets/entitlement-webhook.secret.prev-$R1"
  out="$(cptool promote --id "$R1" --backend-already-restarted)"; rc=$?
  t_eq "...a re-run of promote completes (exit 0)" "$rc" "0"
  t_eq "...live, rendered config: NEW; .prev: OLD, whole, 0600" "$(cat "$CP/etc/aicc/secrets/entitlement-webhook.secret")/$(cp_cfg_fp)/$(cat "$CP/etc/aicc/secrets/entitlement-webhook.secret.prev-$R1")/$(mode "$CP/etc/aicc/secrets/entitlement-webhook.secret.prev-$R1")" "$NEW/$FPNEW/$OLD/600"
done
for st in api_backup_after_create api_backup_after_write api_backup_after_fsync api_backup_after_rename api_after_backup api_env_after_create api_env_after_write api_env_after_fsync api_env_after_rename api_after_env api_after_restart; do
  reset_world; stage_new "$R1" >/dev/null; KILL=$st killed apitool apply --id "$R1" >/dev/null; rc=$?
  t_ok "apply killed at $st: really killed" test "$rc" != 0
  t_ok "...backend.env is WHOLE: byte-identical to the original, or the original with only the secret line replaced; mode 640" bash -c "[ \"\$(stat -f '%Lp' '$API/etc/aicc/backend.env' 2>/dev/null || stat -c '%a' '$API/etc/aicc/backend.env')\" = 640 ] && [ \"\$(python3 -I '$FAKE/h.py' envmask '$API/etc/aicc/backend.env')\" = \"\$(python3 -I '$FAKE/h.py' envmask '$TMP/backend.env.orig')\" ]"
  [ ! -e "$API/etc/aicc/backend.env.pre-webhook-rotation-$R1" ] || t_ok "...the env copy, when it exists, is COMPLETE (the original bytes)" cmp "$TMP/backend.env.orig" "$API/etc/aicc/backend.env.pre-webhook-rotation-$R1"
  out="$(apitool apply --id "$R1")"; rc=$?
  t_eq "...a re-run of apply completes (exit 0)" "$rc" "0"
  t_eq "...the env holds the NEW secret and the RUNNING Backend loaded it" "$(api_env_fp)/$(be_fp)" "$FPNEW/$FPNEW"
  t_ok "...the env copy is the original, complete" cmp "$TMP/backend.env.orig" "$API/etc/aicc/backend.env.pre-webhook-rotation-$R1"
  t_eq "...no temp file is left" "$(find "$API" -name '.*.new.*' | wc -l | tr -d ' ')" "0"
done
# finalize on a finished rotation, killed at each stage
reset_world; flag_set window-events 2; rot run; getrid; t_eq "(setup) a rotation to finalize" "$R_RC" "0"
rm -rf "$TMP/cp.snap" "$TMP/api.snap"; cp -Rp "$CP" "$TMP/cp.snap"; cp -Rp "$API" "$TMP/api.snap"
for st in cp_registry_after_create cp_registry_after_write cp_registry_after_fsync cp_registry_after_rename cp_after_registry; do
  rm -rf "$CP"; cp -Rp "$TMP/cp.snap" "$CP"
  KILL=$st killed cptool finalize --id "$RID" >/dev/null; rc=$?
  t_ok "CP finalize killed at $st: really killed" test "$rc" != 0
  t_ok "...the registry is absent or WHOLE (0 or 1 line, never partial)" bash -c "f='$CP/etc/aicc/webhook-secret-retired.fp'; [ ! -e \"\$f\" ] || [ \"\$(wc -l < \"\$f\" | tr -d ' ')\" = 1 ]"
  t_ok "...nothing was deleted (the previous secret is still in .prev or .retired)" bash -c "[ -e '$CP/etc/aicc/secrets/entitlement-webhook.secret.prev-$RID' ] || [ -e '$CP/etc/aicc/secrets/entitlement-webhook.secret.retired-$RID' ]"
  out="$(cptool finalize --id "$RID")"; rc=$?
  t_eq "...a re-run completes: exit 0, exactly ONE registry line, .prev renamed to .retired" "$rc/$(wc -l < "$CP/etc/aicc/webhook-secret-retired.fp" | tr -d ' ')/$([ -e "$CP/etc/aicc/secrets/entitlement-webhook.secret.retired-$RID" ] && [ ! -e "$CP/etc/aicc/secrets/entitlement-webhook.secret.prev-$RID" ] && echo renamed)" "0/1/renamed"
done
for st in api_registry_after_create api_registry_after_write api_registry_after_fsync api_registry_after_rename api_after_registry; do
  rm -rf "$API"; cp -Rp "$TMP/api.snap" "$API"
  KILL=$st killed apitool finalize --id "$RID" >/dev/null; rc=$?
  t_ok "API finalize killed at $st: really killed" test "$rc" != 0
  t_ok "...the registry is absent or WHOLE; the env copy is kept" bash -c "f='$API/etc/aicc/webhook-secret-retired.fp'; { [ ! -e \"\$f\" ] || [ \"\$(wc -l < \"\$f\" | tr -d ' ')\" = 1 ]; } && [ -e '$API/etc/aicc/backend.env.pre-webhook-rotation-$RID' ]"
  out="$(apitool finalize --id "$RID")"; rc=$?
  t_eq "...a re-run completes with exactly ONE registry line" "$rc/$(wc -l < "$API/etc/aicc/webhook-secret-retired.fp" | tr -d ' ')" "0/1"
done
rm -rf "$CP" "$API"; cp -Rp "$TMP/cp.snap" "$CP"; cp -Rp "$TMP/api.snap" "$API"

echo "== C1. the host tools on their own: refusals and idempotency =="
reset_world
t_contains "CP: prepare without --id is REFUSED" "$(cptool prepare 2>&1 || true)" "--id must look like"
t_contains "CP: a malformed id is REFUSED" "$(cptool prepare --id 2026 2>&1 || true)" "--id must look like"
t_contains "CP: a mutating mode without --expect-stage-id is REFUSED" "$(env "PATH=$TMP/cpbin:$BASEPATH" AICC_TEST_HARNESS=1 "AICC_ROOT_PREFIX=$CP" python3 -I "$CPTOOL" prepare --id "$R1" 2>&1 || true)" "--expect-stage-id is required"
t_contains "CP: a WRONG stage id is REFUSED (wrong machine)" "$(env "PATH=$TMP/cpbin:$BASEPATH" AICC_TEST_HARNESS=1 "AICC_ROOT_PREFIX=$CP" python3 -I "$CPTOOL" prepare --id "$R1" --expect-stage-id 00000000000000000000000000000000 2>&1 || true)" "differs from --expect-stage-id"
t_ok "...nothing was written by those refusals" bash -c "[ ! -e '$CP/var/lib/aicc/webhook-rotation' ] && [ -z \"\$(ls '$CP/etc/aicc/secrets' | grep next)\" ]"
t_contains "CP: promote without --backend-already-restarted is REFUSED (the Backend must hold the new secret first)" "$(cptool promote --id "$R1" 2>&1 || true)" "--backend-already-restarted"
t_contains "CP: promote of an unknown id is REFUSED" "$(cptool promote --id "$R1" --backend-already-restarted 2>&1 || true)" "no rotation with id"
t_contains "CP: finalize before promote is REFUSED" "$(cptool prepare --id "$R1" >/dev/null; cptool finalize --id "$R1" 2>&1 || true)" "not promoted"
O1="$(cptool prepare --id "$R1")"; t_contains "CP: a second prepare is an idempotent no-op that keeps the SAME secret" "$O1" "already prepared: id=$R1 next_fp=$FPNEW"
t_eq "CP: fingerprint --which next prints exactly 16 hex" "$(cptool fingerprint --which next --id "$R1")" "$FPNEW"
t_eq "CP: fingerprint --which live" "$(cptool fingerprint --which live)" "$FPOLD"
t_eq "CP: fingerprint --which config" "$(cptool fingerprint --which config)" "$FPOLD"
t_not_contains "CP: status never shows a secret" "$(cptool status --id "$R1")" "$OLD"
t_not_contains "...(the prepared one either)" "$(cptool status --id "$R1")" "$NEW"
t_contains "CP: a different id while this one is unfinished is REFUSED" "$(cptool prepare --id 20261117T190100Z 2>&1 || true)" "an earlier rotation is unfinished: id=$R1"
chmod 644 "$CP/etc/aicc/secrets/entitlement-webhook.secret"; t_contains "CP: a live secret file with mode 0644 is REFUSED by preflight" "$(cptool preflight 2>&1 || true)" "mode is 0644, expected 0600"
chmod 600 "$CP/etc/aicc/secrets/entitlement-webhook.secret"
t_contains "CP: emit-next on a pipe works and prints exactly the new secret and a newline" "$(cptool_raw emit-next --id "$R1" | head -c 64 | sed 's/./X/g')" "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
t_eq "...(64 hex + newline = 65 bytes, nothing else)" "$(cptool_raw emit-next --id "$R1" | wc -c | tr -d ' ')" "65"
t_contains "CP: emit-next for an id that was never prepared is REFUSED" "$(cptool emit-next --id 20261117T190200Z 2>&1 | head -c 300 || true)" "no prepared secret"
# a terminal as stdout / stdin
TTYC="$(jq -nc --arg py "$(command -v python3)" --arg tool "$CPTOOL" --arg pfx "$CP" --arg path "$TMP/cpbin:$BASEPATH" --arg id "$R1" --arg sid "$STAGEID" --arg out "$DRV/tty1.json" --arg tmp "$TMP" \
  '{argv:[$py,"-I",$tool,"emit-next","--id",$id,"--expect-stage-id",$sid], env:{PATH:$path, AICC_TEST_HARNESS:"1", AICC_ROOT_PREFIX:$pfx, TMPDIR:$tmp}, cwd:$tmp, steps:[], secrets:[], timeout:30, out:$out}')"
printf '%s' "$TTYC" > "$DRV/tty1.cfg"; python3 -I "$HERE/lib/pty_drive.py" "$DRV/tty1.cfg"
t_contains "CP: emit-next with stdout on a TERMINAL is REFUSED" "$(jq -r .output "$DRV/tty1.json")" "stdout is a terminal"
t_not_contains "...the terminal never showed the secret" "$(jq -r .output "$DRV/tty1.json")" "$NEW"
STG="$(jq -nc --arg py "$(command -v python3)" --arg tool "$APITOOL" --arg pfx "$API" --arg path "$TMP/apibin:$BASEPATH" --arg id "$R1" --arg h "$APIHOST" --arg out "$DRV/tty2.json" --arg tmp "$TMP" --arg url "$BURL" \
  '{argv:[$py,"-I",$tool,"stage","--id",$id,"--expect-hostname",$h], env:{PATH:$path, AICC_TEST_HARNESS:"1", AICC_ROOT_PREFIX:$pfx, AICC_TEST_HOSTNAME:$h, AICC_TEST_BACKEND_URL:$url, TMPDIR:$tmp}, cwd:$tmp, steps:[], secrets:[], timeout:30, out:$out}')"
printf '%s' "$STG" > "$DRV/tty2.cfg"; python3 -I "$HERE/lib/pty_drive.py" "$DRV/tty2.cfg"
t_contains "API: stage with stdin on a TERMINAL is REFUSED (the secret is never typed)" "$(jq -r .output "$DRV/tty2.json")" "stdin is a terminal"
for bad in "" "short" "$(printf 'A%.0s' $(seq 64))" "${NEW:0:63}" "${NEW}0" "$NEW"$'\n'"$NEW" "$(printf '0%.0s' $(seq 64))" "xyz$(printf 'a%.0s' $(seq 61))"; do
  o="$(printf '%s\n' "$bad" | apitool stage --id "$R1" 2>&1)"; rc=$?
  [ "$rc" = 1 ] && [ ! -e "$API/etc/aicc/webhook-rotation/$R1/next.secret" ] && t_pass "API: stage refuses the input '$(printf '%s' "$bad" | head -c 12 | tr '\n' '|')...' and writes nothing" || t_bad "API: stage input refusal for '${bad:0:12}'" "rc=$rc $o"
  case "$o" in *"$bad"*) [ -z "$bad" ] || t_bad "API: a refusal echoed the offending input" ;; esac
done
t_contains "API: stage with 71 bytes is refused" "$(printf '%s\n' "$(printf 'a%.0s' $(seq 80))" | apitool stage --id "$R1" 2>&1 || true)" "more than 70 bytes"
o="$(stage_new "$R1")"; t_contains "API: stage of a valid secret prints only its fingerprint" "$o" "staged: id=$R1 fp=$FPNEW"
t_not_contains "...never the secret" "$o" "$NEW"
t_contains "API: a second stage of the SAME secret is an idempotent no-op" "$(stage_new "$R1")" "already staged"
t_contains "API: a DIFFERENT secret for the same id is REFUSED (a staged secret is immutable)" "$(printf '%s\n' "$OLD" | apitool stage --id "$R1" 2>&1 || true)" "a DIFFERENT secret is already staged"
t_contains "API: the wrong host name is REFUSED" "$(env "PATH=$TMP/apibin:$BASEPATH" AICC_TEST_HARNESS=1 "AICC_ROOT_PREFIX=$API" AICC_TEST_HOSTNAME=elsewhere python3 -I "$APITOOL" preflight --expect-hostname "$APIHOST" 2>&1 || true)" "not \`$APIHOST\`"
t_contains "API: a mutating mode without --expect-hostname is REFUSED" "$(env "PATH=$TMP/apibin:$BASEPATH" AICC_TEST_HARNESS=1 "AICC_ROOT_PREFIX=$API" AICC_TEST_HOSTNAME="$APIHOST" python3 -I "$APITOOL" apply --id "$R1" 2>&1 || true)" "--expect-hostname is required"
t_contains "API: apply of an id with no staged secret is REFUSED" "$(apitool apply --id 20261117T190300Z 2>&1 || true)" "no staged secret"
t_eq "API: fingerprint --which staged / env" "$(apitool fingerprint --which staged --id "$R1")/$(apitool fingerprint --which env)" "$FPNEW/$FPOLD"
t_eq "...and backend.env is still the original" "$(cmp -s "$TMP/backend.env.orig" "$API/etc/aicc/backend.env" && echo same)" "same"
# the env shape refusals (read-only plan)
envcase() { # <name> <expected text> <command that damages the env>
  reset_world; eval "$3"; rot plan
  t_eq "env shape: $1 -> plan REFUSES (exit 1)" "$R_RC" "1"
  t_contains "...naming the problem" "$R_OUT" "$2"
  t_eq "...nothing was changed (the Backend was not restarted)" "$(be_restarts)" "0"
}
envcase "no ENTITLEMENT_WEBHOOK_SECRET line" "found 0 mention(s)" "grep -v '^ENTITLEMENT_WEBHOOK_SECRET=' '$TMP/backend.env.orig' > '$API/etc/aicc/backend.env'; chmod 640 '$API/etc/aicc/backend.env'"
envcase "two secret lines" "found 2 mention(s)" "printf 'ENTITLEMENT_WEBHOOK_SECRET=%s\n' '$OLD' >> '$API/etc/aicc/backend.env'"
envcase "a commented mention is ambiguous too" "found 2 mention(s)" "printf '#ENTITLEMENT_WEBHOOK_SECRET=old\n' >> '$API/etc/aicc/backend.env'"
envcase "mode 0644" "mode is 0644, expected 0640" "chmod 644 '$API/etc/aicc/backend.env'"
envcase "CRLF line endings" "carriage return" "sed 's/\$/\r/' '$TMP/backend.env.orig' > '$API/etc/aicc/backend.env'"
envcase "a value that is not 64 hex" "not 64 lowercase hex" "sed 's/^ENTITLEMENT_WEBHOOK_SECRET=.*/ENTITLEMENT_WEBHOOK_SECRET=short/' '$TMP/backend.env.orig' > '$API/etc/aicc/backend.env'"
envcase "an unit that does not read the env file" "does not read --env-file" "touch '$FLAGS/unit-no-envfile'"
envcase "entitlement_mode not enforced" "entitlement_mode is shadow, expected enforced" "echo shadow > '$FLAGS/mode'"
envcase "the bystander container is unhealthy" "the bystander container nourishvik-care is not healthy" "echo 'exited|none|2026-11-17T01:02:03Z' > '$API/docker/nourishvik-care'"
envcase "the bystander container does not exist" "the bystander container nourishvik-care is not healthy (state=unknown" "rm -f '$API/docker/nourishvik-care'"
envcase "a Backend that is down" "/health is not the expected Backend" "touch '$FLAGS/down'"
envcase "the live CP secret is already retired" "RETIRED_SECRET_IN_USE" "printf '%s %s %s\n' '$FPOLD' 2026-01-01T00:00:00Z 20260101T000000Z > '$CP/etc/aicc/webhook-secret-retired.fp'; chmod 600 '$CP/etc/aicc/webhook-secret-retired.fp'"
envcase "the outbox already has an exhausted event" "already has 1 exhausted" "FAKE_OUTBOX='$TMP/outbox.json' FAKE_CP_CONFIG='$CP/srv/aicc/shared/wp-config.php' FAKE_BACKEND_URL='$BURL' FAKE_FLAGS='$FLAGS' python3 '$FAKE/dispatcher.py' enqueue 1 exhaust; python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); d[\"events\"][-1][\"exhausted\"]=True; json.dump(d,open(sys.argv[1],\"w\"))' '$TMP/outbox.json'"
envcase "the outbox cannot be read" "the outbox health could not be read" "touch '$FLAGS/aicc-wp-down'"
envcase "the rendered wp-config differs from the live file" "CONFIG_MISMATCH" "sed -i.bak \"s/'$OLD'/'$NEW'/\" '$CP/srv/aicc/shared/wp-config.php'; rm -f '$CP/srv/aicc/shared/wp-config.php.bak'"
envcase "a render would change another constant" "a render would change the wp-config BEFORE the secret changes" "printf 'AICC_MAIL_PROVIDER=brevo_api\n' > '$CP/etc/aicc/owner-facts.env'; chmod 600 '$CP/etc/aicc/owner-facts.env'"
envcase "the CP identity is staging" "does not say AICC_ENV=production" "printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\nAICC_STAGE_ID=$STAGEID\n' > '$CP/etc/aicc-stage-identity'"

echo "== C2. partial failures at the orchestrator level: every one is followed by resume or rollback =="
# 1 killed right after the new secret was prepared on the CP (the journal line was not written yet)
newscn; AICC_TEST_KILL_AT=cp_prepare_after_rename rot run; getrid
failed_in "CP killed after prepare" prepare
t_contains "...nothing live changed" "$R_OUT" "Live change so far: nothing live has changed"
t_eq "...the world is old (the live secret never changed)" "$(world)" "old"
invariants "after the kill at prepare"
recover_resume "after the kill at prepare"
# 2 killed while the secret was being staged on the API host
newscn; AICC_TEST_KILL_AT=api_stage_after_write rot run; getrid
failed_in "API killed mid-stage" stage
t_eq "...the world is old and the staged file is absent (never partial)" "$(world)/$([ -e "$API/etc/aicc/webhook-rotation/$RID/next.secret" ] && echo staged || echo none)" "old/none"
recover_resume "after the kill mid-stage"
# 3 killed after the env file was replaced, before the restart: the Backend still runs the OLD secret
newscn; AICC_TEST_KILL_AT=api_after_env rot run; getrid
failed_in "API killed after the env replace" apply
t_contains "...says the state is UNKNOWN (the env file may already hold the new secret)" "$R_OUT" "UNKNOWN: the connection to the API host or the tool itself died"
t_eq "...env: NEW, running Backend: OLD, CP: OLD (the tool must not call this consistent)" "$(world)" "mixed(cp=$(printf OLD) cfg=OLD env=NEW backend=OLD)"
invariants "after the kill before the restart"
recover_resume "after the kill before the restart"
# 4 killed after the restart (the Backend already runs the new secret, the CP does not)
newscn; AICC_TEST_KILL_AT=api_after_restart rot run; getrid
failed_in "API killed after the restart" apply
t_eq "...env NEW and Backend NEW, CP OLD: the window is OPEN (CP deliveries get 401 and wait)" "$(world)" "mixed(cp=OLD cfg=OLD env=NEW backend=NEW)"
t_eq "...a CP delivery in the window was answered 401 and stays PENDING (not lost, not exhausted)" "$(outbox)" "4/0"
recover_resume "after the kill after the restart"
# 5 the Backend health fails after the restart: AUTOMATIC restore, loud failure
newscn; flag_set backend-broken-new; rot run; getrid
failed_in "Backend unhealthy with the new secret" apply
t_contains "...the tool says it restored the env copy" "$R_OUT" "APPLY FAILED AND RESTORED: the Backend runs the PREVIOUS secret again"
t_contains "...and that the Control Plane was not touched" "$R_OUT" "The Control Plane was not touched"
t_eq "...ALL hosts hold the OLD secret again and the Backend is healthy" "$(world)/$(curl -s "$BURL/health" | jq -r .status)" "old/ok"
t_eq "...the Backend was restarted twice (apply, then the automatic restore)" "$(be_restarts)" "2"
t_ok "...backend.env is byte-identical to the original again, mode 640" cmp "$TMP/backend.env.orig" "$API/etc/aicc/backend.env"
t_eq "...the CP was never touched: no .prev, no promote line" "$(find "$CP/etc/aicc/secrets" -name '*prev-*' | wc -l | tr -d ' ')/$(grep -c 'promote' "$CP/var/lib/aicc/webhook-rotation/$RID.state")" "0/0"
invariants "after the automatic restore"
rm -f "$FLAGS/backend-broken-new"; recover_resume "after the Backend problem is fixed"
# 6 systemctl restart fails once: automatic restore (its restart succeeds)
newscn; flag_set restart-fail 1; rot run; getrid
failed_in "restart fails once" apply
t_contains "...restored" "$R_OUT" "APPLY FAILED AND RESTORED"
t_eq "...all old" "$(world)" "old"
recover_resume "after the restart problem is fixed"
# 7 the restart fails TWICE: the automatic restore cannot restart either -> CRITICAL, then rollback
newscn; flag_set restart-fail 2; rot run; getrid
failed_in "restart fails twice" apply
t_contains "...CRITICAL: the automatic restore FAILED" "$R_OUT" "CRITICAL: THE AUTOMATIC RESTORE FAILED"
t_contains "...and the state is called UNKNOWN with the manual command" "$R_OUT" "STATE UNKNOWN: the complete env copy is /etc/aicc/backend.env.pre-webhook-rotation-$RID"
t_contains "...the orchestrator carries it into its summary" "$R_OUT" "UNKNOWN: the automatic restore of the Backend FAILED"
recover_rollback "after the double restart failure"
# 8 the CP is killed between preserving the old secret and the rename
newscn; AICC_TEST_KILL_AT=cp_after_prev rot run; getrid
failed_in "CP killed after .prev" promote
t_eq "...the Backend holds NEW, the CP is still OLD (file and config)" "$(world)" "mixed(cp=OLD cfg=OLD env=NEW backend=NEW)"
recover_resume "after the kill after .prev"
# 9 killed between the rename and the render: the CP file is NEW, the rendered config still OLD
newscn; AICC_TEST_KILL_AT=cp_after_rename rot run; getrid
VERIFY_AFTER=1
failed_in "CP killed after the rename" promote
t_eq "...CP file NEW, rendered config OLD (the dangerous half state), Backend NEW" "$(world)" "mixed(cp=NEW cfg=OLD env=NEW backend=NEW)"
rot status --id "$RID"; t_eq "...status reports the CONFIG_MISMATCH loudly (exit 1)" "$R_RC" "1"; t_contains "...naming it" "$R_OUT" "CONFIG_MISMATCH"
recover_resume "after the kill after the rename"
VERIFY_AFTER=0
newscn; AICC_TEST_KILL_AT=cp_after_rename rot run; getrid
recover_rollback "after the kill after the rename (rolled back instead)"
# 10 killed after the render, before the reload; and after the reload
newscn; AICC_TEST_KILL_AT=cp_after_render rot run; getrid; failed_in "CP killed after the render" promote
recover_resume "after the kill after the render"
newscn; AICC_TEST_KILL_AT=cp_after_reload rot run; getrid; failed_in "CP killed after the reload" promote
recover_resume "after the kill after the reload"
# 11 the render fails once (mid promote): automatic restore of the CP, the Backend stays NEW
newscn; flag_set fail-render 1; rot run; getrid
failed_in "render fails once" promote
t_contains "...PROMOTE FAILED AND RESTORED" "$R_OUT" "PROMOTE FAILED AND RESTORED: the Control Plane holds the PREVIOUS secret again"
t_contains "...honest about the open window" "$R_OUT" "nothing delivers until the Control Plane is promoted again"
t_eq "...CP back on OLD (file and config), Backend NEW" "$(world)" "mixed(cp=OLD cfg=OLD env=NEW backend=NEW)"
t_ok "...the new secret was kept as .next-ID (nothing was lost)" secret_whole "$CP/etc/aicc/secrets/entitlement-webhook.secret.next-$RID"
invariants "after the automatic CP restore"
recover_resume "after the render problem is fixed"
# 12 the render fails twice: the restore cannot render either -> CRITICAL; the files are still consistent (old); rollback
newscn; flag_set fail-render 2; rot run; getrid
failed_in "render fails twice" promote
t_contains "...CRITICAL: the automatic restore FAILED" "$R_OUT" "CRITICAL: the automatic restore FAILED"
t_contains "...STATE UNKNOWN with the .prev path" "$R_OUT" "STATE UNKNOWN: the live secret file is the PREVIOUS one if the restore wrote it"
recover_rollback "after the render failed twice"
# 13 the reload fails twice (the retry fails too): automatic restore
newscn; flag_set fail-reload 2; rot run; getrid
failed_in "reload fails twice" promote
t_contains "...names the reload" "$R_OUT" "the php-fpm reload failed twice"
t_eq "...restored: CP OLD, Backend NEW" "$(world)" "mixed(cp=OLD cfg=OLD env=NEW backend=NEW)"
recover_resume "after the reload problem is fixed"
# 14 the reload fails once: the retry succeeds, the promote completes by itself
newscn; flag_set fail-reload 1; rot run; getrid
t_eq "a reload that fails once is retried: run exits 0 and the world is NEW" "$R_RC/$(world)" "0/new"
t_ok "...php-fpm was reloaded twice in the promote (one failure, one retry)" bash -c "[ \"\$(grep -c 'reload php8.3-fpm' '$LOGS/cp-systemctl.log')\" = 2 ]"
# 15 the Backend still accepts the OLD secret after the cutover: the probes fail
newscn; flag_set also-accept-old; rot run; getrid
failed_in "the old secret is still accepted" probes
t_contains "...THE BACKEND STILL ACCEPTS THE PREVIOUS (EXPOSED) SECRET" "$R_OUT" "THE BACKEND STILL ACCEPTS THE PREVIOUS (EXPOSED) SECRET"
t_contains "...the live change is reported (both hosts run the NEW secret, not verified)" "$R_OUT" "both hosts now run the NEW secret (not yet verified, not yet finalized)"
rot finalize --id "$RID"; t_eq "...finalize REFUSES to retire anything while a probe fails" "$R_RC" "1"
t_ok "...no registry was written" bash -c "[ ! -e '$CP/etc/aicc/webhook-secret-retired.fp' ] && [ ! -e '$API/etc/aicc/webhook-secret-retired.fp' ]"
recover_rollback "after the probe failure"
rm -f "$FLAGS/also-accept-old"
# 16 the drain does not complete in time (events held in backoff): not lost, resume waits again
newscn; flag_set window-mode held; rot run; getrid
failed_in "drain timeout" drain
t_contains "...says the events are NOT lost" "$R_OUT" "events are NOT lost: the outbox is durable"
t_eq "...the cutover itself is verified: all NEW" "$(world)" "new"
t_eq "...pending is above the baseline (2 baseline + 2 held in the window)" "$(outbox)" "4/0"
release_held; recover_resume "after the held events were released"
# 17 events exhausted in the window: the rotation is NOT declared done
newscn; flag_set window-mode exhaust; rot run; getrid
failed_in "exhausted events" drain
t_contains "...EXHAUSTED EVENTS are reported and not deleted" "$R_OUT" "EXHAUSTED EVENTS: 2. They are not deleted"
rot resume --id "$RID"; t_eq "...resume refuses to go on while events are exhausted (preflight)" "$R_RC" "1"
t_contains "...naming them" "$R_OUT" "already has 2 exhausted event(s)"
rot finalize --id "$RID"; t_eq "...finalize still works only on explicit decision (the tool does not forbid it) but the rotation printed no READY" "$(printf '%s' "$R_OUT" | grep -c 'READY TO FINALIZE')" "0"
newscn; flag_set window-mode exhaust; rot run; getrid; rot rollback --id "$RID"; t_eq "...rollback works with exhausted events present" "$R_RC" "0"
# 18 the bystander is restarted by something else during the run
newscn; flag_set bystander-restart; rot run; getrid
failed_in "the bystander's StartedAt changed" observe
t_contains "...BYSTANDER CHANGED is reported with both StartedAt values" "$R_OUT" "BYSTANDER CHANGED: StartedAt was 2026-11-17T01:02:03.123456789Z, now 2026-11-17T19:30:00.000000000Z"
t_contains "...and that this tool never touches it" "$R_OUT" "This tool never touches it (read-only docker inspect)"
t_eq "...the rotation itself is complete and verified: NEW" "$(world)" "new"
t_not_contains "...no READY TO FINALIZE was printed" "$R_OUT" "READY TO FINALIZE"
# 19 --no-wait-drain
newscn; flag_set window-mode held; rot run --no-wait-drain; getrid
t_eq "--no-wait-drain: run exits 0 even though pending is above the baseline" "$R_RC/$(world)" "0/new"
t_contains "...and says plainly that the drain was NOT checked" "$R_OUT" "--no-wait-drain: the drain was NOT checked"
# 20 rollback of a rotation that only got as far as prepare
newscn; AICC_TEST_KILL_AT=cp_prepare_after_rename rot run; getrid; rot rollback --id "$RID"
t_eq "rollback of a rotation that was only prepared: exit 0" "$R_RC" "0"
t_eq "...the live secret never changed and the prepared secret is KEPT (never deleted)" "$(world)/$([ -e "$CP/etc/aicc/secrets/entitlement-webhook.secret.next-$RID" ] && echo kept)" "old/kept"
rot rollback --id "$RID"; t_eq "...a second rollback is an idempotent no-op" "$R_RC" "0"
rot resume --id "$RID"; t_eq "...resume of a rolled-back id is refused" "$R_RC" "1"
# 21 rollback after a COMPLETE (not finalized) rotation, verify after it, then a fresh rotation
newscn; rot run; getrid; recover_rollback "after a complete rotation (not finalized)"
rot verify; t_eq "verify after the rollback FAILS (the exposed secret is in service)" "$R_RC" "1"
t_contains "...ROLLED_BACK_EXPOSED_SECRET_IN_SERVICE" "$R_OUT" "ROLLED_BACK_EXPOSED_SECRET_IN_SERVICE"
rot rollback --id "$RID"; t_contains "a second rollback says already rolled back and changes nothing" "$R_OUT" "already rolled back"
sleep 1; rot run; t_eq "a new rotation after a rollback is allowed and succeeds" "$R_RC/$(world)" "0/new"
RID2="$(ID_NOW)"; t_ok "...with a NEW id" test -n "$RID2" -a "$RID2" != "$RID"
# 22 concurrency: a second run is refused by the host locks
newscn; mkdir -p "$CP/var/lib/aicc/webhook-rotation"; python3 -I "$FAKE/h.py" lock "$CP/var/lib/aicc/webhook-rotation/.lock" > "$TMP/lock1.out" 2>&1 &
LK1=$!; for i in $(seq 1 50); do grep -q locked "$TMP/lock1.out" 2>/dev/null && break; sleep 0.1; done
rot run; getrid
failed_in "a second run while the CP lock is held" prepare
t_contains "...REFUSED by the Control Plane lock" "$R_OUT" "another aicc-rotate-webhook-secret is running"
t_eq "...nothing changed (OLD everywhere, Backend never restarted)" "$(world)/$(be_restarts)" "old/0"
kill "$LK1" 2>/dev/null; wait "$LK1" 2>/dev/null
newscn; mkdir -p "$API/var/lib/aicc/webhook-rotation"; python3 -I "$FAKE/h.py" lock "$API/var/lib/aicc/webhook-rotation/.lock" > "$TMP/lock2.out" 2>&1 &
LK2=$!; for i in $(seq 1 50); do grep -q locked "$TMP/lock2.out" 2>/dev/null && break; sleep 0.1; done
rot run; getrid
t_eq "a second run while the API lock is held: exit 1" "$R_RC" "1"
t_contains "...REFUSED by the API host lock" "$R_OUT" "another aicc-rotate-webhook-secret-api is running"
t_eq "...nothing changed on either host's secrets" "$(world)/$(be_restarts)" "old/0"
kill "$LK2" 2>/dev/null; wait "$LK2" 2>/dev/null
rot status; t_eq "(status is read-only and not blocked by a lock)" "$R_RC" "0"
# 23 the staged secret on the API host is lost / different: the orchestrator does not guess
newscn; AICC_TEST_KILL_AT=api_after_env rot run; getrid
printf '%s\n' "$OLD" | python3 -I -c 'import sys,os; p=sys.argv[1]; os.chmod(p,0o600); open(p,"w").write(sys.stdin.read().strip())' "$API/etc/aicc/webhook-rotation/$RID/next.secret"
rot resume --id "$RID"
t_eq "a staged secret that does not match the CP's prepared one: resume REFUSES (exit 1)" "$R_RC" "1"
t_contains "...naming the DIFFERENT staged secret" "$R_OUT" "the API host has a DIFFERENT staged secret for this id"

echo "== D. the gates =="
newscn; SNAPD="$(HP snap "$CP" "$API" | shasum -a 256)"
SNAPGOOD="$(HP snap "$CP" "$API" | shasum -a 256)"; cp "$CP/etc/aicc-stage-identity" "$TMP/ident.good"
printf 'AICC_ENV=production\nAICC_HOSTNAME=www.copilt.org\nAICC_STAGE_ID=00000000000000000000000000000000\n' > "$CP/etc/aicc-stage-identity"; SNAPD="$(HP snap "$CP" "$API" | shasum -a 256)"
rot run; t_eq "a CP with the WRONG stage id: run REFUSED (exit 1)" "$R_RC" "1"; t_contains "...naming the identity" "$R_OUT" "differs from the expected production id (wrong machine"
t_eq "...EVERY file of both hosts is unchanged (refused before any change)" "$(HP snap "$CP" "$API" | shasum -a 256)" "$SNAPD"
printf 'AICC_ENV=production\nAICC_HOSTNAME=stage.copilt.org\nAICC_STAGE_ID=%s\n' "$STAGEID" > "$CP/etc/aicc-stage-identity"; rot run; t_contains "a CP with the wrong host name is REFUSED" "$R_OUT" "identity hostname is not www.copilt.org"
cp "$TMP/ident.good" "$CP/etc/aicc-stage-identity"
rot run --api-hostname other.copilt.org; t_eq "an API host with another name: REFUSED" "$R_RC" "1"; t_contains "...naming the expected and the real name" "$R_OUT" "the API host says its name is 'api.copilt.org', expected 'other.copilt.org'"
flag_set unit-inactive; rot run; t_contains "an API host without an active aicc-backend unit is REFUSED" "$R_OUT" "no active aicc-backend unit"; rm -f "$FLAGS/unit-inactive"
flag_set down; rot run; t_contains "an API host whose /health is not the Backend is REFUSED" "$R_OUT" "/health is not the expected Backend"; rm -f "$FLAGS/down"
touch "$FLAGS/ssh-down-cp"; rot run; t_eq "an unreachable CP: REFUSED before any change" "$R_RC" "1"; t_contains "...says nothing was changed" "$R_OUT" "nothing was changed"; rm -f "$FLAGS/ssh-down-cp"
touch "$FLAGS/ssh-down-api"; rot run; t_eq "an unreachable API host: REFUSED before any change" "$R_RC" "1"; rm -f "$FLAGS/ssh-down-api"
t_eq "...(after all those refusals both hosts are still byte-identical to the start)" "$(HP snap "$CP" "$API" | shasum -a 256)" "$SNAPGOOD"
t_eq "...and the Backend was never restarted" "$(be_restarts)" "0"
rot status --confirm-production; rm -f "$HOMED/.ssh/known_hosts_aicc_prod.bak"
# local gates
mv "$HOMED/.ssh/aicc_digitalocean_prod" "$TMP/apikey"; rot plan; t_contains "a missing API operator key is REFUSED" "$R_OUT" "the operator key"; chmod 644 "$TMP/apikey"; cp "$TMP/apikey" "$HOMED/.ssh/aicc_digitalocean_prod"; rot plan; t_contains "an API key with mode 0644 is REFUSED" "$R_OUT" "must be mode 0600"; chmod 600 "$HOMED/.ssh/aicc_digitalocean_prod"
cp "$HOMED/.ssh/known_hosts_aicc_prod" "$TMP/kh"; printf '157.230.110.211 %s\n' "$(cut -d' ' -f1,2 "$TMP/hostkey.pub")" > "$HOMED/.ssh/known_hosts_aicc_prod"; rot plan; t_contains "a pinned file with no entry for the API address is REFUSED" "$R_OUT" "has no entry for 139.59.157.231"; cp "$TMP/kh" "$HOMED/.ssh/known_hosts_aicc_prod"
rm -f "$HOMED/.ssh/known_hosts_aicc_prod"; rot plan; t_contains "a missing pinned host-key file is REFUSED (no trust on first use)" "$R_OUT" "no trust on first use"; cp "$TMP/kh" "$HOMED/.ssh/known_hosts_aicc_prod"
# arguments
rot run --confirm-production --nonsense; t_contains "an unknown option is refused" "$R_OUT" "unknown argument"
t_contains "a missing --confirm-production is REFUSED before anything" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" bash "$ROT" plan 2>&1 </dev/null || true)" "every subcommand needs --confirm-production"
t_contains "--ignore-window exists only for the test harness" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" bash "$ROT" plan --confirm-production --ignore-window 2>&1 </dev/null || true)" "exists only for the test harness"
t_contains "--cp-ip (any other address) exists only for the test harness" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" bash "$ROT" plan --confirm-production --cp-ip 203.0.113.9 2>&1 </dev/null || true)" "exists only for the test harness"
t_contains "--backend-url exists only for the test harness" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" bash "$ROT" plan --confirm-production --backend-url http://127.0.0.1:9 2>&1 </dev/null || true)" "exists only for the test harness"
t_contains "--cp-stage-id exists only for the test harness" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" bash "$ROT" plan --confirm-production --cp-stage-id 00000000000000000000000000000000 2>&1 </dev/null || true)" "exists only for the test harness"
t_contains "an unknown subcommand is refused" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" bash "$ROT" explode 2>&1 </dev/null || true)" "unknown subcommand"
t_contains "the fake-ssh seam outside the temp dir is REFUSED" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" AICC_TEST_HARNESS=1 AICC_TEST_SSH=/usr/bin/ssh bash "$ROT" plan --confirm-production 2>&1 </dev/null || true)" "under the system temp dir"
t_contains "the seam without a fake ssh is REFUSED" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" AICC_TEST_HARNESS=1 bash "$ROT" plan --confirm-production 2>&1 </dev/null || true)" "AICC_TEST_SSH"
t_contains "bash -x is REFUSED" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" bash -x "$ROT" plan --confirm-production 2>&1 </dev/null | grep -v '^+' || true)" "shell tracing"
t_contains "BASH_XTRACEFD is REFUSED" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" BASH_XTRACEFD=2 bash "$ROT" plan --confirm-production 2>&1 </dev/null || true)" "BASH_XTRACEFD"
t_contains "SHELLOPTS=xtrace is REFUSED" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" SHELLOPTS=xtrace bash "$ROT" plan --confirm-production 2>&1 </dev/null | grep -v '^+' || true)" "shell tracing"
t_contains "a customised PS4 is REFUSED" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" 'PS4=$(touch /tmp/ap38r-ps4-pwned)' bash "$ROT" plan --confirm-production 2>&1 </dev/null || true)" "PS4 is customised"
t_ok "...and it did not run" test ! -e /tmp/ap38r-ps4-pwned
t_contains "BASH_ENV is REFUSED" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" "BASH_ENV=$TMP/none" bash "$ROT" plan --confirm-production 2>&1 </dev/null || true)" "BASH_ENV"
t_contains "a malformed --api-hostname is refused" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" bash "$ROT" plan --confirm-production --api-hostname 'a b;rm' 2>&1 </dev/null || true)" "not a plain host name"
t_contains "a malformed --bystander is refused" "$(env -i "PATH=$BASEPATH" "HOME=$HOMED" bash "$ROT" plan --confirm-production --bystander 'x;y' 2>&1 </dev/null || true)" "not a plain container name"
t_contains "the tool seams of the host tools are refused outside a scratch dir (CP)" "$(env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX=/etc python3 -I "$CPTOOL" status 2>&1 || true)" "under the system temp dir"
t_contains "...(API)" "$(env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX=/etc python3 -I "$APITOOL" status 2>&1 || true)" "under the system temp dir"
t_contains "...and with NO prefix at all" "$(env AICC_TEST_HARNESS=1 python3 -I "$CPTOOL" status 2>&1 || true)" "under the system temp dir"
t_contains "the host tools announce the active seams loudly" "$(cptool status 2>&1 >/dev/null; env PATH="$TMP/cpbin:$BASEPATH" AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$CP" python3 -I "$CPTOOL" fingerprint 2>&1 | head -2)" "TEST HARNESS ACTIVE"
if [ "$(id -u)" != 0 ]; then
  t_contains "without the harness a non-root caller is REFUSED (CP tool)" "$(env -u AICC_TEST_HARNESS AICC_ROOT_PREFIX="$CP" python3 -I "$CPTOOL" status 2>&1 || true)" "must run as root"
  t_contains "...(API tool)" "$(env -u AICC_TEST_HARNESS AICC_ROOT_PREFIX="$API" python3 -I "$APITOOL" status 2>&1 || true)" "must run as root"
  t_contains "...the seams are ignored without the harness (the prefix is not honoured)" "$(env -u AICC_TEST_HARNESS AICC_ROOT_PREFIX="$CP" AICC_TEST_KILL_AT=cp_after_prev python3 -I "$CPTOOL" status 2>&1 || true)" "must run as root"
else t_skip "non-root refusal" "tests run as root"; fi

echo "-- D2. the deploy windows (the owner script, no --ignore-window) --"
reset_world
wcase() { # <hh:mm> <open|closed>
  AICC_TEST_UTC_HHMM="$1" ROT_NOWIN=1 rot install-api-tool
  if [ "$2" = open ]; then t_ok "window: $1 UTC is OPEN (the command goes on to the hosts)" bash -c "echo '$R_OUT' | grep -q 'API host tool:' && ! echo '$R_OUT' | grep -q 'deploy windows'"
  else t_ok "window: $1 UTC is CLOSED (refused, nothing sent)" bash -c "echo '$R_OUT' | grep -q 'outside the deploy windows' && ! echo '$R_OUT' | grep -q 'identity verified'"; fi
}
for w in 00:18 00:26 00:48 00:56 04:20 13:19 23:50; do wcase "$w" open; done
for w in 00:17 00:27 00:47 00:57 00:00 12:30 02:20 02:50 03:20 03:50 01:30 23:59; do wcase "$w" closed; done
AICC_TEST_UTC_HHMM=10:30 ROT_NOWIN=1 rot run; t_contains "run outside a window: REFUSED with the current UTC time and the windows" "$R_OUT" "outside the deploy windows (UTC minutes 18-26 and 48-56 of any hour, never UTC hours 02 and 03; now is 10:30 UTC)"
AICC_TEST_UTC_HHMM=10:30 ROT_NOWIN=1 rot finalize --id 20261117T190000Z; t_contains "finalize outside a window: REFUSED" "$R_OUT" "outside the deploy windows"
AICC_TEST_UTC_HHMM=10:30 ROT_NOWIN=1 rot run --emergency-outside-window; t_contains "--emergency-outside-window does NOT open a NEW run" "$R_OUT" "outside the deploy windows"
AICC_TEST_UTC_HHMM=10:30 ROT_NOWIN=1 rot plan; t_contains "plan runs at any time and says the window is CLOSED" "$R_OUT" "Deploy window right now: CLOSED"
AICC_TEST_UTC_HHMM=10:30 ROT_NOWIN=1 rot verify; t_eq "verify runs at any time" "$R_RC" "0"
newscn; AICC_TEST_KILL_AT=cp_after_prev rot run; getrid
AICC_TEST_UTC_HHMM=10:30 ROT_NOWIN=1 rot resume --id "$RID"; t_eq "a half-rotated state outside the window: resume is REFUSED" "$R_RC" "1"; t_contains "...by the window" "$R_OUT" "outside the deploy windows"
AICC_TEST_UTC_HHMM=10:30 ROT_NOWIN=1 rot resume --id "$RID" --emergency-outside-window
t_eq "...with --emergency-outside-window resume goes on (the identity gates still apply)" "$R_RC" "0"; t_contains "...and says so loudly" "$R_OUT" "continuing OUTSIDE the deploy window because the hosts may be half rotated"
newscn; AICC_TEST_KILL_AT=cp_after_prev rot run; getrid
AICC_TEST_UTC_HHMM=10:30 ROT_NOWIN=1 rot rollback --id "$RID"; t_eq "rollback outside the window is REFUSED too" "$R_RC" "1"
AICC_TEST_UTC_HHMM=10:30 ROT_NOWIN=1 rot rollback --id "$RID" --emergency-outside-window; t_eq "...and allowed with --emergency-outside-window" "$R_RC/$(world)" "0/old"

echo "-- D3. the API host tool is installed by the orchestrator, verified before and after --"
reset_world
rot install-api-tool
t_eq "install-api-tool: exit 0" "$R_RC" "0"
t_contains "...says it installed the tool, root:root 0755, sha256 verified before and after" "$R_OUT" "installed /usr/local/sbin/aicc-rotate-webhook-secret-api root:root 0755, sha256"
t_ok "...the installed file is byte-identical to this checkout, mode 0755" bash -c "cmp '$APITOOL' '$API/usr/local/sbin/aicc-rotate-webhook-secret-api' && [ \"\$(stat -f '%Lp' '$API/usr/local/sbin/aicc-rotate-webhook-secret-api' 2>/dev/null || stat -c '%a' '$API/usr/local/sbin/aicc-rotate-webhook-secret-api')\" = 755 ]"
t_eq "...no temp copy is left on the API host" "$(ls -A "$API/usr/local/sbin" | tr '\n' ' ')" "aicc-rotate-webhook-secret-api "
rot install-api-tool; t_contains "a second install is a no-op that says the sha256 matches" "$R_OUT" "already installed, sha256"
echo '# stale' >> "$API/usr/local/sbin/aicc-rotate-webhook-secret-api"; rot install-api-tool
t_ok "an installed tool that DIFFERS from this checkout is replaced (and verified)" cmp "$APITOOL" "$API/usr/local/sbin/aicc-rotate-webhook-secret-api"
echo '# stale' >> "$API/usr/local/sbin/aicc-rotate-webhook-secret-api"; STALE="$(shasum -a 256 "$API/usr/local/sbin/aicc-rotate-webhook-secret-api" | cut -d' ' -f1)"; touch "$FLAGS/bad-sha"; rot install-api-tool
t_eq "an upload whose sha256 does not match is REFUSED (exit 1)" "$R_RC" "1"
t_contains "...naming the mismatch and that the installed tool was NOT replaced" "$R_OUT" "the installed tool was NOT replaced"
rm -f "$FLAGS/bad-sha"
t_eq "...the installed tool is untouched and the temp copy was removed" "$(shasum -a 256 "$API/usr/local/sbin/aicc-rotate-webhook-secret-api" | cut -d' ' -f1)/$(ls -A "$API/usr/local/sbin" | wc -l | tr -d ' ')" "$STALE/1"
rot install-api-tool

echo "-- D4. the external preflight hook and the recorded ssh options --"
cat > "$TMP/hook.sh" <<EOF
#!/bin/bash
n=\$(wc -l < "$TMP/hook.log" | tr -d ' '); echo "hook ran" >> "$TMP/hook.log"
[ ! -e "$FLAGS/hook-fail" ] || { echo "hook: the external check failed"; exit 1; }
[ ! -e "$FLAGS/hook-fail-second" ] || [ "\$n" = 0 ] || { echo "hook: the external check failed (second call)"; exit 1; }
echo "hook: read-only check ok"
EOF
chmod 755 "$TMP/hook.sh"
newscn; : > "$TMP/hook.log"; rot run --preflight-cmd "$TMP/hook.sh"
t_eq "--preflight-cmd: a passing hook runs BEFORE and AFTER the rotation" "$R_RC/$(wc -l < "$TMP/hook.log" | tr -d ' ')" "0/2"
t_contains "...its output is shown" "$R_OUT" "[hook] hook: read-only check ok"
newscn; : > "$TMP/hook.log"; touch "$FLAGS/hook-fail"; rot run --preflight-cmd "$TMP/hook.sh"; getrid
failed_in "a failing hook before the change" baseline
t_eq "...nothing live changed: OLD everywhere, the Backend never restarted, no secret prepared" "$(world)/$(be_restarts)/$(find "$CP/etc/aicc/secrets" -name '*next-*' | wc -l | tr -d ' ')" "old/0/0"
rm -f "$FLAGS/hook-fail"
newscn; AICC_TEST_KILL_AT=cp_after_prev rot run; getrid; : > "$TMP/hook.log"; touch "$FLAGS/hook-fail-second"; rot resume --id "$RID" --preflight-cmd "$TMP/hook.sh"
t_eq "a hook that fails AFTER the rotation: the rotation is complete but READY TO FINALIZE is not printed" "$R_RC/$(printf '%s' "$R_OUT" | grep -c 'READY TO FINALIZE')/$(world)" "1/0/new"
t_contains "...with the phase named" "$R_OUT" "the external preflight (--preflight-cmd) failed AFTER the rotation"
rm -f "$FLAGS/hook-fail-second"
# the ssh options of every call, per host
t_ok "ssh was only ever called for the two production addresses" bash -c "[ -z \"\$(grep '^SSH host=' '$REC' | grep -v 'dest=aicc@157.230.110.211\|dest=aicc@139.59.157.231')\" ]"
OPT_CP="$(grep '^SSHOPT cp=' "$REC" | sort -u | head -3)"; OPT_API="$(grep '^SSHOPT api=' "$REC" | sort -u | head -3)"
t_eq "every CP call used exactly the pinned production options" "$(printf '%s\n' "$OPT_CP" | wc -l | tr -d ' ')" "1"
t_contains "...the CP options (isolated from the owner's config, the CP operator identity, the pinned host key, no forwarding, no tty)" "$OPT_CP" "-F /dev/null -i $HOMED/.ssh/aicc_cp_prod_operator -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -oUserKnownHostsFile=$HOMED/.ssh/known_hosts_aicc_prod -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no -o RequestTTY=no -o ProxyCommand=none -o ProxyJump=none -o ForwardAgent=no -o ForwardX11=no -o ClearAllForwardings=yes -o ConnectTimeout=15 -o ControlMaster=no -o ControlPath=none"
t_eq "every API call used exactly one option set" "$(printf '%s\n' "$OPT_API" | wc -l | tr -d ' ')" "1"
t_contains "...the production API options use the API operator identity (a different key file) with the same isolation" "$OPT_API" "-F /dev/null -i $HOMED/.ssh/aicc_digitalocean_prod -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -oUserKnownHostsFile=$HOMED/.ssh/known_hosts_aicc_prod -o GlobalKnownHostsFile=/dev/null"
t_not_contains "...the CP calls never used the API key" "$OPT_CP" "aicc_digitalocean_prod"
t_not_contains "...and the API calls never used the CP key" "$OPT_API" "aicc_cp_prod_operator"
t_contains "the transfer is two separate ssh connections: the CP command line (emit-next) holds no secret" "$(grep '^SSHCMD cp=sudo .*emit-next' "$REC" | head -1)" "emit-next --id "
t_contains "...and the API command line (stage) holds no secret" "$(grep '^SSHCMD api=sudo .*aicc-rotate-webhook-secret-api stage' "$REC" | head -1)" "stage --id "
t_eq "no recorded ssh option or command contains a secret or a fingerprint-length token" "$(grep -c "$OLD\|$NEW" "$REC" || true)" "0"

echo "== E. secret hygiene: the canaries are nowhere they must not be =="
reset_world; flag_set window-events 2; : > "$REC"
# the pseudo-terminal run with a process-list poller watching every argv AND every environment for both canaries
CTRL="$(jq -nc --arg out "$DRV/c1.json" --arg tmp "$TMP" '{argv:["/bin/bash","-c","sleep 1 CONTROL-SECRET-ARGV & CTRLENV=CONTROL-SECRET-ENV sleep 1 & wait; echo CONTROL-SECRET-TERMINAL"], env:{PATH:"/usr/bin:/bin"}, cwd:$tmp, steps:[], secrets:["CONTROL-SECRET-ARGV","CONTROL-SECRET-ENV","CONTROL-SECRET-TERMINAL"], timeout:30, out:$out}')"; printf '%s' "$CTRL" > "$DRV/c1.cfg"; python3 -I "$HERE/lib/pty_drive.py" "$DRV/c1.cfg"
res() { jq -r "$2" "$DRV/$1.json"; }
t_eq "CONTROL: the poller sees a secret placed in an ARGUMENT" "$(res c1 '.leaks|map(select(contains("CONTROL-SECRET-ARGV")==false and contains("<SECRET>") and contains("sleep 1")))|length > 0')" "true"
t_eq "CONTROL: the poller sees a secret placed in the ENVIRONMENT of a process" "$(res c1 '.leaks|map(select(contains("CTRLENV=<SECRET>")))|length > 0')" "true"
t_eq "CONTROL: the terminal-output check sees a secret printed to the terminal" "$(res c1 '.leaks|map(select(startswith("TERMINAL")))|length > 0')" "true"
RUNCFG="$(jq -nc --arg mac "$ROT" --arg home "$HOMED" --arg path "$BASEPATH" --arg tmp "$TMP" --arg ssh "$TMP/fakessh" --arg st "$ROTSTATE" --arg nf "$TMP/new-secret.file" --arg old "$OLD" --arg new "$NEW" --arg out "$DRV/e1.json" --arg api "$APIHOST" --arg url "$BURL" \
  '{argv:["/bin/bash",$mac,"run","--confirm-production","--ignore-window","--poll-interval","0.2","--drain-timeout","3","--health-timeout","5","--api-hostname",$api,"--backend-url",$url,"--finalize"], env:{PATH:$path, HOME:$home, TERM:"xterm", TMPDIR:$tmp, AICC_TEST_HARNESS:"1", AICC_TEST_SSH:$ssh, AICC_ROT_STATE_DIR:$st, AICC_TEST_NEW_SECRET_FILE:$nf}, cwd:$tmp, steps:[], secrets:[$old,$new], timeout:300, out:$out}')"
printf '%s' "$RUNCFG" > "$DRV/e1.cfg"; python3 -I "$HERE/lib/pty_drive.py" "$DRV/e1.cfg"
t_eq "a whole rotation WITH --finalize on a pseudo terminal exits 0" "$(res e1 .exit)" "0"
t_contains "...and ends VERIFY OK" "$(res e1 .output)" "VERIFY OK"
t_eq "...the world is NEW" "$(world)" "new"
t_eq "the terminal output NEVER contained either secret" "$(res e1 '.leaks|map(select(startswith("TERMINAL")))|length')" "0"
t_eq "the process-list poller (argv AND environment of every process, sampled every few ms, the whole rotation) never saw the exposed or the new secret" "$(res e1 '.leaks|length')" "0"
RID="$(sed -n 's/.*READY TO FINALIZE: id \([0-9TZ]*\).*/\1/p' <<< "$(res e1 .output)" | head -1)"
t_eq "the same run with the secrets in no ssh option or command" "$(grep -c "$OLD\|$NEW" "$REC" || true)" "0"
# every file anywhere in the test tree that holds a canary must be one of the allowed 0600 files
allowed_hits() { # <canary> -> lists files that hold it and are NOT in the allowed set
  grep -rlF "$1" "$TMP" 2>/dev/null | grep -v "^$DRV/" | grep -v "^$TMP/new-secret.file\$" | grep -v "^$TMP/backend.env.orig\$" | grep -v "^$TMP/wp-config.orig\$" | grep -v "^$TMP/wp-config.cache\$" | grep -v "^$TMP/env.good\$" | grep -v "^$TMP/cpsec.good\$" \
    | grep -v "^$CP/etc/aicc/secrets/entitlement-webhook.secret\(\.next-\|\.prev-\|\.retired-\)\{0,1\}[0-9TZ]*\$" | grep -v "^$CP/srv/aicc/shared/wp-config.php\$" \
    | grep -v "^$API/etc/aicc/backend.env\(\.pre-webhook-rotation-[0-9TZ]*\)\{0,1\}\$" | grep -v "^$API/etc/aicc/webhook-rotation/[0-9TZ]*/next.secret\$" | grep -v "^$CP.snap/\|^$API.snap/" || true
}
t_eq "the EXPOSED secret is in NO file of the whole test tree except the root-only files (secrets dir, backend.env and its copy, wp-config)" "$(allowed_hits "$OLD" | tr '\n' ' ')" ""
t_eq "the NEW secret is in NO file of the whole test tree except the root-only files (secrets dir, backend.env, staged copy, wp-config)" "$(allowed_hits "$NEW" | tr '\n' ' ')" ""
t_eq "...(and neither is in any captured output, log, journal or record: $(ls "$LOGS" | wc -l | tr -d ' ') files)" "$(grep -rlF "$OLD" "$LOGS" "$ROTSTATE" 2>/dev/null | wc -l | tr -d ' ')/$(grep -rlF "$NEW" "$LOGS" "$ROTSTATE" 2>/dev/null | wc -l | tr -d ' ')" "0/0"
t_ok "the allowed files are root-only: no file holding a canary is group- or world-readable beyond the documented 0640 (wp-config, backend.env and its copy)" bash -c "
  for f in \$(grep -rlF '$OLD' '$CP' '$API' 2>/dev/null; grep -rlF '$NEW' '$CP' '$API' 2>/dev/null); do m=\$(stat -f '%Lp' \"\$f\" 2>/dev/null || stat -c '%a' \"\$f\"); case \"\$f\" in */wp-config.php|*/backend.env|*/backend.env.pre-webhook-rotation-*) [ \"\$m\" = 640 ] || { echo \"\$f \$m\"; exit 1; } ;; *) [ \"\$m\" = 600 ] || { echo \"\$f \$m\"; exit 1; } ;; esac; done"
t_eq "no state journal, registry, audit line or fingerprint file holds a canary (they hold 16-hex fingerprints only)" "$(grep -lF "$OLD" "$CP"/var/lib/aicc/webhook-rotation/* "$API"/var/lib/aicc/webhook-rotation/* "$CP/etc/aicc/webhook-secret-retired.fp" "$API/etc/aicc/webhook-secret-retired.fp" "$LOGS/journal.log" 2>/dev/null | wc -l | tr -d ' ')" "0"
t_eq "...the audit journal holds fingerprint PREFIXES (8 hex) and never a 16-hex fingerprint" "$(grep -c "$FPOLD\|$FPNEW" "$LOGS/journal.log" || true)" "0"
t_eq "...and every audit line names the action, the id and the phase" "$(grep -vc 'action=.* id=.* phase=' "$LOGS/journal.log" || true)" "0"
t_eq "no stale secret temp file is left anywhere after a clean run" "$(find "$CP" "$API" -name '.*.new.*' | wc -l | tr -d ' ')" "0"
t_eq "the Mac side left no temp tree behind (the transfer files held only fingerprints and were removed)" "$(ls -d "$TMP"/aicc-rot.* 2>/dev/null | wc -l | tr -d ' ')" "0"
t_eq "the Mac journal (phases only) exists and is mode 0700 / holds no canary" "$(stat -f '%Lp' "$ROTSTATE" 2>/dev/null || stat -c '%a' "$ROTSTATE")/$(grep -rlF "$NEW" "$ROTSTATE" | wc -l | tr -d ' ')" "700/0"
t_eq "the shell history of the test user was not written" "$(find "$HOMED" -maxdepth 2 -iname '*history*' | wc -l | tr -d ' ')" "0"

echo "-- E2. static rules over the three scripts and the probe --"
t_eq "no script turns tracing on (a command line that starts with set -x / set -o xtrace / bash -x)" "$(grep -hv '^[[:space:]]*#' "$ROT" "$CPTOOL" "$APITOOL" | grep -cE '^[[:space:]]*(set -x|set -o xtrace|bash -x)' || true)" "0"
t_eq "the orchestrator never echoes or prints a variable named like a secret" "$(grep -hv '^[[:space:]]*#' "$ROT" | grep -Eci "(echo|printf)[^|]*\\$\\{?(secret|new_secret|old_secret|token)\\b" || true)" "0"
t_eq "...it has no tee and no history command" "$(grep -hv '^[[:space:]]*#' "$ROT" | grep -cE '(^|[;&|(] *)(tee|history)[[:space:]]' || true)" "0"
t_eq "...the transfer is ONE pipeline between the two ssh calls, its exit codes are read from PIPESTATUS, pipefail is on" "$(grep -c 'emit-next --id \$ID --expect-stage-id \$CP_STAGE_ID" </dev/null 2>"\$ef" | rapi' "$ROT")/$(grep -c 'rcs=("${PIPESTATUS\[@\]}")' "$ROT")/$(grep -c '^set -euo pipefail' "$ROT")" "1/1/1"
t_eq "the orchestrator sets umask 077, no history, no core dump and refuses tracing" "$(grep -c "^umask 077\|unset HISTFILE\|ulimit -c 0\|BASH_XTRACEFD\|SHELLOPTS" "$ROT")" "5"
t_ok "the host tools: python in isolated mode, O_EXCL temp files, O_NOFOLLOW / S_ISREG refusals, the short-write check, flock, fsync" bash -c "for f in '$CPTOOL' '$APITOOL'; do for n in sys.flags.isolated 'os.O_EXCL' 'os.fsync' 'fcntl.flock' 'os.replace' 'S_ISREG' 'os.fstat(fd).st_size' 'logger'; do grep -qF \"\$n\" \"\$f\" || { echo \"\$f lacks \$n\"; exit 1; }; done; done; grep -qF O_NOFOLLOW '$CPTOOL'"
t_ok "neither host tool can delete a secret or a backup: the only os.unlink targets are their own temp files and stale temp files" python3 -I -c "
import ast, sys
for f in (sys.argv[1], sys.argv[2]):
    tree = ast.parse(open(f).read())
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            name = ast.unparse(n.func)
            if name in ('os.remove', 'os.truncate', 'os.rmdir', 'shutil.rmtree', 'os.removedirs'):
                sys.exit('%s calls %s' % (f, name))
            if name == 'os.unlink' and ast.unparse(n.args[0]) not in ('tmp', 'p', 'os.path.join(sd, n)'):
                sys.exit('%s unlinks %s' % (f, ast.unparse(n.args[0])))
" "$CPTOOL" "$APITOOL"
t_eq "...and the only rm in the orchestrator removes its own scratch dir, its two transfer-report files and the temp copy of a FAILED API tool upload" "$(grep -hv '^[[:space:]]*#' "$ROT" | grep -E '(^|[;&|(` ] *)(rm|shred|truncate) ' | grep -vc 'rm -rf "\$WORK"\|rm -f "\$ef" "\$of"\|umask 077; t=\|sudo rm -f \$tmp' || true)" "0"
t_ok "the probe script prints only constant_fp, status and error (no secret, signature or body)" python3 -I -c "
import re, sys
src = open(sys.argv[1]).read()
code = re.sub(r'(?s)/\*.*?\*/', '', src)
ok = ('constant_fp=', 'status=', 'error=')
for m in re.finditer(r'echo\s+(.*?);', code):
    a = m.group(1).strip()
    if not any(a.startswith(\"'\" + o) or a.startswith('\"' + o) for o in ok):
        sys.exit('unexpected echo: ' + a[:60])
assert 'print_r' not in code and 'var_dump' not in code and 'error_log' not in code
" "$PROBEPHP"
t_ok "...php -l accepts it" php -l "$PROBEPHP"
t_ok "the three scripts are shellcheck / syntax clean (when the tools are installed)" bash -c "bash -n '$ROT' && python3 -c \"import ast;[ast.parse(open(f).read()) for f in ('$CPTOOL','$APITOOL')]\" && { command -v shellcheck >/dev/null || exit 0; shellcheck -x -S warning -e SC2034,SC2154,SC2120 '$ROT'; }"

t_summary
