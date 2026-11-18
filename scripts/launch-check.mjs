// npm run launch:check: what would be published that must not be published yet?
// Reports pending owner values, legal blocks that are not approved, draft notices and the marketing copy that needs the same review.
// Report-only by default; FAILS (exit 1) with --strict or AICC_PRODUCTION=1 (run it that way before a production deploy).
import fs from "node:fs";
import path from "node:path";
import { loadTs, ROOT } from "./lib/load.mjs";
import { auditBuild, DEFAULT_ORIGIN, structuredOffersOn } from "./lib/seo-audit.mjs";
import { makeAttested } from "./lib/ea-attest.mjs";
import { processorProblems, placeholderMarkup, REAL_GATEWAY_ALLOWLIST } from "./lib/payment-gate.mjs";

const strict = process.argv.includes("--strict") || process.env.AICC_PRODUCTION === "1";
const env = process.env;
const { LEGAL_DOCS, TRANSLATION_REVIEW, LEGAL_REVIEW_KEYS } = await loadTs("src/data/legal.ts");
const { FAQ } = await loadTs("src/data/faq.ts");

const problems = [];
const VALUES = [
  ["NEXT_PUBLIC_AICC_LEGAL_NAME", "company legal name"],
  ["NEXT_PUBLIC_AICC_ADDRESS", "company address"],
  ["NEXT_PUBLIC_AICC_SUPPORT_EMAIL", "support email"],
  ["NEXT_PUBLIC_AICC_GOVERNING_LAW", "governing law"],
  ["NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR", "payment processor"],
  ["NEXT_PUBLIC_AICC_HOSTING_REGION", "hosting region"],
];
for (const [k, label] of VALUES) if (!env[k]) problems.push(`pending value: ${label} (${k}) is not set; the page would show "To be confirmed before purchases open."`);

// Commercial checkout switch (round 3). The public site can be LIVE while checkout is CLOSED: that is a valid, truthful state ("Purchases open soon" instead of any purchase button, `npm run test:public-truth`
// proves it is clean). THIS command is the COMMERCIAL launch gate, so a closed build is reported as a blocker here and is not one for the public release.
const commerceOpen = env.NEXT_PUBLIC_AICC_COMMERCE_OPEN === "true";
console.log(`commercial checkout switch (NEXT_PUBLIC_AICC_COMMERCE_OPEN): ${commerceOpen ? "OPEN: plan buttons and bands lead to the account area" : "CLOSED (default): the build shows \"Purchases open soon\" and no purchase CTA; set it to true together with the Control Plane owner fact AICC_COMMERCE_OPEN, in the same release"}`);
if (!commerceOpen) problems.push("commercial checkout is CLOSED in this build (NEXT_PUBLIC_AICC_COMMERCE_OPEN is not true): correct for a pre-commercial public release, a blocker only for the commercial launch");
if (env.NEXT_PUBLIC_AICC_COMMERCE_OPEN && !["true", "false"].includes(env.NEXT_PUBLIC_AICC_COMMERCE_OPEN)) problems.push(`NEXT_PUBLIC_AICC_COMMERCE_OPEN is "${env.NEXT_PUBLIC_AICC_COMMERCE_OPEN}": only the exact value "true" opens commerce (anything else is closed)`);

// A placeholder is as bad as nothing: a support address that is set but obviously not real (review finding C M-2).
if (env.NEXT_PUBLIC_AICC_SUPPORT_EMAIL && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.NEXT_PUBLIC_AICC_SUPPORT_EMAIL) || /@(example|test|invalid|localhost)\b|\.(test|invalid|example|local)$/i.test(env.NEXT_PUBLIC_AICC_SUPPORT_EMAIL)))
  problems.push(`support email: NEXT_PUBLIC_AICC_SUPPORT_EMAIL is "${env.NEXT_PUBLIC_AICC_SUPPORT_EMAIL}", which is not a real address`);
