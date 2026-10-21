#!/usr/bin/env bash
# Renders /srv/aicc/shared/wp-config.php from wp-config.stage.template.php ON THE HOST. Secrets come from 0600 files; none is printed.
#     sudo infra/provision/render-wp-config.sh [--dry-run] [--force-salts]
# Inputs : /etc/aicc/secrets/db-cp.pass (written by create-staging-db.sh); /etc/aicc/secrets/wp-secrets.env (created here once: eight WordPress keys/salts and
#          two staging-only plugin secrets, 256-bit random each; reused on later runs so sessions survive a re-render; --force-salts regenerates them).
# Output : /srv/aicc/shared/wp-config.php, mode 0640, owner root:aicc-cp (PHP-FPM and WP-CLI run as aicc-cp: read, cannot modify), `php -l` checked before it replaces
#          the old file (atomic rename). Idempotent: identical input gives an identical file ("unchanged").
# Test seams: --template --out --secrets-dir (absolute paths) for tests; defaults are the host paths.
set -euo pipefail
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF/lib/common.sh"
TEMPLATE="$SELF/wp-config.stage.template.php"; OUT="/srv/aicc/shared/wp-config.php"; SECRETS="/etc/aicc/secrets"; FORCE_SALTS=0
DB="aicc_cp"; DBUSER="aicc_cp"; OWNER="root:aicc-cp"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) AICC_DRY_RUN=1; shift ;;
    --force-salts) FORCE_SALTS=1; shift ;;
    --template) TEMPLATE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --secrets-dir) SECRETS="$2"; shift 2 ;;
    --owner) OWNER="$2"; shift 2 ;;
    -h|--help) sed -n 2,10p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ "$OUT" == /* && "$SECRETS" == /* && "$TEMPLATE" == /* ]] || die "paths must be absolute"
[ -r "$TEMPLATE" ] || die "template not readable: $TEMPLATE"
# The production template is a RECORD of required settings, not a usable template (architecture review B-3): refuse it by name and by its marker, before anything is read or written.
case "$(basename "$TEMPLATE")" in *production*) die "REFUSED: $TEMPLATE is the production template, which is NOT USABLE (record of required settings only); this script renders the STAGING wp-config." ;; esac
if grep -q "AICC_TEMPLATE_STATUS: NOT-USABLE" "$TEMPLATE" 2>/dev/null; then die "REFUSED: $TEMPLATE is marked AICC_TEMPLATE_STATUS: NOT-USABLE."; fi
if [ "${AICC_TEST_HARNESS:-0}" != "1" ] && [ "$(id -u)" != "0" ] && ! is_dry; then die "must run as root (sudo). Refusing."; fi
grep -Eq "define\( 'WP_HOME', 'https://stage\.copilt\.org' \)" "$TEMPLATE" || die "template is not the stage template (WP_HOME)"
if is_dry; then would "render $OUT from $TEMPLATE using secrets in $SECRETS (mode 0640 $OWNER); nothing printed"; exit 0; fi
umask 077
mkdir -p "$SECRETS"; chmod 700 "$SECRETS"
[ -s "$SECRETS/db-cp.pass" ] || die "$SECRETS/db-cp.pass missing: run create-staging-db.sh first"
ENVF="$SECRETS/wp-secrets.env"
if [ ! -s "$ENVF" ] || [ "$FORCE_SALTS" = 1 ]; then
  { for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT AICC_ACTIVATION_PROOF_SECRET AICC_ENTITLEMENT_WEBHOOK_SECRET; do
      printf '%s=%s\n' "$k" "$(openssl rand -hex 32)"; done; } > "$ENVF.new"
  chmod 600 "$ENVF.new"; mv -f "$ENVF.new" "$ENVF"; info "generated $ENVF (0600)"
fi
tmp="$(mktemp "$(dirname "$OUT")/.wpcfg.XXXXXX" 2>/dev/null || mktemp)"
trap 'rm -f "$tmp"' EXIT
python3 -I - "$TEMPLATE" "$ENVF" "$SECRETS/db-cp.pass" "$DB" "$DBUSER" > "$tmp" <<'PY'
import re, sys
tpl, envf, passf, db, dbuser = sys.argv[1:6]
s = open(tpl).read()
env = {}
for line in open(envf):
    line = line.strip()
    if line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k] = v
pw = open(passf).read().strip()
for name, val in (("DB_PASSWORD", pw), ("DB_NAME", db), ("DB_USER", dbuser)):
    assert re.fullmatch(r"[A-Za-z0-9_]+", val), name   # nothing that needs PHP escaping
    s = s.replace("@@%s@@" % name, val)
salts = "\n".join("define( '%s', '%s' );" % (k, env[k]) for k in ("AUTH_KEY","SECURE_AUTH_KEY","LOGGED_IN_KEY","NONCE_KEY","AUTH_SALT","SECURE_AUTH_SALT","LOGGED_IN_SALT","NONCE_SALT"))
s = s.replace("@@SALTS@@", salts)
for k in ("AICC_ACTIVATION_PROOF_SECRET", "AICC_ENTITLEMENT_WEBHOOK_SECRET"):
    assert re.fullmatch(r"[0-9a-f]{64}", env[k])
    s = s.replace("@@%s@@" % k, env[k])
left = re.findall(r"@@[A-Z_]+@@", s)
if left: sys.exit("unreplaced placeholders: %s" % ", ".join(sorted(set(left))))
sys.stdout.write(s)
PY
if command -v php >/dev/null 2>&1; then php -l "$tmp" >/dev/null || die "rendered wp-config.php has a PHP syntax error: not installed"; else warn "php not found: syntax check skipped"; fi
if [ -f "$OUT" ] && cmp -s "$tmp" "$OUT"; then info "unchanged: $OUT"; exit 0; fi
mkdir -p "$(dirname "$OUT")"
chmod 640 "$tmp"; [ "${AICC_TEST_HARNESS:-0}" = "1" ] || chown "$OWNER" "$tmp"
mv -f "$tmp" "$OUT"; trap - EXIT
info "wrote $OUT (0640 $OWNER); secrets not printed"
