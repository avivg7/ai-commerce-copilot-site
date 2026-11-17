import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./Primitives";
import { Button } from "./Button";
import { cn } from "@/lib/cn";
import { localePath } from "@/lib/routes";
import { currencySuffix, formatPrice, planById } from "@/data/plans";
import { COMMERCE_OPEN, planUrl, type PlanId } from "@/lib/site";
import { EA_ON, EA_OPEN, EA_STRIKE, EA_INTAKE_CLOSES, eaUrl } from "@/lib/earlyAccess";
import { txProps, type Dictionary } from "@/i18n";
import { SS_ON } from "@/lib/selfService";
import { SsCtaSlot, SsDates, SsDemoLink } from "@/components/ss/Ss";
import type { Locale } from "@/i18n/config";

export interface PricingCardProps {
  id: PlanId;
  name: string;
  price: number;
  storesLabel: string;
  fit: string;
  perYear: string;
  featuredLabel?: string;
  features: string[];
  /** Per-feature i18n paths (so each feature carries its own language), same order as `features`. */
  featurePaths?: string[];
  cta: string;
  /** "Purchases open soon": shown instead of the button while commercial checkout is closed (the default). Required, so a new caller cannot forget it and publish a purchase button by accident. */
  soon: string;
  compact?: boolean;
  locale: string;
  headingLevel?: 2 | 3;
  extra?: ReactNode;
  /** Early Access strings (t.ea.plan). Rendered only by an Early Access build; a normal build ignores them. */
  ea?: { pill: string; free: string; freeWord: string; freeUntil: string; regular: string; planned: string; regularPer: string; approved: string; noCard: string; noAuto: string; term: string; ends: string; ctaOpen: string; ctaAnnounce: string; ctaClosed: string };
  /** P36: the label of the one working action on a launch-offer card while requests are not open ("Try Live Demo", the Hero's own string). */
  demoLabel?: string;
  /** P37: the self-service strings (t.ea.ss), passed ONLY by a self-service build; an ordinary build never sets it (the markup is then exactly the P36 one). */
  ss?: Dictionary["ea"]["ss"];
  /** P37: the page dictionary, needed by the self-service button for its labels (passed with `ss`). */
  t?: Dictionary;
}

/**
 * One plan. The price and limits come from src/data/plans.ts. The CTA goes to the account page of the page language (getStartedUrl/planUrl) with ?plan=.
 * Studio carries a neutral "Built for multiple stores" badge (a purpose label, not a recommendation: two Solo plans cost less than one Studio); nothing here says "most popular" and there is no urgency.
 */
