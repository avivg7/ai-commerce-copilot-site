// "Control, not a black box": a small interactive illustration of the four merchant rules on a SAMPLE product list.
// Mounted by data-aicc-rules (see index.js). Strings: strings.json[locale].rules. Truthful semantics come from rules-core.js:
// Pin -> first place; Exclude -> removed and always wins; Prefer -> up one place; Deprioritize -> down one place; out-of-stock products stay out even when pinned.
// Keyboard: a native <select> for the product, four toggle buttons (aria-pressed), Reset; every change is announced in one polite live region.
// Reduced motion: nothing animates here except a short highlight that is switched off by the motion tokens.
import { setLang, labeler } from "./motion.js";
import { applyRules, RULE_ACTIONS } from "./rules-core.js";

const BASE = [
  { id: "filters", tier: "learned", count: 48, inStock: true },
  { id: "grinder", tier: "learned", count: 31, inStock: true },
  { id: "kettle", tier: "learned", count: 12, inStock: true },
  { id: "mug", tier: "category", inStock: true },
  { id: "towel", tier: "category", inStock: true },
  { id: "travel", tier: "category", inStock: false },
];
let uid = 0;

export function mountRules(el, opts) {
  if (!el || el.dataset.aiccReady === "mounted") return;
  el.dataset.aiccReady = "mounted";
  const s = opts.strings;
  const locale = opts.locale || "en";
  const fallback = !!s._fallback;
  setLang(el, s, locale, opts.dir || el.dataset.dir);
  const { T } = labeler(s, { locale });
  const num = new Intl.NumberFormat(fallback ? "en" : locale);
  const id = `aicc-rules-${++uid}`;
  const state = { product: BASE[0].id, rules: [], seq: 0, effect: "", help: "none", announce: "", moved: null };
  const name = (pid) => s.products[pid];

  el.classList.add("aicc-rules");
  el.removeAttribute("aria-busy");
  el.innerHTML =
    `<p class="aicc-rules__label">${T(s.label)}</p>` +
    `<div class="aicc-rules__grid">` +
    `<div class="aicc-rules__panel aicc-rules__controls">` +
    `<div class="aicc-rules__field"><label for="${id}-product">${T(s.productLabel)}</label>` +
    `<select id="${id}-product" data-product>${BASE.map((b) => `<option value="${b.id}">${T(name(b.id))}</option>`).join("")}</select></div>` +
    `<div class="aicc-rules__field"><span id="${id}-act">${T(s.actionLabel)}</span>` +
    `<div class="aicc-rules__actions" role="group" aria-labelledby="${id}-act">${RULE_ACTIONS.map((a) => `<button type="button" class="aicc-rules__btn" data-action="${a}" aria-pressed="false" aria-describedby="${id}-help">${T(s.actions[a])}</button>`).join("")}</div></div>` +
    `<p class="aicc-rules__help" id="${id}-help" data-help></p>` +
    `<p class="aicc-rules__effect" data-effect></p>` +
    `<div class="aicc-rules__active"><p class="aicc-rules__sub">${T(s.activeHeading)}</p><ul data-active class="aicc-rules__chips"></ul></div>` +
    `<button type="button" class="aicc-btn aicc-btn--outline aicc-btn--sm" data-reset>${T(s.reset)}</button>` +
    `</div>` +
    `<div class="aicc-rules__panel aicc-rules__result"><h3>${T(s.heading)}</h3><ol class="aicc-rules__list" data-list></ol>` +
    `<p class="aicc-rules__sub">${T(s.hiddenHeading)}</p><ul class="aicc-rules__hidden" data-hidden></ul></div>` +
    `</div>` +
    `<p class="aicc-sr-only" role="status" data-announce></p>` +
    `<p class="aicc-rules__small">${T(s.smallprint)}</p>`;

  const $ = (q) => el.querySelector(q);
  const ruleOf = (pid) => state.rules.find((r) => r.id === pid);
  const evidence = (b) => (!b.inStock ? s.evidence.outOfStock : b.tier === "learned" ? s.evidence.learned.replace("{n}", num.format(b.count)) : s.evidence.fallback);

  function render() {
    const { shown, hidden } = applyRules(BASE, state.rules);
    $("[data-list]").innerHTML = shown.map((b, i) => {
      const r = ruleOf(b.id);
      return `<li data-id="${b.id}"${state.moved === b.id ? ' data-moved="true"' : ""}><span class="aicc-rules__pos" aria-hidden="true">${i + 1}</span><span class="aicc-rules__name"><span class="aicc-sr-only">${T(s.place.replace("{n}", String(i + 1)))}: </span>${T(name(b.id))}<small>${T(evidence(b))}</small></span>${r ? `<span class="aicc-rules__tag" data-action="${r.action}">${T(s.tags[r.action])}</span>` : ""}</li>`;
    }).join("");
    $("[data-hidden]").innerHTML = hidden.length
      ? hidden.map(({ item, reason }) => `<li><span>${T(name(item.id))}</span><small>${T(reason === "outOfStock" ? s.effect.outOfStock : s.effect.exclude)}</small></li>`).join("")
      : `<li class="aicc-rules__none">${T(s.hiddenNone)}</li>`;
    $("[data-active]").innerHTML = state.rules.length
      ? state.rules.map((r) => `<li><span class="aicc-rules__tag" data-action="${r.action}">${T(s.tags[r.action])}</span> ${T(name(r.id))}</li>`).join("")
      : `<li class="aicc-rules__none">${T(s.activeNone)}</li>`;
    const cur = ruleOf(state.product)?.action;
    el.querySelectorAll("[data-action]").forEach((b) => { if (b.tagName === "BUTTON") b.setAttribute("aria-pressed", String(b.dataset.action === cur)); });
    $("[data-help]").innerHTML = T(s.help[state.help] || s.help.none);
    $("[data-effect]").innerHTML = T(state.effect);
    $("[data-announce]").innerHTML = T(state.announce);
  }

  function listText() {
    const { shown, hidden } = applyRules(BASE, state.rules);
    return `${s.announceList.replace("{list}", shown.map((b) => name(b.id)).join(", "))} ${hidden.length ? s.announceHidden.replace("{list}", hidden.map((h) => name(h.item.id)).join(", ")) : ""}`.trim();
  }

  el.addEventListener("change", (e) => {
    if (!e.target.matches("[data-product]")) return;
    state.product = e.target.value;
    state.help = ruleOf(state.product)?.action || "none";
    state.effect = ruleOf(state.product) ? s.effect[ruleOf(state.product).action] : s.effect.none;
    state.moved = null; state.announce = "";
    render();
  });
  el.addEventListener("click", (e) => {
    const a = e.target.closest("button[data-action]");
    if (a) {
      const action = a.dataset.action, pid = state.product;
      const before = applyRules(BASE, state.rules).shown.findIndex((b) => b.id === pid);
      const had = ruleOf(pid);
      state.rules = state.rules.filter((r) => r.id !== pid);
      let effect;
      if (had && had.action === action) { effect = s.effect.none; state.help = "none"; }
      else {
        state.rules.push({ id: pid, action, seq: ++state.seq });
        state.help = action;
        const after = applyRules(BASE, state.rules).shown.findIndex((b) => b.id === pid);
        effect = s.effect[action];
        // The ranking is the backend's own (rules-core.js): a nudge can be blocked by a group boundary or by another product with the same kind of rule.
        if (action === "prefer" && after !== before - 1) effect = s.effect.stays;
        if (action === "deprioritize" && after <= before) effect = s.effect.stays;
        if (action === "pin" && !BASE.find((b) => b.id === pid).inStock) effect = s.effect.outOfStock;
      }
      state.effect = effect;
      state.moved = pid;
      state.announce = `${name(pid)}: ${effect} ${listText()}`;
      render();
      return;
    }
    if (e.target.closest("[data-reset]")) {
      state.rules = []; state.help = "none"; state.effect = ""; state.moved = null;
      state.announce = `${s.announceReset} ${listText()}`;
      render();
    }
  });
  render();
}
