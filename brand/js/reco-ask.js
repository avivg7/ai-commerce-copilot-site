// Ask Reco panel mockup: what the helper looks like inside the WordPress admin, with SAMPLE questions and answers.
// Honest about what Reco is: answers come from your own dashboard data, are built from fixed rules, give information and links,
// and never change settings. It is a labelled SAMPLE CONVERSATION: the two sample questions are real buttons that swap the answer;
// there is deliberately no text input (a field that does nothing would look like a broken chat).
// renderRecoAskHTML(strings, opts) -> markup (server-rendered by the site); initRecoAsk(el) wires the two sample-question buttons.
// Strings: strings.json[locale].ask. opts: { assetsBase, locale, dir }
import { icon } from "./icons.js";
import { esc, langAttrs, labeler } from "./motion.js";

const KEYS = ["next", "perf"];

export function renderRecoAskHTML(s, o = {}) {
  const { T } = labeler(s, o);
  const logo = o.assetsBase !== undefined ? `<img src="${esc(o.assetsBase)}/aicc-logomark.svg" alt="" width="24" height="24" decoding="async">` : "";
  return (
    `<div class="aicc-ask"${langAttrs(s, o)} data-aicc-ask data-aicc-ssr>` +
    `<p class="aicc-ask__label">${icon("info", 16)}<span>${T(s.label)}</span></p>` +
    `<div class="aicc-ask__panel"><div class="aicc-ask__head">${logo}<span>${T(s.title)}</span></div>` +
    `<p class="aicc-ask__try" id="aicc-ask-try">${T(s.suggestionsLabel)}</p>` +
    `<div class="aicc-ask__chips" role="group" aria-labelledby="aicc-ask-try">` +
    KEYS.map((k, i) => `<button type="button" class="aicc-ask__chip" data-qa="${k}" aria-pressed="${i === 0}">${T(s.qa[k].q)}</button>`).join("") +
    `</div><div class="aicc-ask__thread" aria-live="polite">` +
    KEYS.map((k, i) => `<div class="aicc-ask__pair" data-pair="${k}"${i ? " hidden" : ""}><p class="aicc-ask__q">${T(s.qa[k].q)}</p>` +
      `<div class="aicc-ask__a"><span class="aicc-ask__who">${T(s.answerLabel)}</span><p>${T(s.qa[k].a)}</p><span class="aicc-ask__link">${T(s.qa[k].link)}${icon("arrow-right", 14)}</span></div></div>`).join("") +
    `</div></div>` +
    `<p class="aicc-ask__foot">${T(s.footnote)}</p></div>`
  );
}

export function initRecoAsk(el) {
  if (!el || el.dataset.aiccReady === "wired") return;
  el.dataset.aiccReady = "wired";
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-qa]");
    if (!b) return;
    el.querySelectorAll("button[data-qa]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    el.querySelectorAll("[data-pair]").forEach((p) => { p.hidden = p.dataset.pair !== b.dataset.qa; });
  });
}

export function mountRecoAsk(el, opts) {
  if (!el || el.dataset.aiccReady) return;
  el.innerHTML = renderRecoAskHTML(opts.strings, { assetsBase: opts.assetsBase });
  el.firstElementChild.removeAttribute("data-aicc-ask");
  initRecoAsk(el);
}
