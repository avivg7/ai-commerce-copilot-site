# copilt.org DNS baseline, before/after table, and mail readiness inventory

Status: **READ-ONLY INVENTORY. Nothing here has been applied.** No DNS, registrar, GitHub, repo or QA-service setting was changed and no mail was sent. Every row marked **[OWNER ACTION]** needs the owner's explicit approval at that moment (same rule as `runbook.md`).
Observed: **2026-10-20, 06:26-06:30 UTC** (`dig` from the dev machine; resolvers: system default, 1.1.1.1, 8.8.8.8, and the authoritative `dns1.registrar-servers.com` (156.154.132.200) / `dns2.registrar-servers.com` (156.154.133.200)). Domain facts from `whois`: registrar NameCheap, Inc.; status `clientTransferProhibited`; expires 2027-07-04; **DNSSEC unsigned**. Anything not confirmed is marked **UNVERIFIED**. DNS/web content was treated as data.
Related docs: `runbook.md` (precedence), `redirect-matrix.md`, `Caddyfile.edge.template`.

---

## PART 1. Public DNS baseline (2026-10-20 06:26-06:30 UTC)

All three public resolvers and both authoritative servers returned the same RRsets (only RR ordering differed). TTL column: **auth** = value at `dns1/dns2.registrar-servers.com`; recursive resolvers count down from it.

| Name | Type | Value | TTL (auth) | Notes |
|---|---|---|---|---|
| `copilt.org` | A | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` | **1799** | the four GitHub Pages IPs |
| `copilt.org` | AAAA | none | - | NODATA (SOA returned) |
| `copilt.org` | CNAME | none | - | |
| `copilt.org` | MX | `10 eforward1.registrar-servers.com.`, `10 eforward2...`, `10 eforward3...`, `15 eforward4...`, `20 eforward5...` | **1800** | Namecheap email forwarding |
| `copilt.org` | TXT | `"v=spf1 include:spf.efwd.registrar-servers.com ~all"` (the **only** apex TXT) | **1800** | single SPF; no verification TXT of any kind |
| `copilt.org` | NS | `dns1.registrar-servers.com.`, `dns2.registrar-servers.com.` | **1800** (parent `.org` delegation: 3600) | Namecheap BasicDNS-style hosts |
| `copilt.org` | SOA | `dns1.registrar-servers.com. hostmaster.registrar-servers.com. 1787482698 43200 3600 604800 3601` | 3601 | **SOA minimum 3601 = negative-cache TTL (see section 2.5)** |
| `copilt.org` | CAA | **none** | - | any CA may issue |
| `copilt.org` | DS (at .org) / DNSKEY | **none / none** | - | DNSSEC not enabled |
| `www.copilt.org` | CNAME | `avivg7.github.io.` | **1799** | GitHub Pages user site |
| `www.copilt.org` | A / AAAA (via the CNAME) | A `185.199.108-111.153`; AAAA `2606:50c0:8000::153`, `8001::153`, `8002::153`, `8003::153` (these belong to `avivg7.github.io`, TTL 3600, GitHub's zone) | CNAME 1799 | **www is dual-stack today only because of the CNAME** |
| `www.copilt.org` | MX/TXT/NS/DS | none (CNAME owner: no other types may exist) | - | |
| `www.copilt.org` | CAA (effective) | via the CNAME target `avivg7.github.io`: `issue`/`issuewild` for `sectigo.com`, `letsencrypt.org`, `digicert.com` (GitHub's zone, not ours) | 3600 | the CAA lookup follows the alias; `copilt.org` itself has none |
| `api.copilt.org` | A | `139.59.157.231` (DigitalOcean, Caddy) | **1799** | no AAAA, no CNAME, no MX/TXT |
| `_dmarc.copilt.org` | TXT | **none** | - | **no DMARC policy exists** |
| DKIM selectors tried: `default`, `google`, `selector1`, `selector2`, `s1`, `s2`, `k1`, `mail`, `dkim` `._domainkey` and `_domainkey` | TXT/CNAME | **none exist** | - | no DKIM published |
| `_github-pages-challenge-avivg7` (apex and `.www`) | TXT | **none** | - | **no GitHub Pages domain verification** |
| `_acme-challenge`, `.www`, `.api` | TXT/CNAME | **none** | - | |
| `_mta-sts`, `_smtp._tls`, `default._bimi`, `_amazonses` | TXT | none | - | |
| Site-verification TXT (google-site-verification, MS=, etc.) | TXT | **none** (apex has only the SPF TXT) | - | |
| Subdomains tried (A/AAAA/CNAME on the authoritative server): `staging stage www-stage edge-stage qa test app admin mail docs status cp account dev beta demo blog shop store billing license licenses portal control cdn static assets webmail smtp imap pop ftp ns1 ns2 autodiscover autoconfig` | - | **none exist** | - | only `www`, `api` and the apex exist |
| Wildcard (`*.copilt.org`) | A | none (random label returned NXDOMAIN-style SOA) | - | |
| Other | ANY on apex | `HINFO "RFC8482"` (server minimal-ANY) | 3600 | |

Related live state seen while checking (not DNS): `https://copilt.org/` answers `301 https://www.copilt.org/` from GitHub.com; Pages certificate for `www.copilt.org`/`copilt.org` was Let's Encrypt YR2 with notAfter 2026-11-19 until the morning of 2026-10-20, and **GitHub renewed it at 12:41 UTC that day (Let's Encrypt YR1, notAfter 2027-01-18 12:41:22 GMT; re-verified 16:41 UTC with `openssl s_client`, `live-facts-2026-10-20.txt`)**; earlier the same morning `gh api .../pages` showed `https_enforced: true`, certificate `approved`, expires 2026-11-19, no pending domain verification; `api.copilt.org` certificate Let's Encrypt YE2, notAfter 2026-11-21. Authoritative A/CNAME TTLs read **1799** and MX/TXT/NS read **1800**, constant across repeated queries (so the runbook's "1800 s" is right to within one second).

