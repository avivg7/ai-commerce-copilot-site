#!/usr/bin/env bash
# Renders /srv/aicc/shared/wp-config.php ON THE HOST from the template of the chosen environment. Secrets come from 0600 files; none is printed.
#     sudo infra/provision/render-wp-config.sh [--env stage] [--dry-run] [--force-salts]
#     sudo infra/provision/render-wp-config.sh --env production --confirm-production [--dry-run]     (production host only, see below)
# --env stage (default) uses wp-config.stage.template.php and runs only on a host whose /etc/aicc-stage-identity says AICC_ENV=staging.
# --env production uses wp-config.production.template.php and is refused unless ALL of: the host identity says AICC_ENV=production; --confirm-production is given;
#   /etc/aicc/secrets/entitlement-webhook.secret and activation-proof.secret exist (0600, >= 32 characters; placed by the OWNER, they are never generated because
#   the webhook secret must equal the Backend's); the database password file exists. promote-to-production.sh runs it; nothing else does.
# MAIL (production only; the file lives in /etc/aicc-mail because the PHP user cannot traverse /etc/aicc): the template's AICC_MAIL_* region (the Control Plane's SMTP layer) is kept ONLY when /etc/aicc-mail/smtp.env exists AND is safe: a regular file, owned by root,
#   group aicc-cp, mode 0640 or 0600 or 0440 (nothing for "other", nothing writable by the group), exactly the two keys AICC_MAIL_SMTP_USER and AICC_MAIL_SMTP_PASS with non-empty values and no
#   quote/newline/space in them. A file that exists but is unsafe makes the renderer REFUSE (nothing written); an absent file removes the region (production sends no mail). The stage render never
#   contains the region (staging keeps the mail sink). The values are never printed.
# OWNER FACTS (both environments; the owner-facts region): non-secret launch facts (AICC_ACTIVATION_PROOF_KID, AICC_LEGAL_*, AICC_LM_PAID_GATEWAYS, AICC_LAUNCH_REAL_GATEWAYS, extra outbound gateway host) are read from the
#   root-only file /etc/aicc/owner-facts.env (mode 0600 or 0400, a regular file, root:root; default = next to the secrets directory, --owner-facts-file for tests). The renderer NEVER writes that file, so a re-render can never
#   lose a value; `aicc-owner-facts set|unset|list` edits it. Every value is validated (lib/owner_facts.py) and written as an escaped PHP literal. A file that exists but is unsafe or invalid makes the renderer REFUSE (nothing
#   written); an absent file or an empty one renders exactly what an unset file always rendered, byte for byte. Production allows every key; staging only the proof key id, the paid-gateway list, the strict-mode switch and the extra host.
# P37 SELF-SERVICE (production only; docs/cutover/p37-self-service-wp-config.md): the delimited P37 region of the template (Trial signup switch + cap, Turnstile site key, notification switch and excluded accounts, mail caps, funnel counters, owner-dashboard
#   section, milestone sync, plan change, payment reconcile, privacy requests) is rendered from the SAME owner-facts file (new keys, listed by `aicc-owner-facts keys`) and from ONE secret FILE, /etc/aicc-mail/turnstile.secret (regular file, not a symlink, root:aicc-cp,
#   mode 0640 or 0440, in the 0750 root:aicc-cp directory of smtp.env, first line = the Turnstile secret: the renderer checks it exactly as the Control Plane reads it and NEVER prints, copies or renders it; only the constant AICC_TURNSTILE_SECRET_FILE with its path is
#   written). With no P37 fact and no such file the region is removed and the render is byte-identical to the render before P37. An unsafe/invalid secret file, or an inconsistent set (self-service without cap, Turnstile key + file, Turnstile host, mail enabled and
#   the notification switch; notification switch or mail caps without mail; ...) REFUSES: nothing is written. Staging never carries the region.
# P38 BREVO API MAIL (production only; docs/cutover/p38-brevo-host-update.md): the delimited P38 region of the template (AICC_MAIL_ENABLED, AICC_MAIL_PROVIDER=brevo_api, the PATH of the key file, sender, reply-to, daily budget, optional test recipients and status poll) is rendered
#   ONLY when the owner fact AICC_MAIL_PROVIDER=brevo_api is set AND /etc/aicc-mail/brevo-api.key exists and is safe (regular file, not a symlink, root:aicc-cp, mode 0640 or 0440, in the 0750 root:aicc-cp directory, 20-256 bytes, exactly one line that matches the
#   Control Plane's key pattern [A-Za-z0-9_-]{20,200}, not an SMTP key). The key file is judged by `owner_facts.py check-brevo-key` (python, never a shell variable, so no `bash -x` trace can hold it): its content is never printed, copied or rendered; only the constant
#   AICC_MAIL_API_KEY_FILE with the path is written. api.brevo.com is appended to WP_ACCESSIBLE_HOSTS in the same condition and never otherwise. A key file that exists but is unsafe REFUSES. The provider fact without the key file renders NO mail (a warning, not a half-enabled
#   state). Both smtp.env and the key file without the provider fact REFUSES (the explicit fact decides). With no P38 fact and no key file the render is byte-identical to the render before P38. `--compare` renders to a temporary file and reports whether it equals the
#   current output (constant NAMES that differ, never a value; exit 0 identical, 4 different); it writes nothing.
# Inputs : /etc/aicc/secrets/db-cp.pass (written by create-staging-db.sh); /etc/aicc/secrets/wp-secrets.env (created here once: eight WordPress keys/salts and
#          two staging-only plugin secrets, 256-bit random each; reused on later runs so sessions survive a re-render; --force-salts regenerates them).
# Output : /srv/aicc/shared/wp-config.php, mode 0640, owner root:aicc-cp (PHP-FPM and WP-CLI run as aicc-cp: read, cannot modify), `php -l` checked (when php is installed; otherwise a warning) before it replaces
#          the old file (atomic rename). Idempotent: identical input gives an identical file ("unchanged").
# Test seams: --template --out --secrets-dir (absolute paths) for tests; defaults are the host paths.
set -euo pipefail
# SELF = the real directory of this script even when called through the /usr/local/sbin/aicc-render-wp-config symlink (lib/ and the templates live next to the real file)
self="${BASH_SOURCE[0]}"; while [ -L "$self" ]; do d="$(cd "$(dirname "$self")" && pwd)"; self="$(readlink "$self")"; case "$self" in /*) ;; *) self="$d/$self";; esac; done
SELF="$(cd "$(dirname "$self")" && pwd)"
. "$SELF/lib/common.sh"
TEMPLATE=""; ENVN="stage"; CONFIRM=0; OUT="/srv/aicc/shared/wp-config.php"; SECRETS="/etc/aicc/secrets"; FORCE_SALTS=0; COMPARE=0
DB="aicc_cp"; DBUSER="aicc_cp"; OWNER="root:aicc-cp"; MAILDIR="/etc/aicc-mail"; RELDIR="/srv/aicc/shared/plugin-releases"; OWNERF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) AICC_DRY_RUN=1; shift ;;
    --force-salts) FORCE_SALTS=1; shift ;;
    --compare) COMPARE=1; shift ;;
    --env) ENVN="${2:-}"; shift 2 ;;
    --confirm-production) CONFIRM=1; shift ;;
    --template) TEMPLATE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --secrets-dir) SECRETS="$2"; shift 2 ;;
    --mail-dir) MAILDIR="$2"; shift 2 ;;
    --plugin-release-dir) RELDIR="$2"; shift 2 ;;
    --owner-facts-file) OWNERF="$2"; shift 2 ;;
    --owner) OWNER="$2"; shift 2 ;;
    -h|--help) sed -n 2,10p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
case "$ENVN" in stage|production) ;; *) die "--env must be stage or production" ;; esac
[ -n "$TEMPLATE" ] || TEMPLATE="$SELF/wp-config.$ENVN.template.php"
[ -n "$OWNERF" ] || OWNERF="$(dirname "$SECRETS")/owner-facts.env"
[[ "$OUT" == /* && "$SECRETS" == /* && "$TEMPLATE" == /* && "$OWNERF" == /* ]] || die "paths must be absolute"
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
MAIL=0
if [ "$ENVN" = production ] && [ -e "$MAILDIR/smtp.env" ]; then
  SM="$MAILDIR/smtp.env"
  [[ "$MAILDIR" == /* ]] || die "--mail-dir must be absolute"
  [ -f "$SM" ] && [ ! -L "$SM" ] || die "REFUSED: $SM is not a regular file"
  smm="$(stat -c '%a' "$SM" 2>/dev/null || stat -f '%Lp' "$SM")"
  case "$smm" in 640|600|440) ;; *) die "REFUSED: $SM must be mode 0640 (is $smm): the mail credentials may be read by root and the aicc-cp group only" ;; esac
  if [ "${AICC_TEST_HARNESS:-0}" != "1" ]; then
    [ "$(stat -c '%U:%G %a' "$MAILDIR")" = "root:aicc-cp 750" ] || die "REFUSED: $MAILDIR must be root:aicc-cp 0750 (is $(stat -c '%U:%G %a' "$MAILDIR"))"
    [ "$(stat -c '%U:%G' "$SM")" = "root:aicc-cp" ] || die "REFUSED: $SM must be owned root:aicc-cp (is $(stat -c '%U:%G' "$SM")): PHP-FPM runs as aicc-cp and the file must not be writable by it"
  fi
  python3 -I - "$SM" <<'PY' || die "REFUSED: $SM must hold exactly AICC_MAIL_SMTP_USER and AICC_MAIL_SMTP_PASS, both non-empty, without spaces or quotes"
import re, sys
keys = {}
for line in open(sys.argv[1]):
    line = line.rstrip("\n")
    if not line.strip() or line.lstrip().startswith("#"): continue
    m = re.fullmatch(r"(AICC_MAIL_SMTP_USER|AICC_MAIL_SMTP_PASS)=([^\s'\"\\]+)", line)
    if not m or m.group(1) in keys: sys.exit(1)
    keys[m.group(1)] = m.group(2)
sys.exit(0 if set(keys) == {"AICC_MAIL_SMTP_USER", "AICC_MAIL_SMTP_PASS"} else 1)
PY
  MAIL=1
fi
# TURNSTILE SECRET FILE (P37, production only): absent = no AICC_TURNSTILE_SECRET_FILE constant. Present = must be a regular file, not a symlink, mode 0640 or 0440 (the PHP user, group aicc-cp, must be able to READ it: 0600 root would not be
# readable by PHP, so it is refused instead of silently failing at the first signup; nothing for "other", nothing writable by the group), owned root:aicc-cp in the 0750 root:aicc-cp directory, and readable as the Control Plane reads it. Its content is never printed.
TS=0; TSF="$MAILDIR/turnstile.secret"
if [ "$ENVN" = production ] && { [ -e "$TSF" ] || [ -L "$TSF" ]; }; then
  [ -f "$TSF" ] && [ ! -L "$TSF" ] || die "REFUSED: $TSF is not a regular file"
  tsm="$(stat -c '%a' "$TSF" 2>/dev/null || stat -f '%Lp' "$TSF")"
  case "$tsm" in 640|440) ;; *) die "REFUSED: $TSF must be mode 0640 (is $tsm): readable by root and the aicc-cp group (PHP) only, writable by nobody but root" ;; esac
  if [ "${AICC_TEST_HARNESS:-0}" != "1" ]; then
    [ "$(stat -c '%U:%G %a' "$MAILDIR")" = "root:aicc-cp 750" ] || die "REFUSED: $MAILDIR must be root:aicc-cp 0750 (is $(stat -c '%U:%G %a' "$MAILDIR"))"
    [ "$(stat -c '%U:%G' "$TSF")" = "root:aicc-cp" ] || die "REFUSED: $TSF must be owned root:aicc-cp (is $(stat -c '%U:%G' "$TSF")): PHP-FPM runs as aicc-cp and must not be able to change it"
  fi
  tsout="$(python3 -I "$SELF/lib/owner_facts.py" check-turnstile-secret --file "$TSF" --env "$ENVN" 2>&1)" || die "REFUSED: ${tsout#REFUSED: }"
  TS=1
fi
# BREVO API KEY FILE (P38, production only): absent = no Brevo region. Present = regular file, not a symlink, mode 0640 or 0440 (PHP, group aicc-cp, must be able to READ it; nothing for "other", nothing writable by the group), owned root:aicc-cp in the
# 0750 root:aicc-cp directory, and shaped as the Control Plane reads it (owner_facts.py check-brevo-key: python reads the file; the key is never in a shell variable, a trace, an argument or an output). An existing but unsafe file REFUSES, whatever the facts say.
XT=0; case "$-" in *x*) XT=1; set +x ;; esac     # `bash -x` is paused around the key file (it is never in a shell variable, so nothing could leak; the pause is belt and braces) and resumed right after
BK=0; BKF="$MAILDIR/brevo-api.key"
if [ "$ENVN" = production ] && { [ -e "$BKF" ] || [ -L "$BKF" ]; }; then
  [ -f "$BKF" ] && [ ! -L "$BKF" ] || die "REFUSED: $BKF is not a regular file"
  bkm="$(stat -c '%a' "$BKF" 2>/dev/null || stat -f '%Lp' "$BKF")"
  case "$bkm" in 640|440) ;; *) die "REFUSED: $BKF must be mode 0640 (is $bkm): readable by root and the aicc-cp group (PHP) only, writable by nobody but root" ;; esac
  if [ "${AICC_TEST_HARNESS:-0}" != "1" ]; then
    [ "$(stat -c '%U:%G %a' "$MAILDIR")" = "root:aicc-cp 750" ] || die "REFUSED: $MAILDIR must be root:aicc-cp 0750 (is $(stat -c '%U:%G %a' "$MAILDIR"))"
    [ "$(stat -c '%U:%G' "$BKF")" = "root:aicc-cp" ] || die "REFUSED: $BKF must be owned root:aicc-cp (is $(stat -c '%U:%G' "$BKF")): PHP-FPM runs as aicc-cp and must not be able to change it"
  fi
  bkout="$(python3 -I "$SELF/lib/owner_facts.py" check-brevo-key --file "$BKF" --env "$ENVN" 2>&1)" || die "REFUSED: ${bkout#REFUSED: }"
  BK=1
fi
[ "$XT" = 0 ] || set -x
# OWNER FACTS: absent = nothing to render. Present = must be a regular root-owned file nobody else can read or write, and every value must validate for this environment.
NFACTS=0
if [ -e "$OWNERF" ] || [ -L "$OWNERF" ]; then
  [ -f "$OWNERF" ] && [ ! -L "$OWNERF" ] || die "REFUSED: $OWNERF is not a regular file"
  ofm="$(stat -c '%a' "$OWNERF" 2>/dev/null || stat -f '%Lp' "$OWNERF")"
  case "$ofm" in 600|400) ;; *) die "REFUSED: $OWNERF must be mode 0600 (is $ofm)" ;; esac
  if [ "${AICC_TEST_HARNESS:-0}" != "1" ]; then
    [ "$(stat -c '%U:%G' "$OWNERF")" = "root:root" ] || die "REFUSED: $OWNERF must be owned root:root (is $(stat -c '%U:%G' "$OWNERF")): PHP-FPM runs as aicc-cp and must not be able to change what the renderer will write"
  fi
  ofctx=(); [ "$ENVN" != production ] || { ofctx=(--context); [ "$MAIL" != 1 ] || ofctx+=(--mail-ready); [ "$BK" != 1 ] || ofctx+=(--brevo-key-ready); [ "$TS" != 1 ] || ofctx+=(--turnstile-secret-file "$TSF"); }
  ofout="$(python3 -I "$SELF/lib/owner_facts.py" check --file "$OWNERF" --env "$ENVN" ${ofctx[@]+"${ofctx[@]}"} 2>&1)" || die "REFUSED: $OWNERF: ${ofout#REFUSED: }"
  NFACTS="$(printf '%s' "$ofout" | sed -n 's/^ok: \([0-9][0-9]*\) value.*/\1/p')"
