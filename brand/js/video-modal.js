// "Watch demo" modal: a native <dialog> (focus trap, Esc, backdrop click, focus returns to the trigger), body scroll lock, responsive 16:9
// player, <video controls playsinline preload="metadata"> with poster + <track kind="captions">, pauses and resets on close.
// Configuration, NO fake footage: the trigger carries data-demo-video / data-demo-poster / data-demo-captions (+ data-demo-captions-lang, default: the page language).
// On the site these come from NEXT_PUBLIC_DEMO_VIDEO_SRC / _POSTER / _CAPTIONS / _CAPTIONS_LANG at build time (docs/watch-demo-video.md); tested by `npm run test:video`.
// With no video configured the same frame shows a calm, clearly labelled placeholder (data-demo-placeholder="true"), which
// `npm run launch:check` treats as a launch blocker.
import { icon } from "./icons.js";
import { esc, motionAllowed } from "./motion.js";

let counter = 0;

/** strings: { title, close, placeholder, tryDemo, captionsLabel } */
export function initVideoModal(trigger, strings) {
  if (!trigger || trigger.dataset.aiccReady) return;
  trigger.dataset.aiccReady = "1";
  let dialog = null;
  let goDemo = false;

  const build = () => {
    const id = `aicc-modal-${++counter}`;
    const video = trigger.dataset.demoVideo || "";
    const poster = trigger.dataset.demoPoster || "";
    const caps = trigger.dataset.demoCaptions || "";
    const capsLang = trigger.dataset.demoCaptionsLang || document.documentElement.lang || "en";
    dialog = document.createElement("dialog");
    dialog.className = "aicc-modal";
    dialog.setAttribute("aria-labelledby", `${id}-t`);
    dialog.innerHTML =
      `<div class="aicc-modal__bar"><h2 class="aicc-modal__title" id="${id}-t">${esc(strings.title)}</h2>` +
      `<button type="button" class="aicc-modal__close" aria-label="${esc(strings.close)}">${icon("x", 22)}</button></div>` +
      `<div class="aicc-modal__player">` +
      (video
        ? `<video controls playsinline preload="metadata" aria-label="${esc(strings.title)}"${poster ? ` poster="${esc(poster)}"` : ""}><source src="${esc(video)}">${caps ? `<track kind="captions" src="${esc(caps)}" srclang="${esc(capsLang)}" label="${esc(strings.captionsLabel)}" default>` : ""}</video>`
        : `<div class="aicc-modal__placeholder" data-demo-placeholder="true">${icon("video", 36)}<p>${esc(strings.placeholder)}</p><button type="button" class="aicc-btn aicc-btn--primary" data-aicc-try-demo>${esc(strings.tryDemo)}</button></div>`) +
      `</div>`;
    document.body.appendChild(dialog);
    dialog.querySelector(".aicc-modal__close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    // With no video yet, the useful next step is the interactive demo: close the dialog, bring #demo into view and put focus on its heading.
    dialog.querySelector("[data-aicc-try-demo]")?.addEventListener("click", () => { goDemo = true; dialog.close(); });
    dialog.addEventListener("close", () => {
      document.documentElement.classList.remove("aicc-scroll-lock");
      const v = dialog.querySelector("video");
      if (v) { v.pause(); try { v.currentTime = 0; } catch {} }
      if (goDemo) {
        goDemo = false;
        const target = document.querySelector(trigger.dataset.demoTarget || "#demo");
        if (target) {
          target.scrollIntoView({ behavior: motionAllowed() ? "smooth" : "auto", block: "start" });
          const h = target.querySelector("h2, h3");
          if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
          return;
        }
      }
      trigger.focus();
    });
  };

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    if (!dialog) build();
    if (dialog.open) return;
    document.documentElement.classList.add("aicc-scroll-lock");
    dialog.showModal();
  });
}
