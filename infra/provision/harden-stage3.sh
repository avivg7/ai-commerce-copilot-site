#!/usr/bin/env bash
# STAGE 3 host hardening for the STAGING Droplet (security review L8, 2026-10-21). Idempotent, --dry-run, refuses anything that is not the staging host.
#     sudo infra/provision/harden-stage3.sh [--dry-run] [--max-age-min 60] [--skip-ssh] [--skip-services]
# Run it from your FIRST session, AFTER stage 2 (harden-stage2.sh) and with a fresh two-session marker (stage2-verify-second-session.sh in a SECOND session, as for stage 2).
#
#   (i)   SSH crypto allow-list: /etc/ssh/sshd_config.d/06-aicc-stage3-crypto.conf (sorts after 05-aicc-stage2.conf and before cloud-init's 10-aicc-hardening.conf, OpenSSH keeps the
#         FIRST value it reads): Ciphers chacha20-poly1305, aes256-gcm, aes128-gcm; KexAlgorithms curve25519-sha256 (+ the @libssh.org alias and the sntrup761x25519 hybrid of
#         OpenSSH >= 9.0); MACs hmac-sha2-512-etm / hmac-sha2-256-etm (the AEAD ciphers need none; this only closes the legacy list: aes*-ctr, hmac-sha1, umac-64 are gone).
#         Validated by `sshd -t` and by the EFFECTIVE `sshd -T` (it must report exactly the wanted lists) BEFORE a reload; on any problem the file is reverted and sshd is NOT reloaded.
#         `systemctl reload ssh` (SIGHUP) never closes an existing session. A client that only speaks the removed algorithms (very old OpenSSH, some embedded clients) can no longer
#         connect: open a THIRD session from the Mac to prove yours still can BEFORE closing the first one. Rollback: rm the file, `sshd -t`, `systemctl reload ssh`.
#   (ii)  unused services are stopped, disabled and MASKED: snapd (+ socket, seeded), ModemManager, udisks2, multipathd (+ socket). Each is checked first and SKIPPED with the reason when
#         something that matters depends on it or it is in use: a reverse dependency among do-agent, droplet-agent, ssh, mysql, php8.3-fpm, aicc-*, fail2ban, chrony, cloud-init,
#         unattended-upgrades; installed snaps (snapd is kept if any snap other than the base/core snaps is installed, e.g. a snap-packaged DigitalOcean agent); multipath maps in use.
#         do-agent and droplet-agent are NEVER touched. Rollback: `systemctl unmask <unit> && systemctl enable --now <unit>`.
#   (iii) the cloud-firewall narrowing of port 22 to the operator's address(es) is an [OWNER] decision in the DigitalOcean panel and is only DOCUMENTED here (printed at the end), never applied.
# Exit: 0 done / unchanged, 1 refused or failed (nothing half-applied: the SSH file is reverted), 2 usage.
set -euo pipefail
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF/lib/common.sh"
. "$SELF/lib/ssh-session.sh"
MAX_AGE_MIN=60; DO_SSH=1; DO_SVC=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) AICC_DRY_RUN=1; shift ;;
    --max-age-min) MAX_AGE_MIN="${2:-}"; [[ "$MAX_AGE_MIN" =~ ^[0-9]+$ ]] || die "--max-age-min needs a number"; shift 2 ;;
    --skip-ssh) DO_SSH=0; shift ;;
    --skip-services) DO_SVC=0; shift ;;
    -h|--help) sed -n 2,22p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
MARKER="$STAGE2_MARKER_DEFAULT"; SSHD="sshd"; SSHD_DIR=/etc/ssh/sshd_config.d; SYSTEMCTL="systemctl"; IDENT=/etc/aicc-stage-identity; SNAP="snap"; MULTIPATH="multipath"
if [ "${AICC_TEST_HARNESS:-0}" = "1" ]; then
  MARKER="${AICC_MARKER_PATH:-$MARKER}"; SSHD="${AICC_SSHD_BIN:-$SSHD}"; SSHD_DIR="${AICC_SSHD_DIR:-$SSHD_DIR}"; SYSTEMCTL="${AICC_SYSTEMCTL_BIN:-$SYSTEMCTL}"
  IDENT="${AICC_IDENTITY_FILE:-$IDENT}"; SNAP="${AICC_SNAP_BIN:-$SNAP}"; MULTIPATH="${AICC_MULTIPATH_BIN:-$MULTIPATH}"
else
  [ "$(id -u)" = "0" ] || die "must run as root (sudo). Refusing."
fi