fi
# WHICH MAIL TRANSPORT (P38): the explicit fact AICC_MAIL_PROVIDER decides when both secret files exist; computed once, by the same function the renderer's python uses. none | smtp | brevo_api. A contradiction REFUSES here, before anything is written.
MAILMODE=none
if [ "$ENVN" = production ]; then
  mmflags=(); [ "$MAIL" != 1 ] || mmflags+=(--mail-ready); [ "$BK" != 1 ] || mmflags+=(--brevo-key-ready)
  mmerr="$(mktemp)"; mmout="$(python3 -I "$SELF/lib/owner_facts.py" mail-mode --file "$OWNERF" --env "$ENVN" ${mmflags[@]+"${mmflags[@]}"} 2>"$mmerr")" || { mmtxt="$(cat "$mmerr")"; rm -f "$mmerr"; die "REFUSED: owner facts: ${mmtxt#REFUSED: }"; }
  while IFS= read -r l; do [ -z "$l" ] || warn "${l#NOTE: }"; done < "$mmerr"; rm -f "$mmerr"
  MAILMODE="$mmout"
  case "$MAILMODE" in none|smtp|brevo_api) ;; *) die "REFUSED: unexpected mail mode '$MAILMODE'" ;; esac
fi
# AICC_COMMERCE_OPEN (pre-commercial truth round): commerce opens only with a working account flow, and every account e-mail (password link, receipt) needs the mail layer. Production without a safe smtp.env sends NO mail, so
# a facts file that opens commerce cannot be rendered into it. (The Control Plane launch gate checks the mail transport too; this is the lock at the door that cannot be forgotten.)
if [ "$ENVN" = production ] && [ "$NFACTS" -gt 0 ] && python3 -I "$SELF/lib/owner_facts.py" list --file "$OWNERF" --env "$ENVN" 2>/dev/null | grep -q '^AICC_COMMERCE_OPEN='; then
  [ "$MAILMODE" != none ] || die "REFUSED: $OWNERF sets AICC_COMMERCE_OPEN but the mail layer is not enabled (no safe /etc/aicc-mail/smtp.env, no Brevo API key with AICC_MAIL_PROVIDER=brevo_api): customers could not receive their password link or receipt. Place the SMTP credentials first, or \`aicc-owner-facts unset AICC_COMMERCE_OPEN\`."
