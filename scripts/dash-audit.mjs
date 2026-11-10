#!/usr/bin/env node
// Typography audit: no em dash (U+2014) and no en dash (U+2013) in CUSTOMER-FACING text (owner rule, global).
//
//   node scripts/dash-audit.mjs --list [--all] [--json] [--root DIR]   every dash by file, line, class (string / comment / regex / text) ; --all adds the out-of-scope files
//   node scripts/dash-audit.mjs --check [--root DIR]                   exit 1 on any customer-facing hit that is not covered by scripts/dash-allowlist.json (a stale allow-list entry also fails)
//   node scripts/dash-audit.mjs --check --out DIR [--allowlist FILE]   the same for a BUILT export (HTML visible text, attributes / meta, JSON-LD, RSC payload and other script data, JS chunk strings, text files)
//   node scripts/dash-audit.mjs --fix [--root DIR]                     dry run: the reviewable diff of the rewrite (nothing is written)
//   node scripts/dash-audit.mjs --fix --write [--root DIR]             apply it
//   node scripts/dash-audit.mjs --self-test                            proves the check fails on injected dashes and passes on a comment (runs inside `npm run copy:check`)
//
// What is customer-facing (scanned string-literal-aware, so a dash inside a comment never counts):
//   src/**/*.ts|tsx        TypeScript compiler API: StringLiteral, template literals, JsxText (also the entity forms &mdash; &ndash; &#8212; &#8211;) and "\u2014"-style escapes
//   brand/js/**/*.js       the same parser in JavaScript mode (the brand kit scripts that ship to the Control Plane theme)
//   brand/**/*.json        every JSON string (content/, i18n/ ; i18n/strings.json is GENERATED: fix the source, then `npm run brand:build`)
//   src|brand **/*.css     strings and "\2014" escapes (CSS comments are ignored)
//   public/**              text files (security.txt, robots, vtt, xml, json ...) as a whole
// Regex literals are classed "regex" (code, never rendered) and reported but they do not fail the check.
// Out of scope by the owner brief (listed with --all only): comments anywhere, docs/, infra/, scripts/, tests/, *.md.
// The rewrite (--fix): every dash becomes the ASCII hyphen-minus U+002D, keeping the surrounding (no-break) spaces ("a\u00a0\u2014 b" becomes "a\u00a0- b"); the hand rewrites where a hyphen would sound
// awkward live in scripts/dash-overrides.mjs and run first. Hebrew / Spanish / English never needed either; the tool treats every locale alike.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
// every spelling of the two characters: the characters themselves, JS / JSON "\u2014" "\u{2014}" escapes, HTML entities
const DASH_RE = () => /[\u2013\u2014]|\\u(?:2013|2014)|\\u\{0*(?:2013|2014)\}|&(?:mdash|ndash);|&#(?:x0*(?:2013|2014)|0*(?:8211|8212));/gi;
const CSS_ESC_RE = () => /\\0*(?:2013|2014)(?![0-9a-fA-F])/g;
const SKIP_DIR = new Set(["node_modules", ".next", "out", ".git", ".turbo", "coverage"]);

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);

function* walk(dir, base = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && SKIP_DIR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, base);
    else if (e.isFile()) yield p;
  }
}
const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");
const lineCol = (text, i) => { let line = 1, last = -1; for (let k = text.indexOf("\n"); k !== -1 && k < i; k = text.indexOf("\n", k + 1)) { line++; last = k; } return { line, col: i - last }; };
const snippet = (text, i, len) => text.slice(Math.max(0, i - 36), i).replace(/\s+/g, " ") + "[" + text.slice(i, i + len) + "]" + text.slice(i + len, i + len + 36).replace(/\s+/g, " ");
const cp = (s) => (/^[\u2013\u2014]$/.test(s) ? "U+" + s.codePointAt(0).toString(16).toUpperCase() : s);

