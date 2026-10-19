// The www-canonical edge redirect / routing matrix as DATA. Nothing here is applied anywhere.
//
//   docs/cutover/redirect-matrix.md        the human-readable matrix (rationale, cutover-only flags, unowned routes)
//   docs/cutover/Caddyfile.edge.template   the candidate edge config; its GENERATED blocks come from this file
//   scripts/test-redirects.mjs             `npm run test:redirects`: regenerates and diffs those blocks (`--write` updates them),
//                                          interprets the Caddyfile text with a small stand-in edge, and asserts CASES below
//
// Regexes are written in the subset shared by Go RE2 (Caddy) and JavaScript so one text drives both the Caddyfile and the test.
export const CANONICAL_HOST = "www.copilt.org";
export const APEX_HOST = "copilt.org";
export const API_HOST = "api.copilt.org";
export const ORIGIN = `https://${CANONICAL_HOST}`;
export const LEGACY_BASE_PATH = "/ai-commerce-copilot-site";

/** Optional language prefix, captured as group 1 ("" for English). Never dropped, never added. */
const LOC = "(/(?:he|es|ru))?";

/** Pages that already exist (or will exist) as a trailing-slash URL; a bare form gets the slash in the SAME hop as any host redirect. */
export const SLASH_PAGES = ["product", "pricing", "questions", "data-and-trust", "privacy", "terms", "refund-policy", "accessibility", "data-processing-addendum", "my-account", "cart", "checkout"];

/**
 * Path rules. Applied to every request on every host (apex, www, http, https). Every target is ABSOLUTE on https://www.copilt.org,
 * so an apex or http request reaches its final URL in ONE hop (no apex -> www -> alias chain). The query string is always kept.
 * `enabled: false` rules are emitted as comments only (their target does not exist yet).
 * `cutoverOnly`: matters only after the edge is live (or only if the old URLs were ever indexed / linked).
 */
export const PATH_RULES = [
  { id: "base_index", match: `^${LEGACY_BASE_PATH}(/(?:.*/)?)index\\.html$`, target: "{1}", note: "old GitHub Pages sub-path, index.html (strip both in one hop)", cutoverOnly: true },
  { id: "base_root", match: `^${LEGACY_BASE_PATH}/?$`, target: "/", note: "old GitHub Pages sub-path, site root", cutoverOnly: true },
  { id: "base_slash", match: `^${LEGACY_BASE_PATH}(/.*/)$`, target: "{1}", note: "old GitHub Pages sub-path, directory URL", cutoverOnly: true },
  { id: "base_file", match: `^${LEGACY_BASE_PATH}(/.*\\.[A-Za-z0-9]+)$`, target: "{1}", note: "old GitHub Pages sub-path, file URL", cutoverOnly: true },
  { id: "base_bare", match: `^${LEGACY_BASE_PATH}(/[^.]*[^/])$`, target: "{1}/", note: "old GitHub Pages sub-path, bare page URL (slash added in the same hop)", cutoverOnly: true },
  { id: "index_html", match: "^((?:/[^/]+)*/)index\\.html$", target: "{1}", note: "duplicate of the directory URL (static hosts serve /x/index.html as a second copy)" },
  { id: "alias_account", match: `^${LOC}/(?:account|login|register)/?$`, target: "{1}/my-account/", note: "friendly names for the account page; ?plan= kept" },
  { id: "alias_store", match: `^${LOC}/(?:store|shop)/?$`, target: "{1}/pricing/", note: "WooCommerce's shop page is not a storefront here" },
  { id: "alias_install", match: `^${LOC}/(?:install|download)/?$`, target: "{1}/get-started/", enabled: false, note: "BLOCKED: /get-started/ is not built in the site yet (docs promise it); enabling now would redirect to a 404" },
  { id: "slash_pages", match: `^${LOC}/(${SLASH_PAGES.join("|")})$`, target: "{1}/{2}/", note: "bare page URL gets its trailing slash in the same hop" },
  { id: "slash_locale", match: "^/(he|es|ru)$", target: "/{1}/", note: "bare language root" },
  { id: "slash_wp_deep", match: `^${LOC}/((?:my-account|checkout)(?:/[A-Za-z0-9_-]+)+)$`, target: "{1}/{2}/", note: "bare account / checkout endpoint URL" },
];

/** Path rules use the same method split as the host rule: GET/HEAD get 301, every other method 308 (a POST to a slash-less /checkout/order-received/12 or /account keeps its method and body). */
export const PATH_RULE_CODES = { safeMethods: ["GET", "HEAD"], safeCode: 301, otherCode: 308 };

