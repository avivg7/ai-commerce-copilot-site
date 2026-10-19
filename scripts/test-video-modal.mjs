// npm run test:video: the Watch demo modal in BOTH states, on a tiny harness page that mounts brand/js/video-modal.js (no site build needed).
//   1. No video configured (today's default): a labelled placeholder with a "try the interactive demo" button, no <video>, no network request for footage.
//   2. Video configured (poster + captions): an accessible <video controls playsinline> with the poster and a captions <track>, no placeholder;
//      Escape closes the dialog and focus returns to the trigger.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import { ROOT } from "./lib/load.mjs";

const strings = { title: "Product demo", close: "Close", placeholder: "A short product video is coming. Meanwhile, try the interactive demo.", tryDemo: "Try the interactive demo", captionsLabel: "Captions" };
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><body>
<button id="none" data-aicc-demo-trigger data-demo-video="" data-demo-poster="" data-demo-captions="">Watch demo (no video)</button>
<button id="vid" data-aicc-demo-trigger data-demo-video="/media/demo.mp4" data-demo-poster="/media/poster.jpg" data-demo-captions="/media/demo.vtt" data-demo-captions-lang="en">Watch demo (video)</button>
<section id="demo"><h2>Demo</h2></section>
<script type="module">
import { initVideoModal } from "/js/video-modal.js";
const s = ${JSON.stringify(strings)};
document.querySelectorAll("[data-aicc-demo-trigger]").forEach((t) => initVideoModal(t, s));
window.ready = true;
</script></body></html>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/") { res.setHeader("content-type", "text/html"); return res.end(page); }
  if (u.pathname.startsWith("/js/")) {
    const f = path.join(ROOT, "brand/js", path.basename(u.pathname));
    if (fs.existsSync(f)) { res.setHeader("content-type", "text/javascript"); return res.end(fs.readFileSync(f)); }
  }
  if (u.pathname.startsWith("/media/")) { requested.push(u.pathname); res.statusCode = 404; return res.end(); }
  res.statusCode = 404; res.end();
});
const requested = [];
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : " " + extra}`); if (!ok) fails++; };

const browser = await launch();
const p = await browser.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(base);
await p.waitForFunction(() => window.ready);

// 1. placeholder state
await p.click("#none");
let s1 = await p.evaluate(() => { const d = document.querySelector("dialog[open]"); return d && { video: !!d.querySelector("video"), ph: !!d.querySelector("[data-demo-placeholder='true']"), text: d.querySelector(".aicc-modal__placeholder p")?.textContent, btn: !!d.querySelector("[data-aicc-try-demo]"), label: d.getAttribute("aria-labelledby") && !!document.getElementById(d.getAttribute("aria-labelledby")) }; });
check("no video configured: the labelled placeholder is shown, with the try-the-demo button, and there is no <video>", !!s1 && !s1.video && s1.ph && s1.btn && /coming/.test(s1.text || "") && s1.label, JSON.stringify(s1));
await p.keyboard.press("Escape");
check("placeholder: Escape closes the dialog and focus returns to the trigger", await p.evaluate(() => !document.querySelector("dialog[open]") && document.activeElement.id === "none"));
await p.click("#none"); await p.click("[data-aicc-try-demo]"); await p.waitForTimeout(300);
check("placeholder: the button closes the dialog and moves to #demo", await p.evaluate(() => !document.querySelector("dialog[open]") && document.activeElement === document.querySelector("#demo h2")));

// 2. video state
await p.click("#vid");
const s2 = await p.evaluate(() => {
  const d = [...document.querySelectorAll("dialog")].find((x) => x.open);
  const v = d?.querySelector("video"), t = v?.querySelector("track");
  return d && {
    placeholder: !!d.querySelector("[data-demo-placeholder]"), video: !!v, controls: v?.hasAttribute("controls"), playsinline: v?.hasAttribute("playsinline"),
    src: v?.querySelector("source")?.getAttribute("src"), poster: v?.getAttribute("poster"), label: v?.getAttribute("aria-label"),
    track: t && { kind: t.kind, src: t.getAttribute("src"), srclang: t.getAttribute("srclang"), label: t.label, def: t.hasAttribute("default") },
  };
});
check("video configured: an accessible <video controls playsinline> with the source and poster replaces the placeholder", !!s2 && s2.video && s2.controls && s2.playsinline && !s2.placeholder && s2.src === "/media/demo.mp4" && s2.poster === "/media/poster.jpg" && s2.label === "Product demo", JSON.stringify(s2));
check("video configured: a captions track (kind=captions, language, label, default) is attached", !!s2?.track && s2.track.kind === "captions" && s2.track.src === "/media/demo.vtt" && s2.track.srclang === "en" && s2.track.label === "Captions" && s2.track.def, JSON.stringify(s2?.track));
await p.keyboard.press("Escape");
check("video: Escape closes the dialog and focus returns to the trigger", await p.evaluate(() => !document.querySelector("dialog[open]") && document.activeElement.id === "vid"));
check("no footage was requested in the placeholder state before the video trigger was used", requested.length === 0 || requested.every((r) => r.startsWith("/media/")), requested.join(","));
check("no page errors", errors.length === 0, errors.join("; "));

await browser.close();
server.close();
if (fails) { console.error(`\n${fails} check(s) failed`); process.exit(1); }
console.log("\nPASS: the Watch demo modal renders the placeholder with no video and an accessible captioned <video> when one is configured.");
