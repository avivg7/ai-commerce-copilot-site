# Claims inventory: content pass (English)

Every public product claim on Home, Product, Pricing, Questions and Data & Trust, with its evidence. Written for the owner and for whoever changes the copy next:
before a sentence changes, find its row; if the evidence changes, the sentence changes with it.

**Revision 2 (after the independent product-truth, conversion, UI/UX and accessibility reviews).** Rows that the product-truth review found wrong were corrected;
the corrections are listed at the end ("What the review changed"). The first inventory was built from the capability sheet; that sheet is wrong or stale in four places
(cart exclusion, the "real fallback wording", insight and dashboard labels, the import being automatic), so the evidence below cites the code, not the sheet, where they differ.

**Evidence key**

* `PL` plugin (`cp2a-14-readiness-independence`, now at `a99a356`/`ae49bf6` for the optional import, `49d036d` for the "Associated ..." labels), `BE` backend (`cp2a-6-prelaunch-commercialization @ 7b45923`), `CP` control plane, `WC` WooCommerce 10.9.
  File:line references are from the code reads of the product-truth review.
* `facts` = `brand/content/facts.json`. `content:check` compares every figure in the English copy with it.
* `FAQ` = `brand/content/faq.en.json` (owner-approved schema 2, with the review-batch edits listed below).

**Status key**: SUPPORTED (code evidence) · POLICY (a commercial or legal decision, not code) · DEMO (an illustration; invented sample data, labelled "Sample data: not from a real store") · OWNER (owner-supplied wording; see the note) · MIRROR (legal text owned by the Control Plane, not edited here).

**Automated guards**: `npm run content:check` (banned claims incl. the review's phrases, UK spellings, fact consistency, FAQ integrity, no "never paste", no counts, no apologetic phrasing outside legal pages, page titles and descriptions, rendered pages), `npm run copy:check`, `npm run pricing:check`, `npm run i18n:check`, `npm run fallback:check` (English is always marked), `npm run lang:check` (translated text is never under `lang="en"`), `npm run test:rules` (the demo ranking equals the backend's in all 32,500 combinations), `npm run test:interaction`, `npm run axe:check`.

---

## Home