// ---------- classification of one file ----------
// A hit: { start, len, text, kind } ; kind: string | text | regex | comment | other   (string / text are customer-facing)
function tsRanges(file, text) {
  const ext = path.extname(file).toLowerCase();
  const kind = ext === ".tsx" ? ts.ScriptKind.TSX : ext === ".ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const ranges = [];
  const visit = (n) => {
    const k = n.kind;
    if (k === ts.SyntaxKind.StringLiteral || k === ts.SyntaxKind.NoSubstitutionTemplateLiteral || k === ts.SyntaxKind.TemplateHead || k === ts.SyntaxKind.TemplateMiddle || k === ts.SyntaxKind.TemplateTail) ranges.push([n.getStart(sf), n.getEnd(), "string"]);
    else if (k === ts.SyntaxKind.JsxText) ranges.push([n.getFullStart(), n.getEnd(), "string"]);
    else if (k === ts.SyntaxKind.RegularExpressionLiteral) ranges.push([n.getStart(sf), n.getEnd(), "regex"]);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  ranges.sort((a, b) => a[0] - b[0]);
  return { ranges, parseErrors: sf.parseDiagnostics.length };
}
function classifyByRanges(text, ranges, dflt) {
  const out = [];
  const re = DASH_RE();
  let m, r = 0;
  while ((m = re.exec(text))) {
    while (r < ranges.length && ranges[r][1] <= m.index) r++;
    let kind = dflt;
    for (let q = r; q < ranges.length && ranges[q][0] <= m.index; q++) if (m.index < ranges[q][1]) { kind = ranges[q][2]; break; }
    out.push({ start: m.index, len: m[0].length, text: m[0], kind });
  }
  return { hits: out };
}
function jsonRanges(text) {
  const ranges = [];
  const re = /"(?:[^"\\]|\\.)*"/gs;
  let m;
  while ((m = re.exec(text))) ranges.push([m.index, m.index + m[0].length, "string"]);
  return ranges;
}
function cssRanges(text) {
  const ranges = [];
  const re = /\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
  let m;
  while ((m = re.exec(text))) ranges.push([m.index, m.index + m[0].length, m[0].startsWith("/*") ? "comment" : "string"]);
  return ranges;
}

/** scope of a repo-relative path: "ts" | "json" | "css" | "text" (customer-facing) or null (out of scope) */
function scopeOf(r) {
  if (/^src\/.*\.(ts|tsx)$/.test(r)) return "ts";
  if (/^brand\/js\/.*\.js$/.test(r)) return "ts";
  if (/^brand\/.*\.json$/.test(r)) return "json";
  if (/^(src|brand)\/.*\.css$/.test(r)) return "css";
  if (/^public\/.*\.(txt|vtt|xml|json|webmanifest|html|svg|js|css)$/.test(r)) return "text";
  return null;
}
const OUT_OF_SCOPE_EXT = /\.(ts|tsx|js|mjs|json|css|md|py|sh|php|txt|yml|yaml|html|svg|vtt|xml|toml)$/;

function analyzeFile(root, file, rtype) {
  const r = rel(root, file);
  const scope = rtype ?? scopeOf(r);
  if (!scope) return null;
  const text = fs.readFileSync(file, "utf8");
  if (!DASH_RE().test(text)) return { rel: r, scope, text, hits: [], parseErrors: 0 };
  let hits, parseErrors = 0;
  if (scope === "ts") { const t = tsRanges(file, text); parseErrors = t.parseErrors; hits = classifyByRanges(text, t.ranges, "comment").hits; }
  else if (scope === "json") hits = classifyByRanges(text, jsonRanges(text), "other").hits;
  else if (scope === "css") {
    hits = classifyByRanges(text, cssRanges(text), "other").hits.map((h) => (h.kind === "other" ? { ...h, kind: "string" } : h));
    const re = CSS_ESC_RE(); let m; while ((m = re.exec(text))) hits.push({ start: m.index, len: m[0].length, text: m[0], kind: "string" });
  } else hits = classifyByRanges(text, [[0, text.length, "text"]], "text").hits;
  return { rel: r, scope, text, hits, parseErrors };
}

