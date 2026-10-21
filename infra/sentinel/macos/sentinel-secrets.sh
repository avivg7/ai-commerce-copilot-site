#!/usr/bin/env bash
# Create, check or remove the Telegram secrets file for the AICC Sentinel:  ~/.config/aicc-sentinel/secrets.env  (mode 0600, directory 0700).
#
#   sentinel-secrets.sh            interactive: two SILENT prompts (nothing echoed, nothing on the command line, nothing in shell history)
#   sentinel-secrets.sh --check    verify the file exists, is 0600 and has both keys; prints NO values
#   sentinel-secrets.sh --remove   delete the file (Telegram is then disabled; events go to the log / macOS notifications)
#
# The file format is exactly what sentinel.py loads:  TELEGRAM_BOT_TOKEN=...  and  TELEGRAM_CHAT_ID=... one per line.
# sentinel.py ignores a secrets file that is readable by group/other, so the mode matters. The values are written with a shell builtin (printf), never as
# arguments of an external program, and are never printed. Refuses to run as root.
#
# Tests only: `--stdin` (together with AICC_SENTINEL_SECRETS_TEST=1) reads the two values from stdin lines instead of the terminal. Do not use it by hand:
# piping a secret from another command puts it where the silent prompt is meant to keep it out.
set -euo pipefail

die() { echo "sentinel-secrets: $*" >&2; exit 1; }
usage() { sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

mode=set use_stdin=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check) mode=check ;;
    --remove) mode=remove ;;
    --stdin) use_stdin=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument (secrets are never accepted as arguments; run it without arguments and type them at the silent prompts)" ;;
  esac
  shift
done

[ "$(id -u)" -ne 0 ] || die "refusing to run as root"
[ -n "${HOME:-}" ] && [ -d "$HOME" ] || die "HOME is not set to a directory"
DIR="$HOME/.config/aicc-sentinel"
FILE="$DIR/secrets.env"

file_mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }

case "$mode" in
  remove)
    if [ -e "$FILE" ]; then rm -f "$FILE"; echo "removed $FILE (Telegram is now disabled for the sentinel)"; else echo "no secrets file at $FILE"; fi
    exit 0 ;;
  check)
    [ -f "$FILE" ] || { echo "MISSING: $FILE (Telegram disabled)"; exit 1; }
    m="$(file_mode "$FILE")"
    [ "$m" = "600" ] || { echo "BAD MODE $m on $FILE: sentinel.py will IGNORE it. Fix: chmod 600 \"$FILE\""; exit 1; }
    grep -q '^TELEGRAM_BOT_TOKEN=.\{10,\}' "$FILE" || { echo "TELEGRAM_BOT_TOKEN missing or too short in $FILE"; exit 1; }
    grep -q '^TELEGRAM_CHAT_ID=.\{3,\}' "$FILE" || { echo "TELEGRAM_CHAT_ID missing or too short in $FILE"; exit 1; }
    echo "OK: $FILE is 0600 and has TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (values not shown)"
    exit 0 ;;
esac

if [ "$use_stdin" -eq 1 ]; then
  [ "${AICC_SENTINEL_SECRETS_TEST:-}" = "1" ] || die "--stdin is for tests only (needs AICC_SENTINEL_SECRETS_TEST=1)"
else
  [ -t 0 ] || die "stdin is not a terminal: run this in a Terminal window (the prompts are silent)"
fi

token="" chat=""
if [ "$use_stdin" -eq 1 ]; then
  IFS= read -r token || true
  IFS= read -r chat || true
else
  printf 'Telegram bot token (input hidden): ' >&2
  IFS= read -rs token || true
  printf '\n' >&2
  printf 'Telegram chat id (input hidden; a number, may start with -): ' >&2
  IFS= read -rs chat || true
  printf '\n' >&2
fi

# Validate the shape without ever printing a value. Token: <digits>:<35-ish url-safe chars>. Chat: integer, or @channelname.
[[ "$token" =~ ^[0-9]{6,}:[A-Za-z0-9_-]{20,}$ ]] || { token=""; chat=""; die "that does not look like a Telegram bot token (expected 123456789:AA...); nothing written"; }
[[ "$chat" =~ ^(-?[0-9]{1,20}|@[A-Za-z0-9_]{5,32})$ ]] || { token=""; chat=""; die "that does not look like a chat id (an integer such as 123456789 or -1001234567890, or @channelname); nothing written"; }

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"
tmp="$(mktemp "$DIR/.secrets.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_CHAT_ID=%s\n' "$token" "$chat" > "$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$FILE"
trap - EXIT
token="" chat=""
echo "wrote $FILE (0600, atomically). Values were not echoed."
echo "Next: send a test message with   python3.12 <sentinel.py> --config <targets.toml> --test-notify"