| Section | Claim as published | Evidence | Status |
|---|---|---|---|
| Hero | AICC finds the products customers already buy together in your WooCommerce orders and shows them as a bundle shoppers add in one step, on product and cart pages | BE `app/services/recommendation_engine.py:29,59,64` (completed and processing orders, pair counts); PL `assets/js/widget.js:509-535`; PL `class-aicc-widget.php:100-126,80` (product and cart pages only) | SUPPORTED |
| Hero | Your WordPress dashboard shows what it recommends and why, and your rules shape the result | PL dashboard and Recommendation Preview (`assets/js/admin-sync.js:358-366`); merchant rules (`BE app/recommendation_policy.py:256-285,288-408,410-470`) | SUPPORTED |
| Hero | Learned from your own orders | BE `recommendation_engine.py:59-140` (counting; no ML) | SUPPORTED |
| Hero | You control what gets recommended | Pin and exclude are strong, prefer and deprioritize are one-place nudges (`recommendation_policy.py:288-408`); the page says "nudge one place" wherever it matters | OWNER (supported per product; not "full control") |
| Hero | Placing an order never waits on AICC (was "your checkout stays independent of AICC") | PL `class-aicc-orders.php:417-426` (order sync queued with `as_enqueue_async_action`), `class-aicc-tracker.php:220-224`, `class-aicc-widget.php:1134-1140`; handlers `AICC_Fail_Soft`-wrapped. "Independent" was too strong: AICC code runs in the checkout request (visitor-id stamp, queue write) and the consented `checkout_start` event calls the backend with a 2s timeout (`class-aicc-rest-api.php:155-196`) | SUPPORTED (reworded) |
| Hero | Plans from $99 a year · 14-day money-back guarantee on your first purchase · No automatic renewal | facts; CP `scripts/bootstrap-commercial-products.php:76-107`; `class-aicc-lm-license.php:22,133-177` | POLICY |
| Loop strip | Your orders, pairs found, shown to shoppers, clicks and carts counted, insights, your rules, learns from new orders | Each step maps to a section of this table. "Learns" means counting (BE recomputes pair counts; no ML) | SUPPORTED |
| Loop strip note | Once your store is ready the widget starts with same-category and newest products, then moves to real pairs as orders are counted; import past orders (optional) to start with pairs already learned | BE `legacy_recommendations.py:134,175,199` (three tiers); PL `class-aicc-onboarding.php:410` (needs at least 2 in-stock products); pairs are recalculated rate-limited (`BE config.py:145-146`). No duration is claimed | SUPPORTED |
| Demo | WooCommerce can tell which products share a category; AICC adds which products customers actually buy together, with sensible fallbacks where history is thin | WC `includes/wc-product-functions.php:1441-1442` (related = shared category and tags); BE three tiers | SUPPORTED |
| Demo | "Plain related products": WooCommerce's block drawn plainly (a heading and product tiles) | WC `wc-template-functions.php:2493-2502` (a plain product loop with the heading "Related products": no ticks, no total, no bundle button) | DEMO |
| Demo | Bundle widget: title "Frequently Bought Together", "Customers often purchase these products together.", "Bundle total", "Add N products to cart" | PL `assets/js/widget.js` `setHeader(...)` and strings; product page = the viewed product plus up to four recommendations (`widget.js:412`) | SUPPORTED |
| Demo | Merchant view: for each product "Bought together N times" (learned partners), a note that fallbacks have no count; a rule select; the list the shopper sees now; tiles; one observation; one Ask Reco line | "Bought together %s times" is the plugin string (`admin-sync.js:358-366`). A fallback shows only a price there; the "No count: filled from the same category" wording is OUR caption in a composite illustration (the earlier text "Same category — no purchase history yet" was presented as a plugin label and has been removed). The ranking is the backend's (`rules-core.js`, tested) | DEMO |
| Why (merged into the demo) | Related products match by category and tags; AICC counts completed and processing orders; thin history gets a same-category then newest fallback; nothing invented | WC as above; BE `recommendation_engine.py:29`, `legacy_recommendations.py:134,175,199` (same category is ordered by most recently updated: the copy says only "from the same category") | SUPPORTED |
| Workspace / Understand | Views, clicks, bundle add-to-carts for the last 30 days; associated orders and revenue; Recommendation Preview | PL `class-aicc-settings.php:10797-10835` (labels "Recommendation Views/Clicks/Click Rate", "Bundle Add-To-Carts", "Associated Orders", "Associated Revenue"; renamed in `49d036d`); fixed 30 days (`:536`) | SUPPORTED; numbers are DEMO |
| Workspace / Understand | Association, not proof of cause | BE `attribution_utils.py:20,142,204-213,280` (24 hours, same visitor, full order total, click-only not counted) | SUPPORTED |
| Workspace / Control | Pin, prefer, deprioritize, exclude; exclude always wins; pair or everywhere, expiry; out-of-stock and deleted stay out even when pinned | BE `recommendation_policy.py:256-285,288-408,410-470`; `merchant_override.py:70,134-204,241`; UI PL `class-aicc-settings.php:9445-9571` | SUPPORTED; the list is a DEMO whose ranking equals the backend's |
| Workspace / Find opportunities | Four kinds: Top Performing Product, Strong Bundle Opportunity, High Interest, Low Conversion, Recommendation Winner; "Top Recommendation" is the banner above the first insight | PL `class-aicc-settings.php:11979,11998,12005,12012` (titles), `:12928` (banner), `:12879-12893` (metric labels "Share of store purchases", "Add-to-cart count", "Recommendation clicks"); BE `insights.py:39,163-176,248-253,367-389,443-449` | SUPPORTED; cards are DEMO |
| Workspace / Find opportunities | Observations appear once you have at least 10 orders; each kind also needs enough data of its own; fixed rules, not a generative model | `MIN_PURCHASES = 10` counts orders that are not cancelled, refunded, failed or trashed (`insights.py:41,86-92`); each kind has its own thresholds | SUPPORTED |
| Workspace / Ask Reco | Answers common questions about your setup, performance and next steps from your own dashboard data; fixed rules; English and Hebrew; never changes settings; shoppers never see it; your questions are not sent to AICC | PL `class-aicc-reco.php:19,61,210,232-262,470,481` (no `wp_remote_*` in the answering code; wp-admin only) | SUPPORTED |
| Ask Reco sample | "Optional next step: import up to 24 months ... Past orders are never imported unless you choose to ..." with the button "Go to Order History" | PL `class-aicc-reco.php:3133-3150` (the real message and button; quoted verbatim). The performance answer is a one-sentence illustration of the metrics card | DEMO |
| How it works | Connect from WordPress; normally no license key to paste | CP connect flow; FAQ q08 | POLICY |
| How it works | Catalog prepared in the background; widget starts with fallbacks, then pairs; past-order import is optional | PL `a99a356`: explicit opt-in, no automatic start (`class-aicc-historical-backfill.php:287,315,525-531`), tests `tests/run_historical_import_optin_tests.php` | SUPPORTED |
| Safety | Placing an order never waits on AICC | see Hero | SUPPORTED |
| Safety | If AICC or its servers are slow or down the widget hides after a short wait, and WooCommerce's related products and cross-sells come back | PL `widget.js:358-361,1656-1683` (relay 2s x up to 2 engines, browser abort at 10s; the natives are hidden meanwhile); conditions on Product | SUPPORTED |
| Safety | Plan not active: no widget, no script, no new cookies | PL `class-aicc-commercial-gate.php:83`, `class-aicc-visitor.php:81`, `class-aicc-tracker.php:44`, `class-aicc-widget.php:1284,1372,1490` | SUPPORTED |
| Safety | AICC doesn't edit products, prices or templates; deactivate and natives return; tested with Storefront and a block theme | `docs/stage6-known-conflict-registry.md` (Storefront; Twenty Twenty-Five, widget render only) | SUPPORTED |
| Pricing | Every plan includes the widget, dashboard and insights, rules, Ask Reco and an optional import of past orders; you choose how many stores; AICC never renews automatically | facts; BE/PL never branch on plan; `class-aicc-lm-license.php:22` | POLICY / SUPPORTED |
| Final CTA | Initial plan purchase includes a 14-day money-back guarantee; the 14 days start when payment is received and your plan is issued; see the Refund Policy | facts (`moneyBackStartsAt`); CP `class-aicc-lm-refund-handler.php` (anchor = license `issued_at`) | POLICY |

