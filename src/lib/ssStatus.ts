/**
 * P37 self-service sign-up status: the ONE place that knows the Control Plane answer, the state -> label/link table and the status fetch.
 * Pure (no React, no process.env): it is imported by the card button (client), by the build (server) and by `scripts/test-selfservice.mjs`, which pins the table below.
 *
 * The truthful states live on the Control Plane /start/ page (open | waitlist | cutoff | paused). The static Site only reads, at run time and best effort,
 *   GET /wp-json/aicc/v1/signup/status   (same origin as the Site: the edge routes /wp-json/ to WordPress, exactly like the request form)
 *   -> { open: boolean, mode: "open" | "waitlist" | "closed_cutoff" | "paused" | "off", plan_options?: [...], cap_remaining?: coarse bucket }
 * and switches the card button to the truthful label. Nothing here grants, reserves or promises a place; the Control Plane decides at sign-up time with its own clock.
 *
 * Failure rule: ANY answer that is not a complete, valid, consistent status (network error, timeout, non-200, malformed JSON, unknown mode, `open` contradicting `mode`) keeps the STATIC button: a link to
 * /start/, which renders the truthful state itself. A visitor is never shown a fake button, a dead button or a link that cannot work from a guess.
 */
export const SS_STATUS_PATH = "/wp-json/aicc/v1/signup/status";
export const SS_MODES = ["open", "waitlist", "closed_cutoff", "paused", "off"] as const;
export type SsMode = (typeof SS_MODES)[number];
/** What the button shows: "static" = not asked yet or no valid answer (the build-time button), otherwise the server mode. */
export type SsView = "static" | SsMode;
export type SsLabelKey = "start" | "waitlist" | "closed" | "paused" | "notOpen";
export type SsDecision = { kind: "link"; label: SsLabelKey } | { kind: "text"; label: SsLabelKey };

/**
 * THE TABLE (state -> what the visitor sees). `link` = a real <a> to {CP}/start/?plan=<id> (the sign-up page, which shows the matching form or notice); `text` = plain text, never a button, never a link.
 *   static / open  link  "Start free trial"          (the page decides at submit time; the static build cannot know better)
 *   waitlist       link  "Join the waitlist"         (the sign-up page shows the waitlist form: a real action)
 *   closed_cutoff  text  "Free trial registration closed"
 *   paused         text  "Free trial registration paused"
 *   off            text  "Free trial registration is not open"   (the route may not exist: no link)
 */
export const SS_STATE_TABLE: Readonly<Record<SsView, SsDecision>> = Object.freeze({
  static: { kind: "link", label: "start" },
  open: { kind: "link", label: "start" },
  waitlist: { kind: "link", label: "waitlist" },
  closed_cutoff: { kind: "text", label: "closed" },
  paused: { kind: "text", label: "paused" },
  off: { kind: "text", label: "notOpen" },
});

export function ssDecision(view: SsView): SsDecision {
  return SS_STATE_TABLE[view] ?? SS_STATE_TABLE.static;
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
