import { REPLICA_LABELS } from "./replica-labels.js";
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

const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// One alternation, longest label first. "{n}" in a label (Bought together {n} times) matches the number that replaced it.
const ALT = [...REPLICA_LABELS].sort((a, b) => b.length - a.length).map((l) => escRe(l).replace("\\{n\\}", "[\\d.,\\u00a0\\u202f ]+?")).join("|");
const LABEL_RE = new RegExp(`(?<![\\p{L}])(${ALT})(?![\\p{L}])`, "gu");
const LABEL_EXACT = new RegExp(`^(?:${ALT})$`, "u");

/**
 * Real plugin-admin labels stay English in the plugin admin of every language except Hebrew, so on a translated (non-fallback) es/ru page each occurrence in a
 * replica must say lang="en" dir="ltr" AT THE LEAF (WCAG 3.1.2), while the Spanish/Russian words around it do not. Hebrew replicas use the plugin's own Hebrew
 * labels (nothing to mark). Returns functions bound to one string set s and its render options o ({ locale }):
 *   T(text)   -> escaped HTML with every label occurrence wrapped in <span lang="en" dir="ltr" class="aicc-admin-label">
 *   A(text)   -> ' lang="en" dir="ltr"' when the WHOLE text is a label (for <option> and other elements that cannot contain markup), else ''
 */
export function labeler(s, o = {}) {
  const on = !!o.locale && o.locale !== "en" && !s._fallback;
  return {
    T: (text) => { const e = esc(text); return on ? e.replace(LABEL_RE, (m) => `<span lang="en" dir="ltr" class="aicc-admin-label">${m}</span>`) : e; },
    A: (text) => (on && LABEL_EXACT.test(String(text)) ? ' lang="en" dir="ltr"' : ""),
  };
}

/** Splits plain text into [{ text, label }] parts, label = a real plugin-admin label (for renderers that build nodes instead of HTML, e.g. the React site). */
export function splitLabels(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(LABEL_RE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), label: false });
    out.push({ text: m[0], label: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), label: false });
  return out;
}
