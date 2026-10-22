# Promoting the existing Droplet `aicc-cp-stage` to the initial PRODUCTION host (plan, tooling and runbook)

Status (2026-10-22): **PREPARED, NOT EXECUTED.** Nothing here was applied to the live Droplet, to DNS, to `www.copilt.org`, the apex, `api.copilt.org`, the existing API Droplet, Neon, Render or any payment system. No production identity was written on the host. The tooling is tested on the Mac against stubs, a temp "host" prefix and a throwaway MySQL (`npm run infra:test`, section 12). Every step marked **STOP: owner approval** needs the owner's explicit approval at that moment; approving this document approves no step.

**Owner direction (2026-10-22):** the existing `$12 / 1 vCPU / 2 GiB` Droplet `aicc-cp-stage` (`157.230.110.211`, Reserved IP `206.189.248.204`) becomes the initial production Control Plane + edge host. No second Droplet, no resize. The host must **not** become publicly authoritative for `www.copilt.org` until a final explicit owner cutover gate (section 9). This task changes no DNS.

Related documents: `production-path.md` (configuration and deploy path), `runbook.md` (the DNS cutover and its rollback, sections 2-6 still apply; this document replaces its "new Droplet" assumptions), `redirect-matrix.md`, `tls-caa-hsts.md`, `dns-and-mail.md`, `ssh-access.md`, `alerting.md`, `infra/backup/README-backup.md`.

## 1. Decisions (with the reasons)

