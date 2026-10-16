// Motion preferences shared by every kit module: the OS setting AND the site's own control (data-aicc-motion="reduce").
const mq = () => (typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false, addEventListener() {}, removeEventListener() {} });

/** True when animation is allowed. */
export function motionAllowed() {
  return !mq().matches && document.documentElement.getAttribute("data-aicc-motion") !== "reduce";
}

/** True on touch-first devices (no hover/pointer tilt). */
export function isCoarsePointer() {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/** Subscribe to changes of either motion source; returns an unsubscribe function. */
export function onMotionChange(cb) {
  const m = mq();
  m.addEventListener("change", cb);
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-aicc-motion"] });
  return () => {
    m.removeEventListener("change", cb);
    mo.disconnect();
  };
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
