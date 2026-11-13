import { Fragment } from "react";
import { ArrowRight, CalendarCheck, Check, Rocket, Sparkles } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { txProps } from "@/i18n";
import { EA_ON, EA_OPEN, EA_EXTENDED, EA_EXTENSION_STEP, EA_INTAKE_CLOSES, EA_END_ISO_UTC, EA_LIMITED, eaUrl } from "@/lib/earlyAccess";
import { EA_DATES, nbDate } from "@/i18n/eaTokens";
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

/**
 * The launch Hero keeps the final P24 look (review fix): only the badge line and the two action labels change. The P21 "compact Early Access hero" rules in aicc.css were written for a hero with a
 * fine-print line and a 3rem headline; they are undone for the HOME hero here (a few lines of inline CSS, emitted by a campaign build only, so aicc.css and every ordinary page stay byte-identical),
 * by restating the ordinary P24 values with a more specific selector: padding (less the header height the bar already clears), headline size per breakpoint and language (4.25rem desktop,
 * 3.25rem on laptop heights, 4rem Russian), spacing of headline, subtitle and actions, and the 100svh behaviour on laptop-height screens.
 */
const H = "html[data-ea-mode]:not([data-ea-over]) .aicc-hero--home";
export const EA_HERO_CSS = [
  `@media (max-width:39.99rem){${H}.aicc-hero{padding-block-start:calc(5.75rem - var(--aicc-header-h))}}`,
  `@media (min-width:40rem){${H}.aicc-hero{padding-block:calc(8.25rem - var(--aicc-header-h)) 3.75rem}${H} .aicc-hero-title{margin-block-start:1rem;font-size:3rem}${H} .aicc-hero-lead{margin-block-start:1rem}${H} .aicc-hero-actions{margin-block-start:1.75rem}}`,
  `@media (min-width:48rem){${H} .aicc-hero-title{font-size:3.75rem}}`,
  `@media (min-width:64rem){${H} .aicc-hero-title{font-size:min(4.25rem,calc((100vw - 7.5rem)/16))}html[data-ea-mode]:not([data-ea-over]):lang(ru) .aicc-hero--home .aicc-hero-title{font-size:min(4rem,calc((100vw - 7.5rem)/18.5))}}`,
  `@media (min-width:64rem) and (max-height:47.5rem){${H} .aicc-hero-title,html[data-ea-mode]:not([data-ea-over]):lang(ru) .aicc-hero--home .aicc-hero-title{font-size:3.25rem}}`,
  `@media (min-width:64rem) and (max-height:50rem){${H}.aicc-hero{min-block-size:100svh;display:flex;align-items:center}${H} .aicc-hero__grid{inline-size:100%}}`,
].join("");

/**
 * P34 (owner request): the two-part Hero pill, the short support lines under the Hero buttons and under the plan cards, and the launch-offer label on each card. Inline CSS emitted by a
 * campaign build only (like EA_HERO_CSS), so aicc.css and every ordinary page stay byte-identical. Colours are existing tokens: the tag is white on --aicc-success (emerald-700, 5.48:1),
 * the support lines are --aicc-text-muted (slate-600) with --aicc-success icons, the card label is the success badge (emerald-700 on emerald-50, 5.21:1).
 */
