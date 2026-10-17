# Claims inventory: content pass (English)

Every public product claim on Home, Product, Pricing, Questions and Data & Trust, with its evidence. Written for the owner and for whoever changes the copy next:
before a sentence changes, find its row; if the evidence changes, the sentence changes with it.

**Evidence key**

* `§N` = section N of the verified capability sheet (the code at the accepted commits; plugin `PL` = `cp2a-14-readiness-independence @ cd3b41b`, backend `BE` = `cp2a-6-prelaunch-commercialization @ 7b45923`, control plane `CP`).
  File:line references are the ones recorded there. The sheet also lists the "DO NOT SAY" wording that this copy avoids.
* `facts` = `brand/content/facts.json` (plans, term, windows, limits). `content:check` compares every figure in the English copy with it.
* `FAQ` = `brand/content/faq.en.json` (owner-approved schema 2). Its wording is canonical; this inventory only maps it to evidence.

**Status key**: SUPPORTED (code evidence) · POLICY (a commercial or legal decision, not code) · DEMO (an illustration; invented sample data, labelled "Sample data: not from a real store") · PENDING (the copy follows the owner addendum, the code at the accepted head does not yet do it) · OWNER (owner-supplied wording; see the note).

**Automated guards**: `npm run content:check` (banned claims, UK spellings, fact consistency, FAQ integrity, no "never paste", no counts, no apologetic phrasing outside legal pages, rendered pages, page titles and descriptions), `npm run copy:check`, `npm run pricing:check`, `npm run i18n:check`, `npm run fallback:check`.

---

## Home

