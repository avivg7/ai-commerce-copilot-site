# Production-like edge rehearsal (phases 1, 2, the round-4b fixes and round 5: Linux architecture + fail-closed tooling)

> **Round 5 (2026-10-21) changed the defaults; section 15 is the current state and `docs/cutover/stage-linux.md` the reference.** Operators use a loopback-only listener (SSH tunnel) instead of `AICC_OPERATOR_CIDRS`; WordPress is reached with `php_fastcgi` over a unix socket (the php -S + reverse_proxy form stays as a fallback); HTTP/3 and `Alt-Svc` are off; every runner is fail-closed (`scripts/lib/target-guard.mjs`). Passages below that describe the CIDR allowlist, `Alt-Svc`, `X-Forwarded-For` trust, `~/aicc-rehearsal/bin/rcurl`, `staging:replay --edge-ip/--base` or Options A/B for the certificate are the HISTORY of rounds 1-4 and are marked superseded in section 15.

Status: **executed 2026-10-20 on one Mac, on loopback, with a real Caddy and a real WordPress/WooCommerce Control Plane fixture.** It is NOT the cutover and NOT the public launch. No public DNS, no `/etc/hosts`, no server, no deploy, no push and no commit was involved, and Caddy never contacted a public CA.
Every claim below is labelled **VERIFIED** (observed in a real run, evidence file named), **INFERRED** (reasoned, not observed) or **UNVERIFIED** (could not be tested here). Evidence: `~/Downloads/AICC-cutover-evidence/rehearsal/` (one `.md` and `.json` per section, `caddy-*.txt`, `live-facts-*.txt`, `log-samples-sanitized.jsonl`, `phase2/`, `staging-replay/`).
**Currency of the numbers below:** the real-Caddy sections 01-20 were re-run in full on the FINAL template on 2026-10-20 (17:03-17:14 UTC; 12 and 11 re-run afterwards after a test-only change), the phase-2 browser suite after the last Control Plane change, and the offline model on the final tree. Earlier numbers in this document's history (211 cases, 14 mutants, 531 browser checks, "all sections pass on the final run") described EARLIER templates and are superseded. The reviewers found real defects after those runs (section 8, rows 14-20); this revision fixes them.

## 1. What was built (SITE repo)

