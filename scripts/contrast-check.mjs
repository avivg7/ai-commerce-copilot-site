// npm run contrast:check: WCAG contrast of every token foreground/background pair the components use.
// Text >= 4.5:1, large text and UI components >= 3:1. Every pair is a real pass/fail assertion (no exceptions list).
// Writes the table to stdout (copied into the docs).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/load.mjs";

const full = fs.readFileSync(path.join(ROOT, "brand/aicc-tokens.css"), "utf8");
// Only the base :root block (the high-contrast overrides are checked explicitly below).
const css = full.slice(full.indexOf(":root {"), full.indexOf("/* ── User preference modes"));
const raw = {};
for (const m of css.matchAll(/--aicc-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) raw[m[1]] = m[2];
const alias = {};
for (const m of css.matchAll(/--aicc-([a-z0-9-]+):\s*var\(--aicc-([a-z0-9-]+)\)\s*;/g)) alias[m[1]] = m[2];
const val = (name) => {
  let n = name, guard = 0;
  while (!raw[n] && alias[n] && guard++ < 10) n = alias[n];
  if (!raw[n]) throw new Error("unknown token " + name);
  return raw[n];
};
const rgb = (hex) => { let h = hex.slice(1); if (h.length === 3) h = [...h].map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = (hex) => { const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Gradients are read from the token file and SAMPLED along their whole length (oklab interpolation for the button, as the
// browser does; sRGB for the headline), not just at the stops.
const cssOf = (name) => { const m = full.match(new RegExp("--aicc-" + name + ":\\s*([^;]+);")); if (!m) throw new Error("missing token " + name); return m[1].trim(); };
const stopsOf = (name) => [...cssOf(name).matchAll(/#[0-9a-fA-F]{6}(?:\s+(\d+(?:\.\d+)?)%)?/g)].map((m, i, all) => ({ hex: m[0].slice(0, 7), t: m[1] !== undefined ? Number(m[1]) / 100 : i / (all.length - 1) }));
const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGam = (v) => { v = Math.max(0, Math.min(1, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
const toOk = ([r, g, b]) => { const [R, G, B] = [r, g, b].map((v) => toLin(v / 255)); const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B); return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; };
const fromOk = ([L, a, b]) => { const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3; return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((v) => toGam(v) * 255); };
const sample = (stops, oklab, n = 400) => Array.from({ length: n }, (_, k) => {
  const t = k / (n - 1); let i = 0; while (i < stops.length - 2 && t > stops[i + 1].t) i++;
  const [s0, s1] = [stops[i], stops[i + 1]]; const u = (t - s0.t) / (s1.t - s0.t || 1);
  const A = rgb(s0.hex), B = rgb(s1.hex);
  const px = oklab ? fromOk(toOk(A).map((v, j) => v + (toOk(B)[j] - v) * u)) : A.map((v, j) => v + (B[j] - v) * u);
  return "#" + px.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
});
const GRAD = {
  "gradient-action": sample(stopsOf("gradient-action"), true), // primary button, default look
  "gradient-action-aa": sample(stopsOf("gradient-action-aa"), true), // badges, step numbers, pressed toggles, Enhanced-contrast button
  "gradient-text": sample(stopsOf("gradient-text"), false), // headline gradient (display text only)
};
// Eyebrow pill = the 8% navy tint composited over the page background (and over the tinted hero).
const HERO_TINT = "#eaf1fb"; // worst-case backdrop of the hero: the page background under the blue glow
const over = (fg, a, bg) => { const F = rgb(fg), B = rgb(bg); return "#" + F.map((v, i) => Math.round(v * a + B[i] * (1 - a)).toString(16).padStart(2, "0")).join(""); };
const pillBg = cssOf("eyebrow-bg").match(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/);
const pill = (bg) => over("#" + [pillBg[1], pillBg[2], pillBg[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join(""), Number(pillBg[4]), bg);
GRAD["eyebrow-on-page"] = [pill(val("bg"))];
GRAD["eyebrow-on-hero"] = [pill(HERO_TINT)];

const PAIRS = [
  // [label, fg, bg, min]
  ["body text on page", "text", "bg", 4.5], ["body text on surface", "text", "surface", 4.5], ["body text on sunken", "text", "surface-sunken", 4.5],
  ["muted text on page", "text-muted", "bg", 4.5], ["muted text on surface", "text-muted", "surface", 4.5], ["muted text on sunken", "text-muted", "surface-sunken", 4.5],
  ["subtle text on surface (captions only)", "text-subtle", "surface", 4.5],
  ["inverse text on navy", "text-inverse", "surface-inverse", 4.5], ["inverse muted on navy", "text-inverse-muted", "surface-inverse", 4.5],
  ["inverse muted on navy raised", "text-inverse-muted", "surface-inverse-raised", 4.5],
  ["link on page", "link", "bg", 4.5], ["link on surface", "link", "surface", 4.5], ["link on sunken", "link", "surface-sunken", 4.5], ["cyan link on navy", "cyan-300", "surface-inverse", 4.5],
  ["white on primary", "white", "primary", 4.5], ["white on primary-strong", "white", "primary-strong", 4.5],
  ["success text on success-bg", "success", "success-bg", 4.5], ["success text on surface", "success", "surface", 4.5],
  ["warning text on warning-bg", "warning", "warning-bg", 4.5], ["danger text on danger-bg", "danger", "danger-bg", 4.5], ["danger text on surface", "danger", "surface", 4.5],
  ["info text on info-bg", "info", "info-bg", 4.5], ["primary-strong icon on info-bg", "primary-strong", "info-bg", 3],
  ["white on AA action gradient (badges, step numbers, pressed toggles)", "white", "gradient-action-aa", 4.5],
  ["white on the default primary button gradient (md + lg), whole length", "white", "gradient-action", 4.5],
  ["white on the Enhanced-contrast button gradient (stronger than default)", "white", "gradient-action-aa", 5.0],
  ["headline gradient text (display >= 24px) on page, worst stop", "gradient-text", "bg", 3],
  ["headline gradient text (display >= 24px) on the tinted hero, worst stop", "gradient-text", HERO_TINT, 3],
  ["eyebrow pill text on its tint over the page", "eyebrow-fg", "eyebrow-on-page", 4.5],
  ["eyebrow pill text on its tint over the tinted hero", "eyebrow-fg", "eyebrow-on-hero", 4.5],
  ["Enhanced-contrast headline text (solid #1e3a8a) on page", "#1e3a8a", "bg", 4.5],
  ["Enhanced-contrast eyebrow pill (primary-strong on info-bg)", "primary-strong", "info-bg", 4.5],
  ["focus ring on surface (UI >= 3)", "focus", "surface", 3], ["focus ring on page", "focus", "bg", 3], ["focus ring on navy", "focus-on-dark", "surface-inverse", 3],
  ["form-control border (slate-500) on surface (UI >= 3)", "slate-500", "surface", 3], ["form-control border on sunken", "slate-500", "surface-sunken", 3], ["switch track (slate-500) on surface", "slate-500", "surface", 3],
  ["switch track on (success) on surface", "success", "surface", 3],
];
// High-contrast mode overrides
const HC = [
  ["[high contrast] muted text on page", "slate-900", "bg", 4.5], ["[high contrast] subtle on surface", "slate-700", "surface", 4.5],
  ["[high contrast] border on surface", "slate-500", "surface", 3], ["[high contrast] link on surface", "#1e3a8a", "surface", 4.5],
];

let fail = 0;
// The contract baseline (brand/contract-baseline.json) and the tokens must say the same thing.
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "brand/contract-baseline.json"), "utf8"));
for (const [label, tok, want] of [["primary button gradient", "gradient-action", baseline.primaryButton.gradient], ["primary button hover gradient", "gradient-action-hover", baseline.primaryButton.hoverGradient], ["headline gradient", "gradient-text", baseline.headlineGradient.gradient], ["eyebrow text", "eyebrow-fg", baseline.eyebrow.color], ["eyebrow background", "eyebrow-bg", baseline.eyebrow.background]]) {
  const have = cssOf(tok).replace(/\s+/g, " ");
  if (have !== want) { fail++; console.log(`FAIL  baseline mismatch for ${label}: tokens "${have}" vs contract-baseline.json "${want}"`); }
}

const rows = [];
const run = (label, fg, bg, min) => {
  const fgs = GRAD[fg] ?? (fg.startsWith("#") ? [fg] : [val(fg)]);
  const bgs = GRAD[bg] ?? [bg.startsWith("#") ? bg : val(bg)];
  const worst = Math.min(...bgs.flatMap((b) => fgs.map((f) => ratio(f, b))));
  const ok = worst >= min;
  if (!ok) fail++;
  rows.push(`${ok ? "PASS" : "FAIL"}  ${worst.toFixed(2).padStart(5)}:1  (min ${min})  ${label}`);
};
for (const [l, f, b, m] of PAIRS) run(l, f, b, m);
for (const [l, f, b, m] of HC) run(l, f, b, m);
console.log(rows.join("\n"));

// Guard: the headline gradient is clipped text and only meets AA as LARGE text. It may only be used on display text.
const rel = (f) => path.relative(ROOT, f);
const users = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(tsx?|jsx?|mjs|html)$/.test(e.name)) { const t = fs.readFileSync(f, "utf8"); if (/aicc-text-gradient/.test(t) && !/^(brand\/aicc-brand\.css)$/.test(rel(f))) users.push(rel(f)); } } };
walk(path.join(ROOT, "src")); walk(path.join(ROOT, "brand/js"));
const ALLOWED = new Set(["src/components/pages/HomePage.tsx"]); // the h1 (36px at 320px, up to 68px)
const stray = users.filter((f) => !ALLOWED.has(f));
if (stray.length) { fail++; console.log(`FAIL  .aicc-text-gradient used outside the display headline: ${stray.join(", ")} (use solid --aicc-primary-strong for smaller text)`); }
else console.log(`PASS  .aicc-text-gradient is used only by ${[...ALLOWED].join(", ")} (rendered size is asserted in npm run test:interaction)`);
const minDisplay = Number((cssOf("text-display").match(/clamp\(\s*([\d.]+)rem/) ?? [])[1]) * 16;
console.log(`      display size floor ${minDisplay}px (>= 24px)`);
if (!(minDisplay >= 24)) { fail++; console.log("FAIL  display type floor below 24px"); }
console.log(fail ? `\nFAIL: ${fail} pair(s) below minimum` : `\nPASS: ${rows.length} token pairs meet WCAG 2.2 AA minimums`);
process.exit(fail ? 1 : 0);
