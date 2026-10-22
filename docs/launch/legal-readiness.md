# Legal, support and trust readiness (WS10)

Audit date 2026-10-22. Branch `launch/legal` (Site, from `feature/unified-experience` adf345a) and `launch/legal` (Control Plane, from `feature/cp2a-14-readiness-independence` e22ebd1). Nothing pushed, merged or deployed.

**This is not legal advice and the author is not a lawyer.** Every text below marked "proposed" is a drafting suggestion for the owner and counsel. Nothing here approves a legal claim; the approval switches (`NEXT_PUBLIC_LEGAL_REVIEW_APPROVED`, `AICC_LEGAL_REVIEW_APPROVED`) were not touched. Where a fact is unknown the cell says **UNKNOWN** and who can find out. The single list of facts the owner has to supply is `docs/launch/owner-facts-batch.md`.

## What was audited

| Surface | Source of truth | Reviewed from |
|---|---|---|
| Terms of service, Privacy policy, Refund policy, Data Processing Addendum | Control Plane `scripts/legal-source/*.md` (English), seeded as versioned documents by `scripts/seed-legal-documents.php`, rendered at `/terms/`, `/privacy/`, `/refund-policy/`, `/data-processing-addendum/` | the four sources in full, the renderer (`class-aicc-lm-legal-documents.php`), the 12 he/es/ru translation files (structure and placeholders), a standalone render with every value supplied |
| Terms, Privacy, Refund, Data and trust, Accessibility (marketing mirror) | Site `src/data/legal.ts` + `src/i18n/*.ts` | source and the built `out/` in en, he, es, ru (39 pages, text extracted) |
| Questions / FAQ, 63 active items | `brand/content/faq.<locale>.json` (one file, byte-synced into the CP theme) | all 63 English items, the 9 flagged for legal review, JSON-LD |
| Pricing, home, product, footer, 404, edge 5xx page | Site (marketing) and CP theme (`pricing.php`, `plan-cards.php`, `front-page.php`) | built Site pages, the CP strings catalogues (theme 322, plugin 257 msgids), the staging host `stage.copilt.org` (read-only GETs) |
| Checkout acceptance and account pages | CP plugin | strings catalogue, `class-aicc-lm-plan-intent.php`, refund handler, live `Set-Cookie` of the staging host |
| Structured data | Site `src/lib/jsonld.ts`, CP `inc/seo.php` | built JSON-LD, seo:check negative controls, CP gate |
| Accessibility statements | Site and CP | text only; the tests were re-run (see the end) |

## Severity scale

* **BLOCKER**: would be a false or misleading public statement, or legally unfit, on launch day if left as it is. Must be resolved or consciously accepted by the owner.
* **HIGH**: real inconsistency or missing disclosure; fix before launch.
* **MEDIUM**: should be decided before launch; low chance of harm if shipped.
* **LOW / INFO**: polish, or recorded so nobody re-investigates.

Status: **FIXED** (committed with a test), **GATED** (cannot ship silently: a launch check fails closed), **OPEN** (needs the person in "decides").

## Matrix

