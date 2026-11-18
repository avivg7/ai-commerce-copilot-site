// P40 pricing prototype: renders the framework-neutral MARKUP SKELETON of docs/design/p40-pricing.md with the REAL kit CSS.
// Not shipped: the Site (React) and the Control Plane theme (PHP) write the same markup. Run with: PATH=/opt/homebrew/opt/node@22/bin:$PATH node --no-warnings design/p40/build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { icon } from "../../brand/js/icons.js";
import { resolveEaTokens, SS_REG_DATES, EA_DATES } from "../../src/i18n/eaTokens.ts";
import { PLANS, formatPrice, currencySuffix } from "../../src/data/plans.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LANGS = ["en", "he", "es", "ru"];
/** Every state of the control. closed = after the registration cutoff, paid purchase closed; purchase = after the cutoff, paid purchase OPEN (Control Plane only); ended = after the trial END (data-ea-after: the ordinary card). */
export const STATES = ["off", "open", "waitlist", "closed", "paused", "purchase", "ended"];
export const NAMES = { solo: "Solo", studio: "Studio", agency: "Agency" };

// ---- copy: the P39 snapshot (unchanged keys) overlaid with design/p40/copy.json (new + changed keys) ----
const snap = {};
for (const line of fs.readFileSync(path.join(HERE, "../../scripts/snapshots/selfservice-msgids.txt"), "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const [k, en, he, es, ru] = line.split("\t");
  snap[k] = { en, he, es, ru };
}
const overlay = JSON.parse(fs.readFileSync(path.join(HERE, "copy.json"), "utf8"));
export const COPY = { ...snap };
for (const [k, v] of Object.entries(overlay)) if (!k.startsWith("_")) COPY[k] = { en: v.en, he: v.he, es: v.es, ru: v.ru };
// strings of the main dictionary the redesign reuses unchanged (status quo, not part of the ss pack)
COPY["common.soon.label"] = { en: "Purchases open soon", he: "הרכישות ייפתחו בקרוב", es: "Las compras abrirán pronto", ru: "Покупки скоро откроются" };

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function T(key, lang, vars = {}) {
  const row = COPY[key];
  if (!row) throw new Error("missing msgid " + key);
  let s = row[lang];
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return esc(resolveEaTokens(s, lang, 0));
}
const ico = (n, s = 18) => icon(n, s);
const SLOTS = 10;
const slots = (n, mod = "") => { const total = mod.includes("trial") ? 1 : SLOTS; return `<span class="aicc-cap${mod}" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<span class="aicc-cap__slot${i < n ? " aicc-cap__slot--on" : ""}"></span>`).join("")}</span>`; };

/** The control of one card. `variant` = what the plan is (featured => primary), `inverse` = on the dark band. */
export function cta({ lang, state, plan = "studio", featured = false, inverse = false }) {
  const name = NAMES[plan];
  const href = `${lang === "en" ? "" : "/" + lang}/start/${plan ? `?plan=${plan}` : ""}`.replace(/^\/\//, "/");
  const btn = (variant) => `aicc-btn aicc-btn--lg aicc-btn--block ${variant}`;
  const v = inverse ? "aicc-btn--primary" : featured ? "aicc-btn--primary" : "aicc-btn--outline";
  const nid = `plan-${plan}-note`;
  const sr = inverse ? "" : `<span class="aicc-sr-only"> (${name})</span>`;
  const arrow = `<span class="aicc-btn__icon aicc-flip" aria-hidden="true">${ico("arrow-right", 18)}</span>`;
  const inv = inverse ? " aicc-pcta--inverse" : "";
  switch (state) {
    case "open":
      return `<div class="aicc-pcta${inv}" data-ss-cta="link"><a class="${btn(v)}" data-ss-state="open" href="${href}"><span>${T("ss.cta.start", lang)}</span>${arrow}${sr}</a></div>`;
    case "waitlist":
      return `<div class="aicc-pcta${inv}" data-ss-cta="link"><a class="${btn(v)}" data-ss-state="waitlist" href="${href}" aria-describedby="${nid}"><span>${T("ss.cta.waitlist", lang)}</span>${arrow}${sr}</a><p class="aicc-pcta__note" id="${nid}">${T("ss.state.waitlistNote", lang)}</p></div>`;
    case "purchase":
      if (!plan) return `<div class="aicc-pcta${inv}" data-ss-cta="purchase"><a class="${btn("aicc-btn--primary")}" data-ss-state="purchase" href="#plans"><span>${T("ss.cta.choosePlan", lang)}</span>${arrow}</a></div>`;
      return `<div class="aicc-pcta${inv}" data-ss-cta="purchase"><p class="aicc-pcta__note" data-ss-state="closed_cutoff">${T("ss.state.closedPaidNote", lang)}</p><a class="${btn(v)}" data-ss-state="purchase" href="#purchase-${plan}"><span>${T("ss.cta.purchase", lang, { plan: `<bdi>${name}</bdi>` }).replaceAll("&lt;bdi&gt;", "<bdi>").replaceAll("&lt;/bdi&gt;", "</bdi>")}</span></a></div>`;
    case "closed":
      return status({ lang, mode: "closed_cutoff", icon: "lock", label: "ss.cta.closed", note: "ss.state.closedNote", featured, inverse });
    case "paused":
      return status({ lang, mode: "paused", icon: "pause", label: "ss.cta.paused", note: "ss.state.pausedNote", featured, inverse });
    case "off":
    default:
      return status({ lang, mode: "off", icon: "clock", label: "ss.cta.soon", note: "ss.state.soonNote", featured, inverse });
  }
}
function status({ lang, mode, icon: ic, label, note, inverse }) {
  return `<div class="aicc-pcta${inverse ? " aicc-pcta--inverse" : ""}" data-ss-cta="status"><p class="aicc-pstatus" role="status" data-ss-state="${mode}"><span class="aicc-pstatus__pill">${ico(ic, 18)}<span class="aicc-pstatus__label">${T(label, lang)}</span></span><span class="aicc-pstatus__note">${T(note, lang)}</span></p></div>`;
}

export function card({ lang, plan, state, strike = false }) {
  const p = PLANS.find((x) => x.id === plan);
  const featured = p.featured;
  const price = formatPrice(p.price, lang) ;
  const per = `${T("ss.pricing.per", lang)}${esc(currencySuffix(lang))}`;
  const paid = p.stores === 1 ? T("ss.plan.paidOne", lang) : T("ss.plan.paidMany", lang, { n: p.stores });
  const ended = state === "ended";
  const cls = ["aicc-tier", featured ? "aicc-tier--featured" : "", ended ? "aicc-tier--standard" : "", ["closed", "purchase", "paused"].includes(state) ? "aicc-tier--closed" : ""].filter(Boolean).join(" ");
  const label = strike ? T("ss.pricing.priceLabelStrike", lang) : T("ss.pricing.priceLabel", lang);
  const amount = strike ? `<s class="aicc-tier__amount"><bdi>${price}</bdi></s>` : `<bdi class="aicc-tier__amount">${price}</bdi>`;
  const priceBlock = ended
    ? `<p class="aicc-tier__price" data-aicc-ss="regular"><span class="aicc-tier__price-line"><bdi class="aicc-tier__amount">${price}</bdi> <span class="aicc-tier__per">${per}</span></span></p>`
    : `<p class="aicc-tier__price${strike ? " aicc-tier__price--strike" : ""}" data-aicc-ss="regular"${strike ? ' data-ss-price="strike"' : ""}><span class="aicc-tier__price-label">${label}</span><span class="aicc-tier__price-line">${amount} <span class="aicc-tier__per">${per}</span></span></p>`;
  const launch = ended
    ? `<div class="aicc-tier__launch"><div class="aicc-pcta" data-ss-cta="status"><p class="aicc-pstatus" role="status" data-commerce="closed"><span class="aicc-pstatus__pill">${ico("info", 18)}<span class="aicc-pstatus__label">${T("common.soon.label", lang)}</span></span></p></div></div>`
    : `<div class="aicc-tier__launch"><p class="aicc-tier__free" data-aicc-ss="free" data-ss-free><span class="aicc-tier__free-word">${T("ss.pricing.free", lang)}</span><span class="aicc-tier__trial"><span class="aicc-cap aicc-cap--trial" aria-hidden="true"><span class="aicc-cap__slot aicc-cap__slot--on"></span></span>${T("ss.pricing.trial", lang)}</span></p>${cta({ lang, state, plan, featured })}</div>`;
  return `<article class="${cls}" aria-labelledby="plan-${plan}" data-plan="${plan}"${featured ? ' data-featured=""' : ""}>
  <div class="aicc-tier__plan">
    <div class="aicc-tier__head"><h3 class="aicc-tier__name" id="plan-${plan}"><bdi>${NAMES[plan]}</bdi></h3>${featured ? `<p class="aicc-tier__badge">${T("ss.pricing.badge", lang)}</p>` : ""}</div>
    <p class="aicc-tier__fit">${T("ss.pricing.fit." + plan, lang)}</p>
    <div class="aicc-tier__cap" data-aicc-ss="paid"><p class="aicc-tier__cap-text">${paid}</p>${slots(p.stores)}</div>
    ${priceBlock}
  </div>
  ${launch}
  <p class="aicc-tier__incl"><span class="aicc-tier__incl-icon" aria-hidden="true">${ico("check", 16)}</span>${T("ss.pricing.incl", lang)}</p>
