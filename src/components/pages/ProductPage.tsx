import type { Locale } from "@/i18n/config";
import { LOCALE_META } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { Rich, type RichCtx } from "@/lib/rich";
import { Container, Section, SectionHeading } from "@/components/ui/Primitives";
import { FbtDemoLoader } from "@/components/demo/FbtDemoLoader";
import { Faq, JsonLd, PageHead } from "./shared";
import { breadcrumbLd, faqLd, softwareLd } from "@/lib/jsonld";
import { Button } from "@/components/ui/Button";
import { GET_STARTED_URL } from "@/lib/site";

export function ProductPage({ locale, t }: { locale: Locale; t: Dictionary }) {
  const p = t.product;
  const ctx: RichCtx = { locale, t };
  const R = (x: string) => <Rich text={x} ctx={ctx} />;
  const rtl = LOCALE_META[locale].dir === "rtl";
  const toc = [
    ["shopper", p.toc.shopper],
    ["merchant", p.toc.merchant],
    ["decide", p.toc.decide],
    ["data", p.toc.data],
    ["measure", p.toc.measure],
    ["import", p.toc.import],
    ["multi", p.toc.multi],
    ["safe", p.toc.safe],
    ["returning", p.toc.returning],
    ["languages", p.toc.languages],
    ["not-yet", p.toc.notYet],
  ] as const;

  return (
    <>
      <JsonLd data={breadcrumbLd(locale, "product", t, t.common.pageNames.product)} />
      <JsonLd data={softwareLd(locale, t)} />
      <JsonLd data={faqLd(locale, t, "product")} />
      <PageHead locale={locale} t={t} pageName={t.common.pageNames.product} title={p.hero.title} lead={p.hero.lead}>
        <nav aria-label={t.common.toc}>
          <ul className="aicc-chips">
            {toc.map(([id, label]) => (
              <li key={id}><a href={`#${id}`}>{label}</a></li>
            ))}
          </ul>
        </nav>
      </PageHead>

      <Section tone="surface">
        <Container narrow>
          <div className="aicc-sections aicc-prose" style={{ maxInlineSize: "none" }}>
            <section aria-labelledby="shopper">
              <h2 id="shopper">{p.shopper.title}</h2>
              <div className="aicc-prose"><p>{p.shopper.p1}</p><p>{p.shopper.p2}</p><p>{p.shopper.p3}</p></div>
            </section>
          </div>
        </Container>
      </Section>

      <Section tone="sunken" labelledBy="see-working">
        <Container>
          <SectionHeading id="see-working" title={p.demoHeading} lead={t.demo.intro} />
          <FbtDemoLoader s={t.demo} rtl={rtl} locale={locale} />
        </Container>
      </Section>

      <Section tone="surface">
        <Container narrow>
          <div className="aicc-sections">
            <section aria-labelledby="merchant">
              <h2 id="merchant">{p.merchant.title}</h2>
              <div className="aicc-prose"><p>{p.merchant.p1}</p><p>{p.merchant.p2}</p><p>{p.merchant.p3}</p></div>
            </section>

            <section aria-labelledby="decide">
              <h2 id="decide">{p.decide.title}</h2>
              <p className="aicc-muted" style={{ marginBlockEnd: "1rem" }}>{p.decide.lead}</p>
              <ol className="aicc-decide">
                {(["learned", "category", "newest", "rules"] as const).map((k) => (
                  <li key={k}>
                    <div>
                      <h3>{p.decide.steps[k].title}</h3>
                      <p>{p.decide.steps[k].body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="aicc-prose" style={{ marginBlockStart: "1rem" }}>{p.decide.honest}</p>
            </section>

            <section aria-labelledby="data">
              <h2 id="data">{p.data.title}</h2>
              <div className="aicc-prose"><p>{p.data.p1}</p><p>{R(p.data.p2)}</p></div>
            </section>

            <section aria-labelledby="measure">
              <h2 id="measure">{p.measure.title}</h2>
              <div className="aicc-prose"><p>{p.measure.p1}</p><p>{p.measure.p2}</p></div>
            </section>

            <section aria-labelledby="import">
              <h2 id="import">{p.import.title}</h2>
              <div className="aicc-prose"><p>{p.import.p1}</p><p>{p.import.p2}</p></div>
            </section>

            <section aria-labelledby="multi">
              <h2 id="multi">{p.multi.title}</h2>
              <div className="aicc-prose"><p>{p.multi.p1}</p><p>{R(p.multi.p2)}</p></div>
            </section>

            <section aria-labelledby="safe">
              <h2 id="safe">{p.safe.title}</h2>
              <div className="aicc-prose"><p>{p.safe.p1}</p><p>{p.safe.p2}</p></div>
            </section>

            <section aria-labelledby="returning">
              <h2 id="returning">{p.returning.title}</h2>
              <div className="aicc-prose"><p>{p.returning.p1}</p></div>
            </section>

            <section aria-labelledby="languages">
              <h2 id="languages">{p.languages.title}</h2>
              <div className="aicc-prose"><p>{p.languages.p1}</p></div>
            </section>

            <section aria-labelledby="not-yet">
              <h2 id="not-yet">{p.notYet.title}</h2>
              <ul className="aicc-prose">
                {(["a", "b", "c", "d", "e", "f"] as const).map((k) => <li key={k}>{p.notYet.items[k]}</li>)}
              </ul>
              <p className="aicc-prose" style={{ marginBlockStart: "1rem" }}>{p.notYet.outro}</p>
            </section>
          </div>
        </Container>
      </Section>

      <Section tone="sunken" labelledBy="product-questions">
        <Container narrow>
          <SectionHeading id="product-questions" title={t.questionsPage.hero.title} />
          <Faq locale={locale} t={t} page="product" />
          <div className="aicc-hero__actions" style={{ marginBlockStart: "2rem" }}>
            <Button href={GET_STARTED_URL} variant="primary" size="lg">{t.common.getStarted}</Button>
          </div>
        </Container>
      </Section>
    </>
  );
}