| ID | Page / surface | Issue | Severity | Decides | Status |
|---|---|---|---|---|---|
| L-01 | Every legal page, footer, pricing, FAQ | Owner facts not supplied: legal entity name, address, support email, governing law, courts, payment processor, hosting region (Site) | BLOCKER (known) | Owner | GATED |
| L-02 | Terms 28.1 | The court-jurisdiction exclusivity is a placeholder with NO configuration value: the Terms still render "(pending)" after every `AICC_LEGAL_*` value is set (proved) | BLOCKER | Owner + counsel | GATED (gate now says no value can fill it) |
| L-03 | Privacy 2 and 3 | "Legal basis" is "(pending)" in two places; counsel-only | BLOCKER | Counsel | GATED |
| L-04 | Privacy 6, DPA 8 | Subprocessor schedule describes the pre-launch infrastructure: DigitalOcean "standby only", Render and Neon as live hosts, no email service, processor "not yet selected" | BLOCKER | Owner + counsel | GATED (new check, attestation required) |
| L-05 | Privacy 6, DPA 8 | "Not yet selected" stays in the payment-processor row after a processor is configured | BLOCKER once configured | Counsel | GATED (new check, no attestation can clear it) |
| L-06 | Privacy 7, DPA 12, Site privacy "Where data is processed" | Hosting-region wording: "no region fixed" vs a configured region; the Site text is self-contradictory once the region is set | HIGH | Owner + counsel | OPEN |
| L-07 | Privacy (both), Data and trust | Cookies of the website and the account area are not disclosed; the Site says only language and accessibility settings | HIGH | Owner + counsel | OPEN |
| L-08 | Privacy 3.3, DPA 4 vs Product page | Contradiction: Ask Reco questions "are sent to the Service" vs "are not sent to AICC" | HIGH | Owner (plugin owner confirms), counsel | OPEN |
| L-09 | Privacy 9, Refund 4, Data and trust, FAQ q15 q21 q23 q56 q63 | Retention wording ("target 12 months, nothing deleted automatically today") is true today but fragile; a retention sweep exists in the Backend with different defaults and is switched off | MEDIUM | Owner | OPEN (record) |
| L-10 | Terms 16, 17.3; Refund 4; FAQ q63, pricing; Site terms | "AICC stops working" on refund, revocation, suspension, expiry is true only when the Backend enforces entitlements; the default is `shadow`. The Terms drafting note that disclosed this is stripped by the renderer | HIGH | Owner (production mode) + Backend | OPEN |
| L-11 | Refund policy, Terms 4.4, FAQ, plan cards, home | 14-day money-back wording: meaning checked on every surface; the plan-card and home-line wording ("first-purchase", as in the first thing ever bought) did not carry the same meaning as "initial purchase of a plan" | MEDIUM | Owner | FIXED |
| L-12 | Refund 1, Terms 3.6 | Does a larger plan bought later get its own 14 days? Not stated | MEDIUM | Owner + counsel | OPEN |
| L-13 | Refund 2, Terms 15.4, Accessibility, Privacy 10 | Promises of a reply "within one business day" and handling by hand need a mailbox someone reads; support@copilt.org forwards only | HIGH | Owner (email workstream) | OPEN |
| L-14 | Terms 4.3, pricing page | Terms say fees are exclusive of taxes; the pricing page and cards show "$99 per year" with no tax statement; VAT/tax details are optional and unset | MEDIUM | Owner + accountant | OPEN |
| L-15 | Site legal pages, he/es/ru | The machine-translation disclosure disappeared when the English text was approved | HIGH | (code) | FIXED |
| L-16 | he/es/ru marketing pages | No visible machine-draft disclosure outside the legal pages and the accessibility statement | MEDIUM | Owner | OPEN |
| L-17 | CP legal translation banner | Says "and the legal drafts have not been reviewed by a lawyer": false after approval | LOW | Owner | OPEN |
| L-18 | Site Data and trust | "What we haven't finalized" (company details "will be published before launch") stayed after every value was supplied | MEDIUM | (code) | FIXED |
| L-19 | Site legal page header | "Draft last updated" and "Status: Draft" remain after approval | LOW | Owner | OPEN |
| L-20 | Privacy "Security" (Site) | "License keys ... are stored hashed" omits the 15-minute plaintext exception the CP policy states | LOW | Owner | OPEN |
| L-21 | Terms 16.2 (CP) | Disclosure about observe-only enforcement is a `[PRE-LAUNCH BLOCKER]` note and is removed from the published text by design | see L-10 | | |
| L-22 | DPA 11.1, 11.2, 1 | Breach-notice timeframe, audit mechanism and controller/processor roles are undecided | MEDIUM | Counsel | OPEN |
| L-23 | Accessibility statements (Site, CP) | WCAG 2.2 AA is stated as an aim, never as conformance; coverage statement is dated 2026-10-20; the two statements differ | LOW | Owner | OPEN |
| L-24 | Checkout acceptance | Checkbox links the four documents and the order records version and hash; the documents are drafts until approval | INFO | | OK |
| L-25 | Structured data | No Offer or price schema anywhere (Site and CP); FAQPage JSON-LD omits answers flagged for legal review until approval | INFO | | OK; CP gate added |
| L-26 | Certifications and security | No security-framework attestation, privacy-law badge or storage-encryption claim anywhere; the DPA says none exists | INFO | | OK; guard added |
| L-27 | AI wording | Recommendations are deterministic order-history counts; Ask Reco is rule-based; every page says "not a generative model" | INFO | | OK |
| L-28 | 404 and 5xx pages | One neutral sentence; no support promise, no claim | INFO | | OK |

