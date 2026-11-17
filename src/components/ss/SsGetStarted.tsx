"use client";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { ssServerSnapshot, ssSnapshot, ssStart, ssStartsSignup, ssSubscribe, type SsInitial } from "@/lib/ssStatus";

/**
 * P39: "Get started" of a self-service build (header, mobile menu, Product hero). It is an ordinary link; only its TARGET depends on the sign-up state:
 *   the account page   the static state of the default (coming_soon) build, and every answer except open / waitlist (a page that exists: S0 behaviour; "Sign in" stays on it too)
 *   the sign-up page   a build with initial `link`, or a valid run-time answer of open or waitlist
 * Server HTML and first client render use the static target (no hydration mismatch). The status request is the page's ONE shared request (src/lib/ssStatus.ts). Never the Live Demo, never a link to /start/ that may be a 404.
 */
export function SsGetStarted({ startHref, accountHref, initial, className, icon, children, lang, dir }: { startHref: string; accountHref: string; initial: SsInitial; className: string; icon?: ReactNode; children: ReactNode; lang?: string; dir?: "ltr" | "rtl" }) {
  const view = useSyncExternalStore(ssSubscribe, ssSnapshot, ssServerSnapshot);
  useEffect(() => { void ssStart(); }, []);
  const href = ssStartsSignup(view, initial) ? startHref : accountHref;
  return (
    <a href={href} className={className} lang={lang} dir={dir} data-ss-getstarted={ssStartsSignup(view, initial) ? "start" : "account"}>
      {children}
      {icon ? <span className="aicc-btn__icon">{icon}</span> : null}
    </a>
  );
}
