/**
 * EARLY ACCESS (Production 20): a fixed-calendar promotional access period, NOT a free trial and NOT a free plan.
 * Every Early Access entitlement ends at the same absolute instant, whatever the sign-up date:
 *   2027-01-01 00:00:00 Asia/Jerusalem = 2026-12-31 22:00:00 UTC (Israel is UTC+2 in winter). The last included moment is 31 December 2026, Israel time.
 * The instant is a UTC millisecond constant. It never depends on a visitor's time zone: the browser compares Date.now() with the constant, and
 * `scripts/test-early-access.mjs` re-derives it from the IANA time-zone database (Intl) under several process time zones and fails if they disagree.
 *
 * This file only decides what the PAGES SAY. Whether a store really gets access is decided by the Control Plane (the entitlement, with the same
 * constant) and the Backend/Plugin clocks: nothing on this static site grants, extends or removes access.
 *
 * Build-time switch NEXT_PUBLIC_AICC_EARLY_ACCESS (a separate switch from NEXT_PUBLIC_AICC_COMMERCE_OPEN: the campaign never opens paid checkout):
 *   unset / anything else  OFF       the site is exactly as before (nothing about Early Access is rendered)
 *   "announce"             ANNOUNCE  the offer and the end date are shown; the buttons say Early Access "opens soon" (nothing to sign up for yet)
 *   "open"                 OPEN      the buttons lead to the Early Access sign-up (the Control Plane flow must exist and be approved first: `npm run launch:check`)
 * A build made at or after the cutoff IGNORES the switch (mode OFF), so a late deployment of an old configuration cannot publish an expired campaign.
 * A page that is LOADED (from the network, a CDN or a browser cache) after the cutoff is switched to the "ended" presentation by a tiny inline script (see EA_HEAD_SCRIPT);
 * a page left open across the instant keeps its view until it is reloaded (display only: access itself ends on the servers at the instant).
 */

/** 2027-01-01T00:00:00 Asia/Jerusalem, in UTC milliseconds. */
import type { Locale } from "@/i18n/config";
import { getStartedUrl, localizeAccountUrl, type PlanId } from "./site";

export const EA_CUTOFF_UTC_MS = Date.UTC(2026, 11, 31, 22, 0, 0);
/** The same instant, for machine-readable markup. */
export const EA_CUTOFF_ISO_UTC = "2026-12-31T22:00:00Z";
/** Human wording is fixed in the dictionaries (`ea.*`); these are the calendar facts those strings state, checked by `npm run ea:check`. */
export const EA_LAST_DAY = "2026-12-31";
export const EA_END_DAY = "2027-01-01";
export const EA_TIME_ZONE = "Asia/Jerusalem";

export type EaMode = "off" | "announce" | "open";

/** Exactly "announce" or "open"; anything else (including "true", "1", "OPEN", " open") is OFF. */
export function parseEaMode(raw: string | undefined): EaMode {
  return raw === "announce" || raw === "open" ? raw : "off";
}

/** True at or after the cutoff (inclusive: at 22:00:00.000 UTC the campaign is over). */
export function eaIsOver(nowMs: number): boolean {
  return !(nowMs < EA_CUTOFF_UTC_MS);
}

/** What a build or page made at `nowMs` shows for a requested mode. */
export function eaModeAt(requested: EaMode, nowMs: number): EaMode {
  return eaIsOver(nowMs) ? "off" : requested;
}

/**
 * Test seam: AICC_BUILD_NOW_MS pins the build clock, but ONLY together with AICC_EA_TEST_SEAM=1, so a leftover variable in a release environment can never make a
 * late build publish an expired campaign. `npm run launch:check` fails if either variable is set.
 */
function buildNow(): number {
  const pinned = process.env.AICC_BUILD_NOW_MS;
  if (process.env.AICC_EA_TEST_SEAM === "1" && pinned && /^\d{10,14}$/.test(pinned)) return Number(pinned);
  return Date.now();
}

export const EA_REQUESTED: EaMode = parseEaMode(process.env.NEXT_PUBLIC_AICC_EARLY_ACCESS);
export const EA_BUILD_MS = buildNow();
/** The mode of THIS build. OFF unless the switch is "announce" or "open" and the build is made before the cutoff. */
export const EA_MODE: EaMode = eaModeAt(EA_REQUESTED, EA_BUILD_MS);
/** The switch is set but this build is at or past the cutoff: the campaign was NOT published (`launch:check` reports it). */
export const EA_EXPIRED_REQUEST = EA_REQUESTED !== "off" && EA_MODE === "off";
export const EA_ON = EA_MODE !== "off";
/**
 * Build-time sub-switch NEXT_PUBLIC_AICC_EA_STRIKE=on: show the plan price STRUCK THROUGH next to the free offer. Default OFF: the same price is shown plainly as "Planned price when purchases open".
 * A strike-through reads as a reduction from an established price, and no plan has ever been sold; turn it on only when counsel has approved it (docs/cutover/early-access.md).
 */
export const EA_STRIKE = process.env.NEXT_PUBLIC_AICC_EA_STRIKE === "on";
export const EA_OPEN = EA_MODE === "open";

/**
 * Where the Early Access button leads in OPEN mode: the Control Plane sign-up for Early Access (an English base, localised like the account URL).
 * Default: the account page with an offer hint. It is a placeholder for a flow that is not built or approved yet; `npm run launch:check` fails in OPEN mode
 * until NEXT_PUBLIC_AICC_EARLY_ACCESS_URL names the real destination.
 */
export const EA_URL_OVERRIDE = process.env.NEXT_PUBLIC_AICC_EARLY_ACCESS_URL || "";

/**
 * Runs in <head> before first paint on every page of an Early Access build (and on no other). If the visitor's clock says the cutoff has passed it marks
 * the document, and the CSS then hides every `data-ea-live` block and shows the `data-ea-after` blocks. It compares absolute UTC milliseconds: no time zone,
 * no locale. A visitor with a wrong device clock only changes what THEY see; entitlement is decided on the servers.
 */
export const EA_HEAD_SCRIPT = `try{if(Date.now()>=${EA_CUTOFF_UTC_MS})document.documentElement.setAttribute("data-ea-over","")}catch(e){}`;


/** The Early Access destination in the page language (OPEN mode only); `plan` adds the plan hint like the normal plan buttons. */
export function eaUrl(locale: Locale, plan?: PlanId): string {
  const base = EA_URL_OVERRIDE ? localizeAccountUrl(EA_URL_OVERRIDE, locale) : getStartedUrl(locale);
  const hash = base.indexOf("#");
  const head = hash === -1 ? base : base.slice(0, hash);
  const frag = hash === -1 ? "" : base.slice(hash);
  const q = [...(EA_URL_OVERRIDE ? [] : ["offer=early-access"]), ...(plan ? [`plan=${plan}`] : [])];
  return q.length ? `${head}${head.includes("?") ? "&" : "?"}${q.join("&")}${frag}` : base;
}
