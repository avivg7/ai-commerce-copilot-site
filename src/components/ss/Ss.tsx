import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { txProps } from "@/i18n";
import { SS_INITIAL, SS_ON, startUrl } from "@/lib/selfService";
import { EA_ON } from "@/lib/earlyAccess";
import { getStartedUrl, type PlanId } from "@/lib/site";
import { planById } from "@/data/plans";
import { COMMERCE_OPEN } from "@/lib/site";
import { paidCapacity } from "@/lib/ssCapacity";
import { SoonContact } from "@/components/ui/Soon";

/**
 * P37/P39 self-service presentation. Server components only (plus the client controls, imported behind the compile-time constant so a build without self-service carries none of their code).
 * Every export renders nothing unless SS_ON. Strings are `t.ea.ss.*` (src/i18n/ea/<locale>.ts); each carries its own language and direction like the launch-offer blocks.
 */
const A = (locale: Locale, path: string) => { const { lang, dir } = txProps(locale, path); return { lang, dir }; };

/**
 * CSS of the self-service parts that the shared brand kit does NOT cover (inline, emitted only by a self-service build, so aicc.css and every other build stay byte-identical). Existing tokens only.
 * P40: the plan cards, the control, the launch panel and the closing band are the kit's `.aicc-pricing` section (brand/aicc-brand.css, one class contract with the Control Plane); what stays here is the
 * Site-only part: the invisible reserve that keeps a link as tall as the status region it replaces, and the plan finder's result.
 */
export const SS_CSS = [
  // the link states keep the height of the status region's note (the note is rendered invisibly from the same text): the status answer arriving shifts nothing. (The pill and the link share one box height in the kit.)
  ".aicc-ss-reserve{display:block;margin-block-start:-0.125rem;font-size:0.875rem;line-height:1.4;text-align:center;text-wrap:pretty;visibility:hidden;pointer-events:none;user-select:none}",
  ".aicc-ss-reserve::before{content:attr(data-reserve)}",
  ".aicc-pcta--inverse .aicc-ss-reserve{text-align:start}",
  // the band's wrapper (kit resets apply) keeps the dark band's own text colour
  ".aicc-pricing.aicc-pricing--band{color:inherit}",
  // the two card sets: live (FREE + trial) while registration can start, closed / ordinary (the price leads, no FREE, no trial line) once it cannot (html[data-ss-closed]) and after the trial end (html[data-ea-over]); the launch panel is not shown when closed
  "html:not([data-ss-closed]):not([data-ea-over]) .aicc-pricing [data-ss-set=\"closed\"]{display:none}",
  "html[data-ss-closed] .aicc-pricing [data-ss-set=\"live\"],html[data-ss-closed] .aicc-pricing .aicc-launch{display:none}",
  // the announcement bar says the trial: from the cutoff it stays in place (the hero keeps its spacing) but is hidden from sight and from the focus order
  "html[data-ss-closed] .aicc-eabar{visibility:hidden}",
  // the page's own `.aicc-final` grid had an implicit auto column: a band action that cannot shrink pushed it past a 320 px screen at 200% text
  ".aicc-final{grid-template-columns:minmax(0,1fr)}",
  // the finder's result: the plan, its paid capacity, then the control (the same region as a card)
  ".aicc-ssfinder__result{display:grid;gap:0.75rem;justify-items:start;inline-size:100%}",
  ".aicc-ssfinder__cap{margin:0;font-size:var(--aicc-text-sm);font-weight:650;line-height:1.35;color:var(--aicc-text)}",
  ".aicc-ssfinder__result .aicc-pcta{inline-size:min(100%,22rem)}",
].join("");

const labelsOf = (t: Dictionary) => { const c = t.ea.ss.cta; return { soon: c.soon, start: c.start, waitlist: c.waitlist, closed: c.closed, paused: c.paused }; };
/** The explanation line of each status (and of the waitlist link): the per-state notes of the pack. */
// the closed note says paid plans are not open for purchase: when the build has commerce open it says only that registration has closed (closedPaidNote), like the launch panel footnote (foot.paidOpen)
const notesOf = (t: Dictionary) => { const n = t.ea.ss.state; return { soon: n.soonNote, closed: COMMERCE_OPEN ? n.closedPaidNote : n.closedNote, paused: n.pausedNote, waitlist: n.waitlistNote }; };

