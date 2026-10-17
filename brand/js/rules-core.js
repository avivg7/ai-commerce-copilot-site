// The merchant rules as one pure function shared by the demos (fbt-demo.js merchant view, rules-demo.js).
// It is a LINE-BY-LINE port of the backend ranking policy (BE app/recommendation_policy.py `_apply_resolved_policy` and
// `_apply_prefer_deprioritize`), so the demo shows what the product really does, including how several rules interact:
//   1. EXCLUDE is a hard filter and wins over every other rule.
//   2. Out-of-stock (and deleted) products never appear, and cannot be pinned.
//   3. PIN prepends the pinned products (most recently set first) and removes them from the rest.
//   4. PREFER / DEPRIORITIZE reorder the REMAINING products with two bounded single-adjacent-swap passes:
//        prefer pass (left to right): a preferred product swaps with its immediate predecessor, once, unless the predecessor is also
//        preferred or belongs to another tier; the product placed in front by a swap becomes `protected`.
//        deprioritize pass (left to right): a deprioritized product swaps with its immediate successor, once, unless the successor is also
//        deprioritized, is `protected`, or belongs to another tier; after a swap the scan skips both products.
//      A tier is the group a product comes from (learned partners / same category / newest); a swap never crosses a tier boundary.
//      Pin is the only way to force a position; a product can still be displaced by OTHER products' swaps.
// items: [{ id, tier, inStock? }] in AICC's own order. rules: [{ id, action: "pin"|"prefer"|"deprioritize"|"exclude", seq }]
// returns { shown: [item...], hidden: [{ item, reason: "excluded"|"outOfStock" }] }
// tests: scripts/rules-core-test.mjs compares this file with an independent port of the Python over every combination of rules.
export const RULE_ACTIONS = ["pin", "prefer", "deprioritize", "exclude"];

export function applyRules(items, rules) {
  const action = new Map(rules.map((r) => [r.id, r.action]));
  const hidden = [];
  const filtered = [];
  for (const it of items) {
    if (it.inStock === false) hidden.push({ item: it, reason: "outOfStock" });
    else if (action.get(it.id) === "exclude") hidden.push({ item: it, reason: "excluded" });
    else filtered.push(it);
  }
  // PIN: most recently set first; only products that are eligible (in stock, not excluded) can be pinned.
  const pinned = rules
    .filter((r) => r.action === "pin")
    .sort((a, b) => b.seq - a.seq)
    .map((r) => filtered.find((it) => it.id === r.id))
    .filter(Boolean);
  const pinnedIds = new Set(pinned.map((it) => it.id));
  const remaining = filtered.filter((it) => !pinnedIds.has(it.id));

  const prefer = new Set(rules.filter((r) => r.action === "prefer").map((r) => r.id));
  const deprioritize = new Set(rules.filter((r) => r.action === "deprioritize").map((r) => r.id));
  const result = [...remaining];
  const n = result.length;
  const protectedIds = new Set();
  for (let i = 1; i < n; i++) {
    if (prefer.has(result[i].id) && !prefer.has(result[i - 1].id) && result[i - 1].tier === result[i].tier) {
      [result[i - 1], result[i]] = [result[i], result[i - 1]];
      protectedIds.add(result[i - 1].id);
    }
  }
  let i = 0;
  while (i < n - 1) {
    const cur = result[i].id, nxt = result[i + 1].id;
    if (deprioritize.has(cur) && !deprioritize.has(nxt) && !protectedIds.has(nxt) && result[i].tier === result[i + 1].tier) {
      [result[i], result[i + 1]] = [result[i + 1], result[i]];
      i += 2;
    } else i += 1;
  }
  return { shown: [...pinned, ...result], hidden };
}
