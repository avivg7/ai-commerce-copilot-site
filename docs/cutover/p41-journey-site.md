# P41 onboarding journey: Site (builder S)

Branch `feat/p41-site-journey` (worktree `ai_copilot_site-worktrees/p41-journey`), from P40 tip `1693122`. Local only: nothing pushed, nothing deployed, no production access. Design record and markup contract (what the Control Plane mirror reads): `docs/design/p41-journey.md`.

## 1. What changed

The owner's correction: three giant inert controls with paragraphs under them are not the end product. Now (self-service builds only, default state `coming_soon`):

* **A working public onboarding page, `/get-started/` (+ `/he/`, `/es/`, `/ru/`)**: a Site-exported static page (no edge change: the edge sends only the WordPress allow-list to WordPress). It tells the real journey in nine steps (choose a plan, create the account and verify the e-mail, the 1-store trial is created automatically, download the plugin from the account, install it in WordPress, connect the store by secure pairing, sync products, recommendations go live only after the widget is confirmed to render, the dashboard shows where you are), grounded in what the Control Plane sign-up, the plugin and the Backend do. It is honest while registration is not open: the banner `ss.state.line.soon` (registration is not open yet), the working Live Demo (Home `#demo`) and See pricing; NO link to `/start/`, no fake sign-up. It opens the real flow by itself when the status route answers open (`/<lang>/start/?plan=<plan>`) or waitlist; closed text from 2026-12-24T00:00:00Z. `?plan=` is validated (solo | studio | agency; everything else ignored) and carried to the start link. The two UTC dates are written once on the page (the trial terms block, hidden in the closed view), from the single build-time token source.
* **Cards, Home plan section, closing band, finder**: the inert pill is gone. While registration is not open the control is a real link "See how it works" to `/<lang>/get-started/?plan=<plan>` (Studio primary, the others outline). The fact "registration isn't open yet" is said ONCE per section, in a compact status line above the cards (role=status, with the Live Demo link). When the status route answers open / waitlist the same controls flip to the real sign-up link (`ss.cta.start` / `ss.cta.waitlist`; plan and language kept), with no rebuild and no reload.
* **Header "Get started" (desktop, menu, Product hero)**: leads to the journey page while registration is not open (it led to `/my-account/`, whose copy says "Purchases open soon", the wrong word for a trial); to `/start/` when open / waitlist.
* **Planned price above FREE**: the compliant default (large muted UNSTRUCK price, pill "Planned to start after the launch offer", chevron down) in every default build and in every state of a strike build except `open`; the strike variant (owner mandate, counsel-gated, OFF) is built, tested and screenshotted and shows ONLY while the status is open.

## 2. Commits (Site worktree)

Kit commits (the Control Plane syncs `brand/` from the Site HEAD; all four are CSS-only inside the new `P41 OFFER` block, listed separately on purpose):

* `abae783` P41 KIT 1: planned price above FREE (`.aicc-tier--offer`, `.aicc-tier__offer*`), compact status line (`.aicc-pstate*`); retires `.aicc-tier__price--strike`
* `593060b` P41 KIT 2: `.aicc-tier__offer` stretches its items (a long word at 200% text wraps inside the card), the pill is a start-aligned flex box
* `d20f38a` P41 KIT 3: the planned-price pill is a fit-content block that wraps a long word instead of overflowing (200% text, Russian)
* `be46f4e` P41 KIT 4: the planned / struck price is ONE line sized by its container (per-language fit, nowrap); the status line text and link wrap inside it

Review round (`62ba7e0` merge, then `681bac0`, `bc3111a` and the commits after it): NO kit change (`brand/` untouched), so the kit commits above are still the four to sync.

The remaining commits: pack strings, the journey page, the cards / bands / finder / header, tests and guards, docs (see `git log 1693122..HEAD`).

## 3. Build

The production recipe is unchanged (`docs/cutover/p39-marketing.md` section 4: `NEXT_PUBLIC_AICC_EARLY_ACCESS=announce NEXT_PUBLIC_AICC_SELFSERVICE=on`, `NEXT_PUBLIC_AICC_SS_INITIAL` unset). The journey page exists only when `NEXT_PUBLIC_AICC_SELFSERVICE=on` (`src/lib/requestRoutes.ts`; the import sits behind the compile-time constant `NEXT_PUBLIC_AICC_SS_CODE`, so every other build carries none of the page or of its client islands).

