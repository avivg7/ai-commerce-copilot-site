// npm run test:demo: the built site's "Watch demo" dialog with the owner-approved master, in a real browser (needs a build in out/).
//   Serves out/ itself (with byte ranges), then on desktop, mobile (touch) and reduced-motion contexts checks:
//   the served bytes are the approved master (sha256 in docs/approved-demo.sha256), the dialog opens, the <video> has controls + poster + a default captions track,
//   it does NOT autoplay (or play sound by itself), metadata loads, keyboard play/pause and seeking work, captions cues exist and show, the player fits the viewport,
//   Escape closes, playback pauses and rewinds, and focus returns to the trigger.
// Payload (OWNER ask, 2026-10-20): the 44 MB master must never be fetched by merely visiting a page. On Home (desktop and 390 mobile, English and Hebrew), BEFORE the dialog
//   is opened there is no request at all for /demo/ (video, captions, poster); after opening it and BEFORE play only ranged requests for the video occur (the first is a
//   `Range: bytes=0-` request, never a plain 200), `preload="metadata"` is honoured, and the bytes the browser actually received (Chromium DevTools protocol dataReceived, which
//   counts what the page's network stack read) stay under a byte budget (< 4 MB of 43,957,999). The static server also logs what it wrote to the socket (--stats): that figure is
//   inflated by kernel socket buffers on loopback, so it only has to stay well under the whole file (< 25%). Both numbers are printed.
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

const server = spawn("node", [path.join(ROOT, "scripts/serve-out.mjs"), "--port", String(PORT), "--stats"], { stdio: "ignore" });
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