fi
if is_dry; then would "render $OUT from $TEMPLATE using secrets in $SECRETS (mode 0640 $OWNER); mail layer $([ "$MAILMODE" != none ] && echo "ENABLED (transport: $MAILMODE)" || echo "not enabled"); brevo api key file $([ "$BK" = 1 ] && echo "valid (path rendered only when AICC_MAIL_PROVIDER=brevo_api; content never read into the output)" || echo "absent"); turnstile secret file $([ "$TS" = 1 ] && echo "valid (constant rendered, content never read into the output)" || echo "absent"); owner facts: ${NFACTS} value(s) from $OWNERF; nothing printed"; exit 0; fi
if [ "$ENVN" = production ]; then
  for f in entitlement-webhook.secret activation-proof.secret; do
    [ -s "$SECRETS/$f" ] || die "REFUSED: $SECRETS/$f is missing: the OWNER places it (0600); it is never generated for production"
    m="$(stat -c '%a' "$SECRETS/$f" 2>/dev/null || stat -f '%Lp' "$SECRETS/$f")"
    case "$m" in 600|400) ;; *) die "REFUSED: $SECRETS/$f must be mode 0600 (is $m)" ;; esac
  done
fi
# The private Plugin release store the template points at (AICC_LM_PLUGIN_RELEASE_DIR): a missing or wrongly owned directory is a WARNING here (the install/promotion path creates it; the Control
# Plane launch gate 5g blocks launch until it holds a verified release), never a reason to refuse the render.
if [ ! -d "$RELDIR" ]; then warn "$RELDIR does not exist yet: the Plugin download will report 'not configured' until it is created (root:aicc-cp 0750; install-stack.sh / promote-to-production.sh create it)"
elif [ "${AICC_TEST_HARNESS:-0}" != "1" ] && [ "$(stat -c '%U:%G %a' "$RELDIR")" != "root:aicc-cp 750" ]; then warn "$RELDIR is $(stat -c '%U:%G %a' "$RELDIR"), expected root:aicc-cp 750"
elif [ "${AICC_TEST_HARNESS:-0}" = "1" ] && [ "$(stat -c '%a' "$RELDIR" 2>/dev/null || stat -f '%Lp' "$RELDIR")" != "750" ]; then warn "$RELDIR must be mode 750"; fi
umask 077
if [ "$COMPARE" != 1 ]; then mkdir -p "$SECRETS"; chmod 700 "$SECRETS"; fi
[ -s "$SECRETS/db-cp.pass" ] || die "$SECRETS/db-cp.pass missing: run create-staging-db.sh first"
ENVF="$SECRETS/wp-secrets.env"
if [ "$COMPARE" = 1 ] && { [ ! -s "$ENVF" ] || [ "$FORCE_SALTS" = 1 ]; }; then die "--compare writes nothing: $ENVF is missing (or --force-salts was given); run a normal render first"; fi
if [ ! -s "$ENVF" ] || [ "$FORCE_SALTS" = 1 ]; then
  { for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT $([ "$ENVN" = stage ] && echo "AICC_ACTIVATION_PROOF_SECRET AICC_ENTITLEMENT_WEBHOOK_SECRET"); do
      printf '%s=%s\n' "$k" "$(openssl rand -hex 32)"; done; } > "$ENVF.new"
  chmod 600 "$ENVF.new"; mv -f "$ENVF.new" "$ENVF"; info "generated $ENVF (0600)"