// ---------- allow-list ----------
function loadAllow(root, which) {
  const f = [opt("--allowlist"), path.join(root, "scripts", "dash-allowlist.json"), path.join(HERE, "dash-allowlist.json")].filter(Boolean).find((p) => fs.existsSync(p));
  if (!f) return [];
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  return (j.allow || []).filter((e) => (e.scope || "source") === which);
}
const globRe = (g) => new RegExp("^" + g.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");
/** applies the allow-list to failing hits [{rel, ...}]; returns { failing, problems } (problems = stale / over-cap entries) */
function applyAllow(failing, allow) {
  const used = allow.map(() => 0);
  const rest = [];
  for (const h of failing) {
    const i = allow.findIndex((e) => globRe(e.path).test(h.rel));
    if (i === -1) { rest.push(h); continue; }
    used[i]++;
    if (used[i] > e_max(allow[i])) rest.push({ ...h, over: allow[i] });
  }
  const problems = [];
  allow.forEach((e, i) => {
    if (!e.reason || String(e.reason).length < 10) problems.push(`allow-list entry "${e.path}" has no reason`);
    if (used[i] === 0) problems.push(`allow-list entry "${e.path}" matches nothing (stale: delete it)`);
  });
  return { failing: rest, problems };
}
const e_max = (e) => (Number.isInteger(e.max) ? e.max : 0);

// ---------- source scan ----------
function scanSource(root) {
  const files = [];
  for (const p of walk(root)) {
    const r = rel(root, p);
    if (scopeOf(r)) { const a = analyzeFile(root, p); if (a) files.push(a); }
  }
  return files;
}
function outOfScope(root) {
  const res = [];
  for (const p of walk(root)) {
    const r = rel(root, p);
    if (scopeOf(r) || !OUT_OF_SCOPE_EXT.test(r) || /^package-lock\.json$|^scripts\/dash-audit\.mjs$/.test(r)) continue;
    let text; try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
    const n = (text.match(DASH_RE()) || []).length;
    if (n) res.push({ rel: r, count: n });
  }
  return res;
}

// ---------- built export scan ----------
const TOKEN_RE = () => /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<[^>]*>/gi;
function scanHtml(text) {
  const hits = [];
  const push = (kind, base, seg) => { const re = DASH_RE(); let m; while ((m = re.exec(seg))) hits.push({ start: base + m.index, len: m[0].length, text: m[0], kind }); };
  const re = TOKEN_RE();
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) push("text", last, text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("<!--")) push("comment", m.index, t);
    else if (/^<script/i.test(t)) {
      const open = t.match(/^<script\b[^>]*>/i)[0], body = t.slice(open.length);
      push("attribute", m.index, open);
      push(/ld\+json/i.test(open) ? "json-ld" : /__next_f/.test(body) ? "rsc" : "script", m.index + open.length, body);
    } else if (/^<style/i.test(t)) push("css", m.index, t);
    else push(/^<meta\b/i.test(t) ? "meta" : "attribute", m.index, t);
    last = m.index + t.length;
  }
  if (last < text.length) push("text", last, text.slice(last));
  return hits;
}
function scanOut(outDir) {
  const files = [];
  for (const p of walk(outDir)) {
    const r = rel(outDir, p);
    if (/\.(jpe?g|png|webp|gif|ico|woff2?|ttf|mp4|webm|map|gz|br|zip)$/i.test(r)) continue;
    let text; try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
    if (text.includes("\u0000")) continue;
    if (!DASH_RE().test(text)) { files.push({ rel: r, hits: [], text }); continue; }
    let hits;
    if (/\.html?$/i.test(r)) hits = scanHtml(text);
    else if (/\.js$/i.test(r)) { const t = tsRanges(p, text); hits = classifyByRanges(text, t.ranges, "comment").hits; }
    else if (/\.css$/i.test(r)) { hits = classifyByRanges(text, cssRanges(text), "other").hits.map((h) => (h.kind === "other" ? { ...h, kind: "string" } : h)); }
    else if (/\.json$/i.test(r)) hits = classifyByRanges(text, jsonRanges(text), "other").hits;
    else hits = classifyByRanges(text, [[0, text.length, "text"]], "text").hits;
    files.push({ rel: r, hits, text });
  }
  return files;
}
// kinds that fail: everything a visitor can read or a crawler can see
const FAILS = new Set(["string", "text", "meta", "attribute", "json-ld", "rsc", "script", "other"]);
// "other" in a JSON file is impossible; in a .js chunk "comment" is a comment; "css" is an inline <style> (class names / comments only)

