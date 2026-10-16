// npm run pricing:check: prices/limits must equal the accepted values AND the Control Plane bootstrap file (if present).
import fs from "node:fs";
import { loadTs, loadDictionaries } from "./lib/load.mjs";

const ACCEPTED = { solo: { price: 99, stores: 1 }, studio: { price: 199, stores: 3 }, agency: { price: 499, stores: 10 } };
const BOOTSTRAP = process.env.AICC_BOOTSTRAP_PHP ||
  "/Users/avivgerman/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/cp2a-14-readiness-independence/scripts/bootstrap-commercial-products.php";

const { PLANS, CURRENCY, TERM_DAYS, GUARANTEE_DAYS } = await loadTs("src/data/plans.ts");
const errors = [];

for (const [id, want] of Object.entries(ACCEPTED)) {
  const p = PLANS.find((x) => x.id === id);
  if (!p) { errors.push(`plan "${id}" missing from src/data/plans.ts`); continue; }
  if (p.price !== want.price) errors.push(`${id}: price ${p.price} != accepted ${want.price}`);
  if (p.stores !== want.stores) errors.push(`${id}: stores ${p.stores} != accepted ${want.stores}`);
}
if (PLANS.length !== 3) errors.push(`expected exactly 3 plans, found ${PLANS.length}`);
if (CURRENCY !== "USD") errors.push(`currency ${CURRENCY} != USD`);
if (TERM_DAYS !== 365) errors.push(`term ${TERM_DAYS} != 365`);
if (GUARANTEE_DAYS !== 14) errors.push(`guarantee ${GUARANTEE_DAYS} != 14`);
console.log("accepted values   :", Object.entries(ACCEPTED).map(([k, v]) => `${k} $${v.price}/${v.stores}`).join("  "));
console.log("src/data/plans.ts :", PLANS.map((p) => `${p.id} $${p.price}/${p.stores}`).join("  "));

if (fs.existsSync(BOOTSTRAP)) {
  const php = fs.readFileSync(BOOTSTRAP, "utf8");
  const found = {};
  const re = /'plan_code'\s*=>\s*'(\w+)'[\s\S]*?'price'\s*=>\s*'(\d+)'[\s\S]*?'activation_limit'\s*=>\s*(\d+)/g;
  let m;
  while ((m = re.exec(php))) found[m[1]] = { price: Number(m[2]), stores: Number(m[3]) };
  console.log("Control Plane     :", Object.entries(found).map(([k, v]) => `${k} $${v.price}/${v.stores}`).join("  ") || "(none parsed)");
  for (const p of PLANS) {
    const f = found[p.id];
    if (!f) errors.push(`Control Plane bootstrap has no plan "${p.id}" (parsed: ${Object.keys(found).join(", ") || "none"})`);
    else {
      if (f.price !== p.price) errors.push(`${p.id}: site $${p.price} != Control Plane $${f.price}`);
      if (f.stores !== p.stores) errors.push(`${p.id}: site ${p.stores} stores != Control Plane ${f.stores}`);
    }
  }
} else {
  console.log(`Control Plane bootstrap file not found (${BOOTSTRAP}); compared to accepted values only.`);
}

// No literal price in any dictionary may differ from a plan price (copy uses {priceSolo} etc.).
const dicts = await loadDictionaries();
const prices = new Set(PLANS.map((p) => p.price));
const walk = (o, path, cb) => {
  if (typeof o === "string") cb(o, path);
  else if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${path}[${i}]`, cb));
  else if (o && typeof o === "object") for (const k of Object.keys(o)) walk(o[k], path ? `${path}.${k}` : k, cb);
};
for (const [l, d] of Object.entries(dicts)) {
  walk(d, "", (s, p) => {
    for (const m of s.matchAll(/\$\s?(\d[\d,]*)/g)) {
      if (!prices.has(Number(m[1].replace(/,/g, "")))) errors.push(`[${l}] ${p}: literal price "$${m[1]}" is not a plan price`);
      else errors.push(`[${l}] ${p}: hard-coded plan price "$${m[1]}"; use {price<Plan>} so plans.ts stays the only source`);
    }
  });
}

if (errors.length) {
  console.error("\nFAIL pricing:check");
  errors.forEach((e) => console.error("  " + e));
  process.exit(1);
}
console.log("PASS pricing:check");
