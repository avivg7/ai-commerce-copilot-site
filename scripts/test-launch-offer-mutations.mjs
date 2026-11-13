// npm run test:launch-offer-mutations: proves the P36 regression guards of test-launch-offer.mjs FAIL on the regressions the owner named. Each mutation breaks a COPY of the ANNOUNCE export in one way
// and the suite must then exit non-zero with the expected failure text; the untouched export must pass.
//   node scripts/test-launch-offer-mutations.mjs --off <dir> --announce <dir> --open <dir> --verify <dir>
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? path.resolve(args[i + 1]) : undefined; };
const dirs = { off: arg("off"), announce: arg("announce"), open: arg("open"), verify: arg("verify") };
if (!dirs.off || !dirs.announce || !dirs.open || !dirs.verify) { console.error("usage: --off <dir> --announce <dir> --open <dir> --verify <dir>"); process.exit(2); }
let total = 0, failed = 0;
const check = (c, m) => { total++; if (!c) { failed++; console.error("  FAIL " + m); } else console.log("  ok   " + m); };
const run = (announce) => spawnSync("node", ["scripts/test-launch-offer.mjs", "--off", dirs.off, "--announce", announce, "--open", dirs.open, "--verify", dirs.verify], { encoding: "utf8", env: { ...process.env, AICC_CP_DIR: "none" }, maxBuffer: 1 << 28 });
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
