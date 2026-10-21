// ONE template, three renders: docs/cutover/Caddyfile.edge.template -> a Caddyfile for `stage`, `production` or the macOS `rehearsal`.
//
//   import { render, readTemplate, RENDER_MODES } from "./edge-render.mjs";
//   const { text } = render(readTemplate(), { mode: "stage" });
//
// CLI (no Caddy needed): node scripts/ops/render-edge.mjs --mode stage|production [--out FILE] ...
//
// What a render may change (everything else is the SAME TEXT in every mode, so one set of tests covers all of them):
//   mode "production"  the committed text, unchanged: www + apex, automatic public-CA HTTPS, php_fastcgi, NO identity route. NOT activated by anything in this repo.
//   mode "stage"       the stage topology: ONE public address (default `{$AICC_PUBLIC_HOST}`), no apex block, automatic public-CA HTTPS, php_fastcgi, the stage identity route.
//   mode "rehearsal"   macOS: production OR stage topology (opts.topology), caller-supplied global options (`local_certs`, loopback ports), `tls internal` (or files),
//                      php_fastcgi (scratch php-fpm) or reverse_proxy (opts.upstream), the identity route, a loopback-only hook.
// The regions it touches: global options, the aicc_tls / aicc_site_hook / aicc_stage_identity snippets, the wp_proxy selector, the site addresses, the apex-https block, and the
// absolute `https://www.copilt.org` redirect targets. Each substitution is asserted (a template that no longer contains the region fails loudly instead of rendering silently wrong).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/cutover/Caddyfile.edge.template");
export const RENDER_MODES = ["production", "stage", "rehearsal"];
export const CANONICAL = "www.copilt.org";
export const APEX = "copilt.org";
export const STAGE_HOST_PLACEHOLDER = "{$AICC_PUBLIC_HOST}";
export const IDENTITY_PATH = "/.well-known/aicc-stage-identity";

export const readTemplate = (file = TEMPLATE_PATH) => fs.readFileSync(file, "utf8");