# ---- 0. this is the STAGING host (fail closed) -------------------------------------------------------------------------------------------
[ -r "$IDENT" ] || die "$IDENT is missing: this does not look like the staging host. Refusing."
grep -q '^AICC_ENV=staging$' "$IDENT" || die "$IDENT does not say AICC_ENV=staging. Refusing."
IDHOST="$(sed -n 's/^AICC_HOSTNAME=//p' "$IDENT" | head -1)"
[[ "$IDHOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || die "the identity host '$IDHOST' is not a stage*.copilt.org name. Refusing."
case "$IDHOST" in www.copilt.org|copilt.org|api.copilt.org) die "REFUSED: $IDHOST is a production hostname." ;; esac
info "staging host confirmed: $IDHOST"

# ---- 1. two-session safeguard (same rules as stage 2) ---------------------------------------------------------------------------------------
require_second_session_marker "$MARKER" "$MAX_AGE_MIN"

# ---- (i) SSH crypto ------------------------------------------------------------------------------------------------------------------------------
DROPIN="$SSHD_DIR/06-aicc-stage3-crypto.conf"
W_CIPHERS="chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com"
W_KEX="curve25519-sha256,curve25519-sha256@libssh.org,sntrup761x25519-sha512@openssh.com"
W_MACS="hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com"
RELOAD=0
if [ "$DO_SSH" = 1 ]; then
  step "ssh crypto allow-list"
  # stage 2 must be in force (this script does not weaken or replace it)
  pre="$("$SSHD" -T -C user=aicc,host=localhost,addr=127.0.0.1 2>/dev/null || true)"
  echo "$pre" | grep -q '^permitrootlogin no$' && echo "$pre" | grep -q '^allowusers aicc$' || die "stage 2 is not in force (sshd -T: permitrootlogin no + allowusers aicc). Run harden-stage2.sh first. Refusing."
  WANT="$(cat <<EOT
# AICC stage 3 (written by infra/provision/harden-stage3.sh): modern algorithms only. Sorts before 10-aicc-hardening.conf on purpose: OpenSSH keeps the FIRST value.
# Rollback: remove this file, run \`sshd -t\`, then \`systemctl reload ssh\`. The DigitalOcean web console works regardless of this file.
Ciphers $W_CIPHERS
KexAlgorithms $W_KEX
MACs $W_MACS
EOT
)"
  if [ -f "$DROPIN" ] && [ "$(cat "$DROPIN")" = "$WANT" ]; then info "unchanged: $DROPIN"
  elif is_dry; then would "write $DROPIN (Ciphers, KexAlgorithms, MACs allow-lists); sshd -t; sshd -T must report exactly them; systemctl reload ssh"
  else
    mkdir -p "$SSHD_DIR"
    BAK=""; if [ -f "$DROPIN" ]; then BAK="$(mktemp)"; cp -p "$DROPIN" "$BAK"; fi
    printf '%s\n' "$WANT" > "$DROPIN.new"; chmod 0644 "$DROPIN.new"; mv -f "$DROPIN.new" "$DROPIN"
    revert() { if [ -n "$BAK" ]; then cp -p "$BAK" "$DROPIN"; else rm -f "$DROPIN"; fi; }
    if ! "$SSHD" -t; then revert; die "sshd -t rejected the configuration: change reverted, sshd NOT reloaded"; fi
    eff="$("$SSHD" -T -C user=aicc,host=localhost,addr=127.0.0.1 2>/dev/null || true)"
    [ "$(echo "$eff" | sed -n 's/^ciphers //p')" = "$W_CIPHERS" ] || { revert; die "effective ciphers differ from the allow-list (an earlier file wins?): change reverted, sshd NOT reloaded"; }
    [ "$(echo "$eff" | sed -n 's/^kexalgorithms //p')" = "$W_KEX" ] || { revert; die "effective KexAlgorithms differ from the allow-list: change reverted, sshd NOT reloaded"; }
    [ "$(echo "$eff" | sed -n 's/^macs //p')" = "$W_MACS" ] || { revert; die "effective MACs differ from the allow-list: change reverted, sshd NOT reloaded"; }
    echo "$eff" | grep -q '^permitrootlogin no$' && echo "$eff" | grep -q '^allowusers aicc$' || { revert; die "stage 2 settings are no longer effective: change reverted, sshd NOT reloaded"; }
    [ -n "$BAK" ] && rm -f "$BAK"
    RELOAD=1; info "validated: sshd -t OK; effective ciphers/KEX/MACs are the allow-lists; stage 2 settings still effective"
  fi
  if [ "$RELOAD" = 1 ]; then
    "$SYSTEMCTL" reload ssh || { rm -f "$DROPIN"; die "reload failed; drop-in removed. Check: systemctl status ssh"; }
    info "sshd reloaded (existing sessions untouched)"
  fi
