import type { ReactNode } from "react";
import { Check, Info } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { txProps } from "@/i18n";
import { PLANS, currencySuffix, formatPrice, type PlanId } from "@/data/plans";
import { COMMERCE_OPEN, planUrl } from "@/lib/site";
import { EA_ON, EA_STRIKE } from "@/lib/earlyAccess";
import { SS_ON } from "@/lib/selfService";
import { SsCtaSlot } from "./Ss";

/**
 * P40: the premium pricing section of a self-service build (docs/design/p40-pricing.md, sections 3.1 to 3.4; classes are the shared kit's `.aicc-pricing` block, brand/aicc-brand.css, the same ones the Control Plane writes in PHP):
 * the header block, the three plan cards, and the ONE launch panel of the page (the dates and the trial conditions are said there and nowhere else). Server components only; the control inside every card is the client SsCta.
 * No price, store count or date is written in this file: prices and capacities come from src/data/plans.ts, the dates from the pack tokens (src/i18n/eaTokens.ts).
 * A launch-offer build also carries the ORDINARY cards (`aicc-tier--standard`, data-ea-after) that replace the launch view after the trial end instant, exactly like the P39 cards did.
 */
const A = (locale: Locale, path: string) => { const { lang, dir } = txProps(locale, path); return { lang, dir }; };
const LIVE = EA_ON ? { "data-ea-live": "" } : {};
const AFTER = EA_ON ? { "data-ea-after": "" } : {};

/** The store glyph row: ten slots, the first N filled (the plan's PAID capacity); the `trial` row is the single green slot of the launch trial. Decorative: the words next to it carry the meaning. */
function Cap({ n, trial = false }: { n: number; trial?: boolean }) {
  const total = trial ? 1 : 10;
  return (
    <span className={trial ? "aicc-cap aicc-cap--trial" : "aicc-cap"} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (<span key={i} className={i < n ? "aicc-cap__slot aicc-cap__slot--on" : "aicc-cap__slot"} />))}
    </span>
  );
}

/** The regular yearly price. Standard = "Planned regular price / per year" (a fact, never a reduction); the counsel-gated variant strikes the amount (build flag NEXT_PUBLIC_AICC_EA_STRIKE, refused in production without the counsel reference). */
function Price({ locale, t, plan, ended }: { locale: Locale; t: Dictionary; plan: (typeof PLANS)[number]; ended: boolean }) {
  const s = t.ea.ss.pricing;
  const amount = formatPrice(plan.price, locale);
  const per = <span className="aicc-tier__per">{s.per}{currencySuffix(locale)}</span>;
  if (ended) {
    return <p className="aicc-tier__price" data-aicc-ss="regular"><span className="aicc-tier__price-line"><bdi className="aicc-tier__amount">{amount}</bdi> {per}</span></p>;
  }
  if (EA_STRIKE) {
    return (
      <p className="aicc-tier__price aicc-tier__price--strike" data-aicc-ss="regular" data-ss-price="strike">
        <span className="aicc-tier__price-label">{s.priceLabelStrike}</span>
        <span className="aicc-tier__price-line"><s className="aicc-tier__amount"><bdi>{amount}</bdi></s> {per}</span>
      </p>
    );
  }
  return (
    <p className="aicc-tier__price" data-aicc-ss="regular">
      <span className="aicc-tier__price-label">{s.priceLabel}</span>
      <span className="aicc-tier__price-line"><bdi className="aicc-tier__amount">{amount}</bdi> {per}</span>
    </p>
  );
}

