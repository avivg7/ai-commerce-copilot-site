#!/usr/bin/env bash
# BACKUP-ENCRYPTION KIT SELF-TEST. Runs the owner procedure of 01-signing-and-backup-key-kit.md part B in a THROWAWAY sandbox with a THROWAWAY RSA key,
# against the REAL pull-offhost.sh / decrypt-offhost.sh / install-launchd.sh of the Site repo. The host is a stub (no network, no ssh): it serves a fake backup set.
#   backup-key-selftest.sh --site-repo <Site checkout containing infra/backup/pull-offhost.sh> [--keep]
set -uo pipefail
SITE=""; KEEP=0
while [ $# -gt 0 ]; do case "$1" in --site-repo) SITE="${2:-}"; shift 2;; --keep) KEEP=1; shift;; *) echo "usage: $0 --site-repo DIR [--keep]" >&2; exit 2;; esac; done
BKP="$SITE/infra/backup"; [ -f "$BKP/pull-offhost.sh" ] || { echo "no infra/backup/pull-offhost.sh in '$SITE'" >&2; exit 2; }
SB="$(mktemp -d "${TMPDIR:-/tmp}/aicc-backup-selftest.XXXXXX")"; chmod 700 "$SB"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1"; }
t_ok() { local d="$1"; shift; if "$@" >"$SB/last.out" 2>&1; then ok "$d"; else bad "$d"; sed 's/^/        /' "$SB/last.out" | head -8; fi; }
t_rc() { local d="$1" want="$2"; shift 2; "$@" >"$SB/last.out" 2>&1; local rc=$?; if [ "$rc" = "$want" ]; then ok "$d (exit $rc)"; else bad "$d (exit $rc, wanted $want)"; sed 's/^/        /' "$SB/last.out" | head -6; fi; }
MNT=""
cleanup() {
  [ -n "$MNT" ] && hdiutil detach "$MNT" -force >/dev/null 2>&1
  if [ "$KEEP" = 1 ]; then echo "sandbox kept at $SB (THROWAWAY keys only)"; return; fi
  find "$SB" -name '*.key' -type f -exec sh -c 'for f; do head -c 256 /dev/urandom > "$f" 2>/dev/null; done' _ {} + 2>/dev/null
  rm -rf "$SB"; [ ! -e "$SB" ] && echo "sandbox deleted: $SB"
}
trap cleanup EXIT
echo "== sandbox $SB; openssl in PATH: $(openssl version); LaunchAgent default PATH would use: $(/usr/bin/openssl version)"

echo "== 1. generate the key pair ON the encrypted image (the real procedure: on a stick/medium that is not the pulling Mac's disk)"
printf 'throwaway-selftest-passphrase\n' | hdiutil create -size 16m -encryption AES-256 -fs APFS -volname AICCBACKUPKEY -stdinpass "$SB/keys.dmg" >/dev/null 2>&1 && ok "encrypted image created" || bad "hdiutil create"
MNT="$SB/mnt"; mkdir -p "$MNT"; printf 'throwaway-selftest-passphrase\n' | hdiutil attach -stdinpass -mountpoint "$MNT" "$SB/keys.dmg" >/dev/null 2>&1 && ok "image mounted" || bad "attach"
umask 077
( cd "$MNT" && openssl req -x509 -newkey rsa:4096 -nodes -keyout aicc-backup-recipient.key -out aicc-backup-recipient.crt -subj "/CN=aicc-backup-recipient" -days 3650 ) >/dev/null 2>&1 \
  && ok "openssl req -x509 -newkey rsa:4096 -nodes ... -days 3650 (the README command)" || bad "key generation"
chmod 600 "$MNT/aicc-backup-recipient.key"
CRT="$MNT/aicc-backup-recipient.crt"; KEY="$MNT/aicc-backup-recipient.key"
grep -q 'BEGIN CERTIFICATE' "$CRT" && ! grep -q 'PRIVATE KEY' "$CRT" && ok "the .crt is a certificate and holds NO private key" || bad "crt content"
BITS="$(openssl x509 -in "$CRT" -noout -text | sed -n 's/.*Public-Key: (\([0-9]*\) bit).*/\1/p' | head -1)"; [ "${BITS:-0}" -ge 3072 ] && ok "RSA $BITS bits (>= 3072)" || bad "bits=$BITS"
echo "      certificate fingerprint (record this; it identifies the key you must be able to find later): $(openssl x509 -in "$CRT" -noout -fingerprint -sha256)"
echo "      expires: $(openssl x509 -in "$CRT" -noout -enddate)"

echo "== 2. the REAL pull-offhost.sh (stub ssh) encrypts to the certificate; the Mac holds ciphertext only"
REMOTE="$SB/remote"; STUB="$SB/stub"; mkdir -p "$REMOTE" "$STUB" "$SB/home/.ssh" "$SB/fake-up"; CALLS="$SB/calls.log"; : > "$CALLS"; echo img > "$SB/fake-up/a.jpg"
printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\n' > "$SB/ident"
mkset() { local ts="$1" d="aicc_cp-$1-scheduled.sql.gz" f="aicc-files-$1-scheduled.tar.gz"
  printf 'CREATE TABLE customers (id int, email text);\nINSERT INTO customers VALUES (1,%s);\n-- Dump completed on %s\n' "'selftest@example.invalid'" "$ts" | gzip -c > "$REMOTE/$d"; tar czf "$REMOTE/$f" -C "$SB" fake-up 2>/dev/null
  echo "$(shasum -a 256 "$REMOTE/$d" | cut -d' ' -f1)  $d" > "$REMOTE/$d.sha256"; echo "$(shasum -a 256 "$REMOTE/$f" | cut -d' ' -f1)  $f" > "$REMOTE/$f.sha256"
  jq -n --arg d "$d" --arg f "$f" --arg ds "$(shasum -a 256 "$REMOTE/$d" | cut -d' ' -f1)" --arg fs "$(shasum -a 256 "$REMOTE/$f" | cut -d' ' -f1)" --argjson e "$(date -u +%s)" \
   '{schema:1,status:"ok",reason:"",finished_epoch:$e,db_dump:{file:$d,sha256:$ds},files_archive:{file:$f,sha256:$fs},last_success:{finished_epoch:$e,db_dump_file:$d,files_archive_file:$f}}' > "$REMOTE/status.json"; }
cat > "$STUB/ssh" <<EOS
#!/usr/bin/env bash
echo "ssh \$*" >> "$CALLS"
cmd="\${@: -1}"
case "\$cmd" in
  identity) printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\n' ;;
  ack\ *) AICC_TEST_HARNESS=1 AICC_BACKUP_DIR="$REMOTE" bash "$BKP/aicc-offhost-serve.sh" "\$cmd" ;;
  get\ *|status) AICC_TEST_HARNESS=1 AICC_BACKUP_DIR="$REMOTE" AICC_IDENTITY_FILE="$SB/ident" bash "$BKP/aicc-offhost-serve.sh" "\$cmd" ;;
  *) exit 1 ;;
