// npm run ea:check: the Early Access campaign's time logic, copy contract and build guard (Production 20). Offline; no browser (the browser side is `npm run test:early-access`).
//   node scripts/ea-check.mjs [--out <dir>] [--expect off|announce|open] [--expect-step 0|1|2] [--compare-off <dir>] [--strike]
//     (--out: also audit a BUILT export; --expect: which mode it was built with; --expect-step: which extension step (Production 21); --compare-off: a normal build whose head metadata must be identical)
//
// What it proves:
//  1. the cutoff constant IS 2027-01-01 00:00:00 Asia/Jerusalem, and the two extension steps ARE 2027-02-01 and 2027-03-01 00:00:00 Asia/Jerusalem, re-derived from the IANA
//     time-zone database (Intl) with no help from the constants, in child processes running under different process time zones (so neither the machine's zone nor DST can move them);
//  2. mode resolution at the boundary: before (1 ms earlier), at, and after the cutoff; the switch only accepts the exact words; a build made at or after the cutoff
//     ignores the switch (a late deployment cannot publish an expired campaign);
//  3. the page script that flips an open page to the "ended" view compares absolute UTC milliseconds only (run in a sandbox at the boundary, under several zones);
//  4. no code of the campaign reads the visitor's time zone or formats a date with the locale;
//  5. every locale carries the disclosures (end date, nothing charged automatically, no card, the extension reservation, the plan-change answer, the paid-only guarantee) in EVERY
//     extension step (0, 1, 2): one copy set with date TOKENS, no literal year in the packs, no other step's date in a step's text, the token table equal to the independent literals
//     and to Intl's own formatting of the Israel calendar day in each language; and the Early Access copy lives only in src/i18n/ea/;
//  6. optionally, a built export: an Early Access build carries the script and the offer, a normal build carries NO trace of the campaign; an extended build carries its step's end
//     and NONE of the initial-end sentences (the one allowed mention of the first date is the extension note);
//  7. the Control Plane constants (CUTOFF_UNIX and EXTENSION_STEPS) equal the Site's.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { ROOT, loadTs, loadDictionaries } from "./lib/load.mjs";
import { REQUIRED, REQUIRED_DATES, eaDisclosureProblems } from "./lib/early-access-truth.mjs";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const problems = [];
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { problems.push(m); console.error("  FAIL " + m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

// ── 1. the instant, derived from the IANA database ───────────────────────────────────────────────────────────────────────────────────────────
function deriveFromIana(y = 2027, mo = 1, d = 1) {
  // Find the UTC instant whose wall clock in Asia/Jerusalem reads y-mo-d 00:00:00 (search the offsets a zone can have).
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const hits = [];
  for (let off = -14 * 60; off <= 14 * 60; off += 15) {
    const t = Date.UTC(y, mo - 1, d) - off * 60000;
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    if (+p.year === y && +p.month === mo && +p.day === d && p.hour === "00" && p.minute === "00" && p.second === "00") hits.push(t);
  }
  return hits;
}
// The same derivation as a self-contained child-process program (arguments: year month day), run under several process time zones.
const derive = `const [y,mo,d]=process.argv.slice(1).map(Number);const fmt=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Jerusalem",hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"});const h=[];for(let o=-840;o<=840;o+=15){const t=Date.UTC(y,mo-1,d)-o*60000;const p=Object.fromEntries(fmt.formatToParts(new Date(t)).map(x=>[x.type,x.value]));if(+p.year===y&&+p.month===mo&&+p.day===d&&p.hour==="00"&&p.minute==="00"&&p.second==="00")h.push(t)}console.log(JSON.stringify(h))`;
const TZS = ["UTC", "America/Los_Angeles", "Asia/Jerusalem", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Australia/Lord_Howe", "Asia/Kolkata"];
// The earlyAccess module loaded in a child process with a given environment (the build-time switches are read once, at import).
function loadWith(env) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import { loadTs } from "${path.join(ROOT, "scripts/lib/load.mjs")}"; const m = await loadTs("src/lib/earlyAccess.ts"); console.log(JSON.stringify({ mode: m.EA_MODE, requested: m.EA_REQUESTED, expired: m.EA_EXPIRED_REQUEST, step: m.EA_EXTENSION_STEP, end: m.EA_END_UTC_MS, endIso: m.EA_END_ISO_UTC, script: m.EA_HEAD_SCRIPT, extReq: m.EA_EXTENSION_REQUESTED, extRej: m.EA_EXTENSION_REJECTED }))`], { env: { ...process.env, NEXT_PUBLIC_AICC_EARLY_ACCESS: "", NEXT_PUBLIC_AICC_EA_EXTENSION_STEP: "", NEXT_PUBLIC_AICC_EA_EXTENSION_REF: "", AICC_BUILD_NOW_MS: "", AICC_EA_TEST_SEAM: "", ...env }, encoding: "utf8", cwd: ROOT });
  if (r.status !== 0) throw new Error(`child failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

console.log("1. the cutoff instant");
const ea = await loadTs("src/lib/earlyAccess.ts");
const hits = deriveFromIana();
check(hits.length === 1, `Intl finds exactly one instant at which Jerusalem reads 2027-01-01 00:00:00 (${hits.length})`);
check(hits[0] === ea.EA_CUTOFF_UTC_MS, `EA_CUTOFF_UTC_MS (${ea.EA_CUTOFF_UTC_MS}) equals the IANA-derived instant (${hits[0]})`);
check(ea.EA_CUTOFF_UTC_MS === 1798754400000 && new Date(ea.EA_CUTOFF_UTC_MS).toISOString() === "2026-12-31T22:00:00.000Z", "it is 2026-12-31T22:00:00Z = unix 1798754400, the constant the Control Plane sends to the Backend");
check(ea.EA_CUTOFF_ISO_UTC === "2026-12-31T22:00:00Z", "the machine-readable ISO constant matches");
for (const tz of TZS) {
  const r = spawnSync(process.execPath, ["-e", derive, "2027", "1", "1"], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  check(r.status === 0 && JSON.parse(r.stdout)[0] === ea.EA_CUTOFF_UTC_MS, `derivation under process time zone ${tz}`);
}
// The two published extension steps (Production 21): 2027-02-01 00:00 and 2027-03-01 00:00 Asia/Jerusalem, derived from the IANA database exactly like the cutoff.
check(Array.isArray(ea.EA_EXTENSION_STEPS) && ea.EA_EXTENSION_STEPS.length === 2, "EA_EXTENSION_STEPS has exactly two steps");
for (const [i, [mo, d, ms, iso]] of [[2, 1, 1801432800000, "2027-01-31T22:00:00.000Z"], [3, 1, 1803852000000, "2027-02-28T22:00:00.000Z"]].entries()) {
  const h = deriveFromIana(2027, mo, d);
  check(h.length === 1 && h[0] === ea.EA_EXTENSION_STEPS[i], `step ${i + 1}: EA_EXTENSION_STEPS[${i}] (${ea.EA_EXTENSION_STEPS[i]}) equals the IANA-derived instant at which Jerusalem reads 2027-0${mo}-0${d} 00:00:00 (${h[0]})`);
  check(ea.EA_EXTENSION_STEPS[i] === ms && new Date(ms).toISOString() === iso, `step ${i + 1} is ${iso} = unix ${ms / 1000}`);
  for (const tz of TZS) {
    const r = spawnSync(process.execPath, ["-e", derive, "2027", String(mo), String(d)], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
    check(r.status === 0 && JSON.parse(r.stdout)[0] === ea.EA_EXTENSION_STEPS[i], `step ${i + 1}: derivation under process time zone ${tz}`);
  }
}
check(ea.EA_CUTOFF_UTC_MS < ea.EA_EXTENSION_STEPS[0] && ea.EA_EXTENSION_STEPS[0] < ea.EA_EXTENSION_STEPS[1], "the ends are strictly increasing: initial cutoff < step 1 < step 2 (an extension can never shorten)");
// The last included day and the end day, as calendar facts in Israel (this is what the words "December 31, 2026" / "January 1, 2027" mean).
{
  const day = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(t));
  check(day(ea.EA_CUTOFF_UTC_MS - 1) === ea.EA_LAST_DAY, `1 ms before the cutoff it is still ${ea.EA_LAST_DAY} in Israel`);
  check(day(ea.EA_CUTOFF_UTC_MS) === ea.EA_END_DAY, `at the cutoff it is ${ea.EA_END_DAY} in Israel`);
  const ends = [ea.EA_CUTOFF_UTC_MS, ...ea.EA_EXTENSION_STEPS];
  check(Array.isArray(ea.EA_STEP_DAYS) && ea.EA_STEP_DAYS.length === 3, "EA_STEP_DAYS has the initial end and the two steps");
  ends.forEach((e, i) => {
    check(day(e - 1) === ea.EA_STEP_DAYS[i].last && day(e) === ea.EA_STEP_DAYS[i].end, `step ${i}: 1 ms before the end it is ${ea.EA_STEP_DAYS[i].last} (the last included day) and at the end it is ${ea.EA_STEP_DAYS[i].end} in Israel`);
    check(new Date(e).toISOString().slice(0, 10) === ea.EA_STEP_DAYS[i].last, `step ${i}: the UTC date of the end instant is the last included day (the end is 22:00 UTC the day before)`);
  });
}

// ── 2. mode resolution ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("2. modes at the boundary");
const C = ea.EA_CUTOFF_UTC_MS;
const S1 = ea.EA_EXTENSION_STEPS[0], S2 = ea.EA_EXTENSION_STEPS[1];
for (const [raw, want] of [["open", "open"], ["announce", "announce"], [undefined, "off"], ["", "off"], ["true", "off"], ["1", "off"], ["OPEN", "off"], [" open", "off"], ["open ", "off"], ["Announce", "off"], ["on", "off"]])
  check(ea.parseEaMode(raw) === want, `switch ${JSON.stringify(raw)} -> ${want}`);
for (const mode of ["open", "announce"]) {
  check(ea.eaModeAt(mode, C - 1) === mode, `${mode}: 1 ms before the cutoff stays ${mode}`);
  check(ea.eaModeAt(mode, C) === "off", `${mode}: AT the cutoff is off (inclusive)`);
  check(ea.eaModeAt(mode, C + 1) === "off", `${mode}: after the cutoff is off`);
  check(ea.eaModeAt(mode, C + 400 * 86400000) === "off", `${mode}: a year later is off`);
  for (const [n, e] of [[1, S1], [2, S2]]) {
    check(ea.eaModeAt(mode, e - 1, e) === mode && ea.eaModeAt(mode, e, e) === "off" && ea.eaModeAt(mode, e + 1, e) === "off", `${mode}: step ${n}: stays ${mode} 1 ms before its end, is off AT it and after it`);
    check(ea.eaModeAt(mode, C + 1, e) === mode, `${mode}: step ${n}: a clock after the INITIAL cutoff is still ${mode} when the step is in effect`);
  }
}
check(ea.eaIsOver(C - 1) === false && ea.eaIsOver(C) === true && ea.eaIsOver(C + 1) === true, "eaIsOver: false at C-1, true at C and C+1");
check(ea.eaIsOver(NaN) === true, "eaIsOver(NaN) fails closed (over)");
check(ea.eaIsOver(NaN, S2) === true, "eaIsOver(NaN, step end) fails closed (over)");
check(ea.eaEndForStep(0) === C && ea.eaEndForStep(1) === S1 && ea.eaEndForStep(2) === S2, "eaEndForStep: 0 = the initial cutoff, 1 and 2 = the two published steps (nothing else is an end)");
check(ea.EA_STEP_ISO_UTC.every((iso, i) => Date.parse(iso) === [C, S1, S2][i]) && ea.EA_STEP_ISO_UTC.length === 3, "the three ISO strings equal the three millisecond constants");
// The extension input: ONLY the exact words "1" or "2" AND a decision reference; anything else is step 0.
{
  const REF = "DEC-2027-0001";
  for (const [st, ref, want] of [["1", REF, 1], ["2", REF, 2], ["1", undefined, 0], ["2", "", 0], ["1", "ab", 0], ["1", "a".repeat(65), 0], ["1", "a".repeat(64), 1], ["1", "abc", 1], ["1", "has space", 0], ["1", "<script>", 0], ["1", "-leading", 0], ["1", "line\nbreak", 0],
    ["0", REF, 0], ["3", REF, 0], ["01", REF, 0], [" 1", REF, 0], ["1 ", REF, 0], ["one", REF, 0], ["true", REF, 0], ["", REF, 0], [undefined, REF, 0], ["1.0", REF, 0], ["+1", REF, 0], ["-1", REF, 0], ["２", REF, 0]])
    check(ea.parseEaExtension(st, ref).step === want, `extension step ${JSON.stringify(st)} with reference ${JSON.stringify(ref && ref.length > 20 ? ref.length + " chars" : ref)} -> ${want}`);
  check(ea.parseEaExtension("1", undefined).rejected.includes("EXTENSION_REF") && ea.parseEaExtension("9", REF).rejected.includes("exactly"), "a rejected request says why (the reference is missing / the step is not 1 or 2)");
}
// The build guard, in real child processes: the build clock is pinned, the switch and the extension are set.
{
  const run = (env) => loadWith(env);
  const t = (ms) => ({ AICC_BUILD_NOW_MS: String(ms), AICC_EA_TEST_SEAM: "1" });
  const before = run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "open", ...t(C - 1) });
  const at = run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "open", ...t(C) });
  const late = run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "announce", ...t(C + 86400000 * 30) });
  const none = run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "", ...t(C - 1000) });
  check(before.mode === "open" && !before.expired && before.step === 0 && before.end === C, "build 1 ms before the cutoff with the switch 'open' -> OPEN, step 0, the end is the initial cutoff");
  check(at.mode === "off" && at.expired, "build AT the cutoff with the switch 'open' -> OFF and flagged as an expired request");
  check(late.mode === "off" && late.expired, "build 30 days after with 'announce' -> OFF (the campaign is NOT published)");
  check(none.mode === "off" && !none.expired, "no switch -> OFF, not flagged");
  // The pin works ONLY with the explicit test-seam variable: a leftover AICC_BUILD_NOW_MS in a release environment must not move the build clock.
  const leftover = run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "open", AICC_BUILD_NOW_MS: String(C + 86400000 * 30) });
  check(leftover.mode === "open" && !leftover.expired, "AICC_BUILD_NOW_MS without AICC_EA_TEST_SEAM=1 is ignored (the real clock is used)");
  const junk = run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "open", AICC_BUILD_NOW_MS: "abc", AICC_EA_TEST_SEAM: "1" });
  check(junk.mode === "open" && !junk.expired, "a malformed build-clock pin ('abc') is ignored: the real clock (before the cutoff) is used and the campaign stays OPEN");
  const junk2 = run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "open", AICC_BUILD_NOW_MS: "-5", AICC_EA_TEST_SEAM: "1" });
  check(junk2.mode === "open", "a negative pin is ignored too");
  // The extension: the end of the build is the step's instant, the build clock is compared with THAT, and without the reference the step is 0 (the initial end).
  const ext = (step, ref, ms, mode = "open") => run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: mode, ...(step !== undefined ? { NEXT_PUBLIC_AICC_EA_EXTENSION_STEP: step } : {}), ...(ref !== undefined ? { NEXT_PUBLIC_AICC_EA_EXTENSION_REF: ref } : {}), ...t(ms) });
  for (const mode of ["open", "announce"]) {
    const a1 = ext("1", "DEC-0001", C + 10 * 86400000, mode), b1 = ext("1", "DEC-0001", S1 - 1, mode), c1 = ext("1", "DEC-0001", S1, mode), d1 = ext("1", "DEC-0001", S1 + 86400000, mode);
    check(a1.mode === mode && a1.step === 1 && a1.end === S1 && !a1.expired, `${mode}: step 1 with its reference: a build 10 days after the INITIAL cutoff is ${mode}, step 1, ends at ${S1}`);
    check(b1.mode === mode && c1.mode === "off" && c1.expired && d1.mode === "off" && d1.expired, `${mode}: step 1: a build 1 ms before its end is ${mode}; AT its end and after it the build is OFF and flagged (the campaign is not published)`);
    const a2 = ext("2", "DEC-0002", S1 + 86400000, mode), b2 = ext("2", "DEC-0002", S2 - 1, mode), c2 = ext("2", "DEC-0002", S2, mode);
    check(a2.mode === mode && a2.step === 2 && a2.end === S2 && b2.mode === mode && c2.mode === "off" && c2.expired, `${mode}: step 2 ends at ${S2}: ${mode} 1 ms before, OFF at it`);
    const noRef = ext("1", undefined, C + 86400000, mode), emptyRef = ext("1", "", C + 86400000, mode), badRef = ext("2", "x", C + 86400000, mode);
    check(noRef.mode === "off" && noRef.step === 0 && noRef.expired && noRef.extReq && noRef.extRej.includes("REF"), `${mode}: step 1 WITHOUT the reference is step 0: a build after the initial cutoff is OFF (the conservative side), flagged, and says the reference is missing`);
    check(emptyRef.step === 0 && badRef.step === 0 && emptyRef.mode === "off" && badRef.mode === "off", `${mode}: an empty or too short reference is no reference`);
    const early = ext("1", undefined, C - 1000, mode);
    check(early.mode === mode && early.step === 0 && early.end === C && early.extRej !== "", `${mode}: step 1 without a reference, built BEFORE the initial cutoff, is a normal step-0 build (and the rejected request is reported)`);
    const wrong = ext("3", "DEC-0001", C - 1000, mode);
    check(wrong.step === 0 && wrong.end === C, `${mode}: step "3" is step 0`);
  }
  const offWithStep = run({ NEXT_PUBLIC_AICC_EA_EXTENSION_STEP: "1", NEXT_PUBLIC_AICC_EA_EXTENSION_REF: "DEC-0001", ...t(C - 1000) });
  check(offWithStep.mode === "off", "an extension step with the switch OFF changes nothing: the build is OFF");
}

