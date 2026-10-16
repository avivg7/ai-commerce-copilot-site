// Makes the kit's binary assets web-accessible for the Next static export: copies brand/assets/* to public/brand-kit/ (git-ignored).
// The kit stays the only committed copy.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/load.mjs";
const from = path.join(ROOT, "brand/assets");
const to = path.join(ROOT, "public/brand-kit");
fs.mkdirSync(to, { recursive: true });
for (const f of fs.readdirSync(from)) {
  const src = path.join(from, f), dst = path.join(to, f);
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size || fs.statSync(dst).mtimeMs < fs.statSync(src).mtimeMs) fs.copyFileSync(src, dst);
}
console.log(`brand assets published to public/brand-kit (${fs.readdirSync(from).length} files)`);
