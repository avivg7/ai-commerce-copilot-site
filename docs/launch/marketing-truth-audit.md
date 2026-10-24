# Marketing truth audit (WS11)

Audit date 2026-10-22. Scope: every call to action and claim on the built Site (English, Hebrew, Spanish, Russian: 39 pages extracted from `out/`) and the Control Plane pricing, account, cart and checkout surfaces, against the **actual launch state**: WooCommerce is the only live platform, no payment gateway is configured, the plugin has no distribution route, support email is forwarding only, the legal texts are unapproved drafts, he/es/ru are machine drafts.

The approved conversion pass was not touched: H1 "Turn every shopper journey into a smarter selling opportunity.", the subheadline, CTAs, section order and widget mock are unchanged.

## Verdict in one paragraph

The copy is already unusually honest: no free offer, trial, customer counts, logos, customer quotes, measurable lift, other-platform support or directory-install wording exists in any of the four languages, and every sample number is labelled as sample data. Two wordings blurred the offer and were fixed (the guarantee line on the plan cards, and a panel heading that read as a trial). The remaining launch-day risks are not copy at all: (1) the plan buttons lead into an account and then a checkout that cannot take payment (the gate that stops this from being published works, but the interim behaviour is untidy), (2) "Available for WooCommerce" and "install and activate the plugin" have no way to obtain the plugin behind them, (3) two public pages disagree about whether Ask Reco questions leave the store, (4) the legal drafts describe the pre-launch infrastructure. Items 3 and 4 are in `legal-readiness.md` (L-08, L-04); item 2 is a known distribution blocker.

## Claim-by-claim

| Claim or CTA | Where | Verdict | Evidence / action |
|---|---|---|---|
| "Get started", "Sign in" | header, hero, every CTA band, 4 languages | TRUTHFUL | They open `/my-account/` (sign in or register). No payment promise. |
| "Choose Solo / Studio / Agency" | pricing page, home cards, CP plan cards | TRUTHFUL ONLY WITH A GATEWAY | see "What the plan buttons do today" below. `launch:check` blocks the Site build while no processor is configured (48 `?plan=` links reported). |
| Free-start CTA, trial, free offers, card-free signup | everywhere | ABSENT | `copy:check` bans these in 4 languages; the new `free-plan` rule adds free-of-charge wording attached to a plan, tier, version, download or install. The word "free" next to "slot" (a store slot) is correct. |
| "Try it" (pricing panel heading) | Site `pricing.terms.try.title`, CP `pricing.php` | FIXED | read as a trial. Now "Money-back guarantee" in 4 languages and the CP catalogue. |
| Guarantee line on the plan cards and the home confidence line | plan cards, home | FIXED | it promised the guarantee on the merchant's "first-ever purchase", a different promise from the initial purchase of a plan. Now "initial plan purchase" everywhere (Site 4 locales, CP source, catalogue). |
| 14-day wording elsewhere | Refund policy, Terms 4.4, FAQ q26 to q30, q53, q54, q56, pricing panel, CTA bands, checkout and order strings | CONSISTENT | same four facts on every surface: initial plan purchase; 14 days from payment received and plan issued; not automatic for renewals; refunded to the original payment method where the processor allows. See `legal-readiness.md` L-11. |
| Prices and terms | 4 locales, Terms, Refund, FAQ, CP bootstrap, order strings | CONSISTENT | `pricing:check`: Solo $99/1, Studio $199/3, Agency $499/10, USD, 365 days, renewal manual, "never renews automatically", "keeps no authorization to charge you again". Spanish shows `US$`, Russian adds "(USD)". |
| Recurring billing, automatic renewal | all | ABSENT / DENIED | every occurrence is a denial. The new `recurring` rule fails an un-negated claim in public copy. |
| Customer counts, logos, customer quotes, endorsements, awards | all | ABSENT | `copy:check` already banned the endorsement and invitation phrases; the new `social-proof` rule covers counts, crowd claims, quotes and customer write-ups. |
| Measurable lift, AOV, conversion claims | all | ABSENT | existing bans on percentage results, revenue-increase promises and result boasts; the dashboard text says "association, not proof it caused them" and "AICC doesn't run a control group". The sample dashboard figures (3,860 views, 6.2% click rate, $1,312) sit in panels labelled "Sample data: not from a real store". |
| Other e-commerce platforms | all | ABSENT | built text contains no platform name; FAQ q64 says "No other platform is supported or announced". New rule `other-platform` bans naming any, even as roadmap. |
| WordPress.org / plugin-directory install | all | ABSENT | new rule `wordpress-org` (public copy). "install and activate the AICC plugin" is neutral. |
| "Available for WooCommerce" (eyebrow, footer, Terms) | home hero, many pages | TRUE AS SCOPE, MISLEADING ON DAY ONE IF NO ROUTE EXISTS | AICC is built for and only works on WooCommerce; but a buyer cannot yet obtain the plugin (no download route, no `/get-started/`, not on WordPress.org: launch blocker "plugin distribution path not available"). Owner-approved wording left unchanged; the distribution workstream closes it. |
| AI claims | home, product, FAQ q42, q02, Terms, widget mock | TRUTHFUL | "fixed rules, not a generative model", "no per-shopper profile", "same data gives the same result", Merchant Insights "not written by an AI", Ask Reco "is not a chatbot". Matches the plugin (rule-based, no LLM) and the Backend (pair counting). "Powered by AI Commerce Copilot" in the widget mock is the product name. |
| Ask Reco | home, product, FAQ | TRUTHFUL EXCEPT ONE SENTENCE | boundaries are exact (fixed rules, never changes settings, merchants only, English and Hebrew, short text box plus chips). The sentence "Your questions ... are not sent to AICC" contradicts the CP Privacy policy: see L-08. |
| Widget screenshots and mocks | home, product | LABELLED | "Illustration with invented sample products, not a real store.", "Sample data: not from a real store", "Illustration with sample numbers". The heading limitation ("the widget heading is the same for fallback products as for learned ones") is disclosed on Home, Product and FAQ. |
| Demo video | Watch demo (modal) | NO CLAIM FOUND IN THE TRANSCRIPT | the VTT transcript contains no number, result, customer or platform claim; it says checkout stays WooCommerce and the store keeps selling if the service is down. The text burned into the video picture was NOT machine-reviewed (no working ffmpeg); the hash is pinned (`docs/approved-demo.sha256`). Narration and captions are English in every language and the accessibility statement says so. |
| "Tested with Storefront and a block theme", "declared minimums WordPress 6.0, WooCommerce 7.0, PHP 7.4, HPOS" | home, product, FAQ | SUPPORTED | plugin header: Requires at least 6.0, Requires PHP 7.4, WC requires at least 7.0, WC tested up to 10.9; test evidence in `docs/claims-inventory-content-pass.md`. |
| "Placing an order never waits on AICC", "checkout doesn't wait on it" | home, product, FAQ, Terms | SUPPORTED | claims inventory (order sync queued; handlers fail-soft). Not re-tested here. |
| Support | footer (CP), 404, pricing ("Contact support"), FAQ, legal | PENDING | the support address is unset, so every "write to support" sentence ends with "Support details will be published before launch." (muted line). The Site footer has no support link. Known blocker; email workstream. |
| 404 and 5xx | Site 404, edge 5xx | TRUTHFUL | "The link may be old or mistyped. Your store was not affected." / "AI Commerce Copilot is temporarily unavailable. Please try again shortly." No support promise. |
| Structured data | all | TRUTHFUL | no Offer, price or rating; see `legal-readiness.md` L-25. |

