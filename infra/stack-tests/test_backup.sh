#!/usr/bin/env bash
# Backup / restore tests. (1) The dump + restore scripts against the rehearsal FIXTURE database ~/aicc-rehearsal/cp (database aicc_rehearsal_cp ONLY, read-only dump;
# the only write is the throwaway database aicc_rehearsal_restore_check, dropped again). (2) The off-host pull script with a stubbed ssh (no network).
# The production-name / real-backup-account path is covered in test_provision.sh against a throwaway server.
# Run: bash infra/stack-tests/test_backup.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; BKP="$REPO/infra/backup"
T_SUITE="backup"; . "$HERE/lib/t.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/abk.XXXX")"; trap 'rm -rf "$TMP"' EXIT
LOCALMY="$HOME/Library/Application Support/Local/lightning-services/mysql-8.4.0+2/bin/darwin-arm64/bin"
FXSOCK="$HOME/aicc-rehearsal/cp/mysql.sock"

echo "== fixture run (database aicc_rehearsal_cp only) =="
if [ -S "$FXSOCK" ] && [ -x "$LOCALMY/mysqldump" ]; then
  FXCNF="$TMP/fx.cnf"; printf '[client]\nuser=root\nsocket=%s\n' "$FXSOCK" > "$FXCNF"; chmod 600 "$FXCNF"
  mkdir -p "$TMP/shared/uploads" "$TMP/edge"; echo up > "$TMP/shared/uploads/a.txt"; echo "<?php define('AICC_ENTITLEMENT_WEBHOOK_SECRET', 'SECRET-MARKER-9f3a');" > "$TMP/shared/wp-config.php"; echo cfg > "$TMP/edge/Caddyfile"; mkdir -p "$TMP/shared/plugin-releases/1.2.0"; echo 1.2.0 > "$TMP/shared/plugin-releases/current"; echo PK > "$TMP/shared/plugin-releases/1.2.0/z.zip"
  # shellcheck disable=SC2046      # the --min-free-pct pair is deliberately word-split
  FX() { MYSQL_BIN="$LOCALMY/mysql" MYSQLDUMP_BIN="$LOCALMY/mysqldump" bash "$BKP/$1" --fixture-test --mysql-defaults-file "$FXCNF" --db aicc_rehearsal_cp --restore-db aicc_rehearsal_restore_check $([ "$1" = aicc-backup.sh ] && echo --min-free-pct 1) "${@:2}"; }  # the tests must not depend on how full the developer disk is: the guard itself is tested with an explicit --min-free-pct 100
  BEFORE="$("$LOCALMY/mysql" --defaults-extra-file="$FXCNF" -N -e "SELECT COUNT(*) FROM aicc_rehearsal_cp.rhsl_options")"
  t_ok "fixture backup succeeds (dump, gzip -t, trailer, restore smoke, files archive)" FX aicc-backup.sh --backup-dir "$TMP/bk" --shared-dir "$TMP/shared" --edge-conf-dir "$TMP/edge" --release-root "$TMP/rel" --label manual
  t_eq "status.json: ok" "$(jq -r .status "$TMP/bk/status.json")" "ok"
  # F-05 (security review B): the rendered wp-config.php (DB password, salts, activation-proof and webhook secrets) must NEVER be in an archive that leaves the host
  FA="$(ls "$TMP"/bk/aicc-files-*.tar.gz | head -1)"
  t_eq "F-05: the files archive does not contain wp-config.php" "$(tar -tzf "$FA" | grep -c 'wp-config' || true)" "0"
  t_eq "F-05: ...and no secret marker appears anywhere in the archive content" "$(mkdir -p "$TMP/x5" && tar -xzf "$FA" -C "$TMP/x5" && { grep -rl 'SECRET-MARKER-9f3a' "$TMP/x5" || true; } | wc -l | tr -d ' ')" "0"
  t_eq "F-05: pointers.txt records only a HASH of the rendered config (re-render from /etc/aicc/secrets on restore)" "$(tar -xOzf "$FA" pointers.txt | grep -c '^wp_config_sha256 [0-9a-f]\{64\}$')" "1"
  t_eq "F-05: ...and not the content" "$(tar -xOzf "$FA" pointers.txt | grep -c 'SECRET-MARKER')" "0"
  t_eq "F-05: the dump of the fixture database holds no marker either" "$(gzip -dc "$TMP"/bk/aicc_rehearsal_cp-*.sql.gz | grep -c 'SECRET-MARKER' || true)" "0"
  t_ok "the files archive carries the private Plugin release store (current pointer + immutable release)" bash -c "tar -tzf \"$TMP\"/bk/aicc-files-*.tar.gz | grep -q 'plugin-releases/current' && tar -tzf \"$TMP\"/bk/aicc-files-*.tar.gz | grep -q 'plugin-releases/1.2.0/z.zip'"
  t_eq "status.json: restore_check ok" "$(jq -r .db_dump.restore_check "$TMP/bk/status.json")" "ok"
  t_eq "status.json: 57 tables restored" "$(jq -r .db_dump.tables "$TMP/bk/status.json")" "$("$LOCALMY/mysql" --defaults-extra-file="$FXCNF" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='aicc_rehearsal_cp'")"
  t_eq "status.json has the keys AICC Ops needs (status, finished_epoch, last_success)" "$(jq -r '[has("status"), has("finished_epoch"), has("last_success")] | all' "$TMP/bk/status.json")" "true"
  t_ok "restore test on the fixture dump" FX aicc-restore-test.sh --backup-dir "$TMP/bk"
  # tiered retention: 10 days of hourly fake sets are pruned to: all of the last 24 h + the newest set of each of the 6 older days within 7 days (+ the real set just made)
  RB="$TMP/bkret"; mkdir -p "$RB"
  python3 - "$RB" <<'PY'
import os, sys, time
d = sys.argv[1]; now = int(time.time())
for h in range(1, 240):                       # 1..239 hours ago
    t = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(now - h * 3600))
    for n in ("aicc_rehearsal_cp-%s-scheduled.sql.gz" % t, "aicc-files-%s-scheduled.tar.gz" % t):
        open(os.path.join(d, n), "w").write("x"); open(os.path.join(d, n + ".sha256"), "w").write("x")
PY
  BEFORE_N="$(ls "$RB"/aicc_rehearsal_cp-*.sql.gz | wc -l | tr -d ' ')"
  t_ok "fixture backup with a pre-filled 10-day hourly history prunes it" FX aicc-backup.sh --backup-dir "$RB" --shared-dir "$TMP/shared" --edge-conf-dir "$TMP/edge" --release-root "$TMP/rel" --label manual
  AFTER_N="$(ls "$RB"/aicc_rehearsal_cp-*.sql.gz | wc -l | tr -d ' ')"
  t_eq "retention: the history shrank from $BEFORE_N hourly sets" "$([ "$AFTER_N" -lt 40 ] && [ "$AFTER_N" -gt 20 ] && echo yes || echo "no ($AFTER_N)")" "yes"
  t_eq "retention: everything from the last 24 h is still there (23 hourly sets + the new one)" "$(find "$RB" -name 'aicc_rehearsal_cp-*.sql.gz' -newermt '-0 sec' >/dev/null 2>&1; python3 - "$RB" <<'PY'
import os, sys, time
d = sys.argv[1]; now = time.time(); n = 0
for f in os.listdir(d):
    if f.startswith("aicc_rehearsal_cp-") and f.endswith(".sql.gz"):
        ts = f.split("-")[1]; ep = time.mktime(time.strptime(ts, "%Y%m%dT%H%M%SZ")) - time.timezone
        if now - ep <= 86400: n += 1
print("yes" if n >= 23 else "no (%d)" % n)
PY
)" "yes"
  t_eq "retention: no file older than 7 days remains" "$(python3 - "$RB" <<'PY'
import os, sys, time
d = sys.argv[1]; now = time.time(); old = 0
for f in os.listdir(d):
    if f.endswith((".sql.gz", ".tar.gz")) and "-20" in f:
        ts = f.split("-")[1] if f.startswith("aicc_rehearsal_cp-") else f.split("-")[2]
        ep = time.mktime(time.strptime(ts, "%Y%m%dT%H%M%SZ")) - time.timezone
        if now - ep > 7 * 86400 + 3600: old += 1
