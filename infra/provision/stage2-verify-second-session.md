# Stage 2: the two-session procedure (SSH hardening without locking yourself out)

Goal: disable root SSH login and allow only the operator account `aicc`, **without ever being able to lose access**.
Stage 1 (cloud-init) left root login key-only on purpose. Stage 2 removes it. Two scripts and one rule keep this safe:

> **Rule: the session you start with stays open until a third, brand-new login as `aicc` has worked.**

Recovery if everything goes wrong: DigitalOcean web console (Droplet, Access, **Launch Droplet Console**). It does not use sshd, so no sshd setting can lock you out of it.

## Roles of the sessions

| Session | Opened by | User | Purpose |
|---|---|---|---|
| 1 | already open (first login) | root or aicc | stays open the whole time; runs `harden-stage2.sh` |
| 2 | new terminal on the Mac | `aicc`, dedicated key | proves the operator account works; runs `stage2-verify-second-session.sh` |
| 3 | new terminal on the Mac, after hardening | `aicc` | final proof; also try `ssh root@<ip>`: it must now be refused |

## Procedure

0. Put the infra bundle on the host (from the Mac): `infra/provision/push-bundle.sh --stage-host stage.copilt.org --stage-ip <IP> --key ~/.ssh/aicc_cp_stage` (copies `infra/` and `scripts/ops/` to `~/aicc-infra-bundle` of user aicc; refuses production addresses).
1. **Session 1** exists already. Do nothing in it yet.
2. **Session 2** (new Mac terminal): `ssh -i ~/.ssh/aicc_cp_stage -o IdentitiesOnly=yes aicc@<IP>`
   then `sudo ~/aicc-infra-bundle/infra/provision/stage2-verify-second-session.sh`.
   It checks: the session belongs to `aicc`, sshd logged `Accepted publickey` for this very connection, passwordless sudo, an ed25519 key in `authorized_keys`, key auth on and password auth off in sshd's effective configuration. All PASS, then it writes `/run/aicc/stage2-verified` (tmpfs, root 0600: the marker disappears on reboot and also carries the boot id and a timestamp).
   Any FAIL: no marker, nothing changes. Fix and re-run.
3. **Back in session 1**: `sudo ~/aicc-infra-bundle/infra/provision/harden-stage2.sh --dry-run` (read what it will do), then without `--dry-run`.
   It refuses unless the marker is from this boot, younger than 60 minutes, for user `aicc`, and written by a different session than the one running it.
   It writes `/etc/ssh/sshd_config.d/05-aicc-stage2.conf` (`PermitRootLogin no`, `AllowUsers aicc`), runs `sshd -t`, checks `sshd -T`, and only then does `systemctl reload ssh`. A reload does not close established sessions.
4. **Session 3**: open a new login as `aicc`; it must work. `ssh root@<IP>` must fail. Only now close session 1 and 2 if you like.

## Rollback

From session 1, 2 or 3, or the web console:

```bash
sudo rm /etc/ssh/sshd_config.d/05-aicc-stage2.conf && sudo sshd -t && sudo systemctl reload ssh
```

## Why the file is called 05-...

OpenSSH takes the **first** value it reads for most keywords. cloud-init's `/etc/ssh/sshd_config.d/10-aicc-hardening.conf` says `PermitRootLogin prohibit-password`; a drop-in that sorts later (for example `20-`) would be ignored. `harden-stage2.sh` therefore checks the *effective* configuration (`sshd -T`) and reverts if its change did not take effect.

## What this does not protect against

* Losing the private key `~/.ssh/aicc_cp_stage` (keep a backup; recovery is the web console plus adding a new key to `/home/aicc/.ssh/authorized_keys`).
* `fail2ban` banning your own address (the sshd jail from cloud-init bans after 5 failures in 10 minutes; unban from the web console: `fail2ban-client unban <ip>`).
* A host that has been rebooted between steps 2 and 3: the marker is gone by design; just repeat step 2.
