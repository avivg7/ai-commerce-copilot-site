// Public-truth rules (round 3, "pre-commercial" state): what a PUBLIC page must never show while the website is live but commercial checkout is not.
// Pure functions: no network, no file system. Shared by scripts/public-truth-gate.mjs (the crawler + CLI + mutation self-test).
//
// Two families of rules:
//   WORDING rules run on what a visitor can read or a crawler indexes: the visible text, the <title>, the meta description / Open Graph text and the title / alt / aria-label
//     attributes. They find internal-looking placeholders ("(pending)", "Support details will be published before launch", TODO / TBD, "placeholder"), launch-test language,
//     test sentinel values, and the claims the owner banned (free trial, Shopify, WordPress.org install, conversion / AOV percentages, same-category fallback, AI / semantic
//     cold start, "Frequently Bought Together" as AICC's identity). The ban list that already guards the source (scripts/lib/launch-truth.mjs TRUTH_RULES) is reused as-is.
//   MARKUP rules run on the raw document: noindex / staging markers, stage or loopback or apex or http:// URLs, a missing or wrong canonical, source-map references.
// A rule is never weakened to make a page pass: fix the page. Each rule has a sample in SELF_TEST (a sentence that must be caught) and CLEAN_SAMPLES (must not be).
import { truthProblems } from "./launch-truth.mjs";

export const CANONICAL_ORIGIN = "https://www.copilt.org";

