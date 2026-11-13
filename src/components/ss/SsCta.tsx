"use client";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { ssDecision, ssServerSnapshot, ssSnapshot, ssStart, ssSubscribe, type SsLabelKey } from "@/lib/ssStatus";

/**
 * P37: the one self-service button. Server HTML and first client render are the STATIC button (a link to the Control Plane sign-up page: the same markup whatever the Control Plane says, so
 * hydration always matches). After hydration the shared store asks GET /wp-json/aicc/v1/signup/status ONCE; on a valid answer the state table of src/lib/ssStatus.ts decides:
 * a link ("Start free trial" / "Join the waitlist") or PLAIN TEXT ("Free trial registration closed / paused / not open"): never an inert button, never a link to a page that cannot work. A failed answer changes nothing.
 * This module is imported only by builds that carry the self-service code (next.config.ts NEXT_PUBLIC_AICC_SS_CODE), so every other build has no trace of it.
 */
export function SsCta({ href, labels, variant = "primary", size = "lg", block = false, srName, inverse = false, lang, dir }: {
  href: string;
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
  const d = ssDecision(view);
  if (d.kind === "text") {
    return <p className={inverse ? "aicc-sstate aicc-sstate--inverse" : "aicc-sstate"} data-ss-state={view} role="status" lang={lang} dir={dir}>{labels[d.label]}</p>;
  }
  return (
    <Button href={href} variant={variant} size={size} block={block} lang={lang} dir={dir}>
      {labels[d.label]}
      {srName ? <span className="aicc-sr-only"> ({srName})</span> : null}
    </Button>
  );
}
