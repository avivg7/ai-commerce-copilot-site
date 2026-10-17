// "Frequently-bought-together, actually learned." interactive demo (vanilla; used by the site and the Control Plane theme).
// Honest by construction: invented sample goods and sample counts (labelled "Sample data: not from a real store"), no revenue/CTR/customer claims.
// Two controls, same sample bundle:
//   Compare:  Plain related products / With AICC   (what a shopper sees: WooCommerce's own related-products block vs. what was bought together)
//   View:     What shoppers see / What you see      (the merchant side: why each product is listed, the rule controls, the dashboard tiles)
// The demo OPENS on "With AICC" (the result first); the plain related-products block is one click away, and a live result line under the toggles says
// in one sentence what the current state shows.
// Shopper view, With AICC: base product -> partners (real checkboxes in a fieldset) -> bundle total -> "Add N products to cart" (adds nothing).
// Shopper view, plain related products: WooCommerce's own block drawn plainly (a heading and product tiles: nothing to tick, no total, no button).
// Merchant view: for each listed product "Bought together N times" (learned partners) or a no-count note (fallbacks), a rule select with the real
// ranking policy (rules-core.js), the list the shopper sees RIGHT NOW (updates live), the dashboard tiles that record the add-to-cart, one observation
// and one Ask Reco line. Both are computed from the rules, so neither promotes a product you have excluded.
// There are no Strong/Medium/Light tiers: they do not exist in the product.
// Keyboard: Tab/Space; arrows follow reading direction and do not wrap. Reduced motion (OS or data-aicc-motion="reduce"): no count-up.
import { icon } from "./icons.js";
import { esc, motionAllowed, setLang } from "./motion.js";
import { applyRules } from "./rules-core.js";

const ANCHOR = { id: "kit", price: 38, icon: "coffee" };
// AICC's own order for the sample product. tier: learned (counted from orders) | category (same-category fallback).
const WITH = [
  { id: "filters", price: 14, icon: "filter", tier: "learned", count: 48 },
  { id: "grinder", price: 46, icon: "cog", tier: "learned", count: 31 },
  { id: "kettle", price: 52, icon: "flame", tier: "learned", count: 12 },
  { id: "mug", price: 16, icon: "cup-soda", tier: "category", count: 0 },
];
const WITHOUT = [
  { id: "mug", price: 16, icon: "cup-soda" },
  { id: "towel", price: 18, icon: "layers" },
  { id: "scale", price: 24, icon: "package" },
];
const BASE_TILES = { views: 1240, clicks: 86, adds: 31 };

const money = (n) => "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

/** "Add N products to cart": exact 1 uses addOne; Russian "few" (2-4) uses addFew; otherwise addMany. */
export function addToCartText(locale, w, count) {
  if (count === 1) return w.addOne;
  const cat = new Intl.PluralRules(locale).select(count);
  return (locale === "ru" && cat === "few" ? w.addFew : w.addMany).replace("{count}", String(count));
}

/**
 * Mount into `el`. opts: { strings (the "demo" strings of one locale), locale, dir ("ltr"|"rtl"), assets: { reco } }
 * strings._fallback === true means the strings are English on a page of another language (the container is marked lang="en" dir="ltr").
 */
