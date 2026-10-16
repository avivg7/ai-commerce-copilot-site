import { ArrowRight, Check, Gauge, SlidersHorizontal, ShoppingCart, ShieldCheck, Lock, Undo2, PlugZap } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { Rich, type RichCtx } from "@/lib/rich";
import { PLANS } from "@/data/plans";
import { GET_STARTED_URL } from "@/lib/site";
import { localePath } from "@/lib/routes";
import { Button } from "@/components/ui/Button";
import { Card, Container, Section, SectionHeading } from "@/components/ui/Primitives";
import { PricingCard } from "@/components/ui/PricingCard";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { RecoImage } from "@/components/ui/RecoImage";
import { RecoHero } from "@/components/brand/RecoHero";
import { FbtSection } from "@/components/brand/FbtSection";
import { WatchDemo } from "@/components/brand/WatchDemo";
import { Faq, JsonLd } from "./shared";
import { faqLd, organizationLd, softwareLd } from "@/lib/jsonld";

export function HomePage({ locale, t }: { locale: Locale; t: Dictionary }) {
  const h = t.home;
  const ctx: RichCtx = { locale, t };
  const R = (text: string) => <Rich text={text} ctx={ctx} />;
  const arrow = <ArrowRight size={18} className="aicc-flip" aria-hidden="true" />;

  return (
    <>
      <JsonLd data={organizationLd(t)} />
      <JsonLd data={softwareLd(locale, t)} />
      <JsonLd data={faqLd(locale, t, "home")} />

      {/* Hero: the live copilt.org composition (eyebrow, gradient headline, CTAs, animated Reco) */}
      <section className="aicc-hero" aria-labelledby="hero-title">
        <div className="aicc-hero__grid">
          <div className="aicc-hero__copy">
            <span className="aicc-eyebrow-pill aicc-fade-up" style={{ ["--i" as string]: 0 }}>{h.hero.eyebrow}</span>
            <h1 id="hero-title" className="aicc-hero-title aicc-fade-up" style={{ ["--i" as string]: 1 }}>
              {h.hero.titleLead} <span className="aicc-text-gradient">{h.hero.titleAccent}</span>
            </h1>
            <p className="aicc-hero-lead aicc-fade-up" style={{ ["--i" as string]: 2 }}>{h.hero.lead}</p>
            <div className="aicc-hero-actions aicc-fade-up" style={{ ["--i" as string]: 3 }}>
              <Button href={GET_STARTED_URL} variant="primary" size="lg" icon={<ArrowRight size={16} className="aicc-flip" aria-hidden="true" />}>
                {t.common.getStarted}
              </Button>
              <WatchDemo locale={locale} t={t} />
            </div>
            <ul className="aicc-hero__facts aicc-fade-up" style={{ ["--i" as string]: 4 }}>
              <li><Check size={18} aria-hidden="true" /><span>{R(h.hero.facts.price)}</span></li>
              <li><Check size={18} aria-hidden="true" /><span>{h.hero.facts.guarantee}</span></li>
              <li><Check size={18} aria-hidden="true" /><span>{h.hero.facts.noCharge}</span></li>
            </ul>
          </div>
          <div className="aicc-hero__visual">
            <RecoHero labels={[t.brand.chips.orders, t.brand.chips.clicks, t.brand.chips.recs, t.brand.chips.insights, t.brand.chips.bundles]} />
          </div>
        </div>
      </section>

      {/* Frequently-bought-together, actually learned: directly after the hero */}
      <FbtSection locale={locale} t={t} />

      {/* How it works: three steps */}
      <Section id="how-it-works" tone="surface" labelledBy="how-title">
        <Container>
          <SectionHeading id="how-title" title={h.how.title} lead={h.how.lead} />
          <ol className="aicc-steps aicc-steps--three">
            {(["connect", "learn", "recommend"] as const).map((k) => (
              <li key={k} className="aicc-step">
                <h3>{h.how.steps[k].title}</h3>
                <p>{h.how.steps[k].body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      {/* You decide, and WooCommerce keeps working */}
      <Section tone="sunken" labelledBy="control-title">
        <Container>
          <SectionHeading id="control-title" title={h.control.title} lead={h.control.lead} />
          <div className="aicc-grid aicc-grid--3">
            {(
              [
                ["rules", SlidersHorizontal],
                ["dashboard", Gauge],
                ["checkout", ShoppingCart],
                ["failSoft", ShieldCheck],
                ["dormant", Lock],
                ["remove", Undo2],
              ] as const
            ).map(([k, Icon]) => (
              <Card key={k}>
                <span className="aicc-icon-tile aicc-icon-tile--brand"><Icon size={24} aria-hidden="true" /></span>
                <h3>{h.control.items[k].title}</h3>
                <p>{h.control.items[k].body}</p>
              </Card>
            ))}
          </div>
          <p className="aicc-muted aicc-small" style={{ marginBlockStart: "1.5rem" }}>{h.control.caveat}</p>
          <p style={{ marginBlockStart: "0.5rem" }}>
            <PlugZap size={16} aria-hidden="true" style={{ display: "inline", verticalAlign: "-2px", marginInlineEnd: 6 }} />
            {h.control.history}{" "}
            <LocaleLink locale={locale} route="data-and-trust" hash="dataTrust-retention" className="aicc-link">{t.common.readHistory}</LocaleLink>
          </p>
        </Container>
      </Section>

      {/* Reco */}
      <Section tone="inverse" labelledBy="reco-title">
        <Container>
          <div className="aicc-split">
            <div className="aicc-stack--lg aicc-stack">
              <h2 id="reco-title" className="aicc-h2">{h.reco.title}</h2>
              <p className="aicc-lead">{h.reco.lead}</p>
              <ul className="aicc-checklist">
                {(["one", "two", "three", "four"] as const).map((k) => (
                  <li key={k}><Check size={20} aria-hidden="true" /><span>{R(h.reco.points[k])}</span></li>
                ))}
              </ul>
            </div>
            <div className="aicc-reco-figure">
              <RecoImage pose="thinking" sizes="(min-width: 62rem) 360px, 70vw" displayWidth={300} />
            </div>
          </div>
        </Container>
      </Section>

      {/* Plans */}
      <Section tone="surface" labelledBy="pricing-title">
        <Container>
          <SectionHeading id="pricing-title" title={h.pricing.title} lead={h.pricing.lead} />
          <div className="aicc-plans">
            {PLANS.map((p) => (
              <PricingCard
                key={p.id}
                id={p.id}
                name={t.pricing.plans[p.id].name}
                price={p.price}
                locale={locale}
                storesLabel={p.stores === 1 ? t.common.plan.oneStore : t.common.plan.upToStores.replace("{n}", String(p.stores))}
                fit={t.pricing.plans[p.id].fit}
                perYear={t.common.plan.perYear}
                featuredLabel={p.featured ? t.common.plan.recommended : undefined}
                features={[]}
                cta={t.common.plan.choose.replace("{plan}", t.pricing.plans[p.id].name)}
                compact
              />
            ))}
          </div>
          <p style={{ marginBlockStart: "1.5rem" }}>
            <LocaleLink locale={locale} route="pricing" className="aicc-link">{h.pricing.link}</LocaleLink>
          </p>
        </Container>
      </Section>

      {/* Questions: four */}
      <Section tone="sunken" labelledBy="questions-title">
        <Container narrow>
          <SectionHeading id="questions-title" title={h.questions.title} lead={h.questions.lead} />
          <Faq locale={locale} t={t} page="home" />
          <p style={{ marginBlockStart: "1.5rem" }}>
            <LocaleLink locale={locale} route="questions" className="aicc-link">{t.common.seeAllQuestions}</LocaleLink>
          </p>
        </Container>
      </Section>

      {/* Final CTA (no mascot here) */}
      <Section tone="inverse" labelledBy="final-title">
        <Container>
          <div className="aicc-final">
            <div className="aicc-stack aicc-stack--lg">
              <h2 id="final-title" className="aicc-h2">{h.final.title}</h2>
              <p className="aicc-lead">{h.final.body}</p>
              <div className="aicc-hero-actions">
                <Button href={GET_STARTED_URL} variant="primary" size="lg">
                  {t.common.getStarted}
                  {arrow}
                </Button>
                <Button href={localePath(locale, "pricing")} variant="ghost" size="lg">
                  {t.common.seePricing}
                </Button>
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
