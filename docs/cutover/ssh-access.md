# SSH access to the Linux hosts: decision and operator recovery

Status: **decision review for production, staging unchanged.** The existing production API Droplet is not covered by this document and was not touched.

## 1. Measured state of `aicc-cp-stage` (VERIFIED 2026-10-21)

| Item | Value |
|---|---|
| Root login | `permitrootlogin no` (drop-in `05-aicc-stage2.conf`) |
| Passwords | `passwordauthentication no`, `kbdinteractiveauthentication no` |
| Who may log in | `AllowUsers aicc aicc-offhost` (the second is the restricted backup-pull account, below) |
| Attempts | `maxauthtries 3` |
| `aicc` | operator, key-only, `sudo` (passwordless; a key compromise = root) |
| `aicc-offhost` | forced command only: `identity`, `status`, `get <backup>`, `ack ...`; no TTY, no forwarding (`Match User` block + `restrict` key option + a sudoers rule for that one script) |
| `/root/.ssh/authorized_keys` | 1 key (the DigitalOcean-injected provisioning key); unusable while root login is off |
| Firewall | UFW and the Cloud Firewall both allow 22/80/443 from anywhere (IPv4 and IPv6) |
| fail2ban `sshd` | 5 failures in 10 min → 1 h ban (increasing for repeat offenders) |
| Observed | the internet scans port 22 constantly: 10 scanner addresses were banned at one moment (most within hours of the Droplet going up) |
| Self-lockout | **happened to us:** a mis-quoted test command produced several failed logins from the owner's own address and fail2ban banned it for an hour; an already-open session was dropped too. Recovery was waiting (or the DigitalOcean web console). |

## 2. Options compared

| Option | Attack surface | Lockout / recovery risk | Operability | Real benefit |
|---|---|---|---|---|
| **A. Key-only SSH on 22 open to the world + fail2ban (current)** | `sshd` pre-authentication code and its patch level; credential guessing is impossible with passwords off | fail2ban can lock out the operator (seen); recovery = DO console or wait | works from any network, laptop travel, phone hotspot | baseline |
| **B. Cloud Firewall source-restricted to the operator's address(es)** | removes the internet from `sshd` entirely | a residential/mobile address changes: locked out until the firewall is edited in the DO console (always possible, needs the DO login and 2FA) | needs a stable IP or a habit of editing the firewall | real reduction of pre-auth exposure; not a defence against a stolen key |
| **C. VPN/bastion (WireGuard, Tailscale-like)** | replaces SSH exposure with another daemon (UDP port or a third-party control plane) | another thing to keep alive and to recover | extra software on a 1 vCPU box, extra account | usually not worth it for one host |
| **D. Non-standard port** | none (security by obscurity) | breaks tooling defaults and the Cloud Firewall rule set | friction | removes log noise only |

Key-only SSH on a patched OpenSSH is not guessable: the scanning is noise, not risk. What really protects the box is the operator key (a passphrase-less key on a laptop is the weakest link: it is root-equivalent through passwordless `sudo`) and patching.

## 3. Recommendation for production (written decision)

1. **Keep option A as the default**: key-only SSH on 22, root login off, passwords off, `AllowUsers` to named accounts, `maxauthtries 3`, automatic security updates (unattended-upgrades is enabled by cloud-init; `reboot_required` alerts tell the operator when a reboot is waiting).
2. **Add option B only if the owner has a stable address**: restrict the Cloud Firewall rule for 22 to that `/32` (and the IPv6 `/128`/`/64` if any), keep 80/443 open. If the owner moves between networks, do **not** adopt B: the lockout risk and friction exceed the benefit for a single key-protected host.
3. **Tune fail2ban for key-only reality**: raise `maxretry` to 10 and keep `bantime` at 1 h. With passwords off a ban stops no break-in; it only dampens connection floods and log noise, and a low `maxretry` mostly bites the legitimate operator. (Not applied to staging: the default stays until the owner agrees.)
4. **Mandatory before the production cutover** (cheap, not yet done): (a) a **second operator key** generated on a different machine and stored offline, authorised in `~aicc/.ssh/authorized_keys`; (b) a rehearsed **console recovery**: in the DigitalOcean console use the Droplet's *Access → Reset root password* (DigitalOcean emails a one-time password), open the web *Console* and log in as `root` (a console login is not an SSH login, so `PermitRootLogin no` does not block it), repair `~aicc/.ssh/authorized_keys` or `fail2ban-client unban`, then lock the root password again (`passwd -l root`); rehearse it once on staging and write down how many minutes it took; (c) protect the DigitalOcean account with 2FA and a recovery code kept offline; (d) the operator key gets a passphrase and lives in the OS keychain/agent (this key is also used by the test tooling today without a passphrase: use a separate key for human operations once the rehearsal tooling is finished).
5. **Unattended access is confined**: the Mac backup pull uses the restricted `aicc-offhost` account only (never the operator key). The Backend's existing production key (`aicc_digitalocean_prod`) is refused by every staging tool and is never used here.
6. **Operator hygiene lesson**: never script retries of a failing SSH login; one failed attempt is enough to know. If banned: wait for `bantime`, use another network, or unban from an already-open root-capable session (`sudo fail2ban-client set sshd unbanip <addr>`), or the DO console.

## 4. Recovery paths, in order of preference

1. A second already-open SSH session (keep one open while changing `sshd`/firewall settings: the change scripts here never close sessions).
2. A second operator key from another machine.
3. DigitalOcean web console with a reset root password (section 3, item 4b; uses the DO account, not SSH).
4. DigitalOcean recovery mode / a snapshot restore. No paid backups or snapshots are enabled; the application-level recovery is the off-host backup + `aicc-restore` (`infra/backup/README-backup.md`).

## 5. Not changed

Port 22 stays open to the world on staging; no firewall edit was made in this phase (the owner decision above is recorded, not applied).
