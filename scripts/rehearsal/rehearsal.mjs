#!/usr/bin/env node
// AICC production-like edge rehearsal: generator + runner for a REAL Caddy on loopback. See docs/cutover/rehearsal.md.
//
//   node scripts/rehearsal/rehearsal.mjs release                 copy out/ (+ docs/cutover/50x.html) into ~/aicc-rehearsal/releases/<id>, point `current` at it
//   node scripts/rehearsal/rehearsal.mjs generate [opts]         write ~/aicc-rehearsal/generated/Caddyfile[.<name>] FROM docs/cutover/Caddyfile.edge.template
//   node scripts/rehearsal/rehearsal.mjs validate|adapt [opts]   real `caddy validate` / `caddy adapt` on the generated file
//   node scripts/rehearsal/rehearsal.mjs start|stop|reload|status [opts]
//   node scripts/rehearsal/rehearsal.mjs run-tests [which]       routing matrix + real-behaviour tests (scripts/rehearsal/run-tests.mjs)
//   node scripts/rehearsal/rehearsal.mjs launchd-plist           write ~/aicc-rehearsal/run/org.copilt.aicc-rehearsal-edge.plist (supervision rehearsal)
//
// Options: --name edge|public|stage|<x>  --http-port N --https-port N --admin host:port  --static-root DIR  --wp-timeout 60s  --variant block-demo|old-target  --template FILE
//          --upstream-mode proxy|fastcgi (env AICC_REHEARSAL_UPSTREAM; proxy = reverse_proxy to the php -S fixture, fastcgi = php_fastcgi over the scratch php-fpm socket: bash scripts/rehearsal/fpm.sh start)
//          --upstream 127.0.0.1:18982 (proxy)  --fpm-socket PATH --wp-root DIR (fastcgi)  --topology production|stage  --stage-host NAME  --operator-port N
//          --operator-cidrs "A B"   OPTIONAL public operator list, EMPTY by default (operators use the loopback operator listener: 127.0.0.1:<operator port>; edge 18444, public twin 18445, stage 18464)
// Instances: edge = the standing production-topology edge on :80/:443; public = its high-port twin (18080/18443); stage = the STAGE topology (stage-rehearsal.copilt.org, 18200/18463, php_fastcgi).
// Every request any runner sends goes through scripts/lib/target-guard.mjs (fail closed; docs/cutover/stage-linux.md section 10); the render comes from scripts/lib/edge-render.mjs.
// Safety (enforced here, refusing to run otherwise): upstream must be loopback; the generated file must contain `local_certs`, `tls internal` on every site, no
// acme_ca/email/dns challenge line, no api.copilt.org address; after start the live config is read back from Caddy's admin API and must contain no ACME issuer.
import fs from "node:fs";
import { settings, generate, safetyCheck, validate, adapt, start, stop, reload, status, release, launchdPlist } from "./edge.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const s = settings(undefined, argv);
switch (cmd) {
  case "release": release(); break;
  case "generate": { const { file, text } = generate(s); const e = safetyCheck(s, text); console.log(`wrote ${file}${e.length ? "\nSAFETY: " + e.join("; ") : "\nsafety checks: ok"}`); process.exit(e.length ? 3 : 0); }
  case "validate": { const v = await validate(s); process.exit(v.ok ? 0 : 1); }
  case "adapt": { const a = adapt(s); process.stdout.write(a.json); if (!a.ok) { console.error(a.err); process.exit(1); } break; }
  case "start": await start(s); break;
  case "stop": await stop(s); break;
  case "reload": await reload(s); break;
  case "restart": await stop(s); await start(s); break;
  case "status": await status(s); break;
  case "launchd-plist": { const r = launchdPlist(s); console.log(r.out); break; }
  case "run-tests": { const m = await import("./run-tests.mjs"); await m.main(argv.slice(1)); break; }
  default: console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 16).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(cmd ? 2 : 0);
}
