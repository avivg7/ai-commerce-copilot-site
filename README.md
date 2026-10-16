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
| `NEXT_PUBLIC_LEGAL_DRAFT_NOTICE` | on | `off` hides the "Draft: pending legal review" notices |
| `NEXT_PUBLIC_AICC_LEGAL_NAME`, `..._ADDRESS`, `..._SUPPORT_EMAIL`, `..._GOVERNING_LAW`, `..._PAYMENT_PROCESSOR`, `..._HOSTING_REGION` | unset | owner values; unset renders a visible `[... -- pending]` token |

## Checks

| Command | What it enforces |
|---|---|
| `npm run lint` | ESLint (Next core-web-vitals + TypeScript) |
| `npm run tokens:check` | `design/aicc-tokens.css` is byte-identical to the Control Plane theme copy (passes with a note if the peer is absent) |
| `npm run pricing:check` | prices and limits equal 99/1, 199/3, 499/10 and the Control Plane bootstrap file; no hard-coded prices in copy |
| `npm run i18n:check` | every key in en/he/es/ru, no untranslated values, placeholder/markup parity, terminology table, legal + FAQ structure |
| `npm run copy:check` | banned phrases (fabricated claims, "Start Free", "Trend", ...) in every locale source |
| `npm run contrast:check` | WCAG contrast of every token pair the components use |
| `npm run perf:check` | gzip first-load JS per route against the budgets (needs a build) |
| `npm run audit` | axe-core + structure + overflow on every page, locale and width (needs `serve:out`) |
| `npm run test:interaction` | keyboard walks, reduced motion, language persistence (needs `serve:out`) |
| `npm run og:build` / `npm run shots` | regenerate Open Graph images / visual evidence screenshots |

## Where things are

```
src/app/[[...slug]]/   one optional catch-all: root layout (html lang/dir) and the page switch
src/i18n/              config + one typed dictionary per language (en.ts is the contract)
src/data/              plans.ts (the only prices), faq.ts and legal.ts (structure + review flags)
src/components/ui      Button, Card/Badge/Banner/Container/SectionHeading/FormField, Accordion, PricingCard, Logo, RecoImage, ...
src/components/layout  Header, Footer, LanguageSwitcher, A11yControl, LanguageSuggestion
src/components/demo    FbtDemo (lazy)
src/styles             aicc.css (components), demo.css
design/aicc-tokens.css the shared design tokens (do not edit one copy only)
docs/AUTHORITY.md      who owns what; full architecture notes live in the Control Plane repo docs/unified-experience/site-architecture.md
```
