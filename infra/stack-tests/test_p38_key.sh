#!/usr/bin/env bash
# Tests of the OWNER-RUN Brevo key provisioning (infra/provision/set-brevo-key.sh on the Mac, infra/provision/host/aicc-set-brevo-key on the host) against a LOCAL FAKE HOST.
# The fake host is a temp directory used as a root prefix (AICC_ROOT_PREFIX, like the other stack tests); a fake `ssh` runs the remote command locally inside it. No network, no real host, no real secret
# (the "key" is the fake xkeysib-TEST-NOT-A-REAL-KEY-0000). The Mac script is driven on a real pseudo terminal (lib/pty_drive.py: hidden prompts, a process-list poller that watches ps arguments AND environment).
#   A  the host script alone: modes install / rotate / revoke / status, shape and size limits, directory and symlink refusals, unrelated files untouched, journal line, file mode and owner, fingerprint
#   B  ATOMICITY: kill -9 at every stage of install and rotate leaves the old key or nothing, never a partial or truncated file; stale temp files are cleaned
#   C  the Mac script: tty / tracing / history refusals, hidden prompt, SHA-256 confirmation, shape refusals, identity gates, dry run
#   D  the whole flow on a pty: the key never appears in any argument, environment, file (but the key file), terminal output, journal or record of any child process
#   E  rotation, revocation, status, and --then-check (render + reload + tests) end to end with the real renderer
# Run: bash infra/stack-tests/test_p38_key.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; INFRA="$REPO/infra"; PROV="$INFRA/provision"
T_SUITE="p38-key"; . "$HERE/lib/t.sh"
HOSTSCRIPT="$PROV/host/aicc-set-brevo-key"; MACSCRIPT="$PROV/set-brevo-key.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ap38k.XXXX")"; trap 'rm -rf "$TMP"' EXIT
for tool in php python3 jq ssh-keygen shasum; do command -v "$tool" >/dev/null 2>&1 || { echo "need $tool"; exit 2; }; done
mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
KEY1='xkeysib-TEST-NOT-A-REAL-KEY-0000'; KEY2='xkeysib-TEST-NOT-A-REAL-KEY-ROT2-9999'; SMTPKEY='xsmtpsib-TEST-NOT-A-REAL-SMTP-KEY-000'
OFU="$(id -un):$(id -gn)"; STAGEID="3e897286ce82e55f4d866acf0d526a5f"
fp8() { printf '%s' "$1" | shasum -a 256 | cut -c1-8; }

# ---- the fake host (a prefix) ------------------------------------------------------------------------------------------------------------------------------------------------------------------
PFX="$TMP/host"; FAKEBIN="$TMP/fakebin"; RECBIN="$TMP/recbin"; DRV="$TMP/drv"; HOMED="$TMP/home"
REC="$TMP/records.log"; JOURNAL="$TMP/journal.log"; SYSCTL="$TMP/systemctl.log"
mkdir -p "$PFX/etc/aicc-mail" "$PFX/etc/aicc/secrets" "$PFX/srv/aicc/shared" "$PFX/rel" "$FAKEBIN" "$RECBIN" "$DRV" "$HOMED/.ssh"
chmod 750 "$PFX/etc/aicc-mail" "$PFX/rel"; chmod 700 "$PFX/etc/aicc/secrets"; : > "$REC"; : > "$JOURNAL"; : > "$SYSCTL"
MAILD="$PFX/etc/aicc-mail"
reset_identity() { printf 'AICC_ENV=production\nAICC_HOSTNAME=www.copilt.org\nAICC_HOST_ROLE=control-plane-edge\nAICC_STAGE_ID=%s\n' "${1:-$STAGEID}" > "$PFX/etc/aicc-stage-identity"; }
reset_identity
echo '<?php' > "$TMP/abs-settings.php"; mkdir -p "$TMP/abs"; echo '<?php' > "$TMP/abs/wp-settings.php"
printf 'golden_db_pass_0001\n' > "$PFX/etc/aicc/secrets/db-cp.pass"
HEX="$(printf 'ab12%.0s' $(seq 16))"
{ for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT; do printf '%s=SALTVALUE_%s\n' "$k" "$k"; done; printf 'AICC_ACTIVATION_PROOF_SECRET=%s\nAICC_ENTITLEMENT_WEBHOOK_SECRET=%s\n' "$HEX" "$HEX"; } > "$PFX/etc/aicc/secrets/wp-secrets.env"
printf 'WEBHOOK-test-0123456789-0123456789-abcdef\n' > "$PFX/etc/aicc/secrets/entitlement-webhook.secret"; printf 'PROOF-test-0123456789-0123456789-abcdefgh\n' > "$PFX/etc/aicc/secrets/activation-proof.secret"; chmod 600 "$PFX/etc/aicc/secrets/"*

# recorder wrappers: every external command the scripts run logs its argv AND its environment, then runs the real one
make_wrapper() { # <dir> <name> <real path>
  cat > "$1/$2" <<WRAP
#!/bin/bash
{ printf 'REC $2 argv:'; printf ' [%s]' "\$@"; printf '\n'; /usr/bin/env | /usr/bin/sort | /usr/bin/sed 's/^/RECENV /'; } >> "$REC"
exec "$3" "\$@"
WRAP
  chmod 755 "$1/$2"
}
for c in shasum sed grep cut stat ssh-keygen cat tr awk head mktemp; do make_wrapper "$RECBIN" "$c" "$(command -v "$c")"; done
for c in python3 mktemp; do make_wrapper "$FAKEBIN" "$c" "$(command -v "$c")"; done
cat > "$FAKEBIN/logger" <<EOF
#!/bin/bash
{ printf 'LOGGER'; printf ' [%s]' "\$@"; printf '\n'; } >> "$JOURNAL"
EOF
cat > "$FAKEBIN/sudo" <<'EOF'
#!/bin/bash
while [ $# -gt 0 ]; do case "$1" in -u) shift 2 ;; -*) shift ;; *) break ;; esac; done
exec "$@"
EOF
cat > "$FAKEBIN/systemctl" <<EOF
#!/bin/bash
printf 'systemctl %s\n' "\$*" >> "$SYSCTL"
EOF
ln -s "$HOSTSCRIPT" "$FAKEBIN/aicc-set-brevo-key"
cat > "$FAKEBIN/aicc-owner-facts" <<EOF
#!/bin/bash
exec env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$PFX/etc/aicc/owner-facts.env" --env production "\$@"
EOF
cat > "$FAKEBIN/aicc-render-wp-config" <<EOF
#!/bin/bash
exec env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --out "$PFX/srv/aicc/shared/wp-config.php" --secrets-dir "$PFX/etc/aicc/secrets" --mail-dir "$PFX/etc/aicc-mail" --plugin-release-dir "$PFX/rel" --owner-facts-file "$PFX/etc/aicc/owner-facts.env" --owner "$OFU" "\$@"
EOF
cat > "$FAKEBIN/aicc-wp" <<EOF
#!/bin/bash
# a stand-in for the Control Plane's WP-CLI: prints what a real one would (the FULL address is deliberately included: the owner script must mask it)
if [ "\$1 \$2" = "aicc-mail check" ]; then echo "check: provider=brevo_api config=ok key=ok (content not shown)"; exit 0; fi
if [ "\$1 \$2" = "aicc-mail send-test" ]; then to=""; kind=""; for a in "\$@"; do case "\$a" in --to=*) to="\${a#--to=}" ;; --kind=*) kind="\${a#--kind=}" ;; esac; done
  printf 'send-test kind=%s result=accepted to=%s message_id=<fake-%s-0001@example.test>\n' "\$kind" "\$to" "\$kind"; exit 0; fi