/** The ordinary control of the ended view (after the trial end): "Purchases open soon" (the P36 status, data-commerce) or, only when the build opens commerce, the link to the plan's purchase. */
function StandardControl({ locale, t, id }: { locale: Locale; t: Dictionary; id: PlanId }) {
  const name = t.pricing.plans[id].name;
  if (COMMERCE_OPEN) {
    return (
      <div className="aicc-pcta" data-ss-cta="purchase">
        <a className={`aicc-btn aicc-btn--lg aicc-btn--block ${id === "studio" ? "aicc-btn--primary" : "aicc-btn--outline"}`} data-ss-state="purchase" href={planUrl(id, locale)} {...A(locale, "common.plan.choose")}>{t.common.plan.choose.replace("{plan}", name)}</a>
      </div>
    );
  }
  return (
    <div className="aicc-pcta" data-ss-cta="status">
      <p className="aicc-pstatus" role="status" data-commerce="closed" {...A(locale, "common.soon.label")}>
        <span className="aicc-pstatus__pill"><Info size={18} aria-hidden="true" focusable="false" /><span className="aicc-pstatus__label">{t.common.soon.label}</span></span>
      </p>
    </div>
  );
}

/** One plan card. `ended` = the ordinary card (data-ea-after): the price leads, the lower zone holds only the ordinary control. */
function Tier({ locale, t, plan, ended = false }: { locale: Locale; t: Dictionary; plan: (typeof PLANS)[number]; ended?: boolean }) {
  const s = t.ea.ss;
  const name = t.pricing.plans[plan.id].name;
  const id = ended ? `plan-${plan.id}-after` : `plan-${plan.id}`;
  const paid = plan.stores === 1 ? s.plan.paidOne : s.plan.paidMany.replace("{n}", String(plan.stores));
  const cls = ["aicc-tier", plan.featured ? "aicc-tier--featured" : "", ended ? "aicc-tier--standard" : ""].filter(Boolean).join(" ");
  return (
    <article className={cls} aria-labelledby={id} data-plan={plan.id} {...(plan.featured ? { "data-featured": "" } : {})} {...A(locale, "ea.ss.pricing")}>
      <div className="aicc-tier__plan">
        <div className="aicc-tier__head">
          <h3 className="aicc-tier__name" id={id}><bdi>{name}</bdi></h3>
          {plan.featured ? <p className="aicc-tier__badge">{s.pricing.badge}</p> : null}
        </div>
        <p className="aicc-tier__fit">{s.pricing.fit[plan.id]}</p>
        <div className="aicc-tier__cap" data-aicc-ss="paid">
          <p className="aicc-tier__cap-text">{paid}</p>
          <Cap n={plan.stores} />
        </div>
        <Price locale={locale} t={t} plan={plan} ended={ended} />
      </div>
      <div className="aicc-tier__launch">
        {ended ? (
          <StandardControl locale={locale} t={t} id={plan.id} />
        ) : (
          <>
            <p className="aicc-tier__free" data-aicc-ss="free" data-ss-free>
              <span className="aicc-tier__free-word">{s.pricing.free}</span>
              <span className="aicc-tier__trial"><Cap n={1} trial />{s.pricing.trial}</span>
            </p>
            <SsCtaSlot locale={locale} t={t} plan={plan.id} featured={plan.featured} srName={name} />
          </>
        )}
      </div>
      <p className="aicc-tier__incl"><span className="aicc-tier__incl-icon" aria-hidden="true"><Check size={16} focusable="false" /></span>{s.pricing.incl}</p>
    </article>
  );
}

/** The header block (the section's H2 and its lede): the launch trial while registration can start, the plain pricing statement once it is closed (SsSwap, browser clock) and in the ordinary after-trial view. */
async function Head({ locale, t, titleId }: { locale: Locale; t: Dictionary; titleId: string }) {
  const s = t.ea.ss.pricing;
  let open: (a: string, b: string) => ReactNode = (a) => a;
  if (process.env.NEXT_PUBLIC_AICC_SS_CODE === "1" && SS_ON) {
    const { SsSwap } = await import("./SsSwap");
    open = (a, b) => <SsSwap open={a} closed={b} />;
  }
  const one = (a: string, b: string): ReactNode => (EA_ON ? (<><span {...LIVE}>{open(a, b)}</span><span {...AFTER}>{b}</span></>) : open(a, b));
  return (
    <header className="aicc-pricing__head" data-aicc-ss="head" {...A(locale, "ea.ss.pricing")}>
      <h2 className="aicc-pricing__title" id={titleId}>{one(s.title, s.titleClosed)}</h2>
      <p className="aicc-pricing__lead">{one(s.lead, s.leadClosed)}</p>
    </header>
  );
}

