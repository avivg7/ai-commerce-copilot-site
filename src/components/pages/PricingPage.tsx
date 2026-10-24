import { ArrowRight, Check } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { fbProps, txProps } from "@/i18n";
import { Rich, type RichCtx } from "@/lib/rich";
import { PLANS } from "@/data/plans";
import { COMMERCE_OPEN, getStartedUrl } from "@/lib/site";
import { SoonBandActions } from "@/components/ui/Soon";
import { Container, Section, SectionHeading } from "@/components/ui/Primitives";
import { PricingCard } from "@/components/ui/PricingCard";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { Button } from "@/components/ui/Button";
import { PlanFinder } from "@/components/home/PlanFinder";
import { Fb } from "@/components/blocks/Blocks";
import { Faq, JsonLd, PageHead } from "./shared";
import { breadcrumbLd, faqLd, softwareLd } from "@/lib/jsonld";

export function PricingPage({ locale, t }: { locale: Locale; t: Dictionary }) {
  const p = t.pricing;
  const ctx: RichCtx = { locale, t };
  const R = (x: string) => <Rich text={x} ctx={ctx} />;
  const fb = (path: string) => fbProps(locale, path);
  const tx = (path: string) => { const { lang, dir } = txProps(locale, path); return { lang, dir }; };
  const storesLabel = (n: number) => (n === 1 ? t.common.plan.oneStore : t.common.plan.upToStores.replace("{n}", String(n)));
  const shared = [t.common.plan.term, t.common.plan.guarantee];
  const sharedPaths = ["common.plan.term", "common.plan.guarantee"];
  const names = { solo: p.plans.solo.name, studio: p.plans.studio.name, agency: p.plans.agency.name };

  return (
    <>
      <JsonLd data={breadcrumbLd(locale, "pricing", t, t.common.pageNames.pricing)} />
      <JsonLd data={softwareLd(locale, t)} />
      <JsonLd data={faqLd(locale, t, "pricing")} />

      {/* 1. Hero */}
      <div>
        <PageHead locale={locale} t={t} pageName={t.common.pageNames.pricing} title={<span {...fb("pricing.hero")}>{p.hero.title}</span>} lead={<span {...fb("pricing.hero")}>{R(p.hero.lead)}</span>} />
      </div>

      {/* 2. What every plan includes, before any price */}
      <Section tone="surface" labelledBy="included-title" fb={fb("pricing.included")}>
        <Container>
          <SectionHeading id="included-title" title={p.included.title} lead={p.included.lead} />
          <ul className="aicc-included">
            {(["a", "b", "c", "d", "e", "f", "g", "h", "i"] as const).map((k) => (
              <li key={k}><Check size={20} aria-hidden="true" /><span>{p.included.items[k]}</span></li>
            ))}
          </ul>
          <p style={{ marginBlockStart: "1.5rem", fontWeight: 650 }}>{p.included.outro}</p>
        </Container>
      </Section>

      {/* 3. Plans */}
      <Section tone="sunken" labelledBy="plans-title" fb={fb("pricing.plansSection")}>
        <Container>
          <SectionHeading id="plans-title" title={p.plansSection.title} />
          <div className="aicc-plans">
            {PLANS.map((pl) => (
              <PricingCard
                key={pl.id}
                id={pl.id}
                name={p.plans[pl.id].name}
                price={pl.price}
                locale={locale}
                storesLabel={storesLabel(pl.stores)}
                fit={p.plans[pl.id].fit}
                perYear={t.common.plan.perYear}
                featuredLabel={pl.featured ? t.common.plan.recommended : undefined}
                features={shared}
                featurePaths={sharedPaths}
                cta={t.common.plan.choose.replace("{plan}", p.plans[pl.id].name)}
                soon={t.common.soon.label}
                headingLevel={3}
              />
            ))}
          </div>
          <p className="aicc-countline" style={{ marginBlockStart: "1.5rem" }}>{p.plansSection.note} {t.common.plan.renewal}</p>
          <p className="aicc-countline" style={{ marginBlockStart: "0.5rem" }} {...tx("pricing.teaser")}>
            {p.teaser.text}{" "}
            <LocaleLink locale={locale} route="product" hash="demo" className="aicc-link">{p.teaser.link}</LocaleLink>
          </p>
        </Container>
      </Section>

      {/* 4. Which plan? */}
      <Section tone="surface" labelledBy="which-title" fb={fb("pricing.which")}>
        <Container narrow>
          <SectionHeading id="which-title" title={p.which.title} lead={p.which.lead} />
          <div className="aicc-card aicc-which" role="list">
            {(["solo", "studio", "agency"] as const).map((k) => (
              <p key={k} className="aicc-which__row" role="listitem">
                <span>{p.which.items[k]}</span>
                <strong><bdi>{p.plans[k].name}</bdi></strong>
              </p>
            ))}
          </div>
          <p className="aicc-prose" style={{ marginBlock: "1.5rem" }}>{R(p.which.outro)}</p>
          <PlanFinder
            locale={locale}
            {...tx("pricing.finder")}
            s={{
              label: p.finder.label,
              hint: p.finder.hint,
              error: p.finder.error,
              many: p.finder.many,
              empty: p.finder.empty,
              suggestion: p.finder.suggestion,
              results: { solo: p.finder.resultSolo, studio: p.finder.resultStudio, agency: p.finder.resultAgency },
              names,
              choose: t.common.plan.choose,
              soon: t.common.soon.label,
            }}
          />
        </Container>
      </Section>

      {/* 5. How store slots work */}
      <Section tone="sunken" labelledBy="slots-title" fb={fb("pricing.slots")}>
        <Container narrow>
          <SectionHeading id="slots-title" title={p.slots.title} />
          <div className="aicc-prose">
            <p>{p.slots.p1}</p><p>{p.slots.p2}</p><p>{p.slots.p3}</p><p>{p.slots.p4}</p>
          </div>
        </Container>
      </Section>

      {/* 6. Term, renewal and refunds */}
      <Section tone="surface" labelledBy="terms-title" fb={fb("pricing.terms")}>
        <Container>
          <SectionHeading id="terms-title" title={p.terms.title} />
          <div className="aicc-termblocks">
            <div>
              <h3>{p.terms.try.title}</h3>
              <p>{R(p.terms.try.body)}</p>
            </div>
            <div>
              <h3>{p.terms.renewal.title}</h3>
              <p>{p.terms.renewal.body}</p>
            </div>
            <div>
              <h3>{p.terms.back.title}</h3>
              <p>{p.terms.back.body}</p>
              <p><LocaleLink locale={locale} route="data-and-trust" hash="dataTrust-retention" className="aicc-link">{p.terms.back.link}</LocaleLink></p>
            </div>
          </div>
          <p className="aicc-muted" style={{ marginBlockStart: "2rem", maxInlineSize: "52rem" }}>{p.terms.account}</p>
        </Container>
      </Section>

      {/* 7. FAQ */}
      <Section tone="sunken" labelledBy="pq-title" fb={fb("pricing.questions")}>
        <Container narrow>
          <SectionHeading id="pq-title" title={p.questions.title} />
          <Faq locale={locale} t={t} page="pricing" />
          <p style={{ marginBlockStart: "1.5rem" }}>
            <LocaleLink locale={locale} route="questions" className="aicc-link"><Fb locale={locale} k="common.seeAllQuestions">{t.common.seeAllQuestions}</Fb></LocaleLink>
          </p>
        </Container>
      </Section>

      {/* 8. CTA */}
      <Section tone="inverse" labelledBy="pricing-final" fb={fb("pricing.final")}>
        <Container>
          <div className="aicc-final">
            <div className="aicc-stack aicc-stack--lg">
              <h2 id="pricing-final" className="aicc-h2">{p.final.title}</h2>
              {COMMERCE_OPEN ? <p className="aicc-lead">{p.final.body}</p> : <p className="aicc-lead" {...tx("common.soon.band")}>{t.common.soon.band}</p>}
              {COMMERCE_OPEN ? (
                <div className="aicc-hero-actions">
                  <Button href={getStartedUrl(locale)} variant="primary" size="lg" {...tx("common.getStarted")} icon={<ArrowRight size={16} className="aicc-flip" aria-hidden="true" />}>
                    {t.common.getStarted}
                  </Button>
                </div>
              ) : (
                <SoonBandActions locale={locale} t={t} to="questions" />
              )}
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
