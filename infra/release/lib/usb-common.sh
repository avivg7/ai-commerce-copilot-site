#!/usr/bin/env bash
# SOURCED by infra/release/usb-key-ceremony.sh and infra/release/sign-plugin-release-usb.sh (P45 passwordless USB signing). bash 3.2 compatible (macOS). Never executed on its own.
# There is NO password prompt and no unlock step anywhere in this tooling: the only interactive input is a typed CONFIRMATION phrase (usb_confirm).
# The secret key is only ever (a) a file at a fixed path on the stick, (b) read inside PHP/python processes by PATH or through a pipe, (c) never printed, never an argument, never in the environment.
USB_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USB_PY=(python3 -I "$USB_LIB_DIR/usb_tools.py")
USB_PHP="$USB_LIB_DIR/usb_sign.php"
USB_FOLDER="AICC-RELEASE-SIGNING"

# ---- process hygiene: umask, no core dumps, no tracing, no shell history ------------------------------------------------------------------------------------------------------------------------
usb_hygiene() {
  umask 077; ulimit -c 0 2>/dev/null || true
  # a traced run would print every variable and command (including paths and confirmation phrases); the scripts handle no secret in variables, but tracing is refused anyway
  case "$-" in *x*) echo "REFUSED: this script must not run with xtrace (set -x / bash -x): it is refused so that no trace can ever capture key-handling output" >&2; exit 3 ;; esac
  case ":${SHELLOPTS:-}:" in *:xtrace:*) echo "REFUSED: SHELLOPTS contains xtrace: unset it" >&2; exit 3 ;; esac
  [ -z "${BASH_XTRACEFD:-}" ] || { echo "REFUSED: BASH_XTRACEFD is set: unset it" >&2; exit 3; }
  set +o history 2>/dev/null || true; unset HISTFILE HISTSIZE 2>/dev/null || true
}
usb_refuse() { echo "REFUSED: $*" >&2; exit 3; }
usb_fail()   { echo "FAILED: $*" >&2; exit 1; }
usb_note()   { echo "  $*"; }

usb_need_tools() {
  command -v php >/dev/null 2>&1 && php -r 'exit(function_exists("sodium_crypto_sign_detached")?0:1);' || usb_refuse "php with ext-sodium is required"
  command -v python3 >/dev/null 2>&1 || usb_refuse "python3 is required"
  command -v diskutil >/dev/null 2>&1 || usb_refuse "diskutil is required (this tooling is for macOS)"
  "${USB_PY[@]}" selftest >/dev/null || usb_refuse "the independent Ed25519 implementation failed its RFC 8032 self-test"
}

# ---- the test seam: loud, never silent ----------------------------------------------------------------------------------------------------------------------------------------------------------
usb_harness_banner() {
  [ "${AICC_TEST_HARNESS:-}" = "1" ] || return 0
  [ -n "${USB_BANNER_SHOWN:-}" ] && return 0
  USB_BANNER_SHOWN=1
  {
    echo "################################################################################################"
    echo "## AICC_TEST_HARNESS=1  --  TEST MODE: a THROWAWAY DISK IMAGE under the system temp dir stands in ##"
    echo "## for a USB stick. This is accepted ONLY for such an image, NEVER for a real stick (/Volumes/..).##"
    echo "## A signature made in this mode is a TEST ARTIFACT. Never use this variable for a real signing.  ##"
    echo "################################################################################################"
  } >&2
}

# ---- classification of the volume: sets U_<key> variables; exits 3 with the reason when the path is not a physical USB stick -----------------------------------------------------------------
# usb_classify <mount> [--serial]
usb_classify() {
  local mp="$1" shift_serial="${2:-}" line k v rc=0 tmp
  usb_harness_banner
  tmp="$(mktemp "${TMPDIR:-/tmp}/aicc-usbc.XXXXXX")" || usb_refuse "cannot create a temp file"
  "${USB_PY[@]}" classify --usb "$mp" $shift_serial > "$tmp" 2>"$tmp.err" || rc=$?
  if [ "$rc" != 0 ]; then
    cat "$tmp.err" >&2; rm -f "$tmp" "$tmp.err"; exit 3
  fi
  while IFS=$'\t' read -r k v; do
    case "$k" in *[!a-z_]*|"") continue ;; esac
    printf -v "U_$k" '%s' "$v"
  done < "$tmp"
  rm -f "$tmp" "$tmp.err"
  [ -n "${U_volume_uuid:-}" ] || usb_refuse "the volume has no UUID: it cannot be identified (reformat is the owner's decision; this tool never formats)"
}

