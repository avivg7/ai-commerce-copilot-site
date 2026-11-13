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
/** The Watch demo files are NOT immutable (same URL, replaceable master): revalidatable (ETag/Last-Modified, 304) instead of the one-day cache of the other static assets. */
export const STATIC_DEMO_RE = "^/demo/.*$";
/**
 * Admin-surface rules (owner decision 2026-10-20; proven by the real-Caddy rehearsal). `(?i)` = case-insensitive (the model strips it into a JS flag).
 * BAD_PATH: dot-segments, backslash, control characters, tested on the path AS SENT (`vars_regexp {http.request.uri.path}`): Caddy's path matchers see a cleaned path but reverse_proxy forwards the raw one, so a request that needs cleaning is refused instead of being matched on one form and served on another.
 * Operator-only rules use the AICC_OPERATOR_CIDRS environment variable (the model replays them with a header that says the peer is / is not an operator).
 */
export const BAD_PATH_RE = "(?:^|/)\\.{1,2}(?:/|$)|\\\\|[\\x00-\\x1f\\x7f]";
export const XMLRPC_RE = "(?i)^/xmlrpc\\.php(?:/.*)?$";
export const WP_CRON_RE = "(?i)^/wp-cron\\.php(?:/.*)?$";
export const WP_ADMIN_RE = "(?i)^/wp-admin(?:/|$)";
export const WP_ADMIN_PUBLIC_RE = "(?i)^/wp-admin/(?:admin-ajax|admin-post)\\.php$";
export const WP_LOGIN_RE = "(?i)^/wp-login\\.php(?:/.*)?$";
/**
 * The ONLY public shapes of /wp-login.php (customer logout, as wp_logout_url() builds it): GET/HEAD, the exact path (no path-info, lower case), and exactly
 *   action=logout[&redirect_to=<x>][&_wpnonce=<hex>]      WordPress's confirm page / the nonce-carrying logout
 *   loggedout=true[&wp_lang=<locale>]                      WordPress's landing page after logout
 * No other parameter, no other method, no case-insensitivity. A broader exception (any method, `(?i)`, parameter anywhere) let `POST /wp-login.php?loggedout=true`
 * with a login body reach wp_signon() from any address (security review F2, reproduced on the twin: 302 + a valid session cookie). No `{n,m}` quantifier and no whitespace:
 * the expression is written unquoted in the Caddyfile.
 */
export const WP_LOGIN_PUBLIC_METHODS = ["GET", "HEAD"];
export const WP_LOGIN_PUBLIC_PATH = "/wp-login.php";
export const WP_LOGIN_PUBLIC_QUERY = "^(action=logout(&redirect_to=[^&]*)?(&_wpnonce=[0-9a-f]+)?|loggedout=true(&wp_lang=[A-Za-z_]+)?)$";
/**
 * Linux/stage architecture (Caddy php_fastcgi over a unix socket to PHP-FPM, WordPress docroot read by the edge itself): nginx's `location ~ \.php$` hardening moves into the edge.
 * PHP_DENY: any path that contains a PHP extension (also followed by path-info) is a branded 404 ... PHP_ENTRY: ... unless it is one of WordPress's real entry points:
 * /index.php, /wp-login.php, /wp-cron.php and the direct children of /wp-admin/ (admin-ajax.php, admin-post.php, the operator pages). Plugin, theme, uploads and wp-includes
 * .php files are never executed directly (an uploaded or plugin-supplied .php file is the classic WordPress takeover). Applied on both listeners, after the deny rules (so
 * /xmlrpc.php, /wp-login.php, /wp-cron.php and /wp-admin/ keep their 403s) and before anything is proxied.
 */
export const PHP_DENY_RE = "(?i)\\.(?:php[0-9]?|phtml|phar|pht)(?:/|$)";
export const PHP_ENTRY_RE = "^/(?:index|wp-login|wp-cron)\\.php$|^/wp-admin/[A-Za-z0-9_-]+\\.php$";
/** Files in WordPress's own trees that are never public: dotfiles and dot-directories (.git, .htaccess, .env), logs/dumps/backups, readme/changelog/license (version disclosure). 404, never proxied or served. */
/**
 * Security review L4 (2026-10-21): also dependency manifests and lock files (composer.json/.lock, vendor/composer/installed.json, package.json, package-lock.json, yarn.lock, pnpm-lock.yaml),
 * translation sources (.po/.pot/.mo: WordPress reads them from DISK, never over HTTP), tool configs (phpcs/phpunit .xml), sample-data and tests/docs directories of plugins and themes, and sample CSVs
 * under plugins (WooCommerce ships sample-data/*.csv), and, since the security review of 2026-10-24 (the raw legal Markdown sources with their internal placeholders and the build/dev files of WordPress,
 * WooCommerce and the theme were served): any .md/.neon/.dist/.map file, any .d.ts file, package.xml, the brand MANIFEST.json / contract-baseline.json, sources.json and the whole plugins/NAME/languages/legal/ tree. Public assets (js, css, images, fonts, json that scripts fetch) are untouched.
 */
