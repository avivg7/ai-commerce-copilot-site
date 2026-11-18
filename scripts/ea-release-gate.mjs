// P35: the RELEASE gate for the two presentation extras that need an attestation. Called by infra/release/build-site-release.sh (production target) on the packaged tree.
//   node scripts/ea-release-gate.mjs --tree <export dir>
// Refuses (exit 1) a tree whose markup carries
//   * the struck-through regular price (`class="... aicc-plan__regular--strike ..."`, the P40 card `aicc-tier__price--strike` / `data-ss-price="strike"` / `<s class="aicc-tier__amount">`, or any <s>/<del> in Home/Pricing, four languages) unless AICC_EA_STRIKE_COUNSEL_APPROVED is a valid attestation, or
//   * the "Limited availability" chip (`data-ea-limited` on the Home page) unless AICC_EA_LIMITED_ATTESTED is a valid attestation.
// "Valid" is exactly what `launch:check` accepts (scripts/lib/ea-attest.mjs: an evidence-folder regular file, or a reference token; placeholders and answer words refused). The gate reads the BUILT
// markup, not the shell's NEXT_PUBLIC_ switches, so it cannot be bypassed by building with one environment and packaging with another. An ordinary (OFF) tree carries neither marker: exit 0, no output.
import fs from "node:fs";
import path from "node:path";
import { loadTs } from "./lib/load.mjs";
import { makeAttested } from "./lib/ea-attest.mjs";
import { STRIKE_PAGES, strikeMarkup, strikeCardProblems } from "./lib/strike-markup.mjs";
import { loadDictionaries } from "./lib/load.mjs";

const i = process.argv.indexOf("--tree");
if (i < 0 || !process.argv[i + 1]) { console.error("usage: ea-release-gate.mjs --tree <export dir>"); process.exit(2); }
const tree = path.resolve(process.argv[i + 1]);
const { eaRefIsPlaceholder } = await loadTs("src/lib/earlyAccess.ts");
const attested = makeAttested(process.env, eaRefIsPlaceholder);
const read = (rel) => { const f = path.join(tree, rel); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""; };
const strikeIn = STRIKE_PAGES.filter((rel) => strikeMarkup(read(rel)).length > 0); // P40: the P36 and the P40 card markers (scripts/lib/strike-markup.mjs)
const limited = read("index.html").includes("data-ea-limited");
const problems = [];
if (strikeIn.length && !attested(process.env.AICC_EA_STRIKE_COUNSEL_APPROVED)) problems.push(`the export shows the plan price struck through (${strikeIn.slice(0, 4).join(", ")}${strikeIn.length > 4 ? ", ..." : ""}): a release needs counsel's pricing-claims approval attested with AICC_EA_STRIKE_COUNSEL_APPROVED=<reference> (an evidence-folder file or a real reference; the same rules as launch:check)`);
// P41 (compliance memo 7.3): even WITH counsel's reference a struck price is refused unless every struck card carries its label, its disclosure and its screen-reader text in the same card (checked in the page's own language)
if (strikeIn.length) {
  const D = await loadDictionaries();
  for (const rel of strikeIn) {
    const l = ["he", "es", "ru"].find((x) => rel.startsWith(`${x}/`)) || "en", pr = D[l].ea.ss.pricing;
    for (const q of strikeCardProblems(read(rel), { label: pr.strikeLabel, note: pr.strikeNote, sr: pr.strikeSr })) problems.push(`${rel}: ${q} (memo 7.3: strike markup needs its label and disclosure in the same card)`);
  }
}
if (limited && !attested(process.env.AICC_EA_LIMITED_ATTESTED)) problems.push('the export shows "Limited availability" (data-ea-limited on Home): a release needs the owner attestation AICC_EA_LIMITED_ATTESTED=<reference> (same rules as launch:check)');
for (const p of problems) console.error("EA RELEASE GATE FAIL: " + p);
process.exit(problems.length ? 1 : 0);
