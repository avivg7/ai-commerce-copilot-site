#!/usr/bin/env bash
# AICC stack installer for the Linux STAGING host (Ubuntu 24.04 LTS, DigitalOcean Basic Regular 1 vCPU / 2 GiB). Runs ON THE HOST, as root, over SSH,
# step by step. Same architecture is reused for production later (different hostname/identity), never pointed at the production API host.
#
#   sudo infra/provision/install-stack.sh --dry-run                 print everything it would change (changes nothing; also runs on a Mac)
#   sudo infra/provision/install-stack.sh --only users-dirs,caddy   run selected steps (comma separated, in the order given)
#   sudo infra/provision/install-stack.sh                           run the default steps in order (see --list-steps)
#   sudo infra/provision/install-stack.sh --only edge-env --acme-email ops@example.org
#   sudo infra/provision/install-stack.sh --only caddyfile --caddyfile /home/aicc/aicc-infra-bundle/Caddyfile.stage
#   sudo infra/provision/install-stack.sh --only enable-edge        (explicit only: starts the public edge)
#   sudo infra/provision/install-stack.sh --only enable-timers      (explicit only)
#   sudo infra/provision/install-stack.sh --production-host --confirm-production --only scripts,systemd,logrotate,fail2ban,php,mysql,sysctl,services,verify,enable-timers
#        re-installs/updates the stack on the PROMOTED host (identity AICC_ENV=production, docs/cutover/production-promotion.md). The stage-only steps (identity, edge-env, caddyfile,
#        enable-edge) are REFUSED there: the production edge is installed by promote-to-production.sh. In production, enable-timers leaves aicc-cert-expiry.timer off while the edge still
#        serves Caddy's internal certificate (AICC_ALLOW_INTERNAL_TLS=1 in edge.env).
#
# Options: --dry-run | --only <steps> | --list-steps | --require-cosign | --acme-email <addr> | --caddyfile <path> | --ops-fpm-access | --production-host --confirm-production | -h
#
# Properties (checked by infra/stack-tests):
#   * idempotent: a second run reports "unchanged" for everything and restarts nothing.
#   * fail closed: any unexpected state stops the run (set -euo pipefail + die()); it never "tries something else".
#   * prints what it changes; --dry-run changes nothing. Config files it replaces are kept in /var/backups/aicc-config/<timestamp>/.
#   * refuses to run unless /etc/aicc-stage-identity says AICC_ENV=staging (cloud-init writes it), so it cannot be pointed at another machine by mistake.
#   * no secrets are generated or printed here (database passwords are created by create-staging-db.sh, mode 0600, never echoed).
set -euo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA="$(cd "$SELF/.." && pwd)"
BUNDLE="$(cd "$INFRA/.." && pwd)"          # the pushed bundle contains infra/ and scripts/ops/
# shellcheck source=lib/common.sh
. "$SELF/lib/common.sh"
load_pins "$SELF/pins.env"

DEFAULT_STEPS="preflight identity packages users-dirs caddy wpcli php mysql sysctl scripts systemd logrotate fail2ban services verify"
EXTRA_STEPS="edge-env caddyfile enable-edge enable-timers"
ONLY=""; REQUIRE_COSIGN=0; ACME_EMAIL=""; CADDYFILE_SRC=""; OPS_FPM_ACCESS=0; PRODUCTION_HOST=0; CONFIRM_PRODUCTION=0

usage() { sed -n 2,22p "${BASH_SOURCE[0]}"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) AICC_DRY_RUN=1; shift ;;
    --only) ONLY="${2:-}"; [ -n "$ONLY" ] || die "--only needs a value"; shift 2 ;;
    --list-steps) echo "default steps (in order): $DEFAULT_STEPS"; echo "explicit-only steps:      $EXTRA_STEPS"; exit 0 ;;
    --require-cosign) REQUIRE_COSIGN=1; shift ;;
    --acme-email) ACME_EMAIL="${2:-}"; shift 2 ;;
    --caddyfile) CADDYFILE_SRC="${2:-}"; shift 2 ;;
    --ops-fpm-access) OPS_FPM_ACCESS=1; shift ;;
    --production-host) PRODUCTION_HOST=1; shift ;;
    --confirm-production) CONFIRM_PRODUCTION=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done
export AICC_DRY_RUN

# ---- constants (paths are the contract with infra/systemd, infra/php, infra/backup, infra/release) ------------------------------------------
PHP_VER="${PHP_SERIES}"
SOCK_PATH=/run/php/aicc-cp.sock
CADDY_BIN=/usr/local/bin/caddy
WP_BIN=/usr/local/bin/wp
DL_DIR=/var/cache/aicc/downloads
LIB_DIR=/usr/local/lib/aicc
SBIN=/usr/local/sbin
CHANGED_SERVICES=""

[ -d "$INFRA/systemd" ] && [ -d "$INFRA/php" ] && [ -d "$INFRA/mysql" ] || die "infra bundle incomplete at $INFRA (expected systemd/ php/ mysql/)"

# ---- helpers local to this script ---------------------------------------------------------------------------------------------------------------
check() { # check <description> <command...>   -> PASS/FAIL line; counts failures for the verify step
  local d="$1"; shift
  if "$@" >/dev/null 2>&1; then printf 'PASS  %s\n' "$d"; else printf 'FAIL  %s\n' "$d"; VERIFY_FAILS=$((VERIFY_FAILS + 1)); fi
}
VERIFY_FAILS=0
sock_ok() { [ -S "$(P "$SOCK_PATH")" ] && [ "$(owner_of "$(P "$SOCK_PATH")")" = "aicc-cp:aicc-edge" ] && [ "$(mode_of "$(P "$SOCK_PATH")")" = "660" ]; }
mark_changed() { CHANGED_SERVICES="$CHANGED_SERVICES $1"; }

