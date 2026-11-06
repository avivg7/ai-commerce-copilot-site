import { ArrowRight, CalendarCheck, Check, Rocket, Sparkles } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { txProps } from "@/i18n";
import { EA_ON, EA_OPEN, EA_EXTENDED, EA_INTAKE_CLOSES, EA_END_ISO_UTC, eaUrl } from "@/lib/earlyAccess";
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

/**
 * In an extended OPEN build new requests close at the INITIAL end (EA_INTAKE_CLOSES): the blocks that invite a request carry `data-ea-intake` (hidden once the head script sets
 * `data-ea-closed`), and their "requests are closed, the extension is for stores already in" counterparts carry `data-ea-closed-only` (hidden before it).
 * Every other build renders only the request wording and neither attribute.
 */
const INTAKE: Record<string, string> = EA_INTAKE_CLOSES ? { "data-ea-intake": "" } : {};
const CLOSED_ONLY: Record<string, string> = { "data-ea-closed-only": "" };

/** The slim bar above the header. */
export function EaBar({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  const e = t.ea.bar;
  return (
    <div className="aicc-eabar" data-ea-live role="region" aria-label={e.label} {...A(locale, "ea.bar.label")}>
      <Container>
        <p className="aicc-eabar__text">
          <Sparkles size={16} aria-hidden="true" />
          {EA_EXTENDED ? (
            <>
              <span {...INTAKE} {...A(locale, "ea.extended")}>{t.ea.extended.bar}</span>
              {EA_INTAKE_CLOSES ? <span {...CLOSED_ONLY} {...A(locale, "ea.extended")}>{t.ea.extended.barClosed}</span> : null}
            </>
          ) : (
            <span {...A(locale, "ea.bar")}>{EA_OPEN ? e.live : e.announce}</span>
          )}
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
  const note = (text: string, extra: Record<string, string>) => <p className="aicc-eanote aicc-fade-up" data-ea-live style={{ ["--i" as string]: 4 }} {...extra} {...A(locale, "ea.hero")}>{text}</p>;
  return EA_INTAKE_CLOSES ? <>{note(t.ea.hero.note, INTAKE)}{note(t.ea.hero.noteClosed, CLOSED_ONLY)}</> : note(t.ea.hero.note, {});
}

/** The Early Access button. OPEN: a link to the sign-up. ANNOUNCE: a pointer to the explanation (nothing to sign up for yet). */
export function EaCta({ locale, t, size = "lg", variant = "primary", plan }: { locale: Locale; t: Dictionary; size?: "md" | "lg"; variant?: "primary" | "secondary"; plan?: "solo" | "studio" | "agency" }) {
  if (!EA_ON) return null;
  const arrow = <ArrowRight size={18} className="aicc-flip" aria-hidden="true" />;
  return EA_OPEN ? (
    <>
      <span data-ea-live {...INTAKE} style={{ display: "contents" }}>
        <Button href={eaUrl(locale, plan)} variant={variant} size={size} icon={arrow} {...A(locale, "ea.hero")}>{t.ea.hero.ctaOpen}</Button>
      </span>
      {EA_INTAKE_CLOSES ? (
        <span data-ea-live {...CLOSED_ONLY} style={{ display: "contents" }}>
          <Button href={`${localePath(locale, "pricing")}#early-access`} variant={variant} size={size} icon={arrow} {...A(locale, "ea.hero")}>{t.ea.hero.ctaAnnounce}</Button>
        </span>
      ) : null}
    </>
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

/** The offer sentence (Home, Pricing hero line, closing bands): the request wording, plus the "already in Early Access" wording once new requests have closed (extended OPEN builds). */
export function EaLeadText({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_INTAKE_CLOSES) return <>{t.ea.section.homeLead}</>;
  return (
    <>
      <span {...INTAKE} {...A(locale, "ea.section")}>{t.ea.section.homeLead}</span>
      <span {...CLOSED_ONLY} {...A(locale, "ea.section")}>{t.ea.section.homeLeadClosed}</span>
    </>
  );
}

/** The paragraph version used by the closing bands. */
export function EaClosingLead({ locale, t }: { locale: Locale; t: Dictionary }) {
  return <p className="aicc-lead" {...A(locale, "ea.section")}><EaLeadText locale={locale} t={t} /></p>;
}

/** The short Home version of the offer, above the plan cards. */
export function EaHomeLead({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  return (
    <>
      <p className="aicc-ealead" data-ea-live {...A(locale, "ea.section")}>
        <Sparkles size={18} aria-hidden="true" />
        <span><EaLeadText locale={locale} t={t} />{" "}
          <LocaleLink locale={locale} route="pricing" hash="early-access" className="aicc-link">{t.ea.section.link}</LocaleLink>
        </span>
      </p>
      {EA_EXTENDED ? (
        <p className="aicc-ealead aicc-eaextended" data-ea-live data-ea-extended-note {...A(locale, "ea.extended")}>
          <Sparkles size={18} aria-hidden="true" />
          <span>{t.ea.extended.note}</span>
        </p>
      ) : null}
    </>
  );
}

/** The full explanation on the Pricing page: the three-step timeline, who it is for, what happens at the end, the terms and the questions. */
export function EaSection({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  const s = t.ea.section;
  const steps = [s.steps.request, s.steps.use, s.steps.decide];
  const ctx = { locale, t };
  const faq = (["free", "end", "auto", "continue", "change", "extension", "guarantee", "plugin"] as const).map((k) => ({ id: `ea-faq-${k}`, question: s.faq[k].q, answer: <p><Rich text={s.faq[k].a} ctx={ctx} /></p> }));
  const icons = [<Rocket key="r" size={20} aria-hidden="true" />, <Check key="c" size={20} aria-hidden="true" />, <CalendarCheck key="k" size={20} aria-hidden="true" />];
  return (
    <div data-ea-live data-ea-cutoff={EA_END_ISO_UTC} {...A(locale, "ea.section")}>
      <Section id="early-access" tone="surface" labelledBy="ea-title" className="aicc-easection">
        <Container>
          <div className="aicc-easection__head">
            <SectionHeading id="ea-title" title={s.title} lead={s.lead} />
            <div className="aicc-reco-figure aicc-reco-figure--small" aria-hidden="true">
              <RecoImage pose="celebrate" sizes="(min-width: 62rem) 200px, 36vw" displayWidth={160} />
            </div>
          </div>
          {EA_EXTENDED ? (
            <>
              <p className="aicc-ealead aicc-eaextended" data-ea-extended-note {...A(locale, "ea.extended")}>
                <Sparkles size={18} aria-hidden="true" />
                <span>{t.ea.extended.note}</span>
              </p>
              {EA_INTAKE_CLOSES ? (
                <p className="aicc-ealead aicc-eaextended" {...CLOSED_ONLY} {...A(locale, "ea.extended")}>
                  <Sparkles size={18} aria-hidden="true" />
                  <span>{t.ea.extended.closedNote}</span>
                </p>
              ) : null}
            </>
          ) : null}
          <ol className="aicc-eatimeline" aria-label={s.stepsLabel}>
            {steps.map((st, i) => (
              <li key={st.title}>
                <span className="aicc-eatimeline__dot" aria-hidden="true">{icons[i]}</span>
                {i === 0 && EA_INTAKE_CLOSES ? (
                  <>
                    <h3><span {...INTAKE}>{st.title}</span><span {...CLOSED_ONLY}>{s.steps.requestClosed.title}</span></h3>
                    <p><span {...INTAKE}>{st.body}</span><span {...CLOSED_ONLY}>{s.steps.requestClosed.body}</span></p>
                  </>
                ) : (
                  <>
                    <h3>{st.title}</h3>
                    <p>{st.body}</p>
                  </>
                )}
              </li>
            ))}
          </ol>
          <div className="aicc-twocol aicc-twocol--even">
            <div>
              <h3 className="aicc-eah3">{s.whoTitle}</h3>
              <ul className="aicc-lines">
                {(["a", "b", "c", "d"] as const).map((k) => (<li key={k}><Check size={20} aria-hidden="true" /><span>{k === "d" && EA_EXTENDED ? s.who.dExtended : s.who[k]}</span></li>))}
              </ul>
            </div>
            <div>
              <h3 className="aicc-eah3">{s.endTitle}</h3>
              <ul className="aicc-lines">
                {(["a", "b", "c"] as const).map((k) => (<li key={k}><Check size={20} aria-hidden="true" /><span>{s.end[k]}</span></li>))}
              </ul>
            </div>
          </div>
          <p className="aicc-muted aicc-small" style={{ marginBlockStart: "1.5rem", maxInlineSize: "52rem" }}><Rich text={s.terms} ctx={ctx} />{" "}<Rich text={s.reservation} ctx={ctx} /></p>
          <h3 className="aicc-eah3" style={{ marginBlockStart: "2rem" }}>{s.faqTitle}</h3>
          <Accordion items={faq} />
        </Container>
      </Section>
    </div>
  );
}

/** The header button while the offer is live in OPEN mode: same words and destination as the hero button (the ordinary "Get started" is shown after the end date and in every other mode). */
export function EaHeaderCta({ locale, t, className }: { locale: Locale; t: Dictionary; className: string }) {
  if (!EA_OPEN) return null;
  return (
    <>
      <a href={eaUrl(locale)} className={className} data-ea-live {...INTAKE} {...A(locale, "ea.header")}>{t.ea.header.cta}</a>
      {EA_INTAKE_CLOSES ? <a href={`${localePath(locale, "pricing")}#early-access`} className={className} data-ea-live {...CLOSED_ONLY} {...A(locale, "ea.bar")}>{t.ea.bar.link}</a> : null}
    </>
  );
}

/** One line under the Pricing headline so the offer is on the first screen, not only after the plan cards. */
export function EaPricingLine({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  return (
    <p className="aicc-ealead" data-ea-live {...A(locale, "ea.section")}>
      <Sparkles size={18} aria-hidden="true" />
      <span><EaLeadText locale={locale} t={t} />{" "}
        <LocaleLink locale={locale} route="pricing" hash="early-access" className="aicc-link">{t.ea.section.link}</LocaleLink>
      </span>
    </p>
  );
}

/** "View plans": hidden while the offer is live, shown after the end date so the ended hero still leads somewhere. */
export function EaAfterPlans({ locale, label, path }: { locale: Locale; label: string; path: string }) {
  if (!EA_ON) return null;
  return (
    <span data-ea-after style={{ display: "contents" }}>
      <Button href={localePath(locale, "pricing")} variant="secondary" size="lg" {...A(locale, path)}>{label}</Button>
    </span>
  );
}
