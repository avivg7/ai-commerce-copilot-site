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
 * A build made at or after the END IGNORES the switch (mode OFF), so a late deployment of an old configuration cannot publish an expired campaign.
 * A page that is LOADED (from the network, a CDN or a browser cache) after the end is switched to the "ended" presentation by a tiny inline script (see EA_HEAD_SCRIPT);
 * a page left open across the instant keeps its view until it is reloaded (display only: access itself ends on the servers at the instant).
 *
 * EXTENSION (Production 21). The initial published end is the cutoff below. The Control Plane can, by an operator decision (never automatic), move EVERY Early Access store to one of
 * two published later ends (EA_EXTENSION_STEPS). The Site follows by REBUILD, never by itself: a build says "extended" only when it is given BOTH
 *   NEXT_PUBLIC_AICC_EA_EXTENSION_STEP  exactly "1" or "2" (anything else is step 0, the initial end), and
 *   NEXT_PUBLIC_AICC_EA_EXTENSION_REF   the operator's decision reference (3-64 characters; without it the step is 0 and the build keeps the initial end).
 * An extended OPEN build also closes the request controls at the INITIAL end (see EA_INTAKE_CLOSES): the Control Plane takes no new request after it.
 * EA_END_UTC_MS is the one instant that means "the end" everywhere (build clock, head script, strike-through, every band). Rebuild only AFTER the Control Plane `extend` has run and
 * been verified: a Site that announces a later date than the product delivers is the harmful order (docs/cutover/early-access.md section 7b).
 */

/** 2027-01-01T00:00:00 Asia/Jerusalem, in UTC milliseconds. */
import type { Locale } from "@/i18n/config";
import { getStartedUrl, localizeAccountUrl, type PlanId } from "./site";

/** The INITIAL published end (unix 1798754400 = the Control Plane CUTOFF_UNIX). An extension moves the end to a later step below; it never touches this constant. */
export const EA_CUTOFF_UTC_MS = Date.UTC(2026, 11, 31, 22, 0, 0);
/** The same instant, for machine-readable markup. */
export const EA_CUTOFF_ISO_UTC = "2026-12-31T22:00:00Z";
/**
 * The two published extension ends, in UTC milliseconds (index 0 = step 1): 2027-02-01 00:00 and 2027-03-01 00:00 Asia/Jerusalem (= 2027-01-31 22:00 UTC and 2027-02-28 22:00 UTC).
 * Constants, never input: nothing but these two instants can ever be an end. `npm run ea:check` re-derives both from the IANA database and compares them with the Control Plane table.
 */
export const EA_EXTENSION_STEPS: readonly [number, number] = [Date.UTC(2027, 0, 31, 22, 0, 0), Date.UTC(2027, 1, 28, 22, 0, 0)];
/** Human wording is fixed in the dictionaries (`ea.*`, see src/i18n/ea/dates.ts); these are the Israel calendar facts those strings state per step (0 = initial), checked by `npm run ea:check`. */
export const EA_STEP_DAYS: readonly { last: string; end: string }[] = [
  { last: "2026-12-31", end: "2027-01-01" },
  { last: "2027-01-31", end: "2027-02-01" },
  { last: "2027-02-28", end: "2027-03-01" },
];
/** The same three instants (index = step) as ISO strings, for machine-readable markup; `ea:check` compares each with its millisecond constant. */
export const EA_STEP_ISO_UTC: readonly string[] = ["2026-12-31T22:00:00Z", "2027-01-31T22:00:00Z", "2027-02-28T22:00:00Z"];
export const EA_LAST_DAY = EA_STEP_DAYS[0].last;
export const EA_END_DAY = EA_STEP_DAYS[0].end;
export const EA_TIME_ZONE = "Asia/Jerusalem";

export type EaStep = 0 | 1 | 2;
/** The decision reference an extension needs: 3 to 64 characters, letters, digits and . _ : / # - only (it is an operator's reference, never public text). */
export const EA_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,63}$/;
/** A reference that is obviously not a decision reference (a placeholder, or one character repeated): refused, so a template value can never make a build "extended". */
export function eaRefIsPlaceholder(ref: string): boolean {
  return /^(todo|tbd|tba|xxx+|test|testing|placeholder|n\/a|na|none|null|ref|reference|changeme|foo|bar|abc|abcd|1234|123456)$/i.test(ref) || /^(.)\1+$/.test(ref);
}
/**
 * The extension step a build is allowed to claim: 1 or 2 only when the raw step is EXACTLY "1" or "2" AND a valid decision reference is given; anything else is 0 (the initial end).
 * `rejected` says why a requested step was ignored (launch:check reports it).
 */
