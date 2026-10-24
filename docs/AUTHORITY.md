# Who is authoritative for what

This repository (`ai_copilot_site`) and the Control Plane WordPress site (`aicc-control-plane`, the commerce and account area) will,
after the domain cutover, serve one domain. Until then they are two codebases, so each page and fact has exactly one owner and the
other side carries a **mirror**: the same facts and wording, flagged as a mirror in code and docs, guarded by the parity checks.

**Status: the hybrid topology below is pending owner confirmation** (see `docs/unified-experience/domain-migration.md` in the Control Plane repo).

## Page ownership until cutover

| Page | Owner | Mirror on the other surface |
|---|---|---|
| `/`, `/product/`, `/data-and-trust/`, `/questions/` | **this site** (`src/i18n/*.ts`) | the Control Plane links to them |
| `/pricing/`, `/privacy/`, `/terms/`, `/refund-policy/`, `/data-processing-addendum/`, `/accessibility/` | **Control Plane (WordPress)** | `/pricing/`, `/privacy/`, `/terms/`, `/refund-policy/`, `/accessibility/` here are MIRRORS (`MIRROR_ROUTES` in `src/lib/routes.ts`); the DPA is not mirrored |
| Checkout, cart, account, connect, renew, Plans & Stores | **Control Plane** | this site only links (`getStartedUrl(locale)` / `planUrl(plan, locale)` in `src/lib/site.ts`: language-prefixed, `/he/my-account/`; plan buttons add `?plan=solo\|studio\|agency`) |
| The interactive Frequently Bought Together demo (`brand/js/fbt-demo.js`) | **this repo (brand kit)** | the Control Plane home page renders the same module; strings come from `brand/i18n/strings.json` |
| **Brand kit** (tokens, button/header/language/hero/modal/FBT CSS and vanilla JS, Reco assets, shared strings) | **this repo** (`brand/`) | the Control Plane theme, delivered byte-for-byte by `node scripts/sync-brand-kit.mjs --to <theme dir>` and verified against `brand/MANIFEST.json` (`tokens:check`, `sync-brand-kit --verify`, `test:visual-contract`) |
| Plan prices and store limits **as purchased** | **Control Plane** (WooCommerce products, `scripts/bootstrap-commercial-products.php`) | `src/data/plans.ts` (`npm run pricing:check`) |
| **Content pack: facts and the FAQ** (`brand/content/facts.json`, `faq.<locale>.json`) | **this repo**, one file for both surfaces | the Control Plane receives the same bytes with the brand kit (`sync-brand-kit`), never a copy it edits; `npm run content:check -- --cp <theme dir>` verifies identity. The Control Plane renders its FAQ and any fact it states from this file. |
| Voice, claims allowed and not allowed | Control Plane repo `docs/unified-experience/content-source.md` and `claims-inventory.md`; this repo `docs/claims-inventory-content-pass.md` maps every public claim to evidence | dictionaries here (`npm run copy:check`, `npm run content:check`) |
| Signature demo, rules demo, dashboard preview, Ask Reco panel, flow diagrams | **this repo (brand kit)** | the Control Plane renders the same modules and classes (`brand/README.md`) |

## What "mirror" means

- If the owner changes a price, a limit, the refund window or a legal paragraph, the mirror changes in the same release.
  `pricing:check` fails when the numbers drift. There is no automatic check for legal wording: someone has to diff it.
- Every legally sensitive block is flagged `legalReview: true` in `src/data/legal.ts` (and per FAQ answer in `src/data/faq.ts`).
  The draft notice appears **on the legal pages only** (never on marketing cards) until `NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=true`.
  Supplying the company values does **not** hide it. Hebrew, Spanish and Russian legal text is a draft translation
  (`TRANSLATION_REVIEW`) and needs native legal review.
- FAQ answers flagged for review (`legalReview` in `brand/content/faq.en.json`) are left out of the `FAQPage` JSON-LD until approval.
- Translations are not blocked by the English pass: a unit or FAQ question that has no current translation shows its English text marked `lang="en" dir="ltr"`
  (see `docs/content-architecture.md`). `npm run i18n:strict` fails until none is left.
- Owner values that do not exist yet (company name, address, support email, governing law, payment processor, hosting region)
  render one calm muted line ("To be confirmed before purchases open."; see `docs/cutover/pre-commercial.md`). Set `NEXT_PUBLIC_AICC_LEGAL_NAME`,
  `NEXT_PUBLIC_AICC_ADDRESS`, `NEXT_PUBLIC_AICC_SUPPORT_EMAIL`, `NEXT_PUBLIC_AICC_GOVERNING_LAW`,
  `NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR`, `NEXT_PUBLIC_AICC_HOSTING_REGION`. Never invent them in the dictionaries.
- `npm run launch:check` lists everything that would be published pending, drafted or unapproved. It fails (exit 1) with `--strict`
  or `AICC_PRODUCTION=1`: run it that way before any production deploy.

## At cutover

1. Point `NEXT_PUBLIC_AICC_ACCOUNT_URL` at the real account page (default `${SITE_URL}/my-account/`, i.e. `https://www.copilt.org/my-account/` for the production build and `https://stage.copilt.org/my-account/` for the stage build; this is the ENGLISH URL, he/es/ru insert their prefix before the last path segment: `/he/my-account/`).
2. Remove the mirror routes here that WordPress owns, or keep them as redirects at the host; the sitemap and hreflang come from `src/lib/routes.ts` (the sitemap also lists `WORDPRESS_SITEMAP_PAGES`: the Control Plane's public `/data-processing-addendum/`, because the edge serves this one sitemap for the whole host).
3. Build with `AICC_BASE_PATH=""` and `SITE_URL=https://www.copilt.org` for a domain-root deployment. **The canonical public host is `www.copilt.org`** (owner decision 2026-10-19); `copilt.org` 301s to it at the edge and `api.copilt.org` stays API-only. Run `npm run seo:check` on the build; edge rules are in `docs/cutover/redirect-matrix.md`.
