# Early Access: the campaign switch, its time logic and how it ends (Production 20)

Written for: the owner and the operator. Status: **built and tested locally; OFF by default; nothing is published.** The Control Plane side (who may get access, the fixed expiry) is `docs/launch/early-access.md` in the Control Plane repository; this page is only what the static website says.

## 1. What it is

A fixed-calendar promotional access period, not a trial and not a permanent plan. Every Early Access store ends at the same instant, whatever its sign-up date: **2027-01-01 00:00:00 Asia/Jerusalem = 2026-12-31 22:00:00 UTC** (unix 1798754400). The last included moment is 31 December 2026, Israel time. Nothing renews or converts by itself; a paid plan starts only if the merchant chooses and buys it. This site decides only what the pages SAY; it cannot grant, extend or remove access.

## 2. The switch and its three states (build time)

`NEXT_PUBLIC_AICC_EARLY_ACCESS`, separate from `NEXT_PUBLIC_AICC_COMMERCE_OPEN` (the campaign never opens paid checkout).

| Value | Mode | What a visitor sees |
|---|---|---|
| unset, or anything else | OFF | exactly the site as before: no trace of the campaign in any page |
| `announce` | ANNOUNCE | the offer, the end date, struck regular prices, the explanation, the questions; every button says Early Access opens soon (nothing to sign up for yet) |
| `open` | OPEN | the same, with buttons leading to the sign-up (`NEXT_PUBLIC_AICC_EARLY_ACCESS_URL`; the Control Plane flow must exist and be approved) |

Only the exact words work: `true`, `1`, `OPEN`, ` open` are OFF.

## 3. Time logic (what keeps the page from going stale)

1. **One constant**, `EA_CUTOFF_UTC_MS` in `src/lib/earlyAccess.ts`. `npm run ea:check` re-derives it from the IANA time-zone database (not from the constant) under seven process time zones and fails if they differ, so neither the machine nor a change of time rules can silently move it.
2. **Build guard.** A build made at or after the cutoff IGNORES the switch (mode OFF) and `npm run launch:check` reports the expired request. A late deployment of an old configuration cannot publish an expired campaign.
3. **Page script.** On a campaign build, a 100-byte script in `<head>` compares `Date.now()` with the constant (absolute UTC milliseconds, no time zone, no locale). At or after the instant it marks `<html data-ea-over>`; the CSS then hides every offer block, shows the ordinary prices and "Purchases open soon" and a short "Early Access has ended" note. A page loaded from a CDN or browser cache after the end date therefore shows the ended view. A page left open across the instant keeps its view until it is reloaded.
4. **Limits, stated honestly.** A visitor without JavaScript sees the build as built until the site is redeployed; a visitor with a wrong device clock sees the wrong view (display only: access itself ends on the servers). Meta descriptions, Open Graph text and structured data never mention the campaign, so nothing in a search result goes stale.
5. The campaign code never reads the visitor's time zone or formats a date with the locale (`ea:check` greps for it).

## 4. Where it shows (all four languages; he is right-to-left)

Announcement bar under the header; Home hero buttons and fine print; the plan cards on Home and Pricing (struck regular price with the visible label "Regular price", "Free until December 31, 2026", the end date, one action per card); the Early Access explanation and its four questions on Pricing (`#early-access`); the closing bands. Prices come only from `src/data/plans.ts` (Solo $99, Studio $199, Agency $499 a year, USD): the struck number is the real regular price, never a reference price, and no percentage or "save" wording exists. The Control Plane shows the same facts on its own pages and in its mail templates.

## 5. Enabling it (order matters; none of this is approved yet)

1. The Control Plane Early Access path is deployed dark and independently reviewed (Control Plane `docs/launch/early-access.md`).
2. The accountant has confirmed the proposed public activity in writing, counsel has approved the promotional terms, and the legal text on the site and in the Control Plane (Terms, Privacy, DPA, Refund) carries the Early Access disclosures.
3. Build with `NEXT_PUBLIC_AICC_EARLY_ACCESS=announce` first and publish it only on the owner's explicit approval; switch to `open` (with `NEXT_PUBLIC_AICC_EARLY_ACCESS_URL`) only when real merchants may be admitted.
4. `npm run launch:check`, `npm run ea:check -- --out out --expect <mode>`, `npm run test:early-access`.

## 6. Approvals this needs from the owner

Publishing the `announce` build; publishing the `open` build; admitting real merchants (a Control Plane approval, not a site setting); the legal and accountant confirmations in section 5. `launch:check` reports the campaign as a blocker while it is on, so the existing production gate cannot pass by accident.

## 7. Ending it (the removal plan)

1. **Before 2027-01-01:** prepare the normal build (the default configuration, switch unset) and verify it with `ea:check -- --out <dir> --expect off`.
2. **At or just after 2027-01-01 00:00 Israel time (2026-12-31 22:00 UTC):** deploy the normal build. Until then the live campaign build stays; the page script already shows the ended view to anyone loading a page after the instant.
3. Verify on the live host: no "Early Access" text, no struck prices, "Purchases open soon" (or the open checkout if Commerce has opened). The Mac sentinel's closed-commerce target keeps passing; add a post-cutoff check to your own calendar.
4. Remove `NEXT_PUBLIC_AICC_EARLY_ACCESS` and `..._URL` from the release environment file so no later build carries them (a build after the cutoff ignores them anyway).
5. Rollback of the campaign itself is the same deployment of the normal build; nothing in the Control Plane needs to change for the pages.

## 8. Tests

`npm run ea:check` (instant, modes, page script, no time-zone reads, copy contract in four languages, built-export audit with `--out`), `npm run test:early-access` (a real browser with a pinned clock: 7 moments from 40 days before to 15 days after, in 6 visitor time zones, live and ended views, overflow at four widths, keyboard, Hebrew), plus the existing `copy:check`, `content:check`, `i18n:strict`, axe, audit and interaction suites. The campaign vocabulary is allowed only under `src/i18n/ea/` (`scripts/lib/early-access-truth.mjs`).