esac
EOS
chmod +x "$STUB/ssh"
FAKEKEY="$SB/fake_stage_key"; printf -- '-----BEGIN %s-----\nDUMMY-NOT-A-KEY\n-----END %s-----\n' "OPENSSH PRIVATE KEY" "OPENSSH PRIVATE KEY" > "$FAKEKEY"
PULL() { local p="$1"; shift; env HOME="$SB/home" PATH="$p" bash "$BKP/pull-offhost.sh" --key "$FAKEKEY" --stage-ip 203.0.113.9 "$@"; }
DEST1="$SB/dest-homebrew"; DEST2="$SB/dest-launchagent"
# a plaintext copy that pre-exists (what the staging agent has written so far)
mkdir -p "$DEST1"; chmod 700 "$DEST1"
mkset 20261020T010000Z; cp "$REMOTE/aicc_cp-20261020T010000Z-scheduled.sql.gz" "$REMOTE/aicc_cp-20261020T010000Z-scheduled.sql.gz.sha256" "$DEST1/"
mkset 20261023T010000Z
D="aicc_cp-20261023T010000Z-scheduled.sql.gz"; F="aicc-files-20261023T010000Z-scheduled.tar.gz"
t_ok "encrypted pull, PATH with Homebrew OpenSSL 3 (interactive Mac)" PULL "$STUB:$PATH" --dest "$DEST1" --encrypt-to "$CRT"
t_ok "encrypted pull, LaunchAgent-like PATH (/usr/bin = LibreSSL 3.3)" PULL "$STUB:/usr/bin:/bin:/usr/sbin:/sbin" --dest "$DEST2" --encrypt-to "$CRT"
for DD in "$DEST1" "$DEST2"; do
  n="$(basename "$DD")"
  [ -s "$DD/$D.cms" ] && [ -s "$DD/$F.cms" ] && ok "$n: dump and files archive stored as .cms" || bad "$n: no .cms"
  [ ! -e "$DD/$D" ] && [ ! -e "$DD/$F" ] && ok "$n: NO plaintext of the new set at rest" || bad "$n: plaintext present"
  [ "$(ls "$DD"/*.partial 2>/dev/null | wc -l | tr -d ' ')" = 0 ] && ok "$n: no .partial plaintext temp left" || bad "$n: partial left"
  gzip -t "$DD/$D.cms" 2>/dev/null && bad "$n: ciphertext is readable gzip!" || ok "$n: ciphertext is opaque (not gzip)"
  strings "$DD/$D.cms" | grep -q 'selftest@example.invalid' && bad "$n: plaintext marker visible in ciphertext" || ok "$n: the customer-data marker is not visible in the ciphertext"
  [ "$(stat -f %Lp "$DD/$D.cms")" = 600 ] && [ "$(stat -f %Lp "$DD")" = 700 ] && ok "$n: modes 0600 file / 0700 directory" || bad "$n: modes"
  [ "$(awk '{print $1}' "$DD/$D.cms.sha256")" = "$(shasum -a 256 "$REMOTE/$D" | cut -d' ' -f1)" ] && ok "$n: sidecar = PLAINTEXT sha256 (what the host acked)" || bad "$n: sidecar"