## Details, evidence and proposed text

### L-01 Owner facts (BLOCKER, GATED)

Evidence: `npm run launch:check` on the unmodified branch reports 15 blockers; six are the unset values. `scripts/check-launch-blockers.php` blocker 1 lists `AICC_LEGAL_*` keys. The built pages carry 64 `data-pending` lines.
Proposed text: **owner supplies** (`docs/launch/owner-facts-batch.md`).

### L-02 Terms 28.1: court exclusivity has no value (BLOCKER, GATED)

Evidence: a standalone render of the four sources with every `AICC_LEGAL_*` value set (script kept in the evidence directory) leaves one "(pending)" in the Terms, in "The parties submit to the **(pending)** jurisdiction of the courts of ...". The placeholder `[EXCLUSIVE/NON-EXCLUSIVE]` is deliberately mapped to nothing (`substitute_placeholders`). Before this pass the gate told the owner to "set the legal values and re-seed", which can never work.
Done: the gate now says, when the configuration is complete, that the remaining markers are counsel-only and names them (test `run_launch_truth_tests.php`).
Decision: counsel chooses. Proposed English for each outcome (both replace the whole sentence in `terms-of-service.md` 28.1 and the three translations):
* "The parties submit to the exclusive jurisdiction of the courts of {JURISDICTION} for any dispute arising out of this Agreement."
* "The parties submit to the non-exclusive jurisdiction of the courts of {JURISDICTION} for any dispute arising out of this Agreement."
* or an arbitration clause (counsel).

### L-03 Privacy legal basis (BLOCKER, GATED)

`privacy-policy.md` sections 2 and 3 end with "**Legal basis**: [LAWYER REVIEW REQUIRED]", rendered as "(pending)". Proposed text: **counsel supplies**. Questions for counsel: which laws apply to the buyer (an Israeli company selling to businesses worldwide?), whether AICC is controller for account and billing data and processor for store data (DPA 1 says so as a working model), and whether a legitimate-interest basis is wanted for the abuse-prevention hashes.

### L-04 Subprocessor schedule is a pre-launch snapshot (BLOCKER, GATED)

Evidence (Privacy 6, DPA 8, Terms 18.1):

| Statement in the draft | Why it is a risk at launch |
|---|---|
| "Render: application hosting for the AICC Backend, currently used (production)"; "Neon: managed database, currently used" | UNKNOWN whether this is still true. The baseline records `api.copilt.org` at 139.59.157.231, a DigitalOcean Droplet, and the Backend infrastructure document says Neon reported an exhausted compute quota and a move to a self-hosted database is planned. The backend-cutover workstream owns the answer. |
| "DigitalOcean (Frankfurt, FRA1): standby, not used to process Merchant data today" | The Control Plane (website, accounts, checkout, order, billing and licence records) is public on DigitalOcean at launch (the staging host `aicc-cp-stage` is FRA1; the **production host and region are not decided**). From that day the sentence is false. |
| "We do not currently use ... any third-party email-sending service" | A transactional-email path is needed (licence key mail, receipts). Provider not chosen (email workstream). If it is a third party it is a subprocessor. |
| "[PAYMENT PROCESSOR] ... Not yet selected" | Becomes a self-contradiction when the processor is configured (L-05). |

Done: `check-launch-blockers.php` now treats these statements as blockers unless the owner attests `AICC_LEGAL_SUBPROCESSORS_VERIFIED=YYYY-MM-DD` (a real date, not in the future, at most 90 days old) after comparing the text with the live production configuration. An attestation leaves ATTESTED notes in the report so the statements stay visible.
Proposed replacement (table rows; wording is role-based so it stays true after the database move, but the bracketed parts must be re-confirmed and the document republished whenever they change, which the DPA already promises):

