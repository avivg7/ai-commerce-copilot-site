#!/usr/bin/env bash
# Tests of the provisioning scripts that can run on the Mac: dry-run behaviour, idempotent installation into a temp prefix, the stage-2 SSH hardening logic with a
# stubbed sshd/systemctl, database creation + grants against a THROWAWAY mysqld (socket only, in a temp dir; never an owner or fixture server), wp-config rendering,
# PHP-FPM / MySQL configuration syntax, and the fail2ban regexes against the real Caddy 2.11.7 access log format.
# Run: bash infra/stack-tests/test_provision.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; INFRA="$REPO/infra"; PROV="$INFRA/provision"
T_SUITE="provision"; . "$HERE/lib/t.sh"
mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }; export -f mode
TMP="$(mktemp -d "${TMPDIR:-/tmp}/aprov.XXXX")"
LOCALMY="$HOME/Library/Application Support/Local/lightning-services/mysql-8.4.0+2/bin/darwin-arm64/bin"
MYSQLD_PID=""
cleanup() { [ -n "$MYSQLD_PID" ] && kill "$MYSQLD_PID" 2>/dev/null && sleep 1; rm -rf "$TMP"; }
trap cleanup EXIT

echo "== install-stack.sh: argument handling and dry-run =="
t_rc "unknown step is refused" 1 bash "$PROV/install-stack.sh" --dry-run --only nonsense
t_rc "unknown option is refused" 1 bash "$PROV/install-stack.sh" --frobnicate
t_contains "--list-steps shows the default order" "$(bash "$PROV/install-stack.sh" --list-steps)" "preflight identity packages users-dirs caddy wpcli php mysql sysctl scripts systemd logrotate fail2ban services verify"
if [ "$(id -u)" != 0 ]; then t_rc "a real run without root is refused" 1 bash "$PROV/install-stack.sh" --only sysctl; fi
OUT="$(bash "$PROV/install-stack.sh" --dry-run 2>&1)"; rc=$?
t_eq "full --dry-run exits 0" "$rc" "0"
t_contains "dry-run says nothing changed" "$OUT" "dry-run: nothing changed"
t_contains "dry-run lists the pinned Caddy tarball" "$OUT" "caddy_2.11.7_linux_amd64.tar.gz"
t_contains "dry-run lists php 8.3 packages" "$OUT" "php8.3-fpm"
t_not_contains "dry-run: no imagick" "$OUT" "imagick"
t_contains "dry-run installs the pool config" "$OUT" "/etc/php/8.3/fpm/pool.d/aicc.conf"
t_contains "dry-run installs the MySQL drop-in" "$OUT" "/etc/mysql/mysql.conf.d/99-aicc.cnf"
t_contains "dry-run creates the three system users" "$OUT" "useradd --system --gid aicc-ops"
t_not_contains "dry-run does not touch the cloud-init unattended-upgrades files" "$OUT" "52aicc-unattended-upgrades"
t_not_contains "dry-run does not re-create the swap file" "$OUT" "fallocate"
t_not_contains "dry-run does not touch UFW" "$OUT" "ufw"
OUT_ONLY="$(bash "$PROV/install-stack.sh" --dry-run --only sysctl,logrotate 2>&1)"
t_not_contains "--only runs only the named steps" "$OUT_ONLY" "step: caddy"
t_rc "enable-edge in dry-run does not start anything" 0 bash "$PROV/install-stack.sh" --dry-run --only enable-edge
t_rc "edge-env without a valid e-mail is refused" 1 env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$TMP/rootx" bash "$PROV/install-stack.sh" --only edge-env --acme-email 'not an address'

echo "== install-stack.sh: idempotent installation into a temp prefix =="
PFX="$TMP/root"; mkdir -p "$PFX"
H() { env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$PFX" bash "$PROV/install-stack.sh" "$@"; }
mkdir -p "$PFX/etc"; printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\nAICC_STAGE_ID=0123456789abcdef0123456789abcdef\n' > "$PFX/etc/aicc-stage-identity"
FIRST="$(H --only users-dirs,php,mysql,sysctl,scripts,systemd,logrotate,fail2ban,edge-env --acme-email ops@example.org 2>&1)"; rc=$?
t_eq "first run succeeds" "$rc" "0"
t_ok "pool config installed" cmp "$INFRA/php/aicc-pool.conf" "$PFX/etc/php/8.3/fpm/pool.d/aicc.conf"
t_ok "FPM ini installed" cmp "$INFRA/php/90-aicc-fpm.ini" "$PFX/etc/php/8.3/fpm/conf.d/90-aicc.ini"
t_ok "MySQL drop-in installed" cmp "$INFRA/mysql/99-aicc.cnf" "$PFX/etc/mysql/mysql.conf.d/99-aicc.cnf"
t_ok "aicc-edge.service installed" cmp "$INFRA/systemd/aicc-edge.service" "$PFX/etc/systemd/system/aicc-edge.service"
t_ok "php-fpm drop-in installed" cmp "$INFRA/systemd/overrides/php8.3-fpm.service.d/aicc.conf" "$PFX/etc/systemd/system/php8.3-fpm.service.d/aicc.conf"
t_ok "fail2ban jail installed" cmp "$INFRA/fail2ban/jail.d-aicc-edge.local" "$PFX/etc/fail2ban/jail.d/aicc-edge.local"
t_eq "uploads dir mode (setgid 2750)" "$(stat -c '%a' "$PFX/srv/aicc/shared/uploads" 2>/dev/null || stat -f '%Mp%Lp' "$PFX/srv/aicc/shared/uploads" | sed 's/^0*//')" "2750"
t_eq "/etc/aicc/secrets is 0700" "$(mode "$PFX/etc/aicc/secrets")" "700"
t_eq "backups dir is 0751 (status.json readable by name, dumps are 0600)" "$(mode "$PFX/srv/aicc/backups")" "751"
t_eq "edge.env mode 0640" "$(mode "$PFX/etc/aicc-edge/edge.env")" "640"
t_contains "edge.env: stage mode, stage host, stage id from the identity file" "$(cat "$PFX/etc/aicc-edge/edge.env")" "AICC_STAGE_ID=0123456789abcdef0123456789abcdef"
t_contains "edge.env: fastcgi socket in the form the Caddyfile and preflight expect" "$(cat "$PFX/etc/aicc-edge/edge.env")" "AICC_PHP_FPM_SOCKET=unix//run/php/aicc-cp.sock"
t_contains "edge.env: first start uses the Let's Encrypt STAGING directory" "$(cat "$PFX/etc/aicc-edge/edge.env")" "AICC_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory"
t_eq "edge.env: no public operator allowlist is set (stage/production have none)" "$(grep -c '^AICC_OPERATOR_CIDRS=' "$PFX/etc/aicc-edge/edge.env" || true)" "0"
t_contains "edge.env: loopback operator listener port" "$(cat "$PFX/etc/aicc-edge/edge.env")" "AICC_OPERATOR_PORT=8443"
t_contains "edge.env: ACME e-mail rendered" "$(cat "$PFX/etc/aicc-edge/edge.env")" "AICC_ACME_EMAIL=ops@example.org"
t_not_contains "edge.env has no placeholder left" "$(cat "$PFX/etc/aicc-edge/edge.env")" "__"
t_ok "backup scripts installed with their library" test -f "$PFX/usr/local/lib/aicc/backup/lib/backup-common.sh"
t_ok "F-05: the wp-config renderer, both templates and its library are installed for the restore tool" bash -c "test -x '$PFX/usr/local/lib/aicc/provision/render-wp-config.sh' && test -f '$PFX/usr/local/lib/aicc/provision/lib/common.sh' && test -f '$PFX/usr/local/lib/aicc/provision/wp-config.stage.template.php' && test -L '$PFX/usr/local/sbin/aicc-render-wp-config'"
t_ok "sbin symlink for aicc-backup" test -L "$PFX/usr/local/sbin/aicc-backup"
t_ok "sbin symlink for aicc-activate-release" test -L "$PFX/usr/local/sbin/aicc-activate-release"
t_ok "fail2ban log file pre-created" test -f "$PFX/var/log/aicc-edge/aicc-edge.log"
SECOND="$(H --only users-dirs,php,mysql,sysctl,scripts,systemd,logrotate,fail2ban,edge-env --acme-email ops@example.org 2>&1)"; rc=$?
t_eq "second run succeeds" "$rc" "0"
t_eq "IDEMPOTENT: the second run changes nothing (no 'installed:'/'created'/'chmod'/'chown')" "$(printf '%s\n' "$SECOND" | grep -v '^====' | grep -cE 'installed:|created |chmod |chown |symlink /' || true)" "0"
t_contains "second run reports unchanged files" "$SECOND" "unchanged: /etc/mysql/mysql.conf.d/99-aicc.cnf"
echo "# local edit" >> "$PFX/etc/mysql/mysql.conf.d/99-aicc.cnf"
THIRD="$(H --only mysql 2>&1)"
t_contains "a drifted config file is replaced" "$THIRD" "installed: /etc/mysql/mysql.conf.d/99-aicc.cnf"
t_ok "...and the previous version is kept in /var/backups/aicc-config" bash -c "find '$PFX/var/backups/aicc-config' -name '99-aicc.cnf' | grep -q ."
t_ok "...and the file equals the repo version again" cmp "$INFRA/mysql/99-aicc.cnf" "$PFX/etc/mysql/mysql.conf.d/99-aicc.cnf"
t_fail "fail2ban: the installer ships no zz-aicc-local.local (the operator override is absent by default)" test -e "$PFX/etc/fail2ban/jail.d/zz-aicc-local.local"
printf '[aicc-wp-login]\nignoreip = 127.0.0.1/8 ::1 10.19.0.2\n' > "$PFX/etc/fail2ban/jail.d/zz-aicc-local.local"
H --only fail2ban >/dev/null 2>&1; echo "# drift" >> "$PFX/etc/fail2ban/jail.d/aicc-edge.local"; H --only fail2ban >/dev/null 2>&1
t_eq "fail2ban: an operator-owned zz-aicc-local.local survives a re-install (even one that replaces the drifted shipped jail file)" "$(cat "$PFX/etc/fail2ban/jail.d/zz-aicc-local.local")" "$(printf '[aicc-wp-login]\nignoreip = 127.0.0.1/8 ::1 10.19.0.2')"
t_ok "...and the shipped jail file is back to the repo version" cmp "$INFRA/fail2ban/jail.d-aicc-edge.local" "$PFX/etc/fail2ban/jail.d/aicc-edge.local"
t_contains "the shipped jail file documents the operator override and says the installer replaces it" "$(cat "$INFRA/fail2ban/jail.d-aicc-edge.local")" "zz-aicc-local.local"
t_contains "the login filter states the exact limitation (every POST counts, successful or not)" "$(cat "$INFRA/fail2ban/filter.d-aicc-wp-login.conf")" "PRECISE LIMITATION"
t_contains "the flood filter counts only the scanner classes (421 and 429 are not among them; F-09)" "$(grep '^failregex' "$INFRA/fail2ban/filter.d-caddy-4xx-flood.conf")" '(?:400|401|403|404|405)'
t_not_contains "...421/429 are not counted" "$(grep '^failregex' "$INFRA/fail2ban/filter.d-caddy-4xx-flood.conf")" '421'
t_contains "...a browser-labelled cross-site request is ignored" "$(cat "$INFRA/fail2ban/filter.d-caddy-4xx-flood.conf")" '"req_sec_fetch_site":"cross-site"'
rm -f "$PFX/etc/fail2ban/jail.d/zz-aicc-local.local"
DRYP="$(env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$PFX" bash "$PROV/install-stack.sh" --dry-run --only php 2>&1)"
t_contains "dry-run on an installed prefix reports unchanged" "$DRYP" "unchanged: /etc/php/8.3/fpm/pool.d/aicc.conf"

echo "== stage 2: two-session SSH hardening =="
SB="$TMP/sb"; mkdir -p "$SB/bin" "$SB/sshd.d" "$SB/home/.ssh"; CALLS="$SB/calls.log"; : > "$CALLS"
cat > "$SB/bin/sshd" <<EOS
#!/usr/bin/env bash
echo "sshd \$*" >> "$CALLS"
case "\$1" in
  -t) exit "\${STUB_SSHD_T_RC:-0}" ;;
  -T) echo "pubkeyauthentication yes"; echo "passwordauthentication no"
      if [ "\${STUB_SSHD_IGNORE:-0}" != 1 ] && [ -f "$SB/sshd.d/05-aicc-stage2.conf" ]; then grep -q '^PermitRootLogin no' "$SB/sshd.d/05-aicc-stage2.conf" && echo "permitrootlogin no"; grep -q '^AllowUsers aicc' "$SB/sshd.d/05-aicc-stage2.conf" && echo "allowusers aicc"; else echo "permitrootlogin without-password"; fi ;;
esac
EOS
cat > "$SB/bin/systemctl" <<EOS
#!/usr/bin/env bash
echo "systemctl \$*" >> "$CALLS"; exit "\${STUB_SYSTEMCTL_RC:-0}"
EOS
chmod +x "$SB/bin"/*
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMY test" > "$SB/home/.ssh/authorized_keys"; chmod 600 "$SB/home/.ssh/authorized_keys"
echo "11111111-2222-3333-4444-555555555555" > "$SB/boot_id"
HX() { env AICC_TEST_HARNESS=1 AICC_MARKER_PATH="$SB/marker" AICC_BOOT_ID_FILE="$SB/boot_id" AICC_SSHD_BIN="$SB/bin/sshd" AICC_SSHD_DIR="$SB/sshd.d" AICC_SYSTEMCTL_BIN="$SB/bin/systemctl" AICC_TEST_AICC_HOME="$SB/home" "$@"; }
rm -f "$SB/marker"
t_rc "no marker: harden-stage2 refuses" 1 HX AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage2.sh"
t_fail "...and wrote no drop-in" test -e "$SB/sshd.d/05-aicc-stage2.conf"
t_rc "verify step run as root session (not aicc) fails and writes no marker" 1 HX AICC_TEST_SSH_ANCESTOR=200:root bash "$PROV/stage2-verify-second-session.sh" --skip-auth-log-check
t_fail "...no marker was written" test -e "$SB/marker"
t_rc "verify step outside any SSH session (console) fails" 1 HX AICC_TEST_SSH_ANCESTOR=none bash "$PROV/stage2-verify-second-session.sh" --skip-auth-log-check
t_ok "verify step in an aicc SSH session passes" HX AICC_TEST_SSH_ANCESTOR=300:aicc bash "$PROV/stage2-verify-second-session.sh"
t_ok "...and writes the marker (mode 0600)" bash -c "[ -f '$SB/marker' ] && [ \"\$(mode '$SB/marker')\" = 600 ]"
t_contains "marker carries the boot id" "$(cat "$SB/marker")" "BOOT_ID=11111111-2222-3333-4444-555555555555"
t_rc "harden from the SAME session that wrote the marker is refused" 1 HX AICC_TEST_SSH_ANCESTOR=300:aicc bash "$PROV/harden-stage2.sh"
echo "99999999-0000-0000-0000-000000000000" > "$SB/boot_id.other"
t_rc "marker from another boot is refused" 1 env AICC_TEST_HARNESS=1 AICC_MARKER_PATH="$SB/marker" AICC_BOOT_ID_FILE="$SB/boot_id.other" AICC_SSHD_BIN="$SB/bin/sshd" AICC_SSHD_DIR="$SB/sshd.d" AICC_SYSTEMCTL_BIN="$SB/bin/systemctl" AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage2.sh"
cp "$SB/marker" "$SB/marker.good"; sed -i.bak "s/^EPOCH=.*/EPOCH=$(( $(date -u +%s) - 4000 ))/" "$SB/marker"; rm -f "$SB/marker.bak"
t_rc "marker older than 60 minutes is refused" 1 HX AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage2.sh"
cp "$SB/marker.good" "$SB/marker"
: > "$CALLS"
t_rc "--dry-run changes nothing" 0 HX AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage2.sh" --dry-run
t_fail "...no drop-in after a dry run" test -e "$SB/sshd.d/05-aicc-stage2.conf"
t_eq "...no reload after a dry run" "$(grep -c reload "$CALLS" || true)" "0"
OUTH="$(HX AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage2.sh" 2>&1)"; rc=$?
t_eq "harden from the first session with a valid marker succeeds" "$rc" "0"
t_contains "drop-in has PermitRootLogin no" "$(cat "$SB/sshd.d/05-aicc-stage2.conf")" "PermitRootLogin no"
t_contains "drop-in has AllowUsers aicc" "$(cat "$SB/sshd.d/05-aicc-stage2.conf")" "AllowUsers aicc"
t_contains "the file name sorts before cloud-init's 10-aicc-hardening.conf" "$(ls "$SB/sshd.d"; echo 10-aicc-hardening.conf | cat)" "05-aicc-stage2.conf"
t_eq "sshd -t ran BEFORE the reload" "$(grep -nE '^sshd -t|reload' "$CALLS" | head -2 | cut -d: -f2 | tr '\n' ' ' | cut -c1-8)" "sshd -t "
t_contains "reload (not restart) of ssh" "$(cat "$CALLS")" "systemctl reload ssh"
t_not_contains "NEVER a restart/stop of ssh" "$(cat "$CALLS")" "restart"
t_contains "rollback command is printed" "$OUTH" "05-aicc-stage2.conf && sudo sshd -t && sudo systemctl reload ssh"
t_contains "tells the operator to keep the sessions and test a third login" "$OUTH" "THIRD login"
: > "$CALLS"
OUT2="$(HX AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage2.sh" 2>&1)"
t_contains "second run: unchanged" "$OUT2" "unchanged:"
t_eq "second run: no reload" "$(grep -c reload "$CALLS" || true)" "0"
rm -f "$SB/sshd.d/05-aicc-stage2.conf"; : > "$CALLS"
t_rc "sshd -t failure: refused" 1 HX STUB_SSHD_T_RC=1 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage2.sh"
t_fail "...drop-in was reverted" test -e "$SB/sshd.d/05-aicc-stage2.conf"
t_eq "...and sshd was NOT reloaded" "$(grep -c reload "$CALLS" || true)" "0"
t_rc "effective config unchanged by the drop-in (earlier file wins): refused" 1 HX STUB_SSHD_IGNORE=1 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage2.sh"
t_fail "...drop-in was reverted again" test -e "$SB/sshd.d/05-aicc-stage2.conf"
t_eq "...and sshd was NOT reloaded either" "$(grep -c reload "$CALLS" || true)" "0"
t_rc "a failing reload removes the drop-in and fails" 1 HX STUB_SYSTEMCTL_RC=1 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage2.sh"
t_fail "...no drop-in left after a failed reload" test -e "$SB/sshd.d/05-aicc-stage2.conf"
if [ "$(id -u)" != 0 ]; then t_rc "without the harness, non-root is refused" 1 bash "$PROV/harden-stage2.sh"; fi

