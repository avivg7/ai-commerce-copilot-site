#!/usr/bin/env bash
# Tests of infra/provision/promote-to-production.sh (the in-place stage -> production conversion of the existing Droplet) and its inputs: the pre-cutover edge render, the production unit drop-in
# and the production AICC Ops config. Everything runs on the Mac: the host is a temp PREFIX (AICC_TEST_HARNESS + AICC_ROOT_PREFIX), the database is a THROWAWAY mysqld (socket only, temp dir),
# systemctl is never called, nothing touches the live host and no production identity is written anywhere real.
# Run: bash infra/stack-tests/test_promote.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; INFRA="$REPO/infra"; PROV="$INFRA/provision"; PROMOTE="$PROV/promote-to-production.sh"
T_SUITE="promote"; . "$HERE/lib/t.sh"
mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/apro.XXXX")"; MYSQLD_PID=""
cleanup() { [ -n "$MYSQLD_PID" ] && kill "$MYSQLD_PID" 2>/dev/null && sleep 1; rm -rf "$TMP"; }
trap cleanup EXIT
LOCALMY="$HOME/Library/Application Support/Local/lightning-services/mysql-8.4.0+2/bin/darwin-arm64/bin"
OLDID=0123456789abcdef0123456789abcdef
SECA='owner-webhook-secret-0123456789-ABCDEFGHIJ-xyz'; SECB='owner-activation-proof-9876543210-QRSTUVWXYZ-key'

echo "== the pre-cutover edge render (dark production) =="
PRE="$TMP/Caddyfile.pre"; FINAL="$TMP/Caddyfile.final"
t_ok "render-edge --mode production --pre-cutover writes a file" bash -c "node '$REPO/scripts/ops/render-edge.mjs' --mode production --pre-cutover --out '$PRE' 2>/dev/null"
t_ok "render-edge --mode production writes the final file" bash -c "node '$REPO/scripts/ops/render-edge.mjs' --mode production --out '$FINAL' 2>/dev/null"
t_contains "pre-cutover: the first line says so" "$(head -1 "$PRE")" "# PRE-CUTOVER"
t_eq "pre-cutover: exactly one active 'tls internal' (the aicc_tls snippet imported by every https block)" "$(grep -v '^[[:space:]]*#' "$PRE" | grep -cE '^[[:space:]]*tls[[:space:]]+internal')" "1"
t_eq "final: no tls internal anywhere in code" "$(grep -v '^[[:space:]]*#' "$FINAL" | grep -cE 'tls[[:space:]]+internal')" "0"
t_ok "final render equals the committed template byte for byte" cmp "$FINAL" "$REPO/docs/cutover/Caddyfile.edge.template"
t_eq "pre-cutover differs from the final render only by the header line and the aicc_tls body" "$(diff "$FINAL" "$PRE" | grep -c '^[<>]')" "3"
for f in "$PRE" "$FINAL"; do
  C="$(grep -v '^[[:space:]]*#' "$f")"
  t_not_contains "$(basename "$f"): no stage identity route" "$C" "aicc-stage-identity"
  t_not_contains "$(basename "$f"): no noindex header" "$C" "X-Robots-Tag"
  t_not_contains "$(basename "$f"): no staging host" "$C" "stage.copilt.org"
  t_not_contains "$(basename "$f"): no Alt-Svc value (HTTP/3 off)" "$C" 'Alt-Svc "'
  t_contains "$(basename "$f"): serves www.copilt.org" "$C" "www.copilt.org"
  t_contains "$(basename "$f"): HSTS ramp starts at 300 s" "$C" 'Strict-Transport-Security "max-age=300"'
  t_contains "$(basename "$f"): operator listener is loopback only" "$C" "bind 127.0.0.1"
  t_contains "$(basename "$f"): /healthz is answered by Caddy itself" "$C" "respond \"ok\" 200"
