// npm run test:payment-gate: proves the launch gate for the payment placeholder, WITHOUT a build and without touching out/.
//   - bacs / cheque / cod / "Direct bank transfer" (as the configured processor) FAIL; any gateway not on the explicit allowlist (EMPTY today) FAILS; unset FAILS
//   - a checkout page whose markup still offers the bank-transfer placeholder FAILS (scratch output directory, never out/)
//   - the structured-data offers switch state is printed, and "on" without a real gateway FAILS
//   - positive control: a gateway on a (test-only) allowlist passes the pure function
// Runs `node scripts/launch-check.mjs --strict` against a throwaway output directory in the OS temp dir.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./lib/load.mjs";
import { processorProblems, placeholderMarkup, REAL_GATEWAY_ALLOWLIST } from "./lib/payment-gate.mjs";

let total = 0, failed = 0;
const check = (name, ok, detail = "") => { total++; if (!ok) { failed++; console.error(`FAIL: ${name}${detail ? " :: " + detail : ""}`); } };

check("the real-gateway allowlist is EMPTY today (adding a gateway is an owner decision)", REAL_GATEWAY_ALLOWLIST.length === 0);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aicc-pay-gate-"));
const mkOut = (name, html) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "index.html"), html); return d; };
const clean = mkOut("clean", "<!doctype html><html lang=\"en\"><head><title>x</title></head><body><h1>x</h1></body></html>");
const bacs = mkOut("bacs", "<html><body><ul class=\"wc_payment_methods\"><li class=\"wc_payment_method payment_method_bacs\"><input id=\"payment_method_bacs\" type=\"radio\" name=\"payment_method\" value=\"bacs\"><label>Direct bank transfer</label></li></ul></body></html>");
const label = mkOut("label", "<html><body><label>Direct bank transfer</label></body></html>");
const qa = mkOut("qa", "<html><body><label>QA only: not a real payment (Direct bank transfer)</label></body></html>");

function run(outDir, extraEnv = {}) {
  const env = { ...process.env, AICC_OUT_DIR: outDir, AICC_PRODUCTION: "", NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR: "", NEXT_PUBLIC_AICC_STRUCTURED_OFFERS: "", AICC_CHECKOUT_URL: "", ...extraEnv };
  const r = spawnSync("node", ["scripts/launch-check.mjs", "--strict"], { cwd: ROOT, env, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}
const has = (r, re) => re.test(r.out);

// 1. configured processor values
const unset = run(clean);
check("processor unset: launch:check --strict FAILS with the no-gateway blocker", unset.code === 1 && has(unset, /no payment gateway configured/));
for (const v of ["bacs", "cheque", "cod", "Direct bank transfer", "BACS", "Cash on delivery"]) {
  const r = run(clean, { NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR: v });
  check(`processor "${v}": FAILS as a WooCommerce placeholder`, r.code === 1 && has(r, /is a WooCommerce placeholder method/), r.out.split("\n").filter((l) => /processor/.test(l)).join(" | "));
}
for (const v of ["payplus", "Tranzila", "Example Pay", "stripe"]) {
  const r = run(clean, { NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR: v });
  check(`processor "${v}": FAILS (not on the empty allowlist)`, r.code === 1 && has(r, /not on the real-gateway allowlist/));
}

// 2. checkout markup
const mBacs = run(bacs);
check("a checkout page with the bacs input FAILS", mBacs.code === 1 && has(mBacs, /built output contains a payment placeholder \(WooCommerce bacs payment method input\)/));
const mLabel = run(label);
check("a page with the label \"Direct bank transfer\" FAILS", mLabel.code === 1 && has(mLabel, /payment placeholder \(the label "Direct bank transfer"\)/));
const mQa = run(qa);
check("a page with the QA-only marker FAILS (a QA checkout must not be in a publishable output)", mQa.code === 1 && has(mQa, /QA-only placeholder marker/));
check("negative control: the clean output has no markup finding", !has(unset, /payment placeholder \(/));

// 3. the structured-data switch
check("launch:check prints the structured-data offers switch (OFF by default)", has(unset, /structured-data offers switch \(NEXT_PUBLIC_AICC_STRUCTURED_OFFERS\): OFF/));
const on = run(clean, { NEXT_PUBLIC_AICC_STRUCTURED_OFFERS: "on" });
check("the switch ON is printed", has(on, /structured-data offers switch \(NEXT_PUBLIC_AICC_STRUCTURED_OFFERS\): ON/));
check("the switch ON without a real gateway FAILS", on.code === 1 && has(on, /STRUCTURED_OFFERS=on while no real payment gateway/));

// 4. pure function: positive control with a test-only allowlist, and markup detector units
check("positive control: a gateway on a (test-only) allowlist passes", processorProblems("payplus", ["payplus"]).length === 0);
check("positive control: bacs stays a failure even if someone lists it", processorProblems("bacs", ["bacs"]).length === 1);
check("markup detector: clean page -> no findings", placeholderMarkup("<p>hello</p>").length === 0);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `${failed} of ${total} checks FAILED` : `${total}/${total} payment-gate checks passed`);
process.exit(failed ? 1 : 0);