// 2. Payload before the dialog is opened and before play (see the header). Budget on the bytes the browser read from the video; the file is 43,957,999 bytes.
{
  const MASTER_BYTES = 43957999;
  const CLIENT_BUDGET = Number(process.env.AICC_DEMO_PREPLAY_BUDGET || 4_000_000);
  const SERVER_CAP = Math.floor(MASTER_BYTES * 0.25);
  const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
  const serverLog = async () => (await fetch(`${BASE}/__stats`)).json();
  const reset = () => fetch(`${BASE}/__stats/reset`);
  const payloadProfiles = [
    { name: "desktop", opts: { viewport: { width: 1280, height: 800 } }, tap: false },
    { name: "mobile 390", opts: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, tap: true },
  ];
  for (const prof of payloadProfiles) for (const route of ["/", "/he/"]) {
    const label = `payload ${prof.name} ${route}`;
    await reset();
    const ctx = await browser.newContext(prof.opts);
    const p = await ctx.newPage();
    const seen = [];
    p.on("request", (r) => seen.push({ url: r.url(), range: null }));
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Network.enable");
    const R = new Map();
    const rec = (id) => { if (!R.has(id)) R.set(id, { url: "", client: 0 }); return R.get(id); };
    cdp.on("Network.requestWillBeSent", (e) => { rec(e.requestId).url = e.request.url; });
    cdp.on("Network.dataReceived", (e) => { rec(e.requestId).client += e.dataLength; });
    await p.goto(`${BASE}${route}`, { waitUntil: "load" });
    await p.waitForLoadState("networkidle");
    // Scroll the whole page (lazy sections), then wait: nothing about the demo may be fetched by a visit alone.
    const h = await p.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 500) { await p.evaluate((v) => window.scrollTo(0, v), y); await p.waitForTimeout(40); }
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(1500);
    const log0 = await serverLog();
    const demo0 = log0.filter((e) => /\/demo\//.test(e.url));
    const seenDemo0 = seen.filter((r) => /\/demo\//.test(r.url));
    const loadBytes = log0.reduce((a, e) => a + e.sent, 0);
    check(`${label}: BEFORE the dialog opens there is no request for /demo/ at all (video, captions, poster): browser saw ${seenDemo0.length}, server saw ${demo0.length}; page load wrote ${mb(loadBytes)} in ${log0.length} responses`, seenDemo0.length === 0 && demo0.length === 0, JSON.stringify(demo0.map((e) => e.url)));
    // Open the dialog; do NOT press play.
    await p.waitForFunction(() => document.querySelector("[data-aicc-demo-trigger]")?.dataset.aiccBound === "1", null, { timeout: 15000 });
    const trig = p.locator("[data-aicc-demo-trigger]:visible").first();
    await trig.scrollIntoViewIfNeeded();
    if (prof.tap) await trig.tap(); else await trig.click();
    await p.waitForSelector("dialog[open] video");
    await p.waitForFunction(() => document.querySelector("dialog[open] video").readyState >= 1, null, { timeout: 20000 });
    await p.waitForTimeout(3000);
    const v = await p.evaluate(() => { const e = document.querySelector("dialog[open] video"); return { attr: e.getAttribute("preload"), prop: e.preload, paused: e.paused, t: e.currentTime, auto: e.autoplay, rs: e.readyState }; });
    const log1 = await serverLog();
    const mp4 = log1.filter((e) => /\/demo\/aicc-demo\.mp4$/.test(e.url));
    const clientMp4 = [...R.values()].filter((r) => /\/demo\/aicc-demo\.mp4$/.test(r.url)).reduce((a, r) => a + r.client, 0);
    const serverMp4 = mp4.reduce((a, e) => a + e.sent, 0);
    const others = log1.filter((e) => /\/demo\//.test(e.url) && !/\.mp4$/.test(e.url));
    check(`${label}: <video preload="metadata"> is honoured (attribute "${v.attr}", property "${v.prop}"), paused at 0, no autoplay`, v.attr === "metadata" && v.prop === "metadata" && v.paused && v.t === 0 && !v.auto, JSON.stringify(v));
    check(`${label}: the video is requested only AFTER opening, and every video request is ranged (${mp4.map((e) => `${e.range} -> ${e.status}`).join("; ") || "none"})`, mp4.length >= 1 && mp4.every((e) => /^bytes=\d+-\d*$/.test(e.range || "") && e.status === 206), JSON.stringify(mp4));
    check(`${label}: the FIRST video request is a Range request starting at byte 0 (${mp4[0]?.range})`, !!mp4[0] && /^bytes=0-/.test(mp4[0].range || ""));
    check(`${label}: the whole file is never requested with a plain 200 and no request has completed the 43,957,999 bytes before play`, mp4.every((e) => e.status !== 200) && mp4.every((e) => e.sent < MASTER_BYTES), JSON.stringify(mp4.map((e) => [e.status, e.sent])));
    check(`${label}: bytes the browser READ from the video before play = ${mb(clientMp4)} (${(100 * clientMp4 / MASTER_BYTES).toFixed(1)}% of the file) < budget ${mb(CLIENT_BUDGET)}`, clientMp4 > 0 && clientMp4 < CLIENT_BUDGET, `client=${clientMp4}`);
    check(`${label}: bytes the server WROTE for the video before play = ${mb(serverMp4)} (${(100 * serverMp4 / MASTER_BYTES).toFixed(1)}%, includes loopback socket buffering) < 25% of the file (${mb(SERVER_CAP)})`, serverMp4 < SERVER_CAP, `server=${serverMp4}`);
    check(`${label}: poster and captions are requested once each, and only now (${others.map((e) => e.url.split("/").pop() + " " + e.sent + " B").join(", ")})`, others.length === 2 && others.every((e) => e.sent < 400_000), JSON.stringify(others));
    await p.keyboard.press("Escape");
    await ctx.close();
  }
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
    // Captions styling: the shared kit's restrained, dialog-scoped ::cue rule exists in the loaded stylesheets (computed ::cue is not readable from JS in every browser, so the
    // rule is read from the CSSOM). Near-white text on a dark panel, >= 7:1 even over a white frame; the size cut applies only on a wide player; nothing else is hidden or restyled.
    const cue = await p.evaluate(() => {
      const found = [];
      const walk = (rules, media) => { for (const r of rules) { if (r.cssRules && !r.selectorText) walk(r.cssRules, r.conditionText || r.media?.mediaText || ""); else if (r.selectorText && /::cue/.test(r.selectorText)) found.push({ sel: r.selectorText, css: r.style.cssText, media }); } };
      for (const ss of document.styleSheets) { try { walk(ss.cssRules, ""); } catch {} }
      return found;
    });
    const cueBase = cue.find((r) => !r.media), cueWide = cue.find((r) => /min-width/.test(r.media));
    const lumOf = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const rgbaOf = (css, prop) => { const m = new RegExp(`${prop}:\\s*rgba?\\(([^)]+)\\)`).exec(css || ""); if (!m) return null; const q = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [q[0], q[1], q[2], q[3] ?? 1]; };
    const bg = rgbaOf(cueBase?.css, "background-color"), fg = rgbaOf(cueBase?.css, "color") || (/color:\s*(#fff|white)/.test(cueBase?.css || "") ? [255, 255, 255, 1] : null);
    // worst case: the panel over a pure-white video pixel
    const eff = bg && [0, 1, 2].map((i) => bg[i] * bg[3] + 255 * (1 - bg[3]));
    const ratio = eff && fg ? (lumOf(fg) + 0.05) / (lumOf(eff) + 0.05) : 0;
    check(`${label}: captions rule is scoped to the dialog's video (.aicc-modal video::cue), near-white on a dark panel, >= 7:1 even over a white frame (${ratio.toFixed(1)}:1)`, !!cueBase && /^\.aicc-modal video::cue$/.test(cueBase.sel) && ratio >= 7 && bg[3] >= 0.8, JSON.stringify(cue));
    check(`${label}: the caption size cut applies only on a wide player (min-width media rule), never to the controls`, !!cueWide && /font-size:\s*70%/.test(cueWide.css) && !cue.some((r) => !/^\.aicc-modal video::cue$/.test(r.sel)) && !/display|visibility|opacity/.test(cueBase?.css || ""), JSON.stringify(cue));
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
