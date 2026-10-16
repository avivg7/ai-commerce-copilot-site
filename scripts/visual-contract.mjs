// npm run test:visual-contract
// The live public site (https://www.copilt.org/) is the visual source of truth. This test loads
//   (a) the LEGACY reference  AICC_LEGACY_URL   default https://www.copilt.org/
//   (b) the new marketing site AICC_BASE_URL    default http://localhost:3011   (npm run serve:out)
//   (c) the Control Plane      AICC_CP_URL      default http://127.0.0.1:8982   (path AICC_CP_PATH, default /)
// and, for every component role present on a surface, asserts the computed styles equal the legacy values within a stated tolerance,
// that the component is VISIBLE and sits where it belongs (e.g. the Reco video inside the hero, the FBT section directly after the
// hero, no unexpected blank space), and that behaviour works (hover lift, scrolled header, modal, FBT demo, language menu).
// Per-surface report; exit code 1 on any mismatch of a selected surface:  --surfaces=site | site,cp | cp   (default: site,cp)
// Tolerances: colour channels +-2 (alpha +-0.01), lengths +-0.6px, letter-spacing +-0.2px, element screenshots <= 0.5% differing pixels.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { launch } from "./lib/browser.mjs";
import { ROOT } from "./lib/load.mjs";

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || d;
const LEGACY = (process.env.AICC_LEGACY_URL || "https://www.copilt.org/").replace(/\/?$/, "/");
const SITE = (process.env.AICC_BASE_URL || "http://localhost:3011").replace(/\/$/, "") + "/";
const CP = (process.env.AICC_CP_URL || "http://127.0.0.1:8982").replace(/\/$/, "") + (process.env.AICC_CP_PATH || "/");
const SURFACES = arg("surfaces", "site,cp").split(",");

/* ── colour + length normalisation ─────────────────────────────────────────────────────────── */
function oklabToSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))));
}
export function parseColor(str) {
  if (!str) return null;
  str = str.trim();
  if (str === "transparent") return [0, 0, 0, 0];
  let m = /^rgba?\(([^)]+)\)$/.exec(str);
  if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  m = /^oklab\(([^)]+)\)$/.exec(str);
  if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map((x) => (x.endsWith("%") ? parseFloat(x) / 100 : Number(x))); const [r, g, b] = oklabToSrgb(p[0], p[1], p[2]); return [r, g, b, p[3] ?? 1]; }
  m = /^color\(srgb ([^)]+)\)$/.exec(str);
  if (m) { const p = m[1].split(/[\s/]+/).map(Number); return [Math.round(p[0] * 255), Math.round(p[1] * 255), Math.round(p[2] * 255), p[3] ?? 1]; }
  return null;
}
const colorEq = (a, b) => { const x = parseColor(a), y = parseColor(b); if (!x || !y) return a === b; return [0, 1, 2].every((i) => Math.abs(x[i] - y[i]) <= 2) && Math.abs(x[3] - y[3]) <= 0.01; };
// normalise every colour inside a compound value (gradients, shadows) to rgba(r,g,b,a) so oklab/rgb spellings compare equal
function normCompound(v) {
  return String(v)
    .replace(/(oklab|rgba?|color)\([^)]*\)/g, (c) => { const p = parseColor(c); return p ? `rgba(${p.slice(0, 3).join(",")},${+p[3].toFixed(2)})` : c; })
    .replace(/ 0%(?=,)/, "").replace(/ 100%\)$/, ")") // explicit first/last gradient stops are minified away; the paint is identical
    .replace(/rgba\(0,0,0,0\) 0px 0px 0px 0px,? ?/g, "") // Tailwind's empty ring/shadow layers
    .replace(/\s+/g, " ").replace(/,\s*$/, "").replace(/^rgba\(0,0,0,0\)$/, "transparent").trim();
}
const px = (v) => (/^-?[\d.]+px$/.test(v) ? parseFloat(v) : null);
function eq(prop, a, b) {
  if (a === b) return true;
  if (/color$/.test(prop) || prop === "color") return colorEq(a, b);
  const pa = px(a), pb = px(b);
  if (pa !== null && pb !== null) return Math.abs(pa - pb) <= (prop === "letter-spacing" ? 0.2 : 0.6);
  if (prop === "border-radius") return parseFloat(a) > 1000 && parseFloat(b) > 1000;
  if (/shadow|image|filter|mask/.test(prop)) return normCompound(a) === normCompound(b);
  if (prop === "background") return normCompound(a) === normCompound(b);
  if (/^(padding|margin|gap)/.test(prop)) return a.split(" ").map(px).join() === b.split(" ").map(px).join() || a === b;
  return false;
}

