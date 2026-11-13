// npm run test:request-form: the request pages in a real browser against a local MOCK of the intake contract (P32). No real Control Plane, mail provider or Turnstile is involved.
//   node scripts/test-request-form.mjs --open <dir> [--verify <dir>]
// It proves the UI side of the contract: inert unless /status says open (closed, 500, malformed, unreachable, missing key); Turnstile is requested only after "open" and only on the request page;
// the POST is exactly the contract body with X-AICC-Request: 1 (JSON); only fixed generic texts are ever shown (neutral 202, 429, 503, bot failure, 400, network failure, Turnstile failure), never
// anything the server said; nothing is stored (no localStorage, sessionStorage, cookie) and nothing but the mock and the Turnstile origin is contacted; the confirm page removes the fragment token
// from the address bar at once, posts on click only, never puts the token in a URL, and shows one neutral text for a valid, an invalid, an expired and a replayed token.
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import { loadDictionaries } from "./lib/load.mjs";
import { startMock, fakeTurnstileScript } from "./lib/intake-mock.mjs";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? path.resolve(args[i + 1]) : undefined; };
const OPEN = arg("open"), VERIFY = arg("verify");
if (!OPEN) { console.error("usage: --open <dir> [--verify <dir>]"); process.exit(2); }
const D = await loadDictionaries();
const LOCALES = ["en", "he", "es", "ru"];
let failed = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { failed++; console.error("  FAIL " + msg); } else console.log("  ok   " + msg); };
const norm = (t) => String(t).replace(/ /g, " ").replace(/\s+/g, " ").trim();
const R = (l) => D[l].ea.request;
const pre = (l) => (l === "en" ? "" : `/${l}`);
// the server vocabulary that must never reach the screen
const LEAK = /rate_limited|invalid_request|verification_failed|invalid_or_expired|"status"|received|verified|too_large|unsupported|forbidden|Retry-After|ft\.\d|mock-turnstile-token/i;

const PBASE = Number(process.env.AICC_TEST_PORT_BASE || 0); // P35: optional fixed port range for the local mocks (else ephemeral)
const mock = await startMock({ dir: OPEN, port: PBASE });
const browser = await launch();
const TS_ORIGIN = "https://challenges.cloudflare.com";

async function open(route, { turnstile = "ok", fixedNow } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const seen = [];
  const external = [];
  await ctx.route(`${TS_ORIGIN}/**`, (r) => { seen.push(r.request().url()); return r.fulfill({ contentType: "text/javascript", body: fakeTurnstileScript({ fail: turnstile === "fail" }) }); });
  await ctx.route((u) => !["127.0.0.1", "challenges.cloudflare.com"].includes(u.hostname), (r) => { external.push(r.request().url()); return r.abort(); });
  if (fixedNow) await ctx.clock.setFixedTime(new Date(fixedNow)); else await ctx.clock.install(); // a flowing fake clock: timers and Date can be fast-forwarded together with the mock server's virtual clock
  const page = await ctx.newPage();
  const urls = [];
  page.on("request", (rq) => urls.push(rq.url()));
  await page.goto(mock.url + route, { waitUntil: "load" });
  return { ctx, page, seen, external, urls };
}
const visible = (page, sel) => page.locator(sel).evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).map((e) => e.innerText).join(" | "));
/** Age the form token: jump the page clock and the mock server's clock by the same amount (no real multi-second waits). */
async function ageToken(page, ms = 3300) { await page.clock.fastForward(ms); mock.advance(ms); }
async function waitState(page, st) { await page.waitForSelector(`[data-req-state="${st}"]`, { timeout: 5000 }); }
async function fillValid(page, plan) {
  await page.fill("#req-email", "owner@mystore.example");
  await page.fill("#req-store", "https://mystore.example");
  if (plan) await page.selectOption("#req-plan", plan);
  await page.check("#req-operator");
  await page.check("#req-consent");
}
async function solve(page) { await page.waitForSelector("[data-fake-ts-button]", { timeout: 5000 }); await page.click("[data-fake-ts-button]"); }

