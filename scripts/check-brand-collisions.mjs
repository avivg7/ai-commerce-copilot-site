// node scripts/check-brand-collisions.mjs --theme <Control Plane theme dir>
// A kit class name that the consumer's own CSS also styles is a latent layout bug: the Control Plane theme once styled `.aicc-store` (store rows) while the shopper demo
// introduced the kit class `.aicc-store`, which collapsed the approved demo on the Control Plane. Every class the kit DEFINES (brand/aicc-brand.css) or EMITS (brand/js/*.js)
// must be unique to the kit unless it is listed in brand/content/class-ownership.json (grandfathered, intentional named extensions). A NEW collision fails.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/load.mjs";

const i = process.argv.indexOf("--theme");
const theme = i >= 0 ? process.argv[i + 1] : null;
if (!theme) { console.error("usage: node scripts/check-brand-collisions.mjs --theme <theme dir>"); process.exit(2); }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const cssClasses = (s) => new Set([...strip(s).matchAll(/\.(aicc-[a-z0-9_-]+)/g)].map((m) => m[1]));
const kit = cssClasses(fs.readFileSync(path.join(ROOT, "brand", "aicc-brand.css"), "utf8"));
for (const f of fs.readdirSync(path.join(ROOT, "brand", "js"))) if (f.endsWith(".js")) for (const m of fs.readFileSync(path.join(ROOT, "brand", "js", f), "utf8").matchAll(/aicc-[a-z0-9_-]+/g)) kit.add(m[0]);
const own = JSON.parse(fs.readFileSync(path.join(ROOT, "brand", "content", "class-ownership.json"), "utf8")).sharedWithTheme;
const cssDir = path.join(path.resolve(theme), "assets", "css");
const files = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).filter((f) => f.endsWith(".css") && f !== "aicc-tokens.css").map((f) => path.join(cssDir, f)) : [];
if (fs.existsSync(path.join(path.resolve(theme), "style.css"))) files.push(path.join(path.resolve(theme), "style.css"));
if (!files.length) { console.error(`FAIL: no theme CSS found under ${cssDir}`); process.exit(1); }
const theirs = new Map();
for (const f of files) for (const c of cssClasses(fs.readFileSync(f, "utf8"))) theirs.set(c, [...(theirs.get(c) || []), path.basename(f)]);
const collisions = [...kit].filter((c) => theirs.has(c) && !own.includes(c)).sort();
const stale = own.filter((c) => !kit.has(c) || !theirs.has(c));
if (collisions.length) {
  console.error(`FAIL: ${collisions.length} kit class name(s) are also styled by the theme's own CSS (layout collision risk):`);
  for (const c of collisions) console.error(`  .${c}  (theme: ${theirs.get(c).join(", ")})  -> give the KIT class a kit-owned prefix (aicc-fbt-*); do not extend the allow-list to silence this`);
  process.exit(1);
}
console.log(`PASS: no new kit/theme class collisions (${kit.size} kit classes, ${theirs.size} theme classes, ${own.length} grandfathered shared${stale.length ? `, ${stale.length} grandfathered entries no longer collide: ${stale.join(", ")}` : ""})`);
