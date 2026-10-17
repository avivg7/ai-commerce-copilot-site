// A styled replica of the real AICC dashboard blocks (WordPress admin), with the real labels, for explaining "what you get".
// EVERYTHING in it is sample data and says so ("Sample data: not from a real store"): invented numbers, invented products.
// Blocks (labels from the plugin): Recommendation Views, Recommendation Clicks, Recommendation Click Rate, Bundle Add-To-Carts,
// Associated Orders, Associated Revenue (the plugin is being renamed from "AI Assisted ..." to "Associated ..."),
// the Merchant Insights card and a Recommendation Preview row ("Bought together N times").
// Two ways to use it: renderDashPreviewHTML(strings, opts) returns the markup (the site renders it on the server), and
// mountDashPreview(el, opts) fills a [data-aicc-dash] element (the Control Plane theme). Strings: strings.json[locale].dash.
//   opts: { locale, dir, variant: "compact" | "full" (full numbers the blocks 1-4), widget: boolean (show the shopper widget panel), callouts: false to omit the numbered legend }
import { icon } from "./icons.js";
import { langAttrs, labeler } from "./motion.js";

// Store-level sample numbers for the dashboard overview. They differ from the single-bundle tiles in the demo on purpose (one sample dashboard, shown once).
const SAMPLE = { views: 3860, clicks: 241, adds: 97, orders: 24, revenue: 1312 };

export function renderDashPreviewHTML(s, o = {}) {
  const locale = s._fallback ? "en" : o.locale || "en";
  const { T } = labeler(s, o);
  const variant = o.variant === "full" ? "full" : "compact";
  const n = new Intl.NumberFormat(locale);
  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(SAMPLE.clicks / SAMPLE.views);
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(SAMPLE.revenue);
  const mark = (k) => (variant === "full" ? `<span class="aicc-dash__mark" aria-hidden="true">${k}</span>` : "");
  const tile = (key, value, extra = "") => `<li class="aicc-dash__tile"><span class="aicc-dash__tlabel">${T(s.tiles[key])}</span><strong><bdi>${value}</bdi></strong>${extra}</li>`;
  const widget = o.widget
    ? `<section class="aicc-dash__shopper"><p class="aicc-dash__ptitle">${T(s.shopperTitle)}</p><div class="aicc-dash__widget" aria-hidden="false">` +
      `<p class="aicc-dash__wtitle">${T(s.widgetTitle)}</p><p class="aicc-dash__wsub">${T(s.widgetSubtitle)}</p>` +
      [["kit", "coffee", 38], ["filters", "filter", 14], ["grinder", "cog", 46]].map(([id, ic, price]) => `<div class="aicc-dash__wrow"><span class="aicc-dash__wthumb" aria-hidden="true">${icon(ic, 18)}</span><span>${T(s.products[id])}</span><bdi>$${price}</bdi></div>`).join("") +
      `<div class="aicc-dash__wfoot"><span>${T(s.widgetTotal)} <bdi>$98</bdi></span><span class="aicc-dash__wbtn">${T(s.widgetAdd)}</span></div></div></section>`
    : "";
  return (
    `<div class="aicc-dash" data-variant="${variant}" data-widget="${!!o.widget}"${langAttrs(s, o)}>` +
    `<p class="aicc-dash__label">${icon("info", 16)}<span>${T(s.label)}</span></p>` +
    `<div class="aicc-dash__panels">${widget}` +
    `<section class="aicc-dash__admin"><p class="aicc-dash__ptitle">${T(s.youTitle)}</p><div class="aicc-dash__wp">` +
    `<div class="aicc-dash__bar"><span class="aicc-dash__brand">${icon("sparkles", 15)}${T(s.page)}</span><span class="aicc-dash__period">${T(s.period)}</span></div>` +
    `<div class="aicc-dash__block">${mark(1)}<ul class="aicc-dash__tiles aicc-dash__tiles--three">${tile("views", n.format(SAMPLE.views))}${tile("clicks", n.format(SAMPLE.clicks))}${tile("rate", pct)}</ul>` +
    `<div class="aicc-dash__sub">${mark(2)}<ul class="aicc-dash__tiles aicc-dash__tiles--three">${tile("adds", n.format(SAMPLE.adds))}${tile("orders", n.format(SAMPLE.orders), `<span class="aicc-dash__assoc">${T(s.associationNote)}</span>`)}${tile("revenue", usd)}</ul></div></div>` +
    `<div class="aicc-dash__cards"><article class="aicc-dash__card">${mark(3)}<p class="aicc-dash__ctitle">${icon("lightbulb", 16)}${T(s.insightsHeading)}</p>` +
    `<p class="aicc-dash__itype">${T(s.insightTitle)}</p><p class="aicc-dash__ibody">${T(s.insightBody)}</p>` +
    `<p class="aicc-dash__imetric">${T(s.insightMetric)}: <strong><bdi>${n.format(48)}</bdi></strong></p><p class="aicc-dash__gate">${T(s.insightGate)}</p></article>` +
    `<article class="aicc-dash__card">${mark(4)}<p class="aicc-dash__ctitle">${icon("package", 16)}${T(s.previewHeading)}</p>` +
    `<p class="aicc-dash__pfor">${T(s.previewFor)} <strong>${T(s.products.kit)}</strong></p>` +
    // As in the plugin: every product shows its price; only learned partners add "Bought together N times". A fallback product shows the price alone.
    `<ul class="aicc-dash__prows"><li><span>${T(s.products.filters)}</span><em><bdi>$14.00</bdi> · ${T(s.previewLearned.replace("{n}", n.format(48)))}</em></li>` +
    `<li><span>${T(s.products.grinder)}</span><em><bdi>$46.00</bdi> · ${T(s.previewLearned.replace("{n}", n.format(31)))}</em></li>` +
    `<li><span>${T(s.products.mug)}</span><em data-fallback="true"><bdi>$16.00</bdi></em></li></ul></article></div>` +
    `</div></section></div>` +
    (variant === "full" && o.callouts !== false ? `<ol class="aicc-dash__callouts"><li><span aria-hidden="true">1</span>${T(s.callouts.a)}</li><li><span aria-hidden="true">2</span>${T(s.callouts.b)}</li><li><span aria-hidden="true">3</span>${T(s.callouts.c)}</li><li><span aria-hidden="true">4</span>${T(s.callouts.d)}</li></ol>` : "") +
    `</div>`
  );
}

