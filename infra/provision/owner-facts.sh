#!/usr/bin/env bash
# Sets, unsets and lists the owner's NON-SECRET launch facts that render-wp-config.sh writes into the Control Plane's wp-config.php.
#     sudo aicc-owner-facts list
#     sudo aicc-owner-facts set   KEY VALUE        (validated; the file is replaced atomically, mode 0600, root)
#     sudo aicc-owner-facts unset KEY
#     sudo aicc-owner-facts check                  (validates the whole file, changes nothing)
#     sudo aicc-owner-facts keys                   (the keys this host's environment accepts)
#   then apply:  sudo aicc-render-wp-config --env production --confirm-production      (staging: --env stage)
# The file is /etc/aicc/owner-facts.env (--file for tests). The environment comes from the host identity (/etc/aicc-stage-identity: AICC_ENV=production|staging), or --env for tests. It holds facts, never secrets;
# the shared secrets stay in /etc/aicc/secrets. This tool never touches wp-config.php: only the renderer does, so a value you set is applied only by an explicit re-render and is never lost by one.
# Values are checked by lib/owner_facts.py (one validator shared with the renderer): free text may not contain control characters, '<', '>' or '@@'; apostrophes and backslashes are kept and escaped.
set -euo pipefail
self="${BASH_SOURCE[0]}"; while [ -L "$self" ]; do d="$(cd "$(dirname "$self")" && pwd)"; self="$(readlink "$self")"; case "$self" in /*) ;; *) self="$d/$self";; esac; done
SELF="$(cd "$(dirname "$self")" && pwd)"
FILE="/etc/aicc/owner-facts.env"; ENVN=""; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="$2"; shift 2 ;;
    --env) ENVN="$2"; shift 2 ;;
    -h|--help) sed -n 2,11p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
[ "${#ARGS[@]}" -ge 1 ] || { sed -n 2,11p "${BASH_SOURCE[0]}" >&2; exit 2; }
CMD="${ARGS[0]}"
case "$CMD" in list|check|keys|set|unset) ;; *) echo "unknown command: $CMD (list, check, keys, set, unset)" >&2; exit 2 ;; esac
[[ "$FILE" == /* ]] || { echo "--file must be absolute" >&2; exit 2; }
if [ -z "$ENVN" ]; then
  case "$(sed -n 's/^AICC_ENV=//p' /etc/aicc-stage-identity 2>/dev/null | head -1)" in
    production) ENVN=production ;; staging) ENVN=stage ;;
    *) echo "REFUSED: this host's identity (/etc/aicc-stage-identity) does not say AICC_ENV=production or staging" >&2; exit 1 ;;
  esac
fi
case "$ENVN" in stage|production) ;; *) echo "--env must be stage or production" >&2; exit 2 ;; esac
if [ "${AICC_TEST_HARNESS:-0}" != "1" ] && [ "$(id -u)" != "0" ] && [ "$CMD" != keys ]; then echo "must run as root (sudo). Refusing." >&2; exit 1; fi
if [ "$CMD" = set ] || [ "$CMD" = unset ]; then
  umask 077
  [ -d "$(dirname "$FILE")" ] || { echo "REFUSED: $(dirname "$FILE") does not exist" >&2; exit 1; }
  if [ -L "$FILE" ]; then echo "REFUSED: $FILE is a symbolic link" >&2; exit 1; fi
fi
exec python3 -I "$SELF/lib/owner_facts.py" --file "$FILE" --env "$ENVN" -- "$CMD" "${ARGS[@]:1}"
