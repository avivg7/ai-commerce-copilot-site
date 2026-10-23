# Shopper demo guard (owner-approved "What shoppers see")

The approved demo is ONE interactive demo with three controls (Product page | Cart, WooCommerce | With AICC, What shoppers see | What you see and control). It lives in the shared brand kit (`brand/js/fbt-demo.js`, `product-art.js`, `aicc-brand.css`) that the Site renders and the Control Plane theme copies byte-for-byte. Approved reference commit: `972202e`.

## What went wrong once (2026-10-24, see ~/Downloads/AICC-launch-evidence/regression/FORENSIC-RECORD.md)
No commit reverted the demo in the Site. Three other things made the owner see a non-approved demo: (1) the QA Control Plane on 8982 serves a stale theme (symlink to an old release worktree); (2) the demo introduced the kit classes `.aicc-store` / `__name` that the Control Plane theme already styled for its Plans & Stores rows, so the demo collapsed there (fixed: kit-owned `aicc-fbt-*` names for every demo class); (3) no test rendered the integrated Control Plane head or pinned the approved states.

## The guards (all must pass on the FINAL integrated heads, after the last merge and sync)
| Command | What it proves |
|---|---|
| `npm run test:shopper-demo -- --url <base> [--surface site\|cp]` | on a LIVE rendering: semantic invariants (Product page \| Cart inside the demo, no standalone Surfaces section, WooCommerce cart = manually linked cross-sells with "Manually linked" tags and no AICC controls, AICC cart excludes cart products and is selectable, merchant view intact, no same-category-fallback / AI claims), layout sanity (store frame is a column; catches the class-collision collapse), and pixel comparison of 5 states x 2 widths with `tests/approved-visuals/shopper-demo/<surface>/` |
| `npm run test:launch-invariants -- [--cp-theme <dir>] [--site-url U] [--cp-url U]` | merge-order check: `972202e` is an ancestor, the approved files and English demo copy still match `docs/approved-shopper-demo.json`, no Surfaces section, CP theme == Site kit, no new kit/theme class collision, and (with URLs) the guard on each surface |
| `npm run test:brand-collisions -- --theme <dir>` | every kit class (CSS or emitted by kit JS) is unique to the kit unless grandfathered in `brand/content/class-ownership.json` |
| `npm run test:brand-sync` | the sync is Site -> consumer only: refuses to write into the Site, into a Site-looking directory, or from a stale manifest |

## Updating an approved baseline or pin is an OWNER-REVIEW action
Normal runs, merges and syncs never write a baseline; a missing baseline FAILS. After the owner has seen the new states:
`AICC_APPROVE_SHOPPER_DEMO=owner-reviewed npm run test:shopper-demo -- --url <base> --surface site --update-baseline` (and `--surface cp`), then `AICC_APPROVE_SHOPPER_DEMO=owner-reviewed npm run test:launch-invariants -- --update-pins`. Commit the PNGs and the pin file in the same commit as the change, with the owner's approval in the message.

## Control Plane surface
Bring up a CP fixture that renders the theme at the integrated head with `~/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/launch-integration/scripts/dev/cp-theme-fixture.sh start` (prints the URL), then `npm run test:shopper-demo -- --url <that URL> --surface cp`. Never validate the CP against 8982: its theme is a symlink to an old release.
