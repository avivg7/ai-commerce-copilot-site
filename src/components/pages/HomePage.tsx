import { ArrowRight, Check, Coffee } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { fbProps, txProps } from "@/i18n";
import { Rich, type RichCtx } from "@/lib/rich";
import { PLANS } from "@/data/plans";
import { GET_STARTED_URL } from "@/lib/site";
import { localePath } from "@/lib/routes";
import { Button } from "@/components/ui/Button";
import { Container, Section, SectionHeading } from "@/components/ui/Primitives";
import { PricingCard } from "@/components/ui/PricingCard";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { RecoImage } from "@/components/ui/RecoImage";
import { RecoHero } from "@/components/brand/RecoHero";
import { FbtSection } from "@/components/brand/FbtSection";
import { WatchDemo } from "@/components/brand/WatchDemo";
import { Fb, Strip, Tabs, Track } from "@/components/blocks/Blocks";
import { DashPreview, Flow, InsightsPreview, Loop, RecoAskPanel, RulesDemo } from "@/components/blocks/KitMounts";
import { Faq, JsonLd } from "./shared";
import { faqLd, organizationLd, softwareLd } from "@/lib/jsonld";

export function HomePage({ locale, t }: { locale: Locale; t: Dictionary }) {
  const h = t.home;
  const ctx: RichCtx = { locale, t };
  const R = (text: string) => <Rich text={text} ctx={ctx} />;
  const fb = (path: string) => fbProps(locale, path);
  const tx = (path: string) => { const { lang, dir } = txProps(locale, path); return { lang, dir }; };
  const arrow = <ArrowRight size={18} className="aicc-flip" aria-hidden="true" />;
  const w = h.workspace;

  return (
    <>
      <JsonLd data={organizationLd(t)} />
      <JsonLd data={softwareLd(locale, t)} />
      <JsonLd data={faqLd(locale, t, "home")} />

      {/* 1. Hero: the live copilt.org composition (eyebrow, gradient headline, CTAs, animated Reco) */}
      <section className="aicc-hero" aria-labelledby="hero-title" {...fb("home.hero")}>
        <div className="aicc-hero__grid">
          <div className="aicc-hero__copy">
            <span className="aicc-eyebrow-pill aicc-fade-up" style={{ ["--i" as string]: 0 }}>{h.hero.eyebrow}</span>
            <h1 id="hero-title" className="aicc-hero-title aicc-fade-up" style={{ ["--i" as string]: 1 }}>
              {h.hero.titleLead} <span className="aicc-text-gradient">{h.hero.titleAccent}</span>
            </h1>
            <p className="aicc-hero-lead aicc-fade-up" style={{ ["--i" as string]: 2 }}>{h.hero.lead}</p>
            <div className="aicc-hero-actions aicc-fade-up" style={{ ["--i" as string]: 3 }}>
              <Button href={GET_STARTED_URL} variant="primary" size="lg" {...tx("common.getStarted")} icon={<ArrowRight size={16} className="aicc-flip" aria-hidden="true" />}>
                {t.common.getStarted}
              </Button>
              <WatchDemo locale={locale} t={t} />
            </div>
            <ul className="aicc-hero__confidence aicc-fade-up" style={{ ["--i" as string]: 4 }}>
              <li>{R(h.hero.confidence.price)}</li>
              <li>{h.hero.confidence.guarantee}</li>
              <li>{h.hero.confidence.renewal}</li>
            </ul>
            <ul className="aicc-hero__facts aicc-hero__facts--values aicc-fade-up" style={{ ["--i" as string]: 5 }}>
              <li><Check size={18} aria-hidden="true" /><span>{h.hero.facts.learned}</span></li>
              <li><Check size={18} aria-hidden="true" /><span>{h.hero.facts.control}</span></li>
              <li><Check size={18} aria-hidden="true" /><span>{h.hero.facts.checkout}</span></li>
            </ul>
          </div>
          <div className="aicc-hero__visual">
            <div {...tx("brand.chips")}><RecoHero labels={[t.brand.chips.orders, t.brand.chips.clicks, t.brand.chips.recs, t.brand.chips.insights, t.brand.chips.bundles]} motion={t.brand.motion} /></div>
          </div>
        </div>
      </section>

      {/* 1b. The merchandising loop as one strip, legible in about a minute (each step links to its section) */}
      <div className="aicc-loopband">
        <Container>
          <Loop
            locale={locale}
            t={t}
            links={[
              "#how-it-works",
              "#why",
              "#demo",
              { href: "#workspace", tab: "ws-t-understand" },
              { href: "#workspace", tab: "ws-t-insights" },
              { href: "#workspace", tab: "ws-t-control" },
              "#how-it-works",
            ]}
          />
          <p className="aicc-loopband__note" {...fb("home.hero")}>{h.hero.timeline}</p>
        </Container>
      </div>

      {/* 2. The difference, shown: the signature demo, with the one argument for it (category versus basket) directly beneath it */}
      <FbtSection
        locale={locale}
        t={t}
        after={
          <div id="why" {...fb("home.why")} style={{ marginBlockStart: "3rem" }}>
            <h3 className="aicc-h3">{h.why.title}</h3>
            <p className="aicc-lead" style={{ marginBlock: "0.5rem 1.5rem", maxInlineSize: "52rem" }}>{h.why.lead}</p>
            <Strip ctx={ctx} items={[h.why.points.intent, h.why.points.evidence, h.why.points.fallback]} />
            <p style={{ marginBlockStart: "1.5rem" }}>
              <LocaleLink locale={locale} route="product" hash="how-decided" className="aicc-link">{h.why.link}</LocaleLink>
            </p>
          </div>
        }
      />

      {/* 3. One premium workspace: understand, control, find opportunities, ask Reco (replaces the standalone dashboard, Control and Meet Reco sections) */}
      <Section id="workspace" tone="sunken" labelledBy="workspace-title" fb={fb("home.workspace")} className="aicc-workspace">
        <Container>
          <SectionHeading id="workspace-title" title={w.title} lead={w.lead} />
          <p className="aicc-connector">
            <span className="aicc-connector__thumb" aria-hidden="true"><Coffee size={18} /></span>
            <span>{w.connector}</span>
            <a className="aicc-link" href="#demo">{w.connectorLink}</a>
          </p>
          <Tabs
            id="ws"
            label={w.tabsLabel}
            tabs={[
              {
                key: "understand", label: w.understand.tab, title: w.understand.title,
                children: (
                  <>
                    <p className="aicc-lead aicc-tabs__lead">{w.understand.lead}</p>
                    <DashPreview locale={locale} t={t} widget />
                    <p className="aicc-muted aicc-small aicc-tabs__note">{w.understand.note}</p>
                  </>
                ),
              },
              {
                key: "control", label: w.control.tab, title: w.control.title,
                children: (
                  <>
                    <p className="aicc-lead aicc-tabs__lead">{w.control.lead}</p>
                    <RulesDemo locale={locale} t={t} />
                    <p className="aicc-muted aicc-small aicc-tabs__note">{w.control.note}</p>
                    <p><LocaleLink locale={locale} route="product" hash="control" className="aicc-link">{w.control.link}</LocaleLink></p>
                  </>
                ),
              },
              {
                key: "insights", label: w.insights.tab, title: w.insights.title,
                children: (
                  <>
                    <p className="aicc-lead aicc-tabs__lead">{w.insights.lead}</p>
                    <InsightsPreview locale={locale} t={t} />
                    <p className="aicc-muted aicc-small aicc-tabs__note">{w.insights.note}</p>
                  </>
                ),
              },
              {
                key: "ask", label: w.ask.tab, title: w.ask.title,
                children: (
                  <>
                    <p className="aicc-lead aicc-tabs__lead">{w.ask.lead}</p>
                    <div className="aicc-askrow">
                      <div className="aicc-reco-figure aicc-reco-figure--small">
                        <RecoImage pose="thinking" sizes="(min-width: 62rem) 200px, 40vw" displayWidth={170} />
                      </div>
                      <RecoAskPanel locale={locale} t={t} />
                    </div>
                    <p className="aicc-muted aicc-small aicc-tabs__note">{w.ask.note}</p>
                    <p><LocaleLink locale={locale} route="product" hash="ask" className="aicc-link">{w.ask.link}</LocaleLink></p>
                  </>
                ),
              },
            ]}
          />
        </Container>
      </Section>

      {/* 4. How it works */}
      <Section id="how-it-works" tone="surface" labelledBy="how-title" fb={fb("home.how")}>
        <Container>
          <SectionHeading id="how-title" title={h.how.title} lead={h.how.lead} />
          <Track items={[h.how.steps.connect, h.how.steps.learn, h.how.steps.recommend]} />
        </Container>
      </Section>

      {/* 5. Store safety */}
      <Section tone="sunken" labelledBy="safety-title" fb={fb("home.safety")}>
        <Container>
          <SectionHeading id="safety-title" title={h.safety.title} lead={h.safety.lead} />
          <div className="aicc-twocol aicc-twocol--even">
            <ul className="aicc-lines aicc-lines--big">
              {(["a", "b", "c", "d"] as const).map((k) => (
                <li key={k}><Check size={22} aria-hidden="true" /><span>{h.safety.points[k]}</span></li>
              ))}
            </ul>
            <div className="aicc-stackgap">
              <Flow locale={locale} t={t} kind="order" />
              <Flow locale={locale} t={t} kind="down" />
            </div>
          </div>
          <p className="aicc-muted aicc-small" style={{ marginBlockStart: "1.5rem", maxInlineSize: "52rem" }}>{h.safety.supporting}</p>
          <p style={{ marginBlockStart: "0.75rem" }}>
            <LocaleLink locale={locale} route="data-and-trust" className="aicc-link">{h.safety.link}</LocaleLink>
            {" · "}
            <LocaleLink locale={locale} route="product" hash="safety" className="aicc-link">{h.safety.more}</LocaleLink>
          </p>
        </Container>
      </Section>

      {/* 6. Pricing, value first */}
      <Section tone="surface" labelledBy="pricing-title" fb={fb("home.pricing")}>
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

      {/* 7. FAQ */}
      <Section tone="sunken" labelledBy="questions-title" fb={fb("home.questions")}>
        <Container narrow>
          <SectionHeading id="questions-title" title={h.questions.title} lead={h.questions.lead} />
          <Faq locale={locale} t={t} page="home" />
          <p style={{ marginBlockStart: "1.5rem" }}>
            <LocaleLink locale={locale} route="questions" className="aicc-link"><Fb locale={locale} k="common.seeAllQuestions">{t.common.seeAllQuestions}</Fb></LocaleLink>
          </p>
        </Container>
      </Section>

      {/* 8. Final CTA (no mascot here) */}
      <Section tone="inverse" labelledBy="final-title" fb={fb("home.final")}>
        <Container>
          <div className="aicc-final">
            <div className="aicc-stack aicc-stack--lg">
              <h2 id="final-title" className="aicc-h2">{h.final.title}</h2>
              <p className="aicc-lead">{h.final.body}</p>
              <p className="aicc-lead aicc-lead--sub">{R(h.final.guarantee)}</p>
              <div className="aicc-hero-actions">
                <Button href={GET_STARTED_URL} variant="primary" size="lg" {...tx("common.getStarted")}>
                  {t.common.getStarted}
                  {arrow}
                </Button>
                <Button href={localePath(locale, "pricing")} variant="ghost" size="lg" {...tx("common.seePricing")}>
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
