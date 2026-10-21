# The Linux staging host: what changes, how it is rendered, how it is tested

Status (updated 2026-10-21): **the Linux staging host `stage.copilt.org` EXISTS and runs the stage render of this template** (Droplet, Caddy 2.11.7 as `aicc-edge`, PHP-FPM 8.3 pool user `aicc-cp`, MySQL 8.0, releases under `/srv/aicc/{site,cp}/releases`). It was exercised and then independently reviewed (`~/Downloads/AICC-cutover-evidence/linux-stage/`, `reviewer-architecture-final.md`; replay artifacts in `linux-stage/replay/`). Everything below was first implemented and tested locally with the real Caddy 2.11.7 and a real php-fpm 8.2.29 on the Mac (`docs/cutover/rehearsal.md`); the sections that say UNVERIFIED on Linux were written BEFORE the host existed, and `docs/cutover/runbook.md` section 10 lists what the staging run still did NOT prove (production render, apex/www flip, IPv6, HSTS ramp, Search Console, mail DNS, DB-changing rollbacks). Labels: **VERIFIED** (observed in a run on this Mac), **INFERRED** (follows from documentation or from a verified behaviour, not run), **UNVERIFIED** (needs the Linux host or the public CA).

Owner-approved defaults for the staging host (2026-10-21), all implemented in the one template `docs/cutover/Caddyfile.edge.template`:

| Decision | Implementation |
|---|---|
| Public name `stage.copilt.org`, Caddy automatic HTTPS with Let's Encrypt (HTTP-01 / TLS-ALPN-01, **no DNS API token**) | stage render, site address `{$AICC_PUBLIC_HOST}`, `acme_ca` pinned to Let's Encrypt (no ZeroSSL fallback), `email {$AICC_ACME_EMAIL}` |
| HTTP/3 **off** | `servers { protocols h1 h2 }`, no UDP listener, no `Alt-Svc` (an explicit `-Alt-Svc` keeps it that way) |
| Caddy to PHP through a **unix socket**, no HTTP upstream port anywhere | `php_fastcgi unix//run/php/aicc-cp.sock` with `root {$AICC_WP_ROOT}` (`/srv/aicc/cp/current` on the Linux hosts: the release tree is the WordPress root; `edge.env` sets it) |
| MySQL socket-only | a provisioning matter (`infra/mysql`); `scripts/ops/edge-listener-audit.sh` fails when 3306/33060 listen on TCP |
| Operator administration through an **SSH tunnel** to a **loopback-only** listener, no public CIDR allowlist | second site address `{host}:8443` with `bind 127.0.0.1` |
| Static site from `/srv/aicc/site/current` | `AICC_STATIC_ROOT` |
| Caddy admin API on loopback only; metrics enabled privately | `admin 127.0.0.1:12019`; global `metrics`; never routed by any site |
| JSON logs, REDACTED by an allow-list (since the architecture review H-5) | `(edge_log)`: `request>headers` and `resp_headers` deleted whole, only 7 request and 6 response headers come back as flat `req_*` / `resp_*` fields; 50 MiB x 10 retention; field `listener` = `public` or `operator`; the error log carries the same filter |

## 1. Architecture on the host

```
Internet --80/443 (h1,h2)--> Caddy (user aicc-edge) ---static---> /srv/aicc/site/current   (file_server; 50x.html, 404.html inside)
                                  |  \--php_fastcgi--unix//run/php/aicc-cp.sock--> PHP-FPM (user aicc-cp) --> /srv/aicc/cp/current --unix socket--> MySQL
                                  |   (Caddy reads the same docroot: existing files are served by file_server, everything else falls back to /index.php)
operator laptop --ssh -L 443:127.0.0.1:8443--> 127.0.0.1:8443 (Caddy, loopback only: same host name, same certificate, /wp-admin /wp-login.php /wp-cron.php allowed)
host itself ----> 127.0.0.1:12019 (Caddy admin API and /metrics; nothing else may reach it)
```

