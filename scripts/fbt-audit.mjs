// npm run fbt:audit [-- --init] [-- --doc]
// Lists every use of "Frequently Bought Together" / co-purchase wording on the marketing surface and shows its class from scripts/fbt-allowlist.json:
//   A = a legitimate description of the storefront widget (its real heading) or of the co-purchase signal, in context;  B = used as AICC's identity (must not exist).
// --init writes the allow-list from the CURRENT state (review the diff first: only class A may be in it); --doc regenerates the table in docs/fbt-usage-audit.md.
import fs from "node:fs";
import path from "node:path";
import { loadDictionaries, ROOT } from "./lib/load.mjs";
import { scanFbt, classA, checkFbt, loadAllowlist } from "./lib/fbt.mjs";

const args = process.argv.slice(2);
const dicts = await loadDictionaries();
const faq = JSON.parse(fs.readFileSync(path.join(ROOT, "brand/content/faq.en.json"), "utf8"));
const tr = Object.fromEntries(["he", "es", "ru"].map((l) => [l, JSON.parse(fs.readFileSync(path.join(ROOT, `brand/content/faq.${l}.json`), "utf8"))]));
const scan = scanFbt(dicts.en, faq);

if (args.includes("--init")) {
  const per = {};
  for (const o of scan.files) per[o.path] = (per[o.path] || 0) + 1;
  const list = {
    note: "Reviewed class-A usages of 'Frequently Bought Together' / co-purchase wording (see docs/fbt-usage-audit.md). Adding an entry means a person decided it names the widget or describes the signal and is NOT AICC's identity.",
    dict: Object.fromEntries(scan.dict.map((o) => [o.path, classA(o.text)])),
    faq: Object.fromEntries(scan.faqs.map((o) => [o.path, classA(faq.items[o.path.split(".")[0]][o.path.split(".")[1]])])),
    files: Object.fromEntries(Object.entries(per).map(([f, n]) => [f, { max: n, reason: /docs\/|README|\.md$/.test(f) ? "documentation that explains the widget and the guard" : /scripts\//.test(f) ? "test or tooling text about the widget heading and the demo" : "code comment or identifier that describes the widget" }])),
  };
  fs.writeFileSync(path.join(ROOT, "scripts/fbt-allowlist.json"), JSON.stringify(list, null, 2) + "\n");
  console.log(`wrote scripts/fbt-allowlist.json: ${scan.dict.length} dictionary, ${scan.faqs.length} FAQ, ${Object.keys(per).length} files`);
  process.exit(0);
}

const res = checkFbt({ dicts, faq, faqTranslations: tr, enDict: dicts.en });
if (args.includes("--doc")) {
  const allow = loadAllowlist();
  const rows = [
    ...scan.dict.map((o) => `| dictionary \`${o.path}\` | ${o.text.replace(/\|/g, "\\|").slice(0, 100)} | A | ${allow.dict[o.path] || "NOT REVIEWED"} |`),
    ...scan.faqs.map((o) => `| FAQ \`${o.path}\` | (see brand/content/faq.en.json) | A | ${allow.faq[o.path] || "NOT REVIEWED"} |`),
    ...Object.entries(allow.files).map(([f, a]) => `| file \`${f}\` | up to ${a.max} mention(s) | A | ${a.reason} |`),
  ];
  const md = fs.readFileSync(path.join(ROOT, "docs/fbt-usage-audit.md"), "utf8");
  const start = md.indexOf("<!-- table:start -->"), end = md.indexOf("<!-- table:end -->");
  fs.writeFileSync(path.join(ROOT, "docs/fbt-usage-audit.md"), md.slice(0, start) + "<!-- table:start -->\n| Where | Text | Class | Why it stays |\n|---|---|---|---|\n" + rows.join("\n") + "\n" + md.slice(end));
  console.log(`docs/fbt-usage-audit.md: ${rows.length} class-A rows`);
}
console.log(`fbt:audit  dictionary ${scan.dict.length}, FAQ ${scan.faqs.length}, files ${new Set(scan.files.map((f) => f.path)).size} (${scan.files.length} lines)`);
if (res.problems.length) { console.error(`FAIL: ${res.problems.length} problem(s)`); res.problems.forEach((p) => console.error("  " + p)); process.exit(1); }
console.log("PASS: no FBT / co-purchase wording in a positioning slot; every other usage is in the reviewed allow-list (class A).");
