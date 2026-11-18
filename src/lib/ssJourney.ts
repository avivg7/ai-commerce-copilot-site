import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import type { PlanId } from "@/data/plans";

/** The three plan ids (src/data/plans.ts PLANS order); the only values a `?plan=` can carry. */
export const JOURNEY_PLAN_IDS: readonly PlanId[] = ["solo", "studio", "agency"];

/**
 * P41: the self-service journey page (`/get-started/`, a Site-exported page that exists ONLY in a self-service build, src/lib/requestRoutes.ts). Pure helpers, no env and no DOM:
 * the pricing controls (client), the header and the page itself build the same link. The plan is a plain preselection (`?plan=solo|studio|agency`): any other value, and any other
 * query parameter, is ignored and never forwarded.
 */
export const JOURNEY_SLUG = "get-started";

/** Path inside the site, WITHOUT basePath: English at the root, the other languages under /<locale>/. */
export function journeyPath(locale: Locale): string {
  return `${locale === DEFAULT_LOCALE ? "" : `/${locale}`}/${JOURNEY_SLUG}/`;
}

/** The plan a query string names (`?plan=studio`), or null: exactly one of the three plan ids, case-sensitive; unknown parameters and unknown values are ignored. */
export function planFromSearch(search: string): PlanId | null {
  if (typeof search !== "string" || search.length > 2048) return null;
  const v = new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("plan");
  return v !== null && (JOURNEY_PLAN_IDS as readonly string[]).includes(v) ? (v as PlanId) : null;
}

/** `path` with the plan preselection appended (a plan-less call returns the path unchanged). */
export function withPlanParam(path: string, plan?: PlanId | null): string {
  return plan ? `${path}?plan=${plan}` : path;
}
