import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./Primitives";
import { Button } from "./Button";
import { cn } from "@/lib/cn";
import { currencySuffix, formatPrice } from "@/data/plans";
import { planUrl, type PlanId } from "@/lib/site";

export interface PricingCardProps {
  id: PlanId;
  name: string;
  price: number;
  storesLabel: string;
  fit: string;
  perYear: string;
  featuredLabel?: string;
  features: string[];
  cta: string;
  compact?: boolean;
  locale?: string;
  headingLevel?: 2 | 3;
  extra?: ReactNode;
}

/**
 * One plan. The price and limits come from src/data/plans.ts. The CTA goes to the single GET_STARTED_URL with ?plan=.
 * Studio may carry a "Recommended for 2 to 3 stores" badge; nothing here says "most popular" and there is no urgency.
 */
export function PricingCard(p: PricingCardProps) {
  const H = `h${p.headingLevel ?? 3}` as "h2" | "h3";
  return (
    <article className={cn("aicc-plan", p.featuredLabel && "aicc-plan--featured", p.compact && "aicc-plan--compact")} aria-labelledby={`plan-${p.id}`}>
      <div>
        <div className="aicc-plan__badgerow">{p.featuredLabel ? <Badge tone="brand">{p.featuredLabel}</Badge> : null}</div>
        <H id={`plan-${p.id}`} className="aicc-plan__name">
          <bdi>{p.name}</bdi>
        </H>
        <p className="aicc-muted aicc-small" style={{ marginBlockStart: 4 }}>{p.fit}</p>
      </div>
      <p className="aicc-plan__price">
        <span className="aicc-plan__amount"><bdi>{formatPrice(p.price, p.locale)}</bdi></span>
        <span className="aicc-plan__per">{p.perYear}{currencySuffix(p.locale ?? "en")}</span>
      </p>
      <p className="aicc-plan__stores">{p.storesLabel}</p>
      {!p.compact ? (
        <ul className="aicc-plan__list">
          {p.features.map((f) => (
            <li key={f}>
              <Check size={18} aria-hidden="true" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.extra}
      <Button href={planUrl(p.id)} variant={p.featuredLabel ? "primary" : "secondary"} block size="lg">
        {p.cta}
      </Button>
    </article>
  );
}