done
tail -3 "$DEST2/pull.log" | sed 's/^/      pull.log: /'
jq -e '.verified==true' "$REMOTE/offhost-ack.json" >/dev/null 2>&1 && ok "the host received the ack for the set" || bad "no ack"

echo "== 3. DECRYPT with the private key (the restore path): both OpenSSL builds, hash checked, byte-identical"
t_ok "decrypt-offhost.sh (Homebrew OpenSSL 3 build) of the Homebrew-encrypted copy" bash "$BKP/decrypt-offhost.sh" --key "$KEY" --in "$DEST1/$D.cms" --out "$SB/out1.sql.gz"
cmp -s "$SB/out1.sql.gz" "$REMOTE/$D" && ok "...byte-identical to the host's dump" || bad "...differs"
t_ok "decrypt-offhost.sh with PATH=/usr/bin (LibreSSL) of the LaunchAgent-encrypted copy" env PATH="/usr/bin:/bin" bash "$BKP/decrypt-offhost.sh" --key "$KEY" --in "$DEST2/$D.cms" --out "$SB/out2.sql.gz"
cmp -s "$SB/out2.sql.gz" "$REMOTE/$D" && ok "...byte-identical" || bad "...differs"
t_ok "cross: OpenSSL 3 decrypts the LibreSSL-encrypted copy" bash "$BKP/decrypt-offhost.sh" --key "$KEY" --in "$DEST2/$F.cms" --out "$SB/out3.tgz"
t_ok "cross: LibreSSL decrypts the OpenSSL-3-encrypted copy" env PATH="/usr/bin:/bin" bash "$BKP/decrypt-offhost.sh" --key "$KEY" --in "$DEST1/$F.cms" --out "$SB/out4.tgz"
gzip -dc "$SB/out1.sql.gz" | grep -q 'CREATE TABLE customers' && ok "the decrypted dump gunzips and holds the data (restore-ready)" || bad "dump not usable"
tar tzf "$SB/out3.tgz" >/dev/null 2>&1 && ok "the decrypted files archive lists with tar" || bad "archive not usable"

echo "== 4. FAILURES: wrong key, damaged ciphertext, bad certificates"
openssl req -x509 -newkey rsa:3072 -nodes -keyout "$SB/other.key" -out "$SB/other.crt" -subj "/CN=other" -days 30 >/dev/null 2>&1
t_rc "a DIFFERENT private key cannot decrypt" 1 bash "$BKP/decrypt-offhost.sh" --key "$SB/other.key" --in "$DEST1/$D.cms" --out "$SB/w.sql.gz"
[ ! -e "$SB/w.sql.gz" ] && ok "...and leaves no output file" || bad "output left behind"
cp "$DEST1/$D.cms" "$SB/damaged.cms"; cp "$DEST1/$D.cms.sha256" "$SB/damaged.cms.sha256"; printf 'X' | dd of="$SB/damaged.cms" bs=1 seek=400 conv=notrunc 2>/dev/null
t_rc "a DAMAGED ciphertext is refused" 1 bash "$BKP/decrypt-offhost.sh" --key "$KEY" --in "$SB/damaged.cms" --out "$SB/d.sql.gz"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$SB/weak.key" -out "$SB/weak.crt" -subj "/CN=weak" -days 30 >/dev/null 2>&1
cat "$CRT" "$KEY" > "$SB/crt-with-key.pem"
t_rc "pull REFUSES a 2048-bit certificate" 3 PULL "$STUB:$PATH" --dest "$SB/d-w" --encrypt-to "$SB/weak.crt"
t_rc "pull REFUSES a file that also contains the PRIVATE key" 3 PULL "$STUB:$PATH" --dest "$SB/d-k" --encrypt-to "$SB/crt-with-key.pem"
t_rc "pull REFUSES a missing certificate path" 3 PULL "$STUB:$PATH" --dest "$SB/d-m" --encrypt-to "$SB/nope.crt"
t_rc "pull REFUSES a relative certificate path (cwd-independent agents)" 3 bash -c "cd '$MNT' && env HOME='$SB/home' PATH='$STUB:$PATH' bash '$BKP/pull-offhost.sh' --key '$FAKEKEY' --stage-ip 203.0.113.9 --dest '$SB/d-r' --encrypt-to aicc-backup-recipient.crt"
PRODKEY="$SB/aicc_cp_prod_offhost"; cp "$FAKEKEY" "$PRODKEY"; echo "203.0.113.9 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItestonlytestonlytestonlytestonlytestonlytest" > "$SB/kh_prod"
t_rc "production pull WITHOUT --encrypt-to is REFUSED before any ssh" 3 env HOME="$SB/home" PATH="$STUB:$PATH" bash "$BKP/pull-offhost.sh" --env production --stage-ip 203.0.113.9 --expect-id 0123456789abcdef0123456789abcdef --key "$PRODKEY" --known-hosts "$SB/kh_prod" --dest "$SB/d-p"

