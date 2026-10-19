// npm run test:demo: the built site's "Watch demo" dialog with the owner-approved master, in a real browser (needs a build in out/).
//   Serves out/ itself (with byte ranges), then on desktop, mobile (touch) and reduced-motion contexts checks:
//   the served bytes are the approved master (sha256 in docs/approved-demo.sha256), the dialog opens, the <video> has controls + poster + a default captions track,
//   it does NOT autoplay (or play sound by itself), metadata loads, keyboard play/pause and seeking work, captions cues exist and show, the player fits the viewport,
//   Escape closes, playback pauses and rewinds, and focus returns to the trigger.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import { ROOT } from "./lib/load.mjs";

const PORT = Number(process.env.AICC_DEMO_TEST_PORT || 3913);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.AICC_DEMO_SHOTS || "";
const VTT_CUES = (fs.readFileSync(path.join(ROOT, "public/demo/aicc-demo.vtt"), "utf8").match(/-->/g) || []).length;
const want = fs.readFileSync(path.join(ROOT, "docs/approved-demo.sha256"), "utf8").trim().split(/\s+/)[0];

const server = spawn("node", [path.join(ROOT, "scripts/serve-out.mjs"), "--port", String(PORT)], { stdio: "ignore" });
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);
for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : " " + extra}`); if (!ok) fails++; };

const browser = await launch();

// 1. The bytes the site serves are the approved master (full GET, and a ranged GET agrees with it).
{
  const ctx = await browser.newContext();
  const full = await ctx.request.get(`${BASE}/demo/aicc-demo.mp4`);
  const buf = await full.body();
  const got = crypto.createHash("sha256").update(buf).digest("hex");
  check("served /demo/aicc-demo.mp4 is byte-identical to the approved master (sha256)", got === want, `${got} != ${want}`);
  check("served as video/mp4 with Accept-Ranges", /video\/mp4/.test(full.headers()["content-type"] || "") && full.headers()["accept-ranges"] === "bytes");
  const part = await ctx.request.get(`${BASE}/demo/aicc-demo.mp4`, { headers: { Range: "bytes=1000-1999" } });
  check("a byte-range request returns 206 with the matching bytes", part.status() === 206 && Buffer.compare(await part.body(), buf.subarray(1000, 2000)) === 0);
  const vtt = await ctx.request.get(`${BASE}/demo/aicc-demo.vtt`);
  check("captions file is served as text/vtt and starts with WEBVTT", /text\/vtt/.test(vtt.headers()["content-type"] || "") && (await vtt.text()).startsWith("WEBVTT"));
  await ctx.close();
}

const profiles = [
  { name: "desktop", opts: { viewport: { width: 1280, height: 800 } }, tap: false },
  { name: "mobile", opts: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, tap: true },
  { name: "reduced-motion", opts: { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" }, tap: false },
];

for (const prof of profiles) {
  for (const route of ["/", "/he/"]) {
    const label = `${prof.name} ${route}`;
    const ctx = await browser.newContext(prof.opts);
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`${BASE}${route}`);
    await p.waitForFunction(() => document.querySelector("[data-aicc-demo-trigger]")?.dataset.aiccBound === "1", null, { timeout: 15000 });
    const trig = p.locator("[data-aicc-demo-trigger]:visible").first();
    await trig.scrollIntoViewIfNeeded();
    // Keyboard/tap activation of the real button.
    if (prof.tap) await trig.tap(); else { await trig.focus(); await p.keyboard.press("Enter"); }
    await p.waitForSelector("dialog[open] video");
    const s = await p.evaluate(() => {
      const d = document.querySelector("dialog[open]"), v = d.querySelector("video"), t = v.querySelector("track");
      const r = d.getBoundingClientRect(), vr = v.getBoundingClientRect();
      return {
        src: v.currentSrc || v.querySelector("source")?.getAttribute("src"), poster: v.getAttribute("poster"), controls: v.controls, autoplay: v.autoplay, loop: v.loop,
        preload: v.preload, playsinline: v.hasAttribute("playsinline"), muted: v.muted, trackKind: t?.kind, trackDefault: t?.default, trackSrc: t?.getAttribute("src"), trackLang: t?.srclang,
        label: v.getAttribute("aria-label"), dialogLabel: !!d.getAttribute("aria-labelledby"),
        fits: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1, vw: vr.width, iw: innerWidth,
        overflowX: document.documentElement.scrollWidth > innerWidth + 1,
        placeholder: !!d.querySelector("[data-demo-placeholder]"), focusInDialog: d.contains(document.activeElement),
      };
    });
    check(`${label}: dialog opens with the approved video, controls, poster, playsinline, no placeholder`, /\/demo\/aicc-demo\.mp4$/.test(s.src || "") && s.controls && /aicc-demo-poster\.jpg$/.test(s.poster || "") && s.playsinline && !s.placeholder, JSON.stringify(s));
    check(`${label}: not set to autoplay or loop`, !s.autoplay && !s.loop, JSON.stringify(s));
    check(`${label}: captions track (kind=captions, default, en) points at the VTT`, s.trackKind === "captions" && s.trackDefault && /aicc-demo\.vtt$/.test(s.trackSrc || ""), JSON.stringify(s));
    check(`${label}: dialog is labelled and fits the viewport, video width within it, no page overflow`, s.dialogLabel && s.fits && s.vw <= s.iw && !s.overflowX, JSON.stringify(s));
    // Loading state: metadata arrives; nothing plays on its own.
    await p.waitForFunction(() => document.querySelector("dialog[open] video").readyState >= 1, null, { timeout: 20000 });
    await p.waitForTimeout(1500);
    const m = await p.evaluate(() => { const v = document.querySelector("dialog[open] video"); return { dur: v.duration, w: v.videoWidth, h: v.videoHeight, paused: v.paused, t: v.currentTime, ended: v.ended }; });
    check(`${label}: metadata loads (1920x1080, ~108 s) and it is paused at 0 after 1.5 s (no autoplay)`, Math.abs(m.dur - 108.03) < 0.2 && m.w === 1920 && m.h === 1080 && m.paused && m.t === 0, JSON.stringify(m));
    check(`${label}: dialog focus is inside the dialog`, s.focusInDialog === true || (await p.evaluate(() => document.querySelector("dialog[open]").contains(document.activeElement))));
    // Captions cues.
    const cues = await p.evaluate(async () => {
      const v = document.querySelector("dialog[open] video"); const tt = v.textTracks[0];
      if (!tt) return null;
      if (tt.mode === "disabled") tt.mode = "showing";
      await new Promise((r) => setTimeout(r, 800));
      const arr = [...(tt.cues || [])];
      return { n: arr.length, mode: tt.mode, c: arr.find((c) => c.startTime > 19 && c.startTime < 22)?.text, last: arr.at(-1)?.text };
    });
    check(`${label}: captions load every cue of the VTT; the reveal line lands at ~20 s`, !!cues && cues.n === VTT_CUES && /shopper sees/.test(cues.c || "") && /Available for WooCommerce/.test(cues.last || ""), JSON.stringify(cues));
    // Playback: keyboard (Space) plays, advances, then pauses; seeking works; stays unmuted unless the user mutes.
    await p.evaluate(() => document.querySelector("dialog[open] video").focus());
    await p.keyboard.press("Space");
    await p.waitForFunction(() => document.querySelector("dialog[open] video").currentTime > 1.0, null, { timeout: 15000 }).catch(() => {});
    const pl = await p.evaluate(() => { const v = document.querySelector("dialog[open] video"); return { paused: v.paused, t: v.currentTime, muted: v.muted, vol: v.volume }; });
    check(`${label}: Space plays it (the user starts it), time advances, not muted by the page`, !pl.paused && pl.t > 1 && !pl.muted && pl.vol > 0, JSON.stringify(pl));
    await p.evaluate(() => { document.querySelector("dialog[open] video").currentTime = 70; });
    await p.waitForFunction(() => Math.abs(document.querySelector("dialog[open] video").currentTime - 70) < 3 && !document.querySelector("dialog[open] video").seeking, null, { timeout: 15000 }).catch(() => {});
    const sk = await p.evaluate(() => { const v = document.querySelector("dialog[open] video"); return { t: v.currentTime, seeking: v.seeking }; });
    check(`${label}: seeking to 70 s works`, Math.abs(sk.t - 70) < 3 && !sk.seeking, JSON.stringify(sk));
    if (SHOTS && route === "/" ) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `demo-modal-${prof.name}.png`) }); }
    await p.keyboard.press("Space");
    check(`${label}: Space pauses it again`, await p.evaluate(() => document.querySelector("dialog[open] video").paused));
    // Close: Escape pauses, rewinds, returns focus to the trigger.
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
    const c = await p.evaluate(() => { const v = document.querySelector("dialog video"); return { open: !!document.querySelector("dialog[open]"), paused: v.paused, t: v.currentTime, focusTrig: document.activeElement?.hasAttribute("data-aicc-demo-trigger"), lock: document.documentElement.classList.contains("aicc-scroll-lock") }; });
    check(`${label}: Escape closes, pauses, rewinds to 0, returns focus to the Watch demo button, unlocks scroll`, !c.open && c.paused && c.t === 0 && c.focusTrig && !c.lock, JSON.stringify(c));
    // Reopen: still not autoplaying (the second open must not resume).
    if (prof.tap) await trig.tap(); else await p.keyboard.press("Enter");
    await p.waitForSelector("dialog[open] video");
    await p.waitForTimeout(800);
    check(`${label}: reopening does not autoplay`, await p.evaluate(() => document.querySelector("dialog[open] video").paused));
    await p.keyboard.press("Escape");
    check(`${label}: no page errors`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
}

await browser.close();
stop();
console.log(fails ? `\n${fails} FAILED` : "\nAll demo playback checks passed");
process.exit(fails ? 1 : 0);