print(old)
PY
)" "0"
  t_eq "retention: sidecars of pruned files are gone too" "$(ls "$RB"/*.sha256 | wc -l | tr -d ' ')" "$(( $(ls "$RB"/*.sql.gz | wc -l | tr -d ' ') + $(ls "$RB"/*.tar.gz | wc -l | tr -d ' ') ))"

  t_eq "the fixture database is unchanged (same row count)" "$("$LOCALMY/mysql" --defaults-extra-file="$FXCNF" -N -e "SELECT COUNT(*) FROM aicc_rehearsal_cp.rhsl_options")" "$BEFORE"
  t_eq "the fixture server has no leftover throwaway database" "$("$LOCALMY/mysql" --defaults-extra-file="$FXCNF" -N -e "SHOW DATABASES LIKE 'aicc_rehearsal_restore_check'")" ""
  t_eq "the fixture server still has exactly its original databases" "$("$LOCALMY/mysql" --defaults-extra-file="$FXCNF" -N -e "SHOW DATABASES" | grep -vE '^(information_schema|mysql|performance_schema|sys)$' | tr '\n' ' ')" "aicc_rehearsal_cp "
  t_rc "FIXTURE GUARD: a database not named aicc_rehearsal* is refused (backup)" 1 env MYSQL_BIN="$LOCALMY/mysql" bash "$BKP/aicc-backup.sh" --fixture-test --mysql-defaults-file "$FXCNF" --db aicc_cp --restore-db aicc_rehearsal_restore_check --backup-dir "$TMP/bk"
  t_rc "FIXTURE GUARD: a restore database not named aicc_rehearsal* is refused" 1 env MYSQL_BIN="$LOCALMY/mysql" bash "$BKP/aicc-backup.sh" --fixture-test --mysql-defaults-file "$FXCNF" --db aicc_rehearsal_cp --restore-db aicc_restore_check --backup-dir "$TMP/bk"
  t_rc "FIXTURE GUARD: the real mysql system schema can never be dumped" 1 env MYSQL_BIN="$LOCALMY/mysql" bash "$BKP/aicc-backup.sh" --fixture-test --mysql-defaults-file "$FXCNF" --db mysql --restore-db aicc_rehearsal_x --backup-dir "$TMP/bk"
  t_rc "FIXTURE GUARD: aicc_rehearsal names are refused WITHOUT --fixture-test" 1 env AICC_TEST_HARNESS=1 MYSQL_BIN="$LOCALMY/mysql" bash "$BKP/aicc-backup.sh" --mysql-defaults-file "$FXCNF" --db aicc_rehearsal_cp --backup-dir "$TMP/bk"
  t_rc "FIXTURE GUARD: an option file outside the rehearsal home / temp dirs is refused" 2 env MYSQL_BIN="$LOCALMY/mysql" bash "$BKP/aicc-backup.sh" --fixture-test --mysql-defaults-file /etc/passwd --db aicc_rehearsal_cp --restore-db aicc_rehearsal_restore_check --backup-dir "$TMP/bk"
  t_rc "without --fixture-test and without root the script refuses (2)" 2 bash "$BKP/aicc-backup.sh" --backup-dir "$TMP/bk"
else t_skip "fixture backup/restore" "rehearsal MySQL fixture not running at $FXSOCK"; fi

echo "== pull-offhost.sh (stubbed ssh) =="
REMOTE="$TMP/remote"; mkdir -p "$REMOTE"; STUB="$TMP/stub"; mkdir -p "$STUB"; CALLS="$TMP/calls.log"; : > "$CALLS"
mkset() { # mkset <ts> -> creates a dump + archive set on the fake remote, writes status.json pointing at it
  local ts="$1" d="aicc_cp-$1-scheduled.sql.gz" f="aicc-files-$1-scheduled.tar.gz"
  printf 'CREATE TABLE t (id int);\n-- Dump completed on %s\n' "$ts" | gzip -c > "$REMOTE/$d"; tar czf "$REMOTE/$f" -C "$TMP" fake-up 2>/dev/null
  echo "$(shasum -a 256 "$REMOTE/$d" | cut -d' ' -f1)  $d" > "$REMOTE/$d.sha256"; echo "$(shasum -a 256 "$REMOTE/$f" | cut -d' ' -f1)  $f" > "$REMOTE/$f.sha256"
  jq -n --arg d "$d" --arg f "$f" --arg ds "$(shasum -a 256 "$REMOTE/$d" | cut -d' ' -f1)" --arg fs "$(shasum -a 256 "$REMOTE/$f" | cut -d' ' -f1)" --argjson e "$(date -u +%s)" \
    '{schema:1,status:"ok",reason:"",finished_epoch:$e,db_dump:{file:$d,sha256:$ds},files_archive:{file:$f,sha256:$fs},last_success:{finished_epoch:$e,db_dump_file:$d,files_archive_file:$f}}' > "$REMOTE/status.json"
}
mkdir -p "$TMP/fake-up"; echo img > "$TMP/fake-up/a.jpg"
printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\n' > "$TMP/ident"
cat > "$STUB/ssh" <<EOS
#!/usr/bin/env bash
# stands in for the restricted account: the real host runs aicc-offhost-serve for whatever command text arrives; the stub does the same with the real script
echo "ssh \$*" >> "$CALLS"
cmd="\${@: -1}"
case "\$cmd" in
  identity) printf 'AICC_ENV=%s\nAICC_HOSTNAME=%s\n' "\${STUB_ENV:-staging}" "\${STUB_HOSTNAME:-stage.copilt.org}"; [ -z "\${STUB_STAGE_ID:-}" ] || echo "AICC_STAGE_ID=\$STUB_STAGE_ID" ;;
  ack\ *) [ "\${STUB_ACK_FAIL:-0}" = 1 ] && exit 1; AICC_TEST_HARNESS=1 AICC_BACKUP_DIR="$REMOTE" bash "$BKP/aicc-offhost-serve.sh" "\$cmd" ;;
  get\ *.sha256) if [ -n "\${STUB_BAD_SIDE:-}" ]; then printf '%s\n' "\$STUB_BAD_SIDE"; else AICC_TEST_HARNESS=1 AICC_BACKUP_DIR="$REMOTE" bash "$BKP/aicc-offhost-serve.sh" "\$cmd"; fi ;;
  get\ *|status)
     if [ "\${STUB_CORRUPT:-0}" = 1 ] && case "\$cmd" in get\ *.sql.gz) true;; *) false;; esac; then (AICC_TEST_HARNESS=1 AICC_BACKUP_DIR="$REMOTE" bash "$BKP/aicc-offhost-serve.sh" "\$cmd"; printf 'X')
     else AICC_TEST_HARNESS=1 AICC_BACKUP_DIR="$REMOTE" AICC_IDENTITY_FILE="$TMP/ident" bash "$BKP/aicc-offhost-serve.sh" "\$cmd"; fi ;;
  *) exit 1 ;;
esac
EOS
chmod +x "$STUB/ssh"
FAKEKEY="$TMP/fake_stage_key"; printf -- '-----BEGIN %s-----\nDUMMY-NOT-A-KEY\n-----END %s-----\n' "OPENSSH PRIVATE KEY" "OPENSSH PRIVATE KEY" > "$FAKEKEY"; chmod 600 "$FAKEKEY"
PRODKEY="$TMP/aicc_digitalocean_prod"; cp "$FAKEKEY" "$PRODKEY"
PULL() { env HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --key "$FAKEKEY" --dest "$TMP/dest" "$@"; }
mkdir -p "$TMP/home/.ssh"
# the pull refuses on a nearly full Mac volume (free-space guard, tested below): the other tests must not depend on how full the developer disk is
export AICC_PULL_MIN_FREE_MB=1 AICC_PULL_MAX_TOTAL_MB=0
mkset 20261021T033012Z
t_rc "no --stage-ip: usage error (the host is never guessed)" 2 PULL
t_rc "production API IP 139.59.157.231 is REFUSED" 3 PULL --stage-ip 139.59.157.231
t_rc "a hostname instead of an IP is REFUSED" 3 PULL --stage-ip stage.copilt.org
t_rc "www.copilt.org as --stage-host is REFUSED" 3 PULL --stage-ip 203.0.113.9 --stage-host www.copilt.org
t_rc "api.copilt.org as --stage-host is REFUSED" 3 PULL --stage-ip 203.0.113.9 --stage-host api.copilt.org
t_rc "the production key is REFUSED" 3 env HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --key "$PRODKEY" --dest "$TMP/dest" --stage-ip 203.0.113.9
t_eq "no ssh call was made by any refusal" "$(wc -l < "$CALLS" | tr -d ' ')" "0"
t_ok "--dry-run makes no ssh call" PULL --stage-ip 203.0.113.9 --dry-run
t_eq "...dry-run: still zero calls" "$(wc -l < "$CALLS" | tr -d ' ')" "0"
STUB_ENV=production t_rc "a host that does not say AICC_ENV=staging is refused" 3 PULL --stage-ip 203.0.113.9
STUB_HOSTNAME=www.copilt.org t_rc "a host with another AICC_HOSTNAME is refused" 3 PULL --stage-ip 203.0.113.9
t_fail "...and nothing was written to the destination" test -e "$TMP/dest/aicc_cp-20261021T033012Z-scheduled.sql.gz"
t_ok "pull succeeds with a verified checksum" PULL --stage-ip 203.0.113.9
t_ok "dump arrived" test -f "$TMP/dest/aicc_cp-20261021T033012Z-scheduled.sql.gz"
t_ok "files archive arrived" test -f "$TMP/dest/aicc-files-20261021T033012Z-scheduled.tar.gz"
t_eq "dest directory is 0700" "$(stat -c %a "$TMP/dest" 2>/dev/null || stat -f %Lp "$TMP/dest")" "700"
t_eq "pulled dump is 0600" "$(stat -c %a "$TMP/dest/aicc_cp-20261021T033012Z-scheduled.sql.gz" 2>/dev/null || stat -f %Lp "$TMP/dest/aicc_cp-20261021T033012Z-scheduled.sql.gz")" "600"
t_ok "local checksum sidecar verifies" bash -c "cd '$TMP/dest' && shasum -a 256 -c aicc_cp-20261021T033012Z-scheduled.sql.gz.sha256"
t_contains "pull.log records the success without any secret" "$(cat "$TMP/dest/pull.log")" "SUCCESS pulled aicc_cp-20261021T033012Z-scheduled.sql.gz"
t_eq "EVERY ssh call used the dedicated key with IdentitiesOnly and BatchMode" "$(grep -vc -e "-i $FAKEKEY -o IdentitiesOnly=yes -o BatchMode=yes" "$CALLS" || true)" "0"
t_eq "no call touched the production IP" "$(grep -c '139.59.157.231' "$CALLS" || true)" "0"
t_ok "a second pull of the same backup is a no-op" PULL --stage-ip 203.0.113.9
t_contains "...reported as already present" "$(cat "$TMP/dest/pull.log")" "already have"
t_ok "the pull recorded an ack on the host (offhost-ack.json)" test -f "$REMOTE/offhost-ack.json"
t_eq "ack: verified true, puller mac-pull, set timestamp of the pulled set" "$(jq -r '[.verified,.puller,.set_ts]|join(",")' "$REMOTE/offhost-ack.json")" "true,mac-pull,20261021T033012Z"
t_eq "ack: carries the sha256 of the pulled dump" "$(jq -r .dump_sha256 "$REMOTE/offhost-ack.json")" "$(shasum -a 256 "$TMP/dest/aicc_cp-20261021T033012Z-scheduled.sql.gz" | cut -d' ' -f1)"
t_ok "the pull wrote a .last-ok marker (0600)" test "$(stat -f %Lp "$TMP/dest/.last-ok" 2>/dev/null || stat -c %a "$TMP/dest/.last-ok")" = 600
t_eq "no lock directory is left behind" "$(ls -d "$TMP"/dest/.pull.lock 2>/dev/null | wc -l | tr -d ' ')" "0"
for ts in 20260822T033012Z 20260823T033012Z 20260824T033012Z; do mkset "$ts"; PULL --stage-ip 203.0.113.9 --keep 2 >/dev/null 2>&1; done
t_eq "retention: only the newest 2 dumps are kept (--keep 2)" "$(ls "$TMP"/dest/aicc_cp-*.sql.gz | wc -l | tr -d ' ')" "2"
t_eq "retention: the sidecars of pruned dumps are gone too" "$(ls "$TMP"/dest/aicc_cp-*.sha256 | wc -l | tr -d ' ')" "2"
t_ok "the newest dump is kept" test -f "$TMP/dest/aicc_cp-20260824T033012Z-scheduled.sql.gz"
mkset 20260825T033012Z
STUB_CORRUPT=1 t_rc "a corrupted transfer is rejected (exit 1)" 1 PULL --stage-ip 203.0.113.9
t_fail "...the corrupted copy was NOT kept" test -f "$TMP/dest/aicc_cp-20260825T033012Z-scheduled.sql.gz"
t_eq "...and no partial file remains" "$(ls "$TMP"/dest/*.partial 2>/dev/null | wc -l | tr -d ' ')" "0"
echo '{"schema":1,"status":"ok","last_success":{"finished_epoch":1,"db_dump_file":"../../etc/passwd","files_archive_file":"x"}}' > "$REMOTE/status.json"
t_rc "a hostile status.json naming a path outside the backup dir is rejected" 1 PULL --stage-ip 203.0.113.9
echo '{"schema":1,"status":"failed","reason":"disk guard","last_success":{"finished_epoch":1}}' > "$REMOTE/status.json"
t_rc "a failed latest run on the host is reported (exit 1)" 1 PULL --stage-ip 203.0.113.9

