// Export equivalence (shared by test-launch-offer.mjs and export-hash.mjs): two static exports are "byte-identical" when every file has the same SHA-256 after the build id
// (a per-build random value in file names and contents) is normalised. `relaxed` also normalises the page-chunk hash and webpack module ids (used for the VERIFY comparison only).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const walk = (root, filter = () => true) => { const out = []; const w = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (filter(p)) out.push(p); } }; w(root); return out; };

export function buildId(root) {
  const d = path.join(root, "_next/static");
  const ids = fs.readdirSync(d).filter((x) => fs.existsSync(path.join(d, x, "_buildManifest.js")));
  if (ids.length !== 1) throw new Error(`cannot find the build id of ${root}`);
  return ids[0];
}
export function fingerprint(root, { relaxed = false, ignore = [] } = {}) {
  const bid = buildId(root), out = new Map();
  for (const f of walk(root)) {
    let rel = path.relative(root, f).split(path.sep).join("/");
    if (ignore.some((i) => rel.includes(i))) continue;
    let b = fs.readFileSync(f);
    if (/\.(html|txt|js|css|json|xml|map|webmanifest|vtt)$/.test(rel)) {
      let t = b.toString("latin1").split(bid).join("BUILDID");
      if (relaxed) t = t.replace(/(page-)[0-9a-f]{16}(\.js)/g, "$1HASH$2").replace(/(:I\[)\d+(,\[)/g, "$1MODID$2").replace(/(\\"id\\":)\d+/g, "$1MODID");
      b = Buffer.from(t, "latin1");
    }
    rel = rel.split(bid).join("BUILDID");
    if (relaxed) rel = rel.replace(/(app\/\[\[\.\.\.slug\]\]\/page-)[0-9a-f]{16}/, "$1HASH");
    out.set(rel, crypto.createHash("sha256").update(b).digest("hex"));
  }
  return out;
}
export function compare(a, b, opts) {
  const A = fingerprint(a, opts), B = fingerprint(b, opts);
  const onlyA = [...A.keys()].filter((k) => !B.has(k)), onlyB = [...B.keys()].filter((k) => !A.has(k)), diff = [...A.keys()].filter((k) => B.has(k) && A.get(k) !== B.get(k));
  return { n: A.size, m: B.size, onlyA, onlyB, diff };
}
/** One SHA-256 over the sorted "<path> <sha256>" lines of the normalised export. */
export function treeHash(root, opts) {
  const fp = fingerprint(root, opts);
  return crypto.createHash("sha256").update([...fp.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k} ${v}`).join("\n")).digest("hex");
}
