/**
 * THE one place plan prices and store limits live.
 * Accepted values: Solo $99 / 1 store, Studio $199 / up to 3, Agency $499 / up to 10 (USD, per year, per plan).
 * `npm run pricing:check` verifies these against the accepted values and the Control Plane bootstrap file.
 */
export const PLANS = [
  { id: "solo", price: 99, stores: 1, featured: false },
  { id: "studio", price: 199, stores: 3, featured: true },
  { id: "agency", price: 499, stores: 10, featured: false },
] as const;

export type PlanId = (typeof PLANS)[number]["id"];

export const CURRENCY = "USD";
export const TERM_DAYS = 365;
export const GUARANTEE_DAYS = 14;
/** Months the history import looks back. */
export const IMPORT_MONTHS = 24;
/** Months operational data MAY be kept after access ends (draft policy; see legalReview flags). */
export const RETENTION_MONTHS = 12;

export function planById(id: PlanId) {
  return PLANS.find((p) => p.id === id)!;
}

/** "$199" in every language: the price is USD everywhere. */
export function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: CURRENCY,
    maximumFractionDigits: 0,
  }).format(amount);
}