export function mountFbt(el, opts) {
  if (!el || el.dataset.aiccReady === "mounted") return;
  el.dataset.aiccReady = "mounted";
  const s = opts.strings;
  const locale = opts.locale || "en";
  const fallback = !!s._fallback;
  setLang(el, s, locale, opts.dir || el.dataset.dir);
  const rtl = !fallback && (opts.dir || document.documentElement.dir) === "rtl";
  const num = new Intl.NumberFormat(fallback ? "en" : locale);
  const state = { mode: "with", view: "shopper", switched: false, checked: { kit: true }, last: null, added: false, shown: ANCHOR.price, raf: 0, rules: [], seq: 0, addsDelta: 0, announce: "" };

  el.classList.add("aicc-fbt");
  el.removeAttribute("aria-busy");
  el.innerHTML =
    `<div class="aicc-fbt__glow" aria-hidden="true"></div>` +
    `<div class="aicc-fbt__main"><div class="aicc-fbt__widget">` +
    `<div class="aicc-fbt__top"><p class="aicc-fbt__label">${icon("info", 18)}<span>${esc(s.label)}</span></p>` +
    `<div class="aicc-fbt__controls">` +
    `<div role="group" aria-label="${esc(s.view.legend)}" class="aicc-fbt__views">` +
    `<button type="button" class="aicc-fbt__view" data-view="shopper" aria-pressed="true">${esc(s.view.shopper)}</button>` +
    `<button type="button" class="aicc-fbt__view" data-view="merchant" aria-pressed="false">${esc(s.view.merchant)}</button></div>` +
    `<div role="group" aria-label="${esc(s.mode.legend)}" class="aicc-fbt__modes" data-modes>` +
    `<button type="button" class="aicc-fbt__mode" data-mode="without" aria-pressed="false">${esc(s.mode.without)}</button>` +
    `<button type="button" class="aicc-fbt__mode" data-mode="with" aria-pressed="true">${esc(s.mode.with)}</button></div></div></div>` +
    `<p class="aicc-fbt__result" aria-live="polite" aria-atomic="true" data-result></p>` +
    `<p class="aicc-fbt__nudge">${esc(s.nudge)}</p>` +
    `<div data-panel="shopper" class="aicc-fbt__panel">` +
    `<div class="aicc-fbt__head"><h3 data-title></h3><p data-sub></p><p class="aicc-sr-only" data-subsr hidden>${esc(s.mode.withCaption)}</p></div>` +
    `<div data-bundle>` +
    `<fieldset class="aicc-fbt__fieldset"><legend class="aicc-sr-only">${esc(s.groupLabel)}</legend><div data-anchor></div><ul class="aicc-fbt__cands" data-cands></ul></fieldset>` +
    `<p class="aicc-fbt__hint" data-kbd>${esc(s.keyboardHint)}</p>` +
    `<div class="aicc-fbt__foot"><p class="aicc-fbt__total"><span>${esc(s.widget.bundleTotal)}</span><strong><bdi data-total></bdi></strong></p>` +
    `<button type="button" class="aicc-btn aicc-btn--primary" data-add aria-disabled="false"><span data-add-icon></span><span data-add-text></span></button></div>` +
    `<p class="aicc-fbt__status" data-status></p></div>` +
    `<div data-plain hidden><ul class="aicc-fbt__plain" data-plainlist></ul><p class="aicc-fbt__hint">${esc(s.plainHint)}</p></div></div>` +
    `<div data-panel="merchant" class="aicc-fbt__panel aicc-fbt__merchant" hidden>` +
    `<div class="aicc-fbt__head"><h3>${esc(s.merchant.heading)}</h3><p>${esc(s.merchant.intro)}</p></div>` +
    `<p class="aicc-fbt__ctx"><span class="aicc-fbt__ctxthumb" aria-hidden="true">${icon(ANCHOR.icon, 18)}</span><span>${esc(s.merchant.forProduct)} <strong>${esc(s.products[ANCHOR.id])}</strong></span><em>${esc(s.merchant.sameBundle)}</em></p>` +
    `<div class="aicc-fbt__rows" role="table" aria-label="${esc(s.merchant.heading)}"><div class="aicc-fbt__rowhead" role="row"><span role="columnheader">${esc(s.merchant.colProduct)}</span><span role="columnheader">${esc(s.merchant.colWhy)}</span><span role="columnheader">${esc(s.merchant.colRule)}</span></div><div data-rows class="aicc-fbt__rowbody"></div></div>` +
    `<p class="aicc-fbt__now" data-now></p>` +
    `<p class="aicc-fbt__hint">${esc(s.merchant.ruleNote)} ${esc(s.merchant.previewNote)}</p>` +
    `<div class="aicc-fbt__tilebox"><h3>${esc(s.merchant.tilesHeading)}</h3><ul class="aicc-fbt__tiles" data-tiles></ul><p class="aicc-fbt__hint">${esc(s.merchant.tileNote)}</p></div>` +
    `<div class="aicc-fbt__extras" data-extras></div></div>` +
    `<p class="aicc-sr-only" role="status" data-announce></p>` +
    `</div>` +
    `<div class="aicc-fbt__whyinline"><h3>${esc(s.why.heading)}</h3><p data-why-inline></p></div></div>` +
    `<aside class="aicc-fbt__why" aria-labelledby="fbt-why-h"><div class="aicc-fbt__reco"><img src="${esc(opts.assets?.reco || "")}" alt="" width="96" height="137" loading="lazy" decoding="async"><p class="aicc-fbt__bubble" data-bubble></p></div><h3 id="fbt-why-h">${esc(s.why.heading)}</h3><p class="aicc-fbt__recointro">${esc(s.why.recoIntro)}</p><p data-why></p></aside>`;

  const $ = (sel) => el.querySelector(sel);
  const boxes = [];
  const withShown = () => applyRules(WITH, state.rules).shown;
  const items = () => (state.mode === "with" ? [ANCHOR, ...withShown()] : []);
  const nameOf = (id) => s.products[id];
  const ruleOf = (id) => state.rules.find((r) => r.id === id)?.action || "none";
  const list = (names) => (names.length ? names.join(", ") : s.merchant.listEmpty);

  const cardHTML = (it, meta, anchor) =>
    `<label class="aicc-fbt-card" data-checked="${!!state.checked[it.id]}"${anchor ? ' data-anchor="true"' : ""}>` +
    `<input type="checkbox" data-id="${it.id}"${state.checked[it.id] ? " checked" : ""}>` +
    `<span class="aicc-fbt-card__thumb" aria-hidden="true">${icon(it.icon, 26)}</span>` +
    `<span class="aicc-fbt-card__body"><span class="aicc-fbt-card__name">${esc(nameOf(it.id))}</span><span class="aicc-fbt-card__price"><bdi>${money(it.price)}</bdi></span>${meta}</span></label>`;

  function renderList() {
    $("[data-anchor]").innerHTML = cardHTML(ANCHOR, `<span class="aicc-fbt__tag">${esc(s.anchorTag)}</span>`, true);
    $("[data-cands]").innerHTML = withShown().map((c) => `<li>${cardHTML(c, "", false)}</li>`).join("");
    $("[data-plainlist]").innerHTML = WITHOUT.map((c) => `<li class="aicc-fbt-plain"><span class="aicc-fbt-card__thumb" aria-hidden="true">${icon(c.icon, 26)}</span><span class="aicc-fbt-card__name">${esc(nameOf(c.id))}</span><span class="aicc-fbt-card__price"><bdi>${money(c.price)}</bdi></span></li>`).join("");
    boxes.length = 0;
    el.querySelectorAll('[data-bundle] input[type="checkbox"]').forEach((b) => boxes.push(b));
  }

  const why = (it) => (it.tier === "category" ? s.merchant.fallback : s.merchant.boughtTogether.replace("{n}", num.format(it.count)));
  /** The strongest learned partner that is still in the list (an excluded product is never promoted). */
  const strongest = () => WITH.filter((it) => it.tier === "learned" && ruleOf(it.id) !== "exclude").sort((a, b) => b.count - a.count)[0];

  function renderMerchant(refocus) {
    const { shown, hidden } = applyRules(WITH, state.rules);
    const sel = (id) =>
      `<label class="aicc-fbt-row__rule"><span class="aicc-sr-only">${esc(s.merchant.ruleLabel.replace("{product}", nameOf(id)))}</span>` +
      `<select data-rule="${id}">${["none", "pin", "prefer", "deprioritize", "exclude"].map((a) => `<option value="${a}"${ruleOf(id) === a ? " selected" : ""}>${esc(s.merchant.rules[a])}</option>`).join("")}</select></label>`;
    $("[data-rows]").innerHTML =
      shown.map((it, i) => `<div class="aicc-fbt-row" role="row" data-id="${it.id}"><span class="aicc-fbt-row__name" role="cell"><span class="aicc-fbt-row__pos" aria-hidden="true">${i + 1}</span><span><span class="aicc-sr-only">${esc(s.merchant.position.replace("{n}", String(i + 1)))}: </span>${esc(nameOf(it.id))}</span></span><span class="aicc-fbt-row__why" role="cell" data-kind="${it.tier}">${esc(why(it))}</span><span role="cell">${sel(it.id)}</span></div>`).join("") +
      hidden.map(({ item }) => `<div class="aicc-fbt-row" role="row" data-id="${item.id}" data-hidden="true"><span class="aicc-fbt-row__name" role="cell"><span class="aicc-fbt-row__pos" aria-hidden="true">–</span><span>${esc(nameOf(item.id))}</span></span><span class="aicc-fbt-row__why" role="cell">${esc(s.merchant.excluded)}</span><span role="cell">${sel(item.id)}</span></div>`).join("");
    if (refocus) $(`[data-rows] select[data-rule="${refocus}"]`)?.focus();
    $("[data-now]").innerHTML = `<strong>${esc(s.merchant.shopperNow)}</strong> <span data-now-list>${esc(list(shown.map((it) => nameOf(it.id))))}</span>`;
    const t = { ...BASE_TILES, adds: BASE_TILES.adds + state.addsDelta };
    $("[data-tiles]").innerHTML = ["views", "clicks", "adds"].map((k) =>
      `<li class="aicc-fbt-tile" data-tile="${k}"><span class="aicc-fbt-tile__label">${esc(s.merchant.tiles[k])}</span><strong><bdi>${num.format(t[k])}</bdi></strong>${k === "adds" && state.addsDelta ? `<span class="aicc-fbt-tile__delta">${esc(s.merchant.tileAdded)}</span>` : ""}</li>`).join("");
    // One observation and one Ask Reco line about THIS bundle, from the strongest partner that is still listed.
    const top = strongest();
    $("[data-extras]").innerHTML =
      `<section class="aicc-fbt__insight"><h3>${esc(s.merchant.insightHeading)}</h3>` +
      (top
        ? `<p class="aicc-fbt__itype">${icon("lightbulb", 16)}<span>${esc(s.merchant.insightTitle)}</span></p><p>${esc(s.merchant.insightBody.replace("{product}", nameOf(top.id)))}</p><p class="aicc-fbt__imetric">${esc(s.merchant.insightMetric)}: <strong><bdi>${num.format(top.count)}</bdi></strong></p>`
        : `<p>${esc(s.merchant.insightNone)}</p>`) +
      `</section>` +
      `<section class="aicc-fbt__askline"><h3>${esc(s.merchant.askHeading)}</h3><p class="aicc-fbt__aq">${esc(s.merchant.askQuestion)}</p><p class="aicc-fbt__aa"><span>${esc(s.merchant.askLabel)}</span>${esc(top ? s.merchant.askAnswer.replace("{product}", nameOf(top.id)).replace("{n}", num.format(top.count)) : s.merchant.askNone)}</p></section>`;
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

  /** The one-sentence outcome of the current state (also the polite live region for the toggles). */
  function resultText() {
    if (state.view === "merchant") return s.result.merchant;
    if (state.mode === "without") return s.result.without.replace("{names}", WITHOUT.map((x) => nameOf(x.id)).join(", "));
    const learned = withShown().filter((it) => it.tier === "learned");
    const fill = (t, a, b) => t.replace("{a}", nameOf(a.id)).replace("{na}", num.format(a.count)).replace("{b}", b ? nameOf(b.id) : "").replace("{nb}", b ? num.format(b.count) : "");
    if (learned.length >= 2) return fill(s.result.withTwo, learned[0], learned[1]);
    if (learned.length === 1) return fill(s.result.withOne, learned[0]);
    return s.result.withNone;
  }

  function update(speak = false) {
    const { mode, view } = state;
    const withMode = mode === "with";
    el.dataset.mode = mode;
    el.dataset.view = view;
    el.querySelectorAll("button[data-mode]").forEach((b) => { b.setAttribute("aria-pressed", b.dataset.mode === mode ? "true" : "false"); b.disabled = view === "merchant"; });
    el.querySelectorAll("button[data-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === view ? "true" : "false"));
    $('[data-panel="shopper"]').hidden = view === "merchant";
    $('[data-panel="merchant"]').hidden = view !== "merchant";
    $("[data-bundle]").hidden = !withMode;
    $("[data-plain]").hidden = withMode;
    el.querySelectorAll('[data-bundle] .aicc-fbt-card').forEach((card) => { const b = card.querySelector("input"); card.dataset.checked = String(b.checked); });
    const n = count(), t = total();
    const c = withShown();
    const lastItem = withMode ? c.find((x) => x.id === state.last && state.checked[x.id]) : undefined;
    const focus = lastItem || (withMode ? c.find((x) => state.checked[x.id]) : undefined);
    let whyText, reco;
    if (view === "merchant") { whyText = s.why.merchant; reco = s.reco.merchant; }
    else if (!withMode) { whyText = s.why.without; reco = s.reco.without; }
    else { whyText = focus ? s.why[focus.id] : s.why.none; reco = focus ? s.reco[focus.id] : s.reco.intro; }
    $("[data-result]").textContent = resultText();
    $(".aicc-fbt__nudge").hidden = state.switched;
    $("[data-title]").textContent = withMode ? s.widget.title : s.plain.title;
    $("[data-sub]").textContent = withMode ? s.widget.subtitle : s.plain.note;
    $("[data-subsr]").hidden = !withMode;
    $("[data-why]").textContent = whyText;
    $("[data-why-inline]").textContent = whyText;
    $("[data-bubble]").textContent = reco;
    if (withMode) animateTotal(t);
    const addBtn = $("[data-add]");
    addBtn.setAttribute("aria-disabled", String(n === 0));
    $("[data-add-icon]").innerHTML = icon(state.added ? "check" : "shopping-cart", 18);
    $("[data-add-text]").textContent = state.added ? s.widget.added : addToCartText(locale, s.widget, Math.max(1, n));
    $("[data-status]").textContent = n === 0 ? s.widget.selectAtLeastOne : state.added ? s.widget.noteAdd : "";
    $("[data-announce]").textContent = state.announce || (speak && withMode && view === "shopper" ? `${s.summary.replace("{count}", String(n)).replace("{total}", money(t))}${n === 0 ? ` ${s.widget.selectAtLeastOne}.` : ""}${state.added ? ` ${s.widget.added}.` : ""}` : "");
    state.announce = "";
  }

  el.addEventListener("change", (e) => {
    const sel = e.target.closest("select[data-rule]");
    if (sel) {
      const id = sel.dataset.rule, action = sel.value;
      state.rules = state.rules.filter((r) => r.id !== id);
      if (action !== "none") state.rules.push({ id, action, seq: ++state.seq });
      renderMerchant(id);
      renderList();
      state.announce = (action === "none" ? s.merchant.announceNone : s.merchant.announceRule).replace("{product}", nameOf(id)).replace("{rule}", s.merchant.rules[action]).replace("{list}", list(withShown().map((it) => nameOf(it.id))));
      update();
      return;
    }
    const b = e.target.closest('input[type="checkbox"]');
    if (!b) return;
    state.checked[b.dataset.id] = b.checked;
    state.last = b.dataset.id;
    state.added = false;
    update(true);
  });
  el.addEventListener("click", (e) => {
    const v = e.target.closest("button[data-view]");
    if (v) {
      state.view = v.dataset.view; state.switched = true;
      if (state.view === "merchant") state.mode = "with"; // the merchant side only exists for what AICC recommends
      renderList(); renderMerchant(); update();
      return;
    }
    const m = e.target.closest("button[data-mode]");
    if (m && !m.disabled) {
      state.mode = m.dataset.mode; state.switched = true; state.added = false;
      renderList(); update();
      return;
    }
    if (e.target.closest("[data-add]")) {
      if (count() > 0) { state.added = true; state.addsDelta++; renderMerchant(); update(true); }
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
  renderMerchant();
  state.shown = total();
  setTotalText(state.shown);
  update();
}