| # | Decision | Why | Cost / what you give up |
|---|---|---|---|
| D1 | **Convert in place**, in two stages: *dark production* now (production identity, empty production database, production configuration, edge rendered with `tls internal`), *public* only at the cutover gate. | One host was chosen by the owner. "Dark" means no public name resolves to the host as `www`, so nothing public can depend on it yet, while everything that is not DNS can be built and proven. | There is **no staging environment any more** after the promotion (D4). Later releases are rehearsed on the Mac's rehearsal stack; the safety net on the host is the pre-release backup + automatic rollback (`infra/release/README.md`). A disposable second Droplet billed by the hour is a possible later owner decision, not assumed. |
| D2 | **Clean replacement of the database, not a reset.** The staging database is dumped (verified), then `DROP DATABASE aicc_cp`; an empty `aicc_cp` is created with **new random passwords** for `aicc_cp` and `aicc_backup`; WordPress is installed fresh at `https://www.copilt.org`; the seeding scripts run again. The verified staging dump stays in the rollback bundle. | A reset ("delete the test rows") leaves everything we cannot enumerate: options that name `stage.copilt.org` (home, siteurl, cookies and nonces hash `siteurl`), transients, Action Scheduler history, the staging admin and its password, plugin options written during tests, the 2 stale legal versions the runbook warns about (`runbook.md` 1.7), `woocommerce_coming_soon` state, tombstones. A fresh install has a known, enumerable state and a clean audit trail. The staging database holds **1 user and 0 orders** (counted read-only on 2026-10-22), so there is nothing worth migrating. | Seeding is repeated (3 idempotent CP scripts, section 6 step 6.5). |
| D3 | **Secrets: regenerate everything the host can regenerate; the two shared secrets are the owner's.** | A promoted host must not carry any value that ever existed in a staging context (test tooling, evidence files, shells). | Users are logged out (new salts) - nobody real exists yet. |
| D4 | **`stage.copilt.org` is retired, not kept as a second edge name.** The promoted edge serves only `www.copilt.org` + `copilt.org`; the `stage` A record is deleted at the end of the soak (section 10). | (a) *Shared failure domain*: a stage name on the production host tests nothing the host does not share with production (same CPU, same MySQL server, same PHP-FPM pool, same disk) - and a staging rehearsal on that host can take production down. (b) *It cannot test WordPress*: `home`/`siteurl` are `www.copilt.org`, so WordPress redirects every request for another host to `www`, cookies and nonces are bound to `siteurl`. (c) *Surface*: another public name, another certificate to renew and monitor, another Host to filter, the staging-only noindex/identity behaviour would have to be kept alive next to production code. (d) *Dangling name*: an A record to a Reserved IP that is later re-assigned is a take-over risk. (e) All fail-closed staging test tooling refuses a production-identity host by design. | Nothing public is lost: the name was never advertised. |
| D5 | **Dark-production edge = the production render with `tls internal`** (`render-edge.mjs --mode production --pre-cutover`). The final render (automatic Let's Encrypt for `www` and the apex) is installed only at the cutover gate, after DNS points here. | A production render with automatic HTTPS on a host whose names still resolve to GitHub Pages would request public certificates that fail validation; Let's Encrypt limits failed validations (5 per hostname per hour, `runbook.md` 1.10) and Caddy backs off, which can delay the real certificate on cutover day. `tls internal` asks no public CA anything. | Browsers do not trust the internal certificate: dark-phase checks use `--cacert`, the operator browser uses an SPKI exception in a separate profile (step 6.4). Caddy's internal certificates live 12 hours, so `cert_expiry` (AICC Ops) and the cert-expiry timer are switched off during the dark phase and on again by `final-edge`. |
| D6 | **The identity file keeps its historical name** `/etc/aicc-stage-identity`, content `AICC_ENV=production`, `AICC_HOSTNAME=www.copilt.org`, `AICC_HOST_ROLE=control-plane-edge`, a **new random** `AICC_STAGE_ID` (key name unchanged because deploy, restore, pull and drill tooling read exactly that key). | Renaming would touch eight tools for no safety gain; the value, not the file name, is what every tool checks. It is an identifier, not a secret. | The name is misleading; documented here and in the file's own comment. |
| D7 | **Backup identity (names the owner will see):** database `aicc_cp` and file names `aicc_cp-<UTC>-<label>.sql.gz` / `aicc-files-...` are **unchanged** (they name the database, not the environment); the environment is carried by the identity inside every archive (`pointers.txt host_identity`) and checked by pull and restore. Mac side: key `~/.ssh/aicc_cp_prod_offhost`, directory `~/aicc-offhost-backups-production`, LaunchAgent `com.aicc.offhost-pull.production`, pinned host key `~/.ssh/known_hosts_aicc_prod_cp`. Host side: account `aicc-offhost` unchanged (it carries no environment, the key does), ack file `offhost-ack.json` reset (starts absent in production). The staging sets leave `/srv/aicc/backups` (they go to the rollback bundle), so the Mac's restricted pull can never fetch staging data into the production directory. | One name, one meaning per place; nothing production-shaped can be confused with staging in a listing, a LaunchAgent label or a key file. | Two Mac directories exist for a while (staging copies, kept 14 days for the rollback window, then deleted). |
| D8 | **Deployment records continue** in the same `/var/lib/aicc/deployments.jsonl`; the promotion appends one boundary record (`outcome: promoted_to_production`), a rollback appends `demoted_to_staging`. `aicc-deploy-status` shows it. | Continuity of "what was live when" without rewriting history. | - |
| D9 | **Mail:** production uses the Control Plane's SMTP layer, configured by constants + `/etc/aicc-mail/smtp.env` (section 8); staging's mail sink is not carried over. | See section 8. | The SMTP provider account is an owner action. |
| D10 | **No deploy of the old tooling's assumptions:** `deploy-release.sh --env production` no longer refuses the Droplet's two addresses (it used to treat them as "the staging Droplet"); the identity gate (host says `AICC_ENV=production` with this name and id) is what protects a non-promoted host. | The owner decision above makes these addresses the production target. | A production deploy aimed at the Droplet BEFORE the promotion is refused by the identity gate (tested). |
| D11 | **`AICC_LM_TRUSTED_PROXIES` stays EMPTY in production** (verified, below). | With `php_fastcgi` over a unix socket there is no proxy hop in front of PHP: Caddy's FastCGI transport passes the connection peer as `REMOTE_ADDR`, the edge strips every forwarding header (`X-Forwarded-For`, `Forwarded`, `X-Real-IP`, ... , so a client cannot forge one), and the plugin's `AICC_LM_Client_IP` uses `REMOTE_ADDR` unless the peer is listed. Evidence: (a) the real-Caddy + real php-fpm rehearsal (`scripts/rehearsal/run-tests.mjs` sections "php_fastcgi" and 2070-2081): PHP's `REMOTE_ADDR` is the real peer (`127.0.0.1`; `::1` over IPv6, which is a different bucket), forged `X-Forwarded-For` never reaches PHP, `cp_client_ip` (the value the rate limiters use) equals the peer; (b) on the live host the edge access log shows **10,682 distinct `remote_ip` values** in its last 20,000 lines (top address 3 %), i.e. Caddy sees real clients, and that is the value it hands to PHP; (c) the CP launch gate rule 5g-2 ("AICC_LM_TRUSTED_PROXIES is empty ... all clients share one bucket") describes a reverse-proxy topology and is a **false WARN here** (report-only; the CP should make it conditional on a non-fastcgi topology). Listing the edge address would change nothing (the header is stripped) and listing anything else would trust a client-controlled value if the strip lines were ever lost. Proof on the real host: step 6.7b. | - |
| D12 | **The private Plugin release store `/srv/aicc/shared/plugin-releases` (`AICC_LM_PLUGIN_RELEASE_DIR`) is created by `install-stack.sh` and by the promotion (`root:aicc-cp 0750`, contents never touched by the promotion) and IS in the files archive of the backup.** | It is not under any web root (static root `/srv/aicc/site/current`, PHP docroot `/srv/aicc/cp/current`, uploads `/srv/aicc/shared/uploads`: a sibling, not a child), no Caddy route serves it, Caddy's group (`aicc-edge`) cannot read it, and PHP gets read-only access. Releases are immutable and re-publishable from the Plugin repo, but a rebuild is only byte-identical if the toolchain is, and customers' updaters verify against the stored manifest: copying ~1 MB per release is cheaper than reasoning about it. `aicc-restore` restores the store only when the archive carries one (an older archive never deletes the live store). | ~1 MB per release in every hourly archive (a handful of releases: negligible). |

### Secrets and who holds what

| Secret | Value source | Where on the host | Notes |
|---|---|---|---|
| Entitlement webhook secret | **owner-provided** (must equal the Backend's) | `/etc/aicc/secrets/entitlement-webhook.secret` 0600 root; rendered into `wp-config.php` | placed through `promote-to-production.sh set-owner-secret entitlement-webhook` (hidden prompt) into `/etc/aicc/owner-secrets-incoming/` (0700), moved by the `secrets` step; never generated, never printed |
| Activation-proof key | **owner-provided** | same, `activation-proof.secret` | same helper |
| `aicc_cp` / `aicc_backup` DB passwords | regenerated on the host (`create-staging-db.sh`, 192-bit) | `/etc/aicc/secrets/db-*.pass`, `/etc/aicc/backup.cnf` (0600 root) | the old ones exist only in the rollback bundle |
| WordPress keys and salts | regenerated (`render-wp-config.sh`) | `/etc/aicc/secrets/wp-secrets.env`, `wp-config.php` | |
| WordPress admin password | **typed by the owner** at a hidden prompt (`wp-install`) | not stored by us | no `wp-admin.pass` file is created in production; a guessable admin name is refused |
| Mail credentials | owner (Brevo login + SMTP key) | `/etc/aicc-mail/smtp.env` 0640 `root:aicc-cp` | section 8; outside `/etc/aicc` because `/etc/aicc` is `0750 root:root` and the PHP user could not traverse it (verified on the host) |
| Telegram bot token + chat id | owner | `/etc/aicc-ops/secrets.env` 0640 `root:aicc-ops` (not touched by the promotion) | `alerting.md` section 1 |
| Mac off-host pull key, operator key | generated on the Mac | `authorized_keys` (restricted key for `aicc-offhost`, operator key for `aicc`) | new key pairs for production (step 6.1) |

## 2. What changes on the host (and what does not)

| Item | Staging (today) | After the promotion (dark) | Done by |
|---|---|---|---|
| `/etc/aicc-stage-identity` | `AICC_ENV=staging`, `stage.copilt.org`, id `c4cae5ab...` | `AICC_ENV=production`, `www.copilt.org`, new random id | `apply` step `identity` |
| Database `aicc_cp` | staging data (1 user, 0 orders, `siteurl` stage) | empty, new passwords, then fresh install at `https://www.copilt.org` | `db`, `wp-install` |
| `wp-config.php` | stage template (WP_HOME stage, outbound blocked except stage, no webhook) | production template (WP_HOME www, `WP_ACCESSIBLE_HOSTS=api.copilt.org`, webhook URL, owner secrets, mail region if `smtp.env` is valid) | `wpconfig` (`render-wp-config.sh --env production --confirm-production`) |
| `/etc/aicc-edge/edge.env` | `AICC_EDGE_MODE=stage`, stage id, stage host | `AICC_EDGE_MODE=production`, `AICC_PUBLIC_HOST=www.copilt.org`, `AICC_ALLOW_PRODUCTION_MODE=1`, `AICC_ALLOW_INTERNAL_TLS=1` (dark only); **no** `AICC_STAGE_ID`/`AICC_STAGE_HOST` | `edge` |
| `/etc/aicc-edge/Caddyfile` | stage render (one name, identity route, `X-Robots-Tag: noindex`) | pre-cutover production render: `www.copilt.org` + `copilt.org`, no identity route, no noindex, `tls internal` | `edge` |
| `aicc-edge.service` | preflight `--mode stage` | drop-in `10-production.conf`: preflight `--mode production` (start and reload) | `edge` |
| `aicc-cert-expiry.service` | checks `stage.copilt.org` | drop-in: checks `www.copilt.org` and `copilt.org`; timer OFF while dark | `edge`, `final-edge` |
| AICC Ops | label `aicc-cp-stage (staging)`, hosts stage | `aicc-ops.production.toml`: label `aicc-cp-prod (production)`, hosts www, CP collector on, `wc_cron_stale` warn 2 h, `cert_expiry` off while dark | `ops` |
| Backups | staging sets in `/srv/aicc/backups`, ack present | directory emptied (sets in the bundle), ack absent until the first production pull | `backups` |
| Site release | **stage build** (noindex, identity route, disallow-all robots) | **replace with a production build** (step 6.6) - until then the dark site still carries staging markers | `deploy-release.sh --env production` |
| CP release | env-agnostic | unchanged unless a new CP commit is needed (the mail layer is in the CP branch `launch/mail`) | `deploy-release.sh --env production --kind cp` |
| Releases on disk, deployment log, Caddy storage, users, firewall, SSH, fail2ban, sysctl, swap | - | **unchanged** | - |

Staging-only behaviour and what happens to it:

| Staging behaviour | In production |
|---|---|
| `X-Robots-Tag: noindex, nofollow, noarchive` on every response (stage render only) | Not present in the production render; asserted by `assertRender`, by the promotion gate, by `deploy-release.sh` and by `production-edge-check.sh` on every response kind. |
| `/.well-known/aicc-stage-identity` route | Not in the production render; the production site build must not carry the file (refused by `deploy-release.sh`); `production-edge-check.sh` requires a 404. |
| stage site build (`noindex` meta, disallow-all `robots.txt`, no sitemap) | Replaced by the production build (step 6.6); the dark site is not published, but the swap is part of the dark verification. |
| HSTS `max-age=300` | Same value at the start of production; ramp in `tls-caa-hsts.md` section 4 (300, then 86400 after a clean day, 604800 after 7 clean days, 31536000 after 4 clean weeks). No `includeSubDomains`, no `preload`. |
| Mail sink (`aicc-mail-sink`) | WordPress mail goes through the SMTP layer when `smtp.env` is valid, otherwise **no mail is sent at all** (never the sink, never PHP `mail()`). The pool's `sendmail_path` still points at the sink: it only catches mail sent outside WordPress's `wp_mail()` (nothing in our code does). |
| Outbound HTTP blocked except the stage host | `WP_HTTP_BLOCK_EXTERNAL=true`, `WP_ACCESSIBLE_HOSTS=api.copilt.org` (webhook). A payment host is added in a reviewed change when a gateway exists. The SMTP relay is **not** listed: the mail layer uses PHPMailer sockets, not `wp_remote_*`. |
| Test fixtures, test users, WordPress salts, admin password, DB passwords | Gone with the database; passwords/salts regenerated; the owner chooses the admin login/password. |
| `woocommerce_coming_soon = yes` | **Stays `yes`** until a real gateway exists and the CP launch gate passes (`runbook.md` precondition 17). The promotion never turns it off. |
| fixtures 9111-9114 | Not related to this host; untouched. |

## 3. Public behaviour contract after the cutover (and how each item is checked)

`scripts/ops/production-edge-check.sh --ip <edge IPv4> --cacert <Caddy root.crt>` (dark) or `--public` (after DNS) runs 72 read-only GET/HEAD checks; it was validated against the local real-Caddy rehearsal edge (70 pass; the 2 expected failures are rehearsal facts: that edge's identity route and its Caddy admin port on loopback; evidence `production-edge-check-vs-local-rehearsal-edge.txt`).

| Area | Contract | Check |
|---|---|---|
| Canonical host | `https://www.copilt.org` only; every page's canonical is `www`; no `stage`, `localhost`, `http://` self URL in HTML | home, `/pricing/`, `/he/` canonical; HTML scan |
| Apex and http | `http://www`, `http://apex`, `https://apex` -> **301** (308 for non-GET) to `https://www...` keeping path and query, in one hop | three redirect checks; `staging-replay` matrix (270 cases) is the full proof |
| Indexing | no `noindex` anywhere (header or meta); `robots.txt` has no blanket `Disallow: /` and names `https://www.copilt.org/sitemap.xml`; `/cart/ /checkout/ /my-account/` are disallowed/noindex by the site/WordPress, not by the edge | header and meta scans, robots, sitemap |
| Cache | static `_next/static` immutable; WordPress/commerce paths `private, no-store`; `/healthz` `no-store`; branded errors never cached | `cache-control` on `/my-account/`, `wc-ajax`, `/healthz` |
| Locale | `/he/` (RTL), `/es/`, `/ru/` serve the localized pages; WordPress routes keep the prefix (`/he/pricing/` from WordPress); `wc-ajax` stays at the root | locale checks |
| Demo assets | `/demo/aicc-demo.mp4` (sha256 `6ec46e72fd2531ea...`, `docs/approved-demo.sha256`) with `Accept-Ranges: bytes`, a 206 for a Range request; captions and poster 200 | demo checks (`--full-demo-hash` downloads the 44 MB file once and compares the hash) |
| Security headers | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy`, HSTS (above), `X-Request-Id`; **no** `Server`, `X-Powered-By`, `Via`, `Alt-Svc`. CSP: **Report-Only on static pages** (`default-src 'self'; script-src 'self' 'unsafe-inline' ...`); WordPress paths get none. | header checks on four response kinds |
| Operator vs public | `/wp-admin/`, `/wp-login.php` (except `?loggedout=true`/logout shapes), `/wp-cron.php`, `/xmlrpc.php` are **403** on the public listener; the operator uses the loopback listener `127.0.0.1:8443` through the SSH tunnel (`operator-tunnel.sh --env production`); 8443, Caddy admin 12019, AICC Ops 9190, MySQL, PHP-FPM are not reachable from outside | 403 checks; port checks from the Mac; `aicc-edge-listener-audit` on the host |

**CSP decision (stated, not hidden):** an *enforced* CSP is **not** part of the launch. The static export inlines scripts (`'unsafe-inline'` is needed), WordPress/WooCommerce inline scripts, and the payment gateway's origins are unknown. Report-Only without a reporting endpoint only produces browser-console messages, so it is a development aid, not a monitoring signal. Enforcing it (and adding `frame-ancestors`/per-gateway rules for checkout) is a later change once a gateway and nonces/hashes exist. Owner decision.

## 4. Timeline and rollback points

```
T-3d  owner gates that need lead time: Telegram bot + token on the host, DO alert policies, CAA records, SMTP provider account,
      second operator key + console recovery rehearsed (ssh-access.md 3.4)                                     (sections 7, 8; alerting.md)
T-2d  build + validate (Mac) -> push bundle -> secrets placed -> check (read-only gates)                          step 6.1 - 6.3
T-2d  STOP: owner approval -> apply (dark production) -> start -> wp-install -> seed -> first backup -> deploys   step 6.4 - 6.8
      publish the first Plugin release (CP launch gate 5g)                                                      step 6.10
      LOWER DNS TTLs (section 7) the same day, after the host is dark and verified
T-1d  soak 24 h dark: AICC Ops, hourly backups + Mac pulls, production-edge-check, DO policies, test alerts      step 6.9
T0    STOP: owner approval (section 9) -> DNS edit -> final-edge -> verify -> HSTS 300 stays -> announce
T+1d  .. T+28d  HSTS ramp, TTL back up, retire the stage name, delete the rollback bundle and Mac staging copies (section 10)
```

| Rollback point | State | How to go back | What is lost |
|---|---|---|---|
| **R0** before `apply` | untouched staging | nothing to undo | nothing |
| **R1** after `apply` (dark) | production identity, empty DB, services stopped | `promote-to-production.sh rollback --bundle <dir> --confirm-rollback`: staging identity, edge, wp-config, secrets, **the verified staging database**, the old backup directory | production-side work since `apply` (nothing a customer touched) |
| **R2** dark, installed + seeded + deployed | production dark, no public traffic | same command; or keep going | same |
| **R3** cutover, `www` edited, `final-edge` run | public | restore the `www` CNAME to `avivg7.github.io.` (a DNS edit, one TTL of mixed behaviour) and optionally `dark-edge` on the host; allowed **only before the first customer** (`runbook.md` section 5) | nothing - no customer data exists yet |
| **R4** apex edited | public | restore the four apex A records; as R3 | - |
| **R5** after the first customer | public | `aicc-rollback-release --kind site|cp` (previous release), restore from the pre-release dump only for a schema-breaking release, **no DNS revert** | data written after the dump, see `runbook.md` section 7 |

## 5. Preconditions and owner inputs (all must exist before step 6.4)

1. Telegram bot token on the host and the verification checklist passed (`alerting.md` section 1) - independent of the promotion, do it first.
2. DigitalOcean alert policies created and confirmed by a temporary test policy (`alerting.md` section 3).
3. `entitlement-webhook` and `activation-proof` secrets (from the Backend owner's password manager).
4. A production operator SSH key (new, with a passphrase) authorised on the host; the second operator key + console recovery rehearsal (`ssh-access.md` 3.4).
5. The production off-host pull key (new, no passphrase, restricted) installed through `install-offhost-access.sh --env production`.
6. Legal/support facts, payment gateway and SMTP provider are **not** promotion preconditions; they are launch gates tracked in `runbook.md` section 8 and by the CP/Site launch checks (they will fail on the dark host and that is correct).
7. Nobody else is using `stage.copilt.org` any more (announce the freeze: after step 6.4 the name stops answering).

## 6. Runbook (numbered, gated; every command copy-pasteable)

Conventions: all commands on the Mac unless prefixed `HOST$`. `SITE` is the Site worktree/checkout that contains this branch. Host SSH goes through `~/aicc-rehearsal/bin/stage-ssh` (one session at a time; never retry a failing login: fail2ban bans for an hour). After the promotion use the production key and pinned host key (step 6.1).

```bash
export SITE=~/self_projects/ai_copilot_site-worktrees/launch-infra     # or the integrated checkout
export HOSTIP=157.230.110.211 RIP=206.189.248.204
export OLDID=c4cae5ab234f10570763ecd9e9a36a16                           # the CURRENT staging id; verify: ~/aicc-rehearsal/bin/stage-ssh 'grep AICC_STAGE_ID /etc/aicc-stage-identity'
mkdir -p ~/aicc-promotion && cd "$SITE"
```

### 6.1 Prepare keys and the pinned host key (Mac only, host untouched)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/aicc_cp_prod_operator -C "aicc-cp-prod-operator"          # SET A PASSPHRASE; the agent/keychain holds it
ssh-keygen -t ed25519 -N "" -f ~/.ssh/aicc_cp_prod_offhost -C "aicc-offhost-pull-prod"     # unattended, restricted on the host
# pin the host key (read over the already-trusted staging session; compare once with the DO web console: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`)
echo "$HOSTIP,$RIP $(~/aicc-rehearsal/bin/stage-ssh 'cat /etc/ssh/ssh_host_ed25519_key.pub' | cut -d' ' -f1-2)" > ~/.ssh/known_hosts_aicc_prod
cp ~/.ssh/known_hosts_aicc_prod ~/.ssh/known_hosts_aicc_prod_cp
ssh-keygen -F $HOSTIP -f ~/.ssh/known_hosts_aicc_prod >/dev/null && echo pinned
```

### 6.2 Build and validate (Mac)

```bash
npm run infra:lint && npm run infra:test && npm run ops:test && npm run sentinel:test         # all green, else stop
node scripts/ops/render-edge.mjs --mode production --pre-cutover --out ~/aicc-promotion/Caddyfile.pre
node scripts/ops/render-edge.mjs --mode production            --out ~/aicc-promotion/Caddyfile.final
S=$(mktemp -d); mkdir -p $S/sr $S/logs $S/wp; for f in index.html 404.html 50x.html; do echo x > $S/sr/$f; done
for f in Caddyfile.pre Caddyfile.final; do env AICC_ACME_EMAIL=ops@copilt.org AICC_STATIC_ROOT=$S/sr AICC_WP_ROOT=$S/wp AICC_PHP_FPM_SOCKET=unix//run/php/aicc-cp.sock \
  AICC_PUBLIC_HOST=www.copilt.org AICC_LOG_DIR=$S/logs AICC_ADMIN_ADDR=127.0.0.1:12019 AICC_OPERATOR_PORT=8443 ~/aicc-rehearsal/bin/caddy validate --config ~/aicc-promotion/$f --adapter caddyfile 2>&1 | tail -1; done   # both: Valid configuration
# production releases (clean commits only; the manifest records dirty=false)
infra/release/build-site-release.sh --target production --out-dir ~/aicc-releases                  # owner NEXT_PUBLIC_* values per docs/AUTHORITY.md
infra/release/build-cp-release.sh --out-dir ~/aicc-releases                                        # only if the CP commit changed (the mail layer needs a new CP release)
```
Record the two release ids printed (`SITE_REL`, `CP_REL`).

### 6.3 Bring the host's tooling up to date, still in STAGING mode (reversible, no identity change)

```bash
infra/provision/push-bundle.sh --stage-ip $HOSTIP --stage-host stage.copilt.org --dry-run && infra/provision/push-bundle.sh --stage-ip $HOSTIP --stage-host stage.copilt.org
scp -i ~/.ssh/aicc_cp_stage -o IdentitiesOnly=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts_aicc_stage ~/aicc-promotion/Caddyfile.pre ~/aicc-promotion/Caddyfile.final aicc@$HOSTIP:aicc-infra-bundle/
~/aicc-rehearsal/bin/stage-ssh 'cd ~/aicc-infra-bundle && sudo infra/provision/install-stack.sh --dry-run --only scripts,systemd,logrotate,fail2ban | tail -20'
~/aicc-rehearsal/bin/stage-ssh 'cd ~/aicc-infra-bundle && sudo infra/provision/install-stack.sh --only scripts,systemd,logrotate,fail2ban'
# authorise the production operator key and (later, step 6.8) the restricted pull key
cat ~/.ssh/aicc_cp_prod_operator.pub | ~/aicc-rehearsal/bin/stage-ssh 'umask 077; cat >> ~/.ssh/authorized_keys'
```
Place the owner-provided secrets (hidden prompts; **nothing is echoed or stored elsewhere**):
```bash
~/aicc-rehearsal/bin/stage-ssh -t 'sudo ~/aicc-infra-bundle/infra/provision/promote-to-production.sh set-owner-secret entitlement-webhook'
~/aicc-rehearsal/bin/stage-ssh -t 'sudo ~/aicc-infra-bundle/infra/provision/promote-to-production.sh set-owner-secret activation-proof'
```
Read-only gate report (changes nothing):
```bash
~/aicc-rehearsal/bin/stage-ssh "cd ~/aicc-infra-bundle && sudo infra/provision/promote-to-production.sh check --confirm-production --expect-stage-id $OLDID --caddyfile ~/aicc-infra-bundle/Caddyfile.pre --ops-config ~/aicc-infra-bundle/infra/aicc-ops/config/aicc-ops.production.toml"
```
Every line must say PASS. Preview the whole conversion: same command with `apply ... --dry-run` instead of `check`.

> **STOP: owner approval.** After this point staging is converted; `stage.copilt.org` stops answering. Rollback R1 exists.

### 6.4 Apply (dark production)

```bash
~/aicc-rehearsal/bin/stage-ssh -t "cd ~/aicc-infra-bundle && sudo infra/provision/promote-to-production.sh apply --confirm-production --expect-stage-id $OLDID --caddyfile ~/aicc-infra-bundle/Caddyfile.pre --ops-config ~/aicc-infra-bundle/infra/aicc-ops/config/aicc-ops.production.toml"
NEWID=$(~/aicc-rehearsal/bin/stage-ssh 'grep ^AICC_STAGE_ID= /etc/aicc-stage-identity | cut -d= -f2'); echo $NEWID      # an identifier, not a secret; note it
```
It stops with exit 3 and changes nothing if any gate fails; on a step failure fix and re-run the same command (completed steps are skipped), or `rollback`. From now on use the production key and the pinned file:
```bash
export PSSH="ssh -i $HOME/.ssh/aicc_cp_prod_operator -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts_aicc_prod aicc@$HOSTIP"
$PSSH 'cat /etc/aicc-stage-identity'                       # AICC_ENV=production ... www.copilt.org
$PSSH 'sudo ~/aicc-infra-bundle/infra/provision/promote-to-production.sh start --confirm-production'
$PSSH 'systemctl is-active mysql php8.3-fpm aicc-edge aicc-ops aicc-wp-cron.timer aicc-backup.timer; systemctl is-active aicc-cert-expiry.timer || true'   # cert-expiry timer: inactive (dark)
```
Swap the Mac-side agents that point at the retired name (they would alarm every hour otherwise):
```bash
infra/backup/macos/install-launchd.sh --uninstall --apply                                           # the STAGING pull agent (backups/logs are kept)
infra/sentinel/macos/install-launchd.sh --uninstall --apply
infra/sentinel/macos/install-launchd.sh --targets infra/sentinel/targets.dark.toml --apply          # api.copilt.org only until the cutover
```

### 6.5 Fresh WordPress install and seeding

```bash
$PSSH -t 'sudo ~/aicc-infra-bundle/infra/provision/promote-to-production.sh wp-install --admin-user <your-login> --admin-email <your-address>'    # hidden password prompt; use a password-manager value
# seeding: the Control Plane repo's own idempotent scripts (they are not part of the release tree)
CPW="/Users/avivgerman/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/<the approved CP worktree>"
rsync -a --delete -e "ssh -i $HOME/.ssh/aicc_cp_prod_operator -o IdentitiesOnly=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts_aicc_prod" "$CPW/scripts/" aicc@$HOSTIP:cp-scripts/
$PSSH 'sudo rm -rf /var/lib/aicc-cp/seed && sudo install -d -o aicc-cp -m 0750 /var/lib/aicc-cp/seed && sudo cp -R ~/cp-scripts/. /var/lib/aicc-cp/seed/ && sudo chown -R aicc-cp /var/lib/aicc-cp/seed
 for s in bootstrap-commercial-products:AICC_BOOTSTRAP_APPLY configure-account-required-checkout:AICC_ACCOUNT_POLICY_APPLY seed-legal-documents:AICC_LEGAL_SEED_APPLY; do
   sudo env ${s#*:}=1 aicc-wp eval-file /var/lib/aicc-cp/seed/${s%%:*}.php; done
 sudo env AICC_PRODUCTION=1 aicc-wp eval-file /var/lib/aicc-cp/seed/check-launch-blockers.php || true'
```
The last command **is expected to list blockers** (legal facts, gateway, mail until step 8): it is the launch checklist, not a promotion failure. Re-grant check for AICC Ops after the plugin created its counter table: `$PSSH "sudo mysql -N -e \"SHOW GRANTS FOR aicc_monitor@localhost\""` must still list `aicc_ops_counters` and `actionscheduler_actions` (MySQL keeps table grants when a database is dropped); `collector_failure` for the CP collector may fire once until the table exists.

### 6.6 Production releases (dark)

```bash
infra/release/deploy-release.sh --env production --kind site --artifact ~/aicc-releases/site-$SITE_REL.tar.gz --stage-host www.copilt.org --stage-ip $HOSTIP --stage-id $NEWID \
  --key ~/.ssh/aicc_cp_prod_operator --known-hosts ~/.ssh/known_hosts_aicc_prod --confirm-production $SITE_REL --dry-run          # then without --dry-run
# the same for --kind cp with $CP_REL when a new CP release is needed; the pre-release backup and the health gate run on the host
$PSSH 'aicc-deploy-status --last 6'                         # shows the promoted_to_production boundary record, then the new releases
```
The health gates use `-k` against our own loopback edge (the dark certificate is internal), and `smoke-cp.sh` presents `www.copilt.org` (read from the identity).

### 6.7 Dark verification (the production edge answers, nothing public)

```bash
$PSSH 'sudo cat /var/lib/aicc-edge/caddy/pki/authorities/local/root.crt' > ~/aicc-promotion/caddy-root.crt      # a PUBLIC certificate, not a key
scripts/ops/production-edge-check.sh --ip $HOSTIP --cacert ~/aicc-promotion/caddy-root.crt --full-demo-hash                  # expect: 0 failed
$PSSH 'sudo /usr/local/sbin/aicc-edge-listener-audit'
```
Operator browser access (wp-admin) through the tunnel; the dark certificate needs the SPKI exception **in that separate profile only**:
```bash
SPKI=$($PSSH 'sudo openssl x509 -in /var/lib/aicc-edge/caddy/pki/authorities/local/intermediate.crt -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64')
infra/provision/operator-tunnel.sh --env production --stage-ip $HOSTIP --key ~/.ssh/aicc_cp_prod_operator --known-hosts ~/.ssh/known_hosts_aicc_prod --spki-hash "$SPKI"
```
Full route proof (270 matrix cases) is `npm run staging:replay` against the production topology; it requires the stage identity route and therefore cannot run against a production-identity host, so the dark gate is `production-edge-check.sh` plus the Mac rehearsal's 20-section replay already recorded (`rehearsal.md`); the **first full replay against the live names is step 9.4**.

### 6.7b Client-address proof (why `AICC_LM_TRUSTED_PROXIES` stays empty, D11)

The REST throttle is 30 requests per 60 s per client address. Two sources: the Mac (its public address) and the host's own loopback.
```bash
for i in $(seq 1 31); do curl -s -o /dev/null -w '%{http_code} ' --cacert ~/aicc-promotion/caddy-root.crt --resolve www.copilt.org:443:$HOSTIP -X POST -H 'Content-Type: application/json' -d '{"license_key":"smoke-test"}' https://www.copilt.org/wp-json/aicc-license/v1/validate; done; echo   # the 31st (at the latest) is 429
$PSSH 'curl -s -o /dev/null -w "%{http_code}\n" -k --resolve www.copilt.org:443:127.0.0.1 -X POST -H "Content-Type: application/json" -d "{\"license_key\":\"smoke-test\"}" https://www.copilt.org/wp-json/aicc-license/v1/validate'   # a DIFFERENT source, same minute: NOT 429
```
If the second request is also 429, the buckets collapsed to one address: stop, and read `REMOTE_ADDR` as PHP sees it before touching any setting (the fix would be in the Caddy transport, not in a trusted-proxy list).

### 6.8 Backups, off-host copy, alerts in production mode

```bash
$PSSH 'sudo aicc-backup --label manual && sudo cat /srv/aicc/backups/status.json | jq "{status,label,finished_at}"'
# restricted pull account: REPLACES the staging pull key with the production one
scp -i ~/.ssh/aicc_cp_prod_operator -o IdentitiesOnly=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts_aicc_prod ~/.ssh/aicc_cp_prod_offhost.pub aicc@$HOSTIP:aicc_offhost_prod.pub
$PSSH 'sudo ~/aicc-infra-bundle/infra/backup/install-offhost-access.sh --env production --confirm-production --pubkey-file ~/aicc_offhost_prod.pub'
infra/backup/pull-offhost.sh --env production --stage-ip $HOSTIP --expect-id $NEWID --known-hosts ~/.ssh/known_hosts_aicc_prod_cp    # one pull by hand: SUCCESS lines + ack
infra/backup/macos/install-launchd.sh --env production --stage-ip $HOSTIP --expect-id $NEWID --apply                               # hourly, com.aicc.offhost-pull.production
$PSSH 'sudo cat /srv/aicc/backups/offhost-ack.json | jq .'                                                                          # verified:true, the production set
infra/backup/rehearse-production-dr.sh --report ~/aicc-promotion/dr-rehearsal-isolated.json                                         # isolated rehearsal, any time
```
Optional destructive proof on the production host (**only while it holds no customer and no order; the tool checks and refuses otherwise**):
`infra/backup/dr-drill.sh --env production --stage-ip $HOSTIP --stage-host www.copilt.org --stage-id $NEWID --tls dark --known-hosts ~/.ssh/known_hosts_aicc_prod --key ~/.ssh/aicc_cp_prod_operator --offhost-key ~/.ssh/aicc_cp_prod_offhost --i-understand-this-wipes-production-data`.
Then run the Telegram verification checklist (`alerting.md` section 1) so the production label is what you see.

### 6.9 Soak (24 h dark)

AICC Ops overview shows no CRITICAL; 24 hourly backups with Mac acks; `production-edge-check.sh` still green; the DO policies exist; the test alert (section 1c of `alerting.md`) was received; `aicc-cert-expiry` is off by design; `aicc-deploy-status` shows the expected releases; `aicc-restore scratch --production` of the newest set loads and fingerprints (non-destructive).

### 6.10 Publish the first Plugin release (Control Plane launch gate 5g blocks launch until one is installed and verified)

Needs the owner's decisions from the distribution workstream (first version number and customer-facing notes; `~/Downloads/AICC-launch-evidence/distribution/REPORT.md`). Build on the Mac from a clean Plugin commit, then publish; the host-side installer (`scripts/plugin-release/install-plugin-release.sh` of the Control Plane, run as root through sudo) re-validates everything, refuses an installed version being overwritten, and makes `current` atomic. **Never run this against the live host without approval of this step.**
```bash
PLUGW=~/Projects/ai-commerce-copilot-worktrees/<the approved Plugin worktree>; CPW="/Users/avivgerman/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/<the approved CP worktree>"
( cd "$PLUGW" && bin/build-release.sh --out ~/aicc-plugin-dist )                 # ZIP + .sha256 + manifest; refuses a dirty tree
PV=<the version>; D=~/aicc-plugin-dist
PUB="infra/release/publish-plugin-release.sh --env production --stage-host www.copilt.org --stage-ip $HOSTIP --stage-id $NEWID --key $HOME/.ssh/aicc_cp_prod_operator --known-hosts $HOME/.ssh/known_hosts_aicc_prod --installer $CPW/scripts/plugin-release/install-plugin-release.sh"
$PUB --zip $D/ai-commerce-copilot-$PV.zip --manifest $D/ai-commerce-copilot-$PV.manifest.json --sha256-file $D/ai-commerce-copilot-$PV.zip.sha256 --confirm-production $PV            # DRY RUN (production default): prints the plan
$PUB --zip ... --manifest ... --sha256-file ... --confirm-production $PV --apply                                                      # stage the release (current unchanged)
$PUB --zip ... --manifest ... --sha256-file ... --confirm-production $PV --apply --set-current                                          # make it current (idempotent for the same bytes)
$PSSH 'stat -c "%U:%G %a %n" /srv/aicc/shared/plugin-releases /srv/aicc/shared/plugin-releases/current'                                 # root:aicc-cp 750 / 640
$PSSH 'sudo env AICC_PRODUCTION=1 aicc-wp eval-file /var/lib/aicc-cp/seed/check-launch-blockers.php | grep -i "plugin download"'          # "current release <PV> ... (verified now)", and NO 5g blocker
# roll back / forward later (nothing is ever deleted):  $PUB --point-at <previous version> --confirm-production <previous version> --apply
```
The release store is outside every web root and no route serves it; `production-edge-check.sh` asserts `/plugin-releases/...` is not served. A customer-side download test needs a paid plan and therefore waits for the commerce work; the CP suite proves the entitlement-gated download against a fixture. The store is in the backup (D12): the first production backup after this step contains it.

## 7. DNS TTL lowering plan (DNS edits are the owner's; this task changes none)

Measured 2026-10-20/21: authoritative TTL is **1800 s** for the apex A records, MX, TXT and the `www` CNAME; SOA minimum is 3601 s (`runbook.md` section 0). Plan, in the registrar's Advanced DNS (Namecheap):

1. **T-2d, after the host is verified dark:** add `A edge.copilt.org -> 206.189.248.204`, TTL 300 (it carries no traffic; it is the target `www` will point at, so the `www` edit stays CNAME-to-CNAME and the record never disappears, `runbook.md` 2.5). Lower **only** the TTL of the `www` CNAME and of the four apex GitHub A records to 300 s. **Do not touch MX, the SPF TXT or any other TXT** (apex forwarding mail depends on them). Add the CAA records of `tls-caa-hsts.md` section 3 now (no effect on Pages renewals).
2. Wait at least **one full old TTL (30 min); the plan uses 24 h** so that every resolver cache has re-fetched the 300 s value.
3. T0 edits (section 9). T+1d after a stable day: keep 300. After section 10's last step raise the TTLs to 1800-3600 and delete `stage`.
4. Rollback uses the same 300 s window: one TTL plus resolver/browser tails (30-60 min of mixed behaviour, `runbook.md` section 5).

## 8. Outbound mail (SMTP) for production

Facts (checked 2026-10-22): DigitalOcean blocks outbound SMTP on 25/465/587 on Droplets (docs.digitalocean.com/support/why-is-smtp-blocked). **Read-only proof from this Droplet today:** `smtp-relay.brevo.com:2525` open, `mail.smtp2go.com:2525` open, `email-smtp.eu-central-1.amazonaws.com:2587` open, `smtp-relay.brevo.com:587` blocked/filtered. The recommended relay is Brevo free on `smtp-relay.brevo.com:2525` (STARTTLS), From/Reply-To `support@copilt.org` (decision record: `~/Downloads/AICC-launch-evidence/email/docs/email-provider-decision.md`).

Wiring in this repository (tested, `test_provision.sh`):
* `wp-config.production.template.php` contains an **`AICC_MAIL_*` region** (eight constants, no credential). `render-wp-config.sh --env production` keeps it **only if** `/etc/aicc-mail/smtp.env` exists, is a regular file, is `root:aicc-cp`, mode 0640 (0600/0440 accepted, anything for "other" or writable by the group refused), holds exactly `AICC_MAIL_SMTP_USER` and `AICC_MAIL_SMTP_PASS` (non-empty, no spaces/quotes), and `/etc/aicc-mail` is `root:aicc-cp 0750`. An existing but unsafe file makes the render **refuse** (nothing written, no value printed). No file = no region = **production sends no mail** (the CP layer is inert unless `AICC_MAIL_ENABLED === true`; it never falls back to PHP `mail()`). The stage render never carries the region, even if a `smtp.env` exists, and keeps the mail sink.
* **Deviation from the email workstream's note, with the reason:** the secrets file is `/etc/aicc-mail/smtp.env`, not `/etc/aicc/secrets/smtp.env`. `/etc/aicc` is `0750 root:root` on the host (read on 2026-10-22), so PHP-FPM (`aicc-cp`) cannot traverse to `/etc/aicc/secrets/` and the layer would report an unreadable secrets file forever. Opening `/etc/aicc` would expose the other secrets' names. `AICC_MAIL_SECRETS_FILE` is just a constant; the CP code accepts any absolute root-owned path outside the web root. `install-stack.sh` and the `secrets` step create `/etc/aicc-mail` (`0750 root:aicc-cp`, empty).
* The relay host is **not** added to `WP_ACCESSIBLE_HOSTS`: the layer sends with PHPMailer over a socket (`class-aicc-lm-mail.php` contains no `wp_remote_*`; the allow-list only governs WordPress's HTTP API). The FPM sandbox allows `AF_INET/AF_INET6` and the cgroup IP filter denies only loopback/link-local, so an outbound connection to the relay is permitted (not run end to end).

Owner steps after step 6.5 (the provider account, DKIM/DMARC DNS rows and the From/Reply-To mailbox are the email workstream's steps 1-5):

```bash
# 8.1 prove the port from the Droplet again on the day (5 seconds, read-only)
$PSSH 'for t in "smtp-relay.brevo.com 2525" "mail.smtp2go.com 2525"; do set -- $t; timeout 6 bash -c "</dev/tcp/$1/$2" && echo "$1:$2 open" || echo "$1:$2 BLOCKED"; done'
# 8.2 place the credentials with hidden prompts (never in chat or a shell history)
$PSSH -t 'sudo bash -c '"'"'umask 027; read -rp "Brevo login: " u; read -rsp "Brevo SMTP key: " k; echo; install -o root -g aicc-cp -m 0640 /dev/null /etc/aicc-mail/smtp.env; printf "AICC_MAIL_SMTP_USER=%s\nAICC_MAIL_SMTP_PASS=%s\n" "$u" "$k" > /etc/aicc-mail/smtp.env; unset k u'"'"
# 8.3 re-render (the renderer validates the file; it prints no value) and reload PHP-FPM
$PSSH 'cd ~/aicc-infra-bundle && sudo infra/provision/render-wp-config.sh --env production --confirm-production && sudo systemctl reload php8.3-fpm'
# 8.4 prove it as the PHP user (EHLO/STARTTLS/AUTH only, then one message to a mailbox you read)
$PSSH 'sudo aicc-wp aicc-mail check && sudo aicc-wp aicc-mail send-test --to=<mailbox you read> && sudo aicc-wp aicc-mail health --strict'
```
If port 2525 is blocked from the Droplet: open a DigitalOcean support ticket (the DNS authentication records already published) or use the email workstream's fallback; do not enable mail by another route.

## 9. The cutover gate (STOP: owner approval before anything public)

All of: sections 5 and 6.9 satisfied; the owner has re-read `runbook.md` sections 3 and 5; the rollback window facts re-checked (`runbook.md` 2.3: Pages certificate `notAfter`); legal/support/payment items either done or consciously accepted for a **pre-sales** launch (checkout stays closed: `coming_soon = yes`); the TTLs have been at 300 s for at least 24 h; a person is available for the next hour.

> **STOP: owner approval.** Each numbered action below is irreversible-ish (public DNS). Do them in order and stop at the first failure.

```
9.1  Mac: switch the observers to production names (they are idle until DNS moves, so first confirm they will not page: Telegram works):
       infra/sentinel/macos/install-launchd.sh --targets infra/sentinel/targets.production.toml --apply
     (the Mac sentinel is NOT 24/7; the 24/7 GitHub Actions variant is created in step 10.2)
9.2  Registrar: edit the www CNAME TARGET IN PLACE: avivg7.github.io.  ->  edge.copilt.org.      (CNAME to CNAME; never delete and re-add)
9.3  Wait until the AUTHORITATIVE server shows it:   dig @dns1.registrar-servers.com +noall +answer www.copilt.org CNAME
9.4  Host:  $PSSH "sudo ~/aicc-infra-bundle/infra/provision/promote-to-production.sh final-edge --confirm-cutover --caddyfile ~/aicc-infra-bundle/Caddyfile.final --expect-ip $RIP"
       (refuses unless public DNS already resolves www.copilt.org to $RIP; installs the automatic-HTTPS render, removes the dark overrides, enables the cert-expiry timer, RESTARTS the edge)
     Watch: $PSSH 'journalctl -u aicc-edge -f'   until the certificates are obtained (seconds when validation works).
9.5  Mac:   scripts/ops/production-edge-check.sh --ip $RIP --public --full-demo-hash          # every check, now with the public CA
     and the 270-case replay of runbook 1.5 against the live host, then the smoke checklist of runbook section 4.
9.6  Rollback now = R3: set the www CNAME back to avivg7.github.io.   (do not do 9.7 unless 9.5 is green)
9.7  Registrar: edit the FOUR apex A records IN PLACE to 206.189.248.204 (runbook 3.3c). MX/SPF/TXT untouched.
9.8  Verify the apex: http://copilt.org/x?y=1 -> https://www.copilt.org/x?y=1 in one hop; production-edge-check again.
9.9  HSTS stays at max-age=300. Announce only after 9.5 and 9.8 are green.
```

## 10. After the cutover

1. **T+0..T+1d:** hourly backups + Mac pulls continue; `offhost_stale` and `backup_stale` are live; cert expiry visible in AICC Ops (`cert_expiry` WARNING 14 d / CRITICAL 5 d) and in the timer; DO policies.
2. **24/7 external observer (one owner gate):** prepare with `infra/sentinel/github/prepare-sentinel-repo.sh --out ~/aicc-sentinel-repo` and follow `infra/sentinel/github/README.md` (dedicated PUBLIC repository, two Actions secrets, probes `https://www.copilt.org/healthz` only). Until it exists, **whole-host or DNS outages while the Mac sleeps are not detected by anything external**.
3. **HSTS ramp** (`tls-caa-hsts.md` section 4): 300 -> 86400 only after a clean day and renewal monitoring live; keep 300 for the whole Pages rollback window.
4. **T+7d clean:** raise the DNS TTLs back to 1800-3600; delete the `stage.copilt.org` A record; remove the staging operator key from `~aicc/.ssh/authorized_keys`; delete the Mac's `~/aicc-offhost-backups-stage` (staging dumps, wp-config with staging secrets) and the host's rollback bundle (`sudo shred -u` the secrets tar, `rm -rf /var/backups/aicc-promotion/<ts>`).
5. **Retire the Pages site** only by the owner's explicit approval (`runbook.md` section 6).

## 11. Rollback commands (summary)

```bash
# back to STAGING (R1/R2): identity, edge, wp-config, secrets, database (from the verified dump), backup directory; appends demoted_to_staging
$PSSH 'sudo ~/aicc-infra-bundle/infra/provision/promote-to-production.sh rollback --bundle /var/backups/aicc-promotion/<ts> --confirm-rollback'
# cutover rollback on the host only (R3): the tls-internal waiting render again
$PSSH 'sudo ~/aicc-infra-bundle/infra/provision/promote-to-production.sh dark-edge --caddyfile ~/aicc-infra-bundle/Caddyfile.pre --ops-config ~/aicc-infra-bundle/infra/aicc-ops/config/aicc-ops.production.toml'
# release rollback after launch (R5)
$PSSH 'sudo aicc-rollback-release --kind site'      # or --kind cp
```

## 12. What is proven, what is only prepared

**Proven on the Mac (not on the host):** the conversion script against a temp host prefix and a throwaway MySQL: gates (right machine id, owner secrets present/mode/format, pre-cutover render only), bundle, identity, secrets rotation, database replacement with new passwords, production wp-config render, edge/unit/ops installation, idempotent resume, start/wp-install argument handling (stubs), `final-edge` gated by DNS, `dark-edge`, full rollback to the staging state including the database; the real Caddy 2.11.7 validates both renders; the real edge preflight accepts the files the promotion writes and refuses the wrong combinations; the production backup/pull/restore chain with the production identity in an isolated target (dr-rehearsal-production-mode.json: 58-table schema, 0 differing fingerprint lines after recovery from the off-host copy, 2.3 s isolated RTO); `npm run infra:test` 1,000+ checks, `ops:test`, `sentinel:test`.
**Measured read-only on the host:** AICC Ops 24 h / 7 d metrics (`alerting.md` 1a), `aicc-restore scratch` of a real dump on the host's hardware (9.07 s load + fingerprint, live database untouched), outbound 2525/2587 reachability, the installed AICC Ops files are byte-identical to the repository.
**Not proven (needs the host and the owner):** the conversion on the real host (`systemctl`, real MySQL 8.0, real `aicc-wp`), `wp core install --prompt` over a piped TTY, a production Caddy start on Linux with `tls internal`, the Let's Encrypt issuance for `www` and the apex, the final-edge restart gap, IPv6 (no AAAA is published and the guest has none), SMTP delivery, Telegram delivery, DigitalOcean emails, the GitHub Actions sentinel, an end-to-end `aicc-restore live` in production mode (it can only run on the real host; the staging-mode run is 60.4 s, `README-backup.md`).

## 13. Host-readiness checklist (everything that must be green before the cutover gate, with the command that shows it)

| # | Item | Command / evidence | Source |
|---|---|---|---|
| 1 | Identity is production, id recorded | `$PSSH 'cat /etc/aicc-stage-identity'` | 6.4 |
| 2 | Services up, dark edge, cert timer off until cutover | `systemctl is-active mysql php8.3-fpm aicc-edge aicc-ops aicc-wp-cron.timer aicc-backup.timer` | 6.4 |
| 3 | Production wp-config rendered from the production template; no staging host; webhook URL + owner secrets; `AICC_LM_PLUGIN_RELEASE_DIR` set; `AICC_LM_TRUSTED_PROXIES` empty (D11); mail region only with a valid `smtp.env` | `$PSSH 'sudo grep -c "stage.copilt.org" /srv/aicc/shared/wp-config.php'` must print 0 | 6.4, 8 |
| 4 | Fresh WordPress at `https://www.copilt.org`, `blog_public` not 0, `coming_soon` still `yes` until a gateway exists | `aicc-wp option get home siteurl blog_public woocommerce_coming_soon` | 6.5 |
| 5 | Seeded products, account-required checkout, legal documents; CP launch checker run (it lists the open launch items) | `check-launch-blockers.php` | 6.5 |
| 6 | **Plugin release store holds a verified current release (rule 5g)** | step 6.10 | 6.10 |
| 7 | Production site build deployed (no identity route, no noindex) | `production-edge-check.sh` 0 failed | 6.6, 6.7 |
| 8 | Client addresses are per-source (rate-limit buckets do not collapse) | 6.7b | D11 |
| 9 | Hourly backups ok, `restore_check ok`, Mac pull acknowledged for the production set, plugin store inside the archive | `status.json`, `offhost-ack.json`, `tar -tzf` | 6.8 |
| 10 | Telegram TEST + WARNING/RECOVERED received, leak audit CLEAN; DO policies confirmed by the test e-mail | `alerting.md` 1b, 3 | alerting |
| 11 | Mail: port 2525 open, `aicc-mail check|send-test|health --strict` green (or consciously accepted as "no customer mail yet") | 8 | email |
| 12 | Second operator key + console recovery rehearsed; SSH-22 decision | `ssh-access.md` | |
| 13 | CAA records published, DNS TTLs at 300 s for 24 h, `edge.copilt.org` A record in place | 7 | |
| 14 | Observers: Mac sentinel on `targets.production.toml` ready, the Actions sentinel repo staged (not enabled before DNS) | 9.1, 10.2 | |
| 15 | 24 h soak clean | 6.9 | |
