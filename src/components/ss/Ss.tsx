import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { txProps } from "@/i18n";
import { SS_ON, startUrl } from "@/lib/selfService";
import type { PlanId } from "@/lib/site";

/**
 * P37 self-service presentation. Server components only (plus the client button, imported behind the compile-time constant so a build without self-service carries none of its code).
 * Every export renders nothing unless SS_ON. Strings are `t.ea.ss.*` (src/i18n/ea/<locale>.ts); each carries its own language and direction like the launch-offer blocks.
 */
const A = (locale: Locale, path: string) => { const { lang, dir } = txProps(locale, path); return { lang, dir }; };

/** CSS of the self-service parts (inline, emitted only by a self-service build, so aicc.css and every other build stay byte-identical). Existing tokens only. */
export const SS_CSS = [
  ".aicc-plan__checks{list-style:none;padding:0;margin:0;display:grid;gap:0.375rem;font-size:var(--aicc-text-sm);color:var(--aicc-text-muted)}",
  ".aicc-plan__checks li{display:flex;align-items:center;gap:0.5rem}",
  ".aicc-plan__checks svg{flex:none;color:var(--aicc-success)}",
  // the plain-text states keep the button's height so a card does not jump when the status answer arrives
  ".aicc-sstate{margin:0;display:flex;align-items:center;justify-content:center;text-align:center;min-block-size:3.5rem;padding-inline:0.75rem;font-size:var(--aicc-text-sm);font-weight:600;color:var(--aicc-success)}",
  ".aicc-sstate--inverse{color:inherit;justify-content:flex-start;text-align:start;padding-inline:0}",
  ".aicc-hero-actions .aicc-sstate{min-block-size:0}",
].join("");

/** The self-service button: a link to {CP}/start/?plan=<plan> in the page language, state-aware at run time (see SsCta). Async so the client component is imported lazily behind the constant. */
export async function SsCtaSlot({ locale, t, plan, variant = "primary", size = "lg", block = false, srName, inverse = false }: { locale: Locale; t: Dictionary; plan?: PlanId; variant?: "primary" | "secondary" | "outline" | "ghost"; size?: "md" | "lg"; block?: boolean; srName?: string; inverse?: boolean }): Promise<ReactNode> {
  // the import sits INSIDE a branch that webpack folds away when the compile-time constant is not "1" (an early `return` would not remove the import): every other build carries no trace of the client button
  if (process.env.NEXT_PUBLIC_AICC_SS_CODE === "1" && SS_ON) {
    const { SsCta } = await import("./SsCta");
    const c = t.ea.ss.cta;
    return <SsCta href={startUrl(locale, plan)} labels={{ start: c.start, waitlist: c.waitlist, closed: c.closed, paused: c.paused, notOpen: c.notOpen }} variant={variant} size={size} block={block} srName={srName} inverse={inverse} {...A(locale, "ea.ss.cta")} />;
  }
  return null;
}

/** The terms of the free trial, said once under the plan cards (Pricing). id="free-trial" is the target of the bar link and of the "How the free trial works" links. */
export function SsTerms({ locale, t }: { locale: Locale; t: Dictionary }) {
  if (!SS_ON) return null;
  const s = t.ea.ss;
  const items = [s.terms.store, s.terms.payment, s.terms.paid, s.terms.state];
  return (
    <div className="aicc-eaterms" id="free-trial" data-ea-live data-ss-terms style={{ gridColumn: "1 / -1", marginBlockStart: "0.5rem" }} {...A(locale, "ea.ss.terms")}>
      <h3 className="aicc-eah3">{s.terms.label}</h3>
      <ul className="aicc-lines">
        {items.map((x) => (<li key={x}><Check size={20} aria-hidden="true" /><span>{x}</span></li>))}
      </ul>
    </div>
  );
}

/** The closing band's lead sentence and the self-service action(s): used on Home, Pricing and Product while self-service is on. `children` are the extra actions (See Pricing, Live Demo). */
export function SsBand({ locale, t, children }: { locale: Locale; t: Dictionary; children?: ReactNode }) {
  if (!SS_ON) return null;
  return (
    <div className="aicc-stack aicc-stack--lg" data-ss-band>
      <p className="aicc-lead" {...A(locale, "ea.ss.band")}>{t.ea.ss.band.lead}</p>
      <div className="aicc-hero-actions">
        <SsCtaSlot locale={locale} t={t} variant="primary" size="lg" inverse />
        {children}
      </div>
    </div>
  );
}

/** The "Which plan?" finder of a self-service build (the ordinary finder shows an inert "Purchases open soon" chip). Renders nothing unless self-service is on. */
export async function SsPlanFinderSlot({ locale, t, s, lang, dir }: { locale: Locale; t: Dictionary; s: import("./SsPlanFinder").SsPlanFinderStrings; lang?: string; dir?: "ltr" | "rtl" }): Promise<ReactNode> {
  if (process.env.NEXT_PUBLIC_AICC_SS_CODE === "1" && SS_ON) {
    const { SsPlanFinder } = await import("./SsPlanFinder");
    const c = t.ea.ss.cta;
    return <SsPlanFinder s={s} lang={lang} dir={dir} hrefs={{ solo: startUrl(locale, "solo"), studio: startUrl(locale, "studio"), agency: startUrl(locale, "agency") }} labels={{ start: c.start, waitlist: c.waitlist, closed: c.closed, paused: c.paused, notOpen: c.notOpen }} />;
  }
  return null;
}