# non-POSIX filesystems and the noowners mount flag mean: file modes are NOT enforced; any local user (and anyone holding the stick) can read the key
usb_perms_static() {  # echoes yes|no
  case ",$U_mount_flags," in *,noowners,*) echo no; return ;; esac
  case "$U_fs_type" in msdos|exfat|ntfs|udf|cd9660|fuse*|macfuse) echo no ;; *) echo yes ;; esac
}
# active probe on a WRITABLE volume: create a temp file, chmod 0600 then 0644, read the modes back, delete it (and any AppleDouble sidecar it caused)
usb_perms_probe() {  # <mount> echoes yes|no|unwritable
  local mp="$1" p m1 m2
  p="$mp/.aicc-probe.$$"
  ( umask 022; : > "$p" ) 2>/dev/null || { echo unwritable; return; }
  chmod 0600 "$p" 2>/dev/null; m1="$(stat -f '%Lp' "$p" 2>/dev/null || stat -c '%a' "$p")"
  chmod 0644 "$p" 2>/dev/null; m2="$(stat -f '%Lp' "$p" 2>/dev/null || stat -c '%a' "$p")"
  rm -f "$p" "$mp/._.aicc-probe.$$"
  if [ "$m1" = 600 ] && [ "$m2" = 644 ]; then echo yes; else echo no; fi
}

