// npm run test:strike-gate (P40): the gated strikethrough price variant, end to end on REAL exports. Default OFF; a production release REFUSES an export that carries it unless the pricing-claims approval is attested.
//   node scripts/test-strike-gate.mjs --clean <export> [--clean <export> ...] --strike <export built with NEXT_PUBLIC_AICC_SELFSERVICE=on NEXT_PUBLIC_AICC_EARLY_ACCESS=announce NEXT_PUBLIC_AICC_EA_STRIKE=on>
// 1. OFF: no default export (self-service on or off, announce or open, any language) carries ANY strike marker (scripts/lib/strike-markup.mjs: the P36 card, the P40 card, <s> / <del>);
// 2. the strike export carries the P40 markers on Home and Pricing in four languages (`aicc-tier__price--strike`, `data-ss-price="strike"`, `<s class="aicc-tier__amount">`);
// 3. the release gate (scripts/ea-release-gate.mjs, run by infra/release/build-site-release.sh --target production) refuses the strike export without a valid AICC_EA_STRIKE_COUNSEL_APPROVED, refuses placeholders and answer words,
//    and accepts a real reference; it passes every default export;
// 4. `launch:check` raises the counsel blocker for the built export whatever the shell says; the public-truth gate reports `strike-price`; the full production builder refuses (nothing packed) and names the variable;
// 5. the kit stylesheet and the inline CSS that merely NAME the class are not a struck price.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/load.mjs";
import { STRIKE_PAGES, strikeMarkup } from "./lib/strike-markup.mjs";

const args = process.argv.slice(2);
const all = (n) => args.flatMap((a, i) => (a === `--${n}` && args[i + 1] ? [path.resolve(args[i + 1])] : []));
const CLEAN = all("clean"), STRIKE = all("strike")[0];
if (!CLEAN.length || !STRIKE) { console.error("usage: --clean <export> [--clean <export>] --strike <export>"); process.exit(2); }
let failed = 0, total = 0;
const check = (c, m) => { total++; if (!c) { failed++; console.error("  FAIL " + m); } else console.log("  ok   " + m); };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const htmlOf = (root) => walk(root).filter((f) => f.endsWith(".html") && !/\/_next\//.test(f));
const env = (extra = {}) => ({ PATH: process.env.PATH, HOME: process.env.HOME, AICC_CP_DIR: "none", ...extra });
const node = (script, a, e) => spawnSync(process.execPath, [path.join(ROOT, script), ...a], { encoding: "utf8", env: env(e), cwd: ROOT, maxBuffer: 1 << 26 });

console.log("== 1. OFF: no default export carries a strike marker");
for (const root of CLEAN) {
  const hits = htmlOf(root).map((f) => [path.relative(root, f), strikeMarkup(fs.readFileSync(f, "utf8"))]).filter(([, m]) => m.length);
  check(hits.length === 0, `${path.basename(root)}: none of ${htmlOf(root).length} HTML files carries a strike marker${hits.length ? " -> " + hits[0][0] + ": " + hits[0][1].join(", ") : ""}`);
  const css = walk(root).filter((f) => /\.css$/.test(f)).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  check(/aicc-tier__price--strike/.test(css) && htmlOf(root).every((f) => !/class="[^"]*aicc-tier__price--strike/.test(fs.readFileSync(f, "utf8"))), `${path.basename(root)}: the kit stylesheet names the strike class (it is a stylesheet rule) and no element uses it`);
}

console.log("== 2. the strike export carries the P40 markers (Home and Pricing, four languages)");
for (const rel of STRIKE_PAGES) {
  const h = fs.readFileSync(path.join(STRIKE, rel), "utf8");
  const found = strikeMarkup(h);
  const per = [(h.match(/class="aicc-tier__price aicc-tier__price--strike"/g) || []).length, (h.match(/data-ss-price="strike"/g) || []).length, (h.match(/<s class="aicc-tier__amount">/g) || []).length];
  check(found.length >= 3 && per.every((n) => n === 3), `${rel}: markers found (${found.length} kinds), 3 struck cards [${per}]`);
}