if (!env.NEXT_PUBLIC_AICC_SUPPORT_EMAIL) problems.push("support email unset: the footer, the 404 page and every \"contact support\" sentence show the pending line; merchants have nobody to write to");
// Payment gate (owner decision): a configured processor must be on the explicit real-gateway allowlist (EMPTY today); bacs / cheque / cod and any unlisted gateway fail.
for (const p of processorProblems(env.NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR)) problems.push(p);
// Purchasable-price structured data switch (owner decision): Offer/price JSON-LD stays OFF until real public checkout is live.
const offersOn = structuredOffersOn();
console.log(`structured-data offers switch (NEXT_PUBLIC_AICC_STRUCTURED_OFFERS): ${offersOn ? "ON: Offer/price JSON-LD is allowed in this build" : "OFF: no Offer/price JSON-LD is published (default; owner decision until checkout is live)"}`);
console.log(`payment gateway allowlist: ${REAL_GATEWAY_ALLOWLIST.length ? REAL_GATEWAY_ALLOWLIST.join(", ") : "(empty: no gateway counts as real yet)"}; configured processor: ${env.NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR || "(none)"}`);
if (offersOn && processorProblems(env.NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR).length) problems.push("NEXT_PUBLIC_AICC_STRUCTURED_OFFERS=on while no real payment gateway is configured: the pages would publish purchasable prices in structured data before checkout is live");
{
  // The plugin can only be installed if there is a route that tells the merchant where to get it. docs promise /get-started/; until it is built there is no
  // distribution path (no WordPress.org listing, no download route in the account area): "Get started" sells a journey that cannot be finished.
  const { ROUTES } = await loadTs("src/lib/routes.ts");
  if (!Object.values(ROUTES).includes("get-started")) problems.push("plugin distribution path not available: no /get-started/ page and no download route exist, so a merchant who buys cannot obtain the plugin (docs/cutover/redirect-matrix.md section 6; owner/business decision)");
}
const approved = env.NEXT_PUBLIC_LEGAL_REVIEW_APPROVED === "true";
let flagged = 0;
for (const doc of Object.values(LEGAL_DOCS)) for (const sec of doc.sections) for (const b of sec.blocks) if (b.legalReview) flagged++;
const faqFlagged = FAQ.filter((f) => f.legalReview).length;
const translatedLocales = Object.entries(TRANSLATION_REVIEW).filter(([, v]) => v !== "source-draft-pending-legal-review").map(([l]) => l).join(", ");
const translationsReviewed = env.NEXT_PUBLIC_LEGAL_TRANSLATIONS_REVIEWED === "true";
if (!approved) {
  problems.push(`legal review not approved: ${flagged} flagged legal blocks and ${faqFlagged} flagged FAQ answers would be published as drafts (set NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=true only after a lawyer approves them)`);
  problems.push(`draft translations: ${translatedLocales} legal text needs native legal review`);
  problems.push(`marketing copy with legal weight needs the same approval: ${LEGAL_REVIEW_KEYS.join(", ")}`);
}
// Approving the ENGLISH legal text says nothing about the Hebrew, Spanish and Russian drafts (they are machine drafts). The machine-translation disclosure on those legal pages therefore
// stays published until a native-speaking legal reviewer has approved them AND the build says so (NEXT_PUBLIC_LEGAL_TRANSLATIONS_REVIEWED=true). Shipping with the disclosure is allowed (a note,
// not a blocker); claiming the review without the English approval is not.
if (translationsReviewed && !approved) problems.push("NEXT_PUBLIC_LEGAL_TRANSLATIONS_REVIEWED=true without NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=true: the translations cannot be reviewed before the English text is approved");
if (approved) console.log(translationsReviewed
  ? `translations (${translatedLocales}): marked native-reviewed by NEXT_PUBLIC_LEGAL_TRANSLATIONS_REVIEWED=true: the machine-translation disclosure is NOT published; only set it after a native-speaking legal reviewer approved them`
  : `translations (${translatedLocales}): legal pages ship with the machine-translation disclosure ("draft translation, not reviewed by native speakers, English prevails") until NEXT_PUBLIC_LEGAL_TRANSLATIONS_REVIEWED=true`);
{
  // The Watch demo video is the owner-approved master, served first-party from public/demo/ (src/lib/brand.ts defaults).
  const demoDir = path.join(ROOT, "public/demo");
  const mp4 = path.join(demoDir, "aicc-demo.mp4");
  for (const f of ["aicc-demo.mp4", "aicc-demo-poster.jpg", "aicc-demo.vtt"]) if (!fs.existsSync(path.join(demoDir, f))) problems.push(`demo video: public/demo/${f} is missing (docs/watch-demo-video.md)`);
  if (fs.existsSync(mp4) && fs.existsSync(path.join(ROOT, "docs/approved-demo.sha256"))) {
    const want = fs.readFileSync(path.join(ROOT, "docs/approved-demo.sha256"), "utf8").trim().split(/\s+/)[0];
    const got = (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(mp4)).digest("hex");
    if (got !== want) problems.push(`demo video: public/demo/aicc-demo.mp4 (${got.slice(0, 12)}) is not the owner-approved master (${want.slice(0, 12)})`);
  } else problems.push("demo video: docs/approved-demo.sha256 is missing");
}
if (env.NEXT_PUBLIC_LEGAL_DRAFT_NOTICE === "off" && !approved) problems.push("NEXT_PUBLIC_LEGAL_DRAFT_NOTICE=off hides the draft pills without approval");