/** The ONE shared launch panel of the page: two milestones (registration closes, trial access ends: the last day to join is not the expiry) and the three facts. `id="free-trial"` is the target of the bar link and of every "How the free trial works" link. */
export function SsLaunch({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!SS_ON) return null;
  const s = t.ea.ss;
  const fact = (icon: ReactNode, text: string) => (<li className="aicc-launch__fact" key={text}><span className="aicc-launch__fact-icon" aria-hidden="true">{icon}</span><span>{text}</span></li>);
  return (
    <section className="aicc-launch" id="free-trial" aria-labelledby="launch-title" data-aicc-ss="launch" data-ss-terms {...LIVE} {...A(locale, "ea.ss.launch")}>
      <div className="aicc-launch__intro">
        <p className="aicc-launch__tag">{s.launch.tag}</p>
        <h3 className="aicc-launch__title" id="launch-title">{s.link}</h3>
        <p className="aicc-launch__sub">{s.launch.sub}</p>
      </div>
      <ol className="aicc-timeline" aria-label={s.plan.datesLabel} data-ss-dates>
        <li className="aicc-timeline__step" data-ss-date="registration">
          <span className="aicc-timeline__node" aria-hidden="true" />
          <span className="aicc-timeline__label">{s.plan.regLabel}</span>
          <span className="aicc-timeline__date">{s.plan.regValue}</span>
          <span className="aicc-timeline__note">{s.launch.regNote}</span>
        </li>
        <li className="aicc-timeline__step" data-ss-date="end">
          <span className="aicc-timeline__node" aria-hidden="true" />
          <span className="aicc-timeline__label">{s.plan.endLabel}</span>
          <span className="aicc-timeline__date">{s.plan.endValue}</span>
          <span className="aicc-timeline__note">{s.launch.endNote}</span>
        </li>
      </ol>
      <ul className="aicc-launch__facts" aria-label={s.terms.label} data-ss-checks>
        {fact(<Cap n={1} trial />, s.launch.fact.store)}
        {fact(<Check size={18} focusable="false" />, s.launch.fact.payment)}
        {fact(<Check size={18} focusable="false" />, s.launch.fact.noAuto)}
      </ul>
      <p className="aicc-launch__foot">{COMMERCE_OPEN ? s.launch.foot.paidOpen : s.launch.foot.paid} {s.terms.state}</p>
    </section>
  );
}

/**
 * The pricing section of Home and Pricing in a self-service build: header, three plan cards (the ordinary cards too in a launch-offer build, shown after the trial end) and the launch panel.
 * `titleId` is the id the page's `<Section labelledBy>` points at (the H2 of the header block replaces the page's own plans heading).
 */
export async function SsPricing({ locale, t, titleId }: { locale: Locale; t: Dictionary; titleId: string }): Promise<ReactNode> {
  if (!SS_ON) return null;
  return (
    <div className="aicc-pricing" data-aicc-pricing data-ss-pricing>
      <Head locale={locale} t={t} titleId={titleId} />
      <div className="aicc-tiers" data-aicc-ss="plans" {...LIVE}>
        {PLANS.map((p) => (<Tier key={p.id} locale={locale} t={t} plan={p} />))}
      </div>
      {EA_ON ? (
        <div className="aicc-tiers" data-aicc-ss="plans-after" {...AFTER}>
          {PLANS.map((p) => (<Tier key={p.id} locale={locale} t={t} plan={p} ended />))}
        </div>
      ) : null}
      <SsLaunch locale={locale} t={t} />
    </div>
  );
}
