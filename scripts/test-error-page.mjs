// npm run test:error-page: the edge-served 5xx page (docs/cutover/50x.html), owner direction 2026-10-19:
//   "AI Commerce Copilot is temporarily unavailable. Please try again shortly."
// Static checks (standalone: no external request possible, no script, no link, inline CSS, system fonts, accessible document, contrast from the CSS custom properties,
// no infrastructure detail, wired into the Caddyfile template's handle_errors with the status kept) and a Chromium render at 320 / 390 / 1280 in light, dark and
// forced-colours with axe-core (WCAG 2.x A/AA + best-practice), no horizontal scroll, the sentence visible in the viewport, and a request log proving the page makes
// NO request other than itself. The page is opened from its file:// URL; this test writes nothing at all (no screenshots, no temp files).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/load.mjs";
import { launch } from "./lib/browser.mjs";

const require = createRequire(import.meta.url);
const fileArg = process.argv.indexOf("--file");
const FILE = fileArg >= 0 ? path.resolve(process.argv[fileArg + 1]) : path.join(ROOT, "docs/cutover/50x.html"); // --file: mutation self-check on a scratch copy
const TEMPLATE = path.join(ROOT, "docs/cutover/Caddyfile.edge.template");
const RUNBOOK = path.join(ROOT, "docs/cutover/runbook.md");
const SENTENCE = "AI Commerce Copilot is temporarily unavailable. Please try again shortly.";
const raw = fs.readFileSync(FILE, "utf8");
let total = 0, failed = 0;
const check = (name, ok, detail = "") => { total++; if (!ok) { failed++; console.error(`FAIL: ${name}${detail ? " :: " + detail : ""}`); } };