</article>`;
}

export function launchPanel({ lang, commerce = "closed" }) {
  const fact = (iconHtml, key) => `<li class="aicc-launch__fact"><span class="aicc-launch__fact-icon" aria-hidden="true">${iconHtml}</span><span>${T(key, lang)}</span></li>`;
  const foot = commerce === "open" ? T("ss.launch.foot.paidOpen", lang) : T("ss.launch.foot.paid", lang);
  return `<section class="aicc-launch" id="free-trial" aria-labelledby="launch-title" data-aicc-ss="launch" data-ss-terms>
  <div class="aicc-launch__intro">
    <p class="aicc-launch__tag">${T("ss.launch.tag", lang)}</p>
    <h3 class="aicc-launch__title" id="launch-title">${T("ss.link", lang)}</h3>
    <p class="aicc-launch__sub">${T("ss.launch.sub", lang)}</p>
  </div>
  <ol class="aicc-timeline" aria-label="${T("ss.plan.datesLabel", lang)}" data-ss-dates>
    <li class="aicc-timeline__step" data-ss-date="registration">
      <span class="aicc-timeline__node" aria-hidden="true"></span>
      <span class="aicc-timeline__label">${T("ss.plan.regLabel", lang)}</span>
      <span class="aicc-timeline__date">${T("ss.plan.regValue", lang)}</span>
      <span class="aicc-timeline__note">${T("ss.launch.regNote", lang)}</span>
    </li>
    <li class="aicc-timeline__step" data-ss-date="end">
      <span class="aicc-timeline__node" aria-hidden="true"></span>
      <span class="aicc-timeline__label">${T("ss.plan.endLabel", lang)}</span>
      <span class="aicc-timeline__date">${T("ss.plan.endValue", lang)}</span>
      <span class="aicc-timeline__note">${T("ss.launch.endNote", lang)}</span>
    </li>
  </ol>
  <ul class="aicc-launch__facts" aria-label="${T("ss.terms.label", lang)}" data-ss-checks>
    ${fact(slots(1, " aicc-cap--trial"), "ss.launch.fact.store")}
    ${fact(ico("check", 18), "ss.launch.fact.payment")}
    ${fact(ico("check", 18), "ss.launch.fact.noAuto")}
  </ul>
  <p class="aicc-launch__foot">${foot} ${T("ss.terms.state", lang)}</p>
