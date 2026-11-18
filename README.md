# AI Commerce Copilot: public website

The public marketing site for **AICC** (AI Commerce Copilot), a commerce recommendation and merchandising copilot,
available for WooCommerce (its storefront widget is headed "Frequently Bought Together"; that phrase names the widget, never the product: `docs/fbt-usage-audit.md`). Static export, four languages (English at the root, Hebrew right-to-left under `/he/`,
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
| `SITE_URL` | `https://www.copilt.org` | origin for canonical, hreflang, sitemap and Open Graph URLs (the canonical public host is `www`; the apex only redirects to it) |
| `NEXT_PUBLIC_AICC_ACCOUNT_URL` | `https://www.copilt.org/my-account/` | the English "Get started" / "Sign in" destination; he, es and ru insert `/he/`, `/es/`, `/ru/` before the last path segment (`https://www.copilt.org/he/my-account/`); `?plan=solo|studio|agency` is added on plan buttons |
| `NEXT_PUBLIC_DEMO_VIDEO_SRC`, `..._POSTER`, `..._CAPTIONS`, `..._CAPTIONS_LANG` | unset | the Watch demo video (prepared, not enabled): unset shows a labelled placeholder (a `launch:check` blocker); set renders an accessible `<video controls>` with poster and captions. No fake footage. How to enable: `docs/watch-demo-video.md` (the older `NEXT_PUBLIC_AICC_DEMO_VIDEO`, `_POSTER`, `_CAPTIONS` names still work) |
| `NEXT_PUBLIC_AICC_STRUCTURED_OFFERS` | unset (off) | `on` publishes Offer/price JSON-LD (plan prices in `SoftwareApplication.offers`); leave unset until real public checkout is live (owner decision). `seo:check` fails on any Offer/price schema while it is off |
| `NEXT_PUBLIC_LEGAL_REVIEW_APPROVED` | unset | `true` only after a lawyer approves the legal text: removes the draft notices and lets flagged FAQ answers into JSON-LD |
| `NEXT_PUBLIC_LEGAL_DRAFT_NOTICE` | on | `off` hides the draft pills (screenshots only); `launch:check` still fails without approval |
| `NEXT_PUBLIC_AICC_LEGAL_NAME`, `..._ADDRESS`, `..._SUPPORT_EMAIL`, `..._GOVERNING_LAW`, `..._PAYMENT_PROCESSOR`, `..._HOSTING_REGION` | unset | owner values; unset renders one calm "To be confirmed before purchases open." line (pre-commercial truth, `docs/cutover/pre-commercial.md`) |
| `NEXT_PUBLIC_AICC_COMMERCE_OPEN` | unset (CLOSED) | `true` only when commercial checkout opens (set together with the Control Plane owner fact `AICC_COMMERCE_OPEN`): closed shows "Purchases open soon" instead of every purchase button and band; `launch:check` reports it |
| `NEXT_PUBLIC_AICC_EARLY_ACCESS`, `NEXT_PUBLIC_AICC_EARLY_ACCESS_URL` | unset (OFF) | Early Access campaign (Production 20), separate from checkout: `announce` or `open` renders the fixed-end offer (ends 2027-01-01 00:00 Asia/Jerusalem = 2026-12-31 22:00 UTC); any other value is OFF; a build at or after the cutoff ignores it. `open` needs the Control Plane request flow (`..._URL`). `docs/cutover/early-access.md` |
| `NEXT_PUBLIC_AICC_EA_EXTENSION_STEP`, `NEXT_PUBLIC_AICC_EA_EXTENSION_REF` | unset (step 0) | Early Access extension (Production 21, a contingency; run the Control Plane `wp aicc-ea extend` FIRST, rebuild the Site LAST): the step must be exactly `1` (end 2027-02-01 00:00 Israel) or `2` (end 2027-03-01 00:00 Israel) AND `..._REF` must be the operator's decision reference (3-64 characters); otherwise the step is 0 and the build keeps the initial end. Every date, the head script and the build-clock refusal then use that end. `docs/cutover/early-access.md` section 7b |
| `AICC_EA_PLUGIN_RELEASE_SHA256` | unset | Read only by `launch:check`, and required there in `announce` and `open` builds: the sha256 (64 lower-case hex characters) of the corrected Plugin ZIP distributed with Early Access. It must be an entry of the committed allow-list `scripts/data/ea-plugin-releases.json` (adding an entry is a conscious act when a new Plugin build is attested), never the superseded candidate `0fee2c9d...b5a83` and never 64 zeros; the current entry is an UNSIGNED candidate, which `launch:check` still reports as a blocker. The Site build never reads it |
| `AICC_EA_EXTENSION_CP_VERIFIED`, `AICC_EA_HTML_NOCACHE_CONFIRMED` | unset | Read only by `launch:check`; for an EXTENDED build each clears its own blocker when it is exactly `yes`: the Control Plane `wp aicc-ea extend --step=<n>` has been run and verified; HTML is served with a short or no-cache `Cache-Control`, the caches were purged and `npm run ea:live` passed. `docs/cutover/early-access.md` section 7b |
| `AICC_CP_DIR` | the Control Plane worktree p21-early-access | Where `ea:check` reads the Control Plane constants (`CUTOFF_UNIX`, `EXTENSION_STEPS`). The comparison FAILS when the file is missing; `AICC_CP_DIR=none` disables it explicitly (not for a release run) |
| `NEXT_PUBLIC_AICC_EA_STRIKE` | unset (OFF) | `on` shows each plan price struck through next to the free offer (label "Regular price, not charged during Early Access"); the default shows it plainly as "Planned price when purchases open". Counsel must approve the strike-through first (no plan has been sold at that price); `launch:check` reports it as a blocker |
| `NEXT_PUBLIC_AICC_EA_LIMITED_NOTE`, `AICC_EA_LIMITED_ATTESTED` | unset (OFF) | P34: `on` adds the short line "Limited availability" under the Hero buttons of a campaign build (nothing in an OFF build). `launch:check` blocks it until `AICC_EA_LIMITED_ATTESTED=<owner reference>` attests that every request is reviewed, approvals are capped and the offer can close at any time. See `docs/launch/p34-launch-offer-polish.md` |

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
| `npm run test:video` | the Watch demo modal in both states: the labelled placeholder with no video, and an accessible captioned `<video>` when one is configured (`docs/watch-demo-video.md`) |
| `npm run test:rules` | the demos' rule engine (`brand/js/rules-core.js`) ranks exactly like the backend policy in all 32,500 rule combinations (an independent literal port of `recommendation_policy.py`) |
| `npm run axe:check` | axe-core on Home, Product, Pricing, Questions and Data & Trust at 1280/768/390/360/320 in default, Enhanced contrast and reduced-motion modes (needs `serve:out`) |
| `npm run shots:content` | the content-pass screenshots at 1280 and 390 (needs `serve:out`) |
| `npm run copy:check` | banned phrases (fabricated results, free-tier and urgency claims, unshipped features) in every locale source, plus `docs/` and this file |
| `npm run fbt:audit` | "Frequently Bought Together" / co-purchase wording only as a class-A usage (`scripts/fbt-allowlist.json`, `docs/fbt-usage-audit.md`), and never in a positioning slot in any locale (also enforced by `content:check`) |
| `npm run density:check` | the first viewport of Home carries a short text budget at 1280x800 and 390x844 (the hero must not read like a spec) |
| `npm run contrast:check` | WCAG contrast of every token pair the components use, including the sampled primary-button, headline and eyebrow treatments, and the guard that `.aicc-text-gradient` stays on display text (all real pass/fail, no exceptions list) |
| `npm run perf:check` | gzip first-load JS per route against the budgets (needs a build) |
| `npm run audit` | axe-core + structure + overflow on every page, locale and width (needs `serve:out`) |
| `npm run test:interaction` | keyboard walks, reduced motion, language persistence (needs `serve:out`) |
| `npm run seo:check` | static audit of the BUILT `out/`: exactly one canonical per page on the `www` origin with a trailing slash, hreflang clusters (en/he/es/ru/x-default, reciprocal), sitemap and robots.txt origin, Open Graph/Twitter images present in `out/`, icons, html lang/dir, no accidental noindex, truthful JSON-LD, and no apex, `http://`, localhost, staging or GitHub Pages (`/ai-commerce-copilot-site`, `github.io`) string anywhere in the output. Needs a root-path build: `AICC_BASE_PATH="" SITE_URL=https://www.copilt.org npm run build` |
| `npm run test:journey-browser` | P41: the onboarding journey page `/get-started/` (+ he, es, ru) in real Chromium: nine steps in order, one h1, the state-aware action (not open = the working Live Demo and no /start/ link; waitlist / open = the real link with plan and language), `?plan=` validated and carried through, the pricing cards / band / header leading there and FLIPPING by themselves to the real link when the status route answers open (`-- --ss-announce <dir> --ss-off <dir> --ss-link <dir> --shots <dir>`), axe, keyboard, reduced motion, RTL, 320..1920 px, 200% text |
| `npm run test:redirects` | the edge redirect matrix (`docs/cutover/redirect-matrix.md`, data in `scripts/lib/redirect-matrix.mjs`) against a local stand-in server and against the Caddyfile text (offline; applies nothing) |
| `npm run launch:check` | the COMMERCIAL launch gate: what would be published pending, drafted or unapproved, and whether checkout is open (`--strict` fails) |
| `npm run test:public-truth` | the PUBLIC-TRUTH gate: a built export (`-- --out out`) or a running origin (`-- --url <base> --preset site\|cp`) has nothing internal-looking, staged or untrue in en/he/es/ru; `-- --self-test` proves every rule with a mutation |
| `npm run ea:check` | the Early Access campaign: the initial cutoff and the two extension steps re-derived from the IANA database under seven process time zones and compared with the Control Plane constants (`CUTOFF_UNIX`, `EXTENSION_STEPS`), mode resolution at every boundary, the extension input (exact `1`/`2` plus a reference), the page script, no time-zone reads, the disclosures and the date tokens in four languages and three steps; `-- --out <dir> --expect off\|announce\|open [--expect-step 0\|1\|2] [--compare-off <normal build>]` audits a built export (its step's end, no initial-end sentence in an extended build, head metadata identical to the normal build) |
| `npm run ea:live -- <origin> --step <n>` | the post-deploy check of an Early Access build against the live origin (read-only GETs): every page must revalidate soon (`no-cache`, `no-store` or a max-age of at most 300 s; a missing `Cache-Control` fails) and serve the head script of that step; `ea:check` proves the script with local fixture origins |
| `npm run test:early-access` | a real browser with a pinned clock: before, at and after each end in six visitor time zones, live and ended views, the above-the-fold hero, overflow, keyboard, Hebrew (`-- --open <dir> --announce <dir> --off <dir>`; add `--open1 <dir> --announce1 <dir> --open2 <dir> --announce2 <dir>` for the extension step 1 and step 2 builds) |
| `npm run test:payment-gate` | the launch gate fails for bacs / cheque / cod, any gateway not on the (empty) allowlist, and a bank-transfer placeholder in the output; prints the structured-data switch |
| `npm run test:error-page` | the standalone 5xx page `docs/cutover/50x.html`: exact sentence, no external request, axe at 320/390/1280 in light, dark and forced colours, Caddyfile wiring |
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