| Subprocessor | Function | Status |
|---|---|---|
| DigitalOcean | Hosting of the AICC website, account and checkout (Control Plane): purchase, licence and order records | In use |
| {BACKEND HOSTING PROVIDER(S) AT LAUNCH: owner supplies} | Hosting of the AICC Backend API | In use |
| {DATABASE PROVIDER AT LAUNCH: owner supplies; the same name as above if the database moves to the Droplet} | Database of the AICC Backend | In use |
| {EMAIL PROVIDER: owner supplies, or delete the row if mail is sent from the DigitalOcean host itself} | Transactional email (licence keys, receipts) | In use |
| {PAYMENT PROCESSOR: `AICC_LEGAL_PAYMENT_PROCESSOR`} | Payment processing for licence purchases | In use |

and replace the sentence "We do not currently use ... any third-party email-sending service ..." by a list of exactly the categories that remain unused, after the owner confirms them. Do not name a provider that has not been chosen.

### L-05 "Not yet selected" beside a configured processor (BLOCKER, GATED)

Status cell proposed: "In use for licence purchases". The gate fails whenever `AICC_LEGAL_PAYMENT_PROCESSOR` is set and any stored version still contains "Not yet selected"; the attestation of L-04 cannot clear it (tested).

### L-06 Hosting region and transfers (HIGH, OPEN)

Evidence: Privacy 7 and DPA 12 (CP) say "We have not yet fixed a production hosting region". The Site mirror (`legal.privacy.s.transfers.a`) says "We don't yet state a hosting region or a transfer mechanism ... Hosting region: {hostingRegion}"; `launch:check` REQUIRES `NEXT_PUBLIC_AICC_HOSTING_REGION`, so once the owner sets it the page reads "We don't yet state a hosting region ... Hosting region: Frankfurt". The CP has no region value at all.
Decision: either (a) state a region (then edit the text) or (b) keep saying none is fixed and drop the required Site value. Proposed Site/CP text for (a): "Hosting region: {hostingRegion}. We do not offer a choice of data location. {TRANSFER MECHANISM: counsel supplies, or 'We do not rely on a specific international-transfer mechanism'}". Wording that survives the database move: name the region of each hosted component, not of the database alone.

### L-07 Website and account cookies are not disclosed (HIGH, OPEN)

Evidence: the staging host answers `GET /my-account/?plan=solo` with `Set-Cookie: aicc_plan=solo; Max-Age=3600; Secure; HttpOnly; SameSite=Lax`. The language switch sets `aicc_lang` (1 year). Signing in, using the cart or the account area adds the standard WordPress and WooCommerce session, cart and login cookies (names to be confirmed from a live signed-in session; not captured here). The CP Privacy policy discusses only the two storefront cookies of the plugin; the Site policy says "This website doesn't use analytics, advertising or tracking scripts ... It stores your choices in your own browser: language cookie ..., accessibility settings". Once one domain serves both, the Site sentence is incomplete. (The gate already proves WooCommerce Order Attribution cookies are off.)
Proposed text for both policies, section "This website and your account": "The website sets a language cookie (aicc_lang, 1 year) and remembers accessibility settings in your browser. When you choose a plan before signing in, a cookie named aicc_plan (1 hour) remembers the plan. When you sign in or use the cart, WordPress and WooCommerce set the cookies they need to keep you signed in and to hold your cart (their names and lifetimes: {owner confirms from a signed-in session}). We do not use analytics, advertising or tracking cookies on the website."

### L-08 Ask Reco questions: sent or not sent (HIGH, OPEN)