Nothing else listens: no php-fpm TCP port, no MySQL TCP port, no `php -S`. **PHP sees the real client address as `REMOTE_ADDR` and `HTTPS=on` from Caddy**, so `AICC_LM_TRUSTED_PROXIES` stays **empty** and the `wp-config.php` line `if ( $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https' ) { $_SERVER['HTTPS'] = 'on'; }` is **no longer needed** (harmless if left).

## 2. What changes compared with the macOS rehearsal

| Topic | macOS rehearsal (original) | Linux staging (this round) |
|---|---|---|
| WordPress origin | `reverse_proxy 127.0.0.1:18982` (`php -S`) | `php_fastcgi` on a unix socket to PHP-FPM; Caddy also serves WordPress's static files |
| Client address in PHP | `X-Forwarded-For` written by the edge, trusted from `127.0.0.1` | `REMOTE_ADDR` directly; **every** forwarding/identity header is stripped (X-Forwarded-For/-Proto/-Host and Via included) |
| Operators | `AICC_OPERATOR_CIDRS` (loopback was an operator) | loopback-only operator listener; the CIDR list is an optional rehearsal extra, **empty**, and the preflight refuses it on stage/production |
| HTTP/3 | on (UDP 443, short `Alt-Svc`) | off |
| Certificates | `local_certs` / `tls internal` | automatic public-CA HTTPS |
| Hosts | `www.copilt.org` + `copilt.org` | one name: `stage.copilt.org` (no apex block) |
| Unknown Host over TLS | Caddy answered an **empty 200** (found this round) | `strict_sni_host on`: 421 |

The rehearsal still runs the production topology (www + apex) and, new, a `stage` instance with the stage topology (`stage-rehearsal.copilt.org`, local certificates) so the stage render itself is exercised by the real binary.

## 3. The three renders of ONE template

```
node scripts/ops/render-edge.mjs --mode stage --out /etc/aicc-edge/Caddyfile        # {$AICC_PUBLIC_HOST} stays a placeholder; the value comes from edge.env
node scripts/ops/render-edge.mjs --mode stage --env-template --gen-stage-id         # an example /etc/aicc-edge/edge.env (no secrets; the stage id is a random marker)
node scripts/ops/render-edge.mjs --mode production                                  # the committed text, byte for byte. NOT activated by anything in this repo
```

| Mode | Hosts | Certificates | Identity route | Used for |
|---|---|---|---|---|
| `stage` | `{$AICC_PUBLIC_HOST}` (+ operator `{host}:8443`) | automatic, Let's Encrypt | **yes** (`/.well-known/aicc-stage-identity`), `X-Robots-Tag: noindex` on every response | the staging host |
| `production` | `www.copilt.org`, `copilt.org` (+ operator) | automatic | **never** | the later cutover; the preflight refuses to start it without `AICC_ALLOW_PRODUCTION_MODE=1` |
| `rehearsal` | production or stage topology | `local_certs`, `tls internal` | yes (`env: rehearsal`) | this Mac; php_fastcgi or reverse_proxy |

Only marked regions differ (global options, `aicc_tls`, `aicc_site_hook`, `aicc_stage_identity`, `aicc_stage_robots`, the `wp_proxy` selector, the site addresses and the apex-https block). Routing, redirects, headers, body caps and error pages are the same text in every mode, so one set of tests covers all of them. `npm run test:redirects` renders every mode, replays the matrix against the stage render (retargeted to the stage host) in a child run and requires 45 template mutants to die; the real binary replays the same cases (section 11 and `rehearsal.md`).

## 4. Routing semantics under php_fastcgi (nothing of the earlier semantics was dropped)

Ownership order, `/product/` exact vs `/product/<slug>`, root-query `wc-ajax`/`wc-api`/`rest_route` (also behind `/he`, `/es`, `/ru`), `/wp-json`, the aliases, 308 for non-GET, the bad-path guard, the TRACE guard, `xmlrpc.php` denied, `wp-activate`/`wp-signup` 404, 50x handling, security headers once, HSTS `max-age=300` without `includeSubDomains`/`preload`, the 2 MB body cap on public WordPress routes, the request id and the log redaction are all unchanged and replayed (270 matrix cases: 245 for the stage topology).

