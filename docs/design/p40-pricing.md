# P40 premium pricing section: design, markup skeleton and class contract

Status: Stage A (design lead), local only on `feat/p40-pricing` (from P39 tip 7ad5615). Nothing pushed, nothing deployed. Two builders integrate this afterwards: Stage B (Site, Next.js static export) and Stage C (Control Plane, WordPress theme `aicc-admin`). Both render the SAME markup with the SAME stylesheet.

* Stylesheet (single source): the brand kit, `brand/aicc-brand.css`, section `P40 PRICING BEGIN ... END` (about 20 KB, 200 lines). It reaches the Site through `src/app/globals.css` (`@import "../../brand/aicc-brand.css"`) and the theme through `node scripts/sync-brand-kit.mjs --to <theme>` (the theme already enqueues `assets/brand/aicc-brand.css` on every page: `inc/enqueue.php`, handle `aicc-brand`). No new file, no enqueue change, no new dependency. `brand/MANIFEST.json` is regenerated (`npm run brand:build`).
* Prototype and checks: `design/p40/` (`render.mjs` = the markup skeleton as code, `copy.json` = new/changed copy, `build.mjs`, `shots.mjs`, `geometry.mjs`, `modes.mjs`; see section 6).
* Everything below was checked in a real browser (Chromium) with the real kit CSS, the real Geist subsets the Site ships and the real kit icons.

## 1. What changed for the visitor, in one paragraph

Before: three tall admin-style cards (about 790 px each at 1440, about 830 px each on a phone), the two dates repeated in every card, in the terms block and again in the closing band, a weak price/FREE relationship, a plain-text "registration opens soon" and a duplicate "Try Live Demo" link in each card. After: three compact plans (about 580 px at 1440, about 400 px on a phone) that each answer, top to bottom, "who is it for, how many stores can I connect when I pay, what will it cost, what do I get now (FREE, 1 store), what can I do now (one control)". The dates and every trial condition are said once, in one designed launch panel under the cards, as a two-milestone timeline (registration closes, then trial access ends) plus three facts. Studio is the recommended plan. The control is either a real link (open, waitlist, purchase) or an unmistakably non-interactive status region (soon, closed, paused), with a second line saying what happens.

## 2. Design plan (pass 1), critique, revision (pass 2)

### 2.1 Pass 1 (the first idea, written before building)

* Palette: mist `#f8fafc` / sunken `#f1f5f9` (page), white cards, navy `#0f172a` ink, blue `#2563eb`/`#1d4ed8`, emerald `#047857`, navy-950 `#0b1220` for the closing band (all existing tokens).
* Type: Geist only (the site face), Heebo/system for Hebrew exactly as the live Site.
* Layout: three equal white cards, the amount in big type, a gradient "FREE", a "Get started" button, Studio with a gradient border, a terms block under the cards.
* Principle: "make it cleaner".

### 2.2 Critique against the brief and against generic SaaS defaults

That plan is what a generator produces for any pricing page: three identical rounded cards with the same soft shadow, a big gradient number as the hero of each card (the "big number plus gradient accent" default), a gradient-bordered middle card, the same radius for everything. It does not use anything AICC knows: the unit of price is the STORE. It also puts the paid facts and the free trial into one undifferentiated stack, so "FREE" and "up to 10 stores" sit next to each other and invite exactly the misreading the owner forbade (Studio/Agency giving several stores free). And a gradient FREE next to a gradient CTA makes FREE look like a button.

### 2.3 Pass 2 (what was changed, and why)

1. **One memorable element: store capacity made visible.** A row of ten tiny storefronts (awning plus door, drawn with borders only) on every card. Filled blue = the stores the paid plan connects (1, 3, 10 of a common 10-slot scale, so the cards are comparable at a glance). The launch trial is ONE green storefront next to "Launch trial: 1 store". Different colour, different place, different words: trial 1 store versus paid capacity cannot be confused. It is decorative (`aria-hidden`); the words carry the meaning. It is also the only decoration in the section.
2. **Two zones per card instead of one stack.** A faintly blue "plan" zone (name, who it is for, paid capacity, planned regular price) and a white "launch" zone (FREE, the trial allowance, the one control). The tint says "this is the plan you may buy later"; the white zone says "this is what you get now". It also gives the tablet layout for free (zones become two columns).
3. **FREE is navy, very heavy, huge, and not a gradient.** Dominance by size and weight, not by colour, so the only gradients left are Studio's border and the primary control: the gradient always means "this is the action / the recommended plan".
4. **Price LARGE but below FREE.** `$199` is 2.25rem semibold with its "Planned regular price" label above and "per year" after; FREE is up to 3.75rem extra bold. No strikethrough, no "was", no discount in the public build.
5. **Studio = Recommended.** Gradient border, a blue-to-green wash on its plan zone, a deeper shadow, a "Recommended" badge, the primary gradient control, and on desktop a 0.625rem balanced raise (above and below) that does NOT move its content (rows stay aligned with Solo and Agency). Solo and Agency are quiet but complete (outline control, full colour glyphs), never "disabled".
6. **The inactive control is a pill-shaped status region, not a faded button.** Dashed border, tinted fill, leading icon (clock / pause / lock), no arrow, no hover, not focusable, `role="status"`; a second line says what happens. It differs from the active control by shape (dashed versus solid), fill (tint versus gradient/white), icon (state icon versus trailing arrow) and words, never by colour alone.
7. **Dates and conditions once.** One launch panel: a two-node timeline (a ring = the gate, "Registration closes"; a solid node = the end, "Trial access ends"), the last-day note, and three facts. Vertical on a phone, horizontal from 40rem. This is the only place a date appears on the page (plus the Hero pill and bar the Site already has, which carry no date).
8. **Registration closed (after the cutoff) steps FREE back** (smaller, muted, grey glyph) so a card never advertises something that cannot be started; the purchase link or the unavailable state leads instead.
9. **Rejected, on purpose:** a carousel on mobile (hidden content, horizontal scroll); a popularity/"most popular" claim, countdowns, scarcity counters, "save X%", a pulsing badge (owner rules); animating the slots on scroll (decorative-only motion); numbered markers 01/02/03 (the content is not a sequence, except the two milestones, which ARE a sequence and are the only ordered list); all-caps eyebrows above headings; a gradient headline accent word; a monospace face for labels; the same card chrome repeated for the panel (the panel is quieter than the cards: one border, one soft shadow, no tint).

### 2.4 Tokens used (all from `brand/aicc-tokens.css`, no new token)

| Role | Token | Value |
|---|---|---|
| Page / section | `--aicc-bg`, `--aicc-surface-sunken` | `#f8fafc`, `#f1f5f9` |
| Card, panel | `--aicc-surface`, `--aicc-border`, `--aicc-border-strong` | `#fff`, `#e2e8f0`, `#cbd5e1` |
| Ink / muted | `--aicc-text`, `--aicc-text-muted` | `#0f172a`, `#475569` |
| Paid capacity, links, ring node | `--aicc-primary-strong`, `--aicc-primary` | `#1d4ed8`, `#2563eb` |
| Trial / success | `--aicc-success`, `--aicc-success-bg` | `#047857`, `#ecfdf5` |
| Primary control, badge, Studio border | `--aicc-gradient-action`, `--aicc-gradient-action-aa` | AA gradients of the kit |
| Dark band | `--aicc-surface-inverse`, `--aicc-text-inverse(-muted)` | `#0b1220`, `#fff`, `#cbd5e1` |
| Radius / shadow | `--aicc-radius-xl` (cards, panel), `--aicc-radius-pill`, `--aicc-shadow-sm/md/lg` | 1.5rem, 999px |
| Motion | `--aicc-dur`, `--aicc-ease` | collapse under reduced motion |
| Focus | existing `.aicc-btn:focus-visible` ring (`--aicc-focus`, `--aicc-focus-on-dark`) | 2px, offset 2px |

