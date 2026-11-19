# P41 journey: markup contract of the pricing cards (kit `P41 OFFER` block) and the /get-started/ page

Status: Site builder S, local only on `feat/p41-site-journey` (from P40 tip 1693122). Nothing pushed, nothing deployed. The Control Plane mirror (builder C3) reads this file, the kit (`brand/aicc-brand.css`, section `P41 OFFER BEGIN ... END`) and `scripts/snapshots/selfservice-msgids.txt` (60 keys). The P40 contract (`docs/design/p40-pricing.md`) still applies everywhere this file does not change it.

## 1. What changed for the visitor

The owner rejected "three giant inert controls with paragraphs underneath". Now:

* a card whose registration is not open (off, paused, the default static state, every failed status answer) has ONE real link, "See how it works", to the Site page `/<lang>/get-started/?plan=<plan>` (the working onboarding information page: nine steps, honest that registration is not open, the Live Demo, See pricing). No inert pill, no paragraph under any card;
* the fact "Free trial registration isn't open yet." is said ONCE per section, in a compact status line (`.aicc-pstate`) above the cards, together with the working Live Demo link;
* the same controls flip BY THEMSELVES to the real "Get started free" link (`/<lang>/start/?plan=<plan>`) when the status route answers open or waitlist (no rebuild, no reload);
* the planned annual price sits DIRECTLY above FREE (launch zone), in the compliant default treatment (large muted unstruck price, pill "Starts after the launch offer", chevron down) or, behind the counsel gate, struck through with its label and disclosure;
* after 2026-12-24T00:00:00Z the closed view is unchanged (closed text, ordinary cards, no FREE, no status line).

## 2. Class contract additions (all in the kit, one stylesheet for Site and Control Plane)

| class / hook | meaning |
|---|---|
| `.aicc-tier--offer` | a LIVE card (not `--standard`): the price block is in the launch zone. Subgrid rows become plan 3 + launch 3 + footer 1 (was 4 + 2 + 1). Without this class a card is laid out exactly as in P40 |
| `.aicc-tier__offer` (`--planned`, `--strike`), `data-aicc-ss="regular"`, `data-ss-price="planned|strike"` | the planned-price block, first child of `.aicc-tier__launch` |
| `.aicc-tier__offer-price` | the amount and its unit, one line of one size (`min(2.5rem, 11vw)`, 800, tabular); `--planned` colour slate-600, `--strike` colour slate-700 |
| `.aicc-tier__offer-label` | 1rem, 600: the label directly under the price |
| `.aicc-tier__offer-pill` | default variant only: pill "Starts after the launch offer" (the chevron is the `::after` of `--planned`) |
| `.aicc-tier__offer-note` | strike variant only: the disclosure, a `span` INSIDE `p.aicc-tier__free` after the trial line |
| `.aicc-tier__cur` | the explicit currency of Russian ("(USD)"), outside the struck text |
| `.aicc-pstate` (+ `__icon`, `__text`, `__link`), `data-ss-state` | the ONE compact status line of the section |
| `data-ss-cta="info"` | the new control family: a real link to the journey page. Families are now `link | info | status | purchase` |

Retired: `.aicc-tier__price--strike` (the faint grey strike). `.aicc-tier__price` stays for the closed / ordinary (`--standard`) card, where the price leads and has no label.

## 3. Markup

### 3.1 Live card (any state), Studio shown

