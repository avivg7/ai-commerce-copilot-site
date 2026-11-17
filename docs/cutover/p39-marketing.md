# P39: public marketing website completion (Site workstream)

Branch `feat/p39-marketing` (worktree `ai_copilot_site-worktrees/p39-marketing`), from `bf54801` (P37 self-service build, S1). Local only: nothing pushed, nothing deployed, no Production access.
This document is the decision log, the state table, the build recipe and the activation procedure. The Control Plane worker mirrors the copy from `scripts/snapshots/selfservice-msgids.txt` (35 msgids, TAB: key / en / he / es / ru).

## 1. What this change is

A marketing-only change. Switches stay OFF for registration, commerce, recurring billing and research. The Site build is "self-service ON, initial state `coming_soon`": it opens nothing. Nothing links to `/request-access/`. The 2026-12-31T22:00:00Z expiry and the inactive Jan-10 extension are untouched.

Product facts (owner-decided, mirrored from the Control Plane, verified by `pricing:check` and `ea:check`):

| fact | value | Control Plane source |
|---|---|---|
| Solo / Studio / Agency | USD 99 / 199 / 499 per year, paid capacity 1 / up to 3 / up to 10 stores | `AICC_LM_Early_Access::PLAN_SEATS`, plan bootstrap (`pricing:check`) |
| Trial | 1 store whatever plan is selected (the plan is a preference only), no payment method for the trial, no automatic paid conversion | `class-aicc-lm-trial.php`, `self-service.php` |
| Registration closes | **2026-12-24T00:00:00Z** (unix 1798070400). A registration is accepted while the server clock is BEFORE it | `AICC_LM_Trial::REGISTRATION_CUTOFF_UNIX` |
| Trial access ends | **2026-12-31T22:00:00Z** (unix 1798754400) for every trial, whichever day it was started | `AICC_LM_Early_Access::CUTOFF_UNIX` |

## 2. Decision log

* **D1 registration wording.** "Registration closes December 24, 2026 at 00:00 UTC" (cards: "Dec 24, 2026 at 00:00 UTC"), plus in the terms block "The last day to start a trial is December 23, 2026 (UTC)". Chosen because it states the exact instant the server uses (accepted while now < that instant) and the second sentence removes the "does December 24 still count?" ambiguity. Applied in the four languages with the same structure. `00:00` is allowed ONLY in the two registration strings (guards enforce it); every other string keeps the "UTC only, no midnight" rule of P36.
* **D2 two dates, always two labelled lines.** Every surface that mentions either date (plan cards on Home and Pricing, closing bands on Home / Pricing / Product, the "Which plan?" finder result, the terms block) shows `Registration closes ...` and `Trial access ends ...` as a definition list. No loose date exists anywhere else (guard + consistency test). The Hero pill (`ss.hero.badge`) and the announcement bar carry no date, for that reason.
* **D3 truthful CTA.** The static HTML of a self-service build says the build's initial state. Default `coming_soon`: plain text `ss.cta.soon` (`<p role="status">`, no fill, no border, no pointer, not focusable, not inside a link). A real link `/<lang>/start/?plan=<solo|studio|agency>` appears ONLY after the single run-time status request answers `open` (`ss.cta.start`) or `waitlist` (`ss.cta.waitlist`). `closed_cutoff` / `paused` show plain text; `off` shows the same "opens soon" text as the initial state (no flicker, no date promise). Failed or invalid answers keep the build's static state. A signup control never links to the Live Demo and never to a page that may be a 404.
* **D4 "Get started" (header, mobile menu, Product hero).** Stays on the account page `/my-account/` (the S0 destination, which exists) until the status says open or waitlist, then switches to `/start/`. "Sign in" and "Account" never change.
* **D5 demo is secondary.** Each card has a separate text link "Try Live Demo" to the Home demo (`/#demo`); closing bands keep "Try Live Demo" and "See pricing" as secondary actions. The Hero is unchanged (see 6).
* **D6 `off` = "opens soon".** The Control Plane answers `off` today (switch not on). The card keeps the initial words. The retired S1 label `ss.cta.notOpen` is removed from the pack (the Control Plane theme still carries it: see the mirror list).
* **D7 hero support lines.** Two facts as the list ("No payment method for the trial", "The trial includes 1 store") and "No automatic conversion to a paid plan" as the line under it: the same two-part structure as the P36 Hero, so the headline and the actions keep their S0 position (exact in en and he; es / ru within 20 px because the lists wrap differently).
* **D8 machine drafts.** he / es / ru are machine drafts, not reviewed by native speakers. Hebrew times carry a left-to-right isolate (U+2066 ... U+2069) and a no-break space so "00:00 UTC" / "22:00 UTC" read correctly inside right-to-left text; keep them when mirroring.
* **D9 legal pages untouched.** Verified byte for byte against the S0 export (`test:pricing-consistency`).