fi
# --compare writes a COMPLETE wp-config (secrets included) to a temp file: it lives in the 0700 secrets directory (never /tmp), mode 0600, removed by the trap, and a leftover of a killed run is swept at the next run
rm -f "$SECRETS"/.compare.* 2>/dev/null || true
if [ "$COMPARE" = 1 ]; then tmp="$(mktemp "$SECRETS/.compare.XXXXXX")"; chmod 600 "$tmp"; else tmp="$(mktemp "$(dirname "$OUT")/.wpcfg.XXXXXX" 2>/dev/null || mktemp)"; fi
trap 'rm -f "$tmp"' EXIT
python3 -I - "$TEMPLATE" "$ENVF" "$SECRETS/db-cp.pass" "$DB" "$DBUSER" "$ENVN" "$SECRETS" "$MAIL" "$OWNERF" "$SELF/lib/owner_facts.py" "$TS" "$TSF" "$BK" > "$tmp" <<'PY'
import importlib.util, re, sys
tpl, envf, passf, db, dbuser, envn, secdir, mail, ownerf, ofpy, ts, tsf, bk = sys.argv[1:14]
s = open(tpl).read()
spec = importlib.util.spec_from_file_location("owner_facts", ofpy); of = importlib.util.module_from_spec(spec); spec.loader.exec_module(of)
# OWNER FACTS are parsed first: WHICH mail transport the render uses (smtp.env layer, Brevo API, none) is decided by the facts + the two verified secret files, by the one function the preflight check uses (owner_facts.mail_mode)
try:
    facts = of.parse_file(ownerf, envn)
    mctx = {"mail": mail == "1", "brevo_key": bk == "1", "turnstile_secret": ts == "1"}
    mailmode = of.mail_mode(facts, mctx)[0] if envn == "production" else "none"
