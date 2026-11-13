// node scripts/export-hash.mjs <export-dir> [<export-dir> ...]: the normalised tree hash of each static export (build id removed), and, for two directories, whether they are byte-equivalent.
// Used to prove that a build with a new switch OFF equals the build before the switch existed (P37: NEXT_PUBLIC_AICC_SELFSERVICE unset == the P36 export).
import path from "node:path";
import { compare, treeHash } from "./lib/export-fingerprint.mjs";
const dirs = process.argv.slice(2).map((d) => path.resolve(d));
if (dirs.length < 1) { console.error("usage: export-hash.mjs <dir> [<dir>]"); process.exit(2); }
for (const d of dirs) console.log(`${treeHash(d)}  ${d}`);
if (dirs.length === 2) {
  const r = compare(dirs[0], dirs[1]);
  console.log(`files ${r.n} vs ${r.m}; only-in-first ${r.onlyA.length}; only-in-second ${r.onlyB.length}; different ${r.diff.length}${r.diff.length ? " -> " + r.diff.slice(0, 5).join(", ") : ""}`);
  process.exit(r.onlyA.length || r.onlyB.length || r.diff.length ? 1 : 0);
}