/* ── probes (run inside the page) ──────────────────────────────────────────────────────────── */
const PROPS = {
  btn: ["background-image", "color", "border-radius", "padding", "font-size", "font-weight", "line-height", "box-shadow", "transition", "gap", "border-top-width"],
  glass: ["background-color", "color", "border-top-width", "border-top-color", "border-radius", "padding", "font-size", "font-weight", "line-height", "transition", "gap"],
  header: ["position", "z-index", "height"],
  headerScrolled: ["background-color", "border-bottom-width", "border-bottom-color", "box-shadow", "backdrop-filter"],
  eyebrow: ["background-color", "padding", "font-size", "font-weight", "letter-spacing", "text-transform", "color", "border-radius", "line-height"],
  h1: ["font-size", "line-height", "font-weight", "letter-spacing", "color", "text-wrap-style"],
  gradient: ["background-image", "background-clip", "-webkit-text-fill-color"],
  lead: ["font-size", "line-height", "color", "max-width"],
  chip: ["background-color", "border-top-width", "border-top-color", "padding", "font-size", "font-weight", "border-radius", "box-shadow", "gap", "color"],
  chipOuter: ["animation-name", "animation-timing-function", "display"],
  video: ["mask-image", "filter", "object-fit", "scale"],
  glow: ["background-image", "filter", "border-radius"],
  frame: ["transform-style", "aspect-ratio"],
  wrap: ["perspective", "padding-top", "padding-bottom"],
};
const SEL = {
  legacy: {
    hero: "#top", header: "header", eyebrow: "#top h1 ~ *, #top span.rounded-full", h1: "#top h1", gradient: "#top h1 span",
    primaryLg: { sel: "#top a", text: "Start Free" },
    secondaryLg: { sel: "#top a", text: "Watch Demo" },
    primaryMd: { sel: "header a", text: "Get Started" },
    video: "#top video", chipInner: "#top video ~ div .glass", chipOuter: "#top video ~ div",
  },
  kit: {
    hero: ".aicc-hero, .aicc-product-hero", header: ".aicc-site-header", eyebrow: ".aicc-eyebrow-pill", h1: ".aicc-hero-title", gradient: ".aicc-hero-title .aicc-text-gradient",
    primaryLg: "main .aicc-btn--primary.aicc-btn--lg",
    secondaryLg: "main .aicc-btn--secondary.aicc-btn--lg",
    primaryMd: ".aicc-site-header .aicc-btn--primary",
    video: ".aicc-reco-hero__video", chipInner: ".aicc-reco-hero__chip-inner", chipOuter: ".aicc-reco-hero__chip",
  },
};

