import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./Primitives";
import { Button } from "./Button";
import { cn } from "@/lib/cn";
import { currencySuffix, formatPrice } from "@/data/plans";
import { planUrl, type PlanId } from "@/lib/site";
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
  compact?: boolean;
  locale?: string;
  headingLevel?: 2 | 3;
  extra?: ReactNode;
}

/**
 * One plan. The price and limits come from src/data/plans.ts. The CTA goes to the single GET_STARTED_URL with ?plan=.
 * Studio carries a neutral "Built for multiple stores" badge (a purpose label, not a recommendation: two Solo plans cost less than one Studio); nothing here says "most popular" and there is no urgency.
 */
export function PricingCard(p: PricingCardProps) {
  const H = `h${p.headingLevel ?? 3}` as "h2" | "h3";
  // Each string says which language it is in: the card often sits inside a block that is still English fallback while these strings are translated.
  const loc = (p.locale ?? "en") as Locale;
  const A = (path: string) => { const { lang, dir } = txProps(loc, path); return { lang, dir }; };
  const storesPath = p.id === "solo" ? "common.plan.oneStore" : "common.plan.upToStores";
  return (
    <article className={cn("aicc-plan", p.featuredLabel && "aicc-plan--featured", p.compact && "aicc-plan--compact")} aria-labelledby={`plan-${p.id}`}>
      <div>
        <div className="aicc-plan__badgerow">{p.featuredLabel ? <span {...A("common.plan.recommended")}><Badge tone="brand">{p.featuredLabel}</Badge></span> : null}</div>
        <H id={`plan-${p.id}`} className="aicc-plan__name">
          <bdi>{p.name}</bdi>
        </H>
        <p className="aicc-muted aicc-small aicc-plan__fit" style={{ marginBlockStart: 4 }} {...A("pricing.plans")}>{p.fit}</p>
      </div>
      <p className="aicc-plan__price">
        <span className="aicc-plan__amount"><bdi>{formatPrice(p.price, p.locale)}</bdi></span>
        <span className="aicc-plan__per" {...A("common.plan.perYear")}>{p.perYear}{currencySuffix(p.locale ?? "en")}</span>
      </p>
      <p className="aicc-plan__stores" {...A(storesPath)}>{p.storesLabel}</p>
      {!p.compact ? (
        <ul className="aicc-plan__list">
          {p.features.map((f, i) => (
            <li key={f}>
              <Check size={18} aria-hidden="true" />
              <span {...(p.featurePaths?.[i] ? A(p.featurePaths[i]) : {})}>{f}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.extra}
      <Button href={planUrl(p.id)} variant={p.featuredLabel ? "primary" : "outline"} block size="lg" {...A("common.plan.choose")}>
        {p.cta}
      </Button>
    </article>
  );
}