| Section | Claim as published | Evidence | Status |
|---|---|---|---|
| Hero | AICC learns which products customers really buy together from your WooCommerce orders and shows them on product and cart pages | §1 pair learning from completed and processing orders (`BE app/services/recommendation_engine.py:29,64`); §9 product and cart page only (`PL class-aicc-widget.php:100-126,80`) | SUPPORTED |
| Hero | In your WordPress admin you get a dashboard, controls and a guide | §2 dashboard, §3 merchant controls, §5 Ask Reco | SUPPORTED |
| Hero | It stays out of your checkout's way / Your checkout stays independent of AICC | §8: order sync is queued (`PL class-aicc-orders.php:417-426`), checkout hooks wrapped in `AICC_Fail_Soft::attempt` (`:114-236`). Never claims "no network call at checkout" (not literally true, §8) | SUPPORTED |
| Hero | Learned from your own orders | §1 | SUPPORTED |
| Hero | You control what gets recommended | §3: pin, exclude, prefer, deprioritize (`BE app/recommendation_policy.py:410-470`). Narrower than "full control" (§3 DO NOT SAY), which is why the page also says prefer and deprioritize only nudge one place | OWNER (supported for individual products; see report) |
| Hero | Plans from $99 a year · 14-day money-back guarantee on your first purchase · No automatic renewal | facts (plans, `moneyBackDays`, `renewal: manual`); §11 (`CP scripts/bootstrap-commercial-products.php:76-107`); §14 ("Renewal is manual: nothing is charged automatically", `PL class-aicc-settings.php:6609-6623`) | POLICY |
| Loop strip | Store data, relationships, recommendations, measurement, insight, control, learning | Each step maps to a section of this table (§1, §6, §2, §4, §3, §7). No autonomy claim | SUPPORTED |
| Demo | WooCommerce can tell which products share a category; AICC adds which products customers actually buy together, with sensible fallbacks where history is thin | §1: tiers `fbt`, `same_category`, `newest` (`BE app/services/legacy_recommendations.py:134,175,199`) | SUPPORTED |
| Demo | Product names, prices, counts, the add-to-cart total, "Bought together 48 times" | Invented sample data, labelled; the label wording "Bought together N times" is the real Recommendation Preview string (§1, `PL assets/js/admin-sync.js:358-366`); "Same category — no purchase history yet" is the real fallback wording | DEMO |
| Demo | No Strong/Medium/Light tiers | They do not exist in the product (§1, §A item 4); removed | SUPPORTED |
| Why | WooCommerce related products match by category and tags | WooCommerce core behavior; hand-picked per product is also possible (not claimed away) | SUPPORTED |
| Why | A grinder and a bag of coffee beans can sit in different categories and still go into the same basket | Illustrative example, stated as possible, not as a measured result | DEMO |
| Why | Counts completed and processing orders; lists most frequent partners first | §1 `ELIGIBLE_STATUSES = ("completed","processing")`, `pair_count DESC` (`:134`) | SUPPORTED |
| Why | Remaining spots: same category, then newest in-stock | §1 tiers 2 and 3, all tiers exclude deleted and out of stock; same-category order is "most recently updated" (§1 CORRECTION), the copy says only "from the same category" | SUPPORTED |
| Workspace / Understand | Views, clicks, bundle add-to-carts, last 30 days; orders and revenue associated with the widget; Recommendation Preview with "Bought together N times" | §2 (fixed 30 days `:536`; "Recommendation Views/Clicks/Click Rate", "Bundle Add-To-Carts", Recommendation Preview `:9257`). Labels shown are the planned "Associated ..." names (the plugin still says "AI Assisted ..."; see report) | SUPPORTED / PENDING label rename |
| Workspace / Understand | Association, not proof of cause | §6 (association only; no control group) | SUPPORTED |
| Workspace / Control | Pin, prefer, deprioritize, exclude; exclude always wins; rules can target one pair or a product everywhere, can expire; out-of-stock and deleted stay out even when pinned | §3 (`BE app/recommendation_policy.py:256-285,410-470`; UI `PL class-aicc-settings.php:9445-9571`); rule demo semantics in `brand/js/rules-core.js` | SUPPORTED; the interactive list is a DEMO |
| Workspace / Find opportunities | Plain-English observations: top sellers, strong bundles, products added to cart often but bought less, recommended products that get clicks; at least 10 orders; fixed rules, not a generative model | §4: four types, `MIN_PURCHASES = 10` (`BE app/routers/insights.py:39`), "10 orders" not "10 purchases" (§4 gate CORRECTION). The cards are sample content. "Top Recommendation" is the sheet's UI label for the fourth kind (`PL :12864`) | SUPPORTED; cards are DEMO |
| Workspace / Ask Reco | Answers common questions about setup, performance, next steps from your dashboard data, in English or Hebrew; fixed rules, not generative AI; never changes your settings; shoppers never see it | §5 (`PL class-aicc-reco.php:19,61,210,470`; wp-admin only) | SUPPORTED; the Q&A is a DEMO |
| How it works | Connect from the AICC screen in WordPress; normally no license key to paste, no code to write | `CP` connect flow (content-source.md shared decision); FAQ q08, q14 | POLICY |
| How it works | Syncs your catalog in the background; import of up to 24 months of past orders is optional; timing varies | §12 (catalog sync auto-starts from the dashboard or cron, no duration provable). **Optional import: §7 says the import STARTS AUTOMATICALLY at the accepted head** | SUPPORTED (sync) / PENDING (optional import, owner addendum L) |
| Safety | Placing an order never waits on AICC; queued and sent in the background | §8 (`PL class-aicc-orders.php:417-426`, `class-aicc-tracker.php:220-224`) | SUPPORTED |
| Safety | If AICC or its servers are slow or down, the widget hides; native related products and cross-sells come back | §8 steps 1-3 (`PL widget.js:1656-1683`); conditions (JavaScript, default setting) are stated on Product and in the flow note | SUPPORTED |
| Safety | If your plan isn't active: no widget, no script, no new cookies | §8.4 and §14 (`PL class-aicc-commercial-gate.php:83-85`) | SUPPORTED |
| Safety | AICC doesn't edit your products, prices or templates; deactivate and native recommendations return; tested with Storefront and a block theme | §8, §9, §15 (Storefront classic and Twenty Twenty-Five block theme, `docs/stage6-known-conflict-registry.md`) | SUPPORTED |
| Safety flows | Order placed → queued → sent in the background; AICC down → widget hides → native products return | §8; kit markup `.aicc-flow` | SUPPORTED |
| Pricing | Every plan has widget, dashboard and insights, rules, Ask Reco and an optional import; priced by store count; Solo $99 / Studio $199 / Agency $499; AICC never renews automatically | facts; §11 (every plan has every feature); §14. Optional import: see PENDING above | POLICY / PENDING |
| FAQ | The seven selected answers | See the Questions table | |
| Final CTA | Your initial plan purchase includes a 14-day money-back guarantee; the 14 days start when payment is received and your plan is issued; see the Refund Policy | facts (`moneyBackStartsAt`); CP refund policy. Exceptions deliberately not listed on sales surfaces (owner addendum J) | POLICY |

