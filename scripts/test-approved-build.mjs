// npm run test:approved: builds the site the way production will be built (every owner value supplied, legal review approved,
// domain-root base path) and asserts that NOTHING pending or drafted is published and that FAQPage JSON-LD then has every active answer.
// It builds into a THROWAWAY directory (.approved-build/, via AICC_DIST_DIR) with fake company values ("Example Ltd", "support@example.test") and deletes it at the end:
// the default out/ is never touched, so it can never hold the fake values or have its draft notices removed. (Earlier versions overwrote out/ and said "rebuild normally
// afterwards"; rsyncing that out/ would have published invented company facts. `npm run launch:check` now also fails if out/ contains the sentinels.)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/load.mjs";

const DIST = ".approved-build";
const OUT = path.join(ROOT, DIST);
const snapshot = ["next-env.d.ts", "tsconfig.json"].map((f) => [f, fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f)) : null]);
function cleanup() {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const [f, buf] of snapshot) if (buf !== null && !fs.readFileSync(path.join(ROOT, f)).equals(buf)) fs.writeFileSync(path.join(ROOT, f), buf); // Next may rewrite these for a custom distDir
}
process.on("exit", cleanup);
fs.rmSync(OUT, { recursive: true, force: true });
const env = {
  ...process.env,
  AICC_DIST_DIR: DIST,
  AICC_OUT_DIR: DIST,
  AICC_BASE_PATH: "",
  AICC_PRODUCTION: "1",
  NEXT_PUBLIC_LEGAL_REVIEW_APPROVED: "true",
  NEXT_PUBLIC_AICC_LEGAL_NAME: "Example Ltd",
  NEXT_PUBLIC_AICC_ADDRESS: "1 Example Street, Example City",
  NEXT_PUBLIC_AICC_SUPPORT_EMAIL: "support@example.test",
  NEXT_PUBLIC_AICC_GOVERNING_LAW: "Example law",
  NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR: "Example Pay",
  NEXT_PUBLIC_AICC_HOSTING_REGION: "Example region",
  NEXT_PUBLIC_DEMO_VIDEO_SRC: "/demo/aicc-demo.mp4",
  NEXT_PUBLIC_DEMO_VIDEO_POSTER: "/demo/aicc-demo-poster.jpg",
  NEXT_PUBLIC_DEMO_VIDEO_CAPTIONS: "/demo/aicc-demo.vtt",
};
const b = spawnSync("npm", ["run", "-s", "build"], { cwd: ROOT, env, encoding: "utf8" });
if (b.status !== 0) { console.error("build failed\n" + b.stdout + b.stderr); process.exit(1); }
const l = spawnSync("node", ["scripts/launch-check.mjs", "--strict"], { cwd: ROOT, env, encoding: "utf8" });
process.stdout.write(l.stdout);
const errors = [];
// Everything an owner can supply must clear launch:check --strict. Allowed to remain, by name: (1) there is no plugin distribution path yet (no /get-started/ or
// download route): a business fact, gone when the route is built; (2) the sentinel gates themselves, which MUST fire on this build because it carries the fake values
// ("Example Ltd", "support@example.test"): that is the positive control proving a fake-value out/ can never pass launch:check unnoticed. (3) the real-gateway allowlist (scripts/lib/payment-gate.mjs) is EMPTY by owner decision, so the fake processor "Example Pay" is rejected too.
const blockers = l.stdout.split("\n").filter((x) => x.startsWith("  - "));
const ALLOWED = [/plugin distribution path not available/, /not a real address/, /test sentinel value/, /not on the real-gateway allowlist/];
const unexpected = blockers.filter((x) => !ALLOWED.some((re) => re.test(x)));
if (unexpected.length) errors.push("launch:check --strict failed on the approved build: " + unexpected.join(" | "));
for (const re of ALLOWED) if (!blockers.some((x) => re.test(x))) errors.push(`expected launch:check blocker ${re} did not fire on the approved build`);
let pending = 0, drafts = 0, faq = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["_next", "brand-kit", "og", "fonts"].includes(e.name)) walk(p); } else if (e.name.endsWith(".html")) { const h = fs.readFileSync(p, "utf8"); pending += (h.match(/data-pending="true"/g) || []).length; drafts += (h.match(/data-legal-draft="true"/g) || []).length; if (p.endsWith("/questions/index.html") && p.split("/").length === path.join(OUT, "questions", "index.html").split("/").length) { const m = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((x) => JSON.parse(x[1])).find((x) => x["@type"] === "FAQPage"); faq = m ? m.mainEntity : []; } } } };
walk(OUT);
if (pending) errors.push(`${pending} pending lines in the approved build`);
if (drafts) errors.push(`${drafts} draft notices in the approved build`);
const ACTIVE = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "brand/content/faq.en.json"), "utf8")).items).length;
if (faq.length !== ACTIVE) errors.push(`FAQPage JSON-LD has ${faq.length} answers, expected all ${ACTIVE} active questions once approved`);
// Approving the ENGLISH legal text must not remove the machine-translation disclosure from the he / es / ru legal pages (they are machine drafts; only a native-speaking legal
// reviewer plus NEXT_PUBLIC_LEGAL_TRANSLATIONS_REVIEWED=true may). English legal pages never carry it. (Added by the legal / marketing-truth pass: it used to vanish with the draft notice.)
for (const r of ["privacy", "terms", "refund-policy", "data-and-trust", "accessibility"]) {
  for (const loc of ["he", "es", "ru"]) if (!fs.readFileSync(path.join(OUT, loc, r, "index.html"), "utf8").includes('data-translation-draft="true"')) errors.push(`${loc}/${r}: the machine-translation disclosure is missing on an approved build (English approval must not remove it)`);
  if (fs.readFileSync(path.join(OUT, r, "index.html"), "utf8").includes('data-translation-draft="true"')) errors.push(`${r}: the English page carries the machine-translation disclosure`);
}
if (!/legal pages ship with the machine-translation disclosure/.test(l.stdout)) errors.push("launch:check did not report that the translations ship with the machine-translation disclosure");
// Every owner value is supplied on this build: the Data and trust page must stop saying that those details "will be published before launch".
for (const loc of ["", "he/", "es/", "ru/"]) if (fs.readFileSync(path.join(OUT, loc, "data-and-trust/index.html"), "utf8").includes('id="dataTrust-pending"')) errors.push(`${loc || "en/"}data-and-trust: still carries the "What we haven't finalized" section although every owner value is supplied`);
const priv = fs.readFileSync(path.join(OUT, "privacy/index.html"), "utf8");
if (!priv.includes("support@example.test")) errors.push("support email value not rendered");
const home = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
for (const a of ['data-demo-video="/demo/aicc-demo.mp4"', 'data-demo-poster="/demo/aicc-demo-poster.jpg"', 'data-demo-captions="/demo/aicc-demo.vtt"', 'data-demo-captions-lang="en"'])
  if (!home.includes(a)) errors.push(`Watch demo trigger lacks ${a} (video support enabled by env)`);
if (home.includes('data-demo-video=""')) errors.push("Watch demo trigger still has an empty video with the env set");
console.log(`approved build (throwaway ${DIST}/, removed afterwards; out/ untouched): ${pending} pending lines, ${drafts} draft notices, FAQPage answers ${faq.length}`);
if (errors.length) { console.error("FAIL\n  " + errors.join("\n  ")); process.exit(1); }
console.log("PASS: with every value supplied and legal review approved, nothing pending or drafted is published.");
