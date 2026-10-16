# Who is authoritative for what

This repository (`ai_copilot_site`) and the Control Plane WordPress site (`aicc-control-plane`, the commerce and account area)
will, once cut over, serve one domain. Until then they are two codebases, so each fact has exactly one owner and the other
side mirrors it.

| Topic | Authoritative | Mirrored by | Guard |
|---|---|---|---|
| Home, product and data-and-trust marketing copy | **this site** (`src/i18n/*.ts`) | | `i18n:check`, `copy:check` |
| The interactive Frequently Bought Together demo | **this site** (`src/components/demo`) | | `test:interaction` |
| Design tokens (colour, type, spacing, motion) | `design/aicc-tokens.css` (one file, two copies) | Control Plane theme `aicc-tokens.css`, byte-identical | `tokens:check` |
| Plan prices and store limits **as purchased** | **Control Plane** (WooCommerce products; `scripts/bootstrap-commercial-products.php`) | `/pricing/` here, from `src/data/plans.ts` | `pricing:check` |
| Checkout, account, connect and renew flows | **Control Plane** | this site only links to them (`GET_STARTED_URL`) | none needed (links) |
| Legal text (privacy, terms, refund policy), **once on one domain** | **Control Plane** | `/privacy/`, `/terms/`, `/refund-policy/` here | manual: diff before every release |
| Facts, voice, claims allowed / not allowed | Control Plane repo `docs/unified-experience/content-source.md` and `claims-inventory.md` | dictionaries here | `copy:check` (banned phrases only) |

## What "mirror until cutover" means

- `/pricing/` and the three legal pages are copies. If the Control Plane changes a price, a limit, a refund window or a legal
  paragraph, change it here in the same release. `npm run pricing:check` fails the build pipeline if the numbers drift from
  `src/data/plans.ts` (accepted values 99/1, 199/3, 499/10) or from the Control Plane bootstrap file when it is reachable.
  There is no automatic check for legal wording: someone has to diff it.
- Every legally sensitive paragraph is flagged `legalReview: true` in `src/data/legal.ts` (and per FAQ item in `src/data/faq.ts`)
  and shows "Draft: pending legal review" unless `NEXT_PUBLIC_LEGAL_DRAFT_NOTICE=off`. Switch it off only after a person with
  legal authority has approved the text, and only for the languages they approved. Hebrew, Spanish and Russian legal text is a
  draft translation (`TRANSLATION_REVIEW` in `src/data/legal.ts`) and needs native legal review before the notice is turned off.
- Owner-supplied values that do not exist yet (company legal name, address, support email, governing law, payment processor,
  hosting region) render as visible `[... -- pending]` tokens. Set them with `NEXT_PUBLIC_AICC_LEGAL_NAME`,
  `NEXT_PUBLIC_AICC_ADDRESS`, `NEXT_PUBLIC_AICC_SUPPORT_EMAIL`, `NEXT_PUBLIC_AICC_GOVERNING_LAW`,
  `NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR`, `NEXT_PUBLIC_AICC_HOSTING_REGION`. Never invent them in the dictionaries.

## At cutover

1. Point `NEXT_PUBLIC_AICC_ACCOUNT_URL` at the real account page (default `https://copilt.org/my-account/`).
2. Decide which side serves `/pricing/` and the legal pages. If WordPress takes them, delete the routes here and keep the
   links; the sitemap and hreflang entries come from `src/lib/routes.ts`.
3. Build with `AICC_BASE_PATH=""` and `SITE_URL=https://copilt.org` for a domain-root deployment.
