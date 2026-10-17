// npm run test:rules: the demos' rule engine (brand/js/rules-core.js) must rank EXACTLY like the backend policy
// (BE app/recommendation_policy.py `_apply_resolved_policy` / `_apply_prefer_deprioritize`). This file holds a second, independent,
// deliberately literal port of the Python (same names, same loops) and compares the two over EVERY combination of rules
// (none / pin / prefer / deprioritize / exclude per product) on both sample lists the demos use, with pins set in both orders.
import { applyRules } from "../brand/js/rules-core.js";

// ---- literal port of the Python -----------------------------------------------------------------------------------------------
function applyPreferDeprioritize(candidates, prefer, deprioritize) {
  const result = [...candidates];
  const n = result.length;
  const pid = (c) => String(c.id);
  const protectedSet = new Set();
  let i = 1;
  while (i < n) {
    if (prefer.has(pid(result[i])) && !prefer.has(pid(result[i - 1])) && result[i - 1].source === result[i].source) {
      const t = result[i - 1]; result[i - 1] = result[i]; result[i] = t;
      protectedSet.add(pid(result[i - 1]));
    }
    i += 1;
  }
  i = 0;
  while (i < n - 1) {
    const cur = pid(result[i]), nxt = pid(result[i + 1]);
    if (deprioritize.has(cur) && !deprioritize.has(nxt) && !protectedSet.has(nxt) && result[i].source === result[i + 1].source) {
      const t = result[i]; result[i] = result[i + 1]; result[i + 1] = t;
      i += 2;
    } else i += 1;
  }
  return result;
}
function reference(items, assign, seqOrder) {
  // upstream candidates: in stock only (the tiers never return out-of-stock products)
  const candidates = items.filter((it) => it.inStock !== false).map((it) => ({ id: it.id, source: it.tier }));
  const excluded = new Set(Object.entries(assign).filter(([, a]) => a === "exclude").map(([id]) => id));
  const filtered = candidates.filter((c) => !excluded.has(c.id));
  const pinnedRefs = Object.entries(assign).filter(([, a]) => a === "pin").map(([id]) => id).sort((a, b) => seqOrder(b) - seqOrder(a));
  const pinned = pinnedRefs.filter((id) => !excluded.has(id)).map((id) => candidates.find((c) => c.id === id)).filter(Boolean);
  const pinnedIds = new Set(pinned.map((c) => c.id));
  const remaining = filtered.filter((c) => !pinnedIds.has(c.id));
  const prefer = new Set(Object.entries(assign).filter(([, a]) => a === "prefer").map(([id]) => id));
  const dep = new Set(Object.entries(assign).filter(([, a]) => a === "deprioritize").map(([id]) => id));
  return [...pinned, ...applyPreferDeprioritize(remaining, prefer, dep)].map((c) => c.id);
}

// ---- the two sample lists the demos use ----------------------------------------------------------------------------------------
const FBT = [
  { id: "filters", tier: "learned" }, { id: "grinder", tier: "learned" }, { id: "kettle", tier: "learned" }, { id: "mug", tier: "category" },
];
const RULES_DEMO = [
  { id: "filters", tier: "learned" }, { id: "grinder", tier: "learned" }, { id: "kettle", tier: "learned" },
  { id: "mug", tier: "category" }, { id: "towel", tier: "category" }, { id: "travel", tier: "category", inStock: false },
];
const STATES = [null, "pin", "prefer", "deprioritize", "exclude"];

let checked = 0, bad = 0;
const fails = [];
for (const [name, items] of [["fbt-demo list", FBT], ["rules-demo list", RULES_DEMO]]) {
  const ids = items.map((i) => i.id);
  const total = STATES.length ** ids.length;
  for (const reverse of [false, true]) {
    for (let k = 0; k < total; k++) {
      let x = k;
      const assign = {};
      for (const id of ids) { const s = STATES[x % STATES.length]; x = Math.floor(x / STATES.length); if (s) assign[id] = s; }
      const idx = (id) => (reverse ? ids.length - ids.indexOf(id) : ids.indexOf(id)) + 1;
      const rules = Object.entries(assign).map(([id, action]) => ({ id, action, seq: idx(id) }));
      const got = applyRules(items, rules);
      const want = reference(items, assign, idx);
      checked++;
      const g = got.shown.map((i) => i.id).join(",");
      if (g !== want.join(",")) { bad++; if (fails.length < 5) fails.push(`${name} ${JSON.stringify(assign)} (pins ${reverse ? "reversed" : "in order"}): demo ${g} vs backend ${want.join(",")}`); }
      // invariants of the product contract
      const shown = got.shown.map((i) => i.id);
      for (const id of ids) {
        if (assign[id] === "exclude" && shown.includes(id)) { bad++; fails.push(`${name}: excluded ${id} is shown`); }
      }
      if (shown.includes("travel")) { bad++; fails.push(`${name}: out-of-stock product shown`); }
    }
  }
}
console.log(`rules-core:test  ${checked} rule combinations compared with the backend algorithm (fbt-demo list 625 x2, rules-demo list 15,625 x2)`);
if (bad) { console.error(`FAIL: ${bad} difference(s)`); fails.forEach((f) => console.error("  " + f)); process.exit(1); }
// Spot checks quoted by the independent review: deprioritize filters + prefer kettle => filters, kettle, grinder, mug (kettle moves ONE place).
const r = applyRules(FBT, [{ id: "filters", action: "deprioritize", seq: 1 }, { id: "kettle", action: "prefer", seq: 2 }]).shown.map((i) => i.id).join(",");
if (r !== "filters,kettle,grinder,mug") { console.error("FAIL: review example gives " + r); process.exit(1); }
console.log("PASS: identical to the backend policy in every combination; review example reproduced");