## 3. State table (src/lib/ssStatus.ts, pinned by `test:selfservice`)

| status answer | plan card / band / finder control | header + Product "Get started" |
|---|---|---|
| (static HTML, build `coming_soon`, the default) | plain text `ss.cta.soon` | account page |
| (static HTML, build `link`) | link `/<lang>/start/?plan=<id>` `ss.cta.start` | `/start/` |
| not asked yet / HTTP != 200 / timeout / network error / malformed JSON / unknown mode / `open` contradicting `mode` | the build's static state | the build's static state |
| `mode: open` | link `ss.cta.start` | `/start/` |
| `mode: waitlist` | link `ss.cta.waitlist` (same URL) | `/start/` |
| `mode: closed_cutoff` | plain text `ss.cta.closed` | account page |
| `mode: paused` | plain text `ss.cta.paused` | account page |
| `mode: off` | plain text `ss.cta.soon` | account page |

One `GET /wp-json/aicc/v1/signup/status` per page load, same origin, `credentials: omit`, `cache: no-store`, 5 s timeout. Nothing is sent but the request.

## 4. Build recipe (exact production recipe of the S0 / S1 deliveries, read from `p37/I-integration/site-release-BUILD-RECIPE.txt`)

```
cd ~/self_projects/ai_copilot_site-worktrees/p39-marketing
env -i PATH="$PATH" HOME="$HOME" NEXT_PUBLIC_AICC_SUPPORT_EMAIL=support@copilt.org NEXT_PUBLIC_AICC_EARLY_ACCESS=announce \
  NEXT_PUBLIC_AICC_SELFSERVICE=on AICC_EA_RELEASE_APPROVED=owner-approved \
  bash infra/release/build-site-release.sh --target production --out-dir <dir> --public-truth
```

`NEXT_PUBLIC_AICC_SS_INITIAL` is deliberately NOT set (default `coming_soon`). Needs node 22 (`PATH=/opt/homebrew/opt/node@22/bin:$PATH`). The tarball is not byte-reproducible (Next.js build id): upload exactly the hashed file; a rebuild needs a new approval. Any build with an uncommitted tree is `dirty` and must not be deployed.

OFF builds (`NEXT_PUBLIC_AICC_SELFSERVICE` unset) are byte-equivalent to the P36 / S0 exports (`node scripts/export-hash.mjs`; asserted in `test-launch-offer.mjs --base*`): off, announce, open and verify all 0 differing files after normalising the build id. The new production candidate differs from S0 by design (self-service on).

## 5. Activation procedure (later, after the owner activates sign-up)

1. Control Plane side first (separate approvals, not this change): `/start/` serves (edge route already live), the signup switch and cap are on.
2. **No Site redeploy is needed for the cards to go live.** The run-time status answer `open` / `waitlist` upgrades cards, bands, finder, header and Product "Get started" to the plan-prefilled links.
3. Optional hardening rebuild: build again with `NEXT_PUBLIC_AICC_SS_INITIAL=link` so the static HTML links directly (also needs a new approval; do this only once `/start/` is permanent). A static default flip always needs a rebuild.
4. Verify with `test:selfservice-browser` (open and waitlist matrices) against the new export and with the public status route.

Must NOT be done: set `NEXT_PUBLIC_AICC_SS_INITIAL=link` while `/start/` is not live (links to a 404); open `/request-access/`; link a signup control to `#demo`; mention any date outside the two labelled lines; add card-payment / renewal / discount / urgency wording; turn on commerce or recurring switches; touch the extension step or the 22:00 UTC instant; publish he / es / ru as native-reviewed.

## 6. Hero unchanged

`test:visual-regression` compares S0 and the candidate pixel by pixel for the headline, subtitle, the two Hero actions (Try Live Demo -> `#demo`, See Pricing), the Reco visual, the pillars strip, the interactive demo and the header, four languages, 1440 and 390: 0 differing pixels beyond 0.1 %. The pill and the support lines under the buttons are the offer wording and change by design.

## 7. Guards: what changed and why (additive; every old protection still bites)

See the final report for the list; the mutation proofs are `scripts/test-ss-guards.mjs` (159 checks, four languages) and the SS mutations in `scripts/test-launch-offer-mutations.mjs`.
