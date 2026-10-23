# Content architecture

How the words and facts of AICC are organized so that the marketing site and the Control Plane (the commerce and account area) never disagree.

## The single-source model

```
brand/content/facts.json      figures and claim rules   ──┐
brand/content/faq.en.json     the FAQ (canonical)       ──┼──  one file, two surfaces (brand kit, byte-identical)
brand/content/faq.<l>.json    translations (q/a only)   ──┘
src/i18n/en.ts                page copy of THIS site (hero, sections, demos)       site only
src/i18n/{he,es,ru}.ts        PARTIAL dictionaries: translated units only          site only
brand/i18n/strings.json       GENERATED: kit strings for the shared modules        both surfaces
```

* **Shared (one file, both surfaces):** every fact that a visitor could compare between the two sites (prices, store counts, term, refund window,
  import window, attribution window, minimum orders for observations, widget limits, ranking order, rule semantics), the whole FAQ, the banned-claim list,
  the kit modules (demo, rules, dashboard preview, Ask Reco panel, flow diagrams) and the kit strings they read.
* **Surface-specific:** page layout and section copy on the marketing site (`src/i18n/en.ts`), and the Control Plane's own account, checkout and
  renewal copy. A sentence may differ between surfaces only for a reason that is written down:
  1. the surface has a different job (the site persuades and explains; the Control Plane confirms a purchase), or
  2. the form differs (a table cell is shorter than the FAQ answer it summarizes).
  The *fact* inside the sentence never differs. `npm run content:check` finds every price, term, window and limit in the English copy by pattern and
  fails when one disagrees with `facts.json`.
* **Why a pack and not a library:** the Control Plane is PHP/WordPress. A JSON file plus the brand kit's vanilla modules is the one thing both can read without a
  build step, and the existing `MANIFEST.json` already proves byte identity.

## The FAQ in three layers and nine topics

| Layer | Reader's stage | Topics it contains (questions) |
|---|---|---|
| Before you decide (`sales`) | deciding whether AICC fits | the basics (3); how recommendations work (3); dashboard, controls and Ask Reco (5); setup, history, themes and languages (1); renewal, billing and refunds (2) |
| How AICC behaves (`product`) | evaluating details | the basics (2); how recommendations work (1); setup, history, themes and languages (6); store safety and reliability (4) |
| Plans, billing, data and policy (`account`) | buying, paying, coming back | plans and stores (8); renewal, billing and refunds (10); when access pauses, and coming back (6); data and privacy (4) |

A topic can appear in more than one layer; the Questions page groups by layer first, then topic, so the jump links go to a topic *inside* its layer.

Each page shows its own **selection** (a short, ordered list of ids): Home 7, Product 10, Pricing 10, Questions all. The selection is in the pack, so the Control Plane
can show the same questions on its pricing page. No page prints a count of questions as a selling point; links say "See all questions".

Ids (`q01` ... `q56`) are permanent public anchors. A removed question moves to the `retired` map with the id that answers it now (`q07` -> `q51`); the anchor keeps working.

## Translation: the explicit fallback

The English pass changed meaning in many places, so translations were rebuilt unit by unit. The mechanism (`src/i18n/merge.ts`, `src/data/faq.ts`) stays in place even though nothing falls back today, because the next English change will make some unit stale again:

1. `en.ts` is the contract. `he.ts`, `es.ts` and `ru.ts` are *partial*: they keep only strings whose English meaning is unchanged.
2. At load, every missing string is taken from English **per unit** (a page section, one legal section, one kit string set), never string by string, so a block never mixes two languages.
3. The renderer marks fallback blocks `lang="en" dir="ltr"` (`fbProps()`), the kit modules do the same when their strings carry `_fallback: true`, and fallback FAQ questions
   also show a small `EN` tag. The page's own `<html lang>` and `dir` stay the page language. A translated string rendered inside a fallback block carries its own `lang`/`dir` (`txProps()`).
4. `npm run i18n:check` validates every translated unit and prints how much falls back per locale. `npm run i18n:strict` fails while any unit or question falls back (the completion gate; it passes now).
5. Translating a unit means adding it to the locale file (a complete unit) or the FAQ translation file; the fallback disappears by itself.
6. **The mechanism is tested without a real fallback**: `test:interaction` swaps English `_fallback` strings into the served he/es pages (demo, rules demo), renders the server-side kit renderers with `_fallback: true`, and unit-tests `mergeOverEnglish`; `fallback:check` injects English into a translated page (flagged bare, not flagged with `lang="en"`).

### Locale status (all four locales are complete)

