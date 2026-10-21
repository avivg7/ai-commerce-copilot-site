#!/usr/bin/env bash
# Renders /srv/aicc/shared/wp-config.php ON THE HOST from the template of the chosen environment. Secrets come from 0600 files; none is printed.
#     sudo infra/provision/render-wp-config.sh [--env stage] [--dry-run] [--force-salts]
#     sudo infra/provision/render-wp-config.sh --env production --confirm-production [--dry-run]     (production host only, see below)
# --env stage (default) uses wp-config.stage.template.php and runs only on a host whose /etc/aicc-stage-identity says AICC_ENV=staging.
# --env production uses wp-config.production.template.php and is refused unless ALL of: the host identity says AICC_ENV=production; --confirm-production is given;
#   /etc/aicc/secrets/entitlement-webhook.secret and activation-proof.secret exist (0600, >= 32 characters; placed by the OWNER, they are never generated because
#   the webhook secret must equal the Backend's); the database password file exists. Nothing in this repository runs it for production.
# Inputs : /etc/aicc/secrets/db-cp.pass (written by create-staging-db.sh); /etc/aicc/secrets/wp-secrets.env (created here once: eight WordPress keys/salts and
#          two staging-only plugin secrets, 256-bit random each; reused on later runs so sessions survive a re-render; --force-salts regenerates them).
# Output : /srv/aicc/shared/wp-config.php, mode 0640, owner root:aicc-cp (PHP-FPM and WP-CLI run as aicc-cp: read, cannot modify), `php -l` checked before it replaces
#          the old file (atomic rename). Idempotent: identical input gives an identical file ("unchanged").
# Test seams: --template --out --secrets-dir (absolute paths) for tests; defaults are the host paths.
set -euo pipefail
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF/lib/common.sh"
TEMPLATE=""; ENVN="stage"; CONFIRM=0; OUT="/srv/aicc/shared/wp-config.php"; SECRETS="/etc/aicc/secrets"; FORCE_SALTS=0
DB="aicc_cp"; DBUSER="aicc_cp"; OWNER="root:aicc-cp"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) AICC_DRY_RUN=1; shift ;;
    --force-salts) FORCE_SALTS=1; shift ;;
    --env) ENVN="${2:-}"; shift 2 ;;
    --confirm-production) CONFIRM=1; shift ;;
    --template) TEMPLATE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --secrets-dir) SECRETS="$2"; shift 2 ;;
    --owner) OWNER="$2"; shift 2 ;;
    -h|--help) sed -n 2,10p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
