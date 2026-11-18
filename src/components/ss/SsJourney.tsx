"use client";
import { useEffect, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { ArrowRight, CircleCheck, Clock, Pause } from "lucide-react";
import type { PlanId } from "@/data/plans";
import { ssDecision, ssRegClosedServerSnapshot, ssRegClosedSnapshot, ssRegClosedSubscribe, ssServerSnapshot, ssSnapshot, ssStart, ssSubscribe, type SsInitial } from "@/lib/ssStatus";
import { planServerSnapshot, planSnapshot, planSubscribe, setPlan } from "@/lib/ssPlan";

/**
 * P41: the two interactive islands of the journey page (`/get-started/`, src/components/pages/GetStartedPage.tsx). Everything else on the page is static server HTML.
 *   SsJourneyPlan    the plan preference chips (real links `?plan=<id>`: they work without script; with script they select in place and keep the URL in step)
 *   SsJourneyAction  the state-aware primary action, from the SAME state table and status store as every pricing control (src/lib/ssStatus.ts):
 *                      not open (off / static / paused)  the honest statement + the working Live Demo + See pricing; NO link to /start/ while that page may be a 404, no fake sign-up
 *                      waitlist                          "Join the waitlist"  -> {CP}/start/?plan=<plan>
 *                      open                              "Get started free"   -> {CP}/start/?plan=<plan>
 *                      closed (browser clock at or after 2026-12-24T00:00:00Z, or an answer closed_cutoff)  the closed text + the Live Demo + See pricing
 * The sign-up URLs are written on the server (src/lib/selfService.ts startUrl: language prefix, build host); the plan only chooses between them.
 */
export function SsJourneyPlan({ plans, label, hint, hrefs }: { plans: { id: PlanId; name: string }[]; label: string; hint: string; hrefs: Record<PlanId, string> }) {
  const plan = useSyncExternalStore(planSubscribe, planSnapshot, planServerSnapshot);
  const pick = (id: PlanId) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setPlan(id);
  };
  return (
    <div className="aicc-jr__plan" data-jr-plan={plan ?? ""}>
      <nav aria-label={label}>
        <ul className="aicc-jr__chips">
          {plans.map((p) => (
            <li key={p.id}>
              <a className="aicc-jr__chip" href={hrefs[p.id]} data-plan={p.id} aria-current={plan === p.id ? "true" : undefined} onClick={pick(p.id)}>
                <bdi>{p.name}</bdi>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="aicc-jr__hint">{hint}</p>
    </div>
  );
}

export type SsJourneyStrings = { soon: string; paused: string; open: string; waitlist: string; closed: string; waitBody: string; openBody: string; closedBody: string; start: string; joinWaitlist: string; demo: string; pricing: string };

export function SsJourneyAction({ strings, initial, startHrefs, demoHref, pricingHref, lang, dir }: { strings: SsJourneyStrings; initial: SsInitial; startHrefs: Record<PlanId | "none", string>; demoHref: string; pricingHref: string; lang?: string; dir?: "ltr" | "rtl" }) {
  const view = useSyncExternalStore(ssSubscribe, ssSnapshot, ssServerSnapshot);
  useEffect(() => { void ssStart(); }, []);
  const closedByClock = useSyncExternalStore(ssRegClosedSubscribe, ssRegClosedSnapshot, ssRegClosedServerSnapshot);
  const plan = useSyncExternalStore(planSubscribe, planSnapshot, planServerSnapshot);
  const d = ssDecision(view, initial, closedByClock);
  const state = closedByClock ? "closed_cutoff" : view;
  const key: "soon" | "paused" | "open" | "waitlist" | "closed" = d.kind === "link" ? (d.label === "waitlist" ? "waitlist" : "open") : d.label === "closed" ? "closed" : d.label === "paused" ? "paused" : "soon";
  const Icon: typeof Clock = key === "open" ? CircleCheck : key === "paused" ? Pause : Clock;
  const body = key === "open" ? strings.openBody : key === "closed" ? strings.closedBody : key === "waitlist" ? "" : strings.waitBody;
  const link = (href: string, cls: string, children: ReactNode) => <a className={`aicc-btn aicc-btn--lg aicc-btn--block ${cls}`} href={href} data-jr-act>{children}</a>;
  const arrow = <span className="aicc-btn__icon aicc-flip" aria-hidden="true"><ArrowRight size={18} focusable="false" /></span>;
  const signup = startHrefs[plan ?? "none"];
  return (
    <div className="aicc-jr__act-body" data-jr-state={key} data-ss-state={state} lang={lang} dir={dir}>
      <p className="aicc-jr__state" role="status" data-jr-line={key}>
        <span className="aicc-jr__state-icon" aria-hidden="true"><Icon size={20} focusable="false" /></span>
        <span>{strings[key]}</span>
      </p>
      {body ? <p className="aicc-jr__act-text">{body}</p> : null}
      <div className="aicc-jr__actions">
        {d.kind === "link" ? (
          <>
            {link(signup, "aicc-btn--primary", <><span>{key === "waitlist" ? strings.joinWaitlist : strings.start}</span>{arrow}</>)}
            {link(demoHref, "aicc-btn--ghost", <span>{strings.demo}</span>)}
          </>
        ) : key === "closed" ? (
          <>
            {link(pricingHref, "aicc-btn--primary", <span>{strings.pricing}</span>)}
            {link(demoHref, "aicc-btn--ghost", <span>{strings.demo}</span>)}
          </>
        ) : (
          <>
            {link(demoHref, "aicc-btn--primary", <><span>{strings.demo}</span>{arrow}</>)}
            {link(pricingHref, "aicc-btn--ghost", <span>{strings.pricing}</span>)}
          </>
        )}
      </div>
    </div>
  );
}