const KIND_ICON = { hot: "flame", bundle: "package", interest: "shopping-cart", winner: "mouse-pointer-click" };

/**
 * The four kinds of Merchant Insights the product can show, as sample cards (labels from the plugin; numbers invented).
 * renderInsightsHTML(strings.dash, { locale }) returns markup; it is server-rendered by the site.
 */
export function renderInsightsHTML(s, o = {}) {
  const locale = s._fallback ? "en" : o.locale || "en";
  const { T } = labeler(s, o);
  const n = new Intl.NumberFormat(locale);
  return (
    `<div class="aicc-insights"${langAttrs(s, o)}>` +
    `<p class="aicc-dash__label">${icon("info", 16)}<span>${T(s.label)}</span></p>` +
    `<p class="aicc-insights__banner">${icon("sparkles", 14)}<span>${T(s.insightsBanner)}</span></p>` +
    `<ul class="aicc-insights__list">` +
    ["hot", "bundle", "interest", "winner"].map((k) => {
      const c = s.insightKinds[k];
      const v = /^\d+$/.test(c.value) ? n.format(+c.value) : c.value;
      return `<li class="aicc-insight" data-kind="${k}"><p class="aicc-insight__kind">${icon(KIND_ICON[k], 16)}<span>${T(c.title)}</span></p><p class="aicc-insight__body">${T(c.body)}</p><p class="aicc-insight__metric">${T(c.metric)}: <strong><bdi>${T(v)}</bdi></strong></p></li>`;
    }).join("") +
    `</ul><p class="aicc-dash__gate">${T(s.insightGate)}</p></div>`
  );
}

export function mountDashPreview(el, opts) {
  if (!el || el.dataset.aiccReady === "mounted") return;
  el.dataset.aiccReady = "mounted";
  el.removeAttribute("aria-busy");
  el.innerHTML = renderDashPreviewHTML(opts.strings, { locale: opts.locale, variant: el.dataset.variant, widget: el.dataset.widget === "true" });
}
