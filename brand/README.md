# AICC brand kit

One authoritative source of the AICC look and the interactive components, consumed **byte-identically** by two surfaces:

| Surface | How it consumes the kit |
|---|---|
| Marketing site (`ai_copilot_site`, this repo) | `src/app/globals.css` imports `brand/aicc-tokens.css` and `brand/aicc-brand.css`; thin React wrappers (`src/components/brand/*`) render kit markup and call `brand/js/index.js` (`initBrand`). `scripts/publish-brand-assets.mjs` copies `brand/assets/*` to `public/brand-kit/` before dev/build (git-ignored). |
| Control Plane WordPress theme (`aicc-admin`) | `node scripts/sync-brand-kit.mjs --to <theme dir>` copies the kit to `<theme>/assets/brand/**` and the token file to `<theme>/assets/css/aicc-tokens.css`. The theme enqueues the two CSS files and the module, and renders the markup contract below. Never edit the copies; change the kit here and re-sync. |

The **live public site (https://www.copilt.org/) is the visual source of truth** for geometry, shadow, type, glass, header, hero, chips, language control, modal and FBT. Values marked "live" were measured from its computed styles, and
`npm run test:visual-contract` keeps them honest (see Contract tests). The ONE exception is three colour treatments that carry text (primary button gradient, headline gradient, eyebrow text colour): their source of truth is `contract-baseline.json`, because the live values fail WCAG AA.

## Files

```
aicc-tokens.css   design tokens (colour, type, space, motion) + the button shadow/hover, glass, header, eyebrow tokens and the AA colour treatments;
                  the user-preference modes (data-aicc-motion / -contrast / -text) live here. Enhanced contrast (data-aicc-contrast="high") is a STRONGER optional mode.
contract-baseline.json  the accessible values of the primary-button gradient, headline gradient and eyebrow colour (test baseline, see below);
aicc-brand.css    vanilla CSS, logical properties only: .aicc-btn (+--primary --secondary --ghost --quiet --outline, --sm/--lg/--block), .aicc-glass,
                  .aicc-text-gradient, .aicc-eyebrow-pill, .aicc-hero-title/-lead/-note/-actions, .aicc-fade-up, .aicc-site-header*, .aicc-navlink, .aicc-iconbtn,
                  .aicc-lang*, .aicc-reco-hero*, .aicc-modal*, .aicc-fbt*, .aicc-rules*, .aicc-dash*, .aicc-ask*, .aicc-flow*
js/               framework-free ES modules (no build step): index.js (initBrand), header-scroll.js, lang-menu.js, lang-store.js, reco-hero.js, video-modal.js,
                  fbt-demo.js (shopper view + merchant view), rules-demo.js + rules-core.js (the four merchant rules), dash-preview.js (dashboard replica),
                  reco-ask.js (Ask Reco panel mockup), flow.js (safety/measurement flow diagrams), loop.js (the merchandising loop strip), tabs.js (tabbed workspace),
                  faq-search.js (client-side FAQ filter), motion.js,
                  icons.js (generated from Lucide, ISC licence, by scripts/build-brand-icons.mjs)
content/          the CANONICAL CONTENT PACK shared with the Control Plane: facts.json, faq.en.json, faq.<locale>.json. See content/README.md. Change facts and FAQ here first.
assets/           reco-hero.mp4, reco-hero-poster.jpg, reco-hero.webp (restored byte-identical from git main: sha256 verified equal to the live URLs),
                  the logomark, favicon + icons, the Reco poses
i18n/strings.json GENERATED from the typed dictionaries (src/i18n/*.ts) by `npm run brand:strings`: language names, header/button labels, chip labels,
                  modal strings and the kit string sets (demo, rules, dash, ask, flows), in en/he/es/ru. A set that is not translated yet is English with
                  `"_fallback": true`; a module that sees it marks its container lang="en" dir="ltr". `needsTranslation` lists those sets per locale.
MANIFEST.json     SHA-256 and size of every file; the contract both surfaces verify
```

## Markup contract (what a surface must render; behaviour is added by `initBrand()`)

- **Header**: `<header class="aicc-site-header" data-aicc-header>` > `.aicc-site-header__bar` (logo `a.aicc-site-header__logo`, `nav.aicc-site-header__nav > ul.aicc-site-header__links > li > a.aicc-navlink`, `.aicc-site-header__actions`),
  menu button `button[data-aicc-menu-btn][aria-controls][aria-expanded]` and panel `[data-aicc-menu-panel][hidden]`. The module sets `data-scrolled` after 12px of scroll and `data-menu-open`.
  Anonymous: `Sign in` (`.aicc-btn--quiet`) + `Get started` (`.aicc-btn--primary`). Signed in: no `Get started`; a quiet `Plans & Stores` pill (secondary/glass) instead.
- **Language control**: the string returned by `renderLangMenuHTML({...})` (one compact `.aicc-lang`: globe + code + chevron, a menu of four real links with `lang`/`hreflang`, `aria-current`). The button's accessible name is "Language: English, EN" (it must contain its visible code as a word, WCAG 2.5.3). `data-persist` stores the choice (the Control Plane leaves it off and keeps its URL-prefix logic). Mobile: add `aicc-lang--block`.
- **Reco hero**: `renderRecoHeroHTML({ labels: [5 strings], assets: { video, poster } })`. The video is `preload="metadata"`, has no `autoplay` attribute (played only while 25% in view and motion is allowed), poster first. Put the poster in a `<link rel=preload as=image fetchpriority=high>`.
- **Watch demo**: `<button class="aicc-btn aicc-btn--secondary aicc-btn--lg" data-aicc-demo-trigger data-locale data-strings='{modal strings JSON}' data-demo-video data-demo-poster data-demo-captions>`. No video configured => the labelled placeholder (`[data-demo-placeholder]`), never footage.
- **FBT demo**: `<div data-aicc-fbt data-locale data-dir data-strings='{demo strings JSON}' aria-busy="true">` (reserve ~44rem/36rem min-height). It mounts lazily when near the viewport; `data-strings` is `strings.json[locale].demo`.
  Two controls over the SAME sample bundle: **Plain related products | With AICC** (a segmented pill; opens on "With AICC", the result first; the plain state draws WooCommerce's own related-products block: a heading and product tiles, no ticks, total or button)
  and **What shoppers see | What you see** (underlined text tabs; the merchant side: for each listed product "Bought together N times" or a no-count note, a rule select per product with the real ranking policy of `rules-core.js`, the list the shopper sees RIGHT NOW,
  the dashboard tiles that record the add-to-cart, one observation and one Ask Reco line, both computed from the rules so neither promotes an excluded product). A live result line under the toggles states in one sentence what the current state shows.
  Everything is labelled "Sample data: not from a real store". There are no Strong/Medium/Light tiers: they are not in the product.
- **Rules demo** ("Control, not a black box"): `<div class="aicc-rules aicc-rules--placeholder" data-aicc-rules data-locale data-dir data-strings='{rules strings JSON}' aria-busy="true">` (the placeholder class reserves the height).
  A product select, four toggle buttons (Pin, Prefer, Deprioritize, Exclude; `aria-pressed`), Reset, and one polite live region. Semantics from `rules-core.js`, mirrored from the product: Exclude is a hard filter and always wins;
  out-of-stock and deleted products stay out even when pinned; Pin forces the first place (several pins: most recent first); Prefer and Deprioritize nudge exactly one place and never past a product of another group.
- **Dashboard preview**: `renderDashPreviewHTML(strings.dash, { locale, variant: "compact" | "full", widget: bool, callouts: bool })` returns server-renderable markup (the site) and `mountDashPreview` fills `[data-aicc-dash]` (the theme).
  Real labels: Recommendation Views, Recommendation Clicks, Recommendation Click Rate, Bundle Add-To-Carts, Associated Orders, Associated Revenue, Merchant Insights, Recommendation Preview. Always labelled as sample data.
- **Ask Reco panel**: `renderRecoAskHTML(strings.ask, { assetsBase })` (markup contains `data-aicc-ask data-aicc-ssr`; `initBrand` wires the two sample-question buttons). A picture of the panel with two sample questions; the input is decorative.
- **Flow diagrams** (plain markup; no JavaScript, so the Control Plane can write it by hand or call `renderFlowHTML`):
  ```html
  <figure class="aicc-flow" data-kind="order|down|inactive|measure|history">
    <figcaption class="aicc-flow__title">When an order is placed</figcaption>
    <ol class="aicc-flow__steps">
      <li class="aicc-flow__step" data-step="1"><span class="aicc-flow__icon">svg</span><span class="aicc-flow__text">Order placed</span></li>
      <!-- three steps; the arrows between them are drawn by CSS and flip in RTL -->
    </ol>
    <p class="aicc-flow__note">Placing an order never waits on AICC.</p>
  </figure>
  ```
  The words are in `strings.json[locale].flows` (`order`, `down`, `inactive`).
- **Loop strip**: `renderLoopHTML(strings.loop, { links })` returns `<nav class="aicc-loop" data-aicc-loop aria-label>` with an ordered list of seven steps (`.aicc-loop__step > a > .aicc-loop__n + .aicc-loop__t`); a link may be `{ href, tab }` (the click also selects that tab of a tabbed workspace).
  `initBrand` adds a quiet sequential highlight when the strip scrolls into view (skipped under reduced motion). Words: `strings.json[locale].loop`.
- **Tabs** (a tabbed workspace, ARIA tabs pattern): `<div class="aicc-tabs" data-aicc-tabs data-selected="<tab id>">` containing `<div class="aicc-tabs__list" role="tablist" aria-label hidden>` with `button.aicc-tabs__tab[role=tab][id][aria-controls][aria-selected][tabindex]`
  and a `div.aicc-tabs__stack` holding one `section.aicc-tabs__panel[role=tabpanel][id][aria-labelledby][tabindex=0]` per tab, each starting with `<h3 class="aicc-tabs__ph">`. On wide screens the panels share one grid cell (the workspace keeps the height of its tallest panel, inactive panels are
  `visibility:hidden` and `inert`, via `data-inactive`); on narrow screens inactive panels get the `hidden` attribute. (Do not rely on `hidden` on wide screens: Tailwind's preflight `[hidden]{display:none!important}` lives in a lower layer and beats any unlayered rule.) Without JavaScript the list stays hidden and every panel shows under its heading; with it the list appears and one panel shows
  (arrow keys follow the reading direction, Home/End, roving tabindex, cross-fade that is instant under reduced motion). Lazy modules inside hidden panels (the rules demo) mount when their tab opens.
- **Merchant Insights cards**: `renderInsightsHTML(strings.dash, { locale })`: the four kinds the product can show (Hot Product Detected, Strong Bundle Opportunity, High Interest Low Conversion, Top Recommendation) as sample cards with the 10-order gate.
- **FAQ search** (`faq-search.js`, strings `strings.json[locale].faqSearch`): `<div data-aicc-faq-search data-locale data-dir data-strings='...' data-target="#faq-browse" data-hide="#faq-top">` next to a container of `<details id="qNN">` items
  (optionally in `[data-faq-group]` topic wrappers). It injects a labelled `input[type=search]` in a `form[role=search]`, a polite result-count region and an empty state with a Clear button. Client-side only: nothing is sent or stored;
  the query lives in the input and in `?q=` (`history.replaceState`); matching is case- and diacritic-insensitive over question and answer text (all words must match); `#qNN` links clear a filter that would hide them. Without JavaScript the page is the plain full list. Details: a query shorter than 2 characters does not filter; the result count is visible under the field (and announced once, after a 450 ms pause in typing); `data-hide` takes several selectors (the duplicate "most asked" block and the topic chips are hidden while filtering);
  topic wrappers with no match are hidden; the empty state has its own single Clear button; `?q=` scrolls the field into view.
- **Hero pause control**: `renderRecoHeroHTML({ labels, assets, motion: { pause, play } })` adds a 44px `button[data-aicc-pause][aria-pressed]` (WCAG 2.2.2) that pauses the looping video and the floating chips (`data-paused` on `.aicc-reco-hero`); hidden when motion is already off. The chips are `aria-hidden` (they repeat page copy).
- **Real admin labels are `lang="en"` leaves (WCAG 3.1.2)**: the plugin admin is English-only in es and ru, so a replica in those locales shows labels such as `Recommendation Views`, `Merchant Insights`, `Recommendation Preview`, `Pin`, `Prefer`, `Deprioritize`, `Exclude`, `Bought together {n} times` in English inside translated text. Each occurrence must be its own element `<span lang="en" dir="ltr" class="aicc-admin-label">label</span>` (an `<option>` whose whole text is a label gets `lang="en" dir="ltr"`), and the words around it must NOT sit under `lang="en"`. The list is `content/replica-labels.json` (`labels`; generated `js/replica-labels.js`); `{n}` matches the number that replaced it. JS renderers get this from `labeler(strings, { locale })` in `js/motion.js` (`T()` for HTML text, `A()` for `<option>`); it is off for `en` and for an English fallback (`_fallback`), and finds nothing to wrap in `he` (see below). **Hebrew**: the plugin admin is translated, so the he replicas use the Hebrew labels of `replica-labels.json` `he` (from the plugin `.po`) and wrap nothing. **PHP ports (Control Plane)** must do the same at the leaf: after escaping a replica string for a non-English, non-Hebrew locale, replace each label (longest first, case-sensitive, not adjacent to a letter) with `<span lang="en" dir="ltr" class="aicc-admin-label">...</span>`; the site's `lang:check` shows the expected markup.
- **Translation fallback in every module**: when `strings._fallback === true` the container gets `lang="en" dir="ltr"` so English text is never presented as the page language; when the strings are translated on a non-English page the container gets its own `lang`/`dir` (so a block inside a still-English wrapper resets the language, WCAG 3.1.2).
- Body must use `-webkit-font-smoothing: antialiased` (the kit sets it on `html`) and the Geist font stack, or glyphs differ from the live site.

## Updating the kit

1. Edit files in `brand/` (words only in `src/i18n/*.ts`, facts and FAQ only in `brand/content/`; then `npm run brand:strings`).
2. `npm run brand:build` (regenerates strings.json and MANIFEST.json, which now also covers `content/`); `npm run brand:check` verifies both are current.
   `npm run content:check` verifies the pack and the English copy against it; add `-- --cp "<theme dir>"` to compare the theme's `assets/brand/content/` byte for byte.
3. `npm run test:visual-contract:site` (site vs live) and the usual checks.
4. Deliver: `node scripts/sync-brand-kit.mjs --to "<...>/wp-content/themes/aicc-admin"` then `node scripts/sync-brand-kit.mjs --verify "<same dir>"`.

## Contract tests

- `npm run tokens:check`: `brand/aicc-tokens.css` equals the theme's `assets/css/aicc-tokens.css` byte for byte (fails until the theme is synced).
- `node scripts/sync-brand-kit.mjs --verify <theme dir>`: every kit file in the theme equals `MANIFEST.json`. The Control Plane repo's `tests/run_brand_kit_parity_tests.php` should do the same hash comparison against the site's manifest.
- `npm run test:visual-contract` (`:site` for the site only): loads the live site, the new site build and the Control Plane (`AICC_CP_URL`, default http://127.0.0.1:8982; path `AICC_CP_PATH`) and asserts, per surface and role, computed styles within stated tolerances against the live site (except the three accessible colour treatments, which are compared with `contract-baseline.json`, and the primary-button screenshot, which is the live button with only its gradient replaced by the baseline)
  (colour channels +-2, lengths +-0.6px, element screenshots <= 0.5% differing pixels with the label text normalised and a +-2px alignment search; chips compare their paint with the label hidden), visibility and placement (video inside the hero, FBT directly after the hero, no blank gap), behaviour (hover lift, scrolled header, modal, language menu, FBT interaction), and the contrast of the rendered pixels (button white text >= 4.5:1 along its whole gradient, default and hovered, at 1440/390/360; headline worst stop >= 3:1 against the real backdrop; eyebrow >= 4.5:1 on the composited pill).

## Documented deviations from the live site (owner-visible; nothing else may differ)

1. **Truthful chip labels**: `Order history`, `Click rate`, `Recommendations`, `Insights`, `Bundles` (live: `+ Revenue`, `CTR 18.6%`, which are unsupportable claims). Composition, positions, motion and icons are unchanged.
2. **Copy**: the truthful new copy (no "Start Free", no "No credit card required"); the headline's last words ("buy together.") carry the gradient.
3. **Focus ring**: an accessible 2px blue ring (>= 3:1), not the live cyan ring.
4. **Accessible colour treatments (WCAG 2.2 AA in the DEFAULT look)**: the primary button gradient ends on `#05865f` instead of the live `#10b981` (white text: **4.58:1** at its end, 5.17:1 at its start; everything else about the button, including blue to green, radius, shadow, lift and type, is the live value); the headline gradient is `linear-gradient(100deg, #2563eb, #05865f 55%, #0b86a6)` (worst stop **4.03:1** on `#f8fafc`, **3.71:1** on the tinted hero; large display text only, >= 24px, enforced by `contrast:check` and the interaction tests); the eyebrow pill text is `#1f55d6` (**5.26:1** on `#f8fafc`, **4.86:1** on the tinted hero) on the unchanged live pill background. These values live in `contract-baseline.json`; `npm run test:visual-contract` compares them against that file (not the live site) and measures the contrast of the rendered pixels. The first-party **Enhanced contrast** preference (`data-aicc-contrast="high"`) is a stronger optional mode on top: button gradient `#2563eb -> #047857`, solid dark headline text, darker pill and link text, stronger borders. Nothing relies on it for AA.
5. **`backdrop-filter`**: the live `.glass` only ships `-webkit-backdrop-filter`, so Chrome paints no blur on the glass buttons and chips. The kit ships the same (`-webkit-backdrop-filter: blur(16px)` only). The header's blur is the real `backdrop-filter: blur(24px)`.
6. **`translate` not `transform`** for the hover lift (Tailwind 4 uses the `translate` property, so computed `transform` stays `none`; the kit matches).
7. **Nav link targets are 44px tall** (live: 20px text only); the text, size, weight and colour are the live values. Chips and the eyebrow pill keep the live 12px text.
8. **Chips pixel check** compares paint with the label hidden because glyph baselines round differently by sub-pixel between the two pages; the chip's font, colour and size are asserted equal separately.

9. **Secondary (glass) button boundary**: a 1px slate-500 border (`contract-baseline.json` `secondaryButton`, 4.76:1) instead of the live translucent white one, so the button has a visible boundary (WCAG 1.4.11). Nothing else about it changes.
10. **Reco hero on phones**: the square frame is shortened to 16:10 below 40rem (the live site leaves a ~400px near-empty band around the 16:9 video); desktop geometry is the live one. A Pause/Play control is added (see the markup contract).
11. **Language button**: no `aria-haspopup` (the popup is a disclosure of links, not a menu); `aria-expanded` and `aria-controls` stay.
12. **Placement**: the loop strip band may sit between the hero and the demo, so the demo starts within 1300px of the page top (was 1100px).

## Licences

Lucide icons (ISC) are embedded in `js/icons.js`. Geist and Heebo (SIL OFL) are loaded by the host surface, not the kit.