New rules that php_fastcgi makes necessary (the edge now reads the WordPress docroot; before, a web server in front of `php -S` decided what may run):

* **PHP runs only through WordPress's entry points** (`php_direct`): `/index.php`, `/wp-login.php`, `/wp-cron.php` and the direct children of `/wp-admin/`. Any other path containing `.php`, `.php5`, `.phtml`, `.phar`, `.pht` (also with path-info, any case) is a branded 404 on **both** listeners: an uploaded or plugin `.php` file is never executed directly. Pinned by 15 matrix cases and three mutants.
* **Private files of WordPress's trees are 404** (`wp_hidden`): dotfiles and dot-directories (`.git`, `.htaccess`, `.env`), `*.log`, `*.sql`, `*.bak`, `*.old`, `*.orig`, `*.swp`, `*.env`, `*.ini`, `*.sh`, `readme`/`changelog`/`license` files (version disclosure).
* `/metrics` is a plain 404 on every public route and on the operator listener (never Prometheus text).
* A path that is not a file falls back to WordPress (like nginx `try_files $uri /index.php`), so a missing asset under `/wp-content/` is WordPress's own 404, as before.

## 5. The operator listener and the SSH tunnel

The operator listener is the same host name on `127.0.0.1:8443` (`bind 127.0.0.1`, plus a guard that drops any peer that is not loopback). **A connection that arrives on that socket is the operator.** Nothing a public client sends changes that: the server is chosen by the listening socket first. **VERIFIED** (rehearsal section 04, 48 spoof checks): a public request with `X-Forwarded-For: 127.0.0.1` (also `::1, 127.0.0.1`), `X-Real-IP`/`Client-IP`/`True-Client-IP`, `Forwarded: for=127.0.0.1`, `Host: www.copilt.org:<operator port>`, `Host: 127.0.0.1[:port]`, `Host: localhost`, an upper-case Host, a trailing-dot Host, `X-Forwarded-Host` or `X-Original-URL` never gets operator treatment (403, or 421 for a foreign Host), even from a loopback peer. A request from `127.0.0.1` to the **public** listener is a public request.

On your laptop (the browser keeps the real name and gets the real certificate):

```
# 1. hosts file: 127.0.0.1  stage.copilt.org     (remove it when you are done)
# 2. tunnel (local port 443 needs sudo; a high local port works only if you also browse to https://stage.copilt.org:<port>, and WordPress then redirects away from it, so use 443)
sudo ssh -N -L 127.0.0.1:443:127.0.0.1:8443 operator@<stage ip>
# 3. browse https://stage.copilt.org/wp-login.php  and  /wp-admin/
```

