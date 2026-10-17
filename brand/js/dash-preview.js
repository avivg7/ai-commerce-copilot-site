// A styled replica of the real AICC dashboard blocks (WordPress admin), with the real labels, for explaining "what you get".
// EVERYTHING in it is sample data and says so ("Sample data: not from a real store"): invented numbers, invented products.
// Blocks (labels from the plugin): Recommendation Views, Recommendation Clicks, Recommendation Click Rate, Bundle Add-To-Carts,
// Associated Orders, Associated Revenue (the plugin is being renamed from "AI Assisted ..." to "Associated ..."),
// the Merchant Insights card and a Recommendation Preview row ("Bought together N times").
// Two ways to use it: renderDashPreviewHTML(strings, opts) returns the markup (the site renders it on the server), and
// mountDashPreview(el, opts) fills a [data-aicc-dash] element (the Control Plane theme). Strings: strings.json[locale].dash.
//   opts: { locale, variant: "compact" | "full" (full numbers the blocks 1-4), widget: boolean (show the shopper widget panel), callouts: false to omit the numbered legend }
import { icon } from "./icons.js";
import { esc } from "./motion.js";

const SAMPLE = { views: 1240, clicks: 86, adds: 31, orders: 9, revenue: 412 };

export function renderDashPreviewHTML(s, o = {}) {
  const locale = s._fallback ? "en" : o.locale || "en";
  const variant = o.variant === "full" ? "full" : "compact";
  const n = new Intl.NumberFormat(locale);
  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(SAMPLE.clicks / SAMPLE.views);
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(SAMPLE.revenue);
  const mark = (k) => (variant === "full" ? `<span class="aicc-dash__mark" aria-hidden="true">${k}</span>` : "");
  const tile = (key, value, extra = "") => `<li class="aicc-dash__tile"><span class="aicc-dash__tlabel">${esc(s.tiles[key])}</span><strong><bdi>${value}</bdi></strong>${extra}</li>`;
  const widget = o.widget
    ? `<section class="aicc-dash__shopper"><p class="aicc-dash__ptitle">${esc(s.shopperTitle)}</p><div class="aicc-dash__widget" aria-hidden="false">` +
      `<p class="aicc-dash__wtitle">${esc(s.widgetTitle)}</p><p class="aicc-dash__wsub">${esc(s.widgetSubtitle)}</p>` +
      [["kit", "coffee", 38], ["filters", "filter", 14], ["grinder", "cog", 46]].map(([id, ic, price]) => `<div class="aicc-dash__wrow"><span class="aicc-dash__wthumb" aria-hidden="true">${icon(ic, 18)}</span><span>${esc(s.products[id])}</span><bdi>$${price}</bdi></div>`).join("") +
      `<div class="aicc-dash__wfoot"><span>${esc(s.widgetTotal)} <bdi>$98</bdi></span><span class="aicc-dash__wbtn">${esc(s.widgetAdd)}</span></div></div></section>`
    : "";
  return (
    `<div class="aicc-dash" data-variant="${variant}" data-widget="${!!o.widget}"${s._fallback ? ' lang="en" dir="ltr"' : ""}>` +
    `<p class="aicc-dash__label">${icon("info", 16)}<span>${esc(s.label)}</span></p>` +
    `<div class="aicc-dash__panels">${widget}` +
    `<section class="aicc-dash__admin"><p class="aicc-dash__ptitle">${esc(s.youTitle)}</p><div class="aicc-dash__wp">` +
    `<div class="aicc-dash__bar"><span class="aicc-dash__brand">${icon("sparkles", 15)}${esc(s.page)}</span><span class="aicc-dash__period">${esc(s.period)}</span></div>` +
    `<div class="aicc-dash__block">${mark(1)}<ul class="aicc-dash__tiles aicc-dash__tiles--three">${tile("views", n.format(SAMPLE.views))}${tile("clicks", n.format(SAMPLE.clicks))}${tile("rate", pct)}</ul>` +
    `<div class="aicc-dash__sub">${mark(2)}<ul class="aicc-dash__tiles aicc-dash__tiles--three">${tile("adds", n.format(SAMPLE.adds))}${tile("orders", n.format(SAMPLE.orders), `<span class="aicc-dash__assoc">${esc(s.associationNote)}</span>`)}${tile("revenue", usd)}</ul></div></div>` +
    `<div class="aicc-dash__cards"><article class="aicc-dash__card">${mark(3)}<p class="aicc-dash__ctitle">${icon("lightbulb", 16)}${esc(s.insightsHeading)}</p>` +
    `<p class="aicc-dash__itype">${esc(s.insightTitle)}</p><p class="aicc-dash__ibody">${esc(s.insightBody)}</p>` +
    `<p class="aicc-dash__imetric">${esc(s.insightMetric)}: <strong><bdi>${n.format(48)}</bdi></strong></p><p class="aicc-dash__gate">${esc(s.insightGate)}</p></article>` +
    `<article class="aicc-dash__card">${mark(4)}<p class="aicc-dash__ctitle">${icon("package", 16)}${esc(s.previewHeading)}</p>` +
    `<p class="aicc-dash__pfor">${esc(s.previewFor)} <strong>${esc(s.products.kit)}</strong></p>` +
    `<ul class="aicc-dash__prows"><li><span>${esc(s.products.filters)}</span><em>${esc(s.previewLearned.replace("{n}", n.format(48)))}</em></li>` +
    `<li><span>${esc(s.products.grinder)}</span><em>${esc(s.previewLearned.replace("{n}", n.format(31)))}</em></li>` +
    `<li><span>${esc(s.products.mug)}</span><em data-fallback="true">${esc(s.previewFallback)}</em></li></ul></article></div>` +
    `</div></section></div>` +
    (variant === "full" && o.callouts !== false ? `<ol class="aicc-dash__callouts"><li><span aria-hidden="true">1</span>${esc(s.callouts.a)}</li><li><span aria-hidden="true">2</span>${esc(s.callouts.b)}</li><li><span aria-hidden="true">3</span>${esc(s.callouts.c)}</li><li><span aria-hidden="true">4</span>${esc(s.callouts.d)}</li></ol>` : "") +
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
  const n = new Intl.NumberFormat(locale);
  return (
    `<div class="aicc-insights"${s._fallback ? ' lang="en" dir="ltr"' : ""}>` +
    `<p class="aicc-dash__label">${icon("info", 16)}<span>${esc(s.label)}</span></p>` +
    `<ul class="aicc-insights__list">` +
    ["hot", "bundle", "interest", "winner"].map((k) => {
      const c = s.insightKinds[k];
      const v = /^\d+$/.test(c.value) ? n.format(+c.value) : c.value;
      return `<li class="aicc-insight" data-kind="${k}"><p class="aicc-insight__kind">${icon(KIND_ICON[k], 16)}<span>${esc(c.title)}</span></p><p class="aicc-insight__body">${esc(c.body)}</p><p class="aicc-insight__metric">${esc(c.metric)}: <strong><bdi>${esc(v)}</bdi></strong></p></li>`;
    }).join("") +
    `</ul><p class="aicc-dash__gate">${esc(s.insightGate)}</p></div>`
  );
}

export function mountDashPreview(el, opts) {
  if (!el || el.dataset.aiccReady === "mounted") return;
  el.dataset.aiccReady = "mounted";
  el.removeAttribute("aria-busy");
  el.innerHTML = renderDashPreviewHTML(opts.strings, { locale: opts.locale, variant: el.dataset.variant, widget: el.dataset.widget === "true" });
}