**With the strike variant**: add `NEXT_PUBLIC_AICC_EA_STRIKE=on` to the same recipe. The production builder (`infra/release/build-site-release.sh --target production`, which runs `scripts/ea-release-gate.mjs`) REFUSES the export unless `AICC_EA_STRIKE_COUNSEL_APPROVED=<reference>` is attested (an evidence-folder regular file or a reference token; placeholders and answer words refused). `launch:check` and the public-truth gate refuse it too. The coordinator flips it with that one reference once counsel has cleared it; clearance is an owner / counsel gate nobody can self-certify. Default build: OFF.

## 4. Strike gates (compliance memo section 7)

| gate | where |
|---|---|
| strike only while now < offer end; fails closed | the strike renders only in a launch-offer build (built before the offer end), and only inside the LIVE card set, which the browser clock hides from 2026-12-24T00:00:00Z (`<html data-ss-closed>`, head script + the header island, also for a page left open) and from the trial end (`data-ea-over`); `test:pricing-browser` J proves nothing struck, no label and no disclosure is visible at the cutoff, with the closed answer and after the end |
| strike shows ONLY while the status is `open` (review round) | both variants are in the static HTML; `<html data-ss-open>` (set by the header island only when `ssLine() === "open"`, removed otherwise) is the one switch in the inline CSS. Every other state, no JavaScript and the cutoff show the default planned design. See "How the gates stay meaningful" below |
| the displayed price equals the single build-time plan source | the amount is `src/data/plans.ts` only; a non-finite or non-positive price renders the plain variant (fail closed); `test:strike-gate` compares every struck amount in the built export with the plan table |
| no strike markup without label + disclosure in the same card | `strikeCardProblems()` (`scripts/lib/strike-markup.mjs`), run by `ea-release-gate.mjs` EVEN WITH a counsel reference and by `test:strike-gate` (with mutations: no label, no disclosure, no screen-reader text) |
| forbidden words, four languages | `priceWordProblems()` (`scripts/lib/early-access-truth.mjs`): was / previously / original / save / worth / normally / "regular price" alone (and the Hebrew, Spanish, Russian equivalents), applied to the planned-price copy and to the journey page; `test:ss-guards` mutates each; `test:pricing-browser` J scans the rendered cards of both builds |
| production refusal | the release gate, `launch:check`, the public-truth gate (`scripts/lib/strike-markup.mjs`: the P36, P40 and P41 markers and any `<s>` / `<del>`) |

**How the gates stay meaningful with the strike hidden until open.** The strike markup is still in the static HTML of a strike build (inside `data-ss-when-open` blocks), so `strikeCardProblems()`, `ea-release-gate.mjs`, `launch:check`, the public-truth gate and `ea:check --strike` read exactly what they read before: any strike marker or `<s>` still blocks a production export without the counsel reference, and label + disclosure + screen-reader text must still sit in the same card. A hidden strike therefore cannot hide a missing disclosure. New in `test:strike-gate`: the marker counts (3 strike blocks and 3 disclosures with `data-ss-when-open`, 3 planned blocks with `data-ss-when-not-open`) and both CSS rules. New in `test:pricing-browser` (J, flips): static state and every non-open state show no strike, label or disclosure; open shows all; waitlist / paused / open flips both ways without reload; the cutoff clock hides it; layout shift stays below 0.1 (the five state flips together, the cutoff closed view on its own); no flash: before the status answer nothing struck is visible. Failing-first logs: `failing-first/r2-*`.

The strike disclosure carries the offer end (`{until}`, "Trial access ends December 31, 2026 at 22:00 UTC"), the pill says "Planned to start after the launch offer", and he / es / ru use "planned annual price" wording with no regular / usual / ordinary word (`priceWordProblems` extended and mutated per language).

Not done here (Control Plane, the C3 mirror): the server-clock check, the WooCommerce price check, the dated owner attestation of intent and the log of window / price / locale / timestamp (memo 7.1, 7.2, 7.4, 7.5); the commerce path to buy after the offer is not live (provider pending), which memo condition (ii) requires before publication.

## 5. Tests

Run against exports of the final head (`NEXT_PUBLIC_AICC_SELFSERVICE=on` with the launch-offer switch announce / unset / open, the `SS_INITIAL=link` build, the strike build; plus the four default builds). Results, with logs in the evidence directory `p41/S-site/logs`:

