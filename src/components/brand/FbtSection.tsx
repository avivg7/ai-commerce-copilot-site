import type { Locale } from "@/i18n/config";
import { LOCALE_META } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { fbProps, isFallback } from "@/i18n";
import { kitStrings } from "@/lib/kit-strings";
import { Container, Section, SectionHeading } from "@/components/ui/Primitives";

/**
 * "Frequently-bought-together, actually learned." The heading and lead are page content (their own fallback state); the interactive demo is rendered
 * by the kit (brand/js/fbt-demo.js) into the container below when it nears the viewport. The container carries its strings, so the kit needs no global state.
 */
export function FbtSection({
  locale, t, tone = "sunken", title, lead, titleKey = "home.demo", children, after,
}: { locale: Locale; t: Dictionary; tone?: "sunken" | "surface"; title?: string; lead?: string; titleKey?: string; children?: React.ReactNode; after?: React.ReactNode }) {
  const demoFallback = isFallback(locale, "demo");
  return (
    <Section id="demo" tone={tone} labelledBy="demo-title" className="aicc-fbt-section">
      <Container>
        <div {...fbProps(locale, titleKey)}>
          <SectionHeading id="demo-title" title={title ?? t.home.demo.title} lead={lead ?? t.home.demo.lead} />
        </div>
        {children}
        <div
          className="aicc-fbt aicc-fbt--placeholder"
          data-aicc-fbt
          data-locale={locale}
          data-dir={demoFallback ? "ltr" : LOCALE_META[locale].dir}
          data-strings={JSON.stringify(kitStrings(locale, t, "demo"))}
          aria-busy="true"
        >
          <p className="aicc-fbt__label">{t.demo.label}</p>
        </div>
        {after}
      </Container>
    </Section>
  );
}
