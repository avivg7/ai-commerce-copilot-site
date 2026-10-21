#!/usr/bin/env bash
# Installs the restricted off-host pull access on the HOST (run as root, over the operator session). OWNER-APPROVED model (Phase 2B, 2026-10-21):
#     sudo infra/backup/install-offhost-access.sh --pubkey-file /path/to/aicc_offhost.pub [--dry-run]
#
# Creates the least-privilege path the owner's Mac uses for UNATTENDED backup pulls:
#   * account `aicc-offhost` (no password, home /var/lib/aicc-offhost, shell /bin/bash only because sshd runs ForceCommand through it);
#   * /usr/local/sbin/aicc-offhost-serve (root-owned): identity / status / get <backup file> / ack ... and nothing else;
#   * /etc/sudoers.d/aicc-offhost: that account may run THAT ONE script as root, with any arguments (the script validates them);
#   * /etc/ssh/sshd_config.d/06-aicc-offhost.conf: AllowUsers aicc-offhost is added (AllowUsers lists accumulate, so `aicc` keeps working) and a
#     `Match User aicc-offhost` block forces the command, removes TTY, forwarding, agent, X11, tunnels and passwords;
#   * ~aicc-offhost/.ssh/authorized_keys: the given public key with `restrict,command=...` as a second lock (the key itself cannot open a shell either).
# The pull key therefore cannot: log in interactively, run any other command, read anything except backup files named by the strict pattern, write
# anything except offhost-ack.json (and only for a set whose hashes the host itself recorded), or forward a port.
# Fail closed: sshd -t, visudo -cf and the effective-config checks must pass before sshd is reloaded; on failure the new sshd file is reverted.
# Idempotent. Rollback: sudo infra/backup/install-offhost-access.sh --remove
# Test seam (AICC_TEST_HARNESS=1): --root DIR writes the files under DIR and skips useradd/sshd/systemctl/visudo.
set -euo pipefail
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY=0; REMOVE=0; PUBKEY_FILE=""; ROOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pubkey-file) PUBKEY_FILE="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --remove) REMOVE=1; shift ;;
    --root) ROOT="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,18p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ -n "$ROOT" ] && [ "${AICC_TEST_HARNESS:-0}" != "1" ]; then echo "--root is a test seam (AICC_TEST_HARNESS=1)" >&2; exit 2; fi
say() { printf '%s\n' "$*"; }
P() { printf '%s%s' "$ROOT" "$1"; }
if [ -z "$ROOT" ] && [ "$DRY" = 0 ] && [ "$(id -u)" != "0" ]; then echo "must run as root (sudo). Refusing." >&2; exit 2; fi
if [ -z "$ROOT" ] && [ "$DRY" = 0 ]; then
  grep -q '^AICC_ENV=staging$' /etc/aicc-stage-identity 2>/dev/null || { echo "REFUSED: /etc/aicc-stage-identity does not say AICC_ENV=staging" >&2; exit 3; }
fi

U="aicc-offhost"; HOMEDIR="/var/lib/aicc-offhost"
SERVE="/usr/local/sbin/aicc-offhost-serve"; SUDOERS="/etc/sudoers.d/aicc-offhost"; SSHD_DROP="/etc/ssh/sshd_config.d/06-aicc-offhost.conf"

if [ "$REMOVE" = 1 ]; then
  say "removing the off-host pull access"
  if [ "$DRY" = 1 ]; then say "[dry-run] rm $SUDOERS $SSHD_DROP $SERVE; sshd -t && systemctl reload ssh; userdel $U"; exit 0; fi
  rm -f "$(P $SUDOERS)" "$(P $SSHD_DROP)" "$(P $SERVE)"
  if [ -z "$ROOT" ]; then
    sshd -t && systemctl reload ssh
    if id -u "$U" >/dev/null 2>&1; then userdel "$U" || true; fi
    rm -rf "$HOMEDIR"
  fi
  say "done"; exit 0
fi

[ -n "$PUBKEY_FILE" ] && [ -r "$PUBKEY_FILE" ] || { echo "--pubkey-file <public key file> is required" >&2; exit 2; }
if grep -q 'PRIVATE KEY' "$PUBKEY_FILE"; then echo "REFUSED: that is a private key file" >&2; exit 3; fi
KEYLINE="$(grep -E '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$' "$PUBKEY_FILE" | head -1 || true)"
[ -n "$KEYLINE" ] || { echo "the file must contain one ssh-ed25519 public key line" >&2; exit 2; }
KEYBODY="$(printf '%s' "$KEYLINE" | awk '{print $1" "$2}') aicc-offhost-pull"

[ -f "$SELF/aicc-offhost-serve.sh" ] || { echo "aicc-offhost-serve.sh missing next to this installer" >&2; exit 2; }
AUTH_LINE="restrict,command=\"/usr/bin/sudo -n $SERVE \\\"\$SSH_ORIGINAL_COMMAND\\\"\" $KEYBODY"

