// Flat product illustrations for the interactive demo: they stand in for the product photos the real storefront widget shows on a light tile.
// Everything drawn here is INVENTED sample content (no real products, no photography). The WooCommerce side of the demo renders the same drawings in neutral grey
// (CSS: `.aicc-fbt-plain .aicc-fbt-art { filter: grayscale(1) }`), so the colour difference between the two experiences is carried by styling, not by different artwork.
const BODY = "#e2e8f0", LINE = "#94a3b8", BLUE = "#2563eb", TEAL = "#05865f", DARK = "#475569";

const SHAPES = {
  kit: `<rect x="34" y="12" width="52" height="7" rx="3.5" fill="${LINE}"/><path d="M40 19h40l-8 26H48z" fill="#cbd5e1"/>` +
    `<path d="M44 49h32l6 8v35a10 10 0 0 1-10 10H48a10 10 0 0 1-10-10V57z" fill="${BODY}" stroke="${LINE}" stroke-width="2"/>` +
    `<path d="M39 72h42v20a10 10 0 0 1-10 10H49a10 10 0 0 1-10-10z" fill="${BLUE}" opacity=".85"/>` +
    `<path d="M82 66c10 0 14 6 14 13s-4 13-14 13" fill="none" stroke="${LINE}" stroke-width="4" stroke-linecap="round"/>`,
  filters: `<rect x="24" y="30" width="72" height="62" rx="6" fill="${BODY}" stroke="${LINE}" stroke-width="2"/><rect x="24" y="52" width="72" height="20" fill="${BLUE}" opacity=".85"/>` +
    `<path d="M36 42h48M36 82h30" stroke="${LINE}" stroke-width="3" stroke-linecap="round"/><path d="M44 62h32" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
  grinder: `<path d="M60 22V12h22" fill="none" stroke="${DARK}" stroke-width="4" stroke-linecap="round"/><circle cx="84" cy="12" r="5.5" fill="${BLUE}"/>` +
    `<rect x="38" y="22" width="44" height="10" rx="4" fill="${LINE}"/><rect x="42" y="32" width="36" height="46" rx="6" fill="#cbd5e1"/>` +
    `<path d="M40 78h40v14a8 8 0 0 1-8 8H48a8 8 0 0 1-8-8z" fill="${BODY}" stroke="${LINE}" stroke-width="2"/>`,
  mug: `<path d="M28 38h52v36a20 20 0 0 1-20 20h-12a20 20 0 0 1-20-20z" fill="${BODY}" stroke="${LINE}" stroke-width="2"/>` +
    `<path d="M80 48h6a12 12 0 0 1 0 24h-8" fill="none" stroke="${LINE}" stroke-width="5" stroke-linecap="round"/><rect x="31" y="52" width="46" height="8" fill="${BLUE}" opacity=".85"/>`,
  towel: `<rect x="22" y="40" width="76" height="46" rx="4" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="2"/><path d="M22 56h76M22 70h76" stroke="${TEAL}" stroke-width="3"/>` +
    `<path d="M30 40V30h60v10" fill="${BODY}"/>`,
  scale: `<rect x="40" y="14" width="40" height="12" rx="4" fill="${DARK}"/><path d="M38 26h44l-5 70a8 8 0 0 1-8 7H51a8 8 0 0 1-8-7z" fill="${BODY}" stroke="${LINE}" stroke-width="2"/>` +
    `<rect x="41" y="48" width="38" height="14" fill="${TEAL}" opacity=".85"/>`,
};

/** SVG markup for a sample product id (kit, filters, grinder, mug, towel, scale = the travel mug). Decorative: the product name is always next to it. */
export function productArt(id) {
  const body = SHAPES[id] || SHAPES.mug;
  return `<svg viewBox="0 0 120 120" class="aicc-fbt-art" focusable="false" aria-hidden="true">${body}</svg>`;
}