except of.OwnerFactsError as e:
    sys.exit("REFUSED: owner facts: %s" % e)
# the mail region exists only in the production template; it is kept only when the SMTP layer is the transport (safe smtp.env AND no Brevo decision against it)
if "@@MAIL_BEGIN@@" in s:
    if envn != "production": sys.exit("REFUSED: a stage render may not carry the mail region")
    a = s.index("// @@MAIL_BEGIN@@"); b = s.index("// @@MAIL_END@@") + len("// @@MAIL_END@@\n")
    if mailmode == "smtp": mail_text = s[a:b].replace("// @@MAIL_BEGIN@@\n", "").replace("// @@MAIL_END@@\n", "")
    elif mailmode == "brevo_api": mail_text = "// (SMTP mail layer not rendered: AICC_MAIL_PROVIDER=brevo_api selects the Brevo API region below)\n"
    else: mail_text = "// (mail layer NOT enabled: /etc/aicc-mail/smtp.env is absent, production sends no mail until the owner places it and re-renders)\n"
    s = s[:a] + mail_text + s[b:]
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
        if not re.fullmatch(r"[A-Za-z0-9._~+/=-]{32,}", v) or len(set(v)) < 12:
            sys.exit("REFUSED: %s must be at least 32 characters from [A-Za-z0-9._~+/=-] with at least 12 distinct characters (not a placeholder)" % fname)
    else:
        v = env[k]
        assert re.fullmatch(r"[0-9a-f]{64}", v)
    s = s.replace("@@%s@@" % k, v)
