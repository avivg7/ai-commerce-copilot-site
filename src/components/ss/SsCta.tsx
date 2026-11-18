"use client";
import { useEffect, useSyncExternalStore } from "react";
import { ArrowRight, Clock, Lock, Pause } from "lucide-react";
import { ssDecision, ssRegClosedServerSnapshot, ssRegClosedSnapshot, ssRegClosedSubscribe, ssServerSnapshot, ssSnapshot, ssStart, ssSubscribe, type SsInitial, type SsLabelKey } from "@/lib/ssStatus";

/** The one-line explanation under a status pill (and under the waitlist link): the per-state notes of `t.ea.ss.state`. */
export type SsNotes = { soon: string; closed: string; paused: string; waitlist: string };

/**
 * P37/P39/P40: the one self-service control of a plan card, band or finder result (markup: docs/design/p40-pricing.md 3.3). Server HTML and first client render are the build's STATIC state (src/lib/ssStatus.ts: `initial`,
 * default coming_soon = a NON-interactive status region "Free trial opens soon"; the same markup whatever the Control Plane says, so hydration always matches). After hydration the shared store asks
 * GET /wp-json/aicc/v1/signup/status ONCE; on a valid answer the state table decides: a LINK to {CP}/start/?plan=<id> ("Get started free" for open, "Join the waitlist" for waitlist) or a STATUS REGION
 * (soon / closed / paused): never an inert button, never a link to a page that is not known to work, never the Live Demo. A failed or invalid answer changes nothing (the build's static state stays).
 * The browser clock alone forces the closed region from 2026-12-24T00:00:00Z (a timer in the store flips a page that is left open). This Site has no purchase link: its closed state is always the unavailable one.
 * This module is imported only by builds that carry the self-service code (next.config.ts NEXT_PUBLIC_AICC_SS_CODE).
 */
export function SsCta({ href, labels, notes, initial, featured = false, inverse = false, srName, noteId, lang, dir }: {
  href: string;
  /** The build-time initial state (NEXT_PUBLIC_AICC_SS_INITIAL, resolved on the server). */
  initial: SsInitial;
  labels: Record<SsLabelKey, string>;
  notes: SsNotes;
  /** Studio: the primary (gradient) link; the others are outline links. */
  featured?: boolean;
  /** The control sits on the dark closing band (primary link, inverse status region). */
  inverse?: boolean;
  /** The plan name, read by screen readers after the label (a plan-less control has none). */
  srName?: string;
  /** id of the waitlist note (aria-describedby of the link). */
  noteId?: string;
  lang?: string;
  dir?: "ltr" | "rtl";
}) {
  const view = useSyncExternalStore(ssSubscribe, ssSnapshot, ssServerSnapshot);
  useEffect(() => { void ssStart(); }, []);
  // from 2026-12-24T00:00:00Z the browser clock alone forces the closed region (a stale or cached page, a late status answer of open / waitlist, a page left open across the instant): the Control Plane accepts no registration from then on
  const closedByClock = useSyncExternalStore(ssRegClosedSubscribe, ssRegClosedSnapshot, ssRegClosedServerSnapshot);
  const d = ssDecision(view, initial, closedByClock);
  const state = closedByClock ? "closed_cutoff" : view;
  const wrap = inverse ? "aicc-pcta aicc-pcta--inverse" : "aicc-pcta";
  if (d.kind === "text") {
    const Icon = d.label === "closed" ? Lock : d.label === "paused" ? Pause : Clock;
    const note = d.label === "closed" ? notes.closed : d.label === "paused" ? notes.paused : notes.soon;
    return (
      <div className={wrap} data-ss-cta="status" lang={lang} dir={dir}>
        <p className="aicc-pstatus" role="status" data-ss-state={state}>
          <span className="aicc-pstatus__pill"><Icon size={18} aria-hidden="true" focusable="false" /><span className="aicc-pstatus__label">{labels[d.label]}</span></span>
          <span className="aicc-pstatus__note">{note}</span>
        </p>
      </div>
    );
  }
  const waitlist = d.label === "waitlist";
  const variant = inverse || featured ? "aicc-btn--primary" : "aicc-btn--outline";
  return (
    <div className={wrap} data-ss-cta="link" lang={lang} dir={dir}>
      <a className={`aicc-btn aicc-btn--lg aicc-btn--block ${variant}`} data-ss-state={state} href={href} {...(waitlist && noteId ? { "aria-describedby": noteId } : {})}>
        <span>{labels[d.label]}</span>
        <span className="aicc-btn__icon aicc-flip" aria-hidden="true"><ArrowRight size={18} focusable="false" /></span>
        {srName ? <span className="aicc-sr-only"> ({srName})</span> : null}
      </a>
      {/* the link keeps the height of the status region it replaces (the note's lines are reserved, invisible and not read), so the answer arriving moves nothing */}
      {waitlist ? <p className="aicc-pcta__note" id={noteId}>{notes.waitlist}</p> : <span className="aicc-ss-reserve" aria-hidden="true" data-reserve={notes.soon} />}
    </div>
  );
}
