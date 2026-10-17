// Safety flow diagrams: a short row of three steps joined by arrows, as plain HTML + the kit CSS classes (.aicc-flow*).
// renderFlowHTML(flow, kind) -> markup; the same markup can be written by hand in the Control Plane theme (documented in brand/README.md).
//   flow: { title, steps: [a, b, c], note }   kind: "order" | "down" | "inactive" | "measure" | "history" (selects the icons and the accent)
import { icon } from "./icons.js";
import { esc, langAttrs } from "./motion.js";

const ICONS = { order: ["shopping-cart", "clock", "send"], down: ["triangle-alert", "eye-off", "rotate-ccw"], inactive: ["lock", "eye-off", "circle-check"], measure: ["shopping-cart", "clock", "circle-check"], history: ["database", "clock", "sparkles"] };

export function renderFlowHTML(flow, kind, extra = {}) {
  const ic = ICONS[kind] || ICONS.order;
  return (
    `<figure class="aicc-flow" data-kind="${esc(kind)}"${langAttrs({ _fallback: extra.fallback }, extra)}>` +
    `<figcaption class="aicc-flow__title">${esc(flow.title)}</figcaption>` +
    `<ol class="aicc-flow__steps">${flow.steps.map((t, i) => `<li class="aicc-flow__step" data-step="${i + 1}"><span class="aicc-flow__icon">${icon(ic[i], 20)}</span><span class="aicc-flow__text">${esc(t)}</span></li>`).join("")}</ol>` +
    (flow.note ? `<p class="aicc-flow__note">${esc(flow.note)}</p>` : "") +
    `</figure>`
  );
}
