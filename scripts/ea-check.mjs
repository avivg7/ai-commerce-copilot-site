// npm run ea:check: the Early Access campaign's time logic, copy contract and build guard (Production 20). Offline; no browser (the browser side is `npm run test:early-access`).
//   node scripts/ea-check.mjs [--out <dir>] [--expect off|announce|open]     (--out: also audit a BUILT export; --expect: which mode that export was built with)
//
// What it proves:
//  1. the cutoff constant IS 2027-01-01 00:00:00 Asia/Jerusalem, re-derived from the IANA time-zone database (Intl) with no help from the constant, in child processes
//     running under different process time zones (so neither the machine's zone nor DST can move it);
//  2. mode resolution at the boundary: before (1 ms earlier), at, and after the cutoff; the switch only accepts the exact words; a build made at or after the cutoff
//     ignores the switch (a late deployment cannot publish an expired campaign);
//  3. the page script that flips an open page to the "ended" view compares absolute UTC milliseconds only (run in a sandbox at the boundary, under several zones);
//  4. no code of the campaign reads the visitor's time zone or formats a date with the locale;
//  5. every locale carries the disclosures (end date, nothing charged automatically, no card), and the Early Access copy lives only in src/i18n/ea/;
//  6. optionally, a built export: an Early Access build carries the script and the offer, a normal build carries NO trace of the campaign.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { ROOT, loadTs, loadDictionaries } from "./lib/load.mjs";
import { REQUIRED, eaDisclosureProblems } from "./lib/early-access-truth.mjs";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const problems = [];
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { problems.push(m); console.error("  FAIL " + m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

// ── 1. the instant, derived from the IANA database ───────────────────────────────────────────────────────────────────────────────────────────
function deriveFromIana() {
  // Find the UTC instant whose wall clock in Asia/Jerusalem reads 2027-01-01 00:00:00 (search the offsets a zone can have).
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const hits = [];
  for (let off = -14 * 60; off <= 14 * 60; off += 15) {
    const t = Date.UTC(2027, 0, 1) - off * 60000;
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    if (p.year === "2027" && p.month === "01" && p.day === "01" && p.hour === "00" && p.minute === "00" && p.second === "00") hits.push(t);
  }
  return hits;
}
const derive = `const fmt=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Jerusalem",hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"});const h=[];for(let o=-840;o<=840;o+=15){const t=Date.UTC(2027,0,1)-o*60000;const p=Object.fromEntries(fmt.formatToParts(new Date(t)).map(x=>[x.type,x.value]));if(p.year==="2027"&&p.month==="01"&&p.day==="01"&&p.hour==="00"&&p.minute==="00"&&p.second==="00")h.push(t)}console.log(JSON.stringify(h))`;

console.log("1. the cutoff instant");
const ea = await loadTs("src/lib/earlyAccess.ts");
const hits = deriveFromIana();
check(hits.length === 1, `Intl finds exactly one instant at which Jerusalem reads 2027-01-01 00:00:00 (${hits.length})`);
check(hits[0] === ea.EA_CUTOFF_UTC_MS, `EA_CUTOFF_UTC_MS (${ea.EA_CUTOFF_UTC_MS}) equals the IANA-derived instant (${hits[0]})`);
check(ea.EA_CUTOFF_UTC_MS === 1798754400000 && new Date(ea.EA_CUTOFF_UTC_MS).toISOString() === "2026-12-31T22:00:00.000Z", "it is 2026-12-31T22:00:00Z = unix 1798754400, the constant the Control Plane sends to the Backend");
check(ea.EA_CUTOFF_ISO_UTC === "2026-12-31T22:00:00Z", "the machine-readable ISO constant matches");
for (const tz of ["UTC", "America/Los_Angeles", "Asia/Jerusalem", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Australia/Lord_Howe", "Asia/Kolkata"]) {
  const r = spawnSync(process.execPath, ["-e", derive], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  check(r.status === 0 && JSON.parse(r.stdout)[0] === ea.EA_CUTOFF_UTC_MS, `derivation under process time zone ${tz}`);
}
// The last included day and the end day, as calendar facts in Israel (this is what the words "December 31, 2026" / "January 1, 2027" mean).
{
  const day = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(t));
  check(day(ea.EA_CUTOFF_UTC_MS - 1) === ea.EA_LAST_DAY, `1 ms before the cutoff it is still ${ea.EA_LAST_DAY} in Israel`);
  check(day(ea.EA_CUTOFF_UTC_MS) === ea.EA_END_DAY, `at the cutoff it is ${ea.EA_END_DAY} in Israel`);
}

// ── 2. mode resolution ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("2. modes at the boundary");
const C = ea.EA_CUTOFF_UTC_MS;
for (const [raw, want] of [["open", "open"], ["announce", "announce"], [undefined, "off"], ["", "off"], ["true", "off"], ["1", "off"], ["OPEN", "off"], [" open", "off"], ["open ", "off"], ["Announce", "off"], ["on", "off"]])
  check(ea.parseEaMode(raw) === want, `switch ${JSON.stringify(raw)} -> ${want}`);
for (const mode of ["open", "announce"]) {
  check(ea.eaModeAt(mode, C - 1) === mode, `${mode}: 1 ms before the cutoff stays ${mode}`);
  check(ea.eaModeAt(mode, C) === "off", `${mode}: AT the cutoff is off (inclusive)`);
  check(ea.eaModeAt(mode, C + 1) === "off", `${mode}: after the cutoff is off`);
  check(ea.eaModeAt(mode, C + 400 * 86400000) === "off", `${mode}: a year later is off`);
}
check(ea.eaIsOver(C - 1) === false && ea.eaIsOver(C) === true && ea.eaIsOver(C + 1) === true, "eaIsOver: false at C-1, true at C and C+1");
check(ea.eaIsOver(NaN) === true, "eaIsOver(NaN) fails closed (over)");
// The build guard, in real child processes: the build clock is pinned, the switch is set.
{
  const run = (env) => spawnSync(process.execPath, ["--input-type=module", "-e", `import { loadTs } from "${path.join(ROOT, "scripts/lib/load.mjs")}"; const m = await loadTs("src/lib/earlyAccess.ts"); console.log(JSON.stringify({ mode: m.EA_MODE, requested: m.EA_REQUESTED, expired: m.EA_EXPIRED_REQUEST }))`], { env: { ...process.env, ...env }, encoding: "utf8", cwd: ROOT });
  const t = (ms) => ({ AICC_BUILD_NOW_MS: String(ms), AICC_EA_TEST_SEAM: "1" });
  const before = JSON.parse(run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "open", ...t(C - 1) }).stdout);
  const at = JSON.parse(run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "open", ...t(C) }).stdout);
  const late = JSON.parse(run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "announce", ...t(C + 86400000 * 30) }).stdout);
  const none = JSON.parse(run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "", ...t(C - 1000) }).stdout);
  check(before.mode === "open" && !before.expired, "build 1 ms before the cutoff with the switch 'open' -> OPEN");
  check(at.mode === "off" && at.expired, "build AT the cutoff with the switch 'open' -> OFF and flagged as an expired request");
  check(late.mode === "off" && late.expired, "build 30 days after with 'announce' -> OFF (the campaign is NOT published)");
  check(none.mode === "off" && !none.expired, "no switch -> OFF, not flagged");
  // The pin works ONLY with the explicit test-seam variable: a leftover AICC_BUILD_NOW_MS in a release environment must not move the build clock.
  const leftover = JSON.parse(run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "open", AICC_BUILD_NOW_MS: String(C + 86400000 * 30) }).stdout);
  check(leftover.mode === "open" && !leftover.expired, "AICC_BUILD_NOW_MS without AICC_EA_TEST_SEAM=1 is ignored (the real clock is used)");
  const junk = JSON.parse(run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "open", AICC_BUILD_NOW_MS: "abc", AICC_EA_TEST_SEAM: "1" }).stdout);
  check(junk.mode === "open" && !junk.expired, "a malformed build-clock pin ('abc') is ignored: the real clock (before the cutoff) is used and the campaign stays OPEN");
  const junk2 = JSON.parse(run({ NEXT_PUBLIC_AICC_EARLY_ACCESS: "open", AICC_BUILD_NOW_MS: "-5", AICC_EA_TEST_SEAM: "1" }).stdout);
  check(junk2.mode === "open", "a negative pin is ignored too");
}

