"use client";
import { useSyncExternalStore } from "react";

/**
 * True when animation is allowed: neither the OS (prefers-reduced-motion) nor the site's own control
 * (data-aicc-motion="reduce" on <html>) asks for less motion. Server snapshot is "not allowed" so no motion at first paint.
 */
function subscribe(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-aicc-motion"] });
  return () => {
    mq.removeEventListener("change", cb);
    mo.disconnect();
  };
}
const snapshot = () =>
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
  document.documentElement.getAttribute("data-aicc-motion") !== "reduce";

export function useMotionAllowed(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
