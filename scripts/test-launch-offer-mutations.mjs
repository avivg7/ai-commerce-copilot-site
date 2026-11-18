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
const ssDirs = { off: arg("ss-off"), announce: arg("ss-announce"), open: arg("ss-open") }, ssLink = arg("ss-link");
if (!dirs.off || !dirs.announce || !dirs.open || !dirs.verify) { console.error("usage: --off <dir> --announce <dir> --open <dir> --verify <dir>"); process.exit(2); }
let total = 0, failed = 0;
const check = (c, m) => { total++; if (!c) { failed++; console.error("  FAIL " + m); } else console.log("  ok   " + m); };
const run = (announce) => spawnSync("node", ["scripts/test-launch-offer.mjs", "--off", dirs.off, "--announce", announce, "--open", dirs.open, "--verify", dirs.verify], { encoding: "utf8", env: { ...process.env, AICC_CP_DIR: "none" }, maxBuffer: 1 << 28 });
const runSs = (cell, copy) => spawnSync("node", ["scripts/test-launch-offer.mjs", "--off", dirs.off, "--announce", dirs.announce, "--open", dirs.open, "--verify", dirs.verify, ...Object.entries({ ...ssDirs, ...(ssLink && cell !== "link" ? { link: ssLink } : {}), [cell]: copy }).flatMap(([k, v]) => (v ? [`--ss-${k}`, v] : []))], { encoding: "utf8", env: { ...process.env, AICC_CP_DIR: "none" }, maxBuffer: 1 << 28 });
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
// ----- P37/P39/P40 self-service mutations: [cell, name, expected failure text, mutate]. Cells: off / announce / open = the default (coming_soon) builds; link = the build made with NEXT_PUBLIC_AICC_SS_INITIAL=link.
// P40: the markup is the kit's premium section (docs/design/p40-pricing.md); every P39 mutation was mapped to its P40 element, and new ones prove the new rules (dates once per page, no per-card demo, no struck price,
// the featured card, the capacity glyphs, one launch panel, the badge). Each must make the suite FAIL with the named guard.
const STATUS_P = /<p class="aicc-pstatus" role="status" data-ss-state="static">[\s\S]*?<\/p>/;
const asLink = (plan, label = "Get started free") => `<a class="aicc-btn aicc-btn--lg aicc-btn--block aicc-btn--outline" data-ss-state="static" href="https://www.copilt.org/start/?plan=${plan}"><span>${label}</span></a>`;
const firstCard = (t, f) => { const i = t.indexOf('<article class="aicc-tier'); const j = t.indexOf("</article>", i); return t.slice(0, i) + f(t.slice(i, j)) + t.slice(j); };
const SS_MUTATIONS = [
  ["announce", "the Hero loses Try Live Demo (self-service on)", "Hero keeps|primary link to #demo|exactly its two actions", (d) => edit(d, "index.html", (t) => { const [a, b] = heroActions(t); return t.slice(0, a) + t.slice(a, b).replace(/<a\b[^>]*href="#demo"[\s\S]*?<\/a>/, "") + t.slice(b); })],
  ["announce", "a real /start/ sign-up link is put back on a card while sign-up is off", "NO link and NO button|status region", (d) => edit(d, "pricing/index.html", (t) => t.replace(STATUS_P, asLink("solo")))],
  ["announce", "a plan card control is changed to the Live Demo", "NO link and NO button|NO per-card|status region", (d) => edit(d, "pricing/index.html", (t) => t.replace(STATUS_P, '<a class="aicc-btn aicc-btn--outline aicc-btn--lg aicc-btn--block" href="/#demo">Get started free</a>'))],
  ["announce", "a plan card control leads to /request-access/ while self-service is on", "request-access|NO link and NO button", (d) => edit(d, "pricing/index.html", (t) => t.replace(STATUS_P, asLink("studio").replace("https://www.copilt.org/start/?plan=studio", "/request-access/?plan=studio")))],
  ["announce", "the status region turns into an inert button-looking element", "status region|inert", (d) => edit(d, "pricing/index.html", (t) => t.replace('<p class="aicc-pstatus"', '<p class="aicc-btn aicc-btn--lg aicc-pstatus"'))],
  ["announce", "the status region invites an action it cannot offer (\"Get started free\" as plain status text)", "status region", (d) => edit(d, "index.html", (t) => t.replace(/(<span class="aicc-pstatus__label">)Free trial opens soon/, "$1Get started free"))],
  ["announce", "the status region loses its explanation line", "status region", (d) => edit(d, "pricing/index.html", (t) => t.replace(/<span class="aicc-pstatus__note">[\s\S]*?<\/span>/, ""))],
  ["announce", "the launch panel loses the registration step", "timeline has two ordered steps", (d) => edit(d, "pricing/index.html", (t) => t.replace(/<li class="aicc-timeline__step" data-ss-date="registration">[\s\S]*?<\/li>/, ""))],
  ["announce", "the launch panel loses the trial-end step", "timeline has two ordered steps", (d) => edit(d, "pricing/index.html", (t) => t.replace(/<li class="aicc-timeline__step" data-ss-date="end">[\s\S]*?<\/li>/, ""))],
  ["announce", "the registration line states the wrong instant (22:00 UTC on Dec 24)", "timeline has two ordered steps|clock", (d) => edit(d, "pricing/index.html", (t) => t.replace(/Dec 24, 2026 at.00:00 UTC/, "Dec 24, 2026 at 22:00 UTC"))],
  ["announce", "a date comes back into a card (dates are said once per page)", "no date, no clock", (d) => edit(d, "pricing/index.html", (t) => firstCard(t, (a) => a.replace('<p class="aicc-tier__incl">', '<p class="aicc-tier__trial">Registration closes Dec 24, 2026 at 00:00 UTC</p><p class="aicc-tier__incl">')))],
  ["announce", "a trial condition comes back into a card (the three facts live in the panel)", "no date, no clock|trial conditions", (d) => edit(d, "pricing/index.html", (t) => firstCard(t, (a) => a.replace('<p class="aicc-tier__incl">', '<p class="aicc-tier__trial">No payment method is required, so nothing is charged.</p><p class="aicc-tier__incl">')))],
  ["announce", "the closing band repeats the dates", "carries NO date", (d) => edit(d, "pricing/index.html", (t) => t.replace('<p class="aicc-pband__lead">', '<p class="aicc-pband__lead">Registration closes Dec 24, 2026 at 00:00 UTC. '))],
  ["announce", "the plan finder result repeats a date", "exactly ONCE", (d) => edit(d, "pricing/index.html", (t) => t.replace('<p class="aicc-launch__foot">', '<p class="aicc-launch__foot">Dec 24, 2026 at 00:00 UTC. '))],
  ["announce", "a per-card Try Live Demo link comes back", "NO per-card", (d) => edit(d, "pricing/index.html", (t) => firstCard(t, (a) => a.replace('<p class="aicc-tier__incl">', '<p data-ss-demo><a class="aicc-link" href="/#demo">Try Live Demo</a></p><p class="aicc-tier__incl">')))],
  ["announce", "\"No automatic conversion to a paid plan\" disappears from the panel", "three facts", (d) => edit(d, "pricing/index.html", (t) => t.replace(/<li class="aicc-launch__fact">(?:(?!<li class="aicc-launch__fact">)[\s\S])*?No automatic conversion to a paid plan[\s\S]*?<\/li>/, ""))],
  ["announce", "the trial line disappears from a card", "with the trial line", (d) => edit(d, "pricing/index.html", (t) => t.replace(/(<span class="aicc-tier__trial">(?:<span class="aicc-cap[\s\S]*?<\/span><\/span>))Launch trial: 1.store/, "$1"))],
  ["announce", "a card claims more than 10 stores", "paid capacity|store counts", (d) => edit(d, "pricing/index.html", (t) => t.replace("Paid plan: up to 10 stores", "Paid plan: up to 25 stores"))],
  ["announce", "a card's capacity glyphs show the wrong plan (Solo fills three slots)", "glyph slots", (d) => edit(d, "pricing/index.html", (t) => firstCard(t, (a) => a.replace(/(<span class="aicc-cap__slot"><\/span>)(<span class="aicc-cap__slot"><\/span>)/, '<span class="aicc-cap__slot aicc-cap__slot--on"></span><span class="aicc-cap__slot aicc-cap__slot--on"></span>')))],
  ["announce", "the regular price is struck through (the gated variant leaks into the default build)", "not struck through", (d) => edit(d, "pricing/index.html", (t) => t.replace(/<bdi class="aicc-tier__amount">\$99<\/bdi>/, '<s class="aicc-tier__amount"><bdi>$99</bdi></s>'))],
  ["announce", "the featured card loses its featured class (Studio is no longer Recommended)", "featured|ordinary card", (d) => edit(d, "pricing/index.html", (t) => t.replace('<article class="aicc-tier aicc-tier--featured"', '<article class="aicc-tier"'))],
  ["announce", "the badge becomes a popularity claim", "the badge is", (d) => edit(d, "pricing/index.html", (t) => t.replace('<p class="aicc-tier__badge">Recommended</p>', '<p class="aicc-tier__badge">Most popular</p>'))],
  ["announce", "a second #free-trial anchor appears on the page", "exactly ONE launch panel", (d) => edit(d, "index.html", (t) => t.replace('<h2 class="aicc-pricing__title"', '<span id="free-trial"></span><h2 class="aicc-pricing__title"'))],
  ["announce", "a plan card says Regular price (the plain label loses \"Planned\")", "Planned regular price", (d) => edit(d, "pricing/index.html", (t) => t.replace("Planned regular price", "Regular price"))],
  ["announce", "the header Get started points at /start/ while sign-up is off", "header", (d) => edit(d, "index.html", (t) => t.replace(/(<header[\s\S]*?<a href=")https:\/\/www\.copilt\.org\/my-account\/("[^>]*data-ss-getstarted)/, "$1https://www.copilt.org/start/$2"))],
  ["announce", "the Product Get started points at /start/ while sign-up is off", "Product \"Get started\"", (d) => edit(d, "product/index.html", (t) => { const i = t.indexOf('class="aicc-hero-actions'); return t.slice(0, i) + t.slice(i).replace("https://www.copilt.org/my-account/", "https://www.copilt.org/start/") ; })],
  ["announce", "a closing band shows a sign-up link while sign-up is off", "closing band", (d) => edit(d, "pricing/index.html", (t) => { const i = t.indexOf('aria-labelledby="pricing-final"'); const j = t.indexOf("</section>", i); return t.slice(0, i) + t.slice(i, j).replace(STATUS_P, asLink("solo").replace("?plan=solo", "")) + t.slice(j); })],
  ["announce", "a closing band loses its lead sentence", "closing band", (d) => edit(d, "pricing/index.html", (t) => { const i = t.indexOf('aria-labelledby="pricing-final"'); const j = t.indexOf("</section>", i); return t.slice(0, i) + t.slice(i, j).replace(/<p class="aicc-pband__lead">[\s\S]*?<\/p>/, "") + t.slice(j); })],
  ["announce", "the Product closing band is no longer hidden after the trial end (loses data-ea-live)", "live block|data-ea-live", (d) => edit(d, "product/index.html", (t) => t.replace(/(<div class="aicc-pband" data-aicc-ss="band" data-ss-band="true") data-ea-live=""/, "$1"))],
  ["announce", "the Product Get started is no longer hidden after the trial end", "Get started. is live-only|live-only", (d) => edit(d, "product/index.html", (t) => t.replace('<span style="display:contents" data-ea-live=""><a href', '<span style="display:contents"><a href'))],
  ["announce", "the Product closing band loses the support contact line", "support@copilt.org|contact line", (d) => edit(d, "product/index.html", (t) => { const i = t.indexOf('aria-labelledby="safety-cta"'); const j = t.indexOf("</section>", i); return t.slice(0, i) + t.slice(i, j).replace(/<p class="aicc-small aicc-soon-contact--inverse"[\s\S]*?<\/p>/, "") + t.slice(j); })],
  ["announce", "launch-offer approval wording returns in the panel", "approval|request|three facts", (d) => edit(d, "pricing/index.html", (t) => t.replace("No payment method is required, so nothing is charged.", "Approved stores only"))],
  ["announce", "the retired P39 card markup returns (a P39 checks list in a card)", "retired P39 card markup", (d) => edit(d, "pricing/index.html", (t) => firstCard(t, (a) => a.replace('<p class="aicc-tier__incl">', '<ul class="aicc-plan__checks"><li>x</li></ul><p class="aicc-tier__incl">')))],
  ["off", "a request button is shown in the header while self-service is on", "request", (d) => edit(d, "index.html", (t) => t.replace('<a href="https://www.copilt.org/my-account/"', '<a href="/request-access/" class="aicc-btn">Request Free Access</a><a href="https://www.copilt.org/my-account/"'))],
  ["open", "the Hero of an open build gets a request link back while self-service is on", "request-access|exactly its two actions", (d) => edit(d, "index.html", (t) => { const [a] = heroActions(t); const e = t.indexOf(">", a) + 1; return t.slice(0, e) + '<a class="aicc-btn aicc-btn--primary aicc-btn--lg" href="/request-access/">Request Free Access</a>' + t.slice(e); })],
  ["off", "the status region disappears from a card of a self-service-only build", "status region|NO link", (d) => edit(d, "index.html", (t) => t.replace(STATUS_P, ""))],
  ["link", "(link build) a card sign-up link is changed to #demo", "ONE control|NO per-card", (d) => edit(d, "pricing/index.html", (t) => t.replace("https://www.copilt.org/start/?plan=solo", "/#demo"))],
  ["link", "(link build) the plan query of a card link is wrong (studio card asks for solo)", "ONE control", (d) => edit(d, "index.html", (t) => t.replace("start/?plan=studio", "start/?plan=solo"))],
  ["link", "(link build) a card link leads to a Control Plane path outside the allow-list", "resolves|ONE control", (d) => edit(d, "pricing/index.html", (t) => t.replace("https://www.copilt.org/start/?plan=agency", "https://www.copilt.org/signup/"))],
  ["link", "(link build) the studio link becomes an outline link (Studio is the primary control)", "ONE control", (d) => edit(d, "pricing/index.html", (t) => t.replace(/aicc-btn--block aicc-btn--primary" data-ss-state="static" href="https:\/\/www\.copilt\.org\/start\/\?plan=studio/, 'aicc-btn--block aicc-btn--outline" data-ss-state="static" href="https://www.copilt.org/start/?plan=studio'))],
  ["link", "(link build) the header Get started goes back to the account page", "header", (d) => edit(d, "index.html", (t) => t.replace(/(<header[\s\S]*?<a href=")https:\/\/www\.copilt\.org\/start\/("[^>]*data-ss-getstarted)/, "$1https://www.copilt.org/my-account/$2"))],
];
const DRY = args.includes("--dry"); // only APPLY every mutation to a copy (a mutation that does not change its file is a broken test); no suite run
const ssAll = () => Object.values(ssDirs).every(Boolean);
if (ssAll()) {
  for (const [cell, name, expect, mutate] of SS_MUTATIONS) {
    if (cell === "link" && !ssLink) continue;
    const dirOf = cell === "link" ? ssLink : ssDirs[cell];
    const copy = fs.mkdtempSync(path.join(path.dirname(dirOf), "mut-ss-"));
    fs.rmSync(copy, { recursive: true });
    spawnSync("cp", ["-Rc", dirOf, copy]);
    try {
      mutate(copy);
      if (DRY) { check(true, `(dry) self-service (${cell}) mutation "${name}" applies`); continue; }
      const r = cell === "link" ? runSs("link", copy) : runSs(cell, copy), out = r.stdout + r.stderr;
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
