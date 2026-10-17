// The merchandising loop as ONE visual strip: Store data -> Understand relationships -> Recommend -> Measure -> Insight -> Control -> Keep learning.
// renderLoopHTML(strings.loop, { links: [7 hrefs] }) returns markup (the site renders it on the server; the Control Plane can write it by hand);
// initLoop(el) adds a quiet sequential highlight once the strip is in view. Reduced motion: no highlight at all, the strip is static.
// Markup: <nav class="aicc-loop" data-aicc-loop aria-label="..."><ol class="aicc-loop__steps"><li class="aicc-loop__step"><a href="#x"><span class="aicc-loop__n">1</span><span>Label</span></a></li>...</ol></nav>
import { esc, motionAllowed, langAttrs } from "./motion.js";

export function renderLoopHTML(s, o = {}) {
  // links[i]: "#anchor" or { href: "#anchor", tab: "<tab id>" } (a click also selects that tab of a tabbed workspace)
  const links = (o.links || []).map((l) => (typeof l === "string" ? { href: l } : l));
  return (
    `<nav class="aicc-loop" data-aicc-loop aria-label="${esc(s.label)}"${langAttrs(s, o)}>` +
    `<p class="aicc-loop__title">${esc(s.title)}</p>` +
    `<ol class="aicc-loop__steps">${s.steps.map((t, i) => `<li class="aicc-loop__step" style="--i:${i}">${links[i] ? `<a href="${esc(links[i].href)}"${links[i].tab ? ` data-aicc-tab="${esc(links[i].tab)}"` : ""}>` : "<span>"}<span class="aicc-loop__n" aria-hidden="true">${i + 1}</span><span class="aicc-loop__t">${esc(t)}</span>${links[i] ? "</a>" : "</span>"}</li>`).join("")}</ol>` +
    `</nav>`
  );
}

export function initLoop(el) {
  if (!el || el.dataset.aiccReady === "wired") return;
  el.dataset.aiccReady = "wired";
  if (!motionAllowed() || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { el.dataset.play = "true"; io.disconnect(); }
  }, { threshold: 0.4 });
  io.observe(el);
}
