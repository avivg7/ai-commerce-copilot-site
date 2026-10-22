#!/usr/bin/env bash
# Decrypts one off-host copy (`<name>.cms`, written by pull-offhost.sh --encrypt-to) with the owner's PRIVATE key and checks the plaintext against the sidecar hash.
#
#   infra/backup/decrypt-offhost.sh --key <recipient private key.pem> --in <name>.cms --out <name> [--allow-no-sidecar]
#
# The private key is the half that must NOT live on the pull path: fetch it from the password manager / offline medium for the minutes this takes and delete the copy afterwards.
# It is read by openssl only (never put on a command line as a value, never copied). The output is written 0600 to a temp file next to --out and renamed only after the
# plaintext sha256 equals the one in `<name>.cms.sha256`; on any failure nothing is left at --out.
# Exit codes: 0 ok, 1 decryption or hash failure, 2 usage.
set -euo pipefail
umask 077
KEY=""; IN=""; OUT=""; NOSIDE=0
while [ $# -gt 0 ]; do
  case "$1" in --key) KEY="${2:-}"; shift 2 ;; --in) IN="${2:-}"; shift 2 ;; --out) OUT="${2:-}"; shift 2 ;; --allow-no-sidecar) NOSIDE=1; shift ;; -h|--help) sed -n 2,10p "$0"; exit 0 ;; *) echo "unknown argument: $1" >&2; exit 2 ;; esac
done
[ -f "$KEY" ] && [ -f "$IN" ] && [ -n "$OUT" ] || { echo "usage: $0 --key PRIVATE.pem --in NAME.cms --out NAME" >&2; exit 2; }
grep -q 'PRIVATE KEY' "$KEY" || { echo "$KEY does not look like a private key" >&2; exit 2; }
[ ! -e "$OUT" ] || { echo "refusing to overwrite $OUT" >&2; exit 2; }
SIDE="$IN.sha256"
[ -f "$SIDE" ] || [ "$NOSIDE" = 1 ] || { echo "no $SIDE next to the ciphertext (pass --allow-no-sidecar to skip the hash check)" >&2; exit 2; }
TMP="$OUT.partial.$$"; trap 'rm -f "$TMP"' EXIT
openssl cms -decrypt -binary -inform DER -in "$IN" -inkey "$KEY" -out "$TMP" 2>/dev/null || { echo "decryption failed (wrong key, or the ciphertext is damaged)" >&2; exit 1; }
if [ -f "$SIDE" ]; then
  want="$(awk '{print $1}' "$SIDE")"
  got="$( (shasum -a 256 "$TMP" 2>/dev/null || sha256sum "$TMP") | awk '{print $1}')"
  [ "$got" = "$want" ] || { echo "plaintext sha256 differs from the sidecar: refusing" >&2; exit 1; }
fi
mv "$TMP" "$OUT"; trap - EXIT
echo "decrypted $(basename "$IN") -> $OUT"
