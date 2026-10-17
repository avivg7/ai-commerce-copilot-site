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

/**
 * lang/dir attributes (as an HTML string) for a kit block: English fallback strings -> lang="en" dir="ltr"; translated strings on a non-English page ->
 * the page language (o.locale, o.dir), so the block also resets an enclosing fallback wrapper (WCAG 3.1.2). English pages need nothing.
 */
export function langAttrs(s, o = {}) {
  if (s._fallback) return ' lang="en" dir="ltr"';
  if (o.locale && o.locale !== "en") return ` lang="${o.locale}" dir="${o.dir || "ltr"}"`;
  return "";
}
/** Same for a mounted element (the mount functions get locale and dir from the container's data attributes). */
export function setLang(el, s, locale, dir) {
  if (s._fallback) { el.setAttribute("lang", "en"); el.setAttribute("dir", "ltr"); }
  else if (locale && locale !== "en") { el.setAttribute("lang", locale); if (dir) el.setAttribute("dir", dir); }
}