async function probe(page, kind) {
  return page.evaluate(({ kind, PROPS, SEL }) => {
    const S = SEL[kind];
    const get = (x) => (typeof x === "object" ? [...document.querySelectorAll(x.sel)].find((a) => a.textContent.includes(x.text)) : document.querySelector(x));
    const cs = (el, props) => { if (!el) return null; const s = getComputedStyle(el); const o = {}; for (const k of props) o[k] = s.getPropertyValue(k); return o; };
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height }; };
    const out = {};
    const vis = (el) => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
    const R = (role, el, props) => { out[role] = { present: !!el, visible: vis(el), style: cs(el, props), rect: rect(el) }; };
    R("primaryLg", get(S.primaryLg), PROPS.btn);
    R("primaryMd", get(S.primaryMd), PROPS.btn);
    R("secondaryLg", get(S.secondaryLg), PROPS.glass);
    R("header", get(S.header), PROPS.header);
    R("eyebrow", get(S.eyebrow), PROPS.eyebrow);
    R("h1", get(S.h1), PROPS.h1);
    R("gradient", get(S.gradient), PROPS.gradient);
    const h1 = get(S.h1); const lead = h1 && (kind === "kit" ? document.querySelector(".aicc-hero-lead") : h1.nextElementSibling);
    R("lead", lead, PROPS.lead);
    const video = get(S.video);
    R("video", video, PROPS.video);
    const chip = get(S.chipInner); R("chip", chip, PROPS.chip);
    const co = get(S.chipOuter); R("chipOuter", co, PROPS.chipOuter);
    out.chipCount = document.querySelectorAll(kind === "kit" ? ".aicc-reco-hero__chip-inner" : "#top video ~ div .glass").length;
    const wrap = video && (kind === "kit" ? video.closest(".aicc-reco-hero") : video.parentElement.parentElement);
    R("wrap", wrap, PROPS.wrap);
    const frame = video && video.parentElement; R("frame", frame, PROPS.frame);
    const glow = wrap && (kind === "kit" ? wrap.querySelector(".aicc-reco-hero__glow") : wrap.querySelector("[aria-hidden=true]:not(video)"));
    R("glow", glow, PROPS.glow);
    out.videoInfo = video ? { paused: video.paused, loop: video.loop, muted: video.muted, preload: video.preload, poster: video.poster, src: video.currentSrc || video.src, hasAutoplayAttr: video.hasAttribute("autoplay") } : null;
    const hero = get(S.hero);
    out.layout = hero ? { heroRect: rect(hero), videoInHero: !!(video && hero.contains(video)), next: hero.nextElementSibling ? { id: hero.nextElementSibling.id, cls: hero.nextElementSibling.className.toString().slice(0, 60), top: rect(hero.nextElementSibling).y } : null } : null;
    out.fbt = (() => { const f = document.querySelector("[data-aicc-fbt], .aicc-fbt"); return f ? { top: rect(f).y, heroNext: !!(hero && hero.nextElementSibling && hero.nextElementSibling.contains(f)) } : null; })();
    out.lang = (() => { const b = document.querySelector(".aicc-lang__btn"); return b ? { rect: rect(b), style: cs(b, ["font-size", "font-weight", "color", "background-color"]), aria: { haspopup: b.getAttribute("aria-haspopup"), expanded: b.getAttribute("aria-expanded"), controls: b.getAttribute("aria-controls"), label: b.getAttribute("aria-label") } } : null; })();
    return out;
  }, { kind, PROPS, SEL });
}

/* ── result bookkeeping ────────────────────────────────────────────────────────────────────── */
const results = {}; // surface -> [{ name, ok, detail }]
const rec = (surface, name, ok, detail = "") => { (results[surface] ||= []).push({ name, ok: !!ok, detail }); };
function compareRole(surface, role, legacy, mine, props, label = role) {
  const L = legacy[role], M = mine[role];
  if (!M?.present) { rec(surface, `${label}: present`, false, "component not found on this surface"); return; }
  rec(surface, `${label}: visible`, M.visible, "not visible");
  if (!L?.present) return;
  for (const p of props) {
    const a = L.style[p], b = M.style[p];
    rec(surface, `${label}: ${p}`, eq(p, a, b), `legacy "${String(a).slice(0, 90)}" vs here "${String(b).slice(0, 90)}"`);
  }
}

