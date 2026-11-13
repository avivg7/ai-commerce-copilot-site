# P34: launch offer presentation polish (switches and gates)

Status: built and tested locally on `feat/p34-launch-offer-polish`; nothing is deployed. With no environment set the site is byte-identical to the P32 base (proof: `node scripts/test-launch-offer.mjs ... --base <off export of 4156051> --off-subswitches <off export with both sub-switches on>`, 398 files, 0 different).

## What changes when the campaign is on (announce or open)

| Surface | P34 presentation |
|---|---|
| Announcement bar (every page) | "Launch Offer: Free for approved stores until December 31, 2026" (announce: "Launch Offer coming soon: Free for approved stores until December 31, 2026"), plus the "How it works" link to the explanation |
| Hero pill | a green "Launch Offer" tag (announce: "Launch Offer coming soon") followed by "Free for approved stores until December 31, 2026" (the pill is not next to the cards, so it carries the qualifier) |
| Under the Hero buttons | short single lines: the no-card line and "Manual renewal only"; "Limited availability" only in OPEN builds with its own switch (below), as a plain chip without a check icon. No paragraph, no disclaimer |
| Plan cards (Home and Pricing) | a "Launch Offer" label on every card; "Free until December 31, 2026, Israel time"; the regular price ($99 / $199 / $499 a year, from `src/data/plans.ts`), plain by default or struck through with the strike switch; "Request Free Access" (open) |
| Under the plan cards (Home and Pricing) | the no-card line for the launch offer, "Manual renewal only", "Regular pricing applies once purchases open" |
| Money-back guarantee line | not on any card (P32) and not in the DOM of the Home page of a campaign build; the ended view shows the Home list without it |

The bar and pill name the last day and the approved-stores qualifier (the truth gate requires the qualifier there). The exact end instant stays stated where the offer is explained: every card says "Access ends at 00:00 on January 1, 2027, Israel time (22:00 UTC on December 31)", and the Pricing explanation and its questions say the same. The truth gate (`scripts/lib/early-access-truth.mjs`) keeps requiring the clock on the cards, the explanation and the questions.

All new styling is inline CSS emitted by campaign builds only (`EA_P34_CSS` in `src/components/ea/Ea.tsx`); `aicc.css` is unchanged.

## Switches and attestations

| Variable | Values | Default | What it does | Attestation it needs |
|---|---|---|---|---|
| `NEXT_PUBLIC_AICC_EARLY_ACCESS` | `off` (or unset), `verify`, `announce`, `open` | unset = OFF | the launch-offer mode (unchanged from P32); every P34 element renders only in `announce` and `open` | `open`: `AICC_EA_INTAKE_VERIFIED`, `AICC_EA_LEGAL_SIGNOFF`, a real `NEXT_PUBLIC_AICC_EA_MAIL_PROVIDER`; every campaign build: `AICC_EA_PLUGIN_RELEASE_SHA256` and the owner's publication approval (`launch:check`); production packaging: `AICC_EA_RELEASE_APPROVED=owner-approved` |
| `NEXT_PUBLIC_AICC_EA_STRIKE` | exactly `on`, anything else is off | OFF | the owner's struck-through regular price: the labelled price "Planned regular price, not charged during the launch offer: $99 a year" is struck through (the price has never been charged) and "Free until ..." follows below it. No "was/now", saving or percentage wording exists | `AICC_EA_STRIKE_COUNSEL_APPROVED=<counsel approval reference>` (P32 gate; since review P34-2 it also fires when only the built export carries a struck price) |
| `NEXT_PUBLIC_AICC_EA_LIMITED_NOTE` | exactly `on`, anything else is off | OFF | adds "Limited availability" to the Hero support lines (four languages), OPEN builds only. Never a number, timer or "only N left". No effect in OFF, verify or announce builds | `AICC_EA_LIMITED_ATTESTED=<owner reference>`: the owner attests that every request is reviewed by hand, approvals are capped (`AICC_EA_REQUESTS_CAPACITY` on the Control Plane) and the offer can close to new requests at any time. `launch:check` blocks without it, also when only the built export carries the line |
| `NEXT_PUBLIC_AICC_EA_EXTENSION_STEP`, `NEXT_PUBLIC_AICC_EA_EXTENSION_REF` | unchanged (P21) | step 0 | the published extension steps; the short bar and pill follow the step's last day | unchanged |