// ── 3. the page script ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("3. the page script (sandbox, absolute UTC time)");
function runHead(nowMs) {
  const attrs = {};
  const sandbox = { document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } }, Date: { now: () => nowMs } };
  vm.runInNewContext(ea.EA_HEAD_SCRIPT, sandbox, { timeout: 1000 });
  return attrs;
}
check(!("data-ea-over" in runHead(C - 1)), "1 ms before: the document is NOT marked");
check("data-ea-over" in runHead(C), "at the cutoff: the document is marked");
check("data-ea-over" in runHead(C + 3600e3), "an hour after: marked");
check("data-ea-over" in runHead(4102444800000), "far future: marked");
check(!("data-ea-over" in runHead(NaN)), "a broken clock (NaN) leaves the page as built (NaN >= cutoff is false) and does not throw");
{
  const throws = (() => { try { vm.runInNewContext(ea.EA_HEAD_SCRIPT, { document: null, Date: { now: () => 0 } }); return false; } catch { return true; } })();
  check(!throws, "the script never throws (a failure leaves the page as built)");
}
check(!/Intl|toLocale|getTimezoneOffset|new Date\(/.test(ea.EA_HEAD_SCRIPT), "the page script uses no time zone, locale or Date parsing: only Date.now() against a number");
check(ea.EA_HEAD_SCRIPT.includes(String(C)), "the number in the page script is the cutoff constant");
check(ea.EA_HEAD_SCRIPT.length < 200, `the page script is tiny (${ea.EA_HEAD_SCRIPT.length} bytes)`);

// ── 4. no time-zone reads or locale date formatting in the campaign code ─────────────────────────────────────────────────────────────────
console.log("4. campaign code never reads the visitor's time zone");
for (const f of ["src/lib/earlyAccess.ts", "src/components/ea/Ea.tsx", "src/components/ui/PricingCard.tsx"]) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const m = src.match(/getTimezoneOffset|toLocale(Date|Time)?String|Intl\.DateTimeFormat|resolvedOptions|new Date\(|Date\.parse/g);
  check(!m, `${f}: no time-zone read, locale date formatting or Date parsing${m ? ` (${[...new Set(m)].join(", ")})` : ""}`);
}
{
  const strays = [];
  const walkDir = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["node_modules", ".next", "out", "ea"].includes(e.name)) walkDir(p); } else if (/\.(tsx?|css)$/.test(e.name) && !/earlyAccess\.ts$|components\/ea\/Ea\.tsx$/.test(p) && /EA_|data-ea-|\bt\.ea\b|\bea\.(bar|hero|plan|section|after|header)\b|Early Access/.test(fs.readFileSync(p, "utf8")) && !/PricingCard|HomePage|PricingPage|SiteHeader|layout\.tsx|aicc\.css|i18n\/en\.ts|i18n\/(he|es|ru)\.ts$/.test(p)) strays.push(path.relative(ROOT, p)); } };
  walkDir(path.join(ROOT, "src"));
  check(strays.length === 0, `Early Access wiring is confined to the known files${strays.length ? ` (stray: ${strays.join(", ")})` : ""}`);
}