# OWNER FACTS (after every other substitution: a validated value can contain neither '@@' nor markup, so it can never be re-interpreted as a placeholder)
try:
    region, extra_hosts = of.render(facts, envn)
except of.OwnerFactsError as e:
    sys.exit("REFUSED: owner facts: %s" % e)
RB, RE = "// @@OWNER_FACTS_BEGIN@@\n", "// @@OWNER_FACTS_END@@\n"
if RB in s:
    a = s.index(RB); b = s.index(RE) + len(RE)
    if s.count(RB) != 1 or s.count(RE) != 1 or b < a: sys.exit("REFUSED: the template's owner-facts region is malformed")
    body = s[a:b].replace(RB, "").replace(RE, "")
    s = s[:a] + (body.replace("@@OWNER_FACTS@@\n", "\n".join(region) + "\n") if region else "") + s[b:]
elif region:
    sys.exit("REFUSED: the template has no owner-facts region but the owner facts file sets values")
# P37 SELF-SERVICE region (production only): the consistency rules run HERE too with the verified host state, so nothing is written for an inconsistent set. The secret file is read only to compare it, in memory, with the public site key.
PB, PE = "// @@P37_BEGIN@@\n", "// @@P37_END@@\n"
if envn != "production":
    if PB in s: sys.exit("REFUSED: a stage render may not carry the P37 self-service region")
    p37 = []
