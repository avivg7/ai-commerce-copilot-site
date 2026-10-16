// The Reco hero: looping muted video (played only while >= 25% in view), blurred glow, five floating glass chips and a frame that
// tilts toward the cursor (spring-smoothed, intensity 6, perspective 1200px). Disabled under reduced motion (OS or
// data-aicc-motion="reduce": poster only, chips static, no tilt) and on touch (no tilt). The video never delays LCP: poster first,
// preload="metadata", playback starts lazily from the IntersectionObserver.
import { icon } from "./icons.js";
import { esc, isCoarsePointer, motionAllowed, onMotionChange } from "./motion.js";

export const CHIP_ICONS = ["trending-up", "mouse-pointer-click", "sparkles", "lightbulb", "package"];
// position index -> animation duration (slow = 7s, slower = 9s) and delay, exactly as on the live site.
const CHIP_TIMING = [["true", "0s"], ["false", "0.6s"], ["false", "1.1s"], ["true", "0.3s"], ["true", "1.5s"]];

/** Markup. labels: five truthful strings (no numbers). assets: { video, poster }. */
export function renderRecoHeroHTML({ labels, assets, videoLabel = "" }) {
  const chips = labels.map((label, i) => `<div class="aicc-reco-hero__chip" data-pos="${i + 1}" data-slow="${CHIP_TIMING[i][0]}" style="animation-delay:${CHIP_TIMING[i][1]}"><div class="aicc-reco-hero__chip-inner">${icon(CHIP_ICONS[i], 14)}${esc(label)}</div></div>`).join("");
  return `<div class="aicc-reco-hero" data-aicc-reco-hero>` +
    `<div class="aicc-reco-hero__glow" aria-hidden="true"></div>` +
    `<div class="aicc-reco-hero__frame" data-aicc-reco-frame>` +
    `<video class="aicc-reco-hero__video" src="${esc(assets.video)}" poster="${esc(assets.poster)}" width="1280" height="720" muted loop playsinline preload="metadata" aria-hidden="true" tabindex="-1"${videoLabel ? ` data-label="${esc(videoLabel)}"` : ""}></video>` +
    chips + `</div></div>`;
}

export function initRecoHero(root) {
  if (!root || root.dataset.aiccReady) return () => {};
  root.dataset.aiccReady = "1";
  const frame = root.querySelector("[data-aicc-reco-frame]") || root;
  const video = root.querySelector("video");
  let visible = false;

  const sync = () => {
    if (!video) return;
    if (visible && motionAllowed()) video.play().catch(() => {});
    else video.pause();
  };
  let io;
  if (video && "IntersectionObserver" in window) {
    io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: 0.25 });
    io.observe(video);
  }

  // Cursor tilt: a damped spring (stiffness 120, damping 16, mass 0.4) toward the pointer target.
  const INTENSITY = 6;
  let tx = 0, ty = 0, x = 0, y = 0, vx = 0, vy = 0, raf = 0, last = 0, listening = false;
  const apply = () => { frame.style.transform = Math.abs(x) < 0.01 && Math.abs(y) < 0.01 && !tx && !ty ? "" : `rotateX(${x.toFixed(3)}deg) rotateY(${y.toFixed(3)}deg)`; };
  const step = (t) => {
    const dt = Math.min(0.032, (t - (last || t)) / 1000 || 0.016); last = t;
    const k = 120, c = 16, m = 0.4;
    vx += ((k * (tx - x) - c * vx) / m) * dt; x += vx * dt;
    vy += ((k * (ty - y) - c * vy) / m) * dt; y += vy * dt;
    apply();
    if (Math.abs(vx) + Math.abs(vy) + Math.abs(tx - x) + Math.abs(ty - y) > 0.002) raf = requestAnimationFrame(step);
    else { raf = 0; last = 0; x = tx; y = ty; apply(); }
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(step); };
  const onMove = (e) => {
    const r = frame.getBoundingClientRect();
    ty = ((e.clientX - r.left) / r.width - 0.5) * INTENSITY;
    tx = -((e.clientY - r.top) / r.height - 0.5) * INTENSITY;
    kick();
  };
  const onLeave = () => { tx = 0; ty = 0; kick(); };
  const enableTilt = () => {
    if (listening || isCoarsePointer() || !motionAllowed()) return;
    listening = true;
    window.addEventListener("pointermove", onMove);
    frame.addEventListener("pointerleave", onLeave);
  };
  const disableTilt = () => {
    if (!listening) return;
    listening = false;
    window.removeEventListener("pointermove", onMove);
    frame.removeEventListener("pointerleave", onLeave);
    tx = ty = x = y = vx = vy = 0; frame.style.transform = "";
  };
  enableTilt();
  const off = onMotionChange(() => { if (motionAllowed()) enableTilt(); else disableTilt(); sync(); });
  return () => { io?.disconnect(); off(); disableTilt(); cancelAnimationFrame(raf); };
}