Evidence: Site `/product/` (en) says "Your questions are answered in your WordPress admin and are not sent to AICC." CP Privacy 3.3 says "The questions an admin asks Ask Reco are sent to the Service so that they can be answered", and DPA 4 says ordinary Plugin-to-Backend communication still applies. Plugin source (`class-aicc-reco.php`): answers are produced locally by fixed rules ("no wp_remote_* call", "never forwarded to the Backend, never includes the question text"); the only code path that sends a short product phrase to the Backend is the optional market-signal layer, which is off by default (`AICC_Settings::is_trend_intelligence_enabled()` returns false unless a constant or filter turns it on).
Decision: the plugin owner confirms the shipped build; counsel aligns. Proposed CP text: "The questions an administrator types into Ask Reco are answered inside the WordPress admin by fixed rules and are not sent to AICC. (Only the conversation history shown on screen is kept, in the administrator's browser session storage.)" If the optional layer is ever switched on, the sentence must change first.

### L-09 Retention wording (MEDIUM, OPEN)

Evidence: public wording on 9 surfaces is "retention target up to 12 months after access ends; today nothing is deleted automatically". True today: the Backend retention sweep (`app/services/data_retention.py`, `POST /internal/jobs/run-retention-sweep`) is off (`data_retention_sweep_enabled=False`) and the Site fact file pins `retentionAutoDeleteToday: false`. The sweep's defaults are age-based per category (events 545 days), not "12 months after access ends", so activating it will make the text wrong in a different way. Deletion on request is a CLI run by an operator (`scripts/data_deletion_request.py`), consistent with "handled by hand".
Decision: owner chooses whether to activate before launch. No text change is needed while it stays off. If activated: replace "No automatic deletion exists yet" by the real schedule per category and update `facts.json` and the FAQ together.

### L-10 Enforcement mode behind "AICC stops working" (HIGH, OPEN)

