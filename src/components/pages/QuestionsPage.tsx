import type { Locale } from "@/i18n/config";
import { LOCALE_META } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { fbProps, isFallback } from "@/i18n";
import { Rich, type RichCtx } from "@/lib/rich";
import { kitStrings } from "@/lib/kit-strings";
import { FAQ, FAQ_MOST_ASKED, FAQ_TOPICS, faqTitle } from "@/data/faq";
import { Container, Section, SectionHeading } from "@/components/ui/Primitives";
import { Faq, JsonLd, PageHead } from "./shared";
import { breadcrumbLd, faqLd } from "@/lib/jsonld";

/**
 * Questions as a buyer resource, in this order:
 *   1. Most asked before buying (owner-curated list from the content pack)
 *   2. Search (kit module brand/js/faq-search.js; client-side only, optional: without JavaScript the page is the full list)
 *   3. Browse questions by topic (8 topics, in-page jump links, every question with a stable #qNN anchor)
 * No counts anywhere. The FAQPage JSON-LD lists every active question once and never changes while filtering.
 */
export function QuestionsPage({ locale, t }: { locale: Locale; t: Dictionary }) {
  const ctx: RichCtx = { locale, t };
  const q = t.questionsPage;
  const fb = (path: string) => fbProps(locale, path);
  const topics = FAQ_TOPICS.map((topic) => ({ topic, ids: FAQ.filter((f) => f.topic === topic.id).map((f) => f.id) })).filter((x) => x.ids.length);
  const tag = (id: string) => {
    const x = faqTitle(locale, "topics", id);
    return x.fallback ? { lang: "en", dir: "ltr" as const, "data-needs-translation": `topics.${id}` } : {};
  };
  const searchFallback = isFallback(locale, "faqSearch");
  return (
    <>
      <JsonLd data={breadcrumbLd(locale, "questions", t, t.common.pageNames.questions)} />
      <JsonLd data={faqLd(locale, t, "questions")} />
      <PageHead
        locale={locale}
        t={t}
        pageName={t.common.pageNames.questions}
        title={<span {...fb("questionsPage.hero")}>{q.hero.title}</span>}
        lead={<span {...fb("questionsPage.hero")}><Rich text={q.hero.lead} ctx={ctx} /></span>}
      />

      <Section id="most-asked" tone="surface" labelledBy="top-title" fb={fb("questionsPage.top")}>
        <Container narrow>
          <div data-faq-top id="faq-top">
            <SectionHeading id="top-title" title={q.top.title} lead={q.top.lead} />
            <Faq locale={locale} t={t} page="questions" ids={FAQ_MOST_ASKED} idPrefix="top-" />
          </div>
        </Container>
      </Section>

      <Section id="search" tone="sunken" labelledBy="search-title" fb={fb("questionsPage.search")}>
        <Container narrow>
          <h2 id="search-title" className="aicc-sr-only">{q.search.title}</h2>
          <div
            className="aicc-faqsearch aicc-faqsearch--placeholder"
            data-aicc-faq-search
            data-locale={locale}
            data-dir={searchFallback ? "ltr" : LOCALE_META[locale].dir}
            data-target="#faq-browse"
            data-hide="#faq-top"
            data-strings={JSON.stringify(kitStrings(locale, t, "faqSearch"))}
            aria-busy="true"
          />
        </Container>
      </Section>

      <Section id="browse" tone="surface" labelledBy="browse-title" fb={fb("questionsPage.browse")}>
        <Container narrow>
          <SectionHeading id="browse-title" title={q.browse.title} />
          <nav aria-label={q.nav.label} className="aicc-qnav" {...fb("questionsPage.nav")}>
            <ul className="aicc-chips">
              {topics.map(({ topic }) => (
                <li key={topic.id}><a href={`#topic-${topic.id}`} {...tag(topic.id)}>{faqTitle(locale, "topics", topic.id).title}</a></li>
              ))}
            </ul>
          </nav>
          <div id="faq-browse" data-faq-list>
            {topics.map(({ topic, ids }) => (
              <div key={topic.id} className="aicc-qtopic" data-faq-group>
                <h3 id={`topic-${topic.id}`} {...tag(topic.id)}>{faqTitle(locale, "topics", topic.id).title}</h3>
                <Faq locale={locale} t={t} page="questions" ids={ids} />
              </div>
            ))}
          </div>
          <p className="aicc-backtop"><a className="aicc-link" href="#main" {...fb("questionsPage.nav")}>{q.nav.backToTop}</a></p>
        </Container>
      </Section>
    </>
  );
}