echo "== 5. what happens to OLD UNENCRYPTED copies (measured, not assumed)"
[ -e "$DEST1/aicc_cp-20261020T010000Z-scheduled.sql.gz" ] && ok "FACT: the pull never encrypts or deletes older PLAINTEXT sets by itself (tiered retention keeps them up to 8 weeks)" || bad "plaintext vanished (retention behaviour changed: re-read pull-offhost.sh)"
CLEAN() { find "$1" -maxdepth 1 -type f \( -name 'aicc_cp-*.sql.gz' -o -name 'aicc_cp-*.sql.gz.sha256' -o -name 'aicc-files-*.tar.gz' -o -name 'aicc-files-*.tar.gz.sha256' \) "${@:2}"; }
echo "      cleanup would remove: $(CLEAN "$DEST1" -print | xargs -n1 basename 2>/dev/null | tr '\n' ' ')"
CLEAN "$DEST1" -delete
[ ! -e "$DEST1/aicc_cp-20261020T010000Z-scheduled.sql.gz" ] && ok "the owner's cleanup command removed the plaintext sets" || bad "cleanup did not remove"
[ -s "$DEST1/$D.cms" ] && [ -s "$DEST1/$D.cms.sha256" ] && [ -s "$DEST1/$D.cms.csha256" ] && ok "...and did NOT touch .cms / .cms.sha256 / .cms.csha256" || bad "cleanup damaged ciphertext sets"
t_ok "after cleanup the next pull still works and the set is still decryptable" bash -c "env HOME='$SB/home' PATH='$STUB:$PATH' bash '$BKP/pull-offhost.sh' --key '$FAKEKEY' --stage-ip 203.0.113.9 --dest '$DEST1' --encrypt-to '$CRT' && bash '$BKP/decrypt-offhost.sh' --key '$KEY' --in '$DEST1/$D.cms' --out '$SB/out5.sql.gz'"

echo "== 6. the LaunchAgent installer takes the certificate (DRY-RUN, HOME in the sandbox: nothing is installed)"
OUT="$(env HOME="$SB/home" bash "$BKP/macos/install-launchd.sh" --stage-ip 203.0.113.9 --key "$FAKEKEY" --dest "$DEST2" --encrypt-to "$CRT" 2>&1)"
echo "$OUT" | grep -q "<string>--encrypt-to</string><string>$CRT</string>" && ok "dry-run plist passes --encrypt-to <certificate>" || bad "plist lacks --encrypt-to"
echo "$OUT" | grep -q 'PRIVATE KEY' && bad "plist contains a private key" || ok "plist contains no private key"
t_rc "installer REFUSES a certificate file that holds a private key" 1 env HOME="$SB/home" bash "$BKP/macos/install-launchd.sh" --stage-ip 203.0.113.9 --key "$FAKEKEY" --dest "$DEST2" --encrypt-to "$SB/crt-with-key.pem"
[ ! -e "$SB/home/Library/LaunchAgents/com.aicc.offhost-pull.plist" ] && ok "nothing was written to a LaunchAgents folder" || bad "plist written in dry-run"

echo "== 7. the image is closed again; the private key is unreachable without the passphrase"
hdiutil detach "$MNT" -force >/dev/null 2>&1; MNT=""
printf 'wrong-passphrase\n' | hdiutil attach -stdinpass -mountpoint "$SB/mnt2" "$SB/keys.dmg" >/dev/null 2>&1 && bad "mounted with wrong passphrase" || ok "wrong passphrase cannot open the image"
echo "== RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