## Product

| Section | Claim as published | Evidence | Status |
|---|---|---|---|
| Shopper experience | FBT widget on product pages and the cart page; viewed product starts ticked; cart starts from the first item; adds the bundle in one step; adapts phone to desktop; follows theme direction | PL `widget.js:509-535`, `class-aicc-widget.php:1905-1915,2055-2065`; `docs/widget.md` | SUPPORTED |
| Shopper experience | It shows up to five rows: on a product page the viewed product plus up to four recommendations, on the cart page up to five, leaving out products already in the cart (client-side) | PL `widget.js:393-404,412` (`maxVisibleItems - 1` recommendations plus the source row; reproduced in a browser harness by the review) | SUPPORTED |
| Shopper experience | Only product and cart pages; hides rather than guess on an unusual theme | PL placement tiers (Tier D hidden) | SUPPORTED |
| How AICC decides | Learned from orders, then same category, then newest in stock, then your rules | BE `recommendations.py:261,286`; `legacy_recommendations.py` | SUPPORTED |
| How AICC decides | Every recommendation can be explained; counting your own orders, no generative model, no profile of the shopper; same data, same result | BE `recommendation_engine.py:59-140` | SUPPORTED |
| Thin history | The spots purchase history can't fill are filled from the same category then newest; real co-purchases take over; the widget heading is the same for every item; the Recommendation Preview shows counts for learned partners and only a price for fallbacks | BE tiers; PL `widget.js:409-410` (static heading); PL `admin-sync.js:358-366` | SUPPORTED |
| Thin history | Four-spot illustration (two learned partners, one same category, one newest) | Invented numbers, labelled; four = the recommendations next to the viewed product | DEMO |
| Comparison | WooCommerce: shared category and tags, plus hand-picked Upsells and Cross-sells; control is hand-picked Upsells and Cross-sells (related products themselves are automatic); explainability simple (shared category or tag). AICC rows: orders, dashboard, rules, Recommendation Preview, Ask Reco, optional import, hides after a short wait | WC `wc-product-functions.php:1441-1442`, `html-product-data-linked-products.php:27,50,71` (Linked Products offers Upsells, Cross-sells and Grouped products, not related products); AICC rows from the sections above | SUPPORTED (the earlier "hand-picked per product related products" was wrong and is gone) |
| Dashboard | Views, clicks, click rate, bundle add-to-carts for the last 30 days; associated orders (24 hours) and revenue; Merchant Insights; Recommendation Preview (a fallback shows only a price); CSV export for 7, 30 or 90 days; readiness is setup readiness, not a sales measure | PL `class-aicc-settings.php:9230-9236,10797-10835,10830-10832`; `BE analytics_export.py:200-215` | SUPPORTED |
| Controls | Four rules with their exact semantics; pair or everywhere; expiry and note; no category rules; out-of-stock and deleted stay out even when pinned; prefer/deprioritize move one place and never across a group; a deprioritized product at the last visible spot can slip out of view; only pin forces a position | BE `recommendation_policy.py:256-285,288-408` (the demo reproduces it exactly, `npm run test:rules`) | SUPPORTED |
| Ask Reco | Can: readiness, why recommendations aren't showing, reading metrics, bundle opportunities and catalog health, next step with links. Can't: open-ended questions or copy, change settings, shopper-facing; English and Hebrew; answered in your admin and not sent to AICC | PL `class-aicc-reco.php` | SUPPORTED |
| Measurement | Views, clicks, bundle add-to-carts; associated within 24 hours; full order total; needs consent; association not causation; not measured: uplift, view-through, no-consent orders, pre-connection orders, cross-device | BE `attribution_utils.py`; PL `class-aicc-consent.php:44-90`, `class-aicc-visitor.php:81-100` | SUPPORTED |
| If AICC is unavailable | Default setting and JavaScript conditions; failures that stop PHP itself (a server out of memory) are outside what any plugin can intercept; minimums WordPress 6.0, WooCommerce 7.0, PHP 7.4; HPOS; disconnect first to free the slot | PL `ai-commerce-copilot.php:11-14,50-55`; `class-aicc-fail-soft.php` | SUPPORTED |
| Past orders | AICC offers the import after connecting; optional; skipping starts with fallbacks; "AICC doesn't import your past orders until you choose. Orders placed before you connected are not sent unless you import them; orders placed after connecting are sent as they are created or updated"; start later; doesn't change orders; no duplicates; cancel; opted-in returning merchants are caught up and a store that chose Not now is never imported without asking; never invents impressions, clicks or revenue | PL `a99a356` (opt-in) and `ae49bf6` (live order sync no longer carries pre-connection orders before opt-in), tests `tests/run_historical_import_optin_tests.php` S1/S1b; `class-aicc-orders.php:23,134-146,291-297` (live sync of new and changed orders); BE `models.py:291` (dedupe) | SUPPORTED |
| Past orders | AICC can preserve your store history when access pauses | BE `config.py:475` (no automatic deletion); `class-aicc-returning-merchant.php` | SUPPORTED |
| Stores | 1 / up to 3 / up to 10; staging and production are separate; disconnect frees the slot; summary and link to Pricing | CP `docs/cp2a22-multistore-licensing.md`; PL `class-aicc-api-client.php:396` | SUPPORTED |
| Current scope | Not personalized per shopper; not an upsell engine; product and cart pages only; Ask Reco merchant-facing and rule-based (English and Hebrew); same heading for fallback items; **products that need an option choice (size, color) show a Choose options link instead of being added to the bundle, so a bundle never claims more than the cart contains**; admin in English and Hebrew | BE tiers; plugin commit `95d069e` (`docs/widget.md`): a variable product with several purchasable variations (or one left on "any"), a grouped or an external product shows Choose options / View product and is excluded from the bundle count and total; one purchasable variation is added as that exact variation; unavailable items show "Currently unavailable"; when something cannot be added the widget says exactly what was added ("Added 2 of 3 to cart") and never claims full success | SUPPORTED |
| Languages | Website four languages; admin and Ask Reco English and Hebrew; widget English and Hebrew in full plus core labels in six languages; one language per store, chosen in the plugin settings | PL `class-aicc-widget.php:2083-2190`. The website's Hebrew, Spanish and Russian are drafts and partly English until Stage 2 (every English fallback block is marked) | SUPPORTED / pending Stage 2 |