export const WP_HIDDEN_RE = "(?i)^/wp-(?:content|includes)/(?:.*/\\.|.*/(?:readme|changelog|licen[cs]e)\\.(?:txt|md|html)$|.*\\.(?:log|sql|bak|old|orig|swp|env|ini|sh|po|pot|mo)$|(?:.*/)?(?:composer\\.(?:json|lock)|installed\\.json|package(?:-lock)?\\.json|yarn\\.lock|pnpm-lock\\.yaml|phpcs[^/]*\\.xml(?:\\.dist)?|phpunit[^/]*\\.xml(?:\\.dist)?)$|plugins/.*\\.csv$|.*\\.(?:md|neon|dist|map)$|.*\\.d\\.ts$|(?:.*/)?(?:package\\.xml|MANIFEST\\.json|contract-baseline\\.json|sources\\.json)$|.*/languages/legal/|(?:plugins|themes)/[^/]+/(?:.*/)?(?:sample-data|sample_data|tests?|docs)/)";

/**
 * Security review B, F-11 (2026-10-23): Apache's .htaccess protections (WooCommerce's woocommerce_uploads / wc-logs, WordPress backup plugins' dirs) do not exist under Caddy, and the static
 * `file_server` had no dotfile or extension deny. Three edge rules for BOTH listeners, all answering the branded 404 whether or not a file exists there:
 *   DOTFILE_RE          any path segment that starts with a dot, except /.well-known/ (ACME is handled by Caddy itself before the routes; Search Console/security.txt live under it);
 *   WP_PRIVATE_DIRS_RE  WooCommerce's private upload dirs (invoices, downloadable products, logs) and the usual backup/log/upgrade directories of WordPress;
 *   SENSITIVE_EXT_RE    dumps, backups, archives, key and config files anywhere (static export, WordPress docroot, uploads). Archives are never legitimate public files here: the Plugin ZIP is
 *                       delivered by a PHP route from a store outside every web root, not by URL.
 */
export const DOTFILE_RE = "(?i)(?:^|/)\\.";
/** The one dot-path that stays public (Caddy's regexp engine is RE2: no look-ahead, so the exception is a separate `not` matcher). */
export const DOTFILE_PUBLIC_RE = "(?i)^/\\.well-known(?:/|$)";
export const WP_PRIVATE_DIRS_RE = "(?i)^/wp-content/(?:uploads/(?:woocommerce_uploads|wc-logs)|wc-logs|upgrade|ai1wm-backups|updraft|backups?|backup-db|wflogs)(?:/|$)";
export const SENSITIVE_EXT_RE = "(?i)\\.(?:sql|dump|bak|old|orig|swp|log|gz|tgz|tar|zip|7z|rar|bz2|xz|env|ini|cnf|conf|ya?ml|toml|sh|pem|key|p12|pfx|sqlite3?|db|wpress)$";/** Paths that must be a branded edge 404: the export's error-page duplicates, the multisite entry points (WordPress would 302 them to wp-login.php?action=register = 403), and the 5xx page file itself (served only by handle_errors). */
export const DUPLICATE_ERROR_RE = "^/(?:404|_not-found)(?:/|\\.html)?$|^/(?:wp-activate|wp-signup)\\.php$|^/50x\\.html$";
export const WP_MACHINE_RE = "^/(?:wp-json|wp-admin|wc-api|wc-ajax)(?:/.*)?$|^/(?:wp-login\\.php|wp-cron\\.php|xmlrpc\\.php)$";
/** WordPress's own static files: routed to WordPress but NOT forced to no-store (WordPress / the hosting stack send validators and decide caching; forcing no-store made every theme asset uncacheable). */
export const WP_ASSETS_RE = "^/(?:wp-content|wp-includes)(?:/.*)?$";
/** The root path, with or without a language prefix: WooCommerce's plain-permalink endpoints (?wc-ajax=, ?wc-api=, ?rest_route=) live on it. */
export const WP_ROOT_PATH_RE = `^${LOC}/$`;
export const WP_ROOT_QUERY = "(^|&)(wc-ajax|wc-api|rest_route)=";
/**
 * The REST API INDEX (architecture review H-4, 2026-10-21). `GET /wp-json/` (and `?rest_route=/`, which WordPress honours on ANY URL) builds a 1.2 MB document that enumerates every
 * namespace and costs 0.5-1.1 s of PHP on a one-vCPU host; nothing public needs route discovery. The PUBLIC listener answers the exact index forms with the branded 404; the loopback
 * OPERATOR listener keeps it (wp-admin's block editor and REST discovery use it). Namespaced routes (/wp-json/<ns>/..., ?rest_route=/<ns>/...) are NOT touched.
 * Query form: WordPress takes `rest_route` from the query string, trims trailing slashes/backslashes and treats an empty route as "/": so a missing value, "/", "//", "%2F" are all the index.
 * The parameter NAME may be percent-encoded (PHP decodes it), so each letter and the underscore accept their %XX form. (A raw backslash value is not matched: it would need a backslash
 * in a CEL string; the edge's own bad_path rule refuses backslashes in the PATH only.) This is cost containment, not an access-control boundary.
 */