| File | Purpose |
|---|---|
| `scripts/rehearsal/rehearsal.mjs` | CLI: `release`, `generate`, `validate`, `adapt`, `start`, `stop`, `reload`, `restart`, `status`, `run-tests`, `launchd-plist` |
| `scripts/rehearsal/edge.mjs` | generator + runner library. Template -> rehearsal Caddyfile; safety refusals; **runs `scripts/ops/edge-preflight.sh` before every start/reload/validate**; release builder (union of `_next/static`, prune); old-target generator for the rollback rehearsal |
| `scripts/rehearsal/cp-fixture.sh` | ONE persistent disposable Control Plane (MySQL 8.4 + WordPress 7.1.2 + WooCommerce 10.9.4 + the worktree's plugin and theme symlinked): `create`, `start`, `stop`, `status`, `cron`, `wp ...`, `stop-php`/`start-php`/`stop-mysql`/`start-mysql`, `destroy` |
| `scripts/rehearsal/run-tests.mjs`, `lib.mjs`, `harness.mjs` | the real-HTTP sections 01-20 (below) |
| `scripts/rehearsal/browser-flows.mjs` | the phase-2 real-browser suite (`npm run rehearsal:browser`) |
| `scripts/staging-replay.mjs` | **the runbook's hard gate as a tool** (`npm run staging:replay`): replays every matrix case against ANY edge; Node + curl only, no fixture |
| `scripts/ops/edge-preflight.sh` | fail-closed start gate (env, files, CIDRs, certificates, admin API, `caddy validate`) |
| `scripts/ops/cert-expiry-check.sh` | certificate expiry monitor for cron/uptime tools (exit 0/1/2/3) |
| `scripts/ops/caddy-storage-backup.sh` | backup / verify / restore of Caddy's storage (ACME account, certificates, keys) |
| `scripts/ops/upstream-exposure-check.sh` | is the WordPress upstream reachable from somewhere it must not be? |
| `docs/cutover/Caddyfile.edge.template` | the template, changed by what the real runs proved (section 8) |
| `docs/cutover/caddy-edge.service.template` | production systemd unit: self-contained, collision-free (not executed; `systemd-analyze verify` NOT run) |
| `scripts/lib/redirect-matrix.mjs`, `scripts/test-redirects.mjs` | the matrix (243 cases) and its offline model; 18 mutants |

Control Plane repo (round 4b): `includes/class-aicc-lm-login-throttle.php` (failed-sign-in throttle, section 6) and `tests/run_login_throttle_tests.php`.

Nothing generated at run time is inside a repo. Everything below lives under `~/aicc-rehearsal/` (outside every repo, not committed):

```
~/aicc-rehearsal/
  bin/caddy                     official Caddy v2.11.7 darwin/arm64 (sha512 verified earlier); bin/rcurl = the OLD curl wrapper (superseded: use scripts/rehearsal/rcurl, which is fail-closed)
  generated/Caddyfile[.name]    the generated rehearsal configs
  releases/<utc>-<sha>/         a copy of out/ + 50x.html + the _next/static files of the previous 3 releases + .sha256 manifest and .static.txt; releases/current -> the active release (atomic rename)
  caddy/data/                   Caddy storage: local CA, leaf certificates (dir 0700, keys 0600); caddy/data/pki/authorities/local/root.crt = the rehearsal root CA
  logs/                         the standing edge: aicc-edge.log (access, JSON, redacted), error.log; EVERY OTHER instance: logs/<name>/ (own files: no instance shares a rotated file)
  run/                          pid files, the launchd plist, scratch dirs of the tests
  cp/                           the CP fixture: mysql/ datadir, wp/ docroot, router.php, prepend.php, echo-token
  mail/                         captured outgoing mail (.eml)
  old-target/site/              the saved old site (home page, robots, sitemap, 404 page) for the rollback rehearsal
```

## 2. Versions, processes, ports

| Thing | Value |
|---|---|
| Caddy | `v2.11.7 h1:yj0Y4fYZGPkSvibBJ1sTWE33xC0fxztVyXEW5iIdUT4=`, `~/aicc-rehearsal/bin/caddy`, run as the normal user on this Mac (macOS 26.4, arm64), no root, no keychain change (`skip_install_trust`); stock build (no cache module, no DNS provider module) |
| Standing edge | `:80` and `:443` on the wildcard address (macOS lets an unprivileged process bind low ports only on the wildcard), admin API `127.0.0.1:12019`. A rehearsal-only guard (`abort` for any non-loopback peer, placed first with `order abort before redir`) keeps the LAN out (VERIFIED) |
| Public-source twin | `127.0.0.1` and `[::1]` on `:18080` / `:18443`, admin `127.0.0.1:12020`, operator list `192.0.2.1/32` (so every loopback request is a *non-operator*); same template, same binary; own log directory |
| Scratch instances | started and removed by the tests on `:18090-:18160`, `:18455-:18460`, admin `:12022-:12031` (slow upstream, bad gateway, rollback old target, Option A, release sandbox, mutants, restored storage); all loopback-only, all stopped at the end of their section |
| CP upstream | `php -S 127.0.0.1:18982` (PHP 8.2.29, `PHP_CLI_SERVER_WORKERS=8`), docroot `~/aicc-rehearsal/cp/wp`, DB `aicc_rehearsal_cp` prefix `rhsl_` on its own MySQL 8.4 `127.0.0.1:18971`; wp-config has `AICC_LM_TRUSTED_PROXIES=['127.0.0.1']`, `AICC_LM_OPERATOR_CIDRS='127.0.0.1/32'` (the sign-in throttle's exemption: IPv4 loopback only, so `::1` is an ordinary client) |
| Not used, not touched | QA 8981-8983, owner fixtures 9111-9114, any `api.copilt.org` block |

Hostname model: `www.copilt.org` and `copilt.org` reach 127.0.0.1 **only** for rehearsal clients: `curl --resolve` / `--connect-to` (round 5: `scripts/rehearsal/rcurl`, fail-closed; the names are mapped by the target guard, never by a hand-written `--resolve`) and Chrome `--host-resolver-rules`. Public DNS and `/etc/hosts` are unchanged (VERIFIED, `12-safety`).

## 3. Run it from scratch

```bash
cd ~/self_projects/ai_copilot_site
AICC_BASE_PATH="" SITE_URL=https://www.copilt.org npm run build          # only if out/ is stale
bash scripts/rehearsal/cp-fixture.sh create        # ~15 s: MySQL datadir, WordPress, WooCommerce, seeds (products, account-required checkout, legal documents), users; starts php + mysql
node scripts/rehearsal/rehearsal.mjs release       # out/ -> releases/<id> (+ carried chunks, pruning), current -> it
node scripts/rehearsal/rehearsal.mjs validate      # preflight + real `caddy validate` on the generated file
node scripts/rehearsal/rehearsal.mjs start         # standing edge on :80/:443 (and `start --name public` for the twin)
node scripts/rehearsal/rehearsal.mjs run-tests all # sections 01-20, ~15 min (the TLS section waits ~80 s for a real accelerated renewal)
node scripts/rehearsal/rehearsal.mjs run-tests routing   # or one: routing behavior admin errors break logging demo restart tls rollback apexpost optiona preflight release ops mutation throttle staging safety
npm run rehearsal:browser                          # the phase-2 real-browser suite, ~6 min
npm run staging:replay -- --rehearsal edge --source operator --ci-fs accept      # round 5: the loopback operator listener; `--rehearsal public|stage` for the twin and the stage topology
node scripts/test-redirects.mjs --write && npm run test:redirects        # the offline model + 18 mutants
```

Options: `--name`, `--http-port`, `--https-port`, `--admin`, `--upstream` (must be loopback), `--static-root`, `--operator-cidrs "A B"`, `--wp-timeout 60s`, `--storage DIR`, `--tls-files cert,key` (rehearse the manual-certificate form), `--variant cp-home|block-demo|no-certs` (temporary, joinable with `+`).
The generator refuses (exit 3) to produce or run a file that: lacks `local_certs`; has `acme_ca`/`acme_dns`/`email`/`on_demand_tls`/an issuer line; has an `api.copilt.org` address; has a non-loopback upstream or `bind`; has a static root outside `~/aicc-rehearsal`; or has a TLS-serving site block without `tls internal` (or `tls <cert> <key>` with both files under `~/aicc-rehearsal`). The preflight stops with exit 4 before a start/reload on a missing or unsafe input. After start it reads Caddy's live config back from the admin API and fails if any ACME issuer is present. The only parts of the template it rewrites are the marked global-options region and the two hook snippets (`aicc_tls` -> `tls internal`, `aicc_site_hook` -> loopback guard); routing, redirects, headers, logging, body cap and error handling are the production text. **Production-only lines absent from the rehearsal rendering** (stated because a reviewer asked): `email {$AICC_ACME_EMAIL}`, the production error-log path and size, `admin {$AICC_ADMIN_ADDR:...}` (the rehearsal sets its own admin address), `servers { ... }` timeouts and header limit are re-stated in the rehearsal region with the same values; `auto_https disable_redirects` is present in both. When the https port is not 443 the generator rewrites the absolute redirect target to include the port and binds loopback only; the standing edge on 443 keeps the production redirect text byte for byte.

Stop / tear down:

```bash
node scripts/rehearsal/rehearsal.mjs stop; node scripts/rehearsal/rehearsal.mjs stop --name public     # edges
bash scripts/rehearsal/cp-fixture.sh stop            # php + mysql (data kept);   `start` brings them back
bash scripts/rehearsal/cp-fixture.sh destroy         # deletes ~/aicc-rehearsal/cp and the captured mail
rm -rf ~/aicc-rehearsal/caddy ~/aicc-rehearsal/releases ~/aicc-rehearsal/logs ~/aicc-rehearsal/run    # everything else is regenerated
```

## 4. Hand-off (drive browser flows through this edge)

* URLs: `https://www.copilt.org/` and `https://copilt.org/` (default ports) once the client maps the names to 127.0.0.1. Chrome: `--host-resolver-rules="MAP www.copilt.org 127.0.0.1, MAP copilt.org 127.0.0.1" --ignore-certificate-errors-spki-list=<SPKI pins>`; the pins (root, intermediate, leaf) are computed in `scripts/rehearsal/run-tests.mjs` (`spkiOf`) from `~/aicc-rehearsal/caddy/data/pki/authorities/local/{root,intermediate}.crt`; or trust `root.crt` yourself. To appear as a NON-operator client for the Control Plane's sign-in throttle, map the names to `[::1]` instead (the `throttle` section does).
* Disposable CP (fake data only): staff `rehearsal-admin` / `Rehearsal-Admin-2026!` (only reachable from the operator list = loopback; `https://www.copilt.org/wp-login.php` -> `/wp-admin/`), customer `rehearsal-customer` / `Rehearsal-Customer-2026!` (`rehearsal-customer@example.test`), sign in at `https://www.copilt.org/my-account/`. Mail is captured to `~/aicc-rehearsal/mail/*.eml`. Request echo for header debugging: `GET /wp-json/?__rehearsal_echo=$(cat ~/aicc-rehearsal/cp/echo-token)` (fixture only, token-gated). `bash scripts/rehearsal/cp-fixture.sh wp <wp-cli args>` runs wp-cli against the fixture.
* Do not reuse the literal fixture credentials for any non-rehearsal environment.

## 5. What the real run proved (final run, counts are PASS / FAIL per file)

| # | Section | Result | Evidence file |
|---|---|---|---|
| 01 | Routing matrix | VERIFIED: all **243** cases of `redirect-matrix.mjs` through real Caddy without following redirects: **241 PASS, 0 FAIL, 2 INFO** (the two INFO are macOS case-insensitive-filesystem artifacts: `/Pricing/`, `/PRODUCT/`). Owner proven per request by the PHP marker header AND the access-log `upstream` field (read across all instances' logs, rolled files included) | `01-routing-matrix` |
| 02 | Redirect sweep | VERIFIED: **264** sweeps, at most one edge-made hop, no loop; WordPress's own redirects counted separately (`/checkout/ -> /cart/`, `/wp-admin/ -> /wp-login.php`) | `02-redirect-sweep` |
| 03 | Headers, MIME, ranges, compression, HTTP/2, caching, hosts, injection, methods, body cap, Alt-Svc | VERIFIED **236 / 0**. Unknown Host assertions check the exact behaviour (421 `Misdirected request` on :80; an empty 200 over TLS with a foreign Host) | `03-behavior` |
| 04 | wp-admin / xmlrpc / wp-login / wp-cron, customer flows | VERIFIED **67 / 0** including **19 login-bypass attempts from a non-operator source (no session, WordPress never reached)** | `04-admin-xmlrpc` |
| 05 | 5xx experience | VERIFIED **41 / 0** | `05-5xx-experience` |
| 06 | Try to break it | VERIFIED **46 / 0** | `06-try-to-break` |
| 07 | Logging | VERIFIED **16 / 0** | `07-logging` |
| 08 | Demo | VERIFIED **15 / 0** | `08-demo` |
| 09 | Restart / failure | VERIFIED **13 / 0**, section 9 | `09-restart-failure` |
| 10 | TLS (internal CA) | VERIFIED **17 / 0**; public CA UNPROVEN, section 10 | `10-tls` |
| 11 | Rollback | PARTIAL **12 / 0**, section 11 | `11-rollback` |
| 12 | Safety | VERIFIED **15 / 0** | `12-safety` |
| 13 | `wp_remote_post` to the apex | VERIFIED **2 / 0**: one 308, then WordPress's JSON | `13-apex-wp-remote-post` |
| 14 | Option A: manual `tls <cert> <key>` | VERIFIED **19 / 0** with a throwaway self-signed pair | `14-option-a-manual-certificate` |
| 15 | Preflight negative tests | VERIFIED **51 / 0** | `15-preflight` |
| 16 | Release swap | VERIFIED **9 / 0** | `16-release-swap` |
| 17 | Ops scripts | VERIFIED **19 / 0** | `17-ops-scripts` |
| 18 | Mutation testing against a REAL Caddy | VERIFIED **19 / 0**: 23 mutants, **17 killed**, 6 survivors listed below | `18-mutation-real-caddy` |
| 19 | Failed-login throttle in a real browser | VERIFIED **9 / 0** | `19-login-throttle-browser` |
| 20 | The staging replay tool | VERIFIED **9 / 0** | `20-staging-replay-tool` |
| P2 | Phase-2 browser suite (`npm run rehearsal:browser`) | VERIFIED: 10 sections, **564 checks, 0 failed** (cookies 93, csrf/nonces 19, password reset EN/HE/ES/RU 63, locale routing 114, Watch demo 182, checkout infra 31, structured data/SEO 10, performance 9, client IP 10, public surface 33). A first run after the throttle landed FOUND A DEFECT IN MY OWN CHANGE (a WooCommerce filter I had switched off also governs lost-password by e-mail address: 22 reset checks failed); the filter is no longer touched | `phase2/` |
| M | Offline model | `npm run test:redirects`: **243 cases, 1638 checks, 264-request sweep, 18/18 mutants killed** | (stdout) |

Total real-Caddy checks (01-20): **1120 PASS, 0 FAIL** (+ 564 in the browser suite).

**Mutation testing against the real Caddy (18).** Each mutated template runs on a scratch instance; thirteen real-HTTP detectors must notice. Killed: M02 (remove `defer` from the forced Cache-Control: duplicates), M03 (catch-all 421 block deleted: the detector sees a 308 to `https://evil.example/...`), M04 (`-Client-IP`), M05 (`-CF-Connecting-IP`), M06 (the OLD wp-login exception: `POST ?loggedout=true` -> 302), M10 (body cap), M11 (TRACE guard), M12 (dot-segment guard), M13 (`handle_errors` without security headers), M14 (Alt-Svc), M15 (`-Via`/`-Server`), M16 (client-chosen request id passes), M17 (wp-admin deny removed), M18 (xmlrpc deny removed), M20 (wp-activate/wp-signup/50x), and M21/M22 (Option A structure: `caddy validate` itself rejects it). **Survivors, said plainly:** M01 (`defer` removed from `security_headers`): the security headers are NOT duplicated on any route WordPress sends them on, so this one is an equivalent mutant on the tested routes (the earlier claim that plain `header` duplicates security headers was wrong; only `Cache-Control` was ever seen duplicated, M02); M07/M08/M09 (`header_up X-Forwarded-For/-Proto/-Host` removed): equivalent, Caddy sets the same values itself and the detectors assert what WordPress RECEIVES, not the template text (`caddy adapt` already warns "unnecessary header_up"); M17b (the operator condition removed from the wp-admin rule): it only locks OPERATORS out, which an outsider detector cannot see (section 04 covers the operator side); M19 (`auto_https disable_redirects` removed): equivalent while the explicit catch-all `http://` block exists.

Cache matrix (VERIFIED, `03-behavior`; "Set-Cookie responses never cacheable" held for every response that set a cookie in the whole run):

| Resource | Effective `Cache-Control` | Who decides |
|---|---|---|
| `/`, `/product/`, other static HTML | `public, max-age=0, must-revalidate` (ETag/Last-Modified) | edge |
| `/_next/static/*` (hashed) | `public, max-age=31536000, immutable` | edge |
| `/brand-kit/*`, `/fonts/*`, `/og/*`, `/robots.txt`, `/sitemap.xml` | `public, max-age=86400` | edge |
| `/demo/aicc-demo.mp4`, `.vtt`, poster | `public, max-age=0, must-revalidate`, 304 on `If-None-Match` | edge. **Choice:** the master is replaceable under the same URL and both sites hard-code the path, so these revalidate instead of using the one-day cache |
| `/pricing/` and other WordPress pages | `no-cache, must-revalidate, max-age=0, no-store, private` | WordPress |
| `/cart/`, `/checkout/`, `/my-account/`, login/logout, `/wp-json/*`, `?wc-ajax=`, `/he/?wc-ajax=`, `/wp-admin/admin-ajax.php` | `private, no-store, max-age=0` | edge (forced) |
| `/wp-content/*`, `/wp-includes/*` | whatever WordPress/the web server sends | origin |

The edge caches nothing (two identical `/pricing/` GETs both reached WordPress; no cache module in the binary). Security headers appear exactly once on 5xx/404/deny/redirect/proxied/static responses, HSTS is exactly `max-age=300`, no `Server`, `X-Powered-By` or `Via`; `Alt-Svc` is one value `h3=":443"; ma=3600` (Caddy's own default is 30 days and was duplicated per listener).

## 6. wp-admin, xmlrpc, wp-login, wp-cron, request bodies, sign-in throttle

Dependency inventory (VERIFIED by search of the CP worktree, the product plugin, the Backend and the site; `04-admin-xmlrpc.json` `data.inventory`):

* `xmlrpc.php`: **no use anywhere**. **Decision: denied for everyone**, any case, encoding or path-info form, 403, `no-store`, never proxied. Even operators get 403.
* `/wp-admin/admin-ajax.php` and `/wp-admin/admin-post.php`: the CP has **no front-end caller**; **both stay public anyway** (WordPress core, Action Scheduler's async runner, any future payment-gateway plugin), exact paths only.
* `/wp-login.php`: **customers do reach it** (the Connect page and plan-intent code call `wp_logout_url()` = `/wp-login.php?action=logout&redirect_to=..&_wpnonce=..`; WordPress then shows its confirm page, status 403 by its own design without a valid nonce, and lands on `?loggedout=true`). Customer sign-in, registration and password reset are `/my-account/`. **Decision (revised after the security review F2): operators only, except GET/HEAD on the exact path with exactly `?action=logout[&redirect_to=..][&_wpnonce=..]` or `?loggedout=true[&wp_lang=..]`.** The first version matched any method and any case: **reproduced on the twin (302 + a `wordpress_logged_in` cookie for `POST /wp-login.php?loggedout=true` and `?ACTION=logout` with a login body from an address outside the list)**, i.e. the restriction protected only the dashboard UI. Now: 19 live bypass attempts (POST/PUT with `loggedout`, `ACTION=logout`, `LOGGEDOUT`, extra parameters, duplicated `action`, parameter order, `X-HTTP-Method-Override`, HTTP/2, path-info, case, `//`), all 403 from the edge, **no session cookie in any response, no request in the CP's own request log**, while the same login POST from an operator source still signs in (control) and 5 customer-logout shapes plus 11 other GET shapes (`lostpassword`, `register`, `rp`, `postpass`, `confirmaction`, ...) behave as designed. The explicit denial of `action=login|register|rp|resetpass|postpass|confirmaction` the reviewer suggested is implied: anything that is not one of the two shapes is denied for non-operators.
* `/wp-cron.php`: `DISABLE_WP_CRON` is true; the system cron (`cp-fixture.sh cron`, exit 0) runs the entitlement outbox. **Operators only.**
* `/wp-admin/*` otherwise: **operators only** (round 4: `AICC_OPERATOR_CIDRS`; **superseded in round 5: the loopback operator listener, section 15; the CIDR list is an empty optional extra**). **Correction:** Caddy does NOT refuse an empty or unset value (it denies everyone silently); `scripts/ops/edge-preflight.sh` is what fails, see section 8 row 17.
* `/wp-activate.php`, `/wp-signup.php`: edge 404 (multisite entry points; WordPress answered 302 to `wp-login.php?action=register` = 403). `/50x.html`: edge 404 as a page (the error handler still serves it internally).

Public/operator table (VERIFIED, `04-admin-xmlrpc`, twin vs standing edge): `/xmlrpc.php` 403/403; `/wp-admin/` 403/302 then dashboard after login; `admin-ajax.php` (heartbeat) and `admin-post.php` 200/200; `/wp-login.php` and `?action=lostpassword` 403/200; `/wp-cron.php` 403/200; a valid admin session cookie from a non-operator source is still 403; spoofed `X-Forwarded-For`/`X-Real-IP`/`Forwarded` of an operator address opens nothing; (round 4 sentence; in round 5 the operator is the listener, `::1` is NOT an operator anywhere and the operator socket refuses `::1`). Customer flows from a non-operator source made 21 upstream requests; the only admin-surface URLs among them were the two `wp-login.php?action=logout` requests; none was refused by the edge.

**Remaining exposure, plainly:** WooCommerce signs in ANY role at `/my-account/`, administrators included, and cookie authentication then reaches the REST API. The edge allowlist protects the dashboard UI and `wp-login.php`, not the password. Mitigations in place: the sign-in throttle (below) and the generic error; owner decisions: strong unique administrator passwords, a second factor, and optionally restricting `/wp-json/wp/v2/(plugins|themes|users)` and `admin-ajax.php?action=rest-nonce` for non-operators (not implemented).

**Request body cap (E9).** Every PUBLIC WordPress route (login, cart, reset, Store API, license REST, admin-ajax, wc-ajax, lost-password) is capped at **2 MB**: a 12 MB POST is rejected with **413** at the edge on all six (and 3 MB too; a 12 MB chunked POST is cut off as well), 1 MB passes; operator-only `/wp-admin/` allows 64 MB (a 12 MB upload from an operator reaches WordPress, from a non-operator it is 403). Normal flows (login, cart, reset, Store API) pass under the cap in sections 04 and P2.

**Failed-sign-in throttle (E11; Control Plane plugin `AICC_LM_Login_Throttle`).** 10 failures per (client address, lower-case username) and 30 per client address per 15 minutes (fixed window from the first failure, a locked client cannot extend it), keyed on `AICC_LM_Client_IP::get()` (so per real client behind the edge); while a bucket is full even the CORRECT password is refused; one generic error for unknown username, unknown e-mail and wrong password (no enumeration at the form), the lock text is the same for existing and non-existing usernames; reset on success (the address ceiling just expires); never applied to `AICC_LM_OPERATOR_CIDRS` / the filter `aicc_lm_login_throttle_exempt_cidrs` and never to non-password requests; thresholds filterable. CP unit tests `tests/run_login_throttle_tests.php` (38 checks) and a real Chrome through the edge from `::1` (section 19): 9 generic answers, the 10th failure, then the correct password refused with the lock text and no session, a non-existing username locked identically, the operator address (127.0.0.1) signing in after 12 failures. **Limits, honestly:** per-address buckets (everyone behind one NAT shares the 30/15 min ceiling), no protection against a distributed attack (many addresses, few tries each), counters are WordPress transients (database), not atomic, and the throttle covers sign-in only (not registration, lost-password requests, add-to-cart, the Store API or search).

## 7. Logging (VERIFIED, `07-logging`)

Caddy JSON access log `logs/aicc-edge.log` and runtime/error log `logs/error.log` (other instances: `logs/<name>/`); rotation: access log **50 MiB x 10 files, 30 days (cap about 500 MiB; changed from 20 MiB x 5 after the Linux review measured about one hour of history under load, architecture review M-5)**, error log 20 MiB x 5, 30 days (rotation mechanism proven on a throwaway Caddy with a 1 MiB roll size and 2 kept files). Fields: `ts`, `request.remote_ip` (the real peer: `127.0.0.1` for IPv4, `::1` for IPv6), `request.method/host/uri`, `status`, `duration`, `size`, `request_id` (sent upstream as `X-Request-Id`, recorded by the CP's upstream log, returned to the client; a client-supplied id is overwritten) and `upstream` (`127.0.0.1:18982` for WordPress, empty for static/redirect/deny). The test harness now reads the logs of every instance including rolled and gzipped files (a roll used to turn every owner proof into "no log entry").
**Header ALLOW-LIST (architecture review H-5, replaces the earlier deny-list):** the Linux review found the WooCommerce Store API's `X-Wp-Nonce`, `Nonce`, `Cart-Token` (a JWT that restores a guest cart), `Cart-Hash`, `User-Id` in the logged headers, because only a handful of names were deleted. Now `request>headers` and `resp_headers` are deleted WHOLE and only `req_user_agent`, `req_referer`, `req_accept_language`, `req_content_type`, `req_content_length`, `req_range`, `req_if_none_match`, `resp_content_type`, `resp_content_length`, `resp_content_encoding`, `resp_cache_control`, `resp_location`, `resp_content_range` come back as flat top-level fields through `log_append` (Caddy's filter encoder has no keep-list; request id is the `request_id` field); `request.remote_ip/method/uri` and `status` did not move (fail2ban's regexes read them). The global (error) log has the same filter: REAL-CADDY FINDING, a 502 entry carried every request header and the full URI. Proof in `07-logging`: a REAL Store API GET and POST through the edge (their response carries a Cart-Token and a Nonce) sent with Nonce, Cart-Token, Cart-Hash, User-Id, X-Wp-Nonce, X-WC-Store-API-Nonce, Authorization, Cookie, X-Api-Key, X-CSRF-Token and a custom header; every field of every probe entry is in the documented set; the grep of the log lines written by that run for every value sent AND the real response values found 0 hits; a throwaway Caddy built from the template's own `(edge_log)` snippet and global log block (a Store API-like exchange plus a 502) leaves 0 values in the access and error logs, and five deliberately leaking variants of the configuration (deny-list restored, `Cart-Token` or `Nonce` re-added through `log_append`, error-log header delete removed, error-log URI redaction removed) are each caught by the same probe. The `07-logging` grep only judges lines written during its own run: rehearsal logs from before the change legitimately still hold the old lines.
Redaction: no `Cookie`, `Authorization`, `X-WP-Nonce`, `Set-Cookie` values; `key`, `login`, `user_login`, `pass`, `password`, `pwd`, `token`, `code`, `nonce`, `_wpnonce`, `reset`, `license_key` (case-insensitive) are replaced by `REDACTED` in the logged URI, and the same filter runs over `Referer` and `Location`. A real emailed reset link was requested through the edge; a grep of all edge logs for its key, the test passwords and 25 other secret strings found 0 hits. Client addresses are logged: the privacy text must say so.

## 8. Where the real Caddy (or a reviewer) disagreed with the model, and what changed

| # | Model / template assumption | Real finding | Change |
|---|---|---|---|
| 1 | Path matchers see the path as sent | `path` / `path_regexp` see a **cleaned** path; `reverse_proxy` forwards the RAW path | `bad_path` guard on `vars_regexp {http.request.uri.path}`; the model cleans paths |
| 2 | `handle_errors` pages carry the site headers | They do **not**: no HSTS/nosniff/X-Request-Id, `Server: Caddy` | `handle_errors` imports `security_headers` and `hsts` |
| 3 | plain `header` sets once | For proxied responses a plain `header` ADDS: **`Cache-Control` is duplicated** (M02). **Narrowed by the round-4b mutation run:** the security headers are NOT duplicated on the routes WordPress sends them on (M01 survives) | `header { defer ... }` kept in all snippets (needed for `Cache-Control`, a precaution for the rest) |
| 4 | `error {rp.status_code}` keeps the status | Placeholder not accepted: every upstream 5xx became 500 | one `handle_response` per status |
| 5 | Unknown Host on :80 gets nothing | Caddy 308s any Host to `https://<that Host>/...` | `auto_https disable_redirects` + catch-all `http://` block (421); now asserted exactly and mutation-tested (M03) |
| 6 | Unknown Host over TLS is refused | valid SNI + foreign `Host` -> an empty 200 (Caddy's no-match answer, `Server: Caddy`); `strict_sni_host` changed nothing | not fixable in a Caddyfile; harmless; asserted exactly |
| 7 | `TRACE` is not an issue | proxied `TRACE`/`OPTIONS`/`PATCH` reached PHP | `TRACE TRACK CONNECT` -> 405 |
| 8 | `encode` compresses WordPress HTML/JSON | with the default `minimum_length` a chunked PHP response was never compressed | `minimum_length 1` |
| 9 | upstream headers are not Caddy's business | `Via: 1.1 Caddy` | deferred `-Via` |
| 10 | `/_next/static/*` assets always exist | the model's example names are 404 in a real build | tests substitute real files |
| 11 | `Pricing`/`PRODUCT` 404 (case) | macOS APFS is case-insensitive | INFO here; `--ci-fs` in the replay tool; Linux UNVERIFIED |
| 12 | "at most one hop" | WordPress adds its own redirects | sweep counts them separately |
| 13 | Original template syntax | `caddy adapt`/`validate` accepted the ORIGINAL template | none |
| 14 | **wp-login "operators only" holds (round 4b, security review F2)** | **false: the exception matched any method and any case; a login POST from any address returned a session** | exact GET/HEAD shapes only; 38 wp-login matrix cases, 19 live bypass attempts, mutant M06 |
| 15 | **A pre-issued certificate can be loaded (architecture review F1)** | **false: `tls <cert> <key>` in the apex block that mixed `http://` and `https://` addresses fails `caddy validate`** ("server listening on [...] is HTTP, but attempts to configure TLS connection policies") | the apex is split: `http://copilt.org, http://www.copilt.org` (no TLS), `https://copilt.org` (imports `aicc_tls`), `www.copilt.org`; the body is the `apex_site` snippet; model structure check + 2 mutants + section 14 |
| 16 | Hard gate "replay every case on staging" is executable (architecture review F3) | no tool: the rehearsal harness hard-wired loopback, the macOS CA path and a fixture-only header | `scripts/staging-replay.mjs` (section 20) |
| 17 | "Empty `AICC_OPERATOR_CIDRS` is a startup error" (docs, three places) | **false: `caddy validate` says Valid and Caddy starts; every operator rule denies everybody.** Also an unset `AICC_STATIC_ROOT` (every page 404) and `AICC_WP_UPSTREAM` (every WordPress route 502) start fine | `scripts/ops/edge-preflight.sh` (systemd ExecStartPre and every reload, rehearsal runner), 51 negative tests; the docs say so |
| 18 | A release swap is harmless | atomic and lossless, but the previous release's hashed chunks 404 at once for open tabs | union of the previous 3 releases' `_next/static`, prune after 4 directories (section 16) |
| 19 | DNS plan: delete the `www` CNAME, add an A | an empty answer can be cached up to 3601 s (SOA minimum) in BOTH directions; the "about five minutes" claim was wrong; the rollback also removes the Control Plane | edit-in-place plan, corrected timing and consequences (runbook 2.5, 3.3, 5; `dns-and-mail.md` 2.1-2.6) |
| 20 | Unit file placement | the unit reused `/etc/caddy`, the `caddy` user, `/var/lib/caddy` and admin 2019, all used by the API's Caddy; two Caddies cannot both bind :80/:443 on one IP | self-contained `aicc-edge` unit; placement is an owner decision (runbook 1.2) |

Findings that are not Caddy disagreements: `X-Powered-By: PHP/8.2.29` (stripped) and `Host:` response headers (a `php -S` artifact) come from the upstream; the oversized-header limit has Go's 4 KiB slack.

## 9. Restart and failure (VERIFIED, `09-restart-failure`; this Mac, light probe of 4-6 workers)

| Scenario | Result |
|---|---|
| `caddy reload` (graceful), 4 in a row under a concurrent probe of static + WordPress + REST pages | mean **87 ms** (85-89); **0 failed of 197** requests, max latency 543 ms |
| hard stop (SIGTERM) + start | stop 101 ms, ports open about 104 ms, first 200 about **0.3 s** after the stop command; probe saw a **0.26 s** outage |
| `kill -9`, no supervisor | stays down (connection refused) |
| `kill -9` under launchd (`KeepAlive`, `ThrottleInterval 2`, plist `~/aicc-rehearsal/run/org.copilt.aicc-rehearsal-edge.plist`) | three in a row, each restarted with a new pid, first 200 after **2.16-2.19 s** (the throttle) |
| edge cold start, certificates from storage | 0.5 s to the first WordPress page; certificate serial unchanged across kill -9, launchd restart and cold start |
| CP upstream stop/start (edge up) | static routes 0 of 212 failed; CP routes the branded 502 immediately; recovery measured from the start command about 2.3 s (php boot + health wait), edge untouched |
| Listeners | caddy 80/443 (+UDP 443) wildcard, high ports/admin ports loopback, mysqld 18971, php 18982; nothing on 8981-8983, 9111-9114 or 8000; non-loopback peers are aborted |
| Disk after the run | about 0.55 GB (the MySQL/WordPress fixture dominates), logs a few MB |
| `api.copilt.org` before and after | `HEAD /` identical |

Production uses systemd instead of launchd: `docs/cutover/caddy-edge.service.template` (not executed, `systemd-analyze verify` not run). `php -S` with 8 forked workers is **not** PHP-FPM: do not read concurrency or latency numbers as production capacity.

## 10. TLS: proven and unproven

VERIFIED with `tls internal` / `local_certs` (`10-tls`): certificates for `www.copilt.org` and `copilt.org` (SAN exactly that name, Caddy Local Authority, leaf + intermediate sent, chain verifies, serverAuth, no OCSP/CRL URL so stapling is n/a); data dir 0700 and keys 0600, owned by the service user; restart persistence (same serials); renewal configured and **actually performed** on a throwaway instance (120 s lifetime, replaced after about 81 s without restart); TLS 1.2 and 1.3 only, TLS 1.2 limited to three ECDHE-ECDSA AEAD suites; HTTP/2; UDP 443 listening; unknown SNI and no SNI get a TLS alert; a window with **no certificate** (`no-certs` variant) gives a TLS alert on https and a single 301 on http, no loop.

**VERIFIED with a manual certificate (Option A form, `14-option-a-manual-certificate`, throwaway self-signed pair, no CA of any kind):** the structure `tls <cert> <key>` imported only by the https blocks passes `caddy validate` (rehearsal rendering) and `caddy adapt` (the PRODUCTION template with its global block and `email` line); the OLD structure is rejected by the real Caddy (control); both names serve the manual certificate (SAN covers both, not a Caddy-issued one) and nothing is issued automatically (no `certificates/` directory in that instance's storage); redirects (apex https/http, www http) are one hop, HSTS `max-age=300`, unknown Host on :80 still 421; **after the files are replaced on disk Caddy keeps serving the OLD certificate until `caddy reload` (it does not watch certificate files) and serves the new one right after**; the expiry monitor reports the 10-day certificate as WARN and the renewed one as OK; the preflight refuses a corrupt, expired, wrong-SAN, mismatched or group-readable pair (51 negative tests) so a bad renewal cannot be loaded by a reload.

**UNPROVEN here (cannot be, without public DNS):** public-CA issuance for the real names (HTTP-01 / TLS-ALPN-01 reachability, Let's Encrypt and ZeroSSL rate limits and failed-validation limits, CAA, retry/backoff), DNS-01 through the Namecheap API, certbot's manual flow itself, OCSP stapling with a public certificate, HTTP/3 from a real client, IPv6 reachability from outside, whether Namecheap's DNS API can be used safely next to MX/SPF, whether the CA sends expiry e-mails (do not rely on `AICC_ACME_EMAIL` for that).

### Certificate gate (owner command sequence; UNVERIFIED for the public-CA steps, written from documentation)

Never let the edge try a public CA before the names point at it: failed validations back off for a long time and count against Let's Encrypt's failed-validation limit (5 per hostname per hour).

* **Option A: pre-issue before the flip (zero TLS gap, a certificate tested before the flip).** `certbot certonly --manual --preferred-challenges dns -d www.copilt.org -d copilt.org --cert-name aicc-edge` on the edge host; **the owner adds two `_acme-challenge` TXT values at Namecheap Advanced DNS when asked** (extra TXT rows beside the SPF TXT, removed afterwards; **[OWNER]**), then copies `fullchain.pem`/`privkey.pem` to `/etc/aicc-edge/certs/` (0700 dir, key 0600, owner `aicc-edge`), sets `tls /etc/aicc-edge/certs/fullchain.pem /etc/aicc-edge/certs/privkey.pem` in `(aicc_tls)`, runs the preflight and `systemctl reload aicc-edge`, and checks `openssl x509 -in fullchain.pem -noout -dates -ext subjectAltName` and `curl --resolve www.copilt.org:443:<edge-ip> -vI https://www.copilt.org/` BEFORE the flip. **Renewal is manual, plainly: about every 60 to 90 days a human repeats the TXT step, installs the files and reloads; nothing renews it by itself, and a missed renewal expires silently at day 90** (hence `cert-expiry-check.sh` from outside the edge, alerting at 21 and 7 days). The automated alternative (Caddy or `acme.sh` doing DNS-01 through the DNS provider's API) needs a DNS-provider API token held by the owner and a Caddy build with the provider module (`xcaddy build --with github.com/caddy-dns/namecheap`); **that is an owner decision this plan does not make and never requests a token for**, and Namecheap's API replaces whole host-record sets, so a mistake could touch MX/SPF. After the flip is stable the owner may empty `(aicc_tls)` and reload to hand renewal to Caddy (HTTP-01, no human).
* **Option B: staged start, then an immediate reload (no DNS API, small exposure).** Run the edge with the real names but without any certificate request (the rehearsed waiting state is `auto_https disable_certs`; note `auto_https` takes ONE argument, so use a separate file rather than a second line next to `disable_redirects`). Change DNS (**[OWNER]**), then `systemctl reload aicc-edge` **as soon as the authoritative servers answer with the new record** (Let's Encrypt validates against the authoritative servers, not resolver caches; INFERRED). The apex name stays out of the config until the apex is switched (3.3c). Expected gap: seconds when validation works; if it fails, both names have no TLS until fixed or rolled back. With Option B the production rendering is first exercised by the flip itself.
* **Option C (not recommended):** start with ACME enabled before DNS moves: the first attempts fail and back off.
* **Lifecycle in both options:** monitoring (`scripts/ops/cert-expiry-check.sh`), backup of Caddy's storage (`scripts/ops/caddy-storage-backup.sh`: VERIFIED `19/19`: 0600 archives in a 0700 directory, optional AES-256 with a passphrase file, verify, restore refuses while Caddy runs, restored keys 0600 / dirs 0700, a Caddy started on restored storage presented the identical leaf serial so nothing is re-issued), the renewal and reload procedure, and honest wording about the ACME e-mail: `AICC_ACME_EMAIL` is the account contact, not an expiry-warning service. Record `openssl s_client` evidence for both names (valid, public chain, notAfter) before announcing; keep HSTS at 300 s.

## 11. Rollback rehearsal: PARTIAL

VERIFIED (`11-rollback`): the old target modelled as a second local origin serving the saved old home page (byte-identical, sha256 `5321004d...`), robots.txt, sitemap.xml and the GitHub 404 page, apex and http answering a 301 to `https://www.copilt.org{path?query}` in one hop; the swap is `caddy reload` to that config: **48 ms** to reload, **63 ms** from the trigger to the first old-site answer, **0.5 s** to swap forward again; a separate old-target listener starts cold in **0.43 s**; after the swap `/my-account/`, `/pricing/`, `/cart/`, `/demo/...`, `/xmlrpc.php` are 404 exactly as on the live old site today. UNPROVEN: public DNS propagation, resolver/browser caches, GitHub Pages re-serving after DNS returns, certificate re-issuance by GitHub.

**Real-world rollback timeline (facts re-read on 2026-10-20 16:41 UTC, `live-facts-2026-10-20.txt`; "about five minutes" is withdrawn):**
* Authoritative TTL is **1799-1800 s** (`dns1/dns2.registrar-servers.com`, apex A, `www` CNAME); **300 s only if it was lowered 24 hours or more earlier** (a day, not 30 minutes: the old TTL must expire in every cache first).
* **SOA minimum 3601 s:** an empty answer (a name with no record at the moment a resolver asks) is cached up to an hour, in BOTH directions. The plan therefore never deletes: add an `edge.copilt.org` A record first (24 h ahead, TTL 300), then **edit the `www` CNAME target in place** (`avivg7.github.io.` -> `edge.copilt.org.`; rollback = the same edit back), and edit the apex A values in place (a mixed GitHub/edge answer set is harmless, both 301 to `https://www.copilt.org/`, provided the edge's apex certificate is ready). Whether the Namecheap UI makes an edit atomically is UNVERIFIED (optional dry run on a throwaway name, runbook 2.5).
* Browsers keep 301s (the apex's and the new aliases'); the edge sent a shortened `Alt-Svc` in round 4 (superseded: HTTP/3 is off and no `Alt-Svc` is sent) and HSTS is `max-age=300`, the old site sends neither.
* **The GitHub Pages certificate** (Let's Encrypt): GitHub **renewed it on the morning of 2026-10-20** (`openssl s_client`: notBefore Oct 20 12:41:23 2026, **notAfter Jan 18 12:41:22 2027 GMT**, issuer YR1; it was 2026-11-19 until then). GitHub cannot renew while DNS points elsewhere, so a rollback after the notAfter in force on the day of the flip presents an expired certificate; flipping soon after a renewal keeps the longest window, and the next renewal is expected around 2026-12-19.
* **Rollback makes the Control Plane unreachable:** `/my-account/`, `/cart/`, `/checkout/`, `/pricing/` and `/wp-json/*` are Pages 404s; plugins in the field fail soft (activate/validate/connect POSTs get a 404/405), customers cannot sign in, an order in flight could not complete (no gateway is configured today). **Owner decision:** offer rollback only before the first real customer, or give plugin traffic its own stable hostname (e.g. `licenses.copilt.org`, configured as the plugin's endpoint) that is not part of this flip. Runbook section 5 has the full text.
* Estimated revert: the registrar edit takes minutes of human time; most clients are back within one TTL plus caches, with a long tail; plan for 30 minutes to 1 hour of mixed behaviour.

## 12. Differences from production (honest list)

`php -S` (forked workers) instead of PHP-FPM behind nginx/Apache; MySQL 8.4 from Local instead of the production database; mail captured, not sent (SPF/DKIM unproven); macOS APFS (case-insensitive) instead of Linux; wildcard listener with a loopback guard instead of a firewalled host; launchd instead of systemd; internal CA instead of a public CA; one machine (no real network latency, no IPv6 reachability from outside, no HTTP/3 client); no `Host:`/`X-Powered-By` from the upstream web server in production. The upstream port must be reachable only from the edge in production: the CP believes `X-Forwarded-For` from anyone connecting from an address in `AICC_LM_TRUSTED_PROXIES` (VERIFIED residual); `scripts/ops/upstream-exposure-check.sh` is the check (VERIFIED: a 0.0.0.0-bound throwaway server is reported EXPOSED, exit 1; the loopback-bound fixture is not reachable on the Mac's LAN address, exit 0).

## 13. Owner decisions that remain

1. ~~`AICC_OPERATOR_CIDRS` for production~~ **DECIDED 2026-10-21: SSH tunnel to the loopback operator listener** (no list). Keep `AICC_LM_OPERATOR_CIDRS` in the Control Plane's wp-config at the address operators appear from through the tunnel (loopback on the host), so the sign-in throttle never locks them out.
2. Edge placement for PRODUCTION: its own host, or its own reserved IP on a shared host, or adding the www/apex blocks to the API's Caddy (rejected earlier as a boundary change; this plan does not touch the API host). (The staging host `stage.copilt.org` is its own Linux host: decided 2026-10-21.)
3. ~~Certificate method~~ **DECIDED 2026-10-21: Option B, Caddy's automatic HTTPS (Let's Encrypt, HTTP-01/TLS-ALPN-01); no DNS API token will be created.** Section 10's Option A text is history.
4. ~~Rollback policy~~ **DECIDED 2026-10-21: after the commercial launch, rollback = the previous known-good release on the new infrastructure; GitHub Pages is only a disaster fallback BEFORE the first customer** (until the Pages certificate's notAfter, 2027-01-18 as of the earlier check).
5. Whether `/demo/*` stays revalidatable (chosen here) or moves to a versioned filename with a long cache.
6. Whether to localise the 5xx sentence (English only today) and whether JSON clients of `/wp-json/*` should get JSON instead of the HTML page when WordPress is down.
7. Rate limiting beyond sign-in (stock Caddy has none): fail2ban on the redacted JSON log, a CDN/WAF (then the client-address and operator-allowlist design must be redone), or a Caddy build with a rate-limit plugin.
8. Administrator hardening: strong unique passwords, a second factor, and whether to restrict `/wp-json/wp/v2/(plugins|themes|users)` and `admin-ajax.php?action=rest-nonce` for non-operators.
9. Production payment gateway: `/checkout/` stays reachable in the rehearsal fixture; the launch gates (runbook 1.17) still block a public launch.

## 14. Phase 2: real-browser flows through the edge

`npm run rehearsal:browser` (`scripts/rehearsal/browser-flows.mjs`, repeatable, about 6 minutes; `--only 1,3,5` runs sections) drives Chrome (playwright-core) through the standing edge: names mapped to 127.0.0.1 inside the browser only, rehearsal CA accepted through SPKI pins, fake `@example.test` customers created and deleted per run, no payment submitted. Results `~/Downloads/AICC-cutover-evidence/rehearsal/phase2/`. Last run: **564 checks, 0 failed**.

What it proved that curl could not (VERIFIED): every cookie is host-only on `www.copilt.org` (no `Domain=`), Secure, HttpOnly except the deliberate JS-readable ones, no `sbjs_*`; the apex redirect is one hop with no cookies; sessions and carts survive static -> CP -> static hops in EN and HE; logout clears every cookie at its original path; tampered login/logout/order-review/Store-API nonces are rejected; Back after logout re-requests the `no-store` page; the reset flow works end to end in EN/HE/ES/RU with the `wp-resetpass-*` cookie path under the language prefix and no reset key in the edge log; locale routing for four locales; Watch demo on desktop/mobile/reduced motion; no Offer/price structured data anywhere.

Defects found by the browser and fixed: (1) WooCommerce's cart cookies had no `Secure`/`SameSite` -> CP `harden_cart_cookie_options`; (2) the QA-only payment marker never appeared in the BLOCK checkout -> display-only `option_*` filter; (3) the edge forwarded browser-supplied `Client-IP`, `CF-Connecting-IP`, ... to WordPress -> the template strips them. Round 4b: (4) my own first version of the sign-in throttle switched off a WooCommerce filter that also governs lost-password by e-mail (22 reset checks failed in this suite) -> removed, pinned by a unit check.

Facts to carry forward: the rehearsal host IS the production host name, so the QA payment marker is (correctly) not shown on it and the launch gate is the only guard; WordPress auth cookies carry no explicit `SameSite` (WordPress core does not set one; Chrome applies Lax) - deferred; the origin web server's own access log must not record `key=` of the reset URL (the edge redacts it).

## 15. Round 5 (2026-10-21): the Linux architecture on this Mac, and fail-closed tooling

Why: the staging host will be Linux (Caddy automatic HTTPS, `php_fastcgi` over a unix socket to PHP-FPM, loopback-only operator listener reached through an SSH tunnel, HTTP/3 off, private metrics), and earlier malformed local requests once reached the real public `www.copilt.org`. Reference: `docs/cutover/stage-linux.md`. Labels as above. **Superseded by this section:** the CIDR allowlist (sections 6, 13.1), `Alt-Svc` (sections 5, 11), `X-Forwarded-*` trust (`AICC_LM_TRUSTED_PROXIES`, sections 6, 12), `~/aicc-rehearsal/bin/rcurl`, `staging:replay --edge-ip/--base/--connect-to`, Options A/B (section 10) and the rollback wording (section 11).

**What was built (SITE repo).** `scripts/lib/edge-render.mjs` (one template, three renders: `stage`, `production`, macOS `rehearsal`), `scripts/ops/render-edge.mjs`, `scripts/rehearsal/fpm.sh` (a separate php-fpm 8.2.29 on `~/aicc-rehearsal/scratch-fpm/aicc-cp.sock` in front of the fixture docroot; the fixture's database and files are untouched, only WordPress's own request-time writes happen, as with `php -S`), the `stage` rehearsal instance (stage topology, `stage-rehearsal.copilt.org`, 18200/18463, operator 18464), `scripts/lib/target-guard.mjs` + `scripts/test-target-guard.mjs` (`npm run test:target-guard`), `scripts/rehearsal/rcurl` (fail-closed replacement for the old wrapper: `ln -sf "$PWD/scripts/rehearsal/rcurl" ~/aicc-rehearsal/bin/rcurl`), a rewritten `scripts/ops/edge-preflight.sh` (`--mode stage|production|rehearsal`), `scripts/ops/edge-listener-audit.sh`, and the guard wired into `lib.mjs` (every `req`, `rawRequest`, `startProbe`), `staging-replay.mjs`, `browser-flows.mjs`, `run-tests.mjs`.

**Template changes.** `php_fastcgi` form next to the reverse_proxy form (selector `wp_proxy`), the loopback operator site block (`bind 127.0.0.1`, non-loopback guard, same host and certificate), the generated `routing operator` block, `php_direct` and `wp_hidden` rules, `servers { protocols h1 h2, strict_sni_host on }`, global `metrics`, `acme_ca` pinned to Let's Encrypt, `-Alt-Svc`, log field `listener`, identity route and `X-Robots-Tag` snippets (empty in the committed text, filled only by the stage render), stage topology (no apex block).

**Real-binary findings of this round.** (1) Without strip lines, `Forwarded`, `X-Real-IP`, `Client-IP` and `Via` from the client reached PHP unchanged through php_fastcgi (measured with a real php-fpm); with them none does. (2) `X-Forwarded-For/-Proto/-Host` are added by Caddy itself and are removed too (`header_up -X-Forwarded-For` ...): PHP reads `REMOTE_ADDR` and `HTTPS`. (3) An https request whose Host matches no site (SNI `www.copilt.org`, `Host: localhost`) got an EMPTY 200 with `Server: Caddy` (pre-existing since round 1, previously pinned by the Host tests as "expected"); `strict_sni_host on` makes it 421. (4) `auto_https` takes one argument: the rehearsal's `no-certs` variant must not carry the template's `disable_redirects`. (5) `-Alt-Svc` in the header block hides Caddy's own `Alt-Svc`, so removing `protocols h1 h2` is NOT visible in headers: the mutation harness checks the UDP socket instead. (6) WordPress itself sends `X-Robots-Tag` on some pages; the edge only adds it on the stage topology.

**Round 5 results (VERIFIED on this Mac, real Caddy 2.11.7, 2026-10-21).** The full real-Caddy suite was run twice, once per upstream mode, under a macOS `sandbox-exec` profile that only allows loopback traffic (`scripts/rehearsal/loopback-only.sb`; the restart section needs launchd and ran unsandboxed, behind the guard). Counts are PASS / FAIL per section; evidence copies are in `~/Downloads/AICC-cutover-evidence/rehearsal/round5-proxy` and `round5-fastcgi`.

| # | Section | proxy mode (php -S, reverse_proxy) | fastcgi mode (php-fpm, unix socket) |
|---|---|---|---|
| 01 | routing-matrix | 268 / 0 | 268 / 0 |
| 02 | redirect-sweep | 264 / 0 | 264 / 0 |
| 03 | behavior | 236 / 0 | 236 / 0 |
| 04 | admin-xmlrpc | 116 / 0 | 116 / 0 |
| 05 | 5xx-experience | 41 / 0 | 41 / 0 |
| 06 | try-to-break | 46 / 0 | 46 / 0 |
| 07 | logging | 16 / 0 | 16 / 0 |
| 08 | demo | 15 / 0 | 15 / 0 |
| 09 | restart-failure | 12 / 0 | 12 / 0 |
| 10 | tls | 17 / 0 | 17 / 0 |
| 11 | rollback | 12 / 0 | 12 / 0 |
| 12 | safety | 17 / 0 | 17 / 0 |
| 13 | apex-wp-remote-post | 2 / 0 | 2 / 0 |
| 14 | option-a-manual-certificate | 19 / 0 | 19 / 0 |
| 15 | preflight | 104 / 0 | 104 / 0 |
| 16 | release-swap | 9 / 0 | 9 / 0 |
| 17 | ops-scripts | 19 / 0 | 19 / 0 |
| 18 | mutation-real-caddy | 27 / 0 | 31 / 0 |
| 19 | login-throttle-browser | 9 / 0 | 9 / 0 |
| 20 | staging-replay-tool | 14 / 0 | 14 / 0 |
| 21 | stage-fastcgi | 42 / 0 | 42 / 0 |
| 22 | fixture-egress | 7 / 0 | 7 / 0 |
| | **total** | **1312 / 0** | **1316 / 0** |

Browser flows (`npm run rehearsal:browser`, sandboxed, `caffeinate`d): 564 checks, 0 failed in each mode (cookies 93, csrf 19, reset 63, locale 114, demo 182, checkout 31, SEO 10, performance 9, client ip 10, public surface 33). The guard counted 92 curl/socket requests and about 26 000 browser requests per run, 0 blocked, 0 violations.

Other gates: `npm run test:redirects` 270 cases, 1805 checks, 264-request sweep, 45/45 template mutants killed; `npm run test:target-guard` 244 checks, 0 failed; lint 0 warnings, `tsc` clean, `copy:check`, `fbt:audit`, `seo:check`, `i18n:strict` PASS.

Differences between the two modes that are by design, not failures: under `php_fastcgi` a 12 MB chunked POST is refused with 411 by Caddy (reverse_proxy: 413 or a closed connection); with PHP-FPM stopped, a static theme file under the docroot is still served by Caddy (200), PHP routes give the branded 502; the HTTP-garbage upstream cases exist only for `reverse_proxy` (the `php_fastcgi` equivalents are section 21: php-fpm down gives a branded 502 and recovers in about 0.5 s). The mutation section has 27 mutants in proxy mode and 31 in fastcgi mode.

Harness notes: the Mac idle-sleeps during long runs (Chrome then reports `ERR_NETWORK_CHANGED` / `ERR_NETWORK_IO_SUSPENDED`): run the suites under `caffeinate -ims`. One back-button flow timed out once in 5 full runs and passed 3 of 3 re-runs of section 2 (flake, UNVERIFIED cause).

**No request reached a real public name (VERIFIED for this round's window, 02:32-03:35 IDT).** The egress audit (JSONL, one record per request) for the window shows 3361 sends, all to 127.0.0.1, ::1 or this Mac's own LAN address (the deliberate "operator listener refuses a LAN connect" probe), 0 violations, 0 public-DNS sends, 0 production-direct sends; the kernel sandbox log shows 0 `deny network-outbound` events in the same window. Before this round the fixture's own WordPress could contact real hosts (Action Scheduler loopback to `https://www.copilt.org/wp-admin/admin-ajax.php`, wordpress.org and woocommerce.com update checks): whether it did in earlier rounds is UNVERIFIED. It cannot any more (`egress-guard.php` plus the sandbox).
