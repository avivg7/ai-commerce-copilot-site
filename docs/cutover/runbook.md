# www.copilt.org cutover runbook and rollback

Status: **PREPARATION ONLY. Nothing here has been executed.** Every step marked **[OWNER]** needs the owner's explicit approval *at that moment*; approval of this document is not approval of any step, and each irreversible step has its own gate.
Written 2026-10-19 from fresh inspection (DNS, GitHub, headers), the repository audit in `docs/cutover/redirect-matrix.md` and `~/Downloads/AICC-cutover-evidence/`, and revised after the independent review in `~/Downloads/AICC-cutover-evidence/reviewer-A.md` (findings A1-A13 are referenced below).
**Precedence:** where the Control Plane design docs (`docs/unified-experience/domain-migration.md`, `site-architecture.md`) differ from this runbook, **this runbook wins.**

Owner decisions this runbook assumes (fixed): canonical public host `https://www.copilt.org/`; `https://copilt.org/*` 301s to it; `api.copilt.org` stays API-only; the approved Watch demo master is served at `/demo/aicc-demo.mp4`; no payment provider is configured by this plan.

## 0. What is true today (verified 2026-10-19)

| Fact | Evidence |
|---|---|
| `www.copilt.org` is a one-page old site on **GitHub Pages**: repo `avivg7/ai-commerce-copilot-site`, branch `main` (HEAD `815350b`), workflow deploy, custom domain `www.copilt.org`, HTTPS enforced | `old-site-inventory.md` |
| `copilt.org` (apex) has the four GitHub A records and already 301s to `https://www.copilt.org/` (GitHub issues it) | `curl`, `dig` |
| `www` is `CNAME avivg7.github.io`. The registrar's authoritative TTL for apex A, MX, TXT and the `www` CNAME is **1800 s** (a resolver showed 1799 s; the "817 s" in earlier notes was a cached remainder) | `dig`, reviewer A |
| The apex also carries **Namecheap email-forwarding MX and an SPF TXT** (`v=spf1 include:spf.efwd.registrar-servers.com ~all`); they must survive every DNS edit | `old-site-inventory.md` |
| `api.copilt.org` is `A 139.59.157.231` (Caddy, DigitalOcean). Untouched by this plan | `dig`, `curl` |
| **The GitHub Pages certificate** for `www.copilt.org` and `copilt.org` (Let's Encrypt, issued 2026-08-21) **expires 2026-11-19** and, at the time of writing, has *not yet been renewed* (`openssl s_client` notAfter Nov 19). GitHub renews about 30 days before expiry, so renewal is due around now; it can only succeed while DNS still points at GitHub | `openssl s_client`, `gh api .../pages` |
| **No production host exists for the WordPress Control Plane or for a static-site edge.** QA is `127.0.0.1:8982`. `/my-account/`, `/cart/`, `/checkout/`, `/pricing/` are 404 on GitHub Pages | repo audit |
| The Pages deploy job was **removed** from `.github/workflows/nextjs.yml` on the feature branch (build-and-test only); `main` is not merged; the old `main` HEAD is tagged locally `old-site-rollback-815350b` (local tag, never pushed) | this change |

Consequence: **the cutover cannot be executed until a production Control Plane and an edge exist.** Pointing www at the new static site alone would turn every Get started, Sign in, plan and Pricing link into a 404. The order below therefore starts with building and rehearsing the edge, not with DNS.

## 1. Preconditions (all must be true before step 3)

Technical
1. A production WordPress/WooCommerce Control Plane host exists, reachable only through the edge for public traffic, with `home` and `siteurl` set to `https://www.copilt.org`, PHP seeing `https` behind the proxy (`X-Forwarded-Proto`) and the **real client address** (below). **[OWNER]** (separate ops stage; not part of this task).
   wp-config.php on that host (all three are required; the first is the template's WordPress prerequisite, the second is finding A2, the third finding A9):
   ```php
   if ( ( $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '' ) === 'https' ) { $_SERVER['HTTPS'] = 'on'; }
   define( 'AICC_LM_TRUSTED_PROXIES', array( '<the edge host private IP or CIDR>' ) ); // only X-Forwarded-For from these peers is believed; empty = REMOTE_ADDR
   define( 'DISABLE_WP_CRON', true );                                                  // see 1.3
   ```
   The edge overwrites `X-Forwarded-For` (`header_up X-Forwarded-For {remote_host}` in the template; no client-supplied value is passed through and `trusted_proxies` is NOT configured on the public edge). Without `AICC_LM_TRUSTED_PROXIES`, every per-IP rate limit in the license manager (REST 30 requests / 60 s, Connect AICC store options / poll / acknowledge) is one global limit shared by all merchants.
2. A host for the edge (recommended: **Caddy**, separate process or host from the API's Caddy) with the static `out/` build and the WordPress upstream behind it. Reachability: **ports 80 and 443 over TCP, and UDP 443 (HTTP/3), on IPv4 and IPv6** from the public internet to the edge (port 80 is needed by HTTP-01 and by the http-to-https redirect); the upstream reachable from the edge on its private address only.
3. **WP-Cron (finding A9).** The entitlement outbox delivery (Control Plane to Backend, every five minutes) and the daily expiry sweep run on WP-Cron, whose default trigger is a loopback HTTP request to `https://www.copilt.org/wp-cron.php`; it silently fails while DNS still points at GitHub (all of the rehearsal) or whenever the WordPress host cannot reach the public edge. Set `DISABLE_WP_CRON` true (above) and run a system cron on the WordPress host: `* * * * * cd <wp path> && wp cron event run --due-now >/dev/null 2>&1` (or the hosting provider's equivalent). Smoke test in section 4.
4. `docs/cutover/Caddyfile.edge.template` completed with the real upstream/addresses, then **`caddy validate --config Caddyfile` on the real binary — HARD GATE.** The offline model in `npm run test:redirects` (including its mutant self-test) proves the generated text and a model of the file; it cannot see a Caddy syntax or semantics error (`docs/cutover/redirect-matrix.md` section 8 says exactly what is and is not proven). Do not proceed on the model alone.
5. Staging rehearsal through the edge on a staging hostname — **HARD GATE:** `curl --resolve www.copilt.org:443:<edge-ip>` replay of **every** case in `scripts/lib/redirect-matrix.mjs` (165 today: redirects with status and exact `Location`, POST/PUT/DELETE cases that must answer 308, the prefixed `wc-ajax`/`wc-api`/`rest_route` roots, `Cache-Control` expectations, HSTS header), plus the Control Plane's `tests/browser/reset-password.mjs` and `tests/browser/locale-prefix-flows.mjs` through the edge. Procedure details that earlier drafts left out (finding A13.4):
   - Rehearse with `tls internal` (Caddy's local CA) or the ACME **staging** CA, never the production CA; import the local root into the test browser or use `curl --cacert`. Secure cookies and `SameSite` need a trusted certificate on `www.copilt.org`, so the browser must trust it.
   - Point the browser at the edge with `--host-resolver-rules="MAP www.copilt.org <edge-ip>, MAP copilt.org <edge-ip>"` (Chromium) or `curl --resolve`.
   - The staging WordPress must have `home` = `siteurl` = `https://www.copilt.org` (WordPress cookie names embed a hash of `siteurl`; a different value hides cookie-name bugs). If it is a copy of QA, run `wp search-replace 'http://127.0.0.1:8982' 'https://www.copilt.org' --all-tables` (dry run first) and check no `127.0.0.1` remains in options or content.
   - `tests/browser/reset-password.mjs` needs `WP_CMD` (wp-cli) against a disposable fixture and the fixture flag (`:7-16`); it defaults to `http://127.0.0.1:8975` and cannot be aimed at an ordinary staging WordPress. Run it against a throwaway fixture placed behind the same edge configuration, and test the reset flow by hand on staging with a real mailbox.
   - `wp_remote_post` apex test (finding A8): from a plugin/WordPress fixture, POST (`{"license_key":"smoke-test"}`, a harmless validation request) to `https://copilt.org/wp-json/aicc-license/v1/validate` with the apex resolved to the staging edge; it must follow exactly one 308 and return WordPress's JSON.
6. **Static release procedure in place** (section 7) and the build from the approved commit: `AICC_BASE_PATH="" SITE_URL=https://www.copilt.org npm run build`, then `npm run seo:check`, `npm run test:redirects`, `npm run test:demo`, `npm run launch:check` (demo hash green; remaining blockers listed in section 8 resolved or consciously accepted by the owner).
7. Control Plane commit green: `bash tests/run-all.sh`.
8. Search Console / Bing property for `https://www.copilt.org/` prepared (DNS TXT or HTML file — an HTML file needs a rebuild of the static site, `public/.well-known/` or root — so decide before cutover), so the sitemap can be submitted after cutover.
9. **Rollback rehearsal on a throwaway hostname — [OWNER]** (section 5): a throwaway GitHub Pages repo with a custom domain on a spare domain/subdomain, DNS moved to a test edge and back, observing whether Pages keeps `https_enforced`, whether it re-issues the certificate promptly after DNS returns, and how long that takes. Until that is done the statement "rollback is possible after the certificate expires" is **UNVERIFIED**.
10. **Certificate plan decided** (finding A4), one of:
    - (i) **Pre-issue before the flip**: obtain certificates for `www.copilt.org` and `copilt.org` with DNS-01 (adding `_acme-challenge` TXT records does not affect traffic; needs a Caddy build with the DNS provider's module, or `acme.sh`/`certbot` and `tls /path/fullchain.pem /path/key.pem` in the template, accepting manual renewal), verified with `openssl x509 -noout -dates` before step 3.3a; or
    - (ii) **Controlled start**: do not start Caddy with the real names until step 3.3a, then `systemctl reload caddy` immediately after DNS propagates to force an immediate attempt, accepting a documented 1-2 minute TLS gap at a quiet hour (HTTP-01 attempts that fail while DNS still points at GitHub back off for tens of minutes and count against Let's Encrypt's failed-validation limit; INFERRED from certmagic behaviour, verify with the real binary).
    A certificate must never be first tested by the production flip.
11. **Mail sender decided — [OWNER]** before any account smoke test that sends mail is called green. The apex SPF authorises only Namecheap's forwarder; password-reset, order and license emails from WordPress need a sending provider and DKIM, which requires editing the single SPF TXT record. **This plan does not edit SPF, MX or any TXT record.** Treat it as a separate, owner-approved DNS change.

Business / legal (see section 8 for the full list)
12. Support email, legal name, address, governing law, payment processor and hosting region supplied by the owner; counsel approval of the legal text. Without them the site publishes "will be published before launch" lines and draft notices; `launch:check --strict` fails. **[OWNER]**
13. Decision recorded on the five static legal/pricing mirrors (retire at cutover is the default: WordPress serves those URLs by routing, there is no HTTP redirect).

Hygiene
14. Exact commits recorded here at execution time (fill in): SITE `____`, CP `____`, PLUGIN `____`, BACKEND `____` (unchanged by this plan). Each repo `git status` clean; the `docs/cutover/` files and scripts are **committed** on the feature branch (they are untracked until then and can be lost with a `git clean`).
15. **Do not merge the feature branch into `main` as part of the cutover.** `main` is the rollback artifact. The Pages deploy job has been removed from `.github/workflows/nextjs.yml` (build-and-test only), so a merge no longer deploys; keep it that way. Deploy the static `out/` to the edge with the release procedure in section 7. **[OWNER]** to re-add any Pages deploy.
16. **Snapshot of the old site** (section 2) taken and verified.

## 2. Backups and baseline (the day before; read-only)

1. Record current DNS exactly (`dig +noall +answer` for A, AAAA, CNAME, MX, TXT, NS on `copilt.org` and `www.copilt.org`) and screenshot Namecheap Advanced DNS. Save both under `~/Downloads/AICC-cutover-evidence/dns-before-YYYYMMDD/`.
2. Save the old public site completely, not only the home HTML:
   - `wget --mirror --page-requisites --convert-links --adjust-extension --no-parent -e robots=off -P ~/Downloads/AICC-cutover-evidence/old-site-mirror/ https://www.copilt.org/` (the images and the ~3.4 MB video are not in `old-www-home.html`), plus `curl -sS -D headers https://www.copilt.org/`, `robots.txt`, `sitemap.xml`.
   - The Pages settings page (custom domain, enforce HTTPS) and `gh api repos/avivg7/ai-commerce-copilot-site/pages` output.
   - The local tag `old-site-rollback-815350b` in the SITE repo (`git rev-parse old-site-rollback-815350b` = `815350b12af269e263175c484a3af17e31d91d50`; **local only, do not push it**). Optionally also keep a private bare mirror of the old repo.
3. **Record the Pages certificate**: `echo | openssl s_client -connect www.copilt.org:443 -servername www.copilt.org 2>/dev/null | openssl x509 -noout -dates` and `gh api repos/avivg7/ai-commerce-copilot-site/pages --jq .https_certificate`. At the time of writing `expires_at` is **2026-11-19**. Write the value found here: `________`. **Step 3.3a may not start until GitHub has renewed it (notAfter later than 2026-11-19), or the owner has accepted that the rollback window ends at the recorded notAfter** (section 5).
4. Record the response of `https://www.copilt.org/`, `https://copilt.org/` (301 target) and `https://api.copilt.org/` (404 JSON) for comparison after the cutover.
5. Lower the TTL of the records you will change (`www` CNAME and the apex A records) to 300 s **at least 30 minutes, ideally 24 hours, before** the cutover (the existing 1800 s TTL must expire first). **[OWNER]**
6. Back up the Control Plane database and uploads taken from its production host before any change there (ops stage).
7. Confirm the Namecheap email-forwarding MX and SPF TXT rows are saved in the baseline: they are not edited by this plan.
8. Confirm the Backend (api) is healthy and note its version; the cutover does not touch it.

## 3. Cutover (a quiet hour; owner present). Each irreversible step is gated.

3.1 Re-run the preconditions' automated checks on the approved commits (1.6, 1.7), re-record the Pages certificate (2.3). Abort on any failure.

3.2 **[OWNER]** Deploy the static `out/` (section 7) and the Caddyfile to the edge **without public DNS**. The edge becomes reachable on its IP only; no user traffic. Verify directly: `curl --resolve www.copilt.org:443:<edge-ip> https://www.copilt.org/` etc., and the smoke checklist in section 4 (with the certificate chosen in 1.10: a staging/internal certificate or `-k` until the real names point at the edge). Confirm ports 80/443 (and 443/udp) answer over IPv4 and IPv6 from outside.

3.3a **[OWNER]** Change DNS at Namecheap for `www` only, keeping MX/SPF/TXT untouched: replace `CNAME avivg7.github.io` with `A/AAAA` (or CNAME) to the edge. Do NOT remove the GitHub Pages custom domain (see 3.8). With 1.10 (i) the certificates are already loaded; with (ii) reload Caddy now.

3.3b **Abort/verify point (before the apex).** Wait for the 300 s TTL. Verify: `https://www.copilt.org/` presents a **valid, publicly trusted certificate**, returns the new home page, the smoke subset of section 4 passes (home, product, pricing, `/my-account/`, `/he/my-account/`, prefixed `wc-ajax` routing, `/demo/aicc-demo.mp4`, robots, sitemap), `http://www.copilt.org/` redirects to https. **If any of it fails, revert the `www` record to `CNAME avivg7.github.io` only** (the apex still points at GitHub; nothing else has changed) and stop. Otherwise continue.

3.3c **[OWNER]** Change the apex `copilt.org`: replace the four GitHub `A` records with the edge's `A/AAAA`. Keep MX/SPF/TXT as they are.

3.4 Watch the apex certificate and redirect: `curl -vI https://copilt.org/` must present a valid certificate and 301 to `https://www.copilt.org/`. Until both names present valid certificates, do not announce. If a certificate is missing minutes after propagation, reload Caddy once (do not wait for the ACME backoff) and, if still failing, apply the rollback conditions of section 5.

3.5 Verify redirects: `http://copilt.org/x?y=1` -> `https://www.copilt.org/x?y=1` in **one hop** (301 for GET/HEAD, 308 otherwise); `http://www.copilt.org/` -> https; no loops (`curl -sIL`).

3.6 Verify the critical routes with the checklist in section 4 against live DNS.

3.7 **[OWNER]** Submit `https://www.copilt.org/sitemap.xml` in Search Console / Bing, and set HSTS **only at `max-age=300`**, no `includeSubDomains`, no `preload` (this is what the template sends). **HSTS stays at 300 s for the whole rollback window — until the Pages site is retired (section 6) —** because an expired Pages certificate behind a long HSTS is an unbypassable browser error.

3.8 Leave the GitHub Pages site and the Pages custom-domain setting alone. Once DNS no longer points at GitHub, the Pages setting is inert; removing it is part of the later retirement (section 6), never part of the cutover.

3.9 **[OWNER]** Announce only after 3.4 to 3.6 pass.

## 4. Smoke checklist (run after 3.2 against the edge, again after 3.3b for the subset and after 3.6 against live DNS)

For each of `en`, `/he/` (RTL), `/es/`, `/ru/`:
- Home, Product, Questions, Data & Trust: 200, one canonical on `www`, hreflang alternates, correct `lang`/`dir`, header and footer, language menu.
- Pricing, Privacy, Terms, Refund policy, Accessibility, Data processing addendum: 200 from WordPress, same header/footer, prices and plan counts as expected, no placeholder text beyond the documented owner-input lines. WooCommerce "Coming soon" / maintenance mode is **off** and an anonymous `curl https://www.copilt.org/pricing/` shows the prices.
- Watch demo (home and product): dialog opens, poster, no autoplay, controls, captions, plays; `/demo/aicc-demo.mp4` has `Accept-Ranges: bytes` and sha256 `6ec46e72fd2531ea…` (full hash in `docs/approved-demo.sha256`); the Control Plane's Watch demo (if kept) plays the same file.
- Get started and Sign in from the static pages reach `/my-account/` (no 404), and `/he/`, `/es/`, `/ru/` reach `/he/my-account/`, `/es/my-account/`, `/ru/my-account/` (language prefix kept, no redirect); a plan button carries `?plan=` (also with the prefix); the Control Plane header's Product goes to `/product/` and its Get started to `/my-account/`; `/sitemap.xml` lists `/data-processing-addendum/` x4; register, log in, reset password (cookie path under the language prefix), Plans & Stores, connect flow; the return-to-site links.
- Cart and checkout pages load; checkout stays in the **test/dev gateway** only (no live payment provider is configured by this plan).
- **WooCommerce AJAX in every language (A1):** on `/cart/`, `/he/cart/`, `/es/cart/`, `/ru/cart/` the page source has `"wc_ajax_url":"/?wc-ajax=%%endpoint%%"` (never `/he/?wc-ajax=`); `curl -i 'https://www.copilt.org/?wc-ajax=get_refreshed_fragments'` and the same with `/he/`, `/es/`, `/ru/` in front come from WordPress (JSON, `Cache-Control: private, no-store`), not the static home page.
- Cookies and redirects (A13.6a,b): `Set-Cookie` for `wordpress_logged_in_*`, `wp_woocommerce_session_*`, `aicc_plan` has `Secure`; `curl -I https://www.copilt.org/pricing/` and `/wp-login.php` produce no redirect loop and the HTML contains no `http://www.copilt.org` URL (mixed content).
- **Real client IP (A2), two-source smoke test:** from two different source addresses (e.g. your laptop and a phone on mobile data) POST `{"license_key":"smoke-test"}` 31 times in a minute to `https://www.copilt.org/wp-json/aicc-license/v1/validate` from source A: the 31st returns 429; a single request from source B in the same minute still returns 200. On the server `wp transient get aicc_lm_rl_$(php -r 'echo md5("<A ip>");')` exists and the key for the edge's own address does not.
- **Asset caching (A6):** `curl -I https://www.copilt.org/wp-content/themes/aicc-admin/assets/css/aicc-public.css` has WordPress's own `Cache-Control`/`ETag`/`Last-Modified` and **not** `private, no-store`; `/wp-login.php`, `/wp-json/…`, `/cart/` have `private, no-store`.
- **WP-Cron / outbox (A9):** with the system cron running, an entitlement outbox row created by a test purchase is delivered to the Backend within 10 minutes (`wp cron event list` shows `aicc_lm_entitlement_delivery` due within 5 minutes and re-scheduled; the outbox row's status becomes delivered; the Backend log shows it).
- **Transport (A13.6g):** IPv4 and IPv6 both answer on 443 and 80 (`curl -4`, `curl -6`); an outside port check confirms 80/443.
- **Mail (A13.6f, only after 1.11):** a password-reset email is delivered to an external mailbox with SPF and DKIM `pass`.
- **Database (A13.6i):** no `127.0.0.1`, `localhost` or `.local` URL in `wp option get home siteurl` or in `wp db search` of the options and posts tables.
- `/robots.txt` and `/sitemap.xml` are the site's, `www` host only; `/cart/`, `/checkout/`, `/my-account/` disallowed/noindex.
- `https://api.copilt.org/` unchanged (same 404 JSON, same headers), and a real plugin round trip to the Backend still works.
- Unknown path: branded 404 with status 404. With the WordPress upstream stopped, a WordPress path returns the branded 5xx page (not an empty body) and the status stays 502/503. No `localhost`, `127.0.0.1`, `/ai-commerce-copilot-site` or apex canonical anywhere (`npm run seo:check` against a crawl of the live host).
- Access log (`/var/log/caddy/aicc-edge.log`) is written and contains no `Cookie`, `Authorization` or `Set-Cookie` values and no token in query strings.
- WooCommerce invariant: with the edge stopped or the Control Plane unreachable, a merchant store running the plugin keeps selling (plugin fail-soft is independent of the public website).

## 5. Rollback

Rollback conditions (any one, after 15 minutes of attempted repair):
- `www` root unavailable or a redirect loop; TLS invalid on `www` for more than 10 minutes;
- `/my-account/`, login, registration or password reset broken; checkout/cart unavailable (once checkout is meant to be open);
- locale routing broken for a language, or widespread asset 404s (`/_next/`, fonts, brand kit);
- the API host or the plugin's calls to it disturbed.
Not a rollback by itself: Watch demo failing alone (page still works), a single non-critical page 404, caption styling.

**What rollback is, and its limit (corrected: finding A3).** The old site was never touched, so rollback is a DNS change back to GitHub Pages. But once DNS leaves GitHub, **GitHub can no longer renew its Let's Encrypt certificate** (it validates over HTTP from its own servers). The old site is therefore a usable rollback **only until the certificate in force at the moment of the flip expires** (2026-11-19 if not renewed first; a later date if GitHub renewed it before step 3.3a: that is why 2.3 and 3.1 record it). **After that date, a rollback to Pages would present an expired certificate** (and with HSTS raised, an unbypassable one). Whether GitHub re-provisions a certificate promptly after DNS returns, and whether it keeps `https_enforced`, is **UNVERIFIED** until the rehearsal in 1.9 has been run on a throwaway hostname. The earlier statement that the certificate "renews automatically" was wrong once DNS leaves GitHub and has been removed.

Steps:
1. Namecheap: restore the saved records. `www` -> `CNAME avivg7.github.io`; apex -> the four A records `185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153`. Leave MX/SPF/TXT as they are. (Partial rollback during the cutover: only `www`, see 3.3b.)
2. With TTL 300 s the old site reappears within about five minutes, *if the certificate is still valid* (above).
3. Verify: `https://www.copilt.org/` returns the old one-page site (compare with the saved baseline and the `wget` mirror), `https://copilt.org/` 301s to it, `https://api.copilt.org/` unchanged.
4. Keep the edge running (or stop it) for diagnosis; record what failed; do not retry without a fix and a new approval.

If the rollback window has passed: the fallback is to serve the saved mirror (`old-site-mirror/`) from the edge itself with a valid certificate, not to return to Pages. Rollback of the static site alone (a bad release, nothing else wrong) does not need DNS at all: repoint the `current` symlink (section 7).

## 6. After the cutover

- Monitor for at least two weeks: availability of `www`, certificate dates, Search Console coverage and crawl errors for `www`, redirect behavior, account/checkout errors, the edge access log for 404s on old patterns, plugin-to-Control-Plane activations, the cron/outbox.
- **HSTS stays at `max-age=300` until the Pages site is retired** (the rollback window). Raise it (86400, then 31536000) only after retirement and a stable week; still no `includeSubDomains` unless every subdomain is https-only.
- The old Pages site is **not deleted at cutover.** Retire only after stability is verified and the owner explicitly approves **[OWNER]**: stop the Pages deploy workflow (already removed on the feature branch), then remove the Pages custom domain, only after DNS no longer points at GitHub (removing it while DNS still points at GitHub leaves a dangling name open to takeover; no domain-verification TXT exists today, so consider adding GitHub Pages domain verification first). The rollback window is decided by the owner; its hard upper bound is the Pages certificate's notAfter (section 5). Keep the old repo/branch/tag for as long as the window lasts.
- Do not touch Render or Neon as part of this cutover: the Backend commercial cutover (DigitalOcean) and database migration are separate gates.

## 7. Static release procedure and rollback (finding A12)

The static site is served from a versioned directory behind an atomic symlink; nothing else deploys it (the Pages deploy job is gone).

Layout on the edge host: `/srv/aicc/releases/<UTC timestamp>-<short sha>/` (one directory per release, containing the contents of `out/` **plus `50x.html`** copied from `docs/cutover/50x.html`), `/srv/aicc/current` -> the active release, and Caddy's `AICC_STATIC_ROOT=/srv/aicc/current`. Keep the last five releases.

Build from an approved commit, on a clean checkout, never from a dirty working tree:
```
git fetch && git checkout <approved sha> && git status --porcelain   # must be empty
npm ci
AICC_BASE_PATH="" SITE_URL=https://www.copilt.org \
  NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=<true only after counsel approval, else unset> \
  NEXT_PUBLIC_AICC_LEGAL_NAME=… NEXT_PUBLIC_AICC_ADDRESS=… NEXT_PUBLIC_AICC_SUPPORT_EMAIL=… \
  NEXT_PUBLIC_AICC_GOVERNING_LAW=… NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR=… NEXT_PUBLIC_AICC_HOSTING_REGION=… \
  npm run build                                  # NEXT_PUBLIC_AICC_ACCOUNT_URL stays unset: the default is https://www.copilt.org/my-account/
npm run seo:check && npm run test:redirects && npm run launch:check
```
(Node 20; the owner-supplied `NEXT_PUBLIC_*` values are the ones from `docs/AUTHORITY.md`; record which were set in the release notes.)

Deploy **[OWNER for the first one and for any release after the cutover]**:
1. `R=/srv/aicc/releases/$(date -u +%Y%m%dT%H%M%SZ)-<sha>; mkdir -p $R && rsync -a --delete out/ $R/ && cp docs/cutover/50x.html $R/50x.html && (cd $R && find . -type f -print0 | sort -z | xargs -0 shasum -a 256 > ../$(basename $R).sha256)`
2. Verify the release **before** it is live: a second Caddy listener or `file_server` on a private port pointing at `$R`, `curl` the smoke subset; check `shasum -a 256 $R/demo/aicc-demo.mp4` starts `6ec46e72fd2531ea`.
3. Atomic swap: `ln -sfn $R /srv/aicc/current.new && mv -T /srv/aicc/current.new /srv/aicc/current` (Linux; `mv -T` renames over the symlink in one step). Caddy's `file_server` resolves the path on every request: no reload is needed.
4. Smoke (section 4 subset) against the live host.

Roll the static site back: `ln -sfn /srv/aicc/releases/<previous> /srv/aicc/current.new && mv -T /srv/aicc/current.new /srv/aicc/current`. No build, no DNS, seconds. This is independent of WordPress and of Pages.

## 8. Known blockers and owner inputs at the time of writing

Technical: no production Control Plane host or edge exists yet; **real Caddy not yet exercised (validate + curl replay are hard gates)**; `/get-started/` page referenced by docs and the plugin readme draft is not built (so `/install/` and `/download/` aliases are disabled); links to WordPress-owned routes use `next/link` (cheap 404 prefetches at the edge, tolerated); the single legal-draft `lastmod` in the sitemap; the static `robots.txt` does not carry WordPress's `Disallow: /wp-admin/` + `Allow: /wp-admin/admin-ajax.php` (the edge serves the static one).
Owner/ops decisions (not decided here): where the edge runs and its redundancy/monitoring (a single small host replaces GitHub's CDN for the marketing pages); **[OWNER]** `/wp-admin/` and `/wp-login.php` IP/SSO restriction and denying `xmlrpc.php` (commented options in the template, off in v1); the transactional-mail sender and SPF/DKIM (above); Search Console ownership method; rollback window length and Pages retirement; whether to register `aicommercecopilot.com` (named by the old site's robots/sitemap, unregistered); payment-gateway requirements (frame-ancestors / `X-Frame-Options` on checkout, source-IP checks, return method) once a gateway is chosen; uppercase-URL folding (rejected in v1); permanent 301 aliases (`/account`, `/login`, `/register`, `/shop`, `/store`) are cached by browsers for a long time: accepted, or switch them to 302 until the route map is final.
Legal/review: counsel approval of 60 flagged legal blocks and 9 FAQ answers (`NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=true` only after approval); native review of he/es/ru drafts.
Deferred non-blockers: translated demo voice/subtitles, short demo cut, WordPress.org listing, payment gateway choice (PayPlus vs Tranzila), gating the structured-data `offers` until checkout is live.
