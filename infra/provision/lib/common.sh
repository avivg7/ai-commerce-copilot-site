#!/usr/bin/env bash
# Shared helpers for the AICC stack provisioning scripts (sourced, never executed).
#
# Contract for every script that sources this file:
#   * dry-run:     AICC_DRY_RUN=1 (set by --dry-run). Every state change goes through run()/install_file()/ensure_*(), which print what
#                  they WOULD do and change nothing. Read-only probes still run.
#   * idempotent:  each helper first compares the current state with the wanted state and only then changes it ("unchanged" otherwise).
#   * fail closed: callers use `set -euo pipefail`; helpers call die() on anything unexpected instead of continuing.
#   * no secrets:  nothing here prints or logs secret values. Secrets are only ever written to 0600 files by the callers that create them.
#
# TEST HARNESS: AICC_TEST_HARNESS=1 together with AICC_ROOT_PREFIX=<dir> re-roots every absolute destination path under <dir> and skips
# chown/systemctl/apt. It exists so infra/stack-tests can prove the idempotence logic on a Mac. It is ignored unless BOTH are set.

AICC_DRY_RUN="${AICC_DRY_RUN:-0}"
AICC_CHANGED=0          # set to 1 by any helper that changed (or, in dry-run, would change) something
AICC_PREFIX=""
if [ "${AICC_TEST_HARNESS:-0}" = "1" ] && [ -n "${AICC_ROOT_PREFIX:-}" ]; then AICC_PREFIX="${AICC_ROOT_PREFIX%/}"; fi

_ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log()  { printf '%s  %s\n' "$(_ts)" "$*"; }
info() { printf '%s  INFO  %s\n' "$(_ts)" "$*"; }
warn() { printf '%s  WARN  %s\n' "$(_ts)" "$*" >&2; }
die()  { printf '%s  FATAL %s\n' "$(_ts)" "$*" >&2; exit 1; }
would(){ printf '%s  DRY-RUN would: %s\n' "$(_ts)" "$*"; AICC_CHANGED=1; }
step() { printf '\n==== step: %s ====\n' "$*"; }

# P <abs path>: path under the test prefix (identity when no prefix)
P() { printf '%s%s' "$AICC_PREFIX" "$1"; }

is_linux() { [ "$(uname -s)" = "Linux" ]; }
is_dry() { [ "$AICC_DRY_RUN" = "1" ]; }

# run <cmd...>: execute, or print in dry-run
run() {
  if is_dry; then would "$*"; return 0; fi
  info "run: $*"
  "$@"
}

require_root() {
  [ -n "$AICC_PREFIX" ] && return 0      # test harness: everything is re-rooted under a temp prefix, nothing real is touched
  if [ "$(id -u)" != "0" ]; then
    if is_dry; then warn "not root: continuing only because --dry-run changes nothing"; return 0; fi
    die "must run as root (sudo). Refusing."
  fi
}

# sha helpers (GNU coreutils on the host, shasum on macOS)
sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
sha512_of() { if command -v sha512sum >/dev/null 2>&1; then sha512sum "$1" | awk '{print $1}'; else shasum -a 512 "$1" | awk '{print $1}'; fi; }

# stat helpers: mode (octal) / owner:group, GNU first then BSD
mode_of()  { stat -c '%a' "$1" 2>/dev/null || stat -f '%Mp%Lp' "$1" | sed -e 's/^0*//' -e 's/^$/0/'; }
owner_of() { stat -c '%U:%G' "$1" 2>/dev/null || stat -f '%Su:%Sg' "$1"; }

# load_pins <file>: source KEY=VALUE pins (the file is in this repo, reviewed; refuse anything that is not KEY=VALUE or a comment)
load_pins() {
  local f="$1" bad
  [ -r "$f" ] || die "pins file not readable: $f"
  bad="$(grep -Ev '^[[:space:]]*(#.*)?$|^[A-Z][A-Z0-9_]*=([^[:space:]`$();|&<>'"'"'"]*|'"'"'[^'"'"'`$]*'"'"')$' "$f" || true)"
  [ -z "$bad" ] || die "pins file $f has lines that are not plain KEY=VALUE: $bad"
  # shellcheck disable=SC1090
  . "$f"
}

# ensure_pkgs <pkg...>: apt-get install only the packages that are missing (no recommends: small host)
ensure_pkgs() {
  local missing=() p
  if [ -n "$AICC_PREFIX" ]; then info "harness: skipping apt for: $*"; return 0; fi
  for p in "$@"; do
    if is_linux && command -v dpkg-query >/dev/null 2>&1; then
      dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q '^install ok installed$' || missing+=("$p")
    else
      missing+=("$p")
    fi
  done
  if [ "${#missing[@]}" -eq 0 ]; then info "packages already installed: $*"; return 0; fi
  if is_dry; then would "apt-get install -y --no-install-recommends ${missing[*]}"; return 0; fi
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
}

# ensure_group <name> / ensure_system_user <name> <home> [primary-group]
ensure_group() {
  local g="$1"
  if [ -n "$AICC_PREFIX" ]; then info "harness: group $g (skipped)"; return 0; fi
  if getent group "$g" >/dev/null 2>&1; then info "group $g: unchanged"; return 0; fi
  run groupadd --system "$g"
}
ensure_system_user() {
  local u="$1" home="$2" grp="${3:-$1}"
  if [ -n "$AICC_PREFIX" ]; then info "harness: user $u (skipped)"; return 0; fi
  if id "$u" >/dev/null 2>&1; then info "user $u: unchanged"; return 0; fi
  ensure_group "$grp"
  run useradd --system --gid "$grp" --home-dir "$home" --no-create-home --shell /usr/sbin/nologin --comment "AICC $u" "$u"
}
ensure_user_in_group() {
  local u="$1" g="$2"
  if [ -n "$AICC_PREFIX" ]; then return 0; fi
  if id -nG "$u" 2>/dev/null | tr ' ' '\n' | grep -qx "$g"; then info "user $u already in group $g"; return 0; fi
  run usermod -a -G "$g" "$u"
}

