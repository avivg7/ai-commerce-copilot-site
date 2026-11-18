/**
 * The PAID capacity string of a plan ("Paid plan: 1 store" / "Paid plan: up to 3 stores"): ONE helper for the plan cards and the plan finder, so the two can never say different things.
 * The store count comes from src/data/plans.ts (the caller passes `plan.stores`); `1` only selects the singular string.
 */
export function paidCapacity(plan: { paidOne: string; paidMany: string }, stores: number): string {
  return stores === 1 ? plan.paidOne : plan.paidMany.replace("{n}", String(stores));
}
