// npm run test:kit-a11y: the accessibility fixes that live in the BRAND KIT (Production 22: F3, F4, F6, F8) cannot be dropped again by a kit change, a merge or a sync.
//   node scripts/test-kit-a11y.mjs                      static checks on brand/aicc-brand.css and brand/js/reco-hero.js (+ a self-test: each check FAILS on a mutated copy of the file)
//   node scripts/test-kit-a11y.mjs --url <base url>     the same, plus a browser check on the running Site (or Control Plane): a very long product name in the shopper demo is NOT cut
//                                                       when the reader applies the WCAG 1.4.12 text spacing (line height 1.5, letter spacing 0.12em, word spacing 0.16em, 2em paragraphs)
// Why it exists: the Control Plane theme carried the F3 fix (a demo product name is never line-clamped) while the Site's kit lost it in a branch merge; the kit is the only source of truth, so the
// fix must be pinned HERE (Site -> theme is one-way, see scripts/sync-brand-kit.mjs). The Control Plane repo pins the same facts on its copy (tests/run_brand_kit_a11y_tests.php).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/load.mjs";

const args = process.argv.slice(2);
const URL0 = args.includes("--url") ? args[args.indexOf("--url") + 1].replace(/\/$/, "") : "";
const css = fs.readFileSync(path.join(ROOT, "brand/aicc-brand.css"), "utf8");
const hero = fs.readFileSync(path.join(ROOT, "brand/js/reco-hero.js"), "utf8");
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

// Each rule: [id, what it protects, predicate(css, heroJs)]. The predicate returns true when the fix is PRESENT.
const RULES = [
  ["F3", "a demo product name is never clipped: no line clamp on .aicc-fbt-card__name (WCAG 1.4.12 text spacing)",
    (c) => { const m = noComments(c).match(/\.aicc-fbt-card__name \{([^}]*)\}/); return !!m && !/line-clamp/.test(m[1]) && /display:\s*block/.test(m[1]) && !/overflow:\s*hidden/.test(m[1]); }],
  ["F4", "replica dashboard tiles reflow and wrap (auto-fit columns on narrow screens, overflow-wrap on label and number) (WCAG 1.4.4, 1.4.10)",
    (c) => /\.aicc-dash__tiles--three \{ grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 7\.5rem\), 1fr\)\)/.test(c) && /\.aicc-dash__tlabel, \.aicc-dash__tile strong \{ overflow-wrap: anywhere/.test(c)],
  ["F6", "the replica brand line is 12.5px and the bundle total label 0.8rem (the audit's text-size bar)",
    (c) => /\.aicc-fbt__brand \{[^}]*font-size: 12\.5px/.test(c) && /\.aicc-fbt__total span \{ font-size: 0\.8rem/.test(c)],
  ["F8", "the hero Pause button keeps ONE accessible name and flips aria-pressed (no aria-label change on click)",
    (c, h) => /setAttribute\("aria-pressed"/.test(h) && !/pauseBtn\.setAttribute\("aria-label"/.test(h)],
];

let failed = 0, total = 0;
const check = (cond, msg, extra = "") => { total++; if (cond) console.log("  ok   " + msg); else { failed++; console.error("  FAIL " + msg + (extra ? " -> " + extra : "")); } };

console.log("== the kit carries every Production 22 accessibility fix");
for (const [id, what, ok] of RULES) check(ok(css, hero), `${id}: ${what}`);

console.log("== self-test: each check fails on a kit without its fix");
const mutations = {
  F3: [(c) => c.replace(/(\.aicc-fbt-card__name \{[^}]*?)display: block;/, "$1display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;"), css, hero],
  F4: [(c) => c.replace("repeat(auto-fit, minmax(min(100%, 7.5rem), 1fr))", "repeat(2, minmax(0, 1fr))"), css, hero],
  F6: [(c) => c.replace("font-size: 12.5px; line-height: 1.2; }", "font-size: 11px; line-height: 1.2; }"), css, hero],
  F8: [(h) => h.replace('pauseBtn.querySelector(\'[data-ic="pause"]\')', 'pauseBtn.setAttribute("aria-label", userPaused ? "Play" : "Pause");\n      pauseBtn.querySelector(\'[data-ic="pause"]\')'), css, hero],
};
for (const [id, what, ok] of RULES) {
  const [fn] = mutations[id];
  const c2 = id === "F8" ? css : fn(css), h2 = id === "F8" ? fn(hero) : hero;
  check((id === "F8" ? h2 !== hero : c2 !== css) && !ok(c2, h2), `${id}: a mutated copy (fix removed) is rejected`);
}

if (URL0) {
  console.log(`== browser: WCAG 1.4.12 text spacing with a very long product name at ${URL0}`);
  const { launch } = await import("./lib/browser.mjs");
  const browser = await launch();
  try {
    for (const [locale, w] of [["en", 1280], ["en", 390], ["he", 1280]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: "reduce", locale: locale === "he" ? "he-IL" : "en-US" });
      const p = await ctx.newPage();
      await p.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); localStorage.setItem("aicc_a11y", JSON.stringify({ motion: "reduce" })); } catch {} });
      await p.goto(URL0 + (locale === "en" ? "" : `/${locale}`) + "/", { waitUntil: "load", timeout: 120000 });
      await p.evaluate(() => (document.querySelector("#demo") || document.querySelector(".aicc-fbt"))?.scrollIntoView());
      await p.waitForSelector(".aicc-fbt [data-bundle] .aicc-fbt-card__name", { state: "attached", timeout: 30000 });
      const LONG = "Hand-poured soy candle with a long descriptive name that keeps going, 12 oz amber jar, cedar and vanilla, limited autumn edition, gift boxed";
      await p.evaluate((name) => { document.querySelector(".aicc-fbt [data-bundle] .aicc-fbt-card__name").textContent = name; }, LONG);
      // the WCAG 1.4.12 test values (the bookmarklet every audit uses)
      await p.addStyleTag({ content: "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-block-end: 2em !important; }" });
      const r = await p.evaluate(() => {
        const el = document.querySelector(".aicc-fbt [data-bundle] .aicc-fbt-card__name");
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight);
        return { clamp: cs.webkitLineClamp, overflow: cs.overflow, display: cs.display, lines: Math.round(el.getBoundingClientRect().height / lh), clipped: el.scrollHeight > el.clientHeight + 1 };
      });
      check(r.clamp === "none" && !r.clipped && r.lines > 2, `${locale}@${w}: a ${r.lines}-line product name is fully shown (line-clamp ${r.clamp}, overflow ${r.overflow}, display ${r.display}, clipped ${r.clipped})`, JSON.stringify(r));
      await ctx.close();
    }
  } finally { await browser.close(); }
}

console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error("FAIL test:kit-a11y"); process.exit(1); }
console.log("PASS test:kit-a11y");