echo "== pull-offhost.sh against a HOSTILE server (security review F1/F7) =="
mkset 20261021T040000Z
PWNED="$TMP/pwned.flag"; rm -f "$PWNED"
jq --arg c "KEEP[\$(touch $PWNED)]" '.last_success.finished_epoch = $c' "$REMOTE/status.json" > "$REMOTE/status.json.n" && mv "$REMOTE/status.json.n" "$REMOTE/status.json"
t_rc "a finished_epoch carrying a command substitution is rejected (exit 1)" 1 PULL --stage-ip 203.0.113.9
t_fail "...and the command substitution NEVER ran" test -e "$PWNED"
mkset 20261021T040000Z
jq '.last_success.finished_epoch = 99999999999999' "$REMOTE/status.json" > "$REMOTE/status.json.n" && mv "$REMOTE/status.json.n" "$REMOTE/status.json"
t_rc "an out-of-range finished_epoch is rejected" 1 PULL --stage-ip 203.0.113.9
mkset 20991231T000000Z
t_rc "a far-future set name (eviction attack) is rejected" 1 PULL --stage-ip 203.0.113.9
t_fail "...the far-future file was not kept" test -f "$TMP/dest/aicc_cp-20991231T000000Z-scheduled.sql.gz"
mkset 20261021T050000Z; jq '.db_dump.sha256 = "not-a-hash"' "$REMOTE/status.json" > "$REMOTE/status.json.n" && mv "$REMOTE/status.json.n" "$REMOTE/status.json"
t_rc "a malformed hash in status.json is rejected" 1 PULL --stage-ip 203.0.113.9
mkset 20261021T060000Z; jq '.reason = "\u001b[31mREDALERT\u001b]0;x\u0007"' "$REMOTE/status.json" | jq '.status = "failed"' > "$REMOTE/status.json.n" && mv "$REMOTE/status.json.n" "$REMOTE/status.json"
PULL --stage-ip 203.0.113.9 >/dev/null 2>&1 || true
t_eq "pull.log holds no control or escape character from the server" "$(LC_ALL=C grep -c "[^[:print:][:space:]]" "$TMP/dest/pull.log" || true)" "0"
mkset 20261021T070000Z

echo "== pull-offhost.sh: integrity, ack and retention gates (architecture/test review U1-U16) =="
HASH0="$(printf '0%.0s' $(seq 64))"
mkset 20260901T010000Z
STUB_BAD_SIDE="$HASH0" t_rc "a sidecar that differs from the received bytes is refused" 1 PULL --stage-ip 203.0.113.9
t_fail "...nothing was kept" test -f "$TMP/dest/aicc_cp-20260901T010000Z-scheduled.sql.gz"
STUB_BAD_SIDE="zzz" t_rc "a malformed sidecar is refused" 1 PULL --stage-ip 203.0.113.9
jq --arg h "$(printf 'a%.0s' $(seq 64))" '.db_dump.sha256 = $h' "$REMOTE/status.json" > "$REMOTE/status.json.n" && mv "$REMOTE/status.json.n" "$REMOTE/status.json"
t_rc "a hash in status.json that differs from the bytes is refused (even if the sidecar agrees with the bytes)" 1 PULL --stage-ip 203.0.113.9
mkset 20260901T020000Z
printf 'this is not gzip data' > "$REMOTE/aicc_cp-20260901T020000Z-scheduled.sql.gz"; H="$(shasum -a 256 "$REMOTE/aicc_cp-20260901T020000Z-scheduled.sql.gz" | cut -d' ' -f1)"
echo "$H  aicc_cp-20260901T020000Z-scheduled.sql.gz" > "$REMOTE/aicc_cp-20260901T020000Z-scheduled.sql.gz.sha256"; jq --arg h "$H" '.db_dump.sha256 = $h' "$REMOTE/status.json" > "$REMOTE/status.json.n" && mv "$REMOTE/status.json.n" "$REMOTE/status.json"
t_rc "bytes that are not gzip are refused even when every hash agrees" 1 PULL --stage-ip 203.0.113.9
mkset 20260901T030000Z
jq '.status = "failed" | .reason = "disk guard"' "$REMOTE/status.json" > "$REMOTE/status.json.n" && mv "$REMOTE/status.json.n" "$REMOTE/status.json"
t_ok "a failed LATEST run still pulls the last good set (with a warning)" PULL --stage-ip 203.0.113.9
t_contains "...and the log says the host's latest run failed" "$(cat "$TMP/dest/pull.log")" "latest backup run FAILED"
mkset 20260901T040000Z
jq '.last_success.db_dump_file = "evil.sql.gz"' "$REMOTE/status.json" > "$REMOTE/status.json.n" && mv "$REMOTE/status.json.n" "$REMOTE/status.json"
t_rc "a dump name outside the pattern is refused" 1 PULL --stage-ip 203.0.113.9
mkset 20260901T050000Z
jq --argjson e "$(( $(date -u +%s) + 200000 ))" '.last_success.finished_epoch = $e' "$REMOTE/status.json" > "$REMOTE/status.json.n" && mv "$REMOTE/status.json.n" "$REMOTE/status.json"
t_rc "a backup time in the future is refused" 1 PULL --stage-ip 203.0.113.9
mkset 20260901T060000Z
t_rc "a transfer above the size ceiling is refused" 1 env AICC_PULL_MAX_BYTES=10 HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --key "$FAKEKEY" --dest "$TMP/dest" --stage-ip 203.0.113.9
STUB_ACK_FAIL=1 t_rc "a host that does not accept the ack makes the pull FAIL (but keeps the verified copy)" 1 PULL --stage-ip 203.0.113.9
t_ok "...the verified copy was kept" test -f "$TMP/dest/aicc_cp-20260901T060000Z-scheduled.sql.gz"
t_rc "--keep 1 is a usage error" 2 PULL --stage-ip 203.0.113.9 --keep 1
t_rc "--keep abc is a usage error" 2 PULL --stage-ip 203.0.113.9 --keep abc
mkdir -p "$TMP/dest/.pull.lock"; echo 999999 > "$TMP/dest/.pull.lock/pid"
t_ok "a lock of a dead pid is taken over" PULL --stage-ip 203.0.113.9
rm -rf "$TMP/dest/.pull.lock"; mkdir -p "$TMP/dest/.pull.lock"; sleep 30 & SLP=$!; echo $SLP > "$TMP/dest/.pull.lock/pid"
t_rc "a live young lock makes the run exit 4 (skipped, counted by the runner)" 4 PULL --stage-ip 203.0.113.9
touch -t 202601010000 "$TMP/dest/.pull.lock"
t_ok "a lock older than 3 hours is stale even if its pid is alive (pid reuse)" PULL --stage-ip 203.0.113.9
kill $SLP 2>/dev/null; wait $SLP 2>/dev/null
rm -rf "$TMP/dest2"; mkdir -p "$TMP/dest2"; chmod 700 "$TMP/dest2"
python3 - "$TMP/dest2" <<'PY'
import os, sys, time
d = sys.argv[1]; now = int(time.time())
for h in range(2, 24 * 20):
    t = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(now - h * 3600))
    for n in ("aicc_cp-%s-scheduled.sql.gz" % t, "aicc-files-%s-scheduled.tar.gz" % t):
        open(os.path.join(d, n), "w").write("x"); open(os.path.join(d, n + ".sha256"), "w").write("x")