done
t_rc "--pre-cutover with --mode stage is a usage error" 2 node "$REPO/scripts/ops/render-edge.mjs" --mode stage --pre-cutover
if [ -x "$HOME/aicc-rehearsal/bin/caddy" ]; then
  mkdir -p "$TMP/sr" "$TMP/logs" "$TMP/wp"; for f in index.html 404.html 50x.html; do echo x > "$TMP/sr/$f"; done
  CENV=(env AICC_ACME_EMAIL=ops@copilt.org AICC_STATIC_ROOT="$TMP/sr" AICC_WP_ROOT="$TMP/wp" AICC_PHP_FPM_SOCKET=unix//run/php/aicc-cp.sock AICC_PUBLIC_HOST=www.copilt.org AICC_LOG_DIR="$TMP/logs" AICC_ADMIN_ADDR=127.0.0.1:12019 AICC_OPERATOR_PORT=8443)
  for f in "$PRE" "$FINAL"; do t_contains "caddy validate accepts $(basename "$f") (user-space Caddy 2.11.x)" "$("${CENV[@]}" "$HOME/aicc-rehearsal/bin/caddy" validate --config "$f" --adapter caddyfile 2>&1 | tail -1)" "Valid configuration"; done
else t_skip "caddy validate" "no user-space Caddy at ~/aicc-rehearsal/bin/caddy"; fi

echo "== the edge preflight against the production env files the promotion writes =="
PF="$TMP/pf"; mkdir -p "$PF/sr" "$PF/wp/wp-includes" "$PF/logs"; for f in index.html 404.html 50x.html; do echo x > "$PF/sr/$f"; done
for f in index.php wp-load.php wp-includes/version.php; do echo "<?php" > "$PF/wp/$f"; done
SOCKP="$(mktemp -d /tmp/aps.XXXX)/f.sock"
python3 -c "
import socket,sys,time
s=socket.socket(socket.AF_UNIX); s.bind('$SOCKP'); s.listen(1); time.sleep(40)" & SOCKPID=$!
sleep 1
mkenv() { # mkenv <dark|final> -> an env file with the same variables the promotion writes, paths pointed at the temp tree
  sed -e "s#/srv/aicc/site/current#$PF/sr#" -e "s#/srv/aicc/cp/current#$PF/wp#" -e "s#unix//run/php/aicc-cp.sock#unix/$SOCKP#" -e "s#/var/log/aicc-edge#$PF/logs#" "$1"
}
PFC="$HOME/aicc-rehearsal/bin/caddy"; [ -x "$PFC" ] || PFC=caddy
EDGE_TXT_FN="$(sed -n '/^edge_env_text()/,/^}/p' "$PROMOTE")"
envtext() { bash -c "PROD_HOST=www.copilt.org; $EDGE_TXT_FN; edge_env_text $1 ops@copilt.org"; }
envtext dark > "$TMP/edge.dark.env"; envtext final > "$TMP/edge.final.env"
t_not_contains "edge.env (dark): no AICC_STAGE_ID / AICC_STAGE_HOST (the production preflight refuses them)" "$(cat "$TMP/edge.dark.env")" "AICC_STAGE"
t_contains "edge.env (dark): AICC_ALLOW_INTERNAL_TLS=1" "$(cat "$TMP/edge.dark.env")" "AICC_ALLOW_INTERNAL_TLS=1"
t_not_contains "edge.env (final): no AICC_ALLOW_INTERNAL_TLS" "$(cat "$TMP/edge.final.env")" "AICC_ALLOW_INTERNAL_TLS=1"
t_not_contains "edge.env (final): no ACME staging directory" "$(cat "$TMP/edge.final.env")" "acme-staging"
t_not_contains "edge.env: no AICC_OPERATOR_CIDRS (no public operator allowlist)" "$(cat "$TMP/edge.final.env")" "OPERATOR_CIDRS"
PFRUN() { # PFRUN <caddyfile> <envfile>
  mkenv "$2" > "$TMP/pf.env"; bash "$REPO/scripts/ops/edge-preflight.sh" --mode production --caddyfile "$1" --env-file "$TMP/pf.env" --caddy "$PFC" --quiet 2>&1; }
OUTA="$(PFRUN "$PRE" "$TMP/edge.dark.env")"; rca=$?
t_not_contains "preflight: the dark env + pre-cutover render raise no PREFLIGHT FAIL" "$OUTA" "PREFLIGHT FAIL"
t_contains "preflight: ...and print the NOTE that internal TLS is allowed" "$OUTA" "AICC_ALLOW_INTERNAL_TLS"
grep -v 'AICC_ALLOW_INTERNAL_TLS' "$TMP/edge.dark.env" > "$TMP/edge.noint.env"
t_contains "preflight: the pre-cutover render is REFUSED without AICC_ALLOW_INTERNAL_TLS" "$(PFRUN "$PRE" "$TMP/edge.noint.env")" "PREFLIGHT FAIL"
grep -v 'AICC_ALLOW_PRODUCTION_MODE' "$TMP/edge.final.env" > "$TMP/edge.noprod.env"
t_contains "preflight: production mode is REFUSED without AICC_ALLOW_PRODUCTION_MODE" "$(PFRUN "$FINAL" "$TMP/edge.noprod.env")" "mode production is refused"
OUTF="$(PFRUN "$FINAL" "$TMP/edge.final.env")"
t_not_contains "preflight: the FINAL env + final render raise no PREFLIGHT FAIL" "$OUTF" "PREFLIGHT FAIL"
t_contains "preflight: the final env + the PRE-CUTOVER render is REFUSED (internal certificates)" "$(PFRUN "$PRE" "$TMP/edge.final.env")" "PREFLIGHT FAIL"
printf 'AICC_STAGE_ID=0123456789abcdef0123456789abcdef\n' | cat "$TMP/edge.final.env" - > "$TMP/edge.withid.env"
t_contains "preflight: AICC_STAGE_ID in a production edge.env is REFUSED" "$(PFRUN "$FINAL" "$TMP/edge.withid.env")" "AICC_STAGE_ID is set in production mode"
kill $SOCKPID 2>/dev/null; wait $SOCKPID 2>/dev/null

echo "== the unit drop-in =="
DI="$INFRA/systemd/production/aicc-edge.service.d/10-production.conf"
t_ok "drop-in exists" test -s "$DI"
t_eq "drop-in clears and re-sets ExecStartPre (preflight in production mode)" "$(grep -c '^ExecStartPre=$' "$DI")/$(grep -c '^ExecStartPre=/usr/local/sbin/aicc-edge-preflight --mode production' "$DI")" "1/1"
t_eq "drop-in clears and re-sets ExecReload (preflight, then caddy reload)" "$(grep -c '^ExecReload=$' "$DI")/$(grep -c '^ExecReload=/usr/local/sbin/aicc-edge-preflight --mode production' "$DI")/$(grep -c '^ExecReload=/usr/local/bin/caddy reload' "$DI")" "1/1/1"
t_not_contains "drop-in names no stage mode" "$(grep -v '^#' "$DI")" "--mode stage"
t_fail "install-stack.sh never installs the production drop-in (a staging host can not get it)" grep -q "systemd/production" "$PROV/install-stack.sh"

echo "== scripts/ops/production-edge-check.sh: refusals (the checks themselves were run against the local rehearsal edge, see the evidence) =="
PEC="$REPO/scripts/ops/production-edge-check.sh"
t_rc "edge check: no --ip is a usage error" 2 bash "$PEC" --public
t_rc "edge check: the API Droplet address is REFUSED" 3 bash "$PEC" --ip 139.59.157.231 --public
t_rc "edge check: a GitHub Pages address is REFUSED (the old site must never be probed as 'the new edge')" 3 bash "$PEC" --ip 185.199.108.153 --public
t_rc "edge check: dark production without --cacert is a usage error" 2 bash "$PEC" --ip 203.0.113.9
t_rc "edge check: a hostname instead of an IP is a usage error" 2 bash "$PEC" --ip www.copilt.org --public

echo "== push-bundle.sh --env production: refusals before any ssh =="
PBK="$TMP/aicc_cp_prod_operator"; printf -- '-----BEGIN %s-----\nDUMMY\n-----END %s-----\n' "OPENSSH PRIVATE KEY" "OPENSSH PRIVATE KEY" > "$PBK"; chmod 600 "$PBK"
PBH="$TMP/known_hosts_prod"; echo "203.0.113.9 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItestonlytestonlytestonlytestonlytestonlytest" > "$PBH"
PB() { bash "$PROV/push-bundle.sh" --env production "$@"; }
t_rc "push-bundle production: no --key is a usage error" 2 PB --stage-ip 203.0.113.9 --stage-host www.copilt.org --expect-id "$OLDID" --known-hosts "$PBH" --dry-run
t_rc "push-bundle production: a stage host name is REFUSED" 3 PB --stage-ip 203.0.113.9 --stage-host stage.copilt.org --expect-id "$OLDID" --key "$PBK" --known-hosts "$PBH" --dry-run
t_rc "push-bundle production: no --expect-id is REFUSED" 3 PB --stage-ip 203.0.113.9 --stage-host www.copilt.org --key "$PBK" --known-hosts "$PBH" --dry-run
t_rc "push-bundle production: no pinned known-hosts is REFUSED" 3 PB --stage-ip 203.0.113.9 --stage-host www.copilt.org --expect-id "$OLDID" --key "$PBK" --known-hosts "$TMP/none" --dry-run
t_rc "push-bundle production: the staging key name is REFUSED" 3 PB --stage-ip 203.0.113.9 --stage-host www.copilt.org --expect-id "$OLDID" --key "$TMP/root.conf" --known-hosts "$PBH" --dry-run
t_rc "push-bundle production: the API address is REFUSED" 3 PB --stage-ip 139.59.157.231 --stage-host www.copilt.org --expect-id "$OLDID" --key "$PBK" --known-hosts "$PBH" --dry-run
t_rc "push-bundle stage: the production key name is REFUSED" 3 bash "$PROV/push-bundle.sh" --stage-ip 203.0.113.9 --stage-host stage.copilt.org --key "$PBK" --dry-run

echo "== operator-tunnel.sh --env production (dry-run only) =="
OT() { bash "$PROV/operator-tunnel.sh" --env production "$@"; }
t_rc "operator-tunnel production: no --key is a usage error" 2 OT --stage-ip 203.0.113.9 --known-hosts "$PBH" --dry-run
t_rc "operator-tunnel production: a stage host name is REFUSED" 3 OT --stage-ip 203.0.113.9 --stage-host stage.copilt.org --key "$PBK" --known-hosts "$PBH" --dry-run
t_rc "operator-tunnel production: no pinned known-hosts is REFUSED" 3 OT --stage-ip 203.0.113.9 --key "$PBK" --known-hosts "$TMP/none" --dry-run
t_rc "operator-tunnel production: a malformed --spki-hash is REFUSED" 3 OT --stage-ip 203.0.113.9 --key "$PBK" --known-hosts "$PBH" --spki-hash 'not-a-hash' --dry-run
t_rc "operator-tunnel stage: --spki-hash is REFUSED" 3 bash "$PROV/operator-tunnel.sh" --stage-ip 203.0.113.9 --key "$PBK" --spki-hash 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' --dry-run
OUTT="$(OT --stage-ip 203.0.113.9 --key "$PBK" --known-hosts "$PBH" --spki-hash 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' --dry-run 2>&1)"; rct=$?
t_eq "operator-tunnel production dry-run succeeds" "$rct" "0"
t_contains "...maps www.copilt.org to the tunnel and pins the host key" "$OUTT" "MAP\ www.copilt.org\ 127.0.0.1:8443"
t_contains "...strict host key checking against the pinned file" "$OUTT" "StrictHostKeyChecking=yes"
t_contains "...a separate production Chrome profile" "$OUTT" ".aicc-prod-chrome"
t_contains "...the SPKI exception is only for that key" "$OUTT" "ignore-certificate-errors-spki-list=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

echo "== promote-to-production.sh: argument handling and refusals (no host needed) =="
t_rc "no action: usage (2)" 2 bash "$PROMOTE"
t_rc "unknown action (2)" 2 bash "$PROMOTE" frobnicate
t_rc "unknown option (2)" 2 bash "$PROMOTE" apply --frobnicate
t_contains "--help prints the refusal contract" "$(bash "$PROMOTE" --help 2>&1)" "Refuses (exit 3"
t_rc "apply without --confirm-production is refused (3)" 3 bash "$PROMOTE" apply --expect-stage-id "$OLDID" --dry-run
t_rc "start without --confirm-production is refused (3)" 3 env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$TMP/none" bash "$PROMOTE" start
t_rc "final-edge without --confirm-cutover is refused (3)" 3 env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$TMP/none" bash "$PROMOTE" final-edge --caddyfile "$FINAL" --expect-ip 192.0.2.7
t_rc "rollback without --confirm-rollback is refused (3)" 3 env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$TMP/none" bash "$PROMOTE" rollback --bundle "$TMP"
t_rc "a real run as a non-root user is refused (3)" 3 bash "$PROMOTE" apply --confirm-production --expect-stage-id "$OLDID" --caddyfile "$PRE" --ops-config "$INFRA/aicc-ops/config/aicc-ops.production.toml"
t_rc "set-owner-secret with an unknown name is a usage error (2)" 2 env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$TMP/none" bash "$PROMOTE" set-owner-secret telegram --stdin

echo "== a prefix 'host' that looks like the staging Droplet =="
PFX="$TMP/root"; mkdir -p "$PFX/etc/aicc-edge" "$PFX/etc/aicc-ops" "$PFX/srv/aicc/shared" "$PFX/srv/aicc/backups" "$PFX/etc/aicc" "$PFX/var/lib/aicc" "$PFX/etc/systemd/system"
printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\nAICC_HOST_ROLE=control-plane-edge\n# NOT production.\nAICC_STAGE_ID=%s\n' "$OLDID" > "$PFX/etc/aicc-stage-identity"
cat > "$PFX/etc/aicc-edge/edge.env" <<EOF
AICC_EDGE_MODE=stage
AICC_PUBLIC_HOST=stage.copilt.org
AICC_STAGE_HOST=stage.copilt.org
AICC_STAGE_ID=$OLDID
AICC_ACME_EMAIL=ops@copilt.org
EOF
echo "# stage caddyfile" > "$PFX/etc/aicc-edge/Caddyfile"
echo "<?php // stage wp-config with OLD-STAGE-SALT" > "$PFX/srv/aicc/shared/wp-config.php"
cp "$INFRA/aicc-ops/config/aicc-ops.example.toml" "$PFX/etc/aicc-ops/aicc-ops.toml"
PRODOPS="$INFRA/aicc-ops/config/aicc-ops.production.toml"
SEC="$PFX/etc/aicc/secrets"; mkdir -p "$SEC"; chmod 700 "$SEC"
echo "OLD-STAGE-ADMIN-PASSWORD" > "$SEC/wp-admin.pass"; printf 'AUTH_KEY=OLDSALTOLDSALT\n' > "$SEC/wp-secrets.env"; chmod 600 "$SEC"/*
INC="$PFX/etc/aicc/owner-secrets-incoming"
P() { env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$PFX" bash "$PROMOTE" "$@"; }
t_rc "check: fails while the owner secrets are missing (3)" 3 P check --expect-stage-id "$OLDID" --caddyfile "$PRE" --ops-config "$PRODOPS" --confirm-production
OUT="$(P check --expect-stage-id "$OLDID" --caddyfile "$PRE" --ops-config "$PRODOPS" --confirm-production 2>&1)"
t_contains "check: names the missing owner secret" "$OUT" "owner secret entitlement-webhook"
t_contains "check: the other gates pass (identity, caddyfile, ops config)" "$OUT" "PASS  identity says AICC_ENV=staging"

echo "== set-owner-secret (hidden-prompt helper; --stdin is the test/password-manager path) =="
t_rc "a too-short secret is refused (1) and not stored" 1 bash -c "printf 'short' | env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX='$PFX' bash '$PROMOTE' set-owner-secret entitlement-webhook --stdin"
t_fail "...nothing was stored" test -e "$INC/entitlement-webhook.secret"
t_rc "an all-same-character placeholder is refused (1)" 1 bash -c "printf 'a%.0s' \$(seq 40) | env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX='$PFX' bash '$PROMOTE' set-owner-secret entitlement-webhook --stdin"
t_rc "a value with a quote (would break the PHP string) is refused (1)" 1 bash -c "printf \"abc'def-0123456789-0123456789-ABCDEFGH\" | env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX='$PFX' bash '$PROMOTE' set-owner-secret entitlement-webhook --stdin"
OUTS="$(printf '%s' "$SECA" | P set-owner-secret entitlement-webhook --stdin 2>&1)"
t_eq "a valid webhook secret is stored" "$(cat "$INC/entitlement-webhook.secret")" "$SECA"
t_eq "...mode 0600" "$(mode "$INC/entitlement-webhook.secret")" "600"
t_eq "...the incoming directory is 0700" "$(mode "$INC")" "700"
t_not_contains "...and the value is never printed" "$OUTS" "$SECA"
printf '%s' "$SECB" | P set-owner-secret activation-proof --stdin >/dev/null 2>&1
t_eq "the activation-proof key is stored" "$(cat "$INC/activation-proof.secret")" "$SECB"

echo "== gate refusals with everything else in place =="
APPLY() { P apply --confirm-production --expect-stage-id "$OLDID" --caddyfile "$PRE" --ops-config "$PRODOPS" "$@"; }
t_rc "a wrong --expect-stage-id is refused (3)" 3 P apply --confirm-production --expect-stage-id ffffffffffffffffffffffffffffffff --caddyfile "$PRE" --ops-config "$PRODOPS" --dry-run
t_rc "a missing --expect-stage-id is refused (3)" 3 P apply --confirm-production --caddyfile "$PRE" --ops-config "$PRODOPS" --dry-run
t_rc "the FINAL (non pre-cutover) Caddyfile is refused for the promotion (3)" 3 P apply --confirm-production --expect-stage-id "$OLDID" --caddyfile "$FINAL" --ops-config "$PRODOPS" --dry-run
t_rc "the stage ops config (staging host label) is refused (3)" 3 P apply --confirm-production --expect-stage-id "$OLDID" --caddyfile "$PRE" --ops-config "$INFRA/aicc-ops/config/aicc-ops.example.toml" --dry-run
node "$REPO/scripts/ops/render-edge.mjs" --mode stage --out "$TMP/Caddyfile.stage" 2>/dev/null
t_rc "a STAGE render (identity route, noindex, stage host) is refused (3)" 3 P apply --confirm-production --expect-stage-id "$OLDID" --caddyfile "$TMP/Caddyfile.stage" --ops-config "$PRODOPS" --dry-run
chmod 644 "$INC/activation-proof.secret"
t_rc "an owner secret with mode 0644 is refused (3)" 3 APPLY --dry-run
chmod 600 "$INC/activation-proof.secret"
chmod 755 "$INC"
t_rc "an incoming directory that is not 0700 is refused (3)" 3 APPLY --dry-run
chmod 700 "$INC"
mv "$PFX/etc/aicc-stage-identity" "$PFX/etc/aicc-stage-identity.bak"
printf 'AICC_ENV=production\nAICC_HOSTNAME=www.copilt.org\nAICC_STAGE_ID=%s\n' "$OLDID" > "$PFX/etc/aicc-stage-identity"
t_rc "a host that already says production (no promotion state) is refused (3)" 3 APPLY --dry-run
mv -f "$PFX/etc/aicc-stage-identity.bak" "$PFX/etc/aicc-stage-identity"
t_eq "none of the refusals changed the identity" "$(grep -c '^AICC_ENV=staging$' "$PFX/etc/aicc-stage-identity")" "1"

echo "== --dry-run =="
DRY="$(APPLY --dry-run 2>&1)"; rc=$?
t_eq "dry-run exits 0" "$rc" "0"
t_contains "dry-run says nothing changed and stops for owner approval" "$DRY" "STOP: owner approval is required"
t_contains "dry-run lists the identity write" "$DRY" "AICC_ENV=production AICC_HOSTNAME=www.copilt.org"
t_contains "dry-run lists the database replacement" "$DRY" "DROP DATABASE aicc_cp"
t_eq "dry-run: the identity file is unchanged" "$(grep -c '^AICC_ENV=staging$' "$PFX/etc/aicc-stage-identity")" "1"
t_fail "dry-run: no bundle directory" test -d "$PFX/var/backups/aicc-promotion"
t_fail "dry-run: no promotion state" test -e "$PFX/var/lib/aicc/promotion/bundle"
t_ok "dry-run: the owner secrets are still in the incoming directory" test -s "$INC/entitlement-webhook.secret"
t_not_contains "dry-run prints no secret value" "$DRY" "$SECA"

echo "== apply against a THROWAWAY mysqld =="
if [ -x "$LOCALMY/mysqld" ] && command -v jq >/dev/null 2>&1; then
  M="$TMP/m"; mkdir -p "$M/data"
  printf '[mysqld]\ndatadir=%s/data\nbasedir=%s\nsocket=%s/s.sock\npid-file=%s/p.pid\nmysqlx-socket=%s/x.sock\nskip-networking\n' "$M" "$(dirname "$LOCALMY")" "$M" "$M" "$M" > "$M/my.cnf"
  "$LOCALMY/mysqld" --defaults-file="$M/my.cnf" --initialize-insecure >"$M/init.out" 2>&1 || true
  "$LOCALMY/mysqld" --defaults-file="$M/my.cnf" >"$M/run.out" 2>&1 &
  MYSQLD_PID=$!
  for i in $(seq 1 60); do [ -S "$M/s.sock" ] && break; sleep 1; done
  if [ -S "$M/s.sock" ]; then
    SQL=("$LOCALMY/mysql" --protocol=socket --socket="$M/s.sock" -uroot -N)
    # the "staging" state: a database with a test user marker, old DB passwords, a backup set
    env AICC_TEST_HARNESS=1 bash "$PROV/create-staging-db.sh" --socket "$M/s.sock" --secrets-dir "$SEC" --backup-cnf "$PFX/etc/aicc/backup.cnf" --mysql-bin "$LOCALMY/mysql" >/dev/null 2>&1
    "${SQL[@]}" -e "CREATE TABLE aicc_cp.wp_users_marker (id INT PRIMARY KEY, who VARCHAR(40)); INSERT INTO aicc_cp.wp_users_marker VALUES (1,'STAGING-TEST-USER'); CREATE TABLE aicc_cp.wp_options (option_name VARCHAR(64), option_value TEXT); INSERT INTO aicc_cp.wp_options VALUES ('siteurl','https://stage.copilt.org');"
    OLDDBPW="$(cat "$SEC/db-cp.pass")"
    BIN="$TMP/bin"; mkdir -p "$BIN"
    cat > "$BIN/aicc-backup" <<EOF
#!/usr/bin/env bash
set -e
D="$PFX/srv/aicc/backups"; TS=\$(date -u +%Y%m%dT%H%M%SZ); N=aicc_cp-\$TS-manual.sql.gz; F=aicc-files-\$TS-manual.tar.gz
"$LOCALMY/mysqldump" --protocol=socket --socket="$M/s.sock" -uroot --single-transaction --no-tablespaces aicc_cp | gzip -c > "\$D/\$N"
echo x | gzip -c > "\$D/\$F"
( cd "\$D" && shasum -a 256 "\$N" > "\$N.sha256" && shasum -a 256 "\$F" > "\$F.sha256" )
jq -n --arg d "\$N" --arg f "\$F" '{schema:1,status:"ok",last_success:{db_dump_file:\$d,files_archive_file:\$f}}' > "\$D/status.json"
echo '{"schema":1,"verified":true}' > "\$D/offhost-ack.json"
EOF
    chmod 755 "$BIN/aicc-backup"
    cat > "$BIN/preflight" <<'EOF'
#!/usr/bin/env bash
echo "preflight $*" >> "$PREFLIGHT_LOG"; exit "${PREFLIGHT_RC:-0}"
EOF
    chmod 755 "$BIN/preflight"; export PREFLIGHT_LOG="$TMP/preflight.log"; : > "$PREFLIGHT_LOG"
    cat > "$BIN/wp" <<'EOF'
#!/usr/bin/env bash
echo "wp $*" >> "$WP_LOG"
case "$*" in "option get home"|"option get siteurl") echo "https://www.copilt.org" ;; "option get blog_public") echo 1 ;; esac
EOF
    chmod 755 "$BIN/wp"; export WP_LOG="$TMP/wp.log"; : > "$WP_LOG"
    printf 'SAMPLE-OLD-BACKUP' > "$PFX/srv/aicc/backups/aicc_cp-20261021T000000Z-scheduled.sql.gz"
    SEAMS=(--socket "$M/s.sock" --mysql-bin "$LOCALMY/mysql" --backup-cmd "$BIN/aicc-backup" --preflight-cmd "$BIN/preflight" --wp-bin "$BIN/wp")
    BDIR="/var/backups/aicc-promotion/test1"
    OUT="$(APPLY "${SEAMS[@]}" --bundle-dir "$BDIR" 2>&1)"; rc=$?
    t_eq "apply succeeds" "$rc" "0"
    [ "$rc" = 0 ] || printf '%s\n' "$OUT" | tail -15
    t_contains "apply ends with the STOP marker before anything public" "$OUT" "STOP: nothing above touches DNS"
    t_not_contains "apply never prints an owner secret" "$OUT" "$SECA"
    t_not_contains "apply never prints the other owner secret" "$OUT" "$SECB"
    t_not_contains "apply never prints a database password" "$OUT" "$OLDDBPW"
    echo "-- identity"
    ID="$PFX/etc/aicc-stage-identity"
    t_eq "identity: AICC_ENV=production" "$(sed -n 's/^AICC_ENV=//p' "$ID")" "production"
    t_eq "identity: hostname www.copilt.org" "$(sed -n 's/^AICC_HOSTNAME=//p' "$ID")" "www.copilt.org"
    NEWID="$(sed -n 's/^AICC_STAGE_ID=//p' "$ID")"
    t_ok "identity: a NEW random 32-hex id" bash -c "[[ '$NEWID' =~ ^[0-9a-f]{32}\$ ]] && [ '$NEWID' != '$OLDID' ]"
    t_eq "identity: file mode 0644" "$(mode "$ID")" "644"
    t_eq "identity: exactly one AICC_STAGE_ID line (the key name is historical)" "$(grep -c '^AICC_STAGE_ID=' "$ID")" "1"
    t_eq "deployment records: one promotion boundary record was appended (same file, history kept)" "$(jq -r 'select(.outcome=="promoted_to_production") | .target' "$PFX/var/lib/aicc/deployments.jsonl")" "production"
    t_eq "...and it carries every field aicc-deploy-status prints" "$(jq -r 'select(.outcome=="promoted_to_production") | [.ts,.outcome,.kind,.release_id,.previous,.source_commit,.operator]|map(select(.==null))|length' "$PFX/var/lib/aicc/deployments.jsonl")" "0"
    echo "-- rollback bundle"
    B="$PFX$BDIR"
    t_eq "bundle: directory 0700" "$(mode "$B")" "700"
    t_ok "bundle: keeps the staging identity" grep -q '^AICC_ENV=staging$' "$B/etc_aicc-stage-identity"
    t_ok "bundle: keeps the staging wp-config" grep -q 'OLD-STAGE-SALT' "$B/srv_aicc_shared_wp-config.php"
    t_ok "bundle: has a tar of the staging secrets" test -s "$B/secrets-stage.tar"
    t_ok "bundle: has a verified database dump" bash -c "gzip -t '$B/staging-db.sql.gz' && gzip -dc '$B/staging-db.sql.gz' | grep -q STAGING-TEST-USER"
    t_ok "bundle: has a MANIFEST.sha256 that verifies" bash -c "cd '$B' && shasum -a 256 -c MANIFEST.sha256 >/dev/null"
    t_eq "bundle: files are 0600" "$(find "$B" -type f | while read -r f; do mode "$f"; done | sort -u | tr '\n' ' ')" "600 "
    t_ok "bundle: the old backup directory (with the staging sets and the old ack) moved in" bash -c "test -f '$B/backups-stage/offhost-ack.json' && test -f '$B/backups-stage/aicc_cp-20261021T000000Z-scheduled.sql.gz'"
    echo "-- backups"
    t_eq "backups: the live directory is empty and 0751 (production starts clean)" "$(ls -A "$PFX/srv/aicc/backups" | wc -l | tr -d ' ')/$(mode "$PFX/srv/aicc/backups")" "0/751"
    echo "-- database"
    t_eq "db: the staging test user table is GONE" "$("${SQL[@]}" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='aicc_cp'")" "0"
    t_eq "db: aicc_cp exists and is empty" "$("${SQL[@]}" -e "SHOW DATABASES LIKE 'aicc_cp'")" "aicc_cp"
    NEWDBPW="$(cat "$SEC/db-cp.pass")"
    t_ok "db: a NEW application password (the staging one is not reused)" bash -c "[ -n '$NEWDBPW' ] && [ '$NEWDBPW' != '$OLDDBPW' ]"
    APPC="$TMP/app.cnf"; printf '[client]\nuser=aicc_cp\npassword=%s\nsocket=%s/s.sock\n' "$NEWDBPW" "$M" > "$APPC"; chmod 600 "$APPC"
    t_eq "db: the new password works for aicc_cp" "$("$LOCALMY/mysql" --defaults-extra-file="$APPC" -N -e 'SELECT 1' aicc_cp)" "1"
    printf '[client]\nuser=aicc_cp\npassword=%s\nsocket=%s/s.sock\n' "$OLDDBPW" "$M" > "$APPC"
    t_fail "db: the OLD staging password no longer works" "$LOCALMY/mysql" --defaults-extra-file="$APPC" -N -e 'SELECT 1' aicc_cp
    t_eq "db: backup.cnf rewritten with the new password (0600)" "$(grep -c "password=$(cat "$SEC/db-backup.pass")" "$PFX/etc/aicc/backup.cnf")/$(mode "$PFX/etc/aicc/backup.cnf")" "1/600"
    echo "-- secrets"
    t_eq "secrets: the owner webhook secret is installed (0600)" "$(cat "$SEC/entitlement-webhook.secret")/$(mode "$SEC/entitlement-webhook.secret")" "$SECA/600"
    t_eq "secrets: the owner activation-proof key is installed (0600)" "$(cat "$SEC/activation-proof.secret")/$(mode "$SEC/activation-proof.secret")" "$SECB/600"
    t_fail "secrets: the staging wp-admin password is gone from /etc/aicc/secrets" test -e "$SEC/wp-admin.pass"
    t_fail "secrets: the incoming directory is gone (values moved, not copied)" test -e "$INC"
    t_ok "secrets: directory 0700" test "$(mode "$SEC")" = 700
    t_eq "mail: /etc/aicc-mail prepared (0750, empty: the owner places smtp.env afterwards)" "$(mode "$PFX/etc/aicc-mail")/$(ls -A "$PFX/etc/aicc-mail" | wc -l | tr -d ' ')" "750/0"
    t_ok "secrets: the staging salts are not reused" bash -c "! grep -q OLDSALT '$SEC/wp-secrets.env'"
    echo "-- wp-config"
    WCF="$PFX/srv/aicc/shared/wp-config.php"
    t_ok "wp-config: rendered from the production template (WP_HOME www)" grep -q "define( 'WP_HOME', 'https://www.copilt.org' )" "$WCF"
    t_ok "wp-config: webhook URL on the API host" grep -q "https://api.copilt.org/v1/internal/entitlement/webhook" "$WCF"
    t_ok "wp-config: carries the owner webhook secret" grep -q "$SECA" "$WCF"
    t_ok "wp-config: carries the NEW db password" grep -q "$NEWDBPW" "$WCF"
    t_not_contains "wp-config: no staging host, no old salt, no old db password" "$(cat "$WCF")" "OLD-STAGE"
    t_not_contains "wp-config: no old database password" "$(cat "$WCF")" "$OLDDBPW"
    t_not_contains "wp-config: no staging host" "$(cat "$WCF")" "stage.copilt.org"
    echo "-- edge, unit, ops"
    t_ok "edge: Caddyfile is the pre-cutover render" bash -c "head -1 '$PFX/etc/aicc-edge/Caddyfile' | grep -q '^# PRE-CUTOVER'"
    t_eq "edge: edge.env mode 0640 and production" "$(mode "$PFX/etc/aicc-edge/edge.env")/$(grep -c '^AICC_EDGE_MODE=production$' "$PFX/etc/aicc-edge/edge.env")" "640/1"
    t_not_contains "edge: edge.env has no stage id / stage host" "$(cat "$PFX/etc/aicc-edge/edge.env")" "AICC_STAGE"
    t_contains "edge: the ACME contact of the staging file is carried over" "$(cat "$PFX/etc/aicc-edge/edge.env")" "AICC_ACME_EMAIL=ops@copilt.org"
    t_ok "edge: unit drop-in installed byte for byte" cmp "$DI" "$PFX/etc/systemd/system/aicc-edge.service.d/10-production.conf"
    t_ok "edge: the certificate-expiry drop-in (www + apex) is installed byte for byte" cmp "$INFRA/systemd/production/aicc-cert-expiry.service.d/10-production.conf" "$PFX/etc/systemd/system/aicc-cert-expiry.service.d/10-production.conf"
    t_contains "edge: the cert-expiry drop-in checks BOTH names" "$(cat "$PFX/etc/systemd/system/aicc-cert-expiry.service.d/10-production.conf")" "--host www.copilt.org --host copilt.org"
    t_contains "edge: the preflight ran in production mode against the installed files" "$(cat "$PREFLIGHT_LOG")" "--mode production"
    t_ok "ops: production config installed byte for byte" cmp "$PRODOPS" "$PFX/etc/aicc-ops/aicc-ops.toml"
    t_eq "ops: mode 0640" "$(mode "$PFX/etc/aicc-ops/aicc-ops.toml")" "640"
    echo "-- resume / idempotence"
    OUT2="$(APPLY "${SEAMS[@]}" --bundle-dir "$BDIR" 2>&1)"; rc2=$?
    t_eq "a second apply (promotion state exists) is accepted and exits 0" "$rc2" "0"
    t_contains "...it says the bundle step is already done" "$OUT2" "already done"
    t_eq "...the identity is unchanged" "$(sed -n 's/^AICC_STAGE_ID=//p' "$ID")" "$NEWID"
    t_eq "...the database password is unchanged" "$(cat "$SEC/db-cp.pass")" "$NEWDBPW"
    echo "-- start / wp-install (stubs; no systemctl is ever called in the harness)"
    t_ok "start (harness) succeeds" P start --confirm-production
    t_rc "wp-install: a guessable admin name is refused (3)" 3 P wp-install --admin-user admin --admin-email owner@example.org
    t_rc "wp-install: a short admin name is refused (3)" 3 P wp-install --admin-user abc --admin-email owner@example.org
    t_rc "wp-install: a bad email is refused (3)" 3 P wp-install --admin-user ownerlogin --admin-email nope --wp-bin "$BIN/wp"
    : > "$WP_LOG"
    t_ok "wp-install runs against the production URL" P wp-install --admin-user ownerlogin --admin-email owner@example.org --wp-bin "$BIN/wp"
    t_contains "wp-install: core install with a PROMPTED password" "$(cat "$WP_LOG")" "core install --url=https://www.copilt.org"
    t_contains "wp-install: --prompt=admin_password (no password on any command line)" "$(cat "$WP_LOG")" "--prompt=admin_password"
    t_not_contains "wp-install: no --admin_password argument" "$(cat "$WP_LOG")" "--admin_password="
    t_contains "wp-install: activates WooCommerce and the licence plugin" "$(cat "$WP_LOG")" "plugin activate woocommerce aicc-license-manager"
    echo "-- cutover edge and its gates"
    DNS_OK="$BIN/dns-ok"; printf '#!/bin/sh\necho 206.189.248.204\n' > "$DNS_OK"; chmod 755 "$DNS_OK"
    DNS_OLD="$BIN/dns-old"; printf '#!/bin/sh\necho 185.199.108.153\n' > "$DNS_OLD"; chmod 755 "$DNS_OLD"
    FE() { P final-edge --confirm-cutover --caddyfile "$FINAL" --expect-ip 206.189.248.204 --preflight-cmd "$BIN/preflight" "$@"; }
    t_rc "final-edge: DNS still pointing at GitHub Pages is REFUSED (3)" 3 FE --dns-cmd "$DNS_OLD"
    t_ok "final-edge: the refusal left the dark edge in place" grep -q '^AICC_ALLOW_INTERNAL_TLS=1$' "$PFX/etc/aicc-edge/edge.env"
    t_rc "final-edge: the pre-cutover Caddyfile is REFUSED as the final one (3)" 3 P final-edge --confirm-cutover --caddyfile "$PRE" --expect-ip 206.189.248.204 --dns-cmd "$DNS_OK" --preflight-cmd "$BIN/preflight"
    t_rc "final-edge: a non-IPv4 --expect-ip is REFUSED (3)" 3 P final-edge --confirm-cutover --caddyfile "$FINAL" --expect-ip www.copilt.org --dns-cmd "$DNS_OK"
    t_ok "final-edge: succeeds when DNS resolves to this host" FE --dns-cmd "$DNS_OK"
    t_ok "final-edge: the final Caddyfile is installed" cmp "$FINAL" "$PFX/etc/aicc-edge/Caddyfile"
    t_not_contains "final-edge: edge.env no longer allows internal TLS" "$(cat "$PFX/etc/aicc-edge/edge.env")" "AICC_ALLOW_INTERNAL_TLS"
    t_contains "final-edge: edge.env keeps the production mode flag" "$(cat "$PFX/etc/aicc-edge/edge.env")" "AICC_ALLOW_PRODUCTION_MODE=1"
    t_not_contains "final-edge: the dark cert_expiry override is stripped from the AICC Ops config" "$(cat "$PFX/etc/aicc-ops/aicc-ops.toml")" "DARK-PRODUCTION"
    t_contains "final-edge: the wc_cron_stale override is kept" "$(cat "$PFX/etc/aicc-ops/aicc-ops.toml")" "warn_s = 7200"
    t_eq "final-edge: the ops config is still valid TOML with cert_expiry enabled (no override)" "$(python3.12 -c "import tomllib,sys;d=tomllib.load(open('$PFX/etc/aicc-ops/aicc-ops.toml','rb'));print(d['alerts']['rules'].get('cert_expiry','absent'))")" "absent"
    t_ok "dark-edge: back to the waiting render (with the ops config)" P dark-edge --caddyfile "$PRE" --ops-config "$PRODOPS" --preflight-cmd "$BIN/preflight"
    t_ok "dark-edge: the dark ops config is back" cmp "$PRODOPS" "$PFX/etc/aicc-ops/aicc-ops.toml"
    t_ok "dark-edge: the internal-TLS flag is back" grep -q '^AICC_ALLOW_INTERNAL_TLS=1$' "$PFX/etc/aicc-edge/edge.env"
    echo "-- rollback to the staging state"
    t_rc "rollback with an unknown bundle is refused (3)" 3 P rollback --bundle /var/backups/aicc-promotion/nope --confirm-rollback
    cp -R "$B" "$TMP/bundle-damaged"; echo tamper >> "$TMP/bundle-damaged/etc_aicc-stage-identity"
    mkdir -p "$PFX/var/backups/aicc-promotion"; mv "$TMP/bundle-damaged" "$PFX/var/backups/aicc-promotion/damaged"
    t_rc "rollback with a bundle whose file no longer matches its hash is refused (3)" 3 P rollback --bundle /var/backups/aicc-promotion/damaged --confirm-rollback
    t_eq "...and the refusal changed nothing (still production)" "$(sed -n 's/^AICC_ENV=//p' "$ID")" "production"
    "${SQL[@]}" -e "CREATE TABLE aicc_cp.wp_production_marker (id INT); INSERT INTO aicc_cp.wp_production_marker VALUES (7);"
    t_ok "rollback restores the staging state" P rollback --bundle "$BDIR" --confirm-rollback "${SEAMS[@]}"
    t_eq "rollback: identity is staging again with the ORIGINAL id" "$(sed -n 's/^AICC_ENV=//p' "$ID")/$(sed -n 's/^AICC_STAGE_ID=//p' "$ID")" "staging/$OLDID"
    t_eq "rollback: the staging test user is back" "$("${SQL[@]}" -e "SELECT who FROM aicc_cp.wp_users_marker")" "STAGING-TEST-USER"
    t_eq "rollback: the production-only table is gone" "$("${SQL[@]}" -e "SHOW TABLES FROM aicc_cp LIKE 'wp_production_marker'")" ""
    t_eq "rollback: the staging DB password is back in the secrets directory" "$(cat "$SEC/db-cp.pass")" "$OLDDBPW"
    t_ok "rollback: the staging wp-config is back" grep -q OLD-STAGE-SALT "$PFX/srv/aicc/shared/wp-config.php"
    t_ok "rollback: the staging edge.env is back" grep -q '^AICC_EDGE_MODE=stage$' "$PFX/etc/aicc-edge/edge.env"
    t_fail "rollback: the production unit drop-in is removed" test -e "$PFX/etc/systemd/system/aicc-edge.service.d/10-production.conf"
    t_fail "rollback: the production cert-expiry drop-in is removed" test -e "$PFX/etc/systemd/system/aicc-cert-expiry.service.d/10-production.conf"
    t_ok "rollback: the staging backup directory (and its ack) is back" test -f "$PFX/srv/aicc/backups/aicc_cp-20261021T000000Z-scheduled.sql.gz"
    t_fail "rollback: the promotion state is cleared" test -e "$PFX/var/lib/aicc/promotion/bundle"
    t_ok "rollback: the bundle itself is kept" test -s "$B/MANIFEST.sha256"
    t_eq "the staging secrets (wp-admin password) are restored" "$(cat "$SEC/wp-admin.pass")" "OLD-STAGE-ADMIN-PASSWORD"
    t_eq "no production owner secret remains after the rollback" "$(find "$SEC" -name '*secret' | wc -l | tr -d ' ')" "0"
    t_eq "the throwaway server still has only its own aicc databases" "$("${SQL[@]}" -e "SHOW DATABASES" | grep -E '^aicc' | tr '\n' ' ')" "aicc_cp "
    echo "-- install-stack.sh on the promoted host"
    PP="$TMP/rootprod"; mkdir -p "$PP/etc"; printf 'AICC_ENV=production\nAICC_HOSTNAME=www.copilt.org\nAICC_STAGE_ID=%s\n' "$OLDID" > "$PP/etc/aicc-stage-identity"
    IS() { env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$PP" bash "$PROV/install-stack.sh" "$@"; }
    for st in identity edge-env caddyfile enable-edge; do t_rc "install-stack: the stage-only step '$st' is REFUSED on a production identity" 1 IS --only "$st" --production-host --confirm-production --acme-email ops@example.org; done
    t_rc "install-stack: any step on a production identity without --production-host is REFUSED" 1 IS --only logrotate
    t_rc "install-stack: --production-host without --confirm-production is REFUSED" 1 IS --only logrotate --production-host
    t_ok "install-stack: a config step runs on the promoted host with both flags" IS --only logrotate --production-host --confirm-production
    t_ok "install-stack: ...and installed the file under the prefix" test -s "$PP/etc/logrotate.d/aicc-php"
    mkdir -p "$PP/etc/aicc-edge"; printf 'AICC_EDGE_MODE=production\nAICC_ALLOW_INTERNAL_TLS=1\n' > "$PP/etc/aicc-edge/edge.env"
    t_contains "install-stack: enable-timers keeps the cert-expiry timer OFF while the edge is dark (dry-run text)" "$(IS --dry-run --only enable-timers --production-host --confirm-production 2>&1)" "aicc-cert-expiry.timer stays OFF"
    printf 'AICC_EDGE_MODE=production\n' > "$PP/etc/aicc-edge/edge.env"
    t_contains "install-stack: ...and enables it once the internal-TLS flag is gone" "$(IS --dry-run --only enable-timers --production-host --confirm-production 2>&1)" "systemctl enable --now aicc-wp-cron.timer aicc-backup.timer aicc-cert-expiry.timer"
    t_rc "install-stack: a STAGING identity without the flag still works as before (dry-run list)" 0 env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$PFX" bash "$PROV/install-stack.sh" --list-steps
  else t_bad "throwaway mysqld did not start" "$(tail -3 "$M/run.out" | tr '\n' '|')"; fi
else t_skip "apply / rollback against a throwaway database" "Local's mysql 8.4 binaries or jq not found"; fi

t_summary
