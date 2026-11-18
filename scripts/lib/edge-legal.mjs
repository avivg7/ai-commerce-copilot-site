// P39 round 2 (H1): the Site export carries its OWN copies of the legal pages (/terms/ /privacy/ /refund-policy/ /accessibility/ and he/es/ru), which are OLDER drafts than the ones LIVE serves: the production edge routes those paths to
// WordPress (the Control Plane theme), never to this export. "Do not touch the legal pages" is therefore only safe while the edge keeps routing them to WordPress. This helper reads the edge template
// (docs/cutover/Caddyfile.edge.template, generated from scripts/lib/redirect-matrix.mjs WP_PAGES_RE) and reports a problem when the `@wp_pages` matcher no longer matches every legal route in every language.
export const LEGAL_ROUTES = ["terms", "privacy", "refund-policy", "accessibility", "data-processing-addendum"];
export const EDGE_PREFIXES = ["", "/he", "/es", "/ru"];
export function edgeLegalProblems(templateText) {
  const problems = [];
  const lines = String(templateText).split("\n").filter((l) => /@wp_pages\s+path_regexp\s+wp_pages\s+/.test(l));
  if (!lines.length) return ["the edge template has no `@wp_pages path_regexp wp_pages` matcher: the legal pages would be served from the (older) Site export"];
  for (const line of lines) {
    const re = line.replace(/^.*@wp_pages\s+path_regexp\s+wp_pages\s+/, "").trim();
    let rx;
    try { rx = new RegExp(re); } catch { problems.push(`the @wp_pages regular expression does not compile: ${re.slice(0, 80)}`); continue; }
    for (const pre of EDGE_PREFIXES) for (const r of [...LEGAL_ROUTES, "pricing", "my-account"]) for (const tail of ["/", "/x"]) {
      if (tail === "/x" && r !== "terms") continue;
      const p = `${pre}/${r}${tail}`;
      if (!rx.test(p)) problems.push(`the edge template's @wp_pages matcher does not route ${p} to WordPress (the Site export's older draft would be served)`);
    }
  }
  return [...new Set(problems)];
}