// ── 1. closed, broken and unreachable /status: inert and neutral ──
console.log("== /status closed, broken or unreachable: no form, one neutral sentence, no Turnstile");
for (const st of ["closed", "429", "http500", "badjson", "drop", "missingkey"]) {
  mock.reset(); mock.set({ status: st });
  const { ctx, page, seen } = await open("/request-access/");
  await waitState(page, "closed");
  const t = norm(await page.innerText("main"));
  check(t.includes(R("en").closedBody) && (await page.locator("form").count()) === 0, `status=${st}: "${R("en").closedBody}" and no form`);
  check(seen.length === 0 && (await page.locator("script[data-aicc-turnstile]").count()) === 0, `status=${st}: Turnstile is never requested`);
  check(!LEAK.test(await visible(page, "[data-req-state]")), `status=${st}: nothing the server said is shown`);
  await ctx.close();
}
for (const l of LOCALES) {
  mock.reset(); mock.set({ status: "closed" });
  const { ctx, page } = await open(`${pre(l)}/request-access/`);
  await waitState(page, "closed");
  check(norm(await visible(page, "[data-req-state=closed]")).includes(norm(R(l).closedTitle)) && (await page.locator("form").count()) === 0, `${l}: closed text is the localized neutral sentence, no form`);
  await ctx.close();
}
// after the offer's end instant the page is closed without asking anyone
{
  mock.reset();
  const { ctx, page } = await open("/request-access/", { fixedNow: Date.UTC(2026, 11, 31, 22, 0, 1) });
  await waitState(page, "ended");
  const endedTxt = norm(await visible(page, "[data-req-state=ended]"));
  check(mock.calls("/status").length === 0 && endedTxt.includes(norm(R("en").confirm ? D.en.ea.after.title : "")) && !endedTxt.includes(norm(R("en").closedBody)) && (await page.locator("form").count()) === 0, "at/after the end instant (2026-12-31T22:00:00Z) the page shows the ENDED text (not \"come back later\"), no form, and does not even call /status (stale-page expiry)");
  await ctx.close();
  mock.reset();
  const o = await open("/request-access/", { fixedNow: Date.UTC(2026, 11, 31, 21, 59, 59) });
  await waitState(o.page, "form");
  check(mock.calls("/status").length === 1, "1 s before the end instant the page asks /status and shows the form");
  await o.ctx.close();
}

// ── 2. open: Turnstile only after the answer, only on this page ──
console.log("== /status open: the form, and Turnstile only now");
{
  mock.reset(); mock.set({ statusDelayMs: 600 });
  const { ctx, page, seen } = await open("/request-access/");
  await page.waitForTimeout(250);
  check(seen.length === 0 && (await page.locator("form").count()) === 0, "before /status answers: no form and no request to Turnstile");
  await waitState(page, "form");
  await page.waitForSelector("[data-fake-ts-button]");
  check(seen.length === 1 && seen[0] === `${TS_ORIGIN}/turnstile/v0/api.js`, `after "open": exactly one request to ${TS_ORIGIN}/turnstile/v0/api.js (${seen.join(", ")})`);
  const f = await page.evaluate(() => ({
    email: !!document.querySelector("label[for=req-email]"), store: !!document.querySelector("label[for=req-store]"), plan: !!document.querySelector("label[for=req-plan]"),
    hp: !!document.querySelector("input[name=aicc_hp]") && !document.querySelector("input[name=website]"), hpHidden: document.querySelector("input[name=aicc_hp]").closest("[aria-hidden=true]") !== null && document.querySelector("input[name=aicc_hp]").tabIndex === -1,
    operator: !!document.querySelector("#req-operator"), consent: document.querySelectorAll("a[href*='/terms/'], a[href*='/privacy/']").length,
    notice: document.querySelector("[data-req-notice]")?.innerText || "", live: !!document.querySelector("[role=status][aria-live=polite]"),
  }));
  check((await page.getAttribute("[data-fake-turnstile]", "data-fake-action")) === "request_access" && (await page.getAttribute("[data-fake-turnstile]", "data-fake-sitekey")) === "1x00000000000000000000AA", "the Turnstile widget is rendered with action request_access and the site key from /status (data-action, checked by the server)");
  check(f.email && f.store && f.plan && f.operator && f.hp && f.hpHidden && f.live, "labelled work e-mail, store address, plan, operator checkbox, hidden honeypot (neutral DOM name aicc_hp, sent as the JSON key website), polite live region");
  check(/Cloudflare Turnstile/.test(f.notice) && /Mailco|e-mail delivery provider, to be confirmed/.test(f.notice) && f.consent >= 3, "the in-form notice names Cloudflare Turnstile and the e-mail delivery provider (a visible placeholder or the build value) and links the Privacy Policy; the consent links Terms and Privacy");
  await ctx.close();
  for (const route of ["/", "/pricing/", "/product/", "/request-access/confirm/", "/he/pricing/"]) {
    mock.reset();
    const o = await open(route); await o.page.waitForTimeout(500);
    check(o.seen.length === 0 && !o.urls.some((u) => u.includes("challenges.cloudflare.com")) && mock.calls("/status").length === 0, `${route}: no Turnstile request and no /status call`);
    await o.ctx.close();
  }
}

