// npm run tokens:check: design/aicc-tokens.css must be byte-identical to the Control Plane theme copy.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./lib/load.mjs";

const PEER = process.env.AICC_TOKENS_PEER ||
  "/Users/avivgerman/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/cp2a-14-readiness-independence/admin/wp-content/themes/aicc-admin/assets/css/aicc-tokens.css";
const mine = path.join(ROOT, "design/aicc-tokens.css");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);

if (!fs.existsSync(mine)) {
  console.error("FAIL: design/aicc-tokens.css is missing");
  process.exit(1);
}
if (!fs.existsSync(PEER)) {
  console.log(`tokens:check  peer copy not found at\n  ${PEER}\n  -> PASS (nothing to compare yet; the Control Plane engineer is creating the peer copy).`);
  process.exit(0);
}
const a = fs.readFileSync(mine);
const b = fs.readFileSync(PEER);
if (Buffer.compare(a, b) === 0) {
  console.log(`tokens:check  PASS: identical to the Control Plane copy (${a.length} bytes, sha256 ${sha(a)}).`);
  process.exit(0);
}
const al = a.toString().split("\n");
const bl = b.toString().split("\n");
let n = 0;
console.error(`tokens:check  FAIL: design/aicc-tokens.css differs from the Control Plane copy.\n  site: ${sha(a)} (${a.length} bytes)\n  peer: ${sha(b)} (${b.length} bytes)`);
for (let i = 0; i < Math.max(al.length, bl.length) && n < 12; i++) {
  if (al[i] !== bl[i]) {
    console.error(`  line ${i + 1}:\n    site: ${al[i] ?? "(missing)"}\n    peer: ${bl[i] ?? "(missing)"}`);
    n++;
  }
}
console.error("Fix: edit ONE copy, then copy it byte-for-byte to the other repo.");
process.exit(1);
