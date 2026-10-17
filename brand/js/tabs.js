// Accessible tabs for a server-rendered workspace (ARIA tabs pattern: roving tabindex, arrow keys that follow the reading direction,
// Home/End, automatic activation). Progressive enhancement: without JavaScript every panel is visible under its own heading and the
// tab list stays hidden; with it, the list appears and only the selected panel is shown (cross-fade; instant under reduced motion).
//
// Markup contract (the site renders it in React, the Control Plane can write it by hand):
//   <div class="aicc-tabs" data-aicc-tabs>
//     <div class="aicc-tabs__list" role="tablist" aria-label="..." hidden>
//       <button type="button" class="aicc-tabs__tab" role="tab" id="t-a" aria-controls="p-a" aria-selected="true" tabindex="0">Understand</button> ...
//     </div>
//     <section class="aicc-tabs__panel" id="p-a" role="tabpanel" aria-labelledby="t-a"><h3 class="aicc-tabs__ph">Understand</h3> ... </section> ...
//   </div>
// Optional: a link carrying data-aicc-tab="<tab id>" selects that tab when clicked (its href still scrolls to the section); a script can
// dispatch `aicc-tabs:select` with detail = tab id on the root. A `data-selected` attribute on the root names the initially selected tab id.
export function initTabs(root) {
  if (!root || root.dataset.aiccReady === "wired") return;
  const list = root.querySelector('[role="tablist"]');
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  if (!list || !tabs.length) return;
  root.dataset.aiccReady = "wired";
  const panelOf = (t) => document.getElementById(t.getAttribute("aria-controls"));
  const rtl = () => getComputedStyle(root).direction === "rtl";

  // Wide screens: every panel keeps its place in one grid cell (the workspace keeps the height of its tallest panel, so nothing below jumps);
  // the inactive ones are invisible and inert. Narrow screens: inactive panels are simply hidden. (The `hidden` attribute is not used on wide screens:
  // Tailwind's preflight declares [hidden] { display: none !important } in a lower cascade layer, which beats any unlayered !important.)
  const wide = matchMedia("(min-width: 48rem)");
  let current = null;
  function paint() {
    for (const t of tabs) {
      const on = t === current;
      const p = panelOf(t);
      if (!p) continue;
      p.hidden = !on && !wide.matches;
      p.dataset.inactive = on ? "false" : "true";
      p.inert = !on;
    }
    root.dataset.stacked = String(wide.matches);
  }
  wide.addEventListener("change", paint);

  function select(tab, { focus = false, animate = true } = {}) {
    current = tab;
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      const p = panelOf(t);
      if (!p) continue;
      if (on && animate) { p.classList.remove("is-entering"); void p.offsetWidth; p.classList.add("is-entering"); }
    }
    paint();
    if (focus) tab.focus();
    root.dispatchEvent(new CustomEvent("aicc-tabs:change", { detail: tab.id, bubbles: true }));
  }

  list.hidden = false;
  root.dataset.enhanced = "true";
  const start = tabs.find((t) => t.id === root.dataset.selected) || tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0];
  select(start, { animate: false });

  list.addEventListener("click", (e) => { const t = e.target.closest('[role="tab"]'); if (t) select(t); });
  list.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const fwd = rtl() ? "ArrowLeft" : "ArrowRight", back = rtl() ? "ArrowRight" : "ArrowLeft";
    let n = -1;
    if (e.key === fwd) n = (i + 1) % tabs.length;
    else if (e.key === back) n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    if (n < 0) return;
    e.preventDefault();
    select(tabs[n], { focus: true });
  });
  root.addEventListener("aicc-tabs:select", (e) => { const t = tabs.find((x) => x.id === e.detail); if (t) select(t); });
  if (!document.documentElement.dataset.aiccTabLinks) {
    document.documentElement.dataset.aiccTabLinks = "1";
    document.addEventListener("click", (e) => {
      const a = e.target.closest?.("[data-aicc-tab]");
      const tab = a && document.getElementById(a.dataset.aiccTab);
      tab?.closest("[data-aicc-tabs]")?.dispatchEvent(new CustomEvent("aicc-tabs:select", { detail: tab.id }));
    });
  }
}
