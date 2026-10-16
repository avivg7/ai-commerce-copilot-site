import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { Rich, type RichCtx } from "@/lib/rich";
import { FAQ, FAQ_TOPICS } from "@/data/faq";
import { Container, Section } from "@/components/ui/Primitives";
import { Faq, JsonLd, PageHead } from "./shared";
import { breadcrumbLd, faqLd } from "@/lib/jsonld";
import { RecoImage } from "@/components/ui/RecoImage";

export function QuestionsPage({ locale, t }: { locale: Locale; t: Dictionary }) {
  const ctx: RichCtx = { locale, t };
  return (
    <>
      <JsonLd data={breadcrumbLd(locale, "questions", t, t.common.pageNames.questions)} />
      <JsonLd data={faqLd(locale, t, "questions")} />
      <PageHead
        locale={locale}
        t={t}
        pageName={t.common.pageNames.questions}
        title={t.questionsPage.hero.title}
        lead={<Rich text={t.questionsPage.hero.lead} ctx={ctx} />}
      >
        <nav aria-label={t.common.toc}>
          <ul className="aicc-chips">
            {FAQ_TOPICS.map((tp) => (
              <li key={tp}><a href={`#topic-${tp}`}>{t.questionsPage.topics[tp]}</a></li>
            ))}
          </ul>
        </nav>
      </PageHead>
      <Section tone="surface">
        <Container narrow>
          <div className="aicc-sections">
            {FAQ_TOPICS.map((tp) => {
              const ids = FAQ.filter((f) => f.topic === tp).map((f) => f.id);
              return (
                <section key={tp} aria-labelledby={`topic-${tp}`}>
                  <h2 id={`topic-${tp}`}>{t.questionsPage.topics[tp]}</h2>
                  <Faq locale={locale} t={t} page="questions" ids={ids} />
                </section>
              );
            })}
          </div>
          <div style={{ display: "grid", placeItems: "center", marginBlockStart: "3rem" }}>
            <RecoImage pose="concerned" sizes="120px" displayWidth={110} />
          </div>
        </Container>
      </Section>
    </>
  );
}