const pctLetter = (ch) => { const hex = ch.charCodeAt(0).toString(16).toUpperCase().split("").map((x) => (/[A-F]/.test(x) ? `[${x}${x.toLowerCase()}]` : x)).join(""); return `(?:${ch}|%${hex})`; };
export const WP_REST_INDEX_PATH_RE = `^${LOC}/wp-json/?$`;
export const WP_REST_INDEX_QUERY = `(^|&)${[..."rest"].map(pctLetter).join("")}(?:_|%5[Ff])${[..."route"].map(pctLetter).join("")}(=(?:/|%2[Ff]|%5[Cc])*)?(&|$)`;
export const RSC_UNDER_WP_RE = `^${LOC}/(?:pricing|privacy|terms|refund-policy|accessibility)/(?:__next[^/]*|index)\\.txt$`;
/** Next's client-navigation payloads of the static routes. They sit under /product/ too, which WooCommerce's /product/<slug>/ would otherwise swallow. */
export const STATIC_RSC_RE = `^${LOC}(?:/(?:product|questions|data-and-trust))?/(?:__next[^/]*|index)\\.txt$`;
/**
 * The launch-offer request pages (P32): /request-access/ and /request-access/confirm/ (and anything below), in every language. STATIC (the Next export, only in an OPEN campaign build), answered with the
 * request-page CSP (static_csp_request: the one extra origin is challenges.cloudflare.com, for Cloudflare Turnstile). They sit BEFORE the default static handler and after every WordPress rule, so no
 * WordPress page can shadow them and they can never reach WordPress. The API they call (/wp-json/aicc/v1/access-requests*) is the existing WordPress machine path (WP_MACHINE_RE, never cached).
 */