// ── 3. the page script ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("3. the page script (sandbox, absolute UTC time)");
function runHead(script, nowMs) {
  const attrs = {};
  const sandbox = { document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } }, Date: { now: () => nowMs } };
  vm.runInNewContext(script, sandbox, { timeout: 1000 });
  return attrs;
}
for (const [n, env, E] of [[0, {}, C], [1, { NEXT_PUBLIC_AICC_EA_EXTENSION_STEP: "1", NEXT_PUBLIC_AICC_EA_EXTENSION_REF: "DEC-0001" }, S1], [2, { NEXT_PUBLIC_AICC_EA_EXTENSION_STEP: "2", NEXT_PUBLIC_AICC_EA_EXTENSION_REF: "DEC-0002" }, S2]]) {
  const script = loadWith({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "open", AICC_BUILD_NOW_MS: String(C - 1000), AICC_EA_TEST_SEAM: "1", ...env }).script;
  const tag = `step ${n}`;
  check(!("data-ea-over" in runHead(script, E - 1)), `${tag}: 1 ms before the end: the document is NOT marked`);
  check("data-ea-over" in runHead(script, E), `${tag}: at the end: the document is marked`);
  check("data-ea-over" in runHead(script, E + 3600e3), `${tag}: an hour after: marked`);
  check("data-ea-over" in runHead(script, 4102444800000), `${tag}: far future: marked`);
  check(!("data-ea-over" in runHead(script, NaN)), `${tag}: a broken clock (NaN) leaves the page as built (NaN >= end is false) and does not throw`);
  if (n > 0) check(!("data-ea-over" in runHead(script, C + 1)) && !("data-ea-over" in runHead(script, C)), `${tag}: the INITIAL cutoff no longer ends the page (an extended page stays live there)`);
  const throws = (() => { try { vm.runInNewContext(script, { document: null, Date: { now: () => 0 } }); return false; } catch { return true; } })();
  check(!throws, `${tag}: the script never throws (a failure leaves the page as built)`);
  check(!/Intl|toLocale|getTimezoneOffset|new Date\(/.test(script), `${tag}: the page script uses no time zone, locale or Date parsing: only Date.now() against a number`);
  check(script.includes(String(E)) && !script.includes(String(n === 0 ? S1 : C)), `${tag}: the number in the page script is the end of the step`);
  check(script.length < 200, `${tag}: the page script is tiny (${script.length} bytes)`);
}

// ── 4. no time-zone reads or locale date formatting in the campaign code ─────────────────────────────────────────────────────────────────
console.log("4. campaign code never reads the visitor's time zone");
for (const f of ["src/lib/earlyAccess.ts", "src/components/ea/Ea.tsx", "src/components/ui/PricingCard.tsx"]) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const m = src.match(/getTimezoneOffset|toLocale(Date|Time)?String|Intl\.DateTimeFormat|resolvedOptions|new Date\(|Date\.parse/g);
  check(!m, `${f}: no time-zone read, locale date formatting or Date parsing${m ? ` (${[...new Set(m)].join(", ")})` : ""}`);
}
{
  const strays = [];
  const walkDir = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["node_modules", ".next", "out", "ea"].includes(e.name)) walkDir(p); } else if (/\.(tsx?|css)$/.test(e.name) && !/earlyAccess\.ts$|components\/ea\/Ea\.tsx$/.test(p) && /EA_|data-ea-|\bt\.ea\b|\bea\.(bar|hero|plan|section|after|header)\b|Early Access/.test(fs.readFileSync(p, "utf8")) && !/PricingCard|HomePage|PricingPage|SiteHeader|layout\.tsx|aicc\.css|i18n\/en\.ts|i18n\/(he|es|ru)\.ts|i18n\/eaTokens\.ts|i18n\/index\.ts$/.test(p)) strays.push(path.relative(ROOT, p)); } };
  walkDir(path.join(ROOT, "src"));
  check(strays.length === 0, `Early Access wiring is confined to the known files${strays.length ? ` (stray: ${strays.join(", ")})` : ""}`);
}

