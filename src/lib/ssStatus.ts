/**
 * P37/P39 self-service sign-up status: the ONE place that knows the Control Plane answer, the state -> label/link table and the status fetch.
 * Pure (no React, no process.env): it is imported by the card button (client), by the build (server) and by `scripts/test-selfservice.mjs`, which pins the table below.
 *
 * The truthful states live on the Control Plane /start/ page (open | waitlist | cutoff | paused). The static Site only reads, at run time and best effort,
 *   GET /wp-json/aicc/v1/signup/status   (same origin as the Site: the edge routes /wp-json/ to WordPress, exactly like the request form)
 *   -> { open: boolean, mode: "open" | "waitlist" | "closed_cutoff" | "paused" | "off", plan_options?: [...], cap_remaining?: coarse bucket }
 * and UPGRADES the card to a real link only when the answer says sign-up can be used. Nothing here grants, reserves or promises a place; the Control Plane decides at sign-up time with its own clock.
 *
 * P39 (owner rule: a signup-oriented control NEVER links to a page that may be a 404 and never to the Live Demo): the STATIC state (server HTML, first client render, and every failed or invalid answer) is decided by the
 * BUILD, `NEXT_PUBLIC_AICC_SS_INITIAL`:
 *   coming_soon (the default and the fail-safe: any other value, empty or unset means coming_soon)   PLAIN TEXT "Free trial registration opens soon" (role="status", no button look, no link)
 *   link        (a rebuild made when the owner activates sign-up)                                      LINK {CP}/start/?plan=<id> "Start free trial"
 * Failure rule: ANY answer that is not a complete, valid, consistent status (network error, timeout, non-200, malformed JSON, unknown mode, `open` contradicting `mode`) keeps the build's static state. A visitor is never shown a fake button,
 * a dead button or a link that is not known to work: with the default build a link appears ONLY after the server said open or waitlist.
 */
export const SS_STATUS_PATH = "/wp-json/aicc/v1/signup/status";
export const SS_MODES = ["open", "waitlist", "closed_cutoff", "paused", "off"] as const;
export type SsMode = (typeof SS_MODES)[number];
/** What the control shows: "static" = not asked yet or no valid answer (the build's initial state), otherwise the server mode. */
export type SsView = "static" | SsMode;
/** The build-time initial state (NEXT_PUBLIC_AICC_SS_INITIAL). */
export type SsInitial = "coming_soon" | "link";
export const SS_INITIAL_DEFAULT: SsInitial = "coming_soon";
/** Only the exact string "link" selects the link build; everything else (unset, empty, "LINK", "true", a typo) is the truthful default. */
export function parseSsInitial(v: unknown): SsInitial {
  return v === "link" ? "link" : SS_INITIAL_DEFAULT;
}
export type SsLabelKey = "soon" | "start" | "waitlist" | "closed" | "paused";
export type SsDecision = { kind: "link"; label: SsLabelKey } | { kind: "text"; label: SsLabelKey };

/**
 * THE TABLE (state -> what the visitor sees). `link` = a real <a> to {CP}/start/?plan=<id> (the sign-up page, which shows the matching form or notice); `text` = plain text, never a button, never a link.
 *   static (coming_soon build)  text  "Free trial registration opens soon"   (the build default; also the state of every failed or invalid status answer)
 *   static (link build)         link  "Start free trial"                     (only a build made after sign-up was activated)
 *   open           link  "Start free trial"
 *   waitlist       link  "Join the waitlist"        (the sign-up page shows the waitlist form: a real action)
 *   closed_cutoff  text  "Free trial registration closed"
 *   paused         text  "Free trial registration paused"
 *   off            text  "Free trial registration opens soon"    (the Control Plane switch is not on: the same statement as the initial state, so the card does not change its words when the answer arrives; it promises no date)
 */
export const SS_INITIAL_TABLE: Readonly<Record<SsInitial, SsDecision>> = Object.freeze({
  coming_soon: { kind: "text", label: "soon" },
  link: { kind: "link", label: "start" },
});
export const SS_STATE_TABLE: Readonly<Record<SsMode, SsDecision>> = Object.freeze({
  open: { kind: "link", label: "start" },
  waitlist: { kind: "link", label: "waitlist" },
  closed_cutoff: { kind: "text", label: "closed" },
  paused: { kind: "text", label: "paused" },
  off: { kind: "text", label: "soon" },
});

/** The decision for a view. `static` (and any unknown view) takes the build's initial state; the default build is the truthful plain text. */
export function ssDecision(view: SsView, initial: SsInitial = SS_INITIAL_DEFAULT): SsDecision {
  if (view !== "static" && Object.prototype.hasOwnProperty.call(SS_STATE_TABLE, view)) return SS_STATE_TABLE[view as SsMode];
  return SS_INITIAL_TABLE[initial] ?? SS_INITIAL_TABLE[SS_INITIAL_DEFAULT];
}

/** Does this decision, in this view, use the sign-up URL of the card's plan? Header / Product "Get started" use the same rule: the start page only when sign-up is known (or built) to work. */
export function ssStartsSignup(view: SsView, initial: SsInitial = SS_INITIAL_DEFAULT): boolean {
  return ssDecision(view, initial).kind === "link";
}

/** The mode of a status answer, or null when the answer is not a complete, valid and consistent one (null = keep the static button). */
export function parseSsStatus(body: unknown): SsMode | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  if (typeof o.mode !== "string" || !(SS_MODES as readonly string[]).includes(o.mode)) return null;
  const mode = o.mode as SsMode;
  if ("open" in o && o.open !== (mode === "open")) return null; // `open` must agree with `mode` (an inconsistent answer is not trusted)
  return mode;
}

/** GET the status with an injectable fetch (tests) and a timeout. Resolves to a mode, or null on ANY failure. Never throws. */
export async function fetchSsMode(fetchFn: typeof fetch = fetch, timeoutMs = 5000): Promise<SsMode | null> {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(SS_STATUS_PATH, { method: "GET", credentials: "omit", cache: "no-store", headers: { Accept: "application/json" }, signal: ctl?.signal });
    if (!res || res.status !== 200) return null;
    return parseSsStatus(await res.json());
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---- the tiny shared store: ONE request per page load, however many buttons the page has ----
type Listener = () => void;
let view: SsView = "static";
let started = false;
const listeners = new Set<Listener>();
export const ssSubscribe = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const ssSnapshot = (): SsView => view;
export const ssServerSnapshot = (): SsView => "static";
/** Start the single status request (idempotent; a no-op outside a browser). The view changes only on a valid answer. */
export function ssStart(fetchFn?: typeof fetch): Promise<void> {
  if (started || typeof window === "undefined") return Promise.resolve();
  started = true;
  return fetchSsMode(fetchFn).then((m) => { if (m && m !== view) { view = m; listeners.forEach((l) => l()); } });
}
/** Test seam: forget the answer and allow a new request. */
export function ssReset(): void { view = "static"; started = false; }
