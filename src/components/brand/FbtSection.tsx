import type { Locale } from "@/i18n/config";
import { LOCALE_META } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { Container, Section, SectionHeading } from "@/components/ui/Primitives";

/**
 * "Frequently-bought-together, actually learned." The heading and lead are page content; the interactive demo is rendered by the kit
 * (brand/js/fbt-demo.js) into the container below when it nears the viewport. The container carries its strings, so the
 * kit needs no global state.
 */
export function FbtSection({ locale, t, tone = "sunken" }: { locale: Locale; t: Dictionary; tone?: "sunken" | "surface" }) {
  return (
    <Section id="demo" tone={tone} labelledBy="demo-title" className="aicc-fbt-section">
      <Container>
        <SectionHeading id="demo-title" title={t.home.demo.title} lead={t.home.demo.lead} />
        <div
          className="aicc-fbt aicc-fbt--placeholder"
          data-aicc-fbt
          data-locale={locale}
          data-dir={LOCALE_META[locale].dir}
          data-strings={JSON.stringify(t.demo)}
          aria-busy="true"
        >
          <p className="aicc-fbt__label">{t.demo.label}</p>
        </div>
      </Container>
    </Section>
  );
}
