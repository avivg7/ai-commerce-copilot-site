import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { Rich, type RichCtx } from "@/lib/rich";
import { Accordion } from "@/components/ui/Accordion";
import { DraftNotice } from "@/components/ui/DraftNotice";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { Container } from "@/components/ui/Primitives";
import { FAQ_SELECTION, faqById, type FaqPageKey } from "@/data/faq";
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

/** The FAQ component used on home, pricing, product and questions. `ids` defaults to the page's selection. */
export function Faq({ locale, t, page, ids }: { locale: Locale; t: Dictionary; page: FaqPageKey; ids?: readonly string[] }) {
  const ctx: RichCtx = { locale, t };
  const list = (ids ?? FAQ_SELECTION[page]) as readonly string[];
  const items = list.map((id) => {
    const meta = faqById(id);
    const it = t.faq.items[id as keyof typeof t.faq.items];
    return {
      id: `faq-${id}`,
      question: <Rich text={it.q} ctx={ctx} />,
      answer: (
        <>
          <p>
            <Rich text={it.a} ctx={ctx} />
          </p>
          {meta.legalReview ? <DraftNotice label={t.common.draft.badge} /> : null}
        </>
      ),
    };
  });
  return <Accordion items={items} />;
}