echo "== stage 3: SSH crypto allow-list and unused services (security review L8) =="
S3="$TMP/s3"; mkdir -p "$S3/bin" "$S3/sshd.d" "$S3/masked" "$S3/rdeps"; C3="$S3/calls.log"; : > "$C3"
cat > "$S3/bin/sshd" <<EOS
#!/usr/bin/env bash
echo "sshd \$*" >> "$C3"
case "\$1" in
  -t) exit "\${STUB_SSHD_T_RC:-0}" ;;
  -T) echo "pubkeyauthentication yes"; echo "passwordauthentication no"
      f5="$S3/sshd.d/05-aicc-stage2.conf"; f6="$S3/sshd.d/06-aicc-stage3-crypto.conf"
      if [ -f "\$f5" ]; then echo "permitrootlogin no"; echo "allowusers aicc"; else echo "permitrootlogin without-password"; fi
      if [ -f "\$f6" ] && [ "\${STUB_SSHD_IGNORE:-0}" != 1 ]; then sed -n 's/^Ciphers /ciphers /p;s/^KexAlgorithms /kexalgorithms /p;s/^MACs /macs /p' "\$f6"
      else echo "ciphers chacha20-poly1305@openssh.com,aes128-ctr,aes256-ctr,aes128-gcm@openssh.com"; echo "kexalgorithms curve25519-sha256,diffie-hellman-group14-sha1"; echo "macs hmac-sha1,umac-64@openssh.com"; fi ;;
esac
EOS
cat > "$S3/bin/systemctl" <<EOS
#!/usr/bin/env bash
echo "systemctl \$*" >> "$C3"
case "\$1" in
  is-enabled) if [ -f "$S3/masked/\$2" ]; then echo masked; else echo enabled; fi; exit 0 ;;
  cat) case " \${STUB_UNITS:-snapd.service snapd.socket snapd.seeded.service ModemManager.service udisks2.service multipathd.service multipathd.socket} " in *" \$2 "*) exit 0 ;; *) exit 1 ;; esac ;;
  list-dependencies) u="\${@: -1}"; echo "\$u"; if [ -f "$S3/rdeps/\$u" ]; then sed 's/^/  /' "$S3/rdeps/\$u"; fi; echo "  multi-user.target"; exit 0 ;;
  disable) exit 0 ;;
  mask) touch "$S3/masked/\$2"; exit 0 ;;
  reload) exit "\${STUB_SYSTEMCTL_RC:-0}" ;;