case "$ENVN" in stage|production) ;; *) die "--env must be stage or production" ;; esac
[ -n "$TEMPLATE" ] || TEMPLATE="$SELF/wp-config.$ENVN.template.php"
[[ "$OUT" == /* && "$SECRETS" == /* && "$TEMPLATE" == /* ]] || die "paths must be absolute"
[ -r "$TEMPLATE" ] || die "template not readable: $TEMPLATE"
# The template must belong to the environment asked for (a stage template can never become a production config and the other way round).
if [ "$ENVN" = production ]; then
  grep -q "AICC_TEMPLATE: production" "$TEMPLATE" || die "REFUSED: $TEMPLATE is not the production template (no 'AICC_TEMPLATE: production' marker)"
  grep -Eq "define\( 'WP_HOME', 'https://www\.copilt\.org' \)" "$TEMPLATE" || die "REFUSED: the production template does not name https://www.copilt.org"
  ! grep -Eq "stage\.copilt\.org" <(sed -e 's#/\*.*\*/##' "$TEMPLATE" | grep -v '^[[:space:]]*\(//\|\*\)') || die "REFUSED: the production template carries the staging host"
  [ "$CONFIRM" = 1 ] || die "REFUSED: --env production needs --confirm-production (this writes the PRODUCTION configuration)"
  if [ "${AICC_TEST_HARNESS:-0}" != "1" ] && ! is_dry; then
    grep -q '^AICC_ENV=production$' /etc/aicc-stage-identity 2>/dev/null || die "REFUSED: this host's identity does not say AICC_ENV=production (a staging host can never receive the production configuration)"
  fi
else
  case "$(basename "$TEMPLATE")" in *production*) die "REFUSED: $TEMPLATE is the production template: use --env production on the production host." ;; esac
  grep -Eq "define\( 'WP_HOME', 'https://stage\.copilt\.org' \)" "$TEMPLATE" || die "template is not the stage template (WP_HOME)"
  if [ "${AICC_TEST_HARNESS:-0}" != "1" ] && ! is_dry; then
    grep -q '^AICC_ENV=staging$' /etc/aicc-stage-identity 2>/dev/null || die "REFUSED: this host's identity does not say AICC_ENV=staging (use --env production on the production host)"
  fi
fi
if [ "${AICC_TEST_HARNESS:-0}" != "1" ] && [ "$(id -u)" != "0" ] && ! is_dry; then die "must run as root (sudo). Refusing."; fi
if is_dry; then would "render $OUT from $TEMPLATE using secrets in $SECRETS (mode 0640 $OWNER); nothing printed"; exit 0; fi
if [ "$ENVN" = production ]; then
  for f in entitlement-webhook.secret activation-proof.secret; do
    [ -s "$SECRETS/$f" ] || die "REFUSED: $SECRETS/$f is missing: the OWNER places it (0600); it is never generated for production"
    m="$(stat -c '%a' "$SECRETS/$f" 2>/dev/null || stat -f '%Lp' "$SECRETS/$f")"
    case "$m" in 600|400) ;; *) die "REFUSED: $SECRETS/$f must be mode 0600 (is $m)" ;; esac
  done
fi
umask 077
mkdir -p "$SECRETS"; chmod 700 "$SECRETS"
[ -s "$SECRETS/db-cp.pass" ] || die "$SECRETS/db-cp.pass missing: run create-staging-db.sh first"
ENVF="$SECRETS/wp-secrets.env"
if [ ! -s "$ENVF" ] || [ "$FORCE_SALTS" = 1 ]; then
  { for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT $([ "$ENVN" = stage ] && echo "AICC_ACTIVATION_PROOF_SECRET AICC_ENTITLEMENT_WEBHOOK_SECRET"); do
      printf '%s=%s\n' "$k" "$(openssl rand -hex 32)"; done; } > "$ENVF.new"
  chmod 600 "$ENVF.new"; mv -f "$ENVF.new" "$ENVF"; info "generated $ENVF (0600)"
fi
tmp="$(mktemp "$(dirname "$OUT")/.wpcfg.XXXXXX" 2>/dev/null || mktemp)"
trap 'rm -f "$tmp"' EXIT
python3 -I - "$TEMPLATE" "$ENVF" "$SECRETS/db-cp.pass" "$DB" "$DBUSER" "$ENVN" "$SECRETS" > "$tmp" <<'PY'
import re, sys
tpl, envf, passf, db, dbuser, envn, secdir = sys.argv[1:8]
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
for k, fname in (("AICC_ACTIVATION_PROOF_SECRET", "activation-proof.secret"), ("AICC_ENTITLEMENT_WEBHOOK_SECRET", "entitlement-webhook.secret")):
    if envn == "production":
        # owner-provided, never generated here (the webhook secret must equal the Backend's); must be a string PHP can hold in single quotes without escaping
        try:
            v = open("%s/%s" % (secdir, fname)).read().strip()
        except OSError:
            sys.exit("REFUSED: %s/%s is missing (the owner places it; it is never generated)" % (secdir, fname))
        if not re.fullmatch(r"[A-Za-z0-9._~+/=-]{32,}", v):
            sys.exit("REFUSED: %s must be at least 32 characters from [A-Za-z0-9._~+/=-]" % fname)
    else:
        v = env[k]
        assert re.fullmatch(r"[0-9a-f]{64}", v)
    s = s.replace("@@%s@@" % k, v)
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
