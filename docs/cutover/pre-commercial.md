# Pre-commercial public release: the site is LIVE, checkout is CLOSED

Owner rule (2026-10-24): public production must not show ugly or internal placeholders ("(pending)", TODO, TBD, "placeholder", launch-test language), must not invent legal facts, and must not imply a purchase can be completed
while it cannot. **Public site live** and **commercial checkout open** are two different states with two different gates.

| State | What is true | Gate | Default |
|---|---|---|---|
| PUBLIC SITE LIVE | https://www.copilt.org serves the pages, in four languages. Prices and plan facts are public. No payment gateway, no mail provider, no legal and business facts yet. | `npm run test:public-truth` (this repo), same gate on the Control Plane fixture | the state a production release is built for until the owner facts exist |
| COMMERCIAL CHECKOUT OPEN | a customer can register, pay, receive a license and connect a store | `npm run launch:check -- --strict` (Site) and `scripts/check-launch-blockers.php` with `AICC_PRODUCTION=1` (Control Plane) | CLOSED |

## The switch (one fact, fail closed)

Owner fact **`AICC_COMMERCE_OPEN`** (boolean, production only, validated by `infra/provision/lib/owner_facts.py`): `sudo aicc-owner-facts set AICC_COMMERCE_OPEN true`, then `sudo aicc-render-wp-config --env production --confirm-production`. **Unset means closed.**
Only the exact value `true` is accepted (not `yes`, `1`, `TRUE`, `false`); the stage environment refuses the key. The Control Plane reads it in ONE place, `AICC_LM_Commerce_State` (plugin `aicc-license-manager`):

On a production install (home host `www.copilt.org` / `copilt.org`, or `WP_ENVIRONMENT_TYPE=production`, which the production template sets) commerce is OPEN only when ALL THREE hold, otherwise CLOSED:
1. `AICC_COMMERCE_OPEN === true` (the owner fact);
2. WooCommerce "Coming soon" is OFF (`woocommerce_coming_soon = no`): the existing store-level closed switch is REUSED, not duplicated; flipping only one of the two keeps the store closed;
3. the Control Plane launch gate has recorded a CLEAN run: `AICC_PRODUCTION=1 AICC_LAUNCH_ATTEST=1 wp eval-file scripts/check-launch-blockers.php` writes the option `aicc_launch_gate_attestation` only when it reports ZERO blockers, and a later attesting run that finds a blocker removes it (commerce closes again).

So **the switch cannot be flipped to open while the launch gate still reports blockers**, and **there is NO override**: a blanket "open anyway" constant would be a permanent hole in a money switch. A judgement the gate cannot make has its own dated attestation (`AICC_LEGAL_SUBPROCESSORS_VERIFIED`, `AICC_LEGAL_REVIEW_APPROVED`); a gate false positive is fixed in the gate (a reviewed change). Two earlier locks make the mistake hard to even write:
`owner-facts.sh set AICC_COMMERCE_OPEN true` is refused unless the six legal facts, the review approval, the sub-processor attestation date, the proof key id and both gateway lists are already in the facts file (it must be set LAST, and while it is set none of those can be unset); and
`render-wp-config.sh` refuses to render it when the production mail layer is not enabled (no safe `/etc/aicc-mail/smtp.env`): nobody could receive a password link or a receipt.
Not production (QA, local, the Linux staging host, every test fixture): behaviour is exactly what it was before; an explicit `define( 'AICC_COMMERCE_OPEN', false )` previews the closed presentation.

The Site is static and cannot ask the Control Plane, so it has its own build-time mirror, `NEXT_PUBLIC_AICC_COMMERCE_OPEN=true` (unset = closed; `src/lib/site.ts`). Set the two together at launch, in the same release. `npm run launch:check` prints it and treats a closed build as a COMMERCIAL blocker (not a blocker for the public release).

## What the visitor sees while CLOSED

