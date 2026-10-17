# AI Commerce Copilot: public website

The public marketing site for **AICC** (AI Commerce Copilot), a WooCommerce plugin that adds a Frequently Bought Together
widget learned from a store's own orders. Static export, four languages (English at the root, Hebrew right-to-left under `/he/`,
Spanish `/es/`, Russian `/ru/`).

**Stack:** Next.js 16 (App Router, `output: "export"`, built with webpack for the smaller client runtime), React 19, Tailwind 4
(reset only; components use the `--aicc-*` design tokens), TypeScript. No analytics, no third-party scripts, no runtime calls to
external services. Fonts are self-hosted by `next/font`. Hebrew uses the system Hebrew stack until a self-hosted OFL Hebrew face
(Heebo) is bundled.

Before touching code read `AGENTS.md`: this Next.js has breaking changes; the guides in `node_modules/next/dist/docs/` win.

## Run it

```bash
npm install
npm run dev -- -p 3011          # dev server (3010 is used by another project)
npm run build                   # static export into out/
npm run serve:out -- --port 3011   # serve out/ locally (add --prefix /ai-commerce-copilot-site for a GitHub Pages path)
```

`npm run build` uses base path `/ai-commerce-copilot-site` (GitHub Pages). For a domain root: `AICC_BASE_PATH="" npm run build`.

## Configuration (build-time environment)

| Variable | Default | Purpose |
|---|---|---|
| `AICC_BASE_PATH` | `/ai-commerce-copilot-site` in production, empty in dev | URL prefix of the deployment |
| `SITE_URL` | `https://copilt.org` | origin for canonical, hreflang, sitemap and Open Graph URLs |
| `NEXT_PUBLIC_AICC_ACCOUNT_URL` | `https://copilt.org/my-account/` | the single "Get started" destination (`?plan=solo|studio|agency` is added on plan buttons) |
| `NEXT_PUBLIC_AICC_DEMO_VIDEO`, `..._POSTER`, `..._CAPTIONS` | unset | the Watch demo video; unset shows a labelled placeholder (a `launch:check` blocker). No fake footage |
| `NEXT_PUBLIC_LEGAL_REVIEW_APPROVED` | unset | `true` only after a lawyer approves the legal text: removes the draft notices and lets flagged FAQ answers into JSON-LD |
| `NEXT_PUBLIC_LEGAL_DRAFT_NOTICE` | on | `off` hides the draft pills (screenshots only); `launch:check` still fails without approval |
| `NEXT_PUBLIC_AICC_LEGAL_NAME`, `..._ADDRESS`, `..._SUPPORT_EMAIL`, `..._GOVERNING_LAW`, `..._PAYMENT_PROCESSOR`, `..._HOSTING_REGION` | unset | owner values; unset renders one plain "will be published before launch" line |

## Checks

| Command | What it enforces |
|---|---|
| `npm run lint` | ESLint (Next core-web-vitals + TypeScript) |
| `npm run tokens:check` | `brand/aicc-tokens.css` is byte-identical to the Control Plane theme copy (passes with a note if the peer is absent; FAILS until the theme is synced from the kit) |
| `npm run brand:check` | `brand/i18n/strings.json` and `brand/MANIFEST.json` are current (`npm run brand:build` regenerates them) |
| `npm run test:visual-contract` | computed-style, placement, behaviour and pixel parity against the live copilt.org for the site and the Control Plane (`:site` = site only) |
| `npm run pricing:check` | prices and limits equal 99/1, 199/3, 499/10 and the Control Plane bootstrap file; no hard-coded prices in copy |
| `npm run i18n:check` | every translated unit in he/es/ru is valid (placeholders, markup, terminology, register) and every untranslated unit is an explicit `lang="en"` fallback; reports how much falls back. `npm run i18n:strict` fails until nothing does |
| `npm run content:check` | the content pack (`brand/content`): banned claims, UK spellings, fact consistency with `facts.json`, FAQ integrity, no apologetic phrasing outside legal pages, rendered English pages; `-- --cp <theme dir>` verifies Control Plane byte parity |
| `npm run fallback:check` | on every he/es/ru page, English text is only ever shown inside an element marked `lang="en"` (needs `serve:out`) |
| `npm run lang:check` | on every he/es/ru page, translated text never sits under `lang="en"` and Hebrew never under `dir="ltr"` (WCAG 3.1.2; needs `serve:out`) |
| `npm run test:rules` | the demos' rule engine (`brand/js/rules-core.js`) ranks exactly like the backend policy in all 32,500 rule combinations (an independent literal port of `recommendation_policy.py`) |
| `npm run axe:check` | axe-core on Home, Product, Pricing, Questions and Data & Trust at 1280/768/390/360/320 in default, Enhanced contrast and reduced-motion modes (needs `serve:out`) |
| `npm run shots:content` | the content-pass screenshots at 1280 and 390 (needs `serve:out`) |
| `npm run copy:check` | banned phrases (fabricated results, free-tier and urgency claims, unshipped features) in every locale source, plus `docs/` and this file |
| `npm run contrast:check` | WCAG contrast of every token pair the components use, including the sampled primary-button, headline and eyebrow treatments, and the guard that `.aicc-text-gradient` stays on display text (all real pass/fail, no exceptions list) |
| `npm run perf:check` | gzip first-load JS per route against the budgets (needs a build) |
| `npm run audit` | axe-core + structure + overflow on every page, locale and width (needs `serve:out`) |
| `npm run test:interaction` | keyboard walks, reduced motion, language persistence (needs `serve:out`) |
| `npm run launch:check` | what would be published pending, drafted or unapproved (`--strict` fails) |
| `npm run og:build` / `npm run shots` / `npm run shots:brand` | regenerate Open Graph images / visual evidence screenshots |

## Where things are

```
src/app/[[...slug]]/   one optional catch-all: root layout (html lang/dir) and the page switch
src/i18n/              config + one typed dictionary per language (en.ts is the contract)
src/data/              plans.ts (the only prices), faq.ts and legal.ts (structure + review flags)
src/components/ui      Button, Card/Badge/Banner/Container/SectionHeading/FormField, Accordion, PricingCard, Logo, RecoImage, ...
src/components/layout  Header, Footer, LanguageSwitcher, A11yControl, LanguageSuggestion
src/components/brand   thin wrappers around the brand kit (RecoHero, LangMenu, FbtSection, WatchDemo, BrandInit)
src/styles             aicc.css (components), demo.css
brand/                 the shared BRAND KIT (tokens, CSS, vanilla JS modules, assets, strings, MANIFEST): see brand/README.md
design/source/         original Reco PNGs
docs/AUTHORITY.md      who owns what; full architecture notes live in the Control Plane repo docs/unified-experience/site-architecture.md
```
