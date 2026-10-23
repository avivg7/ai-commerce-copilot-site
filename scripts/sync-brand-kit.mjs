// Copies the brand kit into a consumer (the Control Plane WordPress theme) byte-for-byte.
//   node scripts/sync-brand-kit.mjs --to <theme dir>      copy brand/ -> <theme>/assets/brand/ and tokens -> <theme>/assets/css/aicc-tokens.css; ALSO removes files under
//                                                         <theme>/assets/brand/ that are no longer in the manifest (a kit file that was deleted or renamed upstream)
//   node scripts/sync-brand-kit.mjs --to <theme dir> --dry-run   list what would be copied and what would be removed; changes nothing
//   node scripts/sync-brand-kit.mjs --verify <theme dir>  verify every file of the kit in <theme> against brand/MANIFEST.json (stale extra files are listed as a WARNING)
//   node scripts/sync-brand-kit.mjs --verify <theme dir> --strict   the same, but stale extra files under assets/brand/ also FAIL (the release builders use this)
// The theme is never edited by hand: re-run this after any change in brand/. DIRECTION: Site -> theme only (REFUSED when the destination overlaps the Site, looks like a Site checkout, or the Site manifest is stale).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
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
const dry = args.includes("--dry-run");

// SOURCE-OF-TRUTH GUARDS. The Site's brand/ is canonical; this tool only ever copies Site -> consumer. (The approved shopper demo was once judged on a stale consumer; a reverse or stale sync must be impossible, not merely unlikely.)
if (mode === "to") {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const target = real(dir), rootReal = real(ROOT);
  const inside = (a, b) => a === b || a.startsWith(b + path.sep);
  if (inside(target, rootReal) || inside(rootReal, target)) { console.error(`REFUSED: ${target} overlaps the Site repository (${rootReal}). The brand kit flows Site -> theme only; it can never be written into (or over) the Site.`); process.exit(1); }
  if (fs.existsSync(path.join(target, "src", "i18n", "en.ts")) || fs.existsSync(path.join(target, "brand", "MANIFEST.json"))) { console.error(`REFUSED: ${target} looks like a Site checkout (src/i18n/en.ts or brand/MANIFEST.json exists). The destination must be a consumer theme.`); process.exit(1); }
  // the source must be internally consistent (manifest == files on disk) before it is copied: a stale manifest would copy stale bytes with a "valid" hash
  const chk = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-brand-manifest.mjs"), "--check"], { encoding: "utf8" });
  if (chk.status !== 0) { console.error(`REFUSED: brand/MANIFEST.json does not match the files in brand/ (the source is stale or half-edited). Run \`npm run brand:build\` in the Site first.\n${(chk.stdout || "") + (chk.stderr || "")}`.trimEnd()); process.exit(1); }
}
const strict = args.includes("--strict");

// Files under <theme>/assets/brand/ that the manifest does not list (MANIFEST.json itself is the kit's own copy and is kept). Only regular files and symlinks directly
// inside the real assets/brand/ tree are ever considered; a symlinked assets/brand or symlinked sub-directory is never followed.
function staleFiles() {
  const out = [];
  let st;
  try { st = fs.lstatSync(destKit); } catch { return out; }
  if (!st.isDirectory()) return out; // missing, a file or a symlink: nothing to enumerate (and nothing is ever removed through a link)
  const known = new Set([...Object.keys(manifest.files), "MANIFEST.json"]);
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (!known.has(r)) out.push(r);
    }
  })(destKit, "");
  return out.sort();
}

if (mode === "to" && dry) {
  const stale = staleFiles();
  console.log(`DRY RUN: would copy ${Object.keys(manifest.files).length} kit files to ${destKit} and tokens -> ${destTokens}; would remove ${stale.length} stale file(s) under assets/brand/` + (stale.length ? ":\n  " + stale.join("\n  ") : ""));
  process.exit(0);
}
if (mode === "to") {
  fs.mkdirSync(path.dirname(destTokens), { recursive: true });
  const stale = staleFiles();
  for (const rel of stale) fs.unlinkSync(path.join(destKit, rel)); // regular files / symlink entries only; never recursive, never outside assets/brand
  // drop directories left empty by the removal (deepest first), never assets/brand itself
  for (const rel of [...new Set(stale.map((r) => path.dirname(r)).filter((d) => d !== "."))].sort((a, b) => b.length - a.length)) {
    for (let d = rel; d && d !== "."; d = path.dirname(d)) { try { fs.rmdirSync(path.join(destKit, d)); } catch { break; } }
  }
  if (stale.length) console.log(`removed ${stale.length} stale file(s) no longer in the manifest:\n  ` + stale.join("\n  "));
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
if (mode === "verify") {
  const stale = staleFiles();
  if (stale.length) {
    const msg = `${stale.length} stale file(s) under assets/brand/ are not in the manifest (run --to to remove them):\n  ` + stale.slice(0, 20).join("\n  ");
    if (strict) bad.push(...stale.map((r) => `stale ${r}`)); else console.error("WARNING: " + msg);
  }
}
if (bad.length) { console.error(`FAIL: ${bad.length} file(s) not identical to the brand kit\n  ` + bad.slice(0, 20).join("\n  ")); process.exit(1); }
console.log(`PASS: ${Object.keys(manifest.files).length} files identical to the brand kit (MANIFEST.json)`);
