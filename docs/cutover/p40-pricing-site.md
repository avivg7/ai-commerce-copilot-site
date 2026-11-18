# P40 premium pricing section: Site (Stage B)

Design record: `docs/design/p40-pricing.md` (markup skeleton, class contract, pack). This note is the Site's operating summary. Nothing here is deployed by the repo: building, signing off and publishing stay with the coordinator.

## What the Site renders (self-service builds only)

Output identity: the HTML and RSC payload of the OFF, announce, open and verify builds are identical to P39 (proved by `scripts/export-hash.mjs` against an export of the kit commit built from the same path); the CSS file is P39 + the kit P40 block (about +15 KB), so its hash differs.

* `src/components/ss/SsPlans.tsx` (server): the header block and two card sets: the LIVE cards (Studio "Recommended", paid capacity glyphs, planned regular price, FREE and the trial line, ONE control) and the CLOSED / ordinary cards (`aicc-tier--standard`: the price leads, no FREE word, no trial line; after the trial end a launch-offer build adds the ordinary "Purchases open soon" control, `data-ea-after`); plus the ONE launch panel per page (`id="free-trial"`, two timeline steps, three facts), which is not shown when registration is closed.
* `src/components/ss/SsCta.tsx` (client): the control. Two families: `data-ss-cta="link"` (a real link `/<lang>/start/?plan=<solo|studio|agency>`, plan-less in the band) and `data-ss-cta="status"` (a non-interactive region, `role="status"`, never a link, never `#demo`). Decisions still come from `src/lib/ssStatus.ts` (state table, 30 s cache, browser-clock cutoff 2026-12-24T00:00:00Z). The Site has no purchase link.
* `src/components/ss/SsSwap.tsx` (client): the header text changes to the closed wording at the cutoff.
* The closed view: `<html data-ss-closed>` is set before first paint by a head script when the page loads at or after 2026-12-24T00:00:00Z (`SS_HEAD_SCRIPT`, launch-offer builds) and kept in step by the header island (`SsGetStarted`: browser clock, a status answer `closed_cutoff`, visibility / focus wake-up). Site CSS then shows the closed cards, hides the live cards and the launch panel, and hides the announcement bar (`visibility:hidden`: it keeps its box, because the hero spacing is tied to the bar; it leaves sight and focus order). The closed view announces once (the band has role=status, the cards do not).
* `src/lib/ssStatus.ts`: a valid view is kept through single failed answers but returns to the build's static state after 5 failed answers in a row or 150 s without a valid answer (never to open); the page re-checks on `visibilitychange` / `focus` (TTL cache, no polling). `NEXT_PUBLIC_AICC_START_URL` is validated in `selfService.ts` (https, copilt.org family, no credentials; a bad value fails the build).
* `Ss.tsx`: the band (lead and control only, no dates), the finder slot (plan and paid capacity only) and the small inline CSS the kit does not cover.
* Retired: the per-card demo link, the card date lines, the long terms block, the P39 inline card CSS.
* Styling is the shared kit (`brand/aicc-brand.css`, section P40 PRICING): one class contract with the Control Plane. The kit was frozen at 7b2c577 and changed once in the fix round (commit d8851b3): FREE fit with text-spacing headroom (`.aicc-tier__free-word` factors en 3.4, he 3.1, es 5, ru 8.5, break-word, the closed floor equals the open fit), pill and link share 3.625rem (`.aicc-pcta .aicc-btn`, `.aicc-pstatus__pill`), `.aicc-pstatus__label` and `.aicc-tier__trial` break-word, `.aicc-launch` padding capped by the viewport, equal timeline columns, small-screen caps (`.aicc-timeline__node`, `__step`, `.aicc-launch__fact` icon above text), `.aicc-pband` column and button wrapping, `.aicc-pcta .aicc-btn` / `.aicc-pband .aicc-btn` radius cap. Frozen again.

## Gated struck price variant

Build flag `NEXT_PUBLIC_AICC_EA_STRIKE=on` (the existing flag; default off). Markup: `aicc-tier__price--strike`, `data-ss-price="strike"`, `<s class="aicc-tier__amount">`. The release gate (`scripts/ea-release-gate.mjs`, run by `build-site-release.sh --target production`), `launch:check` and the public-truth gate refuse an export that carries any strike marker unless `AICC_EA_STRIKE_COUNSEL_APPROVED=<reference>` is attested. The one list of markers is `scripts/lib/strike-markup.mjs`.

## Tests added or rewritten

`test:pricing-browser` (adversarial browser matrix), `test:pricing-sources` (the two instants equal the Control Plane constants 1798070400 and 1798754400; no component hard-codes a date, clock, price or store count), `test:strike-gate`, and the updated launch-offer, self-service browser, consistency (with mutations), guard and interaction tests. Plan-card visual baselines moved to `tests/approved-visuals/p40-pricing`.

## Traps

* The OFF, announce, open and verify exports must equal an export of the kit commit built from the same checkout path (module ids depend on the path). Tailwind scans `scripts/` and `docs/`: a new file whose text looks like a class or an attribute selector can change the CSS and break that identity; re-run `scripts/export-hash.mjs` after adding files.
* A reduced-width status label (Russian) wraps in two lines, so its pill is 7 px taller than the link that replaces it; the shift score stays below 0.01.
* The msgid snapshot is `scripts/snapshots/selfservice-msgids.txt` (55 keys). Wording changes after the first snapshot commit are listed in the stage report; the Control Plane mirror reads this file.