export const EA_P34_CSS = [
  ".aicc-eabadge{display:inline}",
  ".aicc-eabadge__tag{display:inline-block;padding:0.125rem 0.5rem;margin-inline:-0.625rem 0.125rem;margin-block:0.125rem;border-radius:9999px;background:var(--aicc-success);color:var(--aicc-white);font-weight:700}",
  ".aicc-easupport{list-style:none;padding:0;margin:1rem 0 0;display:flex;flex-wrap:wrap;gap:0.375rem 1.25rem;font-size:var(--aicc-text-sm);line-height:1.35;font-weight:500;color:var(--aicc-text-muted)}",
  ".aicc-easupport li{display:inline-flex;align-items:center;gap:0.375rem}",
  ".aicc-easupport svg{flex:none;color:var(--aicc-success)}",
  ".aicc-easupport__chip{padding:0.0625rem 0.5rem;border:1px solid var(--aicc-border);border-radius:9999px;background:var(--aicc-surface)}",
  ".aicc-easupport--plans{margin-block-start:1.5rem}",
  // P35 (review L3): the inert "requests open soon" status must not look like a button: dashed outline, pill shape, regular weight, no fill (still a <p>, no role)
  ".aicc-btn--soon.aicc-eastatus[data-ea-soon]{border-style:dashed;border-radius:9999px;background:transparent;font-weight:500;box-shadow:none;white-space:normal;text-align:center;line-height:1.25;block-size:auto;min-block-size:3.5rem;padding-block:0.25rem}",
  ".aicc-plans>.aicc-easupport{grid-column:1/-1;margin-block-start:0.25rem}",
  "@media (max-width:39.99rem){.aicc-easupport{gap:0.375rem 1rem;margin-block-start:0.875rem}}",
  ".aicc-plan__badgerow{gap:0.5rem;flex-wrap:wrap}",
  ".aicc-plan__regular--strike .aicc-plan__regular-label{display:block;font-size:var(--aicc-text-sm);line-height:1.35}",
  ".aicc-plan__regular--strike s{font-size:1.5rem}",
  "@media (forced-colors:active){.aicc-eabadge__tag{border:1px solid CanvasText}}",
].join("");

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
              <span {...INTAKE} {...A(locale, "ea.extended")}>{EA_OPEN ? t.ea.extended.bar : t.ea.extended.barAnnounce}</span>
              {EA_INTAKE_CLOSES ? <span {...CLOSED_ONLY} {...A(locale, "ea.extended")}>{t.ea.extended.barClosed}</span> : null}
            </>
          ) : (
            <span {...A(locale, "ea.bar")}>{EA_OPEN ? e.live : e.announce}</span>
          )}
          {/* in the closed phase the header button and the hero action already lead to the same place: one tab stop fewer */}
          <span {...INTAKE} style={{ display: "contents" }}>
            <LocaleLink locale={locale} route="pricing" hash="early-access" className="aicc-eabar__link">
              <span {...A(locale, "ea.bar")}>{e.link}</span>
            </LocaleLink>
          </span>
        </p>
      </Container>
    </div>
  );
}

/**
 * P34 (owner request, replacing the P32 "no fine print under the buttons" decision): three short lines under the Hero buttons, never a paragraph. "Limited availability" only with
 * NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on (EA_LIMITED; launch:check needs the owner's attestation). Hidden with the rest of the offer after the end date.
 */