A Chromium profile can do the same without touching the hosts file: `--host-resolver-rules="MAP stage.copilt.org 127.0.0.1:8443"` (the rehearsal's browser runner uses exactly this idea).

Properties: reachable only by someone who can already SSH to the host; cookies are host-only for `stage.copilt.org` and are sent to the public listener too, which denies `/wp-admin/` anyway; `wp-cron.php` stays closed to the world (use `wp cron event run --due-now` from the system cron). **VERIFIED**: the operator socket is not reachable from the LAN address of this Mac, not over `::1`, and the real operator login (POST `/wp-login.php`, 302, dashboard 200) works through it. **UNVERIFIED on Linux:** the tunnel itself (no SSH was used), `ss -ltn` on the real host (`scripts/ops/edge-listener-audit.sh` does that check).

## 6. Certificates (automatic HTTPS, Let's Encrypt): what to expect and what to verify

Expectations (INFERRED from Caddy's documentation; **UNVERIFIED**, a public CA cannot be contacted from this Mac):

1. Prerequisites: public A (and AAAA if the host has IPv6) for `stage.copilt.org` pointing at the host; ports 80 and 443 TCP reachable over IPv4 and IPv6; no firewall rule dropping the CA's validation traffic; no CAA record that forbids `letsencrypt.org` (check: `dig +short CAA copilt.org`).
2. First start with the Let's Encrypt **staging** CA: `AICC_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory` (the preflight warns). Browsers do not trust that certificate, but the whole chain of events (HTTP-01 or TLS-ALPN-01, storage, renewal timer) is proven without touching the production rate limit. Then delete the line, `systemctl reload aicc-edge`; Caddy keeps a separate storage directory per CA and obtains the real certificate.
3. The edge keeps `auto_https disable_redirects`; the ACME HTTP-01 challenge is answered by Caddy before any route is tried (this is Caddy's documented behaviour; **UNVERIFIED** with this exact config on the real CA).

Verify after issuance (commands for the host or any machine):

```
echo | openssl s_client -connect stage.copilt.org:443 -servername stage.copilt.org 2>/dev/null | openssl x509 -noout -issuer -subject -dates -ext subjectAltName
echo | openssl s_client -connect stage.copilt.org:443 -servername stage.copilt.org -showcerts 2>/dev/null | grep -c 'BEGIN CERTIFICATE'     # leaf + intermediate = 2
openssl s_client -connect stage.copilt.org:443 -servername stage.copilt.org -tls1_3 </dev/null 2>&1 | grep -E 'Protocol|Cipher is'
curl -sI https://stage.copilt.org/ | grep -iE 'alt-svc|strict-transport|x-robots-tag|server|via'
scripts/ops/cert-expiry-check.sh --host stage.copilt.org                                                     # from a machine OUTSIDE the host
sudo sh -c 'ls /var/lib/aicc-edge/caddy/certificates/*/stage.copilt.org/'                                         # on the host (the glob must expand AS root: the directory is 0700 aicc-edge): .crt, .key, .json per CA directory
```

| Check | Expected |
|---|---|
| Issuer | `Let's Encrypt` (an `R`-series intermediate); for the dry run the staging CA (`(STAGING) ...`) |
| Chain | the server sends leaf + intermediate (2 certificates) |
| SAN | **exactly** `DNS:stage.copilt.org` (no `www`, no apex: the stage render never names a production host; the preflight refuses a production name) |
| Validity | about 90 days; Caddy renews when a third of the lifetime is left (about 30 days before expiry); `cert-expiry-check.sh` warns under 21 days and is critical under 7 |
| Renewal configuration | nothing to configure: automatic, from the same storage; confirm with `journalctl -u aicc-edge | grep -i 'certificate'` after the first renewal window, and keep the external expiry monitor (do not rely on CA e-mail) |
| Operator listener | presents the **same** certificate: `openssl s_client -connect 127.0.0.1:8443 -servername stage.copilt.org` on the host |
| Protocols | TLS 1.2 and 1.3 (Caddy defaults); no HTTP/3: `ss -ulpn` shows no UDP 80/443 listener |

Back up Caddy's storage (`scripts/ops/caddy-storage-backup.sh`) after the first issuance. The preflight refuses `local_certs` / `tls internal` / pre-issued files in stage and production unless an explicit override (`AICC_ALLOW_INTERNAL_TLS`, `AICC_ALLOW_MANUAL_TLS`) is set, and prints that it was used.

## 7. No Alt-Svc, no HTTP/3 (VERIFIED on this Mac, INFERRED on Linux)

The standing rehearsal edge has **no UDP socket at all** (`lsof -iUDP` empty; real-Caddy section 10) and no response of any route, listener or error page carries `Alt-Svc` (replay, section 03 and the mutation harness: removing `protocols h1 h2` is caught by the "no UDP socket" detector, setting `Alt-Svc` by the header detector). On the host: `ss -ulpn | grep -E ':(80|443)\b'` must print nothing, and `curl -sI https://stage.copilt.org/ | grep -i alt-svc` must print nothing. The UDP 443 firewall rule is not needed.

## 8. Metrics are private

`metrics` is a **global** option: Caddy serves the Prometheus text at `http://127.0.0.1:12019/metrics` (the admin API, loopback only). No site, handle or snippet routes it. **VERIFIED:** `GET /metrics`, `/metrics/` and `/he/metrics` on the public AND the operator listener are the normal branded 404 (matrix cases, replay check "no Prometheus text on any route", real-Caddy detector, and a mutant that routes `metrics` publicly is killed by the preflight, by `test:redirects` and by the real-Caddy harness). Scrape it only from the host: `curl -s http://127.0.0.1:12019/metrics | head`, or a Prometheus on the same host. The admin API has no authentication, which is why the preflight refuses anything but loopback or a unix socket for it. Per-host labels are off (no `per_host`); metrics carry counters and histograms, no request paths, no client addresses.

## 9. What the edge expects from the provisioning work (check against `infra/php`, `infra/mysql`, `infra/systemd`)

* A PHP-FPM pool whose socket is `/run/php/aicc-cp.sock` with mode `0660`, `listen.owner` = the PHP user and `listen.group` = the edge's group (`aicc-edge`); the socket must exist **before** Caddy starts (`After=` / `Requires=` the pool in the edge unit; the preflight fails otherwise).
* The docroot `/srv/aicc/cp/current` (the Linux hosts; `/srv/aicc/cp/current/wp` was the macOS fixture layout) is a symlink to the release; it is **readable by the edge's user** (Caddy checks file existence and serves non-PHP files) and **not writable by it**; the PHP user writes only `wp-content/uploads` (and cache directories). `resolve_root_symlink` makes opcache follow release switches.
* `security.limit_extensions = .php`, `cgi.fix_pathinfo = 0`, `expose_php = Off` (the edge also strips `X-Powered-By`), `clear_env = yes`, `request_terminate_timeout` a little **below** `AICC_WP_TIMEOUT` (default 60 s) so PHP answers its own error before Caddy answers 504.
* `wp-config.php`: `home`/`siteurl` = `https://stage.copilt.org`, `AICC_LM_TRUSTED_PROXIES` empty or unset, no `X-Forwarded-Proto` line, `DISABLE_WP_CRON` true plus the system cron, `DB_HOST` the MySQL **socket**.
* The edge unit sets `AICC_EDGE_MODE=stage` and runs `aicc-edge-preflight --mode stage` as `ExecStartPre` and in `ExecReload` (`infra/systemd/aicc-edge.service`, which supersedes the generic `docs/cutover/caddy-edge.service.template`).
* `scripts/ops/edge-listener-audit.sh` on the host: only `*:80`, `*:443`, `127.0.0.1:8443`, `127.0.0.1:12019` (and sshd) listen; no UDP; no 3306, 9000, 6379, 18982.

## 10. Fail-closed test tooling

The lesson (owner): earlier malformed local requests accidentally reached the real public `www.copilt.org`. The tools can now no longer do that, by construction. Module: `scripts/lib/target-guard.mjs`; tests: `npm run test:target-guard`.

**Required, explicitly, or exit code 3 with nothing sent:** `--stage-host`, `--stage-ip`, `--port`, `--stage-id` (flags or `AICC_STAGE_HOST`, `AICC_STAGE_IP`, `AICC_STAGE_PORT`, `AICC_STAGE_ID`).

**Refused (exit 3):** a production name as the staging host (`www.copilt.org`, `copilt.org`, `api.copilt.org`, any other `*.copilt.org` that is not `stage*`); a known production address (`139.59.157.231`, the four GitHub Pages addresses `185.199.108-111.153`) as the expected IP; a URL without an explicit port or with a different port; a host that is not the named staging host; a missing or mismatching connect-to mapping (the guard builds its own, a hand-written `--resolve`/`--connect-to` to any other address is refused); a state-changing method (POST/PUT/PATCH/DELETE) before the identity was verified in the same run (in fact **any** request but the identity probe, so nothing is sent to an unproven server); a staging host whose public/system DNS differs from the expected IP (unless `--allow-dns-mismatch`, which still forces the connection to the IP and still needs the identity); a redirect off the staging host/port set (never followed; recorded as a violation; the run ends with 3); `-L`, proxies, `--config`, `--next`, a second URL smuggled into the arguments.

**Identity:** `GET https://<host>:<port>/.well-known/aicc-stage-identity` over the mapped connection must return `{"env":"staging","host":"<stage host>","id":"<--stage-id>"}`. The id is random, lives only in the host's `edge.env`, and is given to the tester out of band. The **production render and the production build never contain the route** (`test:target-guard` scans `out/`, `public/`, the committed template and the production render).

**Egress audit:** every request is checked before it is sent and recorded (JSONL when `AICC_GUARD_AUDIT_FILE` is set; the rehearsal writes `~/aicc-rehearsal/logs/guard-audit.jsonl`); `node scripts/lib/target-guard.mjs --audit-report FILE` summarises destinations, refusals, violations and sends to any address other than the expected one (exit 3 if any). A Node-level tripwire refuses and records any attempt to resolve a production name. Browsers: Chromium starts with `--host-resolver-rules="MAP <hosts> <ip>, MAP * ~NOTFOUND"`, a black-hole proxy for literal addresses, and a Playwright route handler that aborts and records every request outside the allowed host:port set; a violation ends the run with exit code 3.

**Production names:** only `--production-readonly` (GET/HEAD, port 443, no mapping, nothing else) can talk to them, and the rehearsal runners use it only when `AICC_REHEARSAL_PRODUCTION_READONLY=1` is set (the old "before/after" probe of `api.copilt.org` and the live-old-site comparisons are therefore **off by default**).

Commands for the real host (the operator commands that read root-owned state need `sudo` ON the host: `sudo sh -c 'ls /var/lib/aicc-edge/caddy/certificates/*/stage.copilt.org/'` (the directory is 0700 `aicc-edge`; the glob must expand as root), `sudo tail /var/log/aicc-edge/aicc-edge.log` (0640)):

```
npm run staging:replay -- --stage-host stage.copilt.org --stage-ip <ip> --port 443 --http-port 80 --stage-id <id>            # public listener: the whole matrix (306 cases since the REST-index rules), sweep, exposure probe
npm run staging:replay -- --stage-host stage.copilt.org --stage-ip 127.0.0.1 --port 443 --stage-id <id> --source operator     # through the SSH tunnel: the operator cases
npm run staging:replay -- --stage-host stage.copilt.org --stage-ip <ip> --port 443 --stage-id <id> --allow-dns-mismatch       # before DNS exists
node scripts/rehearsal/browser-flows.mjs --stage-host stage.copilt.org --stage-ip <ip> --port 443 --stage-id <id> --only 5,7,8  # read-only browser sections
scripts/rehearsal/rcurl --stage-host stage.copilt.org --stage-ip <ip> --port 443 --stage-id <id> -sI https://stage.copilt.org:443/
```

**Production names against the stage IP** (the apex/www redirect rules): the stage render has no apex and does not serve `www.copilt.org`; those rules are proven by the rehearsal (real Caddy, production topology) and the model. If you ever need them on the stage IP, the guard supports `--alias-host www.copilt.org --alias-host copilt.org --alias-production-names` (the names are only Host/SNI values of the forced connection, never resolved, GET/HEAD/POST only after the identity is verified, `--no-post` skips the state-changing cases), but this repository provides **no** production render that starts on the staging host: nothing production-shaped runs there before the cutover.

**The rehearsal fixture's own traffic (found with the macOS sandbox log, 2026-10-21).** WordPress sends outbound HTTP on its own: Action Scheduler's async runner posts to `admin_url('admin-ajax.php')`, which in the fixture is `https://www.copilt.org/wp-admin/admin-ajax.php`, a REAL public host, and update/marketplace checks go to wordpress.org and woocommerce.com. Under a loopback-only sandbox profile the kernel logged `php ... deny(1) network-outbound remote:*:443` during a normal rehearsal run, so earlier rounds almost certainly let the fixture (not the test runners) reach the public site (UNVERIFIED which hosts: the log redacts them). Now every PHP process of the fixture (php -S, php-fpm, wp-cli) loads `scripts/rehearsal/egress-guard.php` (only `www.copilt.org`/`copilt.org` forced to 127.0.0.1 on ports 80/443, and loopback; everything else is a `WP_Error` before any DNS lookup, logged to `~/aicc-rehearsal/logs/cp-egress-blocked.log`) and, on macOS, runs under `scripts/rehearsal/loopback-only.sb` (the kernel denies every other connect). The real staging host needs the same discipline in `wp-config.php` or an mu-plugin (`WP_HTTP_BLOCK_EXTERNAL` with `WP_ACCESSIBLE_HOSTS`, or Action Scheduler's `action_scheduler_allow_async_request_runner` filter) so a staging WordPress never calls the production site, the API host or a payment gateway by accident: an item for the provisioning work, not done here.

Replace `~/aicc-rehearsal/bin/rcurl` with `scripts/rehearsal/rcurl` (`ln -sf "$PWD/scripts/rehearsal/rcurl" ~/aicc-rehearsal/bin/rcurl`); the old script sent whatever it was given.

## 11. Order of work on the Linux host

1. Provision (other agents): PHP-FPM pool and socket, MySQL socket, release directories, users.
2. `node scripts/ops/render-edge.mjs --mode stage --env-template --gen-stage-id > /etc/aicc-edge/edge.env`; fill the owner inputs; `render-edge.mjs --mode stage --out /etc/aicc-edge/Caddyfile`.
3. `aicc-edge-preflight --mode stage --caddyfile /etc/aicc-edge/Caddyfile --env-file /etc/aicc-edge/edge.env` (adapts the config and checks the listeners; **does not** contact the CA).
4. DNS A/AAAA for `stage.copilt.org`; first start with the Let's Encrypt staging directory; verify section 6; switch to the production CA directory; verify again.
5. `scripts/ops/edge-listener-audit.sh`; `curl http://127.0.0.1:12019/metrics`; no Alt-Svc.
6. `npm run staging:replay` from outside (public) and through the tunnel (`--source operator`); browser sections 5, 7, 8; the tunnel login by hand.

## 12. Proven here vs. pending (explicit)

VERIFIED on this Mac (real Caddy 2.11.7, real php-fpm 8.2.29 on a unix socket, WordPress/WooCommerce fixture): the template renders and validates in all modes; the stage topology (one host, local certificates) passes the retargeted matrix on the public listener (234 of 245 cases pass, the 11 operator-peer cases are skipped there) and through the loopback operator listener (205 pass, 40 skipped because the operator socket serves https and the canonical host only), plus the 132-request sweep and the identity route; the forged `X-Forwarded-For`, `Client-IP`, `X-Real-IP`, `Forwarded`, `X-Forwarded-Host/Proto` and `Via` never reach PHP (and without the strip lines they do: `Forwarded`, `X-Real-IP`, `Client-IP`, `Via` arrived unchanged); `REMOTE_ADDR` is the real peer and `HTTPS=on`; operator vs public separation including spoof/Host variants; no UDP listener; no Alt-Svc; `/metrics` 404; strict SNI; PHP entry-point and private-file rules; the preflight's negative tests (104 checks); every refusal of the target guard (`npm run test:target-guard`: 244 checks).

UNVERIFIED until the Linux host exists: (1) public-CA issuance, HTTP-01/TLS-ALPN-01 on the real names, renewal, OCSP; (2) the SSH tunnel and `ss -ltn` on Linux; (3) PHP-FPM under Linux (pool user/group/socket modes, opcache with `resolve_root_symlink`, `request_terminate_timeout` vs the 504 path, real 502 when the socket is missing under systemd ordering); (4) public DNS and the DNS-mismatch gate against a real record; (5) the systemd unit (`systemd-analyze verify` was never run); (6) the browser sections against a remote host (the plumbing is verified against the Mac stage instance only); (7) behaviour of the stage render under the real CA's rate limits.

## 13. Decisions

Decided by the owner on 2026-10-21 (moved out of the open list): operator administration through an SSH tunnel; certificate method = Option B, automatic HTTPS (no pre-issued files, no DNS API token); HTTP/3 off; unix sockets. Rollback policy: **after the commercial launch, rollback means redeploying the previous known-good release on the new infrastructure; GitHub Pages is only a disaster fallback BEFORE the first customer** (`docs/cutover/runbook.md` section 5). The `aicommercecopilot.com` decision is not present in these documents (nothing to remove).

Still open (owner): the ACME contact address; the staging IP and the DNS record; who holds SSH keys for the tunnel; whether the stage database may hold production-like data (it should not); the monitoring target for `cert-expiry-check.sh`; whether to keep `FORCE_SSL_ADMIN`.
