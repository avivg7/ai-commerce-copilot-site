"use client";
import { useEffect, useSyncExternalStore } from "react";
import { ArrowRight, Lock } from "lucide-react";
import { ssControl, ssRegClosedServerSnapshot, ssRegClosedSnapshot, ssRegClosedSubscribe, ssServerSnapshot, ssSnapshot, ssStart, ssSubscribe, type SsInitial } from "@/lib/ssStatus";

/** The labels of the control: the real sign-up link (start / waitlist), the information link (how), and the closed status. */
export type SsCtaLabels = { start: string; waitlist: string; closed: string; how: string };

/**
 * P37/P39/P40/P41: the one self-service control of a plan card, band or finder result (markup: docs/design/p41-journey.md). Server HTML and first client render are the build's STATIC state (src/lib/ssStatus.ts: `initial`; the same markup
 * whatever the Control Plane says, so hydration always matches). After hydration the shared store asks GET /wp-json/aicc/v1/signup/status ONCE and the state table decides. Three kinds, never an inert button:
 *   link  (`data-ss-cta="link"`)   open / waitlist: a real link {CP}/start/?plan=<id> "Get started free" / "Join the waitlist" (plan and language preserved)
 *   info  (`data-ss-cta="info"`)   off / paused / static (registration not open): a real link to this site's journey page `/<lang>/get-started/?plan=<id>` "See how it works" (a page that exists in every self-service build,
 *                                  says honestly that registration is not open and offers the Live Demo). Never a link to /start/ while that page may be a 404, never the Live Demo itself, never a fake sign-up
 *   status (`data-ss-cta="status"`) closed (browser clock at or after 2026-12-24T00:00:00Z, or an answer closed_cutoff): a non-interactive region ("Registration closed" + its note)
 * The fact that registration is not open yet is said ONCE per section (SsState, the status line), not under every card. A failed or invalid answer changes nothing (the build's static state stays).
 * This module is imported only by builds that carry the self-service code (next.config.ts NEXT_PUBLIC_AICC_SS_CODE).
 */
export function SsCta({ href, infoHref, labels, closedNote, initial, featured = false, inverse = false, announce = true, srName, lang, dir }: {
  /** The sign-up link (open / waitlist). */
  href: string;
  /** The information link (registration not open): this site's journey page, with the plan when the control has one. */
  infoHref: string;
  /** The build-time initial state (NEXT_PUBLIC_AICC_SS_INITIAL, resolved on the server). */
  initial: SsInitial;
  labels: SsCtaLabels;
  /** The line under the closed status. */
  closedNote: string;
  /** Studio: the primary (gradient) link; the others are outline links. */
  featured?: boolean;
  /** The control sits on the dark closing band (primary link, inverse status region). */
  inverse?: boolean;
  /** role="status" on the closed region (a live region). The closed view announces ONCE (the band): the cards of that view pass false, their text stays visible. */
  announce?: boolean;
  /** The plan name, read by screen readers after the label (a plan-less control has none). */
  srName?: string;
  lang?: string;
  dir?: "ltr" | "rtl";
}) {
  const view = useSyncExternalStore(ssSubscribe, ssSnapshot, ssServerSnapshot);
  useEffect(() => { void ssStart(); }, []);
  // from 2026-12-24T00:00:00Z the browser clock alone forces the closed region (a stale or cached page, a late status answer of open / waitlist, a page left open across the instant): the Control Plane accepts no registration from then on
  const closedByClock = useSyncExternalStore(ssRegClosedSubscribe, ssRegClosedSnapshot, ssRegClosedServerSnapshot);
  const kind = ssControl(view, initial, closedByClock);
  const state = closedByClock ? "closed_cutoff" : view;
  const wrap = inverse ? "aicc-pcta aicc-pcta--inverse" : "aicc-pcta";
  if (kind === "closed") {
    return (
      <div className={wrap} data-ss-cta="status" lang={lang} dir={dir}>
        <p className="aicc-pstatus" {...(announce ? { role: "status" } : {})} data-ss-state={state}>
          <span className="aicc-pstatus__pill"><Lock size={18} aria-hidden="true" focusable="false" /><span className="aicc-pstatus__label">{labels.closed}</span></span>
          <span className="aicc-pstatus__note">{closedNote}</span>
        </p>
      </div>
    );
  }
  const info = kind === "info"; // soon / paused: registration is not open (yet)
  const variant = inverse || featured ? "aicc-btn--primary" : "aicc-btn--outline";
  const label = info ? labels.how : labels[kind as "start" | "waitlist"];
  return (
    <div className={wrap} data-ss-cta={info ? "info" : "link"} lang={lang} dir={dir}>
      <a className={`aicc-btn aicc-btn--lg aicc-btn--block ${variant}`} data-ss-state={state} href={info ? infoHref : href}>
        <span>{label}</span>
        <span className="aicc-btn__icon aicc-flip" aria-hidden="true"><ArrowRight size={18} focusable="false" /></span>
        {srName ? <span className="aicc-sr-only"> ({srName})</span> : null}
      </a>
    </div>
  );
}