// ── 5. copy contract ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("5. the copy contract in every language");
{
  const dicts = await loadDictionaries();
  const strict = args.includes("--strict");
  const { fallbackUnits } = await loadTs("src/i18n/index.ts");
  for (const l of ["en", "he", "es", "ru"]) {
    const fb = fallbackUnits(l).filter((u) => u.startsWith("ea.") || u === "home.hero");
    if (l !== "en" && fb.length) (strict ? bad : (m) => console.log("  warn " + m))(`${l}: untranslated (English shown, marked lang="en"): ${fb.join(", ")}`);
    else if (l !== "en") ok(`${l}: every ea.* unit and home.hero is translated`);
    const pr = eaDisclosureProblems(l, dicts[l].ea);
    // a fallback locale shows English text, so its required tokens are the English ones
    const pe = fb.length ? eaDisclosureProblems("en", dicts[l].ea) : pr;
    check(pe.length === 0, `${l}: end date, last day and the disclosures are present${pe.length ? " -> " + pe.join("; ") : ""}`);
  }
  check(JSON.stringify(Object.keys(REQUIRED)) === JSON.stringify(["en", "he", "es", "ru"]), "the required-token table covers exactly the four locales");
}

// ── 6. a built export ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const out = arg("out");
if (out) {
  console.log(`6. built export ${out}`);
  const expect = arg("expect") || "off";
  const root = path.resolve(out);
  const html = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const pages = ["index.html", "pricing/index.html", "he/index.html", "he/pricing/index.html", "es/pricing/index.html", "ru/pricing/index.html", "product/index.html", "questions/index.html"];
  for (const p of pages) {
    if (!fs.existsSync(path.join(root, p))) { bad(`${p} missing from the export`); continue; }
    const h = html(p);
    const mode = h.match(/<html[^>]*\sdata-ea-mode="(\w+)"/)?.[1] || "off";
    check(mode === expect, `${p}: built in mode ${mode} (expected ${expect})`);
    const hasScript = h.includes(`Date.now()>=${C}`);
    const trace = /data-ea-(live|after|hide-live|soon|cutoff)|aicc-eabar|Early Access/i.test(h);
    if (expect === "off") { check(!hasScript && !trace, `${p}: a normal build carries no trace of the campaign (no script, no attribute, no text)`); }
    else {
      check(hasScript, `${p}: the head script is present with the cutoff number`);
      const headEnd = h.indexOf("</head>"); const sp = h.indexOf(`Date.now()>=${C}`);
      check(sp > -1 && sp < headEnd, `${p}: the script runs in <head> (before first paint)`);
    }
  }
  if (expect !== "off") {
    const pr = html("pricing/index.html");
    check(/<s>/.test(pr) && /Regular price/.test(pr), "pricing: the regular price is struck through and labelled");
    check(/Free until December 31, 2026/.test(pr) && /January 1, 2027/.test(pr), "pricing: 'Free until December 31, 2026' and the end date 'January 1, 2027' are stated");
    check(!/(<meta[^>]*(description|og:)[^>]*Early Access)/i.test(html("index.html")), "the meta description and Open Graph text do not mention the campaign (they would go stale after the end date)");
    check(!/application\/ld\+json[^<]*Early Access/i.test(html("pricing/index.html")), "no JSON-LD mentions the campaign");
  }
}

// ── 7. the Control Plane constant ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const cp = process.env.AICC_CP_DIR || path.join(process.env.HOME || "", "Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/p20-early-access");
  const f = path.join(cp, "admin/wp-content/plugins/aicc-license-manager/includes/class-aicc-lm-early-access.php");
  console.log("7. the Control Plane cutoff constant");
  if (fs.existsSync(f)) {
    const m = fs.readFileSync(f, "utf8").match(/CUTOFF_UNIX\s*=\s*(\d+)/);
    check(m && Number(m[1]) * 1000 === C, `Control Plane CUTOFF_UNIX (${m ? m[1] : "not found"}) equals the Site constant (${C / 1000})`);
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