# ================================================================================================================================================
step_preflight() {
  step "preflight (host identity and sizing)"
  if ! is_linux; then
    if is_dry; then warn "not Linux: host checks skipped in this dry-run on the authoring machine"; return 0; fi
    die "this installer only runs on the Linux staging host"
  fi
  require_root
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] && [ "${VERSION_ID:-}" = "24.04" ] || die "expected Ubuntu 24.04, found ${PRETTY_NAME:-unknown}"
  [ "$(uname -m)" = "x86_64" ] || die "expected x86_64 (the pinned Caddy tarball is linux_amd64), found $(uname -m)"
  if [ "$PRODUCTION_HOST" = 1 ]; then
    [ "$CONFIRM_PRODUCTION" = 1 ] || die "--production-host needs --confirm-production"
    [ -f /etc/aicc-stage-identity ] && grep -q '^AICC_ENV=production$' /etc/aicc-stage-identity \
      || die "/etc/aicc-stage-identity missing or not AICC_ENV=production: refusing (--production-host is for the promoted host)"
  else
    [ -f /etc/aicc-stage-identity ] && grep -q '^AICC_ENV=staging$' /etc/aicc-stage-identity \
      || die "/etc/aicc-stage-identity missing or not AICC_ENV=staging: refusing (this installer is for the staging host; the promoted host needs --production-host --confirm-production)"
  fi
  [ -f /var/lib/aicc-init-stage1-done ] || die "stage-1 cloud-init marker missing: run cloud-init's stage first (README-droplet-creation.md)"
  local mem swap swp
  mem="$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)"; swap="$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)"
  swp="$(cat /proc/sys/vm/swappiness)"
  [ "$mem" -ge 1800 ] && [ "$mem" -le 2200 ] || warn "RAM is ${mem} MiB; the tuning in infra/ assumes about 2 GiB"
  [ "$swap" -ge 1900 ] || die "swap is ${swap} MiB; expected the 2 GiB swapfile from cloud-init"
  [ "$swp" = "10" ] || die "vm.swappiness is $swp; expected 10 (cloud-init sets it in /etc/sysctl.d/99-aicc.conf)"
  local freepct; freepct="$(df -Pk / | awk 'NR==2{printf "%d", ($4*100)/($3+$4)}')"
  [ "$freepct" -ge 40 ] || die "only ${freepct}% free on / (need >= 40% before installing the stack)"
  info "OK: Ubuntu 24.04 x86_64, ${mem} MiB RAM, ${swap} MiB swap, swappiness ${swp}, ${freepct}% disk free"
  for u in unattended-upgrades fail2ban chrony; do systemctl is-active --quiet "$u" || warn "$u is not active (cloud-init should have enabled it)"; done
  grep -q 'Unattended-Upgrade::Automatic-Reboot "false"' /etc/apt/apt.conf.d/52aicc-unattended-upgrades 2>/dev/null \
    && info "unattended-upgrades already configured by cloud-init (not duplicated here)" \
    || warn "cloud-init's /etc/apt/apt.conf.d/52aicc-unattended-upgrades is missing; fix that before continuing"
}

step_identity() {
  step "identity (stage id used by deploy-release.sh to prove it is talking to THIS staging host)"
  local f; f="$(P /etc/aicc-stage-identity)"
  [ -f "$f" ] || { is_dry && { would "(no identity file here: dry-run on a non-staging machine)"; return 0; }; die "no $f"; }
  if grep -q '^AICC_STAGE_ID=[0-9a-f]\{32\}$' "$f"; then info "unchanged: stage id present"; return 0; fi
  if is_dry; then would "append AICC_STAGE_ID=<32 random hex> to /etc/aicc-stage-identity"; return 0; fi
  local id; id="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  printf 'AICC_STAGE_ID=%s\n' "$id" >> "$f"
  AICC_CHANGED=1; info "stage id generated; read it with: grep AICC_STAGE_ID /etc/aicc-stage-identity (an identifier, not a secret; build-site-release.sh embeds it)"
}

step_packages() {
  step "packages (Ubuntu archive only; no third-party apt repositories)"
  require_root
  # PHP: only what WordPress + WooCommerce need. imagick is NOT installed: GD covers resize/WebP; ImageMagick adds ~20-40 MiB per image operation,
  # a long CVE history and policy.xml work, which is not justified on a 2 GiB host serving a marketing/licence site. (Revisit if a plugin requires it.)
  local php=(php"$PHP_VER"-fpm php"$PHP_VER"-cli php"$PHP_VER"-common php"$PHP_VER"-curl php"$PHP_VER"-mbstring php"$PHP_VER"-xml php"$PHP_VER"-zip
             php"$PHP_VER"-gd php"$PHP_VER"-intl php"$PHP_VER"-mysql php"$PHP_VER"-opcache)
  ensure_pkgs "${php[@]}"
  ensure_pkgs mysql-server-8.0 mysql-client-8.0
  # libfcgi-bin: cgi-fcgi, used by the release health gate to talk to the FPM socket directly; acl: setfacl; the rest were installed by cloud-init
  ensure_pkgs libfcgi-bin acl curl jq openssl rsync logrotate ca-certificates
}

