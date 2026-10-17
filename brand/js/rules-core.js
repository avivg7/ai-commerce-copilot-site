// The truthful semantics of the four merchant rules, as one pure function shared by the demos (fbt-demo.js merchant view, rules-demo.js).
// Mirrors how the product applies them (capability sheet section 3):
//   1. EXCLUDE is a hard filter and wins over every other rule.
//   2. Out-of-stock (and deleted) products never appear, even when pinned.
//   3. PIN moves a product to the front (several pins: the one set most recently comes first).
//   4. PREFER nudges a product up ONE place and DEPRIORITIZE down ONE place, and neither crosses into another tier
//      (learned partners / same-category fallbacks / newest products).
// items: [{ id, tier, inStock? }] in AICC's own order. rules: [{ id, action: "pin"|"prefer"|"deprioritize"|"exclude", seq }]
// returns { shown: [item...], hidden: [{ item, reason: "excluded"|"outOfStock" }] }
export const RULE_ACTIONS = ["pin", "prefer", "deprioritize", "exclude"];

export function applyRules(items, rules) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const hidden = [];
  const list = [];
  for (const it of items) {
    const r = byId.get(it.id);
    if (it.inStock === false) hidden.push({ item: it, reason: "outOfStock" });
    else if (r && r.action === "exclude") hidden.push({ item: it, reason: "excluded" });
    else list.push(it);
  }
  const pins = list.filter((it) => byId.get(it.id)?.action === "pin").sort((a, b) => byId.get(b.id).seq - byId.get(a.id).seq);
  const rest = list.filter((it) => !pins.includes(it));
  for (let i = 1; i < rest.length; i++) {
    if (byId.get(rest[i].id)?.action === "prefer" && rest[i - 1].tier === rest[i].tier) [rest[i - 1], rest[i]] = [rest[i], rest[i - 1]];
  }
  for (let i = rest.length - 2; i >= 0; i--) {
    if (byId.get(rest[i].id)?.action === "deprioritize" && rest[i + 1].tier === rest[i].tier) [rest[i], rest[i + 1]] = [rest[i + 1], rest[i]];
  }
  return { shown: [...pins, ...rest], hidden };
}