PY
mkset "$(date -u +%Y%m%dT%H%M%SZ)"
env HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --key "$FAKEKEY" --dest "$TMP/dest2" --stage-ip 203.0.113.9 >/dev/null 2>&1
N2="$(ls "$TMP"/dest2/aicc_cp-*.sql.gz | wc -l | tr -d ' ')"
t_eq "tiered retention: 20 days of hourly sets shrink to (24 h hourly + ~14 daily + ~8 weekly)" "$([ "$N2" -ge 30 ] && [ "$N2" -le 50 ] && echo yes || echo "no ($N2)")" "yes"
t_eq "tiered retention: the sets of the last 24 h are still there" "$(ls "$TMP"/dest2/aicc_cp-*.sql.gz | python3 -c '
import sys,time
n=0
for l in sys.stdin:
    ts=l.strip().split("-")[-2]; ep=time.mktime(time.strptime(ts,"%Y%m%dT%H%M%SZ"))-time.timezone
    n+= (time.time()-ep)<=86400
print("yes" if n>=22 else "no (%d)"%n)')" "yes"

echo "== pull-offhost.sh: free-space guard, hard cap, and the runner's disk-full notification (Production 19) =="
mkset 20261102T010000Z
: > "$CALLS"
t_rc "free-space guard: a floor above what the volume has is REFUSED with exit 5" 5 PULL --stage-ip 203.0.113.9 --min-free-mb 999999999
t_eq "...before any ssh call (nothing asked of the host, nothing acknowledged)" "$(wc -l < "$CALLS" | tr -d ' ')" "0"
t_contains "...pull.log says why" "$(tail -2 "$TMP/dest/pull.log")" "below the floor"
t_fail "...the new set was not pulled" test -f "$TMP/dest/aicc_cp-20261102T010000Z-scheduled.sql.gz"
t_rc "--min-free-mb abc is a usage error" 2 PULL --stage-ip 203.0.113.9 --min-free-mb abc
t_rc "--max-total-mb -1 is a usage error" 2 PULL --stage-ip 203.0.113.9 --max-total-mb -1
jq '.db_dump.bytes = 900000000000' "$REMOTE/status.json" > "$REMOTE/status.json.n" && mv "$REMOTE/status.json.n" "$REMOTE/status.json"
: > "$CALLS"
t_rc "free-space guard: a declared size that cannot fit is REFUSED before the transfer (exit 5)" 5 PULL --stage-ip 203.0.113.9 --min-free-mb 1
t_eq "...no 'get <dump>' transfer call was made" "$(grep -c "get aicc_cp-20261102T010000Z-scheduled.sql.gz\$" "$CALLS" || true)" "0"
t_fail "...nothing of the set is kept" test -f "$TMP/dest/aicc_cp-20261102T010000Z-scheduled.sql.gz"
t_contains "...pull.log names the shortfall" "$(tail -2 "$TMP/dest/pull.log")" "not enough free space"
t_eq "...and the host was not told a copy exists (the ack does not name this set)" "$(jq -r .set_ts "$REMOTE/offhost-ack.json" | grep -c 20261102T010000Z || true)" "0"
t_eq "...no lock directory is left behind" "$(ls -d "$TMP"/dest/.pull.lock 2>/dev/null | wc -l | tr -d ' ')" "0"
PWNED2="$TMP/pwned2.flag"; rm -f "$PWNED2"
jq --arg c "\$(touch $PWNED2)" '.db_dump.bytes = $c' "$REMOTE/status.json" > "$REMOTE/status.json.n" && mv "$REMOTE/status.json.n" "$REMOTE/status.json"
t_ok "a declared size that is not a plain number is ignored (a fixed assumption is used) and the pull still works" PULL --stage-ip 203.0.113.9 --min-free-mb 1
t_fail "...and the text from the host was never evaluated" test -e "$PWNED2"
t_ok "...the set arrived" test -f "$TMP/dest/aicc_cp-20261102T010000Z-scheduled.sql.gz"
t_ok "the default floor and cap are documented in the pull script header" bash -c "grep -q 'default 3072, env AICC_PULL_MIN_FREE_MB' '$BKP/pull-offhost.sh' && grep -q 'default 3072, env AICC_PULL_MAX_TOTAL_MB' '$BKP/pull-offhost.sh'"
# hard cap: ten 1 MiB hourly dumps and archives, cap 4 MiB per kind
rm -rf "$TMP/dest3"; mkdir -p "$TMP/dest3"; chmod 700 "$TMP/dest3"
python3 - "$TMP/dest3" <<'PY'
import os, sys, time
d = sys.argv[1]; now = int(time.time())
for h in range(2, 12):
    t = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(now - h * 3600))
    for n in ("aicc_cp-%s-scheduled.sql.gz" % t, "aicc-files-%s-scheduled.tar.gz" % t):
        open(os.path.join(d, n), "wb").write(b"\0" * 1048576); open(os.path.join(d, n + ".sha256"), "w").write("x")
PY
mkset "$(date -u +%Y%m%dT%H%M%SZ)"
t_ok "hard cap: a pull with --max-total-mb 4 succeeds" PULL --dest "$TMP/dest3" --stage-ip 203.0.113.9 --min-free-mb 1 --max-total-mb 4
NC="$(ls "$TMP"/dest3/aicc_cp-*.sql.gz | wc -l | tr -d ' ')"
t_eq "hard cap: the 10 MiB of dumps shrank to about the cap (3 to 6 sets)" "$([ "$NC" -ge 3 ] && [ "$NC" -le 6 ] && echo yes || echo "no ($NC)")" "yes"
t_eq "...the same for the files archives" "$([ "$(ls "$TMP"/dest3/aicc-files-*.tar.gz | wc -l | tr -d ' ')" -le 6 ] && echo yes || echo no)" "yes"
t_eq "...the newest (just pulled) set is among the kept" "$(ls "$TMP"/dest3/aicc_cp-*.sql.gz | sort | tail -1 | xargs basename)" "$(jq -r .last_success.db_dump_file "$REMOTE/status.json")"
t_eq "...pruned sets lose their sidecars too" "$(ls "$TMP"/dest3/aicc_cp-*.sql.gz.sha256 | wc -l | tr -d ' ')" "$NC"
mkset "$(date -u +%Y%m%dT%H%M%SZ)"
t_ok "hard cap: even a cap far below one set never drops below the newest 3" PULL --dest "$TMP/dest3" --stage-ip 203.0.113.9 --min-free-mb 1 --max-total-mb 1
t_eq "...exactly 3 dumps remain" "$(ls "$TMP"/dest3/aicc_cp-*.sql.gz | wc -l | tr -d ' ')" "3"

echo "== offhost-pull-runner.sh: a full Mac disk is notified at once, and a full volume does not silence the runner =="
RN="$TMP/runner"; mkdir -p "$RN/bin" "$RN/dest"
printf '#!/bin/sh\necho "$*" >> "%s/osa.log"\n' "$RN" > "$RN/bin/osascript"; chmod +x "$RN/bin/osascript"
printf '#!/usr/bin/env bash\nexit "${STUB_PULL_RC:-1}"\n' > "$RN/pull.sh"
RUN() { env PATH="$RN/bin:$PATH" STUB_PULL_RC="$1" bash "$BKP/macos/offhost-pull-runner.sh" --pull-script "$RN/pull.sh" --stage-ip 203.0.113.9 --stage-host stage.copilt.org --key "$FAKEKEY" --dest "$RN/dest"; }
nots() { if [ -f "$RN/osa.log" ]; then wc -l < "$RN/osa.log" | tr -d ' '; else echo 0; fi; }
t_rc "runner: one ordinary failure (exit 1) is counted and not notified" 1 RUN 1
t_eq "...no notification yet" "$(nots)" "0"
t_rc "runner: exit 5 (Mac volume too full) still returns 1" 1 RUN 5
t_eq "...and notifies at once, without waiting for 3 failures and 26 h" "$(nots)" "1"
t_contains "...the text names the disk" "$(cat "$RN/osa.log")" "disk is almost full"
t_rc "runner: a second exit 5 within 12 h" 1 RUN 5
t_eq "...is not notified again" "$(nots)" "1"
rm -f "$RN/dest/.last-notified"; rm -rf "$RN/dest/.consecutive-failures"; mkdir -p "$RN/dest/.consecutive-failures"    # a state file that cannot be written, as on a full volume
t_rc "runner: unwritable state files (full volume) do not abort it" 1 RUN 5
t_eq "...the notification was still shown" "$(nots)" "2"
rm -rf "$RN/dest/.consecutive-failures"
t_rc "runner: a pull that succeeds returns 0" 0 RUN 0