| command | result |
|---|---|
| `test:selfservice` | 230 / 230 |
| `test:ss-guards` (mutations of the copy guards, four languages) | 287 / 287 |
| `test:pricing-sources` | pass |
| `test:journey-browser` (full matrix) | 409 / 409 |
| `test:selfservice-browser` | 536 / 536 |
| `test:pricing-browser` J (planned price and strike matrix, languages x 320..1920 x 100 / 200 % text) and H (geometry), full | 560 / 560 and 1800 / 1800 |
| `test:pricing-browser` other sections, quick | 436 / 436 |
| `test:pricing-consistency` and its mutations | 298 / 298 and 57 / 57 |
| `test:launch-offer` and its mutations | 3460 / 3460 and 100 / 100 |
| `test:strike-gate` | 71 / 71 |
| `test:visual-regression` (baselines regenerated and reviewed) | 88 / 88 |
| `test:launch-offer-browser`, `test:early-access` (default builds) | pass |
| `test:link-resolution` (self-service: journey links and page; default builds: none) | pass |
| `test:public-truth` (all builds, plus self-test) | pass |
| `ea:check` (and `--out` of the self-service builds) | pass |
| `test:redirects` with the export | 2 failures, both present on P40 (demo assets, security.txt) |

Failing-first: `failing-first/` holds the new tests run against the P40 base (`1693122`): `test:selfservice`, `test:pricing-sources` fail on the missing helpers, `test:journey-browser` reports 31 failures on the missing page, `test:pricing-browser` D / J report the inert pill and the missing status line.

 New or rewritten: `test:journey-browser` (new), `test:pricing-browser` (J rewritten: planned price and strike matrix; the control and status line in every state), `test:selfservice-browser`, `test:pricing-consistency`, `test:launch-offer`, `test:selfservice`, `test:pricing-sources`, `test:ss-guards`, `test:strike-gate`, `test:redirects`, `test:visual-regression` (baselines moved to `tests/approved-visuals/p41-journey`, regenerated and reviewed). Failing-first: each new behaviour test was run against the P40 base (`1693122`) and failed there (logs `failing-first/`).

## 6. Export identity

OFF, announce, open and verify builds (self-service unset) are byte-identical to an export of the kit commits built from the same checkout path (`node scripts/export-hash.mjs`, 0 differing files; recorded in the evidence). The self-service builds differ by design in: every page (header "Get started" target), Home and Pricing (cards, status line, planned price), the Product page (hero "Get started", bands), the closing bands, the plan finder, the sitemap (+4 entries) and the new `/get-started/` pages (+4 pages and their payload files); the legal pages, Questions and Data and Trust differ only in the header link and the stylesheet name. The stylesheet differs in every build by the kit commits (KIT 1 and KIT 2), nothing else.

Traps: Tailwind scans `scripts/` and `docs/`: a new file whose text contains a utility-looking token creates CSS in EVERY build and breaks identity (found: the bare word for the strikethrough utility in a test script; written differently now). Re-run `export-hash.mjs` after adding files.

## 6b. Review round (items 1 to 7 of the review brief)

1. Strike only when open: section 4 above. 2. Terms card: `ss.launch.foot.paid` plus one end-of-trial line (`ea.journey.terms.end`) on the journey page, four languages, the dates still once. 3. Strike disclosure with the end date, pill "Planned to start after the launch offer", he / es / ru wording. 4. Aside: sticky only when the viewport shows all of it (`(min-width: 62rem) and (min-height: 68rem)`), `aria-label` = `ea.journey.asideLabel`; DOM / focus order kept (status panel first, then steps; rationale in `docs/design/p41-journey.md` 7.1). 5. 320 px Russian: smaller step indent (`--jr-node`, `--jr-gap`), 1.125rem step titles, `hyphens: manual` with a selector that beats the global phone-heading hyphenation (the first attempt lost on specificity and on rule order; found by `test:journey-browser` at 320 px Russian, "Синхронизируйте" was broken), word joiner so the comma stays with the path chip. 6. Install path "Plugins > Add New Plugin > Upload Plugin" (he "תוספים > הוספת תוסף חדש > העלאת תוסף", es "Plugins > Añadir nuevo plugin > Subir plugin", ru "Плагины > Добавить новый плагин > Загрузить плагин"). 7. Evidence: `shots/journey-off-<lang>-<320|390>.png` (full page, off state, four languages) and `shots/r2*/geo-*-320-200-*.png` (planned design at 320 px and 200 % text).

**Exact msgid changes for the Control Plane mirror** (`scripts/snapshots/selfservice-msgids.txt` stays at 60 keys: no key added or retired in this round):