export function PricingCard(p: PricingCardProps) {
  const H = `h${p.headingLevel ?? 3}` as "h2" | "h3";
  // Each string says which language it is in: the card often sits inside a block that is still English fallback while these strings are translated.
  const loc = p.locale as Locale;
  const A = (path: string) => { const { lang, dir } = txProps(loc, path); return { lang, dir }; };
  const storesPath = p.id === "solo" ? "common.plan.oneStore" : "common.plan.upToStores";
  const ea = EA_ON ? p.ea : undefined;
  const E = (path: string) => A(path);
  // P37 self-service: the card's one action is the sign-up button; the stores line states the PAID allowance and the checks state the TRIAL allowance (one store) and the payment rule
  const ss = SS_ON ? p.ss : undefined;
  const ssStores = ss ? (planById(p.id).stores === 1 ? ss.plan.paidOne : ss.plan.paidMany.replace("{n}", String(planById(p.id).stores))) : "";
  const ssButton = ss && p.t ? <SsCtaSlot locale={loc} t={p.t} plan={p.id} variant={p.featuredLabel ? "primary" : "outline"} block size="lg" srName={p.name} /> : null;
  // P39: the checks state the payment rule and "no automatic conversion"; the trial allowance ("Free trial: 1 store") is the line under FREE, the two dates are the labelled lines above the checks
  const ssChecks = ss ? (
    <ul className="aicc-plan__checks" aria-label={ss.plan.checksLabel} data-ss-checks {...E("ea.ss.plan")}>
      {(ea ? [ss.plan.noPayment, ss.plan.noAuto] : [ss.plan.trial, ss.plan.noPayment, ss.plan.noAuto]).map((x) => (<li key={x}><Check size={16} aria-hidden="true" /><span>{x}</span></li>))}
    </ul>
  ) : null;
  const ssDemo = ss ? <SsDemoLink locale={loc} label={p.demoLabel ?? ""} planName={p.name} /> : null;
  const ssDates = ss && p.t ? <SsDates locale={loc} t={p.t} /> : null;
  const featured = p.featuredLabel ? <span {...A("common.plan.recommended")}><Badge tone="brand">{p.featuredLabel}</Badge></span> : null;
  // The ordinary purchase control (Purchases open soon, or the choose-a-plan button): the only one shown after the Early Access end date.
  const standardCta = COMMERCE_OPEN ? (
    <Button href={planUrl(p.id, loc)} variant={p.featuredLabel ? "primary" : "outline"} block size="lg" {...A("common.plan.choose")}>
      {p.cta}
    </Button>
  ) : (
    <p className="aicc-btn aicc-btn--lg aicc-btn--block aicc-btn--soon" data-commerce="closed" {...A("common.soon.label")}>{p.soon}</p>
  );
  return (
    <article className={cn("aicc-plan", p.featuredLabel && "aicc-plan--featured", p.compact && "aicc-plan--compact")} aria-labelledby={`plan-${p.id}`}>
      <div>
        {/* P34 (owner request): the launch-offer label on every card while the offer is live; an ordinary build renders exactly the old single child (byte-identical pages) */}
        <div className="aicc-plan__badgerow">{ea ? <>{featured}<span data-ea-live data-ea-pill {...E("ea.plan")}><Badge tone="success">{ea.pill}</Badge></span></> : featured}</div>
        <H id={`plan-${p.id}`} className="aicc-plan__name">
          <bdi>{p.name}</bdi>
        </H>
        <p className="aicc-muted aicc-small aicc-plan__fit" style={{ marginBlockStart: 4 }} {...A("pricing.plans")}>{p.fit}</p>
      </div>
      {ea ? <p className="aicc-plan__stores" data-ea-live {...(ss ? E("ea.ss.plan") : A(storesPath))}>{ss ? ssStores : p.storesLabel}</p> : null}
      <p className="aicc-plan__price" {...(ea ? { "data-ea-hide-live": "" } : {})}>
        <span className="aicc-plan__amount"><bdi>{formatPrice(p.price, p.locale)}</bdi></span>
        <span className="aicc-plan__per" {...A("common.plan.perYear")}>{p.perYear}{currencySuffix(p.locale ?? "en")}</span>
      </p>
      {ea ? (
        <div className="aicc-plan__offer" data-ea-live>
          {/* P36 hierarchy: the regular yearly price LARGE (struck through only in the counsel-gated variant, never as a footnote), then FREE, dominant, with "until <date>" */}
          <p className={EA_STRIKE ? "aicc-plan__regular aicc-plan__regular--strike" : "aicc-plan__regular"} {...E("ea.plan")}>
            <span className="aicc-plan__regular-label">{EA_STRIKE ? ea.regular : ea.planned}</span>
            <span className="aicc-plan__regular-line">
              {EA_STRIKE ? <s><bdi>{formatPrice(p.price, p.locale)}</bdi></s> : <bdi>{formatPrice(p.price, p.locale)}</bdi>}
              <span className="aicc-plan__regular-per"> {ea.regularPer}{currencySuffix(p.locale ?? "en")}</span>
            </span>
          </p>
          {ss ? (
            /* P39: FREE + the trial allowance ("Free trial: 1 store"); the two dates follow as labelled lines (never "FREE until <date>": registration and access end on different dates) */
            <>
              <p className="aicc-plan__free" data-ss-free {...E("ea.ss.plan")}>
                <span className="aicc-plan__free-word">{ea.freeWord}</span>
                <span className="aicc-plan__free-until">{ss.plan.trial}</span>
              </p>
              {ssDates}
            </>
          ) : (
            <p className="aicc-plan__free" {...E("ea.plan")}>
              <span className="aicc-plan__free-word">{ea.freeWord}</span>
              <span className="aicc-plan__free-until">{ea.freeUntil}</span>
            </p>
          )}
        </div>
      ) : null}
      <p className="aicc-plan__stores" {...(ea ? { "data-ea-hide-live": "" } : {})} {...(ss && !ea ? E("ea.ss.plan") : A(storesPath))}>{ss && !ea ? ssStores : p.storesLabel}</p>
      {!p.compact ? (
        <ul className="aicc-plan__list" {...(ea ? { "data-ea-after": "" } : {})}>
          {p.features.map((f, i) => (
            // a launch-offer build never renders the 14-day guarantee line on a card (not even hidden): no payment is taken, so there is nothing to guarantee; the policy lives in the FAQ and the Refund Policy
            ea && p.featurePaths?.[i] === "common.plan.guarantee" ? null : (
              <li key={f}>
                <Check size={18} aria-hidden="true" />
                <span {...(p.featurePaths?.[i] ? A(p.featurePaths[i]) : {})}>{f}</span>
              </li>
            )
          ))}
        </ul>
      ) : null}
      {p.extra}
      {ea ? (
        <>
          <div data-ea-live {...(EA_INTAKE_CLOSES && !ss ? { "data-ea-intake": "" } : {})}>
            {ss ? (
              /* P37/P39: the checks, then the ONE sign-up control (plain status text until sign-up is known to work; never #demo, never /request-access/); the demo is a separate secondary link below */
              <div className="aicc-plan__ssctl">{ssChecks}{ssButton}</div>
            ) : EA_OPEN ? (
              <Button href={eaUrl(loc, p.id)} variant={p.featuredLabel ? "primary" : "outline"} block size="lg" {...E("ea.plan")}>{ea.ctaOpen}<span className="aicc-sr-only"> ({p.name})</span></Button>
            ) : (
              /* P36: ONE working action while requests are not open: the live demo (never an inert button; the "coming soon" status is plain text under the cards) */
              <Button href={`${localePath(loc)}#demo`} variant={p.featuredLabel ? "primary" : "outline"} block size="lg">{p.demoLabel}<span className="aicc-sr-only"> ({p.name})</span></Button>
            )}
          </div>
          {EA_INTAKE_CLOSES && !ss ? (
            <div data-ea-live data-ea-closed-only>
              <p className="aicc-eanote" data-ea-status {...E("ea.plan")}>{ea.ctaClosed}</p>
            </div>
          ) : null}
          {ss ? (
            <div data-ea-live>{ssDemo}</div>
          ) : (
            <ul className="aicc-plan__checks" data-ea-live>
              {[ea.noCard, ea.noAuto, ea.approved].map((x) => (<li key={x}><Check size={16} aria-hidden="true" /><span {...E("ea.plan")}>{x}</span></li>))}
            </ul>
          )}
          <div data-ea-after>{standardCta}</div>
        </>
      ) : ss ? (
        <>
          {ssDates}
          {ssChecks}
          {ssButton}
          {ssDemo}
        </>
      ) : standardCta}
    </article>
  );
}
