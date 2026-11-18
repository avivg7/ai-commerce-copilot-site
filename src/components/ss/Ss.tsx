import type { ReactNode } from "react";
import { Check, MousePointerClick } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { txProps } from "@/i18n";
import { SS_INITIAL, SS_ON, startUrl } from "@/lib/selfService";
import { EA_ON } from "@/lib/earlyAccess";
import { getStartedUrl, type PlanId } from "@/lib/site";
import { localePath } from "@/lib/routes";
import { SoonContact } from "@/components/ui/Soon";

/**
 * P37/P39 self-service presentation. Server components only (plus the client controls, imported behind the compile-time constant so a build without self-service carries none of their code).
 * Every export renders nothing unless SS_ON. Strings are `t.ea.ss.*` (src/i18n/ea/<locale>.ts); each carries its own language and direction like the launch-offer blocks.
 */
const A = (locale: Locale, path: string) => { const { lang, dir } = txProps(locale, path); return { lang, dir }; };

/** CSS of the self-service parts (inline, emitted only by a self-service build, so aicc.css and every other build stay byte-identical). Existing tokens only. */
export const SS_CSS = [
  ".aicc-plan__checks{list-style:none;padding:0;margin:0;display:grid;gap:0.375rem;font-size:var(--aicc-text-sm);color:var(--aicc-text-muted)}",
  ".aicc-plan__checks li{display:flex;align-items:center;gap:0.5rem}",
  ".aicc-plan__checks svg{flex:none;color:var(--aicc-success)}",
  // P39: the plain-text state of a control (registration opens soon / closed / paused): a status LINE, never a button: no fill, no border, no radius, no pointer; it keeps the button's height so a card does not jump when the answer arrives
  ".aicc-sstate{margin:0;display:flex;align-items:center;justify-content:flex-start;gap:0.5rem;text-align:start;min-block-size:3.5rem;font-size:var(--aicc-text-sm);font-weight:600;line-height:1.35;color:var(--aicc-success)}",
  ".aicc-sstate svg{flex:none}",
  ".aicc-sstate--inverse{color:inherit}",
  ".aicc-hero-actions .aicc-sstate{min-block-size:0;flex:1 0 100%}",
  // P39: the two labelled dates (registration closes / trial access ends): a definition list, label above value, one rule between the rows
  ".aicc-ssdates{margin:0;padding:0;display:grid;gap:0;border-block:1px solid var(--aicc-border)}",
  ".aicc-ssdates>div{display:grid;gap:0.125rem;padding-block:0.625rem}",
  ".aicc-ssdates>div+div{border-block-start:1px solid var(--aicc-border)}",
  ".aicc-ssdates dt{margin:0;font-size:var(--aicc-text-sm);font-weight:500;line-height:1.35;color:var(--aicc-text-muted)}",
  ".aicc-ssdates dd{margin:0;font-size:1rem;font-weight:700;line-height:1.35;color:var(--aicc-text);font-variant-numeric:tabular-nums}",
  ".aicc-ssdates--wide{border-block:0}",
  ".aicc-ssdates--wide>div{grid-template-columns:minmax(0,12rem) 1fr;gap:0.25rem 1rem;align-items:baseline}",
  "@media (max-width:39.99rem){.aicc-ssdates--wide>div{grid-template-columns:1fr}}",
  ".aicc-ssdates--inverse{border-color:rgb(255 255 255 / 0.28)}",
  ".aicc-ssdates--inverse>div+div{border-color:rgb(255 255 255 / 0.28)}",
  ".aicc-ssdates--inverse dt{color:var(--aicc-text-inverse-muted,rgb(255 255 255 / 0.82))}",
  ".aicc-ssdates--inverse dd{color:var(--aicc-text-inverse,#fff)}",
  ".aicc-ssdates--band{max-inline-size:28rem}",
  // the card's secondary demo link: a text link under the status line, clearly not the sign-up action
  ".aicc-plan__ssctl{display:grid;gap:0.75rem}",
  // P39 round 2 (M2): the plan grid columns may shrink below their content (an implicit `auto` column grew to the width of the big Russian word and pushed the page 42 to 110 px past a 320 px screen); the long Russian FREE word is sized to the screen on phones.
  // Self-service builds only (inline), so the CSS file and every other build stay byte-identical to S0.
  ".aicc-plans{grid-template-columns:minmax(0,1fr)}",
  "@media (min-width:62rem){.aicc-plans{grid-template-columns:repeat(3,minmax(0,1fr))}}",
  ".aicc-plan{min-inline-size:0}",
  ".aicc-plan .aicc-plan__free-word{overflow-wrap:anywhere}",
  "@media (max-width:39.99rem){html:lang(ru) .aicc-plan .aicc-plan__free-word{font-size:clamp(1.75rem,9.5vw,3rem)}}",
  ".aicc-plan__demo{margin:0;display:flex;align-items:center;gap:0.375rem;font-size:var(--aicc-text-sm)}",
  ".aicc-plan__demo svg{flex:none}",
  ".aicc-plan__demo a{display:flex;align-items:center;inline-size:fit-content;min-block-size:2.75rem}",
].join("");