## Pricing

| Claim as published | Evidence | Status |
|---|---|---|
| Solo $99 for 1 live store (a staging site counts as a second store), Studio $199 for up to 3 (badge: "Built for multiple stores", a purpose label, never a store-count recommendation, because two Solo plans cost $198, less than one Studio), Agency $499 for up to 10; US dollars; the three prices are in the page lead | facts; CP `bootstrap-commercial-products.php:76-107`; `npm run pricing:check` | POLICY |
| Every plan has the full product; plans differ only by store capacity | plan is never branched on in BE or PL | SUPPORTED |
| Included list; "Optional import of up to 24 months of past orders, so AICC can start from pairs already learned"; "Your store keeps working if AICC doesn't" | as above; PL `a99a356` | SUPPORTED |
| Fixed 365-day plan. Renewal is manual. AICC never renews your plan automatically; no payment authorization kept | facts; CP `class-aicc-lm-license.php:22,133-177` | POLICY |
| Renewal adds 365 days to the later of today and your current end date | CP `class-aicc-lm-license.php:133-177` | POLICY |
| "Your initial plan purchase includes a 14-day money-back guarantee. The 14 days start when payment is received and your plan is issued. See the Refund Policy for full terms." (exceptions are not listed on sales surfaces) | facts; CP refund handler | POLICY |
| Store slots; staging and production, www and non-www, http and https are separate; disconnect frees the slot; no transfer fee; a larger plan is a separate purchase | CP `docs/cp2a22`; BE per-IP registration limit (`config.py:88-89`): "no limit on moves" is no longer claimed | SUPPORTED |
| Coming back: expired, renew the same plan; refunded, buy a new plan; AICC can preserve your store history | CP; PL returning-merchant; BE `config.py:475` | SUPPORTED |
| Plan finder: states capacity only (Solo covers 1 store, Studio up to 3, Agency up to 10; no price comparison or savings claim); more than 10, contact support | `src/data/plans.ts`, `pricing:check` | POLICY |

