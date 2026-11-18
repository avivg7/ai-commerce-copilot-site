// npm run test:pricing-sources (P40): the SOURCES of the premium pricing section, offline.
//   node scripts/test-pricing-sources.mjs [--cp <Control Plane worktree>] [--strict]
//  1. the two instants the Site shows and acts on equal the Control Plane constants: registration closes 2026-12-24T00:00:00Z (AICC_LM_Trial::REGISTRATION_CUTOFF_UNIX 1798070400, accepted while now < it) and the trial
//     ends 2026-12-31T22:00:00Z (AICC_LM_Early_Access::CUTOFF_UNIX 1798754400). Written here as literals on purpose (a third, independent statement), and read from the Control Plane checkout when one is given / found
//     (--strict: a missing Control Plane checkout is a failure, not a note);
//  2. NO component of the self-service presentation hard-codes a date, a clock time, a price or a store count: they come from src/data/plans.ts, the pack tokens (src/i18n/eaTokens.ts) and the constants above;
//  3. the one status table: every state the controls can show maps to a pack key (labels and notes), the state values of the markup are the documented ones, and no component names a purchase / checkout URL.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs, ROOT } from "./lib/load.mjs";

const args = process.argv.slice(2);
const argv = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
let failed = 0, total = 0;
const check = (c, m) => { total++; if (!c) { failed++; console.error("  FAIL " + m); } else console.log("  ok   " + m); };

console.log("== 1. the instants equal the Control Plane constants");
const REG_UNIX = 1798070400, END_UNIX = 1798754400;
const { SS_REG_CLOSE_MS, ssRegClosed, SS_STATE_TABLE, SS_INITIAL_TABLE, SS_MODES } = await loadTs("src/lib/ssStatus.ts");
const toks = await loadTs("src/i18n/eaTokens.ts");
const ea = await loadTs("src/lib/earlyAccess.ts");
check(SS_REG_CLOSE_MS === REG_UNIX * 1000 && new Date(SS_REG_CLOSE_MS).toISOString() === "2026-12-24T00:00:00.000Z", "src/lib/ssStatus.ts SS_REG_CLOSE_MS is 2026-12-24T00:00:00Z (unix 1798070400)");
check(toks.SS_REG_CLOSE_UTC_MS === REG_UNIX * 1000, "src/i18n/eaTokens.ts SS_REG_CLOSE_UTC_MS (the date text) is the same instant");
check(ea.EA_CUTOFF_UTC_MS === END_UNIX * 1000 && new Date(ea.EA_CUTOFF_UTC_MS).toISOString() === "2026-12-31T22:00:00.000Z", "src/lib/earlyAccess.ts EA_CUTOFF_UTC_MS is 2026-12-31T22:00:00Z (unix 1798754400)");
check(ssRegClosed(REG_UNIX * 1000 - 1) === false && ssRegClosed(REG_UNIX * 1000) === true, "registration is open at 2026-12-23T23:59:59.999Z and closed at 2026-12-24T00:00:00.000Z (the server accepts while now < cutoff)");
check(REG_UNIX < END_UNIX && END_UNIX - REG_UNIX === 7 * 86400 + 22 * 3600 - 0 * 3600 && new Date(REG_UNIX * 1000).getUTCHours() === 0, "the last day to join is NOT the expiry: 7 days 22 hours apart, registration at 00:00 UTC");
const CP = argv("cp") || process.env.AICC_CP_DIR || path.join(os.homedir(), "Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/p40-pricing");
const trial = path.join(CP, "admin/wp-content/plugins/aicc-license-manager/includes/class-aicc-lm-trial.php"), early = path.join(CP, "admin/wp-content/plugins/aicc-license-manager/includes/class-aicc-lm-early-access.php");
if (CP !== "none" && fs.existsSync(trial) && fs.existsSync(early)) {
  const g = (f, re) => Number((fs.readFileSync(f, "utf8").match(re) || [])[1]);
  check(g(trial, /const\s+REGISTRATION_CUTOFF_UNIX\s*=\s*(\d+)\s*;/) === REG_UNIX, `Control Plane AICC_LM_Trial::REGISTRATION_CUTOFF_UNIX equals ${REG_UNIX} (${path.relative(os.homedir(), trial)})`);
  check(g(early, /const\s+CUTOFF_UNIX\s*=\s*(\d+)\s*;/) === END_UNIX, `Control Plane AICC_LM_Early_Access::CUTOFF_UNIX equals ${END_UNIX}`);
} else if (args.includes("--strict")) check(false, `no Control Plane checkout at ${CP} (--strict: the constants must be compared)`);
else console.log(`  note no Control Plane checkout at ${CP}: the constants were compared with the independent literals only`);