## Product

| Section | Claim as published | Evidence | Status |
|---|---|---|---|
| Shopper experience | FBT widget on product pages and the cart page; product page starts with the viewed product ticked; cart starts from the first item; one step to add the bundle; adapts from phone to desktop; follows theme direction; up to five products | §9 (`PL class-aicc-widget.php:100-126,80,1905,1334`; `docs/widget.md`; RTL `:2055`) | SUPPORTED |
| Shopper experience | Not on the home page, category or checkout; hides rather than guess on an unusual theme | §9 (Tier D hidden). The cart-exclusion sentence is removed (§9 CORRECTION) | SUPPORTED |
| How it learns | Four stages: learned from your orders, same category, newest in stock, your rules last | §1; rules last at `BE recommendations.py:286` | SUPPORTED |
| How it learns | Every recommendation can be explained: counting your orders, no generative model, no per-shopper profile; same data, same result | §1 ("No ML, no LLM, no personalisation, deterministic") | SUPPORTED |
| Thin history | Spots filled from the same category then newest; real co-purchases take over as orders come in | §1; §12 (fallbacks need only a synced catalog and at least 2 in-stock products, `class-aicc-onboarding.php:410`) | SUPPORTED |
| Thin history | The widget heading is the same for every item; Recommendation Preview shows counts for learned partners only | §1 "Widget heading is static" (`PL widget.js:413`) | SUPPORTED |
| Thin history | Sample slots (two learned partners, then fallbacks) | Invented numbers, labelled as an illustration | DEMO |
| Dashboard | Recommendation views, clicks, click rate, bundle add-to-carts, last 30 days; associated orders (24 hours) and revenue; Merchant Insights; Recommendation Preview; CSV export for 7, 30 or 90 days; readiness is setup readiness, not a sales measure | §2 (`PL :6421-6427,10830-10832`; `BE app/routers/analytics_export.py:200-215`) | SUPPORTED |
| Dashboard | "Recommendation views" counts product impressions, not page views | §2 Impressions CORRECTION: the copy says "recommendation views" and never "widget views" | SUPPORTED |
| Controls | Four rules with exact semantics; pair-specific or everywhere; optional expiry and internal note; no rules by category; out-of-stock and deleted stay out even when pinned; prefer/deprioritize never cross a group; only pin forces a position | §3 (`BE app/recommendation_policy.py:288-408`) | SUPPORTED |
| Ask Reco | Can: readiness, why recommendations aren't showing, reading metrics, bundle opportunities and catalog health, next step with links. Can't: open-ended questions or copy, change settings, shopper-facing, other languages (English and Hebrew) | §5 capability list and DO NOT SAY | SUPPORTED |
| Measurement | Views, clicks, bundle add-to-carts; order associated if bundle added and bought within 24 hours; full order total; needs consent; association not causation; not measured: uplift, view-through, no-consent orders, pre-connection orders, cross-device | §6 (`BE app/attribution_utils.py:20,204-213,280`; `PL class-aicc-consent.php:44-90`) | SUPPORTED |
| Safety | Flow diagrams; default setting and JavaScript conditions; failures that stop PHP itself are outside what any plugin can intercept; declared minimums WordPress 6.0, WooCommerce 7.0, PHP 7.4; HPOS compatible; disconnect first to free the slot | §8 (limits), §15 (`PL ai-commerce-copilot.php:3-15,50-55`), §11 | SUPPORTED |
| Past orders | After connecting AICC offers to import up to 24 months; optional; skipping starts with fallbacks; nothing sent until you choose; start later from the dashboard; doesn't change orders; no duplicates; cancel from the dashboard; returning merchants who opted in are caught up, "Not now" is never imported without asking; never invents impressions, clicks or revenue | §7 supports the 24-month window, "does not modify WooCommerce orders" (no `update_meta` in `class-aicc-historical-backfill.php`), dedupe (`BE app/models.py:291`), cancel, returning-merchant reconcile (`class-aicc-returning-merchant.php`), no fabricated events. **§7 also says the start is automatic at this head and there is no opt-out setting: the opt-in is owner addendum L** | PENDING (plugin must ship the opt-in before this copy is published) |
| Past orders | AICC can preserve your store history when access pauses, so returning merchants can continue instead of starting from zero | §10 (Backend deletes nothing automatically; retention sweep off, `BE app/config.py:475`); §7 returning merchants. Current behavior only; target policy is stated separately on Data and trust | SUPPORTED |
| More stores | 1 / up to 3 / up to 10; what counts as a store; disconnect frees the slot; no transfer fee; larger plan is a separate purchase with its own 365-day term, no credit | §11 (`PL class-aicc-api-client.php:396`; `CP docs/cp2a22-multistore-licensing.md`); facts `largerPlan` | SUPPORTED |
| Comparison | Table: category and tags, or hand-picked per product, versus AICC rows (what you can see, control, explainability, guidance, history, failure) | WooCommerce core behavior; AICC rows from §1-§5, §7, §8. "Explainability: Not applicable" for WooCommerce is a fair statement, not a criticism | SUPPORTED |
| Current scope | No per-shopper personalization; not an upsell engine; no home, category or checkout widget; Ask Reco merchant-facing, rule-based, English and Hebrew; same heading for fallback items; bundle button can't add products that need an option choice; admin English and Hebrew | §1, §5, §9 (variable products: `add_to_cart($pid, 1)` has no variation, WooCommerce refuses a variable parent, `class-wc-cart.php:1155-1158`), §13 | SUPPORTED (variable-product wording: see report) |
| Languages | Website four languages; admin and Ask Reco English and Hebrew; widget English and Hebrew in full plus core labels in six languages | §13 | SUPPORTED |