Raw colours in the section: only `rgb()` tints of token colours at 4.5 % to 12 % (zone washes, trial glyph body), plus `#fff` for text on the AA gradients (the kit does the same) and `#000` in `@media print`.

### 2.5 Type scale (Geist; Hebrew falls through to the system Hebrew face as on the live Site)

| Element | Size | Weight | Notes |
|---|---|---|---|
| Section title (optional) | `--aicc-text-3xl` | 700 | page-owned on Home/Pricing |
| Plan name `h3` | 1.375rem | 650 | `<bdi>` isolates the Latin name in RTL |
| Positioning line | 0.9375rem (`--aicc-text-sm`) | 400 | muted, max 3 lines at 1024 |
| Paid capacity text | 0.9375rem | 650 | |
| Regular price label | 0.8125rem | 400 | muted |
| Amount | `min(2.25rem, 11vw)` | 700, tabular | 2.75rem in the ordinary (after-trial) card |
| "per year" | 0.9375rem | 500 | muted |
| FREE word | 2rem to 3.75rem, container-query sized | 800, tracking -0.035em | per-language width table below |
| Trial line | 1rem | 650 | success green |
| Control label | 1rem (`.aicc-btn--lg`) / 0.9375rem (status pill) | 600-650 | |
| Notes | 0.875rem | 400 | muted |
| Panel title | 1.5rem | 700 | |
| Timeline date | 1.25rem | 700, tabular | |

FREE is sized by its container (`container-type: inline-size` on the `p`, `font-size: clamp(min(1.5rem, 9vw), calc(100cqi / var(--aicc-free-em)), 3.75rem)`), with `--aicc-free-em` = the word's width in em per language: en 2.7, he 2.6, es 4.1, ru 7 (БЕСПЛАТНО). The word therefore always fits its card at any width and any text size, and `overflow-wrap: anywhere` is the last resort (never clipping). A `vw` fallback exists for browsers without container units.

### 2.6 Wireframes

Desktop (3 columns, Studio raised, rows shared by subgrid):

```
 +----------------------+  +=======================+  +----------------------+
 | Solo                 |  | Studio  [Recommended] |  | Agency               |
 | For independent ...  |  | For growing ...       |  | For teams ...        |
 | Paid plan: 1 store   |  | Paid plan: up to 3    |  | Paid plan: up to 10  |
 | [#][ ][ ][ ] ... [ ] |  | [#][#][#][ ] ... [ ]  |  | [#][#][#][#] ... [#] |
 | Planned regular price|  | Planned regular price |  | Planned regular price|
 | $99 per year         |  | $199 per year         |  | $499 per year        |
 |  (blue-tinted zone)  |  |  (blue/green wash)    |  |                      |
 |----------------------|  |-----------------------|  |----------------------|
 | FREE                 |  | FREE                  |  | FREE                 |
 | [g] Launch trial: 1  |  | [g] Launch trial: 1   |  | [g] Launch trial: 1  |
 | ( Get started free ->)  | (( Get started free ->))|  | ( Get started free ->)|
 | v Every feature, ... |  | v Every feature, ...  |  | v Every feature, ... |
 +----------------------+  +=======================+  +----------------------+
 +----------------------------------------------------------------------------+
 | [Launch offer]            o-----------------------------o                  |
 | How the free trial works  Registration closes    Trial access ends         |
 | Whichever plan you pick.. Dec 24, 2026 at 00:00  Dec 31, 2026 at 22:00 UTC |
 |---------------------------------------------------------------------------|
 | [g] 1 store, any plan   v No payment method    v No automatic conversion   |
 | footnote (paid plans not open; registration can close or move to waitlist) |
 +----------------------------------------------------------------------------+
```

Tablet (40rem to 61.99rem): each plan is a row (identity | launch), the footer line spans; panel keeps a horizontal timeline. Phone (under 40rem): one column per plan (about 400 px), then the panel with a vertical timeline.

```
 +--------------------------------------+     +-------------------+
 | Solo                    |  FREE      |     | Solo              |
 | For independent ...     |  [g] Launch|     | For independent.. |
 | Paid plan: 1 store      |  ( status )|     | Paid plan: 1 store|
 | [#][ ][ ] ...           |  note      |     | [#][ ][ ] ...     |
 | $99 per year            |            |     | $99 per year      |
 | v Every feature, on every plan       |     | FREE              |
 +--------------------------------------+     | [g] Launch trial  |
                                              | ( Get started ->) |
                                              | v Every feature.. |
                                              +-------------------+
```

Alignment: everything start-aligned (text-align: start), except the status pill and its note, which centre inside the pill and under it. RTL mirrors by logical properties; nothing is hand-mirrored.

## 3. Markup skeleton (semantic HTML, framework-neutral)

Conventions: `{{key}}` = a copy string by msgid (section 5); `{{plan}}` = Solo | Studio | Agency (inside `<bdi>`); `{{svg:name}}` = the kit icon (`brand/js/icons.js`, 18px, `aria-hidden="true" focusable="false"`; React: lucide-react with the same names; PHP: `aicc_brand_icon()`). `data-plan` is `solo|studio|agency`. DOM and reading order is Solo, Studio, Agency; nothing is reordered visually. The reference implementation is `design/p40/render.mjs` (it is what the screenshots were taken from).

### 3.1 Section and header

```html
<section class="aicc-pricing" aria-labelledby="pricing-title" data-aicc-pricing>
  <!-- optional: the pages keep their own SectionHeading; the kit classes exist when a page has none -->
  <header class="aicc-pricing__head">
    <h2 class="aicc-pricing__title" id="pricing-title">{{page title}}</h2>
    <p class="aicc-pricing__lead">{{ss.pricing.lead}}</p>
  </header>

  <div class="aicc-tiers" data-aicc-ss="plans"> <!-- 3 x article.aicc-tier --> </div>

  <section class="aicc-launch" id="free-trial" ...> <!-- 3.4: ONE per page --> </section>
</section>
```

`id="free-trial"` stays the target of the announcement-bar link and of every "How the free trial works" link (one id per page).

### 3.2 The plan card (standard build, any control state; Studio shown, Solo/Agency differ where marked)

```html
<article class="aicc-tier aicc-tier--featured"            <!-- Studio only: --featured. Add --closed when registration is closed or paused (3.3). -->
         aria-labelledby="plan-studio" data-plan="studio" data-featured>
  <div class="aicc-tier__plan">
    <div class="aicc-tier__head">
      <h3 class="aicc-tier__name" id="plan-studio"><bdi>Studio</bdi></h3>
      <p class="aicc-tier__badge">{{ss.pricing.badge}}</p>             <!-- Studio only; Solo/Agency: no badge element -->
    </div>
    <p class="aicc-tier__fit">{{ss.pricing.fit.studio}}</p>
    <div class="aicc-tier__cap" data-aicc-ss="paid">
      <p class="aicc-tier__cap-text">{{ss.plan.paidMany n=3}}</p>      <!-- Solo: ss.plan.paidOne; Agency: paidMany n=10 -->
      <span class="aicc-cap" aria-hidden="true">                       <!-- always 10 spans; the first N (1 | 3 | 10) carry --on -->
        <span class="aicc-cap__slot aicc-cap__slot--on"></span> ... <span class="aicc-cap__slot"></span>
      </span>
    </div>
    <p class="aicc-tier__price" data-aicc-ss="regular">
      <span class="aicc-tier__price-label">{{ss.pricing.priceLabel}}</span>
      <span class="aicc-tier__price-line"><bdi class="aicc-tier__amount">$199</bdi> <span class="aicc-tier__per">{{ss.pricing.per}}</span></span>
    </p>
  </div>

  <div class="aicc-tier__launch">
    <p class="aicc-tier__free" data-aicc-ss="free" data-ss-free>
      <span class="aicc-tier__free-word">{{ss.pricing.free}}</span>
      <span class="aicc-tier__trial">
        <span class="aicc-cap aicc-cap--trial" aria-hidden="true"><span class="aicc-cap__slot aicc-cap__slot--on"></span></span>{{ss.pricing.trial}}
      </span>
    </p>
    <!-- the ONE control: section 3.3 -->
  </div>

  <p class="aicc-tier__incl"><span class="aicc-tier__incl-icon" aria-hidden="true">{{svg:check}}</span>{{ss.pricing.incl}}</p>
</article>
```