// Early Access (Production 20): a SEPARATE switch from checkout. It never opens paid purchases; it publishes a fixed-end free-access offer.
{
  const ea = await loadTs("src/lib/earlyAccess.ts");
  const eaRefIsPlaceholder = ea.eaRefIsPlaceholder;
  // The campaign the BUILT export carries counts as much as this shell's environment (security review H1): an open export checked from another shell used to print "switch: OFF" and raise nothing.
  const artDir = path.resolve(ROOT, process.env.AICC_OUT_DIR || "out");
  const art = (() => {
    const f = path.join(artDir, "index.html");
    if (!fs.existsSync(f)) return { mode: null, verify: false };
    const mode = fs.readFileSync(f, "utf8").match(/<html[^>]*\sdata-ea-mode="(\w+)"/)?.[1] || "off";
    const rp = path.join(artDir, "request-access/index.html");
    return { mode, verify: mode === "off" && fs.existsSync(rp) && fs.readFileSync(rp, "utf8").includes("data-req-verify") };
  })();
  const effMode = ea.EA_ON ? ea.EA_MODE : (art.mode && art.mode !== "off" ? art.mode : "off");
  const effOn = effMode !== "off", effOpen = effMode === "open", effVerify = ea.EA_VERIFY || art.verify;
  const M = effMode.toUpperCase();
  if (art.mode !== null && (art.mode !== ea.EA_MODE || art.verify !== ea.EA_VERIFY)) problems.push(`launch offer: this shell's environment says mode "${ea.EA_MODE}"${ea.EA_VERIFY ? " (verify)" : ""} but the built export in ${path.relative(ROOT, artDir) || "."} says "${art.mode}"${art.verify ? " (verify)" : ""}: the stricter reading applies below, and the export must be rebuilt or checked with the environment it was built with`);
  const attested = makeAttested(env, eaRefIsPlaceholder); // an attestation is a REFERENCE to evidence, recorded and never verified here (rules: scripts/lib/ea-attest.mjs)
  console.log(`early access switch (NEXT_PUBLIC_AICC_EARLY_ACCESS): ${ea.EA_MODE.toUpperCase()}${ea.EA_REQUESTED !== ea.EA_MODE ? ` (requested "${ea.EA_REQUESTED}", ignored: this build is at or after the end ${ea.EA_END_ISO_UTC})` : ""}; end ${ea.EA_END_ISO_UTC}${ea.EA_EXTENDED ? ` = EXTENSION STEP ${ea.EA_EXTENSION_STEP} (the initial published end was ${ea.EA_CUTOFF_ISO_UTC})` : ` = 2027-01-01 00:00 Asia/Jerusalem (initial published end)`}`);
  // VERIFY mode (P32): the ordinary site plus UNLISTED request pages, to test the live destination before any button exists. It may be built anywhere, but a PRODUCTION run refuses it without the owner's explicit word.
  if (env.NEXT_PUBLIC_AICC_EARLY_ACCESS === "verify" || art.verify) {
    console.log(`launch offer VERIFY build: ${ea.EA_VERIFY ? "the ordinary site plus the unlisted, noindex request pages (/request-access/, /request-access/confirm/) with a \"Verification page, not public\" banner; no campaign text or button anywhere" : "IGNORED (this build is at or after the end)"}`);
    if (effVerify && env.AICC_PRODUCTION === "1" && env.AICC_EA_VERIFY_BUILD !== "owner-approved") problems.push("launch offer VERIFY with a production deploy flag (AICC_PRODUCTION=1): a verify build puts the unlisted request pages on the live host, which is the owner's decision; set AICC_EA_VERIFY_BUILD=owner-approved only when the owner has approved exactly this deployment");
    else if (effVerify && env.AICC_EA_VERIFY_BUILD === "owner-approved") console.log("launch offer VERIFY: AICC_EA_VERIFY_BUILD=owner-approved is set (recorded, not verified by this command)");
  }
  if (env.AICC_EA_VERIFY_BUILD && env.AICC_EA_VERIFY_BUILD !== "owner-approved") problems.push(`AICC_EA_VERIFY_BUILD is "${env.AICC_EA_VERIFY_BUILD}": the only accepted value is the exact word owner-approved`);
  if (ea.EA_EXPIRED_REQUEST) problems.push(`early access: the switch is "${ea.EA_REQUESTED}" but this build is made at or after the end (${ea.EA_END_ISO_UTC}), so the campaign was NOT published; remove NEXT_PUBLIC_AICC_EARLY_ACCESS from the release environment${ea.EA_EXTENSION_REQUESTED && !ea.EA_EXTENDED ? " (an extension was requested but ignored, see the next line)" : ""}`);
  // P37 self-service free trial (orthogonal to the launch-offer mode): report the state, refuse a value that is not exactly "on", and remind the deploy order (the Control Plane /start/ page must be live first)
  {
    const ss = await loadTs("src/lib/selfService.ts");
    const raw = env.NEXT_PUBLIC_AICC_SELFSERVICE;
    console.log(`self-service free trial switch (NEXT_PUBLIC_AICC_SELFSERVICE): ${ss.SS_ON ? `ON, static initial state "${ss.SS_INITIAL}": ${ss.SS_INITIAL === "link" ? `plan cards, bands and "Get started" link to ${ss.startUrl("en", "solo")} (and /he/start/, /es/start/, /ru/start/)` : `plan cards and bands say the plain status "Free trial registration opens soon" and "Get started" stays on the account page; a link to /start/?plan= appears only when GET /wp-json/aicc/v1/signup/status answers open or waitlist`}; the Hero keeps Try Live Demo and See Pricing` : "OFF (default): the build is the P36 export for the same environment"}`);
    if (raw !== undefined && raw !== "" && raw !== "on") problems.push(`self-service: NEXT_PUBLIC_AICC_SELFSERVICE is "${raw}": only the exact value "on" turns it on (anything else is OFF)`);
    if (ss.SS_EXPIRED_REQUEST) problems.push(`self-service: the switch is "on" but this build is made at or after the end (${ea.EA_END_ISO_UTC}), so self-service was NOT published; remove NEXT_PUBLIC_AICC_SELFSERVICE from the release environment`);
    const rawInit = env.NEXT_PUBLIC_AICC_SS_INITIAL;
    if (rawInit !== undefined && rawInit !== "" && rawInit !== "link" && rawInit !== "coming_soon") problems.push(`self-service: NEXT_PUBLIC_AICC_SS_INITIAL is "${rawInit}": only the exact value "link" selects the link build; anything else is coming_soon (the safe default)`);
    if (ss.SS_ON && ss.SS_INITIAL === "link") problems.push("self-service: NEXT_PUBLIC_AICC_SS_INITIAL=link makes every plan card a static link to /start/, which is a 404 while the Control Plane switch is off: publish this build only AFTER the Control Plane serves /start/ and GET /wp-json/aicc/v1/signup/status answers open or waitlist (remove the variable otherwise)");
    if (ss.SS_ON) {
      // P39 round 2 (H1): DEPLOY ORDER and the legal pages
      console.log("  DEPLOY ORDER (self-service build): the Control Plane mirror of the 35 self-service msgids (scripts/snapshots/selfservice-msgids.txt) and of the date tokens regDate / regShort / regLast must be LIVE before, or in the same window as, this Site build (`node scripts/wording-parity.mjs --cp <CP release worktree> --require-ss` must be green): otherwise Home says one thing and the live /pricing/ (served by WordPress) another, and the bar link /pricing/#free-trial has no anchor.");
      console.log("  LEGAL PAGES: the legal pages inside this export (/terms/ /privacy/ /refund-policy/ /accessibility/, he/es/ru) are OLDER drafts that live does NOT serve: the edge routes them to WordPress. The byte-equality test proves equality with the S0 export only. The edge allow-list (docs/cutover/Caddyfile.edge.template, @wp_pages) must keep routing them to WordPress.");
      const { edgeLegalProblems } = await import("./lib/edge-legal.mjs");
      const tpl = path.join(ROOT, "docs/cutover/Caddyfile.edge.template");
      if (!fs.existsSync(tpl)) problems.push("edge template docs/cutover/Caddyfile.edge.template not found: cannot prove that the legal pages are routed to WordPress");
      else for (const x of edgeLegalProblems(fs.readFileSync(tpl, "utf8"))) problems.push(`self-service / legal pages: ${x}`);
    }
    if (ss.SS_ON && ss.SS_INITIAL !== "link") console.log("  note self-service (initial coming_soon): no DEPLOY ORDER dependency: the static pages link nowhere near /start/; the run-time status upgrades the cards when the Control Plane opens sign-up (no Site redeploy)");
    if (ss.SS_ON && env.NEXT_PUBLIC_AICC_START_URL && !/^https:\/\//.test(env.NEXT_PUBLIC_AICC_START_URL)) problems.push(`self-service: NEXT_PUBLIC_AICC_START_URL ("${env.NEXT_PUBLIC_AICC_START_URL}") is not an https URL`);
  }
  // Extension (Production 21): a step needs its decision reference; without it the build silently keeps the initial end, which is the conservative side, but the operator must be told.
  if (ea.EA_EXTENSION_REQUESTED && !ea.EA_EXTENDED) problems.push(`early access extension: NEXT_PUBLIC_AICC_EA_EXTENSION_STEP is "${env.NEXT_PUBLIC_AICC_EA_EXTENSION_STEP}" but the extension was IGNORED (${ea.EA_EXTENSION_REJECTED}); this build keeps the initial end ${ea.EA_CUTOFF_ISO_UTC}`);
  if (ea.EA_EXTENDED && !ea.EA_ON) problems.push(`early access extension: step ${ea.EA_EXTENSION_STEP} is set but the Early Access switch is off in this build: the extension changes nothing; remove NEXT_PUBLIC_AICC_EA_EXTENSION_STEP and NEXT_PUBLIC_AICC_EA_EXTENSION_REF`);
  if (ea.EA_EXTENDED && ea.EA_ON) {
    const step = ea.EA_EXTENSION_STEP;
    console.log(`early access EXTENDED to step ${step} (${ea.EA_END_ISO_UTC}; decision reference ${env.NEXT_PUBLIC_AICC_EA_EXTENSION_REF}): two explicit confirmations are required`);
    if (env.AICC_EA_EXTENSION_CP_VERIFIED === "yes") console.log(`  confirmed (AICC_EA_EXTENSION_CP_VERIFIED=yes): the Control Plane \`wp aicc-ea extend --step=${step}\` has been run and verified`);
    else problems.push(`early access EXTENDED to step ${step}: publish this build only AFTER the Control Plane \`wp aicc-ea extend --step=${step}\` has been run and VERIFIED (a Site that announces a later date than the product delivers is the harmful order; docs/cutover/early-access.md section 7b); confirm with AICC_EA_EXTENSION_CP_VERIFIED=yes`);
    if (env.AICC_EA_HTML_NOCACHE_CONFIRMED === "yes") console.log("  confirmed (AICC_EA_HTML_NOCACHE_CONFIRMED=yes): HTML pages are served with a short or no-cache Cache-Control, the CDN/browser HTML caches were purged, and `npm run ea:live` passed against the live pages");
    else problems.push(`early access EXTENDED to step ${step}: a cached page of the INITIAL build flips to "Early Access has ended" at ${ea.EA_CUTOFF_ISO_UTC} although access is extended: serve HTML with a short or no-cache Cache-Control, purge HTML caches and CDN at this deploy, then run \`npm run ea:live -- <live origin> --step ${step}\`; confirm with AICC_EA_HTML_NOCACHE_CONFIRMED=yes (docs/cutover/early-access.md section 7b)`);
  }
  // Plugin identity gate (Production 21): the release being distributed must be the corrected Plugin (no 14-day money-back message on a free grant), recorded by its hash.
  // The hash must be in the committed allow-list (scripts/data/ea-plugin-releases.json): adding an entry is a conscious act when a new Plugin build is attested.
  if (effOn) {
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/data/ea-plugin-releases.json"), "utf8"));
    const v = env.AICC_EA_PLUGIN_RELEASE_SHA256;
    const why = "it records that the Plugin release distributed with Early Access is the corrected one that no longer shows a 14-day money-back message on a free grant (the superseded 1.1.0 candidate does); the Site build never reads it; the hash must be in scripts/data/ea-plugin-releases.json, and adding an entry there is a conscious act when a new Plugin build is attested";
    if (!v) problems.push(`early access ${M}: AICC_EA_PLUGIN_RELEASE_SHA256 is not set: ${why}`);
    else if (!/^[0-9a-f]{64}$/.test(v)) problems.push(`early access ${M}: AICC_EA_PLUGIN_RELEASE_SHA256 must be 64 lower-case hex characters (the sha256 of the Plugin release ZIP): ${why}`);
    else if (reg.superseded.some((x) => x.sha256 === v)) problems.push(`early access ${M}: AICC_EA_PLUGIN_RELEASE_SHA256 is a SUPERSEDED candidate (${v.slice(0, 8)}...): that Plugin shows the money-back message on free grants and must not be distributed with Early Access; ${why}`);
    else if (/^0{64}$/.test(v)) problems.push(`early access ${M}: AICC_EA_PLUGIN_RELEASE_SHA256 is 64 zeros, a placeholder and not the hash of any file; ${why}`);
    else if (!reg.allowed.some((x) => x.sha256 === v)) problems.push(`early access ${M}: AICC_EA_PLUGIN_RELEASE_SHA256 (${v.slice(0, 12)}...) is not in the allow-list scripts/data/ea-plugin-releases.json: ${why}`);
    else { const e = reg.allowed.find((x) => x.sha256 === v); console.log(`early access Plugin release identity (AICC_EA_PLUGIN_RELEASE_SHA256): ${v.slice(0, 12)}... allow-listed (${e.status}); recorded, not verified against any file`); if (/unsigned/i.test(e.status)) problems.push(`early access ${M}: the allow-listed Plugin release ${v.slice(0, 12)}... is an UNSIGNED candidate: do not publish until the signed release hash replaces it in scripts/data/ea-plugin-releases.json`); }
  }
  // Strike-through (P32): off by default (`EA_STRIKE` is false unless the build says "on"); when it is on it stays a blocker until counsel's approval is attested with a real reference.
  // Review P34-2: the BUILT export counts too (Home and Pricing in every language): a struck price there raises the same blocker whatever this shell's switch says.
  const strikeBuilt = ["", "he/", "es/", "ru/"].flatMap((l) => [`${l}index.html`, `${l}pricing/index.html`]).filter((rel) => { const f = path.join(artDir, rel); if (!fs.existsSync(f)) return false; const h = fs.readFileSync(f, "utf8"); return /class="[^"]*aicc-plan__regular--strike/.test(h) || /<(s|del)>/.test(h); }); // the markup, not the inline stylesheet every campaign build carries
  if (ea.EA_STRIKE || strikeBuilt.length) {
    if (!attested(env.AICC_EA_STRIKE_COUNSEL_APPROVED)) problems.push(`early access: NEXT_PUBLIC_AICC_EA_STRIKE=on shows the plan price struck through next to the free offer${strikeBuilt.length && !ea.EA_STRIKE ? ` (found in the built export: ${strikeBuilt.join(", ")})` : ""}: counsel must approve that presentation first (no plan has ever been sold at that price); attest it with AICC_EA_STRIKE_COUNSEL_APPROVED=<counsel approval reference>`);
    else console.log(`early access strike-through: ON, counsel approval attested (${env.AICC_EA_STRIKE_COUNSEL_APPROVED.trim()}); recorded, not verified`);
  }
  // "Limited availability" (P34): off by default; on, it is a blocker until the owner attests the facts that make it true (the built export counts as much as this shell's switch).
  const limitedBuilt = (() => { const f = path.join(artDir, "index.html"); return fs.existsSync(f) && fs.readFileSync(f, "utf8").includes("data-ea-limited"); })();
  if (ea.EA_LIMITED || limitedBuilt) {
    if (!attested(env.AICC_EA_LIMITED_ATTESTED)) problems.push(`launch offer: the Hero says "Limited availability" (NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on${limitedBuilt && !ea.EA_LIMITED ? ", found in the built export" : ""}): the owner must attest that it is true (every request is reviewed by hand, approvals are capped by AICC_EA_REQUESTS_CAPACITY on the Control Plane, and the offer can close to new requests at any time); attest it with AICC_EA_LIMITED_ATTESTED=<reference>`);
    else console.log(`launch offer "Limited availability": ON, owner attestation (AICC_EA_LIMITED_ATTESTED=${env.AICC_EA_LIMITED_ATTESTED.trim()}); recorded, not verified`);
  } else if (ea.EA_LIMITED_REQUESTED) console.log("launch offer \"Limited availability\": NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on has no effect in this build (the campaign is off)");
  if (env.NEXT_PUBLIC_AICC_EARLY_ACCESS_URL) problems.push(`early access: NEXT_PUBLIC_AICC_EARLY_ACCESS_URL is set ("${env.NEXT_PUBLIC_AICC_EARLY_ACCESS_URL}") but is IGNORED since the launch offer (P32): the request buttons lead only to this site's /request-access/ page; remove the variable so nobody believes it decides anything`);
  if (effOn) problems.push(`launch offer ${M}: publishing a campaign build needs the owner's explicit approval (a separate decision from this build); the Control Plane intake (the request-access routes) must be deployed and independently reviewed, and the legal pages must carry the launch-offer terms and the new processors before ${ea.EA_OPEN ? "this build is" : "any build is"} published`);
  // OPEN mode (P32): the buttons lead to a real form. Two explicit attestations are required, each a non-empty reference to evidence (a path, ticket or decision id), never a bare "yes" or a placeholder.
  if (effOpen) {
    if (!attested(env.AICC_EA_INTAKE_VERIFIED)) problems.push(`launch offer OPEN: AICC_EA_INTAKE_VERIFIED is ${env.AICC_EA_INTAKE_VERIFIED ? `"${env.AICC_EA_INTAKE_VERIFIED}", which is not a real evidence reference` : "not set"}: set it to the reference of the evidence that the destination works end to end (the Control Plane request-access routes are deployed, a request arrives, the confirmation e-mail is delivered and confirmed, a rejected request and a closed state behave); an OPEN build must not be published without it`);
    else console.log(`launch offer OPEN: intake verified (AICC_EA_INTAKE_VERIFIED=${env.AICC_EA_INTAKE_VERIFIED.trim()}); recorded, not verified by this command`);
    if (!attested(env.AICC_EA_LEGAL_SIGNOFF)) problems.push(`launch offer OPEN: AICC_EA_LEGAL_SIGNOFF is ${env.AICC_EA_LEGAL_SIGNOFF ? `"${env.AICC_EA_LEGAL_SIGNOFF}", which is not a real sign-off reference` : "not set"}: set it to the reference of the legal sign-off that the Privacy Policy and Terms cover the new data collection (e-mail, store address, plan, and the short-lived abuse counters keyed by a hash of the connection, which are the only IP-derived data kept) and the new processors (Cloudflare Turnstile and the e-mail delivery provider); the legal pages are the owner's and counsel's gate and this build does not edit them`);
    else console.log(`launch offer OPEN: legal sign-off (AICC_EA_LEGAL_SIGNOFF=${env.AICC_EA_LEGAL_SIGNOFF.trim()}); recorded, not verified by this command`);
    const mp = ea.EA_MAIL_PROVIDER;
    if (!mp || eaRefIsPlaceholder(mp) || /to be confirmed|\btbd\b|\btodo\b|placeholder|example|\bn\/a\b|replace/i.test(mp)) problems.push(`launch offer OPEN: NEXT_PUBLIC_AICC_EA_MAIL_PROVIDER is ${mp ? `"${mp}", a placeholder` : "not set"}: the request form's privacy notice names the e-mail delivery provider, and the owner has not chosen one; until a real provider name is given the page shows a visible placeholder and this build must not be published`);
    else console.log(`launch offer OPEN: the request form names the e-mail delivery provider "${mp}"`);
  }
  if (effOpen && !commerceOpen) console.log("early access OPEN with checkout CLOSED: a valid state (free access does not need checkout); after the end date the pages return to \"Purchases open soon\"");
}

