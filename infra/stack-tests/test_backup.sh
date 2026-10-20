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
  mkdir -p "$TMP/shared/uploads" "$TMP/edge"; echo up > "$TMP/shared/uploads/a.txt"; echo "<?php" > "$TMP/shared/wp-config.php"; echo cfg > "$TMP/edge/Caddyfile"
  FX() { MYSQL_BIN="$LOCALMY/mysql" MYSQLDUMP_BIN="$LOCALMY/mysqldump" bash "$BKP/$1" --fixture-test --mysql-defaults-file "$FXCNF" --db aicc_rehearsal_cp --restore-db aicc_rehearsal_restore_check "${@:2}"; }
  BEFORE="$("$LOCALMY/mysql" --defaults-extra-file="$FXCNF" -N -e "SELECT COUNT(*) FROM aicc_rehearsal_cp.rhsl_options")"
  t_ok "fixture backup succeeds (dump, gzip -t, trailer, restore smoke, files archive)" FX aicc-backup.sh --backup-dir "$TMP/bk" --shared-dir "$TMP/shared" --edge-conf-dir "$TMP/edge" --release-root "$TMP/rel" --label manual
  t_eq "status.json: ok" "$(jq -r .status "$TMP/bk/status.json")" "ok"
  t_eq "status.json: restore_check ok" "$(jq -r .db_dump.restore_check "$TMP/bk/status.json")" "ok"
  t_eq "status.json: 57 tables restored" "$(jq -r .db_dump.tables "$TMP/bk/status.json")" "$("$LOCALMY/mysql" --defaults-extra-file="$FXCNF" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='aicc_rehearsal_cp'")"
  t_eq "status.json has the keys AICC Ops needs (status, finished_epoch, last_success)" "$(jq -r '[has("status"), has("finished_epoch"), has("last_success")] | all' "$TMP/bk/status.json")" "true"
  t_ok "restore test on the fixture dump" FX aicc-restore-test.sh --backup-dir "$TMP/bk"
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
cat > "$STUB/ssh" <<EOS
#!/usr/bin/env bash
echo "ssh \$*" >> "$CALLS"
cmd="\${@: -1}"
case "\$cmd" in
  "cat /etc/aicc-stage-identity") printf 'AICC_ENV=%s\nAICC_HOSTNAME=%s\n' "\${STUB_ENV:-staging}" "\${STUB_HOSTNAME:-stage.copilt.org}" ;;
  "sudo cat /srv/aicc/backups/"*) f="$REMOTE/\${cmd#sudo cat /srv/aicc/backups/}"; case "\$f" in *..*) exit 1;; esac; [ -f "\$f" ] || exit 1
     if [ "\${STUB_CORRUPT:-0}" = 1 ] && case "\$f" in *.sql.gz) true;; *) false;; esac; then (cat "\$f"; printf 'X') ; else cat "\$f"; fi ;;
  *) exit 1 ;;
esac
EOS
chmod +x "$STUB/ssh"
FAKEKEY="$TMP/fake_stage_key"; printf -- '-----BEGIN %s-----\nDUMMY-NOT-A-KEY\n-----END %s-----\n' "OPENSSH PRIVATE KEY" "OPENSSH PRIVATE KEY" > "$FAKEKEY"; chmod 600 "$FAKEKEY"
PRODKEY="$TMP/aicc_digitalocean_prod"; cp "$FAKEKEY" "$PRODKEY"
PULL() { env HOME="$TMP/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --key "$FAKEKEY" --dest "$TMP/dest" "$@"; }
mkdir -p "$TMP/home/.ssh"
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
for ts in 20261022T033012Z 20261023T033012Z 20261024T033012Z; do mkset "$ts"; PULL --stage-ip 203.0.113.9 --keep 2 >/dev/null 2>&1; done
t_eq "retention: only the newest 2 dumps are kept (--keep 2)" "$(ls "$TMP"/dest/aicc_cp-*.sql.gz | wc -l | tr -d ' ')" "2"
t_eq "retention: the sidecars of pruned dumps are gone too" "$(ls "$TMP"/dest/aicc_cp-*.sha256 | wc -l | tr -d ' ')" "2"
t_ok "the newest dump is kept" test -f "$TMP/dest/aicc_cp-20261024T033012Z-scheduled.sql.gz"
mkset 20261025T033012Z
STUB_CORRUPT=1 t_rc "a corrupted transfer is rejected (exit 1)" 1 PULL --stage-ip 203.0.113.9
t_fail "...the corrupted copy was NOT kept" test -f "$TMP/dest/aicc_cp-20261025T033012Z-scheduled.sql.gz"
t_eq "...and no partial file remains" "$(ls "$TMP"/dest/*.partial 2>/dev/null | wc -l | tr -d ' ')" "0"
echo '{"schema":1,"status":"ok","last_success":{"finished_epoch":1,"db_dump_file":"../../etc/passwd","files_archive_file":"x"}}' > "$REMOTE/status.json"
t_rc "a hostile status.json naming a path outside the backup dir is rejected" 1 PULL --stage-ip 203.0.113.9
echo '{"schema":1,"status":"failed","reason":"disk guard","last_success":{"finished_epoch":1}}' > "$REMOTE/status.json"
t_rc "a failed latest run on the host is reported (exit 1)" 1 PULL --stage-ip 203.0.113.9

echo "== RPO/RTO documentation exists and does not claim an unproven restore time =="
t_ok "README-backup.md documents RPO and RTO" bash -c "grep -q 'RPO' '$BKP/README-backup.md' && grep -q 'RTO' '$BKP/README-backup.md'"
t_ok "README-backup.md says the RTO is not yet measured" grep -qi 'not yet measured\|not measured' "$BKP/README-backup.md"

t_summary
