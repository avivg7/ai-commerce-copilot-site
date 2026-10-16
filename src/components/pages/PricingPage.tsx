import { Check } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { Rich, type RichCtx } from "@/lib/rich";
import { PLANS } from "@/data/plans";
import { Container, Section, SectionHeading } from "@/components/ui/Primitives";
import { PricingCard } from "@/components/ui/PricingCard";
import { DraftNotice } from "@/components/ui/DraftNotice";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { PlanFinder } from "@/components/home/PlanFinder";
import { Faq, JsonLd, PageHead } from "./shared";
import { breadcrumbLd, faqLd, softwareLd } from "@/lib/jsonld";

export function PricingPage({ locale, t }: { locale: Locale; t: Dictionary }) {
  const p = t.pricing;
  const ctx: RichCtx = { locale, t };
  const R = (x: string) => <Rich text={x} ctx={ctx} />;
  const storesLabel = (n: number) => (n === 1 ? t.common.plan.oneStore : t.common.plan.upToStores.replace("{n}", String(n)));
  const shared = [t.common.plan.sameFeatures, t.common.plan.term, t.common.plan.renewal, t.common.plan.guarantee];
  const names = { solo: p.plans.solo.name, studio: p.plans.studio.name, agency: p.plans.agency.name };

  return (
    <>
      <JsonLd data={breadcrumbLd(locale, "pricing", t, t.common.pageNames.pricing)} />
      <JsonLd data={softwareLd(locale, t)} />
      <JsonLd data={faqLd(locale, t, "pricing")} />
      <PageHead locale={locale} t={t} pageName={t.common.pageNames.pricing} title={p.hero.title} lead={p.hero.lead} />

      <Section tone="sunken">
        <Container>
          <div className="aicc-plans">
            {PLANS.map((pl) => (
              <PricingCard
                key={pl.id}
                id={pl.id}
                name={p.plans[pl.id].name}
                price={pl.price}
                storesLabel={storesLabel(pl.stores)}
                fit={p.plans[pl.id].fit}
                perYear={t.common.plan.perYear}
                featuredLabel={pl.featured ? t.common.plan.recommended : undefined}
                features={shared}
                cta={t.common.plan.choose.replace("{plan}", p.plans[pl.id].name)}
                headingLevel={2}
              />
            ))}
          </div>
          <p className="aicc-muted" style={{ marginBlockStart: "1.5rem", textAlign: "center" }}>{p.cta.body}</p>
        </Container>
      </Section>

      <Section tone="surface" labelledBy="included-title">
        <Container narrow>
          <SectionHeading id="included-title" title={p.included.title} />
          <ul className="aicc-checklist">
            {(["a", "b", "c", "d", "e", "f"] as const).map((k) => (
              <li key={k}><Check size={20} aria-hidden="true" /><span>{p.included.items[k]}</span></li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section tone="sunken" labelledBy="slots-title">
        <Container narrow>
          <SectionHeading id="slots-title" title={p.slots.title} />
          <div className="aicc-prose">
            <p>{p.slots.p1}</p><p>{p.slots.p2}</p><p>{p.slots.p3}</p><p>{p.slots.p4}</p>
          </div>
        </Container>
      </Section>

      <Section tone="surface" labelledBy="which-title">
        <Container narrow>
          <SectionHeading id="which-title" title={p.which.title} lead={p.which.lead} />
          <ul className="aicc-prose" style={{ marginBlockEnd: "1.5rem" }}>
            {(["solo", "studio", "agency"] as const).map((k) => <li key={k}>{p.which.items[k]}</li>)}
          </ul>
          <p className="aicc-prose" style={{ marginBlockEnd: "1.5rem" }}>{R(p.which.outro)}</p>
          <PlanFinder
            s={{
              label: p.finder.label,
              hint: p.finder.hint,
              error: p.finder.error,
              empty: p.finder.empty,
              suggestion: p.finder.suggestion,
              results: { solo: p.finder.resultSolo, studio: p.finder.resultStudio, agency: p.finder.resultAgency },
              names,
              choose: t.common.plan.choose,
            }}
          />
        </Container>
      </Section>

      <Section tone="sunken" labelledBy="terms-title">
        <Container narrow>
          <SectionHeading id="terms-title" title={p.terms.title} />
          <ul className="aicc-prose">
            {(["term", "renewal", "billing", "guarantee", "account"] as const).map((k) => <li key={k}>{p.terms.items[k]}</li>)}
          </ul>
          <p style={{ marginBlockStart: "1rem" }}>{p.refunds.p1}</p>
          <DraftNotice label={t.common.draft.badge} />
          <p style={{ marginBlockStart: "1rem" }}>
            <LocaleLink locale={locale} route="refund-policy" className="aicc-link">{p.terms.policy}</LocaleLink>
          </p>
        </Container>
      </Section>

      <Section tone="surface" labelledBy="pq-title">
        <Container narrow>
          <SectionHeading id="pq-title" title={p.questions.title} />
          <Faq locale={locale} t={t} page="pricing" />
          <p style={{ marginBlockStart: "1.5rem" }}>
            <LocaleLink locale={locale} route="questions" className="aicc-link">{t.common.seeAllQuestions}</LocaleLink>
          </p>
        </Container>
      </Section>
    </>
  );
}