export function EaHeroSupport({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  const s = t.ea.hero.support;
  return (
    <ul className="aicc-easupport aicc-fade-up" style={{ ["--i" as string]: 4 }} data-ea-live data-ea-support="hero" {...(EA_LIMITED ? { "data-ea-limited": "" } : {})} aria-label={t.ea.hero.supportLabel} {...A(locale, "ea.hero")}>
      {[s.noCard, s.manual].map((x) => (<li key={x}><Check size={16} aria-hidden="true" /><span>{x}</span></li>))}
      {/* review P34-5: a plain text chip, no check icon (it is a condition of the offer, not a benefit); OPEN builds only */}
      {EA_LIMITED ? <li className="aicc-easupport__chip"><span>{s.limited}</span></li> : null}
    </ul>
  );
}

/** P34 (owner list): the three short lines right under the plan cards (Home and Pricing), while the offer is live. */
export function EaPlanSupport({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  const s = t.ea.pricing.support;
  return (
    <ul className="aicc-easupport aicc-easupport--plans" data-ea-live data-ea-support="plans" aria-label={t.ea.hero.supportLabel} {...A(locale, "ea.pricing")}>
      {[s.noCard, s.manual, s.regular].map((x) => (<li key={x}><Check size={16} aria-hidden="true" /><span>{x}</span></li>))}
    </ul>
  );
}

/** The badge text with the date made no-break (the dates of the build's step, in the language the string is written in). */
function nbBadge(text: string, locale: Locale): string {
  const d = EA_DATES[locale][EA_EXTENSION_STEP];
  return text.split(d.lastDay).join(nbDate(d.lastDay));
}

/** The hero badge (the pill above the headline): [Launch offer] Free until <last day> while the offer is live (P34: a tag plus the date line); the ordinary "Available for WooCommerce" returns after the end date. */
export function EaHeroBadge({ locale, t, ordinary }: { locale: Locale; t: Dictionary; ordinary: string }) {
  if (!EA_ON) return <>{ordinary}</>;
  return (
    <>
      {/* the date inside the badge is set with no-break spaces: it never wraps in the middle at 390 px */}
      <span className="aicc-eabadge" data-ea-live {...A(locale, "ea.hero")}>
        <span className="aicc-eabadge__tag">{EA_OPEN ? t.ea.hero.badgeTag : t.ea.hero.badgeTagAnnounce}</span>{" "}
        <span className="aicc-eabadge__text">{nbBadge(t.ea.hero.badge, locale)}</span>
      </span>
      <span data-ea-after {...A(locale, "home.hero")}>{ordinary}</span>
    </>
  );
}

/**
 * The request button. OPEN: a link to /request-access/ (this site). ANNOUNCE: a NON-CLICKABLE status ("Free access requests open soon"): no link, nothing to click, so no
 * page can be read as saying that requests are open. In the closed phase of an extended OPEN build the status says that new requests are closed.
 */
export function EaCta({ locale, t, size = "lg", variant = "primary", plan }: { locale: Locale; t: Dictionary; size?: "md" | "lg"; variant?: "primary" | "secondary"; plan?: "solo" | "studio" | "agency" }) {
  if (!EA_ON) return null;
  const arrow = <ArrowRight size={18} className="aicc-flip" aria-hidden="true" />;
  const status = (text: string, extra: Record<string, string> = {}) => (
    <span data-ea-live {...extra} style={{ display: "contents" }}>
      <p className={`aicc-btn aicc-btn--${size} aicc-btn--soon aicc-eastatus`} data-ea-soon {...A(locale, "ea.hero")}>{text}</p>
    </span>
  );
  return EA_OPEN ? (
    <>
      <span data-ea-live {...INTAKE} style={{ display: "contents" }}>
        <Button href={eaUrl(locale, plan)} variant={variant} size={size} icon={arrow} {...A(locale, "ea.hero")}>{t.ea.hero.ctaOpen}</Button>
      </span>
      {EA_INTAKE_CLOSES ? status(t.ea.plan.ctaClosed, CLOSED_ONLY) : null}
    </>
  ) : status(t.ea.hero.ctaAnnounce);
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
  // OPEN builds say when requests stop (the Control Plane grants nothing in the final 24 hours): next to the offer, not only in the list below
  // an ANNOUNCE build says the offer is coming (never present tense: nothing can be requested yet)
  if (!EA_INTAKE_CLOSES) return <>{EA_OPEN ? `${t.ea.section.homeLead} ${t.ea.section.intakeCutoff}` : t.ea.section.homeLeadAnnounce}</>;
  return (
    <>
      <span {...INTAKE} {...A(locale, "ea.section")}>{t.ea.section.homeLead} {t.ea.section.intakeCutoffExt}</span>
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
          <span>{EA_OPEN ? t.ea.extended.note : t.ea.extended.noteAnnounce}</span>
        </p>
      ) : null}
    </>
  );
}