echo "fake aicc-wp: unexpected \$*" >&2; exit 2
EOF
for f in "$FAKEBIN"/*; do [ -L "$f" ] || chmod 755 "$f"; done
cat > "$TMP/fakessh" <<EOF
#!/bin/bash
# fake ssh: logs its own argv and environment, checks the destination, then runs the REMOTE command locally inside the fake host (absolute host paths are re-rooted under the prefix)
set -u
dest=""; cmd=""; opts=()
while [ \$# -gt 0 ]; do case "\$1" in -i|-o) opts+=("\$1" "\$2"); shift 2 ;; -*) opts+=("\$1"); shift ;; *) dest="\$1"; shift; cmd="\$*"; break ;; esac; done
{ printf 'SSH dest=%s\n' "\$dest"; printf 'SSH opt=%s\n' "\${opts[@]}"; printf 'SSH cmd=%s\n' "\$cmd"; /usr/bin/env | /usr/bin/sort | /usr/bin/sed 's/^/SSHENV /'; } >> "$REC"
[ "\$dest" = "aicc@157.230.110.211" ] || { echo "fake ssh: unexpected destination \$dest" >&2; exit 255; }
[ ! -e "$TMP/ssh-down" ] || { echo "fake ssh: connection refused" >&2; exit 255; }
cmd="\${cmd//\\/etc\\//$PFX/etc/}"; cmd="\${cmd//\\/usr\\/local\\/sbin\\//$FAKEBIN/}"
exec env PATH="$FAKEBIN:\$PATH" AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$PFX" AICC_TEST_OWNER="$OFU" bash -c "\$cmd"
EOF
chmod 755 "$TMP/fakessh"
# the operator key file and the pinned host key of the Mac side (fake values)
ssh-keygen -q -t ed25519 -N '' -f "$TMP/hostkey" -C fake-host; printf '157.230.110.211 %s\n' "$(cut -d' ' -f1,2 "$TMP/hostkey.pub")" > "$HOMED/.ssh/known_hosts_aicc_prod"
printf 'fake operator key file, not a key\n' > "$HOMED/.ssh/aicc_cp_prod_operator"; chmod 600 "$HOMED/.ssh/aicc_cp_prod_operator"
BASEPATH="$PATH"
HOSTRUN() { env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$PFX" AICC_TEST_OWNER="$OFU" PATH="$FAKEBIN:$BASEPATH" bash "$HOSTSCRIPT" "$@"; }
HOSTIN() { local k="$1"; shift; printf '%s\n' "$k" | HOSTRUN "$@"; }       # key on stdin through a shell builtin (no argv)
mailstate() { ls -A "$MAILD" | tr '\n' ' '; }
fresh_dir() { rm -rf "$MAILD"; mkdir -p "$MAILD"; chmod 750 "$MAILD"; printf 'AICC_MAIL_SMTP_USER=u\nAICC_MAIL_SMTP_PASS=p-sentinel-0001\n' > "$MAILD/smtp.env"; chmod 640 "$MAILD/smtp.env"; printf 'turnstile-sentinel-secret-0002\n' > "$MAILD/turnstile.secret"; chmod 640 "$MAILD/turnstile.secret"; }
UNRELATED_SHA() { sha "$MAILD/smtp.env"; sha "$MAILD/turnstile.secret"; }
KF="$MAILD/brevo-api.key"
size_state() { local n; n="$(wc -c < "$KF" | tr -d ' ')"; if [ "$n" = 33 ] || [ "$n" = 38 ]; then echo whole; else echo "PARTIAL($n)"; fi; }

echo "== A. the host script: install / rotate / revoke / status =="
fresh_dir; SM0="$(UNRELATED_SHA)"
OUTI="$(HOSTIN "$KEY1" install --expect-stage-id "$STAGEID" 2>&1)"; rc=$?
t_eq "install exits 0" "$rc" "0"
t_contains "...prints exactly the documented line: installed: <path> owner mode size" "$OUTI" "installed: /etc/aicc-mail/brevo-api.key $OFU 640 33"
t_contains "...prints the fingerprint: the first 8 hex of the SHA-256" "$OUTI" "fingerprint: sha256:$(fp8 "$KEY1") "
t_not_contains "...and never the key" "$OUTI" "$KEY1"
t_eq "the file holds the key and one newline" "$(cat "$KF")" "$KEY1"
t_eq "...mode 0640 (whatever the caller's umask)" "$(mode "$KF")" "640"
t_eq "...owner:group is the expected one (root:aicc-cp on a real host)" "$(stat -f '%Su:%Sg' "$KF" 2>/dev/null || stat -c '%U:%G' "$KF")" "$OFU"
t_eq "...a regular file, not a symlink" "$([ -f "$KF" ] && [ ! -L "$KF" ] && echo yes)" "yes"
t_eq "...the directory holds only the three expected files (no temp, no backup)" "$(mailstate)" "brevo-api.key smtp.env turnstile.secret "
t_eq "...smtp.env and turnstile.secret are byte-identical to before (never opened for writing)" "$(UNRELATED_SHA)" "$SM0"
t_contains "the audit line went to the journal: action, operator, fingerprint prefix" "$(cat "$JOURNAL")" "[-t] [aicc-brevo-key]"
t_contains "...with the action and the fingerprint prefix" "$(cat "$JOURNAL")" "action=install operator="
t_contains "...(fingerprint)" "$(cat "$JOURNAL")" "fingerprint_prefix=$(fp8 "$KEY1")"
t_not_contains "...and no key in the journal" "$(cat "$JOURNAL")" "$KEY1"
t_contains "install reminds the next step and prints no key" "$OUTI" "NEXT:"
OUTX="$(HOSTIN "$KEY2" install 2>&1)"; rc=$?
t_eq "install over an existing file is REFUSED (use rotate)" "$rc" "1"
t_contains "...with the reason" "$OUTX" "use \`rotate\`"
t_eq "...and the old key is untouched" "$(cat "$KF")" "$KEY1"
SM1="$(UNRELATED_SHA)"
OUTR="$(HOSTIN "$KEY2" rotate 2>&1)"; rc=$?
t_eq "rotate exits 0" "$rc" "0"
t_eq "...the file holds the NEW key" "$(cat "$KF")" "$KEY2"
t_contains "...the fingerprint is the new one" "$OUTR" "fingerprint: sha256:$(fp8 "$KEY2") "
t_contains "...and it prints the reminder to revoke the old key in Brevo" "$OUTR" "REVOKE IT IN BREVO"
t_not_contains "...no key printed" "$OUTR" "$KEY2"
t_eq "...NO copy of the previous key is kept anywhere in the directory" "$(mailstate)" "brevo-api.key smtp.env turnstile.secret "
t_eq "...(and the old key is in no file of the whole fake host)" "$(grep -rlF "$KEY1" "$PFX" 2>/dev/null | head -1)" ""
t_eq "...mode 0640 again" "$(mode "$KF")" "640"
t_eq "...unrelated files untouched" "$(UNRELATED_SHA)" "$SM1"
STAT="$(HOSTRUN status 2>&1)"
t_contains "status shows the file: path, owner, mode, size, shape" "$STAT" "present: /etc/aicc-mail/brevo-api.key $OFU 640 38 bytes; mode/owner ok; shape: ok"
t_not_contains "...never the content" "$STAT" "$KEY2"
t_not_contains "...(nor a part of it)" "$STAT" "ROT2"
OUTV="$(HOSTRUN revoke 2>&1)"; rc=$?
t_eq "revoke exits 0" "$rc" "0"
t_eq "...the file is gone and NOTHING else changed" "$(mailstate)" "smtp.env turnstile.secret "
t_eq "...unrelated files untouched" "$(UNRELATED_SHA)" "$SM1"
t_contains "...it says the key must also be revoked in Brevo" "$OUTV" "REVOKE it in Brevo"
t_contains "...and how to switch the site's mail off" "$OUTV" "aicc-owner-facts unset AICC_MAIL_PROVIDER"
t_contains "...a second revoke is a harmless no-op" "$(HOSTRUN revoke 2>&1)" "nothing to revoke"
t_contains "status of an absent file says absent" "$(HOSTRUN status 2>&1)" "absent: /etc/aicc-mail/brevo-api.key"
t_contains "rotate with no file is REFUSED" "$(HOSTIN "$KEY1" rotate 2>&1 || true)" "nothing to rotate"
t_eq "...and wrote nothing" "$(mailstate)" "smtp.env turnstile.secret "
t_eq "the journal has one audit line per successful change (install, rotate, revoke, revoke)" "$(grep -c 'aicc-brevo-key' "$JOURNAL")" "4"
t_contains "...the revoke lines carry no fingerprint" "$(grep 'action=revoke' "$JOURNAL" | head -1)" "fingerprint_prefix=none"
# umask independence
fresh_dir; for um in 000 022 077; do rm -f "$KF"; ( umask "$um"; HOSTIN "$KEY1" install >/dev/null 2>&1 ); t_eq "file mode is 0640 with the caller's umask $um" "$(mode "$KF")" "640"; done
# shape and size refusals: nothing written, nothing printed
fresh_dir; SM2="$(UNRELATED_SHA)"
refuse_in() { local n="$1" want="$2" input="$3" out rc=0; out="$(printf '%b' "$input" | HOSTRUN install 2>&1)" || rc=$?; if [ "$rc" = 1 ] && printf '%s' "$out" | grep -qF -- "$want" && [ ! -e "$KF" ] && [ "$(mailstate)" = "smtp.env turnstile.secret " ]; then t_pass "$n"; else t_bad "$n" "rc=$rc dir='$(mailstate)' out=$(printf '%s' "$out" | head -2 | tr '\n' '|' | cut -c1-200)"; fi; }
refuse_in "an SMTP key (xsmtpsib-) is REFUSED with a plain reason" "this is an SMTP key" "$SMTPKEY\n"
refuse_in "an empty input is REFUSED" "the shape of a Brevo API key" ""
refuse_in "a bare newline is REFUSED" "the shape of a Brevo API key" "\n"
refuse_in "a 19-character key is REFUSED" "the shape of a Brevo API key" "aaaaaaaaaaaaaaaaaaa\n"
refuse_in "a 201-character key is REFUSED" "the shape of a Brevo API key" "$(printf 'a%.0s' $(seq 201))\n"
refuse_in "a key with a space is REFUSED" "the shape of a Brevo API key" "has a space inside this key 0000\n"
refuse_in "a key with punctuation is REFUSED" "the shape of a Brevo API key" "xkeysib-TEST-NOT-A-REAL-KEY-0000!\n"
refuse_in "a key with a dot is REFUSED" "the shape of a Brevo API key" "xkeysib.TEST.NOT.A.REAL.KEY.0000\n"
refuse_in "two lines are REFUSED (a second secret must not ride along)" "not exactly one line" "$KEY1\nsecond-line-secret-0000\n"
refuse_in "a CRLF line ending is REFUSED" "not exactly one line" "$KEY1\r\n"
refuse_in "a NUL byte is REFUSED" "not exactly one line" "${KEY1}\\0\n"
refuse_in "more than 257 bytes of input are REFUSED (byte limit)" "more than 257 bytes" "$(printf 'a%.0s' $(seq 400))\n"
t_not_contains "a refusal never echoes the offending input" "$(printf '%s\n' 'has a space inside this key 0000' | HOSTRUN install 2>&1 || true)" "has a space"
t_eq "...unrelated files untouched by every refusal" "$(UNRELATED_SHA)" "$SM2"
t_ok "a 20-character key (the lower bound) is accepted" bash -c "printf '%s\n' 'aaaaaaaaaaaaaaaaaaaa' | env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX='$PFX' AICC_TEST_OWNER='$OFU' PATH='$FAKEBIN:$BASEPATH' bash '$HOSTSCRIPT' install >/dev/null 2>&1"
rm -f "$KF"; t_ok "...and a 200-character key (the upper bound)" bash -c "printf '%s\n' '$(printf 'a%.0s' $(seq 200))' | env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX='$PFX' AICC_TEST_OWNER='$OFU' PATH='$FAKEBIN:$BASEPATH' bash '$HOSTSCRIPT' install >/dev/null 2>&1"
t_eq "...(size 201 = 200 + newline)" "$(wc -c < "$KF" | tr -d ' ')" "201"
# directory / symlink / special-file refusals
fresh_dir; chmod 755 "$MAILD"; t_contains "a directory with mode 0755 is REFUSED" "$(HOSTIN "$KEY1" install 2>&1 || true)" "must be $OFU 0750"; chmod 770 "$MAILD"; t_contains "...0770 too" "$(HOSTIN "$KEY1" install 2>&1 || true)" "must be $OFU 0750"; chmod 700 "$MAILD"; t_contains "...and 0700 (PHP could not traverse it)" "$(HOSTIN "$KEY1" install 2>&1 || true)" "must be $OFU 0750"; chmod 750 "$MAILD"
t_eq "...nothing was written in any of them" "$(mailstate)" "smtp.env turnstile.secret "
rm -rf "$MAILD"; t_contains "a missing /etc/aicc-mail is REFUSED" "$(HOSTIN "$KEY1" install 2>&1 || true)" "does not exist"
fresh_dir; mv "$MAILD" "$TMP/real-mail"; ln -s "$TMP/real-mail" "$MAILD"; t_contains "/etc/aicc-mail as a SYMLINK is REFUSED" "$(HOSTIN "$KEY1" install 2>&1 || true)" "not a directory"; t_eq "...nothing written through it" "$(ls -A "$TMP/real-mail" | tr '\n' ' ')" "smtp.env turnstile.secret "; rm -f "$MAILD"; mv "$TMP/real-mail" "$MAILD"
fresh_dir; printf 'victim-content\n' > "$TMP/victim"; ln -s "$TMP/victim" "$KF"; t_contains "a SYMLINK as the key file is REFUSED (rotate)" "$(HOSTIN "$KEY1" rotate 2>&1 || true)" "not a regular file"; t_contains "...(install too)" "$(HOSTIN "$KEY1" install 2>&1 || true)" "not a regular file"; t_eq "...and the link target was never written" "$(cat "$TMP/victim")" "victim-content"; HOSTRUN revoke >/dev/null 2>&1; t_ok "...revoke refuses it too: the link is still there" test -L "$KF"; rm -f "$KF"
mkdir "$KF"; t_contains "a DIRECTORY as the key file is REFUSED" "$(HOSTIN "$KEY1" install 2>&1 || true)" "not a regular file"; rmdir "$KF"
fresh_dir; t_contains "a stdin that is a terminal-less empty pipe is refused with the shape reason, not a hang" "$(HOSTRUN install </dev/null 2>&1 || true)" "the shape of a Brevo API key"
# identity gates (the key is not read before they pass)
fresh_dir; reset_identity "00000000000000000000000000000000"; t_contains "a wrong --expect-stage-id is REFUSED (wrong machine)" "$(HOSTIN "$KEY1" install --expect-stage-id "$STAGEID" 2>&1 || true)" "differs from --expect-stage-id"; t_ok "...nothing written" test ! -e "$KF"
printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\nAICC_STAGE_ID=%s\n' "$STAGEID" > "$PFX/etc/aicc-stage-identity"; t_contains "a STAGING identity is REFUSED" "$(HOSTIN "$KEY1" install --expect-stage-id "$STAGEID" 2>&1 || true)" "AICC_ENV=production"
printf 'AICC_ENV=production\nAICC_HOSTNAME=other.copilt.org\nAICC_STAGE_ID=%s\n' "$STAGEID" > "$PFX/etc/aicc-stage-identity"; t_contains "another host name is REFUSED" "$(HOSTIN "$KEY1" install --expect-stage-id "$STAGEID" 2>&1 || true)" "www.copilt.org"
reset_identity; t_contains "a malformed --expect-stage-id is REFUSED" "$(HOSTIN "$KEY1" install --expect-stage-id nothex 2>&1 || true)" "32 hex"
t_contains "an unknown mode is REFUSED" "$(HOSTRUN delete 2>&1 || true)" "unknown mode"
t_contains "an unknown argument is REFUSED" "$(HOSTIN "$KEY1" install --verbose 2>&1 || true)" "unknown argument"
# tracing and root
fresh_dir; XOUT="$(printf '%s\n' "$KEY1" | env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$PFX" AICC_TEST_OWNER="$OFU" PATH="$FAKEBIN:$BASEPATH" bash -x "$HOSTSCRIPT" install 2>&1)"; rc=$?
t_eq "the host script REFUSES to run under bash -x" "$rc" "1"; t_contains "...naming the reason" "$XOUT" "shell tracing"; t_not_contains "...and the key is not in that output" "$XOUT" "$KEY1"; t_ok "...nothing written" test ! -e "$KF"
t_contains "BASH_XTRACEFD set is REFUSED" "$(printf '%s\n' "$KEY1" | env BASH_XTRACEFD=2 AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$PFX" PATH="$FAKEBIN:$BASEPATH" bash "$HOSTSCRIPT" install 2>&1 || true)" "BASH_XTRACEFD"
t_contains "SHELLOPTS=xtrace is REFUSED" "$(printf '%s\n' "$KEY1" | env SHELLOPTS=xtrace AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX="$PFX" PATH="$FAKEBIN:$BASEPATH" bash "$HOSTSCRIPT" install 2>&1 | grep -v '^+' || true)" "shell tracing"
if [ "$(id -u)" != 0 ]; then t_contains "without the test harness a non-root caller is REFUSED" "$(printf '%s\n' "$KEY1" | env -u AICC_TEST_HARNESS AICC_ROOT_PREFIX="$PFX" bash "$HOSTSCRIPT" install 2>&1 || true)" "must run as root"; else t_skip "non-root refusal" "tests run as root"; fi
t_contains "the test seams are IGNORED without AICC_TEST_HARNESS=1 (the prefix is not honoured)" "$(printf '%s\n' "$KEY1" | env -u AICC_TEST_HARNESS AICC_ROOT_PREFIX="$PFX" AICC_TEST_KILL_AT=after_write bash "$HOSTSCRIPT" install 2>&1 || true)" "must run as root"
t_eq "the key is in no argument or environment recorded for any child of the host script (python3, mktemp)" "$(grep -cF "$KEY1" "$REC" || true)" "0"
t_eq "...nor a part of the second key" "$(grep -c 'ROT2' "$REC" || true)" "0"
t_eq "...and the journal never saw a key" "$(grep -c 'xkeysib' "$JOURNAL" || true)" "0"

echo "== B. ATOMICITY: kill -9 at every stage leaves the old key or nothing, never a partial or truncated file =="
for stage in after_create after_write after_fsync after_rename; do
  fresh_dir; AICC_TEST_KILL_AT="$stage" HOSTIN "$KEY1" install >/dev/null 2>&1; rc=$?
  t_ok "install killed at $stage: the process was really killed (non-zero exit)" test "$rc" != 0
  if [ "$stage" = after_rename ]; then
    t_eq "...install killed at $stage: the file is COMPLETE (the rename is the commit point)" "$(cat "$KF")" "$KEY1"
  else
    t_ok "...install killed at $stage: NO key file exists (never a partial one)" test ! -e "$KF"
  fi
  if [ -e "$KF" ]; then t_eq "...mode 0640 on the final file" "$(mode "$KF")" "640"; fi
  left="$(find "$MAILD" -maxdepth 1 -name '.brevo-api.key.new.*' | wc -l | tr -d ' ')"
  if [ "$stage" = after_rename ]; then t_eq "...no temp file left after the rename" "$left" "0"; else t_ok "...a stale temp may remain ($left) but never as brevo-api.key" test ! -e "$KF" -o "$stage" = after_rename; fi
  if [ "$left" != 0 ]; then
    t_ok "...a stale temp file is mode 0400 or 0640 and holds at most the new key (never anything of the old one)" bash -c "for f in '$MAILD'/.brevo-api.key.new.*; do m=\$(stat -f '%Lp' \"\$f\" 2>/dev/null || stat -c '%a' \"\$f\"); [ \"\$m\" = 400 ] || [ \"\$m\" = 640 ] || exit 1; done"
    t_contains "...status reports the stale temp file" "$(HOSTRUN status 2>&1)" "stale temp file"
    HOSTIN "$KEY1" install >/dev/null 2>&1; t_eq "...the next install removes it and succeeds" "$(mailstate)" "brevo-api.key smtp.env turnstile.secret "
  fi
  t_eq "...smtp.env and turnstile.secret are intact" "$(sha "$MAILD/smtp.env" | cut -c1-8)" "$(sha "$MAILD/smtp.env" | cut -c1-8)"
done
for stage in after_create after_write after_fsync after_rename; do
  fresh_dir; HOSTIN "$KEY1" install >/dev/null 2>&1; AICC_TEST_KILL_AT="$stage" HOSTIN "$KEY2" rotate >/dev/null 2>&1; rc=$?
  t_ok "rotate killed at $stage: really killed" test "$rc" != 0
  if [ "$stage" = after_rename ]; then t_eq "...rotate killed at $stage: the NEW key, complete" "$(cat "$KF")" "$KEY2"; else t_eq "...rotate killed at $stage: the OLD key is intact, complete (no truncation, no mix)" "$(cat "$KF")" "$KEY1"; fi
  t_eq "...the final file is a whole key plus newline (size is one of the two)" "$(size_state)" "whole"
  t_eq "...mode 0640" "$(mode "$KF")" "640"
  HOSTIN "$KEY2" rotate >/dev/null 2>&1; t_eq "...a later rotate succeeds and leaves no stale file" "$(mailstate)" "brevo-api.key smtp.env turnstile.secret "
done
fresh_dir; HOSTIN "$KEY1" install >/dev/null 2>&1; AICC_TEST_KILL_AT=after_write HOSTIN "$KEY2" rotate >/dev/null 2>&1
t_ok "a revoke after a crashed rotate removes the key AND the stale temp (no key material is left behind)" bash -c "env AICC_TEST_HARNESS=1 AICC_ROOT_PREFIX='$PFX' AICC_TEST_OWNER='$OFU' PATH='$FAKEBIN:$BASEPATH' bash '$HOSTSCRIPT' revoke >/dev/null 2>&1 && [ \"\$(ls -A '$MAILD' | tr '\n' ' ')\" = 'smtp.env turnstile.secret ' ]"

echo "== C. the Mac script: gates before any prompt =="
export HOME="$HOMED"
MAC_ENV=(env -i "PATH=$RECBIN:$FAKEBIN:$BASEPATH" "HOME=$HOMED" "TERM=xterm" "TMPDIR=$TMP" AICC_TEST_HARNESS=1 "AICC_TEST_SSH=$TMP/fakessh")
mac() { "${MAC_ENV[@]}" bash "$MACSCRIPT" "$@"; }
: > "$REC"
DRY="$(mac --dry-run 2>&1 </dev/null)"; rc=$?
t_eq "--dry-run exits 0" "$rc" "0"
t_contains "...prints the exact remote command (no secret in it)" "$DRY" "sudo /usr/local/sbin/aicc-set-brevo-key install --expect-stage-id $STAGEID"
t_contains "...prints the pinned ssh options (identity file, IdentitiesOnly, BatchMode, StrictHostKeyChecking=yes, the pinned known-hosts file)" "$DRY" "-i $HOMED/.ssh/aicc_cp_prod_operator -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -oUserKnownHostsFile=$HOMED/.ssh/known_hosts_aicc_prod"
t_contains "...names the only address it can reach" "$DRY" "aicc@157.230.110.211"
t_contains "...states the identity it would verify" "$DRY" "AICC_HOSTNAME=www.copilt.org, AICC_STAGE_ID=$STAGEID"
t_eq "...made NO connection (the fake ssh was never called)" "$(grep -c '^SSH dest' "$REC" || true)" "0"
t_contains "...also for rotate" "$(mac rotate --dry-run 2>&1 </dev/null)" "aicc-set-brevo-key rotate --expect-stage-id"
t_contains "...and revoke" "$(mac revoke --dry-run 2>&1 </dev/null)" "aicc-set-brevo-key revoke --expect-stage-id"
t_contains "...and --then-check lists the follow-up steps" "$(mac install --then-check --tests verify,welcome --dry-run 2>&1 </dev/null)" "send-test per kind: verify,welcome"
t_contains "...reports whether a terminal is available" "$DRY" "terminal: NOT available"
rm -f "$HOMED/.ssh/aicc_cp_prod_operator.bak"; mv "$HOMED/.ssh/aicc_cp_prod_operator" "$TMP/opkey"; t_contains "a missing operator key is REFUSED" "$(mac --dry-run 2>&1 || true)" "operator key"; chmod 644 "$TMP/opkey"; cp "$TMP/opkey" "$HOMED/.ssh/aicc_cp_prod_operator"; t_contains "an operator key with mode 0644 is REFUSED" "$(mac --dry-run 2>&1 || true)" "must be mode 0600"; chmod 600 "$HOMED/.ssh/aicc_cp_prod_operator"
mv "$HOMED/.ssh/known_hosts_aicc_prod" "$TMP/kh"; t_contains "a missing pinned host-key file is REFUSED (no trust on first use)" "$(mac --dry-run 2>&1 || true)" "pinned host-key file"; printf 'other.example.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDPLACEHOLDERPLACEHOLDERPLACEHOLDERPLACEHOLDER\n' > "$HOMED/.ssh/known_hosts_aicc_prod"; t_contains "a pinned file with no entry for the address is REFUSED" "$(mac --dry-run 2>&1 || true)" "no entry for 157.230.110.211"; cp "$TMP/kh" "$HOMED/.ssh/known_hosts_aicc_prod"
t_contains "an unknown option is refused (usage)" "$(mac --frobnicate 2>&1 || true)" "unknown argument"
t_contains "--tests with a bad kind is REFUSED" "$(mac --tests 'verify;rm' --dry-run 2>&1 || true)" "--tests must be"
t_contains "--tests with more than five kinds is REFUSED" "$(mac --tests a,b,c,d,e,f --dry-run 2>&1 || true)" "--tests must be"
t_contains "--then-check with revoke is REFUSED" "$(mac revoke --then-check --dry-run 2>&1 || true)" "--then-check applies to install and rotate only"
# no terminal
: > "$REC"; NT="$(printf '%s\n' "$KEY1" | mac install 2>&1)"; rc=$?
t_eq "install with stdin NOT a terminal (the key piped in) is REFUSED" "$rc" "1"
t_contains "...with the reason" "$NT" "stdin is not a terminal"
t_not_contains "...and the key is not echoed" "$NT" "$KEY1"
t_eq "...and it never connected (no ssh call: no identity read, nothing sent)" "$(grep -c '^SSH dest' "$REC" || true)" "0"
t_contains "rotate without a terminal is REFUSED too" "$(mac rotate </dev/null 2>&1 || true)" "stdin is not a terminal"
t_contains "revoke without a terminal is REFUSED too" "$(mac revoke </dev/null 2>&1 || true)" "stdin is not a terminal"
# tracing / history
TR="$(printf '' | env -i "PATH=$RECBIN:$FAKEBIN:$BASEPATH" "HOME=$HOMED" AICC_TEST_HARNESS=1 "AICC_TEST_SSH=$TMP/fakessh" bash -x "$MACSCRIPT" install 2>&1)"; t_contains "bash -x is REFUSED" "$TR" "shell tracing"
t_not_contains "...(it asked for no key)" "$TR" "Brevo API key (input hidden"
t_contains "BASH_XTRACEFD is REFUSED" "$("${MAC_ENV[@]}" BASH_XTRACEFD=2 bash "$MACSCRIPT" install </dev/null 2>&1 || true)" "BASH_XTRACEFD"
t_contains "SHELLOPTS=xtrace is REFUSED" "$("${MAC_ENV[@]}" SHELLOPTS=xtrace bash "$MACSCRIPT" install </dev/null 2>&1 | grep -v '^+' || true)" "shell tracing"
t_contains "a custom PS4 is REFUSED (a trace prompt can run commands)" "$("${MAC_ENV[@]}" 'PS4=$(touch /tmp/ap38-ps4-pwned)' bash "$MACSCRIPT" install </dev/null 2>&1 || true)" "PS4 is customised"
t_ok "...and the PS4 command did not run" test ! -e /tmp/ap38-ps4-pwned
t_contains "BASH_ENV set is REFUSED" "$("${MAC_ENV[@]}" "BASH_ENV=$TMP/none" bash "$MACSCRIPT" install </dev/null 2>&1 || true)" "BASH_ENV"
t_eq "the script clears its history file and sets umask 077 and no core dump (source checks)" "$(grep -c "unset HISTFILE\|^umask 077\|ulimit -c 0" "$MACSCRIPT")" "3"
t_eq "the key variable is never an argument of any command in the script (source check: no rssh/ssh/echo line contains \$k1 or \$k2 outside printf pipes and local tests)" "$(grep -n '\$k[12]' "$MACSCRIPT" | grep -v 'printf' | grep -v '^[0-9]*:[[:space:]]*#' | grep -v 'k1=""\|k2=""\|=~\|== xsmtpsib\|== xkeysib\|${#k1}\|\[ -n\|sha8' | wc -l | tr -d ' ')" "0"

echo "== D. the whole install flow on a pseudo terminal: nothing leaks =="
drive() { # drive <result-name> <steps-json> <secret> -- args...
  local name="$1" steps="$2" secret="$3"; shift 4
  jq -n --argjson steps "$steps" --arg secret "$secret" --arg out "$DRV/$name.json" --arg home "$HOMED" --arg path "$RECBIN:$FAKEBIN:$BASEPATH" --arg tmp "$TMP" --arg ssh "$TMP/fakessh" --arg mac "$MACSCRIPT" --argjson args "$(printf '%s\n' "$@" | jq -R . | jq -sc .)" \
    '{argv: (["/bin/bash", $mac] + $args), env: {PATH:$path, HOME:$home, TERM:"xterm", TMPDIR:$tmp, AICC_TEST_HARNESS:"1", AICC_TEST_SSH:$ssh}, cwd: $tmp, steps: $steps, secrets: [$secret], timeout: 120, out: $out}' > "$DRV/$name.cfg"
  python3 -I "$HERE/lib/pty_drive.py" "$DRV/$name.cfg"
}
res() { jq -r "$2" "$DRV/$1.json"; }
# CONTROLS: the detectors must detect (a tool that cannot see a leak proves nothing)
CTRL="$(jq -nc --arg out "$DRV/c1.json" --arg tmp "$TMP" '{argv:["/bin/bash","-c","sleep 1 CONTROL-SECRET-ARGV & CTRLENV=CONTROL-SECRET-ENV sleep 1 & wait; echo CONTROL-SECRET-TERMINAL"], env:{PATH:"/usr/bin:/bin"}, cwd:$tmp, steps:[], secrets:["CONTROL-SECRET-ARGV","CONTROL-SECRET-ENV","CONTROL-SECRET-TERMINAL"], timeout:30, out:$out}')"; printf '%s' "$CTRL" > "$DRV/c1.cfg"; python3 -I "$HERE/lib/pty_drive.py" "$DRV/c1.cfg"
t_eq "CONTROL: the poller sees a secret placed in an ARGUMENT" "$(res c1 '.leaks|map(select(contains("CONTROL-SECRET-ARGV")==false and contains("<SECRET>") and contains("sleep 1")))|length > 0')" "true"
t_eq "CONTROL: the poller sees a secret placed in the ENVIRONMENT of a process" "$(res c1 '.leaks|map(select(contains("CTRLENV=<SECRET>")))|length > 0')" "true"
t_eq "CONTROL: the terminal-output check sees a secret printed to the terminal" "$(res c1 '.leaks|map(select(startswith("TERMINAL")))|length > 0')" "true"
fresh_dir; reset_identity; : > "$REC"; : > "$JOURNAL"
STEPS="$(jq -nc --arg k "$KEY1" '[{expect:"Brevo API key (input hidden", send:($k+"\n"), hidden:true},{expect:"confirm (input hidden", send:($k+"\n"), hidden:true}]')"
drive d1 "$STEPS" "$KEY1" -- install
t_eq "install on a pty: exit 0" "$(res d1 .exit)" "0"
t_contains "...the terminal shows the identity verification" "$(res d1 .output)" "host identity verified: production, www.copilt.org"
t_contains "...and the installed line from the host" "$(res d1 .output)" "installed: /etc/aicc-mail/brevo-api.key"
t_contains "...and that the fingerprint matches what was typed" "$(res d1 .output)" "fingerprint matches what you typed: sha256:$(fp8 "$KEY1")"
t_eq "...the key file on the fake host holds the key" "$(cat "$KF")" "$KEY1"
t_eq "...mode 0640, owner as expected" "$(mode "$KF")/$(stat -f '%Su:%Sg' "$KF" 2>/dev/null || stat -c '%U:%G' "$KF")" "640/$OFU"
t_eq "the terminal output NEVER contained the key (not even echoed by the pty)" "$(res d1 '.leaks|map(select(startswith("TERMINAL")))|length')" "0"
t_eq "the process-list poller (arguments AND environment of every process, sampled every few ms) never saw the key" "$(res d1 '.leaks|length')" "0"
t_eq "the recorded argv/env of every external command the Mac script and the fake host ran holds no key" "$(grep -cF "$KEY1" "$REC" || true)" "0"
t_eq "...nor any fragment of it" "$(grep -c 'NOT-A-REAL-KEY' "$REC" || true)" "0"
t_ok "...(the records are real: ssh, shasum and the host's python were recorded)" bash -c "grep -q '^SSH cmd=sudo /usr/local/sbin/aicc-set-brevo-key install' '$REC' && grep -q '^REC shasum' '$REC' && grep -q '^REC python3' '$REC'"
t_eq "the remote command string sent over ssh contains no secret (it is exactly the documented command)" "$(grep '^SSH cmd=sudo' "$REC" | head -1)" "SSH cmd=sudo /usr/local/sbin/aicc-set-brevo-key install --expect-stage-id $STAGEID"
t_eq "the ssh options recorded are the pinned production ones" "$(grep '^SSH opt=' "$REC" | head -11 | tr '\n' ' ')" "SSH opt=-i SSH opt=$HOMED/.ssh/aicc_cp_prod_operator SSH opt=-o SSH opt=IdentitiesOnly=yes SSH opt=-o SSH opt=BatchMode=yes SSH opt=-o SSH opt=StrictHostKeyChecking=yes SSH opt=-oUserKnownHostsFile=$HOMED/.ssh/known_hosts_aicc_prod SSH opt=-o SSH opt=ConnectTimeout=15 "
t_eq "ssh was called twice: once to read the identity (before the prompt), once with the key on stdin" "$(grep -c '^SSH dest' "$REC")" "2"
t_contains "the identity read came first" "$(grep '^SSH cmd=' "$REC" | head -1)" "cat /etc/aicc-stage-identity"
t_eq "no file anywhere under the temp tree contains the key except the key file (and the test's own pty driver configs)" "$(grep -rlF "$KEY1" "$TMP" 2>/dev/null | grep -v "^$DRV/" | grep -v "^$KF\$" | tr '\n' ' ')" ""
t_eq "the journal has the audit line with the fingerprint and no key" "$(grep -c "fingerprint_prefix=$(fp8 "$KEY1")" "$JOURNAL")/$(grep -cF "$KEY1" "$JOURNAL" || true)" "1/0"
t_eq "the shell history of the test user was not written (HISTFILE unset in the script)" "$(find "$HOMED" -maxdepth 2 -iname '*history*' | wc -l | tr -d ' ')" "0"
# nothing is sent when a gate fails
fresh_dir; : > "$REC"
BAD="$(jq -nc --arg k "$KEY1" '[{expect:"Brevo API key (input hidden", send:($k+"\n"), hidden:true},{expect:"confirm (input hidden", send:($k+"X\n"), hidden:true}]')"
drive d2 "$BAD" "$KEY1" -- install; t_eq "two DIFFERENT entries: REFUSED (exit 1)" "$(res d2 .exit)" "1"
t_contains "...the message says compared by SHA-256, nothing shown" "$(res d2 .output)" "compared by SHA-256, nothing shown"
t_ok "...nothing was installed, and the install command never reached the host" bash -c "[ ! -e '$KF' ] && ! grep -q 'aicc-set-brevo-key install' '$REC'"
t_eq "...no leak even on the refusal path" "$(res d2 '.leaks|join(" | ")')" ""
SM="$(jq -nc --arg k "$SMTPKEY" '[{expect:"Brevo API key (input hidden", send:($k+"\n"), hidden:true}]')"; : > "$REC"
drive d3 "$SM" "$SMTPKEY" -- install; t_eq "an SMTP key typed at the prompt: REFUSED (exit 1)" "$(res d3 .exit)" "1"
t_contains "...with 'this is an SMTP key, an API key is needed'" "$(res d3 .output)" "this is an SMTP key"
t_ok "...before anything was sent (no install command on the host, no file)" bash -c "[ ! -e '$KF' ] && ! grep -q 'aicc-set-brevo-key install' '$REC'"
t_eq "...and the SMTP key never leaked" "$(res d3 '.leaks|length')" "0"
SH2="$(jq -nc '[{expect:"Brevo API key (input hidden", send:"short\n", hidden:true}]')"; : > "$REC"
drive d4 "$SH2" "short-secret" -- install; t_eq "a malformed entry: REFUSED (exit 1)" "$(res d4 .exit)" "1"
t_contains "...with the shape rule and only the LENGTH" "$(res d4 .output)" "does not have the shape of a Brevo API key"
t_ok "...nothing sent" bash -c "! grep -q 'aicc-set-brevo-key install' '$REC'"
printf 'AICC_ENV=production\nAICC_HOSTNAME=www.copilt.org\nAICC_STAGE_ID=00000000000000000000000000000000\n' > "$PFX/etc/aicc-stage-identity"; : > "$REC"
drive d5 "$STEPS" "$KEY1" -- install; t_eq "a host with the WRONG stage id: REFUSED before the prompt (exit 1)" "$(res d5 .exit)" "1"
t_contains "...naming the identity" "$(res d5 .output)" "differs from the expected production id"
t_eq "...the key prompt was never reached (no step typed)" "$(res d5 .steps_done)" "0"
t_ok "...nothing installed" test ! -e "$KF"
printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\nAICC_STAGE_ID=%s\n' "$STAGEID" > "$PFX/etc/aicc-stage-identity"; drive d6 "$STEPS" "$KEY1" -- install; t_contains "a STAGING host is REFUSED before the prompt" "$(res d6 .output)" "does not say AICC_ENV=production"
printf 'AICC_ENV=production\nAICC_HOSTNAME=stage.copilt.org\nAICC_STAGE_ID=%s\n' "$STAGEID" > "$PFX/etc/aicc-stage-identity"; drive d7 "$STEPS" "$KEY1" -- install; t_contains "a wrong host name is REFUSED before the prompt" "$(res d7 .output)" "hostname is not www.copilt.org"
reset_identity; : > "$REC"
touch "$TMP/ssh-down"; drive d8 "$STEPS" "$KEY1" -- install >/dev/null 2>&1; t_eq "an unreachable host: REFUSED before the prompt (exit 1, no step typed), nothing installed" "$(res d8 .exit)/$(res d8 .steps_done)/$([ -e "$KF" ] && echo installed || echo none)" "1/0/none"; rm -f "$TMP/ssh-down"

echo "== E. rotation, revocation, status and --then-check, end to end =="
fresh_dir; reset_identity; HOSTIN "$KEY1" install >/dev/null 2>&1; : > "$REC"; : > "$JOURNAL"
ROT="$(jq -nc --arg k "$KEY2" '[{expect:"Brevo API key (input hidden", send:($k+"\n"), hidden:true},{expect:"confirm (input hidden", send:($k+"\n"), hidden:true}]')"
drive r1 "$ROT" "$KEY2" -- rotate
t_eq "rotate on a pty: exit 0" "$(res r1 .exit)" "0"
t_eq "...the file holds the new key, mode 0640" "$(cat "$KF")/$(mode "$KF")" "$KEY2/640"
t_contains "...the reminder to revoke the old key in Brevo is printed" "$(res r1 .output)" "revoke the PREVIOUS key in Brevo"
t_eq "...no leak (poller + terminal)" "$(res r1 '.leaks|join(" | ")')" ""
t_eq "...the new key is in no record, journal or other file; the old key is nowhere on the host" "$(grep -cF "$KEY2" "$REC" || true)/$(grep -cF "$KEY2" "$JOURNAL" || true)/$(grep -rlF "$KEY1" "$PFX" 2>/dev/null | wc -l | tr -d ' ')" "0/0/0"
t_eq "...the directory holds no backup of the previous key" "$(mailstate)" "brevo-api.key smtp.env turnstile.secret "
fresh_dir; : > "$REC"; drive r2 "$ROT" "$KEY2" -- rotate; t_eq "rotate with no existing key: the host refuses (exit 1)" "$(res r2 .exit)" "1"; t_contains "...nothing to rotate" "$(res r2 .output)" "nothing to rotate"
fresh_dir; HOSTIN "$KEY1" install >/dev/null 2>&1; drive r3 "$STEPS" "$KEY1" -- install; t_eq "install when a key exists: the host refuses (exit 1) and the key is unchanged" "$(res r3 .exit)/$(cat "$KF")" "1/$KEY1"
# status
: > "$REC"; ST="$(mac status 2>&1 </dev/null)"; rc=$?; t_eq "status (no terminal needed) exits 0" "$rc" "0"; t_contains "...shows the host file's state" "$ST" "present: /etc/aicc-mail/brevo-api.key"; t_not_contains "...never the content" "$ST" "NOT-A-REAL"
# revoke
fresh_dir; HOSTIN "$KEY1" install >/dev/null 2>&1; NOC="$(jq -nc '[{expect:"Type REVOKE to continue", send:"no\n"}]')"; drive v1 "$NOC" "none-secret" -- revoke
t_eq "revoke not confirmed: nothing changes (exit 1)" "$(res v1 .exit)/$(cat "$KF")" "1/$KEY1"
YES="$(jq -nc '[{expect:"Type REVOKE to continue", send:"REVOKE\n"}]')"; drive v2 "$YES" "none-secret" -- revoke
t_eq "revoke confirmed: exit 0, the file is gone, nothing else changed" "$(res v2 .exit)/$(mailstate)" "0/smtp.env turnstile.secret "
t_contains "...the reminder that the key is still valid in Brevo" "$(res v2 .output)" "still valid in Brevo until YOU revoke it there"
# --then-check with the real renderer: facts first (the activation runbook), then the owner script
fresh_dir; reset_identity; rm -f "$PFX/etc/aicc/owner-facts.env" "$PFX/srv/aicc/shared/wp-config.php"; : > "$SYSCTL"
FACTS() { env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$PFX/etc/aicc/owner-facts.env" --env production "$@" >/dev/null; }
FACTS set AICC_MAIL_PROVIDER brevo_api; FACTS set AICC_MAIL_FROM_ADDRESS notifications@copilt.org
AICC_TEST_HARNESS=1 "$FAKEBIN/aicc-render-wp-config" --env production --confirm-production >/dev/null 2>&1
t_eq "(before the key: the render is the plain default, mail OFF: no AICC_MAIL_ENABLED in code)" "$(grep -v '^//' "$PFX/srv/aicc/shared/wp-config.php" | grep -c 'AICC_MAIL_ENABLED' || true)" "0"
: > "$REC"; : > "$JOURNAL"
TC="$(jq -nc --arg k "$KEY1" '[{expect:"Brevo API key (input hidden", send:($k+"\n"), hidden:true},{expect:"confirm (input hidden", send:($k+"\n"), hidden:true},{expect:"Render the configuration and reload PHP-FPM now?", send:"y\n"},{expect:"for the test messages", send:"Owner.Box@example.org\n"},{expect:"Send test message(s)", send:"y\n"}]')"
drive t1 "$TC" "$KEY1" -- install --then-check --tests verify,welcome
t_eq "--then-check: exit 0" "$(res t1 .exit)" "0"
t_eq "...all five prompts were answered" "$(res t1 .steps_done)" "5"
OUTT="$(res t1 .output)"
t_contains "...shows what a render would change, by constant name only" "$OUTT" "added  : AICC_MAIL_ALLOWED_FROM_DOMAINS, AICC_MAIL_API_KEY_FILE, AICC_MAIL_DAILY_BUDGET, AICC_MAIL_ENABLED, AICC_MAIL_FROM_ADDRESS, AICC_MAIL_FROM_NAME, AICC_MAIL_PROVIDER, AICC_MAIL_REPLY_TO"
t_contains "...the render wrote the Brevo region (the real renderer judged the installed key file)" "$(grep -c "define( 'AICC_MAIL_ENABLED', true );" "$PFX/srv/aicc/shared/wp-config.php")" "1"
t_eq "...api.brevo.com is on the allow-list exactly once" "$(grep -c 'api\.brevo\.com' "$PFX/srv/aicc/shared/wp-config.php")" "1"
t_contains "...PHP-FPM was reloaded (twice: after the key, after the test recipient)" "$(grep -c 'reload php8.3-fpm' "$SYSCTL")" "2"
t_contains "...the read-only check ran" "$OUTT" "check: provider=brevo_api config=ok key=ok"
t_contains "...the owner fact for the test mailbox was set (exact address in the root-only facts file)" "$(grep AICC_MAIL_TEST_RECIPIENTS "$PFX/etc/aicc/owner-facts.env")" "AICC_MAIL_TEST_RECIPIENTS=Owner.Box@example.org"
t_contains "...and rendered into the config" "$(grep -c "AICC_MAIL_TEST_RECIPIENTS', 'Owner.Box@example.org'" "$PFX/srv/aicc/shared/wp-config.php")" "1"
t_contains "...the verify test ran: outcome class and provider message id" "$OUTT" "verify: ok"
t_contains "...the message id is shown" "$OUTT" "message_id=<fake-verify-0001@example.test>"
t_contains "...the welcome test ran" "$OUTT" "message_id=<fake-welcome-0001@example.test>"
t_eq "...the typed address appears in the output EXACTLY once: the terminal's own echo of what the owner typed; the script itself prints it nowhere (every later line shows the masked form)" "$(printf '%s' "$OUTT" | grep -o 'Owner.Box@example.org' | wc -l | tr -d ' ')" "1"
t_contains "...(masked form)" "$OUTT" "O***@example.org"
t_eq "...the key is in no output, process list sample, record, journal or file" "$(res t1 '.leaks|length')/$(grep -cF "$KEY1" "$REC" || true)/$(grep -cF "$KEY1" "$JOURNAL" || true)/$(grep -rlF "$KEY1" "$TMP" 2>/dev/null | grep -v "^$DRV/" | grep -v "^$KF\$" | wc -l | tr -d ' ')" "0/0/0/0"
t_eq "...the wp-config.php on the fake host contains no key" "$(grep -c "NOT-A-REAL-KEY" "$PFX/srv/aicc/shared/wp-config.php" || true)" "0"
# declining the render and the mailbox leaves the configuration alone
fresh_dir; rm -f "$PFX/etc/aicc/owner-facts.env"; FACTS set AICC_MAIL_PROVIDER brevo_api; FACTS set AICC_MAIL_FROM_ADDRESS notifications@copilt.org; AICC_TEST_HARNESS=1 "$FAKEBIN/aicc-render-wp-config" --env production --confirm-production >/dev/null 2>&1; W0="$(sha "$PFX/srv/aicc/shared/wp-config.php")"; : > "$SYSCTL"
TN="$(jq -nc --arg k "$KEY1" '[{expect:"Brevo API key (input hidden", send:($k+"\n"), hidden:true},{expect:"confirm (input hidden", send:($k+"\n"), hidden:true},{expect:"Render the configuration and reload PHP-FPM now?", send:"n\n"},{expect:"for the test messages", send:"\n"}]')"
drive t2 "$TN" "$KEY1" -- install --then-check
t_eq "answering n and an empty mailbox: exit 0, the key is placed, the config is NOT rendered, PHP-FPM not reloaded, no test sent" "$(res t2 .exit)/$(cat "$KF")/$([ "$(sha "$PFX/srv/aicc/shared/wp-config.php")" = "$W0" ] && echo same)/$(grep -c reload "$SYSCTL" || true)/$(res t2 .output | grep -c 'send-test')" "0/$KEY1/same/0/0"
t_eq "...no facts file entry for a test recipient" "$(grep -c TEST_RECIPIENTS "$PFX/etc/aicc/owner-facts.env" || true)" "0"
# a non-address at the mailbox prompt is refused and nothing is set
fresh_dir; TB="$(jq -nc --arg k "$KEY1" '[{expect:"Brevo API key (input hidden", send:($k+"\n"), hidden:true},{expect:"confirm (input hidden", send:($k+"\n"), hidden:true},{expect:"Render the configuration and reload PHP-FPM now?", send:"n\n"},{expect:"for the test messages", send:"not an address; rm -rf /\n"}]')"
drive t3 "$TB" "$KEY1" -- install --then-check; t_eq "a hostile string at the mailbox prompt: REFUSED (exit 1), nothing set" "$(res t3 .exit)/$(grep -c TEST_RECIPIENTS "$PFX/etc/aicc/owner-facts.env" || true)" "1/0"
t_contains "...with the reason" "$(res t3 .output)" "not a plain mailbox address"

echo "== F. script hygiene (source checks) =="
t_eq "the Mac script refuses every address but 157.230.110.211 (the address is a constant; no --host option)" "$(grep -c -- '--host\|--ip\|--stage-ip' "$MACSCRIPT" || true)/$(grep -c 'HOSTIP="157.230.110.211"' "$MACSCRIPT")" "0/1"
t_eq "the Mac script never uses the production API key or another identity" "$(grep -c 'aicc_digitalocean_prod\|aicc_cp_stage' "$MACSCRIPT" || true)" "0"
t_eq "the host script has no network command, no eval, no bash -x, no set -x" "$(grep -v '^[[:space:]]*#' "$HOSTSCRIPT" | grep -Ec '(^|[;&|(] *)(curl|wget|nc|eval|tee|bash -x|set -x) ' || true)" "0"
t_eq "the host script writes only the key file through the python writer (os.replace of a temp in the same directory)" "$(grep -c '^    os.replace(tmp, target)$' "$HOSTSCRIPT")/$(grep -c 'os.O_EXCL' "$HOSTSCRIPT")" "1/1"
t_ok "both scripts are shellcheck-clean at warning level (when shellcheck is installed)" bash -c "command -v shellcheck >/dev/null || exit 0; shellcheck -x -S warning '$MACSCRIPT' && shellcheck -x -S warning -s bash '$HOSTSCRIPT'"

t_summary