| Locale | Dictionary units falling back | FAQ questions falling back | Page titles in English | reviewStatus (`faq.<l>.json`) | Native review |
|---|---|---|---|---|---|
| en | n/a (canonical) | n/a | n/a | canonical | n/a |
| he | 0 of 64 | 0 of 57 | none | machine-draft; native review pending | pending |
| es | 0 of 64 | 0 of 57 | none | machine-draft; native review pending | pending |
| ru | 0 of 64 | 0 of 57 | none | machine-draft; native review pending | pending |

The privacy, terms and refund mirrors are not site-translated text of our own: they follow the Control Plane documents, and every legal page shows the "machine draft, legal review pending" notice.

### Real plugin-admin labels (WCAG 3.1.2)

The AICC admin is translated to Hebrew and English only. The replicas on the site (dashboard preview, Merchant Insights, rules demo, merchant view, Ask Reco panel) and the prose that names these labels use the real label text of the merchant's admin:

* **he**: the plugin's own Hebrew labels (`brand/content/replica-labels.json`, key `he`, taken from `languages/ai-commerce-copilot-he_IL.po`). They are Hebrew and are never marked as English. `i18n:check` fails if a he kit string that equals an English label differs from the plugin's Hebrew label.
* **es, ru**: the labels stay English (Recommendation Views, Merchant Insights, Recommendation Preview, Pin, Prefer, Deprioritize, Exclude, Bought together {n} times, ...). Each occurrence is a `lang="en" dir="ltr"` **leaf** (`<span class="aicc-admin-label">`, or `lang` on an `<option>`), so surrounding translated words never sit under `lang="en"`. `lang:check` fails when an es/ru text node holds a label that is not such a leaf, or when a `lang="en"` label wrapper holds translated words.
* The label list lives in one file, `brand/content/replica-labels.json` (shared with the Control Plane); `npm run brand:build` generates `brand/js/replica-labels.js` from it. The kit renderers use `labeler(strings, { locale })` from `brand/js/motion.js`; the React site uses `Rich` / `Lb` / `Track` (`src/lib/rich.tsx`), which call the same `splitLabels()`. The English fallback never wraps (everything is already `lang="en"`).
* Hebrew dashboard term: the plugin admin says **דשבורד**, so the site uses "דשבורד / הדשבורד" everywhere (including its Hebrew legal strings). The Control Plane's legal mirrors still say "לוח הבקרה" and need the same change.
* Russian "{n} раз": the counts in the kit and on the Product page are fixed samples (48, 31, 12). "раз" is right for the plural categories one and many and wrong only for few (2-4, 22-24 ...), so `i18n:check` fails if a sample count ever falls in "few"; add real `Intl.PluralRules("ru")` forms when counts become dynamic (the cart label already has them).

### Behaviour added by the i18n/RTL review

