import { ArrowRight, Check, Boxes, Gauge, SlidersHorizontal, MessageCircle, ShoppingCart, ShieldCheck, Lock, Undo2, History } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { LOCALE_META } from "@/i18n/config";
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
import { DraftNotice } from "@/components/ui/DraftNotice";
import { withBase } from "@/lib/site";
import { FbtDemoLoader } from "@/components/demo/FbtDemoLoader";
import { Faq, JsonLd } from "./shared";
import { faqLd, organizationLd, softwareLd } from "@/lib/jsonld";

export function HomePage({ locale, t }: { locale: Locale; t: Dictionary }) {
  const h = t.home;
  const ctx: RichCtx = { locale, t };
  const rtl = LOCALE_META[locale].dir === "rtl";
  const R = (text: string) => <Rich text={text} ctx={ctx} />;
  const arrow = <ArrowRight size={18} className="aicc-flip" aria-hidden="true" />;

  return (
    <>
      <JsonLd data={organizationLd(t)} />
      <JsonLd data={softwareLd(locale, t)} />
      <JsonLd data={faqLd(locale, t, "home")} />

      {/* Hero */}
      <section className="aicc-hero" aria-labelledby="hero-title">
        <Container>
          <div className="aicc-hero__grid">
            <div className="aicc-hero__copy">
              <h1 id="hero-title" className="aicc-display">{h.hero.title}</h1>
              <p className="aicc-lead">{h.hero.lead}</p>
              <div className="aicc-hero__actions">
                <Button href={GET_STARTED_URL} variant="primary" size="lg">
                  {t.common.getStarted}
                  {arrow}
                </Button>
                <Button href="#how-it-works" size="lg">
                  {t.common.seeHow}
                </Button>
              </div>
              <ul className="aicc-hero__facts">
                <li><Check size={18} aria-hidden="true" /><span>{R(h.hero.facts.price)}</span></li>
                <li><Check size={18} aria-hidden="true" /><span>{h.hero.facts.guarantee}</span></li>
                <li><Check size={18} aria-hidden="true" /><span>{h.hero.facts.noCharge}</span></li>
              </ul>
            </div>
            <div className="aicc-hero__visual">
            <div className="aicc-hero__stage">
              <RecoImage pose="hero" priority className="aicc-hero__photo" sizes="(min-width: 62rem) 520px, 100vw" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="aicc-hero__mark" src={withBase("/brand/aicc-logomark.svg")} alt="" width={44} height={44} loading="lazy" decoding="async" />
            </div>
              <div className="aicc-hero__widget aicc-card aicc-card--glass" role="group" aria-label={h.hero.cardLabel}>
                <p className="aicc-hero__widget-title"><ShoppingCart size={16} aria-hidden="true" />{h.hero.cardTitle}</p>
                <ul>
                  <li><span>{t.demo.products.kit}</span><bdi>$38</bdi></li>
                  <li><span>{t.demo.products.filters}</span><bdi>$14</bdi></li>
                </ul>
                <p className="aicc-muted" style={{ fontSize: "var(--aicc-text-xs)" }}>{h.hero.cardLabel}</p>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* What AICC actually does */}
      <Section tone="surface" labelledBy="what-title">
        <Container>
          <SectionHeading id="what-title" title={h.what.title} lead={h.what.lead} />
          <div className="aicc-grid aicc-grid--4">
            {(
              [
                ["widget", Boxes],
                ["dashboard", Gauge],
                ["rules", SlidersHorizontal],
                ["reco", MessageCircle],
              ] as const
            ).map(([k, Icon]) => (
              <Card key={k} lift>
                <span className="aicc-icon-tile"><Icon size={24} aria-hidden="true" /></span>
                <h3>{h.what.items[k].title}</h3>
                <p>{h.what.items[k].body}</p>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* Interactive demo */}
      <Section id="demo" tone="sunken" labelledBy="demo-title">
        <Container>
          <SectionHeading id="demo-title" title={h.demo.title} lead={h.demo.lead} />
          <FbtDemoLoader s={t.demo} rtl={rtl} />
        </Container>
      </Section>

      {/* How it works */}
      <Section id="how-it-works" tone="surface" labelledBy="how-title">
        <Container>
          <SectionHeading id="how-title" title={h.how.title} lead={h.how.lead} />
          <ol className="aicc-steps">
            {(["connect", "learn", "recommend", "improve"] as const).map((k) => (
              <li key={k} className="aicc-step">
                <h3>{h.how.steps[k].title}</h3>
                <p>{h.how.steps[k].body}</p>
              </li>
            ))}
          </ol>
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
                  <li key={k}><Check size={20} aria-hidden="true" /><span>{h.reco.points[k]}</span></li>
                ))}
              </ul>
            </div>
            <div className="aicc-reco-figure">
              <RecoImage pose="thinking" sizes="(min-width: 62rem) 360px, 70vw" displayWidth={300} />
            </div>
          </div>
        </Container>
      </Section>

      {/* Merchant control */}
      <Section tone="surface" labelledBy="control-title">
        <Container>
          <SectionHeading id="control-title" title={h.control.title} lead={h.control.lead} />
          <div className="aicc-grid aicc-grid--4">
            {(["pin", "prefer", "deprioritise", "exclude"] as const).map((k) => (
              <Card key={k} className="aicc-rule">
                <h3>{h.control.items[k].title}</h3>
                <p>{h.control.items[k].body}</p>
              </Card>
            ))}
          </div>
          <p className="aicc-muted aicc-small" style={{ marginBlockStart: "1.5rem" }}>{h.control.note}</p>
        </Container>
      </Section>

      {/* Safe by design */}
      <Section tone="sunken" labelledBy="safe-title">
        <Container>
          <SectionHeading id="safe-title" title={h.safe.title} lead={h.safe.lead} />
          <div className="aicc-grid aicc-grid--4">
            {(
              [
                ["checkout", ShoppingCart],
                ["failSoft", ShieldCheck],
                ["dormant", Lock],
                ["remove", Undo2],
              ] as const
            ).map(([k, Icon]) => (
              <Card key={k}>
                <span className="aicc-icon-tile aicc-icon-tile--brand"><Icon size={24} aria-hidden="true" /></span>
                <h3>{h.safe.items[k].title}</h3>
                <p>{h.safe.items[k].body}</p>
              </Card>
            ))}
          </div>
          <p className="aicc-muted aicc-small" style={{ marginBlockStart: "1.5rem" }}>{h.safe.caveat}</p>
        </Container>
      </Section>

      {/* Multi-store */}
      <Section tone="surface" labelledBy="multi-title">
        <Container>
          <SectionHeading id="multi-title" title={h.multi.title} lead={h.multi.lead} />
          <div className="aicc-grid aicc-grid--3">
            {PLANS.map((p) => (
              <Card key={p.id}>
                <h3><bdi>{t.pricing.plans[p.id].name}</bdi></h3>
                <p style={{ fontWeight: 650, color: "var(--aicc-text)", marginBlockEnd: "0.25rem" }}>
                  {p.stores === 1 ? t.common.plan.oneStore : t.common.plan.upToStores.replace("{n}", String(p.stores))}
                </p>
                <p>{h.multi.items[p.id]}</p>
              </Card>
            ))}
          </div>
          <p className="aicc-muted" style={{ marginBlockStart: "1.5rem", maxInlineSize: "var(--aicc-measure)" }}>{h.multi.note}</p>
        </Container>
      </Section>

      {/* Returning merchants */}
      <Section tone="sunken" labelledBy="returning-title">
        <Container narrow>
          <div className="aicc-callout">
            <span className="aicc-icon-tile aicc-icon-tile--brand" style={{ marginBlockEnd: 0 }}><History size={24} aria-hidden="true" /></span>
            <h2 id="returning-title" className="aicc-h2">{h.returning.title}</h2>
            <p>{h.returning.body}</p>
            <DraftNotice label={t.common.draft.badge} />
            <p>{h.returning.gap}</p>
            <p>
              <LocaleLink locale={locale} route="data-and-trust" className="aicc-link">{h.returning.link}</LocaleLink>
            </p>
          </div>
        </Container>
      </Section>

      {/* Pricing preview */}
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

      {/* Questions */}
      <Section tone="sunken" labelledBy="questions-title">
        <Container narrow>
          <SectionHeading id="questions-title" title={h.questions.title} lead={h.questions.lead} />
          <Faq locale={locale} t={t} page="home" />
          <p style={{ marginBlockStart: "1.5rem" }}>
            <LocaleLink locale={locale} route="questions" className="aicc-link">{t.common.seeAllQuestions}</LocaleLink>
          </p>
        </Container>
      </Section>

      {/* Final CTA */}
      <Section tone="inverse" labelledBy="final-title">
        <Container>
          <div className="aicc-final">
            <div className="aicc-stack aicc-stack--lg">
              <h2 id="final-title" className="aicc-h2">{h.final.title}</h2>
              <p className="aicc-lead">{h.final.body}</p>
              <div className="aicc-hero__actions">
                <Button href={GET_STARTED_URL} variant="primary" size="lg">
                  {t.common.getStarted}
                  {arrow}
                </Button>
                <Button href={localePath(locale, "pricing")} variant="ghost" size="lg">
                  {t.common.seePricing}
                </Button>
              </div>
            </div>
            <RecoImage pose="celebrate" sizes="176px" displayWidth={176} />
          </div>
        </Container>
      </Section>
    </>
  );
}
