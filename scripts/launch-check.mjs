// npm run launch:check: what would be published that must not be published yet?
// Reports pending owner values, legal blocks that are not approved, draft notices and the marketing copy that needs the same review.
// Report-only by default; FAILS (exit 1) with --strict or AICC_PRODUCTION=1 (run it that way before a production deploy).
import fs from "node:fs";
import path from "node:path";
import { loadTs, ROOT } from "./lib/load.mjs";

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
for (const [k, label] of VALUES) if (!env[k]) problems.push(`pending value: ${label} (${k}) is not set; the page would show "Support details will be published before launch."`);

const approved = env.NEXT_PUBLIC_LEGAL_REVIEW_APPROVED === "true";
let flagged = 0;
for (const doc of Object.values(LEGAL_DOCS)) for (const sec of doc.sections) for (const b of sec.blocks) if (b.legalReview) flagged++;
const faqFlagged = FAQ.filter((f) => f.legalReview).length;
if (!approved) {
  problems.push(`legal review not approved: ${flagged} flagged legal blocks and ${faqFlagged} flagged FAQ answers would be published as drafts (set NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=true only after a lawyer approves them)`);
  problems.push(`draft translations: ${Object.entries(TRANSLATION_REVIEW).filter(([, v]) => v !== "source-draft-pending-legal-review").map(([l]) => l).join(", ")} legal text needs native legal review`);
  problems.push(`marketing copy with legal weight needs the same approval: ${LEGAL_REVIEW_KEYS.join(", ")}`);
}
if (!env.NEXT_PUBLIC_AICC_DEMO_VIDEO) problems.push("demo video: NEXT_PUBLIC_AICC_DEMO_VIDEO is not set; the Watch demo modal would show the labelled placeholder (no footage exists yet)");
if (env.NEXT_PUBLIC_LEGAL_DRAFT_NOTICE === "off" && !approved) problems.push("NEXT_PUBLIC_LEGAL_DRAFT_NOTICE=off hides the draft pills without approval");

// If a build exists, look at what it really contains.
const out = path.join(ROOT, "out");
if (fs.existsSync(out)) {
  let pend = 0, drafts = 0, pages = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["_next", "brand-kit", "og", "fonts"].includes(e.name)) walk(p); } else if (e.name.endsWith(".html")) { const h = fs.readFileSync(p, "utf8"); pages++; pend += (h.match(/data-pending="true"/g) || []).length; drafts += (h.match(/data-legal-draft="true"/g) || []).length; } } };
  walk(out);
  console.log(`built output: ${pages} pages, ${pend} pending lines, ${drafts} draft notices`);
  if (pend) problems.push(`built output contains ${pend} pending lines`);
  let ph = 0;
  const walk2 = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["_next", "brand-kit", "og", "fonts"].includes(e.name)) walk2(p); } else if (e.name.endsWith(".html")) ph += (fs.readFileSync(p, "utf8").match(/data-demo-video=""/g) || []).length; } };
  walk2(out);
  if (ph) problems.push(`built output has ${ph} Watch demo button(s) without a video (placeholder modal)`);
  if (drafts) problems.push(`built output contains ${drafts} draft notices`);
} else console.log("no out/ build found; run `npm run build` first to also scan the built pages");

if (!problems.length) { console.log("PASS: nothing pending, drafted or unapproved would be published."); process.exit(0); }
console.log(`${strict ? "FAIL" : "REPORT"}: ${problems.length} launch blocker(s)`);
for (const p of problems) console.log("  - " + p);
if (!strict) console.log("(report-only; use --strict or AICC_PRODUCTION=1 to fail)");
process.exit(strict ? 1 : 0);