// ── 3. validation, the exact POST, the neutral success, nothing stored ──
console.log("== validation and the exact POST (English)");
{
  mock.reset();
  const { ctx, page, external } = await open("/request-access/");
  await waitState(page, "form");
  await page.waitForSelector("[data-fake-ts-button]");
  await page.click("button[type=submit]");
  const errs = norm(await visible(page, ".aicc-field__error, .aicc-req__summary"));
  check(errs.includes(R("en").fieldRequired) && errs.includes(R("en").checkRequired) && mock.calls("/access-requests", "POST").length === 0, "empty submit: required-field errors, no request sent");
  await page.waitForTimeout(150);
  check(await page.evaluate(() => document.activeElement?.id === "req-email"), "the first invalid field receives focus");
  await page.fill("#req-email", "not-an-email"); await page.fill("#req-store", "http://shop.example"); await page.click("button[type=submit]");
  const e2 = norm(await visible(page, ".aicc-field__error"));
  check(e2.includes(R("en").emailInvalid) && e2.includes(R("en").storeInvalid) && (await page.getAttribute("#req-email", "aria-invalid")) === "true" && !!(await page.getAttribute("#req-email", "aria-describedby")), "invalid e-mail and a non-https store address are reported on the fields (aria-invalid, aria-describedby)");
  await fillValid(page, "agency");
  await page.click("button[type=submit]");
  check(mock.calls("/access-requests", "POST").length === 0 && norm(await visible(page, "[data-req-message], .aicc-field__error")).includes(R("en").errorBot), "valid fields but the bot check not solved: no request is sent");
  await solve(page);
  await ageToken(page);
  await page.click("button[type=submit]");
  await waitState(page, "done");
  const post = mock.calls("/access-requests", "POST")[0];
  const body = JSON.parse(post.raw);
  check(Object.keys(body).sort().join() === ["email", "form_token", "lang", "operator_confirmed", "plan", "store_url", "terms_accepted", "turnstile_token", "website"].sort().join(), `the POST body has exactly the contract keys (${Object.keys(body).join(", ")})`);
  check(body.email === "owner@mystore.example" && body.store_url === "https://mystore.example" && body.plan === "agency" && body.operator_confirmed === true && body.terms_accepted === true && body.lang === "en" && body.turnstile_token === "mock-turnstile-token-1" && /^ft\./.test(body.form_token) && body.website === "", "values: plan, lang, both booleans true, Turnstile token, form token from /status, empty honeypot");
  check(post.headers["x-aicc-request"] === "1" && /^application\/json/.test(post.headers["content-type"]) && post.bytes < 2048, `headers: X-AICC-Request: 1, Content-Type: application/json, body ${post.bytes} bytes (< 2048)`);
  const okText = norm(await visible(page, "[data-req-state=done]"));
  check(okText.includes(R("en").success) && !LEAK.test(okText) && (await page.locator("form").count()) === 0, `success: the neutral sentence "${R("en").success}" and no form`);
  const store = await page.evaluate(() => ({ ls: localStorage.length, ss: sessionStorage.length, ck: document.cookie, idb: indexedDB.databases ? null : null }));
  check(store.ls === 0 && store.ss === 0 && store.ck === "", "nothing is stored: localStorage, sessionStorage and cookies are empty");
  check(external.length === 0, `no request left the mock and the Turnstile origin (${external.length} blocked)`);
  await ctx.close();
}
// a quick submit (autofill) waits out the contract's 3 s minimum fill time instead of failing (fake clock: no real wait)
{
  mock.reset();
  const { ctx, page } = await open("/request-access/"); await waitState(page, "form"); await fillValid(page); await solve(page);
  await page.click("button[type=submit]"); await page.waitForTimeout(250);
  check(mock.calls("/access-requests", "POST").length === 0, "an immediate submit sends nothing yet (the page holds it until 3.2 s after the form token was issued)");
  await ageToken(page); await waitState(page, "done");
  const st = mock.calls("/status", "GET")[0].t, po = mock.calls("/access-requests", "POST")[0].t;
  check(po - st >= 3000 && mock.calls("/access-requests", "POST").length === 1, `...then it is sent once and accepted (token age ${po - st} ms on the server's clock), never rejected for being too fast`);
  await ctx.close();
}
// a double click sends one request; an expired or failed widget blocks the submit; a refetched token is the one that is sent
{
  mock.reset();
  const { ctx, page } = await open("/request-access/"); await waitState(page, "form"); await fillValid(page); await solve(page); await ageToken(page);
  await page.dblclick("button[type=submit]"); await waitState(page, "done");
  check(mock.calls("/access-requests", "POST").length === 1, "a double click on submit sends exactly one request");
  await ctx.close();
}
{
  mock.reset();
  const { ctx, page } = await open("/request-access/"); await waitState(page, "form"); await fillValid(page); await solve(page); await ageToken(page);
  await page.click("[data-fake-ts-expire]"); await page.click("button[type=submit]"); await page.waitForTimeout(200);
  check(mock.calls("/access-requests", "POST").length === 0 && norm(await visible(page, "[data-req-message]")).includes(R("en").errorBot), "Turnstile expired callback: the token is dropped, submit is blocked with the bot-check text");
  await page.click("[data-fake-ts-error]"); await page.waitForTimeout(150);
  check(norm(await visible(page, ".aicc-field__error")).includes(R("en").botFailed) && mock.calls("/access-requests", "POST").length === 0, "Turnstile error callback: the bot-check failure text is shown and nothing is sent");
  await solve(page); await page.click("button[type=submit]"); await waitState(page, "done");
  check(mock.calls("/access-requests", "POST").length === 1, "after solving the widget again the request goes through");
  await ctx.close();
}
{
  // a form token older than 2 h (the page was left open): the page replaces it (fresh /status) and asks for the widget again; the NEW token is the one that is sent
  mock.reset();
  const { ctx, page } = await open("/request-access/"); await waitState(page, "form"); await fillValid(page); await solve(page);
  const first = mock.calls("/status", "GET")[0];
  await ageToken(page, 111 * 60 * 1000);
  await page.click("button[type=submit]"); await page.waitForFunction((w) => document.querySelector("[data-req-message]")?.innerText.includes(w), R("en").errorBot);
  check(mock.calls("/status", "GET").length === 2 && mock.calls("/access-requests", "POST").length === 0, "a form token older than 110 minutes is replaced by a fresh /status before anything is posted");
  await solve(page); await ageToken(page); await page.click("button[type=submit]"); await waitState(page, "done");
  const post = JSON.parse(mock.calls("/access-requests", "POST")[0].raw), second = mock.calls("/status", "GET")[1];
  const issued = Number(post.form_token.split(".")[1]);
  check(Math.abs(issued - second.t) < 1000 && issued - first.t > 100 * 60 * 1000, `the token that is sent is the NEW one (issued with the second /status, ${Math.round((issued - first.t) / 60000)} min after the first), not the stale one`);
  await ctx.close();
  // after a generic 400 the next attempt carries a refetched token and a re-solved widget (a spent Turnstile token would fail the bot check)
  mock.reset(); mock.set({ create: "400invalid" });
  const o = await open("/request-access/"); await waitState(o.page, "form"); await fillValid(o.page); await solve(o.page); await ageToken(o.page);
  await o.page.click("button[type=submit]"); await o.page.waitForFunction((w) => document.querySelector("[data-req-message]")?.innerText.includes(w), R("en").errorGeneric);
  mock.set({ create: "auto" });
  await solve(o.page); await ageToken(o.page); await o.page.click("button[type=submit]"); await waitState(o.page, "done");
  const posts = mock.calls("/access-requests", "POST").map((x) => JSON.parse(x.raw));
  check(posts.length === 2 && posts[0].form_token !== posts[1].form_token && posts[0].turnstile_token !== posts[1].turnstile_token, "after a 400 the retry carries a fresh form token and a fresh Turnstile token (neither is reused)");
  await o.ctx.close();
  mock.reset();
  { const r = await fetch(mock.url + "/wp-json/aicc/v1/access-requests", { method: "POST", headers: { "Content-Type": "application/json", "X-AICC-Request": "1" }, body: JSON.stringify({ email: "a@b.cc", store_url: "https://x.example", plan: "solo", operator_confirmed: true, terms_accepted: true, lang: "en", turnstile_token: "t1", form_token: `ft.${mock.now()}.9`, website: "" }) });
    check(r.status === 400, "mock sanity: a form token younger than 3 s is 400 invalid_request (the contract's minimum fill time is enforced)"); }
}
// the plan hint of a button preselects the plan
{
  mock.reset();
  const { ctx, page } = await open("/request-access/?plan=solo"); await waitState(page, "form");
  check((await page.inputValue("#req-plan")) === "solo", "?plan=solo preselects Solo");
  await ctx.close();
}

