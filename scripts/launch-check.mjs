// npm run launch:check: what would be published that must not be published yet?
// Reports pending owner values, legal blocks that are not approved, draft notices and the marketing copy that needs the same review.
// Report-only by default; FAILS (exit 1) with --strict or AICC_PRODUCTION=1 (run it that way before a production deploy).
import fs from "node:fs";
import path from "node:path";
import { loadTs, ROOT } from "./lib/load.mjs";
import { auditBuild, DEFAULT_ORIGIN, structuredOffersOn } from "./lib/seo-audit.mjs";
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
  console.log(`early access switch (NEXT_PUBLIC_AICC_EARLY_ACCESS): ${ea.EA_MODE.toUpperCase()}${ea.EA_REQUESTED !== ea.EA_MODE ? ` (requested "${ea.EA_REQUESTED}", ignored: this build is at or after the cutoff ${ea.EA_CUTOFF_ISO_UTC})` : ""}; cutoff ${ea.EA_CUTOFF_ISO_UTC} = 2027-01-01 00:00 Asia/Jerusalem`);
  if (ea.EA_EXPIRED_REQUEST) problems.push(`early access: the switch is "${ea.EA_REQUESTED}" but this build is made at or after the cutoff, so the campaign was NOT published; remove NEXT_PUBLIC_AICC_EARLY_ACCESS from the release environment`);
  if (env.NEXT_PUBLIC_AICC_EARLY_ACCESS && !["announce", "open"].includes(env.NEXT_PUBLIC_AICC_EARLY_ACCESS)) problems.push(`early access: NEXT_PUBLIC_AICC_EARLY_ACCESS is "${env.NEXT_PUBLIC_AICC_EARLY_ACCESS}": only the exact values "announce" and "open" switch the campaign on; anything else is OFF`);
  if (env.AICC_BUILD_NOW_MS || env.AICC_EA_TEST_SEAM) problems.push("early access: AICC_BUILD_NOW_MS / AICC_EA_TEST_SEAM are set: they pin the build clock for tests and must never exist in a release environment");
  if (ea.EA_ON) problems.push("early access is ON in this build: publishing free access needs the owner's explicit approval, the accountant's written confirmation and counsel's review of the promotional terms (docs/cutover/early-access.md section 6)");
  if (ea.EA_OPEN && !ea.EA_URL_OVERRIDE) problems.push("early access OPEN: NEXT_PUBLIC_AICC_EARLY_ACCESS_URL is not set, so the buttons lead to the plain account page: the Early Access request flow on the Control Plane must exist and be approved first");
  if (ea.EA_OPEN && !commerceOpen) console.log("early access OPEN with checkout CLOSED: a valid state (free access does not need checkout); after the end date the pages return to \"Purchases open soon\"");
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
