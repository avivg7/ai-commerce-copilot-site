// Compact language control: globe + code + chevron -> small menu of real links (lang/hreflang, aria-current).
// Keyboard: Enter/Space/ArrowDown open and focus the current item; Up/Down/Home/End move (no wrap); Esc closes and returns focus;
// focus leaving or a click outside closes. The menu aligns to the logical end edge (RTL-safe). Inside the mobile menu use
// class aicc-lang--block (full-width disclosure). Persistence: with data-persist on the root, choosing a language stores it in the
// first-party cookie + localStorage "aicc_lang" (the Control Plane keeps its own URL-prefix logic and leaves data-persist off). With data-persist the links also carry the current ?query and #anchor.
import { icon } from "./icons.js";
import { esc } from "./motion.js";
import { storeLang } from "./lang-store.js";

export { LANG_KEY, storeLang } from "./lang-store.js";

/**
 * Markup for the control. items: [{ locale, label, href, htmlLang }]; current: locale code; short: "EN";
 * buttonLabel: "Language: English, EN". The visible code must appear as a whole word in the accessible name (WCAG 2.5.3 Label in Name;
 * axe checks it word-wise), hence the trailing ", EN".
 */
export function renderLangMenuHTML({ id, current, items, short, buttonLabel, currentWord = "", block = false, persist = false }) {
  const lis = items.map((it) => {
    const cur = it.locale === current;
    return `<li><a class="aicc-lang__item" href="${esc(it.href)}" lang="${esc(it.htmlLang || it.locale)}" hreflang="${esc(it.htmlLang || it.locale)}" data-lang="${esc(it.locale)}"${cur ? ' aria-current="true"' : ""}><span>${esc(it.label)}</span>${cur ? icon("check", 16) + (currentWord ? `<span class="aicc-sr-only">(${esc(currentWord)})</span>` : "") : ""}</a></li>`;
  }).join("");
  return `<div class="aicc-lang${block ? " aicc-lang--block" : ""}" data-aicc-lang${persist ? " data-persist" : ""}>` +
    `<button type="button" class="aicc-lang__btn" aria-expanded="false" aria-controls="${esc(id)}" aria-label="${esc(buttonLabel)}">${icon("globe", 18)}<span>${esc(short)}</span><span class="aicc-lang__chev">${icon("chevron-down", 14)}</span></button>` +
    `<ul id="${esc(id)}" class="aicc-lang__menu" hidden>${lis}</ul></div>`;
}

export function initLangMenu(root) {
  if (!root || root.dataset.aiccReady) return;
  root.dataset.aiccReady = "1";
  const btn = root.querySelector(".aicc-lang__btn");
  const menu = root.querySelector(".aicc-lang__menu");
  if (!btn || !menu) return;
  const items = () => [...menu.querySelectorAll("a")];
  const isOpen = () => btn.getAttribute("aria-expanded") === "true";
  const open = (focusItem) => {
    btn.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    if (focusItem) (menu.querySelector('[aria-current="true"]') || items()[0])?.focus();
  };
  const close = (returnFocus) => {
    btn.setAttribute("aria-expanded", "false");
    menu.hidden = true;
    if (returnFocus) btn.focus();
  };
  btn.addEventListener("click", (e) => (isOpen() ? close(false) : open(e.detail === 0)));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); open(true); } // stop: the root handler would move on to the 2nd item
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) { e.stopPropagation(); close(true); return; }
    if (!menu.contains(document.activeElement)) return;
    const list = items();
    const i = list.indexOf(document.activeElement);
    let n = -1;
    if (e.key === "ArrowDown") n = Math.min(list.length - 1, i + 1);
    else if (e.key === "ArrowUp") n = Math.max(0, i - 1);
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = list.length - 1;
    if (n >= 0) { e.preventDefault(); list[n].focus(); }
  });
  root.addEventListener("focusout", (e) => {
    if (isOpen() && !root.contains(e.relatedTarget)) close(false);
  });
  document.addEventListener("pointerdown", (e) => {
    if (isOpen() && !root.contains(e.target)) close(false);
  });
  if (root.hasAttribute("data-persist")) {
    // The site's switcher keeps the query (?q= of the FAQ search) and the #anchor when it changes language: the links are refreshed whenever the menu
    // opens and when the hash changes (ids such as #q41 or #compare are the same in every language). Without JavaScript they stay plain page links.
    const keep = () => items().forEach((a) => {
      a.dataset.baseHref = a.dataset.baseHref || a.getAttribute("href").replace(/[?#].*$/, "");
      a.setAttribute("href", a.dataset.baseHref + location.search + location.hash);
    });
    keep();
    window.addEventListener("hashchange", keep);
    btn.addEventListener("click", keep);
    btn.addEventListener("keydown", keep);
    menu.addEventListener("focusin", keep);
    menu.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-lang]");
      if (a) storeLang(a.dataset.lang);
    });
  }
}
