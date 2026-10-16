# AICC brand kit

One authoritative source of the AICC look and the interactive components, consumed **byte-identically** by two surfaces:

| Surface | How it consumes the kit |
|---|---|
| Marketing site (`ai_copilot_site`, this repo) | `src/app/globals.css` imports `brand/aicc-tokens.css` and `brand/aicc-brand.css`; thin React wrappers (`src/components/brand/*`) render kit markup and call `brand/js/index.js` (`initBrand`). `scripts/publish-brand-assets.mjs` copies `brand/assets/*` to `public/brand-kit/` before dev/build (git-ignored). |
| Control Plane WordPress theme (`aicc-admin`) | `node scripts/sync-brand-kit.mjs --to <theme dir>` copies the kit to `<theme>/assets/brand/**` and the token file to `<theme>/assets/css/aicc-tokens.css`. The theme enqueues the two CSS files and the module, and renders the markup contract below. Never edit the copies; change the kit here and re-sync. |

The **live public site (https://www.copilt.org/) is the visual source of truth**. Values marked "live" were measured from its computed styles, and
`npm run test:visual-contract` keeps them honest (see Contract tests).

## Files

```
aicc-tokens.css   design tokens (colour, type, space, motion) + the exact legacy button gradient/shadow/hover, glass, header, eyebrow tokens;
                  the user-preference modes (data-aicc-motion / -contrast / -text) live here. AA-safe variants sit under data-aicc-contrast="high".
aicc-brand.css    vanilla CSS, logical properties only: .aicc-btn (+--primary --secondary --ghost --quiet --outline, --sm/--lg/--block), .aicc-glass,
                  .aicc-text-gradient, .aicc-eyebrow-pill, .aicc-hero-title/-lead/-note/-actions, .aicc-fade-up, .aicc-site-header*, .aicc-navlink, .aicc-iconbtn,
                  .aicc-lang*, .aicc-reco-hero*, .aicc-modal*, .aicc-fbt*
js/               framework-free ES modules (no build step): index.js (initBrand), header-scroll.js, lang-menu.js, lang-store.js, reco-hero.js, video-modal.js,
                  fbt-demo.js, motion.js, icons.js (generated from Lucide, ISC licence, by scripts/build-brand-icons.mjs)
assets/           reco-hero.mp4, reco-hero-poster.jpg, reco-hero.webp (restored byte-identical from git main: sha256 verified equal to the live URLs),
                  the logomark, favicon + icons, the Reco poses
i18n/strings.json GENERATED from the typed dictionaries (src/i18n/*.ts) by `npm run brand:strings`: language names, header/button labels, chip labels,
                  modal strings, the full demo strings, in en/he/es/ru
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
- Body must use `-webkit-font-smoothing: antialiased` (the kit sets it on `html`) and the Geist font stack, or glyphs differ from the live site.

## Updating the kit

1. Edit files in `brand/` (words only in `src/i18n/*.ts`; then `npm run brand:strings`).
2. `npm run brand:build` (regenerates strings.json and MANIFEST.json); `npm run brand:check` verifies both are current.
3. `npm run test:visual-contract:site` (site vs live) and the usual checks.
4. Deliver: `node scripts/sync-brand-kit.mjs --to "<...>/wp-content/themes/aicc-admin"` then `node scripts/sync-brand-kit.mjs --verify "<same dir>"`.

## Contract tests

- `npm run tokens:check`: `brand/aicc-tokens.css` equals the theme's `assets/css/aicc-tokens.css` byte for byte (fails until the theme is synced).
- `node scripts/sync-brand-kit.mjs --verify <theme dir>`: every kit file in the theme equals `MANIFEST.json`. The Control Plane repo's `tests/run_brand_kit_parity_tests.php` should do the same hash comparison against the site's manifest.
- `npm run test:visual-contract` (`:site` for the site only): loads the live site, the new site build and the Control Plane (`AICC_CP_URL`, default http://127.0.0.1:8982; path `AICC_CP_PATH`) and asserts, per surface and role, computed styles within stated tolerances
  (colour channels +-2, lengths +-0.6px, element screenshots <= 0.5% differing pixels with the label text normalised and a +-2px alignment search; chips compare their paint with the label hidden), visibility and placement (video inside the hero, FBT directly after the hero, no blank gap), and behaviour (hover lift, scrolled header, modal, language menu, FBT interaction).

## Documented deviations from the live site (owner-visible; nothing else may differ)

1. **Truthful chip labels**: `Order history`, `Click rate`, `Recommendations`, `Insights`, `Bundles` (live: `+ Revenue`, `CTR 18.6%`, which are unsupportable claims). Composition, positions, motion and icons are unchanged.
2. **Copy**: the truthful new copy (no "Start Free", no "No credit card required"); the headline's last words ("buy together.") carry the gradient.
3. **Focus ring**: an accessible 2px blue ring (>= 3:1), not the legacy cyan ring.
4. **Contrast caveat (owner-mandated look, reported honestly)**: white on the `#10b981` end of the legacy button gradient is **2.54:1**; the headline gradient text is below 4.5:1 at its cyan end; the eyebrow pill (`#2563eb` on an 8% navy tint) is **4.32:1**. The default look is the legacy one, exactly. The first-party **Enhanced contrast** preference (`data-aicc-contrast="high"`) swaps in the AA-safe variants (button gradient `#2563eb -> #047857`, solid dark headline text, darker pill text). `npm run contrast:check` lists these as "KNOWN" and `npm run audit` proves 0 axe violations in Enhanced contrast; the accessibility statement lists the limitation.
5. **`backdrop-filter`**: the live `.glass` only ships `-webkit-backdrop-filter`, so Chrome paints no blur on the glass buttons and chips. The kit ships the same (`-webkit-backdrop-filter: blur(16px)` only). The header's blur is the real `backdrop-filter: blur(24px)`.
6. **`translate` not `transform`** for the hover lift (Tailwind 4 uses the `translate` property, so computed `transform` stays `none`; the kit matches).
7. **Nav link targets are 44px tall** (live: 20px text only); the text, size, weight and colour are the live values. Chips and the eyebrow pill keep the live 12px text.
8. **Chips pixel check** compares paint with the label hidden because glyph baselines round differently by sub-pixel between the two pages; the chip's font, colour and size are asserted equal separately.

## Licences

Lucide icons (ISC) are embedded in `js/icons.js`. Geist and Heebo (SIL OFL) are loaded by the host surface, not the kit.