esac
exit 0
EOS
cat > "$S3/bin/snap" <<EOS
#!/usr/bin/env bash
printf 'Name  Version  Rev  Tracking  Publisher  Notes\n'
for n in \${STUB_SNAPS:-core22 snapd bare}; do printf '%s 1 1 latest/stable x -\n' "\$n"; done
EOS
chmod +x "$S3/bin"/*
printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\nAICC_STAGE_ID=0123456789abcdef0123456789abcdef\n' > "$S3/identity"
H3() { env AICC_TEST_HARNESS=1 AICC_MARKER_PATH="$S3/marker" AICC_BOOT_ID_FILE="$SB/boot_id" AICC_SSHD_BIN="$S3/bin/sshd" AICC_SSHD_DIR="$S3/sshd.d" AICC_SYSTEMCTL_BIN="$S3/bin/systemctl" AICC_SNAP_BIN="$S3/bin/snap" AICC_IDENTITY_FILE="$S3/identity" AICC_MULTIPATH_BIN=/nonexistent AICC_TEST_AICC_HOME="$SB/home" "$@"; }
rm -f "$S3/marker" "$S3/sshd.d"/*
printf 'PermitRootLogin no\nAllowUsers aicc\n' > "$S3/sshd.d/05-aicc-stage2.conf"
t_rc "no marker: harden-stage3 refuses" 1 H3 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh"
t_ok "second-session verification writes the marker" env AICC_TEST_HARNESS=1 AICC_MARKER_PATH="$S3/marker" AICC_BOOT_ID_FILE="$SB/boot_id" AICC_SSHD_BIN="$S3/bin/sshd" AICC_SSHD_DIR="$S3/sshd.d" AICC_SYSTEMCTL_BIN="$S3/bin/systemctl" AICC_TEST_AICC_HOME="$SB/home" AICC_TEST_SSH_ANCESTOR=300:aicc bash "$PROV/stage2-verify-second-session.sh"
t_rc "the SAME session that wrote the marker is refused" 1 H3 AICC_TEST_SSH_ANCESTOR=300:aicc bash "$PROV/harden-stage3.sh"
mv "$S3/identity" "$S3/identity.ok"
t_rc "no identity file: not the staging host, refused" 1 H3 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh"
printf 'AICC_ENV=production\nAICC_HOSTNAME=www.copilt.org\n' > "$S3/identity"
t_rc "AICC_ENV=production is refused" 1 H3 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh"
printf 'AICC_ENV=staging\nAICC_HOSTNAME=www.copilt.org\n' > "$S3/identity"
t_rc "a production host name in a staging-looking identity is refused" 1 H3 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh"
mv "$S3/identity.ok" "$S3/identity"
rm "$S3/sshd.d/05-aicc-stage2.conf"
t_rc "stage 2 not in force: refused (stage 3 never replaces it)" 1 H3 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh"
t_fail "...and wrote nothing" test -e "$S3/sshd.d/06-aicc-stage3-crypto.conf"
printf 'PermitRootLogin no\nAllowUsers aicc\n' > "$S3/sshd.d/05-aicc-stage2.conf"
: > "$C3"
t_rc "--dry-run succeeds" 0 H3 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh" --dry-run
t_fail "...no drop-in after a dry run" test -e "$S3/sshd.d/06-aicc-stage3-crypto.conf"
t_eq "...no reload, no mask after a dry run" "$(grep -cE 'reload|mask |disable' "$C3" || true)" "0"
t_eq "...no unit masked" "$(ls "$S3/masked" | wc -l | tr -d ' ')" "0"
: > "$C3"
OUT3="$(H3 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh" 2>&1)"; rc=$?
t_eq "stage 3 from the first session with a valid marker succeeds" "$rc" "0"
t_contains "drop-in: only AEAD ciphers" "$(cat "$S3/sshd.d/06-aicc-stage3-crypto.conf")" "Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com"
t_contains "drop-in: curve25519 key exchange" "$(cat "$S3/sshd.d/06-aicc-stage3-crypto.conf")" "KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,sntrup761x25519-sha512@openssh.com"
t_contains "drop-in: encrypt-then-MAC only" "$(cat "$S3/sshd.d/06-aicc-stage3-crypto.conf")" "MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com"
t_not_contains "no legacy algorithm anywhere in the drop-in" "$(cat "$S3/sshd.d/06-aicc-stage3-crypto.conf")" "ctr"
t_eq "sshd -t and the effective sshd -T both ran BEFORE the reload" "$(awk '/^sshd -t/{t=NR} /^sshd -T/{T=NR} /reload/{r=NR} END{print (t>0 && T>0 && t<r && T<r) ? "yes" : "no"}' "$C3")" "yes"
t_not_contains "NEVER a restart/stop of ssh" "$(cat "$C3")" "restart"
for u in snapd.service snapd.socket snapd.seeded.service ModemManager.service udisks2.service multipathd.service multipathd.socket; do t_ok "$u is masked" test -f "$S3/masked/$u"; done
t_not_contains "do-agent and droplet-agent are never mentioned to systemctl" "$(cat "$C3")" "agent"
t_contains "the cloud-firewall narrowing is documented as an OWNER decision and not applied" "$OUT3" "[OWNER DECISION, NOT APPLIED]"
t_contains "tells the operator to test a THIRD login first" "$OUT3" "THIRD login"
: > "$C3"
OUT3B="$(H3 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh" 2>&1)"
t_contains "second run: SSH file unchanged" "$OUT3B" "unchanged: $S3/sshd.d/06-aicc-stage3-crypto.conf"
t_contains "second run: units already masked" "$OUT3B" "unchanged: snapd.service is already masked"
t_eq "second run: no reload and no new mask" "$(grep -cE 'reload|^systemctl mask|disable' "$C3" || true)" "0"
# a drop-in that is not effective (an earlier file wins) is reverted and sshd is not reloaded
rm -f "$S3/sshd.d/06-aicc-stage3-crypto.conf" "$S3/masked"/*; : > "$C3"
t_rc "ineffective drop-in (sshd -T does not report the allow-list): refused" 1 H3 STUB_SSHD_IGNORE=1 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh" --skip-services
t_fail "...the drop-in was reverted" test -e "$S3/sshd.d/06-aicc-stage3-crypto.conf"
t_eq "...and sshd was never reloaded" "$(grep -c reload "$C3" || true)" "0"
t_rc "sshd -t rejecting the file: refused and reverted" 1 H3 STUB_SSHD_T_RC=1 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh" --skip-services
t_fail "...the drop-in is gone" test -e "$S3/sshd.d/06-aicc-stage3-crypto.conf"
t_rc "a failing reload removes the drop-in again" 1 H3 STUB_SYSTEMCTL_RC=1 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh" --skip-services
t_fail "...no drop-in left behind" test -e "$S3/sshd.d/06-aicc-stage3-crypto.conf"
# dependency checks
rm -f "$S3/masked"/*; printf 'do-agent.service\n' > "$S3/rdeps/udisks2.service"; printf 'droplet-agent.service\n' > "$S3/rdeps/ModemManager.service"; : > "$C3"
OUT3C="$(H3 AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh" --skip-ssh 2>&1)"
t_contains "a unit that do-agent depends on is SKIPPED with the reason" "$OUT3C" "SKIPPED udisks2.service: required by do-agent.service"
t_contains "a unit that droplet-agent depends on is SKIPPED with the reason" "$OUT3C" "SKIPPED ModemManager.service: required by droplet-agent.service"
t_fail "...and not masked" test -f "$S3/masked/udisks2.service"
t_ok "the others are still masked" test -f "$S3/masked/snapd.service" -a -f "$S3/masked/multipathd.service"
rm -f "$S3/masked"/* "$S3/rdeps"/*; : > "$C3"
OUT3D="$(H3 STUB_SNAPS="core22 snapd bare droplet-agent" AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh" --skip-ssh 2>&1)"
t_contains "snapd is kept when a snap (e.g. a snap-packaged cloud agent) is installed" "$OUT3D" "SKIPPED snapd"
t_fail "...snapd not masked" test -f "$S3/masked/snapd.service"
rm -f "$S3/masked"/*; : > "$C3"
OUT3E="$(H3 STUB_UNITS="snapd.service" AICC_TEST_SSH_ANCESTOR=100:root bash "$PROV/harden-stage3.sh" --skip-ssh 2>&1)"
t_contains "units that are not installed are skipped quietly" "$OUT3E" "absent: ModemManager.service is not installed"
t_ok "the installed one is masked" test -f "$S3/masked/snapd.service"
t_contains "--help prints the header" "$(bash "$PROV/harden-stage3.sh" --help 2>&1 | head -3)" "STAGE 3"

echo "== PHP-FPM / PHP ini configuration syntax (local php-fpm, user/paths substituted) =="
if command -v php-fpm >/dev/null 2>&1; then
  FD="$TMP/fpm"; mkdir -p "$FD/log" "$FD/run" "$FD/tmp" "$FD/sess"
  sed -e "s#^user = aicc-cp#user = $(id -un)#" -e "s#^group = aicc-cp#group = $(id -gn)#" -e "s#^listen.owner = aicc-cp#listen.owner = $(id -un)#" -e "s#^listen.group = aicc-edge#listen.group = $(id -gn)#" \
      -e "s#/run/php/aicc-cp.sock#$FD/run/s.sock#" -e "s#/var/log/aicc-cp#$FD/log#g" -e "s#/var/lib/aicc-cp/tmp#$FD/tmp#g" -e "s#/var/lib/aicc-cp/sessions#$FD/sess#" \
      -e "s#^php_admin_value\[sendmail_path\].*#php_admin_value[sendmail_path] = /bin/true#" "$INFRA/php/aicc-pool.conf" > "$FD/pool.conf"
  printf '[global]\nerror_log = %s/log/fpm.log\ndaemonize = no\ninclude = %s/pool.conf\n' "$FD" "$FD" > "$FD/fpm.conf"
  t_ok "php-fpm -t accepts the pool file" php-fpm -t -y "$FD/fpm.conf" -n
  DUMP="$(php-fpm -tt -y "$FD/fpm.conf" -n 2>&1)"
  for kv in "pm = dynamic" "pm.max_children = 3" "pm.start_servers = 1" "pm.min_spare_servers = 1" "pm.max_spare_servers = 2" "pm.max_requests = 300" "pm.status_path = /fpm-status" "ping.path = /fpm-ping" "request_slowlog_timeout = 5" "listen.mode = 0660" "request_terminate_timeout = 55"; do
    t_contains "pool value: $kv" "$DUMP" "$kv"
  done
  t_contains "pool: memory_limit 192M for the pool" "$DUMP" "php_admin_value[memory_limit] = 192M"
  t_contains "pool: sendmail goes to the sink (substituted here)" "$(cat "$INFRA/php/aicc-pool.conf")" "sendmail_path] = /usr/local/sbin/aicc-mail-sink"
  t_contains "pool: expose_php is off in the ini" "$(cat "$INFRA/php/90-aicc-fpm.ini")" "expose_php = Off"
  OPC="$(php -n -d zend_extension=opcache -c "$INFRA/php/90-aicc-fpm.ini" -i 2>/dev/null | grep -E '^opcache\.(validate_timestamps|memory_consumption|max_accelerated_files|interned_strings_buffer|save_comments) ')"
  t_contains "ini: opcache.validate_timestamps Off" "$OPC" "opcache.validate_timestamps => Off"
  t_contains "ini: opcache.memory_consumption 128" "$OPC" "opcache.memory_consumption => 128"
  t_contains "ini: opcache.save_comments On" "$OPC" "opcache.save_comments => On"
  t_ok "mail sink writes a file and sends nothing" bash -c "echo 'Subject: t' | AICC_MAIL_SINK_DIR='$TMP/mail' bash '$INFRA/php/aicc-mail-sink.sh' && ls '$TMP/mail'/*.eml >/dev/null && [ \"\$(stat -c %a '$TMP/mail'/*.eml 2>/dev/null || stat -f %Lp '$TMP/mail'/*.eml)\" = 600 ]"
  t_ok "the disabled-functions list does not contain functions WordPress needs (mail, curl_exec, file_put_contents)" bash -c "! grep -E 'disable_functions' '$INFRA/php/aicc-pool.conf' | grep -Eq 'mail|curl_exec|file_put_contents|fsockopen|proc_nice'"
else t_skip "php-fpm syntax tests" "php-fpm not installed"; fi

echo "== MySQL configuration against a throwaway mysqld (8.4 here; production is 8.0) =="
if [ -x "$LOCALMY/mysqld" ]; then
  M="$TMP/m"; mkdir -p "$M/data" "$M/log"
  { printf '[mysqld]\ndatadir=%s/data\nbasedir=%s\nsocket=%s/s.sock\npid-file=%s/p.pid\nmysqlx-socket=%s/x.sock\n' "$M" "$(dirname "$LOCALMY")" "$M" "$M" "$M"; sed "s#/var/log/mysql#$M/log#g" "$INFRA/mysql/99-aicc.cnf"; } > "$M/my.cnf"
  t_ok "mysqld --validate-config accepts the drop-in" "$LOCALMY/mysqld" --defaults-file="$M/my.cnf" --validate-config
  "$LOCALMY/mysqld" --defaults-file="$M/my.cnf" --initialize-insecure >"$M/init.out" 2>&1 || true
  "$LOCALMY/mysqld" --defaults-file="$M/my.cnf" >"$M/run.out" 2>&1 &
  MYSQLD_PID=$!
  for i in $(seq 1 60); do [ -S "$M/s.sock" ] && break; sleep 1; done
  if [ -S "$M/s.sock" ]; then
    MY=("$LOCALMY/mysql" --protocol=socket --socket="$M/s.sock" -uroot -N)
    t_eq "effective settings: skip_networking=1 performance_schema=0 buffer_pool=192M max_connections=30 log_bin=0" "$("${MY[@]}" -e 'SELECT @@skip_networking, @@performance_schema, @@innodb_buffer_pool_size, @@max_connections, @@log_bin' | tr '\t' ' ')" "1 0 201326592 30 0"
    t_eq "effective: slow log on, 2 s threshold, general log off" "$("${MY[@]}" -e 'SELECT @@slow_query_log, @@long_query_time, @@general_log' | tr '\t' ' ')" "1 2.000000 0"
    t_eq "effective: utf8mb4 server charset" "$("${MY[@]}" -e 'SELECT @@character_set_server')" "utf8mb4"
    t_eq "effective: table caches 800" "$("${MY[@]}" -e 'SELECT @@table_open_cache, @@table_definition_cache' | tr '\t' ' ')" "800 800"
    t_eq "the server has NO TCP listener at all (socket only)" "$("${MY[@]}" -e 'SELECT @@port > 0 AND @@skip_networking = 0')" "0"

    echo "== create-staging-db.sh (grants verified against the throwaway server) =="
    SEC="$TMP/secrets"; BKCNF="$TMP/backup.cnf"
    CDB() { env AICC_TEST_HARNESS=1 bash "$PROV/create-staging-db.sh" --socket "$M/s.sock" --secrets-dir "$SEC" --backup-cnf "$BKCNF" --mysql-bin "$LOCALMY/mysql" "$@"; }
    OUTDB="$(CDB 2>&1)"; rc=$?
    t_eq "create-staging-db succeeds" "$rc" "0"
    t_ok "app password file is 0600" bash -c "[ \"\$(mode '$SEC/db-cp.pass')\" = 600 ]"
    t_ok "backup.cnf is 0600" bash -c "[ \"\$(mode '$BKCNF')\" = 600 ]"
    t_not_contains "the app password is never printed" "$OUTDB" "$(cat "$SEC/db-cp.pass")"
    t_not_contains "the backup password is never printed" "$OUTDB" "$(cat "$SEC/db-backup.pass")"
    P1="$(cat "$SEC/db-cp.pass")"; CDB >/dev/null 2>&1
    t_eq "IDEMPOTENT: a re-run keeps the same password" "$(cat "$SEC/db-cp.pass")" "$P1"
    APPC="$TMP/app.cnf"; printf '[client]\nuser=aicc_cp\npassword=%s\nsocket=%s/s.sock\n' "$P1" "$M" > "$APPC"; chmod 600 "$APPC"
    APP=("$LOCALMY/mysql" --defaults-extra-file="$APPC" -N); BK=("$LOCALMY/mysql" --defaults-extra-file="$BKCNF" -N)
    t_ok "app user can create tables in aicc_cp" "${APP[@]}" aicc_cp -e "CREATE TABLE wp_options (option_id INT PRIMARY KEY AUTO_INCREMENT, option_name VARCHAR(191), option_value LONGTEXT); INSERT INTO wp_options (option_name, option_value) VALUES ('siteurl','https://stage.copilt.org'),('blogname','AICC'); CREATE TABLE wp_posts (ID INT PRIMARY KEY, post_title TEXT); CREATE VIEW v_opts AS SELECT option_name FROM wp_options; CREATE TRIGGER trg_ins BEFORE INSERT ON wp_posts FOR EACH ROW SET NEW.post_title = UPPER(NEW.post_title); CREATE FUNCTION f_one() RETURNS INT DETERMINISTIC RETURN 1; CREATE EVENT ev_noop ON SCHEDULE EVERY 1 DAY DO SELECT 1;"
    t_fail "app user cannot create another database" "${APP[@]}" -e "CREATE DATABASE other"
    t_fail "app user cannot read mysql.user" "${APP[@]}" -e "SELECT * FROM mysql.user"
    t_ok "backup user can SELECT in aicc_cp" "${BK[@]}" -e "SELECT COUNT(*) FROM aicc_cp.wp_options"
    t_fail "backup user cannot INSERT in aicc_cp" "${BK[@]}" -e "INSERT INTO aicc_cp.wp_options (option_name) VALUES ('x')"
    t_fail "backup user cannot DROP in aicc_cp" "${BK[@]}" -e "DROP TABLE aicc_cp.wp_posts"
    t_ok "backup user can create and drop aicc_restore_check" "${BK[@]}" -e "CREATE DATABASE aicc_restore_check; DROP DATABASE aicc_restore_check"
    t_fail "backup user cannot create any other database" "${BK[@]}" -e "CREATE DATABASE aicc_restore_checkX"
    t_fail "backup user cannot create a differently named lookalike (underscore escaped in the GRANT)" "${BK[@]}" -e "CREATE DATABASE aiccXrestoreXcheck"
    t_rc "--db with a non-aicc name is refused" 1 env AICC_TEST_HARNESS=1 bash "$PROV/create-staging-db.sh" --db mysql --socket "$M/s.sock" --secrets-dir "$SEC" --backup-cnf "$BKCNF" --mysql-bin "$LOCALMY/mysql"
    t_rc "--db aicc_restore_check is refused" 1 env AICC_TEST_HARNESS=1 bash "$PROV/create-staging-db.sh" --db aicc_restore_check --socket "$M/s.sock" --secrets-dir "$SEC" --backup-cnf "$BKCNF" --mysql-bin "$LOCALMY/mysql"
    t_ok "--dry-run touches nothing" bash "$PROV/create-staging-db.sh" --dry-run

    echo "== wp-config rendering =="
    WC="$TMP/wpcfg"; mkdir -p "$WC/shared"
    RWC() { env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --out "$WC/shared/wp-config.php" --secrets-dir "$SEC" --owner "$(id -un):$(id -gn)" "$@"; }
    OUTW="$(RWC 2>&1)"; rc=$?
    t_eq "render-wp-config succeeds" "$rc" "0"
    t_ok "rendered file passes php -l" php -l "$WC/shared/wp-config.php"
    t_eq "rendered file is mode 0640" "$(mode "$WC/shared/wp-config.php")" "640"
    t_eq "no placeholder is left in the rendered file" "$(grep -c '@@' "$WC/shared/wp-config.php" || true)" "0"
    t_not_contains "no secret in the script's output" "$OUTW" "$(sed -n 's/^AUTH_KEY=//p' "$SEC/wp-secrets.env")"
    mkdir -p "$WC/abs"; echo '<?php echo json_encode(array("home"=>WP_HOME,"siteurl"=>WP_SITEURL,"env"=>WP_ENVIRONMENT_TYPE,"dbhost"=>DB_HOST,"fmods"=>DISALLOW_FILE_MODS,"cron"=>DISABLE_WP_CRON,"debug"=>WP_DEBUG,"proxies"=>AICC_LM_TRUSTED_PROXIES,"ops"=>AICC_LM_OPERATOR_CIDRS,"charset"=>DB_CHARSET,"dbuser"=>DB_USER,"dbname"=>DB_NAME,"mem"=>WP_MEMORY_LIMIT,"maxmem"=>WP_MAX_MEMORY_LIMIT,"autoupd"=>AUTOMATIC_UPDATER_DISABLED,"ssladmin"=>FORCE_SSL_ADMIN,"devboot"=>defined("AICC_LM_ALLOW_DEV_SECRET_BOOTSTRAP"),"fixture"=>defined("AICC_LM_TEST_FIXTURE")));' > "$WC/abs/wp-settings.php"
    CONF="$(php -r 'define("ABSPATH", $argv[2]); require $argv[1];' "$WC/shared/wp-config.php" "$WC/abs/" 2>&1)"
    t_eq "WP_HOME and WP_SITEURL are https://stage.copilt.org" "$(echo "$CONF" | jq -r '.home + " " + .siteurl')" "https://stage.copilt.org https://stage.copilt.org"
    t_eq "WP_ENVIRONMENT_TYPE staging" "$(echo "$CONF" | jq -r .env)" "staging"
    t_eq "DB_HOST is the MySQL unix socket" "$(echo "$CONF" | jq -r .dbhost)" "localhost:/run/mysqld/mysqld.sock"
    t_eq "DISALLOW_FILE_MODS true, DISABLE_WP_CRON true, WP_DEBUG false" "$(echo "$CONF" | jq -r '[.fmods,.cron,.debug]|join(" ")')" "true true false"
    t_eq "AICC_LM_TRUSTED_PROXIES is empty" "$(echo "$CONF" | jq -c .proxies)" "[]"
    t_eq "AICC_LM_OPERATOR_CIDRS is loopback only" "$(echo "$CONF" | jq -c .ops)" '["127.0.0.1/32","::1/128"]'
    t_eq "auto updates off, admin over SSL" "$(echo "$CONF" | jq -r '[.autoupd,.ssladmin]|join(" ")')" "true true"
    t_eq "memory ceilings 128M/192M match the pool" "$(echo "$CONF" | jq -r '[.mem,.maxmem]|join(" ")')" "128M 192M"
    t_eq "the dev secret bootstrap and test-fixture constants are NOT defined" "$(echo "$CONF" | jq -r '[.devboot,.fixture]|join(" ")')" "false false"
    t_eq "DB_USER/DB_NAME as created" "$(echo "$CONF" | jq -r '.dbuser + " " + .dbname')" "aicc_cp aicc_cp"
    SUM1="$(shasum -a 256 "$WC/shared/wp-config.php" | cut -d' ' -f1)"; RWC >/dev/null 2>&1
    t_eq "IDEMPOTENT: re-render gives an identical file (salts reused)" "$(shasum -a 256 "$WC/shared/wp-config.php" | cut -d' ' -f1)" "$SUM1"
    RWC --force-salts >/dev/null 2>&1
    t_fail "--force-salts changes the keys" bash -c "[ \"\$(shasum -a 256 '$WC/shared/wp-config.php' | cut -d' ' -f1)\" = '$SUM1' ]"
    t_fail "the template in git has no secret-looking define with a value" grep -Eq "define\( '(AUTH|SECURE_AUTH|LOGGED_IN|NONCE)_(KEY|SALT)', '[A-Za-z0-9]{16,}'" "$PROV/wp-config.stage.template.php"
    t_rc "rendering the PRODUCTION template is refused (record only, not usable)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --template "$PROV/wp-config.production.template.php" --out "$WC/prod.php" --secrets-dir "$SEC"
    t_ok "... and the refusal says why" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --template '$PROV/wp-config.production.template.php' --out '$WC/prod.php' --secrets-dir '$SEC' 2>&1 | grep -q 'production template'"
    t_ok "... and nothing was written" test ! -e "$WC/prod.php"
    echo "== production wp-config path (rendered into a scratch dir only; the host is never touched) =="
    PSEC="$TMP/psecrets"; mkdir -p "$PSEC"; chmod 700 "$PSEC"; cp "$SEC/db-cp.pass" "$PSEC/"
    PW() { env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --env production "$@" --out "$WC/prod.php" --secrets-dir "$PSEC" --mail-dir "${MAILD:-$TMP/none-mail}"; }
    t_rc "production render without --confirm-production is refused" 1 PW
    t_ok "...and the refusal says why" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --out '$WC/prod.php' --secrets-dir '$PSEC' 2>&1 | grep -q 'confirm-production'"
    t_rc "production render without the owner-provided secrets is refused" 1 PW --confirm-production
    t_ok "...naming the missing file, never generating it" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --out '$WC/prod.php' --secrets-dir '$PSEC' 2>&1 | grep -q 'entitlement-webhook.secret is missing'"
    t_fail "...and nothing was written" test -e "$WC/prod.php"
    t_fail "...and the secrets directory gained no generated shared secret" test -e "$PSEC/entitlement-webhook.secret"
    printf 'WEBHOOK-test-0123456789-0123456789-abcdef\n' > "$PSEC/entitlement-webhook.secret"; printf 'PROOF-test-0123456789-0123456789-abcdefgh\n' > "$PSEC/activation-proof.secret"; chmod 644 "$PSEC/entitlement-webhook.secret"; chmod 600 "$PSEC/activation-proof.secret"
    t_rc "an owner secret with mode 0644 is refused" 1 PW --confirm-production
    chmod 600 "$PSEC/entitlement-webhook.secret"
    t_rc "a too-short owner secret is refused" 1 bash -c "printf 'short' > '$PSEC/activation-proof.secret'; env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --out '$WC/prod.php' --secrets-dir '$PSEC'"
    printf 'PROOF-test-0123456789-0123456789-abcdefgh\n' > "$PSEC/activation-proof.secret"
    t_rc "a secret containing a quote (would break the PHP string) is refused" 1 bash -c "printf \"WEBHOOK'quote-0123456789-0123456789-abcdef\" > '$PSEC/entitlement-webhook.secret'; env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --out '$WC/prod.php' --secrets-dir '$PSEC'"
    t_rc "an owner secret of 40 identical characters (a placeholder) is refused" 1 bash -c "printf 'a%.0s' \$(seq 40) > '$PSEC/entitlement-webhook.secret'; env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --out '$WC/prod.php' --secrets-dir '$PSEC'"
    printf 'WEBHOOK-test-0123456789-0123456789-abcdef\n' > "$PSEC/entitlement-webhook.secret"
    t_rc "an owner secret with mode 0666 is refused" 1 bash -c "chmod 666 '$PSEC/activation-proof.secret'; env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --out '$WC/prod.php' --secrets-dir '$PSEC'"
    chmod 600 "$PSEC/activation-proof.secret"
    t_rc "a production template without its marker is refused" 1 bash -c "grep -v 'AICC_TEMPLATE: production' '$PROV/wp-config.production.template.php' > '$TMP/nomarker.php'; env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --template '$TMP/nomarker.php' --out '$WC/prod.php' --secrets-dir '$PSEC'"
    t_rc "a production template whose WP_HOME is not www.copilt.org is refused" 1 bash -c "sed \"s#define( 'WP_HOME', 'https://www.copilt.org' )#define( 'WP_HOME', 'https://example.org' )#\" '$PROV/wp-config.production.template.php' > '$TMP/otherhome.php'; env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --template '$TMP/otherhome.php' --out '$WC/prod.php' --secrets-dir '$PSEC'"
    t_rc "a production template that carries the staging host in code is refused" 1 bash -c "sed \"s#define( 'WP_ACCESSIBLE_HOSTS', 'api.copilt.org' )#define( 'WP_ACCESSIBLE_HOSTS', 'stage.copilt.org' )#\" '$PROV/wp-config.production.template.php' > '$TMP/badprod.php'; env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --template '$TMP/badprod.php' --out '$WC/prod.php' --secrets-dir '$PSEC'"
    t_fail "none of the refused renders wrote a production file" test -e "$WC/prod.php"
    t_rc "the PRODUCTION template cannot be used by the stage renderer" 1 env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --template "$PROV/wp-config.production.template.php" --out "$WC/x1.php" --secrets-dir "$SEC"
    t_rc "the STAGE template cannot be used with --env production" 1 env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --env production --confirm-production --template "$PROV/wp-config.stage.template.php" --out "$WC/x2.php" --secrets-dir "$PSEC"
    t_rc "without the test harness, production needs a production host identity (this machine has none)" 1 bash "$PROV/render-wp-config.sh" --env production --confirm-production --out "$WC/x4.php" --secrets-dir "$PSEC"
    t_ok "--env production --dry-run changes nothing" bash "$PROV/render-wp-config.sh" --env production --confirm-production --dry-run --secrets-dir "$PSEC"
    t_ok "with the confirmation and the owner secrets the production config renders" PW --confirm-production
    t_eq "...mode 0640" "$(stat -f %Lp "$WC/prod.php" 2>/dev/null || stat -c %a "$WC/prod.php")" "640"
    t_eq "...no placeholder left" "$(grep -c '@@' "$WC/prod.php" || true)" "0"
    t_ok "...php -l clean" php -l "$WC/prod.php"
    t_eq "the wp-secrets.env generated for production has NO shared secrets (those are the owner's)" "$(grep -c 'AICC_ENTITLEMENT_WEBHOOK_SECRET\|AICC_ACTIVATION_PROOF_SECRET' "$PSEC/wp-secrets.env" || true)" "0"
    mkdir -p "$WC/abs2"; echo '<?php' > "$WC/abs2/wp-settings.php"
    PCONF="$(php -r 'define("ABSPATH", $argv[2]); require $argv[1]; echo json_encode(array("home"=>WP_HOME,"siteurl"=>WP_SITEURL,"env"=>WP_ENVIRONMENT_TYPE,"hosts"=>WP_ACCESSIBLE_HOSTS,"block"=>WP_HTTP_BLOCK_EXTERNAL,"hook"=>AICC_ENTITLEMENT_WEBHOOK_URL,"fmods"=>DISALLOW_FILE_MODS,"fedit"=>DISALLOW_FILE_EDIT,"cron"=>DISABLE_WP_CRON,"debug"=>WP_DEBUG,"debuglog"=>WP_DEBUG_LOG,"debugdisp"=>WP_DEBUG_DISPLAY,"updater"=>AUTOMATIC_UPDATER_DISABLED,"ssl"=>FORCE_SSL_ADMIN,"dbhost"=>DB_HOST,"proxies"=>AICC_LM_TRUSTED_PROXIES,"ops"=>AICC_LM_OPERATOR_CIDRS,"devboot"=>defined("AICC_LM_ALLOW_DEV_SECRET_BOOTSTRAP"),"fixture"=>defined("AICC_LM_TEST_FIXTURE"),"cookiedom"=>defined("COOKIE_DOMAIN")));' "$WC/prod.php" "$WC/abs2/" 2>&1)"
    t_eq "production: WP_HOME/WP_SITEURL are https://www.copilt.org" "$(echo "$PCONF" | jq -r '.home + " " + .siteurl')" "https://www.copilt.org https://www.copilt.org"
    t_eq "production: environment type production, TLS admin" "$(echo "$PCONF" | jq -r '[.env,.ssl]|join(" ")')" "production true"
    t_eq "production: outbound blocked, ONLY the API host allowed" "$(echo "$PCONF" | jq -r '[.block,.hosts]|join(" ")')" "true api.copilt.org"
    t_eq "production: webhook URL is https on the API host" "$(echo "$PCONF" | jq -r .hook)" "https://api.copilt.org/v1/internal/entitlement/webhook"
    t_eq "production: immutable code, no file editor, auto-updates off, system cron" "$(echo "$PCONF" | jq -r '[.fmods,.fedit,.updater,.cron]|join(" ")')" "true true true true"
    t_eq "production: debug, debug log and debug display all off" "$(echo "$PCONF" | jq -r '[.debug,.debuglog,.debugdisp]|join(" ")')" "false false false"
    t_eq "production: DB over the unix socket" "$(echo "$PCONF" | jq -r .dbhost)" "localhost:/run/mysqld/mysqld.sock"
    t_eq "production: no trusted proxies, loopback-only operators" "$(echo "$PCONF" | jq -c '[.proxies,.ops]')" '[[],["127.0.0.1/32","::1/128"]]'
    t_eq "production: dev bootstrap / fixture constants NOT defined, no COOKIE_DOMAIN (host-only cookies)" "$(echo "$PCONF" | jq -r '[.devboot,.fixture,.cookiedom]|join(" ")')" "false false false"
    t_not_contains "the rendered production file names no staging host" "$(cat "$WC/prod.php")" "stage.copilt.org"
    # PINNED: the constants that differ between the stage render and the production render are exactly the environment-specific ones (any other drift fails here)
    DIFFK="$(php -r '$dump=function($f){ $code=file_get_contents($f); preg_match_all("/define\(\s*\x27([A-Z_]+)\x27,\s*(.*?)\s*\);/", $code, $m, PREG_SET_ORDER); $o=[]; foreach($m as $x){ if(preg_match("/^(AUTH|SECURE_AUTH|LOGGED_IN|NONCE)_(KEY|SALT)$/",$x[1])) continue; $o[$x[1]]=$x[2]; } return $o; }; $s=$dump($argv[1]); $p=$dump($argv[2]); $d=[]; foreach(array_unique(array_merge(array_keys($s),array_keys($p))) as $k){ if(($s[$k]??null)!==($p[$k]??null)) $d[]=$k; } sort($d); echo json_encode($d);' "$WC/shared/wp-config.php" "$WC/prod.php")"
    t_eq "PINNED: only environment-specific constants differ between the stage and the production render" "$DIFFK" '["AICC_ACTIVATION_PROOF_SECRET","AICC_ENTITLEMENT_WEBHOOK_SECRET","AICC_ENTITLEMENT_WEBHOOK_URL","WP_ACCESSIBLE_HOSTS","WP_ENVIRONMENT_TYPE","WP_HOME","WP_SITEURL"]'
    # mutation proof for the pin itself: a drifted production copy must change the set
    sed "s#define( 'DISALLOW_FILE_EDIT', true )#define( 'DISALLOW_FILE_EDIT', false )#" "$WC/prod.php" > "$WC/prod.drift.php"
    DRIFT="$(php -r '$dump=function($f){ $code=file_get_contents($f); preg_match_all("/define\(\s*\x27([A-Z_]+)\x27,\s*(.*?)\s*\);/", $code, $m, PREG_SET_ORDER); $o=[]; foreach($m as $x){ $o[$x[1]]=$x[2]; } return $o; }; $s=$dump($argv[1]); $p=$dump($argv[2]); echo (($s["DISALLOW_FILE_EDIT"]??null)!==($p["DISALLOW_FILE_EDIT"]??null)) ? "detected" : "missed";' "$WC/shared/wp-config.php" "$WC/prod.drift.php")"
    t_eq "...and a drifted production copy (DISALLOW_FILE_EDIT false) is detected by the same comparison" "$DRIFT" "detected"
    echo "== AICC_LM_PLUGIN_RELEASE_DIR (private Plugin release store) =="
    t_eq "stage and production define the SAME release dir (so it is not in the pinned diff set)" "$(php -r 'define("ABSPATH",$argv[3]); foreach(array($argv[1],$argv[2]) as $f){ $c=file_get_contents($f); preg_match("/define\(\s*\x27AICC_LM_PLUGIN_RELEASE_DIR\x27,\s*\x27([^\x27]+)\x27/",$c,$m); echo $m[1]," "; }' "$WC/shared/wp-config.php" "$WC/prod.php" "$WC/abs2/")" "/srv/aicc/shared/plugin-releases /srv/aicc/shared/plugin-releases "
    webroot_class() { case "$1" in /srv/aicc/site/*|/srv/aicc/cp/*|/srv/aicc/shared/uploads*|*/wp-content*) echo inside ;; /*) echo outside ;; *) echo relative ;; esac; }
    t_eq "the store is absolute and outside both web roots (site static root, CP docroot, uploads)" "$(webroot_class /srv/aicc/shared/plugin-releases)" "outside"
    RELD="$TMP/relstore"; mkdir -p "$RELD"; chmod 750 "$RELD"
    t_not_contains "no warning when the store exists with mode 750" "$(env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --env production --confirm-production --out "$WC/prod2.php" --secrets-dir "$PSEC" --mail-dir "$TMP/none-mail" --plugin-release-dir "$RELD" 2>&1)" "plugin-releases"
    t_contains "a missing store is a WARNING, not a refusal" "$(env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --env production --confirm-production --out "$WC/prod3.php" --secrets-dir "$PSEC" --mail-dir "$TMP/none-mail" --plugin-release-dir "$TMP/missing-store" 2>&1)" "does not exist yet"
    t_ok "...and the config was still written" test -s "$WC/prod3.php"
    chmod 755 "$RELD"; t_contains "a store that is not 750 is a WARNING" "$(env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --env production --confirm-production --out "$WC/prod4.php" --secrets-dir "$PSEC" --mail-dir "$TMP/none-mail" --plugin-release-dir "$RELD" 2>&1)" "must be mode 750"
    t_contains "install-stack creates the store (root:aicc-cp 0750) in its users-dirs step" "$(cat "$PROV/install-stack.sh")" "ensure_dir 0750 root:aicc-cp /srv/aicc/shared/plugin-releases"
    echo "== production mail region (AICC_MAIL_*): enabled only by a SAFE /etc/aicc/secrets/smtp.env; staging never gets it =="
    t_eq "no smtp.env: the production render carries NO AICC_MAIL_ constant (mail layer inert, nothing falls back to PHP mail())" "$(grep -c "define( 'AICC_MAIL_" "$WC/prod.php" || true)" "0"
    t_contains "...and says so in a comment" "$(cat "$WC/prod.php")" "mail layer NOT enabled"
    t_eq "...no region markers left in the output" "$(grep -c '@@MAIL' "$WC/prod.php" || true)" "0"
    MAILUSER="brevo-login@example.org"; MAILPASS="xsmtpsib-0123456789abcdefABCDEF0123456789"
    MAILD="$TMP/aicc-mail"; mkdir -p "$MAILD"; chmod 750 "$MAILD"; SMTPF="$MAILD/smtp.env"
    printf 'AICC_MAIL_SMTP_USER=%s\nAICC_MAIL_SMTP_PASS=%s\n' "$MAILUSER" "$MAILPASS" > "$SMTPF"
    chmod 666 "$SMTPF"; t_rc "smtp.env readable/writable by everybody (0666) is REFUSED" 1 PW --confirm-production
    chmod 644 "$SMTPF"; t_rc "smtp.env world-readable (0644) is REFUSED" 1 PW --confirm-production
    chmod 660 "$SMTPF"; t_rc "smtp.env group-writable (0660) is REFUSED" 1 PW --confirm-production
    t_fail "...the refusals wrote nothing new (prod.php is still the no-mail render)" grep -q "define( 'AICC_MAIL_" "$WC/prod.php"
    chmod 640 "$SMTPF"
    printf 'AICC_MAIL_SMTP_USER=%s\n' "$MAILUSER" > "$SMTPF"; chmod 640 "$SMTPF"; t_rc "smtp.env with only the user (no password) is REFUSED" 1 PW --confirm-production
    printf 'AICC_MAIL_SMTP_USER=%s\nAICC_MAIL_SMTP_PASS=%s\nEXTRA_KEY=1\n' "$MAILUSER" "$MAILPASS" > "$SMTPF"; chmod 640 "$SMTPF"; t_rc "smtp.env with an extra key is REFUSED (exactly two keys)" 1 PW --confirm-production
    printf 'AICC_MAIL_SMTP_USER=%s\nAICC_MAIL_SMTP_PASS=pass with space\n' "$MAILUSER" > "$SMTPF"; chmod 640 "$SMTPF"; t_rc "smtp.env with a space in the password is REFUSED" 1 PW --confirm-production
    printf 'AICC_MAIL_SMTP_USER=%s\nAICC_MAIL_SMTP_PASS=\n' "$MAILUSER" > "$SMTPF"; chmod 640 "$SMTPF"; t_rc "smtp.env with an empty password is REFUSED" 1 PW --confirm-production
    printf 'AICC_MAIL_SMTP_USER=%s\nAICC_MAIL_SMTP_PASS=%s\nAICC_MAIL_SMTP_PASS=again\n' "$MAILUSER" "$MAILPASS" > "$SMTPF"; chmod 640 "$SMTPF"; t_rc "smtp.env with a duplicated key is REFUSED" 1 PW --confirm-production
    ln -s "$TMP/elsewhere.env" "$PSEC/smtp.link" 2>/dev/null; rm -f "$PSEC/smtp.link"
    printf 'AICC_MAIL_SMTP_USER=%s\nAICC_MAIL_SMTP_PASS=%s\n' "$MAILUSER" "$MAILPASS" > "$SMTPF"; chmod 640 "$SMTPF"
    OUTM="$(PW --confirm-production 2>&1)"; rcm=$?
    t_eq "a safe smtp.env (0640, exactly the two keys) renders" "$rcm" "0"
    t_not_contains "the render output never prints the mail credentials" "$OUTM" "$MAILPASS"
    t_not_contains "...nor the login" "$OUTM" "$MAILUSER"
    t_eq "the rendered file carries all eight AICC_MAIL_ constants" "$(grep -c "^define( 'AICC_MAIL_" "$WC/prod.php")" "8"
    t_not_contains "the rendered wp-config carries NO mail credential (they stay in smtp.env)" "$(cat "$WC/prod.php")" "$MAILPASS"
    t_not_contains "...nor the login" "$(cat "$WC/prod.php")" "$MAILUSER"
    t_ok "...php -l clean with the region" php -l "$WC/prod.php"
    t_eq "...no region markers or placeholders left" "$(grep -c '@@' "$WC/prod.php" || true)" "0"
    MCONF="$(php -r 'define("ABSPATH", $argv[2]); require $argv[1]; echo json_encode(array(AICC_MAIL_ENABLED, AICC_MAIL_SMTP_HOST, AICC_MAIL_SMTP_PORT, AICC_MAIL_SMTP_SECURE, AICC_MAIL_SECRETS_FILE, AICC_MAIL_FROM_ADDRESS, AICC_MAIL_REPLY_TO, WP_ACCESSIBLE_HOSTS));' "$WC/prod.php" "$WC/abs2/")"
    t_eq "mail constants: enabled === true, Brevo relay on 2525 with STARTTLS, secrets-file path, the support From/Reply-To" "$(echo "$MCONF" | jq -c '.[0:7]')" '[true,"smtp-relay.brevo.com",2525,"starttls","/etc/aicc-mail/smtp.env","support@copilt.org","support@copilt.org"]'
    t_eq "the SMTP relay is NOT in WP_ACCESSIBLE_HOSTS (the layer uses PHPMailer sockets, not wp_remote_*)" "$(echo "$MCONF" | jq -r '.[7]')" "api.copilt.org"
    DIFFM="$(php -r '$dump=function($f){ $code=file_get_contents($f); preg_match_all("/define\(\s*\x27([A-Z_]+)\x27,\s*(.*?)\s*\);/", $code, $m, PREG_SET_ORDER); $o=[]; foreach($m as $x){ if(preg_match("/^(AUTH|SECURE_AUTH|LOGGED_IN|NONCE)_(KEY|SALT)$/",$x[1])) continue; $o[$x[1]]=$x[2]; } return $o; }; $s=$dump($argv[1]); $p=$dump($argv[2]); $d=[]; foreach(array_unique(array_merge(array_keys($s),array_keys($p))) as $k){ if(($s[$k]??null)!==($p[$k]??null)) $d[]=$k; } sort($d); echo json_encode($d);' "$WC/shared/wp-config.php" "$WC/prod.php")"
    t_eq "PINNED (with mail): the differing constants are the environment ones PLUS exactly the eight AICC_MAIL_ constants" "$DIFFM" '["AICC_ACTIVATION_PROOF_SECRET","AICC_ENTITLEMENT_WEBHOOK_SECRET","AICC_ENTITLEMENT_WEBHOOK_URL","AICC_MAIL_ENABLED","AICC_MAIL_FROM_ADDRESS","AICC_MAIL_FROM_NAME","AICC_MAIL_REPLY_TO","AICC_MAIL_SECRETS_FILE","AICC_MAIL_SMTP_HOST","AICC_MAIL_SMTP_PORT","AICC_MAIL_SMTP_SECURE","WP_ACCESSIBLE_HOSTS","WP_ENVIRONMENT_TYPE","WP_HOME","WP_SITEURL"]'
    t_ok "dry-run says whether the mail layer would be enabled and prints nothing secret" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --dry-run --secrets-dir '$PSEC' --mail-dir '$MAILD' | grep -q 'mail layer ENABLED'"
    # the STAGE render must never carry the region, even when a smtp.env happens to exist next to its secrets
    cp "$SMTPF" "$MAILD/stage-copy.env"; cp "$SMTPF" "$SEC/smtp.env"; chmod 640 "$SEC/smtp.env"
    t_ok "stage render with a smtp.env present still succeeds" env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --out "$WC/stage-with-smtp.php" --secrets-dir "$SEC" --owner "$(id -un):$(id -gn)"
    t_eq "...and carries NO AICC_MAIL_ constant (staging keeps the mail sink)" "$(grep -c "define( 'AICC_MAIL_" "$WC/stage-with-smtp.php" || true)" "0"
    rm -f "$SEC/smtp.env"
    t_eq "the stage template itself has no AICC_MAIL_ at all" "$(grep -c "AICC_MAIL_" "$PROV/wp-config.stage.template.php" || true)" "0"
    t_eq "the production template has the region exactly once" "$(grep -c '@@MAIL_BEGIN@@' "$PROV/wp-config.production.template.php")/$(grep -c '@@MAIL_END@@' "$PROV/wp-config.production.template.php")" "1/1"
    rm -f "$SMTPF"
    t_ok "removing smtp.env and re-rendering turns the mail layer off again" PW --confirm-production
    t_eq "...no AICC_MAIL_ constant left" "$(grep -c "define( 'AICC_MAIL_" "$WC/prod.php" || true)" "0"
    echo "== owner facts region (AICC_ACTIVATION_PROOF_KID, AICC_LEGAL_*, gateway allowlists, extra gateway host): rendered from a root-only host file; unset = byte-for-byte what it always was =="
    OFD="$TMP/ofacts"; OFSEC="$OFD/sec"; mkdir -p "$OFSEC" "$OFD/rel" "$OFD/abs"; chmod 700 "$OFSEC"; chmod 750 "$OFD/rel"; echo '<?php' > "$OFD/abs/wp-settings.php"
    printf 'golden_db_pass_0001\n' > "$OFSEC/db-cp.pass"; OFHEX="$(printf 'ab12%.0s' $(seq 16))"
    seedsalts() { { for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT; do printf '%s=SALTVALUE_%s\n' "$k" "$k"; done; printf 'AICC_ACTIVATION_PROOF_SECRET=%s\nAICC_ENTITLEMENT_WEBHOOK_SECRET=%s\n' "$OFHEX" "$OFHEX"; } > "$OFSEC/wp-secrets.env"; chmod 600 "$OFSEC/wp-secrets.env"; }
    seedsalts
    printf 'WEBHOOK-test-0123456789-0123456789-abcdef\n' > "$OFSEC/entitlement-webhook.secret"; printf 'PROOF-test-0123456789-0123456789-abcdefgh\n' > "$OFSEC/activation-proof.secret"; chmod 600 "$OFSEC/"*.secret
    OFU="$(id -un):$(id -gn)"; OFF="$OFD/owner-facts.env"     # the default location is next to the secrets directory (/etc/aicc/owner-facts.env on a host)
    OFR() { env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --env production --confirm-production --out "$OFD/prod.php" --secrets-dir "$OFSEC" --mail-dir "$OFD/nomail" --plugin-release-dir "$OFD/rel" --owner "$OFU" "$@"; }
    OFS() { env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --out "$OFD/stage.php" --secrets-dir "$OFSEC" --plugin-release-dir "$OFD/rel" --owner "$OFU" "$@"; }
    OFT() { env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production "$@"; }
    OFTS() { env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env stage "$@"; }
    hexnorm() { sed -E 's/[0-9a-f]{64}/HEX64/g' "$1"; }
    cst() { local f="$1"; shift; php -r 'define("ABSPATH",$argv[2]); require $argv[1]; $o=array(); foreach (array_slice($argv,3) as $n) { $o[$n]=defined($n)?constant($n):null; } echo json_encode($o);' "$f" "$OFD/abs/" "$@"; }
    sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
    ALLK="AICC_ACTIVATION_PROOF_KID AICC_LEGAL_ENTITY_NAME AICC_LEGAL_ENTITY_ADDRESS AICC_LEGAL_SUPPORT_EMAIL AICC_LEGAL_GOVERNING_LAW AICC_LEGAL_JURISDICTION AICC_LEGAL_PAYMENT_PROCESSOR AICC_LEGAL_VAT_DETAILS AICC_LEGAL_REVIEW_APPROVED AICC_LEGAL_SUBPROCESSORS_VERIFIED AICC_STRUCTURED_DATA_OFFERS AICC_LM_PAID_GATEWAYS AICC_LAUNCH_REAL_GATEWAYS AICC_LM_PAYMENT_GATE_STRICT"
    # --- unset: byte-for-byte golden files, produced by the renderer and templates as they were BEFORE this region existed
    t_ok "the production template has the owner-facts region exactly once" bash -c "[ \"\$(grep -c '@@OWNER_FACTS_BEGIN@@' '$PROV/wp-config.production.template.php')/\$(grep -c '@@OWNER_FACTS_END@@' '$PROV/wp-config.production.template.php')/\$(grep -c '^@@OWNER_FACTS@@' '$PROV/wp-config.production.template.php')\" = 1/1/1 ]"
    t_ok "the stage template has the owner-facts region exactly once" bash -c "[ \"\$(grep -c '@@OWNER_FACTS_BEGIN@@' '$PROV/wp-config.stage.template.php')/\$(grep -c '@@OWNER_FACTS_END@@' '$PROV/wp-config.stage.template.php')/\$(grep -c '^@@OWNER_FACTS@@' '$PROV/wp-config.stage.template.php')\" = 1/1/1 ]"
    OFR >/dev/null 2>&1; t_ok "UNSET production render == golden (byte for byte, 64-hex values normalised)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OFD/prod.php') '$HERE/golden/wp-config.production.no-owner-facts.php'"
    OFS >/dev/null 2>&1; t_ok "UNSET stage render == golden (byte for byte, 64-hex values normalised)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OFD/stage.php') '$HERE/golden/wp-config.stage.no-owner-facts.php'"
    t_eq "...the unset render contains no owner-facts marker, placeholder or region comment" "$(grep -c 'OWNER_FACTS\|OWNER FACTS\|@@' "$OFD/prod.php" "$OFD/stage.php" | tr '\n' ' ')" "$OFD/prod.php:0 $OFD/stage.php:0 "
    t_eq "...and defines none of the owner-fact constants (the launch gate keeps its empty AICC_LAUNCH_REAL_GATEWAYS fallback; the payment gate keeps its empty allowlist)" "$(cst "$OFD/prod.php" $ALLK | jq -c '[.[]|select(.!=null)]')" "[]"
    t_eq "...and WP_ACCESSIBLE_HOSTS is exactly the API host" "$(cst "$OFD/prod.php" WP_ACCESSIBLE_HOSTS | jq -r .WP_ACCESSIBLE_HOSTS)" "api.copilt.org"
    printf '# only a comment\n\n' > "$OFF"; chmod 600 "$OFF"
    OFR >/dev/null 2>&1; t_ok "an EMPTY (comment-only) facts file renders the same golden file" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OFD/prod.php') '$HERE/golden/wp-config.production.no-owner-facts.php'"
    t_contains "the dry run reports zero values" "$(OFR --dry-run 2>&1)" "owner facts: 0 value(s)"
    rm -f "$OFF"
    # --- the operator command: set / list / unset
    t_rc "set: nothing is created for an unknown key" 1 OFT set AICC_NOT_A_KEY x
    t_fail "...no facts file was created by the refusal" test -e "$OFF"
    t_ok "set AICC_ACTIVATION_PROOF_KID" OFT set AICC_ACTIVATION_PROOF_KID prod-2026-10
    t_eq "the facts file is mode 0600" "$(mode "$OFF")" "600"
    t_ok "set the six required legal facts + the optional VAT text" bash -c "set -e; T() { env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$OFF' --env production \"\$@\" >/dev/null; }; T set AICC_LEGAL_ENTITY_NAME 'Example Studio Ltd'; T set AICC_LEGAL_ENTITY_ADDRESS '1 Example Street, Example City'; T set AICC_LEGAL_SUPPORT_EMAIL support@copilt.org; T set AICC_LEGAL_GOVERNING_LAW 'the laws of Example'; T set AICC_LEGAL_JURISDICTION 'the courts of Example City'; T set AICC_LEGAL_PAYMENT_PROCESSOR PayPlus; T set AICC_LEGAL_VAT_DETAILS 'VAT exempt'"
    t_ok "set the two launch switches and the date" bash -c "set -e; T() { env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$OFF' --env production \"\$@\" >/dev/null; }; T set AICC_LEGAL_REVIEW_APPROVED true; T set AICC_LEGAL_SUBPROCESSORS_VERIFIED 2026-10-23; T set AICC_STRUCTURED_DATA_OFFERS true"
    t_ok "set the payment gateway family (card + wallets, exact ids) and the launch list" bash -c "set -e; T() { env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$OFF' --env production \"\$@\" >/dev/null; }; T set AICC_LM_PAID_GATEWAYS 'payplus-payment-gateway:payplus_transaction_uid, payplus-payment-gateway-applepay:payplus_transaction_uid,payplus-payment-gateway-googlepay:payplus_transaction_uid'; T set AICC_LAUNCH_REAL_GATEWAYS payplus-payment-gateway"
    t_ok "set an extra outbound host for the payment gateway" OFT set AICC_EXTRA_ACCESSIBLE_HOSTS restapi.payplus.co.il
    t_eq "the file still has mode 0600 after every write" "$(mode "$OFF")" "600"
    t_eq "list shows the key" "$(OFT list | grep -c '^AICC_ACTIVATION_PROOF_KID=prod-2026-10$')" "1"
    # --- set values are rendered, exactly
    OFSUM="$(sha "$OFF")"
    OUTF="$(OFR 2>&1)"; rcf=$?
    t_eq "production render with facts succeeds" "$rcf" "0"
    t_ok "...php -l clean" php -l "$OFD/prod.php"
    t_eq "...mode 0640 (unchanged)" "$(mode "$OFD/prod.php")" "640"
    t_eq "...owner is the one passed to the renderer (the host passes root:aicc-cp)" "$(stat -c '%U:%G' "$OFD/prod.php" 2>/dev/null || stat -f '%Su:%Sg' "$OFD/prod.php")" "$OFU"
    t_eq "...the renderer did not touch the facts file" "$(sha "$OFF")" "$OFSUM"
    t_eq "...no placeholder or marker is left" "$(grep -c '@@' "$OFD/prod.php" || true)" "0"
    FC="$(cst "$OFD/prod.php" $ALLK WP_ACCESSIBLE_HOSTS WP_HTTP_BLOCK_EXTERNAL)"
    t_eq "proof key id rendered" "$(echo "$FC" | jq -r .AICC_ACTIVATION_PROOF_KID)" "prod-2026-10"
    t_eq "the seven legal facts rendered verbatim" "$(echo "$FC" | jq -c '[.AICC_LEGAL_ENTITY_NAME,.AICC_LEGAL_ENTITY_ADDRESS,.AICC_LEGAL_SUPPORT_EMAIL,.AICC_LEGAL_GOVERNING_LAW,.AICC_LEGAL_JURISDICTION,.AICC_LEGAL_PAYMENT_PROCESSOR,.AICC_LEGAL_VAT_DETAILS]')" '["Example Studio Ltd","1 Example Street, Example City","support@copilt.org","the laws of Example","the courts of Example City","PayPlus","VAT exempt"]'
    t_eq "the switches are real booleans / the date is the string the gate expects" "$(echo "$FC" | jq -c '[.AICC_LEGAL_REVIEW_APPROVED,.AICC_STRUCTURED_DATA_OFFERS,.AICC_LEGAL_SUBPROCESSORS_VERIFIED]')" '[true,true,"2026-10-23"]'
    t_eq "AICC_LM_PAID_GATEWAYS: exactly the three listed ids, strict (transaction id required), proof meta kept" "$(echo "$FC" | jq -c '.AICC_LM_PAID_GATEWAYS')" '{"payplus-payment-gateway":{"require_transaction_id":true,"proof_meta":["payplus_transaction_uid"]},"payplus-payment-gateway-applepay":{"require_transaction_id":true,"proof_meta":["payplus_transaction_uid"]},"payplus-payment-gateway-googlepay":{"require_transaction_id":true,"proof_meta":["payplus_transaction_uid"]}}'
    t_eq "AICC_LAUNCH_REAL_GATEWAYS: the one enabled card gateway (a subset of the runtime list)" "$(echo "$FC" | jq -c .AICC_LAUNCH_REAL_GATEWAYS)" '["payplus-payment-gateway"]'
    t_eq "WP_ACCESSIBLE_HOSTS: the API host plus exactly the owner's gateway host; outbound stays blocked" "$(echo "$FC" | jq -r '[.WP_ACCESSIBLE_HOSTS,.WP_HTTP_BLOCK_EXTERNAL]|join(" ")')" "api.copilt.org,restapi.payplus.co.il true"
    t_eq "AICC_LM_PAYMENT_GATE_STRICT is NOT defined by a production render (production is strict by its host name)" "$(echo "$FC" | jq -r .AICC_LM_PAYMENT_GATE_STRICT)" "null"
    t_ok "the facts are in ONE region: every owner-fact define is a single line" bash -c "[ \"\$(grep -c \"^define( 'AICC_\(ACTIVATION_PROOF_KID\|LEGAL_\|STRUCTURED\|LM_PAID_GATEWAYS\|LAUNCH_REAL\)\" '$OFD/prod.php')\" = 13 ]"
    t_not_contains "the render output names no value (nothing from the facts file is printed)" "$OUTF" "Example Studio"
    DIFFO="$(php -r '$dump=function($f){ $code=file_get_contents($f); preg_match_all("/define\(\s*\x27([A-Z_]+)\x27,\s*(.*?)\s*\);/", $code, $m, PREG_SET_ORDER); $o=[]; foreach($m as $x){ if(preg_match("/^(AUTH|SECURE_AUTH|LOGGED_IN|NONCE)_(KEY|SALT)$/",$x[1])) continue; $o[$x[1]]=$x[2]; } return $o; }; $s=$dump($argv[1]); $p=$dump($argv[2]); $d=[]; foreach(array_unique(array_merge(array_keys($s),array_keys($p))) as $k){ if(($s[$k]??null)!==($p[$k]??null)) $d[]=$k; } sort($d); echo json_encode($d);' "$OFD/stage.php" "$OFD/prod.php")"
    t_eq "PINNED (with owner facts): the constants that differ from the stage render are the environment ones plus EXACTLY the thirteen owner-fact constants" "$DIFFO" '["AICC_ACTIVATION_PROOF_KID","AICC_ACTIVATION_PROOF_SECRET","AICC_ENTITLEMENT_WEBHOOK_SECRET","AICC_ENTITLEMENT_WEBHOOK_URL","AICC_LAUNCH_REAL_GATEWAYS","AICC_LEGAL_ENTITY_ADDRESS","AICC_LEGAL_ENTITY_NAME","AICC_LEGAL_GOVERNING_LAW","AICC_LEGAL_JURISDICTION","AICC_LEGAL_PAYMENT_PROCESSOR","AICC_LEGAL_REVIEW_APPROVED","AICC_LEGAL_SUBPROCESSORS_VERIFIED","AICC_LEGAL_SUPPORT_EMAIL","AICC_LEGAL_VAT_DETAILS","AICC_LM_PAID_GATEWAYS","AICC_STRUCTURED_DATA_OFFERS","WP_ACCESSIBLE_HOSTS","WP_ENVIRONMENT_TYPE","WP_HOME","WP_SITEURL"]'
    t_contains "dry run reports the number of values and prints none" "$(OFR --dry-run 2>&1)" "owner facts: 14 value(s)"
    t_not_contains "...nor any value" "$(OFR --dry-run 2>&1)" "Example Studio"
    # --- AICC_COMMERCE_OPEN: the ONE fail-closed switch for "commercial checkout is open" (pre-commercial truth round). Unset = CLOSED = the golden render; only `true`; production only; never without every launch fact.
    t_ok "production \`keys\` lists AICC_COMMERCE_OPEN" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$OFF' --env production keys | grep -q '^AICC_COMMERCE_OPEN$'"
    t_fail "...and stage \`keys\` does not (commerce opens on production only)" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$OFF' --env stage keys | grep -q COMMERCE_OPEN"
    t_rc "stage REFUSES AICC_COMMERCE_OPEN" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFD/stage-only.env" --env stage set AICC_COMMERCE_OPEN true
    for v in yes 1 TRUE True false on open; do t_rc "REFUSED: AICC_COMMERCE_OPEN=$v (only the exact value true)" 1 OFT set AICC_COMMERCE_OPEN "$v"; done
    t_eq "...the refused values wrote nothing" "$(OFT list | grep -c '^AICC_COMMERCE_OPEN=' || true)" "0"
    OFSAVE="$(cat "$OFF")"; OFEMPTY="$OFD/empty-facts.env"
    t_rc "REFUSED on a file that lacks the launch facts (a lone key id): the gate would block, so the switch cannot be set" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFEMPTY" --env production set AICC_COMMERCE_OPEN true
    printf 'AICC_ACTIVATION_PROOF_KID=k1\n' > "$OFEMPTY"; chmod 600 "$OFEMPTY"
    t_contains "...and the refusal names what is missing and says there is no override" "$(env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFEMPTY" --env production set AICC_COMMERCE_OPEN true 2>&1)" "There is no override"
    t_contains "...it names the legal facts, the payment gateways and the review approval" "$(env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFEMPTY" --env production set AICC_COMMERCE_OPEN true 2>&1)" "AICC_LEGAL_ENTITY_NAME"
    t_eq "...and wrote nothing" "$(cat "$OFEMPTY")" "AICC_ACTIVATION_PROOF_KID=k1"
    t_ok "COM-GATE-01: the evidence provider is a launch fact too (set before the switch)" OFT set AICC_LM_PAYMENT_EVIDENCE_PROVIDER payplus
    t_ok "with every launch fact present the switch can be set (last)" OFT set AICC_COMMERCE_OPEN true
    t_eq "...list shows it" "$(OFT list | grep -c '^AICC_COMMERCE_OPEN=true$')" "1"
    for k in AICC_LEGAL_SUPPORT_EMAIL AICC_LEGAL_REVIEW_APPROVED AICC_LAUNCH_REAL_GATEWAYS AICC_LM_PAID_GATEWAYS AICC_ACTIVATION_PROOF_KID AICC_LEGAL_PAYMENT_PROCESSOR; do t_rc "while it is set, unsetting $k is REFUSED (unset AICC_COMMERCE_OPEN first)" 1 OFT unset $k; done
    t_rc "...the render is REFUSED while the mail layer is not enabled (no mail provider: nobody could receive a password link)" 1 OFR
    t_contains "...and says why" "$(OFR 2>&1)" "mail layer"
    mkdir -p "$OFD/mail"; chmod 750 "$OFD/mail"; printf 'AICC_MAIL_SMTP_USER=%s\nAICC_MAIL_SMTP_PASS=%s\n' "brevo-login@example.org" "xsmtpsib-0123456789abcdefABCDEF0123456789" > "$OFD/mail/smtp.env"; chmod 640 "$OFD/mail/smtp.env"
    t_ok "with a safe smtp.env the production render succeeds" OFR --mail-dir "$OFD/mail"
    t_eq "...and defines AICC_COMMERCE_OPEN as the boolean true" "$(cst "$OFD/prod.php" AICC_COMMERCE_OPEN | jq -c .AICC_COMMERCE_OPEN)" "true"
    t_eq "...exactly once, on one line" "$(grep -c "^define( 'AICC_COMMERCE_OPEN', true );$" "$OFD/prod.php")" "1"
    t_ok "unset AICC_COMMERCE_OPEN" OFT unset AICC_COMMERCE_OPEN
    t_ok "...and the evidence provider fact is removed again (the file is back to what it was)" OFT unset AICC_LM_PAYMENT_EVIDENCE_PROVIDER
    t_ok "...the render is no longer refused and defines nothing (closed again)" bash -c "cd '$TMP' && env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --out '$OFD/prod.php' --secrets-dir '$OFSEC' --mail-dir '$OFD/nomail' --plugin-release-dir '$OFD/rel' --owner '$OFU' >/dev/null 2>&1 && ! grep -q \"define( 'AICC_COMMERCE_OPEN'\" '$OFD/prod.php'"
    t_eq "...the facts file is back to what it was before the switch" "$(cat "$OFF")" "$OFSAVE"
    # --- a re-render never loses an owner-set value
    P0="$(hexnorm "$OFD/prod.php" | grep -v '^define( .\(AUTH\|SECURE\|LOGGED\|NONCE\)' | shasum -a 256)"
    OFR >/dev/null 2>&1; OFR --force-salts >/dev/null 2>&1; OFR >/dev/null 2>&1
    seedsalts      # --force-salts replaced the fixed test salts with random ones (and dropped the stage-only values): restore the fixed inputs for the golden comparisons below
    OFR >/dev/null 2>&1
    t_eq "after re-renders (including --force-salts) every owner fact is still there" "$(cst "$OFD/prod.php" $ALLK | jq -c '[.[]|select(.!=null)]|length')" "13"
    t_eq "...and the file is identical apart from the regenerated salts" "$(hexnorm "$OFD/prod.php" | grep -v '^define( .\(AUTH\|SECURE\|LOGGED\|NONCE\)' | shasum -a 256)" "$P0"
    t_eq "the facts file was never modified by any render" "$(sha "$OFF")" "$OFSUM"
    t_ok "a deleted wp-config is re-created WITH the facts (what the restore tool does)" bash -c "rm -f '$OFD/prod.php'; cd '$TMP' && env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --out '$OFD/prod.php' --secrets-dir '$OFSEC' --mail-dir '$OFD/nomail' --plugin-release-dir '$OFD/rel' --owner '$OFU' >/dev/null 2>&1 && grep -q \"define( 'AICC_LEGAL_ENTITY_NAME', 'Example Studio Ltd' )\" '$OFD/prod.php'"
    ln -sfn "$PROV/render-wp-config.sh" "$TMP/aicc-render-wp-config"; ln -sfn "$PROV/owner-facts.sh" "$TMP/aicc-owner-facts"
    t_ok "the renderer works through the /usr/local/sbin-style symlink (it resolves its own directory)" env AICC_TEST_HARNESS=1 bash "$TMP/aicc-render-wp-config" --env production --confirm-production --out "$OFD/prod.sym.php" --secrets-dir "$OFSEC" --mail-dir "$OFD/nomail" --plugin-release-dir "$OFD/rel" --owner "$OFU"
    t_ok "...and so does the owner-facts command" env AICC_TEST_HARNESS=1 bash "$TMP/aicc-owner-facts" --file "$OFF" --env production list
    # --- unset restores the golden render; the other values stay
    t_ok "unset one value" OFT unset AICC_LEGAL_VAT_DETAILS
    t_eq "...it is gone from the file, the rest stays (13)" "$(OFT list | wc -l | tr -d ' ')" "13"
    t_contains "unsetting a value that is not set says so and changes nothing" "$(OFT unset AICC_LEGAL_VAT_DETAILS 2>&1)" "was not set"
    t_rc "unsetting the paid-gateway list while the launch list still names its gateway is refused (order matters)" 1 OFT unset AICC_LM_PAID_GATEWAYS
    for k in AICC_LAUNCH_REAL_GATEWAYS AICC_LM_PAID_GATEWAYS AICC_ACTIVATION_PROOF_KID AICC_LEGAL_ENTITY_NAME AICC_LEGAL_ENTITY_ADDRESS AICC_LEGAL_SUPPORT_EMAIL AICC_LEGAL_GOVERNING_LAW AICC_LEGAL_JURISDICTION AICC_LEGAL_PAYMENT_PROCESSOR AICC_LEGAL_REVIEW_APPROVED AICC_LEGAL_SUBPROCESSORS_VERIFIED AICC_STRUCTURED_DATA_OFFERS AICC_EXTRA_ACCESSIBLE_HOSTS; do OFT unset $k >/dev/null 2>&1; done
    t_eq "after unsetting everything the file lists nothing" "$(OFT list | wc -l | tr -d ' ')" "0"
    OFR >/dev/null 2>&1; t_ok "...and the production render is the golden file again, byte for byte" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OFD/prod.php') '$HERE/golden/wp-config.production.no-owner-facts.php'"
    # --- validation: nothing invalid is accepted, nothing partial is written
    rm -f "$OFF"; OFT set AICC_ACTIVATION_PROOF_KID keep-1 >/dev/null; OFSUM="$(sha "$OFF")"
    bad() { t_rc "REFUSED: $1" 1 OFT set "$2" "$3"; }
    bad "a newline inside a legal fact" AICC_LEGAL_ENTITY_NAME $'Acme\ndefine(1)'
    bad "a carriage return" AICC_LEGAL_ENTITY_NAME $'Acme\rLtd'
    bad "a tab / control character" AICC_LEGAL_ENTITY_NAME $'Acme\tLtd'
    bad "a PHP open tag" AICC_LEGAL_ENTITY_NAME '<?php system("id"); ?>'
    bad "a PHP close tag" AICC_LEGAL_ENTITY_ADDRESS 'x ?> y'
    bad "an angle bracket (no markup in a legal fact)" AICC_LEGAL_JURISDICTION 'a<b'
    bad "a template placeholder" AICC_LEGAL_ENTITY_NAME '@@DB_PASSWORD@@'
    bad "a bidirectional override character" AICC_LEGAL_ENTITY_NAME $'Acme \xe2\x80\xaeLtd'
    bad "an over-long value" AICC_LEGAL_ENTITY_NAME "$(printf 'a%.0s' $(seq 1 201))"
    bad "an empty value" AICC_LEGAL_ENTITY_NAME "   "
    bad "a support address that is not an address" AICC_LEGAL_SUPPORT_EMAIL "a b@copilt.org"
    bad "a support address with a quote" AICC_LEGAL_SUPPORT_EMAIL "a'b@copilt.org"
    bad "a key id with a quote" AICC_ACTIVATION_PROOF_KID "k';system(1);//"
    bad "a key id with a space" AICC_ACTIVATION_PROOF_KID "k 1"
    bad "a switch that is not exactly true" AICC_LEGAL_REVIEW_APPROVED yes
    bad "a switch set to false (unset it instead)" AICC_STRUCTURED_DATA_OFFERS false
    bad "an impossible date" AICC_LEGAL_SUBPROCESSORS_VERIFIED 2026-02-31
    bad "a date in another format" AICC_LEGAL_SUBPROCESSORS_VERIFIED 23/10/2026
    bad "the strict-mode switch in production" AICC_LM_PAYMENT_GATE_STRICT true
    bad "a placeholder gateway" AICC_LM_PAID_GATEWAYS bacs
    bad "a placeholder gateway next to a real one" AICC_LM_PAID_GATEWAYS "payplus-payment-gateway,cod"
    bad "an upper-case gateway id (ids are exact and lower case)" AICC_LM_PAID_GATEWAYS PayPlus
    bad "a gateway id with a pattern character" AICC_LM_PAID_GATEWAYS 'payplus-*'
    bad "a gateway id with a quote" AICC_LM_PAID_GATEWAYS "x'=>1"
    bad "a duplicated gateway id" AICC_LM_PAID_GATEWAYS "a-gw,a-gw"
    bad "a proof meta key with a quote" AICC_LM_PAID_GATEWAYS "a-gw:x'y"
    bad "a stray comma in a gateway list" AICC_LM_PAID_GATEWAYS "a-gw,"
    bad "a launch gateway that the runtime list does not know" AICC_LAUNCH_REAL_GATEWAYS not-in-the-paid-list
    for h in '*.payplus.co.il' 'payplus.co.il,*' '127.0.0.1' '10.0.0.5' 'localhost' 'internal.service.internal' 'host:8443' 'https://restapi.payplus.co.il' 'restapi.payplus.co.il/path' 'a_b.payplus.co.il' 'api.copilt.org' 'stage.copilt.org' 'evil.copilt.org' 'www.copilt.org' 'singlelabel' '-bad.example.com' 'x.payplus.co.il,' $'a.example.net\nb.example.net' "a'.example.net" 'a.b.c.d.e,f.g,h.i,j.k,l.m,n.o'; do bad "extra host '$h'" AICC_EXTRA_ACCESSIBLE_HOSTS "$h"; done
    t_eq "every refusal left the facts file untouched" "$(sha "$OFF")" "$OFSUM"
    t_ok "an upper-case host is accepted and lower-cased" OFT set AICC_EXTRA_ACCESSIBLE_HOSTS 'RestAPI.PayPlus.co.il'
    t_eq "...stored lower case" "$(OFT list | sed -n 's/^AICC_EXTRA_ACCESSIBLE_HOSTS=//p')" "restapi.payplus.co.il"
    t_ok "two hosts are accepted" OFT set AICC_EXTRA_ACCESSIBLE_HOSTS 'restapi.payplus.co.il, restapidev.payplus.co.il'
    OFR >/dev/null 2>&1; t_eq "...both rendered after the API host, nothing else" "$(cst "$OFD/prod.php" WP_ACCESSIBLE_HOSTS | jq -r .WP_ACCESSIBLE_HOSTS)" "api.copilt.org,restapi.payplus.co.il,restapidev.payplus.co.il"
    # --- injection attempts that ARE legal text are escaped, never executed (round trip through real PHP)
    OFT unset AICC_EXTRA_ACCESSIBLE_HOSTS >/dev/null
    rt() { OFT set AICC_LEGAL_ENTITY_NAME "$2" >/dev/null 2>&1 && OFR >/dev/null 2>&1 && t_eq "round trip through PHP: $1" "$(cst "$OFD/prod.php" AICC_LEGAL_ENTITY_NAME AICC_EVIL | jq -r '[.AICC_LEGAL_ENTITY_NAME,(.AICC_EVIL|tostring)]|join("|")')" "$2|null" || t_bad "round trip through PHP: $1" "set or render failed"; }
    rt "an apostrophe" "O'Brien & Sons"
    rt "a quote-semicolon sequence that would end the string and the statement" "x'); define('AICC_EVIL', 1); //"
    rt "a backslash before a quote" "a\\' b"
    rt "a trailing backslash" "Acme\\"
    rt "a double backslash and quote" "Acme \\\\' x"
    rt "dollar, braces, backtick and command substitution syntax" 'Acme $x ${y} `id` $(id)'
    rt "a double quote and a percent sign" 'Acme "Pro" 100%'
    rt "Hebrew and accents" 'חברה בע"מ Café'
    t_not_contains "the rendered file has no second statement from the attack" "$(cat "$OFD/prod.php")" "define('AICC_EVIL'"
    t_ok "...and still passes php -l" php -l "$OFD/prod.php"
    # --- a facts file edited BY HAND (or planted) is validated by the renderer itself: nothing is written
    OFH="$(sha "$OFD/prod.php")"
    hand() { printf '%b' "$2" > "$OFF"; chmod 600 "$OFF"; t_rc "REFUSED by the renderer: $1" 1 OFR; }
    hand "a value that tries to close the string" "AICC_LEGAL_ENTITY_NAME=x'; define('AICC_EVIL', 1); //\nAICC_LEGAL_ENTITY_ADDRESS=<?php echo 1;\n"
    hand "a carriage-return line ending" "AICC_ACTIVATION_PROOF_KID=k1\r\n"
    hand "an unknown key" "AICC_SOMETHING_ELSE=1\n"
    hand "a repeated key" "AICC_ACTIVATION_PROOF_KID=k1\nAICC_ACTIVATION_PROOF_KID=k2\n"
    hand "a line that is not KEY=value" "AICC_ACTIVATION_PROOF_KID k1\n"
    hand "an indented key" " AICC_ACTIVATION_PROOF_KID=k1\n"
    hand "a shell-style export" "export AICC_ACTIVATION_PROOF_KID=k1\n"
    hand "the strict switch in production" "AICC_LM_PAYMENT_GATE_STRICT=true\n"
    hand "a launch gateway missing from the runtime list" "AICC_LAUNCH_REAL_GATEWAYS=gw-x\n"
    hand "a wildcard host" "AICC_EXTRA_ACCESSIBLE_HOSTS=*.example.net\n"
    hand "a NUL byte" "AICC_ACTIVATION_PROOF_KID=k1\0\n"
    hand "invalid UTF-8" "AICC_LEGAL_ENTITY_NAME=\xff\xfe\n"
    t_eq "...and no refusal changed the previously rendered production file" "$(sha "$OFD/prod.php")" "$OFH"
    t_fail "...nothing from the planted file reached any output" grep -q "AICC_EVIL" "$OFD/prod.php"
    printf 'AICC_ACTIVATION_PROOF_KID=k1\n' > "$OFF"
    chmod 644 "$OFF"; t_rc "a world-readable facts file (0644) is refused" 1 OFR
    chmod 660 "$OFF"; t_rc "a group-writable facts file (0660) is refused" 1 OFR
    chmod 666 "$OFF"; t_rc "a world-writable facts file (0666) is refused" 1 OFR
    chmod 400 "$OFF"; t_ok "a read-only 0400 facts file is accepted" OFR
    chmod 600 "$OFF"
    rm -f "$OFF"; ln -s "$OFD/elsewhere.env" "$OFF"; t_rc "a symbolic link as the facts file is refused" 1 OFR
    rm -f "$OFF"; mkdir "$OFF"; t_rc "a directory as the facts file is refused" 1 OFR; rmdir "$OFF"
    printf 'AICC_ACTIVATION_PROOF_KID=k1\n' > "$OFF"; chmod 600 "$OFF"
    t_rc "the owner-facts command refuses to write through a symbolic link" 1 bash -c "rm -f '$OFD/linked.env'; ln -s '$OFD/target.env' '$OFD/linked.env'; env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$OFD/linked.env' --env production set AICC_ACTIVATION_PROOF_KID k2"
    t_fail "...and wrote nothing at the link target" test -e "$OFD/target.env"
    if [ "$(id -u)" != 0 ]; then t_rc "without the test harness the command needs root" 1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production set AICC_ACTIVATION_PROOF_KID k2; fi
    if [ ! -e /etc/aicc-stage-identity ]; then t_rc "the command refuses a host whose identity says neither production nor staging (no --env)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" list; fi
    # --- staging: only the sandbox-rehearsal keys; the stage template stays untouched when unset
    rm -f "$OFF"
    t_rc "stage refuses a legal fact" 1 OFTS set AICC_LEGAL_ENTITY_NAME x
    t_rc "stage refuses the launch allowlist" 1 OFTS set AICC_LAUNCH_REAL_GATEWAYS payplus-payment-gateway
    t_ok "stage accepts a key id, the paid list, strict mode and the sandbox host" bash -c "set -e; T() { env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$OFF' --env stage \"\$@\" >/dev/null; }; T set AICC_ACTIVATION_PROOF_KID stage-1; T set AICC_LM_PAID_GATEWAYS payplus-payment-gateway:payplus_transaction_uid; T set AICC_LM_PAYMENT_GATE_STRICT true; T set AICC_EXTRA_ACCESSIBLE_HOSTS restapidev.payplus.co.il"
    OFS >/dev/null 2>&1; SC="$(cst "$OFD/stage.php" AICC_ACTIVATION_PROOF_KID AICC_LM_PAYMENT_GATE_STRICT AICC_LM_PAID_GATEWAYS WP_ACCESSIBLE_HOSTS AICC_LEGAL_ENTITY_NAME)"
    t_eq "stage render: key id, strict mode, the gateway, the sandbox host appended to the stage host, no legal fact" "$(echo "$SC" | jq -c '[.AICC_ACTIVATION_PROOF_KID,.AICC_LM_PAYMENT_GATE_STRICT,(.AICC_LM_PAID_GATEWAYS|keys),.WP_ACCESSIBLE_HOSTS,.AICC_LEGAL_ENTITY_NAME]')" '["stage-1",true,["payplus-payment-gateway"],"stage.copilt.org,restapidev.payplus.co.il",null]'
    t_ok "...and the stage render still passes php -l" php -l "$OFD/stage.php"
    cp "$OFF" "$OFD/stage-facts.env"; printf 'AICC_LEGAL_ENTITY_NAME=x\n' > "$OFF"; chmod 600 "$OFF"
    t_rc "a production-only key planted in the stage facts file makes the STAGE renderer refuse" 1 OFS
    rm -f "$OFF"; OFS >/dev/null 2>&1; t_ok "stage with no facts file is the golden again" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OFD/stage.php') '$HERE/golden/wp-config.stage.no-owner-facts.php'"
    echo "== owner facts, COM-GATE-01 (Production 14): the evidence provider flags EVERY payment path; production can only render 'live' =="
    rm -f "$OFF"
    GWV='payplus-payment-gateway:payplus_transaction_uid,payplus-payment-gateway-applepay:payplus_transaction_uid'
    OFT set AICC_ACTIVATION_PROOF_KID prod-1 >/dev/null; OFT set AICC_LM_PAID_GATEWAYS "$GWV" >/dev/null
    OFR >/dev/null 2>&1; EV0="$(cst "$OFD/prod.php" AICC_LM_PAID_GATEWAYS AICC_LM_PAYMENT_EVIDENCE_PROVIDER)"
    t_eq "without the provider fact the gateway entries are exactly what they always were (no evidence keys)" "$(echo "$EV0" | jq -c '.AICC_LM_PAID_GATEWAYS|map(keys)')" '[["proof_meta","require_transaction_id"],["proof_meta","require_transaction_id"]]'
    t_eq "...and the provider constant is not defined" "$(echo "$EV0" | jq -r .AICC_LM_PAYMENT_EVIDENCE_PROVIDER)" "null"
    t_ok "set the evidence provider tag" OFT set AICC_LM_PAYMENT_EVIDENCE_PROVIDER payplus
    t_eq "list shows it" "$(OFT list | grep -c '^AICC_LM_PAYMENT_EVIDENCE_PROVIDER=payplus$')" "1"
    OFR >/dev/null 2>&1; t_ok "...the production render passes php -l" php -l "$OFD/prod.php"
    EV1="$(cst "$OFD/prod.php" AICC_LM_PAID_GATEWAYS AICC_LM_PAYMENT_EVIDENCE_PROVIDER)"
    t_eq "EVERY gateway id (the card gateway AND the wallet id) requires provider evidence, names the provider and is LIVE" "$(echo "$EV1" | jq -c '.AICC_LM_PAID_GATEWAYS|map([.require_provider_evidence,.evidence_provider,.evidence_environment,.require_transaction_id])')" '[[true,"payplus","live",true],[true,"payplus","live",true]]'
    t_eq "proof meta is kept next to the evidence keys" "$(echo "$EV1" | jq -c '.AICC_LM_PAID_GATEWAYS|map(.proof_meta)')" '[["payplus_transaction_uid"],["payplus_transaction_uid"]]'
    t_eq "the provider tag constant is rendered" "$(echo "$EV1" | jq -r .AICC_LM_PAYMENT_EVIDENCE_PROVIDER)" "payplus"
    t_eq "no production render can contain the word sandbox (the environment is fixed by the renderer, not by a fact)" "$(grep -c "sandbox" "$OFD/prod.php" || true)" "0"
    t_rc "there is no owner fact that could select a sandbox environment for production" 1 OFT set AICC_LM_PAYMENT_EVIDENCE_ENVIRONMENT sandbox
    t_rc "an evidence-environment key is not accepted as an inline option either" 1 OFT set AICC_LM_PAID_GATEWAYS "payplus-payment-gateway:payplus_transaction_uid:evidence_environment=sandbox"
    ebad() { local n="$1" v="$2"; t_rc "$n" 1 OFT set AICC_LM_PAYMENT_EVIDENCE_PROVIDER "$v"; }
    ebad "a provider tag in upper case is refused" PayPlus
    ebad "a provider tag with a space is refused" "pay plus"
    ebad "a provider tag with a quote is refused" "x'y"
    ebad "a provider tag with a comma (a list) is refused" "payplus,other"
    ebad "an over-long provider tag is refused" "$(printf 'a%.0s' $(seq 1 41))"
    ebad "an empty provider tag is refused" ""
    OFSUM2="$(sha "$OFF")"; OFR >/dev/null 2>&1; H1="$(hexnorm "$OFD/prod.php" | shasum -a 256 | cut -d' ' -f1)"; OFR >/dev/null 2>&1; H2="$(hexnorm "$OFD/prod.php" | shasum -a 256 | cut -d' ' -f1)"
    t_eq "rendering twice gives the identical production file (reproducible)" "$H1" "$H2"
    t_eq "...and the renderer did not touch the facts file" "$(sha "$OFF")" "$OFSUM2"
    # commerce can be opened only with the provider fact (the gate would block it anyway; the file refuses early)
    OFT unset AICC_LM_PAYMENT_EVIDENCE_PROVIDER >/dev/null
    t_ok "set every other fact commerce needs" bash -c "set -e; T() { env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$OFF' --env production \"\$@\" >/dev/null; }; T set AICC_LEGAL_ENTITY_NAME 'Example Studio Ltd'; T set AICC_LEGAL_ENTITY_ADDRESS '1 Example Street, Example City'; T set AICC_LEGAL_SUPPORT_EMAIL support@copilt.org; T set AICC_LEGAL_GOVERNING_LAW 'Law of Example'; T set AICC_LEGAL_JURISDICTION 'Courts of Example'; T set AICC_LEGAL_PAYMENT_PROCESSOR 'PayPlus Ltd'; T set AICC_LEGAL_REVIEW_APPROVED true; T set AICC_LEGAL_SUBPROCESSORS_VERIFIED 2026-10-23; T set AICC_LAUNCH_REAL_GATEWAYS payplus-payment-gateway"
    EVOUT="$(OFT set AICC_COMMERCE_OPEN true 2>&1)"; evrc=$?
    t_eq "AICC_COMMERCE_OPEN=true is REFUSED while the evidence provider is not set" "$evrc" "1"
    t_contains "...and the refusal names the missing fact" "$EVOUT" "AICC_LM_PAYMENT_EVIDENCE_PROVIDER"
    t_ok "set the evidence provider, then the switch is accepted" bash -c "set -e; T() { env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$OFF' --env production \"\$@\" >/dev/null; }; T set AICC_LM_PAYMENT_EVIDENCE_PROVIDER payplus; T set AICC_COMMERCE_OPEN true"
    t_rc "the evidence provider cannot be unset while commerce is open (close commerce first)" 1 OFT unset AICC_LM_PAYMENT_EVIDENCE_PROVIDER
    # staging: the same fact renders the SANDBOX environment
    rm -f "$OFF"
    OFTS set AICC_ACTIVATION_PROOF_KID stage-1 >/dev/null; OFTS set AICC_LM_PAID_GATEWAYS "$GWV" >/dev/null
    t_ok "stage accepts the evidence provider" OFTS set AICC_LM_PAYMENT_EVIDENCE_PROVIDER payplus
    OFS >/dev/null 2>&1; t_ok "...the stage render passes php -l" php -l "$OFD/stage.php"
    t_eq "STAGE renders every path with evidence_environment sandbox (a payment sandbox rehearsal), never live" "$(cst "$OFD/stage.php" AICC_LM_PAID_GATEWAYS | jq -c '.AICC_LM_PAID_GATEWAYS|map([.require_provider_evidence,.evidence_provider,.evidence_environment])')" '[[true,"payplus","sandbox"],[true,"payplus","sandbox"]]'
    rm -f "$OFF"; OFS >/dev/null 2>&1; t_ok "stage with no facts file is the golden again" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OFD/stage.php') '$HERE/golden/wp-config.stage.no-owner-facts.php'"
    echo "== owner facts, fixB: signing public keys (M6), ASCII dates + literal values after KEY (secR2-9), export/import for disaster recovery =="
    rm -f "$OFF"
    SK1="$(python3 -c 'import base64;print(base64.b64encode(bytes(range(32))).decode())')"; SK2="$(python3 -c 'import base64;print(base64.b64encode(bytes(range(1,33))).decode())')"; SK3="$(python3 -c 'import base64;print(base64.b64encode(bytes(range(2,34))).decode())')"
    t_ok "production accepts AICC_LM_PLUGIN_SIGNING_PUBKEYS (primary + standby)" OFT set AICC_LM_PLUGIN_SIGNING_PUBKEYS "$SK1, $SK2"
    t_contains "...stored canonically (blanks removed)" "$(OFT list)" "AICC_LM_PLUGIN_SIGNING_PUBKEYS=$SK1,$SK2"
    t_rc "three keys are refused (the Control Plane reads at most two)" 1 OFT set AICC_LM_PLUGIN_SIGNING_PUBKEYS "$SK1,$SK2,$SK3"
    t_rc "the same key twice is refused" 1 OFT set AICC_LM_PLUGIN_SIGNING_PUBKEYS "$SK1,$SK1"
    t_rc "a 64-byte value (an Ed25519 SECRET key shape) is refused" 1 OFT set AICC_LM_PLUGIN_SIGNING_PUBKEYS "$(python3 -c 'import base64;print(base64.b64encode(bytes(64)).decode())')"
    t_rc "a 31-byte value is refused" 1 OFT set AICC_LM_PLUGIN_SIGNING_PUBKEYS "$(python3 -c 'import base64;print(base64.b64encode(bytes(31)).decode())')"
    t_rc "non-base64 text is refused" 1 OFT set AICC_LM_PLUGIN_SIGNING_PUBKEYS "not-a-key-not-a-key-not-a-key-not-a-key-12="
    t_rc "a stray comma is refused" 1 OFT set AICC_LM_PLUGIN_SIGNING_PUBKEYS "$SK1,"
    t_rc "a value with a quote or PHP is refused" 1 OFT set AICC_LM_PLUGIN_SIGNING_PUBKEYS "$SK1');phpinfo();//"
    t_rc "stage does NOT accept the signing keys (production serves the signed releases)" 1 OFTS set AICC_LM_PLUGIN_SIGNING_PUBKEYS "$SK1"
    t_fail "...and \`keys\` for stage does not list it" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$OFF' --env stage keys | grep -q SIGNING_PUBKEYS"
    t_ok "...while \`keys\` for production lists it" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$OFF' --env production keys | grep -q '^AICC_LM_PLUGIN_SIGNING_PUBKEYS$'"
    OFR >/dev/null 2>&1; t_eq "production render defines AICC_LM_PLUGIN_SIGNING_PUBKEYS exactly as set" "$(cst "$OFD/prod.php" AICC_LM_PLUGIN_SIGNING_PUBKEYS | jq -r .AICC_LM_PLUGIN_SIGNING_PUBKEYS)" "$SK1,$SK2"
    t_eq "...as ONE define line" "$(grep -c "^define( 'AICC_LM_PLUGIN_SIGNING_PUBKEYS'" "$OFD/prod.php")" "1"
    t_ok "...php -l clean" php -l "$OFD/prod.php"
    OFR >/dev/null 2>&1; OFR --force-salts >/dev/null 2>&1; OFR >/dev/null 2>&1
    seedsalts; OFR >/dev/null 2>&1
    t_eq "a re-render (including --force-salts) keeps it: the owner never hand-edits the rendered wp-config again" "$(cst "$OFD/prod.php" AICC_LM_PLUGIN_SIGNING_PUBKEYS | jq -r .AICC_LM_PLUGIN_SIGNING_PUBKEYS)" "$SK1,$SK2"
    OFT unset AICC_LM_PLUGIN_SIGNING_PUBKEYS >/dev/null; OFR >/dev/null 2>&1
    t_ok "unset + re-render: back to the golden file byte for byte" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OFD/prod.php') '$HERE/golden/wp-config.production.no-owner-facts.php'"
    # --- ASCII digits only in dates (the PHP launch gate is ASCII)
    t_rc "a date written with full-width digits is refused" 1 OFT set AICC_LEGAL_SUBPROCESSORS_VERIFIED "２０２６-１０-２３"
    t_rc "a date written with Arabic-Indic digits is refused" 1 OFT set AICC_LEGAL_SUBPROCESSORS_VERIFIED "٢٠٢٦-١٠-٢٣"
    t_ok "an ASCII date is accepted" OFT set AICC_LEGAL_SUBPROCESSORS_VERIFIED 2026-10-23
    # --- option parsing stops after KEY (secR2-9)
    rm -f "$OFF"
    t_rc "set KEY --help is a value, not the help flag (here an invalid key id: refused with exit 1, not 0)" 1 OFT set AICC_ACTIVATION_PROOF_KID --help
    t_fail "...and printed no usage" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$OFF' --env production set AICC_ACTIVATION_PROOF_KID --help 2>&1 | grep -q 'Sets, unsets and lists'"
    t_ok "a free-text value equal to --file is stored literally" OFT set AICC_LEGAL_ENTITY_NAME --file
    t_eq "...the facts file did not move: the value is --file" "$(OFT list | grep '^AICC_LEGAL_ENTITY_NAME=')" "AICC_LEGAL_ENTITY_NAME=--file"
    t_ok "a free-text value equal to --env is stored literally" OFT set AICC_LEGAL_PAYMENT_PROCESSOR --env
    t_eq "...and the environment stayed production" "$(OFT list | grep '^AICC_LEGAL_PAYMENT_PROCESSOR=')" "AICC_LEGAL_PAYMENT_PROCESSOR=--env"
    t_ok "options placed before the command and between the command and KEY still work" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' set --file '$OFF' --env production AICC_ACTIVATION_PROOF_KID k9 >/dev/null && grep -q '^AICC_ACTIVATION_PROOF_KID=k9$' '$OFF'"
    t_ok "--help before the command prints the usage and exits 0" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --help | grep -q 'Sets, unsets and lists'"
    t_rc "--file as the very last argument (no value) is a usage error, not a crash" 2 bash "$PROV/owner-facts.sh" list --file
    # --- disaster recovery: export / import
    OFT set AICC_LM_PLUGIN_SIGNING_PUBKEYS "$SK1" >/dev/null
    OFT export > "$OFD/export.env"; EXSUM="$(sha "$OFD/export.env")"
    t_eq "export prints exactly the facts file text (header + KEY=value lines, no secret exists in the file)" "$(cat "$OFF" | shasum -a 256 | cut -d' ' -f1)" "$EXSUM"
    t_eq "...the export holds the signing key and the legal name" "$(grep -c '^AICC_LM_PLUGIN_SIGNING_PUBKEYS=\|^AICC_LEGAL_ENTITY_NAME=' "$OFD/export.env")" "2"
    chmod 600 "$OFD/export.env"
    rm -f "$OFF"
    t_ok "import re-enters the export on a host that has NO facts file (rebuilt host)" OFT import "$OFD/export.env"
    t_eq "...mode 0600" "$(mode "$OFF")" "600"
    t_eq "...identical content" "$(sha "$OFF")" "$EXSUM"
    t_ok "...importing the same file again is idempotent" OFT import "$OFD/export.env"
    OFT set AICC_ACTIVATION_PROOF_KID other1 >/dev/null
    t_rc "import refuses to merge into / overwrite a DIFFERENT existing facts file" 1 OFT import "$OFD/export.env"
    t_contains "...the existing value is untouched" "$(OFT list)" "AICC_ACTIVATION_PROOF_KID=other1"
    rm -f "$OFF"
    t_rc "import of a relative path is refused" 1 OFT import export.env
    t_rc "import of a missing file is refused" 1 OFT import "$OFD/nonexistent.env"
    printf 'AICC_LM_PLUGIN_SIGNING_PUBKEYS=%s\n' "bad" > "$OFD/bad-export.env"; chmod 600 "$OFD/bad-export.env"
    t_rc "import validates every value: an invalid export is refused" 1 OFT import "$OFD/bad-export.env"
    t_fail "...and no facts file was created" test -e "$OFF"
    t_rc "import for stage refuses a production-only key (the file is validated for the host's environment)" 1 OFTS import "$OFD/export.env"
    ln -sfn "$OFD/export.env" "$OFD/export-link.env"
    t_rc "import through a symbolic link is refused" 1 OFT import "$OFD/export-link.env"
    printf 'AICC_ACTIVATION_PROOF_KID=k1\n' > "$OFF"; chmod 600 "$OFF"
    t_rc "unknown command still refused (exit 2)" 2 OFT frobnicate
    t_ok "the owner-facts command and its validator are installed with the renderer (install-stack scripts step)" bash -c "test -x '$PFX/usr/local/lib/aicc/provision/owner-facts.sh' && test -f '$PFX/usr/local/lib/aicc/provision/lib/owner_facts.py' && test -L '$PFX/usr/local/sbin/aicc-owner-facts'"
    t_not_contains "the stale template says nothing about 'NOT usable' any more" "$(cat "$PROV/wp-config.stage.template.php")" "NOT usable"
    t_rc "rendering without the DB password file is refused" 1 env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --out "$WC/x.php" --secrets-dir "$TMP/emptysecrets"
    t_rc "--dry-run prints nothing secret" 0 bash "$PROV/render-wp-config.sh" --dry-run

        echo "== aicc-fpm-log-status.sh (counts, never log text) =="
    FL="$TMP/fpmlog"; mkdir -p "$FL/st"; NOWE=1792600000
    mkl() { local off="$1"; date -u -r $((NOWE - off)) +"[%d-%b-%Y %H:%M:%S] WARNING: [pool aicc] server reached pm.max_children setting (3), consider raising it" 2>/dev/null || date -u -d "@$((NOWE - off))" +"[%d-%b-%Y %H:%M:%S] WARNING: [pool aicc] server reached pm.max_children setting (3), consider raising it"; }
    { mkl 10; mkl 100; mkl 290; mkl 400; mkl 899; mkl 1200; mkl -5; echo "[01-Jan-2026 00:00:00] NOTICE: secret-looking text token=abc123 should never be copied"; echo "garbage line"; } > "$FL/php.log"
    t_ok "the counter runs" env AICC_FPM_LOG="$FL/php.log" AICC_STATUS_DIR="$FL/st" AICC_NOW=$NOWE bash "$INFRA/systemd/aicc-fpm-log-status.sh"
    t_eq "events in the last 5 minutes (10 s, 100 s, 290 s ago; a line dated in the future is ignored)" "$(jq -r .events_5m "$FL/st/fpm-log.json")" "3"
    t_eq "events in the last 15 minutes (adds 400 s and 899 s; 1200 s is outside)" "$(jq -r .events_15m "$FL/st/fpm-log.json")" "5"
    t_not_contains "the status file holds no log text" "$(cat "$FL/st/fpm-log.json")" "secret"
    t_eq "...and its keys are exactly the documented ones" "$(jq -r 'keys|join(",")' "$FL/st/fpm-log.json")" "events_15m,events_5m,log_present,schema,ts"
    t_ok "an absent log is reported as log_present=false (not a crash)" env AICC_FPM_LOG="$FL/none.log" AICC_STATUS_DIR="$FL/st" AICC_NOW=$NOWE bash "$INFRA/systemd/aicc-fpm-log-status.sh"
    t_eq "...with zero events" "$(jq -r '[.log_present,.events_15m]|join(",")' "$FL/st/fpm-log.json")" "false,0"
    t_rc "a non-numeric AICC_NOW is refused" 2 env AICC_FPM_LOG="$FL/php.log" AICC_STATUS_DIR="$FL/st" AICC_NOW=abc bash "$INFRA/systemd/aicc-fpm-log-status.sh"

        echo "== aicc-security-updates.sh (hourly security updates; numbers and package names only) =="
    SU="$TMP/secupd"; mkdir -p "$SU/bin" "$SU/proc/4242"
    printf '#!/bin/bash\nif [[ "$*" == *" -s "* || "$*" == *"-s -o"* ]]; then cat "$FAKE_INST"; fi\nexit 0\n' > "$SU/bin/apt-get"
    printf '#!/bin/bash\n[ "$#" -eq 0 ] || { echo "unattended-upgrade: error: unrecognized arguments: $*" >&2; exit 2; }\nif [ -n "${FAKE_UU_LOCK:-}" ] && [ ! -e "$FAKE_UU_LOCK" ]; then : > "$FAKE_UU_LOCK"; echo "Could not get lock /var/lib/dpkg/lock-frontend" >&2; exit 1; fi\n: > "$FAKE_INST"\nexit "${FAKE_UU_RC:-0}"\n' > "$SU/bin/uu"
    printf '#!/bin/bash\nif [[ "$1" == show ]]; then for a in "$@"; do [[ "$a" == php8.3-fpm.service ]] && { echo 4242; exit 0; }; done; echo 0; exit 0; fi\nif [[ "$1" == reload ]]; then : > "$FAKE_PROC/4242/maps"; fi\nexit 0\n' > "$SU/bin/systemctl"
    chmod +x "$SU/bin/"*
    printf 'Inst libnss3 [2:3.98-1ubuntu0.2] (2:3.98-1ubuntu0.3 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])\nInst vim [1] (2 Ubuntu:24.04/noble-updates [amd64])\n' > "$SU/inst"
    echo "7f00-7f01 r-xp 00000000 fd:01 1 /usr/lib/x86_64-linux-gnu/libssl.so.3 (deleted)" > "$SU/proc/4242/maps"
    SUENV=(env FAKE_INST="$SU/inst" FAKE_PROC="$SU/proc" AICC_APT_GET="$SU/bin/apt-get" AICC_UNATTENDED_UPGRADE="$SU/bin/uu" AICC_SYSTEMCTL="$SU/bin/systemctl" AICC_PROC_ROOT="$SU/proc" AICC_REBOOT_FILE="$SU/none" AICC_STATUS_DIR="$SU/st" AICC_STATE_DIR="$SU/state" AICC_RELOAD_SETTLE=0 AICC_RETRY_SLEEP=0)
    t_ok "the job runs: only the SECURITY update is installed, a stale PHP-FPM is reloaded" "${SUENV[@]}" AICC_NOW=1800000000 bash "$INFRA/systemd/aicc-security-updates.sh"
    t_eq "...the security package is reported as upgraded (the non-security one is not)" "$(jq -r '.upgraded|join(",")' "$SU/st/security-updates.json")" "libnss3"
    t_eq "...nothing is pending and PHP-FPM was reloaded and is no longer stale" "$(jq -r '[.pending_count,(.reloaded|join(",")),(.stale_services|length),.ok]|join("|")' "$SU/st/security-updates.json")" "0|php8.3-fpm|0|true"
    t_eq "...its keys are exactly the documented ones" "$(jq -r 'keys|join(",")' "$SU/st/security-updates.json")" "finished_epoch,ok,pending_count,pending_oldest_epoch,reboot_required,reloaded,schema,stale_services,ts,update_rc,upgrade_rc,upgraded"
    perm() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
    t_eq "...the status file is world-readable (AICC Ops reads it) and the state file is root-only" "$(perm "$SU/st/security-updates.json") $(perm "$SU/state/security-updates.pending.json")" "644 600"
    printf 'Inst libnss3 [2:3.98-1ubuntu0.2] (2:3.98-1ubuntu0.3 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])\n' > "$SU/inst"; rm -f "$SU/lock"
    t_ok "a held dpkg lock is retried (bounded) and the upgrade then succeeds; the fake rejects ANY argument like the real argparse tool (rc 2)" "${SUENV[@]}" FAKE_UU_LOCK="$SU/lock" AICC_LOCK_RETRY_SLEEP=0 AICC_NOW=1800001800 bash "$INFRA/systemd/aicc-security-updates.sh"
    t_eq "...and the retry installed the update" "$(jq -r '[.ok,.upgrade_rc,.pending_count]|join(",")' "$SU/st/security-updates.json")" "true,0,0"
    printf 'Inst openssl [1] (2 Ubuntu:24.04/noble-security [amd64])\n' > "$SU/inst"; : > "$SU/proc/4242/maps"
    t_rc "a failing unattended-upgrade makes the unit FAIL (rc 1) ..." 1 "${SUENV[@]}" FAKE_UU_RC=1 AICC_NOW=1800003600 bash "$INFRA/systemd/aicc-security-updates.sh"
    t_eq "...but the status file is still written, ok=false, with the failure code" "$(jq -r '[.ok,.upgrade_rc]|join(",")' "$SU/st/security-updates.json")" "false,1"
    printf 'Inst openssl [1] (2 Ubuntu:24.04/noble-security [amd64])\n' > "$SU/inst"
    t_ok "a held-back update stays pending and keeps its FIRST-SEEN time across runs" bash -c "printf '#!/bin/bash\nexit 0\n' > '$SU/bin/uu'; chmod +x '$SU/bin/uu'; env FAKE_INST='$SU/inst' FAKE_PROC='$SU/proc' AICC_APT_GET='$SU/bin/apt-get' AICC_UNATTENDED_UPGRADE='$SU/bin/uu' AICC_SYSTEMCTL='$SU/bin/systemctl' AICC_PROC_ROOT='$SU/proc' AICC_REBOOT_FILE='$SU/none' AICC_STATUS_DIR='$SU/st' AICC_STATE_DIR='$SU/state' AICC_RELOAD_SETTLE=0 AICC_RETRY_SLEEP=0 AICC_NOW=1800007200 bash '$INFRA/systemd/aicc-security-updates.sh' && env FAKE_INST='$SU/inst' FAKE_PROC='$SU/proc' AICC_APT_GET='$SU/bin/apt-get' AICC_UNATTENDED_UPGRADE='$SU/bin/uu' AICC_SYSTEMCTL='$SU/bin/systemctl' AICC_PROC_ROOT='$SU/proc' AICC_REBOOT_FILE='$SU/none' AICC_STATUS_DIR='$SU/st' AICC_STATE_DIR='$SU/state' AICC_RELOAD_SETTLE=0 AICC_RETRY_SLEEP=0 AICC_NOW=1800010800 bash '$INFRA/systemd/aicc-security-updates.sh'"
    t_eq "...pending since the first run (an hour-old first-seen time is not reset by a later run)" "$(jq -r '[.pending_count,.pending_oldest_epoch]|join(",")' "$SU/st/security-updates.json")" "1,1800007200"
    t_rc "a non-numeric AICC_NOW is refused" 2 "${SUENV[@]}" AICC_NOW=abc bash "$INFRA/systemd/aicc-security-updates.sh"
    t_contains "the timer runs hourly with jitter and catches up after downtime" "$(cat "$INFRA/systemd/aicc-security-updates.timer")" "OnCalendar=*-*-* *:23:00"
    t_contains "...Persistent" "$(cat "$INFRA/systemd/aicc-security-updates.timer")" "Persistent=true"
    t_contains "the unit reports failures to AICC Ops through the failure hook" "$(cat "$INFRA/systemd/aicc-security-updates.service")" "OnFailure=aicc-notify-failure@%n.service"

        echo "== logrotate: no second stanza for a file Ubuntu's mysql-server rule already rotates =="
    t_eq "no AICC logrotate file claims a path under /var/log/mysql/ (Ubuntu's /var/log/mysql/*log glob covers it; a duplicate makes logrotate exit 1 nightly: seen on the host 2026-10-21/22)" "$(grep -l '^[[:space:]]*/var/log/mysql/' "$INFRA"/logrotate/* 2>/dev/null | wc -l | tr -d ' ')" "0"

