# AICC content pack

The canonical facts and FAQ of AICC, shared byte-for-byte by the marketing site (`ai_copilot_site`) and the Control Plane theme.
It travels with the brand kit: `brand/MANIFEST.json` lists every file here, `npm run brand:check` fails when the manifest is stale,
`node scripts/sync-brand-kit.mjs --verify <theme>` fails when a consumer differs, and
`npm run content:check -- --cp <theme dir>` compares just these files with the Control Plane copy.

**The rule: change facts and FAQ here first.** Never edit a copy in a consumer. Run `npm run brand:build`, review the diff, then sync.

| File | What it is |
|---|---|
| `facts.json` | Plans, prices, term, refund window, import window, attribution window, minimum orders for observations, widget limits, ranking order, rule semantics, banned-claim regexes and the UK-spelling list. Tests compare every rendered figure with it. Changing a value needs owner approval. |
| `faq.en.json` | The canonical English FAQ: layers, topics, per-page selections, the retired-id map and every question and answer. |
| `replica-labels.json` | The real plugin-admin labels that stay English inside es/ru replicas and prose (`labels`) and the plugin's own Hebrew labels (`he`). The kit wraps each English occurrence as a `lang="en"` leaf; see `brand/README.md`. Generates `brand/js/replica-labels.js`. |
| `header-nav.json` | The header contract: nav links (Product, Pricing, Questions, Account) in order, the Sign in and Get started actions, and where each goes (`/product/`, `/pricing/`, `/questions/`, `/my-account/`; `/<locale>` in front for he, es, ru). Labels live in `brand/i18n/strings.json` -> `<locale>.header`. The interaction test (site) and `run_content_consistency_tests.php` (Control Plane) hold each header to this file. |
| `faq.he.json`, `faq.es.json`, `faq.ru.json` | Translations. They hold **only** `q` and `a` per id (plus `reviewStatus` and optional layer/topic titles). Anything missing falls back to English. |

## `faq.en.json`

```jsonc
{
  "schema": 1, "locale": "en", "status": "canonical",
  "layers":  [{ "id": "sales", "title": "Before you decide" }, ...],      // 3: sales, product, account
  "topics":  [{ "id": "basics", "title": "The basics" }, ...],            // 9
  "selection": { "home": ["q41", ...], "product": [...], "pricing": [...], "questions": "all" },
  "retired": { "q07": { "mergedInto": "q51", "reason": "..." } },
  "items": { "q01": { "layer": "sales", "topic": "basics", "q": "...", "a": "...", "legalReview": true } }
}
```

* **Ids are stable forever** (`q01` ... `q56`). They are the public anchors (`/questions/#q41`). Never renumber and never reuse an id.
* **Layers** are the reader's stage (before you decide / how AICC behaves / plans, billing, data and policy); **topics** split a layer.
  Order on the Questions page: layer, then topic order, then order in the file.
* **`selection`** is which questions each page shows, in order. Only those Q&As are on the page and in that page's FAQPage JSON-LD.
  The Questions page shows every active question (`"all"`). The selection must only name active ids.
* **`retired`** maps an id that no longer exists to the question that now answers it. The site keeps the old anchor working
  (`#q07` opens `q51`). A retired id is never an `items` key and never appears in a selection or a translation.
* **`legalReview: true`** marks answers that state rights, retention, refunds or privacy. They are shown, but kept out of FAQPage JSON-LD until
  `NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=true` (a person with legal authority approved the wording).
* **Answers**: short direct answer first, useful explanation second. Paragraphs are separated by a blank line (`\n\n`). US English.
* **Link tokens**: inline links are written `[label](route:x)` where `x` is one of `product`, `pricing`, `questions`, `data-and-trust`, `privacy`,
  `terms`, `refund-policy`, `accessibility`. Each surface turns a token into its own URL (locale-aware on the site, a page link in the Control Plane).
  An absolute `https://` URL is also allowed. No other link form. `content:check` fails on an unknown route.

## Translations

`faq.<locale>.json` has the same shape for every locale:

```jsonc
{ "schema": 1, "locale": "he", "reviewStatus": "machine-draft; native review pending",
  "titles": { "layers": {}, "topics": {} },            // optional translated layer/topic titles
  "items": { "q03": { "q": "...", "a": "..." } } }     // ONLY q and a, only ids that exist in English
```

A translation may keep an entry only while the English meaning is unchanged. When you change an English answer in a way that changes its meaning,
**delete that id from every `faq.<locale>.json`** (Stage 2 retranslates it); a pure typo fix may keep it.

A question without a translation renders its English text marked `lang="en" dir="ltr"` with a small `EN` tag, on a page whose own `lang`
and `dir` stay correct. This is the explicit fallback mechanism; the same idea covers the site dictionaries (`src/i18n/merge.ts`) and the kit
string sets (`brand/i18n/strings.json` marks a set `_fallback: true`). `npm run i18n:check` reports how much falls back;
`npm run i18n:strict` fails until nothing does.

## Adding or changing things

* **A question**: append it to `faq.en.json` `items` with the next free `qNN`, a `layer` and a `topic`; add it to any page `selection` that should show it;
  mark `legalReview` if it states rights, retention, refunds or privacy; run `npm run content:check`.
* **Retiring a question**: remove the item, add it to `retired` with `mergedInto`, drop it from every selection and every translation file.
* **A fact** (price, window, limit): change `facts.json`, then every sentence that states it, and run `npm run content:check` and `npm run pricing:check`.
  The checker finds each figure in the copy by pattern, so a stale `$99` or `14-day` elsewhere fails the build.
* **A banned claim**: add its regex to `bannedClaims`. UK spellings go in `ukSpellings` (stems, matched at a word start).

After any change: `npm run brand:build` (regenerates `brand/i18n/strings.json` and `brand/MANIFEST.json`), then the checks, then sync.

## Brand guardrail: what AICC is (do not erode)

AICC (AI Commerce Copilot) is a **commerce recommendation and merchandising copilot**. WooCommerce is the **first supported platform** ("Available for WooCommerce"), not the permanent definition. **"Frequently Bought Together" must not be used as AICC's product category, primary positioning, umbrella descriptor, footer definition or brand identity**: it is the real heading of one storefront widget, and co-purchase counting is the first step of a fixed ranking chain (products bought together, then the same category, then the newest in-stock products; stock and deletion are filters; the merchant's rules apply last). Never claim several recommendation strategies (the engine's strategy presets are off), another platform, uplift or invented numbers. `npm run content:check` enforces this with a positional guard in every locale (hero, meta, share-image text, footer, "What is AICC?") and a reviewed allow-list; see `docs/fbt-usage-audit.md`.
