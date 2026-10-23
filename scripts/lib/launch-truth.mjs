// Launch-truth rules (legal / marketing-truth pass, 2026-10-22): wording that would be a false or unprovable public claim at launch.
// Shared by `npm run copy:check` (every locale source, line by line) and `npm run content:check` (English dictionary, FAQ and rendered pages, sentence by sentence).
// A rule with `negatable` may be NAMED in order to deny it on the same sentence ("There is no recurring billing", "not certified"); every other rule has no exception.
// A rule with `exempt` is skipped for a sentence that matches it (WooCommerce's own related products ARE same-category/tag based, which is true).
// A rule with `scope: "src"` applies to public copy only (docs legitimately discuss WordPress.org, recurring-billing designs etc.).
// Weakening or deleting a rule needs the same owner decision as the claim it guards. Each rule has samples in SELF_TEST (checked on every run).
export const NEGATION = /\b(no|not|never|without|nor|neither|nothing|n't|cannot)\b/i;

export const TRUTH_RULES = [
  // The guarantee is on the INITIAL PLAN purchase (14 days from payment received and plan issued); "your first purchase" reads as the first thing a merchant ever buys.
  { id: "first-purchase-en", re: /\bfirst (plan )?purchase\b/i, why: 'say "initial plan purchase", not "first purchase" (the guarantee covers the initial purchase of a plan, never renewals)' },
  { id: "first-purchase-es", re: /primera compra/i, why: 'es: say "compra inicial de su plan", not "primera compra"' },
  // The money-back panel is not a trial.
  { id: "try-it-title", re: /\btitle:\s*"(Try it|לנסות|Pruébelo|Проверьте)"/i, why: 'money-back panel titled like a trial ("Try it"): call it "Money-back guarantee"', scope: "src" },
  // AICC is not listed on WordPress.org (no listing, no distributable ZIP).
  { id: "wordpress-org", re: /wordpress\.org|plugin directory|plugin repository|wordpress plugin (store|marketplace)|one-click install/i, why: "WordPress.org / plugin-directory install wording (AICC is not listed there yet)", scope: "src" },
  // WooCommerce is the only supported platform; no other platform is named in public copy (not even as "coming").
  { id: "other-platform", re: /shopify|bigcommerce|magento|squarespace/i, why: "another e-commerce platform named (WooCommerce is the only supported platform; no roadmap platform is announced)" },
  // No free flow exists.
  { id: "free-plan", re: /\bfree (plan|tier|version|forever|to start|to try|download|install(ation)?)\b|freemium/i, why: "free plan / tier wording (no free flow exists)" },
  // No certification claims; encryption at rest is not verified.
  { id: "certification", re: /\b(soc ?2|iso ?27001|hipaa|pci[- ]dss|certified|certification)\b/i, why: "certification claim (SOC 2, ISO 27001, HIPAA, PCI DSS, certified) without a negation", negatable: true },
  { id: "encryption-at-rest", re: /encrypt(ed|ion) at[- ]rest|at[- ]rest encrypt/i, why: "encryption-at-rest claim (not verified)" },
  { id: "gdpr-ready", re: /\b(gdpr|ccpa|hipaa)[- ](ready|certified|friendly|approved|safe)\b/i, why: "GDPR / CCPA ready-certified-friendly claim" },
  // No invented social proof.
  { id: "social-proof", re: /\b\d[\d,.]*\+?\s*(merchants|stores|shops|customers|brands|businesses|sellers)\s+(who\s+|that\s+)?(use|trust|rely|already|worldwide|love)\b|\b(thousands|hundreds|millions) of (merchants|stores|shops|customers|businesses)\b|testimonial|case stud(y|ies)|as seen (in|on)\b|\bour customers (say|love)\b/i, why: "invented social proof (customer counts, testimonials, case studies)" },
  // No recurring billing / auto-renewal wording unless denied.
  { id: "recurring", re: /\b(recurring|renews? automatically|renewed automatically|automatically renew\w*|auto-?pay)\b/i, why: "recurring billing / automatic renewal wording without a negation", negatable: true, scope: "src" },
  // Cold-start / thin-history truth (owner decision, 2026-10-23). The chain is: product pairs counted from the store's own orders -> relevant in-stock catalog products (internally the same-category
  // tier) -> newest in-stock products -> merchant rules last. It is never positioned as a "same category fallback", and no AI / semantic / ML / embedding claim is made (the semantic cold-start provider is
  // disabled by default and fake-only). WooCommerce's related products really are category/tag based, so a sentence that names WooCommerce / related products may say "same category".
  { id: "same-category-fallback", re: /\bsame[- ]categor(y|ies)\b(?=[^.]*\b(fill\w*|fall\w* ?back|fallbacks?|remaining spots?|newest)\b)|\b(fill\w*|fall\w* ?back|fallbacks?|remaining spots?)\b[^.]*\bsame[- ]categor(y|ies)\b|\bfrom the same categor(y|ies)\b|\bfall\w* back (to|on) (its|the|their|your|a) categor(y|ies)\b/i, exempt: /woocommerce|related products/i, scope: "src", why: "AICC's thin-history fill is not described as a same-category fallback (say: relevant in-stock products from the catalog, then the newest in-stock products)" },
  { id: "ai-semantic-claim", re: /\b(embeddings?|machine[- ]learning|neural|deep learning|large language models?|llm)\b|\bsemantic (cold|catalog|match\w*|similarity|search|recommend\w*|provider|engine)\b/i, why: "AI / semantic / ML / embedding claim (the semantic cold-start provider is disabled by default; AICC counts and ranks with fixed rules)", negatable: true },
  // WooCommerce DOES have cart cross-sells (hand-linked by the merchant) and category/tag related products; never claim it lacks cart recommendations.
  { id: "woo-no-cart-recs", re: /\bwoocommerce\b[^.]*\b(has|have|offers?|ships with|includes?|provides?|gives you) (no|nothing for|no built-in|no native)\b[^.]*\b(cart|cross-?sells?)\b|\b(no|without any) (native|built-in) (cart )?(recommendations?|cross-?sells?)\b/i, why: "never claim WooCommerce lacks cart recommendations (cart cross-sells exist; the merchant links them by hand)" },
];

const sentences = (text) => String(text).split(/(?<=[.!?;])\s+|\n+/);

/** Problems of one text: [{id, why, snippet}]. `publicCopy` is false for docs (the rules with scope "src" are skipped). */
export function truthProblems(text, { publicCopy = true } = {}) {
  const out = [];
  for (const s of sentences(text)) {
    for (const r of TRUTH_RULES) {
      if (r.scope === "src" && !publicCopy) continue;
      const m = s.match(r.re);
      if (!m) continue;
      if (r.exempt && r.exempt.test(s)) continue;
      if (r.negatable && (NEGATION.test(s) || /\?\s*$/.test(s))) continue; // denied, or asked ("Does my plan renew automatically?" is a question, not a claim)
      out.push({ id: r.id, why: r.why, snippet: s.slice(Math.max(0, m.index - 30), m.index + 70).replace(/\s+/g, " ").trim() });
    }
  }
  return out;
}

export const SELF_TEST = {
  bad: [
    "14-day money-back guarantee on your first purchase", "Garantía de devolución del dinero de 14 días en su primera compra", 'title: "Try it",',
    "Install it from the WordPress plugin directory", "Get it on wordpress.org", "Also works for Shopify stores", "A free plan for one store", "Free forever for small stores",
    "SOC 2 certified", "ISO 27001 compliant", "Your data is encrypted at rest", "GDPR ready", "Used by 2,000 merchants who trust AICC", "Over 5,000 stores use AICC",
    "Thousands of merchants rely on it", "Read our case study", "A recurring annual charge", "Your plan renews automatically",
    "the remaining spots are filled from the same category", "AICC falls back to the same category, then the newest products", "From the same category", "Uses semantic matching to fill thin history",
    "Embeddings pick the products", "Powered by machine learning", "WooCommerce has no cart recommendations", "WooCommerce offers nothing for the cart",
  ],
  ok: [
    "14-day money-back guarantee on your initial plan purchase", "Garantía de devolución del dinero de 14 días en la compra inicial de su plan", 'title: "Money-back guarantee",',
    "No independent third-party security certification (SOC 2, ISO 27001) exists for the service", "We have not been audited or certified by a third party", "There is no recurring or automatic billing",
    "AICC never renews a plan automatically", "Nothing renews or charges automatically", "It reads your WooCommerce orders", "Free slot on your plan", "Disconnecting frees the slot",
    "A larger plan is a separate purchase.", "Does my plan renew automatically?",
    "WooCommerce related products come from the same category", "WooCommerce's related products match by category or tag", "The remaining spots are filled with relevant in-stock products from your catalog",
    "AICC counts and ranks with fixed rules, not a machine-learning model", "There is no semantic matching or embeddings in this decision", "WooCommerce cross-sells are products you link by hand",
    "Semantic landmarks, one main heading per page",
  ],
};

/** Throws a message when the rules do not catch every SELF_TEST.bad sample or flag a SELF_TEST.ok sample. */
export function selfTestProblems() {
  const missed = SELF_TEST.bad.filter((t) => !truthProblems(t).length);
  const wrong = SELF_TEST.ok.filter((t) => truthProblems(t).length);
  return missed.length || wrong.length ? `missed [${missed.join(" | ")}] flagged [${wrong.join(" | ")}]` : "";
}