// ── 5. copy contract ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("5. the copy contract in every language and every extension step");
const LOCALES = ["en", "he", "es", "ru"];
const nbn = (x) => String(x).replace(/ /g, " ");
const dateIn = (text, lit) => new RegExp(`(?<![0-9])${lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(nbn(text)); // "1 de enero de 2027" must not match inside "31 de enero de 2027"
const flat = (o, pre = "", out = []) => { if (typeof o === "string") out.push([pre, o]); else if (o && typeof o === "object") for (const k of Object.keys(o)) flat(o[k], pre ? `${pre}.${k}` : k, out); return out; };
{
  const dicts = await loadDictionaries();
  const strict = args.includes("--strict");
  const idx = await loadTs("src/i18n/index.ts");
  const toks = await loadTs("src/i18n/eaTokens.ts");
  const { fallbackUnits } = idx;
  const raw = { en: (await loadTs("src/i18n/ea/en.ts")).eaEn, he: (await loadTs("src/i18n/ea/he.ts")).eaHe, es: (await loadTs("src/i18n/ea/es.ts")).eaEs, ru: (await loadTs("src/i18n/ea/ru.ts")).eaRu };
  for (const l of LOCALES) {
    const fb = fallbackUnits(l).filter((u) => u.startsWith("ea.") || u === "home.hero");
    if (l !== "en" && fb.length) (strict ? bad : (m) => console.log("  warn " + m))(`${l}: untranslated (English shown, marked lang="en"): ${fb.join(", ")}`);
    else if (l !== "en") ok(`${l}: every ea.* unit and home.hero is translated`);
    for (const step of [0, 1, 2]) {
      const ea = idx.getEaDictionary(l, step);
      const pr = eaDisclosureProblems(l, ea, step);
      // a fallback locale shows English text, so its required tokens are the English ones
      const pe = fb.length ? eaDisclosureProblems("en", ea, step) : pr;
      check(pe.length === 0, `${l} step ${step}: the dates of this end, the time zone and the disclosures are present${pe.length ? " -> " + pe.join("; ") : ""}`);
    }
    // ONE copy set: the packs themselves carry no literal date (everything is a token), and every token they use is a known one
    const rawStrings = flat(raw[l]);
    const lit = rawStrings.filter(([, v]) => /20(26|27)/.test(v));
    check(lit.length === 0, `${l}: the pack has no literal year (the dates are tokens, one copy set)${lit.length ? " -> " + lit.map(([p]) => p).join(", ") : ""}`);
    const unknown = rawStrings.flatMap(([, v]) => [...v.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1])).filter((t) => !toks.EA_DATE_TOKENS.includes(t) && t !== "contactEmail");
    check(unknown.length === 0, `${l}: every {token} in the pack is a date token or {contactEmail}${unknown.length ? " -> " + [...new Set(unknown)].join(", ") : ""}`);
    check(rawStrings.some(([, v]) => v.includes("{firstLastDay}")) && rawStrings.filter(([, v]) => v.includes("{firstLastDay}")).every(([p]) => p === "extended.note"), `${l}: {firstLastDay} (the initial last day) is used by the extension note and by nothing else`);
    // the token table equals the independent literals (REQUIRED_DATES) and Intl's own formatting of the Israel calendar day, step by step
    const tag = { en: "en-US", he: "he-IL", es: "es-ES", ru: "ru-RU" }[l];
    const fmt = (iso, withYear) => nbn(new Intl.DateTimeFormat(tag, { timeZone: "Asia/Jerusalem", ...(withYear ? { year: "numeric" } : {}), month: "long", day: "numeric" }).format(Date.parse(`${iso}T12:00:00Z`))).replace(/ г\.$/, "");
    for (const step of [0, 1, 2]) {
      const row = toks.EA_DATES[l][step], want = REQUIRED_DATES[l][step], days = ea.EA_STEP_DAYS[step];
      check(nbn(row.lastDay).replace(/ г\.$/, "") === nbn(want.last) && nbn(row.endDate).replace(/ г\.$/, "") === nbn(want.end) && nbn(want.utc).endsWith(nbn(row.lastDayShort)), `${l} step ${step}: the token table equals the independent literals (${nbn(row.lastDay)} / ${nbn(row.endDate)} / ${nbn(row.lastDayShort)})`);
      check(nbn(row.lastDay).replace(/ г\.$/, "") === fmt(days.last, true) && nbn(row.endDate).replace(/ г\.$/, "") === fmt(days.end, true) && nbn(row.lastDayShort) === fmt(days.last, false), `${l} step ${step}: the dates are what Intl prints for the Israel calendar days ${days.last} and ${days.end}`);
    }
    // no date of another step is ever rendered in a step's text (the one exception: the extension note names the INITIAL last day, on purpose)
    for (const step of [0, 1, 2]) {
      const strings = flat(idx.getEaDictionary(l, step)).filter(([p]) => !(step > 0 && p === "extended.note"));
      for (const other of [0, 1, 2].filter((o) => o !== step)) {
        const hits = strings.filter(([, v]) => ["last", "end", "utc"].some((k) => dateIn(v, REQUIRED_DATES[l][other][k])));
        check(hits.length === 0, `${l} step ${step}: no date of step ${other} appears in the text${hits.length ? " -> " + hits.map(([p]) => p).join(", ") : ""}`);
      }
    }
    { const note = idx.getEaDictionary(l, 1).extended.note;
      check(dateIn(note, REQUIRED_DATES[l][0].last) && dateIn(idx.getEaDictionary(l, 2).extended.note, REQUIRED_DATES[l][0].last), `${l}: the extension note names the initial last day (${REQUIRED_DATES[l][0].last}), in both steps`); }
    // the dictionary the site renders is the step of THIS process's build (step 0 here)
    check(JSON.stringify(dicts[l].ea) === JSON.stringify(idx.getEaDictionary(l, 0)), `${l}: the dictionary the site renders is the resolved copy of this build's step`);
  }
  check(JSON.stringify(Object.keys(REQUIRED)) === JSON.stringify(["en", "he", "es", "ru"]) && JSON.stringify(Object.keys(REQUIRED_DATES)) === JSON.stringify(["en", "he", "es", "ru"]), "the required-token tables cover exactly the four locales");
  // the resolver refuses an unknown token (a typo can never reach a page)
  let threw = false; try { toks.resolveEaTokens("until {lastDy}", "en", 0); } catch { threw = true; }
  check(threw && toks.resolveEaTokens("a {contactEmail} b", "en", 1) === "a {contactEmail} b" && toks.resolveEaTokens("{endDate}", "en", 2) === "March 1, 2027" && toks.resolveEaTokens("{firstLastDay}", "es", 2) === "31 de diciembre de 2026", "the token resolver: an unknown token throws, {contactEmail} passes through, {endDate} follows the step, {firstLastDay} is always the initial day");
}