console.log("== 3. the release gate refuses the strike export and accepts a real reference");
{
  const gate = (root, ref) => node("scripts/ea-release-gate.mjs", ["--tree", root], ref === undefined ? {} : { AICC_EA_STRIKE_COUNSEL_APPROVED: ref });
  const r0 = gate(STRIKE);
  check(r0.status === 1 && /struck through/.test(r0.stderr) && /AICC_EA_STRIKE_COUNSEL_APPROVED/.test(r0.stderr), "the strike export WITHOUT an approval is refused (exit 1) and the variable is named");
  for (const bad of ["yes", "approved-1", "TODO", "true-2026", "ok-1", "x-1", "/etc/hosts", "package.json", " "]) check(gate(STRIKE, bad).status === 1, `a placeholder / answer word / out-of-evidence file (${JSON.stringify(bad)}) is not an approval`);
  check(gate(STRIKE, "counsel-2026-11-30").status === 0, "a real counsel reference lets the strike export through (recorded, not verified)");
  for (const root of CLEAN) check(gate(root).status === 0, `${path.basename(root)}: a default export passes the gate without any approval`);
}

console.log("== 4. launch:check, the public-truth gate and the production builder");
{
  const lc = (root, extra = {}) => node("scripts/launch-check.mjs", [], { NEXT_PUBLIC_AICC_SELFSERVICE: "on", NEXT_PUBLIC_AICC_EARLY_ACCESS: "announce", AICC_OUT_DIR: root, ...extra });
  const a = lc(STRIKE), out = a.stdout + a.stderr;
  check(/NEXT_PUBLIC_AICC_EA_STRIKE=on shows the plan price struck through/.test(out) && /found in the built export/.test(out), "launch:check on the strike export reports the counsel blocker although the shell's switch is unset (it reads the built export)");
  check(!/shows the plan price struck through/.test(lc(CLEAN[0]).stdout + lc(CLEAN[0]).stderr), "launch:check on a default export raises no strike blocker");
  check(!/shows the plan price struck through/.test(lc(STRIKE, { AICC_EA_STRIKE_COUNSEL_APPROVED: "counsel-2026-11-30" }).stdout), "launch:check with a real reference clears the strike blocker");
  const pt = node("scripts/public-truth-gate.mjs", ["--out", STRIKE]), ptOk = node("scripts/public-truth-gate.mjs", ["--out", STRIKE], { AICC_EA_STRIKE_COUNSEL_APPROVED: "counsel-2026-11-30" });
  check(pt.status === 1 && /strike-price|struck-through/.test(pt.stdout + pt.stderr) && ptOk.status === 0, "the public-truth gate reports the struck price on the strike export (exit 1) and passes it only with the attested approval (exit 0)");
  for (const root of CLEAN) check(node("scripts/public-truth-gate.mjs", ["--out", root]).status === 0, `${path.basename(root)}: the public-truth gate passes a default export`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p40-strike-rel-"));
  try {
    const rel = (root, extra = {}) => spawnSync("bash", [path.join(ROOT, "infra/release/build-site-release.sh"), "--target", "production", "--export-dir", root, "--out-dir", path.join(tmp, path.basename(root) + JSON.stringify(extra).length), "--public-truth"], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, AICC_EA_RELEASE_APPROVED: "owner-approved", ...extra }, cwd: ROOT, maxBuffer: 1 << 26 });
    const r = rel(STRIKE), ro = r.stdout + r.stderr;
    check(r.status !== 0 && /EA RELEASE GATE/.test(ro) && /AICC_EA_STRIKE_COUNSEL_APPROVED/.test(ro) && !/site-[0-9TZ-]+[0-9a-f]*\.tar\.gz/.test(r.stdout), "the production release builder REFUSES the strike export (nothing packed) and names AICC_EA_STRIKE_COUNSEL_APPROVED");
    const ok = rel(CLEAN[0]);
    check(ok.status === 0 && /tarball/.test(ok.stdout), `the same builder packs the default export ${path.basename(CLEAN[0])} (exit ${ok.status})`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

console.log("== 5. a stylesheet that only names the class is not a struck price");
{
  const css = "<style>.aicc-tier__price--strike .aicc-tier__amount{text-decoration:line-through}</style>";
  check(strikeMarkup(`<html><head>${css}</head><body><p class="aicc-tier__price">x</p></body></html>`).length === 0, "an inline stylesheet naming aicc-tier__price--strike raises nothing");
  check(strikeMarkup('<p class="aicc-tier__price aicc-tier__price--strike">x</p>').length === 1 && strikeMarkup('<s class="aicc-tier__amount">$99</s>').length >= 1 && strikeMarkup("<del>$99</del>").length === 1 && strikeMarkup("<span>$99</span><svg></svg><section></section><strong>x</strong>").length === 0, "the detector sees each marker and none of the look-alike elements (svg, section, strong, span)");
}

console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:strike-gate (${failed})`); process.exit(1); }
console.log("PASS test:strike-gate");