echo "== backup / restore as the REAL backup account against the throwaway server =="
    BKDIR="$TMP/bk"; SH="$TMP/shared"; EC="$TMP/edgeconf"; mkdir -p "$SH/uploads/2026" "$EC" "$TMP/rel/site" "$TMP/rel/cp"; echo img > "$SH/uploads/2026/a.jpg"; echo "<?php // x" > "$SH/wp-config.php"; echo cfg > "$EC/Caddyfile"
    ln -s "$TMP/rel/site/releases/R1" "$TMP/rel/site/current"
    BKP() { env AICC_TEST_HARNESS=1 MYSQL_BIN="$LOCALMY/mysql" MYSQLDUMP_BIN="$LOCALMY/mysqldump" bash "$INFRA/backup/aicc-backup.sh" --backup-dir "$BKDIR" --shared-dir "$SH" --edge-conf-dir "$EC" --release-root "$TMP/rel" --mysql-defaults-file "$BKCNF" --min-free-pct 1 "$@"; }  # independent of the free space of the machine running the tests; the guard case passes --min-free-pct 100 explicitly
    OUTB="$(BKP --label scheduled 2>&1)"; rc=$?
    [ "$rc" = 0 ] || echo "$OUTB" | tail -8
    t_eq "aicc-backup (real backup account, production names) succeeds" "$rc" "0"
    t_eq "status.json says ok" "$(jq -r .status "$BKDIR/status.json")" "ok"
    t_eq "restore smoke check ran and passed" "$(jq -r .db_dump.restore_check "$BKDIR/status.json")" "ok"
    DUMPF="$BKDIR/$(jq -r .last_success.db_dump_file "$BKDIR/status.json")"; FILESF="$BKDIR/$(jq -r .last_success.files_archive_file "$BKDIR/status.json")"
    t_eq "dump file mode 0600" "$(mode "$DUMPF")" "600"
    t_eq "files archive mode 0600" "$(mode "$FILESF")" "600"
    t_eq "status.json mode 0644 (readable by AICC Ops)" "$(mode "$BKDIR/status.json")" "644"
    t_ok "sha256 sidecar verifies" bash -c "cd '$BKDIR' && (shasum -a 256 -c '$(basename "$DUMPF").sha256' || sha256sum -c '$(basename "$DUMPF").sha256')"
    DUMPTXT="$(gzip -dc "$DUMPF")"
    t_contains "dump contains the trigger" "$DUMPTXT" "trg_ins"
    t_contains "dump contains the stored function (--routines)" "$DUMPTXT" "f_one"
    t_contains "dump contains the event (--events)" "$DUMPTXT" "ev_noop"
    t_contains "dump contains the view" "$DUMPTXT" "v_opts"
    t_not_contains "dump holds no tablespace statements (--no-tablespaces)" "$DUMPTXT" "CREATE LOGFILE GROUP"
    t_ok "files archive contains uploads, edge config and release pointers, and (F-05) NO wp-config.php" bash -c "tar tzf '$FILESF' | grep -q 'uploads/2026/a.jpg' && ! tar tzf '$FILESF' | grep -q 'wp-config' && tar tzf '$FILESF' | grep -q 'Caddyfile' && tar tzf '$FILESF' | grep -q 'pointers.txt'"
    t_not_contains "the DB dump does not contain wp-config content" "$DUMPTXT" "<?php // x"
    t_fail "the database password never appears in the log or status" grep -q "$(cat "$SEC/db-backup.pass")" "$BKDIR/backup.log" "$BKDIR/status.json"
    t_eq "the throwaway restore database is gone" "$("${MY[@]}" -e "SHOW DATABASES LIKE 'aicc_restore_check'")" ""
    t_ok "aicc-restore-test succeeds on the latest dump" env AICC_TEST_HARNESS=1 MYSQL_BIN="$LOCALMY/mysql" bash "$INFRA/backup/aicc-restore-test.sh" --backup-dir "$BKDIR" --mysql-defaults-file "$BKCNF"
    t_eq "restore-test.json records the result" "$(jq -r .status "$BKDIR/restore-test.json")" "ok"
    # corrupt dumps must FAIL the restore test
    cp "$DUMPF" "$TMP/good.sql.gz"; cp "$DUMPF.sha256" "$TMP/good.sha256"
    head -c 300 "$TMP/good.sql.gz" > "$DUMPF"
    t_rc "a truncated dump fails the restore test" 1 env AICC_TEST_HARNESS=1 MYSQL_BIN="$LOCALMY/mysql" bash "$INFRA/backup/aicc-restore-test.sh" --backup-dir "$BKDIR" --mysql-defaults-file "$BKCNF"
    t_eq "...restore-test.json says failed" "$(jq -r .status "$BKDIR/restore-test.json")" "failed"
    cp "$TMP/good.sql.gz" "$DUMPF"; echo "00ff  $(basename "$DUMPF")" > "$DUMPF.sha256"
    t_rc "a checksum mismatch fails the restore test" 1 env AICC_TEST_HARNESS=1 MYSQL_BIN="$LOCALMY/mysql" bash "$INFRA/backup/aicc-restore-test.sh" --backup-dir "$BKDIR" --mysql-defaults-file "$BKCNF"
    cp "$TMP/good.sha256" "$DUMPF.sha256"
    t_eq "...the throwaway database is dropped even after failures" "$("${MY[@]}" -e "SHOW DATABASES LIKE 'aicc_restore_check'")" ""
    # lock, retention, guards
    mkdir -p "$BKDIR/.lock"; sleep 30 & SLP=$!; echo $SLP > "$BKDIR/.lock/pid"
    t_rc "a second concurrent run exits 3 (lock held by a live pid)" 3 BKP --label manual
    kill $SLP 2>/dev/null; rm -rf "$BKDIR/.lock"
    for n in 1 2 3 4 5; do for k in "aicc_cp-2026010${n}T030000Z-scheduled.sql.gz" "aicc-files-2026010${n}T030000Z-scheduled.tar.gz"; do echo old > "$BKDIR/$k"; echo x > "$BKDIR/$k.sha256"; touch -t 2601010300 "$BKDIR/$k"; done; done
    BKP --label manual >/dev/null 2>&1
    t_eq "retention: old sets beyond the newest three are pruned" "$(ls "$BKDIR"/aicc_cp-*.sql.gz | wc -l | tr -d ' ')" "3"
    t_ok "retention: the fresh dump is still there" test -f "$DUMPF"
    t_ok "retention never touches other files" test -f "$BKDIR/status.json"
    t_rc "disk guard: refuses with exit 4 when free space is below the limit" 4 BKP --min-free-pct 100
    t_eq "...and status.json says failed with the reason" "$(jq -r '.status + ":" + (.reason|startswith("disk guard")|tostring)' "$BKDIR/status.json")" "failed:true"
    t_eq "...but last_success survives the failure" "$(jq -r '.last_success.label' "$BKDIR/status.json")" "manual"
    t_rc "--dry-run changes nothing" 0 BKP --dry-run
    t_rc "bad label is a usage error" 2 BKP --label evil
    t_rc "the fixture database names are refused outside --fixture-test" 1 env AICC_TEST_HARNESS=1 MYSQL_BIN="$LOCALMY/mysql" bash "$INFRA/backup/aicc-backup.sh" --backup-dir "$BKDIR" --mysql-defaults-file "$BKCNF" --db aicc_rehearsal_cp
    t_rc "in --fixture-test mode a non-rehearsal database is refused" 1 bash "$INFRA/backup/aicc-backup.sh" --fixture-test --backup-dir "$BKDIR" --mysql-defaults-file "$BKCNF" --db aicc_cp --restore-db aicc_rehearsal_x
    chmod 644 "$BKCNF"; t_rc "an option file readable by others is refused" 2 BKP; chmod 600 "$BKCNF"
    kill "$MYSQLD_PID" 2>/dev/null; wait "$MYSQLD_PID" 2>/dev/null; MYSQLD_PID=""
    t_rc "MySQL down: backup fails (exit 1)" 1 BKP --label manual
    t_eq "...status.json says failed" "$(jq -r .status "$BKDIR/status.json")" "failed"
    t_eq "...and the last good backup is still referenced" "$(jq -r '.last_success.label' "$BKDIR/status.json")" "manual"
  else t_bad "throwaway mysqld did not start" "$(tail -3 "$M/run.out" | tr '\n' '|')"; fi