export function parseEaExtension(rawStep: string | undefined, rawRef: string | undefined): { step: EaStep; requested: boolean; rejected: string } {
  const requested = rawStep !== undefined && rawStep !== "";
  if (rawStep !== "1" && rawStep !== "2") return { step: 0, requested, rejected: requested ? `the step must be exactly "1" or "2" (got "${rawStep}")` : "" };
  if (typeof rawRef !== "string" || !EA_REF_PATTERN.test(rawRef)) return { step: 0, requested, rejected: "an extension needs NEXT_PUBLIC_AICC_EA_EXTENSION_REF (the operator's decision reference, 3-64 characters)" };
  if (eaRefIsPlaceholder(rawRef)) return { step: 0, requested, rejected: "NEXT_PUBLIC_AICC_EA_EXTENSION_REF looks like a placeholder (todo, tbd, xxx, test, placeholder, n/a ...): give the real decision reference" };
  return { step: rawStep === "1" ? 1 : 2, requested, rejected: "" };
}
/** The end instant for a step (0 = the initial cutoff). */
export function eaEndForStep(step: EaStep): number {
  return step === 1 ? EA_EXTENSION_STEPS[0] : step === 2 ? EA_EXTENSION_STEPS[1] : EA_CUTOFF_UTC_MS;
}

export type EaMode = "off" | "announce" | "open";

/** Exactly "announce" or "open"; anything else (including "true", "1", "OPEN", " open") is OFF. */
export function parseEaMode(raw: string | undefined): EaMode {
  return raw === "announce" || raw === "open" ? raw : "off";
}

/** True at or after the END (`endMs`, by default the end of THIS build; inclusive: at 22:00:00.000 UTC the campaign is over). A broken clock (NaN) counts as over. */
export function eaIsOver(nowMs: number, endMs: number = EA_END_UTC_MS): boolean {
  return !(nowMs < endMs);
}

/** What a build or page made at `nowMs` shows for a requested mode. */
export function eaModeAt(requested: EaMode, nowMs: number, endMs: number = EA_END_UTC_MS): EaMode {
  return eaIsOver(nowMs, endMs) ? "off" : requested;
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
const EXT = parseEaExtension(process.env.NEXT_PUBLIC_AICC_EA_EXTENSION_STEP, process.env.NEXT_PUBLIC_AICC_EA_EXTENSION_REF);
/** The extension step of THIS build (0 = the initial published end). */
export const EA_EXTENSION_STEP: EaStep = EXT.step;
/** An extension step was asked for in the environment (valid or not) and the reason it was ignored, if it was (`launch:check` reports both). */
export const EA_EXTENSION_REQUESTED = EXT.requested;
export const EA_EXTENSION_REJECTED = EXT.rejected;
export const EA_EXTENDED = EA_EXTENSION_STEP !== 0;
/** THE END of this build: the instant of its step, or the initial cutoff. Everything that means "the end" reads this and nothing else. */
export const EA_END_UTC_MS = eaEndForStep(EA_EXTENSION_STEP);
export const EA_END_ISO_UTC = EA_STEP_ISO_UTC[EA_EXTENSION_STEP];
/** The mode of THIS build. OFF unless the switch is "announce" or "open" and the build is made before the end. */
export const EA_MODE: EaMode = eaModeAt(EA_REQUESTED, EA_BUILD_MS, EA_END_UTC_MS);
/** The switch is set but this build is at or past the end: the campaign was NOT published (`launch:check` reports it). */
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
 * Runs in <head> before first paint on every page of an Early Access build (and on no other). If the visitor's clock says the end has passed it marks
 * the document, and the CSS then hides every `data-ea-live` block and shows the `data-ea-after` blocks. It compares absolute UTC milliseconds: no time zone,
 * no locale. A visitor with a wrong device clock only changes what THEY see; entitlement is decided on the servers.
 */
export const EA_HEAD_SCRIPT = EA_EXTENDED && EA_OPEN
  ? `try{if(Date.now()>=${EA_END_UTC_MS})document.documentElement.setAttribute("data-ea-over","");if(Date.now()>=${EA_CUTOFF_UTC_MS})document.documentElement.setAttribute("data-ea-closed","")}catch(e){}`
  : `try{if(Date.now()>=${EA_END_UTC_MS})document.documentElement.setAttribute("data-ea-over","")}catch(e){}`;
/**
 * In an extended OPEN build new requests close at the INITIAL end (the Control Plane grants only before it, whatever extension is in effect): from that instant until the extended end
 * the page offers no request action and says the extension is for stores already in Early Access (`data-ea-closed`, set by the same fixed-instant head script).
 */
export const EA_INTAKE_CLOSES = EA_EXTENDED && EA_OPEN;


/** The Early Access destination in the page language (OPEN mode only); `plan` adds the plan hint like the normal plan buttons. */
export function eaUrl(locale: Locale, plan?: PlanId): string {
  const base = EA_URL_OVERRIDE ? localizeAccountUrl(EA_URL_OVERRIDE, locale) : getStartedUrl(locale);
  const hash = base.indexOf("#");
  const head = hash === -1 ? base : base.slice(0, hash);
  const frag = hash === -1 ? "" : base.slice(hash);
  const q = [...(EA_URL_OVERRIDE ? [] : ["offer=early-access"]), ...(plan ? [`plan=${plan}`] : [])];
  return q.length ? `${head}${head.includes("?") ? "&" : "?"}${q.join("&")}${frag}` : base;
}