Rules: the price amount is the plan's `AICC_LM_Plans::all()` price (CP) or `src/data/plans.ts` (Site), formatted by the existing `formatPrice()` / `aicc_price_html()`; `currencySuffix()` appends " (USD)" in Russian. The capacity N comes from the same source (CP: `limit`; Site: `stores`). There is NO "Try Live Demo" link in a card, NO date in a card, NO trial condition in a card.

### 3.3 The control, in every state

Wrapper (all states): `<div class="aicc-pcta" data-ss-cta="link|status|purchase">`. The state values are the existing ones (Site `src/lib/ssStatus.ts`: `open | waitlist | closed_cutoff | paused | off`, plus `static` before the status answer = `off`; CP `AICC_LM_Signup::public_mode()`).

**open** (link, "Get started free"; Studio primary gradient, Solo/Agency outline):

```html
<div class="aicc-pcta" data-ss-cta="link">
  <a class="aicc-btn aicc-btn--lg aicc-btn--block aicc-btn--primary"   <!-- Solo/Agency: aicc-btn--outline -->
     data-ss-state="open" href="/{{lang-prefix}}start/?plan=studio">
    <span>{{ss.cta.start}}</span>
    <span class="aicc-btn__icon aicc-flip" aria-hidden="true">{{svg:arrow-right}}</span>
    <span class="aicc-sr-only"> (Studio)</span>
  </a>
</div>
```

