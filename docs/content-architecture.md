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

The English pass changed meaning in many places, so the existing Hebrew, Spanish and Russian text cannot be trusted unit by unit. The mechanism (`src/i18n/merge.ts`, `src/data/faq.ts`):

1. `en.ts` is the contract. `he.ts`, `es.ts` and `ru.ts` are *partial*: they keep only strings whose English meaning is unchanged.
2. At load, every missing string is taken from English **per unit** (a page section, one legal section, one kit string set), never string by string, so a block never mixes two languages.
3. The renderer marks fallback blocks `lang="en" dir="ltr"` (`fbProps()`), the kit modules do the same when their strings carry `_fallback: true`, and fallback FAQ questions
   also show a small `EN` tag. The page's own `<html lang>` and `dir` stay the page language.
4. `npm run i18n:check` validates every translated unit and asserts the mechanism (fallback units render English and are marked, translated units are not).
   It prints how much falls back. `npm run i18n:strict` fails while any unit or question falls back: that is the Stage 2 completion gate.
5. Translating a unit means adding it to the locale file (a complete unit) or the FAQ translation file; the fallback disappears by itself.

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