Evidence: Backend `entitlement_enforcement_mode` defaults to `shadow` ("observe-only": decisions are recorded, nothing is denied); the cutover runbook says enforced mode is "not activated". The Terms, Refund policy, FAQ q63, pricing FAQ, and plan text say that after a refund, revocation, suspension or expiry "AICC stops on your stores". That is true only in `enforced` mode (or by the plugin's own entitlement refresh, which was not re-verified here). The Terms source carries the disclosure as `[PRE-LAUNCH BLOCKER ...]` (16.2); the renderer removes every `[PRE-LAUNCH ...]` bracket, so the published page would simply not carry it.
Decision: owner (the open "production enforced mode" decision). If enforced at launch: no text change. If `shadow` at launch: do not publish the stop-working sentences as facts. Proposed replacement for FAQ q63 first sentence and the Refund 4 / Terms 17.3 statements: "After a full refund the plan is revoked. AICC's access to your stores is switched off as the revocation reaches them." and add to Terms 16.1: "Suspension takes effect when the suspension reaches the Service." Backend workstream confirms the actual mode.

### L-11 The 14-day money-back wording (FIXED)

Checked on 12 surfaces (Refund policy 1 to 3, Terms 4.4 and 17.3, Privacy-adjacent Refund data section, FAQ q26 to q30, q53, q54, q56, Pricing terms panel and plan cards, Home confidence line and final CTA, Product page, CP plan cards and home, checkout strings, order-received strings): every one says the guarantee is on the **initial** plan purchase, runs 14 days from payment received and plan issued, is not automatic for renewals, is asked for by email from the account email within the window, and is repaid to the original payment method where the processor allows. The exception was the card line and the home confidence line, which used the "first-purchase" phrasing: that reads as the first thing a merchant ever buys, a different promise.
Done: Site (4 locales) and CP (theme source, catalogue, 3 locales) now say "14-day money-back guarantee on your initial plan purchase"; the pricing panel heading "Try it" (it read as a trial) is now "Money-back guarantee". New rules `first-purchase-en` and `first-purchase-es` in `scripts/lib/launch-truth.mjs`; CP test `run_launch_truth_tests.php`.

### L-12 Larger plan and the guarantee (MEDIUM, OPEN)

The Refund policy gives the guarantee on "the initial purchase of a plan"; the Terms say a larger plan is "a separate purchase with its own 365-day term". Whether a larger plan carries its own 14 days is not stated, and the code refunds any full refund of an issuance order regardless of timing. Proposed (owner picks one):
* "Each plan you buy, including a larger plan bought later, has its own 14-day guarantee from the day that plan is issued."
* "The 14-day guarantee applies once per account, to its first plan. A larger plan bought later is not covered by it."

### L-13 Support promises with no mailbox behind them (HIGH, OPEN)

The documents promise a reply "within one business day" (service target), handling of deletion, export, rights and refund requests by hand, and accessibility reports. The support address is unset (`launch:check`: "merchants have nobody to write to") and `support@copilt.org` forwards only (email workstream). Proposed: do not publish the reply-time sentence until a named person answers the mailbox; keep "We aim to reply" only if true on launch day.

### L-14 Taxes (MEDIUM, OPEN)

Terms 4.3: "Fees are exclusive of applicable taxes unless stated otherwise. {VAT/TAX DETAILS IF REQUIRED}", rendering "(not applicable at this time)" while unset. The pricing page shows "$99 per year ... All prices are in US dollars (USD)" and does not mention tax. UNKNOWN whether the entity must charge VAT or issue a tax invoice, and whether any registration number is to be displayed (none is displayed anywhere today). Proposed pricing line once decided: "Prices are in US dollars and exclude any applicable taxes, which are added at checkout." (only if checkout really adds them). Owner and accountant decide; `AICC_LEGAL_VAT_DETAILS` is the optional field.

### L-15 Machine-translation disclosure vanished on approval (HIGH, FIXED)

Evidence: `LegalPage.tsx` showed the he/es/ru "draft translation, not reviewed by native speakers, English prevails" banner only while `LEGAL_DRAFT_NOTICE` was true, and that flag is false as soon as `NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=true`; `launch:check` also reported the translation blocker only when not approved. Approving the English text would have silently removed the disclosure.
Done: new switch `NEXT_PUBLIC_LEGAL_TRANSLATIONS_REVIEWED` (default off); the disclosure is independent of the English approval and of `NEXT_PUBLIC_LEGAL_DRAFT_NOTICE=off`; `launch:check` prints the state, fails if it is claimed without the English approval, and verifies the built he/es/ru legal pages carry it; `test:approved` asserts it on the approved build. The Control Plane banner was already independent of approval.

### L-16 Marketing pages in he/es/ru (MEDIUM, OPEN)

Only the legal pages and the accessibility statements disclose that the Hebrew, Spanish and Russian texts are drafts; home, product, pricing and questions do not, and nothing on them claims a review. Proposed footer line for non-English locales only (not implemented: it changes the approved layout): "This translation is a draft that has not yet been reviewed by a native speaker. If it differs from the English page, the English page applies."

### L-17 CP translation banner (LOW, OPEN)

Current CP text: "This is a draft translation. Hebrew, Spanish and Russian texts have not yet been reviewed by native speakers, and the legal drafts have not been reviewed by a lawyer." The last clause is false after approval. Proposed: delete it. Requires the string and its three translations; held back so it is changed together with the approval.

### L-18 Data and trust "What we haven't finalized" (FIXED)

The Site page kept the section saying the company details, support address, governing law, processor and hosting region "will be published before launch" after they were supplied. Now hidden when every value is set; `test:approved` asserts it is gone in all four languages. The CP page has no such section.

### L-19, L-20 (LOW, OPEN)

* Header "Draft last updated" and "Status: Draft" stay after approval (conservative, not misleading). Needs two new dictionary keys in four languages; do it with the approval.
* Site Privacy "Security": add "(the licence key is shown once and kept in plaintext for about 15 minutes on the account site, then only as a hash)" to match the CP policy.

### L-22 DPA decisions (MEDIUM, OPEN)

11.1 breach notice timeframe, 11.2 audit mechanism, 1 role characterisation, 9 return format: counsel. No text proposed.

### L-23 Accessibility (LOW, OPEN)

Both statements aim at WCAG 2.2 AA, make no conformance statement and cite no audit; both say no screen-reader testing was done; neither claims a national law. The coverage sentence ("every page in all four languages at a phone and a desktop width ... five widths ... automated keyboard tests") is dated 2026-10-20. The automated suites were re-run on this branch (see the end); the date itself is the owner's statement and was not changed.

### Items verified OK (INFO)

* **Checkout acceptance (L-24)**: one required checkbox ("I confirm that I am purchasing AICC for business use ... I have read and agree to the Terms of Service, Privacy Policy, Refund Policy and Data Processing Addendum"); the order stores version and hash (Privacy 2). No IP address is stored for it.
* **Structured data (L-25)**: Site JSON-LD has Organization (name, url, logo; no address, phone, rating), SoftwareApplication without `offers`, BreadcrumbList and FAQPage; `seo:check` fails any Offer/price schema (negative control fires on 3 of 3 mutants). `NEXT_PUBLIC_AICC_STRUCTURED_OFFERS` is unset (OFF) and `launch:check` fails if it is on without a real gateway. The CP switch `AICC_STRUCTURED_DATA_OFFERS` defaults OFF; the CP gate now also fails if it is on without an allow-listed gateway (test). Nine FAQ answers flagged for legal review are left out of FAQPage until approval.
* **Certifications, security (L-26)**: the only occurrences are denials (the DPA says no independent third-party security attestation exists; the accessibility statements say there was no third-party audit). "HTTPS/TLS in transit" is stated; storage encryption is stated nowhere and is now banned because it is not verified for any provider. Three new rules in `scripts/lib/launch-truth.mjs` guard these claims.
* **AI wording (L-27)**: FAQ q42 and q02, the Product page and Terms say fixed rules, no generative model, no per-shopper profile; Ask Reco "is not a chatbot"; Merchant Insights "not written by an AI". Matches the plugin (rule-based, `no LLM` in `class-aicc-reco.php`) and the Backend (pair counting). The name "AI Commerce Copilot" is the brand.
* **Provider names**: no payment gateway, email provider or analytics vendor is named in any public copy. The only named infrastructure providers are in the CP Privacy and DPA tables (L-04).
* **Prices and terms** (Solo $99/1, Studio $199/3, Agency $499/10, USD, 365 days, manual renewal, no recurring billing): identical on the Site (`pricing:check`), the CP bootstrap, the Terms 3 and 4, the Refund policy, FAQ, the cards, JSON-LD (none) and the order strings. `content:check` fact-consistency and CP `run_content_consistency_tests.php` (371 checks) pass.

## Fail-closed behaviour of the consumers

| Missing | Site `launch:check` | CP `check-launch-blockers.php` |
|---|---|---|
| any of the six facts | blocker per value (6) plus "support email unset" | blocker 1 lists the missing `AICC_LEGAL_*` keys; stored versions with "(pending)" are blockers |
| counsel-only markers with a complete configuration | n/a | blocker names them as counsel-only (new) |
| legal approval | blocker (and 3 more lines) | blocker 2 |
| he/es/ru native review | note; disclosure stays published; blocker if claimed without approval (new) | note |
| subprocessor/infrastructure statements | not readable here (printed as a CP precondition) | blocker unless `AICC_LEGAL_SUBPROCESSORS_VERIFIED` (new) |
| payment processor | blocker unless on the real-gateway allowlist (empty) | blocker unless on `AICC_LAUNCH_REAL_GATEWAYS` (empty); "Not yet selected" contradiction (new) |
| structured offers on early | blocker | blocker (new) |
| a published build with sentinel values | blocker | n/a |

Both gates are report-only until `--strict` / `AICC_PRODUCTION=1`. The pending values are never filled with a guess: unset values render one muted line or a visible "(pending)" marker, and the checks above find them in the built output and in the stored legal versions.

Remaining weakness (not closed): the two surfaces take the same facts from two configurations (Site build environment, CP constants). Nothing compares them, so they can drift (for example different support addresses). Set both from the same source and re-run both gates; a cross-check was not built because the CP values are not readable from the Site build.

## Checks run on this branch

Site `launch/legal` (see the commit list in `REPORT.md`): lint (0 errors, 3 pre-existing warnings), tsc, copy:check, content:check (also with `--cp` against the CP worktree), i18n:check and strict, fbt:audit, pricing:check, brand:check, tokens:check, lang:check, density:check, contrast:check, seo:check, test:links, test:interaction, test:approved. Control Plane: the whole suite plus the new `run_launch_truth_tests.php`.