step_users_dirs() {
  step "users, groups, directories, ACLs"
  require_root
  if [ -z "$AICC_PREFIX" ] && ! is_dry; then id aicc >/dev/null 2>&1 || die "the operator user 'aicc' does not exist (cloud-init stage 1 creates it); refusing to continue"; fi
  ensure_system_user aicc-edge /var/lib/aicc-edge
  ensure_system_user aicc-cp   /var/lib/aicc-cp
  ensure_system_user aicc-ops  /var/lib/aicc-ops        # PLACEHOLDER: the AICC Ops service runs as this user; it gets no shell and no group beyond its own
  if [ "$OPS_FPM_ACCESS" = 1 ]; then
    warn "--ops-fpm-access: aicc-ops joins group aicc-edge, which grants it connect rights on the PHP socket (a FastCGI client can run any .php file as aicc-cp). Owner decision."
    ensure_user_in_group aicc-ops aicc-edge
  fi
  # /srv/aicc tree. Release trees are world-readable and owned by the deploy user `aicc` (an operator with sudo): immutable once activated.
  ensure_dir 0750 root:aicc-cp /etc/aicc-mail          # holds smtp.env on the PRODUCTION host only (the staging host leaves it empty); /etc/aicc is root-only, so the PHP user needs its own directory
  ensure_dir 0755 root:root /srv/aicc
  for k in site cp; do
    ensure_dir 0755 aicc:aicc "/srv/aicc/$k"
    ensure_dir 0755 aicc:aicc "/srv/aicc/$k/releases"
  done
  ensure_dir 0755 root:root /srv/aicc/shared
  ensure_dir 2750 aicc-cp:aicc-edge /srv/aicc/shared/uploads
  ensure_dir 0750 root:aicc-cp /srv/aicc/shared/plugin-releases   # private Plugin release store (AICC_LM_PLUGIN_RELEASE_DIR): PHP reads, only the root installer writes; not under any web root, not group aicc-edge (Caddy cannot read it)
  ensure_dir 0751 root:root /srv/aicc/backups        # x for others so AICC Ops can open status.json by name; dumps inside are 0600 root
  ensure_dir 0755 root:root /var/lib/aicc
  ensure_dir 0755 root:root /var/lib/aicc/status
  ensure_dir 0750 root:root /etc/aicc
  ensure_dir 0700 root:root /etc/aicc/secrets
  ensure_dir 0750 root:aicc-edge /etc/aicc-edge
  ensure_dir 0700 aicc-edge:aicc-edge /var/lib/aicc-edge
  ensure_dir 0750 aicc-edge:adm /var/log/aicc-edge
  ensure_dir 0750 aicc-cp:aicc-cp /var/lib/aicc-cp
  for d in tmp sessions mail wp-cli; do ensure_dir 0700 aicc-cp:aicc-cp "/var/lib/aicc-cp/$d"; done
  ensure_dir 0750 aicc-cp:adm /var/log/aicc-cp
  ensure_dir 0700 root:root /var/cache/aicc
  ensure_dir 0700 root:root "$DL_DIR"
  # ACLs. uploads: owner aicc-cp (rwx), group aicc-edge (r-x, so Caddy can read), nobody else. The ACL adds the operator `aicc` (read-only, no sudo needed to look) and, as DEFAULT entries, makes
  # every file/dir PHP creates later readable by aicc-edge and aicc whatever umask the PHP process has. No named entry for aicc-cp: it is the owner already, and a named rwx entry would
  # raise the ACL mask to rwx so that the next `chmod 2750` (this installer, on a re-run) silently turned it back into r-x and took write access away from PHP (found by the container test).
  if [ -n "$AICC_PREFIX" ]; then info "harness: ACLs skipped"; return 0; fi
  if getfacl -p /srv/aicc/shared/uploads 2>/dev/null | grep -q '^default:group:aicc-edge:r-x$' && getfacl -p /srv/aicc/shared/uploads 2>/dev/null | grep -q '^user:aicc:r-x$'; then info "unchanged: ACL /srv/aicc/shared/uploads"
  else
    run setfacl -m "u:aicc:rx,g:aicc-edge:rx" /srv/aicc/shared/uploads
    run setfacl -d -m "u:aicc:rx,g:aicc-edge:rx,o::---" /srv/aicc/shared/uploads
    run chmod 2750 /srv/aicc/shared/uploads
  fi
  # AICC Ops may read the edge logs (no write)
  if getfacl -p /var/log/aicc-edge 2>/dev/null | grep -q '^user:aicc-ops:r-x$'; then info "unchanged: ACL /var/log/aicc-edge"
  else run setfacl -m "u:aicc-ops:rx" /var/log/aicc-edge; run setfacl -d -m "u:aicc-ops:rx" /var/log/aicc-edge; fi
}

# ---- Caddy: verified release tarball ----------------------------------------------------------------------------------------------------------
# Verification chain (every link must hold or the install stops):
#   1. sha512 of the downloaded tarball == CADDY_TARBALL_SHA512 pinned in pins.env (reviewed in git; the trust anchor)
#   2. the same hash appears in the release's own caddy_<v>_checksums.txt (downloaded now)  -> detects a stale/wrong pin
#   3. IF `cosign` is installed: cosign verify-blob of that checksums file with its .pem/.sig (Sigstore keyless, GitHub Actions identity).
#      Without cosign this link is SKIPPED with a loud warning, or the run fails with --require-cosign.
#   4. the extracted binary reports exactly v<CADDY_VERSION> before it replaces anything.
step_caddy() {
  step "caddy ${CADDY_VERSION} (official release tarball, verified; no apt repository)"
  require_root
  if [ -x "$(P $CADDY_BIN)" ] && "$(P $CADDY_BIN)" version 2>/dev/null | grep -q "^v${CADDY_VERSION} "; then info "unchanged: caddy v${CADDY_VERSION} already installed"; return 0; fi
  if is_dry; then
    would "download ${CADDY_RELEASE_BASE}/${CADDY_TARBALL} (+ checksums, .pem, .sig) into $DL_DIR"
    would "verify sha512 == pin ${CADDY_TARBALL_SHA512:0:16}..., cross-check against ${CADDY_CHECKSUMS_FILE}, cosign verify-blob if available"
    would "install caddy to $CADDY_BIN (0755 root:root) after checking 'caddy version'"; return 0
  fi
  local d="$DL_DIR/caddy-${CADDY_VERSION}"; mkdir -p "$d"; chmod 700 "$d"
  download "${CADDY_RELEASE_BASE}/${CADDY_TARBALL}" "$d/${CADDY_TARBALL}"
  local got; got="$(sha512_of "$d/${CADDY_TARBALL}")"
  [ "$got" = "$CADDY_TARBALL_SHA512" ] || die "caddy tarball sha512 MISMATCH (got ${got:0:24}..., pinned ${CADDY_TARBALL_SHA512:0:24}...): refusing"
  info "sha512 matches the pin in pins.env"
  download "${CADDY_RELEASE_BASE}/${CADDY_CHECKSUMS_FILE}" "$d/${CADDY_CHECKSUMS_FILE}"
  grep -q "^${CADDY_TARBALL_SHA512}  ${CADDY_TARBALL}\$" "$d/${CADDY_CHECKSUMS_FILE}" \
    || die "the release's own checksums file does not list the pinned hash for ${CADDY_TARBALL}: refusing (pin stale or release tampered)"
  info "sha512 matches the release's published ${CADDY_CHECKSUMS_FILE}"
  if command -v cosign >/dev/null 2>&1; then
    download "${CADDY_RELEASE_BASE}/${CADDY_CHECKSUMS_FILE}.pem" "$d/${CADDY_CHECKSUMS_FILE}.pem"
    download "${CADDY_RELEASE_BASE}/${CADDY_CHECKSUMS_FILE}.sig" "$d/${CADDY_CHECKSUMS_FILE}.sig"
    cosign verify-blob "$d/${CADDY_CHECKSUMS_FILE}" --certificate "$d/${CADDY_CHECKSUMS_FILE}.pem" --signature "$d/${CADDY_CHECKSUMS_FILE}.sig" \
      --certificate-identity-regexp "$CADDY_COSIGN_IDENTITY_REGEXP" --certificate-oidc-issuer "$CADDY_COSIGN_OIDC_ISSUER" \
      || die "cosign verification of ${CADDY_CHECKSUMS_FILE} FAILED: refusing"
    info "Sigstore signature of ${CADDY_CHECKSUMS_FILE} verified (cosign)"
  elif [ "$REQUIRE_COSIGN" = 1 ]; then die "--require-cosign given but cosign is not installed"
  else warn "cosign is NOT installed: Sigstore signature NOT verified (the pinned sha512 and the published checksums file were). Verify once on the Mac: see RUNBOOK step 4."; fi
  local x="$d/extract"; rm -rf "$x"; mkdir -p "$x"
  tar -xzf "$d/${CADDY_TARBALL}" -C "$x" caddy
  chmod 0755 "$x/caddy"
  "$x/caddy" version | grep -q "^v${CADDY_VERSION} " || die "extracted caddy does not report v${CADDY_VERSION}: refusing"
  install -m 0755 -o root -g root "$x/caddy" "$CADDY_BIN.new"
  mv -f "$CADDY_BIN.new" "$CADDY_BIN"
  AICC_CHANGED=1; info "installed $CADDY_BIN ($("$CADDY_BIN" version | cut -c1-40))"
  # The distro's own caddy unit/user are not installed; make sure nothing else binds :80/:443
  systemctl disable --now caddy.service >/dev/null 2>&1 || true
}