/** The full explanation on the Pricing page: the three-step timeline, who it is for, what happens at the end, the terms and the questions. */
export function EaSection({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  const s = t.ea.section;
  const steps = EA_OPEN ? [s.steps.request, s.steps.use, s.steps.decide] : [s.steps.requestAnnounce, s.steps.useAnnounce, s.steps.decide];
  const ctx = { locale, t };
  const faq = (["free", "eligible", "end", "auto", "continue", "change", "extension", "guarantee", "plugin"] as const).map((k) => ({ id: `ea-faq-${k}`, question: s.faq[k].q, answer: <p><Rich text={k === "free" && !EA_OPEN ? s.faq.free.aAnnounce : s.faq[k].a} ctx={ctx} /></p> }));
  const icons = [<Rocket key="r" size={20} aria-hidden="true" />, <Check key="c" size={20} aria-hidden="true" />, <CalendarCheck key="k" size={20} aria-hidden="true" />];
  return (
    <div data-ea-live data-ea-cutoff={EA_END_ISO_UTC} {...A(locale, "ea.section")}>
      <Section id="early-access" tone="surface" labelledBy="ea-title" className="aicc-easection">
        <Container>
          <div className="aicc-easection__head">
            <SectionHeading id="ea-title" title={s.title} lead={EA_OPEN ? s.lead : s.leadAnnounce} />
            <div className="aicc-reco-figure aicc-reco-figure--small" aria-hidden="true">
              <RecoImage pose="celebrate" sizes="(min-width: 62rem) 200px, 36vw" displayWidth={160} />
            </div>
          </div>
          {EA_EXTENDED ? (
            <>
              <p className="aicc-ealead aicc-eaextended" data-ea-extended-note {...A(locale, "ea.extended")}>
                <Sparkles size={18} aria-hidden="true" />
                <span>{EA_OPEN ? t.ea.extended.note : t.ea.extended.noteAnnounce}</span>
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
                {(["a", "b", "c", "d"] as const).map((k) => {
                  const text = k === "d" && EA_EXTENDED ? s.who.dExtended : s.who[k];
                  // closed phase (extended OPEN build): the eligibility line and the "ask for the plan you would want" / "we review each request" lines invite a request, so they give way to their closed wording
                  if (!EA_INTAKE_CLOSES || k === "b") return <li key={k}><Check size={20} aria-hidden="true" /><span>{text}</span></li>;
                  return (
                    <Fragment key={k}>
                      <li {...INTAKE}><Check size={20} aria-hidden="true" /><span>{text}</span></li>
                      {k === "c" ? <li {...CLOSED_ONLY}><Check size={20} aria-hidden="true" /><span>{s.who.cClosed}</span></li> : null}
                      {k === "d" ? <li {...CLOSED_ONLY}><Check size={20} aria-hidden="true" /><span>{s.who.dClosed}</span></li> : null}
                    </Fragment>
                  );
                })}
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
          {/* P35: the data-use notice belongs to the moment requests can be made (OPEN), as on the Control Plane page; an announce build collects nothing and carries no privacy text */}
          {EA_OPEN ? (
            <p className="aicc-muted aicc-small" data-ea-notice {...INTAKE} style={{ marginBlockStart: "0.75rem", maxInlineSize: "52rem" }} {...A(locale, "ea.section")}><Rich text={s.notice} ctx={ctx} /></p>
          ) : null}
          <h3 className="aicc-eah3" style={{ marginBlockStart: "2rem" }}>{s.faqTitle}</h3>
          <Accordion items={faq} />
        </Container>
      </Section>
    </div>
  );
}

/** The header button while the offer is live in OPEN mode: same words and destination as the hero button (the ordinary "Get started" is shown after the end date and in every other mode). */
export function EaHeaderCta({ locale, t, className, hidden = false }: { locale: Locale; t: Dictionary; className: string; hidden?: boolean }) {
  // `hidden`: the request pages themselves do not repeat the request button in the header (the visitor is already on the form)
  if (!EA_OPEN || hidden) return null;
  return (
    <>
      <a href={eaUrl(locale)} className={className} style={{ whiteSpace: "nowrap", paddingInline: "0.875rem" }} data-ea-live {...INTAKE} {...A(locale, "ea.header")}>{t.ea.header.cta}</a>
      {EA_INTAKE_CLOSES ? <a href={`${localePath(locale, "pricing")}#early-access`} className={className} style={{ whiteSpace: "nowrap", paddingInline: "0.875rem" }} data-ea-live {...CLOSED_ONLY} {...A(locale, "ea.bar")}>{t.ea.bar.link}</a> : null}
    </>
  );
}

/**
 * The launch-offer terms every plan shares, said once under the plan cards on Pricing (P32, owner list; approved stores, no card and no automatic renewal are on each card): an explicit renewal
 * decision after the end, paid purchases not open. No promise of a paid continuation in 2027 and no percentage, saving or countdown wording exists in this block or anywhere in the campaign copy.
 */
export function EaPlanTerms({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!EA_ON) return null;
  const e = t.ea;
  // approved stores, no card and no automatic renewal are already on every card; this block carries the two statements that apply to all plans at once
  const items = [e.pricing.decision, e.pricing.notOpen];
  return (
    <div className="aicc-eaterms" data-ea-live data-ea-terms style={{ gridColumn: "1 / -1", marginBlockStart: "0.5rem" }} {...A(locale, "ea.pricing")}>
      <h3 className="aicc-eah3">{e.pricing.label}</h3>
      <ul className="aicc-lines">
        {items.map((x) => (<li key={x}><Check size={20} aria-hidden="true" /><span>{x}</span></li>))}
      </ul>
    </div>
  );
}

/** The sentence under the plan cards: while the offer is live it says what is true then (paid purchases are not open, accounts are created for approved requests); the ordinary sentence returns after the end date. */
export function EaPricingNote({ locale, t, ordinary }: { locale: Locale; t: Dictionary; ordinary: string }) {
  if (!EA_ON) return <>{ordinary}</>;
  return (
    <>
      <span data-ea-live {...A(locale, "ea.pricing")}>{t.ea.pricing.note}</span>
      <span data-ea-after>{ordinary}</span>
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
