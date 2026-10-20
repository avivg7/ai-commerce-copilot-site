# Creating the AICC Control Plane STAGING Droplet (owner procedure)

Approved spend: **one** DigitalOcean Basic Regular Droplet, FRA1, 1 vCPU / 2 GiB / 50 GiB SSD, Ubuntu 24.04 LTS, **$12/month**, plus a Reserved IPv4 (free **while assigned**), a Cloud Firewall (documented as free: confirm the console shows $0), and DigitalOcean Monitoring ($0).
**Not approved, leave OFF:** Droplet Backups, Spaces, managed database, CDN, load balancer, WAF, snapshots-on-schedule, any resize.
No DigitalOcean API token is requested or needed. You do all clicks yourself. DigitalOcean's console labels may differ slightly from the names below; if a screen offers a paid option not listed here, do not enable it.

Everything in this file is preparation. Nothing here has been executed.

## 1. Create a dedicated SSH key (on your Mac)

Never reuse `~/.ssh/aicc_digitalocean_prod` (that is the production API Droplet key).

```bash
ssh-keygen -t ed25519 -a 64 -f ~/.ssh/aicc_cp_stage -C "aicc-cp-stage"
```

- A passphrase is recommended. If you set one, load it so automated checks can use it: `ssh-add --apple-use-keychain ~/.ssh/aicc_cp_stage` and confirm with `ssh-add -l`.
- A passphrase-less key is acceptable for this single staging host (small blast radius) but is weaker if your Mac is compromised.
- The **private** key (`aicc_cp_stage`) never leaves your Mac and is never pasted anywhere. Only the **public** key (`aicc_cp_stage.pub`) is used below.

## 2. Render the cloud-init (on your Mac, from the site repo)

```bash
cd ~/self_projects/ai_copilot_site
infra/provision/render-cloud-init.sh ~/.ssh/aicc_cp_stage.pub > /tmp/aicc-cloud-init.yaml
less /tmp/aicc-cloud-init.yaml     # read it: it is short, it only does base hardening
```
The script refuses a private key, a multi-line file, a non-ed25519 key and the production key name.

## 3. Droplet settings in the DigitalOcean console (Create > Droplets)

| Setting | Value |
|---|---|
| Region | **Frankfurt: FRA1** |
| VPC | the default VPC for FRA1 |
| Image | **Ubuntu 24.04 (LTS) x64** |
| Droplet type | **Basic** |
| CPU options | **Regular** (shared CPU, **not** Premium) |
| Plan | **$12/mo: 1 vCPU / 2 GB RAM / 50 GB SSD / 2 TB transfer** (check the price shown is exactly $12.00/mo) |
| Authentication | **SSH Key**: add the contents of `~/.ssh/aicc_cp_stage.pub` as a new key named `aicc-cp-stage` |
| Additional options: **Monitoring** | **ON** (free; installs the metrics agent so memory/disk/load graphs work) |
| Additional options: **IPv6** | **ON** (free) |
| Additional options: **User data** | paste the whole content of `/tmp/aicc-cloud-init.yaml` |
| **Backups** | **OFF** (not approved) |
| Managed database / extra volumes | none |
| Quantity | **1** |
| Hostname | `aicc-cp-stage` |
| Tags | `aicc`, `stage` |
| Project | your choice (e.g. the existing AICC project) |

Review the **summary price before pressing Create**: it must read **$12.00/month** and nothing else. If it shows more, stop and tell me.

## 4. Reserved IPv4 (Networking > Reserved IPs)

Assign a **Reserved IPv4** in FRA1 to the new Droplet. It is free only while assigned: never leave it unassigned (that is $5/month). Record the address; it is the one used for DNS.

## 5. Cloud Firewall (Networking > Firewalls > Create)

Name `aicc-cp-stage-fw`, apply to the Droplet `aicc-cp-stage` (by name or tag `stage`).

| Direction | Protocol | Port | Sources |
|---|---|---|---|
| Inbound | TCP | 22 | All IPv4, All IPv6 (key-only SSH, fail2ban; can be narrowed later) |
| Inbound | TCP | 80 | All IPv4, All IPv6 |
| Inbound | TCP | 443 | All IPv4, All IPv6 |
| Inbound | ICMP | | All IPv4, All IPv6 (optional) |
| Outbound | all (TCP, UDP, ICMP) | all | All IPv4, All IPv6 (default) |

**No UDP 443** (HTTP/3 is off). Confirm the console shows the firewall as free; if it does not, delete it and tell me (the host's UFW is the primary layer anyway).

## 6. DNS record for you to add (Namecheap > Domain List > Manage > Advanced DNS)

Add exactly one record **after** the Reserved IPv4 exists. I will not rely on it until you tell me and I verify with `dig`:

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `stage` | `<RESERVED_IPV4>` | 5 min (300 s) |

Optional later: an `AAAA` for `stage` with the Droplet's IPv6. Do **not** touch any other record (MX, SPF TXT, `www`, `api`, apex).
Verification you can run: `dig +short stage.copilt.org A` must print the Reserved IPv4.

## 7. After creation: record these and send them to me

- Droplet name and **Droplet ID**
- Public **IPv4** of the Droplet, **IPv6** of the Droplet
- **Reserved IPv4**
- Creation timestamp, and the monthly price shown in the console (expect $12.00)
- The host key fingerprint shown in the console, if offered

## 8. First verification (read-only; run on your Mac)

Wait about 3 minutes after creation (cloud-init needs to run its package upgrade), then:

```bash
cd ~/self_projects/ai_copilot_site
infra/provision/verify-droplet.sh --ip <DROPLET_PUBLIC_IPV4> --key ~/.ssh/aicc_cp_stage
```
It only reads. It refuses production addresses, the production key, and any host that does not present `/etc/aicc-stage-identity` with `AICC_ENV=staging`. It checks: Ubuntu 24.04, 1 vCPU, ~2 GiB RAM, ~50 GiB disk, 2 GiB swap, swappiness 10, cloud-init done, SSH password auth off, UFW (22/80/443 only, no 443/udp), fail2ban sshd jail, time sync, unattended upgrades, and that nothing but sshd listens publicly yet. Paste the output to me.

## 9. If something goes wrong

- Cannot SSH in: DigitalOcean console > Droplet > Access > **Launch Droplet Console** (web console). Check `/var/log/cloud-init-output.log`.
- Wrong price, extra paid option, or wrong region: **destroy the Droplet** (billing stops only when destroyed, not when powered off) and recreate. A Droplet destroyed within minutes costs cents (billed per second).
- Never paste the private key anywhere. If you suspect it leaked: delete the key in the console, generate a new one, and recreate or replace the key on the host.