/**
 * The self-service control (docs/design/p40-pricing.md 3.3): a NON-interactive status region "Free trial opens soon" in the static HTML of the default build, a link to {CP}/start/?plan=<plan> in the page language when the build
 * says `link`, and, at run time, a link only when the Control Plane answers open or waitlist (see SsCta / src/lib/ssStatus.ts). Async so the client component is imported lazily behind the constant.
 * `featured` = Studio (primary link); `inverse` = on the dark closing band (plan-less: no `plan`, so "/start/" without ?plan= and no plan name for screen readers).
 */
export async function SsCtaSlot({ locale, t, plan, featured = false, inverse = false, announce = true, srName, noteId }: { locale: Locale; t: Dictionary; plan?: PlanId; featured?: boolean; inverse?: boolean; announce?: boolean; srName?: string; noteId?: string }): Promise<ReactNode> {
  // the import sits INSIDE a branch that webpack folds away when the compile-time constant is not "1" (an early `return` would not remove the import): every other build carries no trace of the client control
  if (process.env.NEXT_PUBLIC_AICC_SS_CODE === "1" && SS_ON) {
    const { SsCta } = await import("./SsCta");
    return <SsCta href={startUrl(locale, plan)} initial={SS_INITIAL} labels={labelsOf(t)} notes={notesOf(t)} featured={featured} inverse={inverse} announce={announce} srName={srName} noteId={noteId ?? (plan ? `plan-${plan}-note` : "band-note")} {...A(locale, "ea.ss.cta")} />;
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

/**
 * The closing band (Home, Pricing, Product): the lead sentence and the state control; NO dates and no trial conditions (they are said once, in the launch panel). `children` are the extra actions (See Pricing, Live Demo);
 * `contact` = "Questions in the meantime? Write to ..." (Product bands, as in S0).
 */
export function SsBand({ locale, t, children, contact = false }: { locale: Locale; t: Dictionary; children?: ReactNode; contact?: boolean }) {
  if (!SS_ON) return null;
  return (
    // the kit's resets (box model, zero margins, the scoped sr-only) are scoped to `.aicc-pricing`: the band sits inside that wrapper too (`--band` keeps the dark band's own text colour), so a surface without the page's Tailwind reset renders it the same
    // a launch-offer build hides the band after the trial end instant (data-ea-live) and shows the ordinary band instead (data-ea-after, rendered by the page)
    <div className="aicc-pricing aicc-pricing--band" {...(EA_ON ? { "data-ea-live": "" } : {})}>
      <div className="aicc-pband" data-aicc-ss="band" data-ss-band {...(EA_ON ? { "data-ea-live": "" } : {})}>
        <p className="aicc-pband__lead" {...A(locale, "ea.ss.band")}>{t.ea.ss.band.lead}</p>
        <div className="aicc-pband__actions">
          <SsCtaSlot locale={locale} t={t} inverse />
          {children}
        </div>
        {contact ? <SoonContact locale={locale} t={t} inverse /> : null}
      </div>
    </div>
  );
}

/** The "Which plan?" finder of a self-service build (the ordinary finder shows an inert "Purchases open soon" chip). Renders nothing unless self-service is on. The result is the plan, its PAID capacity and the control; no dates, no trial conditions. */
export async function SsPlanFinderSlot({ locale, t, s, lang, dir }: { locale: Locale; t: Dictionary; s: import("./SsPlanFinder").SsPlanFinderStrings; lang?: string; dir?: "ltr" | "rtl" }): Promise<ReactNode> {
  if (process.env.NEXT_PUBLIC_AICC_SS_CODE === "1" && SS_ON) {
    const { SsPlanFinder } = await import("./SsPlanFinder");
    const ss = t.ea.ss;
    const a = A(locale, "ea.ss.plan");
    const cap = (stores: number) => paidCapacity(ss.plan, stores);
    return (
      <SsPlanFinder
        s={s}
        lang={lang}
        dir={dir}
        initial={SS_INITIAL}
        hrefs={{ solo: startUrl(locale, "solo"), studio: startUrl(locale, "studio"), agency: startUrl(locale, "agency") }}
        labels={labelsOf(t)}
        notes={notesOf(t)}
        capacity={{ solo: cap(planById("solo").stores), studio: cap(planById("studio").stores), agency: cap(planById("agency").stores), lang: a.lang, dir: a.dir }}
      />
    );
  }
  return null;
}