function evaluate(files, allow) {
  const failing = [];
  const info = [];
  for (const f of files) for (const h of f.hits) {
    const lc = lineCol(f.text, h.start);
    const row = { rel: f.rel, line: lc.line, col: lc.col, kind: h.kind, text: h.text, ctx: snippet(f.text, h.start, h.len) };
    if (FAILS.has(h.kind)) failing.push(row); else info.push(row);
  }
  const { failing: rest, problems } = applyAllow(failing, allow);
  return { failing: rest, allowed: failing.length - rest.length, info, problems };
}

// ---------- fix ----------
const GENERATED = new Set(["brand/i18n/strings.json"]); // written by scripts/build-brand-strings.mjs from src/i18n: never hand-edited
let OVERRIDES = [];
async function loadOverrides(root) {
  const f = [path.join(root, "scripts", "dash-overrides.mjs"), path.join(HERE, "dash-overrides.mjs")].find((p) => fs.existsSync(p));
  if (!f) return [];
  const mod = await import(pathToFileURL(f).href);
  return mod.default || [];
}
const toHyphen = (raw) => raw.replace(DASH_RE(), "-");
function fixRaw(raw, relPath, used) {
  let out = raw;
  for (const o of OVERRIDES) {
    if (o.file !== relPath || !out.includes(o.from)) continue;
    out = out.split(o.from).join(o.to);
    used.add(o);
  }
  return toHyphen(out);
}
function fixFile(a) {
  // returns { text, changes:[{line, before, after}] } for the customer-facing hits of one analysed file
  const used = new Set();
  const edits = [];
  if (a.scope === "ts" || a.scope === "json" || a.scope === "css") {
    const ranges = a.scope === "ts" ? tsRanges(path.join("/", a.rel), a.text).ranges : a.scope === "json" ? jsonRanges(a.text) : cssRanges(a.text);
    for (const [s, e, k] of ranges) {
      if (k !== "string") continue;
      const raw = a.text.slice(s, e);
      if (!DASH_RE().test(raw) && !(a.scope === "css" && CSS_ESC_RE().test(raw))) continue;
      const fixed = a.scope === "css" ? fixRaw(raw, a.rel, used).replace(CSS_ESC_RE(), "-") : fixRaw(raw, a.rel, used);
      if (fixed !== raw) edits.push([s, e, raw, fixed]);
    }
  } else if (a.scope === "text") {
    const fixed = fixRaw(a.text, a.rel, used);
    if (fixed !== a.text) edits.push([0, a.text.length, a.text, fixed]);
  }
  let text = a.text;
  const changes = [];
  for (const [s, e, raw, fixed] of edits.sort((x, y) => y[0] - x[0])) {
    text = text.slice(0, s) + fixed + text.slice(e);
    changes.unshift({ line: lineCol(a.text, s).line, before: raw, after: fixed });
  }
  return { text, changes, used };
}

