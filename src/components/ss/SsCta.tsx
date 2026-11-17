"use client";
import { useEffect, useSyncExternalStore } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ssDecision, ssServerSnapshot, ssSnapshot, ssStart, ssSubscribe, type SsInitial, type SsLabelKey } from "@/lib/ssStatus";

/**
 * P37/P39: the one self-service control of a plan card, band or finder result. Server HTML and first client render are the build's STATIC state (src/lib/ssStatus.ts: `initial`, default coming_soon = PLAIN TEXT
 * "Free trial registration opens soon"; the same markup whatever the Control Plane says, so hydration always matches). After hydration the shared store asks GET /wp-json/aicc/v1/signup/status ONCE; on a valid answer
 * the state table decides: a LINK to {CP}/start/?plan=<id> ("Start free trial" for open, "Join the waitlist" for waitlist) or PLAIN TEXT ("registration opens soon / closed / paused"): never an inert button, never a link to
 * a page that is not known to work. A failed or invalid answer changes nothing (the build's static state stays). This module is imported only by builds that carry the self-service code (next.config.ts NEXT_PUBLIC_AICC_SS_CODE).
 */
export function SsCta({ href, labels, initial, variant = "primary", size = "lg", block = false, srName, inverse = false, lang, dir }: {
  href: string;
  /** The build-time initial state (NEXT_PUBLIC_AICC_SS_INITIAL, resolved on the server). */
  initial: SsInitial;
  labels: Record<SsLabelKey, string>;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "md" | "lg";
  block?: boolean;
  /** The plan name, read by screen readers after the label (the card heading is not next to a band button). */
  srName?: string;
  /** The text state sits on a dark band. */
  inverse?: boolean;
  lang?: string;
  dir?: "ltr" | "rtl";
}) {
  const view = useSyncExternalStore(ssSubscribe, ssSnapshot, ssServerSnapshot);
  useEffect(() => { void ssStart(); }, []);
  const d = ssDecision(view, initial);
  if (d.kind === "text") {
    return <p className={inverse ? "aicc-sstate aicc-sstate--inverse" : "aicc-sstate"} data-ss-state={view} role="status" lang={lang} dir={dir}><Clock size={16} aria-hidden="true" /><span>{labels[d.label]}</span></p>;
  }
  return (
    <Button href={href} variant={variant} size={size} block={block} lang={lang} dir={dir}>
      {labels[d.label]}
      {srName ? <span className="aicc-sr-only"> ({srName})</span> : null}
    </Button>
  );
}