else t_skip "MySQL / backup / grants tests" "Local's mysql 8.4 binaries not found"; fi

echo "== strict target-address check (security review L5): every notation of the production address is refused by every Mac-side tool, before anything is sent =="
IPG="$PROV/lib/ip-guard.py"
BYPASS="139.073.157.231 0139.0059.0157.0231 0x8b.0x3b.0x9d.0xe7 2336496103 0x8b3b9de7 139.59.157.231. 139.59.157 ::ffff:8b3b:9de7 ::ffff:139.59.157.231 64:ff9b::8b3b:9de7 2002:8b3b:9de7::1 2606:50c0:8001::153 2606:50c0:8000::153"
for ip in $BYPASS; do t_rc "ip-guard.py refuses $ip" 3 python3 -I "$IPG" "$ip"; done
t_rc "ip-guard.py accepts a documentation IPv4" 0 python3 -I "$IPG" 192.0.2.7
t_eq "ip-guard.py prints the canonical form of an accepted IPv6" "$(python3 -I "$IPG" '[2001:DB8::1]')" "2001:db8::1"
t_rc "ip-guard.py refuses an IPv4-embedding form of a HARMLESS address too (non-canonical target)" 3 python3 -I "$IPG" ::ffff:192.0.2.7
KEYX="$TMP/ipg-key"; printf -- '-----BEGIN %s-----\nDUMMY\n-----END %s-----\n' "OPENSSH PRIVATE KEY" "OPENSSH PRIVATE KEY" > "$KEYX"; chmod 600 "$KEYX"
SID32=0123456789abcdef0123456789abcdef
for ip in 139.073.157.231 0x8b.0x3b.0x9d.0xe7 2336496103 139.59.157.231. ::ffff:8b3b:9de7 2606:50c0:8001::153; do
  t_rc "push-bundle.sh refuses --stage-ip $ip" 3 bash "$PROV/push-bundle.sh" --stage-ip "$ip" --stage-host stage.copilt.org --key "$KEYX" --dry-run
  t_rc "verify-droplet.sh refuses --ip $ip" 3 bash "$PROV/verify-droplet.sh" --ip "$ip" --key "$KEYX"
  t_rc "operator-tunnel.sh refuses --stage-ip $ip" 3 bash "$PROV/operator-tunnel.sh" --stage-ip "$ip" --key "$KEYX" --dry-run
  t_rc "pull-offhost.sh refuses --stage-ip $ip" 3 bash "$INFRA/backup/pull-offhost.sh" --stage-ip "$ip" --key "$KEYX" --dry-run
  t_rc "deploy-release.sh refuses --stage-ip $ip" 3 bash "$INFRA/release/deploy-release.sh" --kind site --artifact /nonexistent/site-x.tar.gz --stage-host stage.copilt.org --stage-ip "$ip" --stage-id "$SID32" --key "$KEYX" --dry-run
