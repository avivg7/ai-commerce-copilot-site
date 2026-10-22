#!/usr/bin/env node
// Render the edge Caddyfile for the Linux hosts from the ONE template (docs/cutover/Caddyfile.edge.template). No Caddy needed; prints the text or writes it with --out.
//
//   node scripts/ops/render-edge.mjs --mode stage [--host stage.copilt.org] [--out /etc/aicc-edge/Caddyfile]
//   node scripts/ops/render-edge.mjs --mode production [--out FILE]                  # the committed text, byte for byte. NOT activated by anything in this repo.
//   node scripts/ops/render-edge.mjs --mode production --pre-cutover [--out FILE]    # the DARK-PRODUCTION waiting render: production topology, `tls internal` (Caddy's local CA), so the promoted host can
//                                                                                    # be exercised BEFORE public DNS moves without ever asking a public CA for www/apex certificates.
//   node scripts/ops/render-edge.mjs --mode stage --env-template [--gen-stage-id]    # an example /etc/aicc-edge/edge.env (no secrets; the stage id is a random marker, printed once)
//
// stage:       ONE public address ({$AICC_PUBLIC_HOST} unless --host is given), automatic public-CA HTTPS (Let's Encrypt), php_fastcgi over the unix socket, the loopback operator listener
//              on 127.0.0.1:{$AICC_OPERATOR_PORT:8443}, the identity route /.well-known/aicc-stage-identity, HTTP/3 off, metrics on the loopback admin API only.
// production:  www.copilt.org + copilt.org, the same everything, and NO identity route (npm run test:target-guard checks that).
// The render is the same text the tests model (npm run test:redirects) and the real-Caddy rehearsal runs (docs/cutover/rehearsal.md). After rendering, run scripts/ops/edge-preflight.sh --mode <mode>.
import fs from "node:fs";
import crypto from "node:crypto";
import { render, readTemplate } from "../lib/edge-render.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);
if (flag("help") || !argv.length) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(argv.length ? 0 : 2); }
const mode = opt("mode");
if (!["stage", "production"].includes(mode)) { console.error("--mode must be stage or production"); process.exit(2); }
const preCutover = flag("pre-cutover");
if (preCutover && mode !== "production") { console.error("--pre-cutover applies to --mode production only"); process.exit(2); }
const host = opt("host");
if (host && mode !== "stage") { console.error("--host applies to --mode stage only (the production render serves www.copilt.org and copilt.org)"); process.exit(2); }
if (host && /^(www\.|api\.)?copilt\.org$/i.test(host)) { console.error(`REFUSED: ${host} is a production name; a stage render never serves it`); process.exit(3); }

if (flag("env-template")) {
  const id = flag("gen-stage-id") ? crypto.randomBytes(16).toString("hex") : "<run with --gen-stage-id, or: openssl rand -hex 16>";
  const lines = mode === "stage" ? [
    "# /etc/aicc-edge/edge.env (mode 0640 root:aicc-edge). No secrets live here; AICC_STAGE_ID is a random marker the test tooling must be given as --stage-id.",
    "AICC_EDGE_MODE=stage",
    `AICC_PUBLIC_HOST=${host || "stage.copilt.org"}`,
    `AICC_STAGE_HOST=${host || "stage.copilt.org"}`,
    `AICC_STAGE_ID=${id}`,
    "AICC_STATIC_ROOT=/srv/aicc/site/current",
    "AICC_WP_ROOT=/srv/aicc/cp/current/wp",
    "AICC_PHP_FPM_SOCKET=unix//run/php/aicc-cp.sock",
    "AICC_ACME_EMAIL=<OWNER INPUT: the ACME account contact>",
    "# FIRST start only: the Let's Encrypt STAGING directory (rate limits; browsers will not trust it). Then delete this line and reload.",
    "AICC_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory",
    "AICC_LOG_DIR=/var/log/aicc-edge",
    "AICC_ADMIN_ADDR=127.0.0.1:12019",
    "AICC_OPERATOR_PORT=8443",
    "AICC_WP_TIMEOUT=60s",
  ] : [
    "# /etc/aicc-edge/edge.env for the PRODUCTION render (cutover day only).",
    "AICC_EDGE_MODE=production",
    "AICC_ALLOW_PRODUCTION_MODE=1",
    "AICC_PUBLIC_HOST=www.copilt.org",
    "AICC_STATIC_ROOT=/srv/aicc/site/current",
    "AICC_WP_ROOT=/srv/aicc/cp/current/wp",
    "AICC_PHP_FPM_SOCKET=unix//run/php/aicc-cp.sock",
    "AICC_ACME_EMAIL=<OWNER INPUT>",
    "AICC_LOG_DIR=/var/log/aicc-edge",
    "AICC_ADMIN_ADDR=127.0.0.1:12019",
    "AICC_OPERATOR_PORT=8443",
  ];
  console.log(lines.join("\n"));
  process.exit(0);
}
// pre-cutover: certificates come from Caddy's internal CA (nothing is requested from a public CA, so no failed ACME validations are burned while DNS still points elsewhere). The preflight accepts
// this only with AICC_ALLOW_INTERNAL_TLS=1 and AICC_ALLOW_PRODUCTION_MODE=1 in edge.env; the cutover step re-renders WITHOUT this flag and removes both.
const rendered = render(readTemplate(), { mode, ...(host ? { host } : {}), ...(preCutover ? { tls: "internal", allowNonAutomaticTls: true } : {}) });
let text = rendered.text;
if (preCutover) text = "# PRE-CUTOVER (dark production) RENDER: tls internal. NOT for public traffic. The final render is `render-edge.mjs --mode production` (automatic public-CA HTTPS).\n" + text;
const out = opt("out");
if (out) { fs.writeFileSync(out, text); console.error(`wrote ${out} (${mode} render, ${text.split("\n").length} lines)`); } else process.stdout.write(text);
