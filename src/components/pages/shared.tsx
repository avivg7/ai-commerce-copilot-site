import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { Rich, type RichCtx } from "@/lib/rich";
import { Accordion } from "@/components/ui/Accordion";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { Container } from "@/components/ui/Primitives";
import { FAQ_RETIRED, faqSelection, faqText, type FaqPageKey } from "@/data/faq";
import { FaqHash } from "@/components/ui/FaqHash";
import { ldScript } from "@/lib/jsonld";

export function JsonLd({ data }: { data: unknown }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(data) }} />;
}

/** Inner-page header: breadcrumb, the page's single h1, and a lead paragraph. */
export function PageHead({
  locale,
  t,
  pageName,
  title,
  lead,
  children,
}: {
  locale: Locale;
  t: Dictionary;
  pageName: string;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="aicc-pagehead">
      <Container className="aicc-pagehead__inner">
        <nav className="aicc-crumbs" aria-label={t.common.breadcrumbs.label}>
          <ol>
            <li>
              <LocaleLink locale={locale} route="home">
                {t.meta.siteName}
              </LocaleLink>
            </li>
            <li aria-current="page">
              <span aria-hidden="false">{pageName}</span>
            </li>
          </ol>
        </nav>
        <h1 className="aicc-display">{title}</h1>
        {lead ? <p className="aicc-lead">{lead}</p> : null}
        {children}
      </Container>
    </div>
  );
}

/** The FAQ component used on home, pricing, product and questions. Text, order and selection come from the shared content pack (brand/content). */
/**
 * `idPrefix` lets the same question appear twice on one page (the Questions page lists "Most asked before buying" first, then every topic):
 * the copy in the first list gets a prefixed element id so ids stay unique, while #qNN always opens the canonical copy in its topic.
 */
export function Faq({ locale, t, page, ids, idPrefix = "" }: { locale: Locale; t: Dictionary; page: FaqPageKey; ids?: readonly string[]; idPrefix?: string }) {
  const ctx: RichCtx = { locale, t };
  const list = ids ?? faqSelection(page);
  const aliases: Record<string, string[]> = {};
  for (const [old, r] of Object.entries(FAQ_RETIRED)) (aliases[r.mergedInto] ??= []).push(old);
  const items = list.map((id) => {
    const it = faqText(locale, id);
    return {
      id: `${idPrefix}${id}`,
      fallback: it.fallback,
      tag: t.common.fallbackTag,
      aliases: idPrefix ? undefined : aliases[id],
      question: <Rich text={it.q} ctx={ctx} />,
      answer: (
        <>
          {it.a.split("\n\n").map((para, i) => (
            <p key={i}>
              <Rich text={para} ctx={ctx} />
            </p>
          ))}
        </>
      ),
    };
  });
  return (
    <>
      <FaqHash />
      <Accordion items={items} />
    </>
  );
}