done
t_ok "the refusal message names the reason" bash -c "bash '$PROV/push-bundle.sh' --stage-ip 139.073.157.231 --stage-host stage.copilt.org --key '$KEYX' --dry-run 2>&1 | grep -q 'canonical dotted-decimal'"
t_ok "every Mac-side tool sources the shared check (one implementation, not five string compares)" bash -c "for f in provision/push-bundle.sh provision/verify-droplet.sh provision/operator-tunnel.sh backup/pull-offhost.sh release/deploy-release.sh provision/lib/common.sh; do grep -q 'ip-guard.sh' '$INFRA/'\$f || exit 1; grep -q 'aicc_ip_guard' '$INFRA/'\$f || exit 1; done"

echo "== fail2ban filters (regexes executed with Python re against the REAL Caddy 2.11.7 log format) =="
t_ok "filter regexes vs. real access-log lines (ground truth from JSON parsing)" python3 "$HERE/test_fail2ban_regex.py"


echo "== aicc-wp wrapper forwards ONLY its switch allow-list across sudo (found on the first real promotion: the launch gate and the seeds ran without their variables) =="
WRAPD="$(mktemp -d "${TMPDIR:-/tmp}/aiccwp.XXXX")"
awk '/install_text "\$SBIN\/aicc-wp" 0755 root:root <<.EOF./{f=1;next} f&&/^EOF$/{exit} f{print}' "$INFRA/provision/install-stack.sh" > "$WRAPD/aicc-wp"; chmod +x "$WRAPD/aicc-wp"
mkdir -p "$WRAPD/bin"; printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@"\n' > "$WRAPD/bin/sudo"; chmod +x "$WRAPD/bin/sudo"
OUT="$(env PATH="$WRAPD/bin:$PATH" AICC_PRODUCTION=1 AICC_LEGAL_SEED_APPLY=yes AICC_EVIL=1 SECRET_TOKEN=x "$WRAPD/aicc-wp" eval-file x.php 2>&1)"
t_contains "aicc-wp forwards AICC_PRODUCTION" "$OUT" "AICC_PRODUCTION=1"
t_contains "aicc-wp forwards AICC_LEGAL_SEED_APPLY" "$OUT" "AICC_LEGAL_SEED_APPLY=yes"
t_not_contains "aicc-wp does NOT forward an arbitrary AICC_ variable" "$OUT" "AICC_EVIL"
t_not_contains "aicc-wp does NOT forward other environment" "$OUT" "SECRET_TOKEN"
t_rc "aicc-wp refuses a switch value other than 1/true/yes" 2 env PATH="$WRAPD/bin:$PATH" AICC_PRODUCTION=maybe "$WRAPD/aicc-wp" eval-file x.php
OUT2="$(env PATH="$WRAPD/bin:$PATH" "$WRAPD/aicc-wp" core version 2>&1)"
t_contains "aicc-wp with no switches still passes its arguments (empty-array safe)" "$OUT2" "core"
rm -rf "$WRAPD"

t_summary
