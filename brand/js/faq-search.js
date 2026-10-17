// FAQ search / filter (vanilla; used by the site's Questions page and reusable on the Control Plane). Pure client-side:
// nothing is sent anywhere, nothing is stored (the query lives only in the input and, optionally, in the URL as ?q=).
//
// Markup contract (progressive enhancement: without JavaScript the page is simply the full list):
//   <div data-aicc-faq-search data-locale="en" data-dir="ltr" data-strings='{faqSearch strings JSON}'
//        data-target="#faq-browse" data-hide="#faq-top"></div>
//   #faq-browse   contains the questions: any number of <details id="qNN"> (optionally inside .aicc-accordion__item) and, optionally,
//                 [data-faq-group] wrappers (a topic: heading + its questions) that are hidden when none of their questions match.
//   data-hide     (optional) selector of blocks that duplicate questions (e.g. "Most asked before buying"); hidden while a filter is active.
// The module injects: a labelled <input type="search"> inside <form role="search">, a polite live region with the result count,
// and an empty state with a Clear button. It matches the question AND the answer, case- and diacritic-insensitively (Hebrew niqqud included),
// every word of the query has to appear (AND). ?q=term is read on load and kept in sync with history.replaceState.
// A #qNN link to a question the filter is hiding clears the filter first, so the anchor always works.
// Strings: strings.json[locale].faqSearch. strings._fallback === true means English text on another language's page (lang="en" dir="ltr").
import { esc } from "./motion.js";

const norm = (s) => String(s).normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
let uid = 0;

export function initFaqSearch(root, opts = {}) {
  if (!root || root.dataset.aiccReady === "wired") return;
  const strings = opts.strings || (root.dataset.strings ? JSON.parse(root.dataset.strings) : null);
  const target = document.querySelector(root.dataset.target || "[data-faq-list]");
  if (!strings || !target) return;
  root.dataset.aiccReady = "wired";
  const locale = root.dataset.locale || opts.locale || document.documentElement.lang || "en";
  const id = `aicc-faqs-${++uid}`;
  const s = strings;
  if (s._fallback) { root.setAttribute("lang", "en"); root.setAttribute("dir", "ltr"); }
  else if (root.dataset.dir) root.setAttribute("dir", root.dataset.dir);

  root.classList.add("aicc-faqsearch");
  root.classList.remove("aicc-faqsearch--placeholder");
  root.removeAttribute("aria-busy");
  root.innerHTML =
    `<form role="search" class="aicc-faqsearch__form" aria-label="${esc(s.label)}" novalidate>` +
    `<label class="aicc-faqsearch__label" for="${id}-q">${esc(s.label)}</label>` +
    `<div class="aicc-faqsearch__field"><input id="${id}-q" type="search" name="q" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="${esc(s.placeholder)}" aria-describedby="${id}-hint">` +
    `<button type="button" class="aicc-faqsearch__clear" data-clear hidden>${esc(s.clear)}</button></div>` +
    `<p class="aicc-faqsearch__hint" id="${id}-hint">${esc(s.hint)}</p></form>` +
    `<p class="aicc-sr-only" role="status" aria-live="polite" data-count></p>` +
    `<div class="aicc-faqsearch__empty" data-empty hidden><p data-empty-text></p><button type="button" class="aicc-btn aicc-btn--outline aicc-btn--sm" data-clear>${esc(s.clear)}</button></div>`;

  const input = root.querySelector("input");
  const count = root.querySelector("[data-count]");
  const empty = root.querySelector("[data-empty]");
  const emptyText = root.querySelector("[data-empty-text]");
  const inlineClear = root.querySelector(".aicc-faqsearch__clear");
  const hideBlocks = (root.dataset.hide ? [...document.querySelectorAll(root.dataset.hide)] : []);
  const items = [...target.querySelectorAll("details[id]")].map((d) => ({ d, box: d.closest(".aicc-accordion__item") || d, text: norm(d.textContent) }));
  const groups = [...target.querySelectorAll("[data-faq-group]")];
  const plural = new Intl.PluralRules(locale);
  const message = (n, q) => {
    const m = s.results;
    const form = n === 1 ? "one" : m[plural.select(n)] ? plural.select(n) : "other";
    return (m[form] || m.other).replace("{n}", String(n)).replace("{q}", q);
  };

  function apply(raw, { syncUrl = true } = {}) {
    const q = raw.trim();
    const words = norm(q).split(" ").filter(Boolean);
    let shown = 0;
    for (const it of items) {
      const hit = !words.length || words.every((w) => it.text.includes(w));
      it.box.hidden = !hit;
      if (hit) shown++;
    }
    for (const g of groups) g.hidden = !!words.length && !g.querySelector(".aicc-accordion__item:not([hidden]), details[id]:not([hidden])");
    for (const b of hideBlocks) b.hidden = !!words.length;
    target.hidden = !!words.length && shown === 0;
    empty.hidden = !(words.length && shown === 0);
    inlineClear.hidden = !input.value;
    if (words.length) {
      emptyText.textContent = s.empty.replace("{q}", q);
      count.textContent = shown ? message(shown, q) : s.empty.replace("{q}", q);
    } else count.textContent = "";
    root.dataset.filtering = words.length ? "true" : "false";
    if (syncUrl) {
      const u = new URL(location.href);
      if (words.length) u.searchParams.set("q", q); else u.searchParams.delete("q");
      history.replaceState(history.state, "", u);
    }
  }

  const clear = (focus = true) => { input.value = ""; apply(""); if (focus) input.focus(); };
  input.addEventListener("input", () => apply(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Escape" && input.value) { e.preventDefault(); clear(false); } });
  root.querySelector("form").addEventListener("submit", (e) => e.preventDefault());
  root.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) clear(); });

  // A link to #qNN must always land on a visible question.
  const reveal = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return;
    const el = document.getElementById(h) || document.querySelector(`details[data-aliases~="${CSS.escape(h)}"]`);
    if (el && el.closest("[hidden]")) clear(false);
  };
  window.addEventListener("hashchange", reveal);

  const initial = new URL(location.href).searchParams.get("q");
  if (initial) { input.value = initial; apply(initial, { syncUrl: false }); }
  reveal();
}