## What the plan buttons do today (investigation)

Question: "what does the pricing page's Get started / Choose Studio do when no gateway exists?" Observed on the staging host `stage.copilt.org` (read-only GETs) and from the source:

1. Site `pricing` buttons (and CP plan cards) link to `/my-account/?plan=<solo|studio|agency>` (`planUrl()`); the CP route `class-aicc-lm-plan-intent.php` validates the plan, sets a one-hour cookie `aicc_plan` (`Secure; HttpOnly; SameSite=Lax`, observed on stage), shows a note naming the plan on the sign-in page, and after sign-in or registration redirects to checkout with that plan in the cart.
2. On the staging host WooCommerce "Coming soon" is on: `GET /checkout/` answers 302 to `/cart/`, and `/cart/` renders the stock WooCommerce coming-soon text, "Great things are on the horizon. Something big is brewing! Our store is in the works and will be launching soon!", inside the AICC chrome with a "Back to pricing" link. The footer on that page also shows "Support details will be published before launch."
3. With "Coming soon" off and no gateway, WooCommerce would instead say that no payment method is available; the CP gate (`check-launch-blockers.php`) treats every enabled non-allow-listed gateway, any QA placeholder (Direct bank transfer) and a closed store next to a real gateway as blockers.

So today a visitor who clicks "Choose Studio" creates an account and then reaches a generic "store is in the works" page. Nothing pretends a payment can be made, but the pricing page promises more than the next click delivers. This is gated: `launch:check` fails the Site build while `NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR` is unset, naming the plan buy links, and the CP gate carries the coming-soon notice. At launch both switches flip together (gateway allow-listed, coming-soon off), after which the path is: choose plan, sign in or register, WooCommerce checkout, pay, licence, connect.

**UPDATE 2026-10-24 (round 3): implemented as the pre-commercial state, see `docs/cutover/pre-commercial.md` (one fail-closed switch `AICC_COMMERCE_OPEN`, plan buttons that say "Purchases open soon", registration/cart/checkout closed, calm "to be confirmed" statements, and the public-truth gate).**

