# Production-like edge rehearsal (phase 1: the edge itself)

Status: **executed 2026-10-20 on one Mac, on loopback, with a real Caddy and a real WordPress/WooCommerce Control Plane fixture.** It is NOT the cutover and NOT the public launch. No public DNS, no `/etc/hosts`, no server, no deploy, no push, no commit was involved, and Caddy never contacted a public CA.
Every claim below is labelled **VERIFIED** (observed in a real run, evidence file named), **INFERRED** (reasoned, not observed) or **UNVERIFIED** (could not be tested here). Evidence: `~/Downloads/AICC-cutover-evidence/rehearsal/` (one `.md` and `.json` per section, `caddy-*.txt`, `live-facts-*.txt`, `log-samples-sanitized.jsonl`).

## 1. What was built (all in the SITE repo, `scripts/rehearsal/`)

| File | Purpose |
|---|---|
| `scripts/rehearsal/rehearsal.mjs` | CLI: `release`, `generate`, `validate`, `adapt`, `start`, `stop`, `reload`, `restart`, `status`, `run-tests`, `launchd-plist` |
| `scripts/rehearsal/edge.mjs` | generator + runner library. Template -> rehearsal Caddyfile; safety refusals; process control; old-target generator for the rollback rehearsal |
| `scripts/rehearsal/cp-fixture.sh` | ONE persistent disposable Control Plane (MySQL 8.4 + WordPress 7.1.2 + WooCommerce 10.9.4 + the worktree's plugin and theme symlinked): `create`, `start`, `stop`, `status`, `cron`, `wp ...`, `stop-php`/`start-php`/`stop-mysql`/`start-mysql`, `destroy` |
| `scripts/rehearsal/run-tests.mjs`, `lib.mjs`, `harness.mjs` | the real-HTTP test sections (routing, behaviour, admin, 5xx, break, logging, demo, restart, tls, rollback, apexpost, safety) |
| `docs/cutover/Caddyfile.edge.template` | the template, changed by what the real runs proved (section 8) |
| `docs/cutover/caddy-edge.service.template` | production systemd unit (documented, not executed) |
| `scripts/lib/redirect-matrix.mjs`, `scripts/test-redirects.mjs` | matrix extended (admin surface, TRACE, dot-segments, demo cache); model fixed where the real Caddy disagreed; 14 mutants |

Nothing generated at run time is inside a repo. Everything below lives under `~/aicc-rehearsal/` (outside every repo, not committed):

```
~/aicc-rehearsal/
  bin/caddy                     official Caddy v2.11.7 darwin/arm64 (sha512 verified earlier); bin/rcurl = curl wired to the rehearsal edge
  generated/Caddyfile[.name]    the generated rehearsal configs (+ Caddyfile.old-target for the rollback rehearsal)
  releases/<utc>-<sha>/         a copy of out/ (rsync --exclude .DS_Store) + 50x.html + .sha256 manifest;  releases/current -> the active release (atomic rename)
  caddy/data/                   Caddy storage: local CA, leaf certificates (dir 0700, keys 0600)       caddy/data/pki/authorities/local/root.crt = the rehearsal root CA
  logs/                         aicc-edge.log (access, JSON, redacted), error.log, caddy-*.stdout.log, cp-upstream.log, cp-php-*.log
  run/                          pid files, the launchd plist, scratch dirs
  cp/                           the CP fixture: mysql/ datadir, wp/ docroot, router.php, prepend.php, echo-token
  mail/                         captured outgoing mail (.eml)
  old-target/site/              the saved old site (home page, robots, sitemap, 404 page) for the rollback rehearsal
```

## 2. Versions, processes, ports

| Thing | Value |
|---|---|
| Caddy | `v2.11.7 h1:yj0Y4fYZGPkSvibBJ1sTWE33xC0fxztVyXEW5iIdUT4=`, `~/aicc-rehearsal/bin/caddy`, run as the normal user on this Mac (macOS 26.4, arm64), no root, no keychain change (`skip_install_trust`); modules are the stock build (no cache module, no DNS provider module) |
| Standing edge | `:80` and `:443` on the wildcard address (macOS lets an unprivileged process bind low ports only on the wildcard), admin API `127.0.0.1:12019`. **A rehearsal-only guard (`abort` for any non-loopback peer, placed first with `order abort before redir`) keeps the LAN out** (VERIFIED: a connection to the Mac's own LAN address is aborted) |
| Public-source twin | `127.0.0.1:18080` / `:18443`, admin `127.0.0.1:12020`, operator list `192.0.2.1/32` (so every loopback request is a *non-operator*). Used to prove what a public visitor gets; same template, same binary |
| CP upstream | `php -S 127.0.0.1:18982` (PHP 8.2.29, `PHP_CLI_SERVER_WORKERS=8`), docroot `~/aicc-rehearsal/cp/wp`, DB `aicc_rehearsal_cp` prefix `rhsl_` on its own MySQL 8.4 `127.0.0.1:18971` |
| Not used, not touched | QA 8981-8983 (QA stack at 8982 only ever received nothing from this work), owner fixtures 9111-9114, any `api.copilt.org` block |

Hostname model: `www.copilt.org` and `copilt.org` reach 127.0.0.1 **only** for rehearsal clients: `curl --resolve` (wrapper `~/aicc-rehearsal/bin/rcurl`) and Chrome `--host-resolver-rules="MAP www.copilt.org 127.0.0.1, MAP copilt.org 127.0.0.1"`. Public DNS and `/etc/hosts` are unchanged (VERIFIED, section `12-safety`).

## 3. Run it from scratch

```bash
cd ~/self_projects/ai_copilot_site
AICC_BASE_PATH="" SITE_URL=https://www.copilt.org npm run build          # only if out/ is stale
bash scripts/rehearsal/cp-fixture.sh create        # ~15 s: MySQL datadir, WordPress, WooCommerce, seeds (products, account-required checkout, legal documents), users; starts php + mysql
node scripts/rehearsal/rehearsal.mjs release       # out/ -> releases/<id>, current -> it
node scripts/rehearsal/rehearsal.mjs validate      # real `caddy validate` on the generated file
node scripts/rehearsal/rehearsal.mjs start         # standing edge on :80/:443
node scripts/rehearsal/rehearsal.mjs run-tests all # every section, ~10 min (the TLS section waits ~80 s for a real accelerated renewal)
node scripts/rehearsal/rehearsal.mjs run-tests routing   # or one: routing behavior admin errors break logging demo restart tls rollback apexpost safety
node scripts/rehearsal/rehearsal.mjs status
node scripts/test-redirects.mjs --write && npm run test:redirects        # the offline model + 14 mutants
```

Useful options: `--name`, `--http-port`, `--https-port`, `--admin`, `--upstream` (must be loopback), `--static-root`, `--operator-cidrs "A B"`, `--wp-timeout 60s`, `--variant cp-home|block-demo|no-certs` (temporary, joinable with `+`).
The generator refuses (exit 3) to produce or run a file that: lacks `local_certs`; has `acme_ca`/`acme_dns`/`email`/`on_demand_tls`/an issuer line; has an `api.copilt.org` address; has a non-loopback upstream or `bind`; has a static root outside `~/aicc-rehearsal`; or has a TLS-serving site block without `tls internal`. After start it reads Caddy's live config back from the admin API and fails if any ACME issuer is present. The only part of the template it rewrites is the marked global-options region and the two hook snippets (`aicc_tls` -> `tls internal`, `aicc_site_hook` -> loopback guard); routing, redirects, headers, logging and error handling are the production text. When the https port is not 443 the generator rewrites the absolute redirect target to include the port (`https://www.copilt.org:18443`) and binds loopback only; the standing edge on 443 keeps the production redirect text byte for byte.

Stop / tear down:

```bash
node scripts/rehearsal/rehearsal.mjs stop; node scripts/rehearsal/rehearsal.mjs stop --name public     # edges
bash scripts/rehearsal/cp-fixture.sh stop            # php + mysql (data kept);   `start` brings them back
bash scripts/rehearsal/cp-fixture.sh destroy         # deletes ~/aicc-rehearsal/cp and the captured mail
rm -rf ~/aicc-rehearsal/caddy ~/aicc-rehearsal/releases ~/aicc-rehearsal/logs ~/aicc-rehearsal/run    # everything else is regenerated
```

## 4. Phase 2 hand-off (drive browser flows through this edge)

* URLs: `https://www.copilt.org/` and `https://copilt.org/` (default ports) once the client maps the names to 127.0.0.1. Chrome: `--host-resolver-rules="MAP www.copilt.org 127.0.0.1, MAP copilt.org 127.0.0.1" --ignore-certificate-errors-spki-list=<SPKI pins>`; the pins (root, intermediate, leaf) are computed in `scripts/rehearsal/run-tests.mjs` (`spkiOf`) from `~/aicc-rehearsal/caddy/data/pki/authorities/local/{root,intermediate}.crt`; or trust `root.crt` yourself. Playwright: `chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: [...] })` (the `demo` section is a working example).
* Disposable CP (fake data only): staff `rehearsal-admin` / `Rehearsal-Admin-2026!` (only reachable from the operator list = loopback; `https://www.copilt.org/wp-login.php` -> `/wp-admin/`), customer `rehearsal-customer` / `Rehearsal-Customer-2026!` (`rehearsal-customer@example.test`), sign in at `https://www.copilt.org/my-account/`. Mail is captured to `~/aicc-rehearsal/mail/*.eml` (the reset link is inside). Request echo for header debugging: `GET /wp-json/?__rehearsal_echo=$(cat ~/aicc-rehearsal/cp/echo-token)` (fixture only, token-gated). `bash scripts/rehearsal/cp-fixture.sh wp <wp-cli args>` runs wp-cli against the fixture (usable as `WP_CMD="bash $PWD/scripts/rehearsal/cp-fixture.sh wp"` for the CP's `tests/browser/reset-password.mjs`).
* CP direct (bypassing the edge, for comparison only): `http://127.0.0.1:18982/` with `Host: www.copilt.org` and `X-Forwarded-Proto: https`.
* Not exercised by phase 1 and left for phase 2: the browser flows (cookies/`Secure`/`SameSite` in a browser, reset-password in he/es/ru, locale switching) beyond the curl-level customer flow in `04-admin-xmlrpc`.

## 5. What the real run proved

All sections pass on the final run (`~/Downloads/AICC-cutover-evidence/rehearsal/*.md`; counts are PASS/FAIL per file).

| Area | Result | Evidence |
|---|---|---|
| Routing matrix | VERIFIED: all 211 cases of `redirect-matrix.mjs` replayed through real Caddy without following redirects: status, exact `Location`, 308 for non-GET, `Cache-Control`; owner proven per request by the PHP marker header **and** the access-log `upstream` field (`127.0.0.1:18982` = WordPress, empty = Caddy); 2 case(s) are macOS case-insensitive-filesystem artifacts, reported as INFO | `01-routing-matrix` |
| Redirect sweep | VERIFIED: 264 sweeps (66 paths x apex/www x http/https), at most one **edge-made** hop, no loop; WordPress's own application redirects (e.g. empty-cart `/checkout/` -> `/cart/`) are counted separately | `02-redirect-sweep` |
| Headers, MIME, ranges, compression, HTTP/2, caching, security headers, hosts, injection, methods | VERIFIED (211 checks) | `03-behavior` |
| wp-admin / xmlrpc / wp-login / wp-cron | VERIFIED, section 6 | `04-admin-xmlrpc` |
| 5xx experience | VERIFIED: branded page for a stopped upstream, stopped MySQL, upstream 500/502/503 with a leaky body, slow upstream (504 at the configured timeout), garbage upstream, closed upstream; status kept, no leak | `05-5xx-experience` |
| Try to break it | VERIFIED: spoofed identity headers, smuggling-style input, ranges, path ambiguity, locale + WordPress routes, ownership of every route x locale, unkeyed headers | `06-try-to-break` |
| Logging | VERIFIED, section 7 | `07-logging` |
| Demo | VERIFIED: served bytes == approved master (`6ec46e72fd2531ea...`), Chrome playback and seek through the edge, CP Watch-demo probe | `08-demo` |
| Restart / failure | VERIFIED, section 9 | `09-restart-failure` |
| TLS | VERIFIED for the internal CA, UNPROVEN for the public CA, section 10 | `10-tls` |
| `wp_remote_post` to the apex (finding A8) | VERIFIED: WordPress's own HTTP API, POST to `https://copilt.org/wp-json/aicc-license/v1/validate` with the apex mapped to the edge, followed exactly one **308** to the `www` URL and got the Control Plane's JSON (`{"valid":false,"reason":"not_found"}`) | `13-apex-wp-remote-post` |
| Rollback | PARTIAL: config/content/timing rehearsed, public DNS and GitHub re-issuance not, section 11 | `11-rollback` |
| Safety | VERIFIED: no ACME contact, no outbound connection, no `/etc/hosts` or DNS change | `12-safety` |

Cache matrix (VERIFIED, `03-behavior`; "Set-Cookie responses never cacheable" held for every response that set a cookie in the whole run):

| Resource | Effective `Cache-Control` | Who decides |
|---|---|---|
| `/`, `/product/`, other static HTML | `public, max-age=0, must-revalidate` (ETag/Last-Modified) | edge |
| `/_next/static/*` (hashed) | `public, max-age=31536000, immutable` | edge |
| `/brand-kit/*`, `/fonts/*`, `/og/*`, `/robots.txt`, `/sitemap.xml` | `public, max-age=86400` | edge |
| `/demo/aicc-demo.mp4`, `.vtt`, poster | `public, max-age=0, must-revalidate`, 304 on `If-None-Match` | edge. **Choice:** the master is replaceable under the same URL and both sites hard-code the path, so these revalidate instead of using the one-day cache; revalidation is a 304, not 44 MB |
| `/pricing/` and other WordPress pages | `no-cache, must-revalidate, max-age=0, no-store, private` | WordPress |
| `/cart/`, `/checkout/`, `/my-account/`, login/logout, `/wp-json/*`, `?wc-ajax=`, `/he/?wc-ajax=`, `/wp-admin/admin-ajax.php` | `private, no-store, max-age=0` | edge (forced) |
| `/wp-content/*`, `/wp-includes/*` | whatever WordPress/the web server sends (not forced to no-store) | origin |

The edge caches nothing (VERIFIED: two identical `/pricing/` GETs both reached WordPress; no cache module in the binary). Security headers appear exactly once on 5xx/404/deny/redirect/proxied/static responses, HSTS is exactly `max-age=300`, no `Server`, `X-Powered-By` or `Via`.

## 6. wp-admin, xmlrpc, wp-login, wp-cron (owner decision, implemented and proven)

Dependency inventory (VERIFIED by search of the CP worktree, the product plugin, the Backend and the site; `04-admin-xmlrpc.json` `data.inventory`):

* `xmlrpc.php`: **no use anywhere** (CP plugin/theme: only the i18n path-exclusion list and a test helper; product plugin: none; Backend: none; site: none; Jetpack and the WordPress mobile app are not part of the stack; pingbacks off). **Decision: denied for everyone**, any case, encoding or path-info form (`/XMLRPC.php`, `/%78mlrpc.php`, `/xmlrpc.php/x`), 403, `no-store`, never proxied. Even operators get 403.
* `/wp-admin/admin-ajax.php` and `/wp-admin/admin-post.php`: the CP has **no front-end caller** (its only `admin_post_` handler, `aicc_lm_transition`, is a staff screen form; no `wp_ajax_` handler; WooCommerce's front-end uses `?wc-ajax=`). **Decision: both stay public anyway**, because WordPress core and Action Scheduler's async runner call them for visitors/loopback and any payment-gateway plugin (undecided) typically does; WordPress does its own nonce/capability checks. The edge exception matches the exact path only (`/wp-admin/admin-ajax.php/x` is not public).
* `/wp-login.php`: **customers do reach it**: the Connect page's "use a different account" link and the plan-intent code call `wp_logout_url()`, which is `/wp-login.php?action=logout&_wpnonce=...`; WordPress then shows its confirm page (HTTP 403 by WordPress's own design when no/old nonce) and redirects to `wp-login.php?loggedout=true`. Customer sign-in, registration and password reset are WooCommerce (`/my-account/`), `wp_lostpassword_url()` is `/my-account/lost-password/`. **Decision: operators only, except** `?action=logout` and `?loggedout=true`, which stay open for visitors. Staff login (POST) works from operators.
* `/wp-cron.php`: `DISABLE_WP_CRON` is true; the system cron (`cp-fixture.sh cron` = `wp cron event run --due-now`, VERIFIED exit 0) runs the entitlement outbox. **Decision: operators only.** Action Scheduler's loopback uses admin-ajax, which stays open.
* `/wp-admin/*` otherwise: **operators only** (`AICC_OPERATOR_CIDRS`; rehearsal `127.0.0.1/32 ::1/128`; **production value is an [OWNER] input**; empty/unset is a startup error, never "allow all").

Proof (VERIFIED): the table below is "public visitor / operator" status through the real edge (public = twin whose operator list is `192.0.2.1/32`, operator = standing edge):

| Request | Public | Operator |
|---|---|---|
| GET and POST `/xmlrpc.php` | 403 | 403 |
| `/wp-admin/`, `/wp-admin/index.php` | 403 | 302 (WordPress, to login) / dashboard after login |
| `/wp-admin/admin-ajax.php` (POST action=heartbeat), `/wp-admin/admin-post.php` | 200 | 200 |
| `/wp-login.php`, `?action=lostpassword` | 403 | 200 |
| `/wp-login.php?action=logout`, `?loggedout=true` | WordPress answers | WordPress answers |
| `/wp-cron.php` | 403 | 200 |

Also VERIFIED: a valid admin session cookie presented from a non-operator source is still 403; a spoofed `X-Forwarded-For`/`X-Real-IP`/`Forwarded` of an operator address does not open anything (the allowlist reads the TCP peer); `::1` is an operator on the standing edge and a miss on the twin. Customer flows from a non-operator source (pricing, sign-in, cart with add-to-cart, checkout, `?wc-ajax=` in English and he, Connect page, REST, WordPress logout, password reset incl. the emailed link) made 21 upstream requests; the only admin-surface URLs among them were the two `wp-login.php?action=logout` requests; none was refused by the edge. No regression: REST 200, system cron exits 0, operator staff login works through the edge.

## 7. Logging (VERIFIED, `07-logging`)

Caddy JSON access log `logs/aicc-edge.log` and runtime/error log `logs/error.log`; rotation 20 MiB x 5 files, 30 days (hard cap about 100 MiB per log; rotation mechanism itself proven on a throwaway Caddy with a 1 MiB roll size and 2 kept files). Fields: `ts`, `request.remote_ip` (the real peer: `127.0.0.1` for IPv4, `::1` for IPv6), `request.method/host/uri`, `status`, `duration`, `size`, `request_id` (the same id is sent upstream as `X-Request-Id`, recorded by the CP's upstream log, and returned to the client; a client-supplied id is overwritten) and `upstream` (`127.0.0.1:18982` for WordPress, empty for static/redirect/deny).
Redaction: no `Cookie`, `Authorization`, `X-WP-Nonce`, `Set-Cookie` values; `key`, `login`, `user_login`, `pass`, `password`, `pwd`, `token`, `code`, `nonce`, `_wpnonce`, `reset`, `license_key` (case-insensitive) are replaced by `REDACTED` in the logged URI, and the same filter runs over `Referer` and `Location`. A real emailed reset link was requested through the edge; a grep of all edge logs for its key, the test passwords and 25 other secret strings found 0 hits. Sample (sanitised, from `log-samples-sanitized.jsonl`): `GET /my-account/lost-password/?key=REDACTED&id=7&login=REDACTED&pass=REDACTED&... status 200 upstream 127.0.0.1:18982 request_id <uuid>`.

## 8. Where the real Caddy disagreed with the stand-in model (and what changed)

| # | Model / template assumption | Real Caddy 2.11.7 | Change |
|---|---|---|---|
| 1 | Path matchers see the path as sent | `path` / `path_regexp` see a **cleaned** path (dot-segments resolved, `//` merged); `reverse_proxy` forwards the RAW path. `/wp-admin//admin-ajax.php` therefore matches the public exception | New first rule `bad_path` uses `vars_regexp {http.request.uri.path}` (path as sent) and answers 400 for dot-segments, backslash, control characters; the model now cleans the path for the other matchers |
| 2 | `handle_errors` pages carry the site headers | They do **not** inherit the site block's `header` directives: 404/5xx pages had no HSTS/nosniff/X-Request-Id and sent `Server: Caddy` | `handle_errors` imports `security_headers` and `hsts` |
| 3 | `header` sets once | For proxied responses a plain `header` ADDS to what WordPress sent: duplicate `Cache-Control` / security headers | `header { defer ... }` in the snippets |
| 4 | `error {rp.status_code}` keeps the upstream status | Placeholder not accepted: every upstream 5xx became a 500 | one `handle_response` per status (500-504) |
| 5 | Unknown Host on :80 gets nothing | Caddy answers any Host with a 308 to `https://<that Host>/...` (attacker-chosen) | `auto_https disable_redirects` + catch-all `http://` block answering 421 (a model structure check and a mutant now pin both) |
| 6 | Unknown Host over TLS is refused | with a valid SNI and a foreign `Host`, Caddy answers an empty 200 (no site matched); `strict_sni_host` did not change it | Not fixable in a Caddyfile without a catch-all certificate; harmless (no content, no redirect); reported |
| 7 | `TRACE` is not an issue | proxied `TRACE`/`OPTIONS`/`PATCH` reached PHP (200 page) | `TRACE TRACK CONNECT` -> 405 at the edge (OPTIONS/PATCH stay: the REST API uses them) |
| 8 | `encode` compresses WordPress HTML/JSON | with the default `minimum_length` a chunked PHP response whose first write is small was never compressed | `minimum_length 1`. Static files and `jquery.min.js` (known length) were always fine |
| 9 | upstream headers are not Caddy's business | Caddy adds `Via: 1.1 Caddy` | `-Via` in the deferred header block |
| 10 | `/_next/static/*` assets always exist | the model's example hashed names are 404 in a real build | tests substitute real hashed files |
| 11 | `Pricing`/`PRODUCT` 404 (case) | macOS APFS is case-insensitive, `file_server` found the mirror (and issued its own 308 slash redirect) | INFO in the tests; Linux is case-sensitive (UNVERIFIED on Linux) |
| 12 | "at most one hop" | true for edge-made redirects; WordPress adds its own (empty-cart `/checkout/` -> `/cart/`) | sweep counts them separately |
| 13 | Original template syntax | `caddy adapt`/`validate` accepted the ORIGINAL template (only "unnecessary header_up" warnings, which remain: harmless, the explicit overwrite is kept on purpose) | none; the model's claims about syntax were right |

Findings that are not Caddy disagreements: `X-Powered-By: PHP/8.2.29` (stripped) and `Host:` response headers (a `php -S` artifact) come from the upstream; the oversized-header limit has Go's 4 KiB slack (a 25 KB header is refused, a 20 KB one is accepted).

## 9. Restart and failure (VERIFIED, `09-restart-failure`; this Mac, light probe of 4-6 workers)

| Scenario | Result |
|---|---|
| `caddy reload` (graceful), 4 in a row under a concurrent probe of static + WordPress + REST pages | mean **82 ms** (80-86); **0 failed of 196** requests, max latency 507 ms |
| hard stop (SIGTERM) + start | stop 102 ms, process start to ports open about 107 ms, first 200 about **0.3 s** after the stop command; probe saw a **0.23 s** outage |
| `kill -9`, no supervisor | stays down (connection refused) |
| `kill -9` under launchd (`KeepAlive`, `ThrottleInterval 2`, plist `~/aicc-rehearsal/run/org.copilt.aicc-rehearsal-edge.plist`, loaded with `launchctl bootstrap gui/<uid>`) | three in a row, each restarted with a new pid, first 200 after about **2.2 s** (2.16-2.23 s; the throttle) |
| edge cold start, certificates from storage | 0.7 s to the first WordPress page; certificate serial unchanged across kill -9, launchd restart and cold start |
| CP upstream stop/start (edge up) | static routes 0 failures; CP routes the branded 502 immediately; recovery measured from the start command about 2.4 s (php boot + health wait), edge untouched; 116 of 125 probe requests to CP routes got the branded 502 while it was down, 0 of 212 static requests failed |
| Port check | listeners of the rehearsal's own processes: caddy 80/443 (+UDP 443) wildcard and 18080/18443/12019/12020 loopback, mysqld 18971, php 18982; nothing on 8981-8983, 9111-9114 or 8000; non-loopback peers are aborted by the wildcard listener |
| Disk after the run | about 0.4 GB (the MySQL/WordPress fixture dominates), logs a few MB |
| `api.copilt.org` before and after | `HEAD /` identical (404 JSON, same headers; Date ignored) |

Production uses systemd instead of launchd: `docs/cutover/caddy-edge.service.template` (not executed). `php -S` with 8 forked workers is **not** PHP-FPM: do not read concurrency or latency numbers as production capacity.

## 10. TLS: proven and unproven

VERIFIED with `tls internal` / `local_certs` (`10-tls`): certificates issued for `www.copilt.org` and `copilt.org` (SAN exactly that name, Caddy Local Authority, leaf + intermediate sent, chain verifies against the root, serverAuth, no OCSP/CRL URL so stapling is n/a); data dir 0700 and keys 0600, owned by the service user; restart persistence (same serials, no new "obtained" log line); renewal configured and **actually performed** on a throwaway instance (120 s lifetime, replaced after 81 s without restart; the real 12 h leaves renew by themselves); TLS 1.2 and 1.3 only (1.1/1.0/SSLv3 refused), TLS 1.2 limited to three ECDHE-ECDSA AEAD suites; HTTP/2 negotiated; UDP 443 listening for HTTP/3; unknown SNI and no SNI get a TLS alert; a window with **no certificate** (variant `no-certs`) gives a clean TLS alert on https and a single 301 to https on http, no loop, and a reload brings https back in 0.18 s.

**UNPROVEN here (cannot be, without public DNS):** public-CA issuance for the real names (HTTP-01 / TLS-ALPN-01 reachability of ports 80/443 from the internet, Let's Encrypt and ZeroSSL rate limits and failed-validation limits, CAA, retry/backoff after a failed first attempt), DNS-01 through the Namecheap API, OCSP stapling with a public certificate, HTTP/3 from a real client, IPv6 reachability from outside, whether Namecheap's DNS API (which rewrites a whole host-record set) can be used safely next to MX/SPF.

### Certificate gate (owner command sequence; UNVERIFIED, written from documentation, nothing below was run)

Never let the edge try a public CA before the names point at it: failed HTTP-01 attempts back off for a long time and count against Let's Encrypt's failed-validation limit (5 per hostname per hour).

* **Option A: pre-issue before the flip (preferred for zero TLS gap).** Needs DNS-01, i.e. a TXT record `_acme-challenge.www` / `_acme-challenge` (an extra TXT record, **[OWNER]**, added beside the SPF TXT, removed afterwards). Without handing any token to automation: on the edge host, `certbot certonly --manual --preferred-challenges dns -d www.copilt.org -d copilt.org --cert-name aicc-edge` (the owner adds the two TXT values at Namecheap Advanced DNS when asked, then continues), copy `fullchain.pem`/`privkey.pem` to `/etc/caddy/certs/` (0700 dir, 0600 key, owner `caddy`), set `tls /etc/caddy/certs/fullchain.pem /etc/caddy/certs/privkey.pem` in `(aicc_tls)`, `caddy validate`, `systemctl reload`, then **before the flip** check `openssl x509 -in fullchain.pem -noout -dates -ext subjectAltName` and `curl --resolve www.copilt.org:443:<edge-ip> -vI https://www.copilt.org/` with the real CA. Renewal is manual (every 60 days) until, after the flip is stable, `(aicc_tls)` is emptied and Caddy takes over with HTTP-01. Automatic DNS-01 (`xcaddy build --with github.com/caddy-dns/namecheap`, an API token held by the owner, IP allow-listed at Namecheap) is possible but **[OWNER]** must decide it; the Namecheap API replaces whole host-record sets, so a mistake could touch MX/SPF. This task did not request any token.
* **Option B: staged start, then an immediate reload (no DNS API, small exposure).** Run the edge with the real names but `auto_https disable_certs` (the rehearsed `no-certs` state: no ACME attempt, https answers a TLS alert, http redirects once). Change DNS (**[OWNER]**), then `caddy reload` **as soon as the authoritative servers answer with the new record** (Let's Encrypt validates against the authoritative servers, not resolver caches, so this can be minutes before most clients move; INFERRED). Expected gap: issuance takes seconds when validation works; clients whose resolvers still hold the old record keep using GitHub Pages meanwhile. Risk: a validation failure puts both names without TLS until fixed or rolled back (runbook 5).
* **Option C (not recommended):** start with ACME enabled before DNS moves: the first attempts fail and back off.
* Either way: record `openssl s_client` evidence for both names (valid, public chain, notAfter) before announcing; keep HSTS at 300 s.

## 11. Rollback rehearsal: PARTIAL

VERIFIED (`11-rollback`): the old target modelled as a second local origin serving the saved old home page (byte-identical, sha256 `5321004d...`), robots.txt, sitemap.xml and the GitHub 404 page, apex and http answering a 301 to `https://www.copilt.org{path?query}` in one hop; the swap is `caddy reload` to that config: **43 ms** to reload, **54 ms** from the trigger to the first old-site answer, **0.4 s** to swap forward again; a separate old-target listener starts cold in **0.44 s**; after the swap `/my-account/`, `/pricing/`, `/cart/`, `/demo/...`, `/xmlrpc.php` are 404 exactly as on the live old site today (read-only comparison: `/my-account/` 404, `/pricing/` 404, apex 301, robots 200, sitemap 200).
UNPROVEN: public DNS propagation, resolver/browser caches, GitHub Pages re-serving after DNS returns, certificate re-issuance by GitHub.

Real-world rollback timeline, from facts re-checked on 2026-10-20 (`live-facts-2026-10-20.txt`):
* Authoritative TTL is **1799-1800 s** (`dns1/dns2.registrar-servers.com`, apex A, `www` CNAME); lower both to 300 s at least 30 minutes (ideally 24 h) before the flip so the revert is bounded by 300 s.
* Do the `www` change as ONE edit (delete CNAME and add the A/AAAA together, and the same on the way back): the SOA minimum is **3601 s**, so an empty answer can be cached for up to an hour.
* Browsers keep 301s (the new alias redirects `/account /login /register /shop /store`) and the existing apex 301; HSTS from the new edge is `max-age=300`, the old site sends none, so HSTS does not trap a rollback.
* **Critical:** the GitHub Pages certificate (Let's Encrypt YR2, issued 2026-08-21) **still expires 2026-11-19 09:36:54 GMT** (freshly re-verified, not renewed yet). GitHub cannot renew while DNS points elsewhere, so a rollback after that date presents an expired certificate. Rollback is credible only until the notAfter in force at the flip, unless GitHub renews first (runbook 2.3 and 3.1 record it).
* Estimated timeline of a revert: edit at the registrar (minutes, human) -> authoritative change immediate -> most clients within 5 minutes at TTL 300 (up to 30 minutes if the TTL was not lowered) -> old site reachable with valid TLS only while the Pages certificate is valid.

## 12. Differences from production (honest list)

`php -S` (forked workers) instead of PHP-FPM behind nginx/Apache; MySQL 8.4 from Local instead of the production database; mail captured, not sent (SPF/DKIM unproven); macOS APFS (case-insensitive) instead of Linux; wildcard listener with a loopback guard instead of a firewalled host; launchd instead of systemd; internal CA instead of a public CA; one machine, so no real network latency, no IPv6 reachability from outside, no HTTP/3 client; no `Host:`/`X-Powered-By` from the upstream web server in production. The upstream port must be reachable only from the edge in production: the CP believes `X-Forwarded-For` from anyone connecting from an address in `AICC_LM_TRUSTED_PROXIES` (VERIFIED residual: a direct request from the edge's address with an arbitrary XFF is believed).

## 13. Owner decisions that remain

1. `AICC_OPERATOR_CIDRS` for production (who may open `/wp-admin/`, staff `wp-login.php` and `wp-cron.php`); until named the production edge would deny everyone, which is the safe default.
2. Certificate method (section 10), including whether a Namecheap API token will ever be created.
3. Whether `/demo/*` should stay revalidatable (chosen here) or move to a versioned filename with a long cache.
4. Whether to localise the 5xx sentence (English only today) and whether JSON clients of `/wp-json/*` should get JSON instead of the HTML page when WordPress is down.
5. Rollback window: bounded by the GitHub Pages certificate notAfter (2026-11-19 unless renewed before the flip).
6. Production payment gateway: `/checkout/` stays reachable in the rehearsal fixture; the launch gates (runbook 1.17) still block a public launch.

## 12. Phase 2: real-browser flows through the edge (executed 2026-10-20)

`npm run rehearsal:browser` (`scripts/rehearsal/browser-flows.mjs`, repeatable, about 6 minutes; `--only 1,3,5` runs sections) drives Chrome (playwright-core) through the standing edge: names mapped to 127.0.0.1 inside the browser only, rehearsal CA accepted through SPKI pins, fake `@example.test` customers created and deleted per run (random passwords, memory only), no payment submitted. Results `~/Downloads/AICC-cutover-evidence/rehearsal/phase2/` (`00-summary.md`, one `.json`/`.md` per section, `screenshots/`: email/password fields masked, no URL bar). Last run: **531 checks, 0 failed** (cookies+session 93, csrf/nonces/back button 19, password reset EN/HE/ES/RU 63, locale routing and crawl 114, Watch demo 182, checkout infra 31, structured data/SEO 10, performance 9, client IP 10).

What it proved that curl could not (VERIFIED in the run): every cookie is host-only on `www.copilt.org` (no `Domain=`, none for the apex or `api`), Secure, HttpOnly except the deliberate JS-readable ones (`aicc_lang`, WooCommerce's two cart markers), no `sbjs_*`, no duplicate `aicc_lang`; the language cookie is set only by a click on the language menu; the apex redirect is one hop with no `Set-Cookie` and no `Cookie` header sent to the apex; sessions and carts survive static -> CP -> static hops in EN and HE; logout clears every cookie at its original path; a tampered login nonce, stale/tampered logout nonce, tampered `update_order_review` nonce and tampered/absent Store API nonce are all rejected; Back after logout re-requests the `no-store` account/checkout page (bfcache proven working on a static control page); the reset flow works end to end in EN/HE/ES/RU with the `wp-resetpass-*` cookie path under the language prefix and no reset key in the edge log; locale routing, language menu round trips, direct entry and apex entry for four locales; Watch demo on desktop/mobile touch/reduced motion (no `/demo/` request before the dialog opens, first video request is `Range: bytes=0-` -> 206, about 124 KiB before play, seeks are ranged 206, focus trap, Escape/close/backdrop, reopen clean, captions and `::cue` style); the public launch gate fails for the placeholder state; no Offer/price structured data anywhere.

Defects found by the browser and fixed: (1) WooCommerce's `woocommerce_items_in_cart` / `woocommerce_cart_hash` cookies were set with no `Secure` and no `SameSite` -> CP `AICC_LM_Commerce_UX::harden_cart_cookie_options` (Secure over HTTPS, `SameSite=Lax`; they stay non-HttpOnly because WooCommerce's cart-fragments script reads them); (2) the QA-only payment marker never appeared in the BLOCK checkout (WooCommerce's block integrations read `woocommerce_{bacs,cheque,cod}_settings` directly) -> display-only `option_*` filter, stored row untouched; (3) the edge forwarded browser-supplied `Client-IP`, `CF-Connecting-IP`, `X-Cluster-Client-IP`, `X-Originating-IP`, `Fastly-Client-IP`, `Forwarded-For`, `X-Forwarded`, `-Port`, `-Scheme`, `-Ssl`, `Front-End-Https`, `X-Url-Scheme` to WordPress (WooCommerce's Store API rate limiter reads `Client-IP`) -> template strips them; `npm run test:redirects` pins every stripped name (14/14 mutants still killed).

Facts to carry forward: the rehearsal host IS the production host name, so the QA marker is (correctly) not shown on it and the launch gate is the only guard (the marker was shown in a fixture-only QA-host simulation, EN and HE); WordPress auth cookies carry no explicit `SameSite` (WordPress core does not set one; Chrome applies Lax) - deferred; the origin web server's own access log must not record `key=` of the reset URL (the edge redacts it; `php -S` is not the production origin); if the edge's access log rotates, the high-port twin keeps writing to the rotated file until it is restarted (harness artifact: `rehearsal.mjs stop --name public`, then run any `run-tests` section); the Reco hero loop video (3.4 MB, `preload=metadata`) is requested only as a canceled metadata probe on mobile and under reduced motion (0 KiB), and is streamed only on desktop when visible.