SUDOERS_TXT="# AICC off-host pull (installed by install-offhost-access.sh). The Mac's restricted key may run ONE script as root; the script validates its argument.
$U ALL=(root) NOPASSWD: $SERVE *
Defaults:$U !requiretty, env_reset, secure_path=\"/usr/sbin:/usr/bin:/sbin:/bin\""
SSHD_TXT="# AICC off-host pull (installed by install-offhost-access.sh). AllowUsers accumulates with 05-aicc-stage2.conf (aicc keeps working).
# Rollback: sudo infra/backup/install-offhost-access.sh --remove
AllowUsers $U
Match User $U
    ForceCommand /usr/bin/sudo -n $SERVE \"\$SSH_ORIGINAL_COMMAND\"
    PermitTTY no
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
    GatewayPorts no
    PermitUserRC no
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PubkeyAuthentication yes
    MaxSessions 2"

if [ "$DRY" = 1 ]; then
  say "[dry-run] would create user $U (home $HOMEDIR), install $SERVE, write $SUDOERS and $SSHD_DROP; authorized_keys line:"
  say "  $AUTH_LINE"
  exit 0
fi

if [ -z "$ROOT" ]; then
  id -u "$U" >/dev/null 2>&1 || useradd --system --home-dir "$HOMEDIR" --create-home --shell /bin/bash --comment "AICC off-host backup pull (restricted)" "$U"
  passwd -l "$U" >/dev/null 2>&1 || true
fi
mkdir -p "$(P $HOMEDIR)/.ssh" "$(P /usr/local/sbin)" "$(P /etc/sudoers.d)" "$(P /etc/ssh/sshd_config.d)"
install -m 0755 "$SELF/aicc-offhost-serve.sh" "$(P $SERVE)"
printf '%s\n' "$AUTH_LINE" > "$(P $HOMEDIR)/.ssh/authorized_keys.new"; mv -f "$(P $HOMEDIR)/.ssh/authorized_keys.new" "$(P $HOMEDIR)/.ssh/authorized_keys"
# the home, .ssh and authorized_keys are owned by ROOT and read-only for the account: nothing that ever runs as aicc-offhost can remove the `command=` restriction
# (sshd StrictModes accepts a root-owned authorized_keys; the account only needs to read it)
chmod 755 "$(P $HOMEDIR)" "$(P $HOMEDIR)/.ssh"; chmod 644 "$(P $HOMEDIR)/.ssh/authorized_keys"
[ -n "$ROOT" ] || chown -R root:root "$HOMEDIR"
printf '%s\n' "$SUDOERS_TXT" > "$(P $SUDOERS).new"; chmod 0440 "$(P $SUDOERS).new"
if [ -z "$ROOT" ]; then visudo -cf "$SUDOERS.new" >/dev/null || { rm -f "$SUDOERS.new"; echo "visudo rejected the sudoers file: nothing installed" >&2; exit 1; }; fi
mv -f "$(P $SUDOERS).new" "$(P $SUDOERS)"
BAK=""; if [ -f "$(P $SSHD_DROP)" ]; then BAK="$(mktemp)"; cp -p "$(P $SSHD_DROP)" "$BAK"; fi
printf '%s\n' "$SSHD_TXT" > "$(P $SSHD_DROP)"; chmod 644 "$(P $SSHD_DROP)"
if [ -z "$ROOT" ]; then
  revert() { if [ -n "$BAK" ]; then cp -p "$BAK" "$SSHD_DROP"; else rm -f "$SSHD_DROP"; fi; }
  sshd -t || { revert; echo "sshd -t rejected the configuration: change reverted, sshd NOT reloaded" >&2; exit 1; }
  eff="$(sshd -T -C "user=$U,host=localhost,addr=127.0.0.1" 2>/dev/null || true)"
  echo "$eff" | grep -q '^forcecommand ' || { revert; echo "ForceCommand is not effective for $U: reverted" >&2; exit 1; }
  echo "$eff" | grep -q '^permittty no$' || { revert; echo "PermitTTY is not effective for $U: reverted" >&2; exit 1; }
  echo "$eff" | grep -qE '^allowusers .*aicc-offhost' || { revert; echo "AllowUsers lacks $U: reverted" >&2; exit 1; }
  echo "$eff" | grep -qF "forcecommand /usr/bin/sudo -n $SERVE" || { revert; echo "ForceCommand for $U is not ours: reverted" >&2; exit 1; }
  effa="$(sshd -T -C "user=aicc,host=localhost,addr=127.0.0.1" 2>/dev/null || true)"
  echo "$effa" | grep -qE '^allowusers (.* )?aicc( |$)' || { revert; echo "AllowUsers no longer lists aicc: reverted" >&2; exit 1; }
  # the Match block must NOT leak to the operator account (it would lock the operator out)
  echo "$effa" | grep -qE '^forcecommand none$' || { revert; echo "ForceCommand leaks to the operator account: reverted" >&2; exit 1; }
  echo "$effa" | grep -qE '^permittty yes$' || { revert; echo "PermitTTY no leaks to the operator account: reverted" >&2; exit 1; }
  systemctl reload ssh
fi
say "installed: user $U, $SERVE, sudoers, sshd Match block. Existing sessions untouched."
