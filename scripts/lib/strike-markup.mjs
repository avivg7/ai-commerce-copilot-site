// P40: the ONE definition of "this document shows a struck-through plan price" (built MARKUP, never a stylesheet): used by the release gate (scripts/ea-release-gate.mjs), `launch:check`, `ea:check` self-tests,
// the public-truth gate (scripts/lib/public-truth.mjs) and scripts/test-strike-gate.mjs, so every gate learns a new marker at once.
// The markers: the P36 card (class aicc-plan__regular--strike, <s><bdi>), the P40 card (class aicc-tier__price--strike, data-ss-price="strike", <s class="aicc-tier__amount">) and ANY <s> / <del> element.
// A class NAME inside a <style> block or a CSS file is not a struck price (a campaign build carries the rules in inline CSS, the kit names the class in its stylesheet): only attributes and elements count.
export const STRIKE_MARKERS = [
  ["class aicc-plan__regular--strike (P36 card)", /\bclass="[^"]*\baicc-plan__regular--strike\b/],
  ["class aicc-tier__price--strike (P40 card)", /\bclass="[^"]*\baicc-tier__price--strike\b/],
  ['data-ss-price="strike" (P40 card)', /\bdata-ss-price="strike"/],
  ['<s class="aicc-tier__amount"> (P40 amount)', /<s\s[^>]*\bclass="[^"]*\baicc-tier__amount\b/],
  ["<s> / <del> element", /<(?:s|del)(?:\s[^>]*)?>/],
];

/** The names of the strike markers present in this HTML (empty = none). Inline <style> bodies are removed first: a stylesheet that names the class is not markup. */
export function strikeMarkup(html) {
  const body = String(html).replace(/<style\b[\s\S]*?<\/style>/gi, "");
  return STRIKE_MARKERS.filter(([, re]) => re.test(body)).map(([name]) => name);
}

/** The Home and Pricing pages of the four languages: where a struck price can be. */
export const STRIKE_PAGES = ["", "he/", "es/", "ru/"].flatMap((l) => [`${l}index.html`, `${l}pricing/index.html`]);
