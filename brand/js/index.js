// Brand kit entry point. `initBrand()` finds every kit component in the document and wires it. Idempotent (each element carries
// data-aicc-ready), so it can be called again after client-side navigation. Heavy parts (the demo, the modal) are dynamic imports,
// so a page that does not scroll to the demo never downloads it.
import { initSiteHeader } from "./header-scroll.js";
import { initLangMenu } from "./lang-menu.js";
import { initRecoHero } from "./reco-hero.js";

export { initSiteHeader, initLangMenu, initRecoHero };
export { renderRecoHeroHTML } from "./reco-hero.js";
export { renderLangMenuHTML } from "./lang-menu.js";
export { storeLang, LANG_KEY } from "./lang-store.js";
export { renderDashPreviewHTML, renderInsightsHTML } from "./dash-preview.js";
export { renderRecoAskHTML } from "./reco-ask.js";
export { renderFlowHTML } from "./flow.js";
export { renderLoopHTML } from "./loop.js";
export { initFaqSearch } from "./faq-search.js";
export { initTabs } from "./tabs.js";
export { applyRules, RULE_ACTIONS } from "./rules-core.js";
export { motionAllowed, isCoarsePointer, onMotionChange } from "./motion.js";

/**
 * ctx: { assetsBase: "/brand-kit", strings?: brand/i18n/strings.json }. Containers may carry their own strings as JSON in data-strings
 * (the site does); otherwise they come from ctx.strings[locale] (the theme can pass strings.json).
 */
let anchorAt = 0;
export function initBrand(ctx = {}, root = document) {
  if (!document.documentElement.dataset.aiccAnchors) {
    document.documentElement.dataset.aiccAnchors = "1";
    document.addEventListener("click", (e) => { if (e.target.closest?.('a[href^="#"], a[href*="/#"]')) anchorAt = Date.now(); }, true);
  }
  root.querySelectorAll("[data-aicc-header]").forEach(initSiteHeader);
  root.querySelectorAll("[data-aicc-lang]").forEach(initLangMenu);
  root.querySelectorAll("[data-aicc-reco-hero]").forEach(initRecoHero);

  root.querySelectorAll("[data-aicc-demo-trigger]").forEach((t) => {
    if (t.dataset.aiccBound) return;
    t.dataset.aiccBound = "1";
    // The modal module loads on the first click (and re-fires the click), so pages that never open it never download it.
    t.addEventListener("click", async () => {
      if (t.dataset.aiccReady) return;
      const { initVideoModal } = await import("./video-modal.js");
      const strings = t.dataset.strings ? JSON.parse(t.dataset.strings) : ctx.strings?.[t.dataset.locale || document.documentElement.lang]?.modal || ctx.strings?.en?.modal;
      initVideoModal(t, strings);
      t.click();
    });
  });

  // Interactive modules, mounted lazily when they near the viewport. Each container carries its own strings (data-strings JSON, the site)
  // or takes them from ctx.strings[locale][key] (the theme passes brand/i18n/strings.json). strings._fallback === true means English text on a page
  // of another language: the module marks its container lang="en" dir="ltr".
  const lazy = (selector, key, load) => {
    const els = root.querySelectorAll(selector);
    if (!els.length) return;
    const mount = async (el) => {
      if (el.dataset.aiccLoading) return;
      el.dataset.aiccLoading = "1";
      const mod = await load();
      const locale = el.dataset.locale || "en";
      const strings = el.dataset.strings ? JSON.parse(el.dataset.strings) : ctx.strings?.[locale]?.[key] || ctx.strings?.en?.[key];
      mod(el, { strings, locale, dir: el.dataset.dir, assetsBase: ctx.assetsBase || "", assets: { reco: `${ctx.assetsBase || ""}/reco-thinking-480.webp` } });
      // A module above an in-page link target changes the page height after the jump: land on the target again (only right after a click on such a link).
      if (Date.now() - anchorAt < 2500 && location.hash.length > 1) {
        const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (t) t.scrollIntoView({ block: "start", behavior: "auto" });
      }
    };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); mount(en.target); } }), { rootMargin: "600px 0px" });
      els.forEach((el) => io.observe(el));
      // Whatever is still unmounted a moment after load is mounted while the browser is idle, so the page has its final height before anyone taps a jump link.
      const idle = () => els.forEach((el) => { io.unobserve(el); mount(el); });
      const later = () => (window.requestIdleCallback ? window.requestIdleCallback(idle, { timeout: 4000 }) : setTimeout(idle, 2500));
      if (document.readyState === "complete") setTimeout(later, 1200); else window.addEventListener("load", () => setTimeout(later, 1200), { once: true });
    } else els.forEach(mount);
  };
  lazy("[data-aicc-fbt]", "demo", async () => (await import("./fbt-demo.js")).mountFbt);
  lazy("[data-aicc-rules]", "rules", async () => (await import("./rules-demo.js")).mountRules);
  lazy("[data-aicc-dash]:not([data-aicc-ssr])", "dash", async () => (await import("./dash-preview.js")).mountDashPreview);
  lazy("[data-aicc-ask]:not([data-aicc-ssr])", "ask", async () => (await import("./reco-ask.js")).mountRecoAsk);
  // FAQ search: wired at once (not on scroll) because ?q= and #qNN deep links must work on load. The module is small and loads on demand.
  root.querySelectorAll("[data-aicc-faq-search]").forEach(async (el) => {
    const locale = el.dataset.locale || "en";
    const strings = el.dataset.strings ? JSON.parse(el.dataset.strings) : ctx.strings?.[locale]?.faqSearch || ctx.strings?.en?.faqSearch;
    (await import("./faq-search.js")).initFaqSearch(el, { strings, locale });
  });
  // Tabbed workspaces ([data-aicc-tabs]) and the loop strip ([data-aicc-loop]) are server-rendered; these only add behavior.
  const tabs = root.querySelectorAll("[data-aicc-tabs]");
  if (tabs.length) import("./tabs.js").then((m) => tabs.forEach((el) => m.initTabs(el)));
  const loops = root.querySelectorAll("[data-aicc-loop]");
  if (loops.length) import("./loop.js").then((m) => loops.forEach((el) => m.initLoop(el)));
  // Server-rendered Ask Reco panels only need their two sample-question buttons wired.
  const ssrAsk = root.querySelectorAll("[data-aicc-ask][data-aicc-ssr]");
  if (ssrAsk.length) import("./reco-ask.js").then((m) => ssrAsk.forEach(m.initRecoAsk));
}
