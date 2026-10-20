#!/usr/bin/env bash
# READ-ONLY post-creation verification of the new STAGING Droplet. Changes nothing on the host.
# Usage: infra/provision/verify-droplet.sh --ip <PUBLIC_IPV4> --key ~/.ssh/aicc_cp_stage [--expect-ram-mib 2048]
# Fail-closed: refuses the existing production API Droplet IP, requires an explicit key and IP, and requires the host to
# present the staging identity file /etc/aicc-stage-identity before it reports anything as OK.
set -uo pipefail
IP=""; KEY=""; USER_NAME="aicc"
while [ $# -gt 0 ]; do
  case "$1" in
    --ip) IP="$2"; shift 2;;
    --key) KEY="$2"; shift 2;;
    --user) USER_NAME="$2"; shift 2;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
[ -n "$IP" ] && [ -n "$KEY" ] || { echo "usage: $0 --ip <ipv4> --key <private-key-path>" >&2; exit 2; }
# Production / public hosts that must never be targeted by staging tooling.
DENY="139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153"
for d in $DENY; do [ "$IP" = "$d" ] && { echo "REFUSED: $IP is a production/public address, not the staging Droplet." >&2; exit 3; }; done
echo "$IP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || { echo "REFUSED: --ip must be a literal IPv4 address." >&2; exit 3; }
[ "$(basename "$KEY")" = "aicc_digitalocean_prod" ] && { echo "REFUSED: never use the production API key." >&2; exit 3; }
[ -f "$KEY" ] || { echo "no such key file: $KEY" >&2; exit 2; }
KH="$HOME/.ssh/known_hosts_aicc_stage"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KH" "$USER_NAME@$IP")
fail=0; ok(){ printf 'PASS  %s\n' "$1"; }; bad(){ printf 'FAIL  %s\n' "$1"; fail=$((fail+1)); }
r(){ "${SSH[@]}" "$@" 2>&1; }

out="$(r 'cat /etc/aicc-stage-identity')" || { echo "FAIL  cannot SSH as $USER_NAME@$IP with that key: $out"; exit 1; }
echo "$out" | grep -q '^AICC_ENV=staging$' && ok "staging identity file present (AICC_ENV=staging)" || { bad "no staging identity: ABORT"; exit 1; }
echo "host key fingerprint recorded in $KH (compare with the DigitalOcean console if you want):"; ssh-keygen -lf "$KH" 2>/dev/null | grep -F "$IP" | head -1
v="$(r 'lsb_release -ds; uname -r')"; echo "$v" | grep -q '24.04' && ok "Ubuntu 24.04: $(echo "$v" | head -1)" || bad "OS is not Ubuntu 24.04: $v"
n="$(r nproc)"; [ "$n" = "1" ] && ok "1 vCPU" || bad "vCPU is $n (expected 1)"
mem="$(r "awk '/MemTotal/{print int(\$2/1024)}' /proc/meminfo")"; [ "${mem:-0}" -ge 1800 ] && [ "${mem:-0}" -le 2100 ] && ok "RAM ${mem} MiB (about 2 GiB)" || bad "RAM ${mem} MiB (expected about 2 GiB)"
dsk="$(r "df -BG --output=size / | tail -1 | tr -dc 0-9")"; [ "${dsk:-0}" -ge 45 ] && [ "${dsk:-0}" -le 55 ] && ok "root disk ${dsk} GiB (about 50 GiB)" || bad "root disk ${dsk} GiB"
sw="$(r "awk '/SwapTotal/{print int(\$2/1024)}' /proc/meminfo")"; [ "${sw:-0}" -ge 1900 ] && ok "swap ${sw} MiB" || bad "swap ${sw} MiB (expected 2048)"
r 'cat /proc/sys/vm/swappiness' | grep -q '^10$' && ok "vm.swappiness=10" || bad "vm.swappiness is not 10"
r 'cloud-init status' | grep -q 'status: done' && ok "cloud-init finished" || bad "cloud-init not done: $(r 'cloud-init status --long' | head -3 | tr '\n' ' ')"
r 'test -f /var/lib/aicc-init-stage1-done && echo yes' | grep -q yes && ok "stage-1 provisioning marker present" || bad "stage-1 marker missing"
r 'sudo -n sshd -T' | tr -d '\r' > /tmp/aicc_sshd_T.$$ 2>&1
grep -q '^passwordauthentication no' /tmp/aicc_sshd_T.$$ && ok "SSH password authentication disabled" || bad "SSH password authentication NOT disabled"
grep -q '^permitrootlogin without-password\|^permitrootlogin prohibit-password' /tmp/aicc_sshd_T.$$ && ok "root SSH is key-only (stage 1; disable it with harden-stage2.sh after a second session works)" || echo "INFO  permitrootlogin: $(grep '^permitrootlogin' /tmp/aicc_sshd_T.$$)"
rm -f /tmp/aicc_sshd_T.$$
r 'sudo -n ufw status verbose' | grep -q 'Status: active' && ok "UFW active" || bad "UFW not active"
ports="$(r 'sudo -n ufw status' | grep -E '^(22|80|443)' | wc -l | tr -d ' ')"; [ "${ports:-0}" -ge 3 ] && ok "UFW allows 22, 80, 443 (and nothing else expected)" || bad "UFW rules unexpected"
r 'sudo -n ufw status' | grep -Eq '443/udp' && bad "UFW allows 443/udp (HTTP/3 must stay off)" || ok "443/udp not allowed (HTTP/3 off)"
r 'systemctl is-active fail2ban' | grep -q '^active$' && ok "fail2ban active" || bad "fail2ban not active"
r 'sudo -n fail2ban-client status sshd' | grep -q 'Currently banned' && ok "fail2ban sshd jail enabled" || bad "fail2ban sshd jail missing"
r 'systemctl is-active chrony' | grep -q '^active$' && ok "time sync (chrony) active" || bad "chrony not active"
r 'systemctl is-enabled unattended-upgrades' | grep -q enabled && ok "unattended-upgrades enabled" || bad "unattended-upgrades not enabled"
r 'ss -H -ltn' | awk '{print $4}' | grep -Ev '^(127\.|\[::1\]|\[::\]:22$|0\.0\.0\.0:22$|\*:22$)' | grep -q . && bad "unexpected public listeners: $(r 'ss -H -ltn' | awk '{print $4}' | tr '\n' ' ')" || ok "only sshd listens publicly (nothing else installed yet)"
echo
[ "$fail" = "0" ] && echo "ALL CHECKS PASSED: record Droplet ID, IPv4, IPv6, Reserved IPv4 and tell me." || { echo "$fail CHECK(S) FAILED: do not proceed; send me this output."; exit 1; }
