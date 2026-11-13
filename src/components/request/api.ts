/**
 * The browser side of the request-access intake contract (the Control Plane routes of `aicc/v1`, same origin: see the contract file INTAKE-CONTRACT.md in the P32 evidence).
 * This module is the ONLY place that names a URL of the API. It never reads or shows a server-supplied message: every outcome is reduced to a small closed set, and the
 * pages map each outcome to a fixed, generic text. Nothing is stored (no localStorage, no cookie, no analytics).
 */
export const API_STATUS = "/wp-json/aicc/v1/access-requests/status";
export const API_CREATE = "/wp-json/aicc/v1/access-requests";
export const API_CONFIRM = "/wp-json/aicc/v1/access-requests/confirm";
export const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const HEADERS = { "Content-Type": "application/json", "X-AICC-Request": "1" } as const;

export type StatusResult = { open: false } | { open: true; siteKey: string; formToken: string };

/** GET /status. Closed whenever the answer is not a complete, valid "open" (unreachable, non-200, malformed, missing key or token): the form is inert unless everything is present. */
export async function fetchStatus(signal?: AbortSignal): Promise<StatusResult> {
  try {
    const res = await fetch(API_STATUS, { method: "GET", credentials: "omit", cache: "no-store", headers: { Accept: "application/json" }, signal });
    if (res.status !== 200) return { open: false };
    const j: unknown = await res.json();
    if (!j || typeof j !== "object") return { open: false };
    const o = j as Record<string, unknown>;
    if (o.open === true && typeof o.turnstile_site_key === "string" && o.turnstile_site_key && typeof o.form_token === "string" && o.form_token) {
      return { open: true, siteKey: o.turnstile_site_key, formToken: o.form_token };
    }
    return { open: false };
  } catch {
    return { open: false };
  }
}

export type CreateBody = {
  email: string;
  store_url: string;
  plan: "solo" | "studio" | "agency";
  operator_confirmed: true;
  terms_accepted: true;
  lang: "en" | "he" | "es" | "ru";
  turnstile_token: string;
  form_token: string;
  website: string;
};
/** The closed set of outcomes of POST /access-requests: nothing from the response body is ever surfaced. */
export type CreateOutcome = "received" | "busy" | "closed" | "bot" | "invalid" | "network" | "toobig";

/** The outcome plus the seconds the server asked us to wait (Retry-After on a 429, capped; 0 when absent or not a plain number). */
export type CreateResult = { outcome: CreateOutcome; retryAfter: number };
const waitOf = (res: Response): number => { const v = Number(res.headers.get("Retry-After")); return Number.isFinite(v) && v > 0 ? Math.min(Math.ceil(v), 900) : 0; };

/** The edge refuses a body above 4096 bytes (and the contract above 2048): the page measures the UTF-8 size itself and never sends what cannot be accepted. */
export const MAX_BODY_BYTES = 4096;
export const bodyBytes = (payload: string) => new TextEncoder().encode(payload).length;

export async function postCreate(body: CreateBody): Promise<CreateResult> {
  try {
    const payload = JSON.stringify(body);
    if (bodyBytes(payload) > MAX_BODY_BYTES) return { outcome: "toobig", retryAfter: 0 };
    const res = await fetch(API_CREATE, { method: "POST", credentials: "omit", cache: "no-store", headers: HEADERS, body: payload });
    if (res.status === 202) return { outcome: "received", retryAfter: 0 };
    if (res.status === 429) return { outcome: "busy", retryAfter: waitOf(res) };
    if (res.status === 503) return { outcome: "closed", retryAfter: 0 };
    if (res.status === 400) {
      // verification_failed (bot check) is the one 400 the visitor can act on; every other 400 is one generic text. The body is read only to tell these two apart, never shown.
      let bot = false;
      try {
        const j: unknown = await res.json();
        // the contract names the 400 codes (`invalid_request`, `verification_failed`) but not the JSON key that carries them; the confirm route uses `status`, so `status` is expected and `error`/`code` are accepted too
        if (j && typeof j === "object") bot = ["status", "error", "code"].some((k) => (j as Record<string, unknown>)[k] === "verification_failed");
      } catch { /* no body */ }
      return { outcome: bot ? "bot" : "invalid", retryAfter: 0 };
    }
    return { outcome: "invalid", retryAfter: 0 };
  } catch {
    return { outcome: "network", retryAfter: 0 };
  }
}

/** The closed set of outcomes of POST /confirm: "done" covers a valid AND an invalid/expired/used token (one neutral text for both); "network" lets the visitor retry. */
export type ConfirmOutcome = "done" | "unavailable" | "network";
export async function postConfirm(token: string): Promise<ConfirmOutcome> {
  try {
    const res = await fetch(API_CONFIRM, { method: "POST", credentials: "omit", cache: "no-store", headers: HEADERS, body: JSON.stringify({ token }) });
    // 200 (verified) and 400 (invalid_or_expired) read the same to the visitor; 429 (throttle) and 503 (the Control Plane says: temporarily unavailable, NOT an invalid token) and any other answer are retryable
    // the Control Plane says 503 means temporarily unavailable (switch off, schema not ready), never "bad token": it is its own outcome
    return res.status === 200 || res.status === 400 ? "done" : "unavailable";
  } catch {
    return "network";
  }
}