usb_keydir()  { printf '%s/%s' "$1" "$USB_FOLDER"; }
usb_keyfile() { printf '%s/%s/aicc-release-%s.key' "$1" "$USB_FOLDER" "$2"; }
usb_idfile()  { printf '%s/%s/aicc-release-%s.identity.json' "$1" "$USB_FOLDER" "$2"; }
usb_upper()   { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }
usb_uuid8()   { printf '%s' "$1" | tr -d '-' | cut -c1-8 | tr '[:lower:]' '[:upper:]'; }
usb_utc()     { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
usb_size_of() { stat -f '%z' "$1" 2>/dev/null || stat -c '%s' "$1"; }

# AppleDouble (`._*`) sidecars that are OURS: anything in our own key folder, `._AICC-RELEASE-SIGNING` at the stick root, and the probe file's sidecar. A legacy `._aicc-keys-*.dmg` (or any other `._*` at the
# root) belongs to the old vault files: it is never counted, never removed.
usb_sidecars_list() {  # <mount>
  { "${USB_PY[@]}" sidecars --dir "$(usb_keydir "$1")" | sed "s#^#$USB_FOLDER/#"; "${USB_PY[@]}" sidecars --dir "$1" | grep -E '^\._(AICC-RELEASE-SIGNING$|\.aicc-probe\.)' || true; } 2>/dev/null
}
usb_sidecars_remove_ours() {  # <mount>: only ours; every other file of the stick is never touched
  local mp="$1" f
  for f in "$(usb_keydir "$mp")"/._* "$mp/._$USB_FOLDER" "$mp"/._.aicc-probe.*; do [ -e "$f" ] && rm -f "$f"; done
  return 0
}

# the key folder must be a REAL directory on the stick itself: no symlink at or above it inside the mount, and its resolved path must be exactly <mount>/AICC-RELEASE-SIGNING
usb_check_keydir() {  # <mount>; returns 0 when fine
  local mp="$1" kd; kd="$(usb_keydir "$mp")"
  [ -d "$kd" ] && [ ! -L "$kd" ] || return 1
  [ "$(cd "$kd" && pwd -P)" = "$(cd "$mp" && pwd -P)/$USB_FOLDER" ]
}

# a Plugin checkout that git cannot see through: clean status INCLUDING ignored files, and no assume-unchanged / skip-worktree entries (plain `git status` is fooled by both)
usb_git_pristine() {  # <dir> echoes the reason and returns 1 when not pristine
  local d="$1" n
  [ -z "$(git -C "$d" status --porcelain 2>/dev/null)" ] || { echo "the Plugin checkout is not clean (git status shows changes): use a clean checkout of the pinned commit"; return 1; }
  n="$(git -C "$d" ls-files -v 2>/dev/null | grep -c '^[a-zS]' || true)"
  [ "$n" = 0 ] || { echo "the Plugin checkout has $n file(s) hidden from git status (assume-unchanged / skip-worktree): use a fresh clone of the pinned commit"; return 1; }
  [ -z "$(git -C "$d" status --porcelain --ignored 2>/dev/null)" ] || { echo "the Plugin checkout has ignored files hidden from git status: use a fresh clone of the pinned commit"; return 1; }
  return 0
}

# the public key of a key file, derived THREE ways. Sets K_PUB, K_FP, K_INDEP (a text of what agreed). Never prints the key.
usb_derive() {  # <key file> [--independent]
  local kf="$1" out line k v
  out="$(php "$USB_PHP" derive --key-file "$kf" 2>&1)" || usb_fail "the key file is unusable: ${out#usb_sign: }"
  K_PUB="$(printf '%s\n' "$out" | sed -n 's/^pub=//p')"; K_FP="$(printf '%s\n' "$out" | sed -n 's/^fp=//p')"
  [ -n "$K_PUB" ] && [ -n "$K_FP" ] || usb_fail "could not derive the public key"
  K_INDEP=""
  [ "${2:-}" = "--independent" ] || return 0
  out="$("${USB_PY[@]}" ed25519 --openssl < "$kf")" || usb_fail "the independent re-derivation of the public key FAILED (python RFC 8032): do not use this key"
  local pyp opp
  pyp="$(printf '%s\n' "$out" | sed -n 's/^pub_python\t//p')"; opp="$(printf '%s\n' "$out" | sed -n 's/^pub_openssl\t//p')"
  [ "$pyp" = "$K_PUB" ] || usb_fail "the independent python derivation ($pyp) differs from libsodium's ($K_PUB): do not use this key"
  K_INDEP="libsodium (re-derived from the seed) = independent pure-python RFC 8032"
  if [ -n "$opp" ] && [ "$opp" != unavailable ]; then
    [ "$opp" = "$K_PUB" ] || usb_fail "OpenSSL's derivation differs from libsodium's: do not use this key"
    K_INDEP="$K_INDEP = OpenSSL"
  else
    K_INDEP="$K_INDEP (OpenSSL could not do Ed25519 here: two implementations, not three)"
  fi
}

# usb_confirm <exact phrase>: the ONLY interactive input of this tooling. Reads one line from stdin (never silent, never a secret); stdin closed/empty or any other text refuses.
usb_confirm() {
  local want="$1" got=""
  echo
  echo "  To continue, type exactly this phrase and press Enter (anything else stops here):"
  echo "      $want"
  printf '  > '
  IFS= read -r got || { echo; usb_refuse "no confirmation was typed (stdin is closed or empty): nothing was done"; }
  [ "$got" = "$want" ] || usb_refuse "the confirmation phrase did not match: nothing was done"
}

usb_check_handover_dir() {  # <dir> <mount>: outside git, outside cloud-synced paths, not on the stick. Everything is decided BEFORE anything is created.
  local d="$1" mp="$2" anc rest real low q mreal
  case "$d" in /*) ;; *) d="$PWD/$d" ;; esac
  anc="$d"; rest=""
  while [ ! -e "$anc" ] && [ "$anc" != / ]; do rest="/$(basename "$anc")$rest"; anc="$(dirname "$anc")"; done
  real="$(cd "$anc" && pwd -P)$rest"; low="$(printf '%s' "$real" | tr '[:upper:]' '[:lower:]')"; mreal="$(cd "$mp" && pwd -P)"
  case "$real/" in "$mreal"/*|"$mp"/*) usb_refuse "the handover directory must not be on the stick" ;; esac
  for q in "mobile documents" icloud dropbox "google drive" googledrive onedrive cloudstorage "box sync" pcloud nextcloud; do
    case "$low" in *"$q"*) usb_refuse "the handover directory $real is in a cloud-synced location ($q)" ;; esac
  done
  q="$real"; while :; do [ -e "$q/.git" ] && usb_refuse "the handover directory $real is inside a git repository"; [ "$q" = / ] && break; q="$(dirname "$q")"; done
  mkdir -p "$real" 2>/dev/null && chmod 700 "$real" 2>/dev/null || usb_refuse "cannot create the handover directory $real"
  USB_HANDOVER_REAL="$(cd "$real" && pwd -P)"
}
