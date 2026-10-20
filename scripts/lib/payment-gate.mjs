// Payment-gateway launch gate shared by `npm run launch:check` and `npm run test:payment-gate`.
// OWNER DECISION: until a real public gateway is configured, checkout must not be publicly reachable, and the QA placeholder
// ("Direct bank transfer", WooCommerce bacs) must never be mistaken for production. Real gateway work (PayPlus / Tranzila) is out of scope here.

/**
 * Gateways that may count as "a real payment gateway". EXPLICITLY EMPTY today: no gateway has been chosen, configured or reviewed.
 * Adding an entry is an owner decision made together with the gateway work (and with the matching list in the Control Plane,
 * scripts/check-launch-blockers.php, constant AICC_LAUNCH_REAL_GATEWAYS). Ids/names are compared case-insensitively.
 */
export const REAL_GATEWAY_ALLOWLIST = [];

/** WooCommerce's offline placeholder methods and their labels; never a real way to pay. */
export const PLACEHOLDER_GATEWAYS = ["bacs", "cheque", "cod", "direct bank transfer", "check payments", "cash on delivery", "bank transfer", "bank_transfer"];

/** Markup that proves a checkout page still offers the placeholder. */
export const PLACEHOLDER_MARKUP = [
  [/payment_method_bacs\b|name=["']payment_method["'][^>]*value=["']bacs["']|value=["']bacs["']/i, "WooCommerce bacs payment method input"],
  [/payment_method_(?:cheque|cod)\b|value=["'](?:cheque|cod)["']/i, "WooCommerce cheque / cash-on-delivery payment method input"],
  [/Direct bank transfer/i, "the label \"Direct bank transfer\""],
  [/wc_payment_method[^"']*payment_method_bacs/i, "bacs payment box"],
  [/QA only: not a real payment/i, "the QA-only placeholder marker (a QA checkout page is in this output)"],
];

/** @returns {string[]} problems for a configured processor value (NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR); [] when it is on the allowlist. */
export function processorProblems(value, allow = REAL_GATEWAY_ALLOWLIST) {
  const v = String(value ?? "").trim();
  if (!v) return ["no payment gateway configured (NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR unset): the plans cannot be paid for yet (the Control Plane checkout only offers its test gateway, \"Direct bank transfer\"); `scripts/check-launch-blockers.php` in the Control Plane checks the real gateway"];
  const low = v.toLowerCase();
  if (PLACEHOLDER_GATEWAYS.includes(low) || /bank transfer|\bbacs\b|\bcheque\b|\bcheck payments\b|cash on delivery|\bcod\b/.test(low)) return [`payment processor "${v}" is a WooCommerce placeholder method (bacs / cheque / cod), not a real gateway`];
  if (!allow.map((x) => x.toLowerCase()).includes(low)) return [`payment processor "${v}" is not on the real-gateway allowlist (scripts/lib/payment-gate.mjs REAL_GATEWAY_ALLOWLIST, empty today): adding a gateway is an owner decision`];
  return [];
}

/** @returns {string[]} findings of the placeholder in a page's markup. */
export function placeholderMarkup(text) {
  return PLACEHOLDER_MARKUP.filter(([re]) => re.test(text)).map(([, label]) => label);
}