echo "== aicc-offhost-serve.sh: what the restricted pull key may and may not do =="
SV() { env AICC_TEST_HARNESS=1 AICC_BACKUP_DIR="$REMOTE" AICC_IDENTITY_FILE="$TMP/ident" bash "$BKP/aicc-offhost-serve.sh" "$@"; }
mkset 20260830T033012Z
D1="aicc_cp-20260830T033012Z-scheduled.sql.gz"; F1="aicc-files-20260830T033012Z-scheduled.tar.gz"
DS="$(awk '{print $1}' "$REMOTE/$D1.sha256")"; FS="$(awk '{print $1}' "$REMOTE/$F1.sha256")"
echo secret > "$REMOTE/wp-config.php"; echo log > "$REMOTE/backup.log"
t_ok "identity works" SV identity
t_ok "status works" SV status
t_ok "get of a backup file works" SV "get $D1"
t_ok "get of a checksum sidecar works" SV "get $D1.sha256"
t_rc "no command at all (an interactive login) is refused" 3 SV ""
t_rc "an unknown operation is refused" 3 SV "shell"
t_rc "get with a path is refused" 3 SV "get ../../etc/passwd"
t_rc "get of backup.log (not a backup file) is refused" 3 SV "get backup.log"
t_rc "get of a file that matches no pattern is refused" 3 SV "get wp-config.php"
t_rc "shell metacharacters are refused" 3 SV "get $D1; id"
t_rc "command substitution is refused" 3 SV 'get $(id)'
t_rc "a newline in the command is refused" 3 SV "$(printf 'status\nid')"
t_rc "get with two files is refused" 3 SV "get $D1 $F1"
t_rc "a pre-existing symlink under a valid name is refused" 3 bash -c "ln -sf /etc/passwd '$REMOTE/aicc_cp-20260831T033012Z-manual.sql.gz'; AICC_TEST_HARNESS=1 AICC_BACKUP_DIR='$REMOTE' bash '$BKP/aicc-offhost-serve.sh' 'get aicc_cp-20260831T033012Z-manual.sql.gz'"
rm -f "$REMOTE/offhost-ack.json"
t_rc "ack with a wrong dump hash is refused" 3 SV "ack 20260830T033012Z $D1 $(printf '0%.0s' $(seq 64)) $F1 $FS"
t_fail "...and wrote nothing" test -f "$REMOTE/offhost-ack.json"
t_rc "ack naming a set that does not exist is refused" 3 SV "ack 20271111T000000Z aicc_cp-20271111T000000Z-manual.sql.gz $DS - -"
t_rc "ack with a dump from another set is refused" 3 SV "ack 20261029T033012Z $D1 $DS - -"
t_rc "ack with a malformed hash is refused" 3 SV "ack 20260830T033012Z $D1 zzz - -"
t_rc "ack with a wrong FILES hash is refused" 3 SV "ack 20260830T033012Z $D1 $DS $F1 $HASH0"
t_rc "ack naming a files archive of ANOTHER set is refused" 3 SV "ack 20260830T033012Z $D1 $DS aicc-files-20260829T033012Z-scheduled.tar.gz $FS"
t_rc "ack with files '-' but a files hash is refused" 3 SV "ack 20260830T033012Z $D1 $DS - $FS"
t_rc "ack naming a .sql.gz as the files archive is refused" 3 SV "ack 20260830T033012Z $D1 $DS $D1 $FS"
t_rc "ack naming a .tar.gz as the dump is refused" 3 SV "ack 20260830T033012Z $F1 $FS - -"
t_ok "a correct ack is recorded" SV "ack 20260830T033012Z $D1 $DS $F1 $FS"
t_eq "...with the host's own timestamp and verified=true" "$(jq -r '[.verified,(.acked_at>1700000000)]|join(",")' "$REMOTE/offhost-ack.json")" "true,true"
t_ok "a database-only ack (files -) is accepted" SV "ack 20260830T033012Z $D1 $DS - -"
t_eq "...and records files as -" "$(jq -r .files "$REMOTE/offhost-ack.json")" "-"

echo "== install-offhost-access.sh (file generation only, --root seam) =="
IO="$TMP/io"; mkdir -p "$IO"
ssh-keygen -q -t ed25519 -N "" -f "$TMP/okey" -C test >/dev/null 2>&1 && OK_KEY=1 || OK_KEY=0
if [ "$OK_KEY" = 1 ]; then
  t_ok "installs into a scratch root" env AICC_TEST_HARNESS=1 bash "$BKP/install-offhost-access.sh" --root "$IO" --pubkey-file "$TMP/okey.pub"
  t_contains "authorized_keys: restrict + forced sudo of the one script" "$(cat "$IO/var/lib/aicc-offhost/.ssh/authorized_keys")" 'restrict,command="/usr/bin/sudo -n /usr/local/sbin/aicc-offhost-serve'
  t_not_contains "authorized_keys holds no private material" "$(cat "$IO/var/lib/aicc-offhost/.ssh/authorized_keys")" "PRIVATE"
  t_eq "authorized_keys is 0644 (root-owned on a real host: the account can read it, not change it)" "$(stat -f %Lp "$IO/var/lib/aicc-offhost/.ssh/authorized_keys" 2>/dev/null || stat -c %a "$IO/var/lib/aicc-offhost/.ssh/authorized_keys")" "644"
  t_contains "sudoers: exactly the one script" "$(cat "$IO/etc/sudoers.d/aicc-offhost")" "aicc-offhost ALL=(root) NOPASSWD: /usr/local/sbin/aicc-offhost-serve *"
  t_eq "sudoers has no ALL command grant" "$(grep -c 'NOPASSWD: ALL' "$IO/etc/sudoers.d/aicc-offhost" || true)" "0"
  t_eq "sudoers is 0440" "$(stat -f %Lp "$IO/etc/sudoers.d/aicc-offhost" 2>/dev/null || stat -c %a "$IO/etc/sudoers.d/aicc-offhost")" "440"
  for kw in "ForceCommand" "PermitTTY no" "AllowTcpForwarding no" "PasswordAuthentication no" "AllowAgentForwarding no" "PermitTunnel no"; do t_contains "sshd drop-in: $kw" "$(cat "$IO/etc/ssh/sshd_config.d/06-aicc-offhost.conf")" "$kw"; done
  t_ok "the installed serve script is the repo's" cmp -s "$BKP/aicc-offhost-serve.sh" "$IO/usr/local/sbin/aicc-offhost-serve"
  t_ok "a second run is idempotent" env AICC_TEST_HARNESS=1 bash "$BKP/install-offhost-access.sh" --root "$IO" --pubkey-file "$TMP/okey.pub"
  t_ok "--dry-run changes nothing" env AICC_TEST_HARNESS=1 bash "$BKP/install-offhost-access.sh" --root "$TMP/io-dry" --pubkey-file "$TMP/okey.pub" --dry-run
  t_fail "...(no scratch root was created by the dry run)" test -e "$TMP/io-dry"
  t_rc "a PRIVATE key file is refused" 3 env AICC_TEST_HARNESS=1 bash "$BKP/install-offhost-access.sh" --root "$IO" --pubkey-file "$TMP/okey"
  t_rc "a missing key file is a usage error" 2 env AICC_TEST_HARNESS=1 bash "$BKP/install-offhost-access.sh" --root "$IO" --pubkey-file "$TMP/nokey"
  t_rc "--root without the test harness is refused" 2 bash "$BKP/install-offhost-access.sh" --root "$IO" --pubkey-file "$TMP/okey.pub"
  t_rc "without root and without a seam the installer refuses" 2 bash "$BKP/install-offhost-access.sh" --pubkey-file "$TMP/okey.pub"
  t_ok "--remove removes the generated files" env AICC_TEST_HARNESS=1 bash "$BKP/install-offhost-access.sh" --root "$IO" --remove
  t_fail "...the sudoers file is gone" test -e "$IO/etc/sudoers.d/aicc-offhost"
else t_skip "install-offhost-access tests" "ssh-keygen unavailable"; fi

echo "== aicc-restore.sh verify: hostile archives and dumps (security review F3/F4) =="
RS="$TMP/restore"; mkdir -p "$RS"; IDF="$RS/ident"; printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\nAICC_STAGE_ID=%s\n' "$(printf 'a%.0s' $(seq 32))" > "$IDF"
WANTID="$(tr '\n' ' ' < "$IDF" | sed 's/ *$//')"
python3 - "$RS" "$WANTID" <<'PY'
import io, sys, tarfile, gzip, hashlib, os
d, ident = sys.argv[1], sys.argv[2]
def add(t, name, data=b"x", typ=tarfile.REGTYPE, link=""):
    ti = tarfile.TarInfo(name); ti.type = typ; ti.linkname = link; ti.mode = 0o644
    if typ == tarfile.REGTYPE: ti.size = len(data); t.addfile(ti, io.BytesIO(data))
    else: t.addfile(ti)
def make(fn, members, pointers):
    with tarfile.open(os.path.join(d, fn), "w:gz") as t:
        for m in members: add(t, *m)
        if pointers is not None: add(t, "pointers.txt", pointers.encode())
good = [("srv/aicc/shared/wp-config.php", b"<?php"), ("srv/aicc/shared/uploads/a.jpg", b"img")]
make("good.tgz", good, "# x\nhost_identity " + ident + "\n")
make("withreleases.tgz", good + [("srv/aicc/shared/plugin-releases/current", b"1.2.0\n"), ("srv/aicc/shared/plugin-releases/1.2.0/ai-commerce-copilot-1.2.0.zip", b"PK")], "host_identity " + ident + "\n")
make("badrelease.tgz", good + [("srv/aicc/shared/plugin-releases-evil/x", b"x")], "host_identity " + ident + "\n")
make("hardlink.tgz", good + [("srv/aicc/shared/uploads/h", b"", tarfile.LNKTYPE, "etc/shadow")], "host_identity " + ident + "\n")
make("symlink.tgz", good + [("srv/aicc/shared/uploads/l", b"", tarfile.SYMTYPE, "/etc")], "host_identity " + ident + "\n")
make("abspath.tgz", good + [("/etc/cron.d/x", b"x")], "host_identity " + ident + "\n")
make("dotdot.tgz", good + [("srv/aicc/shared/uploads/../../../../etc/x", b"x")], "host_identity " + ident + "\n")
make("outside.tgz", good + [("etc/passwd", b"x")], "host_identity " + ident + "\n")
make("foreign.tgz", good, "host_identity AICC_ENV=production AICC_HOSTNAME=www.copilt.org AICC_STAGE_ID=" + "b"*32 + "\n")
make("noident.tgz", good, "# no identity line\n")
for n, body in (("good.sql.gz", b"CREATE TABLE t (i int);\n-- Dump completed on x\n"), ("notrailer.sql.gz", b"CREATE TABLE t (i int);\n")):
    with gzip.open(os.path.join(d, n), "wb") as f: f.write(body)