// ── 6. a built export ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const out = arg("out");
if (out) {
  console.log(`6. built export ${out}`);
  const expect = arg("expect") || "off";
  const step = Number(arg("expect-step") || 0);
  const E = [C, S1, S2][step];
  const root = path.resolve(out);
  const html = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const pages = ["index.html", "pricing/index.html", "he/index.html", "he/pricing/index.html", "es/index.html", "es/pricing/index.html", "ru/index.html", "ru/pricing/index.html", "product/index.html", "questions/index.html"];
  for (const p of pages) {
    if (!fs.existsSync(path.join(root, p))) { bad(`${p} missing from the export`); continue; }
    const h = html(p);
    const mode = h.match(/<html[^>]*\sdata-ea-mode="(\w+)"/)?.[1] || "off";
    check(mode === expect, `${p}: built in mode ${mode} (expected ${expect})`);
    const hasScript = h.includes(`Date.now()>=${E}`);
    const trace = /data-ea-(live|after|hide-live|soon|cutoff)|aicc-eabar|Early Access/i.test(h);
    if (expect === "off") { check(!hasScript && !trace && !h.includes(String(C)) && !h.includes(String(S1)) && !h.includes(String(S2)), `${p}: a normal build carries no trace of the campaign (no script, no attribute, no text, no end instant)`); }
    else {
      check(hasScript, `${p}: the head script is present with the end number of step ${step} (${E})`);
      const headEnd = h.indexOf("</head>"); const sp = h.indexOf(`Date.now()>=${E}`);
      check(sp > -1 && sp < headEnd, `${p}: the script runs in <head> (before first paint)`);
      const others = [C, S1, S2].filter((x) => x !== E);
      check(!others.some((x) => h.includes(String(x))) && !others.some((x) => h.includes(new Date(x).toISOString().replace(".000Z", "Z"))), `${p}: no other end instant (milliseconds or ISO) appears anywhere in the page`);
    }
  }
  if (expect !== "off") {
    const text = (rel) => nbn(html(rel).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " "));
    const idx = await loadTs("src/i18n/index.ts");
    const pr = html("pricing/index.html");
    if (args.includes("--strike")) check(/<s>/.test(pr) && /Regular price, not charged during Early Access:/.test(pr), "pricing: strike-through ON: the plan price is struck through and labelled");
    else check(!/<s>|<del>/.test(pr.slice(pr.indexOf("<main"), pr.indexOf("</main>"))) && /Planned price when purchases open:/.test(pr), "pricing: strike-through OFF (default): no struck-through price; the price is labelled 'Planned price when purchases open:'");
    check(pr.includes(`Free until ${REQUIRED_DATES.en[step].last}`) && pr.includes(REQUIRED_DATES.en[step].end), `pricing: 'Free until ${REQUIRED_DATES.en[step].last}' and the end date '${REQUIRED_DATES.en[step].end}' are stated`);
    check(!/(<meta[^>]*(description|og:)[^>]*Early Access)/i.test(html("index.html")), "the meta description and Open Graph text do not mention the campaign (they would go stale after the end date)");
    check(!/application\/ld\+json[^<]*Early Access/i.test(html("pricing/index.html")), "no JSON-LD mentions the campaign");
    // every language: the page says THIS step's sentences and no other step's dates (the extension note's mention of the initial last day is the one exception)
    for (const l of LOCALES) {
      const pre = l === "en" ? "" : `${l}/`;
      const mine = idx.getEaDictionary(l, step), first = idx.getEaDictionary(l, 0);
      for (const [rel, want] of [[`${pre}pricing/index.html`, ["plan.free", "plan.term", "section.title", "section.reservation", "section.faq.extension.q", "section.faq.change.q", "section.who.b", "section.steps.use.body"]], [`${pre}index.html`, ["hero.note", "section.homeLead"]]]) {
        const tx = text(rel);
        const missing = want.filter((p) => !tx.includes(nbn(p.split(".").reduce((a, k) => a[k], mine))));
        check(missing.length === 0, `${rel}: says the sentences of step ${step}${missing.length ? " -> missing " + missing.join(", ") : ""}`);
        const barPath = expect === "open" ? (step > 0 ? "extended.bar" : "bar.live") : "bar.announce";
        check(tx.includes(nbn(barPath.split(".").reduce((a, k) => a[k], mine))), `${rel}: the bar says '${barPath}' of step ${step}`);
        for (const other of [0, 1, 2].filter((o) => o !== step)) {
          let n = 0; for (const k of ["last", "end", "utc"]) { const lit = REQUIRED_DATES[l][other][k]; n += (tx.match(new RegExp(`(?<![0-9])${lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")) || []).length; }
          const allowed = step > 0 && other === 0 && rel.endsWith("pricing/index.html") ? 1 : 0; // the extension note
          check(n === allowed, `${rel}: dates of step ${other} appear ${n} time(s) (allowed ${allowed}${allowed ? ": the extension note names the initial last day" : ""})`);
        }
        if (step === 0) check(!tx.includes(nbn(mine.extended.note)) && !tx.includes(nbn(mine.extended.bar)), `${rel}: a step-0 build says nothing about an extension (the reservation is the only extension text)`);
        else if (rel.endsWith("pricing/index.html")) check(tx.includes(nbn(mine.extended.note)), `${rel}: the extension note is in the explanation`);
        // the leak probe: no sentence of the initial-end copy that CHANGED is rendered in an extended build
        if (step > 0) {
          const stale = flat(first).filter(([p, v]) => p !== "extended.note" && v !== flat(mine).find(([q]) => q === p)?.[1] && tx.includes(nbn(v)));
          check(stale.length === 0, `${rel}: no sentence of the initial-end copy is rendered in an extended build${stale.length ? " -> " + stale.map(([p]) => p).join(", ") : ""}`);
        }
      }
    }
  }
}

// ── 7. the Control Plane constants ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const cp = process.env.AICC_CP_DIR || path.join(process.env.HOME || "", "Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/p21-early-access");
  const f = path.join(cp, "admin/wp-content/plugins/aicc-license-manager/includes/class-aicc-lm-early-access.php");
  console.log("7. the Control Plane constants (CUTOFF_UNIX and EXTENSION_STEPS)");
  if (fs.existsSync(f)) {
    const src = fs.readFileSync(f, "utf8");
    const m = src.match(/CUTOFF_UNIX\s*=\s*(\d+)/);
    check(m && Number(m[1]) * 1000 === C, `Control Plane CUTOFF_UNIX (${m ? m[1] : "not found"}) equals the Site constant (${C / 1000})`);
    const e = src.match(/EXTENSION_STEPS\s*=\s*array\(\s*1\s*=>\s*(\d+)\s*,\s*2\s*=>\s*(\d+)\s*,?\s*\)/);
    if (!e) bad(`Control Plane has no EXTENSION_STEPS table with steps 1 and 2 in ${f} (expected from feat/p21-early-access; set AICC_CP_DIR to the worktree that has it)`);
    else check(Number(e[1]) * 1000 === S1 && Number(e[2]) * 1000 === S2, `Control Plane EXTENSION_STEPS (1 => ${e[1]}, 2 => ${e[2]}) equal the Site steps (${S1 / 1000}, ${S2 / 1000})`);
    if (e) check(!/EXTENSION_STEPS\s*=\s*array\([^)]*3\s*=>/.test(src), "Control Plane has exactly two extension steps (no step 3)");
  } else console.log(`  note Control Plane file not found (${f}); set AICC_CP_DIR to compare`);
}

// ── 8. the head metadata is identical with the campaign ON and OFF (it must never mention the campaign) ────────────────────────────────────
const off = arg("compare-off");
if (out && off) {
  console.log(`8. head metadata: ${out} versus the normal build ${off}`);
  const headOf = (h) => {
    const hd = h.slice(h.indexOf("<head"), h.indexOf("</head>"));
    const tags = [...hd.matchAll(/<(title|meta|link)\b[^>]*>(?:[^<]*<\/title>)?/g)].map((x) => x[0]);
    const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((x) => x[1]);
    return JSON.stringify({ tags: tags.filter((t) => !/\/_next\/|nonce|preload/.test(t)), ld });
  };
  const list = (d) => { const r = []; const w = (x, rel) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { if (e.isDirectory()) { if (!["_next", "brand-kit", "fonts", "og", "demo"].includes(e.name)) w(path.join(x, e.name), `${rel}${e.name}/`); } else if (e.name === "index.html") r.push(`${rel}index.html`); } }; w(d, ""); return r; };
  let n = 0, diff = 0;
  for (const rel of list(path.resolve(out))) {
    const o = path.join(path.resolve(off), rel); if (!fs.existsSync(o)) { bad(`${rel} missing from the normal build`); continue; }
    n++;
    if (headOf(fs.readFileSync(path.join(path.resolve(out), rel), "utf8")) !== headOf(fs.readFileSync(o, "utf8"))) { diff++; bad(`${rel}: title / meta / link / JSON-LD differ between the campaign build and the normal build`); }
  }
  check(n > 0 && diff === 0, `${n} pages: title, meta, Open Graph, hreflang, canonical and JSON-LD are byte-identical with the campaign on and off`);
}

console.log("");
if (problems.length) { console.error(`FAIL ea:check (${problems.length})`); process.exit(1); }
console.log("PASS ea:check");