## Pricing

| Claim as published | Evidence | Status |
|---|---|---|
| Solo $99 for 1 store, Studio $199 for up to 3 (recommended for 2 to 3), Agency $499 for up to 10; US dollars | facts `plans`; §11 (`CP scripts/bootstrap-commercial-products.php:76-107`); `npm run pricing:check` | POLICY |
| Every plan has the full product; plans differ only by store capacity | §11 ("plan string is never branched on in Backend/Plugin") | SUPPORTED |
| Included: recommendations from your orders, FBT bundle on product and cart pages, dashboard, rules, observations, Ask Reco, optional import of up to 24 months, website in four languages, fail-soft design | §1, §9, §2, §3, §4, §5, §7 (optional: PENDING), §13, §8 | SUPPORTED / PENDING (import) |
| Fixed 365-day plan. Renewal is manual. AICC never renews your plan automatically. No stored payment authorization | facts `termDays`, `renewal`, `recurringBilling: false`; §14 lifecycle copy | POLICY |
| Renewal adds 365 days to the later of today and the current end date | facts; `CP` renewal logic | POLICY |
| 14-day money-back guarantee on the initial purchase; starts when payment is received and the plan is issued; see the Refund Policy | facts; CP refund policy (the exceptions list is a Control Plane legal-page task, not repeated on sales surfaces) | POLICY |
| Store slots: staging and production separate, www and non-www, http and https separate; disconnect frees the slot; no transfer fee; larger plan is a separate purchase | §11 | SUPPORTED |
| Coming back: expired → renew the same plan, stores return; refunded → buy a new plan, connect the same store; AICC can recognize it if the store kept its connection; history can be preserved | §14, §7, §10 | SUPPORTED |
| Plan finder suggestion (1 → Solo, 2 to 3 → Studio, 4 to 10 → Agency) | `src/data/plans.ts`, `npm run pricing:check` | POLICY |

## Data and trust