```html
<article class="aicc-tier aicc-tier--featured aicc-tier--offer" aria-labelledby="plan-studio" data-plan="studio" data-featured>
  <div class="aicc-tier__plan">
    <div class="aicc-tier__head"><h3 class="aicc-tier__name" id="plan-studio"><bdi>Studio</bdi></h3><p class="aicc-tier__badge">{{ss.pricing.badge}}</p></div>
    <p class="aicc-tier__fit">{{ss.pricing.fit.studio}}</p>
    <div class="aicc-tier__cap" data-aicc-ss="paid"> ... unchanged ... </div>
    <!-- NO price here any more -->
  </div>
  <div class="aicc-tier__launch">
    <!-- A. default (public build) -->
    <div class="aicc-tier__offer aicc-tier__offer--planned" data-aicc-ss="regular" data-ss-price="planned">
      <p class="aicc-tier__offer-price"><bdi class="aicc-tier__amount">$199</bdi> <span class="aicc-tier__per">{{ss.pricing.perShort}}</span>[ <span class="aicc-tier__cur">(USD)</span> ru only]</p>
      <p class="aicc-tier__offer-label">{{ss.pricing.priceLabel}}</p>
      <p class="aicc-tier__offer-pill">{{ss.pricing.afterOffer}}</p>
    </div>
    <!-- B. strike variant (counsel-gated; see 5) replaces A -->
    <div class="aicc-tier__offer aicc-tier__offer--strike" data-aicc-ss="regular" data-ss-price="strike">
      <p class="aicc-tier__offer-price"><span class="aicc-sr-only">{{ss.pricing.strikeSr}} </span><s><bdi class="aicc-tier__amount">$199</bdi> <span class="aicc-tier__per">{{ss.pricing.perShort}}</span></s>[ <span class="aicc-tier__cur">(USD)</span>]</p>
      <p class="aicc-tier__offer-label">{{ss.pricing.strikeLabel}}</p>
    </div>
    <p class="aicc-tier__free" data-aicc-ss="free" data-ss-free>
      <span class="aicc-tier__free-word">{{ss.pricing.free}}</span>
      <span class="aicc-tier__trial"> ... {{ss.pricing.trial}}</span>
      <span class="aicc-tier__offer-note">{{ss.pricing.strikeNote}}</span>   <!-- B only -->
    </p>
    <div class="aicc-pcta" data-ss-cta="info|link"> ... 3.2 ... </div>
  </div>
  <p class="aicc-tier__incl"> ... unchanged ... </p>
</article>
```

The closed / ordinary card (`aicc-tier--standard`) keeps its P40 markup: `p.aicc-tier__price > span.aicc-tier__price-line` (amount and "per year"), NO label, NO FREE.
On the Control Plane, the paused card (`--closed` muted FREE) takes the same offer block and the same info control.

### 3.2 The control

* off / paused / static (information): `<div class="aicc-pcta" data-ss-cta="info"><a class="aicc-btn aicc-btn--lg aicc-btn--block aicc-btn--primary|outline" data-ss-state="static|off|paused" href="/{lang-prefix}get-started/?plan=<plan>"><span>{{ss.cta.how}}</span><span class="aicc-btn__icon aicc-flip" aria-hidden="true">arrow</span><span class="aicc-sr-only"> (Studio)</span></a></div>` (Studio primary, the others outline; the band link is plan-less and primary on the dark band). The link is a same-host path of the Site export, never `/start/`, never `#demo`.
* open / waitlist: unchanged from P40 (`data-ss-cta="link"`, `/start/?plan=`), but the waitlist link has NO per-card note and no `aria-describedby`: the waitlist fact is `ss.state.line.waitlist`, in the status line.
* closed: unchanged (`data-ss-cta="status"`, `p.aicc-pstatus` with the closed pill and `ss.state.closedNote`). Only this state still uses the status pill.

### 3.3 The status line (once per section, between the header block and the cards)

```html
<p class="aicc-pstate" role="status" id="ss-state-line" data-ss-state="off|paused|open|waitlist|static" data-ss-line="soon|paused|open|waitlist">
  <span class="aicc-pstate__icon" aria-hidden="true">clock | pause | circle-check</span>
  <span class="aicc-pstate__text">{{ss.state.line.<soon|paused|open|waitlist>}}</span>
  <a class="aicc-pstate__link" href="/{lang-prefix}#demo">{{ss.state.demo}}</a>   <!-- soon and paused only -->
</p>
```
Not rendered in the closed view. `data-ss-line` is the key of `ssLine()` (src/lib/ssStatus.ts); on the Control Plane the state comes from `AICC_LM_Signup::public_mode()` at render time. The Live Demo link is the Home page `#demo` (the same target as the hero button).

## 4. State table (Site: `ssControl()` / `ssLine()`; Control Plane: `public_mode()`)

| answer | control family | status line | header "Get started" |
|---|---|---|---|
| off, unknown, failed answer, static | info "See how it works" | `line.soon` + Live Demo link | journey page |
| paused | info | `line.paused` + Live Demo link | journey page |
| waitlist | link "Join the waitlist" | `line.waitlist` | `/start/` |
| open (or the static state of a link build) | link "Get started free" | `line.open` | `/start/` |
| closed_cutoff, or the clock at or after 2026-12-24T00:00:00Z | status "Registration closed" (closed cards, no FREE) | none | journey page |

