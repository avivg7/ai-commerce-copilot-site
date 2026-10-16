// npm run test:approved: builds the site the way production will be built (every owner value supplied, legal review approved,
// domain-root base path) and asserts that NOTHING pending or drafted is published and that FAQPage JSON-LD then has all 40 answers.
// It leaves out/ holding the approved build; rebuild normally afterwards.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/load.mjs";

const env = {
  ...process.env,
  AICC_BASE_PATH: "",
  AICC_PRODUCTION: "1",
  NEXT_PUBLIC_LEGAL_REVIEW_APPROVED: "true",
  NEXT_PUBLIC_AICC_LEGAL_NAME: "Example Ltd",
  NEXT_PUBLIC_AICC_ADDRESS: "1 Example Street, Example City",
  NEXT_PUBLIC_AICC_SUPPORT_EMAIL: "support@example.test",
  NEXT_PUBLIC_AICC_GOVERNING_LAW: "Example law",
  NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR: "Example Pay",
  NEXT_PUBLIC_AICC_HOSTING_REGION: "Example region",
  NEXT_PUBLIC_AICC_DEMO_VIDEO: "https://example.test/demo.mp4",
};
const b = spawnSync("npm", ["run", "-s", "build"], { cwd: ROOT, env, encoding: "utf8" });
if (b.status !== 0) { console.error("build failed\n" + b.stdout + b.stderr); process.exit(1); }
const l = spawnSync("node", ["scripts/launch-check.mjs", "--strict"], { cwd: ROOT, env, encoding: "utf8" });
process.stdout.write(l.stdout);
const errors = [];
if (l.status !== 0) errors.push("launch:check --strict failed on the approved build");
let pending = 0, drafts = 0, faq = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!["_next", "brand-kit", "og", "fonts"].includes(e.name)) walk(p); } else if (e.name.endsWith(".html")) { const h = fs.readFileSync(p, "utf8"); pending += (h.match(/data-pending="true"/g) || []).length; drafts += (h.match(/data-legal-draft="true"/g) || []).length; if (p.endsWith("/questions/index.html") && p.split("/").length === path.join(ROOT, "out", "questions", "index.html").split("/").length) { const m = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((x) => JSON.parse(x[1])).find((x) => x["@type"] === "FAQPage"); faq = m ? m.mainEntity : []; } } } };
walk(path.join(ROOT, "out"));
if (pending) errors.push(`${pending} pending lines in the approved build`);
if (drafts) errors.push(`${drafts} draft notices in the approved build`);
if (faq.length !== 40) errors.push(`FAQPage JSON-LD has ${faq.length} answers, expected 40 once approved`);
const priv = fs.readFileSync(path.join(ROOT, "out/privacy/index.html"), "utf8");
if (!priv.includes("support@example.test")) errors.push("support email value not rendered");
console.log(`approved build: ${pending} pending lines, ${drafts} draft notices, FAQPage answers ${faq.length}`);
if (errors.length) { console.error("FAIL\n  " + errors.join("\n  ")); process.exit(1); }
console.log("PASS: with every value supplied and legal review approved, nothing pending or drafted is published.");