**waitlist** (link, same URL; the note explains, and is the link's description):

```html
<div class="aicc-pcta" data-ss-cta="link">
  <a class="aicc-btn aicc-btn--lg aicc-btn--block aicc-btn--primary" data-ss-state="waitlist" href="/{{lang-prefix}}start/?plan=studio" aria-describedby="plan-studio-note">
    <span>{{ss.cta.waitlist}}</span><span class="aicc-btn__icon aicc-flip" aria-hidden="true">{{svg:arrow-right}}</span><span class="aicc-sr-only"> (Studio)</span>
  </a>
  <p class="aicc-pcta__note" id="plan-studio-note">{{ss.state.waitlistNote}}</p>
</div>
```

**soon / off / unknown / static** (non-interactive status; NOT a button, NOT a link, never focusable, never to `#demo` or a 404):

```html
<div class="aicc-pcta" data-ss-cta="status">
  <p class="aicc-pstatus" role="status" data-ss-state="off">          <!-- Site before the answer: data-ss-state="static" -->
    <span class="aicc-pstatus__pill">{{svg:clock}}<span class="aicc-pstatus__label">{{ss.cta.soon}}</span></span>
    <span class="aicc-pstatus__note">{{ss.state.soonNote}}</span>
  </p>
</div>
```

**paused**: same, `data-ss-state="paused"`, icon `pause`, label `ss.cta.paused`, note `ss.state.pausedNote`.

**closed after the cutoff, paid purchase NOT open** (CP: `aicc_commerce_closed()`; Site: always, it has no purchase link): status markup, `data-ss-state="closed_cutoff"`, icon `lock`, label `ss.cta.closed`, note `ss.state.closedNote` ("No new trials can be started. Paid plans are not open for purchase yet."). The card gets `aicc-tier--closed` (FREE steps back).

**closed after the cutoff, paid purchase OPEN** (CP only: `! aicc_commerce_closed()`; the link is `AICC_LM_Plans::purchase_url( $plan['id'] )`, never a checkout that cannot complete):

```html
<div class="aicc-pcta" data-ss-cta="purchase">
  <p class="aicc-pcta__note" data-ss-state="closed_cutoff">{{ss.state.closedPaidNote}}</p>
  <a class="aicc-btn aicc-btn--lg aicc-btn--block aicc-btn--primary" data-ss-state="purchase" href="{{purchase_url}}"><span>{{ss.cta.purchase plan=<bdi>Studio</bdi>}}</span></a>
</div>
```

**After the trial END** (the ordinary card, hidden/shown by the existing `data-ea-live` / `data-ea-after` mechanism): the price leads and the launch zone holds only the ordinary control (the existing "Purchases open soon" status, or "Choose {plan}"). Markup: `aicc-tier aicc-tier--standard`; `.aicc-tier__price` WITHOUT the label; `.aicc-tier__launch` containing only `.aicc-pcta[data-ss-cta=status] > p.aicc-pstatus[role=status][data-commerce=closed]` (icon `info`, label `common.soon.label`) or the purchase link. In a Site export that carries both views, mark the launch-only parts `data-ea-live` (`.aicc-tier__price-label`, the whole FREE zone, the panel, the band) and the ordinary parts `data-ea-after`; the kit needs nothing else.

### 3.4 The shared launch panel (ONE per page, below the cards)

```html
<section class="aicc-launch" id="free-trial" aria-labelledby="launch-title" data-aicc-ss="launch" data-ss-terms>
  <div class="aicc-launch__intro">
    <p class="aicc-launch__tag">{{ss.launch.tag}}</p>
    <h3 class="aicc-launch__title" id="launch-title">{{ss.link}}</h3>
    <p class="aicc-launch__sub">{{ss.launch.sub}}</p>
  </div>
  <ol class="aicc-timeline" aria-label="{{ss.plan.datesLabel}}" data-ss-dates>
    <li class="aicc-timeline__step" data-ss-date="registration">
      <span class="aicc-timeline__node" aria-hidden="true"></span>
      <span class="aicc-timeline__label">{{ss.plan.regLabel}}</span>
      <span class="aicc-timeline__date">{{ss.plan.regValue}}</span>
      <span class="aicc-timeline__note">{{ss.launch.regNote}}</span>
    </li>
    <li class="aicc-timeline__step" data-ss-date="end">
      <span class="aicc-timeline__node" aria-hidden="true"></span>
      <span class="aicc-timeline__label">{{ss.plan.endLabel}}</span>
      <span class="aicc-timeline__date">{{ss.plan.endValue}}</span>
      <span class="aicc-timeline__note">{{ss.launch.endNote}}</span>
    </li>
  </ol>
  <ul class="aicc-launch__facts" aria-label="{{ss.terms.label}}" data-ss-checks>
    <li class="aicc-launch__fact"><span class="aicc-launch__fact-icon" aria-hidden="true"><span class="aicc-cap aicc-cap--trial"><span class="aicc-cap__slot aicc-cap__slot--on"></span></span></span><span>{{ss.launch.fact.store}}</span></li>
    <li class="aicc-launch__fact"><span class="aicc-launch__fact-icon" aria-hidden="true">{{svg:check}}</span><span>{{ss.launch.fact.payment}}</span></li>
    <li class="aicc-launch__fact"><span class="aicc-launch__fact-icon" aria-hidden="true">{{svg:check}}</span><span>{{ss.launch.fact.noAuto}}</span></li>
  </ul>
  <p class="aicc-launch__foot">{{ss.launch.foot.paid | ss.launch.foot.paidOpen}} {{ss.terms.state}}</p>
</section>
```

The dates come from the existing token resolution (`{regShort}`, `{until}`, `{regLast}`; Site `src/i18n/eaTokens.ts`; CP the same table via `aicc_ss_shared_h`). The displayed expiry follows the authoritative effective policy (CP: the plugin value; Site: the single build-time source); the inactive Jan-10 extension is not advertised and the markup carries no machine-readable duplicate of a date (no `<time datetime>`), so nothing can contradict the text. `foot.paidOpen` replaces `foot.paid` only when paid purchase is open (CP, after the cutoff).

### 3.5 The closing band (inside the page's dark band; no dates, no trial conditions)

```html
<div class="aicc-pband" data-aicc-ss="band" data-ss-band>
  <p class="aicc-pband__lead">{{ss.band.lead}}</p>
  <div class="aicc-pband__actions">
    <div class="aicc-pcta aicc-pcta--inverse" data-ss-cta="link|status|purchase"> <!-- 3.3 with the --inverse modifier; plan-less: href="/start/" (no ?plan=), no (Plan) sr text -->
    </div>
    <!-- optional, and only if it adds value: ONE quiet secondary link (See pricing / Try Live Demo) as a sibling .aicc-btn--ghost -->
  </div>
</div>
```

Band control per state: open "Get started free", waitlist "Join the waitlist", soon/closed/paused the inverse status region, purchase state `{{ss.cta.choosePlan}}` linking to `#plans` / the plan cards (the band is not plan-specific, so it never says "Choose undefined"). The band's heading (`Start with one store.`) stays page-owned. The hero's "Try Live Demo" and "See Pricing" are not touched.

### 3.6 Feature-gated strikethrough price (default OFF, never in the public build)

Only the price block changes; the label becomes `{{ss.pricing.priceLabelStrike}}` and the amount a `<s>`:

```html
<p class="aicc-tier__price aicc-tier__price--strike" data-aicc-ss="regular" data-ss-price="strike">
  <span class="aicc-tier__price-label">{{ss.pricing.priceLabelStrike}}</span>
  <span class="aicc-tier__price-line"><s class="aicc-tier__amount"><bdi>$199</bdi></s> <span class="aicc-tier__per">{{ss.pricing.per}}</span></span>
</p>
```

Gate: Site build flag `NEXT_PUBLIC_AICC_EA_STRIKE=on` (already exists, `src/lib/earlyAccess.ts` `EA_STRIKE`; `launch:check` already refuses it without `AICC_EA_STRIKE_COUNSEL_APPROVED=<reference>`); CP constant (default false, e.g. `AICC_PRICING_STRIKE`) read by `plan-cards.php`, with the same "refused in a production build unless a documented explicit approval flag is also set" rule in `public-truth-gate`. The class `aicc-tier__price--strike` and the markup `<s class="aicc-tier__amount">` are NEW markers: Stage B must add them to the strike detectors in `scripts/launch-check.mjs` (line 157, which today matches `class="...aicc-plan__regular--strike` and `<s><bdi>`) and `scripts/ea-check.mjs` (lines 543-553), otherwise a built export that carries the new struck price would not raise the counsel blocker. The kit CSS (a stylesheet, not markup) naming the class must NOT trigger the gate (the existing test for the inline stylesheet already covers that rule).

## 4. Class contract (BEM; every class below is defined in the kit; nothing else may style these elements)

Namespaces were chosen to avoid every existing class: ``node scripts/check-brand-collisions.mjs --theme <theme>` passes against the Control Plane theme (it caught `.aicc-facts` and `.aicc-slots` during the work; they became `.aicc-launch__facts` and `.aicc-cap`). The old `.aicc-plan*`, `.aicc-ssdates`, `.aicc-sstate`, `.aicc-plan__ssctl`, `.aicc-eaterms` classes are NOT reused and stay in `src/styles/aicc.css` / the theme CSS for the other modes (launch offer without self-service, ordinary purchase cards); Stage B/C may delete the self-service-only ones once nothing renders them.

| Block / element | Modifiers | Purpose |
|---|---|---|
| `.aicc-pricing` | | the section; sets `--aicc-tier-px` (card side padding, `min(1.5rem, 6vw)`, 1.375rem at 62rem+), scoped `box-sizing`, zero-specificity resets, scoped `.aicc-sr-only` |
| `.aicc-pricing__head`, `__title`, `__lead` | | optional header (pages may keep their own) |
| `.aicc-tiers` | | the plan grid. Phone 1 column; 40rem to 61.99rem each plan is a row; 62rem+ three columns, 7 shared rows (subgrid) |
| `.aicc-tier` | `--featured` (Studio), `--closed` (registration closed or paused: FREE steps back; also applied without the class through `:has()` on the control's `data-ss-state` = `closed_cutoff|paused`), `--standard` (ordinary card after the trial end) | one plan (`article`) |
| `.aicc-tier__plan` | | plan zone (tinted) |
| `.aicc-tier__head`, `__name`, `__badge` | | name row; `__badge` = "Recommended" (Studio) |
| `.aicc-tier__fit` | | positioning line |
| `.aicc-tier__cap`, `__cap-text` | | paid capacity block and its words |
| `.aicc-cap`, `.aicc-cap__slot` | `.aicc-cap--trial` (single green store), `.aicc-cap__slot--on` (filled) | the store glyph row; decorative, `aria-hidden` on the `.aicc-cap` |
| `.aicc-tier__price`, `__price-label`, `__price-line`, `__amount`, `__per` | `.aicc-tier__price--strike` (gated variant) | planned regular price |
| `.aicc-tier__launch` | | launch zone (FREE + the control) |
| `.aicc-tier__free`, `__free-word`, `__trial` | | FREE and the trial allowance line |
| `.aicc-tier__incl`, `__incl-icon` | | footer line "Every feature, on every plan" |
| `.aicc-pcta` | `--inverse` (on the dark band) | wrapper of the control; `__note` = line above/below the control |
| `.aicc-pstatus`, `__pill`, `__label`, `__note` | | non-interactive status region |
| `.aicc-btn` (kit) | `--lg --block --primary|--outline` | the link states reuse the kit button; the section only adds `min-block-size: 3.5rem` and responsive side padding |
| `.aicc-launch` | | the shared panel |
| `.aicc-launch__intro`, `__tag`, `__title`, `__sub`, `__foot` | | intro and footnote |
| `.aicc-timeline`, `__step`, `__node`, `__label`, `__date`, `__note` | | the two-milestone timeline (`ol`) |
| `.aicc-launch__facts`, `__fact`, `__fact-icon` | | the three facts (`ul`) |
| `.aicc-pband`, `__lead`, `__actions` | | closing band content |

### 4.1 Data attributes (hooks for tests and scripts; styling uses classes, except the `:has()` rule on `data-ss-state` described under `.aicc-tier--closed`)

| Attribute | Where | Values |
|---|---|---|
| `data-aicc-pricing` | `section.aicc-pricing` | presence |
| `data-aicc-ss` | the CP's existing hook family, now on both surfaces | `plans`, `paid`, `regular`, `free`, `launch`, `band` |
| `data-plan` | `article.aicc-tier` | `solo|studio|agency` |
| `data-featured` | Studio's article | presence |
| `data-ss-cta` | `.aicc-pcta` | `link|status|purchase` (what kind of control) |
| `data-ss-state` | the control element (`a.aicc-btn`, `p.aicc-pstatus`, `p.aicc-pcta__note` in purchase) | `open|waitlist|purchase|off|static|closed_cutoff|paused` (existing Site values; CP additionally keeps its old `data-aicc-ss=<mode>` if its tests need it) |
| `data-commerce="closed"` | the ordinary "Purchases open soon" status | existing hook, kept |
| `data-ss-free`, `data-ss-checks`, `data-ss-dates`, `data-ss-date=registration|end`, `data-ss-terms`, `data-ss-band` | as in the skeleton | existing Site hooks, kept so most browser tests survive |
| `data-ss-price="strike"` | gated price | new |
| `data-ea-live` / `data-ea-after` | launch-only parts / ordinary parts | existing Site mechanism (hidden by `html[data-ea-over]`); the kit does not depend on it |
| RETIRED | `data-ss-demo` (the per-card demo link is gone), `data-ss-support*` (Hero, untouched) | |

### 4.2 ARIA behaviour per state

| State | Element | Semantics |
|---|---|---|
| open | `a.aicc-btn` | a link; name = "Get started free (Studio)" (the plan name is a visually hidden suffix, as today); one tab stop per card |
| waitlist | `a.aicc-btn` | a link, `aria-describedby` = the note ("... The waitlist does not reserve one.") |
| soon / off / unknown | `p.aicc-pstatus[role=status]` | not focusable, not a link, not a button; the pill carries the state, the note says what happens; the icon is `aria-hidden` |
| closed (cutoff) | `p.aicc-pstatus[role=status]` | same; label "Registration closed", note says no new trials and that paid plans are not open |
| paused | `p.aicc-pstatus[role=status]` | same |
| purchase | `a.aicc-btn` | a link "Choose Studio"; the line above it ("Free trial registration has closed.") is plain text |
| band | same elements, `--inverse` | the plan-less link says "Get started free"; no plan suffix |

`role="status"` on static server HTML is not announced at load (live regions announce changes); on the Site, when the status answer changes the control, the new `role=status` text is announced politely. No focus is ever moved. The 4 status regions (3 cards and the band) are separate regions on purpose: each is next to what it describes. Section and panel are named landmarks-by-heading (`aria-labelledby`), the timeline is an ordered list with an `aria-label`, the capacity glyphs are hidden from assistive technology, FREE and the trial line read in order ("FREE. Launch trial: 1 store."). Heading hierarchy: `h2` section (page-owned), `h3` plan names and the panel title; the band heading is the page's own `h2`.

### 4.3 Responsive behaviour

| Width | Behaviour |
|---|---|
| 320 (and 200 % text) | one column; card side padding `min(1.5rem, 6vw)`; amount `min(2.25rem, 11vw)`; FREE floor `min(1.5rem, 9vw)`; control padding `min(2rem, 4vw)`; every long word may break (`overflow-wrap`), nothing is clipped, no horizontal scroll |
| 375, 390, 430 | one column; about 400 px per card; panel timeline vertical; facts stacked |
| 768 | one row per plan (identity left, FREE and control right), footer spans, panel timeline horizontal, three facts in a row |
| 1024 | three columns (`62rem`), shared rows (subgrid), Studio raised 0.625rem above and below; panel: intro left, timeline right, facts full width |
| 1440 | same, container 80rem |
| 1920 | same (the container caps at 80rem; the section never stretches) |

Without subgrid support (`@supports not (grid-template-rows: subgrid)`) the three columns fall back to flex stacks with a minimum height for the positioning line, so rows still line up in the common case. No fixed heights anywhere; every box grows with its text.

### 4.4 RTL notes

* Logical properties only (`inline-size`, `margin-inline`, `inset-inline`, `border-block-start`, `padding-inline`, `text-align: start`): Hebrew mirrors the grid, the timeline (step 1 on the right), the badge, the arrow (`.aicc-flip` + the kit's `[dir=rtl] .aicc-btn__icon` rule) and the rail. No `left`/`right` and no direction-specific gradients are used.
* Prices and names: `<bdi>` around the plan name and the amount (`$199` stays readable); Hebrew times keep the P39 left-to-right isolate (U+2066 ... U+2069) and the no-break space inside the existing `ss.plan.regValue/endValue` strings, which the panel renders unchanged.
* Hebrew FREE ("חינם") is 2.6 em wide, so it can be the largest; Hebrew letter-spacing is 0 (tracking only on Latin and Cyrillic).
* The status pill label and the note are centred (neutral in RTL).

### 4.5 Motion

No entrance animation, no scroll animation, no looping animation, nothing decorative. Only state transitions, all on the duration tokens (`--aicc-dur`, `--aicc-ease`, so `prefers-reduced-motion` and the kit's `data-aicc-motion="reduce"` collapse them to 0.01 ms; verified: computed durations 0.00001 s and zero running animations): card border/shadow on hover (`(hover: hover)` only, no transform, no layout shift), the kit button hover (translate -2px, arrow nudge 2px, existing). No JavaScript in the kit for this section.

### 4.6 Modes

* Enhanced contrast (`data-aicc-contrast="high"`): tokens darken muted text and borders; the status pill turns solid-bordered on a white fill with ink text; the trial line and tag use ink. axe: 0 violations in four languages (open, off, closed).
* Forced colours: card and panel borders `CanvasText`, Studio a 3px `Highlight` border, badge/tag get a `ButtonText` border, the pill a 2px dashed `GrayText` border, glyphs and timeline nodes borders only (`Highlight` / `GrayText`), the rail a `CanvasText` border; the kit button rule applies to the links.
* Print: three columns, no shadows or tints, black borders, links as plain bordered boxes.
* Text spacing (WCAG 1.4.12: line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em, paragraph spacing 2em): no clipping, no overflow, four languages at 390.
* Larger text (root 125 % and 200 %) at 320 and 390: no clipping and no horizontal overflow (geometry check, below). At 200 % on a 320 px screen the Russian control label may break inside a long word: this is the documented worst case (an effective 160 px layout), nothing is cut.

## 5. Copy: every string, with its stable msgid

Rules followed: dates appear ONCE per page (the launch panel; no date in a card, the band, the finder or the status notes); tokens are the P39 ones (`{n}` `{regShort}` `{regDate}` `{regLast}` `{until}` `{lastDay}`, resolved by `src/i18n/eaTokens.ts` / the CP's shared table); UTC only, no 'Israel time'; no discount, popularity, urgency or scarcity claims; every sentence restates a verified behaviour (the /start/ page copy, the P39 terms, `plans.ts`, the Backend allowance 1 / 3 / 10); the product claims are only the ones already published on the Site (full product on every plan). **he / es / ru are machine drafts, not reviewed by native speakers** (same register as the P39 pack: he plural imperative, es usted, ru vy). The machine-readable source is `design/p40/copy.json` (new and changed keys) read together with `scripts/snapshots/selfservice-msgids.txt` (unchanged keys); Stage B regenerates the snapshot with `scripts/selfservice-msgids.mjs` and Stage C mirrors it. The truth guard (`scripts/lib/early-access-truth.mjs` `SS_EXTRA_RULES`) was run on every new string in all four languages: 0 hits (the first draft of the waitlist note said 'no places left' and was rejected by the scarcity rule; it was rewritten from the verified `/start/` waitlist copy).

### 5.1 New and changed msgids (en final; he/es/ru machine drafts)

| msgid | status | en | he | es | ru |
|---|---|---|---|---|---|
| `ss.pricing.lead` | new | Every plan has every feature. You only choose how many stores to connect. | בכל תוכנית יש את כל התכונות. אתם בוחרים רק כמה חנויות לחבר. | Todos los planes tienen todas las funciones. Solo elige cuántas tiendas conectar. | В каждом плане есть все функции. Вы выбираете только число подключаемых магазинов. |
| `ss.pricing.fit.solo` | new | For independent stores ready to make smarter recommendations | לחנויות עצמאיות שמוכנות להמליץ חכם יותר | Para tiendas independientes listas para recomendar mejor | Для независимых магазинов, готовых давать более точные рекомендации |
| `ss.pricing.fit.studio` | new | For growing merchants managing multiple storefronts | לסוחרים בצמיחה שמנהלים כמה חנויות | Para comerciantes en crecimiento que gestionan varias tiendas | Для растущих продавцов, которые ведут несколько магазинов |
| `ss.pricing.fit.agency` | new | For teams managing a portfolio of client stores | לצוותים שמנהלים מערך של חנויות לקוחות | Para equipos que gestionan una cartera de tiendas de clientes | Для команд, которые ведут портфель клиентских магазинов |
| `ss.pricing.badge` | new | Recommended | מומלצת | Recomendado | Рекомендуем |
| `ss.pricing.priceLabel` | new | Planned regular price | מחיר רגיל מתוכנן | Precio regular previsto | Планируемая обычная цена |
| `ss.pricing.priceLabelStrike` | new | Regular price | מחיר רגיל | Precio regular | Обычная цена |
| `ss.pricing.per` | new | per year | לשנה | al año | в&nbsp;год |
| `ss.pricing.free` | new | FREE | חינם | GRATIS | БЕСПЛАТНО |
| `ss.pricing.trial` | new | Launch trial: 1&nbsp;store | ניסיון השקה: חנות אחת | Prueba de lanzamiento: 1&nbsp;tienda | Пробный период запуска: 1&nbsp;магазин |
| `ss.pricing.incl` | new | Every feature, on every plan | כל התכונות, בכל תוכנית | Todas las funciones, en todos los planes | Все функции в&nbsp;каждом плане |
| `ss.cta.start` | changed | Get started free | התחילו בחינם | Empezar gratis | Начать бесплатно |
| `ss.cta.purchase` | new | Choose {plan} | בחירת {plan} | Elegir {plan} | Выбрать {plan} |
| `ss.cta.soon` | changed | Free trial opens soon | ניסיון החינם ייפתח בקרוב | La prueba gratuita abrirá pronto | Бесплатный период скоро откроется |
| `ss.cta.closed` | changed | Registration closed | ההרשמה נסגרה | Registro cerrado | Регистрация закрыта |
| `ss.cta.paused` | changed | Registration paused | ההרשמה מושהית | Registro en pausa | Регистрация приостановлена |
| `ss.state.soonNote` | new | Registration is not open yet. This page shows a start button as soon as it opens. | ההרשמה עדיין לא נפתחה. כפתור התחלה יופיע כאן ברגע שתיפתח. | El registro aún no está abierto. Aquí aparecerá un botón para empezar en cuanto se abra. | Регистрация пока не открыта. Кнопка запуска появится здесь, как только она откроется. |
| `ss.state.closedNote` | new | No new trials can be started. Paid plans are not open for purchase yet. | אי אפשר להתחיל ניסיונות חדשים. רכישות בתשלום עדיין אינן פתוחות. | Ya no se pueden iniciar pruebas nuevas. Las compras de pago aún no están abiertas. | Новые пробные периоды больше начать нельзя. Платные планы пока нельзя купить. |
| `ss.state.closedPaidNote` | new | Free trial registration has closed. | ההרשמה לניסיון החינם נסגרה. | El registro de la prueba gratuita está cerrado. | Регистрация на бесплатный пробный период закрыта. |
| `ss.state.pausedNote` | new | Registration is paused for now. Please come back later. | ההרשמה מושהית לעת עתה. אפשר לחזור מאוחר יותר. | El registro está en pausa por ahora. Vuelva más tarde. | Регистрация пока приостановлена. Загляните позже. |
| `ss.state.waitlistNote` | new | We will write if a place may become available. The waitlist does not reserve one. | נכתוב אליכם אם יתפנה מקום. הרשימה אינה שומרת מקום. | Le escribiremos si puede quedar una plaza libre. La lista de espera no reserva plaza. | Мы напишем, если может освободиться место. Список ожидания не резервирует место. |
| `ss.launch.tag` | new | Launch offer | הצעת השקה | Oferta de lanzamiento | Предложение в честь запуска |
| `ss.launch.sub` | new | Whichever plan you pick, the trial is the same. The plan is only your preference. | בכל תוכנית שתבחרו הניסיון זהה. התוכנית היא העדפה בלבד. | Sea cual sea el plan que elija, la prueba es la misma. El plan es solo una preferencia. | Какой бы план вы ни выбрали, пробный период одинаков. План означает только ваше предпочтение. |
| `ss.launch.regNote` | new | The last day to start a trial is {regLast} (UTC). | היום האחרון להתחיל ניסיון הוא {regLast} (UTC). | El último día para empezar una prueba es el {regLast} (UTC). | Последний день, когда можно начать пробный период, это {regLast} (UTC). |
| `ss.launch.endNote` | new | For every trial, whichever day you started. | לכל ניסיון, בלי קשר ליום שבו התחלתם. | Para cada prueba, sea cual sea el día en que la empezó. | Для любого пробного периода, в какой бы день вы его ни начали. |
| `ss.launch.fact.store` | new | The trial covers 1 store, whichever plan you choose. | הניסיון כולל חנות אחת, בכל תוכנית שתבחרו. | La prueba cubre 1 tienda, sea cual sea el plan que elija. | Пробный период охватывает 1 магазин, какой бы план вы ни выбрали. |
| `ss.launch.fact.payment` | new | No payment method is required, so nothing is charged. | לא נדרש אמצעי תשלום, ולכן לא נגבה דבר. | No hace falta método de pago, así que no se cobra nada. | Способ оплаты не нужен, поэтому ничего не списывается. |
| `ss.launch.fact.noAuto` | new | No automatic conversion to a paid plan. Continuing is your decision. | אין מעבר אוטומטי לתוכנית בתשלום. ההמשך הוא החלטה שלכם. | No pasa automáticamente a un plan de pago. Seguir es decisión suya. | Автоматического перехода на платный план нет. Продолжить или нет, решаете вы. |
| `ss.launch.foot.paid` | new | Paid plans are not open for purchase yet. Their regular prices apply once they open. | רכישות בתשלום עדיין אינן פתוחות. המחירים הרגילים יחולו כשייפתחו. | Las compras de pago aún no están abiertas. Los precios regulares se aplicarán cuando se abran. | Платные планы пока нельзя купить. Обычные цены начнут действовать, когда покупка станет доступна. |
| `ss.launch.foot.paidOpen` | new | Paid plans are open for purchase. | תוכניות בתשלום פתוחות לרכישה. | Los planes de pago están abiertos a la compra. | Платные планы можно купить. |
| `ss.band.lead` | changed | See AICC's recommendations on your own WooCommerce store. | ראו את ההמלצות של AICC בחנות ה-WooCommerce שלכם. | Vea las recomendaciones de AICC en su propia tienda WooCommerce. | Посмотрите рекомендации AICC в своём магазине на WooCommerce. |
| `ss.cta.choosePlan` | new | Choose a plan | בחירת תוכנית | Elegir un plan | Выбрать план |

### 5.2 Unchanged P39 msgids the design reuses (no new translation needed)

| msgid | en |
|---|---|
| `ss.plan.paidOne` | Paid plan: 1 store |
| `ss.plan.paidMany` | Paid plan: up to {n} stores |
| `ss.plan.datesLabel` | Free trial dates |
| `ss.plan.regLabel` | Registration closes |
| `ss.plan.regValue` | {regShort} at&nbsp;00:00 UTC |
| `ss.plan.endLabel` | Trial access ends |
| `ss.plan.endValue` | {until} at&nbsp;22:00 UTC |
| `ss.link` | How the free trial works |
| `ss.terms.label` | Free trial terms |
| `ss.terms.state` | Registration can close or move to a waitlist, and the sign-up page always shows the current state. |
| `ss.cta.waitlist` | Join the waitlist |

### 5.3 Reused from the main dictionary (not part of the ss pack)

`common.soon.label` ('Purchases open soon', the ordinary status after the trial end). Page-owned and untouched: the section title and lead of Home/Pricing, the hero (pill, support lines, 'Try Live Demo', 'See Pricing'), the announcement bar (`ss.bar.*`), the finder, the FAQ.

### 5.4 Retired msgids (no longer rendered by the redesigned section)

`ss.plan.trial`, `ss.plan.noPayment`, `ss.plan.noAuto`, `ss.plan.checksLabel`, `ss.terms.regValue`, `ss.terms.endValue`, `ss.terms.store`, `ss.terms.payment`, `ss.terms.noAuto`, `ss.terms.paid`. Not deleted by this change (Stage B decides; the hero keeps `ss.hero.*`, the bar keeps `ss.bar.*`). If `ss.plan.noAuto` is retired, the guard constants `SS_NOAUTO_PATHS`, `SS_DATE_PATHS` and `SS_REG_PATHS` in `scripts/lib/early-access-truth.mjs` must move to `launch.fact.noAuto`, `plan.regValue`, `plan.endValue` (the date lines stay in `ss.plan.*`, so the date guards keep working unchanged).

## 6. Prototype and verification

Files: `design/p40/render.mjs` (the markup skeleton as code), `copy.json`, `harness.css` + `fonts.css` (page chrome and the real Geist subsets; Hebrew uses the system face, exactly like the live Site), `build.mjs`, `shots.mjs`, `geometry.mjs`, `modes.mjs`, `prototype.html` (index). The five Geist `.woff2` files in `design/p40/fonts/` are the files the Site's own build emits (next/font, OFL); they are used only by the prototype.

```
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
node --no-warnings design/p40/build.mjs                       # writes design/p40/out/<lang>__<state>.html (git-ignored)
node --no-warnings design/p40/shots.mjs --out <dir> --langs en,he --states off,open --widths 390,1440 [--text 200] [--sel .aicc-tiers] [--strike] [--dsf 2]
node --no-warnings design/p40/geometry.mjs --axe              # geometry + axe over lang x state x width (x text scale)
node --no-warnings design/p40/modes.mjs --out <dir>           # keyboard, reduced motion, enhanced-contrast axe, 1.4.12, forced colours, print
```

States rendered: off, open, waitlist, closed, paused, purchase, ended; plus the strikethrough variant (`--strike`); languages en/he/es/ru.

Results of the final run (`design/p40/geometry.mjs --axe`: 392 checks, 0 failing; `modes.mjs`: all pass):

* **No horizontal overflow, no clipping**: for every language x 7 states x widths 320, 375, 390, 430, 768, 1024, 1440, 1920, and additionally root font size 125 % and 200 % at 320 and 390: the page does not overflow; no element inside a card, the panel or the band has `scrollWidth > clientWidth + 1`, sticks out of its container, or has a text line outside it; cards and panel have `scrollHeight <= clientHeight` (cards use `overflow: hidden`, so this is the real clipping test). The Russian БЕСПЛАТНО is covered (it is the widest word).
* **Desktop alignment** (1024, 1440, 1920): name, capacity, price, FREE, control and footer tops are identical across the three cards in every language and state (subgrid; difference 0 to 1 px).
* **Card height**: 536 px (Studio 556 px with its raise) at 1440 and 534 px at 390 in English (Hebrew 514, Spanish 536, Russian 525 to 536), against about 790 px and about 825 px before. Whole plans section including header, panel and terms: 1652 px to 1190 px at 1440 and 3623 px to 2798 px at 390 (English; `compare/COMPARE-*.png`).
* **axe-core** (wcag2a, 2aa, 21aa, 22aa, best-practice; `page-has-heading-one` disabled because the prototype has no page `h1`): 0 violations in four languages x 7 states at 390 and 1440, and 0 violations with `data-aicc-contrast="high"` (open, off, closed). axe reports `color-contrast` as *incomplete* only for the Studio card (its background is a gradient, which axe cannot evaluate). Those pairs were computed instead: ink on white 17.9:1; muted `#475569` on the plan zone 7.1:1 and on the darkest part of Studio's wash 6.5:1; success `#047857` on white 5.48:1 and on `--aicc-success-bg` 5.21:1; status pill `#334155` on `#f1f5f9` 9.5:1 and Studio's `#1d4ed8` on `#eff6ff` 6.2:1; white on the AA gradient 5.17:1 to 5.48:1 (badge and primary control; the kit's own default gradient ends at 4.58:1); band lead 18.7:1 and note 12.6:1 on `#0b1220`; blue glyph border 6.7:1 on white (graphic). The dashed pill border (1.4:1) and the empty-slot outline (1.5:1) are decorative: the control is not interactive, and the state is carried by icon and words.
* **Keyboard**: in the three link states there are exactly four tab stops in section order (Solo, Studio, Agency, band), each with a 2px focus ring and a 56px target (>= 44); in the soon / closed / paused / ended states there are zero tab stops in the section (the status region is not focusable). Targets: every link is 56px tall (kit `min-block-size: 3.5rem`).
* **Reduced motion**: transition durations 0.00001 s, no running animations. **WCAG 1.4.12 text spacing**: no clipping in four languages at 390. **Forced colours** and **print**: screenshots in `modes/`.
* **Kit hygiene**: collision check against the CP theme passes; kit a11y/sync/tokens tests pass; the new CSS uses logical properties only (no `left`/`right`/`margin-left`/`padding-right`, no direction-specific gradient).

Not verified here (honest list): real screen readers (VoiceOver / NVDA / TalkBack) were not run, the semantics were reasoned from the markup and checked with axe; Windows High Contrast was emulated with Chromium's `forced-colors` emulation (it renders system colours approximately); Safari and Firefox were not run (the section uses `subgrid`, container query units, `:has()`, each has a documented fallback: flex stacks with a min-height, a `vw` size for FREE, class-based closed styling); the he/es/ru copy is machine-drafted and un-reviewed; no Hebrew web font is bundled (the Site falls back to the system Hebrew face today), so Hebrew metrics on a phone depend on the device's font.

## 7. Integration notes

### 7.1 Site (Stage B: Next.js static export)

* New server component (suggested `src/components/ss/SsPlans.tsx`, plus `SsLaunch`, and a rewritten `SsBand`) renders sections 3.1 to 3.5 from `PLANS` (`src/data/plans.ts`), the plan names (`t.pricing.plans[id].name`) and the `ss` block. Keep the compile-time gating (`NEXT_PUBLIC_AICC_SS_CODE`, `SS_ON`) and the lazy import of the client control, so a build without self-service carries none of it.
* `SsCta` (client) keeps its logic (`ssDecision`, the status store, the browser-clock cutoff, hydration-safe static first render) and changes only its markup: link states render `<div class="aicc-pcta" data-ss-cta="link"><a class="aicc-btn aicc-btn--lg aicc-btn--block ...">`, status states the `.aicc-pstatus` region of 3.3 (it needs the per-state note strings next to the labels: extend `labelsOf()` in `Ss.tsx`). `closed_cutoff` by clock keeps winning over every answer. The Site has no purchase link (`COMMERCE_OPEN` is a build constant; a self-service build never links to a checkout): its closed state is always the unavailable one (note `ss.state.closedNote`), except in a build where `COMMERCE_OPEN` is true, which may use the `purchase` markup with `planUrl()`.
* The card's closed look needs no JavaScript: the kit styles `.aicc-tier:has([data-ss-state="closed_cutoff"], [data-ss-state="paused"])`, so the client control only has to render `data-ss-state` (the server markup may also add `aicc-tier--closed`; both give the same result).
* Delete from `Ss.tsx` the inline `SS_CSS` rules that exist only for the old cards (`.aicc-plan__*`, `.aicc-sstate`, `.aicc-ssdates*`, `.aicc-plans` column hack) once nothing renders them; the kit replaces them. Do not touch `src/styles/aicc.css` plan rules used by the OFF/launch-offer/ordinary cards.
* `PricingCard`: keep as is for every non-self-service view; the self-service branch (`ss`) moves out of it. `SsDemoLink` and every per-card demo link go. `SsTerms` becomes the panel; `SsDates` is no longer needed (the finder's result drops its dates; it should show the plan and its paid capacity only).
* Home: the plans `Section` keeps its `SectionHeading` (page title) and may use `ss.pricing.lead`; The panel carries `id="free-trial"` once per page (it is the target of the bar link and of every "How the free trial works" link, as today). Pricing: panel directly under the cards, then the page's own "All prices are in US dollars (USD)..." note.
* Apply `data-ea-live` / `data-ea-after` as in 3.3 (launch-only parts live; ordinary control after).

### 7.2 Control Plane theme (Stage C: PHP)

* `template-parts/plan-cards.php` (self-service branch, `$ss`) and `inc/self-service.php` (`aicc_ss_card_extras`, `aicc_ss_cta_html`, `aicc_ss_dates_html`, `aicc_ss_terms_html`, `aicc_ss_band_html`, `aicc_ss_demo_link_html`) emit the same markup. Reuse `AICC_LM_Plans::all()` (price, `limit`, `featured`, `plan_code`), `aicc_ss_mode()` / `aicc_ss_state_table()` for the state, `aicc_commerce_closed()` and `AICC_LM_Plans::purchase_url()` for the post-cutoff purchase state, `aicc_brand_icon()` for icons. The server clock decides `closed_cutoff` (unchanged). The non-self-service branches of `plan-cards.php` (launch offer without sign-up, ordinary cards) are untouched.
* The theme enqueues the kit stylesheet on every page already (`inc/enqueue.php`, handle `aicc-brand`, loaded before `aicc-components`/`aicc-public`): no enqueue change. The theme CSS must not restyle the new classes (the collision check passes). The old self-service additions in `assets/css/aicc-start.css` (`.aicc-plan__checks`, `.aicc-sstate*`, `.aicc-ssdates*`, `.aicc-plan__demo`, `.aicc-plan__ssctl`) are dead once the markup moves; the 'off' pages never rendered them.
* Heads-up for the 24 off-state byte-identity test: `aicc_asset_ver()` returns `filemtime()` of the asset, so ANY kit CSS change (this one included) changes the `?ver=` query of the `aicc-brand` stylesheet in every page's HTML. The 24 pages are byte-identical in content and markup, but a literal byte comparison across a kit sync only holds if the comparison normalises asset versions (or the release build fixes mtimes). Decide this before the Stage C gate.
* Constant for the gated strike variant: default false, never set in production; `public-truth-gate` must refuse it in a production build without the documented approval flag.

### 7.3 Order of work and one trap

The Site's "OFF byte-identity base" and every export fingerprint must be rebuilt from THIS kit commit (section 8). Re-run `node scripts/sync-brand-kit.mjs --to <theme>` after any later change to `brand/` and `npm run brand:build` first (the sync refuses a stale manifest). `node scripts/check-brand-collisions.mjs --theme <theme>` must pass in both repos; Stage B/C must not add a class of this section to the theme CSS.

## 8. Effect on the existing builds and tests (measured)

* The kit stylesheet grows by 20 KB raw (14.6 KB minified in the export): every build's CSS file hash changes. **The Site's OFF byte-identity base must be rebuilt from this kit commit**; comparing against an older base fails on the CSS file name alone (every one of the 39 pages references it).
* Measured with this commit and its parent (7ad5615), same environment, OFF build (`AICC_BASE_PATH=""`, no switches) and the P39 production recipe (`NEXT_PUBLIC_AICC_EARLY_ACCESS=announce`, `NEXT_PUBLIC_AICC_SELFSERVICE=on`): all 39 HTML pages are identical after normalising the build id and the hashed asset names, in both recipes (`scripts/export-hash.mjs` itself reports every file as different, because the CSS file name is part of every page). The source diff of `brand/aicc-brand.css` is append-only (0 deleted lines).
* Same comparison for the launch-offer modes announce, open and verify (`NEXT_PUBLIC_AICC_EARLY_ACCESS=announce|open|verify`): 39 / 47 / 47 pages, all identical modulo hashes.
* `npm run brand:check`, `tokens:check` (tokens untouched), `test:brand-sync` (21/21), `test:kit-a11y` (8/8), `node scripts/check-brand-collisions.mjs --theme <CP theme>` (no collision) pass. `npm run test:visual-regression -- --before <parent build, self-service on> --after <this build>`: 80/80 checks passed (the Hero, header, pillars, demo and the stored plan-card baselines of `tests/approved-visuals/p39-pricing` are unchanged: 0.000 % of pixels differ), which is the proof that the kit addition changes no unrelated page and not even the current cards.
* Tests that WILL need updates in Stage B because the plan-card markup, the msgids or the strings change (not rewritten here):
  * Browser/DOM tests keyed to the old card classes or hooks: `scripts/test-selfservice-browser.mjs` (state matrix: `data-ss-state`, plain-text control, links), `scripts/test-launch-offer-browser.mjs` and `scripts/interaction-test.mjs` (`.aicc-plan`, `.aicc-plan__free*`, `__regular*`, `__checks` ... for the self-service view), `scripts/test-launch-offer.mjs` and `scripts/test-early-access.mjs` (structure of cards: `.aicc-plan__*`, `data-ss-demo`, `data-ss-dates`, `data-ss-terms`, the ended view), `scripts/test-pricing-consistency.mjs` (+ `-mutations`) and `scripts/test-launch-offer-mutations.mjs` (mutations of the old strings/markup).
  * Copy and truth guards: `scripts/lib/early-access-truth.mjs` (`SS_NOAUTO_PATHS`, `SS_DATE_PATHS`, `SS_REG_PATHS`, `ssDisclosureProblems`, `REQUIRED_*` lists that name `ss.plan.trial`, `ss.plan.noAuto`, `ss.terms.*`), `scripts/test-ss-guards.mjs` (165 mutations that target retired keys), `scripts/ea-check.mjs` (the `terms.*` path list, built-page checks), `scripts/selfservice-msgids.mjs` (the generated pack, header comments and the 35-key snapshot `scripts/snapshots/selfservice-msgids.txt`), `scripts/wording-parity.mjs` (CP parity, 00:00 exception paths), `scripts/copy-check.mjs` / `scripts/public-truth-gate.mjs` / `scripts/lib/public-truth.mjs` (self-tests that quote pack strings), `scripts/launch-check.mjs` and `scripts/ea-check.mjs` (the strike detectors: add `aicc-tier__price--strike` and `<s class="aicc-tier__amount">`).
  * Visual baselines: `tests/approved-visuals/p39-pricing/*.png` (plan-card sections of Home and Pricing, four languages, 1440 and 390: 16 images) must be regenerated (`test:visual-regression ... --update-baseline`) and reviewed; `scripts/test-visual-regression.mjs`'s Hero-unchanged assertions need no change (the Hero is untouched).
  * Not affected: `test:kit-a11y`, `test:brand-sync`, `tokens:check`, `contrast:check` on tokens, the Hero/demo/FAQ/legal checks (no markup change outside the plans section and the band).

## 9. Open items for the coordinator / next stages

1. **he / es / ru copy** needs native review before any claim of review; the new strings are marked machine drafts like P39.
2. **Positioning lines are marketing copy**, taken from the brief's examples ('For independent stores ready to make smarter recommendations', ...). They replace the P39 lines 'One live store. A staging site counts as a second store.' etc.; the staging-counts-as-a-store fact therefore leaves the cards. It is still stated on the Pricing page ('How store slots work') and in the FAQ; the coordinator may want it back as a one-line note near the capacity text.
3. **'Recommended'** replaces 'Built for multiple stores' (decision [C]); confirm that `common.plan.recommended` is no longer used by the self-service view (the OFF/ordinary cards still use it).
4. **Asset version (CP)**: see 7.2: the kit change alters `?ver=` on every CP page; decide how the 24-page byte-identity gate treats it.
5. **Strike detectors** need the two new markers (3.6) so the counsel gate cannot be bypassed by the new markup.
6. **`aicc-tier--closed`** is also reachable without a class (`:has()` on the control's `data-ss-state`), so the Site's client control never needs to touch its parent.
7. The page-level copy stays as is: the Pricing page's USD note, the 'Which plan?' finder (must lose its dates and use the new pack), FAQ, hero, bar.
8. Home's hero and the closing band's heading are page-owned; the band's secondary 'Try Live Demo' / 'See Pricing' buttons may stay as the page decides (they are not part of the contract).