fi

# ---- (ii) unused services ------------------------------------------------------------------------------------------------------------------------
PROTECTED_RE='^(do-agent|droplet-agent|ssh|sshd|mysql|php8\.3-fpm|aicc-[a-z-]+|fail2ban|chrony|cloud-init|cloud-init-local|cloud-config|cloud-final|unattended-upgrades|systemd-[a-z-]+)(\.service|\.socket|\.timer|\.target)?$'
mask_state() { "$SYSTEMCTL" is-enabled "$1" 2>/dev/null || true; }
unit_known() { "$SYSTEMCTL" cat "$1" >/dev/null 2>&1; }
reverse_deps() { "$SYSTEMCTL" list-dependencies --reverse --plain "$1" 2>/dev/null | sed -e 's/^[ ●*]*//' -e '/^$/d' | grep -v "^$1\$" || true; }
disable_unit() { # disable_unit <unit> [reason-to-skip-prefix]
  local u="$1" st d blockers=""
  st="$(mask_state "$u")"
  if [ "$st" = "masked" ]; then info "unchanged: $u is already masked"; return 0; fi
  if ! unit_known "$u"; then info "absent: $u is not installed (nothing to do)"; return 0; fi
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    if [[ "$d" =~ $PROTECTED_RE ]]; then blockers="$blockers $d"; fi
  done < <(reverse_deps "$u")
  if [ -n "$blockers" ]; then warn "SKIPPED $u: required by${blockers}"; return 0; fi
  if is_dry; then would "systemctl disable --now $u && systemctl mask $u"; return 0; fi
  "$SYSTEMCTL" disable --now "$u" >/dev/null 2>&1 || true
  "$SYSTEMCTL" mask "$u" >/dev/null 2>&1 || { warn "could not mask $u"; return 0; }
  AICC_CHANGED=1; info "disabled and masked: $u"
}
if [ "$DO_SVC" = 1 ]; then
  step "unused services (do-agent and droplet-agent are never touched)"
  # snapd: only when no snap beyond the base/core ones is installed (a snap-packaged cloud agent must keep working)
  SNAPD_OK=1
  if command -v "$SNAP" >/dev/null 2>&1; then
    extra="$("$SNAP" list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Ev '^(core[0-9]*|snapd|bare|gtk-common-themes|gnome-[0-9-]+)$' || true)"
    if [ -n "$extra" ]; then SNAPD_OK=0; warn "SKIPPED snapd: snaps are installed that need it: $(echo $extra | tr '\n' ' ')"; fi
  fi
  if [ "$SNAPD_OK" = 1 ]; then for u in snapd.seeded.service snapd.socket snapd.service; do disable_unit "$u"; done; fi
  disable_unit ModemManager.service
  disable_unit udisks2.service
  MP_OK=1
  if command -v "$MULTIPATH" >/dev/null 2>&1 && [ -n "$("$MULTIPATH" -ll 2>/dev/null || true)" ]; then MP_OK=0; warn "SKIPPED multipathd: multipath maps exist"; fi
  if [ "$MP_OK" = 1 ]; then disable_unit multipathd.socket; disable_unit multipathd.service; fi
fi

# ---- (iii) documented, not applied ------------------------------------------------------------------------------------------------------------
cat <<EOT

DONE (stage 3). NOW: from your Mac open a THIRD login as aicc to prove SSH still works with the new algorithms BEFORE you close this session:
    ssh -i ~/.ssh/aicc_cp_stage -o IdentitiesOnly=yes aicc@<ip> 'sudo sshd -T -C user=aicc,host=x,addr=127.0.0.1 | grep -E "^(ciphers|kexalgorithms|macs) "'
ROLLBACK:  sudo rm $DROPIN && sudo sshd -t && sudo systemctl reload ssh      (services: sudo systemctl unmask <unit> && sudo systemctl enable --now <unit>)

[OWNER DECISION, NOT APPLIED]  DigitalOcean Cloud Firewall: restrict inbound TCP 22 to the operator's address(es) instead of the whole internet (key-only, AllowUsers aicc, root refused and
fail2ban already limit the exposure; a narrowed rule removes the scan noise but locks you out when your address changes: keep the DigitalOcean web console as the way back in, and
edit the rule in the panel). 80/443 stay open to everyone. This script never calls any DigitalOcean API.
EOT
