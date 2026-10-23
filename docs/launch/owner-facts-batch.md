# Owner facts batch: everything the owner supplies, once

Audit date 2026-10-22. This is the minimum list. Fill the table, give the values to whoever builds and configures the two surfaces, and every public page, every stored legal document and both launch gates read from them. **Nothing in this file is a value.** AICC does not invent a company name, address, law, processor or region; an unset value renders as a visible pending line and fails a launch check.

Not legal advice. Items marked "counsel" need a lawyer's wording, not just a fact.

## A. Facts (7 values, each configured in two places)

The marketing Site is a static build, so its values are build-time environment variables. The Control Plane (WordPress) reads `define()` constants, then falls back to environment variables of the same name (`AICC_LM_Legal_Config::get`). Use the same text in both places.

| # | Fact | Where it appears | Site build env | Control Plane constant | Notes / who knows |
|---|---|---|---|---|---|
| 1 | Legal entity name | Terms 0, Privacy 1, Refund 1, DPA 1, Site legal pages | `NEXT_PUBLIC_AICC_LEGAL_NAME` | `AICC_LEGAL_ENTITY_NAME` | Owner. As registered. |
| 2 | Registered business address | Terms 0, Site legal pages | `NEXT_PUBLIC_AICC_ADDRESS` | `AICC_LEGAL_ENTITY_ADDRESS` | Owner. |
| 3 | Support email (a mailbox someone answers) | footer, 404, pricing, FAQ, account pages, every "write to support" sentence (refunds, deletion, export, accessibility) | `NEXT_PUBLIC_AICC_SUPPORT_EMAIL` | `AICC_LEGAL_SUPPORT_EMAIL` | `support@copilt.org` currently only forwards (email workstream owns the mailbox). A fake address (`example`, `test`, `invalid`, `local`) is rejected by both gates. |
| 4 | Governing law | Terms 28 | `NEXT_PUBLIC_AICC_GOVERNING_LAW` | `AICC_LEGAL_GOVERNING_LAW` | Counsel. The Site renders "Governing law and courts: {value}" from this ONE value, so put the courts in it too (see 5). |
| 5 | Courts / jurisdiction | Terms 28.1 | (inside #4 for the Site) | `AICC_LEGAL_JURISDICTION` | Counsel. Also needs the exclusive / non-exclusive choice, see C-1. |
| 6 | Payment processor (the real one, once chosen and configured) | Terms 4.2, Refund 3 and 5.3, Privacy 6, DPA 8, Site legal pages | `NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR` | `AICC_LEGAL_PAYMENT_PROCESSOR` | Payments workstream. Must also be put on the real-gateway allowlists (below). Do NOT name a provider that is not chosen. |
| 7 | Hosting region | Site Privacy "Where data is processed" only (the Control Plane text has no value, see C-5) | `NEXT_PUBLIC_AICC_HOSTING_REGION` | (none) | UNKNOWN for production: the staging Droplet is Frankfurt (FRA1); the production host and the Backend/database location after the planned move are not decided (backend-cutover workstream). Wording must stay true after the move, see C-5. |

Optional: `AICC_LEGAL_VAT_DETAILS` (Control Plane only): VAT/tax text for Terms 4.3 and Refund 5.3; unset renders "(not applicable at this time)". Owner and accountant decide whether a tax number or tax statement must be shown.

Where to put the Control Plane constants: **on the production host with `sudo aicc-owner-facts set KEY VALUE`** (the root-only file `/etc/aicc/owner-facts.env`, rendered into wp-config.php by `aicc-render-wp-config`; exact commands, validation rules and the read-back in `docs/cutover/production-path.md` section 3a). The production template carries the owner-facts region since 2026-10-23; nothing is rendered until a value is set, and secrets are never placed there.

## B. Switches that are decisions, not facts

| # | Switch | Set it when | Site | Control Plane | What fails closed without it |
|---|---|---|---|---|---|
| 8 | Legal wording approved by a person with legal authority | counsel approves the English texts | `NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=true` | `AICC_LEGAL_REVIEW_APPROVED=true` | draft notices stay on every legal page; both gates fail |
| 9 | he/es/ru legal text reviewed by native-speaking legal reviewers | optional, later | `NEXT_PUBLIC_LEGAL_TRANSLATIONS_REVIEWED=true` (new) | (the CP banner stays) | the machine-translation disclosure stays on the he/es/ru legal pages even after #8 |
| 10 | Infrastructure statements in the Privacy policy and the DPA compared with the live production setup | after counsel has corrected the subprocessor schedule (C-4) | (printed as a precondition) | `AICC_LEGAL_SUBPROCESSORS_VERIFIED=YYYY-MM-DD` (new; a real date, at most 90 days old) | the CP gate fails on "Standby only", Render/Neon, "no hosting region fixed", "no email-sending service" |
| 11 | Purchasable-price structured data | only when public checkout works | `NEXT_PUBLIC_AICC_STRUCTURED_OFFERS=on` | `AICC_STRUCTURED_DATA_OFFERS` = true | both gates fail if it is on while no real gateway is allow-listed |

The real-gateway allowlists (payments workstream, same decision as #6) are three DIFFERENT lists, not three copies of one: Site `scripts/lib/payment-gate.mjs` `REAL_GATEWAY_ALLOWLIST` holds the processor display name (compared with `NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR`); Control Plane `AICC_LAUNCH_REAL_GATEWAYS` (launch gate) and `AICC_LM_PAID_GATEWAYS` (runtime payment gate) hold exact WooCommerce gateway ids, the launch list being a subset of the runtime list. All are empty today on purpose; the two Control Plane lists are set on the host with `aicc-owner-facts` (`docs/cutover/production-path.md` section 3a).

## C. Counsel text (source edits, not environment values)

These cannot be filled by any value. They are listed so the lawyer sees the whole job in one place; proposed wording for each is in `docs/launch/legal-readiness.md`.

| # | Edit | File | Why a value cannot do it |
|---|---|---|---|
| C-1 | Exclusive or non-exclusive jurisdiction (or arbitration) | CP `scripts/legal-source/terms-of-service.md` 28.1 and the three `languages/legal/*/terms-of-service.md` | the placeholder has no configuration key; the Terms keep a "(pending)" after facts 1 to 7 are set (proved) |
| C-2 | Legal basis for account/purchase data and for store data | CP `privacy-policy.md` sections 2 and 3 (and translations) | counsel-only; two "(pending)" markers |
| C-3 | Controller / processor roles, breach-notice timeframe, audit mechanism, return format | CP `data-processing-addendum.md` 1, 9, 11.1, 11.2 | counsel-only |
| C-4 | Subprocessor schedule at launch: DigitalOcean (Control Plane) in use; Backend and database host(s) at launch and after the move; email provider if any; payment processor status "in use"; the "no email-sending service" sentence | CP `privacy-policy.md` 6, `data-processing-addendum.md` 8, `terms-of-service.md` 18.1 | provider facts: backend-cutover, email and payments workstreams |
| C-5 | Hosting region and transfer mechanism (or the statement that none is relied on), written so it stays true after the database move | CP Privacy 7, DPA 12; Site `legal.privacy.s.transfers.a` | the CP has no region value; the Site text contradicts itself once #7 is set |
| C-6 | Website and account cookies (language, plan-choice, sign-in, cart) | CP Privacy, Site Privacy "This website" | missing disclosure |
| C-7 | Ask Reco questions: stored locally or sent to the Service (the two policies contradict) | CP Privacy 3.3, DPA 4 vs Site `/product/` | plugin owner confirms the shipped behaviour |
| C-8 | Whether each new (larger) plan has its own 14 days | Refund 1, Terms 3.6 | policy decision |
| C-9 | Tax statement and any tax number | Terms 4.3, pricing page | owner and accountant |
| C-10 | Delete "and the legal drafts have not been reviewed by a lawyer" from the CP translation banner at approval; change "Draft" labels in the Site page header at approval | CP `pages/legal.php`; Site `common.draftUpdated` / `versionDraft` | do it together with #8 |

## D. Facts owned by other workstreams that the legal text depends on

| Fact | Owner workstream | Text that depends on it |
|---|---|---|
| Support mailbox exists and is answered; reply-time promise is realistic | email | Terms 15.4, Refund 2, Privacy 10, Accessibility, footer |
| Backend entitlement mode in production: `enforced` or `shadow` (default) | backend | Terms 16, 17.3; Refund 4; FAQ q63, q29; pricing FAQ; "AICC stops on your stores" |
| Backend and database host(s) at launch; date and target of the database move | backend-cutover | C-4, C-5 |
| Real payment gateway, refunds through it | payments | #6, Refund 3, "goes to the original payment method where the processor allows it" |
| How merchants get the plugin (no distributable ZIP, not on WordPress.org) | distribution | "install and activate the AICC plugin", "available for WooCommerce" |
| Retention sweep switched on or not | backend | Privacy 9, Refund 4, Data and trust, FAQ q15 q21 q23 q56 q63 |

## E. Order of work

1. Fill A (7 values) and decide B-8 with counsel; counsel does C-1 to C-9.
2. Site: build with the values, `AICC_BASE_PATH="" SITE_URL=https://www.copilt.org npm run build`, then `npm run launch:check -- --strict` (the only remaining failures must be the other workstreams' known ones: payment gateway allowlist, plugin distribution, sentinel values if a test build).
3. Control Plane: set the constants, re-seed the legal documents (`AICC_LEGAL_SEED_APPLY=1 wp eval-file scripts/seed-legal-documents.php`), then `AICC_PRODUCTION=1 wp eval-file scripts/check-launch-blockers.php`.
4. Compare one value on both surfaces by eye (support address, entity name): nothing cross-checks them.

## F. Fill-in block (names only; keep values out of chat, commits and logs)

```
# Site build environment
NEXT_PUBLIC_AICC_LEGAL_NAME=
NEXT_PUBLIC_AICC_ADDRESS=
NEXT_PUBLIC_AICC_SUPPORT_EMAIL=
NEXT_PUBLIC_AICC_GOVERNING_LAW=        # law and courts, one line
NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR=
NEXT_PUBLIC_AICC_HOSTING_REGION=
NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=     # true only after counsel approves
NEXT_PUBLIC_LEGAL_TRANSLATIONS_REVIEWED=   # leave empty until native legal reviewers approve he/es/ru

# Control Plane (wp-config.php define() or PHP-FPM environment)
AICC_LEGAL_ENTITY_NAME=
AICC_LEGAL_ENTITY_ADDRESS=
AICC_LEGAL_SUPPORT_EMAIL=
AICC_LEGAL_GOVERNING_LAW=
AICC_LEGAL_JURISDICTION=
AICC_LEGAL_PAYMENT_PROCESSOR=
AICC_LEGAL_VAT_DETAILS=                # optional
AICC_LEGAL_REVIEW_APPROVED=            # true only after counsel approves
AICC_LEGAL_SUBPROCESSORS_VERIFIED=     # YYYY-MM-DD after C-4 is corrected and compared with production
```
