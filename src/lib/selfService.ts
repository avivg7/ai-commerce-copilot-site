import type { Locale } from "@/i18n/config";
import { EA_BUILD_MS, EA_END_UTC_MS, eaIsOver } from "./earlyAccess";
import { SITE_URL, localizeAccountUrl, type PlanId } from "./site";
import { parseSsInitial, SS_REG_CLOSE_MS } from "./ssStatus";

/**
 * P37 SELF-SERVICE FREE TRIAL build switch, ORTHOGONAL to the launch-offer mode (NEXT_PUBLIC_AICC_EARLY_ACCESS=off|announce|open|verify):
 *   NEXT_PUBLIC_AICC_SELFSERVICE   exactly "on" = every plan-card control, closing band, the header "Get started" and the Product "Get started" are SIGN-UP aware: they show the build's initial state (NEXT_PUBLIC_AICC_SS_INITIAL, default
 *                                  coming_soon = plain text "Free trial registration opens soon") and are upgraded at run time to the Control Plane sign-up
 *                                  `{CP}/start/?plan=<solo|studio|agency>` (language-prefixed: /he/start/ ...) only when GET /wp-json/aicc/v1/signup/status says open or waitlist. Anything else (including "true", "1", "ON") = OFF (the default): the build is byte-for-byte
 *                                  the P36 export for the same environment (proved by `node scripts/export-hash.mjs`).
 * The Hero keeps "Try Live Demo" (#demo, primary) and "See Pricing" in every mode; a card NEVER links to #demo or to /request-access/ while this is on. "Sign in" stays on the account page (a returning customer signs in, not up).
 * The Control Plane /start/ page renders the truthful state (open | waitlist | cutoff | paused); the static card only reads GET /wp-json/aicc/v1/signup/status at run time (src/lib/ssStatus.ts).
 * DEPLOY ORDER: publish a self-service build only AFTER the Control Plane serves /start/ (the route is a 404 while the Control Plane switch is off); `npm run launch:check` reminds the operator.
 * A build made at or after the end of the launch offer ignores the switch (the trial ends at the same instant), like every campaign mode.
 */
export const SS_REQUESTED = process.env.NEXT_PUBLIC_AICC_SELFSERVICE === "on";
export const SS_ON = SS_REQUESTED && !eaIsOver(EA_BUILD_MS, EA_END_UTC_MS);
/** The switch is set but this build is at or past the end: self-service was NOT published (`launch:check` reports it). */
export const SS_EXPIRED_REQUEST = SS_REQUESTED && !SS_ON;
/**
 * P39: what the STATIC HTML of a self-service build says before (or without) the run-time status answer. NEXT_PUBLIC_AICC_SS_INITIAL: exactly "link" = a link to {CP}/start/?plan=<id> (a build made AFTER sign-up was activated);
 * anything else, including unset, = "coming_soon" (the default): plain text "Free trial registration opens soon". The default is the safe one because /start/ is a 404 while the Control Plane switch is off.
 * The run-time status (src/lib/ssStatus.ts) upgrades a coming_soon card to a link only when the Control Plane says open or waitlist.
 */
export const SS_INITIAL = parseSsInitial(process.env.NEXT_PUBLIC_AICC_SS_INITIAL);
/**
 * P40: a page that is LOADED at or after the registration cutoff (2026-12-24T00:00:00Z, the absolute instant, no time zone) is marked `<html data-ss-closed>` before the first paint (the launch-offer head script runs it):
 * the closed view (ordinary cards, no launch panel, no announcement bar text) shows without a flash. The client store (SsGetStarted) keeps the attribute in step afterwards (a status answer "closed", a page left open across the instant).
 */
export const SS_HEAD_SCRIPT = `try{if(Date.now()>=${SS_REG_CLOSE_MS})document.documentElement.setAttribute("data-ss-closed","")}catch(e){}`;

/**
 * The English sign-up URL: the Control Plane page, same host as the Site by default (the edge routes /start/ to WordPress). NEXT_PUBLIC_AICC_START_URL overrides it for a stage or test host (English base, like
 * NEXT_PUBLIC_AICC_ACCOUNT_URL). The default follows SITE_URL, so a stage build keeps its visitors on the staging host.
 */
/**
 * P40: the override is a build-time INPUT that becomes a link on every plan card, so it is validated: https only, a copilt.org host (the apex or any subdomain: www, stage), no credentials; anything else (http:, javascript:, data:, another host)
 * makes the build FAIL (a malformed or hostile value is never published as a sign-up link).
 */
export function parseStartUrl(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error(`NEXT_PUBLIC_AICC_START_URL is not a URL: "${String(raw).slice(0, 60)}"`); }
  if (u.protocol !== "https:") throw new Error(`NEXT_PUBLIC_AICC_START_URL must be https (got ${u.protocol})`);
  if (u.username || u.password) throw new Error("NEXT_PUBLIC_AICC_START_URL must not carry credentials");
  if (!(u.hostname === "copilt.org" || u.hostname.endsWith(".copilt.org"))) throw new Error(`NEXT_PUBLIC_AICC_START_URL must be on copilt.org (got ${u.hostname})`);
  return raw;
}
const START_URL_EN = parseStartUrl(process.env.NEXT_PUBLIC_AICC_START_URL) || `${SITE_URL}/start/`;
/** The sign-up URL in the page language, with the plan as a plain preselection: https://www.copilt.org/he/start/?plan=studio. Same locale-prefix rule as the account URL (localizeAccountUrl). */
export function startUrl(locale: Locale, plan?: PlanId): string {
  const base = localizeAccountUrl(START_URL_EN, locale);
  if (!plan) return base;
  const hash = base.indexOf("#");
  const head = hash === -1 ? base : base.slice(0, hash);
  const frag = hash === -1 ? "" : base.slice(hash);
  return `${head}${head.includes("?") ? "&" : "?"}plan=${plan}${frag}`;
}
