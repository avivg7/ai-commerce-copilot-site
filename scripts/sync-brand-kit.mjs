// Copies the brand kit into a consumer (the Control Plane WordPress theme) byte-for-byte.
//   node scripts/sync-brand-kit.mjs --to <theme dir>      copy brand/ -> <theme>/assets/brand/ and tokens -> <theme>/assets/css/aicc-tokens.css
//   node scripts/sync-brand-kit.mjs --verify <theme dir>  verify every file of the kit in <theme> against brand/MANIFEST.json
// The theme is never edited by hand: re-run this after any change in brand/.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./lib/load.mjs";

const args = process.argv.slice(2);
const mode = args.includes("--verify") ? "verify" : args.includes("--to") ? "to" : null;
const dir = mode ? args[args.indexOf(mode === "to" ? "--to" : "--verify") + 1] : null;
if (!mode || !dir) { console.error("usage: node scripts/sync-brand-kit.mjs --to <theme dir> | --verify <theme dir>"); process.exit(2); }

const KIT = path.join(ROOT, "brand");
const manifest = JSON.parse(fs.readFileSync(path.join(KIT, "MANIFEST.json"), "utf8"));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const destKit = path.join(path.resolve(dir), "assets", "brand");
const destTokens = path.join(path.resolve(dir), "assets", "css", "aicc-tokens.css");

if (mode === "to") {
  fs.mkdirSync(path.dirname(destTokens), { recursive: true });
  let n = 0, bytes = 0;
  for (const rel of Object.keys(manifest.files)) {
    const to = path.join(destKit, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(KIT, rel), to);
    n++; bytes += manifest.files[rel].bytes;
  }
  fs.copyFileSync(path.join(KIT, "MANIFEST.json"), path.join(destKit, "MANIFEST.json"));
  fs.copyFileSync(path.join(KIT, "aicc-tokens.css"), destTokens);
  console.log(`synced ${n} files (${(bytes / 1024).toFixed(0)} kB) to ${destKit}\ntokens -> ${destTokens}`);
}

// verify (also run after --to)
const bad = [];
for (const [rel, meta] of Object.entries(manifest.files)) {
  const f = path.join(destKit, rel);
  if (!fs.existsSync(f)) { bad.push(`missing ${rel}`); continue; }
  if (sha(fs.readFileSync(f)) !== meta.sha256) bad.push(`differs ${rel}`);
}
if (!fs.existsSync(destTokens) || sha(fs.readFileSync(destTokens)) !== manifest.files["aicc-tokens.css"].sha256) bad.push("assets/css/aicc-tokens.css differs from brand/aicc-tokens.css");
if (bad.length) { console.error(`FAIL: ${bad.length} file(s) not identical to the brand kit\n  ` + bad.slice(0, 20).join("\n  ")); process.exit(1); }
console.log(`PASS: ${Object.keys(manifest.files).length} files identical to the brand kit (MANIFEST.json)`);