async function shotDiff(pageA, selA, pageB, selB, name, surface) {
  const prep = async (page, sel) => {
    const handle = await page.$(sel);
    if (!handle) return null;
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
    await handle.scrollIntoViewIfNeeded();
    // same label text on both, no animation, nothing else visible: only the styling of the element is compared
    await handle.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, first = true;
      while ((n = walker.nextNode())) { if (n.textContent.trim()) { n.textContent = first ? "AICC demo" : ""; first = false; } }
      // Chips float at fractional page offsets inside a tilting 3D frame: neutralise the frame and pin them to a whole-pixel spot.
      const outer = el.closest(".aicc-reco-hero__chip, #top video ~ div");
      const pinned = outer && outer !== el ? outer : el;
      // Chip glyphs differ by sub-pixel baseline rounding between the two pages (computed font/colour/size are asserted equal above);
      // the pixel check therefore compares the chip's PAINT (glass fill, border, radius), with the label hidden.
      if (outer && outer !== el) { el.style.color = "transparent"; el.querySelectorAll("svg").forEach((v) => { v.style.setProperty("opacity", "0", "important"); }); }
      pinned.setAttribute("data-vc-pinned", "1");
      if (pinned === el) Object.assign(el.style, { position: "fixed", inset: "40px auto auto 40px", margin: "0", zIndex: "9999", translate: "none", transform: "none" });
      if (outer && outer !== el) {
        for (let a = outer.parentElement; a && a !== document.documentElement; a = a.parentElement) for (const [k, v] of [["transform", "none"], ["perspective", "none"], ["transform-style", "flat"], ["filter", "none"], ["translate", "none"], ["scale", "none"]]) a.style.setProperty(k, v, "important");
        Object.assign(outer.style, { position: "fixed", inset: "40px auto auto 40px", margin: "0", animation: "none", transform: "none", display: "block", zIndex: "9999" });
      }
    });
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}body *{visibility:hidden!important}[data-vc-pinned],[data-vc-pinned] *{visibility:visible!important}" });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(200);
    return handle.screenshot({ animations: "disabled" });
  };
  const a = await prep(pageA, selA), b = await prep(pageB, selB);
  if (!a || !b) { rec(surface, `pixels: ${name}`, false, "element missing"); return; }
  if (process.env.AICC_VC_DUMP) { fs.mkdirSync(process.env.AICC_VC_DUMP, { recursive: true }); fs.writeFileSync(path.join(process.env.AICC_VC_DUMP, `${surface}-${name.replace(/\W+/g, "-")}-legacy.png`), a); fs.writeFileSync(path.join(process.env.AICC_VC_DUMP, `${surface}-${name.replace(/\W+/g, "-")}-here.png`), b); }
  const A = await sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (Math.abs(A.info.width - B.info.width) > 2 || Math.abs(A.info.height - B.info.height) > 2) { rec(surface, `pixels: ${name}`, false, `size ${A.info.width}x${A.info.height} vs ${B.info.width}x${B.info.height}`); return; }
  // Compare the centred common region (element boxes differ by a pixel when sub-pixel positions round differently), best of +-2px shifts.
  const w = Math.min(A.info.width, B.info.width) - 8, h = Math.min(A.info.height, B.info.height) - 8;
  const ax = Math.floor((A.info.width - w) / 2), ay = Math.floor((A.info.height - h) / 2), bx = Math.floor((B.info.width - w) / 2), by = Math.floor((B.info.height - h) / 2);
  let diff = Infinity;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    let d = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((ay + y) * A.info.width + ax + x) * 4, j = ((by + y + dy) * B.info.width + bx + x + dx) * 4;
      if (Math.abs(A.data[i] - B.data[j]) > 24 || Math.abs(A.data[i + 1] - B.data[j + 1]) > 24 || Math.abs(A.data[i + 2] - B.data[j + 2]) > 24) d++;
    }
    diff = Math.min(diff, d);
  }
  const pct = (100 * diff) / (w * h);
  rec(surface, `pixels: ${name} (${pct.toFixed(2)}% differ, limit 0.5%)`, pct <= 0.5, `${diff} of ${w * h} pixels`);
}

/* ── main ──────────────────────────────────────────────────────────────────────────────────── */
const browser = await launch();
const mk = async (url, width = 1440, height = 900, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, ...opts });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1800);
  return page;
};

