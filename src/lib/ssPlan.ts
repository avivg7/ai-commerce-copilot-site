import { planFromSearch } from "./ssJourney";
import type { PlanId } from "@/data/plans";

/**
 * P41: the plan preselection of the journey page, kept in the URL (`?plan=solo|studio|agency`, validated by `planFromSearch`: anything else is ignored). The URL is the only state: a tiny external store over `location.search`
 * (client only; the server snapshot is "no plan"), so the plan chips and the primary action stay in step and a reload or a shared link keeps the choice. No storage, no cookie, no request.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
export const planSnapshot = (): PlanId | null => (typeof window === "undefined" ? null : planFromSearch(window.location.search));
export const planServerSnapshot = (): PlanId | null => null;
export function planSubscribe(l: Listener): () => void {
  listeners.add(l);
  if (typeof window !== "undefined") window.addEventListener("popstate", l);
  return () => { listeners.delete(l); if (typeof window !== "undefined") window.removeEventListener("popstate", l); };
}
/** Select a plan: only `plan` is written (every other parameter is dropped), the hash is kept, the history gets no new entry. */
export function setPlan(plan: PlanId): void {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  u.search = `?plan=${plan}`;
  window.history.replaceState(window.history.state, "", u.toString());
  listeners.forEach((l) => l());
}