| Surface | Closed presentation |
|---|---|
| Pricing (Control Plane, and the Site home plan cards / mirror) | the three plans keep their facts ($99 / $199 / $499, 365 days, manual renewal, 14-day guarantee on the initial purchase); each plan button is the statement "Purchases open soon" (not a link); the plan finder ends with the same statement; "Questions in the meantime? Write to support@copilt.org." |
| CTA bands (Site home, Product, Pricing; CP Pricing) | "Plans and prices are final. Purchases and new accounts open soon." + See pricing / Browse all questions; no "Create your account" promise |
| `/my-account/` | login for EXISTING accounts only; the registration form, the "what happens next" steps and the `?plan=` choice are gone (a posted registration is refused server-side); "Purchases open soon ... If you already have an AICC account, sign in below" |
| Lost password | "Password reset by e-mail is not available yet" (no mail provider): no form, a posted reset is dropped |
| `/cart/`, `/checkout/`, add-to-cart, Store API checkout | the "Purchases open soon" page (HTTP 200, noindex, no-store); nothing can enter a cart or be checked out (`woocommerce_add_to_cart_quantity`, `woocommerce_before_checkout_process`, `rest_pre_dispatch`) |
| Header "Get started" / "Sign in" | unchanged (shared kit contract); they land on the truthful `/my-account/` page above |
| FAQ (Questions, Pricing) | one calm line: the answers describe how plans work once purchases open |
| Operator / admin | untouched: wp-admin, wp-login (edge-restricted) and WooCommerce admin work as before |

## What replaces each "to be confirmed" phrase

A fact that is not supplied renders as a short calm statement and is NEVER invented. The Site shows "To be confirmed before purchases open." (he/es/ru machine drafts); the Control Plane legal documents show "(to be confirmed before purchases open)" in a span with the machine marker class `aicc-legal-pending` that the launch gate and seed script still key on.

| Where | Owner fact that replaces it (Control Plane constant / Site build env) |
|---|---|
| Terms 0, Privacy 1, Refund, DPA: entity name; Terms 0: registered address; Site "Company details" | `AICC_LEGAL_ENTITY_NAME`, `AICC_LEGAL_ENTITY_ADDRESS` / `NEXT_PUBLIC_AICC_LEGAL_NAME`, `NEXT_PUBLIC_AICC_ADDRESS` |
| Support address and notice addresses (Terms 7.3, 25.1; Privacy 10, 11; footer "Support details"; every "Support address:" slot) | `AICC_LEGAL_SUPPORT_EMAIL` / `NEXT_PUBLIC_AICC_SUPPORT_EMAIL` |
| Governing law (Terms 28) | `AICC_LEGAL_GOVERNING_LAW` / `NEXT_PUBLIC_AICC_GOVERNING_LAW` |
| Courts (Terms 28.1) | `AICC_LEGAL_JURISDICTION` (the Site folds the courts into the governing-law line) |
| Payment processor (Terms 4.2, Privacy 6, DPA 8, Refund 3 and 5.3, Site legal pages) | `AICC_LEGAL_PAYMENT_PROCESSOR` / `NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR` |
| Hosting region (Site Privacy "Where data is processed") | `NEXT_PUBLIC_AICC_HOSTING_REGION` (the Control Plane text has no value: counsel C-5) |
| Exclusive/non-exclusive jurisdiction (Terms 28.1), legal basis (Privacy 2 and 3), sub-processor status cell, controller/processor clauses | NO value can fill these: counsel edits `scripts/legal-source` (owner-facts-batch C-1 to C-5) |
| "Being finalized" notices on legal pages, Data and trust, Accessibility | `AICC_LEGAL_REVIEW_APPROVED=true` / `NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=true` (counsel approval) |
| "Purchases open soon" | `AICC_COMMERCE_OPEN=true` + coming soon off + a clean attested gate run / `NEXT_PUBLIC_AICC_COMMERCE_OPEN=true` |

`support@copilt.org` is offered ONLY in the closed-state "questions in the meantime" sentence (the mailbox the owner named for this period; it currently forwards). It is not the legal support fact: the footer and every "Support address:" slot keep the "to be confirmed" statement until `AICC_LEGAL_SUPPORT_EMAIL` is supplied.

## Verify a pre-commercial release

```
# Site: the production target exactly as the release builder builds it, no owner facts
AICC_BASE_PATH="" SITE_URL=https://www.copilt.org npm run build
npm run test:public-truth -- --out out                      # 0 findings
npm run test:public-truth -- --self-test                    # every rule proven by a mutation
# Control Plane fixture in a production-like closed state (production env constant, switch unset, real seeders, no AICC_LEGAL_* values)
npm run test:public-truth -- --url http://127.0.0.1:<port> --preset cp
# one command for the lot (after a merge): 
npm run test:launch-invariants -- --public-out out --public-url <site url> --public-truth --cp-url <cp url>
# the production RELEASE builder refuses a tree that fails the gate (recommended for every production release):
infra/release/build-site-release.sh --target production --public-truth --cp-worktree <CP worktree of the paired commit>
# on the live host, read-only GETs (also probes source maps and debug routes):
npm run test:public-truth -- --url https://www.copilt.org --preset site --probes edge
```