/** Host rule, last: any request on the apex, on http, or on http://www goes to the same path and query on https://www. GET/HEAD 301, others 308 (method kept). */
export const HOST_RULE = { safeMethods: ["GET", "HEAD"], safeCode: 301, otherCode: 308 };

/** Origin routing on the canonical host for requests no redirect rule took. First match wins; the last entry is the default. */
export const STATIC_ASSET_RE = "^(?:/(?:_next|brand-kit|fonts|og|demo)/.*|/(?:favicon\\.ico|robots\\.txt|sitemap\\.xml|index\\.txt)|/__next[^/]*\\.txt)$";
export const IMMUTABLE_RE = "^/_next/static/.*$";
export const DUPLICATE_ERROR_RE = "^/(?:404|_not-found)(?:/|\\.html)?$";
export const WP_MACHINE_RE = "^/(?:wp-json|wp-admin|wc-api|wc-ajax)(?:/.*)?$|^/(?:wp-login\\.php|wp-cron\\.php|xmlrpc\\.php|wp-activate\\.php|wp-signup\\.php)$";
/** WordPress's own static files: routed to WordPress but NOT forced to no-store (WordPress / the hosting stack send validators and decide caching; forcing no-store made every theme asset uncacheable). */
export const WP_ASSETS_RE = "^/(?:wp-content|wp-includes)(?:/.*)?$";
/** The root path, with or without a language prefix: WooCommerce's plain-permalink endpoints (?wc-ajax=, ?wc-api=, ?rest_route=) live on it. */
export const WP_ROOT_PATH_RE = `^${LOC}/$`;
export const WP_ROOT_QUERY = "(^|&)(wc-ajax|wc-api|rest_route)=";
export const RSC_UNDER_WP_RE = `^${LOC}/(?:pricing|privacy|terms|refund-policy|accessibility)/(?:__next[^/]*|index)\\.txt$`;
/** Next's client-navigation payloads of the static routes. They sit under /product/ too, which WooCommerce's /product/<slug>/ would otherwise swallow. */
export const STATIC_RSC_RE = `^${LOC}(?:/(?:product|questions|data-and-trust))?/(?:__next[^/]*|index)\\.txt$`;
export const WP_NOCACHE_RE = `^${LOC}/(?:cart|checkout|my-account)(?:/.*)?$|^/wp-(?:json|admin|login\\.php)(?:/.*)?$|^/wc-(?:ajax|api)(?:/.*)?$`;
export const WP_PAGES_RE = `^${LOC}/(?:pricing|privacy|terms|refund-policy|data-processing-addendum|accessibility|cart|checkout|my-account|product-category|shop)(?:/.*)?$|^${LOC}/product/.+$`;

/** What each public site route is at the target state. Derived from docs/AUTHORITY.md + domain-migration.md A2. */
export const TARGET_OWNER = {
  home: "static",
  product: "static",
  questions: "static",
  "data-and-trust": "static",
  pricing: "wordpress",
  privacy: "wordpress",
  terms: "wordpress",
  "refund-policy": "wordpress",
  accessibility: "wordpress",
};
/** Routes that exist only on WordPress (the site has no copy). */
export const WP_ONLY_PAGES = ["/data-processing-addendum/", "/cart/", "/checkout/", "/my-account/", "/my-account/aicc-licenses/", "/my-account/connect-aicc/"];
/**
 * WordPress-only pages that are public and indexable in the Control Plane (noindex only on account/cart/checkout; canonical + hreflang x4; linked in its footer)
 * and therefore listed in the site's sitemap, the only sitemap the edge serves. Must equal WORDPRESS_SITEMAP_PAGES in src/lib/routes.ts (test:redirects checks).
 */
export const WP_SITEMAP_PAGES = ["/data-processing-addendum/"];
/** Documented but not built anywhere yet: would be a 404 on the edge. */
export const UNOWNED = ["/get-started/", "/docs/", "/install/", "/download/"];

const W = ORIGIN;
const r = (from, status, location, extra = {}) => ({ from, status, location, ...extra });
const o = (from, origin, status = 200, extra = {}) => ({ from, origin, status, ...extra });
/** What the edge forces on commerce, account and machine paths. `cache: ""` in a case means "the edge sets no Cache-Control". */
export const NOCACHE = "private, no-store, max-age=0";

