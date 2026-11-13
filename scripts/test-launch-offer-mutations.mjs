// npm run test:launch-offer-mutations: proves the P36 regression guards of test-launch-offer.mjs FAIL on the regressions the owner named. Each mutation breaks a COPY of the ANNOUNCE export in one way
// and the suite must then exit non-zero with the expected failure text; the untouched export must pass.
//   node scripts/test-launch-offer-mutations.mjs --off <dir> --announce <dir> --open <dir> --verify <dir> [--ss-off <dir> --ss-announce <dir> --ss-open <dir>]
// P37: with the three self-service exports the same is proved for the SELF-SERVICE matrix: the Hero loses Try Live Demo, a card button becomes #demo, a card button leads to /request-access/ while self-service is on,
// a card button leads to a route that does not exist (relative and Control Plane), the status-only inert chip comes back on a card, the trial allowance disappears, a card claims more than 10 stores, the header "Get started"
// goes back to the account page, "approved stores" / "Request Free Access" wording returns, and the Hero of an open build gets a request link back: each must FAIL the suite.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? path.resolve(args[i + 1]) : undefined; };
const dirs = { off: arg("off"), announce: arg("announce"), open: arg("open"), verify: arg("verify") };
const ssDirs = { off: arg("ss-off"), announce: arg("ss-announce"), open: arg("ss-open") };
if (!dirs.off || !dirs.announce || !dirs.open || !dirs.verify) { console.error("usage: --off <dir> --announce <dir> --open <dir> --verify <dir>"); process.exit(2); }
let total = 0, failed = 0;
const check = (c, m) => { total++; if (!c) { failed++; console.error("  FAIL " + m); } else console.log("  ok   " + m); };
const run = (announce) => spawnSync("node", ["scripts/test-launch-offer.mjs", "--off", dirs.off, "--announce", announce, "--open", dirs.open, "--verify", dirs.verify], { encoding: "utf8", env: { ...process.env, AICC_CP_DIR: "none" }, maxBuffer: 1 << 28 });
const runSs = (cell, copy) => spawnSync("node", ["scripts/test-launch-offer.mjs", "--off", dirs.off, "--announce", dirs.announce, "--open", dirs.open, "--verify", dirs.verify, ...Object.entries({ ...ssDirs, [cell]: copy }).flatMap(([k, v]) => (v ? [`--ss-${k}`, v] : []))], { encoding: "utf8", env: { ...process.env, AICC_CP_DIR: "none" }, maxBuffer: 1 << 28 });
const edit = (dir, rel, fn) => { const f = path.join(dir, rel); const t = fs.readFileSync(f, "utf8"); const n = fn(t); if (n === t) throw new Error(`mutation did not change ${rel}`); fs.writeFileSync(f, n); };
const heroActions = (t) => { const i = t.indexOf('class="aicc-hero-actions'); return [i, t.indexOf("</div>", i)]; };
const MUTATIONS = [
  ["the Hero loses Try Live Demo", "Try Live Demo|href=\"#demo\"", (d) => edit(d, "index.html", (t) => { const [a, b] = heroActions(t); const seg = t.slice(a, b).replace(/<a\b[^>]*href="#demo"[\s\S]*?<\/a>/, ""); return t.slice(0, a) + seg + t.slice(b); })],
  ["the Live Demo destination changes", "#demo", (d) => edit(d, "index.html", (t) => { const [a, b] = heroActions(t); return t.slice(0, a) + t.slice(a, b).replace('href="#demo"', 'href="#somewhere-else"') + t.slice(b); })],
  ["See Pricing disappears from the Hero", "See Pricing|pricing", (d) => edit(d, "index.html", (t) => { const [a, b] = heroActions(t); return t.slice(0, a) + t.slice(a, b).replace(/<a\b[^>]*href="\/pricing\/"[\s\S]*?<\/a>/, "") + t.slice(b); })],
  ["an inert button-looking chip is put back in the Hero", "inert", (d) => edit(d, "index.html", (t) => { const [a] = heroActions(t); const e = t.indexOf(">", a) + 1; return t.slice(0, e) + '<p class="aicc-btn aicc-btn--lg aicc-btn--soon" data-ea-soon>Free access requests open soon</p>' + t.slice(e); })],
  ["FREE is made smaller than the regular price", "dominant", (d) => edit(d, "index.html", (t) => t.replace(/(\.aicc-plan \.aicc-plan__free-word\{font-size:)3\.5rem/, "$11.5rem"))],
  ["a plan card links to the request page while requests are not open", "request-access", (d) => edit(d, "index.html", (t) => t.replace(/(<a\b[^>]*class="aicc-btn[^"]*"[^>]*href=")\/#demo/, "$1/request-access/?plan=solo"))],
];
// ----- P37 self-service mutations: [cell, name, expected failure text, mutate]
const firstCard = (t, plan) => t.replace(new RegExp(`(<a\\b[^>]*href=")https://www\\.copilt\\.org/start/\\?plan=${plan}(")`), "$1@@$2");
const SS_MUTATIONS = [
  ["announce", "the Hero loses Try Live Demo (self-service on)", "Hero keeps|primary link to #demo|exactly its two actions", (d) => edit(d, "index.html", (t) => { const [a, b] = heroActions(t); return t.slice(0, a) + t.slice(a, b).replace(/<a\b[^>]*href="#demo"[\s\S]*?<\/a>/, "") + t.slice(b); })],
  ["announce", "a plan card button is changed to #demo", "targets #demo|ONE action", (d) => edit(d, "pricing/index.html", (t) => firstCard(t, "solo").replace("@@", "/#demo"))],
  ["announce", "a plan card button leads to /request-access/ while self-service is on", "request-access|ONE action", (d) => edit(d, "pricing/index.html", (t) => firstCard(t, "studio").replace("@@", "/request-access/?plan=studio"))],
  ["announce", "a plan card button leads to a relative route that does not exist", "resolves|ONE action", (d) => edit(d, "pricing/index.html", (t) => firstCard(t, "agency").replace("@@", "/get-started/?plan=agency"))],
  ["off", "a plan card button leads to a Control Plane path outside the allow-list", "resolves|ONE action", (d) => edit(d, "pricing/index.html", (t) => firstCard(t, "solo").replace("@@", "https://www.copilt.org/signup/"))],
  ["off", "the plan query of a card button is wrong (studio card asks for solo)", "ONE action", (d) => edit(d, "index.html", (t) => t.replace("start/?plan=studio", "start/?plan=solo"))],
  ["announce", "the status-only inert button comes back on a card", "inert", (d) => edit(d, "pricing/index.html", (t) => t.replace('<ul class="aicc-plan__checks"', '<p class="aicc-btn aicc-btn--lg aicc-btn--block aicc-btn--soon" data-commerce="closed">Purchases open soon</p><ul class="aicc-plan__checks"'))],
  ["off", "the status-only inert button comes back on a card (self-service without a launch offer)", "inert", (d) => edit(d, "index.html", (t) => t.replace('<ul class="aicc-plan__checks"', '<p class="aicc-btn aicc-btn--lg aicc-btn--block aicc-btn--soon" data-commerce="closed">Purchases open soon</p><ul class="aicc-plan__checks"'))],
  ["announce", "the trial allowance disappears from a card", "trial|allowance", (d) => edit(d, "pricing/index.html", (t) => t.replace(/<li><svg(?:(?!<li>)[\s\S])*?<span[^>]*>Free trial: 1 store<\/span><\/li>/, ""))],
  ["announce", "a card claims more than 10 stores", "store counts|capacity", (d) => edit(d, "pricing/index.html", (t) => t.replace("Paid plan: up to 10 stores", "Paid plan: up to 25 stores"))],
  ["announce", "the header Get started goes back to the account page", "header", (d) => edit(d, "index.html", (t) => t.replace(/(<header[\s\S]*?)href="https:\/\/www\.copilt\.org\/start\/"/, '$1href="https://www.copilt.org/my-account/"'))],
  ["announce", "a closing band loses the sign-up button", "closing band", (d) => edit(d, "pricing/index.html", (t) => { const i = t.indexOf('aria-labelledby="pricing-final"'); const j = t.indexOf("</section>", i); return t.slice(0, i) + t.slice(i, j).replace(/<a\b[^>]*href="https:\/\/www\.copilt\.org\/start\/"[\s\S]*?<\/a>/, "") + t.slice(j); })],
  ["announce", "launch-offer approval wording returns on a card", "approval|request", (d) => edit(d, "pricing/index.html", (t) => t.replace("Free trial: 1 store", "Approved stores only"))],
  ["off", "a request button is shown in the header while self-service is on", "request", (d) => edit(d, "index.html", (t) => t.replace('<a href="https://www.copilt.org/my-account/"', '<a href="/request-access/" class="aicc-btn">Request Free Access</a><a href="https://www.copilt.org/my-account/"'))],
  ["open", "the Hero of an open build gets a request link back while self-service is on", "request-access|exactly its two actions", (d) => edit(d, "index.html", (t) => { const [a] = heroActions(t); const e = t.indexOf(">", a) + 1; return t.slice(0, e) + '<a class="aicc-btn aicc-btn--primary aicc-btn--lg" href="/request-access/">Request Free Access</a>' + t.slice(e); })],
];
if (Object.values(ssDirs).every(Boolean)) {
  for (const [cell, name, expect, mutate] of SS_MUTATIONS) {
    const copy = fs.mkdtempSync(path.join(path.dirname(ssDirs[cell]), "mut-ss-"));
    fs.rmSync(copy, { recursive: true });
    spawnSync("cp", ["-Rc", ssDirs[cell], copy]);
    try {
      mutate(copy);
      const r = runSs(cell, copy), out = r.stdout + r.stderr;
      check(r.status !== 0 && /FAIL (en|he|es|ru)|FAIL ss-/.test(out), `self-service (${cell}) mutation "${name}": the suite FAILS (exit ${r.status})`);
      check(new RegExp(expect, "i").test(out.split("\n").filter((l) => /FAIL/.test(l)).join("\n")), `self-service (${cell}) mutation "${name}": the failure names the broken guard (${expect})`);
    } finally { fs.rmSync(copy, { recursive: true, force: true }); }
  }
  const okSs = runSs("announce", ssDirs.announce);
  check(okSs.status === 0, "the untouched self-service exports pass the same suite (so the failures above are caused by the mutations)");
} else console.log("  note --ss-off, --ss-announce and --ss-open not all given: the self-service mutations were not run");
for (const [name, expect, mutate] of MUTATIONS) {
  const copy = fs.mkdtempSync(path.join(path.dirname(dirs.announce), "mut-"));
  fs.rmSync(copy, { recursive: true });
  spawnSync("cp", ["-Rc", dirs.announce, copy]);
  try {
    mutate(copy);
    const r = run(copy), out = r.stdout + r.stderr;
    check(r.status !== 0 && /FAIL (en|he|es|ru)/.test(out), `mutation "${name}": the suite FAILS (exit ${r.status})`);
    check(new RegExp(expect.replace(/\|/g, "|"), "i").test(out.split("\n").filter((l) => /FAIL/.test(l)).join("\n")), `mutation "${name}": the failure names the broken guard (${expect})`);
  } finally { fs.rmSync(copy, { recursive: true, force: true }); }
}
const base = run(dirs.announce);
check(base.status === 0, "the untouched export passes the same suite (so the failures above are caused by the mutations)");
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed ? 1 : 0);