PY
RV() { env AICC_TEST_HARNESS=1 AICC_IDENTITY_FILE="$IDF" bash "$BKP/aicc-restore.sh" verify "$@"; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
DG="$RS/good.sql.gz"; DH="$(sha "$DG")"
t_ok "an archive that carries the private Plugin release store verifies (plugin-releases is an allowed root)" RV --dump "$DG" --sha256 "$DH" --files "$RS/withreleases.tgz" --files-sha256 "$(sha "$RS/withreleases.tgz")"
t_fail "a look-alike root (plugin-releases-evil) is still refused" RV --dump "$DG" --sha256 "$DH" --files "$RS/badrelease.tgz" --files-sha256 "$(sha "$RS/badrelease.tgz")"
t_ok "F-05: restore never extracts wp-config.php from an archive and re-renders a missing one (text gate; live restore only runs on the host)" bash -c "grep -q -- '--exclude=srv/aicc/shared/wp-config.php' '$BKP/aicc-restore.sh' && grep -q 'aicc-render-wp-config' '$BKP/aicc-restore.sh' && grep -q 'run_step wpconfig s_wpconfig' '$BKP/aicc-restore.sh'"
t_ok "restore only replaces the release store when the archive has one (text gate)" bash -c "grep -q \"plugin-releases/'; then rm -rf\" '$BKP/aicc-restore.sh'"
t_ok "a clean dump and archive verify" RV --dump "$DG" --sha256 "$DH" --files "$RS/good.tgz" --files-sha256 "$(sha "$RS/good.tgz")"
t_rc "verify without an out-of-band hash is refused" 1 RV --dump "$DG" --files none
t_rc "a wrong dump hash is refused" 1 RV --dump "$DG" --sha256 "$(printf '0%.0s' $(seq 64))" --files none
t_rc "a dump without the completion trailer is refused" 1 RV --dump "$RS/notrailer.sql.gz" --sha256 "$(sha "$RS/notrailer.sql.gz")" --files none
for bad in hardlink symlink abspath dotdot outside foreign noident; do
  t_rc "a $bad archive is refused" 1 RV --dump "$DG" --sha256 "$DH" --files "$RS/$bad.tgz" --files-sha256 "$(sha "$RS/$bad.tgz")"
done
t_ok "...but an archive without identity is accepted when the operator says so knowingly" RV --dump "$DG" --sha256 "$DH" --files "$RS/noident.tgz" --files-sha256 "$(sha "$RS/noident.tgz")" --allow-no-identity
t_rc "a wrong files hash is refused" 1 RV --dump "$DG" --sha256 "$DH" --files "$RS/good.tgz" --files-sha256 "$(printf '1%.0s' $(seq 64))"
t_rc "live restore without --yes-replace-live is refused" 3 env AICC_TEST_HARNESS=1 AICC_IDENTITY_FILE="$IDF" bash "$BKP/aicc-restore.sh" live --dump "$DG" --files none
t_rc "live restore without out-of-band hashes is refused (before anything runs)" 3 env AICC_TEST_HARNESS=1 AICC_IDENTITY_FILE="$IDF" bash "$BKP/aicc-restore.sh" live --dump "$DG" --files none --yes-replace-live
t_rc "live restore WITH hashes but without --yes-replace-live is still refused" 3 env AICC_TEST_HARNESS=1 AICC_IDENTITY_FILE="$IDF" bash "$BKP/aicc-restore.sh" live --dump "$DG" --sha256 "$DH" --files none
t_rc "live restore of a files archive needs --files-sha256 too" 3 env AICC_TEST_HARNESS=1 AICC_IDENTITY_FILE="$IDF" bash "$BKP/aicc-restore.sh" live --dump "$DG" --sha256 "$DH" --files "$RS/good.tgz" --yes-replace-live
t_rc "a database name that is not aicc_* is refused" 3 env AICC_TEST_HARNESS=1 bash "$BKP/aicc-restore.sh" fingerprint --db 'mysql' --out "$RS/x.fp"
t_rc "a database name with SQL metacharacters is refused" 3 env AICC_TEST_HARNESS=1 bash "$BKP/aicc-restore.sh" fingerprint --db 'aicc_x;drop' --out "$RS/x.fp"
t_rc "without root and without the test harness the restore tool refuses (2)" 2 bash "$BKP/aicc-restore.sh" verify --dump "$DG" --sha256 "$DH"
t_rc "a scratch database name outside aicc_dr_* is refused" 3 env AICC_TEST_HARNESS=1 bash "$BKP/aicc-restore.sh" scratch --dump "$DG" --scratch-db aicc_cp
if [ -S "$FXSOCK" ] && [ -x "$LOCALMY/mysql" ]; then
  HOSTILE="aicc_rehearsal_dr_hostile"
  M() { "$LOCALMY/mysql" --defaults-extra-file="$FXCNF" "$@"; }
  { echo "DROP DATABASE IF EXISTS $HOSTILE; CREATE DATABASE $HOSTILE;"; echo 'CREATE TABLE '"$HOSTILE"'.`ok_table` (i int);'; echo 'CREATE TABLE '"$HOSTILE"'.`x``;select 1;--` (i int);'; } > "$RS/h.sql"
  M < "$RS/h.sql" 2>/dev/null
  t_eq "(the hostile test database really holds the odd table name)" "$(M -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$HOSTILE'")" "2"
  t_rc "fingerprint REFUSES a table whose name could break out of the SQL (backtick/semicolon)" 1 env AICC_TEST_HARNESS=1 MYSQL_BIN="$LOCALMY/mysql" bash "$BKP/aicc-restore.sh" fingerprint --db "$HOSTILE" --mysql-defaults-file "$FXCNF" --out "$RS/h.fp"
  M -e "DROP DATABASE IF EXISTS $HOSTILE" 2>/dev/null
  t_ok "fingerprint works on a normal database (the rehearsal fixture, read-only)" env AICC_TEST_HARNESS=1 MYSQL_BIN="$LOCALMY/mysql" bash "$BKP/aicc-restore.sh" fingerprint --db aicc_rehearsal_cp --mysql-defaults-file "$FXCNF" --out "$RS/f.fp"
  t_eq "...every table has three columns (name, rows, checksum)" "$(awk -F'\t' 'NF==3' "$RS/f.fp" | wc -l | tr -d ' ')" "$(M -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='aicc_rehearsal_cp' AND table_type='BASE TABLE'")"
  t_eq "...and the throwaway database is gone" "$(M -N -e "SHOW DATABASES LIKE 'aicc_rehearsal_dr_hostile'")" ""
else t_skip "fingerprint tests against MySQL" "rehearsal MySQL fixture not running"; fi

