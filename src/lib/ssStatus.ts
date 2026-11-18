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

/**
 * P39 round 2: the registration cutoff of the Control Plane (2026-12-24T00:00:00Z = unix 1798070400, `AICC_LM_Trial::REGISTRATION_CUTOFF_UNIX`; a registration is accepted only while the clock is BEFORE it). The browser clock is compared with this
 * absolute UTC constant (no request, no time zone, like the launch-offer end script): from that instant every control is the plain text "Free trial registration closed", whatever the build or the status answer says
 * (a stale page, a cached page, a status answer of open / waitlist that arrives late). `scripts/test-selfservice.mjs` pins it to src/i18n/eaTokens.ts SS_REG_CLOSE_UTC_MS.
 */
export const SS_REG_CLOSE_MS = 1798070400000;
export function ssRegClosed(now: number = Date.now()): boolean { return now >= SS_REG_CLOSE_MS; }
const CLOSED_BY_CLOCK: SsDecision = Object.freeze({ kind: "text", label: "closed" });

/** The decision for a view. `static` (and any unknown view) takes the build's initial state; the default build is the truthful plain text. `regClosed` (the clock is at or past the registration cutoff) overrides everything with the closed text. */
export function ssDecision(view: SsView, initial: SsInitial = SS_INITIAL_DEFAULT, regClosed = false): SsDecision {
  if (regClosed) return CLOSED_BY_CLOCK;
  if (view !== "static" && Object.prototype.hasOwnProperty.call(SS_STATE_TABLE, view)) return SS_STATE_TABLE[view as SsMode];
  return SS_INITIAL_TABLE[initial] ?? SS_INITIAL_TABLE[SS_INITIAL_DEFAULT];
}

/** Does this decision, in this view, use the sign-up URL of the card's plan? Header / Product "Get started" use the same rule: the start page only when sign-up is known (or built) to work. */
export function ssStartsSignup(view: SsView, initial: SsInitial = SS_INITIAL_DEFAULT, regClosed = false): boolean {
  return ssDecision(view, initial, regClosed).kind === "link";
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

// ---- the tiny shared store: ONE request per full page load, however many controls the page has; a module-level in-memory cache (no storage, no cookie) so client-side navigation does not ask again within the TTL ----
type Listener = () => void;
/** How long a status answer (or a failed attempt) is reused by client-side navigation. One uncached WordPress request per full page load is the capacity cost; docs/cutover/p39-marketing.md has the note. */
export const SS_STATUS_TTL_MS = 30_000;
let view: SsView = "static";
let fetchedAt: number | null = null;
let lastValidAt: number | null = null;
let failures = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<Listener>();
const clockListeners = new Set<Listener>();
let wakeInstalled = false;
/**
 * P40 stale-view limits: a valid answer other than "static" is kept through single failed answers (a hiccup changes nothing), but not for the whole session: after SS_STALE_AFTER_FAILURES failed answers in a row, or when
 * SS_STALE_AFTER_MS have passed since the last VALID answer, the control returns to the build's static state (never to "open": a failed or invalid answer never upgrades anything).
 */
export const SS_STALE_AFTER_FAILURES = 5;
export const SS_STALE_AFTER_MS = 5 * SS_STATUS_TTL_MS;
/** Re-check when the page becomes visible or gets focus (a laptop that slept across the cutoff, a visitor waiting on "opens soon"): the TTL cache still decides whether a request is made; no polling, no timer. */
function installWake(): void {
  if (wakeInstalled || typeof window === "undefined" || typeof document === "undefined") return;
  wakeInstalled = true;
  const wake = () => { if (document.visibilityState === "hidden") return; void ssStart(); clockListeners.forEach((l) => l()); };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
}
export const ssSubscribe = (l: Listener) => { installWake(); listeners.add(l); return () => { listeners.delete(l); }; };
export const ssSnapshot = (): SsView => view;
export const ssServerSnapshot = (): SsView => "static";
/**
 * Start the status request (a no-op outside a browser). Concurrent callers share ONE request; a caller within SS_STATUS_TTL_MS of the last attempt (answered or failed) gets the cached view and no request.
 * The view changes on a valid answer; a failed answer changes nothing until the stale limits above are reached, and then only back to "static".
 */
export function ssStart(fetchFn?: typeof fetch, now: () => number = Date.now): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (inflight) return inflight;
  const t = now();
  if (fetchedAt !== null && t - fetchedAt < SS_STATUS_TTL_MS) return Promise.resolve();
  fetchedAt = t;
  inflight = fetchSsMode(fetchFn).then((m) => {
    if (m) {
      failures = 0; lastValidAt = t;
      if (m !== view) { view = m; listeners.forEach((l) => l()); }
    } else {
      failures++;
      if (view !== "static" && (failures >= SS_STALE_AFTER_FAILURES || (lastValidAt !== null && t - lastValidAt >= SS_STALE_AFTER_MS))) { view = "static"; listeners.forEach((l) => l()); }
    }
  }).finally(() => { inflight = null; });
  return inflight;
}
/** Test seam: forget the answer and the cache. */
export function ssReset(): void { view = "static"; fetchedAt = null; lastValidAt = null; failures = 0; inflight = null; }

// ---- the registration cutoff by the browser clock (see SS_REG_CLOSE_MS) ----
export const ssRegClosedSnapshot = (): boolean => ssRegClosed();
export const ssRegClosedServerSnapshot = (): boolean => false;
/** Notifies once at the cutoff instant for a page that stays open across it (a timer on the absolute constant; nothing is requested). */
export function ssRegClosedSubscribe(l: Listener): () => void {
  if (typeof window === "undefined") return () => {};
  installWake();
  clockListeners.add(l); // woken by a visibilitychange / focus too (a slept page whose timer was late)
  const wait = SS_REG_CLOSE_MS - Date.now();
  const id = wait > 0 && wait <= 2_000_000_000 ? setTimeout(l, wait + 50) : null;
  return () => { clockListeners.delete(l); if (id !== null) clearTimeout(id); };
}
