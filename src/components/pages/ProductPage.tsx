import { ArrowRight, Minus, X } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { fbProps, txProps } from "@/i18n";
import { Lb, type RichCtx } from "@/lib/rich";
import { localePath } from "@/lib/routes";
import { Container, Section, SectionHeading } from "@/components/ui/Primitives";
import { FbtSection } from "@/components/brand/FbtSection";
import { WatchDemo } from "@/components/brand/WatchDemo";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { Faq, JsonLd, PageHead } from "./shared";
import { breadcrumbLd, faqLd, softwareLd } from "@/lib/jsonld";
import { Button } from "@/components/ui/Button";
import { COMMERCE_OPEN, getStartedUrl } from "@/lib/site";
import { SoonBandActions } from "@/components/ui/Soon";
import { SS_INITIAL, SS_ON } from "@/lib/selfService";
import { EA_ON } from "@/lib/earlyAccess";
import { SsBand, SsGetStartedSlot } from "@/components/ss/Ss";
import { Fb, Pair, Ruled, SlotRows, Strip, Track } from "@/components/blocks/Blocks";
import { DashPreview, Flow, Loop, RecoAskPanel, RulesDemo } from "@/components/blocks/KitMounts";
import { PLANS } from "@/data/plans";

export function ProductPage({ locale, t }: { locale: Locale; t: Dictionary }) {
  const p = t.product;
  const ctx: RichCtx = { locale, t };
  const fb = (path: string) => fbProps(locale, path);
  const tx = (path: string) => { const { lang, dir } = txProps(locale, path); return { lang, dir }; };
  const toc = [
    ["demo", p.toc.shopper],
    ["how-decided", p.toc.learn],
    ["sparse", p.toc.sparse],
    ["compare", p.toc.compare],
    ["dashboard", p.toc.dash],
    ["control", p.toc.control],
    ["ask", p.toc.ask],
    ["measure", p.toc.measure],
    ["safety", p.toc.safety],
    ["history", p.toc.history],
    ["stores", p.toc.stores],
    ["limits", p.toc.limits],
  ] as const;
  const cmpKeys = ["chosen", "see", "control", "explain", "guide", "history", "fail"] as const;
  const langKeys = ["site", "admin", "reco", "widget"] as const;
  const slotFor = (n: number) => (n === 1 ? p.stores.slotsOne : p.stores.slots.replace("{n}", String(n)));

  return (
    <>
      <JsonLd data={breadcrumbLd(locale, "product", t, t.common.pageNames.product)} />
      <JsonLd data={softwareLd(locale, t)} />
      <JsonLd data={faqLd(locale, t, "product")} />

      {/* 1. Hero */}
      <div>
        <PageHead locale={locale} t={t} pageName={t.common.pageNames.product} title={<span {...fb("product.hero")}>{p.hero.title}</span>} lead={<span {...fb("product.hero")}>{p.hero.lead}</span>}>
          <div className="aicc-hero-actions">
            {SS_ON ? (
              /* P39: the account page until sign-up is known to work, then the sign-up page (never /start/ while it may be a 404, never the demo). A launch-offer build hides it after the trial end instant and shows the ordinary Get started instead. */
              <>
                <span style={{ display: "contents" }} {...(EA_ON ? { "data-ea-live": "" } : {})}>
                  <SsGetStartedSlot locale={locale} className="aicc-btn aicc-btn--primary aicc-btn--lg" icon={<ArrowRight size={16} className="aicc-flip" aria-hidden="true" />}>{t.common.getStarted}</SsGetStartedSlot>
                </span>
                {EA_ON ? (
                  <span style={{ display: "contents" }} data-ea-after>
                    <Button href={getStartedUrl(locale)} variant="primary" size="lg" {...tx("common.getStarted")} icon={<ArrowRight size={16} className="aicc-flip" aria-hidden="true" />}>{t.common.getStarted}</Button>
                  </span>
                ) : null}
              </>
            ) : (
              <Button href={getStartedUrl(locale)} variant="primary" size="lg" {...tx("common.getStarted")} icon={<ArrowRight size={16} className="aicc-flip" aria-hidden="true" />}>{t.common.getStarted}</Button>
            )}
            <WatchDemo locale={locale} t={t} />
          </div>
        </PageHead>
      </div>

      {/* In-page navigation: one compact bar that stays under the header while you read (horizontal scroll on phones) */}
      <nav className="aicc-subnav" aria-label={t.common.toc} {...fb("product.toc")}>
        <ul>
          {toc.map(([id, label]) => (
            <li key={id}><a href={`#${id}`}>{label}</a></li>
          ))}
        </ul>
      </nav>

      {/* 1b. The merchandising loop as one strip (each step links to its section on this page) */}
      <div className="aicc-loopband">
        <Container>
          <Loop locale={locale} t={t} links={["#history", "#how-decided", "#demo", "#measure", "#dashboard", "#control", "#history"]} />
        </Container>
      </div>

      {/* 2. Shopper experience: the signature demo (shopper view and merchant view) */}
      <FbtSection
        locale={locale}
        t={t}
        tone="surface"
        title={p.shopper.title}
        lead={p.shopper.lead}
        titleKey="product.shopper"
        after={
          <div {...fb("product.shopper")} style={{ marginBlockStart: "3rem" }}>
            <Strip ctx={ctx} items={[p.shopper.page, p.shopper.cart, p.shopper.fit]} />
            <p className="aicc-note" style={{ marginBlockStart: "1.5rem", maxInlineSize: "52rem" }}>{p.shopper.only}</p>
          </div>
        }
      />

      {/* 3. How AICC learns */}
      <Section id="how-decided" tone="sunken" labelledBy="learn-title" fb={fb("product.learn")}>
        <Container>
          <SectionHeading id="learn-title" title={p.learn.title} lead={p.learn.lead} />
          <Track items={[p.learn.steps.learned, p.learn.steps.category, p.learn.steps.newest, p.learn.steps.rules]} locale={locale} />
          <p className="aicc-note" style={{ marginBlockStart: "2.5rem", maxInlineSize: "52rem" }} {...tx("product.learnPlain")}>{p.learnPlain}</p>
        </Container>
      </Section>

      {/* 4. When history is sparse */}
      <Section id="sparse" tone="surface" labelledBy="sparse-title" fb={fb("product.sparse")}>
        <Container>
          <SectionHeading id="sparse-title" title={p.sparse.title} lead={p.sparse.lead} />
          <div className="aicc-twocol aicc-twocol--even">
            <div className="aicc-prose">
              <p>{p.sparse.p1}</p>
              <p>{p.sparse.p2}</p>
            </div>
            <div className="aicc-note">
              <strong>{p.sparse.limitTitle}</strong>
              <Lb text={p.sparse.limit} locale={locale} />
            </div>
          </div>
          <ol className="aicc-slots" style={{ marginBlockStart: "2rem" }} aria-label={p.sparse.slots.caption}>
            {[
              ["learned", p.sparse.slots.learned.replace("{n}", "9")],
              ["learned", p.sparse.slots.learned.replace("{n}", "6")],
              ["category", p.sparse.slots.category],
              ["newest", p.sparse.slots.newest],
            ].map(([kind, label], i) => (
              <li key={i} data-kind={kind}>
                <small>{p.sparse.slots.slot.replace("{n}", String(i + 1))}</small>
                <strong>{label}</strong>
              </li>
            ))}
          </ol>
          <p className="aicc-slots-caption">{p.sparse.slots.caption}</p>
        </Container>
      </Section>

      {/* 4b. A fair comparison (moved up: it answers "why AICC" early) */}
      <Section id="compare" tone="sunken" labelledBy="compare-title" fb={fb("product.compare")}>
        <Container>
          <SectionHeading id="compare-title" title={p.compare.title} lead={p.compare.lead} />
          <div className="aicc-table-wrap">
            <table className="aicc-table">
              <caption className="aicc-sr-only">{p.compare.caption}</caption>
              <thead>
                <tr>
                  <th scope="col"><span className="aicc-sr-only">{p.compare.colTopic}</span></th>
                  <th scope="col">{p.compare.colWoo}</th>
                  <th scope="col" data-col="aicc"><bdi>{p.compare.colAicc}</bdi></th>
                </tr>
              </thead>
              <tbody>
                {cmpKeys.map((k) => (
                  <tr key={k}>
                    <th scope="row">{p.compare.rows[k].topic}</th>
                    <td data-label={p.compare.colWoo}>{p.compare.rows[k].woo}</td>
                    <td data-col="aicc" data-label={p.compare.colAicc}><Lb text={p.compare.rows[k].aicc} locale={locale} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      {/* 5. Dashboard */}
      <Section id="dashboard" tone="surface" labelledBy="dash-title" fb={fb("product.dash")}>
        <Container>
          <SectionHeading id="dash-title" title={p.dash.title} lead={p.dash.lead} />
          <DashPreview locale={locale} t={t} variant="full" callouts={false} />
          <ol className="aicc-numbered">
            {(["a", "b", "c", "d"] as const).map((k) => (
              <li key={k}>
                <h3><Lb text={p.dash.items[k].title} locale={locale} /></h3>
                <p><Lb text={p.dash.items[k].body} locale={locale} /></p>
              </li>
            ))}
          </ol>
          <div className="aicc-twocol aicc-twocol--even" style={{ marginBlockStart: "2rem" }}>
            <p className="aicc-note">{p.dash.readiness} {p.dash.gate}</p>
            <p className="aicc-muted">{p.dash.export}</p>
          </div>
        </Container>
      </Section>

      {/* 6. Controls */}
      <Section id="control" tone="sunken" labelledBy="control-title" fb={fb("product.control")}>
        <Container>
          <SectionHeading id="control-title" title={p.control.title} lead={p.control.lead} />
          <RulesDemo locale={locale} t={t} />
          <div className="aicc-table-wrap" style={{ marginBlockStart: "2.5rem" }}>
            <table className="aicc-table aicc-table--rules">
              <caption>{p.control.tableCaption}</caption>
              <thead>
                <tr><th scope="col">{p.control.colRule}</th><th scope="col">{p.control.colDoes}</th></tr>
              </thead>
              <tbody>
                {(["pin", "exclude", "prefer", "deprioritize"] as const).map((k) => (
                  <tr key={k}>
                    <th scope="row"><Lb text={t.rules.actions[k]} locale={locale} /></th>
                    <td data-label={p.control.colDoes}><Lb text={p.control.rows[k]} locale={locale} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="aicc-twocol aicc-twocol--even" style={{ marginBlockStart: "2rem" }}>
            <div className="aicc-note"><strong>{p.control.scopeTitle}</strong>{p.control.scope}</div>
            <div className="aicc-note aicc-note--warm"><strong>{p.control.guardTitle}</strong><Lb text={p.control.guard} locale={locale} /></div>
          </div>
        </Container>
      </Section>

      {/* 7. Ask Reco */}
      <Section id="ask" tone="surface" labelledBy="ask-title" fb={fb("product.ask")}>
        <Container>
          <SectionHeading id="ask-title" title={p.ask.title} lead={p.ask.lead} />
          <div className="aicc-twocol">
            <div className="aicc-stackgap">
              <Pair
                yes={{ title: p.ask.canTitle, items: Object.values(p.ask.can) }}
                no={{ title: p.ask.cannotTitle, items: Object.values(p.ask.cannot) }}
              />
              <p className="aicc-muted">{p.ask.note}</p>
            </div>
            <RecoAskPanel locale={locale} t={t} />
          </div>
        </Container>
      </Section>

      {/* 8. Measurement and attribution */}
      <Section id="measure" tone="sunken" labelledBy="measure-title" fb={fb("product.measure")}>
        <Container>
          <SectionHeading id="measure-title" title={p.measure.title} lead={p.measure.lead} />
          <Flow locale={locale} t={t} kind="measure" unit="product.measure" flow={{ title: p.measure.flow.title, steps: p.measure.flow.steps }} />
          <div className="aicc-twocol aicc-twocol--even" style={{ marginBlockStart: "2rem" }}>
            <div className="aicc-stackgap">
              <p className="aicc-note aicc-note--warm">{p.measure.association}</p>
              <p>{p.measure.consent}</p>
            </div>
            <div>
              <h3 className="aicc-h3" style={{ marginBlockEnd: "0.75rem" }}>{p.measure.notTitle}</h3>
              <Ruled icon={<X size={18} aria-hidden="true" />} items={Object.values(p.measure.not)} />
            </div>
          </div>
        </Container>
      </Section>

      {/* 9. Safety / fail-soft */}
      <Section id="safety" tone="surface" labelledBy="safety-title" fb={fb("product.safety")}>
        <Container>
          <SectionHeading id="safety-title" title={p.safety.title} lead={p.safety.lead} />
          <div className="aicc-flowgrid">
            <Flow locale={locale} t={t} kind="order" />
            <Flow locale={locale} t={t} kind="down" />
            <Flow locale={locale} t={t} kind="inactive" />
          </div>
          <div className="aicc-twocol aicc-twocol--even" style={{ marginBlockStart: "2rem" }}>
            <div className="aicc-stackgap">
              <p>{p.safety.conditions}</p>
              <p className="aicc-note aicc-note--warm">{p.safety.limit}</p>
            </div>
            <div className="aicc-stackgap">
              <p>{p.safety.requirements}</p>
              <p>{p.safety.light}</p>
              <p><LocaleLink locale={locale} route="data-and-trust" className="aicc-link">{p.safety.link}</LocaleLink></p>
            </div>
          </div>
        </Container>
      </Section>

      {/* 9b. A CTA right after the biggest risk-reducer */}
      <Section tone="inverse" labelledBy="safety-cta" fb={fb("product.safetyCta")}>
        <Container>
          <div className="aicc-final">
            <div className="aicc-stack aicc-stack--lg">
              <h2 id="safety-cta" className="aicc-h2">{p.safetyCta.title}</h2>
              {SS_ON ? (
                <>
                  <SsBand locale={locale} t={t} contact>
                    <Button href={localePath(locale, "pricing")} variant={SS_INITIAL === "link" ? "ghost" : "primary"} size="lg" {...tx("common.seePricing")}>{t.common.seePricing}</Button>
                  </SsBand>
                  {/* after the trial end instant the ordinary band returns (a launch-offer build only) */}
                  {EA_ON ? (
                    <div className="aicc-stack aicc-stack--lg" data-ea-after>
                      {COMMERCE_OPEN ? <p className="aicc-lead">{p.safetyCta.body}</p> : <p className="aicc-lead" {...tx("common.soon.band")}>{t.common.soon.band}</p>}
                      {COMMERCE_OPEN ? null : <SoonBandActions locale={locale} t={t} />}
                    </div>
                  ) : null}
                </>
              ) : COMMERCE_OPEN ? <p className="aicc-lead">{p.safetyCta.body}</p> : <p className="aicc-lead" {...tx("common.soon.band")}>{t.common.soon.band}</p>}
              {SS_ON ? null : COMMERCE_OPEN ? (
                <div className="aicc-hero-actions">
                  <Button href={getStartedUrl(locale)} variant="primary" size="lg" {...tx("common.getStarted")} icon={<ArrowRight size={16} className="aicc-flip" aria-hidden="true" />}>{t.common.getStarted}</Button>
                  <Button href={localePath(locale, "pricing")} variant="ghost" size="lg" {...tx("common.seePricing")}>{t.common.seePricing}</Button>
                </div>
              ) : (
                <SoonBandActions locale={locale} t={t} />
              )}
            </div>
          </div>
        </Container>
      </Section>

      {/* 10. Historical learning */}
      <Section id="history" tone="sunken" labelledBy="history-title" fb={fb("product.history")}>
        <Container>
          <SectionHeading id="history-title" title={p.history.title} lead={p.history.lead} />
          <div className="aicc-twocol aicc-twocol--even">
            <div className="aicc-prose">
              <p>{p.history.p1}</p>
              <p>{p.history.p2}</p>
              <p><Lb text={p.history.p3} locale={locale} /></p>
              <p><LocaleLink locale={locale} route="data-and-trust" hash="dataTrust-retention" className="aicc-link">{p.history.link}</LocaleLink></p>
            </div>
            <Flow locale={locale} t={t} kind="history" unit="product.history" flow={{ title: p.history.flowTitle, steps: p.history.flow }} />
          </div>
        </Container>
      </Section>

      {/* 11. More than one store: a short summary (the full explanation lives on Pricing) */}
      <Section id="stores" tone="surface" labelledBy="stores-title" fb={fb("product.stores")}>
        <Container>
          <SectionHeading id="stores-title" title={p.stores.title} lead={p.stores.lead} />
          <div className="aicc-twocol aicc-twocol--even">
            <SlotRows rows={PLANS.map((pl) => ({ name: t.pricing.plans[pl.id].name, n: pl.stores, label: slotFor(pl.stores) }))} />
            <div className="aicc-prose">
              <p>{p.stores.p1}</p>
              <p><LocaleLink locale={locale} route="pricing" className="aicc-link">{p.stores.link}</LocaleLink></p>
            </div>
          </div>
        </Container>
      </Section>

      {/* 13. Current scope: what AICC focuses on today (late on the page, after the comparison) */}
      <Section id="limits" tone="sunken" labelledBy="limits-title" fb={fb("product.limits")}>
        <Container>
          <SectionHeading id="limits-title" title={p.limits.title} lead={p.limits.lead} />
          <Ruled icon={<Minus size={18} aria-hidden="true" />} items={Object.values(p.limits.items)} />
        </Container>
      </Section>

      {/* 14. Languages */}
      <Section tone="surface" labelledBy="languages-title" fb={fb("product.languages")}>
        <Container>
          <SectionHeading id="languages-title" title={p.languages.title} lead={p.languages.lead} />
          <div className="aicc-table-wrap">
            <table className="aicc-table">
              <caption className="aicc-sr-only">{p.languages.caption}</caption>
              <thead>
                <tr><th scope="col">{p.languages.colPart}</th><th scope="col">{p.languages.colLangs}</th></tr>
              </thead>
              <tbody>
                {langKeys.map((k) => (
                  <tr key={k}>
                    <th scope="row">{p.languages.rows[k].part}</th>
                    <td data-label={p.languages.colLangs}>{p.languages.rows[k].langs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      {/* 15. FAQ */}
      <Section tone="sunken" labelledBy="product-questions" fb={fb("product.questions")}>
        <Container narrow>
          <SectionHeading id="product-questions" title={p.questions.title} />
          <Faq locale={locale} t={t} page="product" />
          <p style={{ marginBlockStart: "1.5rem" }}>
            <LocaleLink locale={locale} route="questions" className="aicc-link"><Fb locale={locale} k="common.seeAllQuestions">{t.common.seeAllQuestions}</Fb></LocaleLink>
          </p>
        </Container>
      </Section>

      {/* 16. CTA */}
      <Section tone="inverse" labelledBy="product-final" fb={fb("product.cta")}>
        <Container>
          <div className="aicc-final">
            <div className="aicc-stack aicc-stack--lg">
              <h2 id="product-final" className="aicc-h2">{p.cta.title}</h2>
              {SS_ON ? (
                <>
                  <SsBand locale={locale} t={t} contact>
                    <Button href={localePath(locale, "pricing")} variant={SS_INITIAL === "link" ? "ghost" : "primary"} size="lg" {...tx("common.seePricing")}>{t.common.seePricing}</Button>
                  </SsBand>
                  {/* after the trial end instant the ordinary band returns (a launch-offer build only) */}
                  {EA_ON ? (
                    <div className="aicc-stack aicc-stack--lg" data-ea-after>
                      {COMMERCE_OPEN ? <p className="aicc-lead">{p.cta.body}</p> : <p className="aicc-lead" {...tx("common.soon.band")}>{t.common.soon.band}</p>}
                      {COMMERCE_OPEN ? null : <SoonBandActions locale={locale} t={t} />}
                    </div>
                  ) : null}
                </>
              ) : COMMERCE_OPEN ? <p className="aicc-lead">{p.cta.body}</p> : <p className="aicc-lead" {...tx("common.soon.band")}>{t.common.soon.band}</p>}
              {SS_ON ? null : COMMERCE_OPEN ? (
                <div className="aicc-hero-actions">
                  <Button href={getStartedUrl(locale)} variant="primary" size="lg" {...tx("common.getStarted")} icon={<ArrowRight size={16} className="aicc-flip" aria-hidden="true" />}>{t.common.getStarted}</Button>
                  <Button href={localePath(locale, "pricing")} variant="ghost" size="lg" {...tx("common.seePricing")}>{t.common.seePricing}</Button>
                </div>
              ) : (
                <SoonBandActions locale={locale} t={t} />
              )}
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