step_wpcli() {
  step "wp-cli ${WPCLI_VERSION} (official phar, pinned sha256+sha512, published .sha512 cross-checked)"
  require_root
  if [ -f "$(P $WP_BIN)" ] && [ "$(sha512_of "$(P $WP_BIN)")" = "$WPCLI_SHA512" ]; then info "unchanged: wp-cli ${WPCLI_VERSION} already installed"
  elif is_dry; then would "download $WPCLI_URL, verify sha256+sha512 against pins.env and the published .sha512, install $WP_BIN (0755 root)"
  else
    local d="$DL_DIR/wp-cli-${WPCLI_VERSION}"; mkdir -p "$d"; chmod 700 "$d"
    download "$WPCLI_URL" "$d/wp-cli.phar"
    [ "$(sha512_of "$d/wp-cli.phar")" = "$WPCLI_SHA512" ] || die "wp-cli.phar sha512 MISMATCH vs pin: refusing"
    [ "$(sha256_of "$d/wp-cli.phar")" = "$WPCLI_SHA256" ] || die "wp-cli.phar sha256 MISMATCH vs pin: refusing"
    download "$WPCLI_SHA512_URL" "$d/wp-cli.phar.sha512"
    local pub; pub="$(awk '{print $1}' "$d/wp-cli.phar.sha512" | head -1)"
    [ "$pub" = "$WPCLI_SHA512" ] || die "the published .sha512 differs from the pin in pins.env: refusing"
    info "sha256 + sha512 match the pins and the published checksum"
    php "$d/wp-cli.phar" --allow-root --version 2>/dev/null | grep -q "^WP-CLI ${WPCLI_VERSION}\$" || die "phar does not report WP-CLI ${WPCLI_VERSION}"
    install -m 0755 -o root -g root "$d/wp-cli.phar" "$WP_BIN.new"; mv -f "$WP_BIN.new" "$WP_BIN"
    AICC_CHANGED=1; info "installed $WP_BIN"
  fi
  # convenience wrapper: always run WP-CLI as the PHP user against the active release, with the same memory ceiling as the web pool
  install_text "$SBIN/aicc-wp" 0755 root:root <<'EOF'
#!/usr/bin/env bash
# Run WP-CLI as the Control Plane PHP user against the active release (never as root: root-owned files under uploads would break PHP).
set -euo pipefail
exec sudo -u aicc-cp -H -- env WP_CLI_CACHE_DIR=/var/lib/aicc-cp/wp-cli /usr/bin/php -d memory_limit=192M /usr/local/bin/wp --path=/srv/aicc/cp/current "$@"
EOF
}

step_php() {
  step "php-fpm ${PHP_VER}: dedicated pool 'aicc' on ${SOCK_PATH}"
  require_root
  if ! is_dry && [ -z "$AICC_PREFIX" ]; then [ -d /var/log/aicc-cp ] && id aicc-cp >/dev/null 2>&1 || die "run the users-dirs step first"; fi
  local pooldir="/etc/php/${PHP_VER}/fpm/pool.d"
  if [ -f "$(P $pooldir/www.conf)" ]; then
    if is_dry; then would "move the default pool aside: $pooldir/www.conf -> www.conf.aicc-disabled"
    else mv "$(P $pooldir/www.conf)" "$(P $pooldir/www.conf.aicc-disabled)"; AICC_CHANGED=1; mark_changed php; info "default pool www.conf moved aside"; fi
  else info "unchanged: default pool already disabled"; fi
  AICC_CHANGED=0
  install_file "$INFRA/php/aicc-pool.conf"  "$pooldir/aicc.conf" 0644 root:root
  install_file "$INFRA/php/90-aicc-fpm.ini" "/etc/php/${PHP_VER}/fpm/conf.d/90-aicc.ini" 0644 root:root
  install_file "$INFRA/php/90-aicc-cli.ini" "/etc/php/${PHP_VER}/cli/conf.d/90-aicc.ini" 0644 root:root
  install_file "$INFRA/php/aicc-mail-sink.sh" "$SBIN/aicc-mail-sink" 0755 root:root
  [ "$AICC_CHANGED" = 1 ] && mark_changed php
  if is_dry || [ -n "$AICC_PREFIX" ]; then return 0; fi
  php-fpm"${PHP_VER}" --test --fpm-config "/etc/php/${PHP_VER}/fpm/php-fpm.conf" || die "php-fpm configuration test failed: nothing was reloaded; previous files are in /var/backups/aicc-config/"
}