## 5. The planned price: default and strike (compliance memo of 2026-11-18, sections 4, 5, 7)

Hierarchy per card, directly above the large FREE: default = `$99 / year` (muted, NOT struck) + label "Planned regular price" + pill "Starts after the launch offer" + chevron; strike = ~~`$99 / year`~~ + label "Planned regular annual price after the launch offer, not a current or past price." + FREE + trial line + "Nothing has been charged at this price yet. No payment method needed; nothing is charged automatically."

KIT 4: the price line (amount and unit, struck or not, plus the Russian "(USD)") is ONE line: `white-space: nowrap` and a container-query fit like the FREE word, `font-size: min(2.5rem, 100cqi / var(--aicc-offer-em))` on `.aicc-tier__offer-price` (the `.aicc-tier__offer` block is the container; `--aicc-offer-em` = the longest price in em with headroom for WCAG 1.4.12 text spacing: en 7.8, he 7.3, es 9.1, ru 9.4). In a narrow card the size shrinks instead of the line wrapping (about 20 px at 200% text on a 320 px phone). The status line text and link use `overflow-wrap: anywhere` with `min-inline-size: 0`, so a long word wraps inside the line.

The strike is one `<s>` holding the amount AND its unit in ONE font size, so one decorating box draws one continuous line (a smaller unit would be struck at the wrong height). The line is `text-decoration-thickness: max(3px, .085em)` in the danger colour (red-700, 6.5:1 on white). The label is 1rem (>= 14 px, 40 % of the 2.5rem amount), contrast >= 4.5:1. Visually hidden announcement text precedes the amount (`ss.pricing.strikeSr`). Never "was / previously / original / save / worth / normally / regular price alone" (guards: `scripts/lib/early-access-truth.mjs` `priceWordProblems`, `test:ss-guards`, `test:pricing-browser` J).

Gates implemented on the Site: build `NEXT_PUBLIC_AICC_EA_STRIKE=on` only (default OFF); the production builder refuses it without `AICC_EA_STRIKE_COUNSEL_APPROVED=<reference>`; the strike renders only in a launch-offer build (`EA_ON`, i.e. built before the offer end), only with a finite positive price from `src/data/plans.ts` (the single build-time source), and only inside the LIVE card set, which the browser clock hides from 2026-12-24T00:00:00Z (`<html data-ss-closed>`) and from the trial end (`data-ea-over`); every export marker (`data-ss-price="strike"`, `aicc-tier__offer--strike`, any `<s>` / `<del>`) is refused by the release gate, `launch:check` and the public-truth gate (`scripts/lib/strike-markup.mjs`); a test fails on strike markup without label + disclosure in the same card. The Control Plane must apply the same gates with its own server clock and its WooCommerce price (memo 7.1 / 7.2).

## 6. Msgids (60 keys in `selfservice-msgids.txt`; delta against the P40 snapshot of 55)

Added (11): `ss.cta.how`, `ss.state.line.soon`, `ss.state.line.paused`, `ss.state.line.open`, `ss.state.line.waitlist`, `ss.state.demo`, `ss.pricing.perShort`, `ss.pricing.afterOffer`, `ss.pricing.strikeLabel`, `ss.pricing.strikeNote`, `ss.pricing.strikeSr`.
Retired (6): `ss.cta.soon`, `ss.cta.paused`, `ss.state.soonNote`, `ss.state.pausedNote`, `ss.state.waitlistNote` (its sentences moved into `ss.state.line.waitlist`), `ss.pricing.priceLabelStrike` ("Regular price" alone is a forbidden reading).
Changed value (1): `ss.launch.foot.paid` ("Their planned regular prices apply once they open." and the he / es / ru equivalents: "regular prices" without "planned" is now a forbidden reading). `ss.pricing.per` ("per year") stays for the closed card; the offer uses `ss.pricing.perShort` ("/ year").
The journey page strings are NOT in the snapshot: they live in `ea.journey` (Site only).

## 7. The page `/get-started/` (+ /he /es /ru)

Site only, static server HTML plus two small client islands (`src/components/ss/SsJourney.tsx`: plan chips, state-aware action). Exists only in a self-service build (`src/lib/requestRoutes.ts`); needs NO edge change. Nine steps in three phases (account, store, recommendations), the state panel first in DOM order (it is the first thing a visitor needs), then the steps; the trial terms with the two UTC dates sit in `[data-jr-terms]` (hidden in the closed view): the dates are written once on the page.