/** The two labelled dates, ALWAYS two separate lines: "Registration closes <date> at 00:00 UTC" and "Trial access ends <date> at 22:00 UTC". `wide` = the long terms variant; `inverse` = on a dark band. */
export function SsDates({ locale, t, wide = false, inverse = false, band = false }: { locale: Locale; t: Dictionary; wide?: boolean; inverse?: boolean; band?: boolean }) {
  if (!SS_ON) return null;
  const s = t.ea.ss;
  const reg = wide ? s.terms.regValue : s.plan.regValue;
  const end = wide ? s.terms.endValue : s.plan.endValue;
  const cls = ["aicc-ssdates", wide ? "aicc-ssdates--wide" : "", inverse ? "aicc-ssdates--inverse" : "", band ? "aicc-ssdates--band" : ""].filter(Boolean).join(" ");
  return (
    <div role="group" aria-label={s.plan.datesLabel} {...A(locale, "ea.ss.plan")}>
      <dl className={cls} data-ss-dates>
        <div data-ss-date="registration"><dt>{s.plan.regLabel}</dt><dd>{reg}</dd></div>
        <div data-ss-date="end"><dt>{s.plan.endLabel}</dt><dd>{end}</dd></div>
      </dl>
    </div>
  );
}

const labelsOf = (t: Dictionary) => { const c = t.ea.ss.cta; return { soon: c.soon, start: c.start, waitlist: c.waitlist, closed: c.closed, paused: c.paused }; };

/**
 * The self-service control: PLAIN TEXT "Free trial registration opens soon" in the static HTML of the default build, a link to {CP}/start/?plan=<plan> in the page language when the build says `link`, and, at run time,
 * a link only when the Control Plane answers open or waitlist (see SsCta / src/lib/ssStatus.ts). Async so the client component is imported lazily behind the constant.
 */
export async function SsCtaSlot({ locale, t, plan, variant = "primary", size = "lg", block = false, srName, inverse = false }: { locale: Locale; t: Dictionary; plan?: PlanId; variant?: "primary" | "secondary" | "outline" | "ghost"; size?: "md" | "lg"; block?: boolean; srName?: string; inverse?: boolean }): Promise<ReactNode> {
  // the import sits INSIDE a branch that webpack folds away when the compile-time constant is not "1" (an early `return` would not remove the import): every other build carries no trace of the client control
  if (process.env.NEXT_PUBLIC_AICC_SS_CODE === "1" && SS_ON) {
    const { SsCta } = await import("./SsCta");
    return <SsCta href={startUrl(locale, plan)} initial={SS_INITIAL} labels={labelsOf(t)} variant={variant} size={size} block={block} srName={srName} inverse={inverse} {...A(locale, "ea.ss.cta")} />;
  }
  return null;
}

/**
 * "Get started" (header, mobile menu, Product hero): the account page (the S0 destination, a page that exists) until sign-up is KNOWN to work, then the sign-up page: a build with initial `link`, or at run time an answer of open or waitlist.
 * It is never a link to /start/ while that page may be a 404, and never the Live Demo. A plain <a> with the same classes as the button it replaces.
 */
export async function SsGetStartedSlot({ locale, className, children, icon }: { locale: Locale; className: string; children: ReactNode; icon?: ReactNode }): Promise<ReactNode> {
  if (process.env.NEXT_PUBLIC_AICC_SS_CODE === "1" && SS_ON) {
    const { SsGetStarted } = await import("./SsGetStarted");
    return <SsGetStarted startHref={startUrl(locale)} accountHref={getStartedUrl(locale)} initial={SS_INITIAL} className={className} icon={icon} {...A(locale, "common.getStarted")}>{children}</SsGetStarted>;
  }
  return null;
}

