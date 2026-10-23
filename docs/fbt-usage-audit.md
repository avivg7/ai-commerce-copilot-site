# "Frequently Bought Together" usage audit

**The rule (owner direction, 2026-10-19).** AICC is a commerce recommendation and merchandising copilot (AI Commerce Copilot). WooCommerce is the first supported
commerce platform ("Available for WooCommerce"), not the permanent definition. "Frequently Bought Together" is the real heading of one storefront widget, and
co-purchase counting is the first step of a fixed ranking chain (products bought together, then the same category, then the newest in-stock products; stock and deletion are filters; the merchant's rules apply last). Neither may be used as AICC's product
category, primary positioning, umbrella descriptor, footer definition, SEO identity or brand identity, or as the answer to "What is AICC?".

## Classes

* **A**: a legitimate description of a specific storefront behavior or signal, in context (the widget's own heading; "Bought together N times", the real evidence label of a learned partner; "AICC counts which products appear together in your orders").
* **B**: the phrase used as AICC's identity. B must not exist; this audit removed every B it found.

## Enforcement (not a blanket ban)

`npm run content:check` (and `npm run fbt:audit`) enforce two things:

1. **Positional guard, every locale**: no FBT / co-purchase wording in the positioning slots: hero eyebrow, category cue, headline and lead; the site name; the meta title and
   description of every page; the share-image text; the footer tagline and note; the Product and Pricing hero; and the first sentence of the "What is AICC?" answer.
   (The JSON-LD description and the page `<title>` are built from those same meta strings.)
2. **Reviewed allow-list**: every other occurrence (English dictionary, FAQ, source, scripts, docs) is listed in `scripts/fbt-allowlist.json`. A new occurrence outside the list
   fails with a message asking for classification: add it to the list with a reason (class A) or rewrite it (class B). Regenerate the table below with `npm run fbt:audit -- --doc`
   after a review; `--init` rewrites the allow-list from the current state (review the diff first).

## What this pass removed (class B)

Positioning slots that used the phrase as identity, before and after (English; the same slots were B in he, es and ru):

| Slot | Before | After |
|---|---|---|
| Hero eyebrow | "Frequently Bought Together for WooCommerce" | "Available for WooCommerce", with the category cue "Commerce recommendation and merchandising copilot" |
| Hero headline | "Show shoppers what your own customers buy together." | "Make every product page a smarter selling opportunity." |
| Hero lead | "AICC finds the products your customers already buy together ... shows them as a bundle ..." (44 words) | "AICC turns your store data into better product recommendations, useful merchant insight, and practical merchandising control." (17 words) |
| Home meta title | "AICC: Frequently Bought Together, learned from your orders" | "AICC: product recommendations and merchandising copilot" |
| Home meta description | "AICC learns which products your customers buy together ..." | "AICC turns your store data into better product recommendations, useful merchant insight and practical merchandising control. Available for WooCommerce." |
| Product meta title | "How AICC works: Frequently Bought Together for WooCommerce" | "How AICC works: recommendations you can explain and control" |
| Share-image alt text | "AICC: Frequently Bought Together, learned from your own store's orders ..." | "AICC: product recommendations, merchant insight and merchandising control for WooCommerce ..." |
| Footer tagline (and the share-image subtitle) | "Frequently Bought Together for WooCommerce, learned from your own orders, with the dashboard and controls to match." | "Product recommendations, merchant insight and merchandising control for WooCommerce, learned from your own orders." |
| Product hero lead | "... shows shoppers what is actually bought together ..." | "AICC turns your store data into the recommendations shoppers see, plus the dashboard, insight and rules ..." |
| Demo section heading and lead | "Frequently-bought-together, actually learned." | "See the signal behind every recommendation." |
| "What is AICC?" (q01) | "AICC turns your WooCommerce orders into a merchandising workspace. It learns which products your customers actually buy together ..." | outcome plus three pillars; the bundle is named as how recommendations reach shoppers today |
| Terms, "What AICC is" | "It adds a Frequently Bought Together widget ..." | "It adds product recommendations learned from your store's orders (shown to shoppers as a Frequently Bought Together bundle) ..." |
| Product "Current scope" | "AICC recommends products bought together." | "AICC recommends complementary products from your own orders and catalog." |

Counts: before this pass 33 positioning slots across the four locales carried the phrase (en 9, he 8, es 8, ru 8); after it, 0 (guarded in every locale).

## Class A: the reviewed list

<!-- table:start -->
| Where | Text | Class | Why it stays |
|---|---|---|---|
| dictionary `demo.result.without` | WooCommerce related products pick from the same category: {names}. Nothing about them comes from wha | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.result.withTwo` | Same product. With AICC the partners are {a} and {b}, bought together {na} and {nb} times. | A | the real evidence label / count of a learned partner |
| dictionary `demo.result.withOne` | Same product. With AICC the first partner is {a}, bought together {na} times; your rules shape the r | A | the real evidence label / count of a learned partner |
| dictionary `demo.result.cartWithout` | WooCommerce cross-sells are products you link to each item by hand: {names}. Nothing about them come | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.result.cartWithTwo` | In the cart. AICC starts from the first item and leaves out what is already there: the partners are  | A | the real evidence label / count of a learned partner |
| dictionary `demo.result.cartWithOne` | In the cart. AICC starts from the first item and leaves out what is already there: the first partner | A | the real evidence label / count of a learned partner |
| dictionary `demo.mode.withCaption` | AICC lists the products that appear in the same orders first. When order history is thin, it keeps t | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.why.withoutCart` | WooCommerce cross-sells | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.plainHintCart` | WooCommerce does not learn these from what shoppers buy together: the merchant chooses the cross-sel | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.widget.title` | Frequently Bought Together | A | names the storefront widget (its real heading) |
| dictionary `demo.mode.captionWith` | With AICC: products bought together come first. | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.mode.withoutCaption` | WooCommerce's own related products come from the same category or tags. They are not based on what s | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.merchant.insightBody` | Pour-over coffee set and {product} are often bought together. | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.merchant.insightMetric` | Times bought together | A | the real evidence label / count of a learned partner |
| dictionary `demo.merchant.askAnswer` | {product} is your strongest bundle with the pour-over set in this sample: bought together {n} times. | A | the real evidence label / count of a learned partner |
| dictionary `demo.merchant.askNone` | No bought-together partner is left in this sample list. Open Recommendation Preview to see the partn | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.merchant.boughtTogether` | Bought together {n} times | A | the real evidence label / count of a learned partner |
| dictionary `demo.merchant.evidenceOrder` | AICC fills the list in this order: products bought together first, then the same category, then your | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.why.filters` | Paper filters: bought together with the pour-over set more often than any other product in this samp | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.why.grinder` | Hand grinder: bought together with the pour-over set less often than the filters, so it is listed ne | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.why.towel` | Linen tea towel: filled in from your newest in-stock products, after the bought-together partners an | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.why.without` | WooCommerce related products come from the same category, which is how they work by default. Nothing | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `demo.why.merchant` | A sample of how the list is built: how many times each product was bought together with the pour-ove | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `rules.evidence.learned` | Bought together {n} times | A | the real evidence label / count of a learned partner |
| dictionary `dash.widgetTitle` | Frequently Bought Together | A | names the storefront widget (its real heading) |
| dictionary `dash.insightBody` | Pour-over coffee set and Paper filters, 100 pack are often bought together. | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `dash.insightMetric` | Times bought together | A | the real evidence label / count of a learned partner |
| dictionary `dash.insightKinds.bundle.body` | Pour-over coffee set and Paper filters, 100 pack are often bought together. | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `dash.insightKinds.bundle.metric` | Times bought together | A | the real evidence label / count of a learned partner |
| dictionary `dash.previewLearned` | Bought together {n} times | A | the real evidence label / count of a learned partner |
| dictionary `ask.qa.focus.a` | Optional next step: import up to 24 months of your WooCommerce order history so AICC can learn which | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `ask.qa.opportunity.a` | Pour-over coffee set and Paper filters, 100 pack are bought together 9 times, your strongest bundle  | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `home.why.lead` | WooCommerce's related products are a sensible default: they match products by category and tags. The | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `home.why.points.fallback.body` | When a product has few co-purchases, AICC still fills the widget, using signals from your catalog beyond past purchases: relevant in-stock product | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `home.workspace.understand.lead` | See what shoppers do with your recommendations: views, clicks and bundle add-to-carts from the last  | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `home.how.steps.learn.body` | AICC prepares your catalog in the background. Once your store is ready, recommendations start with s | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `home.how.steps.recommend.body` | On product and cart pages, the Frequently Bought Together widget shows what your customers bought to | A | names the storefront widget (its real heading) |
| dictionary `product.shopper.lead` | Today, AICC's recommendations reach shoppers as a Frequently Bought Together bundle on your product  | A | names the storefront widget (its real heading) |
| dictionary `product.sparse.p1` | The spots that purchase history can't fill go to relevant in-stock products from your catalog, then your newest in-stock products. | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `product.sparse.limit` | The widget heading is the same for every item. In the Recommendation Preview in your dashboard, lear | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `product.sparse.slots.learned` | Bought together {n} times | A | the real evidence label / count of a learned partner |
| dictionary `product.dash.items.d.body` | Pick any product and see what AICC recommends for it. Learned partners show how many times they were | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `product.compare.rows.chosen.aicc` | What customers in your store bought together; category and newest as fallbacks | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| dictionary `pricing.included.items.b` | Storefront recommendations on product and cart pages (the Frequently Bought Together bundle) | A | names the storefront widget (its real heading) |
| dictionary `legal.terms.s.service.a` | AICC is a commerce recommendation and merchandising copilot, available for WooCommerce as a plugin w | A | names the storefront widget (its real heading) |
| dictionary `legal.dataTrust.s.reads.a` | When you connect a store, AICC receives what it needs to learn which products are bought together: | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| FAQ `q01.a` | (see brand/content/faq.en.json) | A | names the storefront widget (its real heading) |
| FAQ `q41.a` | (see brand/content/faq.en.json) | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| FAQ `q58.a` | (see brand/content/faq.en.json) | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| FAQ `q42.a` | (see brand/content/faq.en.json) | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| FAQ `q43.a` | (see brand/content/faq.en.json) | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| FAQ `q44.a` | (see brand/content/faq.en.json) | A | names the storefront widget (its real heading) |
| FAQ `q51.a` | (see brand/content/faq.en.json) | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| FAQ `q60.q` | (see brand/content/faq.en.json) | A | names the storefront widget (its real heading) |
| FAQ `q60.a` | (see brand/content/faq.en.json) | A | names the storefront widget (its real heading) |
| FAQ `q62.a` | (see brand/content/faq.en.json) | A | describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain) |
| file `src/components/brand/FbtSection.tsx` | up to 2 mention(s) | A | code comment or identifier that describes the widget |
| file `src/lib/rich.tsx` | up to 1 mention(s) | A | code comment or identifier that describes the widget |
| file `brand/js/dash-preview.js` | up to 2 mention(s) | A | code comment or identifier that describes the widget |
| file `brand/js/fbt-demo.js` | up to 3 mention(s) | A | code comment or identifier that describes the widget |
| file `brand/js/motion.js` | up to 1 mention(s) | A | code comment or identifier that describes the widget |
| file `brand/js/replica-labels.js` | up to 1 mention(s) | A | code comment or identifier that describes the widget |
| file `brand/README.md` | up to 8 mention(s) | A | documentation that explains the widget and the guard |
| file `brand/aicc-brand.css` | up to 5 mention(s) | A | code comment or identifier that describes the widget |
| file `brand/content/README.md` | up to 1 mention(s) | A | documentation that explains the widget and the guard |
| file `docs/AUTHORITY.md` | up to 2 mention(s) | A | documentation that explains the widget and the guard |
| file `docs/claims-inventory-content-pass.md` | up to 14 mention(s) | A | documentation that explains the widget and the guard |
| file `docs/content-architecture.md` | up to 5 mention(s) | A | documentation that explains the widget and the guard |
| file `scripts/interaction-test.mjs` | up to 11 mention(s) | A | test or tooling text about the widget heading and the demo |
| file `scripts/lang-scope-check.mjs` | up to 1 mention(s) | A | test or tooling text about the widget heading and the demo |
| file `scripts/rules-core-test.mjs` | up to 3 mention(s) | A | test or tooling text about the widget heading and the demo |
| file `scripts/shots-brand.mjs` | up to 2 mention(s) | A | test or tooling text about the widget heading and the demo |
| file `scripts/visual-contract.mjs` | up to 14 mention(s) | A | test or tooling text about the widget heading and the demo |
| file `README.md` | up to 2 mention(s) | A | documentation that explains the widget and the guard |
| file `scripts/rehearsal/browser-flows.mjs` | up to 2 mention(s) | A | test or tooling text about the widget heading and the demo (the browser suite asserts the home FAQ list and the CSS class of the storefront widget's intro) |
<!-- table:end -->