* **Latin runs in Hebrew** (`src/lib/rich.tsx`, `LATIN_RUN`): a Latin word, version (WCAG 2.2) or domain is one `<bdi>`; the sentence-final period or comma stays outside it, otherwise it renders on the wrong side ("AA." reading ". AA"). `test:interaction` measures the DOM on he pages.
* **Language switch** keeps `?q=` and `#anchor` (`brand/js/lang-menu.js`, links refreshed whenever the menu opens or the hash changes; only with `data-persist`, i.e. the site).
* **FAQ search** (`brand/js/faq-search.js`): apostrophe and quote variants are equal (geresh ׳ = '), and when nothing matches exactly each word of 5+ letters is retried by its stem ("лицензия" finds "лицензионный").
* **Admin labels** keep one trailing punctuation mark inside their `lang="en"` leaf, so a comma or colon is never orphaned at the start of a line.
* **Reflow**: at 320px with Larger text no page overflows in any language (`test:interaction` checks 9 pages x 4 languages); long Russian headings hyphenate only words of 10+ letters.
* **Russian prices** state "(USD)" once per sentence, after the last price.
* **Hebrew "guarantee"**: wherever English says money-back guarantee the Hebrew says "ערבות להחזר כספי". The pin rule says "קרוב לראש" (near the top), as in English.

### For native reviewers (collected from the three translation passes)

**Hebrew**: "דשבורד" (prose; plugin term) vs the legal mirrors' "לוח הבקרה"; the plugin's labels (הכנסה משויכת, הזמנות משויכות, צפיות בהמלצות, הקלקות המלצה, שיעור הקלקות המלצה, הוספות חבילה לעגלה, תובנות סוחר, תצוגה מקדימה של המלצות, נעץ / העדף / הורד בעדיפות / החרג as masculine imperatives); "Ask Reco" kept in Latin with "שאלו את Reco" only as the replica panel title; unconfirmed terms: מרחב עבודה למרצ׳נדייזינג, מוצרים נלווים (learned partners), מוצרי השלמה (fallback products), מקום {n}, מקומות לחנויות, מכירות צולבות / משודרגות, מודל גנרטיבי, הנתון (signal), פרט גישה (credential), ערכת נושא, אזור הניהול, מתכנת; the tab "מה כדאי לקדם" for "Find opportunities" (a banned-phrase rule for the Hebrew word for a paid plan also matches inside the Hebrew word for "opportunities"); "אנג׳" for the EN tag; prices as "Solo ב־$99".

**Spanish**: formal usted; cupo (store slot), comerciante, panel, paquete (bundle), acompañante (learned partner), puesto (list position), "Planes y tiendas", ventas dirigidas / ventas cruzadas, "video"; "Sin AICC" for the plain related-products mode; "Renovación manual, sin cobros automáticos" (the copy rule bans the Spanish phrase for automatic renewal); "Inglés" for the EN tag; product names in «»; the sample Ask Reco conversation is translated although the real Reco answers in English and Hebrew only (a footnote says so); "Pin (fijar)" glosses; "Fijado / Preferido / Con menos prioridad / Excluido" for the rule tags.

**Russian**: formal «вы», «ёлочки», no-break spaces after short words; место для магазина (never «слот»), владелец магазина, гид (Reco), тестовая копия (staging), план, набор (bundle), сопутствующий товар (partner), запасной вариант (fallback), связанные (associated), наблюдения (insights), админ-панель (non-breaking hyphen), панель (dashboard); doubtful: «Решаете вы:» for "You stay in control", допродажи / перекрёстные продажи, «Планы и магазины», "merchandising workspace" as «рабочее пространство для управления витриной»; the labels stay English with a Russian gloss on first mention (Закрепите (Pin), повысьте (Prefer) ...).

## How to add a question

1. Append it to `brand/content/faq.en.json` `items` with the next free `qNN`, a `layer` and a `topic`. First the short direct answer, then the explanation.
2. Add the id to the `selection` of any page that should show it. Mark `"legalReview": true` if it states rights, retention, refunds or privacy.
3. Use `[label](route:x)` tokens for links. Do not restate a figure by hand if a fact exists: write it exactly as in `facts.json` and let the checker compare.
4. `npm run content:check`, `npm run i18n:check`, `npm run brand:build`. The new question falls back to English in the other locales until translated.

## How to add or change a fact

1. Change `brand/content/facts.json` (owner approval for prices, terms, windows). 2. Change every sentence that states it (the checker lists the ones it finds).
3. If the Control Plane renders it, it reads the same file: nothing to copy. 4. `npm run pricing:check` compares plan numbers with `src/data/plans.ts` and the Control Plane.

## Claims discipline

* Every public product claim on Home, Product, Pricing, Questions and Data & Trust is listed with its evidence in `docs/claims-inventory-content-pass.md`.
* The evidence for behavior is the verified capability sheet (the code at the accepted commits); the wording rules in the copy deck are "safe wording" and "do not say".
* Illustrations (the demo, the rules demo, the dashboard preview, the Ask Reco panel) use invented sample products and numbers, each labelled "Sample data: not from a real store".
* The scanners: `copy:check` (phrases in every locale source), `content:check` (banned claims and UK spellings over every English string and the rendered English pages, fact consistency,
  FAQ integrity, no license-key contradiction, no count language, Control Plane parity with `--cp`).

## Brand guardrail: what AICC is (do not erode)

AICC (AI Commerce Copilot) is a **commerce recommendation and merchandising copilot**. WooCommerce is the **first supported platform** ("Available for WooCommerce"), not the permanent definition. **"Frequently Bought Together" must not be used as AICC's product category, primary positioning, umbrella descriptor, footer definition or brand identity**: it is the real heading of one storefront widget, and co-purchase counting is the first step of a fixed ranking chain (products bought together, then the same category, then the newest in-stock products; stock and deletion are filters; the merchant's rules apply last). Never claim several recommendation strategies (the engine's strategy presets are off), another platform, uplift or invented numbers. `npm run content:check` enforces this with a positional guard in every locale (hero, meta, share-image text, footer, "What is AICC?") and a reviewed allow-list; see `docs/fbt-usage-audit.md`.

## Positioning v3 (2026-10-19)

* **Home order**: hero (category cue + "Available for WooCommerce", one headline, one sentence, two CTAs, one quiet purchase-confidence line; about 50 visible words, `npm run density:check`) -> pillars strip (Better recommendations, Less manual merchandising, Visibility and control, one line and one anchor each) -> signature demo ("See what each recommendation is based on.") -> workspace (Understand, Control, Find opportunities, Ask Reco) -> how it works (Connect, learn, recommend, plus the loop strip) -> store safety -> pricing -> FAQ -> final CTA.
* **Demo**: the shopper and merchant views show the same sample relationship; the product the shopper ticked is marked in the merchant list; the merchant view carries an evidence layer labelled "How the list is built (illustration)" (bought together, then same category, then newest in stock, then your rules) and shows one row of each kind: two learned partners, one same-category row, one newest-in-stock row (a pinned product appears when you pin). The real product shows "Bought together N times" only for learned partners and a price only for fallbacks and pins; the replica dashboard blocks keep the real labels, and the demo tiles use the same sample numbers as the dashboard replica (3,860 / 241 / 97). Per-product text under the list is a NEUTRAL caption ("Why this product (illustration)"), never in Reco's voice: the real Reco cannot explain one specific pairing, so Reco appears once and points to the Recommendation Preview. The compare toggle is "WooCommerce related products | With AICC". On phones the caption is docked in the flow directly under the list (no sticky overlay). Sample counts are 9 and 6 (both take the Russian "раз" form).
* **Ask Reco mock**: a guided assistant, not a chat box: no text input, "Choose a question for Reco", the four real starter questions of a set-up store ("What should I focus on today?", "What is my biggest opportunity?", "Give me one quick win.", "What can you help me with?"), every answer labelled "Sample answer", and a footnote saying the real panel also has a text box (up to 300 characters, matched to fixed topics).
* **Accessibility control**: a quiet 44px icon button in the header bar at every width, named "Accessibility settings" (kit: `brand/js/a11y-trigger.js`).

## WordPress.org-ready install wording

The site must never assume ZIP-only installation, and must not claim a directory listing that does not exist yet. Today every install mention is generic: "install and activate the AICC plugin on your WooCommerce site" (Home "Connect" step, FAQ "What happens after I buy?"); it deliberately does not say "from your WordPress admin", which would imply Plugins > Add New or an in-admin upload. **When AICC is listed on WordPress.org**: (1) keep the generic sentence and add the directory path after it ("... search for AICC under Plugins > Add New"), (2) add a "Get the plugin" step that links to the directory page next to "Get started" in the Home Connect step and in `q62`, (3) update `q61` ("Available for WooCommerce") and the Terms/Privacy plugin-distribution wording with counsel, (4) re-check the "no license key" sentence against the directory build, (5) do not write "available in the WordPress plugin directory" anywhere until the listing is live. Until then the structure is ready: the Get started button is the only install entry point (`getStartedUrl(locale)` in `src/lib/site.ts`).

## Wording rules added by the truth and fresh-merchant reviews (2026-10-19)

* **No "why" per product.** The product has no per-product reason UI. Say "what is recommended and how often it is bought together"; the demo's basis column and rule chips are labelled illustrations.
* **Recommendations START from counting.** Never "every recommendation comes from counting your orders": fallbacks come from the catalog (relevant in-stock products, then newest in stock) and pins from a rule you set. Avoid "always"/"every" about the ranking. **Thin history is never described as "a same-category fallback"** (owner decision, 2026-10): say that AICC fills the remaining spots with relevant in-stock products from the merchant's own catalog (signals beyond past purchases), then the newest in-stock products, and that real pairs counted from orders take over as they arrive. Never imply AI, machine learning or embeddings for this (the cold-start semantic provider is disabled in the Backend). The word "category" stays only where it names WooCommerce's own related products (which really are same category or tags) or the plugin's own dashboard label.
* **The rules demo's no-count label is ours, not the plugin's.** The real Recommendation Preview shows a count for a learned partner and only a price for everything else (`admin-sync.js`, `class-aicc-catalog.php`); there is no "From the same category" label in the plugin. The Site illustration label `rules.evidence.fallback` therefore says "Relevant in-stock product from your catalog" (the tier it illustrates). `copy:check` and `content:check` fail on a public sentence that calls the thin-history fill a same-category fallback, makes an ML claim, or says WooCommerce lacks cart recommendations (`scripts/lib/launch-truth.mjs`, with self-test samples).
* **"Built for WooCommerce", not "available today".** The hero eyebrow stays "Available for WooCommerce" (a platform statement); q61/q64 say "built for WooCommerce" and "Today WooCommerce is the supported platform". Install wording never names a route ("from your WordPress admin") until the owner publishes one.
* **Define "copilot" once, in q01** (a guide that helps you act on your own data, not an autonomous agent; fixed rules, not a generative model; "merchandising" = which products appear next to which, on product and cart pages). q42 is in the Home FAQ selection (8 items).
* **Glosses on Home**: "learned partners" = products your orders show were bought together; "fallbacks" = relevant in-stock products from the catalog, then newest in-stock products (a fallback spot is not backed by a purchase count).
* **Reco is not the demo's narrator.** Reco appears in the demo once, pointing to the Recommendation Preview; per-product captions are neutral and about the sample.
* **Share image**: a neutral product-page bundle sketch (no Reco artwork, no chart or growth motif).
* **Footer**: "built for WooCommerce and is not affiliated with or endorsed by WooCommerce or WordPress" next to the trademark note.