// ---------- self-test ----------
function selfTest() {
  const ED = "\u2014", EN = "\u2013";
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dash-audit-"));
  const problems = [];
  const write = (root, r, c) => { const p = path.join(root, r); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
  const clean = (root) => {
    write(root, "src/i18n/ru.ts", `// a comment may use a dash ${ED} (comments are not customer-facing)\nexport const ru = { a: "\u0422\u0435\u043a\u0441\u0442 \u0431\u0435\u0437 \u0442\u0438\u0440\u0435 - \u0441 \u0434\u0435\u0444\u0438\u0441\u043e\u043c", b: \`range 2-3 \${1}\`, re: /[${EN}${ED}]+/ };\n/* block ${EN} comment */\n`);
    write(root, "src/components/pages/Demo.tsx", `export function Demo() {\n  // jsx comment ${ED}\n  return <p title="plain">Hello - world &amp; more</p>;\n}\n`);
    write(root, "brand/content/faq.ru.json", JSON.stringify({ items: [{ q: "\u0412\u043e\u043f\u0440\u043e\u0441?", a: "\u041e\u0442\u0432\u0435\u0442 - \u0431\u0435\u0437 \u0442\u0438\u0440\u0435." }] }, null, 2));
    write(root, "brand/js/fbt-demo.js", `const s = \`<span aria-hidden="true">-</span>\`; // glyph ${EN} in a comment\n`);
    write(root, "brand/aicc-tokens.css", `/* css comment ${ED} */\n:root{--a:1}\n`);
    write(root, "public/.well-known/security.txt", "Contact: mailto:security@example.org\n");
    write(root, "scripts/dash-allowlist.json", JSON.stringify({ allow: [] }));
  };
  const cleanOut = (root) => {
    write(root, "index.html", `<!DOCTYPE html><html lang="ru"><head><title>AICC - title</title><meta name="description" content="Plain description."/><script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"name":"Q","acceptedAnswer":{"text":"Plain answer."}}]}</script></head><body><!-- build note ${ED} comment --><h1>Hello</h1><script>self.__next_f.push([1,"Plain payload"])</script></body></html>`);
    write(root, "_next/static/chunks/app.js", `var a="ok";var re=/[${EN}${ED}]/;// ${ED} comment\n`);
    write(root, "robots.txt", "User-agent: *\nAllow: /\n");
  };
  const emptyAllow = path.join(tmpRoot, "empty-allowlist.json"); fs.writeFileSync(emptyAllow, JSON.stringify({ allow: [] }));
  const runCli = (extra) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...extra, ...(extra.includes("--out") ? ["--allowlist", emptyAllow] : [])], { encoding: "utf8" });
  const mkSrc = (name, mutate) => { const root = path.join(tmpRoot, name); clean(root); mutate(root); return root; };
  const mkOut = (name, mutate) => { const root = path.join(tmpRoot, name); cleanOut(root); mutate(root); return root; };
  const mustFail = (label, args, expectFile, expectKind) => {
    const r = runCli(args);
    const text = (r.stdout || "") + (r.stderr || "");
    if (r.status === 0) problems.push(`${label}: --check passed but must FAIL`);
    else if (!text.includes(expectFile) || !text.includes(expectKind)) problems.push(`${label}: failed, but the report does not name ${expectFile} / ${expectKind}: ${text.slice(0, 200)}`);
  };
  const mustPass = (label, args) => { const r = runCli(args); if (r.status !== 0) problems.push(`${label}: --check must PASS: ${((r.stdout || "") + (r.stderr || "")).slice(0, 300)}`); };
  try {
    // baseline + passes
    const c0 = mkSrc("clean-src", () => {}); mustPass("clean source tree (dashes only in comments, a regex and ASCII hyphens)", ["--check", "--root", c0]);
    const o0 = mkOut("clean-out", () => {}); mustPass("clean export (dashes only in an HTML comment, a JS regex and a JS comment)", ["--check", "--out", o0]);
    const c1 = mkSrc("comment-only", (r) => write(r, "src/lib/x.ts", `// a comment ${ED} and ${EN}\n/** doc ${ED} */\nexport const x = 1; // trailing ${ED}\n`)); mustPass("a dash in a TS comment", ["--check", "--root", c1]);
    // six required mutations + extras: each MUST fail
    const m1 = mkSrc("m1-ru-string", (r) => write(r, "src/i18n/ru.ts", `export const ru = { a: "\u041a\u043e\u0444\u0435\\u00a0${ED} \u0432 \u043a\u043e\u0440\u0437\u0438\u043d\u0435" };\n`)); mustFail("M1 Russian string", ["--check", "--root", m1], "src/i18n/ru.ts", "string");
    const m2 = mkSrc("m2-faq-json", (r) => write(r, "brand/content/faq.ru.json", JSON.stringify({ items: [{ q: "Q", a: `\u041e\u0442\u0432\u0435\u0442 ${ED} \u0441 \u0442\u0438\u0440\u0435.` }] }))); mustFail("M2 FAQ JSON answer", ["--check", "--root", m2], "brand/content/faq.ru.json", "string");
    const m3 = mkSrc("m3-tsx-literal", (r) => write(r, "src/components/pages/Demo.tsx", `export const T = () => <a title="Save ${EN} now">Go</a>;\n`)); mustFail("M3 TSX attribute literal", ["--check", "--root", m3], "src/components/pages/Demo.tsx", "string");
    const m3b = mkSrc("m3b-jsx-text", (r) => write(r, "src/components/pages/Demo.tsx", `export const T = () => <p>Fast ${ED} and simple</p>;\n`)); mustFail("M3b JSX text", ["--check", "--root", m3b], "src/components/pages/Demo.tsx", "string");
    const m3c = mkSrc("m3c-entity", (r) => write(r, "src/components/pages/Demo.tsx", "export const T = () => <p>Fast &mdash; and simple</p>;\n")); mustFail("M3c JSX entity &mdash;", ["--check", "--root", m3c], "src/components/pages/Demo.tsx", "string");
    const m3d = mkSrc("m3d-escape", (r) => write(r, "src/i18n/en.ts", "export const en = { a: \"Fast \\u2014 simple\", b: `x \\u{2013} y` };\n")); mustFail("M3d escaped \\u2014 in a string", ["--check", "--root", m3d], "src/i18n/en.ts", "string");
    const m6 = mkSrc("m6-kit-js", (r) => write(r, "brand/js/fbt-demo.js", "const s = `<span aria-hidden=\"true\">" + EN + "</span>`;\n")); mustFail("M6 brand kit JS template string", ["--check", "--root", m6], "brand/js/fbt-demo.js", "string");
    const m6b = mkSrc("m6b-strings-json", (r) => write(r, "brand/i18n/strings.json", JSON.stringify({ ru: { demo: { x: `\u0422\u043e\u0432\u0430\u0440 ${ED} \u0433\u043b\u0430\u0432\u043d\u044b\u0439` } } }))); mustFail("M6b generated strings.json", ["--check", "--root", m6b], "brand/i18n/strings.json", "string");
    const m4 = mkOut("m4-meta", (r) => write(r, "index.html", fs.readFileSync(path.join(o0, "index.html"), "utf8").replace("Plain description.", `A tool ${ED} for stores.`))); mustFail("M4 meta description", ["--check", "--out", m4], "index.html", "meta");
    const m5 = mkOut("m5-jsonld", (r) => write(r, "index.html", fs.readFileSync(path.join(o0, "index.html"), "utf8").replace("Plain answer.", `Answer ${EN} here.`))); mustFail("M5 JSON-LD answer", ["--check", "--out", m5], "index.html", "json-ld");
    const m7 = mkOut("m7-rsc", (r) => write(r, "index.html", fs.readFileSync(path.join(o0, "index.html"), "utf8").replace("Plain payload", `Payload ${ED} text`))); mustFail("M7 RSC payload string", ["--check", "--out", m7], "index.html", "rsc");
    const m8 = mkOut("m8-visible", (r) => write(r, "index.html", fs.readFileSync(path.join(o0, "index.html"), "utf8").replace("<h1>Hello</h1>", `<h1>Hello ${ED} world</h1>`))); mustFail("M8 visible text", ["--check", "--out", m8], "index.html", "text");
    const m9 = mkOut("m9-chunk", (r) => write(r, "_next/static/chunks/app.js", `var a="bad ${ED} string";\n`)); mustFail("M9 JS chunk string", ["--check", "--out", m9], "_next/static/chunks/app.js", "string");
    const m10 = mkOut("m10-entity", (r) => write(r, "index.html", fs.readFileSync(path.join(o0, "index.html"), "utf8").replace("<h1>Hello</h1>", "<h1>Hello &mdash; world</h1>"))); mustFail("M10 HTML entity", ["--check", "--out", m10], "index.html", "text");
    // allow-list: a covered hit passes, an over-cap hit fails, a stale entry fails
    const a1 = mkSrc("allow-ok", (r) => { write(r, "src/lib/legacy.ts", `export const x = "a ${ED} b";\n`); write(r, "scripts/dash-allowlist.json", JSON.stringify({ allow: [{ path: "src/lib/legacy.ts", max: 1, reason: "self-test: a documented exception" }] })); }); mustPass("an allow-listed hit within its cap", ["--check", "--root", a1]);
    const a2 = mkSrc("allow-cap", (r) => { write(r, "src/lib/legacy.ts", `export const x = "a ${ED} b", y = "c ${ED} d";\n`); write(r, "scripts/dash-allowlist.json", JSON.stringify({ allow: [{ path: "src/lib/legacy.ts", max: 1, reason: "self-test: a documented exception" }] })); }); mustFail("an allow-listed file over its cap", ["--check", "--root", a2], "src/lib/legacy.ts", "string");
    const a3 = mkSrc("allow-stale", (r) => write(r, "scripts/dash-allowlist.json", JSON.stringify({ allow: [{ path: "src/lib/gone.ts", max: 1, reason: "self-test: a stale exception" }] }))); mustFail("a stale allow-list entry", ["--check", "--root", a3], "stale", "stale");
    // --fix: the rewrite removes the dash from a string, keeps the NBSP, and leaves comments and regexes alone
    const f1 = mkSrc("fix", (r) => write(r, "src/i18n/ru.ts", `// keep ${ED}\nexport const ru = { a: "\u0414\u0430\\u00a0${ED} \u043d\u0435\u0442", b: /${ED}/ };\n`));
    const fx = runCli(["--fix", "--write", "--root", f1]);
    const after = fs.readFileSync(path.join(f1, "src/i18n/ru.ts"), "utf8");
    if (fx.status !== 0 || !after.includes("\\u00a0- \u043d\u0435\u0442") || !after.includes(`// keep ${ED}`) || !after.includes(`/${ED}/`)) problems.push(`--fix --write did not rewrite as specified: ${after}`);
    mustPass("source after --fix", ["--check", "--root", f1]);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  if (problems.length) { console.error("dash-audit self-test FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
  console.log("dash-audit self-test PASS: clean trees pass (comment, regex, ASCII hyphen); 14 injected dashes fail (Russian string, FAQ JSON answer, TSX attribute, JSX text, entity, \\u escape, kit JS string, strings.json, meta description, JSON-LD answer, RSC payload, visible HTML text, JS chunk string, HTML entity); allow-list cap + stale entry fail; --fix rewrite verified");
}

// ---------- main ----------
async function main() {
  if (flag("--self-test")) return selfTest();
  const root = path.resolve(opt("--root") || REPO);
  const outDir = opt("--out");
  const json = flag("--json");

  if (outDir) {
    const dir = path.resolve(outDir);
    if (!fs.existsSync(dir)) { console.error(`dash-audit: --out ${dir} does not exist`); process.exit(2); }
    const files = scanOut(dir);
    const ev = evaluate(files, loadAllow(root, "export"));
    const byKind = {};
    for (const f of files) for (const h of f.hits) byKind[h.kind] = (byKind[h.kind] || 0) + 1;
    if (flag("--list") || json) {
      const all = files.flatMap((f) => f.hits.map((h) => ({ file: f.rel, ...lineCol(f.text, h.start), kind: h.kind, char: cp(h.text), ctx: snippet(f.text, h.start, h.len) })));
      if (json) console.log(JSON.stringify({ out: dir, files: files.length, byKind, hits: all }, null, 1));
      else { all.forEach((h) => console.log(`${h.file}:${h.line}:${h.col}  [${h.kind}]  ${h.char}  ${h.ctx}`)); console.log(`${all.length} hit(s) in ${files.length} files  ${JSON.stringify(byKind)}`); }
      if (!flag("--check")) return;
    }
    ev.failing.slice(0, 60).forEach((h) => console.error(`  ${h.rel}:${h.line}:${h.col}  [${h.kind}]  ${cp(h.text)}  ${h.ctx}`));
    ev.problems.forEach((p) => console.error("  " + p));
    if (ev.failing.length || ev.problems.length) { console.error(`dash-audit --out: FAIL ${ev.failing.length} customer-facing dash(es) in the built export${ev.problems.length ? `, ${ev.problems.length} allow-list problem(s) (stale)` : ""}`); process.exit(1); }
    console.log(`dash-audit --out: PASS scanned ${files.length} files of ${dir}: 0 dashes in visible text, attributes / meta, JSON-LD, RSC / script data and JS strings (${ev.info.length} in comments / regex literals; ${ev.allowed} allow-listed)`);
    return;
  }

  const files = scanSource(root);

  if (flag("--fix")) {
    OVERRIDES = await loadOverrides(root);
    const allowFix = loadAllow(root, "source");
    const write = flag("--write");
    let total = 0, changedFiles = 0;
    const usedAll = new Set();
    for (const a of files) {
      if (!a.hits.some((h) => FAILS.has(h.kind))) continue;
      if (GENERATED.has(a.rel)) { console.log(`--- ${a.rel}: GENERATED, not edited (fix its source, then run \`npm run brand:build\`)`); continue; }
      if (allowFix.some((e) => globRe(e.path).test(a.rel))) { console.log(`--- ${a.rel}: ALLOW-LISTED, not edited (see scripts/dash-allowlist.json)`); continue; }
      const fx = fixFile(a);
      fx.used.forEach((u) => usedAll.add(u));
      if (!fx.changes.length) continue;
      changedFiles++; total += fx.changes.length;
      console.log(`--- ${a.rel}`);
      for (const c of fx.changes) { console.log(`@@ line ${c.line}`); console.log(`- ${c.before}`); console.log(`+ ${c.after}`); }
      if (write) {
        if (a.scope === "json") JSON.parse(fx.text); // the rewrite must stay valid JSON
        fs.writeFileSync(path.join(root, a.rel), fx.text);
      }
    }
    const stale = OVERRIDES.filter((o) => !usedAll.has(o) && files.some((f) => f.rel === o.file));
    stale.forEach((o) => console.error(`note: override for ${o.file} did not apply (already fixed or text changed): ${JSON.stringify(o.from).slice(0, 90)}`));
    console.log(`${write ? "WROTE" : "DRY RUN (nothing written; add --write)"}: ${total} string(s) rewritten in ${changedFiles} file(s)`);
    if (write) console.log("next: if brand/content/** or src/i18n/** changed run `npm run brand:build` (strings.json and MANIFEST.json are generated)");
    return;
  }

  const ev = evaluate(files, loadAllow(root, "source"));
  if (flag("--list") || json) {
    const rows = files.flatMap((f) => f.hits.map((h) => ({ file: f.rel, ...lineCol(f.text, h.start), kind: h.kind, char: cp(h.text), ctx: snippet(f.text, h.start, h.len) })));
    const oos = flag("--all") ? outOfScope(root) : [];
    const byKind = {}; rows.forEach((r) => (byKind[r.kind] = (byKind[r.kind] || 0) + 1));
    const byFile = {}; rows.forEach((r) => { byFile[r.file] = byFile[r.file] || {}; byFile[r.file][r.kind] = (byFile[r.file][r.kind] || 0) + 1; });
    if (json) console.log(JSON.stringify({ root, byKind, byFile, outOfScope: oos, hits: rows }, null, 1));
    else {
      rows.forEach((r) => console.log(`${r.file}:${r.line}:${r.col}  [${r.kind}]  ${r.char}  ${r.ctx}`));
      console.log(`in-scope hits: ${rows.length} ${JSON.stringify(byKind)} (customer-facing = string / text / other; comment and regex never fail)`);
      if (oos.length) { oos.forEach((o) => console.log(`out of scope: ${o.rel}  ${o.count}`)); console.log(`out of scope total: ${oos.reduce((s, o) => s + o.count, 0)} in ${oos.length} files`); }
    }
    if (!flag("--check")) return;
  }
  ev.failing.slice(0, 60).forEach((h) => console.error(`  ${h.rel}:${h.line}:${h.col}  [${h.kind}]  ${cp(h.text)}  ${h.ctx}${h.over ? `  (allow-list cap ${h.over.max} exceeded)` : ""}`));
  ev.problems.forEach((p) => console.error("  " + p));
  const bad = files.filter((f) => f.parseErrors).map((f) => f.rel);
  if (bad.length) console.error(`  note: parse diagnostics in ${bad.join(", ")} (strings were still classified)`);
  if (ev.failing.length || ev.problems.length) {
    console.error(`dash-audit: FAIL ${ev.failing.length} customer-facing em / en dash(es)${ev.problems.length ? `, ${ev.problems.length} stale allow-list problem(s)` : ""}. Use an ASCII hyphen (or rephrase); see scripts/dash-audit.mjs --fix`);
    process.exit(1);
  }
  console.log(`dash-audit: PASS scanned ${files.length} customer-facing source files: 0 em / en dashes in strings, JSX text, JSON and public text (${ev.info.length} in comments / regex literals, not rendered; ${ev.allowed} allow-listed)`);
}
main().catch((e) => { console.error(e); process.exit(2); });
