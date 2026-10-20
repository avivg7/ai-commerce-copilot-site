// SEO / canonical / origin audit of a BUILT site (out/). Shared by `npm run seo:check` and `npm run launch:check`.
// Pure Node, no browser, no network, no build: it only reads files. It fails on anything that would publish a wrong origin:
//   - a canonical, og:url, hreflang, sitemap or robots Sitemap line that is not on the canonical host (https://www.copilt.org)
//   - the apex (https://copilt.org), http://, localhost / 127.0.0.1, staging, GitHub Pages (github.io, /ai-commerce-copilot-site) anywhere in the output
//   - missing or duplicated canonical, missing title / description / Open Graph / Twitter tags, image files that are not in out/
//   - hreflang sets that are incomplete or not reciprocal, accidental noindex, html lang/dir that do not match the locale
//   - structured data that names ratings or reviews, or points at another origin
//   - purchasable-price structured data (Offer / AggregateOffer / offers / price / priceCurrency) while the owner switch is off (OWNER DECISION: not until
//     real public checkout is live; switch = NEXT_PUBLIC_AICC_STRUCTURED_OFFERS=on at build time, see src/lib/site.ts)
// The canonical origin is the owner's decision (www.copilt.org); override only for rehearsal with SEO_EXPECTED_ORIGIN.
import fs from "node:fs";
import path from "node:path";
import { WP_SITEMAP_PAGES } from "./redirect-matrix.mjs";

export const DEFAULT_ORIGIN = "https://www.copilt.org";
const LOCALES = { en: { dir: "ltr" }, he: { dir: "rtl" }, es: { dir: "ltr" }, ru: { dir: "ltr" } };
const HREFLANGS = ["en", "he", "es", "ru", "x-default"];
/** Paths that exist only on the WordPress origin: links to them are handed over, not resolved inside out/. */
const WORDPRESS_PREFIXES = ["/my-account/", "/cart/", "/checkout/", "/wp-login.php", "/wp-admin/", "/data-processing-addendum/"];
const TEXT_EXT = new Set([".html", ".txt", ".xml", ".js", ".css", ".json", ".svg", ".webmanifest", ".vtt", ".map"]);
const ERROR_PAGES = new Set(["404.html", "404/index.html", "_not-found/index.html"]);

/** The owner switch for purchasable-price JSON-LD (same name and meaning as src/lib/site.ts STRUCTURED_OFFERS). Default OFF. */
export const structuredOffersOn = (env = process.env) => env.NEXT_PUBLIC_AICC_STRUCTURED_OFFERS === "on";

/** Raw patterns that must never appear inside an application/ld+json block while the switch is off. */
const PRICE_SCHEMA_RAW = [
  [/"offers"/, '"offers"'],
  [/"@type"\s*:\s*"(?:Aggregate)?Offer"/, '@type Offer / AggregateOffer'],
  [/AggregateOffer/, "AggregateOffer"],
  [/priceCurrency/, "priceCurrency"],
  [/"(?:price|lowPrice|highPrice|priceSpecification)"/, '"price" / lowPrice / highPrice / priceSpecification'],
];
const PRICE_SCHEMA_KEYS = /^(offers|price|lowPrice|highPrice|priceCurrency|priceSpecification|priceValidUntil)$/i;

/**
 * Purchasable-price schema in the JSON-LD blocks of one HTML document. Returns a list of human-readable findings (empty = clean).
 * Two independent detectors: raw text of each block (the quoted markers) and a walk of the parsed JSON (keys and @type values), so neither
 * a re-ordering nor a different spacing hides it. Text VALUES (an FAQ answer that says "$99") are not findings: visible pricing is allowed.
 */
export function scanPriceSchema(html) {
  const found = [];
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1];
    for (const [re, label] of PRICE_SCHEMA_RAW) if (re.test(raw)) found.push(`raw ${label}`);
    try {
      (function visit(v) {
        if (Array.isArray(v)) return v.forEach(visit);
        if (v && typeof v === "object") {
          const types = [].concat(v["@type"] || []);
          if (types.some((t) => /^(Offer|AggregateOffer|ItemList|Product)$/.test(String(t)) && (t !== "ItemList" || JSON.stringify(v).includes("Offer")))) found.push(`@type ${types.join(",")}`);
          for (const [k, x] of Object.entries(v)) { if (PRICE_SCHEMA_KEYS.test(k)) found.push(`key ${k}`); visit(x); }
        }
      })(JSON.parse(raw));
    } catch { /* a block that does not parse is reported by the structured-data check itself */ }
  }
  return [...new Set(found)];
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const k = m[1].toLowerCase();
    if (k === "link" || k === "meta") continue;
    out[k] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}