export const REQUEST_ACCESS_RE = `^${LOC}/request-access(?:/.*)?$`;
/** The launch-offer request intake (P32): ONLY /wp-json/aicc/v1/access-requests and below. It gets the 4 KB body cap (to_wordpress_intake); every other REST route keeps the ordinary machine-path handling. */
export const WP_INTAKE_RE = "(?i)^/wp-json/aicc/v1/access-requests(?:/.*)?$"; // case-insensitive: WordPress dispatches REST routes case-insensitively, so a case variant must not escape the 4 KB cap
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
/** d(...) = denied by the edge with a 403 and no-store; b(...) = refused as a malformed path with a 400. */
const d = (from, extra = {}) => o(from, "edge-deny", 403, { cache: "no-store", ...extra });
const b = (from, extra = {}) => o(from, "edge-deny", 400, { cache: "no-store", ...extra });
const m405 = (from, method, extra = {}) => o(from, "edge-deny", 405, { cache: "no-store", method, ...extra });
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
  o("https://www.copilt.org/demo/aicc-demo.mp4", "static", 200, { cache: "public, max-age=0, must-revalidate", note: "the CP's Watch demo uses these canonical same-origin paths; revalidatable, not a day-long cache, because the master can be replaced under the same URL" }),
  o("https://www.copilt.org/demo/aicc-demo.vtt", "static", 200, { cache: "public, max-age=0, must-revalidate" }),
  o("https://www.copilt.org/demo/aicc-demo-poster.jpg", "static", 200, { cache: "public, max-age=0, must-revalidate" }),
  o("https://www.copilt.org/brand-kit/aicc-logomark.svg", "static", 200, { cache: "public, max-age=86400" }),
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
  o("https://www.copilt.org/wp-content/themes/aicc-admin/assets/css/aicc-public.css", "wordpress", 200, { cache: "", note: "theme/plugin assets: NOT forced to no-store (WordPress sends validators)" }),
  o("https://www.copilt.org/wp-content/uploads/2026/10/a.png", "wordpress", 200, { cache: "" }),
  o("https://www.copilt.org/wp-includes/js/jquery/jquery.min.js", "wordpress", 200, { cache: "" }),
  o("https://www.copilt.org/wp-json/aicc-license/v1/activate", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/wp-admin/admin-ajax.php", "wordpress", 200, { cache: NOCACHE }),
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
  // ---- REST API index (architecture review H-4): the public listener answers the index forms with the branded 404; namespaced routes and the operator listener are untouched
  ...["/wp-json", "/wp-json/", "/he/wp-json", "/he/wp-json/", "/es/wp-json/", "/ru/wp-json", "/wp-json/?context=view", "/wp-json//", "/?rest_route=/", "/?rest_route=", "/?rest_route", "/?rest_route=%2F", "/?rest_route=//", "/?rest_route=/&x=1", "/?x=1&rest_route=/", "/he/?rest_route=/", "/es/?rest_route=%2f", "/ru/?rest_route=", "/?rest%5Froute=/", "/?%72est_route=/", "/pricing/?rest_route=/", "/product/?rest_route=/", "/cart/?rest_route=/"].map((p) => o(`https://www.copilt.org${p}`, "404", 404, { publicOnly: true, note: "REST index: public 404 (operator listener keeps it)" })),
  o("https://www.copilt.org/wp-json/wp/v2/types", "wordpress", 200, { cache: NOCACHE, note: "namespaced routes are untouched" }),
  o("https://www.copilt.org/wp-json/wc/store/v1/", "wordpress", 200, { cache: NOCACHE, note: "a namespace index is not the root index" }),
  o("https://www.copilt.org/wp-json/wc/store/v1/cart/items", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/?rest_route=/aicc-license/v1/plans", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/?rest_route=/wc/store/v1/cart&x=1", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/?rest_route=/wp/v2/types", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/he/?rest_route=/aicc-license/v1/plans", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/?xrest_route=/", "static", 200, { note: "negative control: the parameter name must match whole" }),
  o("https://www.copilt.org/?rest_route_x=/", "static", 200, { note: "negative control: the parameter name must match whole" }),
  o("https://www.copilt.org/wp-json/", "wordpress", 200, { peer: "operator", cache: NOCACHE, note: "wp-admin's REST discovery: the operator listener keeps the index" }),
  o("https://www.copilt.org/wp-json", "wordpress", 200, { peer: "operator", cache: NOCACHE }),
  o("https://www.copilt.org/?rest_route=/", "wordpress", 200, { peer: "operator", cache: NOCACHE }),
  o("https://www.copilt.org/wp-json/wp/v2/types", "wordpress", 200, { peer: "operator", cache: NOCACHE }),
  o("https://www.copilt.org/pricing/__next._tree.txt", "404", 404, { note: "Next prefetch payload of a WordPress-owned route: cheap 404 at the edge, never a PHP request" }),
  o("https://www.copilt.org/he/terms/index.txt", "404", 404),
  // ---- admin surface (owner decision 2026-10-20). `peer: "operator"` = the connection comes from AICC_OPERATOR_CIDRS; the default is a public visitor. ----
  o("https://www.copilt.org/wp-admin/admin-ajax.php", "wordpress", 200, { cache: NOCACHE, note: "public: Action Scheduler's async runner, gateway plugins and WordPress itself call it for visitors" }),
  o("https://www.copilt.org/wp-admin/admin-post.php", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/wp-admin/admin-ajax.php?action=heartbeat", "wordpress", 200, { cache: NOCACHE }),
  d("https://www.copilt.org/wp-admin/", { note: "operators only" }),
  d("https://www.copilt.org/wp-admin"),
  d("https://www.copilt.org/wp-admin/post.php?post=1&action=edit"),
  d("https://www.copilt.org/wp-admin/plugins.php"),
  d("https://www.copilt.org/wp-admin/admin-ajax.php/x", { note: "path-info after admin-ajax.php is not the public file" }),
  o("https://www.copilt.org/wp-admin//admin-ajax.php", "wordpress", 200, { cache: NOCACHE, note: "REAL-CADDY FINDING: path matchers see the cleaned path (// merged), so this IS the public file; nginx/Apache merge slashes too, so both agree" }),
  d("https://www.copilt.org/WP-ADMIN/plugins.php", { note: "case-insensitive: macOS/Windows filesystems serve it" }),
  d("https://www.copilt.org/wp-admin/load-scripts.php"),
  o("https://www.copilt.org/wp-admin/", "wordpress", 200, { peer: "operator", cache: NOCACHE }),
  o("https://www.copilt.org/wp-admin/plugins.php", "wordpress", 200, { peer: "operator", cache: NOCACHE }),
  d("https://www.copilt.org/xmlrpc.php", { note: "no dependency in the Control Plane, plugin, theme or Backend (searched)" }),
  d("https://www.copilt.org/xmlrpc.php/"),
  d("https://www.copilt.org/xmlrpc.php/x"),
  d("https://www.copilt.org/XMLRPC.php"),
  d("https://www.copilt.org/%78mlrpc.php", { note: "Caddy matches the decoded path" }),
  d("https://www.copilt.org/%58mlrpc.PHP"),
  d("https://www.copilt.org/xmlrpc.php?rsd"),
  d("https://www.copilt.org/xmlrpc.php", { peer: "operator", note: "denied even for operators: nothing uses it" }),
  d("https://www.copilt.org/wp-login.php", { note: "staff sign-in: operators only" }),
  d("https://www.copilt.org/wp-login.php?action=lostpassword"),
  d("https://www.copilt.org/wp-login.php?action=register"),
  d("https://www.copilt.org/WP-LOGIN.php"),
  d("https://www.copilt.org/wp-login.php?redirect_to=x&action=logout2", { note: "negative control: the query value must match whole" }),
  // security review F2: the old exception matched any method and any case, so these reached wp_signon() from any address
  d("https://www.copilt.org/wp-login.php?loggedout=true", { method: "POST", note: "REVIEW F2: POST with a login body used to return 302 + a session cookie" }),
  d("https://www.copilt.org/wp-login.php?action=logout", { method: "POST" }),
  d("https://www.copilt.org/wp-login.php?action=logout&_wpnonce=abc123", { method: "POST" }),
  d("https://www.copilt.org/wp-login.php?ACTION=logout", { method: "POST", note: "case variant of the parameter name" }),
  d("https://www.copilt.org/wp-login.php?ACTION=logout", { note: "GET too: the exception is exact and case-sensitive" }),
  d("https://www.copilt.org/wp-login.php?LOGGEDOUT=true", { method: "POST" }),
  d("https://www.copilt.org/wp-login.php?loggedout=TRUE"),
  d("https://www.copilt.org/wp-login.php?loggedout=true&log=a&pwd=b", { method: "POST", note: "extra parameters" }),
  d("https://www.copilt.org/wp-login.php?action=logout&action=login", { method: "POST" }),
  d("https://www.copilt.org/wp-login.php?action=logout&x=1", { note: "any extra parameter" }),
  d("https://www.copilt.org/wp-login.php?loggedout=true&x=1"),
  d("https://www.copilt.org/wp-login.php?x=1&loggedout=true", { note: "parameter order is part of the shape" }),
  d("https://www.copilt.org/wp-login.php?action=logout", { method: "PUT" }),
  d("https://www.copilt.org/wp-login.php?action=logout", { method: "DELETE" }),
  d("https://www.copilt.org/wp-login.php?action=logout", { method: "OPTIONS" }),
  d("https://www.copilt.org/wp-login.php/x?action=logout", { note: "path-info after the file" }),
  d("https://www.copilt.org/WP-LOGIN.php?action=logout", { note: "path case" }),
  d("https://www.copilt.org/wp-login.php?action=login", { method: "POST" }),
  d("https://www.copilt.org/wp-login.php?action=register", { method: "POST" }),
  d("https://www.copilt.org/wp-login.php?action=rp"),
  d("https://www.copilt.org/wp-login.php?action=resetpass", { method: "POST" }),
  d("https://www.copilt.org/wp-login.php?action=postpass", { method: "POST" }),
  d("https://www.copilt.org/wp-login.php?action=confirmaction"),
  o("https://www.copilt.org/wp-login.php?action=logout", "wordpress", 200, { method: "HEAD", cache: NOCACHE, note: "HEAD is allowed like GET" }),
  o("https://www.copilt.org/wp-login.php?action=logout&_wpnonce=abc123def", "wordpress", 200, { cache: NOCACHE, note: "CUSTOMER flow: wp_logout_url() in the Connect page and plan-intent code" }),
  o("https://www.copilt.org/wp-login.php?action=logout&redirect_to=https%3A%2F%2Fwww.copilt.org%2Fpricing%2F", "wordpress", 200, { cache: NOCACHE, note: "WordPress's confirm page (the order wp_logout_url() builds: action, redirect_to, _wpnonce)" }),
  o("https://www.copilt.org/wp-login.php?action=logout&redirect_to=https%3A%2F%2Fwww.copilt.org%2Fpricing%2F&_wpnonce=0a1b2c3d4e", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/wp-login.php?loggedout=true", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/wp-login.php?loggedout=true&wp_lang=en_US", "wordpress", 200, { cache: NOCACHE }),
  o("https://www.copilt.org/wp-login.php", "wordpress", 200, { method: "POST", peer: "operator", cache: NOCACHE, note: "operators may POST (staff sign-in)" }),
  o("https://www.copilt.org/wp-login.php?loggedout=true", "wordpress", 200, { method: "POST", peer: "operator", cache: NOCACHE }),
  o("https://www.copilt.org/wp-login.php", "wordpress", 200, { peer: "operator", cache: NOCACHE }),
  o("https://www.copilt.org/wp-login.php?action=lostpassword", "wordpress", 200, { peer: "operator", cache: NOCACHE }),
  d("https://www.copilt.org/wp-cron.php", { note: "DISABLE_WP_CRON + system cron; the entitlement outbox runs from the system cron" }),
  d("https://www.copilt.org/wp-cron.php?doing_wp_cron=1"),
  o("https://www.copilt.org/wp-cron.php", "wordpress", 200, { peer: "operator", cache: NOCACHE }),
  m405("https://www.copilt.org/pricing/", "TRACE", { note: "REAL-CADDY FINDING: TRACE to a proxied path reached PHP and got the page; the edge refuses TRACE/TRACK/CONNECT everywhere" }),
  m405("https://www.copilt.org/", "TRACE"),
  // ---- path ambiguity: refused before anything is proxied (nginx/Apache would normalise these; Caddy does not) ----
  b("https://www.copilt.org/pricing/../wp-admin/post.php", { note: "would reach a rule that only looks at the prefix" }),
  b("https://www.copilt.org/product/../pricing/"),
  b("https://www.copilt.org/pricing/%2e%2e/product/"),
  b("https://www.copilt.org/wp-admin/../xmlrpc.php"),
  b("https://www.copilt.org/pricing/./"),
  b("https://www.copilt.org/pricing/..%2fwp-admin/"),
  b("https://www.copilt.org/pricing/..%5cwp-admin/"),
  b("https://www.copilt.org/pricing/%00"),
  b("https://www.copilt.org/pricing/%0d%0aSet-Cookie:x=1"),
  o("https://www.copilt.org/..;/wp-admin/", "404", 404, { note: "`..;` is not a dot-segment for nginx/Apache/PHP and is not under any WordPress prefix: static 404, never proxied" }),
  // ---- review F15: not routed to WordPress (they ended in a 403 there) and the 5xx page is not a public page ----
  o("https://www.copilt.org/wp-activate.php", "404", 404, { note: "multisite entry point: the Control Plane is single-site" }),
  o("https://www.copilt.org/wp-signup.php", "404", 404),
  o("https://www.copilt.org/wp-signup.php", "404", 404, { method: "POST" }),
  o("https://www.copilt.org/50x.html", "404", 404, { note: "served only by the edge's error handler, never as a page" }),
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
  // ---- Linux/stage architecture (php_fastcgi, docroot read by the edge): PHP is executed only through WordPress's entry points; private files are never served ----
  o("https://www.copilt.org/wp-content/uploads/2026/10/shell.php", "404", 404, { note: "no PHP execution inside uploads (or anywhere but the entry points)" }),
  o("https://www.copilt.org/wp-content/plugins/woocommerce/woocommerce.php", "404", 404, { note: "plugin files are not entry points" }),
  o("https://www.copilt.org/wp-content/themes/aicc-admin/functions.php", "404", 404),
  o("https://www.copilt.org/wp-includes/version.php", "404", 404),
  o("https://www.copilt.org/wp-config.php", "404", 404),
  o("https://www.copilt.org/wp-load.php", "404", 404),
  o("https://www.copilt.org/wp-settings.php", "404", 404),
  o("https://www.copilt.org/wp-content/uploads/a.png/x.php", "404", 404, { note: "path-info trick: an image name followed by .php" }),
  o("https://www.copilt.org/wp-content/uploads/evil.PHP", "404", 404, { note: "extension case" }),
  o("https://www.copilt.org/wp-content/uploads/evil.phtml", "404", 404),
  o("https://www.copilt.org/wp-content/uploads/evil.php5", "404", 404),
  o("https://www.copilt.org/wp-content/uploads/evil.phar", "404", 404),
  o("https://www.copilt.org/pricing/x.php", "404", 404, { note: "a WordPress-owned page prefix does not make a .php path an entry point" }),
  o("https://www.copilt.org/wp-content/debug.log", "404", 404, { note: "WP_DEBUG_LOG output" }),
  o("https://www.copilt.org/wp-content/uploads/.htaccess", "404", 404),
  o("https://www.copilt.org/wp-content/plugins/woocommerce/.git/config", "404", 404),
  o("https://www.copilt.org/wp-content/plugins/woocommerce/readme.txt", "404", 404, { note: "version disclosure" }),
  // security review L4: dependency manifests, translation sources, sample data and test/doc directories are never public; real assets in the same trees are
  ...["/wp-content/plugins/woocommerce/vendor/composer/installed.json", "/wp-content/plugins/woocommerce/composer.json", "/wp-content/plugins/woocommerce/composer.lock", "/wp-content/themes/twentytwentyfive/package.json", "/wp-content/themes/aicc-admin/package-lock.json",
    "/wp-content/plugins/woocommerce/languages/woocommerce-he_IL.po", "/wp-content/plugins/woocommerce/i18n/languages/woocommerce.pot", "/wp-content/languages/plugins/woocommerce-he_IL.mo", "/wp-content/plugins/woocommerce/sample-data/sample_products.csv",
    "/wp-content/plugins/woocommerce/sample-data/", "/wp-content/plugins/aicc-license-manager/tests/run_x.php", "/wp-content/plugins/woocommerce/tests/readme", "/wp-content/plugins/some/docs/guide.png", "/wp-content/plugins/woocommerce/phpunit.xml.dist", "/wp-content/plugins/woocommerce/LICENCE.txt", "/wp-content/plugins/woocommerce/changelog.txt", "/wp-content/plugins/woocommerce/README.md",
    "/wp-content/PLUGINS/woocommerce/Composer.JSON"].map((p) => o(`https://www.copilt.org${p}`, "404", 404, { note: "review L4: never public" })),
  // security review 2026-10-24 (secR3): raw legal Markdown sources (internal placeholders) and build/dev files were served from wp-content; never public
  ...["/wp-content/plugins/aicc-license-manager/languages/legal/es_ES/privacy-policy.md", "/wp-content/plugins/aicc-license-manager/languages/legal/sources.json", "/wp-content/plugins/woocommerce/vendor/wordpress/mcp-adapter/phpstan.neon.dist",
    "/wp-content/plugins/woocommerce/vendor/maxmind-db/reader/package.xml", "/wp-content/themes/aicc-admin/assets/brand/MANIFEST.json", "/wp-content/themes/aicc-admin/assets/brand/contract-baseline.json",
    "/wp-content/plugins/woocommerce/vendor/x/y/index.d.ts", "/wp-content/plugins/x/assets/app.js.map"].map((p) => o(`https://www.copilt.org${p}`, "404", 404, { note: "secR3: never public" })),
  o("https://www.copilt.org/wp-content/plugins/woocommerce/assets/css/woocommerce.css", "wordpress", 200, { cache: "", note: "a real plugin asset next to the hidden files" }),
  o("https://www.copilt.org/wp-content/plugins/woocommerce/assets/js/frontend/cart.min.js", "wordpress", 200, { cache: "" }),
  o("https://www.copilt.org/wp-content/plugins/woocommerce/assets/fonts/WooCommerce.svg", "wordpress", 200, { cache: "" }),
  o("https://www.copilt.org/wp-content/themes/aicc-admin/assets/fonts/x.woff2", "wordpress", 200, { cache: "" }),
  o("https://www.copilt.org/wp-content/plugins/woocommerce/assets/client/blocks/wc-blocks.js", "wordpress", 200, { cache: "", note: "not a tests/docs directory" }),
  o("https://www.copilt.org/wp-content/plugins/woocommerce/assets/client/blocks/product-categories/block.json", "wordpress", 200, { cache: "", note: "only the named manifests are hidden, not every .json" }),
  o("https://www.copilt.org/wp-content/uploads/2026/10/export.csv", "wordpress", 200, { cache: "", note: "uploads are not plugin sample data" }),
  o("https://www.copilt.org/wp-content/uploads/2026/10/tests/photo.png", "wordpress", 200, { cache: "", note: "the tests/docs rule is plugins/themes only" }),
  o("https://www.copilt.org/wp-includes/ID3/license.txt", "404", 404),
  // security review B, F-11: Apache's .htaccess protections do not exist under Caddy. Dotfiles anywhere (except /.well-known/), WooCommerce's private upload dirs, WordPress backup/log dirs and sensitive
  // extensions are an edge 404 whether or not a file exists there (the real-Caddy test puts the files in place).
  ...["/.env", "/.git/config", "/.git/HEAD", "/.htaccess", "/.DS_Store", "/.npmrc", "/.aws/credentials", "/pricing/.env", "/_next/static/.env", "/demo/.hidden", "/.ENV", "/he/.git/config", "/%2e%65nv"].map((p) => o(`https://www.copilt.org${p}`, "404", 404, { note: "F-11: dotfile (outside /.well-known/)" })),
  ...["/wp-content/uploads/woocommerce_uploads/x.pdf", "/wp-content/uploads/woocommerce_uploads/2026/10/invoice.pdf", "/wp-content/uploads/wc-logs/fatal-errors-2026-10-22-abc.log", "/wp-content/uploads/wc-logs/a.log.gz", "/wp-content/wc-logs/a.txt",
    "/wp-content/upgrade/plugin.zip", "/wp-content/ai1wm-backups/site.wpress", "/wp-content/updraft/db.gz", "/wp-content/backups/db.txt", "/wp-content/wflogs/rules.php.txt", "/wp-content/uploads/WooCommerce_Uploads/x.pdf"]
    .map((p) => o(`https://www.copilt.org${p}`, "404", 404, { note: "F-11: WordPress/WooCommerce private directory (their .htaccess does nothing under Caddy)" })),
  ...["/backup.sql", "/db.dump", "/site.zip", "/export.tar", "/export.tgz", "/a/b/data.gz", "/app.env", "/config.yml", "/config.yaml", "/settings.toml", "/id_rsa.pem", "/server.key", "/cert.p12", "/x.sqlite", "/x.sqlite3", "/run.sh", "/notes.swp", "/page.old", "/page.orig",
    "/wp-content/uploads/2026/10/bundle.zip", "/wp-content/uploads/2026/10/export.tar.gz", "/demo/backup.sql", "/_next/static/x.bak", "/he/backup.sql", "/Backup.SQL"].map((p) => o(`https://www.copilt.org${p}`, "404", 404, { note: "F-11: sensitive extension, never served from any static or WordPress root" })),
  o("https://www.copilt.org/.well-known/security.txt", "404", 404, { note: "F-11: /.well-known/ is NOT blocked by the dotfile rule; this file does not exist in the static export, so the answer is the ordinary branded 404" }),
  o("https://www.copilt.org/wp-content/uploads/backup.sql", "404", 404),
  o("https://www.copilt.org/wp-content/uploads/site.bak", "404", 404),
  o("https://www.copilt.org/wp-admin/includes/file.php", "404", 404, { peer: "operator", note: "even an operator reaches only the direct children of /wp-admin/" }),
  o("https://www.copilt.org/wp-admin/admin-ajax.php/x", "404", 404, { peer: "operator", note: "operator listener: path-info after an entry point is not an entry point" }),
  // ---- metrics are private: Caddy's /metrics lives on the loopback admin API only, never on a site (the route table has no metrics handler) ----
  o("https://www.copilt.org/metrics", "404", 404, { note: "must never be Prometheus text" }),
  o("https://www.copilt.org/metrics/", "404", 404),
  o("https://www.copilt.org/he/metrics", "404", 404),
  o("https://www.copilt.org/metrics", "404", 404, { peer: "operator", note: "also not on the operator listener" }),
  r("https://copilt.org/metrics", 301, `${W}/metrics`, { note: "the apex redirects like any other path; the target is a 404" }),
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

/**
 * The same matrix for a host that is NOT www.copilt.org: the staging host (stage topology: ONE site address, no apex block).
 * Cases on the apex host are dropped (the stage render has no apex site), every `https://www.copilt.org` becomes `https://<host>` in `from` and `location`;
 * `http://www.copilt.org` becomes `http://<host>`. Port is not added here (callers add the explicit port the guard demands).
 */
export function retargetCases(cases, host) {
  const swap = (u) => (u === undefined ? u : u.replace(/^(https?):\/\/www\.copilt\.org(?=[/:?#]|$)/, `$1://${host}`));
  return cases
    .filter((c) => !new RegExp(`^https?://${APEX_HOST.replace(/\./g, "\\.")}(?=[/:?#]|$)`).test(c.from))
    .map((c) => ({ ...c, from: swap(c.from), location: swap(c.location) }));
}
/** Sweep paths are host-independent; the sweep hosts for a stage topology are [host] only. */