| msgid | change |
|---|---|
| `ss.pricing.afterOffer` | value, all four: en "Planned to start after the launch offer"; he "מתוכנן להתחיל אחרי הצעת ההשקה"; es "Previsto para empezar después de la oferta de lanzamiento"; ru "Планируется начать после предложения в честь запуска" |
| `ss.pricing.strikeNote` | value, all four: adds the end sentence; en "Nothing has been charged at this price yet. Trial access ends {until} at 22:00 UTC. No payment method needed; nothing is charged automatically." (`{until}` = the offer end date, as the other date placeholders; the space before "22:00" is U+00A0) |
| `ss.pricing.priceLabel` | value, he / es / ru only: "מחיר שנתי מתוכנן" / "Precio anual previsto" / "Планируемая годовая цена" (en unchanged) |
| `ss.pricing.strikeLabel` | value, he / es / ru only: "מחיר שנתי מתוכנן לאחר הצעת ההשקה, לא מחיר נוכחי או קודם." / "Precio anual previsto después de la oferta de lanzamiento, no un precio actual ni pasado." / "Планируемая годовая цена после предложения в честь запуска, не текущая и не прежняя цена." (en unchanged) |
| `ss.launch.foot.paid` | value, he / es / ru only: the planned-annual-price wording (en unchanged) |
| `ea.journey.path` (Site only) | value, all four: the WordPress menu path |
| `ea.journey.terms.end`, `ea.journey.asideLabel` (Site only) | NEW, all four |

The Control Plane mirror must also render the strike only when its own status is open (server clock and public mode) and keep `data-ss-when-open` / `data-ss-when-not-open` semantics: see `docs/design/p41-journey.md` 5.1.

## 7. he / es / ru machine drafts (not reviewed by native speakers)

Every string below was added or changed in P41 in all of he, es, ru and is a machine draft: `ss.cta.how`, `ss.state.line.{soon,paused,open,waitlist}`, `ss.state.demo`, `ss.pricing.{perShort,afterOffer,priceLabel,strikeLabel,strikeNote,strikeSr}`, `ss.launch.foot.paid`, and the whole `ea.journey` block (including `path`, `terms.end`, `asideLabel`) (page title, lead, three phases, nine steps with their texts, the WordPress menu path in each language's WordPress, plan chip label and hint, status panel texts, terms title, meta title and description). The strike label and disclosure carry legal weight: they need native legal review before the strike is ever published (the memo asks that no word default to "original" or "was"; the Hebrew "regular price" alone is avoided on purpose).

## 8. Known issues and deviations

* The brief's wording "enrolment" is British spelling and "No card needed" is card wording; this Site is US English and its guards ban card wording (the one payment sentence is "no payment method is required"). The status line (`ss.state.line.soon`) uses the Control Plane `/start/` vocabulary ("registration") and the disclosure (`ss.pricing.strikeNote`) says "No payment method needed; nothing is charged automatically."
* The planned-price label says "Planned regular annual price after the launch offer, not a current or past price." in the strike variant; the default keeps "Planned regular price" plus the pill.
* The footer has no "Get started" link on purpose (the footer list is mirrored by the Control Plane footer; the header, the cards, the band and the status line lead to the page).
* The language-suggestion bar on the journey page offers the Home page of the other language, not the same page.
* `scripts/lib/redirect-matrix.mjs`: `/get-started/` moves from UNOWNED to Site-owned (static); `alias_install` stays DISABLED (enabling it is an edge change).
* Pre-existing, unchanged: `test:interaction` 2 hero failures, shopper-demo baseline drift 10, `test:redirects` 2 failures when run against an export without the demo assets / with `.well-known/security.txt`.
* Review round: the merged release-tools docs (`docs/cutover/p38-brevo-host-update.md` twice, `docs/cutover/p41-activation-runbook.md` once) said "Free plan" / "Free Trial", which `copy:check` bans in this repo; three lines were reworded ("the account's daily allowance", "the launch trial") in `681bac0`. Meaning unchanged; the owner of those docs may want to mirror the wording.
* Review round: the strike's static HTML now carries BOTH the strike and the default planned block (hidden by CSS until `<html data-ss-open>`); a strike build is therefore slightly larger and its HTML always contains the default block. Intended: it is what keeps the gates meaningful and the no-JavaScript view honest.
* Review round: the DOM order of the journey aside (status panel first, in the right column on a wide screen) is documented, not changed (`docs/design/p41-journey.md` 7.1).
