"use client";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { ssLine, ssRegClosed, ssRegClosedServerSnapshot, ssRegClosedSnapshot, ssRegClosedSubscribe, ssServerSnapshot, ssSnapshot, ssStart, ssStartsSignup, ssSubscribe, type SsInitial } from "@/lib/ssStatus";

/**
 * P39/P41: "Get started" of a self-service build (header, mobile menu, Product hero). It is an ordinary link; only its TARGET depends on the sign-up state:
 *   the journey page   the static state of the default (coming_soon) build, and every answer except open / waitlist (this site's `/<lang>/get-started/`: how it works, honest about registration not being open, with the Live Demo; P41 replaced the
 *                      account page, whose copy says "Purchases open soon", a wrong word for a free trial; "Sign in" stays on the account page)
 *   the sign-up page   a build with initial `link`, or a valid run-time answer of open or waitlist
 * Server HTML and first client render use the static target (no hydration mismatch). The status request is the page's ONE shared request (src/lib/ssStatus.ts). Never the Live Demo, never a link to /start/ that may be a 404.
 */
export function SsGetStarted({ startHref, journeyHref, initial, className, icon, children, lang, dir }: { startHref: string; journeyHref: string; initial: SsInitial; className: string; icon?: ReactNode; children: ReactNode; lang?: string; dir?: "ltr" | "rtl" }) {
  const view = useSyncExternalStore(ssSubscribe, ssSnapshot, ssServerSnapshot);
  useEffect(() => { void ssStart(); }, []);
  const closedByClock = useSyncExternalStore(ssRegClosedSubscribe, ssRegClosedSnapshot, ssRegClosedServerSnapshot);
  const starts = ssStartsSignup(view, initial, closedByClock);
  // the one global island of a self-service build: it keeps `<html data-ss-closed>` (the closed view: ordinary cards, no launch panel, bar text hidden) in step with the store (clock or a status answer closed_cutoff)
  const closed = closedByClock || view === "closed_cutoff";
  useEffect(() => { const d = document.documentElement; if (closed) d.setAttribute("data-ss-closed", ""); else if (!ssRegClosed()) d.removeAttribute("data-ss-closed"); }, [closed]);
  // P41 review: <html data-ss-open> = the status state is OPEN (a valid answer "open", or the static state of a link build, and the clock before the cutoff): the only state in which the counsel-gated struck price may show (CSS in Ss.tsx SS_CSS)
  const open = ssLine(view, initial, closedByClock) === "open";
  useEffect(() => { const d = document.documentElement; if (open) d.setAttribute("data-ss-open", ""); else d.removeAttribute("data-ss-open"); }, [open]);
  const href = starts ? startHref : journeyHref;
  return (
    <a href={href} className={className} lang={lang} dir={dir} data-ss-getstarted={starts ? "start" : "journey"}>
      {children}
      {icon ? <span className="aicc-btn__icon">{icon}</span> : null}
    </a>
  );
}