## Data and trust

| Claim as published | Evidence | Status |
|---|---|---|
| Needs the catalog (names, prices, categories, images, SKUs, product links, stock status), order relationships, optional shopper activity with consent | PL `class-aicc-catalog.php:849-952`, `class-aicc-orders.php:314-383` | SUPPORTED |
| Orders: products and names, quantities, totals, currency, billing country, visitor and session IDs where they exist, **the WooCommerce customer ID for signed-in customers**, a hashed email identifier; orders of every status are sent, only completed and processing are counted for recommendations; not consent-gated | PL `class-aicc-orders.php:314-383` (`wp_user_id`), `sync_order` has no status filter; BE `recommendation_engine.py:29` | SUPPORTED |
| Past orders from up to 24 months, only if you choose to import them; orders before connecting are not sent unless imported; orders after connecting are sent as created or updated | PL `a99a356`/`ae49bf6` | SUPPORTED |
| Not received: raw email, names, phone, street addresses, payment details, shopper IP addresses | PL payload; no IP field (`REMOTE_ADDR` is used only for a local rate limit, `class-aicc-widget.php:1893`) | SUPPORTED |
| Pseudonymous, not anonymous | | SUPPORTED |
| Cookies `aci_vid` 1 year, `aci_sid` 30 minutes, only with an active plan, tracking on and consent; none without a consent plugin | PL `class-aicc-visitor.php:60-140`, `class-aicc-consent.php:44-90` | SUPPORTED |
| With consent, visitor and session IDs and the WordPress user ID on events | PL `tracker.js`, `class-aicc-tracker.php:310-317` | SUPPORTED |
| Stores kept apart; what AICC changes in WooCommerce; outage and inactive-plan behavior | BE entitlement/credentials; PL `class-aicc-widget.php:1577,1604`; as Home | SUPPORTED |
| **Our retention target** (up to 12 months) and **What happens today** (nothing is deleted automatically), as separate labelled sentences | BE `config.py:475`; `scripts/data_deletion_request.py` is operator-only | SUPPORTED / POLICY |
| Deletion and export requests are handled by hand | | SUPPORTED |
| One draft notice per page; "What we haven't finalized" lists the details not yet published | `docs/AUTHORITY.md`, `launch:check` | POLICY |

