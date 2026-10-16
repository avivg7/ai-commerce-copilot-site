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
export { motionAllowed, isCoarsePointer, onMotionChange } from "./motion.js";

/**
 * ctx: { assetsBase: "/brand-kit", strings?: brand/i18n/strings.json }. Containers may carry their own strings as JSON in data-strings
 * (the site does); otherwise they come from ctx.strings[locale] (the theme can pass strings.json).
 */
export function initBrand(ctx = {}, root = document) {
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

  const fbts = root.querySelectorAll("[data-aicc-fbt]");
  if (fbts.length) {
    const mount = async (el) => {
      if (el.dataset.aiccLoading) return;
      el.dataset.aiccLoading = "1";
      const { mountFbt } = await import("./fbt-demo.js");
      const locale = el.dataset.locale || "en";
      const strings = el.dataset.strings ? JSON.parse(el.dataset.strings) : ctx.strings?.[locale]?.demo || ctx.strings?.en?.demo;
      mountFbt(el, { strings, locale, dir: el.dataset.dir, assets: { reco: `${ctx.assetsBase || ""}/reco-thinking-480.webp` } });
    };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); mount(en.target); } }), { rootMargin: "600px 0px" });
      fbts.forEach((el) => io.observe(el));
    } else fbts.forEach(mount);
  }
}