echo "== PRODUCTION-mode backup identity: pull-offhost.sh --env production, the production LaunchAgent, restore and drill gates (stubs; nothing leaves this machine) =="
RK="$TMP/recipient-private.pem"; RC="$TMP/recipient-cert.pem"
openssl req -x509 -newkey rsa:3072 -nodes -keyout "$RK" -out "$RC" -subj "/CN=aicc-backup-recipient-test" -days 30 >/dev/null 2>&1
PID32=0123456789abcdef0123456789abcdef; PKEY="$TMP/aicc_cp_prod_offhost"; cp "$FAKEKEY" "$PKEY"; PKH="$TMP/known_hosts_aicc_prod_cp"
echo "203.0.113.9 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItestonlytestonlytestonlytestonlytestonlytest" > "$PKH"
: > "$CALLS"
PPULL() { env HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --env production --key "$PKEY" --known-hosts "$PKH" --dest "$TMP/destp" --encrypt-to "$RC" "$@"; }
t_rc "production pull: no --expect-id is REFUSED" 3 PPULL --stage-ip 203.0.113.9
t_rc "production pull: a malformed --expect-id is REFUSED" 3 PPULL --stage-ip 203.0.113.9 --expect-id nothex
t_rc "production pull: a stage host name is REFUSED" 3 PPULL --stage-ip 203.0.113.9 --expect-id "$PID32" --stage-host stage.copilt.org
t_rc "production pull: api.copilt.org is REFUSED" 3 PPULL --stage-ip 203.0.113.9 --expect-id "$PID32" --stage-host api.copilt.org
t_rc "production pull: the STAGING pull key name is REFUSED" 3 env HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --env production --key "$FAKEKEY" --known-hosts "$PKH" --dest "$TMP/destp" --stage-ip 203.0.113.9 --expect-id "$PID32"
t_rc "production pull: the API Droplet's key is REFUSED" 3 env HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --env production --key "$PRODKEY" --known-hosts "$PKH" --dest "$TMP/destp" --stage-ip 203.0.113.9 --expect-id "$PID32"
t_rc "production pull: the API Droplet address is REFUSED" 3 PPULL --stage-ip 139.59.157.231 --expect-id "$PID32"
t_rc "production pull: a missing pinned known-hosts file is REFUSED (no trust on first use)" 3 env HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --env production --key "$PKEY" --known-hosts "$TMP/nope" --dest "$TMP/destp" --stage-ip 203.0.113.9 --expect-id "$PID32"
echo "other.example ssh-ed25519 AAAAxx" > "$TMP/known_other_p"
t_rc "production pull: a known-hosts file without an entry for the address is REFUSED" 3 env HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --env production --key "$PKEY" --known-hosts "$TMP/known_other_p" --dest "$TMP/destp" --stage-ip 203.0.113.9 --expect-id "$PID32"
t_rc "stage mode: the production pull key name is REFUSED" 3 env HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --key "$PKEY" --dest "$TMP/dest" --stage-ip 203.0.113.9
t_rc "an unknown --env is a usage error" 2 PPULL --env qa --stage-ip 203.0.113.9
t_eq "none of the refusals made an ssh call" "$(wc -l < "$CALLS" | tr -d ' ')" "0"
t_ok "production --dry-run makes no ssh call and names the production identity" bash -c "PATH='$STUB':\$PATH HOME='$TMP/home' bash '$BKP/pull-offhost.sh' --env production --key '$PKEY' --known-hosts '$PKH' --dest '$TMP/destp' --encrypt-to '$RC' --stage-ip 203.0.113.9 --expect-id $PID32 --dry-run | grep -q 'verify the production identity (www.copilt.org)'"
t_eq "...(zero calls)" "$(wc -l < "$CALLS" | tr -d ' ')" "0"
printf 'AICC_ENV=production\nAICC_HOSTNAME=www.copilt.org\nAICC_STAGE_ID=%s\n' "$PID32" > "$TMP/ident"
mkset 20261022T210000Z
STUB_ENV=staging STUB_HOSTNAME=stage.copilt.org STUB_STAGE_ID="$PID32" t_rc "production pull: a host that still says STAGING is refused (no data pulled)" 3 PPULL --stage-ip 203.0.113.9 --expect-id "$PID32"
STUB_ENV=production STUB_HOSTNAME=www.copilt.org STUB_STAGE_ID=ffffffffffffffffffffffffffffffff t_rc "production pull: a host with ANOTHER id is refused" 3 PPULL --stage-ip 203.0.113.9 --expect-id "$PID32"
STUB_ENV=production STUB_HOSTNAME=stage.copilt.org STUB_STAGE_ID="$PID32" t_rc "production pull: a production host with another name is refused" 3 PPULL --stage-ip 203.0.113.9 --expect-id "$PID32"
t_fail "...nothing reached the production destination" test -e "$TMP/destp/aicc_cp-20261022T210000Z-scheduled.sql.gz"
STUB_ENV=production STUB_HOSTNAME=www.copilt.org STUB_STAGE_ID="$PID32" t_ok "production pull succeeds against the matching identity" PPULL --stage-ip 203.0.113.9 --expect-id "$PID32"
t_ok "production pull: the verified dump is in the PRODUCTION directory (0700, as ciphertext), not the staging one" bash -c "test -f '$TMP/destp/aicc_cp-20261022T210000Z-scheduled.sql.gz.cms' && [ \"\$(stat -f %Lp '$TMP/destp' 2>/dev/null || stat -c %a '$TMP/destp')\" = 700 ] && ! test -e '$TMP/dest/aicc_cp-20261022T210000Z-scheduled.sql.gz'"
t_eq "production pull: every ssh call pinned the host key (StrictHostKeyChecking=yes, the pinned file)" "$(grep -c "StrictHostKeyChecking=yes -o UserKnownHostsFile=$PKH" "$CALLS")/$(grep -vc "StrictHostKeyChecking=yes -o UserKnownHostsFile=$PKH" "$CALLS" || true)" "$(grep -c '^ssh ' "$CALLS")/0"
t_eq "production pull: the ack names the production set" "$(jq -r '[.verified,.set_ts]|join(",")' "$REMOTE/offhost-ack.json")" "true,20261022T210000Z"
printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\n' > "$TMP/ident"
: > "$CALLS"; mkset 20261022T220000Z
t_ok "staging pull: still works exactly as before (default key, default directory names)" PULL --stage-ip 203.0.113.9
t_eq "staging pull: still accept-new against the STAGING known_hosts file (unchanged behaviour)" "$(grep -c 'StrictHostKeyChecking=accept-new -o UserKnownHostsFile=.*known_hosts_aicc_stage' "$CALLS")/$(grep -c '^ssh ' "$CALLS")" "$(grep -c '^ssh ' "$CALLS")/$(grep -c '^ssh ' "$CALLS")"

# the production LaunchAgent (DRY-RUN only: the installer is never applied by a test)
IL="$BKP/macos/install-launchd.sh"
ILD() { env HOME="$TMP/home" bash "$IL" "$@"; }
t_rc "launchd production: a missing --expect-id is refused" 1 ILD --env production --stage-ip 203.0.113.9 --key "$PKEY" --known-hosts "$PKH" --dest "$TMP/destp"
t_rc "launchd production: the staging key name is refused" 1 ILD --env production --stage-ip 203.0.113.9 --expect-id "$PID32" --key "$FAKEKEY" --known-hosts "$PKH" --dest "$TMP/destp"
t_rc "launchd production: an unpinned host is refused" 1 ILD --env production --stage-ip 203.0.113.9 --expect-id "$PID32" --key "$PKEY" --known-hosts "$TMP/nope" --dest "$TMP/destp"
t_rc "launchd stage: the production key name is refused" 1 ILD --stage-ip 203.0.113.9 --key "$PKEY" --dest "$TMP/dest"
OUTL="$(ILD --env production --stage-ip 203.0.113.9 --expect-id "$PID32" --key "$PKEY" --known-hosts "$PKH" --dest "$TMP/destp" --encrypt-to "$RC" 2>&1)"; rcl=$?
t_eq "launchd production dry-run exits 0" "$rcl" "0"
t_contains "launchd production: its own label (the staging agent is untouched)" "$OUTL" "com.aicc.offhost-pull.production"
t_contains "launchd production: the plist passes --env production and the id" "$OUTL" "<string>--expect-id</string><string>$PID32</string>"
t_contains "launchd production: its own support and log directories" "$OUTL" "aicc-offhost-pull-production"
t_contains "launchd production: says plainly it is not 24/7" "$OUTL" "NOT 24/7"
t_not_contains "launchd production: dry-run changed nothing" "$OUTL" "DO    "
t_not_contains "launchd production: no secret in the plist" "$OUTL" "PRIVATE KEY"
OUTS="$(ILD --stage-ip 203.0.113.9 --key "$FAKEKEY" --dest "$TMP/dest" 2>&1)"
t_contains "launchd stage dry-run keeps the staging label" "$OUTS" "<key>Label</key><string>com.aicc.offhost-pull</string>"
t_not_contains "launchd stage dry-run has no production arguments" "$OUTS" "--expect-id"

# host-side tools
t_ok "aicc-restore.sh: --production is understood (verify on a prefix identity under the harness)" bash -c "grep -q -- '--production' '$BKP/aicc-restore.sh' && grep -q 'confirm-production-restore' '$BKP/aicc-restore.sh'"
t_ok "aicc-restore.sh: the staging path still refuses a production identity without --production (text gate)" bash -c "grep -q 'on the production host pass --production' '$BKP/aicc-restore.sh'"
t_ok "aicc-restore.sh: the loopback health self-check no longer verifies Caddy's internal certificate" bash -c "grep -q 'curl -sk' '$BKP/aicc-restore.sh'"
t_ok "install-offhost-access.sh: production needs --env production AND --confirm-production, and still checks the identity file (text gate: the real path needs root on the host)" bash -c "grep -q 'AICC_ENV=\$ENVN' '$BKP/install-offhost-access.sh' && grep -q 'needs --confirm-production' '$BKP/install-offhost-access.sh'"
DD() { bash "$BKP/dr-drill.sh" "$@"; }
t_rc "dr-drill production: the staging confirmation flag is refused" 3 DD --env production --stage-ip 203.0.113.9 --stage-host www.copilt.org --stage-id "$PID32" --tls dark --known-hosts "$PKH" --key "$PKEY" --offhost-key "$PKEY" --i-understand-this-wipes-staging-data
t_rc "dr-drill production: no destructive confirmation is refused" 3 DD --env production --stage-ip 203.0.113.9 --stage-host www.copilt.org --stage-id "$PID32" --tls dark --known-hosts "$PKH" --key "$PKEY" --offhost-key "$PKEY"
t_rc "dr-drill production: a stage host name is refused" 3 DD --env production --stage-ip 203.0.113.9 --stage-host stage.copilt.org --stage-id "$PID32" --tls dark --known-hosts "$PKH" --key "$PKEY" --offhost-key "$PKEY" --i-understand-this-wipes-production-data
t_rc "dr-drill production: the staging operator key name is refused" 3 DD --env production --stage-ip 203.0.113.9 --stage-host www.copilt.org --stage-id "$PID32" --tls dark --known-hosts "$PKH" --key "$FAKEKEY" --offhost-key "$PKEY" --i-understand-this-wipes-production-data
t_rc "dr-drill production: --tls is required (usage error)" 2 DD --env production --stage-ip 203.0.113.9 --stage-host www.copilt.org --stage-id "$PID32" --known-hosts "$PKH" --key "$PKEY" --offhost-key "$PKEY" --i-understand-this-wipes-production-data
t_rc "dr-drill stage: a production key name is refused" 3 DD --stage-ip 203.0.113.9 --stage-host stage.copilt.org --stage-id "$PID32" --key "$PKEY" --offhost-key "$PKEY" --i-understand-this-wipes-staging-data
t_ok "dr-drill production --dry-run sends nothing" DD --encrypt-to "$RC" --decrypt-key "$RK" --env production --stage-ip 203.0.113.9 --stage-host www.copilt.org --stage-id "$PID32" --tls dark --known-hosts "$PKH" --key "$PKEY" --offhost-key "$PKEY" --dry-run
t_ok "dr-drill: the customer/order guard fails closed (text gate: refuses when it cannot read the counts)" bash -c "grep -q 'cannot determine whether the production database holds customers or orders' '$BKP/dr-drill.sh' && grep -q 'only allowed before the first customer' '$BKP/dr-drill.sh'"