An attestation is a reference: either a regular file inside the evidence directory (`AICC_EVIDENCE_DIR`, default `~/aviv_files/AICC/commerce_copilot_images/AICC-launch-evidence`; any other file, a symlink or a path outside it is refused), or a token of at least 8 characters such as `counsel-2026-11-14-ref7`. Bare or suffixed placeholders (yes, true, TODO, approved-1, todo1-x, yes_2026, ok-1, true-2026, x-1) are refused. Since review P34-3 this rule applies to every attestation, including `AICC_EA_INTAKE_VERIFIED` and `AICC_EA_LEGAL_SIGNOFF` (before, any existing file in or outside the repository was accepted). It is recorded by `launch:check`, never verified.

## Copy rules changed deliberately (`scripts/lib/early-access-truth.mjs`, `scripts/copy-check.mjs`)

- The bar no longer has to name the clock (owner wording); it and the Hero pill must carry the approved-stores qualifier; the cards, the explanation and the questions must still state the clock and the exact instant.
- Spanish "Solo renovación manual" is allowed only as the exact whole value of a `manual:` line; every other "renovación" stays banned unless denied with "sin", and "renov... automático" in one clause is banned.
- "Limited availability" is allowed only as the exact approved phrase in its language, as the whole value of a `limited:` key; any other scarcity or urgency word, a number or a timer on that line is still caught (self-tested in `copy:check`).
- New requirements: the manual and limited lines are the exact approved phrases, every support line is one short line (at most 64 characters, no sentence punctuation), the no-card support lines name the card, the pill tag and the card label name the offer, and the announce pill and bar differ from the open ones.

## Languages

en, he (right to left), es and ru carry the same keys (`hero.badgeTag`, `hero.badgeTagAnnounce`, `hero.badge`, `hero.support.*`, `plan.pill`, `pricing.support.*`). The he, es and ru strings are machine drafts, not reviewed by native speakers, like the rest of those packs.

## Counsel review

- "Regular pricing applies once purchases open" is the owner's support line, kept verbatim. Counsel should review it: it names a future price for purchases that are not open and implies they will open.
- The struck-through presentation (`NEXT_PUBLIC_AICC_EA_STRIKE=on`) and its label "Planned regular price, not charged during the launch offer:" need counsel approval before any build that uses it.

## Cross-surface checklist (Site and Control Plane)

The Site (Home, plan cards, Pricing explanation) and the Control Plane (`/pricing/`, legal pages, mails) have SEPARATE switches, and nothing cross-checks them:

| Concern | Site (build time) | Control Plane (`wp-config.php`) |
|---|---|---|
| Mode | `NEXT_PUBLIC_AICC_EARLY_ACCESS` | `AICC_EA_LAUNCH_OFFER_MODE` |
| Struck-through price | `NEXT_PUBLIC_AICC_EA_STRIKE` | `AICC_EA_LAUNCH_STRIKE` |
| "Limited availability" | `NEXT_PUBLIC_AICC_EA_LIMITED_NOTE` | `AICC_EA_LAUNCH_LIMITED_NOTE` |

Flip each pair together, in the same change window, and verify on both surfaces (the Site export with `ea:check --out` and `launch:check`; the live Control Plane pages by eye and with its own checks) that the mode, the strike-through and the limited line agree. A mismatch (for example a struck price on the Site and a plain price on `/pricing/`) is a publication defect.