---

## PART 2. Before/after DNS table for the owner (NOT APPLIED)

Placeholders: `<EDGE_IPV4>` and `<EDGE_IPV6>` are the public addresses of the future Caddy edge (**none exists yet**; runbook section 0). Where the owner is to be the one acting it is marked **[OWNER ACTION]**. All changes are made in **Namecheap -> Domain List -> Manage -> Advanced DNS** (the zone is served by Namecheap's own nameservers, so that is the only place; no other panel hosts it). The Namecheap API (`namecheap.domains.dns.setHosts`) is an alternative, but it **replaces the entire host list in one call** (documented behaviour, UNVERIFIED in this session); a wrong call would delete MX/SPF. Prefer the UI, or pre-build the full record list from the table below before any API use; API access also needs enabling, an IP allow-list and an API key (requirements UNVERIFIED).

### 2.1 Records that CHANGE at cutover (rewritten after the architecture review F4/F5: no record is ever absent)

| # | Name | Type | BEFORE (today) | AFTER | TTL | Step / gate |
|---|---|---|---|---|---|---|
| 0 | `edge` (name TBD by the owner, e.g. `edge.copilt.org`) | A (+ AAAA) | does not exist | **ADD in advance, at least 24 h before the flip:** `A <EDGE_IPV4>` (+ `AAAA <EDGE_IPV6>` if the edge serves IPv6). It carries no traffic until row 1 points at it | 300 | runbook 2.5 **[OWNER ACTION]** |
| 1 | `www` | CNAME | `avivg7.github.io.` | **EDIT the target of the same record** to `edge.copilt.org.` (CNAME to CNAME; the record is never deleted, so no empty answer exists to be cached; **rollback is the same edit back**) | 300 | runbook 3.3a **[OWNER ACTION]**; verify at 3.3b before touching the apex |
| 2 | `@` (apex) | A x4 | `185.199.108.153`, `.109.153`, `.110.153`, `.111.153` | **EDIT in place** to `A <EDGE_IPV4>` (edit the first record's value, then remove the other three, or edit all four to the same address). The apex cannot be a CNAME (MX and SPF live there). Optional alternative if Namecheap offers it: an ALIAS/ANAME at the apex to `edge.copilt.org.` (UNVERIFIED) | 300 | runbook 3.3c **[OWNER ACTION]** (only after 3.3b passes) |
| 3 | `@` (apex) | AAAA | none | optional `AAAA <EDGE_IPV6>`; add **only** if the edge answers port 443/80 over IPv6 (runbook precondition 1.2) | 300 | **[OWNER ACTION]**, optional |

Notes on the two flips:
* **Why not "delete the CNAME, then add an A":** the SOA minimum is **3601 s**, so a resolver that asks while a name has NO record caches the EMPTY answer for up to an hour (standard negative caching; INFERRED from the SOA, not observed). The delete-then-add plan has such a window in BOTH directions (flip and rollback), and the earlier "back-to-back, it only lasts a moment" mitigation cannot make the UI save atomic. Editing the CNAME target keeps the name answerable at every instant. Whether the Namecheap UI implements "edit" as an atomic change or as delete+add behind the scenes is **UNVERIFIED**; the runbook's optional dry run on a throwaway name (poll `dig @dns1.registrar-servers.com` every second during an edit) answers it before the real change.
* `www` becomes dual-stack only if row 0 includes an AAAA. Today the IPv6 addresses come from GitHub through the CNAME; after the flip IPv6 clients simply use IPv4 when the edge has no AAAA. A stale or wrong AAAA is worse than none.
* Apex: during the edit some clients get GitHub (which answers `301 -> https://www.copilt.org/`) and some the edge (which answers the same 301), so a mixed answer set is harmless provided the edge already has a valid certificate for `copilt.org` (runbook 1.10). Keep the mixed window short.
* The extra `edge` record is permanent unless the owner removes it after the rollback window; it exposes the edge IP, which is public anyway once the flip is done.

### 2.2 Records that MUST NOT change or be removed

| Name | Type | Value | Why |
|---|---|---|---|
| `@` | MX x5 | `10 eforward1`, `10 eforward2`, `10 eforward3`, `15 eforward4`, `20 eforward5` `.registrar-servers.com.` | all inbound mail for `@copilt.org` (Namecheap forwarding; support/owner addresses) |
| `@` | TXT | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | the only SPF; **exactly one SPF TXT may exist** (two make SPF a permerror). Changed only by the separate mail decision (Part 3) |
| `@` | NS | `dns1.registrar-servers.com.`, `dns2.registrar-servers.com.` | delegation |
| `api` | A | `139.59.157.231` | the Backend API; untouched by this plan |
| `_dmarc`, DKIM selectors, verification TXT | - | **none exist today** | nothing to preserve; new ones are added alongside, never replacing the SPF |

### 2.3 Records ADDED (all optional or conditional)

| Name | Type | Value | When | Notes |
|---|---|---|---|---|
| `_acme-challenge` and/or `_acme-challenge.www` | TXT | per-challenge token from the ACME client | only if certificate plan 1.10(i) (DNS-01 pre-issue) is chosen | adds nothing that affects traffic; remove afterwards; TTL 60-300 (Namecheap offers 1 min lower bounds, UNVERIFIED in this session). Caddy needs a build with a Namecheap DNS module (needs API key + IP allow-list) or use `certbot --manual` / `acme.sh` and paste the TXT in the UI. HTTP-01 (plan 1.10(ii)) needs **no DNS record** |
| `@` | CAA | e.g. `0 issue "letsencrypt.org"` (+ `0 issuewild ";"` if no wildcard) | optional hardening, **not needed**; none exists today | If added it must allow the CA the edge uses (Caddy: Let's Encrypt and ZeroSSL by default). It also governs `www` once `www` is no longer a CNAME to GitHub. While `www` is still a CNAME the CAA that applies is GitHub's (see section 1) |
| `_github-pages-challenge-avivg7` | TXT | value shown by GitHub's "Verify domain" page | **after** DNS leaves GitHub, before removing the Pages custom domain (runbook section 6; closes the takeover gap) | new TXT alongside the SPF; **[OWNER ACTION]** |
| `@` | TXT | Search Console / Bing verification string | only if the DNS method is chosen (runbook 1.8) | a separate TXT row; never merge into the SPF row |
| `_dmarc`, DKIM, SPF edit | TXT/CNAME | see Part 3 | only after the sender decision (runbook 1.11) | separate owner-approved DNS change |
| `stage` (stage.copilt.org) | A (+ AAAA) | the Linux staging host | **[OWNER ACTION]**, decided 2026-10-21: needed for Let's Encrypt (HTTP-01/TLS-ALPN-01) to issue the staging certificate; no other record changes (no MX/SPF/TXT, no apex, no `www`). Create it only after the host exists; before that the test tools run with an explicit IP and `--allow-dns-mismatch` (`docs/cutover/stage-linux.md` section 10). Check `dig +short CAA copilt.org` first | 300 | **[OWNER ACTION]** |
| other staging/rehearsal names | - | rehearsal host | none | rehearsals use the fail-closed tools' forced connection (`scripts/lib/target-guard.mjs`): the names are never resolved, no DNS is needed (the production `edge` record is row 0 in 2.1) |

### 2.4 TTL lowering plan

| When | What | **[OWNER ACTION]** |
|---|---|---|
| T-24 h or earlier | add the `edge` A (row 0) at TTL 300; set TTL **300** on the `www` CNAME and the four apex A records (Namecheap "Automatic" is 1800/1799; choose 5 min). **Why 24 h and not 30 minutes:** the authoritative TTL today is **1799-1800 s**, so resolvers that cached the old record just before your edit may keep it for up to 30 minutes after the edit AND a TTL change only takes effect for them after their cached copy expires: lower it a day ahead so that every resolver is on 300 s by the flip. Leave MX/TXT/NS/api at their current TTL | yes (runbook 2.5) |
| T-0 (rows 1 and 2) | EDIT the existing records (their TTL stays 300) | yes |
| T+7 to T+14 days, stable, Pages retired or window closed | raise `www`/apex to 1800 or 3600 | yes |
| Rollback window | keep 300 until the owner closes the window (rollback edits the records back at TTL 300) | yes |

Honest arithmetic of a flip or a rollback with TTL 300 lowered 24 h earlier: authoritative servers answer the new value immediately (Namecheap's propagation to its two nameservers is UNVERIFIED but they showed identical data in every check); a recursive resolver switches within **300 s**; browsers and OS caches add their own (Chrome up to 1 minute for DNS, indefinitely for cached 301 responses of the apex and of the new alias redirects; an HTTP/3 hint `Alt-Svc` lives `ma=3600` after the edge's change, GitHub sends none). With TTL NOT lowered: up to 1800 s. "About five minutes" is therefore the BEST case with every precondition met, not a promise, and any gap in a name's records adds up to 3601 s on top. Note that the parent NS delegation at `.org` has TTL 3600 and is unrelated to these edits.

### 2.5 Certificate-related summary

* Today: GitHub Pages certificate (Let's Encrypt) **renewed on 2026-10-20, valid to 2027-01-18 12:41:22 GMT** (previously 2026-11-19). GitHub renews roughly 30 days before expiry and only while DNS still points at it; once DNS leaves GitHub it cannot renew (runbook section 5). The GitHub-side rollback is therefore good until the notAfter in force on the day of the flip.
* The edge needs its own certificate covering `www.copilt.org` and `copilt.org` before or immediately after the flip. Option A (pre-issue with DNS-01 and load the files; manual renewal every 60-90 days unless the owner approves a DNS-provider API token, which this plan never requests) and Option B (let Caddy obtain it by HTTP-01/TLS-ALPN once DNS points at the edge) are in runbook 1.10. A DNS-01 challenge needs `_acme-challenge` TXT rows (section 2.3); HTTP-01 needs port 80/443 reachable and DNS already pointing at the edge, and needs no DNS record.
* `www` as a CNAME to `edge.copilt.org`: the CAA lookup for `www` follows the alias to `edge.copilt.org` (no CAA) and then `copilt.org` (none): no CA is excluded. HTTP-01 validation of `www.copilt.org` follows the same chain to the edge IP.
* No CAA exists; none is required. `AICC_ACME_EMAIL` is the ACME account contact; do not count on the CA to send expiry notices (not verified): monitor with `scripts/ops/cert-expiry-check.sh`.

### 2.6 Rollback table (restore exactly these values, by EDITING)

| Name | Type | Restore to | TTL | When |
|---|---|---|---|---|
| `www` | CNAME | **edit the target back** to `avivg7.github.io.` (the record is never deleted: no empty answer) | 300 (was 1799) | any rollback; partial rollback of 3.3b is this row only |
| `@` | A | edit the value(s) back to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (edit one record, then add the others; remove the edge address last) | 300 (was 1799) | rollback after 3.3c |
| `@` | AAAA | delete the edge AAAA if one was added (none existed before) | - | |
| `edge` | A | leave (harmless) or remove after the rollback window | - | |
| `_acme-challenge*` | TXT | delete (none existed before) | - | |
| (nothing else) | MX x5, SPF TXT, NS, api A | **untouched, leave as is** | - | |

Limits: (1) the GitHub-side rollback only works while the Pages certificate in force at the time of the flip is valid (2027-01-18 today); re-verify right before the flip (runbook 2.3/3.1). (2) **Rollback makes the Control Plane unreachable** (accounts, license validate/activate POSTs from plugins in the field, cart, checkout all become Pages 404s) and the customer and owner consequences are written down in runbook section 5, including the owner decision (rollback only before the first customer, or a separate stable hostname for plugin traffic). (3) Time: one TTL plus caches; never "five minutes".

Recording for the evidence folder: the section 1 table is the "before" record; the runbook asks for `dns-before-YYYYMMDD/` plus a Namecheap Advanced DNS screenshot on the day before.

---

## PART 3. Mail readiness inventory (code and config read only; no mail sent)

Sources read: Control Plane `.../aicc-control-plane-worktrees/cp2a-14-readiness-independence` (HEAD `054b5d9` when this section was re-checked on 2026-10-20; `757a091` when the mail inventory was written), Backend `.../aicc-backend-worktrees/cp2a-6-prelaunch-commercialization` (HEAD `7b45923`), Plugin `/Users/avivgerman/Projects/ai-commerce-copilot-worktrees/cp2a-14-readiness-independence` (HEAD `d53002f`), the QA Control Plane install `~/aicc-qa-acceptance/control-plane/wp` (read-only SELECT on its options table, port 8981) and its bundled WooCommerce 10.9.4.

### 3.1 What actually sends mail today

| Component | Sends mail? | Detail |
|---|---|---|
| **Backend (FastAPI)** | **No.** | No SMTP/provider library in `requirements.txt` (fastapi, uvicorn, sqlalchemy, asyncpg, alembic, pydantic, httpx, pgvector); no send code in `app/` or `scripts/`. Email appears only as an SHA-256 hash for deletion workflows. Operator alerts are unspecified in docs (`docs/stage8-operator-task-runbook.md` says where the alert goes is undecided). |
| **Plugin** | **No.** | No `wp_mail`/`mail()` anywhere in `includes/`. It only reads `billing_email` to hash it (`class-aicc-orders.php`). Links to the site use `https://www.copilt.org/` (Plugin URI; account URL default `https://www.copilt.org/my-account/`). |
| **Control Plane** (WordPress + WooCommerce + `aicc-license-manager` + theme `aicc-admin`) | **Only WordPress/WooCommerce stock emails, plus one license-key paragraph inside a stock WC email.** | No `wp_mail` call, no `WC_Email` subclass, no `wp_mail_from*` / `woocommerce_email_from_*` filter, no `phpmailer_init`, no SMTP plugin, no theme email templates (`themes/aicc-admin/woocommerce/` has only `myaccount/dashboard.php` and `navigation.php`). The only mail hook is `woocommerce_email_order_details` -> `maybe_email_issued_key()` (class-aicc-lm-woocommerce.php:128, 1255). |

**Stale-doc surprise:** `CLAUDE.md` in the Control Plane (line ~320) says a customer "license issued" transactional email fires on completion via a `WC_Email` subclass. **That code does not exist** in this worktree (grep for `WC_Email`, `wp_mail`: nothing); the license key is appended to WooCommerce's own order emails instead. `CLAUDE.md` also lists "email templates" as a planned redesign session that is not done.

### 3.2 Per flow

| Flow | Mail sent today | Mechanism / source | Link host that appears |
|---|---|---|---|
| Account creation | WooCommerce "New account" to the customer (`customer_new_account`, default-enabled; `woocommerce_registration_generate_password=yes`, signup at checkout `yes`, so the mail carries a **set-password magic link**). WordPress core admin notification of new user is stock | WC 10.9.4 `WC_Email_Customer_New_Account`; link = `wc_get_account_endpoint_url('lost-password')?action=newaccount&key=..&login=..` | built from `wc_get_page_permalink('myaccount')` -> `home`/`siteurl` option. **QA: `http://127.0.0.1:8982/my-account/lost-password/...`**. Production: `https://www.copilt.org/my-account/lost-password/...` **only if `home`/`siteurl` are set to it** (runbook 1.1). Language-prefixed (`/he/...`) when the request language is not English (plugin i18n rewrites WP-built URLs) |
| Password reset | WooCommerce "Reset password" (`customer_reset_password`) | `WC_Shortcode_My_Account::retrieve_password` -> `woocommerce_reset_password_notification` -> WC email; link `add_query_arg(key,id,login, wc_get_endpoint_url('lost-password','',wc_get_page_permalink('myaccount')))` | same as above; the browser test `tests/browser/reset-password.mjs` expects `/he|es|ru/my-account/lost-password/?key=..&id=..`. The core `wp-login.php` fallback mail (if ever reached) builds from `network_site_url()` = `siteurl` |
| Order / purchase receipt | WC "Processing order" / "Completed order" (customer), "New order" (admin), "Failed/Cancelled" (admin), "On-hold"; invoice if triggered. All stock WC templates; no AICC wording except the license key block | WC defaults; settings below | order links via `home_url`-based WC permalinks |
| License issued | The **plaintext key + "Normally you don't need to paste a license key..." text** is added inside the customer order email, **only if the transient `aicc_lm_issued_key_<order_id>` still exists (15-minute TTL, set at issuance)**. If the email is delayed or resent later than 15 min, or the order is manually re-sent, the key block is absent (the My Account page remains the source). A deferred/queued email feature (`woocommerce_feature_deferred_transactional_emails_enabled` is `no` in QA) would widen the risk | `class-aicc-lm-woocommerce.php:677,1255` | none (the block contains no link) |
| Activation (store connects) | **None** | in-page only (Connect AICC; My Account) | - |
| Suspension, expiry, revocation | **None** (state changes, outbox delivery to the Backend, My Account/lifecycle page copy; the expiry sweep `aicc_lm_expiry_sweep` sends nothing and `docs/cp2a24-expiry-and-manual-renewal.md` describes no reminder or renewal email) | - | - |
| Refund | WooCommerce stock "Refunded order" customer email (if the refund is issued through WC); license revocation itself sends nothing | `class-aicc-lm-refund-handler.php` has no mail | WC links |
| Support / contact | **No contact form and no inbound mail handling.** Support is a `mailto:` link built from `AICC_LEGAL_SUPPORT_EMAIL` (constant or env) in the footer, My Account and legal pages; refund and data-deletion requests are "write to the support address from your account email" | `class-aicc-lm-myaccount.php:459`, theme `inc/helpers.php:103` | `mailto:` only |

Gaps worth owner attention: no license-lifecycle email exists for expiry reminders, suspension or revocation (merchants learn only by visiting the site/plugin); the only copy of the one-time key by mail depends on the 15-minute transient; the language of emails follows the site language, not the customer's (`docs/unified-experience/multilingual-architecture.md` section 6).

### 3.3 From / Reply-To / mechanism / sink (QA reality)

* **From name:** not set; WooCommerce uses the site name (`get_bloginfo('name')`), QA = `AICC License Manager Suite (QA)`.
* **From address:** WooCommerce option `woocommerce_email_from_address` = **`owner@aicc-qa.example`** (QA). WordPress `admin_email` = `owner@aicc-qa.example`. Core WordPress mail with no override would be `wordpress@<host of siteurl>` (QA: `wordpress@127.0.0.1`, an invalid sender). No constant or filter overrides any of this in code.
* **Reply-To:** WooCommerce 10.9.4 sets it to the **From address** for customer emails unless a custom reply-to is enabled (so replies would go to a no-reply style sender if one is chosen), and to the **customer's billing email** for admin New order / Cancelled / Failed emails (`class-wc-email.php:684-704`).
* **Footer text:** `{site_title}<br />{store_address}`; QA store address/city/postcode are **empty** (default country US:CA) -> a production email would show a blank address line until WooCommerce > Settings > General is filled. No unsubscribe line (transactional emails; none required; none present). No support line inside the emails.
* **Sending mechanism:** PHP `mail()` via `wp_mail` -> PHPMailer `mail` transport. QA CP runs `php -S` with no php.ini (Local's PHP 8.2.29 binary, `sendmail_path = /usr/sbin/sendmail -t -i`, `SMTP=localhost:25`). **No SMTP plugin**; active plugins are only `aicc-license-manager` and `woocommerce`.
* **QA mail sink: none.** No Mailpit/MailHog process is running and the launchd QA stack is not wired to one (Local's own `php.ini.hbs` points to MailHog only for Local-managed sites; a Mailpit service folder exists in Local's `lightning-services` but nothing is listening). Mail from the QA stack goes to macOS `/usr/sbin/sendmail` (delivery behaviour **UNVERIFIED**; probably queued or dropped). In automated tests mail is suppressed with `add_filter('pre_wp_mail','__return_true')` (`tests/lib/helpers.php:31`); `WP_HTTP_BLOCK_EXTERNAL` is also on in QA. So **no test anywhere has proven a real email's content, headers or deliverability**.
* **Hard-coded hosts in mail templates:** none. All links derive from `home_url`/`site_url`/WC permalinks; the host that appears is exactly the `home`/`siteurl` option (QA: `http://127.0.0.1:8982`; a copied QA database would leak `127.0.0.1` links into real mail; hence the runbook's `wp search-replace` and "no 127.0.0.1" checks).

### 3.4 Placeholder / pending values that touch mail

| Item | Current | Where |
|---|---|---|
| `AICC_LEGAL_SUPPORT_EMAIL` | unset -> UI shows "the support address" / "Support details will be confirmed before purchases open."; legal docs contain "(to be confirmed before purchases open)" (formerly "(pending)") | `class-aicc-lm-legal-config.php`, `check-launch-blockers.php` (flags unset and fake addresses) |
| `woocommerce_email_from_address` / `admin_email` | `owner@aicc-qa.example` (QA) | **NOT checked by `check-launch-blockers.php`** (it checks only the support address); add to the launch gate or set manually |
| WC store address, footer text | empty address | WooCommerce settings |
| Support address in static-site copy | `support@example.test` is a sentinel the site `launch:check` rejects; real value comes from `NEXT_PUBLIC_AICC_SUPPORT_EMAIL` | runbook section 7 |
| Legal/Refund pages referencing the support mailbox | still "[LEGAL/SUPPORT EMAIL]" placeholder in the source | `docs/unified-experience/legal-changes-stage2.md` |

### 3.5 What production needs (no provider is chosen or recommended)

1. **Decide the From identity.** Options: (A) `support@copilt.org` / `noreply@copilt.org` from the apex; (B) a dedicated sending subdomain (e.g. `notify.copilt.org`, `mail.copilt.org`; names are examples only) with Reply-To `support@copilt.org`. Set WooCommerce > Settings > Emails (From name, From address, optional custom Reply-To, footer) and `AICC_LEGAL_SUPPORT_EMAIL`; fill store address; set `home`/`siteurl`. Transactional only today, so no unsubscribe is required; keep it that way (no marketing mail from the same stream).
2. **A real sending path.** Today PHP `mail()` only. Neutral options and what each needs:

| Pattern | Needs | DNS impact |
|---|---|---|
| Managed transactional email service (API or SMTP; e.g. SES, SendGrid, Mailgun, Postmark, Brevo, Resend; listed alphabetically, none preferred) | account, domain verification, an SMTP/API plugin or `phpmailer_init` config on the WordPress host, API key as a wp-config constant | DKIM (2-3 CNAME/TXT at the provider's selectors), usually an SPF include or a return-path CNAME, sometimes an MX on the return-path subdomain |
| Mailbox suite SMTP (Google Workspace, Microsoft 365, other) | paid mailbox, app password/OAuth, SMTP plugin | SPF include for that suite, DKIM key (selector TXT/CNAME); **its MX would conflict with Namecheap forwarding if used at the apex**, so a suite is realistic only for a sending subdomain or if forwarding is retired |
| Own relay (an SMTP server the owner runs) | a mail host with reverse DNS, TLS, DKIM signing, reputation management; outbound port 25 policies of the cloud host (UNVERIFIED) | `ip4:` in SPF, DKIM key; weakest deliverability |
| Keep PHP `mail()` from the WordPress host | nothing | `ip4:` in SPF; no DKIM unless the host signs; **not recommended for receipts/resets** (spam folder risk) |

3. **SPF.** Rules: exactly one `v=spf1` TXT per name; at most **10 DNS-querying terms** (`include`, `a`, `mx`, `ptr`, `exists`, `redirect`, counted recursively; `ip4`/`ip6`/`all` are free) and at most 2 void lookups; more gives a permerror and many receivers treat it as a fail. Today: 1 term (`include:spf.efwd.registrar-servers.com`, which resolves to flat `ip4:` ranges ending `?all`, 0 nested lookups). Combined records, written without choosing (replace `<provider>` with the include the chosen service publishes in its own dashboard; the second column counts terms; verified hostnames resolved on 2026-10-20 are noted):

| Pattern (sending from the apex) | Combined SPF TXT | Terms |
|---|---|---|
| Today (receiving only) | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | 1 |
| + one provider | `v=spf1 include:spf.efwd.registrar-servers.com include:<provider> ~all` | 2 + provider nesting |
| + two providers (e.g. transactional + a mailbox suite) | `v=spf1 include:spf.efwd.registrar-servers.com include:<provider-a> include:<provider-b> ~all` | 3 + nesting |
| + own relay IP | `v=spf1 ip4:<relay-ip> include:spf.efwd.registrar-servers.com ~all` | 1 |
| + provider + own IP | `v=spf1 ip4:<ip> include:spf.efwd.registrar-servers.com include:<provider> ~all` | 2 + nesting |

Hostnames that exist in DNS today (SPF content seen 2026-10-20; the provider's own docs are the authority and may differ): `_spf.google.com` (flat ip4/ip6, 1 term), `spf.protection.outlook.com` (flat, 1), `amazonses.com` (flat, 1), `sendgrid.net` (contains `include:ab.sendgrid.net`, so 2), `spf.mandrillapp.com` (flat, 1), `spf.brevo.com` (flat, 1), `spf.postmarkapp.com` (contains `a mx` plus two includes, so 4 or more), `spf.mailgun.org` and `_spf.resend.com` returned **no SPF TXT** at those names (those services normally use a per-domain return-path record, UNVERIFIED), so do not guess them. The current record ends `~all`; keep `~all` (not `-all`) until DMARC reports show clean alignment.
**If the mail is sent from a subdomain** the apex SPF does not need to change at all: the subdomain gets its own TXT (for example `v=spf1 include:<provider> ~all`), plus its own DKIM selector records. This is the lowest-risk option for the apex forwarding records.
4. **DKIM.** Required (it is what survives forwarding and carries DMARC alignment). The provider supplies the selector name and value (TXT or CNAMEs) at `<selector>._domainkey.<sending-domain>`; none exist today (the cheap selectors were tried). Rotating keys is the provider's job.
5. **DMARC.** Add `_dmarc.copilt.org TXT "v=DMARC1; p=none; rua=mailto:<a mailbox the owner reads>; fo=1"` only after SPF/DKIM are in place, start at `p=none`, review aggregate reports for 2-4 weeks, then `quarantine`, then `reject`. The `rua` address can be an alias on the Namecheap forwarders (`dmarc@copilt.org`, created in the Namecheap Email Forwarding UI, so it exists before the policy does). A policy at `_dmarc.copilt.org` also covers subdomains unless `sp=` or a subdomain `_dmarc` overrides it. Alignment is relaxed by default (a return-path on a sibling subdomain still aligns with the organisational domain).
6. **Return-path / bounces.** WordPress does not process bounces. Either the provider's default return-path (SPF alignment then comes from DKIM only) or a branded return-path CNAME/MX at a subdomain, per provider. Keep the Reply-To on a monitored address (the forwarded support mailbox), because WooCommerce replies go to the From address by default.
7. **Namecheap forwarding on the apex (receiving) versus sending.** The five apex MX records route *incoming* mail for `@copilt.org` to the forwarders and nothing else; a sending provider does not use them. Do not replace them with a mailbox suite's MX unless the owner decides to retire forwarding. Forwarders do not DKIM-sign on behalf of the owner's domain and rewrite the path, so third-party mail forwarded through them can fail SPF/DKIM at the final mailbox (harmless at `p=none`; matters once DMARC is `quarantine`/`reject`, and mail sent *by us* to a forwarded alias may be affected the same way). Namecheap's "Mail Settings" selector (Email Forwarding / Custom MX / Private Email) in Advanced DNS can **rewrite the MX and SPF rows when switched** (documented behaviour as I know it; UNVERIFIED in this session): never switch it as part of the cutover. Sending as `support@copilt.org` from a personal mailbox (Gmail "send as") is possible but those messages are sent from that mailbox provider's IPs, so they need that provider's include in the apex SPF or they fail alignment.
8. **Preconditions before any mail smoke test is green** (also runbook 1.11): sender chosen; DNS records above published and verified with a real external mailbox showing SPF/DKIM/DMARC `pass`; `home`/`siteurl` = `https://www.copilt.org`; a mail sink for staging (any capture tool or a provider's sandbox/test mode) so staging never mails real customers; From address and support address real (not `.example`); the wp-config settings from runbook 1.1.

### 3.6 DNS records that MUST NOT be removed (mail)

* `@ MX` x5 (`eforward1..5.registrar-servers.com`, priorities 10/10/10/15/20). Removing them stops all inbound mail for the domain.
* `@ TXT v=spf1 include:spf.efwd.registrar-servers.com ~all`: do not delete, do not add a second SPF TXT; any provider change must edit this one record (or move sending to a subdomain).
* `@ NS` (`dns1/dns2.registrar-servers.com`).
* `api A 139.59.157.231`.
* Anything the owner adds later for mail (DKIM selectors, `_dmarc`, return-path records) once published.

---

## Surprises and open items

1. **No DMARC, no DKIM, no CAA, no DNSSEC, no domain verification of any kind exists**; the zone has only apex A/MX/TXT/NS, `www` CNAME and `api` A. Today the domain cannot pass DMARC for any sender other than Namecheap forwarding.
2. **The Pages certificate was renewed on 2026-10-20 (notAfter now 2027-01-18)**; the whole GitHub-side rollback window depends on the certificate in force at the flip (runbook 2.3, section 5).
3. **`www` can lose IPv6, and replacing a record by delete+add risks an empty-answer cache** (one hour of negative caching, SOA minimum 3601): the plan therefore EDITS records in place (CNAME target for `www`, apex A values) and adds an `edge` A record first (section 2.1).
4. **The code that the Control Plane docs say sends a "license issued" email does not exist**; the key is only injected into stock WooCommerce order emails and only within 15 minutes of issuance.
5. **No lifecycle email exists** (activation, suspension, expiry, revocation); the Backend and the Plugin send no mail at all.
6. **The QA stack has no mail sink**, and tests suppress mail entirely, so email content, headers and deliverability have never been exercised.
7. The launch-blocker script does not check the WooCommerce From address or `admin_email` (both `owner@aicc-qa.example` in QA) or the empty store address.
8. UNVERIFIED in this session: Namecheap UI/API behaviours quoted in 2.x and 3.5.7, provider SPF include accuracy beyond the DNS answers seen, outbound port policies, and what macOS `/usr/sbin/sendmail` does with QA mail.