console.log("== 2. no component hard-codes a date, a clock, a price or a store count");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
const COMPONENTS = fs.readdirSync(path.join(ROOT, "src/components/ss")).filter((f) => f.endsWith(".tsx")).map((f) => `src/components/ss/${f}`);
const MONTHS = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? ?\d|\d{1,2}[ ](?:de )?(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic|янв|фев|мар|апр|мая|июн|июл|авг|сен|окт|ноя|дек)/i;
const RULES = [
  [/\b20(2[5-9]|3\d)\b/, "a year (2025-2039)"],
  [/\b([01]?\d|2[0-3]):[0-5]\d\b/, "a clock time"],
  [MONTHS, "a calendar date"],
  [/\b1[78]\d{8}(?:000)?\b/, "a unix / ms timestamp"],
  [/\$\s?\d|US\$|\bUSD\b/, "a price or currency literal"],
  [/\b(99|199|499)\b/, "a plan price (99 / 199 / 499)"],
  [/\b(?:1|3|10|one|three|ten)\s+(?:stores?|tiendas?|магазин)/i, "a store count next to the word store"],
  // a comparison with 1 only picks the singular string ("Paid plan: 1 store"); any other count literal is a hard-coded capacity
  [/\bstores\s*:\s*\d|\bstores\s*===?\s*(?!1\b)\d|\.stores\s*[<>]=?\s*\d/, "a hard-coded store-count comparison (only === 1, the singular, is allowed)"],
];
for (const f of COMPONENTS) {
  const src = strip(fs.readFileSync(path.join(ROOT, f), "utf8"));
  const hits = RULES.filter(([re]) => re.test(src)).map(([, why]) => why);
  check(hits.length === 0, `${f}: no hard-coded date, clock, price or store count${hits.length ? " -> " + hits.join(", ") : ""}`);
}
{ // the page files: the self-service part names no price / store count either (everything it renders comes from SsPlans / the pack)
  for (const f of ["src/components/pages/HomePage.tsx", "src/components/pages/PricingPage.tsx", "src/components/pages/ProductPage.tsx", "src/components/layout/SiteHeader.tsx"]) {
    const src = strip(fs.readFileSync(path.join(ROOT, f), "utf8"));
    const ss = src.split("\n").filter((l) => /\bSs[A-Z]\w*|SS_ON|ea\.ss\b/.test(l)).join("\n");
    const hits = RULES.filter(([re]) => re.test(ss)).map(([, why]) => why);
    check(hits.length === 0, `${f}: the lines that wire self-service name no date, clock, price or store count${hits.length ? " -> " + hits.join(", ") : ""}`);
  }
}

console.log("== 3. one status table; no purchase link on the Site");
const LABELS = ["soon", "start", "waitlist", "closed", "paused"];
check(SS_MODES.every((m) => SS_STATE_TABLE[m] && LABELS.includes(SS_STATE_TABLE[m].label)) && Object.values(SS_INITIAL_TABLE).every((d) => LABELS.includes(d.label)), "every sign-up status (open, waitlist, closed_cutoff, paused, off) and both build-time initial states map to one of the five control labels");
const { getEaDictionary } = await loadTs("src/i18n/index.ts");
for (const l of ["en", "he", "es", "ru"]) {
  const ss = getEaDictionary(l, 0).ss;
  const notes = { soon: ss.state.soonNote, closed: ss.state.closedNote, paused: ss.state.pausedNote, waitlist: ss.state.waitlistNote };
  check(LABELS.every((k) => typeof ss.cta[k] === "string" && ss.cta[k].trim()) && Object.values(notes).every((n) => typeof n === "string" && n.trim().length > 20), `${l}: every control label and every state note exists in the pack`);
}
{
  const cta = strip(fs.readFileSync(path.join(ROOT, "src/components/ss/SsCta.tsx"), "utf8")), plans = strip(fs.readFileSync(path.join(ROOT, "src/components/ss/SsPlans.tsx"), "utf8")), ss = strip(fs.readFileSync(path.join(ROOT, "src/components/ss/Ss.tsx"), "utf8"));
  check(!/checkout|\/cart|purchaseUrl|purchase_url|planUrl|getStartedUrl/.test(cta) && !/checkout|\/cart|purchase_url/.test(plans + ss), "the live (sign-up) controls name no checkout, cart or purchase URL: the Site never links to a purchase");
  const states = [...cta.matchAll(/data-ss-state=\{(\w+)\}/g)].length;
  check(states >= 2 && /role="status"/.test(cta) && /data-ss-cta="status"/.test(cta) && /data-ss-cta="link"/.test(cta), "SsCta renders the two control families (link, status) with data-ss-state and role=\"status\" on the status region");
  check(/#demo|ctaDemo|data-ss-demo|SsDemoLink/.test(cta + plans + ss) === false, "no control of the section can lead to #demo (the per-card demo link and SsDemoLink are retired)");
  check(/ssDecision\(view, initial, closedByClock\)/.test(cta) && /ssRegClosedSubscribe/.test(cta), "the control keeps the one decision function (ssDecision) and the browser-clock cutoff subscription");
}

console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:pricing-sources (${failed})`); process.exit(1); }
console.log("PASS test:pricing-sources");