const NEG = /\b(no|not|never|without|nor|neither|nothing|n't|cannot|does not|doesn't|isn't)\b/i;
const DECODE = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&rsquo;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

/** WORDING rules: [id, regex, why, options]. `negatable`: a sentence that denies it passes. `question`: a question passes. `fieldsOnly`: only for the title / headings / meta text. */
export const WORDING_RULES = [
  // Internal-looking placeholders and pre-launch phrases
  ["pending-marker", /\(pending\)|\bpending\b[^.]{0,30}\blegal review\b|\blegal review\b[^.]{0,30}\bpending\b|\bDraft: pending\b|\bValues marked\b/i, "an internal '(pending)' marker or 'legal review pending' wording"],
  ["published-before-launch", /\b(will be |to be )?published before (the )?launch\b|\bbefore launch\.?$|\bdetails? will be published\b/i, "'will be published before launch' (internal pre-launch placeholder line)"],
  ["todo-tbd", /\b(TODO|TBD|FIXME)\b|lorem ipsum|\bto be determined\b|\bT\.B\.D\b/, "TODO / TBD / FIXME / lorem ipsum / 'to be determined'"],
  ["placeholder-word", /\bplaceholders?\b|\bplace[- ]holders?\b/i, "the word 'placeholder' in public text"],
  ["draft-label", /\((draft)\)|^\s*Draft\b[: ]|\bdraft (last )?updated\b|\bversion: draft\b|\bnot yet approved\b|\bhas not been reviewed by a lawyer\b|\bdraft and has not\b|\bthis wording is a draft\b/i, "an internal 'draft' / 'not yet approved' / 'not reviewed by a lawyer' label (use the calm 'being finalized before purchases open' statement)"],
  // The same internal labels in the other three languages (the old dictionary wording and its obvious variants): he / es / ru pages must be as clean as the English ones.
  ["internal-label-es", /Borrador[: ]|\(borrador\)|pendiente de revisi[oó]n legal|se publicar[aá]n? antes del lanzamiento|antes del lanzamiento\.?$|no lo ha revisado un abogado/, "es: an internal draft / pending-review / 'published before launch' label"],
  ["internal-label-ru", /Черновик[: ]|\(черновик\)|ожидает юридической проверки|опубликован\S* до\s*запуска|до\s*запуска\.?$|не\s*проверял юрист/, "ru: an internal draft / pending-review / 'published before launch' label"],
  ["internal-label-he", /טיוטה:|\(טיוטה\)|הממתינה לבדיקה משפטית|ממתינה לבדיקה משפטית|יפורסמ\S* לפני ההשקה|לפני ההשקה\.?$|הטיוטה עודכנה|לא נבדק על ידי עורך דין/, "he: an internal draft / pending-review / 'published before launch' label"],
  // Launch-test language and test sentinels
  ["launch-test-language", /\b(test mode|sandbox|rehearsal|dummy (data|text|store|account)|fake (data|store|account|payment)|for testing( purposes)?|test purposes|QA only|not a real payment|launch[- ]test|smoke test)\b/i, "launch-test / QA / staging language"],
  ["qa-word", /(^|[^A-Za-z])QA([^A-Za-z]|$)/, "'QA' in public text"],
  ["placeholder-gateway", /Direct bank transfer|Check payments|Cash on delivery/i, "a WooCommerce placeholder payment method label"],
  ["sentinel-value", /Example Ltd|example\.test|1 Example Street|Example Pay\b|Example (city|region|law)\b|@example\.(com|org|net)|\bexample\.invalid\b|aicc-qa\b|\bAI Commerce Copilot \(QA\)/i, "a test sentinel value (Example Ltd, support@example.test, 1 Example Street, Example Pay ...)"],
  ["loopback-or-stage-text", /\blocalhost\b|127\.0\.0\.1|\b0\.0\.0\.0\b|\bstage[a-z0-9-]*\.copilt\.org\b/i, "localhost / 127.0.0.1 / a stage host named in public text"],
  // Banned claims (owner rules)
  ["free-trial", /\bfree[- ]trial\b|\btry (it |AICC |this )?(for )?free\b|\b\d+[- ]day (free )?trial\b|\bno credit card( required| needed)?\b|\bfree for \d+ days\b|\bstart (your |a )?free\b|\bfreemium\b/i, "free-trial language (no free flow exists)", { negatable: true }],
  ["shopify-live", /\bshopify\b|\bbigcommerce\b|\bmagento\b|\bsquarespace\b/i, "another e-commerce platform named (WooCommerce is the only supported platform)"],
  ["wordpress-org-install", /wordpress\.org|plugin directory|plugin repository|wordpress plugin (store|marketplace)|one[- ]click install|install(s|ed)? from (the )?wordpress|available (on|in) the wordpress/i, "a WordPress.org / plugin-directory install claim (AICC is not listed there)"],
  ["conversion-aov-percentage", /\b(increase|boost|lift|raise|grow|improve|improves|raises|boosts|increases|uplift|average|up to|by)\b[^.!?]{0,70}\b(conversions?( rates?)?|AOV|average order value|order value|revenue|sales|basket size|cart size)\b[^.!?]{0,50}\b\d+(\.\d+)?\s?%|\b\d+(\.\d+)?\s?%\s*(more|higher|increase|lift|boost|uplift|growth|bigger)\b[^.!?]{0,60}\b(conversions?|AOV|order value|revenue|sales|basket|cart)\b|\b\d+(\.\d+)?\s?%\s*(conversion|AOV)\b/i, "an unsupported conversion / AOV / revenue percentage", { negatable: true }],
  ["fbt-as-identity", /\bAICC\s+(is|=)\s+(a |an |the |just |simply )?(simple |basic )?Frequently Bought Together\b|\bFrequently Bought Together (plugin|app|extension|tool|software|engine|copilot)\b|\bAICC,? (the )?Frequently Bought Together\b/i, "'Frequently Bought Together' presented as AICC's identity (it is the storefront widget name)", { negatable: true, question: true }],
  ["support-promise-unknown", /\bwe (reply|respond|answer)\b[^.]{0,40}\b(within|in under)\b|\b24\/7\b|\bround[- ]the[- ]clock\b/i, "a support response-time promise nobody has confirmed", { negatable: true }],
  ["checkout-implied-open", /\b(buy|purchase|order) (it |AICC |a plan |your plan )?(now|today)\b|\bcheckout is (open|live)\b|\bpurchases are open\b|\bstart your subscription\b/i, "wording that says purchases are open now", { negatable: true, question: true }],
];

/** Headings / title / meta text only: "Frequently Bought Together" must not be the name of the product in the title, the first heading, the description or Open Graph text. */
const FIELD_RULES = [
  ["fbt-in-title", /Frequently Bought Together/i, "'Frequently Bought Together' in the <title>, the <h1> or the meta description / Open Graph text (the product is AICC; the widget is a feature)"],
];

const sentences = (text) => String(text).split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

/** Findings in a block of text: [{id, why, snippet}]. */
/** The launch-truth source rules are English phrases with English negations; on a he / es / ru page only the name-based ones apply (a Hebrew "we do not use an LLM provider" would otherwise match "LLM"). */
const LANG_AGNOSTIC_TRUTH = new Set(["other-platform", "wordpress-org", "encryption-at-rest"]);
export function wordingFindings(text, { lang = "en" } = {}) {
  const out = [];
  for (const s of sentences(text)) {
    for (const [id, re, why, opt = {}] of WORDING_RULES) {
      const m = s.match(re);
      if (!m) continue;
      if (opt.negatable && NEG.test(s)) continue;
      if (opt.question && /\?\s*$/.test(s)) continue;
      out.push({ id, why, snippet: s.slice(Math.max(0, m.index - 30), m.index + 80).replace(/\s+/g, " ").trim() });
    }
  }
  for (const p of truthProblems(text, { publicCopy: true })) if (lang === "en" || LANG_AGNOSTIC_TRUTH.has(p.id)) out.push({ id: "truth:" + p.id, why: p.why, snippet: p.snippet });
  return out;
}

export function fieldFindings(fields) {
  const out = [];
  for (const [name, value] of Object.entries(fields)) {
    if (!value) continue;
    for (const [id, re, why] of FIELD_RULES) { const m = value.match(re); if (m) out.push({ id, why, snippet: `${name}: ${value.slice(0, 100)}` }); }
  }
  return out;
}

/** Visible text of an HTML document plus the text-bearing attributes. Scripts, styles, templates and SVG internals are dropped (JSON-LD is returned separately). */
export function extractParts(html) {
  const jsonld = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const head = (html.match(/<head\b[\s\S]*?<\/head>/i) || [""])[0];
  const title = DECODE((head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [, ""])[1]).trim();
  const metaContent = (re) => { const m = head.match(re); return m ? DECODE(m[1]) : ""; };
  const description = metaContent(/<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=["']([^"']*)["']/i) || metaContent(/<meta\b[^>]*\bcontent=["']([^"']*)["'][^>]*\bname=["']description["']/i);
  const ogTitle = metaContent(/<meta\b[^>]*\bproperty=["']og:title["'][^>]*\bcontent=["']([^"']*)["']/i);
  const ogDescription = metaContent(/<meta\b[^>]*\bproperty=["']og:description["'][^>]*\bcontent=["']([^"']*)["']/i);
  const ogSite = metaContent(/<meta\b[^>]*\bproperty=["']og:site_name["'][^>]*\bcontent=["']([^"']*)["']/i);
  const body = (html.match(/<body\b[\s\S]*<\/body>/i) || [html])[0]
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const attrs = [...body.matchAll(/\b(?:title|alt|aria-label)=["']([^"']+)["']/gi)].map((m) => DECODE(m[1]));
  const h1 = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => DECODE(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
  const text = DECODE(body.replace(/<\/(p|li|h[1-6]|div|section|tr|td|th|ul|ol|dd|dt|header|footer|nav|main|article|button|label|span|a|small|strong|em|time|blockquote)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
  const jsonText = jsonld.map((j) => { try { const o = JSON.parse(j); const acc = []; (function v(x) { if (typeof x === "string") acc.push(x); else if (Array.isArray(x)) x.forEach(v); else if (x && typeof x === "object") Object.values(x).forEach(v); })(o); return acc.join("\n"); } catch { return ""; } }).join("\n");
  return { title, description, ogTitle, ogDescription, ogSite, h1, text, attrs, jsonText, head };
}

// URLs that must never appear in a public document. `http://www.w3.org` (SVG / XHTML namespace URIs) is not a link.
const URL_RULES = [
  ["stage-url", /https?:\/\/stage[a-z0-9-]*\.copilt\.org/i, "an absolute staging URL"],
  ["loopback-url", /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?/i, "an absolute localhost / 127.0.0.1 URL"],
  ["apex-url", /https?:\/\/copilt\.org(?![A-Za-z0-9.-])/i, "an apex (non-www) copilt.org URL (the canonical host is www.copilt.org)"],
  ["http-url", /\b(?:href|src|action|content)=["']http:\/\/(?!www\.w3\.org\b)[^"']+/i, "an insecure http:// URL (mixed content)"],
  ["github-pages", /github\.io|\/ai-commerce-copilot-site(?:\/|["'])/i, "the old GitHub Pages site or base path"],
  ["api-host-link", /(?:href|src)=["']https?:\/\/api\.copilt\.org/i, "a link to the API host (api.copilt.org is API-only)"],
];

/** Markup findings for one document. `ctx`: { origin, pathname, status, noindexAllowed, isError, isFixtureAlias }. `html` has already had the fixture origin rewritten to `origin`. */
export function markupFindings(html, ctx) {
  const out = [];
  const origin = ctx.origin || CANONICAL_ORIGIN;
  const head = (html.match(/<head\b[\s\S]*?<\/head>/i) || [""])[0];
  const stripped = html.replace(/<script\b(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/gi, (m) => (/\bsrc=/.test(m.slice(0, 200)) ? m.slice(0, 200) : "")); // inline script bodies are not links; keep the src attributes
  for (const [id, re, why] of URL_RULES) { const m = stripped.match(re); if (m) out.push({ id, why, snippet: m[0].slice(0, 100) }); }
  // noindex / staging markers
  const robots = [...head.matchAll(/<meta\b[^>]*\bname=["'](?:robots|googlebot)["'][^>]*>/gi)].map((m) => m[0]);
  const noindex = robots.some((r) => /noindex|nosnippet|noarchive/i.test(r));
  if (noindex && !ctx.noindexAllowed && !ctx.isError) out.push({ id: "noindex", why: "a noindex / nosnippet / noarchive robots meta on a page that must be indexable", snippet: robots.find((r) => /noindex|nosnippet|noarchive/i.test(r)).slice(0, 120) });
  if (/aicc-stage-identity|data-aicc-stage|"env"\s*:\s*"staging"/i.test(html)) out.push({ id: "stage-marker", why: "a staging identity marker", snippet: "aicc-stage-identity" });
  // canonical
  if (!ctx.isError) {
    const canon = [...head.matchAll(/<link\b[^>]*\brel=["']canonical["'][^>]*>/gi)].map((m) => (m[0].match(/\bhref=["']([^"']*)["']/i) || [, ""])[1]);
    if (!canon.length) { if (!noindex || !ctx.noindexAllowed) out.push({ id: "canonical-missing", why: "no canonical link", snippet: ctx.pathname }); }
    else if (canon.length > 1) out.push({ id: "canonical-duplicate", why: "more than one canonical link", snippet: canon.join(" | ") });
    else {
      const want = origin + ctx.pathname;
      const got = canon[0];
      if (!got.startsWith(origin + "/")) out.push({ id: "canonical-origin", why: `the canonical is not on ${origin}`, snippet: got });
      else if (ctx.canonicalMustMatchPath !== false && got !== want && !(ctx.canonicalAlternatives || []).includes(got)) out.push({ id: "canonical-path", why: "the canonical is not this page's own URL", snippet: `${got} (expected ${want})` });
    }
  }
  // source maps referenced from a document
  if (/sourceMappingURL=/i.test(html)) out.push({ id: "source-map-reference", why: "a sourceMappingURL reference in a public document", snippet: "sourceMappingURL" });
  return out;
}

export function analyzeDocument(html, ctx) {
  const parts = extractParts(html);
  const findings = [];
  const add = (where, arr) => arr.forEach((f) => findings.push({ ...f, where }));
  const lang = ((html.match(/<html\b[^>]*\blang=["']([a-z]{2})/i) || [, "en"])[1] || "en").toLowerCase();
  const w = (t) => wordingFindings(t, { lang });
  add("text", w(parts.text));
  add("title", w(parts.title));
  add("meta", w([parts.description, parts.ogTitle, parts.ogDescription, parts.ogSite].filter(Boolean).join("\n")));
  add("attr", w(parts.attrs.join("\n")));
  add("json-ld", w(parts.jsonText));
  add("field", fieldFindings({ title: parts.title, h1: parts.h1.join(" | "), description: parts.description, "og:title": parts.ogTitle, "og:description": parts.ogDescription }));
  findings.push(...markupFindings(html, ctx).map((f) => ({ ...f, where: "markup" })));
  // de-duplicate (the same sentence is often in the text and an aria-label)
  const seen = new Set();
  return findings.filter((f) => { const k = f.id + "|" + f.snippet; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** robots.txt and sitemap.xml */
export function robotsFindings(txt, origin = CANONICAL_ORIGIN) {
  const out = [];
  if (/^\s*Disallow:\s*\/\s*$/im.test(txt)) out.push({ id: "robots-blanket-disallow", why: "robots.txt disallows the whole site", snippet: "Disallow: /" });
  for (const m of txt.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) if (!m[1].startsWith(origin + "/")) out.push({ id: "robots-sitemap-origin", why: `the robots.txt Sitemap line is not on ${origin}`, snippet: m[1] });
  return out;
}
export function sitemapFindings(xml, origin = CANONICAL_ORIGIN) {
  const out = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) if (!m[1].startsWith(origin + "/")) out.push({ id: "sitemap-origin", why: `a sitemap URL is not on ${origin}`, snippet: m[1] });
  return out;
}

// ---- self-test fixtures -------------------------------------------------------------------------------------------------------------------------------
/** One clean page. The mutations below each inject exactly one defect. */
export function cleanPage({ extraBody = "", extraHead = "", title = "Pricing: Solo, Studio and Agency plans for AICC", canonicalPath = "/pricing/" } = {}) {
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="Every plan has the full AICC product. Solo $99, Studio $199, Agency $499 per year.">` +
    `<link rel="canonical" href="${CANONICAL_ORIGIN}${canonicalPath}"><meta property="og:title" content="Pricing for AICC"><meta property="og:site_name" content="AI Commerce Copilot">${extraHead}</head>` +
    `<body><header><a href="${CANONICAL_ORIGIN}/my-account/">Sign in</a></header><main><h1>One full product. Pick how many stores.</h1><p>Solo $99, Studio $199 or Agency $499 a year. Fixed 365-day plan. Renewal is manual.</p>` +
    `<p>Purchases open soon. Questions in the meantime? Write to <a href="mailto:support@copilt.org">support@copilt.org</a>.</p><p>Company and support details will be confirmed before purchases open.</p>${extraBody}</main></body></html>`;
}

/** [name, mutate(html) -> html, expected rule id]. Each must be caught by analyzeDocument(). */
export const MUTATIONS = [
  ["pending marker", (h) => h.replace("</main>", "<p>Operated by (pending)</p></main>"), "pending-marker"],
  ["legal review pending", (h) => h.replace("</main>", "<p>Draft: pending legal review</p></main>"), "pending-marker"],
  ["published before launch", (h) => h.replace("</main>", "<p>Support details will be published before launch.</p></main>"), "published-before-launch"],
  ["TODO", (h) => h.replace("</main>", "<p>TODO write the refund text</p></main>"), "todo-tbd"],
  ["TBD", (h) => h.replace("</main>", "<p>Governing law: TBD</p></main>"), "todo-tbd"],
  ["placeholder word", (h) => h.replace("</main>", "<p>This is a placeholder for the address.</p></main>"), "placeholder-word"],
  ["draft title", (h) => h.replace("Pricing: Solo", "Terms of service (draft)").replace("</main>", ""), "draft-label"],
  ["not reviewed by a lawyer", (h) => h.replace("</main>", "<p>This document has not been reviewed by a lawyer.</p></main>"), "draft-label"],
  ["es draft label", (h) => h.replace("</main>", "<p>Borrador: pendiente de revisión legal</p></main>"), "internal-label-es"],
  ["es published before launch", (h) => h.replace("</main>", "<p>Los datos de soporte se publicarán antes del lanzamiento.</p></main>"), "internal-label-es"],
  ["ru draft label", (h) => h.replace("</main>", "<p>Черновик: ожидает юридической проверки</p></main>"), "internal-label-ru"],
  ["ru published before launch", (h) => h.replace("</main>", "<p>Эти сведения будут опубликованы до\u00a0запуска.</p></main>"), "internal-label-ru"],
  ["he draft label", (h) => h.replace("</main>", "<p>טיוטה: ממתינה לבדיקה משפטית</p></main>"), "internal-label-he"],
  ["he published before launch", (h) => h.replace("</main>", "<p>פרט זה יפורסם לפני ההשקה.</p></main>"), "internal-label-he"],
  ["launch-test language", (h) => h.replace("</main>", "<p>Payments run in test mode.</p></main>"), "launch-test-language"],
  ["QA word", (h) => h.replace("</main>", "<p>QA only checkout</p></main>"), "qa-word"],
  ["site title (QA)", (h) => h.replace('content="AI Commerce Copilot"', 'content="AI Commerce Copilot (QA)"'), "sentinel-value"],
  ["Example Ltd", (h) => h.replace("</main>", "<p>Operated by Example Ltd.</p></main>"), "sentinel-value"],
  ["support@example.test", (h) => h.replace("</main>", "<p>Write to support@example.test</p></main>"), "sentinel-value"],
  ["1 Example Street", (h) => h.replace("</main>", "<p>1 Example Street, Example City</p></main>"), "sentinel-value"],
  ["Example Pay", (h) => h.replace("</main>", "<p>Payments by Example Pay.</p></main>"), "sentinel-value"],
  ["bank transfer placeholder", (h) => h.replace("</main>", "<label>Direct bank transfer</label></main>"), "placeholder-gateway"],
  ["localhost text", (h) => h.replace("</main>", "<p>Open localhost to test</p></main>"), "loopback-or-stage-text"],
  ["127.0.0.1 text", (h) => h.replace("</main>", "<p>Served from 127.0.0.1</p></main>"), "loopback-or-stage-text"],
  ["stage.copilt.org text", (h) => h.replace("</main>", "<p>Try stage.copilt.org first.</p></main>"), "loopback-or-stage-text"],
  ["free trial", (h) => h.replace("</main>", "<p>Start with a free trial.</p></main>"), "free-trial"],
  ["14-day trial", (h) => h.replace("</main>", "<p>Enjoy a 14-day trial.</p></main>"), "free-trial"],
  ["Shopify live", (h) => h.replace("</main>", "<p>Now also live for Shopify stores.</p></main>"), "shopify-live"],
  ["WordPress.org install", (h) => h.replace("</main>", "<p>Install it from the WordPress plugin directory.</p></main>"), "wordpress-org-install"],
  ["conversion percentage", (h) => h.replace("</main>", "<p>AICC increases conversion by 23%.</p></main>"), "conversion-aov-percentage"],
  ["AOV percentage", (h) => h.replace("</main>", "<p>Merchants see 15% higher AOV.</p></main>"), "conversion-aov-percentage"],
  ["same category fallback", (h) => h.replace("</main>", "<p>The remaining spots are filled from the same category.</p></main>"), "truth:same-category-fallback"],
  ["semantic cold start", (h) => h.replace("</main>", "<p>Semantic matching fills thin history.</p></main>"), "truth:ai-semantic-claim"],
  ["AI claim", (h) => h.replace("</main>", "<p>Powered by machine learning.</p></main>"), "truth:ai-semantic-claim"],
  ["FBT as identity", (h) => h.replace("</main>", "<p>AICC is a Frequently Bought Together plugin.</p></main>"), "fbt-as-identity"],
  ["FBT in title", (h) => h.replace("<title>Pricing: Solo, Studio and Agency plans for AICC", "<title>Frequently Bought Together for WooCommerce"), "fbt-in-title"],
  ["purchases open now", (h) => h.replace("</main>", "<p>Buy now and start today.</p></main>"), "checkout-implied-open"],
  ["noindex", (h) => h.replace("</head>", '<meta name="robots" content="noindex, nofollow"></head>'), "noindex"],
  ["stage identity", (h) => h.replace("</main>", '<span data-aicc-stage="1"></span></main>'), "stage-marker"],
  ["stage URL", (h) => h.replace("</main>", '<a href="https://stage.copilt.org/pricing/">x</a></main>'), "stage-url"],
  ["loopback URL", (h) => h.replace("</main>", '<a href="http://127.0.0.1:3011/x">x</a></main>'), "loopback-url"],
  ["apex URL", (h) => h.replace("</main>", '<a href="https://copilt.org/pricing/">x</a></main>'), "apex-url"],
  ["http URL (mixed)", (h) => h.replace("</main>", '<img src="http://www.copilt.org/a.png" alt="">' + "</main>"), "http-url"],
  ["GitHub Pages", (h) => h.replace("</main>", '<a href="https://avivg7.github.io/x">x</a></main>'), "github-pages"],
  ["canonical missing", (h) => h.replace(/<link rel="canonical"[^>]*>/, ""), "canonical-missing"],
  ["canonical on stage", (h) => h.replace(CANONICAL_ORIGIN + "/pricing/", "https://stage.copilt.org/pricing/"), "canonical-origin"],
  ["canonical on apex", (h) => h.replace(CANONICAL_ORIGIN + "/pricing/", "https://copilt.org/pricing/"), "canonical-origin"],
  ["canonical other path", (h) => h.replace(CANONICAL_ORIGIN + "/pricing/", CANONICAL_ORIGIN + "/"), "canonical-path"],
  ["canonical duplicated", (h) => h.replace("</head>", `<link rel="canonical" href="${CANONICAL_ORIGIN}/pricing/"></head>`), "canonical-duplicate"],
  ["source map reference", (h) => h.replace("</main>", "</main><script>var a=1;\n//# sourceMappingURL=app.js.map</script>"), "source-map-reference"],
  ["placeholder in meta", (h) => h.replace('content="Every plan', 'content="TODO: write description. Every plan'), "todo-tbd"],
  ["pending in aria-label", (h) => h.replace("</main>", '<a href="/x" aria-label="Support (pending)">x</a></main>'), "pending-marker"],
  ["support promise", (h) => h.replace("</main>", "<p>We reply within 2 hours, 24/7.</p></main>"), "support-promise-unknown"],
];

/** Clean sentences that look close to a rule but are true and allowed. Each must produce NO finding. */
export const CLEAN_SAMPLES = [
  "Purchases open soon.",
  "Company and support details will be confirmed before purchases open.",
  "To be confirmed before purchases open.",
  "This page is being finalized and will be confirmed before purchases open.",
  "14-day money-back guarantee on your initial plan purchase",
  "Is AICC just Frequently Bought Together?",
  "No. “Frequently Bought Together” is the name of the storefront widget.",
  "Frequently Bought Together bundle on product and cart pages",
  "There is no free trial; a plan is a fixed 365 days and renewal is manual.",
  "AICC makes no promise of a percentage increase in conversion or order value.",
  "Makes text and controls about 19% larger.",
  "Hebrew, Spanish and Russian texts have not yet been reviewed by native speakers.",
  "WooCommerce related products come from the same category or tag.",
  "Your plan simply runs for the rest of its 365 days.",
  "Accessibility settings are saved in this browser only.",
  "The test of a good recommendation is whether the pair really sells together.",
  "Count the stores you want to connect.",
  "Staging and production count as separate stores.",
  "Esta traducción es un borrador y además necesita un revisor legal nativo.",
  "Этот перевод\u00a0— черновик, и\u00a0ему также нужна проверка юристом.",
  "התרגום הזה הוא טיוטה וזקוק גם לבודק משפטי דובר השפה.",
  "Los datos de la empresa se confirmarán antes de que se abran las compras.",
  "Данные компании будут подтверждены до\u00a0открытия покупок.",
];