// If a build exists, look at what it really contains.
const out = path.resolve(ROOT, process.env.AICC_OUT_DIR || "out");
if (fs.existsSync(out)) {
  let pend = 0, drafts = 0, pages = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["_next", "brand-kit", "og", "fonts"].includes(e.name)) walk(p); } else if (e.name.endsWith(".html")) { const h = fs.readFileSync(p, "utf8"); pages++; pend += (h.match(/data-pending="true"/g) || []).length; drafts += (h.match(/data-legal-draft="true"/g) || []).length; } } };
  walk(out);
  console.log(`built output: ${pages} pages, ${pend} pending lines, ${drafts} draft notices`);
  if (pend) problems.push(`built output contains ${pend} pending lines`);
  // Test sentinels must never be in a build that could be published (`npm run test:approved` used to leave them in out/), and no Finder junk ships.
  const SENT = ["Example Ltd", "support@example.test", "1 Example Street", "Example Pay"];
  const found = new Set(); const junk = [];
  const walk3 = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk3(p); else if (e.name === ".DS_Store") junk.push(path.relative(out, p)); else if (/\.(html|txt|xml|json|js|css|vtt|webmanifest)$/.test(e.name)) { const t = fs.readFileSync(p, "utf8"); for (const x of SENT) if (t.includes(x)) found.add(x); } } };
  walk3(out);
  if (found.size) problems.push(`built output contains test sentinel value(s) ${[...found].map((x) => `"${x}"`).join(", ")}: it was built by \`npm run test:approved\` or with fake company values; rebuild from a clean checkout before anything is published`);
  if (junk.length) problems.push(`built output contains ${junk.join(", ")}: delete .DS_Store files before packaging a release (the release procedure uses rsync --exclude .DS_Store)`);
  if (!env.NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR) {
    let planLinks = 0;
    const walk4 = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["_next", "brand-kit", "og", "fonts"].includes(e.name)) walk4(p); } else if (e.name.endsWith(".html")) planLinks += (fs.readFileSync(p, "utf8").match(/my-account\/\?plan=/g) || []).length; } };
    walk4(out);
    if (planLinks) problems.push(`built output publishes ${planLinks} plan buy link(s) (?plan=) while no payment processor is configured`);
  }
  let ph = 0;
  const walk2 = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["_next", "brand-kit", "og", "fonts"].includes(e.name)) walk2(p); } else if (e.name.endsWith(".html")) ph += (fs.readFileSync(p, "utf8").match(/data-demo-video=""/g) || []).length; } };
  walk2(out);
  if (ph) problems.push(`built output has ${ph} Watch demo button(s) without a video (placeholder modal)`);
  {
    // No checkout page, and no bank-transfer placeholder, may be part of the static output (checkout lives on the WordPress origin and must not be public before a real gateway is configured).
    const hits = new Map();
    const walk5 = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["_next", "brand-kit", "og", "fonts"].includes(e.name)) walk5(p); } else if (/\.(html|txt)$/.test(e.name)) for (const f of placeholderMarkup(fs.readFileSync(p, "utf8"))) hits.set(f, [...(hits.get(f) || []), path.relative(out, p)]); } };
    walk5(out);
    for (const [f, files] of hits) problems.push(`built output contains a payment placeholder (${f}) in ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""}: the QA checkout's "Direct bank transfer" must never be published`);
  }
  if (drafts) problems.push(`built output contains ${drafts} draft notices`);
  {
    // The machine-translation disclosure must be on every he / es / ru legal page of a build unless the translations were marked reviewed (and on none of the English pages).
    const LEGAL_ROUTES = ["privacy", "terms", "refund-policy", "data-and-trust", "accessibility"];
    const missing = [], leaked = [];
    for (const loc of ["he", "es", "ru"]) for (const r of LEGAL_ROUTES) {
      const f = path.join(out, loc, r, "index.html");
      if (!fs.existsSync(f)) continue;
      const has = fs.readFileSync(f, "utf8").includes('data-translation-draft="true"');
      if (!has && !translationsReviewed) missing.push(`${loc}/${r}`);
      if (has && translationsReviewed) leaked.push(`${loc}/${r}`);
    }
    for (const r of LEGAL_ROUTES) { const f = path.join(out, r, "index.html"); if (fs.existsSync(f) && fs.readFileSync(f, "utf8").includes('data-translation-draft="true"')) leaked.push(`en/${r}`); }
    if (missing.length) problems.push(`built output lacks the machine-translation disclosure on ${missing.join(", ")} (NEXT_PUBLIC_LEGAL_TRANSLATIONS_REVIEWED is not true)`);
    if (leaked.length) problems.push(`built output carries the machine-translation disclosure where it should not be: ${leaked.join(", ")}`);
  }
  {
    // Launch offer (P32): what the built pages say must match the mode they were built in. The mode of the BUILD is read from the export itself (data-ea-mode on <html>), not from this
    // process's environment, so a stale `out/` is judged for what it is.
    const read = (rel) => (fs.existsSync(path.join(out, rel)) ? fs.readFileSync(path.join(out, rel), "utf8") : null);
    const home = read("index.html") || "";
    const builtMode = home.match(/<html[^>]*\sdata-ea-mode="(\w+)"/)?.[1] || "off";
    const htmlFiles = []; const walkL = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) { if (!["_next", "brand-kit", "og", "fonts"].includes(e.name)) walkL(q); } else if (e.name.endsWith(".html")) htmlFiles.push(q); } }; walkL(out);
    // 1. the old hero fine print must be gone in every mode
    const notes = htmlFiles.filter((f) => fs.readFileSync(f, "utf8").includes("aicc-eanote")).map((f) => path.relative(out, f));
    if (notes.length) problems.push(`launch offer: ${notes.length} built page(s) still carry the fine print under the hero buttons (class aicc-eanote; the owner removed it): ${notes.slice(0, 3).join(", ")}`);
    // 2. the request pages exist in an OPEN build, in all four languages, and in no other build
    const REQ = ["request-access/index.html", "request-access/confirm/index.html", ...["he", "es", "ru"].flatMap((l) => [`${l}/request-access/index.html`, `${l}/request-access/confirm/index.html`])];
    const present = REQ.filter((r) => fs.existsSync(path.join(out, r)));
    // a VERIFY build is an ordinary (mode off) site whose request pages all carry the verification banner (data-req-verify)
    const bannered = present.filter((r) => fs.readFileSync(path.join(out, r), "utf8").includes("data-req-verify"));
    const builtVerify = builtMode === "off" && present.length > 0 && bannered.length === present.length;
    if (builtVerify && present.length !== REQ.length) problems.push(`launch offer VERIFY: the export lacks request pages (${REQ.filter((r) => !present.includes(r)).join(", ")})`);
    if (builtMode === "open" && bannered.length) problems.push(`launch offer OPEN: ${bannered.length} request page(s) carry the verification banner (an open build must not say "not public")`);
    if (builtMode === "open" && present.length !== REQ.length) problems.push(`launch offer OPEN: the export lacks request pages (${REQ.filter((r) => !present.includes(r)).join(", ")})`);
    if (builtMode !== "open" && present.length && !builtVerify) problems.push(`launch offer: the export was built in mode "${builtMode}" but contains request pages (${present.join(", ")}): they may exist only in an OPEN build`);
    // 3. the words of the request button exist only in an OPEN build (never in an OFF or announce build, not even hidden), in any language
    const isReq = (f) => /(^|\/)request-access\//.test(path.relative(out, f).replace(/\\/g, "/"));
    if (builtVerify) {
      // every NON-request page of a verify build is the ordinary site: no campaign text, no link to the request pages; every request page is noindex
      const nonReq = htmlFiles.filter((f) => !isReq(f));
      const lk = nonReq.filter((f) => /request-access/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(out, f));
      if (lk.length) problems.push(`launch offer VERIFY: ${lk.length} ordinary page(s) mention /request-access/ (the pages must be unlisted): ${lk.slice(0, 3).join(", ")}`);
      const noidx = present.filter((r) => !/<meta name="robots" content="noindex,nofollow"\/?>/.test(fs.readFileSync(path.join(out, r), "utf8")));
      if (noidx.length) problems.push(`launch offer VERIFY: request page(s) without <meta name="robots" content="noindex,nofollow">: ${noidx.slice(0, 3).join(", ")}`);
      for (const f of ["sitemap.xml", "robots.txt"]) { const t = read(f); if (t && /request-access/.test(t)) problems.push(`launch offer VERIFY: ${f} names the request pages (they must be unlisted)`); }
    }
    if (builtMode !== "open") {
      const dicts = await (await import("./lib/load.mjs")).loadDictionaries();
      const words = [...new Set(Object.values(dicts).flatMap((d) => [d.ea.hero.ctaOpen, d.ea.plan.ctaOpen, d.ea.header.cta]))];
      const leaks = [];
      for (const f of htmlFiles.filter((x) => !isReq(x))) { const h = fs.readFileSync(f, "utf8").replace(/&nbsp;|\u00a0/g, " "); for (const w of words) if (h.includes(w)) leaks.push(`${path.relative(out, f)} ("${w}")`); }
      if (leaks.length) problems.push(`launch offer: the request button wording appears in a build that is not OPEN (mode ${builtMode}): ${leaks.slice(0, 3).join(", ")}${leaks.length > 3 ? ` and ${leaks.length - 3} more` : ""}`);
      if (htmlFiles.filter((x) => !isReq(x)).some((f) => /href="[^"]*request-access/.test(fs.readFileSync(f, "utf8")))) problems.push(`launch offer: a link to /request-access/ exists in a build that is not OPEN (mode ${builtMode})`);
    }
    // 4. an OPEN build: nothing in the request pages or their code may reach a payment, checkout, licence or grant route; the only API surface is /wp-json/aicc/v1/access-requests*
    if ((builtMode === "open" || builtVerify) && present.length) {
      const bad = [];
      for (const r of present) { const h = fs.readFileSync(path.join(out, r), "utf8"); const m = h.match(/(?:href|action)="[^"]*(?:checkout|cart|\/pay\b|payment|licen[cs]e|\/grant|wp-admin|wp-login|my-account\/?\?(?:[^"]*&)?plan=|offer=early-access)[^"]*"/gi); if (m) bad.push(`${r}: ${m[0]}`); }
      const chunks = path.join(out, "_next/static/chunks"); const apiRefs = new Set();
      const walkC = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walkC(q); else if (e.name.endsWith(".js")) { const t = fs.readFileSync(q, "utf8"); if (t.includes("access-requests")) for (const m of t.matchAll(/\/wp-json\/[^"'`\s\\)]*/g)) apiRefs.add(m[0]); } } };
      if (fs.existsSync(chunks)) walkC(chunks);
      for (const a of apiRefs) if (!/^\/wp-json\/aicc\/v1\/access-requests(\/status|\/confirm)?$/.test(a)) bad.push(`client code names the API route ${a}`);
      if (bad.length) problems.push(`launch offer OPEN: the request pages reach beyond the intake routes: ${bad.slice(0, 3).join(" | ")}`);
      if (!apiRefs.size) problems.push("launch offer OPEN: the client code of the request page names no intake route (the form would talk to nothing); rebuild");
    }
    console.log(`launch offer built output: mode ${builtVerify ? "verify (off + unlisted request pages)" : builtMode}; request pages ${present.length}/${REQ.length}; hero fine print in ${notes.length} page(s)`);
  }
  // Origin / SEO gate (same audit as `npm run seo:check`): canonical host, sitemap, robots, hreflang, no apex / http / localhost / GitHub Pages.
  const seo = auditBuild({ outDir: out });
  const seoErrors = seo.issues.filter((i) => i.level === "error");
  console.log(`seo audit (${seo.stats.origin || DEFAULT_ORIGIN}): ${seo.stats.pages ?? 0} pages, ${seoErrors.length} error(s)`);
  if (seoErrors.length) {
    const head = seoErrors.slice(0, 5).map((i) => `${i.where}: ${i.msg}`).join(" | ");
    problems.push(`seo:check fails on the built output (${seoErrors.length} error(s); run \`npm run seo:check\`; a build for the www root needs AICC_BASE_PATH="" SITE_URL=${DEFAULT_ORIGIN}): ${head}`);
  }
} else console.log("no out/ build found; run `npm run build` first to also scan the built pages");

// Optional live check of a deployed/served checkout page (AICC_CHECKOUT_URL=https://www.copilt.org/checkout/ or --checkout-url=...): its markup must not offer the placeholder.
{
  const arg = process.argv.find((a) => a.startsWith("--checkout-url="));
  const url = arg ? arg.slice("--checkout-url=".length) : env.AICC_CHECKOUT_URL;
  if (url) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      const body = await res.text();
      const f = placeholderMarkup(body);
      console.log(`checkout markup ${url}: HTTP ${res.status}, ${f.length ? "placeholder found" : "no placeholder"}`);
      for (const x of f) problems.push(`checkout page ${url} offers a payment placeholder (${x}): not acceptable for public launch`);
      if (res.status === 200 && !f.length && !REAL_GATEWAY_ALLOWLIST.length) problems.push(`checkout page ${url} is publicly reachable (HTTP 200) while the real-gateway allowlist is empty: it must not be public until a real gateway is configured and this gate passes`);
    } catch (e) { problems.push(`checkout page ${url} could not be fetched (${e.message}); the markup gate could not run`); }
  }
}

// Production preconditions that live in the Control Plane's configuration and cannot be read from this repository (architecture review B-3). Printed on every run so they are not forgotten;
// the Control Plane's own gate (scripts/check-launch-blockers.php with AICC_PRODUCTION=1) is what fails on them.
console.log("production precondition (checked by the Control Plane gate, not here): the CP -> Backend entitlement webhook. AICC_ENTITLEMENT_WEBHOOK_URL must be https://api.copilt.org/v1/internal/entitlement/webhook (the plugin's default is the docker-compose name http://backend:8000/...) and WP_ACCESSIBLE_HOSTS must be exactly api.copilt.org while WP_HTTP_BLOCK_EXTERNAL is true. Staging keeps WP_HTTP_BLOCK_EXTERNAL=true with its own host only; copying that to production silently blocks every paid-licence entitlement. Template (NOT usable): infra/provision/wp-config.production.template.php. Details: docs/cutover/runbook.md section 11 (B-3).");

if (!problems.length) { console.log("PASS: nothing pending, drafted or unapproved would be published."); process.exit(0); }
console.log(`${strict ? "FAIL" : "REPORT"}: ${problems.length} launch blocker(s)`);
for (const p of problems) console.log("  - " + p);
if (!strict) console.log("(report-only; use --strict or AICC_PRODUCTION=1 to fail)");
process.exit(strict ? 1 : 0);
