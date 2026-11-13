// npm run test:selfservice: unit tests of the P37 self-service pieces that need no build: the status state -> label/link table, the status answer parser and fetch (every failure keeps the static button),
// the shared store (one request however many buttons), the sign-up URL in four languages (locale prefix, plan, stage/base-path hosts) and the build switch (exact "on", ignored after the end).
//   node scripts/test-selfservice.mjs
import { loadTs, loadDictionaries } from "./lib/load.mjs";

let failed = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { failed++; console.error("  FAIL " + msg); } else console.log("  ok   " + msg); };
const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}${JSON.stringify(a) === JSON.stringify(b) ? "" : `: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`}`);

const SS = await loadTs("src/lib/ssStatus.ts");
const D = await loadDictionaries();

console.log("== state table (state -> label / link): pinned exactly");
// The table is the contract with the Control Plane /start/ page. A change here is a decision, not a refactor: update the S-REPORT and the Control Plane page together.
eq(SS.SS_STATE_TABLE, {
  static: { kind: "link", label: "start" },
  open: { kind: "link", label: "start" },
  waitlist: { kind: "link", label: "waitlist" },
  closed_cutoff: { kind: "text", label: "closed" },
  paused: { kind: "text", label: "paused" },
  off: { kind: "text", label: "notOpen" },
}, "the table is exactly: static/open -> link Start; waitlist -> link Join the waitlist; closed_cutoff, paused, off -> plain text (never a link or a button)");
eq([...SS.SS_MODES], ["open", "waitlist", "closed_cutoff", "paused", "off"], "the five modes of GET /signup/status");
check(Object.isFrozen(SS.SS_STATE_TABLE), "the table is frozen");
check(SS.SS_MODES.every((m) => SS.ssDecision(m) === SS.SS_STATE_TABLE[m]) && SS.ssDecision("static").kind === "link" && SS.ssDecision("nonsense").label === "start", "ssDecision reads the table; an unknown view falls back to the static link");
check(SS.SS_STATUS_PATH === "/wp-json/aicc/v1/signup/status", "the status path is /wp-json/aicc/v1/signup/status (same origin, like the request form)");
for (const l of ["en", "he", "es", "ru"]) {
  const c = D[l].ea.ss.cta;
  const labels = ["start", "waitlist", "closed", "paused", "notOpen"].map((k) => c[k]);
  check(labels.every((x) => typeof x === "string" && x.trim()) && new Set(labels).size === 5, `${l}: all five labels exist and differ: ${labels.join(" | ")}`);
  const textStates = SS.SS_MODES.filter((m) => SS.ssDecision(m).kind === "text").map((m) => c[SS.ssDecision(m).label]);
  check(textStates.length === 3 && textStates.every((x) => !/^(start|join)/i.test(x)), `${l}: the three plain-text states are statements, not invitations`);
}
check(D.en.ea.ss.cta.start === "Start free trial" && D.en.ea.ss.cta.waitlist === "Join the waitlist" && D.en.ea.ss.cta.closed === "Free trial registration closed", "en: the labels are 'Start free trial', 'Join the waitlist', 'Free trial registration closed'");

console.log("== status answer parser: only a complete, valid, consistent answer is used");
const P = SS.parseSsStatus;
for (const m of SS.SS_MODES) eq(P({ open: m === "open", mode: m, plan_options: ["solo"], cap_remaining: "some" }), m, `a ${m} answer -> ${m}`);
eq(P({ mode: "waitlist" }), "waitlist", "no `open` key but a valid mode is accepted");
for (const [name, body] of [["null", null], ["a string", "open"], ["an array", ["open"]], ["no mode", { open: true }], ["unknown mode", { open: true, mode: "maybe" }], ["mode of a wrong type", { mode: 1 }], ["open true with mode paused", { open: true, mode: "paused" }], ["open false with mode open", { open: false, mode: "open" }], ["open as a string", { open: "true", mode: "open" }], ["upper-case mode", { open: true, mode: "OPEN" }]]) eq(P(body), null, `${name} -> null (keep the static button)`);

console.log("== fetchSsMode: every failure keeps the static button (null), never throws");
const res = (status, body, json = true) => ({ status, json: async () => { if (!json) throw new SyntaxError("bad json"); return body; } });
for (const m of SS.SS_MODES) eq(await SS.fetchSsMode(async () => res(200, { open: m === "open", mode: m })), m, `HTTP 200 ${m} -> ${m}`);
for (const s of [204, 301, 400, 403, 404, 429, 500, 503]) eq(await SS.fetchSsMode(async () => res(s, { open: true, mode: "open" })), null, `HTTP ${s} -> null (an open-looking body on a non-200 is not trusted)`);
eq(await SS.fetchSsMode(async () => res(200, null, false)), null, "malformed JSON -> null");
eq(await SS.fetchSsMode(async () => { throw new TypeError("network"); }), null, "network error -> null");
eq(await SS.fetchSsMode(async () => undefined), null, "no response object -> null");
{
  let seen;
  await SS.fetchSsMode(async (url, init) => { seen = { url, init }; return res(200, { mode: "open", open: true }); });
  check(seen.url === "/wp-json/aicc/v1/signup/status" && seen.init.method === "GET" && seen.init.credentials === "omit" && seen.init.cache === "no-store", "the request is a credential-less, uncached GET of the status path (no cookie, no body, no identifier)");
}
{
  const t0 = Date.now();
  const r = await SS.fetchSsMode((url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))), 60);
  check(r === null && Date.now() - t0 < 2000, "a request that never answers times out -> null");
}

console.log("== shared store: one request for any number of buttons; invalid answers change nothing");
{
  globalThis.window = {};
  let calls = 0;
  const f = async () => { calls++; return res(200, { open: false, mode: "closed_cutoff" }); };
  SS.ssReset();
  let notified = 0;
  const un = [SS.ssSubscribe(() => notified++), SS.ssSubscribe(() => notified++), SS.ssSubscribe(() => notified++)];
  check(SS.ssSnapshot() === "static" && SS.ssServerSnapshot() === "static", "before the answer the view is static (server and first client render agree: no hydration mismatch)");
  await Promise.all([SS.ssStart(f), SS.ssStart(f), SS.ssStart(f), SS.ssStart(f)]);
  check(calls === 1, `ONE status request for four buttons (${calls})`);
  check(SS.ssSnapshot() === "closed_cutoff" && notified === 3, "the answer reaches every subscribed button (closed_cutoff, 3 notifications)");
  check(SS.ssServerSnapshot() === "static", "the server snapshot stays static");
  un.forEach((u) => u());
  SS.ssReset();
  await SS.ssStart(async () => res(500, null));
  check(SS.ssSnapshot() === "static", "a 500 leaves the view static");
  SS.ssReset();
  await SS.ssStart(async () => { throw new Error("x"); });
  check(SS.ssSnapshot() === "static", "a network error leaves the view static");
  SS.ssReset();
  delete globalThis.window;
  let called = false;
  await SS.ssStart(async () => { called = true; return res(200, { mode: "open", open: true }); });
  check(!called, "outside a browser (server render, build) no request is made");
}

console.log("== sign-up URL: {CP}/start/?plan=<id>, language prefix, host and base path");
const withEnv = async (env, fn) => {
  const old = {}; for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await fn(await loadTs("src/lib/selfService.ts")); } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
};
const CLEAN = { NEXT_PUBLIC_AICC_SELFSERVICE: "on", NEXT_PUBLIC_AICC_START_URL: undefined, SITE_URL: undefined, AICC_EA_TEST_SEAM: undefined, AICC_BUILD_NOW_MS: undefined };
await withEnv(CLEAN, (m) => {
  eq(m.startUrl("en"), "https://www.copilt.org/start/", "en, no plan");
  eq(m.startUrl("en", "solo"), "https://www.copilt.org/start/?plan=solo", "en solo");
  eq(m.startUrl("he", "studio"), "https://www.copilt.org/he/start/?plan=studio", "he studio (/he/start/)");
  eq(m.startUrl("es", "agency"), "https://www.copilt.org/es/start/?plan=agency", "es agency (/es/start/)");
  eq(m.startUrl("ru", "solo"), "https://www.copilt.org/ru/start/?plan=solo", "ru solo (/ru/start/)");
  eq(m.startUrl("ru"), "https://www.copilt.org/ru/start/", "ru without a plan");
});
await withEnv({ ...CLEAN, SITE_URL: "https://stage.copilt.org" }, (m) => eq(m.startUrl("he", "solo"), "https://stage.copilt.org/he/start/?plan=solo", "a stage build keeps its visitors on the stage host"));
await withEnv({ ...CLEAN, NEXT_PUBLIC_AICC_START_URL: "https://shop.example.com/wp/start/" }, (m) => { eq(m.startUrl("en", "studio"), "https://shop.example.com/wp/start/?plan=studio", "an override with a base path (en)"); eq(m.startUrl("he", "studio"), "https://shop.example.com/wp/he/start/?plan=studio", "an override with a base path: the prefix goes before the last segment"); });
await withEnv({ ...CLEAN, NEXT_PUBLIC_AICC_START_URL: "https://shop.example.com/start/?src=site#x" }, (m) => eq(m.startUrl("es", "solo"), "https://shop.example.com/es/start/?src=site&plan=solo#x", "query and hash are kept; the plan is appended"));

console.log("== build switch: exactly 'on'; ignored at or after the end");
for (const [v, want] of [["on", true], ["ON", false], ["true", false], ["1", false], ["", false], [undefined, false], [" on", false], ["off", false]]) await withEnv({ ...CLEAN, NEXT_PUBLIC_AICC_SELFSERVICE: v }, (m) => check(m.SS_ON === want, `NEXT_PUBLIC_AICC_SELFSERVICE=${JSON.stringify(v)} -> ${want ? "ON" : "OFF"}`));
await withEnv({ ...CLEAN, AICC_EA_TEST_SEAM: "1", AICC_BUILD_NOW_MS: String(Date.UTC(2026, 11, 31, 22, 0, 0) - 1) }, (m) => check(m.SS_ON === true, "one millisecond before the end: ON"));
await withEnv({ ...CLEAN, AICC_EA_TEST_SEAM: "1", AICC_BUILD_NOW_MS: String(Date.UTC(2026, 11, 31, 22, 0, 0)) }, (m) => check(m.SS_ON === false && m.SS_EXPIRED_REQUEST === true, "at the end instant: OFF, and reported as an expired request"));
await withEnv({ ...CLEAN, AICC_BUILD_NOW_MS: String(Date.UTC(2027, 5, 1)) }, (m) => check(m.SS_ON === true, "a pinned clock WITHOUT the test seam is ignored (the real clock decides)"));

console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:selfservice (${failed})`); process.exit(1); }
console.log("PASS test:selfservice");