step_mysql() {
  step "mysql 8.0: socket-only, small-memory drop-in"
  require_root
  AICC_CHANGED=0
  install_file "$INFRA/mysql/99-aicc.cnf" /etc/mysql/mysql.conf.d/99-aicc.cnf 0644 root:root
  [ "$AICC_CHANGED" = 1 ] && mark_changed mysql
  if is_dry || [ -n "$AICC_PREFIX" ]; then return 0; fi
  install -d -m 0750 -o mysql -g adm /var/log/mysql
  # validate BEFORE restarting: --validate-config reads the same option files and exits non-zero on an unknown/invalid option
  mysqld --user=mysql --validate-config || die "mysqld --validate-config FAILED: not restarting MySQL; the previous drop-in is in /var/backups/aicc-config/"
}

step_sysctl() {
  step "sysctl and swap check (cloud-init already set swappiness=10, vfs_cache_pressure=50 in 99-aicc.conf: not repeated)"
  AICC_CHANGED=0
  install_text /etc/sysctl.d/98-aicc-stack.conf 0644 root:root <<'EOF'
# AICC stack kernel settings for a 1 vCPU / 2 GiB host (additions to cloud-init's 99-aicc.conf, which keeps vm.swappiness and vfs_cache_pressure).
# Listen backlog: Caddy's default accept queue is min(somaxconn, 4096); 1024 absorbs a burst without queueing seconds of work on one vCPU.
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 1024
net.ipv4.tcp_fin_timeout = 30
# Smoother writeback: with 2 GiB RAM, a 20% default dirty ratio lets 400 MiB of dirty pages build up and then stall MySQL's fsyncs.
vm.dirty_background_ratio = 5
vm.dirty_ratio = 15
# never panic on OOM: the kernel kills one process (mysql is protected with OOMScoreAdjust=-500) and the host stays reachable over SSH
vm.panic_on_oom = 0
EOF
  if [ "$AICC_CHANGED" = 1 ] && ! is_dry && [ -z "$AICC_PREFIX" ]; then sysctl -p /etc/sysctl.d/98-aicc-stack.conf >/dev/null; fi
  if is_linux && [ -z "$AICC_PREFIX" ]; then
    local sw; sw="$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)"
    [ "$sw" -ge 1900 ] && [ "$(cat /proc/sys/vm/swappiness)" = "10" ] && info "swap ${sw} MiB, swappiness 10: OK" || warn "swap/swappiness differ from the cloud-init baseline (swap ${sw} MiB)"
  fi
}

step_scripts() {
  step "helper scripts and libraries -> ${SBIN}, ${LIB_DIR}"
  require_root
  local ops="$BUNDLE/scripts/ops"
  install_file "$INFRA/systemd/aicc-unit-status.sh"          "$SBIN/aicc-unit-status" 0755 root:root
  install_file "$INFRA/systemd/aicc-fpm-log-status.sh"       "$SBIN/aicc-fpm-log-status" 0755 root:root
  install_file "$INFRA/systemd/aicc-security-updates.sh"      "$SBIN/aicc-security-updates" 0755 root:root
  if [ -f "$ops/edge-preflight.sh" ]; then install_file "$ops/edge-preflight.sh" "$SBIN/aicc-edge-preflight" 0755 root:root
  else die "scripts/ops/edge-preflight.sh missing from the bundle ($ops)"; fi
  [ -f "$ops/cert-expiry-check.sh" ] && install_file "$ops/cert-expiry-check.sh" "$SBIN/aicc-cert-expiry-check" 0755 root:root || warn "cert-expiry-check.sh not in bundle"
  [ -f "$ops/caddy-storage-backup.sh" ] && install_file "$ops/caddy-storage-backup.sh" "$SBIN/aicc-caddy-storage-backup" 0755 root:root || true
  [ -f "$ops/edge-listener-audit.sh" ] && install_file "$ops/edge-listener-audit.sh" "$SBIN/aicc-edge-listener-audit" 0755 root:root || warn "edge-listener-audit.sh not in bundle"
  # backup: scripts + library live under /usr/local/lib/aicc/backup (the scripts find lib/ next to their real path); symlinks in /usr/local/sbin
  [ -f "$INFRA/backup/aicc-backup.sh" ] || die "infra/backup missing from the bundle"
  install_file "$INFRA/backup/aicc-backup.sh"       "$LIB_DIR/backup/aicc-backup.sh" 0755 root:root
  install_file "$INFRA/backup/aicc-restore-test.sh" "$LIB_DIR/backup/aicc-restore-test.sh" 0755 root:root
  install_file "$INFRA/backup/lib/backup-common.sh" "$LIB_DIR/backup/lib/backup-common.sh" 0644 root:root
  ensure_symlink "$LIB_DIR/backup/aicc-backup.sh" "$SBIN/aicc-backup"
  ensure_symlink "$LIB_DIR/backup/aicc-restore-test.sh" "$SBIN/aicc-restore-test"
  install_file "$INFRA/backup/aicc-restore.sh"      "$LIB_DIR/backup/aicc-restore.sh" 0755 root:root
  ensure_symlink "$LIB_DIR/backup/aicc-restore.sh" "$SBIN/aicc-restore"
  # the wp-config renderer + its two templates + library: the restore tool re-renders a missing wp-config.php with it (F-05: the backup no longer carries the rendered file). The templates are copied by glob, the
  # production one is only ever USED by `--env production --confirm-production` (the renderer's own gates).
  install_file "$INFRA/provision/render-wp-config.sh" "$LIB_DIR/provision/render-wp-config.sh" 0755 root:root
  install_file "$INFRA/provision/lib/common.sh" "$LIB_DIR/provision/lib/common.sh" 0644 root:root
  for t in "$INFRA"/provision/wp-config.*.template.php; do install_file "$t" "$LIB_DIR/provision/$(basename "$t")" 0644 root:root; done
  ensure_symlink "$LIB_DIR/provision/render-wp-config.sh" "$SBIN/aicc-render-wp-config"
  # the owner-facts tool (non-secret launch facts rendered into wp-config.php) and the validator it shares with the renderer; the facts file itself (/etc/aicc/owner-facts.env) is the owner's and is never created or touched here
  install_file "$INFRA/provision/owner-facts.sh" "$LIB_DIR/provision/owner-facts.sh" 0755 root:root
  install_file "$INFRA/provision/lib/owner_facts.py" "$LIB_DIR/provision/lib/owner_facts.py" 0644 root:root
  ensure_symlink "$LIB_DIR/provision/owner-facts.sh" "$SBIN/aicc-owner-facts"
  # release tooling (host side)
  [ -f "$INFRA/release/activate-release.sh" ] || die "infra/release missing from the bundle"
  for f in activate-release.sh rollback-release.sh smoke-cp.sh smoke-site.sh warm-cp.sh; do install_file "$INFRA/release/$f" "$LIB_DIR/release/$f" 0755 root:root; done
  install_file "$INFRA/release/lib/release-common.sh" "$LIB_DIR/release/lib/release-common.sh" 0644 root:root
  ensure_symlink "$LIB_DIR/release/activate-release.sh" "$SBIN/aicc-activate-release"
  ensure_symlink "$LIB_DIR/release/rollback-release.sh" "$SBIN/aicc-rollback-release"
  install_file "$INFRA/release/deploy-status.sh" "$LIB_DIR/release/deploy-status.sh" 0755 root:root
  ensure_symlink "$LIB_DIR/release/deploy-status.sh" "$SBIN/aicc-deploy-status"
}