/* ---- static ------------------------------------------------------------------------------------------------------------------------------------------ */
const noComments = raw.replace(/<!--[\s\S]*?-->/g, "");
const visible = noComments.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<svg[\s\S]*?<\/svg>/gi, "").replace(/<head[\s\S]*?<\/head>/i, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
check("the visible text is EXACTLY the owner's sentence", visible === SENTENCE, JSON.stringify(visible));
check("<html lang=\"en\">", /<html\s+lang="en"/i.test(noComments));
check("a <title> that names the product and the state", /<title>AI Commerce Copilot is temporarily unavailable<\/title>/.test(noComments));
check("exactly one <h1> and one <main>", (noComments.match(/<h1\b/gi) || []).length === 1 && (noComments.match(/<main\b/gi) || []).length === 1);
check("viewport meta (responsive) and noindex", /<meta name="viewport" content="width=device-width, initial-scale=1">/.test(noComments) && /<meta name="robots" content="noindex">/.test(noComments));
check("no script, no link, no iframe/object/embed/img/video/audio element, no @import, no @font-face, no url() except the in-document #fragment gradient", !/<(script|link|iframe|object|embed|img|video|audio|source|form|input|button|a)\b/i.test(noComments) && !/@import|@font-face|url\((?!#)/i.test(noComments));
check("no http(s):// or protocol-relative reference anywhere outside comments (standalone: the upstreams may be down)", !/(?:https?:)?\/\/[a-z0-9]/i.test(noComments.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "")));
check("no on* event attributes, no inline javascript:", !/\son[a-z]+\s*=|javascript:/i.test(noComments));
check("no stack trace or infrastructure detail in the page text or attributes (nothing about the store, the shop engine, the proxy, hosts, ports or status codes)", !/woocommerce|wordpress|\bphp\b|\bstore\b|\bshop\b|caddy|nginx|upstream|proxy|gateway|exception|stack|trace|traceback|localhost|127\.0\.0\.1|\b5\d\d\b|\bcontrol plane\b|backend|\bapi\b|database|mysql/i.test(visible + " " + noComments.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<svg[\s\S]*?<\/svg>/gi, "")));
check("never claims the store (or the shop engine) is down", !/(store|shop|woocommerce)[^.]{0,40}(down|unavailable|offline)/i.test(visible));
check("system fonts only (no web font), inline <style> only", /font-family:\s*system-ui/.test(noComments) && !/\.woff2?|fonts\.googleapis/i.test(noComments) && (noComments.match(/<style>/g) || []).length === 1);
check("respects prefers-color-scheme (dark) and forced-colors, and declares color-scheme", /@media \(prefers-color-scheme: dark\)/.test(noComments) && /@media \(forced-colors: active\)/.test(noComments) && /<meta name="color-scheme" content="light dark">/.test(noComments));
check("small: under 8 KB (it must survive being served from a degraded host)", Buffer.byteLength(raw) < 8192, String(Buffer.byteLength(raw)));
check("responsive down to 320 px: width-fluid container, box-sizing, wrapping, no fixed widths in px on layout", /max-width:\s*34rem/.test(noComments) && /box-sizing:\s*border-box/.test(noComments) && /overflow-wrap:\s*anywhere/.test(noComments) && !/(?<![\w-])width:\s*\d+px/.test(noComments.replace(/<svg[\s\S]*?<\/svg>/g, "")));
check("the decorative mark is hidden from assistive technology", /<svg[^>]*aria-hidden="true"[^>]*focusable="false"/.test(noComments));
check("no focusable element at all (focus-safe: nothing can trap or lose focus), no tabindex", !/tabindex/i.test(noComments));

// Contrast from the page's own custom properties (WCAG 2.x relative luminance), light and dark.
const lum = (hex) => { const c = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const vars = (block) => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const light = vars(noComments.match(/:root\s*\{[^}]*\}/)[0]);
const dark = { ...light, ...vars(noComments.match(/prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)[1]) };
for (const [name, v] of [["light", light], ["dark", dark]]) {
  check(`${name}: heading text on the card >= 4.5:1 (${ratio(v.text, v.card).toFixed(1)}:1) and on the page background (${ratio(v.text, v.bg).toFixed(1)}:1)`, ratio(v.text, v.card) >= 4.5 && ratio(v.text, v.bg) >= 4.5);
  check(`${name}: muted sentence on the card >= 4.5:1 (${ratio(v.muted, v.card).toFixed(1)}:1)`, ratio(v.muted, v.card) >= 4.5);
}
// The colours are the brand tokens' literal values.
const tokens = fs.readFileSync(path.join(ROOT, "brand/aicc-tokens.css"), "utf8").toLowerCase();
const usedHex = [...new Set((noComments.match(/#[0-9a-f]{6}\b/gi) || []).map((h) => h.toLowerCase()))];
const notTokens = usedHex.filter((h) => !tokens.includes(h));
check(`every colour in the page is a brand-token value (brand/aicc-tokens.css); not found: ${notTokens.join(", ") || "none"}`, notTokens.length === 0 || (notTokens.length === 1 && notTokens[0] === "#334155" && tokens.includes("--aicc-slate-700: #334155")));

// Wiring: the edge template serves it for every status >= 500, keeps the status, never caches it; the runbook copies it into each release.
const tpl = fs.readFileSync(TEMPLATE, "utf8");
const he = tpl.slice(tpl.indexOf("handle_errors {"));
check("Caddyfile template: handle_errors serves /50x.html for status >= 500", /@servererror expression \{http\.error\.status_code\} >= 500/.test(he) && /rewrite \* \/50x\.html/.test(he));
check("Caddyfile template: the status code is kept (file_server status {http.error.status_code}) and the page is no-store", /file_server \{\s*status \{http\.error\.status_code\}\s*\}/.test(he.slice(he.indexOf("@servererror"), he.indexOf("@notfound"))) && /Cache-Control "no-store"/.test(he.slice(he.indexOf("@servererror"), he.indexOf("@notfound"))));
const rb = fs.readFileSync(RUNBOOK, "utf8");
check("runbook: the release procedure copies docs/cutover/50x.html into every release directory", /cp docs\/cutover\/50x\.html \$R\/50x\.html/.test(rb));

/* ---- Chromium render ------------------------------------------------------------------------------------------------------------------------------- */
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const url = pathToFileURL(FILE).href;
const browser = await launch();
let runs = 0;
try {
  for (const width of [320, 390, 1280]) for (const mode of ["light", "dark", "forced-colors"]) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 1280 ? 800 : 700 }, colorScheme: mode === "dark" ? "dark" : "light", forcedColors: mode === "forced-colors" ? "active" : "none", javaScriptEnabled: true });
    const page = await ctx.newPage();
    const requests = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(100);
    const label = `${width}px ${mode}`;
    runs++;
    const others = requests.filter((u) => u !== url);
    check(`${label}: no request other than the page itself (${others.join(", ") || "none"})`, others.length === 0);
    const m = await page.evaluate(() => {
      const h = document.querySelector("h1").getBoundingClientRect();
      const mainEl = document.querySelector("main").getBoundingClientRect();
      const cs = getComputedStyle(document.body);
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, h1Top: h.top, h1Bottom: h.bottom, h1Left: h.left, h1Right: h.right, vh: window.innerHeight, mainLeft: mainEl.left, mainRight: mainEl.right, text: document.body.innerText.replace(/\s+/g, " ").trim(), bg: cs.backgroundColor, fg: cs.color, font: cs.fontFamily, lang: document.documentElement.lang };
    });
    check(`${label}: no horizontal scroll (${m.sw} <= ${m.iw})`, m.sw <= m.iw);
    check(`${label}: the heading is inside the viewport horizontally and vertically`, m.h1Left >= 0 && m.h1Right <= m.iw && m.h1Top >= 0 && m.h1Bottom <= m.vh);
    check(`${label}: the card stays inside the viewport`, m.mainLeft >= 0 && m.mainRight <= m.iw);
    check(`${label}: rendered text is the sentence`, m.text === SENTENCE, m.text);
    check(`${label}: system font stack`, /system-ui/.test(m.font));
    if (mode === "dark") check(`${label}: dark scheme applied (background ${m.bg})`, m.bg === "rgb(11, 18, 32)");
    if (mode === "light") check(`${label}: light scheme applied (background ${m.bg})`, m.bg === "rgb(248, 250, 252)");
    await page.addScriptTag({ content: axeSource });
    const res = await page.evaluate((tags) => axe.run(document, { runOnly: { type: "tag", values: tags } }), TAGS);
    check(`${label}: axe finds 0 violations (${res.violations.map((v) => v.id + ":" + v.impact).join(", ") || "none"}; ${res.passes.length} rules passed)`, res.violations.length === 0);
    // 200% text zoom equivalent: the layout must still fit at 320
    if (width === 320 && mode === "light") {
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      const z = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      check(`${label}: 200% text size still fits without horizontal scroll (${z[0]} <= ${z[1]})`, z[0] <= z[1]);
    }
    await ctx.close();
  }
} finally { await browser.close(); }
check("rendered in Chromium at 320, 390 and 1280 px in light, dark and forced-colors (9 runs)", runs === 9);

console.log(failed ? `${failed} of ${total} checks FAILED` : `${total}/${total} error-page checks passed`);
process.exit(failed ? 1 : 0);