# ensure_dir <mode> <owner:group> <path>
ensure_dir() {
  local mode="$1" own="$2" path dest cur curown
  path="$3"; dest="$(P "$path")"
  if [ -d "$dest" ]; then
    cur="$(mode_of "$dest")"; curown="$(owner_of "$dest")"
    if [ "$cur" = "${mode#0}" ] || [ "$cur" = "$mode" ]; then :; else
      if is_dry; then would "chmod $mode $path (now $cur)"; else chmod "$mode" "$dest"; AICC_CHANGED=1; info "chmod $mode $path (was $cur)"; fi
    fi
    if [ -z "$AICC_PREFIX" ] && [ "$curown" != "$own" ]; then
      if is_dry; then would "chown $own $path (now $curown)"; else chown "$own" "$dest"; AICC_CHANGED=1; info "chown $own $path (was $curown)"; fi
    fi
    return 0
  fi
  if is_dry; then would "mkdir $path (mode $mode owner $own)"; return 0; fi
  mkdir -p "$dest"; chmod "$mode" "$dest"
  [ -n "$AICC_PREFIX" ] || chown "$own" "$dest"
  AICC_CHANGED=1; info "created $path ($mode $own)"
}

# CONFIG_BACKUP_DIR: where the previous version of a replaced config file is kept (never deleted by these scripts)
config_backup_dir() { printf '%s' "$(P /var/backups/aicc-config)/$(date -u +%Y%m%dT%H%M%SZ)"; }

# install_file <src> <dest-abs-path> <mode> <owner:group>
# Copies only when content, mode or owner differ; keeps the previous version under /var/backups/aicc-config/<ts>/; atomic (temp file + rename).
install_file() {
  local src="$1" path="$2" mode="$3" own="$4" dest tmp cur curown bk
  dest="$(P "$path")"
  [ -r "$src" ] || die "install_file: source missing: $src"
  if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
    cur="$(mode_of "$dest")"; curown="$(owner_of "$dest")"
    if { [ "$cur" = "${mode#0}" ] || [ "$cur" = "$mode" ]; } && { [ -n "$AICC_PREFIX" ] || [ "$curown" = "$own" ]; }; then
      info "unchanged: $path"; return 0
    fi
  fi
  if is_dry; then
    if [ -f "$dest" ]; then would "replace $path (mode $mode owner $own); diff follows"; diff -u "$dest" "$src" | sed 's/^/    /' | head -60 || true
    else would "create $path (mode $mode owner $own) from ${src}"; fi
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ]; then bk="$(config_backup_dir)$path"; mkdir -p "$(dirname "$bk")"; cp -p "$dest" "$bk"; info "previous version kept: $bk"; fi
  tmp="$(mktemp "$(dirname "$dest")/.aicc-new.XXXXXX")"
  cp "$src" "$tmp"; chmod "$mode" "$tmp"
  [ -n "$AICC_PREFIX" ] || chown "$own" "$tmp"
  mv -f "$tmp" "$dest"
  AICC_CHANGED=1; info "installed: $path (mode $mode owner $own)"
}

# install_text <dest> <mode> <owner:group>  (content on stdin) -- same semantics as install_file, for generated content (never secrets)
install_text() {
  local t; t="$(mktemp)"; cat > "$t"
  install_file "$t" "$1" "$2" "$3"; local rc=$?
  rm -f "$t"; return $rc
}

# ensure_symlink <target> <link>
ensure_symlink() {
  local target="$1" link; link="$(P "$2")"
  if [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ]; then info "unchanged: $2 -> $target"; return 0; fi
  if is_dry; then would "ln -sfn $target $2"; return 0; fi
  mkdir -p "$(dirname "$link")"; ln -sfn "$target" "$link"; AICC_CHANGED=1; info "symlink $2 -> $target"
}

# download <url> <dest-file>: HTTPS only, follows redirects, fails on HTTP errors, bounded time
download() {
  local url="$1" out="$2"
  case "$url" in https://*) ;; *) die "refusing non-https download: $url";; esac
  if is_dry; then would "download $url"; return 0; fi
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 3 --max-time 300 -o "$out" "$url"
}

# svc_reload_or_restart <unit> <reload|restart>: no-op in harness; in dry-run prints
svc() {
  local action="$1" unit="$2"
  if [ -n "$AICC_PREFIX" ]; then info "harness: systemctl $action $unit (skipped)"; return 0; fi
  run systemctl "$action" "$unit"
}

# list of valid step names helper
in_list() { local needle="$1"; shift; local x; for x in "$@"; do [ "$x" = "$needle" ] && return 0; done; return 1; }

# Production addresses and names that provisioning/deploy tooling must never touch.
AICC_PROD_IPS="139.59.157.231"
AICC_PROD_HOSTS="www.copilt.org copilt.org api.copilt.org"
refuse_production_ip() { local ip; for ip in $AICC_PROD_IPS; do [ "$1" = "$ip" ] && die "REFUSED: $1 is the production API address."; done; return 0; }
refuse_production_host() { local h; for h in $AICC_PROD_HOSTS; do [ "$1" = "$h" ] && die "REFUSED: $1 is a production hostname."; done; return 0; }