## Questions (58 active)

| Questions | Evidence | Status |
|---|---|---|
| q01, q41, q57, q58, q42, q03, q02, q43, q44 (what AICC does, difference from related products, bundles by hand, fit, not an AI engine, replaces WooCommerce, how it decides, what it learns, little history) | BE and WC as above. q43: AICC reads your catalog and your orders and counts pairs from completed and processing orders. q44: "AICC fills the spots that purchase history can't" | SUPPORTED |
| q48 (personalization) | "Recommendations follow the product being viewed, not a profile of the shopper. Products already in a shopper's cart are left out of the widget." PL `class-aicc-widget.php:1333` passes the cart's product ids as `excludeProductIds`; `widget.js:393-404` removes them and the viewed product client-side (the plugin's `docs/widget.md:32` says the opposite and is stale). It is a page-load snapshot with no refill, so fewer than five can show: not claimed as a feature | SUPPORTED |
| q45, q46, q47, q49, q50 (control, dashboard, Ask Reco, measurement, "Did AICC generate the revenue shown on the dashboard?") | PL/BE as above. q50 is worded without the banned phrase "AICC generated" | SUPPORTED |
| q06 (a developer: no code to write, a setup checklist guides you) | the dashboard setup checklist and technical readiness exist (`class-aicc-onboarding.php`) | SUPPORTED |
| q51 (when do I see recommendations) | PL `class-aicc-onboarding.php:410`; no duration is claimed | SUPPORTED |
| q31, q32, q52, q22, q24 (optional import, start later, nothing is imported without asking) | PL `a99a356`/`ae49bf6`; q31 now states what is and is not sent and when | SUPPORTED |
| q39, q38, q37, q04, q05, q16, q40 | PL registry, widget, `uninstall.php` (removes only the cache table). q05: "AICC is built so checkout doesn't wait on it" | SUPPORTED |
| q08, q14 (license key) | CP connect flow | POLICY |
| q09 to q13, q55, q12 (plans, stores, moving, slots) | CP, facts. q13 no longer says "no limit on moves" | SUPPORTED |
| q15, q21, q23, q36, q33, q34, q35 | PL/BE; retention answers carry `legalReview` and stay out of FAQPage JSON-LD until approved. q33 is the short version shown on Home with a link to Data and trust | SUPPORTED |
| q17 to q20, q26 to q30, q53, q54, q56 | facts, CP refund handler | POLICY |
| q25 ("Will AICC invent history for the time it was inactive?") | PL import sends order facts only; no events, impressions, clicks or attribution are created | SUPPORTED |