/**
 * Hand-written expectations (the ORACLE: they do not use the regexes above). `from` is "<scheme>://<host><path>[?query]".
 * r(...) = a redirect (status + exact Location); o(...) = served by that origin ("static" | "wordpress" | "404") with that status.
 */
export const CASES = [
  // ---- host / scheme: path and query kept, one hop -------------------------------------------------------------
  r("http://copilt.org/", 301, `${W}/`),
  r("https://copilt.org/", 301, `${W}/`),
  r("http://www.copilt.org/", 301, `${W}/`),
  r("http://copilt.org/product/", 301, `${W}/product/`),
  r("https://copilt.org/he/pricing/?plan=studio", 301, `${W}/he/pricing/?plan=studio`),
  r("https://copilt.org/es/questions/?q=a%20b&x=1", 301, `${W}/es/questions/?q=a%20b&x=1`),
  r("http://www.copilt.org/ru/data-and-trust/#frag", 301, `${W}/ru/data-and-trust/#frag`, { note: "fragment is client-side; shown for completeness" }),
  r("https://copilt.org/my-account/?plan=solo", 301, `${W}/my-account/?plan=solo`),
  r("https://copilt.org/wp-json/aicc-license/v1/plans", 301, `${W}/wp-json/aicc-license/v1/plans`),
  r("https://copilt.org/wp-json/aicc-license/v1/activate", 308, `${W}/wp-json/aicc-license/v1/activate`, { method: "POST" }),
  r("http://copilt.org/wp-json/aicc-license/v1/connect/ack", 308, `${W}/wp-json/aicc-license/v1/connect/ack`, { method: "POST" }),
  r("https://copilt.org/_next/static/chunks/main.js", 301, `${W}/_next/static/chunks/main.js`),
  r("https://copilt.org/?wc-ajax=get_refreshed_fragments", 301, `${W}/?wc-ajax=get_refreshed_fragments`),
  // ---- host + path rule in ONE hop (no chain) -----------------------------------------------------------------
  r("https://copilt.org/product", 301, `${W}/product/`),
  r("http://copilt.org/pricing?plan=agency", 301, `${W}/pricing/?plan=agency`),
  r("https://copilt.org/he", 301, `${W}/he/`),
  r("https://copilt.org/account/", 301, `${W}/my-account/`),
  r("https://copilt.org/login?plan=solo", 301, `${W}/my-account/?plan=solo`),
  r("http://copilt.org/he/register/?plan=studio", 301, `${W}/he/my-account/?plan=studio`),
  r("https://copilt.org/shop/", 301, `${W}/pricing/`),
  r("https://copilt.org/index.html", 301, `${W}/`),
  r("https://copilt.org/ai-commerce-copilot-site/", 301, `${W}/`),
  r("https://copilt.org/ai-commerce-copilot-site/he/product/", 301, `${W}/he/product/`),
  r("https://copilt.org/ai-commerce-copilot-site/pricing", 301, `${W}/pricing/`),
  // ---- canonical host: path rules ------------------------------------------------------------------------------
  r("https://www.copilt.org/account/", 301, `${W}/my-account/`),
  r("https://www.copilt.org/account", 301, `${W}/my-account/`),
  r("https://www.copilt.org/login/?plan=studio", 301, `${W}/my-account/?plan=studio`),
  r("https://www.copilt.org/register/", 301, `${W}/my-account/`),
  r("https://www.copilt.org/es/account/?plan=agency", 301, `${W}/es/my-account/?plan=agency`),
  r("https://www.copilt.org/ru/login", 301, `${W}/ru/my-account/`),
  r("https://www.copilt.org/store/", 301, `${W}/pricing/`),
  r("https://www.copilt.org/shop", 301, `${W}/pricing/`),
  r("https://www.copilt.org/he/shop/", 301, `${W}/he/pricing/`),
  r("https://www.copilt.org/ai-commerce-copilot-site/", 301, `${W}/`),
  r("https://www.copilt.org/ai-commerce-copilot-site", 301, `${W}/`),
  r("https://www.copilt.org/ai-commerce-copilot-site/he/", 301, `${W}/he/`),
  r("https://www.copilt.org/ai-commerce-copilot-site/_next/static/css/a.css", 301, `${W}/_next/static/css/a.css`),
  r("https://www.copilt.org/ai-commerce-copilot-site/brand-kit/aicc-logomark.svg", 301, `${W}/brand-kit/aicc-logomark.svg`),
  r("https://www.copilt.org/ai-commerce-copilot-site/privacy", 301, `${W}/privacy/`),
  r("https://www.copilt.org/index.html", 301, `${W}/`),
  r("https://www.copilt.org/he/pricing/index.html", 301, `${W}/he/pricing/`),
  r("https://www.copilt.org/product", 301, `${W}/product/`),
  r("https://www.copilt.org/ru/questions?x=1", 301, `${W}/ru/questions/?x=1`),
  r("https://www.copilt.org/data-and-trust", 301, `${W}/data-and-trust/`),
  r("https://www.copilt.org/my-account", 301, `${W}/my-account/`),
  r("https://www.copilt.org/my-account/aicc-licenses", 301, `${W}/my-account/aicc-licenses/`),
  r("https://www.copilt.org/he/my-account/lost-password", 301, `${W}/he/my-account/lost-password/`),
  r("https://www.copilt.org/checkout/order-received/12", 301, `${W}/checkout/order-received/12/`),
  r("https://www.copilt.org/ru", 301, `${W}/ru/`),
  r("https://www.copilt.org/data-processing-addendum", 301, `${W}/data-processing-addendum/`),
  // ---- path rules keep the method: GET/HEAD 301, everything else 308 (a POST to a slash-less WooCommerce URL must not become a GET) ----
  r("https://www.copilt.org/checkout/order-received/12", 308, `${W}/checkout/order-received/12/`, { method: "POST" }),
  r("https://www.copilt.org/checkout/order-received/12?key=wc_order_x", 308, `${W}/checkout/order-received/12/?key=wc_order_x`, { method: "POST" }),
  r("https://www.copilt.org/he/my-account/lost-password", 308, `${W}/he/my-account/lost-password/`, { method: "POST" }),
  r("https://www.copilt.org/my-account?plan=studio", 308, `${W}/my-account/?plan=studio`, { method: "POST" }),
  r("https://www.copilt.org/pricing", 308, `${W}/pricing/`, { method: "PUT" }),
  r("https://www.copilt.org/account", 308, `${W}/my-account/`, { method: "POST" }),
  r("https://www.copilt.org/es/login?plan=agency", 308, `${W}/es/my-account/?plan=agency`, { method: "POST" }),
  r("https://www.copilt.org/shop", 308, `${W}/pricing/`, { method: "DELETE" }),
  r("https://www.copilt.org/he", 308, `${W}/he/`, { method: "POST" }),
  r("https://www.copilt.org/privacy/index.html", 308, `${W}/privacy/`, { method: "POST" }),
  r("https://www.copilt.org/ai-commerce-copilot-site/pricing", 308, `${W}/pricing/`, { method: "POST" }),
  r("https://copilt.org/checkout/order-received/12", 308, `${W}/checkout/order-received/12/`, { method: "POST", note: "apex + path rule in one hop, method kept" }),
  r("http://copilt.org/account?plan=solo", 308, `${W}/my-account/?plan=solo`, { method: "POST" }),
  r("https://www.copilt.org/pricing", 301, `${W}/pricing/`, { method: "HEAD" }),
  r("https://www.copilt.org/checkout/order-received/12", 301, `${W}/checkout/order-received/12/`, { method: "HEAD" }),
  r("https://www.copilt.org/pricing?x=1", 301, `${W}/pricing/?x=1`, { method: "HEAD" }),
  // ---- canonical host: served, no redirect --------------------------------------------------------------------
  o("https://www.copilt.org/", "static"),
  o("https://www.copilt.org/he/", "static"),
  o("https://www.copilt.org/es/", "static"),
  o("https://www.copilt.org/ru/", "static"),
  o("https://www.copilt.org/product/", "static"),
  o("https://www.copilt.org/he/product/", "static"),
  o("https://www.copilt.org/questions/", "static"),
  o("https://www.copilt.org/es/questions/", "static"),
  o("https://www.copilt.org/data-and-trust/", "static"),
  o("https://www.copilt.org/ru/data-and-trust/", "static"),
  o("https://www.copilt.org/?plan=solo", "static", 200, { note: "an arbitrary query on / is still the static home page" }),
  o("https://www.copilt.org/_next/static/chunks/main.js", "static"),
  o("https://www.copilt.org/brand-kit/aicc-logomark.svg", "static"),
  o("https://www.copilt.org/fonts/heebo-hebrew.woff2", "static"),
  o("https://www.copilt.org/og/en-home.jpg", "static"),
  o("https://www.copilt.org/demo/aicc-demo.mp4", "static", 200, { note: "the CP's Watch demo uses these canonical same-origin paths" }),
  o("https://www.copilt.org/favicon.ico", "static"),
  o("https://www.copilt.org/robots.txt", "static"),
  o("https://www.copilt.org/sitemap.xml", "static"),
  o("https://www.copilt.org/__next._tree.txt", "static"),
  o("https://www.copilt.org/he/product/__next._head.txt", "static"),
  o("https://www.copilt.org/index.txt", "static"),
  // WordPress-owned
  o("https://www.copilt.org/pricing/", "wordpress"),
  o("https://www.copilt.org/he/pricing/", "wordpress"),
  o("https://www.copilt.org/privacy/", "wordpress", 200, { note: "same URL as the site's mirror: no HTTP redirect, the edge simply stops sending it to static" }),
  o("https://www.copilt.org/es/terms/", "wordpress"),
  o("https://www.copilt.org/ru/refund-policy/", "wordpress"),
  o("https://www.copilt.org/accessibility/", "wordpress"),
  o("https://www.copilt.org/data-processing-addendum/", "wordpress"),
  o("https://www.copilt.org/he/data-processing-addendum/", "wordpress"),
  o("https://www.copilt.org/es/data-processing-addendum/", "wordpress"),
  o("https://www.copilt.org/ru/data-processing-addendum/", "wordpress"),
  o("https://www.copilt.org/cart/", "wordpress"),
  o("https://www.copilt.org/checkout/", "wordpress"),
  o("https://www.copilt.org/checkout/order-received/12/?key=wc_order_x", "wordpress"),
  o("https://www.copilt.org/checkout/order-pay/12/?pay_for_order=true&key=wc_order_x", "wordpress"),
  o("https://www.copilt.org/my-account/", "wordpress"),
  // the static site's language-aware Get started / plan links (src/lib/site.ts getStartedUrl/planUrl): canonical, no redirect, straight to WordPress with the prefix and ?plan= intact
  o("https://www.copilt.org/he/my-account/", "wordpress"),
  o("https://www.copilt.org/es/my-account/?plan=studio", "wordpress"),
  o("https://www.copilt.org/ru/my-account/?plan=agency", "wordpress"),
  o("https://www.copilt.org/my-account/?plan=solo", "wordpress"),
  o("https://www.copilt.org/he/my-account/lost-password/", "wordpress"),
  o("https://www.copilt.org/my-account/aicc-licenses/", "wordpress"),
  o("https://www.copilt.org/my-account/connect-aicc/?token=abc", "wordpress"),
  o("https://www.copilt.org/product/aicc-solo/", "wordpress", 200, { note: "WooCommerce single product (WordPress 302s it to /pricing/); /product/ itself is the site's page" }),
  o("https://www.copilt.org/he/product/aicc-solo/", "wordpress"),
  o("https://www.copilt.org/product-category/plans/", "wordpress"),
  o("https://www.copilt.org/shop/page/2/", "wordpress"),
  o("https://www.copilt.org/wp-json/aicc-license/v1/plans", "wordpress"),
  o("https://www.copilt.org/wp-json/wc/store/v1/cart", "wordpress"),
  o("https://www.copilt.org/wp-admin/admin-ajax.php", "wordpress"),
  o("https://www.copilt.org/wp-login.php", "wordpress"),
  o("https://www.copilt.org/wp-content/themes/aicc-admin/assets/css/aicc-public.css", "wordpress", 200, { cache: "", note: "theme/plugin assets: NOT forced to no-store (WordPress sends validators)" }),
  o("https://www.copilt.org/wp-content/uploads/2026/10/a.png", "wordpress", 200, { cache: "" }),
  o("https://www.copilt.org/wp-includes/js/jquery/jquery.min.js", "wordpress", 200, { cache: "" }),
  o("https://www.copilt.org/wp-json/aicc-license/v1/activate", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/wp-login.php", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/wp-admin/admin-ajax.php", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/wp-cron.php", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/cart/", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/he/checkout/", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/ru/my-account/aicc-licenses/", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/pricing/", "wordpress", 200, { cache: "" }),
  // WooCommerce plain-permalink endpoints on the ROOT path, with and without a language prefix (the CP no longer prefixes wc_ajax_url, but the edge must not depend on that)
  o("https://www.copilt.org/?wc-ajax=update_order_review", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/?rest_route=/wc/store/v1/cart", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/?wc-api=wc_gateway_x", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/?foo=1&wc-ajax=get_refreshed_fragments", "wordpress", 200, { cache: NOCACHE }),
  ...["he", "es", "ru"].flatMap((l) => [
    o(`https://www.copilt.org/${l}/?wc-ajax=get_refreshed_fragments`, "wordpress", 200, { cache: NOCACHE }),
    o(`https://www.copilt.org/${l}/?wc-api=wc_gateway_x`, "wordpress", 200, { cache: NOCACHE }),
    o(`https://www.copilt.org/${l}/?rest_route=/wc/store/v1/cart`, "wordpress", 200, { cache: NOCACHE }),
    o(`https://www.copilt.org/${l}/?plan=solo`, "static", 200, { note: "negative control: an ordinary query on a language root is still the static page" }),
    o(`https://www.copilt.org/${l}/?awc-ajax=x`, "static", 200, { note: "negative control: the key must match whole" }),
  ]),
  o("https://www.copilt.org/?awc-ajax=x", "static", 200, { note: "negative control: the key must match whole" }),
  o("https://www.copilt.org/pricing/__next._tree.txt", "404", 404, { note: "Next prefetch payload of a WordPress-owned route: cheap 404 at the edge, never a PHP request" }),
  o("https://www.copilt.org/he/terms/index.txt", "404", 404),
  // ---- 404s: never owned -------------------------------------------------------------------------------------------
  o("https://www.copilt.org/get-started/", "404", 404, { note: "UNOWNED: promised by the docs, not built in the site" }),
  o("https://www.copilt.org/install/", "404", 404, { note: "blocked alias (target not built)" }),
  o("https://www.copilt.org/download/", "404", 404),
  o("https://www.copilt.org/docs/", "404", 404),
  o("https://www.copilt.org/faq/", "404", 404),
  o("https://www.copilt.org/contact/", "404", 404),
  o("https://www.copilt.org/Pricing/", "404", 404, { note: "uppercase is not folded: 404 (URLs are case-sensitive; nothing links to them)" }),
  o("https://www.copilt.org/PRODUCT/", "404", 404),
  o("https://www.copilt.org/he/nothing-here/", "404", 404),
  o("https://www.copilt.org/en/", "404", 404, { note: "English has no /en/ prefix (parseSlug returns null): no duplicate URL" }),
  o("https://www.copilt.org/404/", "404", 404, { note: "out/404/index.html would otherwise be a 200 duplicate of the error page" }),
  o("https://www.copilt.org/_not-found/", "404", 404),
  o("https://www.copilt.org/404.html", "404", 404),
  o("https://www.copilt.org/he/wp-json/aicc-license/v1/plans", "404", 404, { note: "a language prefix in front of a machine path is never served (class-aicc-lm-i18n.php)" }),
];

/** Representative request paths for the "at most one hop, never a loop" sweep over all four host/scheme combinations. */
export const SWEEP_PATHS = [
  "/", "/he", "/he/", "/es", "/ru/", "/product", "/product/", "/he/product", "/pricing", "/pricing/", "/he/pricing/", "/questions", "/data-and-trust",
  "/privacy", "/terms", "/refund-policy", "/accessibility", "/data-processing-addendum", "/cart", "/cart/", "/checkout", "/checkout/", "/checkout/order-received/9",
  "/checkout/order-pay/9/", "/my-account", "/my-account/", "/my-account/aicc-licenses", "/my-account/connect-aicc/", "/he/my-account/edit-account", "/account", "/account/",
  "/login", "/register/", "/store", "/shop", "/shop/", "/install", "/download/", "/index.html", "/he/index.html", "/privacy/index.html", "/ai-commerce-copilot-site",
  "/ai-commerce-copilot-site/", "/ai-commerce-copilot-site/product", "/ai-commerce-copilot-site/he/pricing/", "/ai-commerce-copilot-site/index.html",
  "/ai-commerce-copilot-site/robots.txt", "/robots.txt", "/sitemap.xml", "/favicon.ico", "/_next/static/chunks/a.js", "/brand-kit/x.svg", "/og/en-home.jpg", "/demo/aicc-demo.mp4",
  "/wp-json/aicc-license/v1/plans", "/wp-login.php", "/wp-admin/", "/?wc-ajax=x", "/get-started", "/get-started/", "/docs", "/en/", "/404/", "/_not-found/", "/Pricing", "/he/nothing",
];
