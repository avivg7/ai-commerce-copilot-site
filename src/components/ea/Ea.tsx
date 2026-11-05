import { ArrowRight, CalendarCheck, Check, Rocket, Sparkles } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { txProps } from "@/i18n";
import { EA_ON, EA_OPEN, EA_CUTOFF_ISO_UTC, eaUrl } from "@/lib/earlyAccess";
import { localePath } from "@/lib/routes";
import { Button } from "@/components/ui/Button";
import { Container, Section, SectionHeading } from "@/components/ui/Primitives";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { RecoImage } from "@/components/ui/RecoImage";
import { Accordion } from "@/components/ui/Accordion";
import { Rich } from "@/lib/rich";

/**
 * Early Access presentation (Production 20). Every export renders nothing in a normal build (EA_ON false).
 * `data-ea-live` blocks disappear and `data-ea-after` blocks appear when the page script marks the document after the end date (src/lib/earlyAccess.ts).
 * Each string is wrapped with its own language and direction (txProps), because a block can sit inside an English fallback section of a translated page.
 */
const A = (locale: Locale, path: string) => { const { lang, dir } = txProps(locale, path); return { lang, dir }; };

/** The slim bar above the header. */
export function EaBar({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  const e = t.ea.bar;
  return (
    <div className="aicc-eabar" data-ea-live role="region" aria-label={e.label} {...A(locale, "ea.bar.label")}>
      <Container>
        <p className="aicc-eabar__text">
          <Sparkles size={16} aria-hidden="true" />
          <span {...A(locale, "ea.bar")}>{EA_OPEN ? e.live : e.announce}</span>
          <LocaleLink locale={locale} route="pricing" hash="early-access" className="aicc-eabar__link">
            <span {...A(locale, "ea.bar")}>{e.link}</span>
          </LocaleLink>
        </p>
      </Container>
    </div>
  );
}

/** The honest fine print under the hero buttons. */
export function EaHeroNote({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  return <p className="aicc-eanote aicc-fade-up" data-ea-live style={{ ["--i" as string]: 4 }} {...A(locale, "ea.hero")}>{t.ea.hero.note}</p>;
}

/** The Early Access button. OPEN: a link to the sign-up. ANNOUNCE: a pointer to the explanation (nothing to sign up for yet). */
export function EaCta({ locale, t, size = "lg", variant = "primary", plan }: { locale: Locale; t: Dictionary; size?: "md" | "lg"; variant?: "primary" | "secondary"; plan?: "solo" | "studio" | "agency" }) {
  if (!EA_ON) return null;
  const arrow = <ArrowRight size={18} className="aicc-flip" aria-hidden="true" />;
  return EA_OPEN ? (
    <span data-ea-live style={{ display: "contents" }}>
      <Button href={eaUrl(locale, plan)} variant={variant} size={size} icon={arrow} {...A(locale, "ea.hero")}>{t.ea.hero.ctaOpen}</Button>
    </span>
  ) : (
    <span data-ea-live style={{ display: "contents" }}>
      <Button href={`${localePath(locale, "pricing")}#early-access`} variant={variant} size={size} icon={arrow} {...A(locale, "ea.hero")}>{t.ea.hero.ctaAnnounce}</Button>
    </span>
  );
}

/** What replaces the offer once the end date has passed. Hidden until the page script marks the document. */
export function EaAfterNote({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  return (
    <div className="aicc-eaafter" data-ea-after role="status" {...A(locale, "ea.after")}>
      <Container>
        <p><strong>{t.ea.after.title}</strong> {t.ea.after.body}{" "}
          <LocaleLink locale={locale} route="pricing" className="aicc-link">{t.ea.after.cta}</LocaleLink>
        </p>
      </Container>
    </div>
  );
}

/** The short Home version of the offer, above the plan cards. */
export function EaHomeLead({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  return (
    <p className="aicc-ealead" data-ea-live {...A(locale, "ea.section")}>
      <Sparkles size={18} aria-hidden="true" />
      <span>{t.ea.section.homeLead}{" "}
        <LocaleLink locale={locale} route="pricing" hash="early-access" className="aicc-link">{t.ea.section.link}</LocaleLink>
      </span>
    </p>
  );
}

/** The full explanation on the Pricing page: the three-step timeline, who it is for, what happens at the end, the terms and the questions. */
export function EaSection({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  const s = t.ea.section;
  const steps = [s.steps.request, s.steps.use, s.steps.decide];
  const faq = (["free", "end", "auto", "continue"] as const).map((k) => ({ id: `ea-faq-${k}`, question: s.faq[k].q, answer: <p>{s.faq[k].a}</p> }));
  const icons = [<Rocket key="r" size={20} aria-hidden="true" />, <Check key="c" size={20} aria-hidden="true" />, <CalendarCheck key="k" size={20} aria-hidden="true" />];
  return (
    <div data-ea-live data-ea-cutoff={EA_CUTOFF_ISO_UTC} {...A(locale, "ea.section")}>
      <Section id="early-access" tone="surface" labelledBy="ea-title" className="aicc-easection">
        <Container>
          <div className="aicc-easection__head">
            <SectionHeading id="ea-title" title={s.title} lead={s.lead} />
            <div className="aicc-reco-figure aicc-reco-figure--small" aria-hidden="true">
              <RecoImage pose="celebrate" sizes="(min-width: 62rem) 200px, 36vw" displayWidth={160} />
            </div>
          </div>
          <ol className="aicc-eatimeline" aria-label={s.stepsLabel}>
            {steps.map((st, i) => (
              <li key={st.title}>
                <span className="aicc-eatimeline__dot" aria-hidden="true">{icons[i]}</span>
                <h3>{st.title}</h3>
                <p>{st.body}</p>
              </li>
            ))}
          </ol>
          <div className="aicc-twocol aicc-twocol--even">
            <div>
              <h3 className="aicc-eah3">{s.whoTitle}</h3>
              <ul className="aicc-lines">
                {(["a", "b", "c", "d"] as const).map((k) => (<li key={k}><Check size={20} aria-hidden="true" /><span>{s.who[k]}</span></li>))}
              </ul>
            </div>
            <div>
              <h3 className="aicc-eah3">{s.endTitle}</h3>
              <ul className="aicc-lines">
                {(["a", "b", "c"] as const).map((k) => (<li key={k}><Check size={20} aria-hidden="true" /><span>{s.end[k]}</span></li>))}
              </ul>
            </div>
          </div>
          <p className="aicc-muted aicc-small" style={{ marginBlockStart: "1.5rem", maxInlineSize: "52rem" }}><Rich text={s.terms} ctx={{ locale, t }} /></p>
          <h3 className="aicc-eah3" style={{ marginBlockStart: "2rem" }}>{s.faqTitle}</h3>
          <Accordion items={faq} />
        </Container>
      </Section>
    </div>
  );
}