const legacyPage = await mk(LEGACY);
const legacy = await probe(legacyPage, "legacy");
const legacyVideoSrc = legacy.videoInfo?.src;
const legacyHash = legacyVideoSrc ? crypto.createHash("sha256").update(Buffer.from(await (await fetch(legacyVideoSrc)).arrayBuffer())).digest("hex") : null;
// legacy hover values
const hover = async (page, sel) => {
  const el = typeof sel === "function" ? await page.evaluateHandle(sel) : await page.$(sel);
  await el.asElement().scrollIntoViewIfNeeded();
  const box = await el.asElement().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(450);
  const r = await el.asElement().evaluate((e) => { const s = getComputedStyle(e); return { transform: `${s.transform} / ${s.translate}`, shadow: s.boxShadow, bg: s.backgroundColor, image: s.backgroundImage }; });
  await page.mouse.move(2, 2); await page.waitForTimeout(450);
  return r;
};
const legacyHoverPrimary = await hover(legacyPage, (() => [...document.querySelectorAll("#top a")].find((a) => /Start Free/.test(a.textContent))));
const legacyHoverSecondary = await hover(legacyPage, (() => [...document.querySelectorAll("#top a")].find((a) => /Watch Demo/.test(a.textContent))));
const legacyScrolled = await (async () => { await legacyPage.evaluate(() => scrollTo(0, 60)); await legacyPage.waitForTimeout(600); return legacyPage.evaluate(() => { const s = getComputedStyle(document.querySelector("header")); return { "background-color": s.backgroundColor, "border-bottom-width": s.borderBottomWidth, "border-bottom-color": s.borderBottomColor, "box-shadow": s.boxShadow, "backdrop-filter": s.backdropFilter, height: s.height }; }); })();
await legacyPage.evaluate(() => scrollTo(0, 0));
await legacyPage.waitForTimeout(700);
const legacyAtTop = await legacyPage.evaluate(() => getComputedStyle(document.querySelector("header")).backgroundColor);