const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => attrs(m[0].replace(new RegExp(`^<${name}`, "i"), "")));

function walk(dir, fn, rel = "") {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, fn, r);
    else fn(r);
  }
}

/** "he/pricing/index.html" -> "/he/pricing/" ; "index.html" -> "/" */
const routeOf = (file) => "/" + file.replace(/(^|\/)index\.html$/, "$1");
const localeOf = (route) => { const m = /^\/(he|es|ru)(\/|$)/.exec(route); return m ? m[1] : "en"; };

export function auditBuild({ outDir, origin = process.env.SEO_EXPECTED_ORIGIN || DEFAULT_ORIGIN } = {}) {
  origin = origin.replace(/\/+$/, "");
  const issues = [];
  const add = (level, where, msg) => issues.push({ level, where, msg });
  const err = (where, msg) => add("error", where, msg);
  const warn = (where, msg) => add("warn", where, msg);
  const exists = (p) => { try { return fs.statSync(path.join(outDir, p)).isFile(); } catch { return false; } };
  const resolves = (urlPath) => {
    const p = decodeURIComponent(urlPath.replace(/^\//, ""));
    return exists(p) || exists(path.join(p, "index.html")) || exists(`${p}.html`);
  };

  if (!fs.existsSync(outDir)) { err(outDir, "no build found: run a build first (AICC_BASE_PATH=\"\" SITE_URL=" + origin + " npm run build)"); return { issues, stats: {} }; }
  if (!/^https:\/\/www\.[a-z0-9.-]+$/.test(origin)) warn("origin", `expected origin ${origin} is not an https://www. host; the owner's canonical host is ${DEFAULT_ORIGIN}`);

  const files = [];
  walk(outDir, (f) => files.push(f));
  const htmlFiles = files.filter((f) => f.endsWith(".html")).sort();
  const pages = new Map(); // route -> parsed
  const titles = new Map();

  for (const f of htmlFiles) {
    const html = fs.readFileSync(path.join(outDir, f), "utf8");
    const route = routeOf(f);
    const where = f;
    const isError = ERROR_PAGES.has(f);
    // every built page, error pages included: no purchasable-price schema until checkout is live (owner decision), unless the build switch is on
    if (!structuredOffersOn()) for (const f2 of scanPriceSchema(html)) err(where, `JSON-LD carries purchasable-price schema (${f2}); NEXT_PUBLIC_AICC_STRUCTURED_OFFERS is not "on", so no Offer/price data may be published until checkout is live`);
    const locale = localeOf(route);
    const links = tagsOf(html, "link");
    const metas = tagsOf(html, "meta");
    const meta = (key, by = "name") => metas.filter((m) => (m[by] || "").toLowerCase() === key);
    const one = (key, by = "name") => meta(key, by)[0]?.content;

    const robots = (one("robots") || "").toLowerCase();
    const noindex = /noindex/.test(robots);
    const canon = links.filter((l) => (l.rel || "").toLowerCase() === "canonical");

    const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0] || "";
    const ha = attrs(htmlTag.replace(/^<html/i, ""));
    const title = (/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "").trim();

    if (isError) {
      if (!noindex) err(where, "error page is indexable (needs <meta name=\"robots\" content=\"noindex\">)");
      if (canon.length) err(where, `error page carries a canonical (${canon[0].href})`);
      if (!title) err(where, "error page has no <title>");
      pages.set(route, { f, isError: true, locale, html });
      continue;
    }

    if (ha.lang !== (locale === "en" ? "en" : locale)) err(where, `html lang="${ha.lang}" does not match the ${locale} path`);
    if (ha.dir !== LOCALES[locale].dir) err(where, `html dir="${ha.dir}" should be ${LOCALES[locale].dir} for ${locale}`);
    if (noindex) err(where, `accidental noindex (${robots})`);
    if (!/(^|\W)index(\W|$)/.test(robots) && robots) warn(where, `robots meta present without "index": ${robots}`);

    // canonical
    if (canon.length !== 1) err(where, `${canon.length} canonical links (need exactly 1)`);
    const c = canon[0]?.href || "";
    const expected = origin + route;
    if (c && c !== expected) err(where, `canonical ${c} should be ${expected}`);
    if (c && !c.endsWith("/")) err(where, `canonical lacks the trailing slash: ${c}`);
    if (/[?#]/.test(c)) err(where, `canonical carries a query or fragment: ${c}`);

    // title + description
    if (!title) err(where, "missing <title>");
    else {
      if (title.length > 90) warn(where, `title is ${title.length} chars (search results cut at about 60 to 70)`);
      if (titles.has(title)) warn(where, `title duplicates ${titles.get(title)}: "${title}"`);
      titles.set(title, f);
    }
    const desc = one("description");
    if (!desc) err(where, "missing meta description");
    else if (desc.length < 50 || desc.length > 320) warn(where, `meta description is ${desc.length} chars`);

    // Open Graph + Twitter
    const og = (k) => one(`og:${k}`, "property");
    if (og("url") !== c) err(where, `og:url ${og("url")} differs from the canonical ${c}`);
    if (!og("title")) err(where, "missing og:title");
    if (!og("description")) err(where, "missing og:description");
    if (og("type") !== "website") warn(where, `og:type is ${og("type")}`);
    if (!og("locale")) err(where, "missing og:locale");
    const img = og("image");
    if (!img) err(where, "missing og:image");
    else {
      if (!img.startsWith(origin + "/")) err(where, `og:image is not absolute on ${origin}: ${img}`);
      else if (!exists(img.slice(origin.length + 1))) err(where, `og:image file is not in the build: ${img}`);
      if (one("twitter:image") !== img) err(where, `twitter:image ${one("twitter:image")} differs from og:image`);
    }
    if (!og("image:width") || !og("image:height")) warn(where, "og:image width/height missing");
    if (!og("image:alt")) warn(where, "og:image:alt missing");
    if (!/^summary(_large_image)?$/.test(one("twitter:card") || "")) err(where, "missing or unknown twitter:card");
    if (!one("twitter:title")) err(where, "missing twitter:title");

    // hreflang
    const alts = {};
    for (const l of links) if ((l.rel || "").toLowerCase() === "alternate" && l.hreflang) { if (alts[l.hreflang]) err(where, `duplicate hreflang ${l.hreflang}`); alts[l.hreflang] = l.href; }
    const have = Object.keys(alts).sort().join(",");
    if (have !== [...HREFLANGS].sort().join(",")) err(where, `hreflang set is [${have}], expected [${[...HREFLANGS].sort().join(",")}]`);
    for (const [k, v] of Object.entries(alts)) {
      if (!v.startsWith(origin + "/")) err(where, `hreflang ${k} is not on ${origin}: ${v}`);
      if (!v.endsWith("/")) err(where, `hreflang ${k} lacks the trailing slash: ${v}`);
    }
    if (alts[locale] !== c) err(where, `hreflang ${locale} (${alts[locale]}) is not the page's own canonical (${c})`);
    const enRoute = route.replace(/^\/(he|es|ru)(?=\/)/, "") || "/";
    if (alts["x-default"] !== origin + enRoute) err(where, `x-default ${alts["x-default"]} should be the English URL ${origin + enRoute}`);

    // icons
    const icons = links.filter((l) => /(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(l.rel || ""));
    if (!icons.some((l) => /(^|\s)icon(\s|$)/i.test(l.rel))) err(where, "no <link rel=\"icon\">");
    if (!icons.some((l) => /apple-touch-icon/i.test(l.rel))) err(where, "no apple-touch-icon");
    for (const l of icons) {
      const h = l.href || "";
      if (/^https?:/.test(h)) { if (!h.startsWith(origin + "/") || !exists(h.slice(origin.length + 1))) err(where, `icon ${h} is not a file of this build on ${origin}`); }
      else if (!exists(h.replace(/^\//, ""))) err(where, `icon file missing from the build: ${h}`);
    }

    // headings
    const h1 = (html.match(/<h1\b/gi) || []).length;
    if (h1 !== 1) warn(where, `${h1} <h1> elements (expected 1)`);

    // structured data: only facts
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let data;
      try { data = JSON.parse(m[1]); } catch (e) { err(where, `JSON-LD does not parse: ${e.message}`); continue; }
      const seen = [];
      (function visit(v, key) {
        if (Array.isArray(v)) return v.forEach((x) => visit(x, key));
        if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) { if (/^(aggregateRating|review|reviews|ratingValue|reviewCount|ratingCount|award|sameAs|telephone|address|customer)$/i.test(k)) err(where, `JSON-LD names "${k}" (no ratings, reviews, awards, social profiles, phone or address unless they are real)`); visit(x, k); } return; }
        if (typeof v === "string" && /^https?:\/\//.test(v) && key !== "@context") seen.push([key, v]);
      })(data);
      for (const [k, v] of seen) if (!v.startsWith(origin + "/") && v !== origin) err(where, `JSON-LD ${k} points off ${origin}: ${v}`);
    }

    pages.set(route, { f, isError: false, locale, canonical: c, alts, html });
  }

  // hreflang reciprocity
  for (const [, p] of pages) {
    if (p.isError || !p.alts) continue;
    for (const [k, v] of Object.entries(p.alts)) {
      if (!v.startsWith(origin)) continue;
      const target = pages.get(v.slice(origin.length));
      if (!target || target.isError) { err(p.f, `hreflang ${k} -> ${v} is not a built page`); continue; }
      const back = target.alts && Object.entries(target.alts).map(([a, b]) => `${a}=${b}`).sort().join("|");
      const mine = Object.entries(p.alts).map(([a, b]) => `${a}=${b}`).sort().join("|");
      if (back !== mine) err(p.f, `hreflang cluster is not reciprocal with ${target.f}`);
    }
  }

  // sitemap.xml
  const wpSitemapRoutes = new Set(Object.keys(LOCALES).flatMap((l) => WP_SITEMAP_PAGES.map((p) => (l === "en" ? "" : `/${l}`) + p)));
  const indexable = [...pages.entries()].filter(([, p]) => !p.isError).map(([r]) => r);
  const sitemapPath = path.join(outDir, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) err("sitemap.xml", "missing");
  else {
    const xml = fs.readFileSync(sitemapPath, "utf8");
    const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
    const locs = urls.map((u) => /<loc>([^<]+)<\/loc>/.exec(u)?.[1]);
    if (new Set(locs).size !== locs.length) err("sitemap.xml", "duplicate <loc> entries");
    for (const [i, u] of urls.entries()) {
      const loc = locs[i];
      if (!loc?.startsWith(origin + "/")) { err("sitemap.xml", `<loc> not on ${origin}: ${loc}`); continue; }
      if (!loc.endsWith("/")) err("sitemap.xml", `<loc> lacks the trailing slash: ${loc}`);
      const rel = loc.slice(origin.length);
      const sx = {};
      for (const a of u.matchAll(/<xhtml:link\b[^>]*>/g)) { const t = attrs(a[0].replace(/^<xhtml:link/, "")); sx[t.hreflang] = t.href; }
      if (wpSitemapRoutes.has(rel)) {
        // a WordPress-only public page (the edge serves one sitemap for the whole host): no built page to compare with, so the cluster must be the four languages + x-default of the same path
        const base = rel.replace(/^\/(he|es|ru)(?=\/)/, "");
        const want = { en: origin + base, he: origin + "/he" + base, es: origin + "/es" + base, ru: origin + "/ru" + base, "x-default": origin + base };
        if (JSON.stringify(Object.entries(sx).sort()) !== JSON.stringify(Object.entries(want).sort())) err("sitemap.xml", `hreflang entries of the WordPress-only page ${loc} are not the four languages + x-default of ${base}`);
        continue;
      }
      const page = pages.get(rel);
      if (!page || page.isError) { err("sitemap.xml", `<loc> is not a built page: ${loc}`); continue; }
      if (JSON.stringify(Object.entries(sx).sort()) !== JSON.stringify(Object.entries(page.alts || {}).sort())) err("sitemap.xml", `hreflang entries of ${loc} differ from the page's own alternates`);
    }
    const missing = indexable.filter((r) => !locs.includes(origin + r));
    if (missing.length) err("sitemap.xml", `built pages missing from the sitemap: ${missing.join(", ")}`);
    const missingWp = [...wpSitemapRoutes].filter((r) => !locs.includes(origin + r));
    if (missingWp.length) err("sitemap.xml", `WordPress-only public pages missing from the sitemap (the edge serves this one sitemap for the whole host): ${missingWp.join(", ")}`);
  }

  // robots.txt
  const robotsPath = path.join(outDir, "robots.txt");
  if (!fs.existsSync(robotsPath)) err("robots.txt", "missing");
  else {
    const t = fs.readFileSync(robotsPath, "utf8");
    const sm = [...t.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    if (sm.length !== 1 || sm[0] !== `${origin}/sitemap.xml`) err("robots.txt", `Sitemap line(s) [${sm.join(", ")}] should be exactly ${origin}/sitemap.xml`);
    if (/^Disallow:\s*\/\s*$/im.test(t)) err("robots.txt", "blanket Disallow: / (blocks the whole site)");
    for (const p of ["/my-account/", "/checkout/", "/cart/"]) if (!new RegExp(`^Disallow:\\s*${p}`, "im").test(t)) warn("robots.txt", `no Disallow for ${p} (the WordPress origin's own robots rules would be replaced by this file)`);
  }

  // error pages
  if (!exists("404.html")) err("404.html", "missing (the edge needs a branded not-found document)");

  // global scan for wrong origins
  const apex = origin.replace("://www.", "://");
  const apexHost = apex.replace(/^https:\/\//, "");
  const FORBIDDEN = [
    [/(?:https?:)?\/\/localhost\b|localhost:\d{2,5}|127\.0\.0\.1|\b0\.0\.0\.0:\d+/, "localhost / loopback URL"],
    [/(?:staging|qa|dev|test)\.copilt\.org/, "staging / qa host"],
    [/\/ai-commerce-copilot-site/, "GitHub Pages base path /ai-commerce-copilot-site"],
    [/github\.io|avivg7/, "GitHub Pages host or account"],
    [new RegExp(`https?://${apexHost.replace(/\./g, "\\.")}(?![\\w.-])`), `the apex origin (${apex}); the canonical host is ${origin}`],
    [new RegExp(`http://(?:www\\.)?${apexHost.replace(/\./g, "\\.")}`), "insecure http:// origin"],
    [new RegExp(`(?<![\\w.@-])${apexHost.replace(/\./g, "\\.")}(?![\\w-])`), `bare apex host name ${apexHost} (use ${origin.replace("https://", "")} or api.${apexHost})`],
  ];
  let scanned = 0;
  for (const f of files) {
    if (!TEXT_EXT.has(path.extname(f))) continue;
    if (f.startsWith("videos/") || f.startsWith("demo/") && f.endsWith(".mp4")) continue;
    const t = fs.readFileSync(path.join(outDir, f), "utf8");
    scanned++;
    for (const [re, label] of FORBIDDEN) {
      const m = re.exec(t);
      if (m) err(f, `${label}: ...${t.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, " ")}...`);
    }
    // any other copilt.org host that is neither the canonical host nor the API
    for (const m of t.matchAll(/https?:\/\/([a-z0-9-]+\.)*copilt\.org/gi)) {
      const host = m[0].replace(/^https?:\/\//, "").toLowerCase();
      if (host !== origin.replace("https://", "") && host !== `api.${apexHost}` && host !== apexHost) { err(f, `unexpected copilt.org host: ${m[0]}`); break; }
    }
  }

  // internal links and assets resolve inside the build (WordPress-owned paths are handed over)
  let internal = 0, handed = 0;
  const handedTo = new Set();
  for (const [, p] of pages) {
    const html = p.html;
    const refs = [];
    for (const a of tagsOf(html, "a")) if (a.href) refs.push(["a", a.href]);
    for (const l of tagsOf(html, "link")) if (l.href && !/(canonical|alternate)/i.test(l.rel || "")) refs.push(["link", l.href]);
    for (const k of ["script", "img", "source", "video", "track"]) for (const t of tagsOf(html, k)) { if (t.src) refs.push([k, t.src]); if (t.poster) refs.push([k, t.poster]); }
    for (const [k, raw] of refs) {
      if (/^(mailto:|tel:|javascript:|data:|#)/i.test(raw)) continue;
      let u = raw;
      if (/^https?:\/\//i.test(u)) {
        if (!u.startsWith(origin + "/") && u !== origin) { if (k === "a") warn(p.f, `external link: ${u}`); else err(p.f, `${k} loads from another origin: ${u}`); continue; }
        u = u.slice(origin.length) || "/";
      }
      if (!u.startsWith("/")) { err(p.f, `relative ${k} ${raw} (use root-relative or absolute URLs)`); continue; }
      const clean = u.split("#")[0].split("?")[0];
      const unprefixed = clean.replace(/^\/(he|es|ru)(?=\/)/, "");
      if (WORDPRESS_PREFIXES.some((w) => unprefixed.startsWith(w))) { handed++; handedTo.add(clean); continue; }
      internal++;
      if (!resolves(clean)) err(p.f, `${k} ${raw} does not resolve inside the build`);
      else if (k === "a" && !/\.[a-z0-9]+$/i.test(clean) && !clean.endsWith("/")) warn(p.f, `internal link without trailing slash: ${raw} (the edge would add a redirect hop)`);
    }
  }

  const uniq = new Map();
  for (const i of issues) uniq.set(`${i.level}|${i.where}|${i.msg}`, i);
  return {
    issues: [...uniq.values()],
    stats: { origin, structuredOffers: structuredOffersOn() ? "on" : "off", pages: indexable.length, errorPages: pages.size - indexable.length, textFilesScanned: scanned, internalRefs: internal, handedToWordPress: handed, handedPaths: [...handedTo].sort() },
  };
}
