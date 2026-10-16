// "Frequently-bought-together, actually learned." interactive demo (vanilla; used by the site and the Control Plane theme).
// Honest by construction: invented sample goods and link strengths, no revenue/CTR/customer numbers, strength shown in words and bars.
// Base product -> partners (real checkboxes in a fieldset) -> bundle total (tabular numerals) -> "Add N products to cart" (adds nothing) ->
// why-these rationale; Without AICC / With AICC toggle; Reco guidance that follows the ticked item; a separate dashboard-illustration row
// for link strength (the real shopper widget never shows it). Keyboard: Tab/Space; arrows follow reading direction and do not wrap.
// Reduced motion (OS or data-aicc-motion="reduce"): no count-up, no bar animation; every state change is still visible.
import { icon } from "./icons.js";
import { esc, motionAllowed } from "./motion.js";

const ANCHOR = { id: "kit", price: 38, strength: 0, icon: "coffee" };
const WITH = [
  { id: "filters", price: 14, strength: 3, icon: "filter" },
  { id: "grinder", price: 46, strength: 2, icon: "cog" },
  { id: "kettle", price: 52, strength: 1, icon: "flame" },
];
const WITHOUT = [
  { id: "mug", price: 16, strength: 0, icon: "cup-soda" },
  { id: "towel", price: 18, strength: 0, icon: "layers" },
  { id: "scale", price: 24, strength: 0, icon: "package" },
];

const money = (n) => "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

/** "Add N products to cart": exact 1 uses addOne; Russian "few" (2-4) uses addFew; otherwise addMany. */
export function addToCartText(locale, w, count) {
  if (count === 1) return w.addOne;
  const cat = new Intl.PluralRules(locale).select(count);
  return (locale === "ru" && cat === "few" ? w.addFew : w.addMany).replace("{count}", String(count));
}

/**
 * Mount into `el`. opts: { strings (the "demo" strings of one locale), locale, dir ("ltr"|"rtl"), assets: { reco } }
 */
