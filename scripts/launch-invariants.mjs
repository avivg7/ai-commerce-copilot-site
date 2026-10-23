// npm run test:launch-invariants -- [--cp-theme <dir>] [--site-url http://127.0.0.1:3011] [--cp-url http://127.0.0.1:NNNN]
//
// The MERGE-ORDER check: run it AFTER every launch-branch merge and sync, on the FINAL integrated heads (the shopper demo was once reported as intact after a merge, then judged on a stale
// surface). It compares the integrated tree to the OWNER-APPROVED shopper-demo invariants:
//   1. the approved commit (972202e) is an ancestor of HEAD (Git checkouts only; skipped with a NOTE in an exported tree);
//   2. the approved demo files and the approved English demo copy still hash to docs/approved-shopper-demo.json (a legitimate change = an owner-review action: --update-pins);
//   3. the standalone "Surfaces" proof section does not exist (component, import, built page);
//   4. with --cp-theme: the theme carries the kit byte-for-byte (sync --verify --strict) and no NEW kit/theme class collision exists;
//   5. with --site-url / --cp-url: the LIVE rendering passes scripts/shopper-demo-guard.mjs (semantic + layout + approved snapshots) on each surface.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { ROOT, loadDictionaries } from "./lib/load.mjs";

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const APPROVED = "972202e";
const PINS = path.join(ROOT, "docs", "approved-shopper-demo.json");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const FILES = ["brand/js/fbt-demo.js", "brand/js/product-art.js"];

const dicts = await loadDictionaries();
const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);
const current = { files: Object.fromEntries(FILES.map((f) => [f, sha(fs.readFileSync(path.join(ROOT, f)))])), demoDictionaryEn: sha(JSON.stringify(stable(dicts.en.demo))) };

if (argv.includes("--update-pins")) {
  if (process.env.AICC_APPROVE_SHOPPER_DEMO !== "owner-reviewed") { console.error("Refusing to rewrite the approved-shopper-demo pins: an OWNER-REVIEW action. Re-run with AICC_APPROVE_SHOPPER_DEMO=owner-reviewed once the owner has approved the change."); process.exit(2); }
  fs.writeFileSync(PINS, JSON.stringify({ _comment: "Pins of the OWNER-APPROVED shopper demo (approved commit " + APPROVED + "). Changing a pinned file or the English demo copy requires the owner's review: scripts/launch-invariants.mjs --update-pins with AICC_APPROVE_SHOPPER_DEMO=owner-reviewed (and the approved snapshots: scripts/shopper-demo-guard.mjs --update-baseline).", approvedCommit: APPROVED, ...current }, null, 2) + "\n");
  console.log("pins rewritten: " + path.relative(ROOT, PINS));
  process.exit(0);
}

let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { if (ok) { passed++; console.log("ok      " + name); } else { failed++; console.log("FAIL    " + name + (detail ? "  -> " + String(detail).slice(0, 500) : "")); } };

// 1. ancestry
if (fs.existsSync(path.join(ROOT, ".git"))) {
  const r = spawnSync("git", ["merge-base", "--is-ancestor", APPROVED, "HEAD"], { cwd: ROOT, encoding: "utf8" });
  check(`the approved shopper-demo commit ${APPROVED} is an ancestor of HEAD`, r.status === 0, r.stderr || `exit ${r.status}`);
} else console.log(`NOTE    no .git here (exported tree): ancestry of ${APPROVED} not checked`);

// 2. pins
const pins = fs.existsSync(PINS) ? JSON.parse(fs.readFileSync(PINS, "utf8")) : null;
check("docs/approved-shopper-demo.json exists", !!pins);
if (pins) {
  for (const f of FILES) check(`approved file unchanged: ${f}`, pins.files?.[f] === current.files[f], `pinned ${String(pins.files?.[f]).slice(0, 12)} now ${current.files[f].slice(0, 12)} (a deliberate change is an owner-review action: --update-pins)`);
  check("approved English demo copy (dictionary `demo`) unchanged", pins.demoDictionaryEn === current.demoDictionaryEn, "the demo copy changed since the owner approved it");
}
const dictKeys = (l) => Object.keys(dicts[l].demo).length;
check("the demo dictionary is complete in all four locales (he/es/ru are not partial fallbacks)", ["he", "es", "ru"].every((l) => dictKeys(l) === dictKeys("en")), ["he", "es", "ru"].map((l) => `${l}:${dictKeys(l)}`).join(" ") + ` en:${dictKeys("en")}`);

// 3. no standalone Surfaces section
check("src/components/home/Surfaces.tsx does not exist", !fs.existsSync(path.join(ROOT, "src", "components", "home", "Surfaces.tsx")));
const home = fs.readFileSync(path.join(ROOT, "src", "components", "pages", "HomePage.tsx"), "utf8");
check("HomePage does not import or render Surfaces", !/\bSurfaces\b/.test(home));
const built = path.join(ROOT, "out", "index.html");
if (fs.existsSync(built)) { const h = fs.readFileSync(built, "utf8"); check("the built home page has no #surfaces section", !/id="surfaces"/.test(h) && !/aicc-surfaces/.test(h)); } else console.log("NOTE    no out/ build: built-page check skipped (run the build first)");

// 4. Control Plane theme
const theme = arg("cp-theme");
if (theme) {
  const v = spawnSync(process.execPath, [path.join(ROOT, "scripts", "sync-brand-kit.mjs"), "--verify", theme, "--strict"], { encoding: "utf8" });
  check("the Control Plane theme carries the Site brand kit byte-for-byte (sync --verify --strict)", v.status === 0, (v.stdout + v.stderr).trim());
  const c = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-brand-collisions.mjs"), "--theme", theme], { encoding: "utf8" });
  check("no NEW kit/theme CSS class collision (the Control Plane styles `.aicc-store` too)", c.status === 0, (c.stdout + c.stderr).trim());
}

// 5. live rendering on each surface
for (const [surface, flag] of [["site", "site-url"], ["cp", "cp-url"]]) {
  const url = arg(flag);
  if (!url) continue;
  const g = spawnSync(process.execPath, [path.join(ROOT, "scripts", "shopper-demo-guard.mjs"), "--url", url, "--surface", surface], { encoding: "utf8" });
  check(`live ${surface} surface (${url}) passes the shopper-demo guard (semantic + layout + approved snapshots)`, g.status === 0, (g.stdout + g.stderr).split("\n").filter((l) => /FAIL|failed|Refus/.test(l)).slice(0, 6).join(" || "));
}
console.log(`\nlaunch-invariants: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
