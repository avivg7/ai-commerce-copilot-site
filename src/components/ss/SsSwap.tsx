"use client";
import { useEffect, useSyncExternalStore } from "react";
import { ssRegClosedServerSnapshot, ssRegClosedSnapshot, ssRegClosedSubscribe, ssServerSnapshot, ssSnapshot, ssStart, ssSubscribe } from "@/lib/ssStatus";

/**
 * P40: the header of the pricing section says the launch trial while registration can still be started, and the plain "plans priced by store capacity" once registration is closed (docs/design/p40-pricing.md 3.1):
 * `open` is the static server text (every build, before the status answer), `closed` replaces it when the browser clock is at or past 2026-12-24T00:00:00Z or the Control Plane answers closed_cutoff.
 * The same shared store as the controls (one request per page load); paused keeps the launch header (registration is expected back).
 */
export function SsSwap({ open, closed }: { open: string; closed: string }) {
  const view = useSyncExternalStore(ssSubscribe, ssSnapshot, ssServerSnapshot);
  useEffect(() => { void ssStart(); }, []);
  const byClock = useSyncExternalStore(ssRegClosedSubscribe, ssRegClosedSnapshot, ssRegClosedServerSnapshot);
  return <>{byClock || view === "closed_cutoff" ? closed : open}</>;
}
