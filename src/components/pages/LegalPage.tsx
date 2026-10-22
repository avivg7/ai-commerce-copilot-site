import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { Rich, type RichCtx } from "@/lib/rich";
import { fbProps } from "@/i18n";
import { LEGAL_DOCS, TRANSLATION_REVIEW, type LegalDocId } from "@/data/legal";
import { ACCESSIBILITY_REVIEWED_ON, DRAFT_UPDATED_ON, LEGAL_DRAFT_NOTICE, LEGAL_TRANSLATIONS_REVIEWED } from "@/lib/site";
import { formatDate } from "@/lib/format";
import type { RouteId } from "@/lib/routes";
import { Container, Section, Banner } from "@/components/ui/Primitives";
import { JsonLd, PageHead } from "./shared";
import { breadcrumbLd } from "@/lib/jsonld";
import { Pair } from "@/components/blocks/Blocks";

const DOC_ROUTE: Record<LegalDocId, RouteId> = {
  privacy: "privacy",
  terms: "terms",
  refund: "refund-policy",
  dataTrust: "data-and-trust",
  accessibility: "accessibility",
};
const PAGE_NAME: Record<LegalDocId, "privacy" | "terms" | "refund" | "dataTrust" | "accessibility"> = {
  privacy: "privacy",
  terms: "terms",
  refund: "refund",
  dataTrust: "dataTrust",
  accessibility: "accessibility",
};

/**
 * Renders one legal/trust document from src/data/legal.ts (structure + legalReview flags) and the locale dictionary (text).
 * Flagged blocks show the draft notice unless NEXT_PUBLIC_LEGAL_DRAFT_NOTICE === "off".
 */
export function LegalPage({ locale, t, doc }: { locale: Locale; t: Dictionary; doc: LegalDocId }) {
  const d = t.legal[doc];
  const def = LEGAL_DOCS[doc];
  const ctx: RichCtx = { locale, t };
  const route = DOC_ROUTE[doc];
  const pageName = t.common.pageNames[PAGE_NAME[doc]];
  const translated = TRANSLATION_REVIEW[locale] === "native-legal-review-required";
  // The machine-translation disclosure does not depend on the English legal approval (see LEGAL_TRANSLATIONS_REVIEWED in site.ts).
  const showTranslationNotice = translated && !LEGAL_TRANSLATIONS_REVIEWED;
  const isStatement = doc === "accessibility";
  const stamp = isStatement ? ACCESSIBILITY_REVIEWED_ON : DRAFT_UPDATED_ON;
  const date = formatDate(stamp, locale);
  const intro = d.intro.replace("{date}", date);
  // dataTrust is a summary of the privacy policy; it carries the draft notices on its flagged blocks, not a page banner.
  const showStatus = doc !== "dataTrust" && doc !== "accessibility";
  const showBanner = doc !== "accessibility";
  const showDraftBanner = LEGAL_DRAFT_NOTICE && showBanner;
  const fb = (path: string) => fbProps(locale, path);
  const short = doc === "dataTrust" ? t.legal.dataTrust.short : null;

  return (
    <>
      <JsonLd data={breadcrumbLd(locale, route, t, pageName)} />
      <PageHead locale={locale} t={t} pageName={pageName} title={<span {...fb(`legal.${doc}.head`)}>{d.title}</span>} lead={<span {...fb(`legal.${doc}.head`)}><Rich text={intro} ctx={ctx} /></span>}>
        <p className="aicc-muted aicc-small">
          {isStatement ? t.common.lastReviewed : t.common.draftUpdated}: <time dateTime={stamp}>{date}</time>
          {showStatus ? <> &middot; {t.common.version}: {t.common.versionDraft}</> : null}
        </p>
      </PageHead>
      <Section tone="surface">
        <Container>
          {showDraftBanner || showTranslationNotice ? (
            <div style={{ display: "grid", gap: "0.75rem", marginBlockEnd: "2rem", maxInlineSize: "var(--aicc-measure)" }}>
              {/* One draft notice per page (not one per section): the legalReview flags stay in src/data/legal.ts and in launch:check. */}
              {showDraftBanner ? <div data-legal-draft="true"><Banner tone="warning" role="note"><strong>{t.common.draft.badge}</strong>{t.common.draft.text}</Banner></div> : null}
              {showTranslationNotice ? <div data-translation-draft="true"><Banner tone="warning" role="note">{t.common.draft.translation}</Banner></div> : null}
            </div>
          ) : null}
          {short ? (
            <section className="aicc-short" aria-labelledby="dataTrust-short" {...fb("legal.dataTrust.short")}>
              <h2 id="dataTrust-short">{short.h}</h2>
              <Pair
                yes={{ title: short.needsTitle, items: short.needs }}
                no={{ title: short.neverTitle, items: short.never }}
              />
              <p className="aicc-short__receives">{short.receives}</p>
              <p className="aicc-short__note">{short.note}</p>
            </section>
          ) : null}
          <div className="aicc-doc">
            <nav className="aicc-doc__toc" aria-labelledby="doc-toc">
              <h2 id="doc-toc">{t.common.toc}</h2>
              <ol>
                {def.sections.map((sec) => {
                  const sd = d.s[sec.id as keyof typeof d.s] as { h: string };
                  return <li key={sec.id}><a href={`#${doc}-${sec.id}`} {...fb(`legal.${doc}.s.${sec.id}`)}>{sd.h}</a></li>;
                })}
              </ol>
            </nav>
            <div>
              {def.sections.map((sec) => {
                const sd = d.s[sec.id as keyof typeof d.s] as unknown as Record<string, string | string[]>;
                return (
                  <section key={sec.id} id={`${doc}-${sec.id}`} className="aicc-doc__section" aria-labelledby={`${doc}-${sec.id}-h`} {...fb(`legal.${doc}.s.${sec.id}`)}>
                    <h2 id={`${doc}-${sec.id}-h`}>{sd.h as string}</h2>
                    <div className="aicc-prose">
                      {sec.blocks.map((b) => {
                        const v = sd[b.id];
                        return (
                          <div key={b.id} data-legal-review={b.legalReview ? "true" : undefined}>
                            {b.list && Array.isArray(v) ? (
                              <ul>{v.map((item, i) => <li key={i}><Rich text={item} ctx={ctx} /></li>)}</ul>
                            ) : (
                              <p><Rich text={v as string} ctx={ctx} /></p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