</section>`;
}

export function band({ lang, state }) {
  return `<div class="aicc-pband" data-aicc-ss="band" data-ss-band>
  <p class="aicc-pband__lead">${T("ss.band.lead", lang)}</p>
  <div class="aicc-pband__actions">${cta({ lang, state: state === "ended" ? "off" : state, plan: "", inverse: true })}</div>
</div>`;
}

export function pricingSection({ lang, state, commerce, strike = false, title = "One full product. Priced by how many stores." }) {
  const cs = state === "purchase" ? "open" : commerce || "closed";
  const head = `<header class="aicc-pricing__head"><h2 class="aicc-pricing__title" id="pricing-title">${esc(title)}</h2><p class="aicc-pricing__lead">${T("ss.pricing.lead", lang)}</p></header>`;
  const cards = PLANS.map((p) => card({ lang, plan: p.id, state, strike })).join("\n");
  return `<section class="aicc-pricing" aria-labelledby="pricing-title" data-aicc-pricing>
${head}
<div class="aicc-tiers" data-aicc-ss="plans">
${cards}
</div>
${state === "ended" ? "" : launchPanel({ lang, commerce: cs })}
</section>`;
}

const TITLES = {
  en: "One full product. Priced by how many stores.",
  he: "מוצר מלא אחד. המחיר נקבע לפי מספר החנויות.",
  es: "Un producto completo. El precio depende de cuántas tiendas.",
  ru: "Один полный продукт. Цена зависит от числа магазинов.",
};
const BAND_TITLES = { en: "Start with one store.", he: "מתחילים עם חנות אחת.", es: "Empiece con una tienda.", ru: "Начните с одного магазина." };

export function page({ lang = "en", state = "off", strike = false, extraCss = "" }) {
  const dir = lang === "he" ? "rtl" : "ltr";
  const body = `<main>
<section class="h-section h-section--sunken">
  <div class="h-container">
${pricingSection({ lang, state, strike, title: TITLES[lang] })}
  </div>
</section>
<section class="h-section h-section--inverse" aria-labelledby="final-title">
  <div class="h-container">
    <h2 class="h-h2" id="final-title">${esc(BAND_TITLES[lang])}</h2>
${band({ lang, state })}
  </div>
</section>
</main>`;
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AICC pricing prototype (${lang}, ${state}${strike ? ", strike" : ""})</title>
<link rel="stylesheet" href="../fonts.css">
<link rel="stylesheet" href="../../../brand/aicc-tokens.css">
<link rel="stylesheet" href="../../../brand/aicc-brand.css">
<link rel="stylesheet" href="../harness.css">
${extraCss}
</head>
<body>
${body}
</body>
</html>
`;
}
