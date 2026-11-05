import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./Primitives";
import { Button } from "./Button";
import { cn } from "@/lib/cn";
import { currencySuffix, formatPrice } from "@/data/plans";
import { COMMERCE_OPEN, planUrl, type PlanId } from "@/lib/site";
import { EA_ON, EA_OPEN, eaUrl } from "@/lib/earlyAccess";
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
  ea?: { free: string; regular: string; regularPer: string; noCard: string; term: string; ends: string; ctaOpen: string; ctaAnnounce: string };
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
        <div className="aicc-plan__badgerow">{p.featuredLabel ? <span {...A("common.plan.recommended")}><Badge tone="brand">{p.featuredLabel}</Badge></span> : null}</div>
        <H id={`plan-${p.id}`} className="aicc-plan__name">
          <bdi>{p.name}</bdi>
        </H>
        <p className="aicc-muted aicc-small aicc-plan__fit" style={{ marginBlockStart: 4 }} {...A("pricing.plans")}>{p.fit}</p>
      </div>
      <p className="aicc-plan__price" {...(ea ? { "data-ea-hide-live": "" } : {})}>
        <span className="aicc-plan__amount"><bdi>{formatPrice(p.price, p.locale)}</bdi></span>
        <span className="aicc-plan__per" {...A("common.plan.perYear")}>{p.perYear}{currencySuffix(p.locale ?? "en")}</span>
      </p>
      {ea ? (
        <div className="aicc-plan__offer" data-ea-live>
          <p className="aicc-plan__free" {...E("ea.plan")}>{ea.free}</p>
          <p className="aicc-plan__regular" {...E("ea.plan")}>
            <span className="aicc-plan__regular-label">{ea.regular}</span>{" "}
            <s><bdi>{formatPrice(p.price, p.locale)}</bdi></s>
            <span className="aicc-plan__regular-per"> {ea.regularPer}{currencySuffix(p.locale ?? "en")}</span>
          </p>
        </div>
      ) : null}
      <p className="aicc-plan__stores" {...A(storesPath)}>{p.storesLabel}</p>
      {ea ? (
        <ul className="aicc-plan__list" data-ea-live>
          <li><Check size={18} aria-hidden="true" /><span {...E("ea.plan")}>{ea.noCard}</span></li>
          <li><Check size={18} aria-hidden="true" /><span {...E("ea.plan")}>{ea.term}</span></li>
        </ul>
      ) : null}
      {!p.compact ? (
        <ul className="aicc-plan__list" {...(ea ? { "data-ea-after": "" } : {})}>
          {p.features.map((f, i) => (
            <li key={f}>
              <Check size={18} aria-hidden="true" />
              <span {...(p.featurePaths?.[i] ? A(p.featurePaths[i]) : {})}>{f}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.extra}
      {ea ? (
        <>
          <p className="aicc-plan__ends aicc-muted aicc-small" data-ea-live {...E("ea.plan")}>{ea.ends}</p>
          <div data-ea-live>
            {EA_OPEN ? (
              <Button href={eaUrl(loc, p.id)} variant={p.featuredLabel ? "primary" : "outline"} block size="lg" {...E("ea.plan")}>{ea.ctaOpen}</Button>
            ) : (
              <p className="aicc-btn aicc-btn--lg aicc-btn--block aicc-btn--soon" data-ea-soon {...E("ea.plan")}>{ea.ctaAnnounce}</p>
            )}
          </div>
          <div data-ea-after>{standardCta}</div>
        </>
      ) : standardCta}
    </article>
  );
}
