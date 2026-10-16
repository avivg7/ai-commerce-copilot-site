// npm run contrast:check: WCAG contrast of every token foreground/background pair the components use.
// Text >= 4.5:1, large text and UI components >= 3:1. Writes the table to stdout (copied into the docs).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/load.mjs";

const full = fs.readFileSync(path.join(ROOT, "design/aicc-tokens.css"), "utf8");
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
// Over a gradient, check both stops.
const GRAD = { "gradient-action": ["#2563eb", "#047857"], "gradient-action-hover": ["#1d4ed8", "#065f46"], "gradient-action-high-contrast": ["#1d4ed8", "#065f46"] };

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
  ["white on action gradient (both stops)", "white", "gradient-action", 4.5], ["white on action gradient hover", "white", "gradient-action-hover", 4.5],
  ["white on high-contrast action gradient", "white", "gradient-action-high-contrast", 4.5],
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
const rows = [];
const run = (label, fg, bg, min) => {
  const fgs = fg.startsWith("#") ? [fg] : [val(fg)];
  const bgs = GRAD[bg] ?? [bg.startsWith("#") ? bg : val(bg)];
  const worst = Math.min(...bgs.flatMap((b) => fgs.map((f) => ratio(f, b))));
  const ok = worst >= min;
  if (!ok) fail++;
  rows.push(`${ok ? "PASS" : "FAIL"}  ${worst.toFixed(2).padStart(5)}:1  (min ${min})  ${label}`);
};
for (const [l, f, b, m] of PAIRS) run(l, f, b, m);
for (const [l, f, b, m] of HC) run(l, f, b, m);
console.log(rows.join("\n"));
console.log(fail ? `\nFAIL: ${fail} pair(s) below minimum` : `\nPASS: ${rows.length} token pairs meet WCAG 2.2 AA minimums`);
process.exit(fail ? 1 : 0);