// ── 4. every failure reads as one fixed generic text ──
console.log("== failures: 429, 503, bot failure, 400, network failure, Turnstile failure");
{
  const cases = [
    ["429", "busy", R("en").errorBusy, false], ["400bot", "bot", R("en").errorBot, false], ["400invalid", "invalid", R("en").errorGeneric, false], ["drop", "network", R("en").errorNetwork, false],
  ];
  for (const [create, label, want] of cases) {
    mock.reset(); mock.set({ create });
    const { ctx, page } = await open("/request-access/"); await waitState(page, "form"); await fillValid(page); await solve(page); await ageToken(page);
    await page.click("button[type=submit]");
    await page.waitForFunction((w) => document.querySelector("[data-req-message]")?.innerText.includes(w), want, { timeout: 5000 });
    check(!LEAK.test(await visible(page, "[data-req-message], [data-req-state]")) && (await page.locator("form").count()) === 1, `${create}: the page says "${want}" and nothing the server said (the form stays for another try)`);
    if (create === "429") check(await page.locator("button[type=submit]").isDisabled(), "429 with Retry-After: the submit button stays disabled for the time the server asked (no timer is shown)");
    if (label !== "network") check(mock.calls("/status", "GET").length >= 2, `${create}: a failed attempt asks /status again for a fresh form token`);
    await ctx.close();
  }
  mock.reset(); mock.set({ create: "503" });
  { const { ctx, page } = await open("/request-access/"); await waitState(page, "form"); await fillValid(page); await solve(page); await ageToken(page); await page.click("button[type=submit]"); await waitState(page, "closed");
    check(norm(await visible(page, "[data-req-state=closed]")).includes(R("en").closedBody), "503: the neutral closed text replaces the form"); await ctx.close(); }
  mock.reset();
  { const { ctx, page } = await open("/request-access/", { turnstile: "fail" }); await waitState(page, "form"); await page.waitForSelector("[data-fake-ts-button]"); await page.click("[data-fake-ts-button]");
    await page.waitForFunction((w) => document.body.innerText.includes(w), R("en").botFailed);
    await fillValid(page); await page.click("button[type=submit]");
    check(mock.calls("/access-requests", "POST").length === 0, "Turnstile failure: the bot-check message is shown and no request is sent"); await ctx.close(); }
  // the Turnstile script is blocked (error) or stalls (never fires load): a neutral message and a retry button; retrying loads it again
  for (const mode of ["abort", "stall"]) {
    mock.reset();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" }); await ctx.clock.install();
    let n = 0;
    await ctx.route(`${TS_ORIGIN}/**`, (r) => { n++; if (n === 1) return mode === "abort" ? r.abort() : new Promise(() => {}); return r.fulfill({ contentType: "text/javascript", body: fakeTurnstileScript() }); });
    const page = await ctx.newPage(); await page.goto(mock.url + "/request-access/", { waitUntil: "load" }); await waitState(page, "form");
    if (mode === "stall") await page.clock.fastForward(12500);
    await page.waitForSelector("[data-req-retry]", { timeout: 5000 });
    check(norm(await visible(page, ".aicc-field__error")).includes(R("en").botFailed) && (await page.locator("[data-fake-ts-button]").count()) === 0, `Turnstile script ${mode === "abort" ? "blocked" : "stalled (no load event)"}: the neutral bot-check text and a "${R("en").retry}" button appear`);
    await page.click("[data-req-retry]"); await page.waitForSelector("[data-fake-ts-button]", { timeout: 5000 });
    check(n === 2 && (await page.locator("script[data-aicc-turnstile]").count()) === 1, `...Retry loads the script again (one script element, ${n} requests) and the widget renders`);
    await ctx.close();
  }
  // a hostile client: the server never sees anything but the contract (a forged POST without the header is refused by the mock exactly as the contract says)
  mock.reset();
  { const r1 = await fetch(mock.url + "/wp-json/aicc/v1/access-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const r2 = await fetch(mock.url + "/wp-json/aicc/v1/access-requests", { method: "POST", headers: { "Content-Type": "text/plain", "X-AICC-Request": "1" }, body: "{}" });
    check(r1.status === 403 && r2.status === 415, "mock sanity: a POST without X-AICC-Request is 403 and a non-JSON POST is 415 (the contract rules the page relies on)"); }
}

// ── 5. the same flow in every language, Hebrew right-to-left ──
console.log("== four languages");
for (const l of LOCALES) {
  mock.reset();
  const { ctx, page } = await open(`${pre(l)}/request-access/`); await waitState(page, "form"); await fillValid(page); await solve(page); await ageToken(page);
  const dir = await page.evaluate(() => ({ dir: document.documentElement.dir, ov: document.documentElement.scrollWidth <= innerWidth, label: document.querySelector("label[for=req-email]").innerText }));
  check(dir.dir === (l === "he" ? "rtl" : "ltr") && dir.ov && norm(dir.label) === norm(R(l).email), `${l}: dir=${dir.dir}, no overflow, the field label is localized`);
  await page.click("button[type=submit]"); await waitState(page, "done");
  check(norm(await visible(page, "[data-req-state=done]")).includes(norm(R(l).success)) && JSON.parse(mock.calls("/access-requests", "POST")[0].raw).lang === l, `${l}: the neutral success sentence is localized and lang=${l} is sent`);
  await ctx.close();
}

// ── 6. the confirm page ──
console.log("== confirm page: fragment token, click to confirm, one neutral text");
{
  const TOK = "Abc123_-Abc123_-Abc123_-Abc123_-Abc123_-Abc";
  mock.reset();
  const { ctx, page, urls } = await open(`/request-access/confirm/#t=${TOK}`);
  await page.waitForSelector("[data-req-confirm=ready]");
  const u = await page.evaluate(() => ({ href: location.href, hash: location.hash, len: history.length }));
  check(u.hash === "" && !u.href.includes(TOK), `the token is removed from the address bar at once (${u.href})`);
  await page.waitForTimeout(300);
  check(!(await page.evaluate(() => document.documentElement.outerHTML)).includes(TOK) && (await page.locator('a[href*="#t="]').count()) === 0, "the token is nowhere in the DOM after load (no href of the language menu, header or footer carries it)");
  await page.click(".aicc-site-header .aicc-lang button, .aicc-site-header [data-aicc-lang-btn], .aicc-site-header .aicc-lang__btn", { timeout: 2000 }).catch(() => {});
  check(!(await page.evaluate(() => document.documentElement.outerHTML)).includes(TOK), "...nor after the language menu is opened");
  check(mock.calls("/confirm").length === 0 && !urls.some((x) => x.includes(TOK)), "nothing is sent on load (a mail scanner that prefetches the link confirms nothing) and no URL carries the token");
  const btn = await page.locator("[data-req-confirm] button").first().evaluate((b) => b.getBoundingClientRect().height);
  check(btn >= 44, `the Confirm button is at least 44 px tall (${Math.round(btn)})`);
  await page.click("[data-req-confirm] button");
  await page.waitForSelector("[data-req-confirm=done]");
  const c1 = mock.calls("/confirm", "POST");
  check(c1.length === 1 && JSON.parse(c1[0].raw).token === TOK && c1[0].headers["x-aicc-request"] === "1" && !c1[0].raw.includes("turnstile"), "one click: exactly one POST {token} with X-AICC-Request: 1");
  const done = norm(await visible(page, "[data-req-result]"));
  check(done === norm(R("en").confirm.outcome) && !LEAK.test(done), `result: one neutral sentence ("${R("en").confirm.outcome.slice(0, 50)}...")`);
  await ctx.close();
  // replay, invalid, expired: the same text
  for (const [label, t] of [["replay of the same token", TOK], ["expired token", "expired-token-expired-token-expired"], ["malformed token", "zz"]]) {
    const before = mock.calls("/confirm").length;
    const o = await open(`/request-access/confirm/#t=${t}`);
    await o.page.waitForSelector("[data-req-confirm]");
    const st = await o.page.getAttribute("[data-req-confirm]", "data-req-confirm");
    if (st === "ready") { await o.page.click("[data-req-confirm] button"); await o.page.waitForSelector("[data-req-confirm=done]"); }
    const txt = norm(await visible(o.page, "[data-req-result]"));
    check(label === "malformed token" ? txt === norm(R("en").confirm.noLink) && mock.calls("/confirm").length === before : txt === norm(R("en").confirm.outcome) && !LEAK.test(txt), `${label}: ${label === "malformed token" ? "no button, 'this page needs the link' and nothing sent" : "the same neutral sentence (the page cannot tell a valid token from a spent one)"}`);
    await o.ctx.close();
  }
  { const o = await open("/request-access/confirm/"); await o.page.waitForSelector("[data-req-confirm=nolink]");
    check(norm(await visible(o.page, "[data-req-result]")) === norm(R("en").confirm.noLink), "no fragment: the page asks for the link from the e-mail"); await o.ctx.close(); }
  for (const [mode, label] of [["throttle", "429"], ["503", "503"]]) {
    mock.reset(); mock.set({ confirm: mode });
    const o = await open(`/request-access/confirm/#t=${TOK}`); await o.page.waitForSelector("[data-req-confirm=ready]"); await o.page.click("[data-req-confirm] button"); await o.page.waitForSelector("[data-req-confirm=unavailable]");
    check(norm(await visible(o.page, "[data-req-result]")) === norm(R("en").confirm.unavailable) && (await o.page.locator("[data-req-confirm] button").isEnabled()), `${label} on confirm means temporarily unavailable (not an invalid token): "${R("en").confirm.unavailable}", button enabled, the token is kept for another try`);
    mock.set({ confirm: "auto" }); await o.page.click("[data-req-confirm] button"); await o.page.waitForSelector("[data-req-confirm=done]");
    check(mock.calls("/confirm", "POST").length === 2, `${label}: the same token is accepted on the next press`);
    await o.ctx.close();
  }
  mock.reset(); mock.set({ confirm: "drop" });
  { const o = await open(`/request-access/confirm/#t=${TOK}`); await o.page.waitForSelector("[data-req-confirm=ready]"); await o.page.click("[data-req-confirm] button"); await o.page.waitForSelector("[data-req-confirm=retry]");
    check(norm(await visible(o.page, "[data-req-result]")) === norm(R("en").confirm.error), "network failure on confirm: the same generic retry text"); await o.ctx.close(); }
  for (const l of ["he", "es", "ru"]) {
    mock.reset();
    const o = await open(`${pre(l)}/request-access/confirm/#t=${TOK}`); await o.page.waitForSelector("[data-req-confirm=ready]"); await o.page.click("[data-req-confirm] button"); await o.page.waitForSelector("[data-req-confirm=done]");
    check(norm(await visible(o.page, "[data-req-result]")) === norm(R(l).confirm.outcome) && (await o.page.evaluate(() => location.hash)) === "", `${l}: confirm result is localized; the fragment is gone`); await o.ctx.close();
  }
}

// ── 7. verify build: the banner on the form and the confirm page ──
if (VERIFY) {
  console.log("== verify build");
  const m2 = await startMock({ dir: VERIFY, port: PBASE ? PBASE + 1 : 0 });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  for (const l of LOCALES) for (const kind of ["request-access/", "request-access/confirm/"]) {
    const page = await ctx.newPage();
    await page.goto(`${m2.url}${pre(l)}/${kind}`, { waitUntil: "load" });
    const banner = norm(await visible(page, "[data-req-verify]"));
    check(banner === norm(R(l).verifyBanner) && (await page.locator("meta[name=robots][content='noindex,nofollow']").count()) === 1, `${l} ${kind}: the banner "${R(l).verifyBanner}" is visible and the page is noindex,nofollow`);
    await page.close();
  }
  const home = await ctx.newPage(); await home.goto(m2.url + "/", { waitUntil: "load" });
  check((await home.locator("a[href*='request-access']").count()) === 0 && !(await home.content()).includes("Request Free Access"), "verify build Home: no link to the request page and no request wording (nothing public)");
  await ctx.close(); await m2.close();
}

await browser.close(); await mock.close();
console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:request-form (${failed})`); process.exit(1); }
console.log("PASS test:request-form");