echo "== F-05: the Mac keeps ONLY ciphertext (CMS to a recipient certificate whose private half is not on the pull path) =="
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/weak.key" -out "$TMP/weak.pem" -subj "/CN=weak" -days 30 >/dev/null 2>&1
openssl req -x509 -newkey rsa:3072 -nodes -keyout "$TMP/old.key" -out "$TMP/expired.pem" -subj "/CN=old" -days 1 -not_after 20200101000000Z >/dev/null 2>&1 || openssl req -x509 -newkey rsa:3072 -nodes -keyout "$TMP/old.key" -out "$TMP/expired.pem" -subj "/CN=old" -days 0 >/dev/null 2>&1
cat "$RC" "$RK" > "$TMP/cert-with-key.pem"
printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\n' > "$TMP/ident"
mkset 20261023T010000Z
EPULL() { env HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --key "$FAKEKEY" --dest "$TMP/destenc" --stage-ip 203.0.113.9 "$@"; }
t_rc "encrypt-to: a missing certificate file is REFUSED" 3 EPULL --encrypt-to "$TMP/none.pem"
t_rc "encrypt-to: a file that is not a certificate is REFUSED" 3 EPULL --encrypt-to "$FAKEKEY"
t_rc "encrypt-to: a PRIVATE KEY (even next to the certificate) is REFUSED: the private half must not be on the pull path" 3 EPULL --encrypt-to "$TMP/cert-with-key.pem"
t_rc "encrypt-to: an RSA key under 3072 bits is REFUSED" 3 EPULL --encrypt-to "$TMP/weak.pem"
t_rc "encrypt-to: an expired certificate is REFUSED" 3 EPULL --encrypt-to "$TMP/expired.pem"
t_ok "encrypted pull succeeds" EPULL --encrypt-to "$RC"
D1="aicc_cp-20261023T010000Z-scheduled.sql.gz"; F1="aicc-files-20261023T010000Z-scheduled.tar.gz"
t_ok "the Mac holds the dump ONLY as ciphertext (.cms)" test -s "$TMP/destenc/$D1.cms"
t_fail "...no plaintext dump at rest" test -e "$TMP/destenc/$D1"
t_ok "...the files archive too" test -s "$TMP/destenc/$F1.cms"
t_fail "...no plaintext files archive at rest" test -e "$TMP/destenc/$F1"
t_eq "...no .partial plaintext temp is left behind" "$(ls "$TMP"/destenc/*.partial 2>/dev/null | wc -l | tr -d ' ')" "0"
t_eq "...ciphertext is not gzip (nothing readable at rest)" "$(gzip -t "$TMP/destenc/$D1.cms" 2>/dev/null && echo gzip || echo opaque)" "opaque"
t_eq "...the sidecar records the PLAINTEXT sha256 (verification stays possible after decryption)" "$(awk '{print $1}' "$TMP/destenc/$D1.cms.sha256")" "$(shasum -a 256 "$REMOTE/$D1" | cut -d' ' -f1)"
t_eq "...file modes are 0600" "$(stat -f %Lp "$TMP/destenc/$D1.cms" 2>/dev/null || stat -c %a "$TMP/destenc/$D1.cms")" "600"
t_eq "...the host got the ack with the plaintext hashes of the set" "$(jq -r '.dump_sha256' "$REMOTE/offhost-ack.json")" "$(shasum -a 256 "$REMOTE/$D1" | cut -d' ' -f1)"
t_ok "decrypt-offhost.sh with the PRIVATE key restores the exact plaintext (hash checked against the sidecar)" bash "$BKP/decrypt-offhost.sh" --key "$RK" --in "$TMP/destenc/$D1.cms" --out "$TMP/dec-dump.sql.gz"
t_ok "...byte-identical to the host's file" cmp "$TMP/dec-dump.sql.gz" "$REMOTE/$D1"
t_ok "...and the files archive" bash "$BKP/decrypt-offhost.sh" --key "$RK" --in "$TMP/destenc/$F1.cms" --out "$TMP/dec-files.tar.gz"
openssl req -x509 -newkey rsa:3072 -nodes -keyout "$TMP/other.key" -out "$TMP/other.pem" -subj "/CN=other" -days 30 >/dev/null 2>&1
t_fail "a different private key cannot decrypt it" bash "$BKP/decrypt-offhost.sh" --key "$TMP/other.key" --in "$TMP/destenc/$D1.cms" --out "$TMP/dec-wrong.sql.gz"
t_fail "...and no output file is left behind" test -e "$TMP/dec-wrong.sql.gz"
: > "$CALLS"; t_ok "a second pull of the same set is a no-op for an already stored encrypted set" EPULL --encrypt-to "$RC"
t_contains "...reported as already present" "$(tail -4 "$TMP/destenc/pull.log")" "already have"
t_eq "...no second transfer of the dump (no 'get <dump>' call)" "$(grep -c "get $D1\$" "$CALLS" || true)" "0"
printf 'X' | dd of="$TMP/destenc/$D1.cms" bs=1 seek=400 conv=notrunc 2>/dev/null
t_fail "a damaged ciphertext is refused by the decryptor" bash "$BKP/decrypt-offhost.sh" --key "$RK" --in "$TMP/destenc/$D1.cms" --out "$TMP/dec-bad.sql.gz"
: > "$CALLS"; t_ok "the next pull notices the damaged ciphertext (ciphertext hash sidecar) and fetches the set again" EPULL --encrypt-to "$RC"
t_eq "...a 'get <dump>' call was made" "$(grep -c "get $D1\$" "$CALLS" || true)" "1"
t_ok "...and the healed copy decrypts" bash "$BKP/decrypt-offhost.sh" --key "$RK" --in "$TMP/destenc/$D1.cms" --out "$TMP/dec-dump2.sql.gz"
for ts in 20261020T010000Z 20261021T010000Z 20261022T010000Z; do mkset "$ts"; EPULL --encrypt-to "$RC" --keep 2 >/dev/null 2>&1; done
t_eq "retention prunes .cms files and their sidecars like plaintext (--keep 2)" "$(ls "$TMP"/destenc/aicc_cp-*.sql.gz.cms | wc -l | tr -d ' ')/$(ls "$TMP"/destenc/aicc_cp-*.sql.gz.cms.sha256 | wc -l | tr -d ' ')" "2/2"
t_eq "...the same for the files archives" "$(ls "$TMP"/destenc/aicc-files-*.tar.gz.cms | wc -l | tr -d ' ')" "2"
mkset 20261022T020000Z; STUB_CORRUPT=1 t_rc "a corrupted transfer is still rejected before anything is encrypted (1)" 1 EPULL --encrypt-to "$RC"
t_eq "...no ciphertext was stored for it" "$(ls "$TMP"/destenc/*20261022T020000Z* 2>/dev/null | wc -l | tr -d " ")" "0"
# production: encryption is mandatory
PID32=0123456789abcdef0123456789abcdef; PKEY2="$TMP/aicc_cp_prod_offhost"; PKH2="$TMP/known_hosts_aicc_prod_cp"
t_rc "production pull WITHOUT --encrypt-to is REFUSED (plaintext customer data must not rest on the Mac)" 3 env HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --env production --key "$PKEY2" --known-hosts "$PKH2" --dest "$TMP/destp2" --stage-ip 203.0.113.9 --expect-id "$PID32"
t_rc "production launchd installer WITHOUT --encrypt-to is REFUSED" 1 env HOME="$TMP/home" bash "$BKP/macos/install-launchd.sh" --env production --stage-ip 203.0.113.9 --expect-id "$PID32" --key "$PKEY2" --known-hosts "$PKH2" --dest "$TMP/destp2"
OUTE="$(env HOME="$TMP/home" bash "$BKP/macos/install-launchd.sh" --env production --stage-ip 203.0.113.9 --expect-id "$PID32" --key "$PKEY2" --known-hosts "$PKH2" --dest "$TMP/destp2" --encrypt-to "$RC" 2>&1)"
t_contains "production launchd dry-run passes --encrypt-to to the runner" "$OUTE" "<string>--encrypt-to</string><string>$RC</string>"
t_not_contains "...and the plist holds no private key" "$OUTE" "PRIVATE KEY"
t_ok "the pull script documents where the private key must live (owner gate)" bash -c "grep -q 'private half' '$BKP/pull-offhost.sh' && grep -q 'Encrypted off-host copies' '$BKP/README-backup.md'"

echo "== RPO/RTO documentation exists and does not claim an unproven restore time =="
t_ok "README-backup.md documents RPO and RTO" bash -c "grep -q 'RPO' '$BKP/README-backup.md' && grep -q 'RTO' '$BKP/README-backup.md'"
t_ok "README-backup.md states what the RTO figure does NOT cover (whole-Droplet loss)" grep -qi 'does \*\*not\*\* cover loss of the whole Droplet' "$BKP/README-backup.md"
t_ok "README-backup.md names the Mac-offline limit of the off-host copy" grep -qi 'When the Mac sleeps or is offline no copy leaves the host' "$BKP/README-backup.md"
t_ok "README-backup.md has the production section: names, honest Mac limits, whole-Droplet scenario, second-copy options" bash -c "grep -q '^## Production (the promoted host' '$BKP/README-backup.md' && grep -q 'as available as your Mac' '$BKP/README-backup.md' && grep -q 'Whole-Droplet loss is \*\*documented, not timed\*\*' '$BKP/README-backup.md' && grep -q 'Free second-copy options' '$BKP/README-backup.md'"
t_fail "README-backup.md has no unfilled drill placeholder" grep -q 'DRILL_RESULT_PLACEHOLDER' "$BKP/README-backup.md"

t_summary