**Proposed minimal truthful behaviour for any period in which pricing is public but checkout is not** (not implemented: it changes the payment gate that the payments workstream owns, it is not clearly wrong in the launch state, and it needs an owner decision on whether to publish before the gateway exists):

* keep the three prices (they are true);
* while the gateway is not live, label the three buttons "Create account" (no `?plan=`), and add one sentence under the cards: "Checkout is not open yet. Create your account now; you will choose and pay for a plan here when it opens." (and the same in he/es/ru);
* replace the WooCommerce coming-soon wording on the CP cart and checkout with one truthful sentence and a link to the pricing page. The switch should be one existing fact: coming-soon is on, or no allow-listed gateway is enabled;
* nothing else changes: Get started and Sign in stay as they are.

## What was fixed (small copy truth fixes, each with a test)

| Fix | Repo / commit | Test |
|---|---|---|
| Plan-card and home-line guarantee wording corrected to "initial plan purchase" (en, he, es, ru) | Site 9342d2b; CP 3ccc501 | `copy:check` rule `first-purchase-en/es`; `content:check` (also rendered pages); CP `run_launch_truth_tests.php` (catalogue scan) |
| Pricing panel "Try it" to "Money-back guarantee" (en, he, es, ru) | Site 9342d2b; CP 3ccc501 | `copy:check` rule `try-it-title`; CP catalogue scan |
| Brand strings re-synced into the CP theme (the generated `strings.json` was stale against the conversion pass) | Site f4da242; CP 3ccc501 | `brand:check`; CP `run_brand_kit_parity_tests.php` 125/125 |
| he/es/ru machine-translation disclosure no longer vanishes on English approval | Site 462f08b | `launch:check` (built output), `test:approved` |
| Data and trust "What we haven't finalized" hidden once every owner value is supplied | Site d67d381 | `test:approved` |
| New shared truth rules (`scripts/lib/launch-truth.mjs`): the wrong guarantee phrasing, a trial-like heading, WordPress.org install wording, other platforms, free offers, attestation and storage-encryption claims, privacy-law badges, invented social proof, un-negated recurring billing | Site 9342d2b | self-test inside `copy:check` and `content:check` (every bad sample caught, every honest sample passed) |
| Launch gate fails on pre-launch infrastructure statements, on "Not yet selected" beside a configured processor, on structured offers without a real gateway, and explains counsel-only markers | CP cb40229 | CP `run_launch_truth_tests.php` (44 checks) |

No existing rule was weakened or removed. One rule is stricter than before: naming another platform is banned even with "coming soon".

## Observations that are NOT fixed (owner or other workstream)

* **M-A (HIGH if published early)**: pricing buttons into an unusable checkout; proposed behaviour above.
* **M-B (MEDIUM)**: "Available for WooCommerce" and "install and activate the AICC plugin" with no route to obtain the plugin.
* **M-C (LOW)**: FAQ q53 is titled "Can I try AICC without committing to automatic renewal?" and answers with a paid plan plus the money-back guarantee. "Try" can hint at a trial. Suggested question: "Do I have to commit to automatic renewal?" The FAQ file is shared and byte-synced, so change it once with the owner's approval.
* **M-D (LOW)**: the storefront widget heading and the sentence "Customers often purchase these products together" also appear over fallback products. It is disclosed on Home, Product and FAQ; the owner's open decision is whether to change the plugin heading.
* **M-E (LOW)**: the demo narration and captions are English on every language page; disclosed only in the accessibility statement, not next to the button.
* **M-F (MEDIUM)**: he/es/ru marketing pages carry no visible machine-draft disclosure (see `legal-readiness.md` L-16).
* **M-G (INFO)**: the hero's "helping shoppers discover more" is an unmeasured soft outcome statement in the owner-approved text; no number is attached. Left unchanged by instruction.

## Checks run

Site `launch/legal`: lint (0 errors, 3 warnings that exist on the base commit), `tsc`, `copy:check` (71 + 11 rules), `content:check` (also `--cp` against the Control Plane worktree), `i18n:check` and `i18n:strict`, `fbt:audit`, `pricing:check`, `brand:check`, `tokens:check`, `seo:check`, `test:links`, `lang:check`, `density:check`, `contrast:check`, `test:interaction` (373 checks), `test:approved`, `axe:check` (reduced run: en, home plus pricing, 1280 and 390 px, 3 modes, 12 scans, 0 violations; the full 150-scan run was started and stopped after about 16 minutes without a result, so it is not claimed), `launch:check` (report-only: the known blockers remain). Served with `node scripts/serve-out.mjs --port 3411` and `AICC_BASE_URL=http://localhost:3411` (the owner's 3011 was left alone). `test:visual-contract` was NOT run: it compares against the live legacy site www.copilt.org, which this workstream must not touch, and needs the normal QA Control Plane on 8982; this pass changed one text line and two headings (geometry is unaffected). Control Plane: full suite plus the new `run_launch_truth_tests.php`.