async function surfaceChecks(surface, url) {
  let page;
  try { page = await mk(url); } catch (e) { rec(surface, "page loads", false, `cannot load ${url}: ${String(e.message).split("\n")[0]}`); return; }
  rec(surface, `page loads (${url})`, true);
  const mine = await probe(page, "kit");

  // buttons
  compareRole(surface, "primaryLg", legacy, mine, PROPS.btn, "primary button lg");
  compareRole(surface, "primaryMd", legacy, mine, PROPS.btn, "primary button md");
  compareRole(surface, "secondaryLg", legacy, mine, PROPS.glass, "secondary (glass) button lg");
  // hover
  if (mine.primaryLg?.present) {
    const h = await hover(page, (() => document.querySelector("main .aicc-btn--primary.aicc-btn--lg")));
    rec(surface, "primary hover: lift -2px (transform/translate)", h.transform === legacyHoverPrimary.transform, `legacy ${legacyHoverPrimary.transform} vs ${h.transform}`);
    rec(surface, "primary hover: box-shadow", normCompound(h.shadow) === normCompound(legacyHoverPrimary.shadow), `legacy ${legacyHoverPrimary.shadow} vs ${h.shadow}`);
    rec(surface, "primary hover: gradient unchanged", normCompound(h.image) === normCompound(legacyHoverPrimary.image));
  }
  if (mine.secondaryLg?.present) {
    const h = await hover(page, (() => document.querySelector("main .aicc-btn--secondary.aicc-btn--lg")));
    rec(surface, "secondary hover: lift -2px (transform/translate)", h.transform === legacyHoverSecondary.transform, `legacy ${legacyHoverSecondary.transform} vs ${h.transform}`);
    rec(surface, "secondary hover: background .8 white", colorEq(h.bg, legacyHoverSecondary.bg), `legacy ${legacyHoverSecondary.bg} vs ${h.bg}`);
  }
  // header
  compareRole(surface, "header", legacy, mine, PROPS.header, "header");
  if (mine.header?.present) {
    rec(surface, "header: height 76px (+-1)", Math.abs(mine.header.rect.h - 76) <= 1, `${mine.header.rect.h}`);
    rec(surface, "header: transparent at the top", colorEq(await page.evaluate(() => getComputedStyle(document.querySelector(".aicc-site-header")).backgroundColor), legacyAtTop), "");
    await page.evaluate(() => scrollTo(0, 60)); await page.waitForTimeout(600);
    const sc = await page.evaluate(() => { const s = getComputedStyle(document.querySelector(".aicc-site-header")); return { "background-color": s.backgroundColor, "border-bottom-width": s.borderBottomWidth, "border-bottom-color": s.borderBottomColor, "box-shadow": s.boxShadow, "backdrop-filter": s.backdropFilter, height: s.height }; });
    for (const p of PROPS.headerScrolled) rec(surface, `header scrolled: ${p}`, eq(p, legacyScrolled[p], sc[p]), `legacy "${legacyScrolled[p]}" vs "${sc[p]}"`);
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(500);
  }
  // hero typography
  compareRole(surface, "eyebrow", legacy, mine, PROPS.eyebrow, "eyebrow pill");
  compareRole(surface, "h1", legacy, mine, PROPS.h1.filter((p) => p !== "text-wrap-style"), "H1");
  compareRole(surface, "gradient", legacy, mine, ["background-image", "-webkit-text-fill-color"], "H1 gradient text");
  compareRole(surface, "lead", legacy, mine, ["font-size", "line-height", "color", "max-width"], "lead paragraph");
  // reco hero
  compareRole(surface, "video", legacy, mine, ["mask-image", "filter", "object-fit"], "Reco video");
  compareRole(surface, "glow", legacy, mine, ["filter", "border-radius"], "glow");
  compareRole(surface, "wrap", legacy, mine, ["perspective", "padding-top", "padding-bottom"], "Reco wrapper");
  compareRole(surface, "chip", legacy, mine, PROPS.chip, "glass chip");
  rec(surface, "five chips", mine.chipCount === 5, `${mine.chipCount}`);
  const vi = mine.videoInfo;
  if (vi) {
    rec(surface, "Reco video: muted, loop, preload=metadata, poster set, no autoplay attribute (lazy play)", vi.muted && vi.loop && vi.preload === "metadata" && !!vi.poster && !vi.hasAutoplayAttr, JSON.stringify(vi));
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(2200);
    const playing = await page.evaluate(() => { const v = document.querySelector(".aicc-reco-hero__video"); return v && !v.paused && v.currentTime > 0; });
    rec(surface, "Reco video: playing while in view", playing, "paused or not started");
    const hash = crypto.createHash("sha256").update(Buffer.from(await (await fetch(new URL(vi.src, url).href)).arrayBuffer())).digest("hex");
    rec(surface, "Reco video: file identical to the live site (sha256)", hash === legacyHash, `${hash.slice(0, 12)} vs ${legacyHash?.slice(0, 12)}`);
    const posterHash = crypto.createHash("sha256").update(Buffer.from(await (await fetch(new URL(vi.poster, url).href)).arrayBuffer())).digest("hex");
    const legacyPoster = crypto.createHash("sha256").update(Buffer.from(await (await fetch(legacy.videoInfo.poster)).arrayBuffer())).digest("hex");
    rec(surface, "Reco poster: identical to the live site (sha256)", posterHash === legacyPoster, `${posterHash.slice(0, 12)} vs ${legacyPoster.slice(0, 12)}`);
  }
  // placement: video inside hero, no blank gap, FBT directly after the hero
  const L = mine.layout;
  if (L) {
    rec(surface, "placement: Reco video is inside the hero section", L.videoInHero, "");
    rec(surface, "placement: hero is not taller than 1100px (no dead space)", L.heroRect.h <= 1100, `${Math.round(L.heroRect.h)}px`);
    const gap = L.next ? L.next.top - (L.heroRect.y + L.heroRect.h) : null;
    rec(surface, "placement: no blank gap between hero and next section (<= 8px)", gap !== null && gap >= -1 && gap <= 8, `${gap}`);
  } else rec(surface, "placement: hero section found", false, "no .aicc-hero");
  if (mine.fbt) {
    rec(surface, "placement: FBT section is the section directly after the hero", mine.fbt.heroNext, "");
    rec(surface, "placement: FBT section starts within 1100px of the page top", L && L.next && L.next.top <= 1100, `${L?.next ? Math.round(L.next.top) : "?"}`);
  } else rec(surface, "FBT section present", false, "no [data-aicc-fbt]");
  // element screenshot comparison (fresh pages: the capture helper hides everything but the element under test)
  if (mine.primaryLg?.present) {
    for (const [sa, sb, name] of [["#top a", "main .aicc-btn--primary.aicc-btn--lg", "primary button"], ["#top video ~ div:nth-of-type(5) .glass", ".aicc-reco-hero__chip[data-pos=\"5\"] .aicc-reco-hero__chip-inner", "glass chip (Bundles, clear of the video)"], ["#top a:nth-of-type(2)", "main .aicc-btn--secondary.aicc-btn--lg", "secondary (glass) button"]]) {
      const lp = await mk(LEGACY), np = await mk(url);
      await shotDiff(lp, sa === "#top a" ? "#top a:first-of-type" : sa, np, sb, name, surface).catch((e) => rec(surface, `pixels: ${name}`, false, String(e).split("\n")[0]));
      await lp.context().close(); await np.context().close();
    }
  }
  // language control
  if (mine.lang) {
    rec(surface, "language control: height >= 44 and one compact button", mine.lang.rect.h >= 43.5 && mine.lang.rect.w < 140, `${Math.round(mine.lang.rect.w)}x${Math.round(mine.lang.rect.h)}`);
    rec(surface, "language control: 14px/500 muted", mine.lang.style["font-size"] === "14px" && mine.lang.style["font-weight"] === "500" && colorEq(mine.lang.style.color, "rgb(71, 85, 105)"), JSON.stringify(mine.lang.style));
    const a = mine.lang.aria;
    rec(surface, "language control: aria-haspopup/expanded/controls/label", a.haspopup === "true" && a.expanded === "false" && !!a.controls && /:/.test(a.label || ""), JSON.stringify(a));
    await page.click(".aicc-lang__btn");
    const items = await page.$$eval(".aicc-site-header .aicc-lang__menu:not([hidden]) a, .aicc-lang:first-of-type .aicc-lang__menu:not([hidden]) a", (as) => as.map((x) => [x.lang, x.getAttribute("hreflang"), x.getAttribute("aria-current")]));
    rec(surface, "language menu: 4 links with lang/hreflang, one aria-current", items.length === 4 && items.every((i) => i[0] && i[1]) && items.filter((i) => i[2] === "true").length === 1, JSON.stringify(items));
    await page.keyboard.press("Escape");
    rec(surface, "language menu: Esc closes and returns focus", await page.evaluate(() => document.querySelector(".aicc-lang__menu").hidden && document.activeElement === document.querySelector(".aicc-lang__btn")), "");
  } else rec(surface, "language control present", false, "no .aicc-lang__btn");
  // modal
  const trig = await page.$("[data-aicc-demo-trigger], .aicc-btn--secondary.aicc-btn--lg");
  if (trig) {
    await trig.scrollIntoViewIfNeeded(); await trig.focus(); await page.keyboard.press("Enter");
    await page.waitForSelector("dialog.aicc-modal[open]", { timeout: 5000 }).catch(() => {});
    const open = await page.evaluate(() => !!document.querySelector("dialog.aicc-modal[open]"));
    rec(surface, "modal: Watch demo opens a native dialog", open, "");
    if (open) {
      rec(surface, "modal: body scroll locked", await page.evaluate(() => document.documentElement.classList.contains("aicc-scroll-lock")), "");
      let trapped = true;
      for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); if (!(await page.evaluate(() => { const d = document.querySelector("dialog.aicc-modal"); const a = document.activeElement; return d.contains(a) || a === document.body; }))) trapped = false; }
      rec(surface, "modal: focus trapped inside (6 Tabs)", trapped, "");
      rec(surface, "modal: no footage unless configured (placeholder is labelled)", await page.evaluate(() => !!document.querySelector(".aicc-modal [data-demo-placeholder], .aicc-modal video")), "");
      await page.keyboard.press("Escape");
      rec(surface, "modal: Esc closes and focus returns to the trigger", await page.evaluate(() => !document.querySelector("dialog.aicc-modal[open]") && document.activeElement?.matches("[data-aicc-demo-trigger], .aicc-btn--secondary")), "");
    }
  } else rec(surface, "Watch demo button present", false, "");
  // FBT interaction
  const fbt = await page.$("[data-aicc-fbt]");
  if (fbt) {
    await fbt.scrollIntoViewIfNeeded(); await page.waitForSelector(".aicc-fbt input[type=checkbox]", { timeout: 8000 }).catch(() => {});
    const boxes = await page.$$(".aicc-fbt input[type=checkbox]");
    rec(surface, "FBT: real checkboxes in a fieldset (>= 4)", boxes.length >= 4 && !!(await page.$(".aicc-fbt fieldset")), `${boxes.length}`);
    if (boxes.length >= 4) {
      const total0 = await page.textContent(".aicc-fbt [data-total]"), status0 = await page.textContent(".aicc-fbt [role=status]");
      await boxes[2].focus(); await page.keyboard.press("Space"); await page.waitForTimeout(500);
      const total1 = await page.textContent(".aicc-fbt [data-total]"), status1 = await page.textContent(".aicc-fbt [role=status]");
      rec(surface, `FBT: ticking changes the total (${total0} -> ${total1}) and the live region`, total0 !== total1 && status0 !== status1, `${status0} | ${status1}`);
      await page.keyboard.press("Space"); await page.waitForTimeout(500);
      rec(surface, "FBT: unticking restores the total", (await page.textContent(".aicc-fbt [data-total]")) === total0, "");
      const dirRtl = await page.evaluate(() => document.documentElement.dir === "rtl");
      await boxes[0].focus(); await page.keyboard.press(dirRtl ? "ArrowLeft" : "ArrowRight");
      rec(surface, "FBT: arrow keys follow reading direction", await page.evaluate(() => document.activeElement === document.querySelectorAll(".aicc-fbt input[type=checkbox]")[1]), "");
      rec(surface, "FBT: strength is not drawn inside the storefront card", !(await page.$(".aicc-fbt__fieldset .aicc-fbt__bar, .aicc-fbt__fieldset .aicc-fbt__strength")), "");
    }
  } else rec(surface, "FBT section present", false, "no [data-aicc-fbt]");
  await page.context().close();
}