export function replaceRegion(text, begin, end, body) {
  const a = text.indexOf(begin), b = text.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`template region ${begin} .. ${end} not found`);
  return text.slice(0, a) + body + text.slice(b + end.length);
}
export function replaceSnippet(text, name, body) {
  const re = new RegExp(`\\(${name}\\) \\{\\n(?:(?!\\}\\n)[^\\n]*\\n)*\\}\\n`);
  if (!re.test(text)) throw new Error(`template snippet (${name}) not found`);
  return text.replace(re, `(${name}) {\n${body}\n}\n`);
}
function mustReplace(text, from, to, what) {
  if (!text.includes(from)) throw new Error(`template: ${what || from} not found`);
  return text.split(from).join(to);
}
/** Replace only in CODE lines (comments keep describing the production topology). */
function mustReplaceInCode(text, from, to, what) {
  let n = 0;
  const out = text.split("\n").map((l) => { if (/^\s*#/.test(l) || !l.includes(from)) return l; n++; return l.split(from).join(to); }).join("\n");
  if (!n) throw new Error(`template: ${what || from} not found in code`);
  return out;
}

/** The identity route. `env` is "staging" (stage render) or "rehearsal" (macOS). The values come from the environment (AICC_STAGE_HOST, AICC_STAGE_ID), never from this repo. */
export function identitySnippetBody(env) {
  return [
    `\t@aicc_stage_identity path ${IDENTITY_PATH}`,
    "\thandle @aicc_stage_identity {",
    "\t\theader Content-Type \"application/json\"",
    "\t\theader Cache-Control \"no-store\"",
    `\t\trespond \`{"env":"${env}","host":"{$AICC_STAGE_HOST}","id":"{$AICC_STAGE_ID}"}\` 200`,
    "\t}",
  ].join("\n");
}

/**
 * @param {string} template  the committed template text
 * @param {object} o
 *   mode        "production" | "stage" | "rehearsal"
 *   topology    "production" | "stage" (rehearsal only; stage mode implies "stage")
 *   host        stage topology: the literal site host (default `{$AICC_PUBLIC_HOST}`)
 *   upstream    "fastcgi" (default) | "proxy"
 *   tls         "automatic" (default; the aicc_tls snippet stays empty) | "internal" | { cert, key }
 *   globals     replacement text for the global-options region (rehearsal); omitted = keep the template's block
 *   hook        replacement body for aicc_site_hook (rehearsal)
 *   identity    "staging" | "rehearsal" | null (default: "staging" for stage, null for production)
 *   httpsPort   rehearsal: append :<port> to the absolute https redirect targets (a high-port instance)
 */
export function render(template, o = {}) {
  const mode = o.mode || "production";
  if (!RENDER_MODES.includes(mode)) throw new Error(`unknown render mode ${mode}`);
  const topology = mode === "stage" ? "stage" : mode === "production" ? "production" : o.topology || "production";
  const upstream = o.upstream || "fastcgi";
  if (!["fastcgi", "proxy"].includes(upstream)) throw new Error(`unknown upstream ${upstream}`);
  if (mode !== "rehearsal" && upstream !== "fastcgi") throw new Error(`mode ${mode} is php_fastcgi only (reverse_proxy is a macOS rehearsal fallback)`);
  const identity = o.identity !== undefined ? o.identity : mode === "stage" ? "staging" : null;
  if (mode === "production" && identity) throw new Error("the production render never contains the stage identity route");
  let t = template;

  if (o.globals !== undefined && o.globals !== null) {
    if (mode !== "rehearsal") throw new Error("custom global options are a rehearsal-only feature");
    t = replaceRegion(t, "\t# BEGIN GLOBAL OPTIONS", "# END GLOBAL OPTIONS", o.globals);
  }
  const tls = o.tls || "automatic";
  if (tls !== "automatic") {
    if (mode === "production" || mode === "stage") { if (!o.allowNonAutomaticTls) throw new Error(`mode ${mode} uses automatic HTTPS (owner decision); pass allowNonAutomaticTls to render a check build`); }
    t = replaceSnippet(t, "aicc_tls", tls === "internal" ? "\ttls internal" : `\ttls ${tls.cert} ${tls.key}`);
  }
  if (o.hook) t = replaceSnippet(t, "aicc_site_hook", o.hook);
  if (identity) t = replaceSnippet(t, "aicc_stage_identity", identitySnippetBody(identity));
  // the staging host is never indexable (production-shaped canonical URLs on a second host = duplicate content); the stage topology only, never the production topology
  if (topology === "stage") t = replaceSnippet(t, "aicc_stage_robots", `\theader X-Robots-Tag "noindex, nofollow, noarchive"`);
  if (upstream === "proxy") t = replaceSnippet(t, "wp_proxy", "\timport wp_proxy_http");

  if (topology === "stage") {
    const host = o.host || STAGE_HOST_PLACEHOLDER;
    t = t.replace(/# BEGIN APEX-HTTPS[\s\S]*?# END APEX-HTTPS\n/, "");
    if (t.includes("BEGIN APEX-HTTPS")) throw new Error("template: apex-https block markers malformed");
    t = mustReplace(t, `http://${APEX}, http://${CANONICAL} {`, `http://${host} {`, "the http apex+www address line");
    t = mustReplace(t, `\n${CANONICAL} {`, `\n${host} {`, "the canonical site block");
    t = mustReplace(t, `${CANONICAL}:{$AICC_OPERATOR_PORT:8443} {`, `${host}:{$AICC_OPERATOR_PORT:8443} {`, "the operator listener block");
    t = mustReplaceInCode(t, `https://${CANONICAL}`, `https://${host}`, "absolute redirect targets");
    if (/\bwww\.copilt\.org\b/.test(t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"))) throw new Error("stage render still contains a code reference to the canonical production host");
  }
  if (o.httpsPort && Number(o.httpsPort) !== 443) {
    const host = topology === "stage" ? o.host || STAGE_HOST_PLACEHOLDER : CANONICAL;
    t = mustReplaceInCode(t, `https://${host}`, `https://${host}:${o.httpsPort}`, "https redirect targets (port suffix)");
  }
  if (!o.unchecked) assertRender(t, { mode, topology, identity, upstream }); // `unchecked`: only the real-Caddy mutation harness renders deliberately broken templates
  return { text: t, mode, topology, upstream };
}

/** Invariants of every render (cheap string checks; the semantic checks are test:redirects and the real-Caddy run). */
export function assertRender(text, { mode, topology, identity, upstream }) {
  const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const fail = (m) => { throw new Error(`render invariant violated (${mode}): ${m}`); };
  if (/api\.copilt\.org/.test(code)) fail("api.copilt.org appears in code");
  if (mode === "production" && code.includes("aicc-stage-identity")) fail("the production render contains the stage identity route");
  if (identity && !code.includes(IDENTITY_PATH)) fail("the identity route is missing");
  if (!identity && code.includes("aicc-stage-identity")) fail("an identity route is present although none was requested");
  if (topology === "stage" && !/X-Robots-Tag "noindex/.test(code)) fail("the stage render lacks the X-Robots-Tag noindex header");
  if (topology !== "stage" && /X-Robots-Tag/.test(code)) fail("the production topology carries X-Robots-Tag (only the staging host is noindex)");
  if (topology === "stage" && /^(https?:\/\/)?copilt\.org\b/m.test(code)) fail("the stage render has an apex site block");
  if (/Alt-Svc\s+"/.test(code)) fail("an Alt-Svc value is set (HTTP/3 is off)");
  if (upstream === "fastcgi" && /^\s*import wp_proxy_http\s*$/m.test(code.split("(wp_proxy) {")[1]?.split("\n}\n")[0] || "")) fail("fastcgi render selects the http proxy");
}