/** The terms of the free trial, said once under the plan cards (Pricing and Home): the two dates as labelled lines, then the facts. `anchor` = the target of the bar link and of the "How the free trial works" links (Pricing only: one id per page). */
export function SsTerms({ locale, t, anchor = false }: { locale: Locale; t: Dictionary; anchor?: boolean }) {
  if (!SS_ON) return null;
  const s = t.ea.ss;
  const items = [s.terms.store, s.terms.payment, s.terms.noAuto, s.terms.paid, s.terms.state];
  return (
    <div className="aicc-eaterms" {...(anchor ? { id: "free-trial" } : {})} {...(EA_ON ? { "data-ea-live": "" } : {})} data-ss-terms style={{ gridColumn: "1 / -1", marginBlockStart: "0.5rem" }} {...A(locale, "ea.ss.terms")}>
      <h3 className="aicc-eah3">{s.terms.label}</h3>
      <SsDates locale={locale} t={t} wide />
      <ul className="aicc-lines" style={{ marginBlockStart: "1rem" }}>
        {items.map((x) => (<li key={x}><Check size={20} aria-hidden="true" /><span>{x}</span></li>))}
      </ul>
    </div>
  );
}

/** The closing band's lead sentence, the two labelled dates and the self-service action: used on Home, Pricing and Product while self-service is on. `children` are the extra actions (See Pricing, Live Demo). */
export function SsBand({ locale, t, children, contact = false }: { locale: Locale; t: Dictionary; children?: ReactNode; contact?: boolean }) {
  if (!SS_ON) return null;
  return (
    // P39 round 2: a launch-offer build hides the band after the trial end instant (data-ea-live) and shows the ordinary band instead (data-ea-after, rendered by the page); `contact` = "Questions in the meantime? Write to ..." (Product bands, as in S0)
    <div className="aicc-stack aicc-stack--lg" data-ss-band {...(EA_ON ? { "data-ea-live": "" } : {})}>
      <p className="aicc-lead" {...A(locale, "ea.ss.band")}>{t.ea.ss.band.lead}</p>
      <SsDates locale={locale} t={t} inverse band />
      <div className="aicc-hero-actions">
        <SsCtaSlot locale={locale} t={t} variant="primary" size="lg" inverse />
        {children}
      </div>
      {contact ? <SoonContact locale={locale} t={t} inverse /> : null}
    </div>
  );
}

/** The card's SECONDARY "Try Live Demo" link (the interactive demo on Home): a plain text link, never the sign-up action. */
export function SsDemoLink({ locale, label, planName }: { locale: Locale; label: string; planName: string }) {
  return (
    <p className="aicc-plan__demo" data-ss-demo>
      <a className="aicc-link" href={`${localePath(locale)}#demo`}>{label}<span className="aicc-sr-only"> ({planName})</span></a>
      <MousePointerClick size={14} aria-hidden="true" />
    </p>
  );
}

/** The "Which plan?" finder of a self-service build (the ordinary finder shows an inert "Purchases open soon" chip). Renders nothing unless self-service is on. */
export async function SsPlanFinderSlot({ locale, t, s, lang, dir }: { locale: Locale; t: Dictionary; s: import("./SsPlanFinder").SsPlanFinderStrings; lang?: string; dir?: "ltr" | "rtl" }): Promise<ReactNode> {
  if (process.env.NEXT_PUBLIC_AICC_SS_CODE === "1" && SS_ON) {
    const { SsPlanFinder } = await import("./SsPlanFinder");
    const ss = t.ea.ss;
    const a = A(locale, "ea.ss.plan");
    return (
      <SsPlanFinder
        s={s}
        lang={lang}
        dir={dir}
        initial={SS_INITIAL}
        hrefs={{ solo: startUrl(locale, "solo"), studio: startUrl(locale, "studio"), agency: startUrl(locale, "agency") }}
        labels={labelsOf(t)}
        facts={{ trial: ss.plan.trial, noPayment: ss.plan.noPayment, noAuto: ss.plan.noAuto, datesLabel: ss.plan.datesLabel, regLabel: ss.plan.regLabel, regValue: ss.plan.regValue, endLabel: ss.plan.endLabel, endValue: ss.plan.endValue, lang: a.lang, dir: a.dir }}
      />
    );
  }
  return null;
}