else:
    try:
        if ts == "1" and facts.get("AICC_TURNSTILE_SITE_KEY") is not None and of.check_turnstile_secret_file(tsf) == facts["AICC_TURNSTILE_SITE_KEY"]:
            sys.exit("REFUSED: owner facts: AICC_TURNSTILE_SITE_KEY equals the Turnstile secret (the SECRET was entered as the site key). Nothing is rendered; unset the fact and rotate the secret in the Cloudflare dashboard")
        p37 = of.render_p37(facts, envn, mctx)
    except of.OwnerFactsError as e:
        sys.exit("REFUSED: owner facts: %s" % e)
if PB in s:
    a = s.index(PB); b = s.index(PE) + len(PE)
    if s.count(PB) != 1 or s.count(PE) != 1 or b < a or s.count("\n@@P37_SELF_SERVICE@@\n") != 1: sys.exit("REFUSED: the template's P37 region is malformed")
    body = s[a:b].replace(PB, "").replace(PE, "")
    s = s[:a] + (body.replace("@@P37_SELF_SERVICE@@\n", "\n".join(p37) + "\n") if p37 else "") + s[b:]
elif p37:
    sys.exit("REFUSED: the template has no P37 region but the owner facts / secret file set values")
# P38 BREVO API region (production only): lines and the ONE outbound host come from the same ctx; ([], []) unless the transport is brevo_api
BB, BE = "// @@BREVO_BEGIN@@\n", "// @@BREVO_END@@\n"
if envn != "production":
    if BB in s: sys.exit("REFUSED: a stage render may not carry the P38 Brevo region")
    p38, p38_hosts = [], []
