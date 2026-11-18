// Interaction + mode checks of the prototype: keyboard order and focus visibility, status states are not focusable, reduced motion, enhanced contrast (axe), forced colours and print screenshots.
//   PATH=/opt/homebrew/opt/node@22/bin:$PATH node --no-warnings design/p40/modes.mjs [--out <dir>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { launch } from "../../scripts/lib/browser.mjs";
import { LANGS, STATES } from "./render.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const oi = process.argv.indexOf("--out");
const OUT = oi > 0 ? process.argv[oi + 1] : path.join(HERE, "shots");
fs.mkdirSync(OUT, { recursive: true });
const url = (l, s) => pathToFileURL(path.join(HERE, "out", `${l}__${s}.html`)).href;
const b = await launch();
let fails = 0;
const log = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

// 1. keyboard: link states expose exactly 3 card links (Solo, Studio, Agency) + the band link, in DOM order; status states expose none; every focused control shows a visible indicator
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  for (const state of ["open", "waitlist", "purchase", "off", "closed", "paused", "ended"]) {
    await p.goto(url("en", state));
    const stops = [];
    for (let i = 0; i < 8; i++) {
      await p.keyboard.press("Tab");
      const info = await p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return { t: e.textContent.trim().replace(/\s+/g, " ").slice(0, 40), ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2, h: Math.round(r.height), plan: e.closest("[data-plan]")?.dataset.plan || (e.closest(".aicc-pband") ? "band" : "") }; });
      if (!info) break;
      stops.push(info);
    }
    const linkStates = ["open", "waitlist", "purchase"].includes(state);
    const expect = linkStates ? ["solo", "studio", "agency", "band"] : state === "ended" ? [] : ["band"].slice(0, 0);
    log(JSON.stringify(stops.map((s) => s.plan)) === JSON.stringify(expect), `focus order en/${state}: ${stops.map((s) => s.plan + ":" + s.t).join(" > ") || "(no tab stops in the section)"}`);
    log(stops.every((s) => s.ring && s.h >= 44), `focus ring >=2px and target >=44px en/${state}`);
  }
  await ctx.close();
}
// 2. reduced motion: every transition duration collapses
{
  const ctx = await b.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(url("en", "open"));
  const d = await p.evaluate(() => [".aicc-tier", ".aicc-btn"].map((s) => parseFloat(getComputedStyle(document.querySelector(s)).transitionDuration)));
  log(d.every((x) => x <= 0.001), `reduced motion: transition durations ${d.join(", ")}s`);
  const anim = await p.evaluate(() => document.getAnimations().length);
  log(anim === 0, `no running animations (${anim})`);
  await ctx.close();
}
// 3. enhanced contrast mode: axe incl. colour contrast in every language for open + off
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  for (const l of LANGS) for (const s of ["open", "off", "closed"]) {
    await p.goto(url(l, s));
    await p.evaluate(() => document.documentElement.setAttribute("data-aicc-contrast", "high"));
    await p.evaluate(AXE);
    const v = await p.evaluate(async () => (await axe.run(document, { rules: { "page-has-heading-one": { enabled: false } } })).violations.map((x) => x.id + "(" + x.nodes.length + ")"));
    log(v.length === 0, `axe high-contrast ${l}/${s}: ${v.join(",") || "0 violations"}`);
  }
  await ctx.close();
}
// 4. text spacing (WCAG 1.4.12) applied: nothing clips
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
  const p = await ctx.newPage();
  for (const l of LANGS) {
    await p.goto(url(l, "open"));
    await p.addStyleTag({ content: "*{line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important} p{margin-block-end:2em !important}" });
    const bad = await p.evaluate(() => [...document.querySelectorAll(".aicc-tier,.aicc-launch,.aicc-pband")].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.className)).catch(() => []);
    log(bad.length === 0 && (await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)), `text spacing 1.4.12 ${l}: ${bad.join(",") || "no clipping, no overflow"}`);
  }
  await ctx.close();
}
// 4b. Hebrew: the timeline mirrors (step 1 on the right, also stacked vertically on a phone, nodes on the right) and both time strings keep the P39 isolates (U+2066 ... U+2069)
{
  for (const w of [1440, 390]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(url("he", "open"));
    const r = await p.evaluate(() => { const st = [...document.querySelectorAll(".aicc-timeline__step")].map((e) => e.getBoundingClientRect()); const nodes = [...document.querySelectorAll(".aicc-timeline__node")].map((e) => e.getBoundingClientRect()); const dates = [...document.querySelectorAll(".aicc-timeline__date")].map((e) => e.textContent); return { horiz: st[0].right > st[1].right && st[0].top === st[1].top, vert: st[0].top < st[1].top, nodeRight: nodes[0].left > innerWidth / 2 && nodes[1].left > innerWidth / 2, iso: dates.every((t) => t.includes("\u2066") && t.includes("\u2069")) }; });
    log(r.iso && (w > 700 ? r.horiz : r.vert && r.nodeRight), `Hebrew timeline @${w}: ${JSON.stringify(r)}`);
    await ctx.close();
  }
}
// 5. forced colours + print screenshots
{
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, forcedColors: "active" });
  const p = await ctx.newPage();
  for (const s of ["open", "off"]) { await p.goto(url("en", s)); await (await p.$("main")).screenshot({ path: path.join(OUT, `forced-colors-en-${s}.png`) }); }
  await ctx.close();
  const c2 = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const q = await c2.newPage();
  await q.goto(url("en", "off")); await q.emulateMedia({ media: "print" });
  await q.pdf({ path: path.join(OUT, "print-en-off.pdf"), format: "A4" });
  await (await q.$("main")).screenshot({ path: path.join(OUT, "print-media-en-off.png") });
  console.log("screenshots/pdf ->", OUT);
  await c2.close();
}
await b.close();
console.log(fails ? `${fails} FAILING` : "all mode checks pass");
process.exit(fails ? 1 : 0);