step_systemd() {
  step "systemd units and drop-ins (installed, not all enabled)"
  require_root
  AICC_CHANGED=0
  local f
  for f in "$INFRA"/systemd/*.service "$INFRA"/systemd/*.timer; do
    [ -f "$f" ] || continue
    install_file "$f" "/etc/systemd/system/$(basename "$f")" 0644 root:root
  done
  install_file "$INFRA/systemd/overrides/php8.3-fpm.service.d/aicc.conf" /etc/systemd/system/php8.3-fpm.service.d/aicc.conf 0644 root:root
  install_file "$INFRA/systemd/overrides/php8.3-fpm.service.d/20-aicc-sandbox.conf" /etc/systemd/system/php8.3-fpm.service.d/20-aicc-sandbox.conf 0644 root:root
  install_file "$INFRA/systemd/overrides/mysql.service.d/aicc.conf" /etc/systemd/system/mysql.service.d/aicc.conf 0644 root:root
  # fail2ban needs the log file to exist when its jail starts (Caddy has not run yet)
  if [ ! -e "$(P /var/log/aicc-edge/aicc-edge.log)" ]; then
    if is_dry; then would "create empty /var/log/aicc-edge/aicc-edge.log (aicc-edge:adm 0640)"
    else : > "$(P /var/log/aicc-edge/aicc-edge.log)"; [ -n "$AICC_PREFIX" ] || chown aicc-edge:adm /var/log/aicc-edge/aicc-edge.log; chmod 0640 "$(P /var/log/aicc-edge/aicc-edge.log)"; fi
  fi
  if [ "$AICC_CHANGED" = 1 ] && ! is_dry && [ -z "$AICC_PREFIX" ]; then
    systemctl daemon-reload
    if command -v systemd-analyze >/dev/null 2>&1; then
      systemd-analyze verify /etc/systemd/system/aicc-edge.service /etc/systemd/system/aicc-wp-cron.service /etc/systemd/system/aicc-backup.service \
        /etc/systemd/system/aicc-cert-expiry.service /etc/systemd/system/aicc-security-updates.service /etc/systemd/system/aicc-wp-cron.timer /etc/systemd/system/aicc-backup.timer /etc/systemd/system/aicc-cert-expiry.timer /etc/systemd/system/aicc-security-updates.timer \
        || die "systemd-analyze verify reported problems (read above); units are installed but NOT enabled"
      info "systemd-analyze verify: no problems"
    fi
  elif is_dry; then would "systemctl daemon-reload; systemd-analyze verify (on the host)"; fi
}

step_logrotate() {
  step "logrotate"
  install_file "$INFRA/logrotate/aicc-php"    /etc/logrotate.d/aicc-php 0644 root:root
  # (no aicc-mysql file: Ubuntu's own /etc/logrotate.d/mysql-server already rotates /var/log/mysql/*log, slow.log included; a second stanza for the same file makes logrotate exit 1 every night)
  if is_linux && [ -z "$AICC_PREFIX" ] && ! is_dry && [ -f /etc/logrotate.d/aicc-mysql ]; then rm -f /etc/logrotate.d/aicc-mysql; info "removed the superseded /etc/logrotate.d/aicc-mysql"; fi
  install_file "$INFRA/logrotate/aicc-backup" /etc/logrotate.d/aicc-backup 0644 root:root
  if ! is_dry && is_linux && [ -z "$AICC_PREFIX" ]; then logrotate --debug /etc/logrotate.conf >/dev/null 2>&1 || die "logrotate --debug reports an error in the new config"; info "logrotate --debug: OK (Caddy rotates its own logs: roll_size/roll_keep in the Caddyfile)"; fi
}

step_fail2ban() {
  step "fail2ban jails: aicc-wp-login, caddy-4xx-flood (sshd jail comes from cloud-init)"
  require_root
  AICC_CHANGED=0
  install_file "$INFRA/fail2ban/filter.d-aicc-wp-login.conf"  /etc/fail2ban/filter.d/aicc-wp-login.conf 0644 root:root
  install_file "$INFRA/fail2ban/filter.d-caddy-4xx-flood.conf" /etc/fail2ban/filter.d/caddy-4xx-flood.conf 0644 root:root
  install_file "$INFRA/fail2ban/jail.d-aicc-edge.local"       /etc/fail2ban/jail.d/aicc-edge.local 0644 root:root
  if [ "$AICC_CHANGED" = 1 ] && ! is_dry && [ -z "$AICC_PREFIX" ]; then
    fail2ban-client -t || die "fail2ban configuration test failed; files kept in /var/backups/aicc-config/, fail2ban NOT reloaded"
    systemctl reload fail2ban || systemctl restart fail2ban
    info "run: fail2ban-regex /var/log/aicc-edge/aicc-edge.log /etc/fail2ban/filter.d/aicc-wp-login.conf   (after Caddy has logged some requests)"
  fi
}

step_services() {
  step "enable and (re)start mysql, php-fpm in order; edge and timers stay OFF"
  require_root
  if is_dry; then would "systemctl enable --now mysql php${PHP_VER}-fpm (restart only if their config changed: ${CHANGED_SERVICES:-none})"; return 0; fi
  [ -z "$AICC_PREFIX" ] || { info "harness: skipped"; return 0; }
  systemctl enable mysql "php${PHP_VER}-fpm" >/dev/null 2>&1
  case " $CHANGED_SERVICES " in *" mysql "*) systemctl restart mysql ;; *) systemctl is-active --quiet mysql || systemctl start mysql ;; esac
  # --only splits the install over several runs, so CHANGED_SERVICES is empty in a later run: also restart when the RUNNING server does not carry our drop-in.
  if systemctl is-active --quiet mysql && [ "$(mysql --protocol=socket -N -e 'SELECT @@skip_networking, @@innodb_buffer_pool_size' 2>/dev/null | tr '\t' ' ')" != "1 201326592" ]; then info "running mysql does not carry the AICC drop-in: restarting"; systemctl restart mysql; fi
  # wait for the socket (restart of a 2 GiB MySQL takes a few seconds)
  local i; for i in $(seq 1 30); do [ -S /run/mysqld/mysqld.sock ] && break; sleep 1; done
  [ -S /run/mysqld/mysqld.sock ] || die "mysql socket did not appear: journalctl -u mysql"
  case " $CHANGED_SERVICES " in *" php "*) systemctl restart "php${PHP_VER}-fpm" ;; *) systemctl is-active --quiet "php${PHP_VER}-fpm" || systemctl start "php${PHP_VER}-fpm" ;; esac
  sock_ok || { info "the aicc pool socket is missing: restarting php-fpm to load the pool"; systemctl restart "php${PHP_VER}-fpm"; sleep 1; }
  sleep 1
  sock_ok || die "PHP socket $SOCK_PATH missing or not aicc-cp:aicc-edge 0660 after start"
  info "mysql and php-fpm are up"
}

step_verify() {
  step "verify (read-only)"
  if ! is_linux; then warn "verify runs on the Linux host only"; return 0; fi
  VERIFY_FAILS=0
  check "caddy v${CADDY_VERSION}" bash -c "$CADDY_BIN version | grep -q '^v${CADDY_VERSION} '"
  check "wp-cli ${WPCLI_VERSION} sha512 equals pin" bash -c "[ \"\$(sha512sum $WP_BIN | cut -d' ' -f1)\" = \"$WPCLI_SHA512\" ]"
  check "users aicc-edge aicc-cp aicc-ops exist" bash -c 'id aicc-edge && id aicc-cp && id aicc-ops'
  check "PHP socket aicc-cp:aicc-edge 0660" sock_ok
  check "php-fpm config test" php-fpm"${PHP_VER}" --test
  check "only the 'aicc' pool is configured (no www pool)" bash -c "! test -f /etc/php/${PHP_VER}/fpm/pool.d/www.conf"
  check "opcache validate_timestamps=0 in FPM" bash -c "php-fpm${PHP_VER} -i 2>/dev/null | grep -q 'opcache.validate_timestamps => Off'"
  check "expose_php off" bash -c "php-fpm${PHP_VER} -i 2>/dev/null | grep -q 'expose_php => Off'"
  check "mysql: skip_networking=1 performance_schema=0 buffer pool 192M max_connections 30 log_bin 0" bash -c \
    "mysql --protocol=socket -N -e 'SELECT @@skip_networking, @@performance_schema, @@innodb_buffer_pool_size, @@max_connections, @@log_bin' | tr '\\t' ' ' | grep -qx '1 0 201326592 30 0'"
  check "nothing listens on 3306 or 33060" bash -c "! ss -H -ltn | awk '{print \$4}' | grep -Eq ':(3306|33060)\$'"
  check "swap >= 1900 MiB and swappiness 10" bash -c "[ \$(awk '/SwapTotal/{print int(\$2/1024)}' /proc/meminfo) -ge 1900 ] && [ \$(cat /proc/sys/vm/swappiness) = 10 ]"
  check "UFW active, 22/80/443 tcp only, no 443/udp" bash -c "ufw status | grep -q 'Status: active' && ! ufw status | grep -q '443/udp'"
  check "fail2ban jails loaded (sshd, aicc-wp-login, caddy-4xx-flood)" bash -c "fail2ban-client status | grep -q 'aicc-wp-login' && fail2ban-client status | grep -q 'caddy-4xx-flood' && fail2ban-client status | grep -q sshd"
  check "systemd-analyze verify (aicc units)" bash -c "systemd-analyze verify /etc/systemd/system/aicc-edge.service /etc/systemd/system/aicc-wp-cron.service /etc/systemd/system/aicc-backup.service /etc/systemd/system/aicc-cert-expiry.service"
  check "unattended-upgrades config from cloud-init present (not duplicated)" test -f /etc/apt/apt.conf.d/52aicc-unattended-upgrades
  if [ "$VERIFY_FAILS" -gt 0 ]; then die "$VERIFY_FAILS verification check(s) failed"; fi
  info "all verification checks passed"
}

# ---- explicit-only steps --------------------------------------------------------------------------------------------------------------------------
step_edge_env() {
  step "edge-env: /etc/aicc-edge/edge.env (created once, never overwritten)"
  require_root
  local dest; dest="$(P /etc/aicc-edge/edge.env)"
  if [ -f "$dest" ]; then info "unchanged: $dest exists (not overwritten; edit it by hand)"; return 0; fi
  [[ "$ACME_EMAIL" =~ ^[^@[:space:]\"\'\$\`]+@[^@[:space:]\"\'\$\`]+\.[^@[:space:]\"\'\$\`]+$ ]] || die "--acme-email <valid address> is required for edge-env"
  local sid; sid="$(sed -n 's/^AICC_STAGE_ID=\([0-9a-f]\{32\}\)$/\1/p' "$(P /etc/aicc-stage-identity)" 2>/dev/null | head -1 || true)"
  if [ -z "$sid" ]; then is_dry && { would "render edge.env (stage id comes from /etc/aicc-stage-identity once the identity step has run)"; return 0; }; die "no AICC_STAGE_ID in /etc/aicc-stage-identity: run the identity step first"; fi
  local t; t="$(mktemp)"; sed -e "s|__ACME_EMAIL__|${ACME_EMAIL}|" -e "s|__STAGE_ID__|${sid}|" "$INFRA/systemd/edge.env.stage.template" > "$t"
  install_file "$t" /etc/aicc-edge/edge.env 0640 root:aicc-edge; rm -f "$t"
}

step_caddyfile() {
  step "caddyfile: preflight the rendered Caddyfile (stage mode) and install /etc/aicc-edge/Caddyfile"
  require_root
  [ -n "$CADDYFILE_SRC" ] && [ -r "$CADDYFILE_SRC" ] || die "--caddyfile <readable path> is required (render it on the Mac: node scripts/ops/render-edge.mjs --mode stage --out Caddyfile.stage)"
  [ -f "$(P /etc/aicc-edge/edge.env)" ] || die "run edge-env first"
  if ! is_dry && [ -z "$AICC_PREFIX" ]; then
    # the full fail-closed check in stage mode, against the candidate file, BEFORE it replaces anything: adapts the config, checks listeners, identity route, HTTP/3, metrics,
    # PHP socket, static root, ACME settings. It does not contact any CA.
    "$SBIN/aicc-edge-preflight" --mode stage --caddyfile "$CADDYFILE_SRC" --env-file /etc/aicc-edge/edge.env --caddy "$CADDY_BIN" || die "edge preflight (stage) FAILED: the Caddyfile was NOT installed"
  else would "aicc-edge-preflight --mode stage --caddyfile $CADDYFILE_SRC --env-file /etc/aicc-edge/edge.env"; fi
  install_file "$CADDYFILE_SRC" /etc/aicc-edge/Caddyfile 0640 root:aicc-edge
}

step_enable_edge() {
  step "enable-edge: start the PUBLIC edge (needs DNS A record, ports 80/443 reachable, a site release and the PHP socket)"
  require_root
  if is_dry; then would "systemctl enable --now aicc-edge.service (preflight runs first)"; return 0; fi
  [ -f /etc/aicc-edge/Caddyfile ] && [ -f /etc/aicc-edge/edge.env ] || die "Caddyfile/edge.env missing: run edge-env and caddyfile"
  [ -f /srv/aicc/site/current/index.html ] || die "no static site release is active yet (deploy-release.sh --kind site first)"
  sock_ok || die "PHP socket not ready"
  "$SBIN/aicc-edge-preflight" --mode stage --caddyfile /etc/aicc-edge/Caddyfile --env-file /etc/aicc-edge/edge.env --caddy "$CADDY_BIN" --quiet || die "edge preflight (stage) failed: not starting"
  systemctl enable --now aicc-edge.service
  sleep 3
  systemctl is-active --quiet aicc-edge.service || { journalctl -u aicc-edge -n 30 --no-pager; die "aicc-edge did not start"; }
  info "aicc-edge is active; certificate issuance (Let's Encrypt STAGING directory first) happens on the first TLS request: journalctl -u aicc-edge -f"
  [ -x "$SBIN/aicc-edge-listener-audit" ] && "$SBIN/aicc-edge-listener-audit" || warn "listener audit reported a problem (read above)"
}

step_enable_timers() {
  step "enable-timers: wp-cron every 2 minutes, daily backup, daily certificate check"
  require_root
  local timers="aicc-wp-cron.timer aicc-backup.timer aicc-cert-expiry.timer aicc-fpm-log-status.timer aicc-security-updates.timer"
  # dark production: the edge serves Caddy's 12-hour INTERNAL certificate, so the certificate-expiry check would fail every day; `promote-to-production.sh final-edge` enables it
  if [ "$(sed -n 's/^AICC_ENV=//p' "$(P /etc/aicc-stage-identity)" 2>/dev/null | head -1)" = production ] && grep -q '^AICC_ALLOW_INTERNAL_TLS=1$' "$(P /etc/aicc-edge/edge.env)" 2>/dev/null; then
    timers="aicc-wp-cron.timer aicc-backup.timer aicc-fpm-log-status.timer aicc-security-updates.timer"; info "dark production: aicc-cert-expiry.timer stays OFF until final-edge"
  fi
  if is_dry; then would "systemctl enable --now $timers"; return 0; fi
  systemctl enable --now $timers
  systemctl list-timers 'aicc-*' --no-pager
}

# ================================================================================================================================================
run_step() {
  case "$1" in
    preflight) step_preflight ;; identity) step_identity ;; packages) step_packages ;; users-dirs) step_users_dirs ;; caddy) step_caddy ;;
    wpcli) step_wpcli ;; php) step_php ;; mysql) step_mysql ;; sysctl) step_sysctl ;; scripts) step_scripts ;; systemd) step_systemd ;;
    logrotate) step_logrotate ;; fail2ban) step_fail2ban ;; services) step_services ;; verify) step_verify ;;
    edge-env) step_edge_env ;; caddyfile) step_caddyfile ;; enable-edge) step_enable_edge ;; enable-timers) step_enable_timers ;;
    *) die "unknown step: $1 (see --list-steps)" ;;
  esac
}

if is_dry; then log "DRY-RUN: nothing will be changed"; fi
if [ -n "$ONLY" ]; then STEPS="${ONLY//,/ }"; else STEPS="$DEFAULT_STEPS"; fi
for s in $STEPS; do in_list "$s" $DEFAULT_STEPS $EXTRA_STEPS || die "unknown step: $s (see --list-steps)"; done
# the stage-only steps must never run on a host whose identity says production (they would write stage identity/edge files, or start the stage-mode edge)
if [ "$(sed -n 's/^AICC_ENV=//p' "$(P /etc/aicc-stage-identity)" 2>/dev/null | head -1)" = production ]; then
  for s in $STEPS; do case "$s" in identity|edge-env|caddyfile|enable-edge) die "step '$s' is stage-only and the host identity says production: the production edge and identity are managed by promote-to-production.sh" ;; esac; done
  [ "$PRODUCTION_HOST" = 1 ] && [ "$CONFIRM_PRODUCTION" = 1 ] || die "this host says AICC_ENV=production: pass --production-host --confirm-production to change it with this installer"
fi
[ "$(id -u)" = "0" ] || is_dry || [ -n "$AICC_PREFIX" ] || die "must run as root (sudo). Refusing. (use --dry-run to preview as a normal user)"
for s in $STEPS; do run_step "$s"; done
printf '\nDONE: steps run: %s%s\n' "$STEPS" "$(is_dry && echo ' (dry-run: nothing changed)')"