| Claim as published | Evidence | Status |
|---|---|---|
| Short version: AICC needs the product catalog, order relationships (products per order, totals, currency, billing country, hashed email identifier) and optional shopper activity if your cookie consent tool allows statistics | §10 (`PL class-aicc-catalog.php:849-952`, `class-aicc-orders.php:314-382`; order sync is not consent-gated) | SUPPORTED |
| AICC does not receive raw emails, names, phone numbers, street addresses, payment details, shopper IP addresses | §10 ("Not sent: name, raw email, phone, street/city/postcode, IP, payment data") | SUPPORTED |
| Pseudonymous, not anonymous | §10 DO NOT SAY "anonymous" | SUPPORTED |
| Catalog list now includes SKUs and product links | §10 (the old list omitted SKU, link and cross/up-sell ids) | SUPPORTED |
| Past orders from up to the last 24 months, only if you choose to import them | §7; optional import is owner addendum L | PENDING |
| Cookies `aci_vid` 1 year, `aci_sid` 30 minutes, only with an active plan, tracking on and consent granted for statistics; none without a consent plugin | §10, §6 (`PL class-aicc-visitor.php:18-21,133-141`; `class-aicc-consent.php:44-90`) | SUPPORTED |
| Stores kept apart | §11 (store-scoped credentials, `BE app/security/entitlement.py`) | SUPPORTED |
| What AICC changes in WooCommerce: private order fields (visitor and session IDs, only with consent), hides the related-products block by default | §8, §10 (`PL class-aicc-orders.php:255-285`) | SUPPORTED |
| Outage and inactive-plan behavior | §8, §14 | SUPPORTED |
| **Our retention target** (up to 12 months after access ends) and **What happens today** (nothing is deleted automatically), in separate labelled sentences; never implies automatic deletion | §10 (`BE app/config.py:475` sweep off; `BE scripts/data_deletion_request.py` is operator-only); facts `retentionMonthsPolicy`, `retentionAutoDeleteToday` | SUPPORTED / POLICY |
| Deletion and export requests are handled by hand | §10 | SUPPORTED |
| Draft banners and "pending before launch" lines on values that do not exist yet | `docs/AUTHORITY.md`, `npm run launch:check` | POLICY |

## Questions (57 active, grouped by what supports them)

| Questions | Evidence | Status |
|---|---|---|
| q01, q41, q57, q58, q42, q03, q48, q02, q43, q44 (what AICC does, difference from related products, bundles by hand, fit, not an AI recommendation engine, replaces WooCommerce, no personalization, how it decides, what it learns, little history) | §1, §5 (Ask Reco is not a chatbot), §9 | SUPPORTED |
| q45, q46, q47, q49, q50 (control, dashboard, Ask Reco, measurement, "AICC does not claim it generated your revenue") | §3, §2, §5, §6 | SUPPORTED |
| q06 ("No code and no setup wizard") | §12 (a setup checklist and technical readiness exist; the word "wizard" is the owner's) | OWNER (confirm) |
| q51 (timing varies, fallbacks once the catalog is synced) | §12 | SUPPORTED |
| q31, q32, q52, q43 second paragraph, q22 and q24 final sentences (optional import, start later, "Not now" never imported without asking) | §7 supports everything except the opt-in and "never without asking" (automatic start at this head, no opt-out setting) | PENDING (owner addendum L) |
| q39, q38, q37, q04, q05, q16, q40 (themes, mobile, languages, unavailable, checkout, inactive plan, removal) | §8, §9, §13, §15, §10 (uninstall removes only the cache table; no deactivation hook) | SUPPORTED |
| q08, q14 (license key: normally not needed; one-time recovery key) | `CP` connect flow | POLICY |
| q09 to q13, q55, q12 (plans, stores, moving, slots, larger plan) | §11, facts | SUPPORTED |
| q15, q21, q23, q36, q33, q34, q35 (disconnected store, retention, deletion, data use, store isolation) | §10, §11, §14. Retention answers carry `legalReview` and stay out of FAQPage JSON-LD until approved | SUPPORTED / legal review |
| q17 to q20, q26 to q30, q53, q54, q56 (expiry, renewal, authorization, refunds, 14 days) | facts, §14, CP refund policy | POLICY |
| q25 (no fabricated history for the inactive period) | §7 ("no events, impressions, clicks or attribution are fabricated") | SUPPORTED |

## Illustrations (kit modules)

The demo, the rules demo, the dashboard preview, the Merchant Insights cards and the Ask Reco panel use invented products and numbers (pour-over coffee set, 48 and 31 and 12 times, 1,240 views, 86 clicks, 9 orders, $412). Each carries the visible label "Sample data: not from a real store" and none states a result, a percentage lift or a customer. The semantics they show (exclude wins; prefer and deprioritize move one place and never past another group; out-of-stock stays out) are those of §3 and are implemented once in `brand/js/rules-core.js`.