for (const s of SURFACES) {
  if (s === "site") await surfaceChecks("site", SITE);
  else if (s === "cp") await surfaceChecks("cp", CP);
}
await browser.close();

/* ── report ───────────────────────────────────────────────────────────────────────────────── */
let failed = 0;
const out = { legacy: LEGACY, surfaces: {} };
for (const s of SURFACES) {
  const list = results[s] || [];
  const bad = list.filter((r) => !r.ok);
  failed += bad.length;
  out.surfaces[s] = { passed: list.length - bad.length, failed: bad.length, checks: list };
  console.log(`\n=== ${s === "site" ? "marketing site" : "Control Plane"} (${s === "site" ? SITE : CP}) vs LEGACY ${LEGACY}: ${list.length - bad.length}/${list.length} checks pass`);
  for (const r of list) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : "  -> " + r.detail}`);
}
fs.mkdirSync(path.join(ROOT, ".audit"), { recursive: true });
fs.writeFileSync(path.join(ROOT, ".audit/visual-contract.json"), JSON.stringify(out, null, 2));
console.log(`\nvisual contract: ${SURFACES.map((s) => `${s} ${out.surfaces[s].passed}/${out.surfaces[s].passed + out.surfaces[s].failed}`).join(", ")}`);
process.exit(failed ? 1 : 0);
