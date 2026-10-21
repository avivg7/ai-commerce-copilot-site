# TLS, CAA and HSTS: decisions and owner-ready steps

Status: **prepared, NOT applied.** No public DNS record was changed. Measured facts are marked VERIFIED (observed 2026-10-21), the rest is reasoning.

## 1. Which certificate authority we actually use (VERIFIED)

| Name | Issuer observed | Expires | Issued by |
|---|---|---|---|
| `www.copilt.org` (GitHub Pages, today) | Let's Encrypt (intermediate YR1) | 2027-01-18 | GitHub Pages, automatically |
| `api.copilt.org` (existing API Droplet) | Let's Encrypt (YE2) | 2026-11-21 | the API host |
| `stage.copilt.org` (this staging host) | Let's Encrypt production CA (YE2) | 2027-01-19 | Caddy on `aicc-cp-stage`, ACME contact `ops@copilt.org` |

Every certificate we depend on comes from **Let's Encrypt**. Issuer domain for CAA: `letsencrypt.org`.

## 2. Existing CAA situation (VERIFIED with `dig`)

* `copilt.org`, `api.copilt.org`, `stage.copilt.org`: **no CAA record**: any public CA may issue.
* `www.copilt.org` is a CNAME to `avivg7.github.io.`; the CAA answer comes from `github.io` (it allows DigiCert, Sectigo and Let's Encrypt, including wildcard issuance by those CAs). After the cutover `www` becomes an A record and the lookup climbs to `copilt.org`.

## 3. Recommended CAA records (owner action at the DNS provider, Namecheap)

Add these three records **at the apex `copilt.org`** (CAA lookups climb from a name to its parents, so one set covers `www`, `api` and `stage`):

| Host | Type | Flags | Tag | Value |
|---|---|---|---|---|
| `@` | CAA | 0 | `issue` | `letsencrypt.org` |
| `@` | CAA | 0 | `issuewild` | `;` |
| `@` | CAA | 0 | `iodef` | `mailto:ops@copilt.org` |

Why this cannot break issuance or renewal:

* Everything we run is issued by Let's Encrypt (section 1), including GitHub Pages' certificates for the old site, so the old site keeps renewing until it is retired. `issue "letsencrypt.org"` permits exactly that CA.
* `issuewild ";"` forbids wildcard certificates; nothing here uses one (Caddy issues per-name certificates through HTTP-01/TLS-ALPN-01).
* `iodef` is only a reporting hint. Let's Encrypt does not send mail to it, so it is harmless; it documents who owns the policy.
* **Do NOT add `accounturi=` yet.** Binding issuance to our ACME account would make GitHub Pages' renewals fail (it uses its own account) while the old site is still live. Reconsider after the old site is retired: then `0 issue "letsencrypt.org; accounturi=https://acme-v02.api.letsencrypt.org/acme/acct/<id>"` is a good hardening step (the account URI is in Caddy's storage under `acme/acme-v02.api.letsencrypt.org-directory/users/ops@copilt.org/`; it is not a secret).
* `api.copilt.org` is covered by the same policy and is also Let's Encrypt, so its renewal (due 2026-11-21) is unaffected. Do not touch the API host.

Verify after the change (any machine):

```bash
dig +short CAA copilt.org              # the three records
dig +short CAA stage.copilt.org        # same (inherited): proves the climb
```

Rollback: delete the three records. Nothing else depends on them. If a renewal ever fails with "CAA record prevents issuance", delete `issuewild` and `issue` first (a missing CAA set allows every CA).

Verification of issuance with the CAA in place needs no extra step on staging: Caddy renews `stage.copilt.org` automatically about 30 days before 2027-01-19; confirm with `aicc-cert-expiry` output / AICC Ops `cert_expiry` rule after 2026-12-20.

## 4. HSTS: production ramp (decision)

The edge sends `Strict-Transport-Security: max-age=300` on every response on **both** the stage and the production render (`(hsts)` snippet in `docs/cutover/Caddyfile.edge.template`). Staging keeps `max-age=300` permanently.

Production ramp: a change of that one number in the template, re-rendered, deployed and reloaded, with the previous step observed clean first.

| Step | `max-age` | When to take it | Gate before the next step |
|---|---|---|---|
| 0 | 300 (5 min) | day of cutover | all of: `www` and apex answer over HTTPS without a certificate warning; apex 301/308 to `www`; checkout/login/account work over HTTPS; no mixed content; rollback tested |
| 1 | 86400 (1 day) | cutover + 1 day with no TLS incident | 7 clean days |
| 2 | 604800 (1 week) | after the 7 clean days | 4 clean weeks, and the certificate renewed at least once without manual action |
| 3 | 31536000 (1 year) | after step 2 held | stop here |

* **No `includeSubDomains`** until every subdomain that exists is verified to serve valid HTTPS for the full policy lifetime (`api.copilt.org` has its own TLS operations; any future `mail.`/`status.` name would be affected). This is an owner decision, not a default.
* **No `preload`** without explicit owner approval: a preload entry cannot be undone quickly, and it forces HTTPS for every subdomain forever.
* A browser keeps an HSTS policy for the whole `max-age`: if the certificate lapses at step 3, visitors cannot click through the warning. That is why renewal monitoring (`cert_expiry` WARNING at 14 days, CRITICAL at 5 days; sentinel TLS check) must be live **before** step 1.

## 5. What was and was not tested

* VERIFIED: the real Let's Encrypt production certificate for `stage.copilt.org`; the production render validates with Caddy 2.11.7 (`caddy validate`, run on the Mac); HTTP/3 is off in both renders (`servers { protocols h1 h2 }`, `Alt-Svc` removed); both renders carry the 300 s HSTS.
* NOT tested: issuance with a CAA record present (none was created); a second renewal cycle; the production host (there is none).