export function mountFbt(el, opts) {
  if (!el || el.dataset.aiccReady === "mounted") return;
  el.dataset.aiccReady = "mounted";
  const s = opts.strings;
  const locale = opts.locale || "en";
  const rtl = (opts.dir || document.documentElement.dir) === "rtl";
  const state = { mode: "without", switched: false, checked: { kit: true }, last: null, added: false, shown: ANCHOR.price, raf: 0 };

  el.classList.add("aicc-fbt");
  el.removeAttribute("aria-busy");
  el.innerHTML =
    `<div class="aicc-fbt__glow" aria-hidden="true"></div>` +
    `<div class="aicc-fbt__main"><div class="aicc-fbt__widget">` +
    `<div class="aicc-fbt__top"><p class="aicc-fbt__label">${icon("info", 18)}<span>${esc(s.label)}</span></p>` +
    `<div role="group" aria-label="${esc(s.mode.legend)}" class="aicc-fbt__modes">` +
    `<button type="button" class="aicc-fbt__mode" data-mode="without" aria-pressed="true">${esc(s.mode.without)}</button>` +
    `<button type="button" class="aicc-fbt__mode" data-mode="with" aria-pressed="false">${esc(s.mode.with)}</button></div></div>` +
    `<p class="aicc-fbt__caption" aria-live="polite" aria-atomic="true"></p>` +
    `<p class="aicc-fbt__nudge">${esc(s.nudge)}</p>` +
    `<div class="aicc-fbt__head"><h3>${esc(s.widget.title)}</h3><p data-sub></p><p class="aicc-sr-only" data-subsr hidden>${esc(s.mode.withCaption)}</p></div>` +
    `<fieldset class="aicc-fbt__fieldset"><legend class="aicc-sr-only">${esc(s.groupLabel)}</legend><div data-anchor></div><ul class="aicc-fbt__cands" data-cands></ul></fieldset>` +
    `<p class="aicc-fbt__hint">${esc(s.keyboardHint)}</p>` +
    `<div class="aicc-fbt__foot"><p class="aicc-fbt__total"><span>${esc(s.widget.bundleTotal)}</span><strong><bdi data-total></bdi></strong></p>` +
    `<button type="button" class="aicc-btn aicc-btn--primary" data-add aria-disabled="false"><span data-add-icon></span><span data-add-text></span></button></div>` +
    `<p class="aicc-fbt__status" data-status></p><p class="aicc-sr-only" role="status" data-announce></p>` +
    `</div>` +
    `<section class="aicc-fbt__dash" aria-labelledby="fbt-dash-h" data-dash hidden><h4 id="fbt-dash-h">${esc(s.dashboard.heading)}</h4><ul data-dash-list></ul><p>${esc(s.dashboard.explain)}</p></section>` +
    `<div class="aicc-fbt__whyinline"><h3>${esc(s.why.heading)}</h3><p data-why-inline></p></div></div>` +
    `<aside class="aicc-fbt__why" aria-labelledby="fbt-why-h"><div class="aicc-fbt__reco"><img src="${esc(opts.assets?.reco || "")}" alt="" width="96" height="137" loading="lazy" decoding="async"><p class="aicc-fbt__bubble" aria-live="polite" aria-atomic="true" data-bubble></p></div><h3 id="fbt-why-h">${esc(s.why.heading)}</h3><p data-why></p></aside>`;

  const $ = (sel) => el.querySelector(sel);
  const boxes = [];
  const cands = () => (state.mode === "with" ? WITH : WITHOUT);
  const items = () => [ANCHOR, ...cands()];
  const strengthLabel = (it) => (it.strength === 3 ? s.strength.strong : it.strength === 2 ? s.strength.medium : s.strength.light);

  const cardHTML = (it, meta, anchor) =>
    `<label class="aicc-fbt-card" data-checked="${!!state.checked[it.id]}"${anchor ? ' data-anchor="true"' : ""}>` +
    `<input type="checkbox" data-id="${it.id}"${state.checked[it.id] ? " checked" : ""}>` +
    `<span class="aicc-fbt-card__thumb" aria-hidden="true">${icon(it.icon, 26)}</span>` +
    `<span class="aicc-fbt-card__body"><span class="aicc-fbt-card__name">${esc(s.products[it.id])}</span><span class="aicc-fbt-card__price"><bdi>${money(it.price)}</bdi></span>${meta}</span></label>`;

  function renderList() {
    $("[data-anchor]").innerHTML = cardHTML(ANCHOR, `<span class="aicc-fbt__tag">${esc(s.anchorTag)}</span>`, true);
    $("[data-cands]").innerHTML = cands().map((c) => `<li>${cardHTML(c, "", false)}</li>`).join("");
    boxes.length = 0;
    el.querySelectorAll('input[type="checkbox"]').forEach((b) => boxes.push(b));
    $("[data-dash]").hidden = state.mode !== "with";
    $("[data-dash-list]").innerHTML = state.mode === "with"
      ? WITH.map((c) => `<li data-strength="${c.strength}"><span class="aicc-fbt__dash-name">${esc(s.products[c.id])}</span><span class="aicc-fbt__bar" aria-hidden="true"><i></i></span><span class="aicc-fbt__dash-label">${esc(strengthLabel(c))}</span></li>`).join("")
      : "";
  }

  function total() { return items().filter((i) => state.checked[i.id]).reduce((n, i) => n + i.price, 0); }
  function count() { return items().filter((i) => state.checked[i.id]).length; }

  function setTotalText(v) { $("[data-total]").textContent = money(Math.round(v)); }
  function animateTotal(target) {
    cancelAnimationFrame(state.raf);
    if (!motionAllowed()) { state.shown = target; setTotalText(target); return; }
    const from = state.shown, start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / 320);
      state.shown = from + (target - from) * (1 - Math.pow(1 - p, 3));
      setTotalText(state.shown);
      if (p < 1) state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }

  function update() {
    const mode = state.mode;
    el.dataset.mode = mode;
    el.querySelectorAll(".aicc-fbt__mode").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === mode ? "true" : "false"));
    el.querySelectorAll(".aicc-fbt-card").forEach((card) => { const b = card.querySelector("input"); card.dataset.checked = String(b.checked); });
    const n = count(), t = total();
    const c = cands();
    const lastItem = mode === "with" ? c.find((x) => x.id === state.last && state.checked[x.id]) : undefined;
    const focus = lastItem || (mode === "with" ? [...c].filter((x) => state.checked[x.id]).sort((a, b) => b.strength - a.strength)[0] : undefined);
    const why = mode === "without" ? s.why.without : focus ? s.why[focus.id] : s.why.none;
    const reco = mode === "without" ? s.reco.without : focus ? s.reco[["", "light", "medium", "strong"][focus.strength]] : s.reco.intro;
    $(".aicc-fbt__caption").textContent = mode === "without" ? s.mode.captionWithout : focus ? reco : s.mode.captionWith;
    $(".aicc-fbt__nudge").hidden = state.switched;
    $("[data-sub]").textContent = mode === "with" ? s.widget.subtitle : s.mode.withoutCaption;
    $("[data-subsr]").hidden = mode !== "with";
    $("[data-why]").textContent = why;
    $("[data-why-inline]").textContent = why;
    $("[data-bubble]").textContent = reco;
    animateTotal(t);
    const addBtn = $("[data-add]");
    addBtn.setAttribute("aria-disabled", String(n === 0));
    $("[data-add-icon]").innerHTML = icon(state.added ? "check" : "shopping-cart", 18);
    $("[data-add-text]").textContent = state.added ? s.widget.added : addToCartText(locale, s.widget, Math.max(1, n));
    $("[data-status]").textContent = n === 0 ? s.widget.selectAtLeastOne : state.added ? s.widget.noteAdd : "";
    $("[data-announce]").textContent = `${s.summary.replace("{count}", String(n)).replace("{total}", money(t))}${n === 0 ? ` ${s.widget.selectAtLeastOne}.` : ""}${state.added ? ` ${s.widget.added}.` : ""}`;
  }

  el.addEventListener("change", (e) => {
    const b = e.target.closest('input[type="checkbox"]');
    if (!b) return;
    state.checked[b.dataset.id] = b.checked;
    state.last = b.dataset.id;
    state.added = false;
    update();
  });
  el.addEventListener("click", (e) => {
    const m = e.target.closest(".aicc-fbt__mode");
    if (m) {
      state.mode = m.dataset.mode; state.switched = true; state.added = false;
      renderList(); update();
      return;
    }
    if (e.target.closest("[data-add]")) {
      if (count() > 0) { state.added = true; update(); }
    }
  });
  el.addEventListener("keydown", (e) => {
    const idx = boxes.indexOf(document.activeElement);
    if (idx < 0) return;
    let step = 0;
    if (e.key === "ArrowDown") step = 1;
    else if (e.key === "ArrowUp") step = -1;
    else if (e.key === "ArrowRight") step = rtl ? -1 : 1;
    else if (e.key === "ArrowLeft") step = rtl ? 1 : -1;
    if (!step) return;
    e.preventDefault();
    const next = idx + step;
    if (next >= 0 && next < boxes.length) boxes[next].focus(); // no wrapping
  });

  renderList();
  state.shown = total();
  setTotalText(state.shown);
  update();
}
