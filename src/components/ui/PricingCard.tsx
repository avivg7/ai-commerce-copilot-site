import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./Primitives";
import { Button } from "./Button";
import { cn } from "@/lib/cn";
import { localePath } from "@/lib/routes";
import { currencySuffix, formatPrice } from "@/data/plans";
import { COMMERCE_OPEN, planUrl, type PlanId } from "@/lib/site";
import { EA_ON, EA_OPEN, EA_STRIKE, EA_INTAKE_CLOSES, eaUrl } from "@/lib/earlyAccess";
import { txProps } from "@/i18n";
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
      {ea ? <p className="aicc-plan__stores" data-ea-live {...A(storesPath)}>{p.storesLabel}</p> : null}
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
          <p className="aicc-plan__free" {...E("ea.plan")}>
            <span className="aicc-plan__free-word">{ea.freeWord}</span>
            <span className="aicc-plan__free-until">{ea.freeUntil}</span>
          </p>
        </div>
      ) : null}
      <p className="aicc-plan__stores" {...(ea ? { "data-ea-hide-live": "" } : {})} {...A(storesPath)}>{p.storesLabel}</p>
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
          <div data-ea-live {...(EA_INTAKE_CLOSES ? { "data-ea-intake": "" } : {})}>
            {EA_OPEN ? (
              <Button href={eaUrl(loc, p.id)} variant={p.featuredLabel ? "primary" : "outline"} block size="lg" {...E("ea.plan")}>{ea.ctaOpen}<span className="aicc-sr-only"> ({p.name})</span></Button>
            ) : (
              /* P36: ONE working action while requests are not open: the live demo (never an inert button; the "coming soon" status is plain text under the cards) */
              <Button href={`${localePath(loc)}#demo`} variant={p.featuredLabel ? "primary" : "outline"} block size="lg">{p.demoLabel}<span className="aicc-sr-only"> ({p.name})</span></Button>
            )}
          </div>
          {EA_INTAKE_CLOSES ? (
            <div data-ea-live data-ea-closed-only>
              <p className="aicc-eanote" data-ea-status {...E("ea.plan")}>{ea.ctaClosed}</p>
            </div>
          ) : null}
          <ul className="aicc-plan__checks" data-ea-live>
            {[ea.noCard, ea.noAuto, ea.approved].map((x) => (<li key={x}><Check size={16} aria-hidden="true" /><span {...E("ea.plan")}>{x}</span></li>))}
          </ul>
          <div data-ea-after>{standardCta}</div>
        </>
      ) : standardCta}
    </article>
  );
}