else:
    try:
        p38, p38_hosts = of.render_p38(facts, envn, mctx)
    except of.OwnerFactsError as e:
        sys.exit("REFUSED: owner facts: %s" % e)
if BB in s:
    a = s.index(BB); b = s.index(BE) + len(BE)
    if s.count(BB) != 1 or s.count(BE) != 1 or b < a or s.count("\n@@BREVO_MAIL@@\n") != 1: sys.exit("REFUSED: the template's P38 Brevo region is malformed")
    body = s[a:b].replace(BB, "").replace(BE, "")
    s = s[:a] + (body.replace("@@BREVO_MAIL@@\n", "\n".join(p38) + "\n") if p38 else "") + s[b:]
elif p38:
    sys.exit("REFUSED: the template has no P38 Brevo region but the owner facts / key file set values")
extra_hosts = list(extra_hosts) + p38_hosts
if extra_hosts:
    base = {"production": "api.copilt.org", "stage": "stage.copilt.org"}[envn]
    old = "define( 'WP_ACCESSIBLE_HOSTS', '%s' );" % base
    if s.count(old) != 1: sys.exit("REFUSED: the template's WP_ACCESSIBLE_HOSTS line is not the expected single '%s' definition" % base)
    s = s.replace(old, "define( 'WP_ACCESSIBLE_HOSTS', '%s' );" % ",".join([base] + extra_hosts))
left = re.findall(r"@@[A-Z_]+@@", s)
if left: sys.exit("unreplaced placeholders: %s" % ", ".join(sorted(set(left))))
sys.stdout.write(s)
PY
if command -v php >/dev/null 2>&1; then php -l "$tmp" >/dev/null || die "rendered wp-config.php has a PHP syntax error: not installed"; else warn "php not found: syntax check skipped"; fi
if [ "$COMPARE" = 1 ]; then
  if [ -f "$OUT" ] && cmp -s "$tmp" "$OUT"; then info "IDENTICAL: the render equals $OUT byte for byte (nothing would change)"; exit 0; fi
  info "DIFFERENT from $OUT: a render would change it. Constants by NAME only (values are never shown):"
  python3 -I - "$OUT" "$tmp" <<'PY2'
import re, sys
def load(p):
    d = {}
    try:
        for line in open(p):
            m = re.match(r"define\( '([A-Za-z0-9_]+)', ", line)
            if m: d[m.group(1)] = line
    except OSError:
        pass
    return d
a, b = load(sys.argv[1]), load(sys.argv[2])
for label, names in (("added  ", sorted(set(b) - set(a))), ("removed", sorted(set(a) - set(b))), ("changed", sorted(k for k in set(a) & set(b) if a[k] != b[k]))):
    print("  %s: %s" % (label, ", ".join(names) or "-"))
PY2
  exit 4
fi
if [ -f "$OUT" ] && cmp -s "$tmp" "$OUT"; then info "unchanged: $OUT"; exit 0; fi
mkdir -p "$(dirname "$OUT")"
chmod 640 "$tmp"; [ "${AICC_TEST_HARNESS:-0}" = "1" ] || chown "$OWNER" "$tmp"
mv -f "$tmp" "$OUT"; trap - EXIT
info "wrote $OUT (0640 $OWNER); secrets not printed"
