# "Frequently Bought Together" usage audit

**The rule (owner direction, 2026-10-19).** AICC is a commerce recommendation and merchandising copilot (AI Commerce Copilot). WooCommerce is the first supported
commerce platform ("Available for WooCommerce"), not the permanent definition. "Frequently Bought Together" is the real heading of one storefront widget, and
co-purchase counting is one recommendation signal among several (catalog category, stock and recency, the merchant's rules). Neither may be used as AICC's product
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
| dictionary `demo.result.without` | Plain related products pick from the same category: {names}. Nothing about them comes from what shop | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.result.withTwo` | Same product. With AICC the partners are {a} and {b}, bought together {na} and {nb} times. | A | the real evidence label / count of a learned partner |
| dictionary `demo.result.withOne` | Same product. With AICC the first partner is {a}, bought together {na} times; your rules shape the r | A | the real evidence label / count of a learned partner |
| dictionary `demo.widget.title` | Frequently Bought Together | A | names the storefront widget (its real heading) |
| dictionary `demo.mode.captionWith` | With AICC: bought together most often. | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.mode.withoutCaption` | WooCommerce's own related products come from the same category or tags. They are not based on what s | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.merchant.insightBody` | Pour-over coffee set and {product} are often bought together. | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.merchant.insightMetric` | Times bought together | A | the real evidence label / count of a learned partner |
| dictionary `demo.merchant.askAnswer` | {product} is the strongest partner for the pour-over set here: bought together {n} times, more than  | A | the real evidence label / count of a learned partner |
| dictionary `demo.merchant.askNone` | No bought-together partner is left in the list. AICC would fill the spots from the same category. | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.merchant.boughtTogether` | Bought together {n} times | A | the real evidence label / count of a learned partner |
| dictionary `demo.merchant.evidenceOrder` | It fills the list in this order: products bought together first, then the same category, then your n | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.merchant.previewNote` | In your dashboard's Recommendation Preview, learned partners show how many times they were bought to | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.why.grinder` | A hand grinder was bought together fewer times than the filters: shoppers setting up a pour-over rou | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.why.kettle` | A kettle was bought together less often still, so AICC lists it after the products above. | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.why.mug` | There is no purchase history for this pair yet, so this spot is filled from the same category. As or | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.why.without` | Plain related products come from the same category, which is how WooCommerce related products work b | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.why.merchant` | This is the evidence behind the list: how many times each product was bought together with the pour- | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.reco.filters` | Reco: paper filters were bought together with the pour-over set most often, so they come first. | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.reco.grinder` | Reco: a grinder was bought together fewer times than the filters, so it comes next. | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `demo.reco.kettle` | Reco: a kettle was bought together less often, so it is listed after the others. | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `rules.evidence.learned` | Bought together {n} times | A | the real evidence label / count of a learned partner |
| dictionary `dash.widgetTitle` | Frequently Bought Together | A | names the storefront widget (its real heading) |
| dictionary `dash.insightBody` | Pour-over coffee set and Paper filters, 100 pack are often bought together. | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `dash.insightMetric` | Times bought together | A | the real evidence label / count of a learned partner |
| dictionary `dash.insightKinds.bundle.body` | Pour-over coffee set and Paper filters, 100 pack are often bought together. | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `dash.insightKinds.bundle.metric` | Times bought together | A | the real evidence label / count of a learned partner |
| dictionary `dash.previewLearned` | Bought together {n} times | A | the real evidence label / count of a learned partner |
| dictionary `ask.qa.next.a` | Optional next step: import up to 24 months of your WooCommerce order history so AICC can learn which | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `home.pillars.a.body` | Suggestions drawn from your own store data: what customers buy together, your catalog and your stock | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `home.why.lead` | WooCommerce's related products are a sensible default: they match products by category and tags. The | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `home.why.points.fallback.body` | When a product has few co-purchases, the remaining spots come from the same category, then your newe | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `home.workspace.understand.lead` | See what shoppers do with your recommendations: views, clicks and bundle add-to-carts from the last  | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `home.how.steps.learn.body` | AICC prepares your catalog in the background. Once your store is ready, recommendations start with s | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `home.how.steps.recommend.body` | On product and cart pages, the Frequently Bought Together widget shows what your customers bought to | A | names the storefront widget (its real heading) |
| dictionary `product.shopper.lead` | Today, AICC's recommendations reach shoppers as a Frequently Bought Together bundle on your product  | A | names the storefront widget (its real heading) |
| dictionary `product.sparse.p1` | The spots that purchase history can't fill are filled with in-stock products from the same category, | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `product.sparse.limit` | The widget heading is the same for every item. In the Recommendation Preview in your dashboard, lear | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `product.sparse.slots.learned` | Bought together {n} times | A | the real evidence label / count of a learned partner |
| dictionary `product.dash.items.d.body` | Pick any product and see what AICC recommends for it. Learned partners show how many times they were | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `product.compare.rows.chosen.aicc` | What customers in your store bought together; category and newest as fallbacks | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| dictionary `pricing.included.items.b` | Storefront recommendations on product and cart pages (the Frequently Bought Together bundle) | A | names the storefront widget (its real heading) |
| dictionary `legal.terms.s.service.a` | AICC is a WooCommerce plugin with a hosted service. It adds product recommendations learned from you | A | names the storefront widget (its real heading) |
| dictionary `legal.dataTrust.s.reads.a` | When you connect a store, AICC receives what it needs to learn which products are bought together: | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| FAQ `q01.a` | (see brand/content/faq.en.json) | A | names the storefront widget (its real heading) |
| FAQ `q41.a` | (see brand/content/faq.en.json) | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| FAQ `q58.a` | (see brand/content/faq.en.json) | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| FAQ `q42.a` | (see brand/content/faq.en.json) | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| FAQ `q43.a` | (see brand/content/faq.en.json) | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| FAQ `q44.a` | (see brand/content/faq.en.json) | A | names the storefront widget (its real heading) |
| FAQ `q51.a` | (see brand/content/faq.en.json) | A | describes the co-purchase signal or a relationship in context (one signal among several) |
| FAQ `q60.q` | (see brand/content/faq.en.json) | A | names the storefront widget (its real heading) |
| FAQ `q60.a` | (see brand/content/faq.en.json) | A | names the storefront widget (its real heading) |
| FAQ `q62.a` | (see brand/content/faq.en.json) | A | describes the co-purchase signal or a relationship in context (one signal among several) |
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
| file `docs/claims-inventory-content-pass.md` | up to 9 mention(s) | A | documentation that explains the widget and the guard |
| file `docs/content-architecture.md` | up to 3 mention(s) | A | documentation that explains the widget and the guard |
| file `scripts/interaction-test.mjs` | up to 8 mention(s) | A | test or tooling text about the widget heading and the demo |
| file `scripts/lang-scope-check.mjs` | up to 1 mention(s) | A | test or tooling text about the widget heading and the demo |
| file `scripts/rules-core-test.mjs` | up to 3 mention(s) | A | test or tooling text about the widget heading and the demo |
| file `scripts/shots-brand.mjs` | up to 2 mention(s) | A | test or tooling text about the widget heading and the demo |
| file `scripts/visual-contract.mjs` | up to 14 mention(s) | A | test or tooling text about the widget heading and the demo |
| file `README.md` | up to 2 mention(s) | A | documentation that explains the widget and the guard |
<!-- table:end -->
