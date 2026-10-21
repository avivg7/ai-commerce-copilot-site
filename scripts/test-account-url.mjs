// npm run test:account-url: the account ("Sign in" / "Get started" / plan button) URL follows the build's SITE_URL.
//
// Why: the stage build on the real staging host (SITE_URL=https://stage.copilt.org) shipped every account link as https://www.copilt.org/my-account/ because src/lib/site.ts
// hard-coded the production host as the default. A visitor (or a browser test) on the staging site was sent to the PRODUCTION origin. The default is now `${SITE_URL}/my-account/`.
// Each case below evaluates src/lib/site.ts in a fresh process with its own environment (module-level constants are read once per process).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0, failures = 0;
const ok = (cond, msg, detail = "") => { checks++; if (!cond) { failures++; console.error(`  FAIL ${msg}${detail ? "\n       " + String(detail).slice(0, 300) : ""}`); } };

const CHILD = `
import { createJiti } from "jiti";
import path from "node:path";
const jiti = createJiti(process.cwd() + "/x.mjs", { alias: { "@": path.join(process.cwd(), "src") }, moduleCache: false });
const m = await jiti.import(path.join(process.cwd(), "src/lib/site.ts"));
const out = {};
for (const l of ["en", "he", "es", "ru"]) { out[l] = { start: m.getStartedUrl(l), solo: m.planUrl("solo", l), studio: m.planUrl("studio", l), agency: m.planUrl("agency", l) }; }
console.log(JSON.stringify({ site: m.SITE_URL, urls: out }));
`;
function evalSite(env) {
  const clean = { ...process.env }; delete clean.SITE_URL; delete clean.NEXT_PUBLIC_AICC_ACCOUNT_URL;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", CHILD], { cwd: ROOT, env: { ...clean, ...env }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`child failed: ${r.stderr.slice(0, 300)}`);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}
const all = (o) => Object.values(o.urls).flatMap((u) => Object.values(u));

// 1. production build: unchanged
const prod = evalSite({});
ok(prod.site === "https://www.copilt.org", "production build: SITE_URL defaults to https://www.copilt.org", prod.site);
ok(prod.urls.en.start === "https://www.copilt.org/my-account/" && prod.urls.he.start === "https://www.copilt.org/he/my-account/" && prod.urls.es.start === "https://www.copilt.org/es/my-account/" && prod.urls.ru.start === "https://www.copilt.org/ru/my-account/", "production build: account URLs unchanged (en unprefixed, he/es/ru prefixed)", JSON.stringify(prod.urls));
ok(prod.urls.en.solo === "https://www.copilt.org/my-account/?plan=solo" && prod.urls.he.agency === "https://www.copilt.org/he/my-account/?plan=agency", "production build: plan buttons keep ?plan=<id>", JSON.stringify(prod.urls.en));
const prodExplicit = evalSite({ SITE_URL: "https://www.copilt.org" });
ok(JSON.stringify(prodExplicit.urls) === JSON.stringify(prod.urls), "production build with SITE_URL=https://www.copilt.org explicitly set is identical to the default");

// 2. stage build: every account link stays on the staging host
const stage = evalSite({ SITE_URL: "https://stage.copilt.org" });
ok(all(stage).every((u) => u.startsWith("https://stage.copilt.org/")), "stage build (SITE_URL=https://stage.copilt.org): all 16 account/plan URLs are on the staging host", JSON.stringify(stage.urls.en));
ok(!all(stage).some((u) => /www\.copilt\.org|\/\/copilt\.org/.test(u)), "stage build: no account/plan URL names a production host");
ok(stage.urls.en.start === "https://stage.copilt.org/my-account/" && stage.urls.he.solo === "https://stage.copilt.org/he/my-account/?plan=solo" && stage.urls.ru.studio === "https://stage.copilt.org/ru/my-account/?plan=studio", "stage build: same shape as production (en unprefixed, he/es/ru prefixed, ?plan= kept)", JSON.stringify(stage.urls.he));
const stageSlash = evalSite({ SITE_URL: "https://stage.copilt.org/" });
ok(stageSlash.urls.en.start === "https://stage.copilt.org/my-account/", "a trailing slash on SITE_URL does not produce //my-account/", stageSlash.urls.en.start);

// 3. the explicit override still wins
const over = evalSite({ SITE_URL: "https://stage.copilt.org", NEXT_PUBLIC_AICC_ACCOUNT_URL: "https://shop.example.test/wp/my-account/" });
ok(over.urls.en.start === "https://shop.example.test/wp/my-account/" && over.urls.he.start === "https://shop.example.test/wp/he/my-account/", "NEXT_PUBLIC_AICC_ACCOUNT_URL still overrides the default (language prefix goes before the last path segment)", JSON.stringify(over.urls.he));

console.log(`\ntest-account-url: ${checks} checks, ${failures} failed`);
if (failures) process.exit(1);
console.log("PASS: account URLs follow the build's SITE_URL; the production build is unchanged");