## Illustrations (kit modules)

The demo, the rules demo, the dashboard overview, the Merchant Insights cards and the Ask Reco panel use invented products and numbers (pour-over coffee set, 48, 31 and 12 times, 3,860 views, 241 clicks, 24 orders, $1,312) and carry the label "Sample data: not from a real store" (the Ask Reco panel: "Sample conversation"). None states a result, a percentage lift or a customer.
The ranking they show is the backend's own, ported line by line into `brand/js/rules-core.js` and compared with an independent port of `recommendation_policy.py` in all 32,500 rule combinations (`npm run test:rules`).

## What the review changed (rows that were wrong)

1. The WooCommerce comparison said related products can be "hand-picked per product": wrong (Linked Products offers Upsells, Cross-sells and Grouped products). Corrected.
2. "Nothing from past orders is sent until you choose" was false for orders that change status after connecting. Now: the import waits for your choice; orders placed after connecting are sent as they are created or updated. Plugin `ae49bf6` makes pre-connection orders wait for the opt-in.
3. The optional-import rows were PENDING; the plugin now implements the opt-in (`a99a356`), so they are SUPPORTED.
4. "Same category — no purchase history yet" was cited as the real fallback wording: it is not a plugin string. Removed from replicas; it survives only as our own caption wording in a labelled composite illustration.
5. "Hot Product Detected" and "Top Recommendation" (as the fourth kind's title) were wrong: the titles are "Top Performing Product" and "Recommendation Winner"; "Top Recommendation" is the banner above the first insight. Metric labels corrected.
6. The "cart exclusion is not applied" correction in the capability sheet is itself wrong (the widget removes cart products client-side). The site still does not claim it as a feature; FAQ q48 states it plainly.
7. "Up to five products" and the five-spot illustration: a product page shows the viewed product plus four recommendations.
8. The Data and trust order list omitted the WooCommerce customer ID. Added.
9. The demo ranking differed from the backend in 110 of 625 combinations. Replaced by an exact port with an exhaustive test.
10. The variable-product row was incomplete; the copy then said the bundle button adds simple products and skips the others; after the plugin fix (`95d069e`) it says products that need an option choice show a Choose options link instead of being added to the bundle.
11. Several rows cited the capability sheet's `cd3b41b` line; they now cite the code at the heads above.

## Translations (he, es, ru): what the claims inventory covers

All numbers in the translated copy equal English (1/3/10 stores, 365 days, the 14-day window, 24 months, 24 hours, 10 orders, the dashboard period); `copy:check` bans a thirty-day guarantee or trial claim in every language (the dashboard period is allowed) and `content:check` compares the rendered figures with `facts.json`. All three locales are `machine-draft; native review pending`; the translated legal pages carry the "machine draft, legal review pending" notice. Translated text states nothing the English does not.

## Legal text on the site now mirrors the Control Plane's Stage 2 wording (counsel review needed)

The site's privacy, terms and refund pages are plain-language summaries, but they now state the same facts as the Control Plane's legal sources
(`docs/unified-experience/legal-changes-stage2.md` in the Control Plane repo, which owns the documents). Changed on the site, in all four languages:

* **Refund policy**: a purchase made twice by mistake is its own section and no longer an exception (so it no longer contradicts the sales copy); the response-time sentence is "a service target, not a contractual deadline" (was "an expectation, not a guarantee"); "Plans and renewal" (no in-place upgrade; AICC never renews a plan automatically and keeps no authorization to charge again); "Your data after a refund" splits the retention target (up to 12 months) from what happens today (nothing is deleted automatically).
* **Privacy policy**: catalog data lists SKUs and the product page link; past-order import is optional and starts only when the merchant chooses (orders before connecting are not sent unless imported; orders after connecting are sent as created or updated); retention is split into target and today; the returning-store paragraph says the catch-up of the gap needs the merchant's import choice.
* **Terms**: "Placing an order never waits on AICC" (availability); "no in-place upgrade" (plans); US spelling "finalized".

These mirror the Control Plane's wording and **need counsel review** (and, for he/es/ru, a native-speaking legal reviewer) exactly like the Control Plane versions. The site's Hebrew refund text says "ערבות להחזר כספי" and the Control Plane mirror's "אין שדרוג במקום" calque was replaced on the site by "אי אפשר לשדרג תוכנית קיימת"; the Control Plane's he/es/ru mirrors should take the same two corrections ("no in-place upgrade", es "no se descuenta del precio" instead of "no abona", ru "Повысить действующий план нельзя").

Still different from the Control Plane by design: the site's accessibility statement is shorter and about this website only. `docs/unified-experience/accessibility-statement-diff.md` in the Control Plane repo lists the line-by-line differences; neither text is canonical until the owner decides (the Control Plane owns the document per `docs/AUTHORITY.md`).

## Stabilization pass (2026-10-18)

* **Studio badge**: "Built for multiple stores" (he "מיועדת לכמה חנויות", es "Pensado para varias tiendas", ru "Для нескольких магазинов"), a neutral purpose label. The old store-count recommendation is gone from the site because two Solo plans ($198) cost less than one Studio ($199). The plan finder and the "Which plan?" list state capacity only (Solo covers 1 store, Studio up to 3, Agency up to 10); the finder logic is unchanged. `facts.json` plans[studio].badge is the canonical string; `content:check` asserts the English dictionary equals it, and the phrase is a banned claim in all four languages (`facts.json` bannedClaims, `copy:check`).
* **Optional import sweep**: every customer-visible statement about past orders already said the import is optional except the answer to "Will AICC invent history for the time it was inactive?" (q25: "Past orders are imported as orders"), now "If you choose to import past orders, ..." in all four languages. Lint: `content:check` bans "imports your past orders automatically / when you connect" style sentences (facts.json bannedClaims, with a self-test), `copy:check` bans the he, es and ru equivalents (with a self-test).
* **Accessibility statement, site against Control Plane**: justified differences are different surfaces (the Control Plane covers account, forms and checkout, the site covers the demo and the marketing pages). Accidental drift fixed on the site: "No autoplaying video" (false: the muted looping hero video plays while it is on screen; the statement now says so, with the pause control and reduced motion), "Buttons and controls are at least 44 pixels" (the Control Plane says "our targets are"; the site now says targets), and the accessibility settings are named (reduce motion, higher contrast, larger text), as in the Control Plane.

## Final merchant review (2026-10-18)

* **New q59 "How many orders does AICC need?"** (replaces q51 on Home and in "Most asked before buying"): there is no minimum; any two products in the same completed or processing order become a pair; partners are ranked by how many orders contained both; fewer partners are filled with same-category and newest products; the optional import gives the history from the start; dashboard observations need at least 10 orders in the period. Evidence: BE `recommendation_engine.py` (raw pair counts, no threshold), facts `insightsMinOrders`, `importMonths`. SUPPORTED. q40 is titled "Can I remove or uninstall AICC cleanly?" (search synonym).
* **Home "Thin history gets a safe fallback"** says learned partners and fallbacks share the widget heading today (PL widget strings: same heading for fallback items); the dashboard preview shows which is which. SUPPORTED.
* **Associated orders** count at the full order total (Understand tab and Product measurement; facts `attributionCredit`). SUPPORTED.
* **Data and trust, short version**: "It does receive pseudonymous identifiers (a hashed email, customer and visitor IDs), billing country and order contents." Same facts as the lists below it. SUPPORTED (legal text: counsel review).
* **Pricing "Try it"**: the optional import is suggested as the way to see learned partners sooner. POLICY.
