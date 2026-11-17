// npm run test:launch-offer: what the BUILT pages of every launch-offer mode contain, and must not contain, in all four languages (P32). Offline, no browser.
//   node scripts/test-launch-offer.mjs --off <dir> --announce <dir> --open <dir> --verify <dir> [--base <dir>] [--off-subswitches <dir>] [--limited <dir>] [--announce-limited <dir>]
//     (--off-subswitches: an export built with the switch unset but NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on and NEXT_PUBLIC_AICC_EA_STRIKE=on: it must equal --base too;
//      --limited: an OPEN export built with NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on (P34); --announce-limited: the same switch in an ANNOUNCE build, which must not show it)
//     (exports built with NEXT_PUBLIC_AICC_EARLY_ACCESS unset | announce | open | verify; --base: an export of the base commit 5907dea (P35 line) built with the switch unset, from the same checkout path and dist directory name (module ids depend on the path))
//     P37 (self-service): --ss-off <dir> --ss-announce <dir> --ss-open <dir> (exports built with NEXT_PUBLIC_AICC_SELFSERVICE=on and the launch-offer switch unset | announce | open) run the SELF-SERVICE matrix below;
//     --base-announce / --base-open / --base-verify <dir>: P36 exports of the same environments built from the base commit: the OFF (self-service unset) build of each must be byte-equivalent to them
// It proves:
//  * OFF: no trace of the campaign; no request page; byte-equivalent to the base commit (after normalising the build id) when --base is given;
//  * ANNOUNCE: the offer, the end instant and the regular prices are stated; every request control is a plain, non-clickable status; no request button wording and no link to /request-access/ exists anywhere;
//  * OPEN: the same plus request buttons that lead to /request-access/ (hero, header, cards, band), eight request pages (four languages), no link to a payment, checkout, licence or grant route,
//    Turnstile is named only in request-page code, never in an HTML page, and never loaded by another page;
//  * VERIFY: the ordinary site (no campaign text, no button, no link, nothing in the sitemap or robots.txt) plus eight unlisted noindex request pages with the "Verification page, not public" banner;
//  * P34 (owner request): the two-part Hero pill ([Launch offer] Free until ...), the owner's short bar, three short support lines under the Hero buttons ("Limited availability" only with
//    its switch), the launch-offer label on every card, three support lines under the cards on Home and Pricing, and the Home guarantee line only in the hidden ended view;
//  * every mode: no hero fine print, no "was/save/worth/%/countdown" wording in the campaign text, no strike-through without the flag, no 14-day guarantee line on a plan card, the end instant on the bar,
//    the cards and the FAQ in each language, one offer name per language, no promise of a paid plan "from 2027".
import fs from "node:fs";
import path from "node:path";
import { loadDictionaries, loadTs } from "./lib/load.mjs";
import { compare } from "./lib/export-fingerprint.mjs";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? path.resolve(args[i + 1]) : undefined; };
const dirs = { off: arg("off"), announce: arg("announce"), open: arg("open"), verify: arg("verify") };
const SS = { off: arg("ss-off"), announce: arg("ss-announce"), open: arg("ss-open") }, SS_LINK = arg("ss-link");
const BASES = { announce: arg("base-announce"), open: arg("base-open"), verify: arg("base-verify") };
const BASE = arg("base"), OFF_SUB = arg("off-subswitches"), LIMITED = arg("limited"), ANN_LIMITED = arg("announce-limited"), ANN_STRIKE = arg("announce-strike");
if (!dirs.off || !dirs.announce || !dirs.open || !dirs.verify) { console.error("usage: --off <dir> --announce <dir> --open <dir> --verify <dir> [--base <dir>]"); process.exit(2); }

const LOCALES = ["en", "he", "es", "ru"];
const D = await loadDictionaries();
const { getEaDictionary } = await loadTs("src/i18n/index.ts");
const { PLANS, formatPrice } = await loadTs("src/data/plans.ts");
const { EA_CUTOFF_UTC_MS } = await loadTs("src/lib/earlyAccess.ts");
let failed = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { failed++; console.error("  FAIL " + msg); } else console.log("  ok   " + msg); };

const nb = (t) => String(t).replace(/ |&nbsp;/g, " ");
const decode = (t) => t.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
// P36: the renderer wraps Latin runs (UTC, AICC) in <bdi lang="en">; stripping tags to spaces leaves "UTC ." for "UTC.", so a space before punctuation is not a difference
const norm = (t) => nb(decode(String(t))).replace(/\s+/g, " ").replace(/ ([.,;:!?])/g, "$1").trim();
const htmlOf = (root, rel) => { const f = path.join(root, rel); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null; };
const visibleText = (h) => norm(h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " "));
const segments = (h) => new Set(h.replace(/<script[\s\S]*?<\/script>/g, "<").replace(/<style[\s\S]*?<\/style>/g, "<").split(/<[^>]+>/).map(norm).filter((x) => x.length > 2));
const pre = (l) => (l === "en" ? "" : `${l}/`);
const walk = (root, filter = () => true) => { const out = []; const w = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (filter(p)) out.push(p); } }; w(root); return out; };
const htmlFiles = (root) => walk(root, (p) => p.endsWith(".html") && !/\/_next\//.test(p));
const textFiles = (root) => walk(root, (p) => /\.(html|txt|xml|json)$/.test(p) && !/\/(_next|brand-kit|og|fonts|demo)\//.test(p));
const ea = (l) => getEaDictionary(l, 0);
const NAME = { en: /launch[- ]offer/i, he: /הצעת ה?השקה/, es: /oferta de lanzamiento/i, ru: /предложени\S* в[\s ]честь[\s ]запуска/i };
const OLD = { en: /early access/i, he: /גישה מוקדמת/, es: /acceso anticipado/i, ru: /ранн\S* доступ/i };
const BANNED = /\b(was|save|saves|saving|savings|worth|discount|countdown)\b|\d\s?%|(\d+|few) (days?|hours?|minutes?) (left|remaining)|\b(hurry|last chance|act now)\b|ends? (soon|in)\b|from 2027/i;
const BANNED_LOCAL = { he: /הנחה|חסכו|חיסכון|\d\s?%|מבצע|הזדמנות אחרונה|מ־?2027/, es: /descuento|ahorr|\d\s?%|[uú]ltima oportunidad|desde 2027/i, ru: /скидк|экономи|\d\s?%|последний шанс|с 2027/i };
const REQ_FILES = ["request-access/index.html", "request-access/confirm/index.html", ...["he", "es", "ru"].flatMap((l) => [`${l}/request-access/index.html`, `${l}/request-access/confirm/index.html`])];

/** The words of the request button in every language (never allowed outside an OPEN build's pages or a request page). */
const requestWords = [...new Set(LOCALES.flatMap((l) => { const e = ea(l); return [e.hero.ctaOpen, e.plan.ctaOpen, e.header.cta]; }))].map(nb);

// ───────── build equivalence (shared with the OFF proof): scripts/lib/export-fingerprint.mjs ─────────

// ───────── OFF ─────────
console.log("== OFF (switch unset)");
{
  const root = dirs.off;
  const all = textFiles(root);
  const traces = all.filter((f) => /data-ea-|aicc-eabar|aicc-eanote|aicc-easupport|aicc-eabadge|request-access|Request Free Access/.test(fs.readFileSync(f, "utf8")));
  check(traces.length === 0, `no file of the export carries a trace of the campaign (data-ea-*, bar, fine print, request-access, request button wording)${traces.length ? " -> " + path.relative(root, traces[0]) : ""}`);
  check(REQ_FILES.every((r) => !fs.existsSync(path.join(root, r))) && !fs.existsSync(path.join(root, "request-access")), "no request page exists in the export (any language)");
  for (const l of LOCALES) {
    const h = htmlOf(root, `${pre(l)}index.html`), t = visibleText(h);
    check(!requestWords.some((w) => t.includes(w)) && !NAME[l].test(t), `${l}: Home shows no request wording and no offer name`);
    check(/Try Live Demo|id="demo"|#demo/.test(h) || l !== "en", `${l}: the ordinary Hero (live-demo action) is intact`);
  }
  if (BASE) {
    const r = compare(BASE, root);
    check(r.onlyA.length === 0 && r.onlyB.length === 0 && r.diff.length === 0, `OFF is byte-equivalent to the base commit build after normalising the build id: ${r.n} files vs ${r.m}, only-in-base ${r.onlyA.length}, only-in-off ${r.onlyB.length}, different ${r.diff.length}${r.diff.length ? " -> " + r.diff.slice(0, 3).join(", ") : ""}`);
  } else console.log("  note --base not given: the OFF-equivalence proof against the base commit was not run");
  if (BASE && OFF_SUB) {
    // P34: the two sub-switches (strike-through, "Limited availability") change nothing while the campaign switch is off
    const r = compare(BASE, OFF_SUB);
    check(r.onlyA.length === 0 && r.onlyB.length === 0 && r.diff.length === 0, `OFF with NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on and NEXT_PUBLIC_AICC_EA_STRIKE=on is byte-equivalent to the base commit build too: ${r.n} files vs ${r.m}, different ${r.diff.length}${r.diff.length ? " -> " + r.diff.slice(0, 3).join(", ") : ""}`);
  }
}

// ───────── the checks every campaign build shares (announce and open) ─────────
function campaignChecks(mode, root) {
  console.log(`== ${mode.toUpperCase()}: pages, offer, prices, end instant, naming (four languages)`);
  const offSeg = (l, rel) => segments(htmlOf(dirs.off, rel));
  for (const l of LOCALES) {
    const e = ea(l), P = pre(l);
    const home = htmlOf(root, `${P}index.html`), pricing = htmlOf(root, `${P}pricing/index.html`);
    const th = visibleText(home), tp = visibleText(pricing);
    check(new RegExp(`<html[^>]*data-ea-mode="${mode}"`).test(home), `${l}: <html data-ea-mode="${mode}">`);
    // offer, badge, bar, name
    check(th.includes(norm(mode === "open" ? e.bar.live : e.bar.announce)), `${l}: the announcement bar states the offer, the last day and the clock (${mode})`);
    const tag = mode === "open" ? e.hero.badgeTag : e.hero.badgeTagAnnounce;
    { // P34: the pill is [tag] + "Free until <last day>" (the owner's two parts), the tag first, both inside the eyebrow pill
      const pill = (nb(home).match(/<span class="aicc-eyebrow-pill">([\s\S]*?)<\/span><\/div>/) || [])[1] || "";
      const t1 = (pill.match(/aicc-eabadge__tag">([^<]*)</) || [])[1], t2 = (pill.match(/aicc-eabadge__text">([^<]*)</) || [])[1];
      check(norm(t1 || "") === norm(tag) && norm(t2 || "") === norm(e.hero.badge), `${l}: the Hero pill reads [${tag}] ${e.hero.badge} (${mode === "open" ? "the owner's line" : "the coming-soon tag: nothing reads as live"})`);
    }
    check(NAME[l].test(e.offerName) && NAME[l].test(norm(e.bar.live)) && NAME[l].test(norm(e.hero.badgeTag)) && NAME[l].test(norm(e.hero.badgeTagAnnounce)) && NAME[l].test(norm(e.plan.pill)) && NAME[l].test(norm(e.section.title)) && NAME[l].test(norm(e.section.faqTitle)), `${l}: one offer name (${e.offerName}) on the bar, the pill, the card label, the explanation title and the questions`);
    { // P36: while requests are not open the status is PLAIN TEXT (a <p class="aicc-eanote">: no button class, no role, not in a link); an OPEN build has none
      const notes = [...nb(home).matchAll(/<p class="aicc-eanote"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => ({ tag: m[0], text: norm(m[1].replace(/<[^>]+>/g, " ")) }));
      if (mode === "announce") check(notes.length >= 2 && notes.every((n) => n.text === norm(e.hero.ctaAnnounce) && !/aicc-btn|role=|href=/.test(n.tag)), `${l}: the "requests coming soon" status is plain text (${notes.length} notes on Home: under the Hero actions and under the plan cards), never a button`);
      else check(notes.length === 0, `${l}: an open build shows no "coming soon" status`);
    }
    { // P34 (owner request, replacing the P32 "nothing under the buttons" decision): exactly the short support lines follow the Hero actions, inside the Hero copy, before the visual
      const h = nb(home), iA = h.indexOf('class="aicc-hero-actions'), iS = h.indexOf('data-ea-support="hero"'), iV = h.indexOf("aicc-hero__visual");
      const ul = h.slice(h.lastIndexOf("<ul", iS), h.indexOf("</ul>", iS));
      const items = [...ul.matchAll(/<li[^>]*>[\s\S]*?<span>([^<]*)<\/span><\/li>/g)].map((m) => norm(m[1]));
      const want = [e.hero.support.noCard, e.hero.support.noAuto, e.hero.support.approval, ...(root === LIMITED ? [e.hero.support.limited] : [])].map(norm);
      check(iA > 0 && iS > iA && iS < iV && (h.match(/data-ea-support="hero"/g) || []).length === 1 && JSON.stringify(items) === JSON.stringify(want), `${l}: under the Hero buttons: ${want.map((x) => `"${x}"`).join(", ")} (one short list, nothing else)`);
      check(items.every((x) => x.length <= 64 && !/[.!;:]/.test(x) && !/\d/.test(x)), `${l}: every Hero support line is one short line with no number`);
      check(root === LIMITED ? /data-ea-limited/.test(ul) && /<li class="aicc-easupport__chip"><span>[^<]*<\/span><\/li>/.test(ul) : !/data-ea-limited/.test(h) && !th.includes(norm(e.hero.support.limited)), `${l}: "${e.hero.support.limited}" ${root === LIMITED ? "is shown as a plain chip without a check icon (NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on, OPEN)" : root === ANN_LIMITED ? "is absent from an ANNOUNCE build even with its switch on" : "is absent (its switch is off by default)"}`);
    }
    { // P36: the three support lines under the cards are REMOVED (the cards carry the checks, the terms block the rest); the card label stays on every card
      for (const [name, page] of [["Home", home], ["Pricing", pricing]]) check(!/data-ea-support="plans"/.test(page), `${l}: ${name}: no repeated support lines under the plan cards`);
      const pills = [...nb(pricing).matchAll(/data-ea-pill[^>]*>[\s\S]*?aicc-badge--success">([^<]*)</g)].map((m) => norm(m[1]));
      const homePills = [...nb(home).matchAll(/data-ea-pill[^>]*>[\s\S]*?aicc-badge--success">([^<]*)</g)].map((m) => norm(m[1]));
      check(pills.length === 3 && homePills.length === 3 && [...pills, ...homePills].every((x) => x === norm(e.plan.pill)), `${l}: every plan card (Home and Pricing) carries the label "${e.plan.pill}"`);
      // review P34-6: the Home "14-day money-back guarantee" line is not in the DOM of a campaign build at all; the ended view's list (price, renewal) sits in a <div data-ea-after>
      const g = D[l].home.pricing.confidence.guarantee, hh = nb(home);
      const after = hh.match(/<div data-ea-after="">\s*<ul class="aicc-pricing-confidence"[\s\S]*?<\/ul>\s*<\/div>/);
      check(!hh.includes(nb(g)) && !!after && !/display:contents/.test(after[0]) && after[0].includes(nb(D[l].home.pricing.confidence.renewal)), `${l}: Home: the guarantee line is absent from the page; the ended view's list (without it) is wrapped in a div data-ea-after`);
      // the short bar is backed by the exact end instant on every card and in the explanation (the owner's bar wording names no clock)
      check(th.includes(norm(mode === "open" ? e.bar.live : e.bar.announce)) && norm(e.plan.ends).includes("22:00 UTC") && tp.includes(norm(e.plan.ends)) && tp.includes(norm(mode === "open" ? e.section.lead : e.section.leadAnnounce)), `${l}: the short bar "${mode === "open" ? e.bar.live : e.bar.announce}" is backed by the exact instant in the terms block ("${e.plan.ends}") and in the explanation`);
    }
    // the old name only in the one linking sentence (P35: the P22 common.eaNotice legal string is not part of this line, so it is no longer an allowed exception)
    const allowedOld = [].map((x) => norm(x.replace(/\{contactEmail\}/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")));
    const stripAllowed = (t) => { let x = t; for (const a of allowedOld) { const head = a.slice(0, 40); const i = x.indexOf(head); if (i >= 0) x = x.slice(0, i) + " " + x.slice(i + a.length); } return x; };
    const oldHits = [th, tp].map(stripAllowed).filter((t) => OLD[l].test(t));
    check(oldHits.length === 0, `${l}: the older name "Early Access" appears nowhere (P35: not even in a linking sentence)`);
    check(!/Early Access (is|are) (now )?(open|live|available)|now open/i.test(th + tp), `${l}: no page claims the launch offer or Early Access is open`);
    // Hero actions
    if (mode === "announce") {
      check(th.includes(norm(e.hero.ctaAnnounce)) && !new RegExp(`<a[^>]*>[^<]*${e.hero.ctaAnnounce.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(nb(home)), `${l}: the "${e.hero.ctaAnnounce}" status is not inside a link`);
      check(!requestWords.some((w) => th.includes(w) || tp.includes(w)), `${l}: no request button wording ("Request Free Access" in any language) on Home or Pricing`);
      check(!/Request Free Access/i.test(th + tp), `${l}: "Request Free Access" is not displayed`);
    } else {
      const anchors = [...nb(home).matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [m[1], norm(m[2].replace(/<[^>]+>/g, " "))]);
      const want = `/${P}request-access/`.replace("//", "/");
      const hero = anchors.filter(([, t]) => t === norm(e.hero.ctaOpen)), head = anchors.filter(([, t]) => t === norm(e.header.cta));
      check(hero.length >= 1 && hero.every(([h]) => h === want), `${l}: the Hero button "${e.hero.ctaOpen}" leads to ${want} (${hero.map((x) => x[0]).join(", ")})`);
      check(head.length >= 2 && head.every(([h]) => h === want), `${l}: the header button (desktop and menu) "${e.header.cta}" leads to ${want}`);
      const cards = [...nb(pricing).matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].filter((m) => norm(m[2].replace(/<[^>]+>/g, " ")).startsWith(norm(e.plan.ctaOpen)));
      check(cards.length >= 4 && cards.filter((m) => /\/request-access\/\?plan=(solo|studio|agency)$/.test(m[1])).length >= 3, `${l}: Pricing: the three plan buttons and the closing band lead to ${want} (plans carry ?plan=)`);
    }
    // prices: the regular price, read from plans.ts, with its label; no strike-through; no "was/save"
    const regular = [...pricing.matchAll(/<p class="aicc-plan__regular"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => norm(m[1].replace(/<[^>]+>/g, " ")));
    check(regular.length === 3 && PLANS.every((pl, i) => regular[i].includes(formatPrice(pl.price, l)) && regular[i].startsWith(norm(e.plan.planned))), `${l}: Pricing: "${e.plan.planned}" with ${PLANS.map((p) => formatPrice(p.price, l)).join(", ")} from plans.ts on the three cards`);
    check(!/<s>|<del>|line-through/.test(pricing.slice(pricing.indexOf("<main"), pricing.indexOf("</main>"))), `${l}: no struck-through price without NEXT_PUBLIC_AICC_EA_STRIKE=on`);
    { const arts = pricing.split("<article").slice(1).map((a) => norm(a.slice(0, a.indexOf("</article>")).replace(/<[^>]+>/g, " ")));
      check(arts.length === 3 && arts.every((a, i) => a.includes(norm(e.plan.freeWord)) && a.includes(norm(e.plan.freeUntil)) && a.includes(formatPrice(PLANS[i].price, l))), `${l}: every card shows the regular price, "${e.plan.freeWord}" and "${e.plan.freeUntil}"`); }
    // cards: no guarantee line, the approved/no-card/no-renewal lines, the end instant
    const articles = pricing.split("<article").slice(1).map((a) => norm(a.slice(0, a.indexOf("</article>")).replace(/<[^>]+>/g, " ")));
    check(articles.length === 3 && articles.every((a) => !a.includes(norm(D[l].common.plan.guarantee))), `${l}: no plan card carries the 14-day guarantee line (not even hidden)`);
    check(articles.every((a) => a.includes(norm(e.plan.approved)) && a.includes(norm(e.plan.noCard)) && a.includes(norm(e.plan.noAuto)) && !a.includes(norm(e.plan.ends))), `${l}: every card has the three short checks (approved stores, no credit card, no automatic renewal); the exact end instant is NOT repeated on the cards`);
    check(tp.includes(norm(e.plan.ends)) && tp.includes("22:00 UTC"), `${l}: the exact end instant (Israel time and UTC) is stated in the terms block / explanation on Pricing`);
    check(tp.includes(norm(e.pricing.decision)) && tp.includes(norm(e.pricing.notOpen)) && tp.includes(norm(e.pricing.note)), `${l}: Pricing says an explicit renewal decision is needed, paid purchases are not open, accounts are created for approved requests`);
    {
      // the ordinary "Purchases and new accounts open soon" band belongs to the ended view only: while the offer is live it is present in the markup only inside a data-ea-after block
      const band = D[l].common.soon.band, i = nb(pricing).indexOf(band);
      const marker = i < 0 ? "" : [...nb(pricing).slice(Math.max(0, i - 600), i).matchAll(/data-ea-(live|after)/g)].map((m) => m[1]).pop();
      check(i < 0 || marker === "after", `${l}: the ordinary closing sentence "${band.slice(0, 40)}..." is only in the hidden ended view (nearest marker: ${marker || "none"})`);
    }
    // the end instant on the bar, the cards and the FAQ; the head script; the data attribute
    const faq = tp.includes(norm(e.section.faq.end.a)) && tp.includes(norm(mode === "open" ? e.section.faq.free.a : e.section.faq.free.aAnnounce)) && tp.includes(norm(e.section.faq.eligible.a));
    check(faq, `${l}: the FAQ (explanation) states the end instant ("${e.section.faq.end.q}") and the free offer`);
    check(home.includes(`Date.now()>=${EA_CUTOFF_UTC_MS}`) && pricing.includes('data-ea-cutoff="2026-12-31T22:00:00Z"'), `${l}: the page carries the end instant 2026-12-31T22:00:00Z (unix ${EA_CUTOFF_UTC_MS / 1000}) in its head script and the explanation`);
    // announce never reads as live: the present-tense variants exist only in an open build
    if (mode === "announce") check(!th.includes(norm(e.section.homeLead)) && !th.includes(norm(e.section.homeLeadAnnounce)) && !tp.includes(norm(e.section.lead)) && !tp.includes(norm(e.section.steps.request.body)) && !tp.includes(norm(e.section.faq.free.a)), `${l}: an announce page carries none of the present-tense availability sentences (homeLead, lead, "Request access" step, "Is it free?" answer); the coming-soon variants are used`);
    else check(tp.includes(norm(e.section.faq.free.a)) && !tp.includes(norm(e.section.leadAnnounce)), `${l}: an open page uses the present-tense sentences and none of the announce variants`);
    // the Pricing description of a campaign build does not mention the 14-day guarantee (the cards do not)
    { const md = (pricing.match(/<meta name="description" content="([^"]*)"/) || [])[1] || ""; const od = (pricing.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || "";
      check(md && !/14[\s\u00a0-]*(-day|day|días|дн|ימים)|guarantee|garant|гаранти|ערבות/i.test(decode(md) + decode(od)) && decode(md).includes(formatPrice(99, l)), `${l}: the Pricing meta and Open Graph descriptions mention the plan prices and no money-back guarantee`); }
    // wording rules on what the campaign ADDED to the page
    const added = [...segments(home)].filter((s) => !offSeg(l, `${P}index.html`).has(s)).concat([...segments(pricing)].filter((s) => !offSeg(l, `${P}pricing/index.html`).has(s)));
    const bad = added.filter((s) => BANNED.test(s) || (BANNED_LOCAL[l] && BANNED_LOCAL[l].test(s)));
    check(bad.length === 0, `${l}: nothing the campaign adds uses was/save/worth/percent/countdown/urgency or "from 2027" wording (${added.length} added text segments)${bad.length ? " -> " + bad[0].slice(0, 80) : ""}`);
  }
  // identical terms in all languages: the same facts (dates and structure) everywhere
  const dates = LOCALES.map((l) => ea(l).plan.ends.match(/22:00 UTC/) ? 1 : 0);
  check(dates.every((x) => x === 1), `the UTC end instant (22:00 UTC) is on the cards in all four languages`);
  const tokens = LOCALES.map((l) => Object.keys(ea(l)).join(","));
  check(new Set(tokens).size === 1, "the four campaign dictionaries have the same structure (same offer naming keys, same terms)");
}


// ───────── P36 regression guards (owner UX correction): the launch offer is SUPPLEMENTARY and nothing inert may look like an action ─────────
// The P35 build replaced the Hero's "Try Live Demo" with an inert status chip. These checks fail if the Live Demo CTA disappears or its destination changes, if "See Pricing" is lost, if an inert
// button-looking element is visible while the offer is live, if the plan-card hierarchy is wrong (regular price large, FREE dominant), if a card has no single working action, or if a link is dead.
const WP_ROUTES = new Set(["pricing", "my-account", "cart", "checkout", "privacy", "terms", "refund-policy", "data-processing-addendum", "accessibility"]); // served by WordPress at the edge, not part of the export
const remOf = (css, selector) => { const m = css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*?font-size:([0-9.]+)rem")); return m ? parseFloat(m[1]) : NaN; };
function p36Guards(mode, root) {
  console.log(`== ${mode.toUpperCase()}: P36 regression guards (Live Demo, See Pricing, no inert CTA, card hierarchy, links) in four languages`);
  for (const l of LOCALES) {
    const P = pre(l), home = htmlOf(root, `${P}index.html`), pricing = htmlOf(root, `${P}pricing/index.html`), h = nb(home);
    const i0 = h.indexOf('class="aicc-hero-actions'), hero = h.slice(i0, h.indexOf("</div>", i0));
    const anchors = [...hero.matchAll(/<a\b([^>]*)href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[2], cls: (m[1] + m[3]).match(/class="([^"]*)"/)?.[1] || "", text: norm(m[4].replace(/<[^>]+>/g, " ")) }));
    const demo = anchors.find((a) => a.text === norm(D[l].home.hero.ctaDemo)), plans = anchors.find((a) => a.text === norm(D[l].home.hero.ctaPlans));
    check(!!demo && demo.href === "#demo", `${l} ${mode}: the Hero has "${D[l].home.hero.ctaDemo}" as a LINK to #demo (the original destination; a change fails)`);
    check(mode === "open" ? !!demo && /aicc-btn--secondary/.test(demo.cls) : !!demo && /aicc-btn--primary/.test(demo.cls), `${l} ${mode}: "${D[l].home.hero.ctaDemo}" is ${mode === "open" ? "the secondary" : "the primary"} Hero action`);
    check(/\bid="demo"/.test(h), `${l} ${mode}: the #demo target (the interactive demo section) exists on the page`);
    check(!!plans && plans.href === `/${P}pricing/`, `${l} ${mode}: the Hero has "${D[l].home.hero.ctaPlans}" as a link to /${P}pricing/`);
    check(!/<p\b|aicc-btn--soon|data-ea-soon/.test(hero), `${l} ${mode}: no inert element inside the Hero actions`);
    if (mode !== "off") {
      // an inert button-looking element (<p class="aicc-btn ...">) may exist only in the hidden ended view (data-ea-after); never while the offer is live
      const bad = [];
      for (const [name, page] of [["Home", h], ["Pricing", nb(pricing)]]) for (const m of page.matchAll(/<p class="aicc-btn[^"]*"/g)) { const before = page.slice(Math.max(0, m.index - 900), m.index); const mk = [...before.matchAll(/data-ea-(live|after)/g)].map((x) => x[1]).pop(); if (mk !== "after") bad.push(`${name}@${m.index}`); }
      check(bad.length === 0 && !/data-ea-soon|aicc-eastatus/.test(h + nb(pricing)), `${l} ${mode}: no inert button-looking element is visible while the offer is live${bad.length ? " -> " + bad.join(", ") : ""}`);
      // the plan cards: name, then the LARGE regular price, then FREE, then ONE working action, then the three checks
      const arts = nb(pricing).split("<article").slice(1).map((a) => a.slice(0, a.indexOf("</article>")));
      const ok = arts.length === 3 && arts.every((a, i) => { const n = a.indexOf('class="aicc-plan__name"'), r = a.indexOf("aicc-plan__regular-line"), f = a.indexOf("aicc-plan__free-word"), c = a.search(/<a\b[^>]*class="aicc-btn/), k = a.indexOf("aicc-plan__checks"); return n >= 0 && n < r && r < f && f < c && c < k && (a.match(/<a\b[^>]*class="aicc-btn/g) || []).length === 1 && a.includes(formatPrice(PLANS[i].price, l)); });
      check(ok, `${l} ${mode}: each card reads name, regular price, ${D[l] ? ea(l).plan.freeWord : "FREE"}, ONE working button, three checks, in that order`);
      const want = mode === "open" ? /\/request-access\/\?plan=(solo|studio|agency)$/ : new RegExp(`^/${P}#demo$`);
      const hrefs = arts.map((a) => (a.match(/<a\b[^>]*class="aicc-btn[^"]*"[^>]*href="([^"]*)"|<a\b[^>]*href="([^"]*)"[^>]*class="aicc-btn/) || []).slice(1).find(Boolean));
      check(hrefs.length === 3 && hrefs.every((x) => want.test(x || "")), `${l} ${mode}: every card's one action is a real link (${mode === "open" ? "/request-access/?plan=" : "the live demo " + `/${P}#demo`}): ${hrefs.join(", ")}`);
      // hierarchy from the real CSS the build emits: FREE must be larger than the regular price, which stays at least 2rem (never a footnote); smaller type on phones
      const css = (home.match(/<style>([\s\S]*?)<\/style>/g) || []).join("\n");
      const free = remOf(css, ".aicc-plan .aicc-plan__free-word"), reg = remOf(css, ".aicc-plan .aicc-plan__regular-line");
      check(free > reg && reg >= 2 && free / reg >= 1.4, `${l} ${mode}: FREE (${free}rem) is dominant over the regular price (${reg}rem >= 2rem)`);
      const mobile = (css.match(/@media \(max-width:39\.99rem\)\{\.aicc-plan \.aicc-plan__free-word\{font-size:([0-9.]+)rem/) || [])[1];
      check(parseFloat(mobile) >= 2.5 && parseFloat(mobile) > reg, `${l} ${mode}: on phones FREE stays larger than the regular price (${mobile}rem)`);
    }
    // links: every internal link of Home and Pricing resolves to a page of the export or to a WordPress route; none leads to /request-access/ unless the build is OPEN
    const dead = [];
    for (const [name, page] of [["Home", home], ["Pricing", pricing]]) for (const m of page.matchAll(/<a\b[^>]*href="(\/[^"#?]*)/g)) {
      const hp = m[1]; if (/^\/(_next|brand-kit|og|fonts|demo)\//.test(hp) || /\.[a-z0-9]{2,5}$/i.test(hp)) continue;
      const seg = hp.replace(/^\/(he|es|ru)\//, "/").split("/").filter(Boolean)[0];
      const exists = fs.existsSync(path.join(root, hp.replace(/^\//, ""), "index.html")) || (seg && WP_ROUTES.has(seg)) || hp === "/";
      if (!exists) dead.push(`${name}:${hp}`);
    }
    check(dead.length === 0, `${l} ${mode}: no internal link leads to a missing page${dead.length ? " -> " + [...new Set(dead)].slice(0, 4).join(", ") : ""}`);
    if (mode !== "open") check(![home, pricing].some((x) => /request-access/.test(x)), `${l} ${mode}: no link or text points at /request-access/ while requests are not open`);
  }
}

p36Guards("off", dirs.off);
if (ANN_STRIKE) {
  console.log("\n== ANNOUNCE with NEXT_PUBLIC_AICC_EA_STRIKE=on (variant A, counsel-gated): the regular price struck through, FREE below");
  for (const l of LOCALES) {
    const pr = nb(htmlOf(ANN_STRIKE, `${pre(l)}pricing/index.html`)), arts = pr.split("<article").slice(1).map((a) => a.slice(0, a.indexOf("</article>")));
    check(arts.length === 3 && arts.every((a, i) => /<s><bdi>/.test(a) && a.indexOf("<s>") < a.indexOf("aicc-plan__free-word") && a.includes(formatPrice(PLANS[i].price, l))), `${l}: variant A: the regular price is struck through on every card with FREE below it`);
  }
}

// ───────── ANNOUNCE ─────────
console.log("\n== ANNOUNCE: nothing to click");
campaignChecks("announce", dirs.announce);
p36Guards("announce", dirs.announce);
{
  const root = dirs.announce, all = textFiles(root);
  check(all.every((f) => !/request-access/.test(fs.readFileSync(f, "utf8"))), "no file of the export (HTML, RSC payload, sitemap, robots) mentions /request-access/");
  check(REQ_FILES.every((r) => !fs.existsSync(path.join(root, r))), "no request page exists");
  const leaks = all.filter((f) => { const t = nb(fs.readFileSync(f, "utf8")); return requestWords.some((w) => t.includes(w)); });
  check(leaks.length === 0, `no file of the export contains the request button wording in any language, not even in hidden markup${leaks.length ? " -> " + path.relative(root, leaks[0]) : ""}`);
  const anchors = htmlFiles(root).flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1]));
  check(!anchors.some((h) => /offer=early-access|request-access/.test(h)), "no link of any page leads to a request or sign-up destination");
}

// ───────── OPEN ─────────
console.log("\n== OPEN: request buttons lead to /request-access/");
campaignChecks("open", dirs.open);
p36Guards("open", dirs.open);
if (LIMITED) { console.log("\n== OPEN with NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on (P34): the same, plus \"Limited availability\" under the Hero buttons"); campaignChecks("open", LIMITED); }
if (ANN_LIMITED) { console.log("\n== ANNOUNCE with NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on (review P34-5): no \"Limited availability\" (OPEN only)"); campaignChecks("announce", ANN_LIMITED); }
{
  const root = dirs.open;
  check(REQ_FILES.every((r) => fs.existsSync(path.join(root, r))), "eight request pages exist (/request-access/ and /request-access/confirm/ in en, he, es, ru)");
  for (const l of LOCALES) for (const kind of ["request-access/", "request-access/confirm/"]) {
    const h = htmlOf(root, `${pre(l)}${kind}index.html`), meta = D[l].ea.request;
    const dir = l === "he" ? "rtl" : "ltr";
    check(new RegExp(`<html[^>]*lang="${l}"[^>]*dir="${dir}"|<html[^>]*dir="${dir}"[^>]*lang="${l}"`).test(h), `${l} ${kind}: <html lang="${l}" dir="${dir}">`);
    check(/<meta name="robots" content="noindex,nofollow"\/?>/.test(h) && /<meta name="referrer" content="no-referrer"\/?>/.test(h), `${l} ${kind}: noindex,nofollow and no-referrer`);
    const t = visibleText(h);
    check(t.includes(norm(kind.endsWith("confirm/") ? meta.confirm.title : meta.title)), `${l} ${kind}: the page title is in the page language`);
    check(!/data-req-verify/.test(h) && !t.includes(norm(meta.verifyBanner)), `${l} ${kind}: no "Verification page" banner in an open build`);
    check(!/challenges\.cloudflare\.com/.test(h), `${l} ${kind}: the HTML names no Turnstile origin (the script is loaded on demand, after /status says open)`);
    if (!kind.endsWith("confirm/")) check(t.includes(norm(meta.checking)) && !/<form\b/.test(h), `${l} ${kind}: the server HTML shows only "checking" (the form exists only after /status says open)`);
  }
  // Turnstile code lives only in a request-page chunk that no other page references
  const chunkDir = path.join(root, "_next/static/chunks");
  const tsChunks = walk(chunkDir, (p) => p.endsWith(".js")).filter((p) => fs.readFileSync(p, "utf8").includes("challenges.cloudflare.com")).map((p) => path.basename(p));
  check(tsChunks.length >= 1, `the Turnstile origin is named in client code (${tsChunks.join(", ")})`);
  // the origin is a string constant of the request form, which Next bundles with the route's page chunk; no page loads the Turnstile SCRIPT except the request page after /status says open
  // (no <script> of that origin exists in any HTML; the browser test proves no request to it is made by any other page or before the answer)
  check(tsChunks.every((c) => /^page-/.test(c)) && htmlFiles(root).every((f) => !/<script[^>]*src="[^"]*challenges\.cloudflare\.com/.test(fs.readFileSync(f, "utf8"))), `the Turnstile origin is only a string in the route's page chunk (${tsChunks.join(", ")}); no HTML page has a <script> for it (it is injected on demand by the request form)`);
  // nothing reaches payment
  const PAY = /(?:href|action)="[^"]*(?:checkout|\/cart|\/pay\b|payment|licen[cs]e|\/grant|wp-admin|wp-login|my-account\/?\?(?:[^"]*&)?plan=|offer=early-access)[^"]*"/i;
  const payHits = htmlFiles(root).filter((f) => PAY.test(fs.readFileSync(f, "utf8")));
  check(payHits.length === 0, `no page of the open build links to a payment, checkout, licence, grant or purchase route${payHits.length ? " -> " + path.relative(root, payHits[0]) : ""}`);
  const apiRefs = new Set();
  for (const c of walk(chunkDir, (p) => p.endsWith(".js"))) { const t = fs.readFileSync(c, "utf8"); if (t.includes("access-requests")) for (const m of t.matchAll(/\/wp-json\/[^"'`\s\\)]*/g)) apiRefs.add(m[0]); }
  check(apiRefs.size >= 1 && [...apiRefs].every((a) => /^\/wp-json\/aicc\/v1\/access-requests(\/status|\/confirm)?$/.test(a)), `the only API surface named by client code is /wp-json/aicc/v1/access-requests* (${[...apiRefs].join(", ")})`);
  check(!/sitemap|request-access/.test((htmlOf(root, "../__none") || "")) && !/request-access/.test(fs.readFileSync(path.join(root, "sitemap.xml"), "utf8")) && !/request-access/.test(fs.readFileSync(path.join(root, "robots.txt"), "utf8")), "sitemap.xml and robots.txt do not name the request pages");
}

// ───────── VERIFY ─────────
console.log("\n== VERIFY: the ordinary site plus unlisted request pages");
{
  const root = dirs.verify;
  check(REQ_FILES.every((r) => fs.existsSync(path.join(root, r))), "eight request pages exist");
  for (const l of LOCALES) for (const kind of ["request-access/", "request-access/confirm/"]) {
    const h = htmlOf(root, `${pre(l)}${kind}index.html`), meta = D[l].ea.request;
    check(/<meta name="robots" content="noindex,nofollow"\/?>/.test(h), `${l} ${kind}: <meta name="robots" content="noindex,nofollow">`);
    check(/data-req-verify/.test(h) && visibleText(h).includes(norm(meta.verifyBanner)), `${l} ${kind}: the banner says "${meta.verifyBanner}"`);
    check(!/data-ea-mode/.test(h), `${l} ${kind}: no campaign mode marker (the page is OFF plus the form)`);
  }
  check(D.en.ea.request.verifyBanner === "Verification page, not public" && LOCALES.every((l) => !/[–—]/.test(D[l].ea.request.verifyBanner)), "the banner text is exactly 'Verification page, not public' in English and has no dash in any language");
  const nonReq = textFiles(root).filter((f) => !/request-access\//.test(path.relative(root, f).split(path.sep).join("/")));
  check(nonReq.every((f) => !/request-access/.test(fs.readFileSync(f, "utf8"))), "no ordinary page, RSC payload, sitemap.xml or robots.txt names /request-access/ (unlisted: no navigation, no internal link, no search entry)");
  check(nonReq.every((f) => { const t = nb(fs.readFileSync(f, "utf8")); return !requestWords.some((w) => t.includes(w)) && !/data-ea-|aicc-eabar|aicc-eanote/.test(t); }), "no ordinary page carries any campaign text, marker or the request button wording (Request Free Access nowhere)");
  const sm = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8"), rb = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  check(!/request/.test(sm) && !/request/.test(rb), "sitemap.xml and robots.txt contain nothing about the request pages");
  const r = compare(dirs.off, root, { relaxed: true, ignore: ["request-access"] });
  check(r.onlyA.length === 0 && r.onlyB.length === 0 && r.diff.every((d) => /page-HASH\.js$/.test(d)), `every non-request file equals the OFF build after normalising the build id, the page-chunk hash and webpack module ids: ${r.n} files, only-in-off ${r.onlyA.length}, only-in-verify ${r.onlyB.length}, different ${r.diff.length} (${r.diff.join(", ") || "none"}; the page chunk carries the module ids)`);
  const rs = compare(dirs.off, root, { relaxed: true, ignore: ["request-access", "_next/static/chunks"] });
  check(rs.diff.length === 0 && rs.onlyA.length === 0 && rs.onlyB.length === 0, `all ${rs.n} HTML and RSC payload files of the ordinary site are identical to OFF (chunk files aside)`);
}

// ───────── P37 SELF-SERVICE matrix: launch-offer mode (off | announce | open) x self-service (on); the self-service OFF side is the existing matrix above (+ byte-equivalence to P36) ─────────
// With NEXT_PUBLIC_AICC_SELFSERVICE=on: every card button, closing band, the header "Get started" and the Product "Get started" lead to the Control Plane sign-up {CP}/start/?plan=<id> (language-prefixed); the Hero keeps
// Try Live Demo (#demo, primary) and See Pricing; no card ever targets #demo or /request-access/; no inert status-only button; the trial covers one store and the paid allowance is 1 / 3 / 10 only; every link resolves.
const CP_ORIGIN = "https://www.copilt.org";
/** The ONLY absolute (Control Plane hosted) hrefs a page may carry, by exact path pattern: the sign-up (with an optional plan), the account area, the pricing page and the DPA. Anything else absolute is a dead-link risk. */
const CP_ALLOW = /^https:\/\/www\.copilt\.org(\/(he|es|ru))?\/(start\/(\?plan=(solo|studio|agency))?|my-account\/|pricing\/|data-processing-addendum\/)$/;
const startOf = (l, plan) => `${CP_ORIGIN}${l === "en" ? "" : `/${l}`}/start/${plan ? `?plan=${plan}` : ""}`;
const accountOf = (l) => `${CP_ORIGIN}${l === "en" ? "" : `/${l}`}/my-account/`;
const anchorsOf = (h) => [...nb(h).matchAll(/<a\b([^>]*)href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[2], cls: (m[1] + m[3]).match(/class="([^"]*)"/)?.[1] || "", text: norm(m[4].replace(/<[^>]+>/g, " ")), at: m.index }));
const sectionOf = (h, labelledBy) => { const i = h.indexOf(`aria-labelledby="${labelledBy}"`); if (i < 0) return ""; const a = h.lastIndexOf("<section", i); return h.slice(a, h.indexOf("</section>", i)); };
const articlesOf = (h) => nb(h).split("<article").slice(1).map((a) => a.slice(0, a.indexOf("</article>"))).filter((a) => /class="aicc-plan\b/.test(a));
const STORE_NUMS = /(?:(\d+)\s+(?:stores?|tiendas?|магазин\p{L}*|חנויות|חנות)|חנות אחת)/giu;
function ssChecks(mode, root, initial = "coming_soon") {
  const tag = `ss-${mode}${initial === "link" ? "-link" : ""}`, soon = initial !== "link";
  console.log(`== SELF-SERVICE + ${mode.toUpperCase()} (initial ${initial}): CTA state, Hero, dates, allowance, links, no inert chip (four languages)`);
  const requestHits = [];
  for (const l of LOCALES) {
    const e = ea(l), ss = e.ss, P = pre(l), dict = D[l];
    const home = htmlOf(root, `${P}index.html`), pricing = htmlOf(root, `${P}pricing/index.html`), product = htmlOf(root, `${P}product/index.html`);
    const th = visibleText(home), tp = visibleText(pricing);
    const marker = (h, attr, v) => new RegExp(`<html[^>]*${attr}="${v}"`).test(h);
    check(marker(home, "data-ss-mode", "on") && marker(pricing, "data-ss-mode", "on") && (mode === "off" ? !/data-ea-mode/.test(home) : marker(home, "data-ea-mode", mode)), `${l} ${tag}: <html data-ss-mode="on"> and ${mode === "off" ? "no launch-offer marker" : `data-ea-mode="${mode}"`}`);
    check(new RegExp(`<html[^>]*dir="${l === "he" ? "rtl" : "ltr"}"`).test(home), `${l} ${tag}: <html dir="${l === "he" ? "rtl" : "ltr"}">`);
    // ---- Hero: the original two actions, unchanged and independent of self-service
    {
      const h = nb(home), i0 = h.indexOf('class="aicc-hero-actions'), hero = h.slice(i0, h.indexOf("</div>", i0));
      const an = anchorsOf(hero);
      const demo = an.find((a) => a.text === norm(dict.home.hero.ctaDemo)), plans = an.find((a) => a.text === norm(dict.home.hero.ctaPlans));
      check(!!demo && demo.href === "#demo" && /aicc-btn--primary/.test(demo.cls), `${l} ${tag}: the Hero keeps "${dict.home.hero.ctaDemo}" as the PRIMARY link to #demo`);
      check(!!plans && plans.href === `/${P}pricing/`, `${l} ${tag}: the Hero keeps "${dict.home.hero.ctaPlans}" as a link to /${P}pricing/`);
      check(an.length === 2 && !/<p\b|aicc-btn--soon|data-ea-soon/.test(hero), `${l} ${tag}: the Hero has exactly its two actions (no sign-up button, no request button, no inert chip)`);
      check(/\bid="demo"/.test(h), `${l} ${tag}: the #demo target exists on Home`);
    }
    // ---- cards (Home and Pricing): P39 the sign-up control follows the build's initial state; the demo is a separate secondary link; the two dates are two labelled lines
    for (const [name, page] of [["Home", home], ["Pricing", pricing]]) {
      const cards = articlesOf(page);
      check(cards.length === 3, `${l} ${tag} ${name}: three plan cards`);
      cards.forEach((a, i) => {
        const plan = PLANS[i], planName = dict.pricing.plans[plan.id].name;
        const live = mode === "off" ? a : a.replace(/<(div|ul)\b[^>]*data-ea-after[\s\S]*?<\/\1>/g, " ");
        const buttons = anchorsOf(live).filter((x) => /(^|\s)aicc-btn(\s|$)/.test(x.cls));
        const demos = anchorsOf(live).filter((x) => /data-ss-demo/.test(live.slice(Math.max(0, x.at - 60), x.at)));
        const states = [...live.matchAll(/<p class="aicc-sstate"[^>]*data-ss-state="(\w+)"[^>]*role="status"[^>]*>([\s\S]*?)<\/p>/g)];
        if (soon) {
          check(buttons.length === 0 && !/<button\b/.test(live) && !/\/start\//.test(live.replace(/<script[\s\S]*?<\/script>/g, "")), `${l} ${tag} ${name} ${plan.id}: the static card has NO sign-up button or link (no /start/ link, no button) while registration is not known to be open`);
          check(states.length === 1 && states[0][1] === "static" && norm(states[0][2].replace(/<[^>]+>/g, " ")) === norm(ss.cta.soon), `${l} ${tag} ${name} ${plan.id}: the static status is the plain text "${ss.cta.soon}" (<p role="status">, not a link, not a button)`);
          check(!/<(a|button)\b[^>]*>(?:(?!<\/(a|button)>)[\s\S])*aicc-sstate/.test(live), `${l} ${tag} ${name} ${plan.id}: the status text is not inside a link or a button`);
        } else {
          check(buttons.length === 1 && buttons[0].href === startOf(l, plan.id) && buttons[0].text.startsWith(norm(ss.cta.start)) && buttons[0].text.includes(planName), `${l} ${tag} ${name} ${plan.id}: the link build's ONE sign-up control is "${ss.cta.start}" -> ${startOf(l, plan.id)} (${planName} for screen readers)`);
          check(states.length === 0, `${l} ${tag} ${name} ${plan.id}: the link build carries no static status text`);
        }
        check(demos.length === 1 && /(^|\s)aicc-link(\s|$)/.test(demos[0].cls) && !/aicc-btn/.test(demos[0].cls) && demos[0].href === `${P ? "/" + P.replace(/\/$/, "") : ""}/#demo`.replace("//", "/") && demos[0].text.startsWith(norm(dict.home.hero.ctaDemo)), `${l} ${tag} ${name} ${plan.id}: ONE secondary "${dict.home.hero.ctaDemo}" text link to the demo (never a button, never the sign-up control) -> ${demos[0]?.href}`);
        check(!/request-access/.test(a) && !buttons.some((x) => /#demo/.test(x.href)), `${l} ${tag} ${name} ${plan.id}: no card control targets #demo or /request-access/`);
        const text = norm(a.replace(/<[^>]+>/g, " | "));
        const paid = plan.stores === 1 ? ss.plan.paidOne : ss.plan.paidMany.replace("{n}", String(plan.stores));
        check(text.includes(norm(ss.plan.trial)) && text.includes(norm(paid)) && text.includes(norm(ss.plan.noPayment)) && text.includes(norm(ss.plan.noAuto)), `${l} ${tag} ${name} ${plan.id}: the card states the trial ("${ss.plan.trial}"), the paid allowance ("${paid}"), the payment rule and "${ss.plan.noAuto}"`);
        // P39: THE TWO DATES, two labelled lines, registration first
        const dl = (live.match(/<dl class="aicc-ssdates"[\s\S]*?<\/dl>/) || [""])[0];
        const rows = [...nb(dl).matchAll(/<div data-ss-date="(\w+)"><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)].map((m) => [m[1], norm(m[2].replace(/<[^>]+>/g, " ")), norm(m[3].replace(/<[^>]+>/g, " "))]);
        check(rows.length === 2 && rows[0][0] === "registration" && rows[0][1] === norm(ss.plan.regLabel) && rows[0][2] === norm(ss.plan.regValue) && rows[1][0] === "end" && rows[1][1] === norm(ss.plan.endLabel) && rows[1][2] === norm(ss.plan.endValue), `${l} ${tag} ${name} ${plan.id}: two labelled date lines: "${norm(ss.plan.regLabel)}: ${norm(ss.plan.regValue)}" and "${norm(ss.plan.endLabel)}: ${norm(ss.plan.endValue)}"`);
        check(!text.includes(norm(D[l].ea.plan.freeUntil)) && !/FREE until/i.test(text), `${l} ${tag} ${name} ${plan.id}: no loose "FREE until <date>" line (the dates are the two labelled lines)`);
        const nums = [...text.matchAll(STORE_NUMS)].map((m) => (m[1] ? Number(m[1]) : 1)); // Hebrew writes one store as "חנות אחת"
        check(nums.length >= 2 && nums.every((n) => [1, 3, 10].includes(n)) && nums.includes(plan.stores) && nums.includes(1), `${l} ${tag} ${name} ${plan.id}: the only store counts on the card are 1 and ${plan.stores}, from the 1 / 3 / 10 table [${nums}]`);
        const n = a.indexOf('class="aicc-plan__name"'), d = a.indexOf('data-ss-dates'), k = a.indexOf("aicc-plan__checks"), c = Math.max(a.indexOf("aicc-sstate"), a.search(/<a\b[^>]*class="aicc-btn/)), dm = a.indexOf("data-ss-demo");
        if (mode === "off") check(n >= 0 && n < d && d < k && k < c && c < dm, `${l} ${tag} ${name} ${plan.id}: order: plan name, the two dates, the checks, the control, the demo link`);
        else { const r = a.indexOf("aicc-plan__regular-line"), f = a.indexOf("aicc-plan__free-word"); check(n >= 0 && n < r && r < f && f < d && d < k && k < c && c < dm, `${l} ${tag} ${name} ${plan.id}: order: name, regular price, FREE + trial line, the two dates, the checks, the sign-up control, the demo link`); }
        check(!/<p class="aicc-btn/.test(live), `${l} ${tag} ${name} ${plan.id}: no inert button-looking element on the live card`);
      });
      // the inert "Purchases open soon" chip: only in the hidden ended view of a launch-offer build, never visible; in self-service-only builds nowhere
      const bad = []; const h = nb(page);
      for (const m of h.matchAll(/<p class="aicc-btn[^"]*"/g)) { const mk = [...h.slice(Math.max(0, m.index - 900), m.index).matchAll(/data-ea-(live|after)/g)].map((x) => x[1]).pop(); if (mode === "off" || mk !== "after") bad.push(`${name}@${m.index}`); }
      check(bad.length === 0 && !/data-ea-soon|aicc-eastatus/.test(h), `${l} ${tag} ${name}: no status-only inert button is visible (the "${dict.common.soon.label}" chip exists only in the hidden ended view of a launch-offer build)${bad.length ? " -> " + bad.join(", ") : ""}`);
      if (mode !== "off") {
        const css = (home.match(/<style>([\s\S]*?)<\/style>/g) || []).join("\n");
        const free = remOf(css, ".aicc-plan .aicc-plan__free-word"), reg = remOf(css, ".aicc-plan .aicc-plan__regular-line");
        check(name !== "Home" || (free > reg && reg >= 2 && free / reg >= 1.4), `${l} ${tag}: FREE (${free}rem) stays dominant over the regular price (${reg}rem)`);
      }
    }
    // ---- terms (Pricing: #free-trial; Home: the same block without the id): the two dates, then the facts
    {
      const termsOf = (page) => (nb(page).match(/<div class="aicc-eaterms"[^>]*data-ss-terms[\s\S]*?<\/ul><\/div>/) || [""])[0];
      for (const [name, page, anchor] of [["Pricing", pricing, true], ["Home", home, false]]) {
        const t = termsOf(page), tt = norm(t.replace(/<[^>]+>/g, " "));
        check(t !== "" && /\bid="free-trial"/.test(t) === anchor && [ss.terms.label, ss.plan.regLabel, ss.terms.regValue, ss.plan.endLabel, ss.terms.endValue, ss.terms.store, ss.terms.payment, ss.terms.noAuto, ss.terms.paid, ss.terms.state].every((x) => tt.includes(norm(x))), `${l} ${tag} ${name}: the free-trial terms block${anchor ? " (#free-trial)" : ""} states the two dates (long form), one store, no payment method for the trial, no automatic conversion, the 1 / 3 / 10 paid allowance and the state note`);
      }
      check(!/\bid="free-trial"/.test(home), `${l} ${tag}: Home has no id="free-trial" (one anchor per page, on Pricing)`);
    }
    check(tp.includes("22:00 UTC") && tp.includes("00:00 UTC") && norm(ss.terms.endValue).includes("22:00 UTC") && norm(ss.terms.regValue).includes("00:00 UTC"), `${l} ${tag}: the registration close (00:00 UTC) and the trial end (22:00 UTC) are both stated in UTC`);
    check(norm(ss.terms.paid).match(/\d+/g).map(Number).every((n) => [1, 3, 10].includes(n)) && !tp.match(/\b(11|12|15|20|25|30|50|100)\s+(stores|tiendas|магазин)/i), `${l} ${tag}: no page text claims a paid capacity above the Backend table (1 / 3 / 10)`);
    if (mode !== "off") {
      check(th.includes(norm(ss.bar.text)) && !th.includes(norm(e.bar.live)), `${l} ${tag}: the bar says the free trial ("${ss.bar.text}") and not the launch-offer request wording`);
      const barLink = anchorsOf(home).find((a) => a.text === norm(ss.bar.link));
      check(!!barLink && barLink.href === `/${P}pricing/#free-trial`, `${l} ${tag}: the bar link leads to /${P}pricing/#free-trial (${barLink?.href})`);
      const sup = (nb(home).match(/data-ea-support="hero"[\s\S]*?<\/ul>(?:<p class="aicc-eanote"[^>]*data-ss-support-note[\s\S]*?<\/p>)?/) || [""])[0];
      check(sup.includes(norm(ss.hero.support.noPayment)) && sup.includes(norm(ss.hero.support.oneStore)) && sup.includes(norm(ss.hero.support.noAuto)) && !sup.includes(norm(e.hero.support.approval)) && !sup.includes(norm(e.hero.support.noCard)), `${l} ${tag}: the Hero support lines are the three trial facts (no "approval", no "no credit card")`);
      const pill = (nb(home).match(/class="aicc-eabadge"[\s\S]*?<\/span><\/span>/) || [""])[0];
      check(norm(pill.replace(/<[^>]+>/g, " ")).includes(norm(ss.hero.badge)) && !/(Dec|dic|дек|דצמבר)/i.test(pill.replace(/<[^>]+>/g, " ")), `${l} ${tag}: the Hero pill says "${ss.hero.badge}" and names no date (the dates are the labelled lines on the cards)`);
    }
    // ---- no launch-offer request wording while self-service is on: nothing says "approved", "request", or "no credit card"
    {
      const banned = [...new Set([e.hero.ctaOpen, e.hero.ctaAnnounce, e.header.cta, e.plan.approved, e.plan.noCard, e.plan.ctaClosed, e.hero.support.approval, e.hero.support.noCard, e.pricing.note, e.bar.live, e.bar.announce, e.bar.linkAnnounce].map(norm))];
      // the hidden ended view (data-ea-after) may carry the ordinary wording; only what is shown while the page is live counts
      const live = (h) => visibleText(nb(h).replace(/<div class="aicc-eaafter"[\s\S]*?<\/div>/, " ").replace(/<(div|span|p|ul)\b[^>]*data-ea-after[\s\S]*?<\/\1>/g, " "));
      const hits2 = banned.filter((w) => [live(home), live(pricing), live(product)].some((t) => t.includes(w)));
      check(hits2.length === 0, `${l} ${tag}: no launch-offer request / approval / "no credit card" wording is shown while self-service is on${hits2.length ? " -> " + hits2[0] : ""}`);
    }
    // ---- header (desktop and menu): "Get started" -> the account page until sign-up is known to work (a build with initial link: the sign-up page); Sign in stays on the account page; no request button
    {
      const hdr = nb(home).slice(nb(home).indexOf('<header class="aicc-site-header"'), nb(home).indexOf("</header>"));
      const an = anchorsOf(hdr), gs = an.filter((a) => a.text === norm(dict.common.getStarted)), si = an.filter((a) => a.text === norm(dict.brand.signIn));
      const want = soon ? accountOf(l) : startOf(l);
      check(gs.length >= 2 && gs.every((a) => a.href === want) && !/data-ea-after/.test(hdr), `${l} ${tag}: the header "Get started" (desktop and menu) leads to ${want} (${soon ? "a page that exists: never /start/ while it may be a 404" : "the sign-up page of a link build"}) and is visible (not in the ended view)`);
      check(si.length >= 2 && si.every((a) => a.href === accountOf(l)), `${l} ${tag}: "Sign in" (desktop and menu) stays on the account page ${accountOf(l)}`);
      check(!anchorsOf(hdr).some((a) => /request-access|#demo/.test(a.href)), `${l} ${tag}: the header has no request link and no demo link`);
    }
    // ---- closing bands (Home, Pricing, Product x2): lead sentence, the two dates, the sign-up control; the demo / pricing links stay as secondary actions
    for (const [name, page, id] of [["Home", home, "final-title"], ["Pricing", pricing, "pricing-final"], ["Product", product, "safety-cta"], ["Product", product, "product-final"]]) {
      const sec = sectionOf(page, id), an = anchorsOf(sec);
      const live = mode === "off" ? sec : sec.slice(0, sec.indexOf("data-ea-after") > 0 ? sec.indexOf("data-ea-after") : sec.length);
      const txt = norm(live.replace(/<[^>]+>/g, " "));
      const cta = anchorsOf(live).filter((a) => a.text.startsWith(norm(ss.cta.start)));
      if (soon) check(cta.length === 0 && (live.match(/data-ss-state="static"/g) || []).length === 1 && txt.includes(norm(ss.cta.soon)) && !/\/start\//.test(live.replace(/<script[\s\S]*?<\/script>/g, "")), `${l} ${tag}: the ${name} closing band (${id}) shows the plain status "${ss.cta.soon}" and no sign-up link`);
      else check(cta.length === 1 && cta[0].href === startOf(l), `${l} ${tag}: the ${name} closing band (${id}) leads with "${ss.cta.start}" -> ${startOf(l)}`);
      check(txt.includes(norm(ss.band.lead)) && txt.includes(norm(ss.plan.regLabel)) && txt.includes(norm(ss.plan.regValue)) && txt.includes(norm(ss.plan.endLabel)) && txt.includes(norm(ss.plan.endValue)), `${l} ${tag}: the ${name} band (${id}) has its lead sentence and the two labelled dates`);
      check(!an.some((a) => /request-access/.test(a.href)) && !anchorsOf(live).some((a) => /aicc-btn--primary/.test(a.cls) && /#demo/.test(a.href) && id !== "final-title" && id !== "pricing-final"), `${l} ${tag}: the ${name} band (${id}) has no request link`);
    }
    {
      const hero = nb(product).slice(nb(product).indexOf('class="aicc-hero-actions'), nb(product).indexOf("</div>", nb(product).indexOf('class="aicc-hero-actions')));
      const gs = anchorsOf(hero).find((a) => a.text === norm(dict.common.getStarted));
      const want = soon ? accountOf(l) : startOf(l);
      check(!!gs && gs.href === want, `${l} ${tag}: the Product "Get started" leads to ${want}`);
    }
    for (const [name, page] of [["Home", home], ["Pricing", pricing], ["Product", product]]) if (/request-access/.test(page)) requestHits.push(`${l} ${name}`);
  }
  // ---- every link of every page resolves: internal links to an export page / WordPress route, absolute links only to the exact Control Plane patterns
  {
    const dead = [], seen = new Set();
    for (const f of htmlFiles(root)) {
      const rel = path.relative(root, f).split(path.sep).join("/"), raw = fs.readFileSync(f, "utf8");
      for (const m of raw.matchAll(/<a\b[^>]*href="([^"]*)"/g)) {
        const h = decode(m[1]); if (h.startsWith("#") || /^(mailto|tel):/.test(h)) continue;
        if (/^https?:/.test(h)) { if (!CP_ALLOW.test(h) && !seen.has(h)) { seen.add(h); dead.push(`${rel}: ${h}`); } continue; }
        if (!h.startsWith("/")) { dead.push(`${rel}: ${h}`); continue; }
        const hp = h.split(/[?#]/)[0]; if (/^\/(_next|brand-kit|og|fonts|demo)\//.test(hp) || /\.[a-z0-9]{2,5}$/i.test(hp)) continue;
        const seg = hp.replace(/^\/(he|es|ru)\//, "/").split("/").filter(Boolean)[0];
        if (!(fs.existsSync(path.join(root, hp.replace(/^\//, ""), "index.html")) || (seg && WP_ROUTES.has(seg)) || hp === "/")) dead.push(`${rel}: ${h}`);
      }
    }
    check(dead.length === 0, `${tag}: every link of every page resolves (export page, WordPress route, or an exact Control Plane pattern: /start/?plan=, /my-account/, /pricing/, /data-processing-addendum/)${dead.length ? " -> " + dead.slice(0, 4).join(" | ") : ""}`);
  }
  // ---- /request-access/ is never linked, whatever the launch-offer mode; the sitemap does not list the Control Plane sign-up
  {
    const nonReq = textFiles(root).filter((f) => !/(^|\/)request-access\//.test(path.relative(root, f).split(path.sep).join("/")));
    const hits = nonReq.filter((f) => /request-access/.test(fs.readFileSync(f, "utf8")));
    check(hits.length === 0 && requestHits.length === 0, `${tag}: no page, RSC payload, sitemap or robots.txt outside the request pages mentions /request-access/ while self-service is on${hits.length ? " -> " + path.relative(root, hits[0]) : ""}`);
    check(!/\/start\//.test(fs.readFileSync(path.join(root, "sitemap.xml"), "utf8")), `${tag}: sitemap.xml does not list the Control Plane /start/ page`);
    const all = textFiles(root).filter((f) => !/(^|\/)request-access\//.test(path.relative(root, f).split(path.sep).join("/")));
    const leaks = all.filter((f) => requestWords.some((w) => nb(fs.readFileSync(f, "utf8")).includes(w)));
    check(leaks.length === 0, `${tag}: no file outside the request pages carries the "Request Free Access" wording in any language${leaks.length ? " -> " + path.relative(root, leaks[0]) : ""}`);
  }
  // ---- the run-time state code is in a client chunk of this build only; the status path is named there and nowhere else
  {
    const chunkDir = path.join(root, "_next/static/chunks"), refs = new Set();
    for (const c of walk(chunkDir, (p) => p.endsWith(".js"))) { const t = fs.readFileSync(c, "utf8"); if (t.includes("signup/status")) for (const m of t.matchAll(/\/wp-json\/[^"'`\s\\)]*/g)) refs.add(m[0]); }
    check([...refs].length === 1 && [...refs][0] === "/wp-json/aicc/v1/signup/status", `${tag}: the only API surface the self-service button names is GET /wp-json/aicc/v1/signup/status (${[...refs].join(", ")})`);
    check(htmlFiles(root).every((f) => { const h = fs.readFileSync(f, "utf8"); return (soon ? [...h.matchAll(/data-ss-state="(\w+)"/g)].every((m) => m[1] === "static") : !/data-ss-state=/.test(h)); }), `${tag}: no page ships a RUN-TIME state (open / waitlist / closed / paused / off) in its static HTML; the static state is ${soon ? "the plain text of the default build" : "the link of the link build"}`);
    check(htmlFiles(root).every((f) => !/<a\b[^>]*href="[^"]*\/start\/[^"]*"/.test(fs.readFileSync(f, "utf8").replace(/<script[\s\S]*?<\/script>/g, "")) || !soon), `${tag}: ${soon ? "no <a> to the Control Plane /start/ page exists in any static page (the page may be a 404 while sign-up is off)" : "link build: /start/ links allowed"}`);
  }
}
if (SS.off || SS.announce || SS.open) {
  console.log("\n== P37/P39 SELF-SERVICE");
  for (const m of ["off", "announce", "open"]) if (SS[m]) ssChecks(m, SS[m]); else console.log(`  note --ss-${m} not given: the self-service + ${m} cell of the matrix was not run`);
  if (SS_LINK) ssChecks("announce", SS_LINK, "link"); else console.log("  note --ss-link not given: the link-initial build (NEXT_PUBLIC_AICC_SS_INITIAL=link) was not audited");
  // the self-service OFF side of the matrix: the build of each launch-offer environment WITHOUT the switch is byte-equivalent to the P36 export of the same environment
  for (const [m, dir] of [["announce", dirs.announce], ["open", dirs.open], ["verify", dirs.verify]]) if (BASES[m]) {
    const r = compare(BASES[m], dir);
    check(r.onlyA.length === 0 && r.onlyB.length === 0 && r.diff.length === 0, `self-service OFF (${m}) is byte-equivalent to the P36 ${m} export after normalising the build id: ${r.n} files vs ${r.m}, only-in-P36 ${r.onlyA.length}, only-in-new ${r.onlyB.length}, different ${r.diff.length}${r.diff.length ? " -> " + r.diff.slice(0, 3).join(", ") : ""}`);
  } else console.log(`  note --base-${m} not given: the self-service OFF byte-equivalence for ${m} was not run`);
  // the Hero's two actions are identical (destination and wording) with self-service on and off, in every mode and language: self-service never touches them
  for (const [m, dir] of [["off", SS.off], ["announce", SS.announce], ["open", SS.open]]) if (dir) for (const l of LOCALES) {
    const heroLinks = (root) => { const h = nb(htmlOf(root, `${pre(l)}index.html`)), i0 = h.indexOf('class="aicc-hero-actions'); return anchorsOf(h.slice(i0, h.indexOf("</div>", i0))).filter((a) => a.text === norm(D[l].home.hero.ctaDemo) || a.text === norm(D[l].home.hero.ctaPlans)).map((a) => `${a.text}|${a.href}`).sort(); };
    const a = heroLinks(dirs[m]), b = heroLinks(dir);
    check(a.length === 2 && JSON.stringify(a) === JSON.stringify(b), `${l} self-service + ${m}: the Hero's Try Live Demo and See Pricing links equal the ones of the same mode without self-service (${b.join(", ")})`);
  }
}

// ───────── negative controls: the probes must see what they claim to see ─────────
console.log("\n== negative controls");
{
  check(requestWords.some((w) => nb(`<p>${w}</p>`).includes(w)) && /Request Free Access/.test(requestWords.join("|")), "the request-button probe sees the real wording");
  check(BANNED.test("Save 20% today") && BANNED.test("Regular price, was $99") && BANNED.test("Starting from 2027") && !BANNED.test("Planned regular price: $99 a year"), "the banned-wording probe catches save / % / was / from 2027 and passes the plain price line");
  const fakeOff = path.join(process.env.TMPDIR || "/tmp", `p32-neg-${process.pid}`);
  fs.mkdirSync(fakeOff, { recursive: true });
  fs.writeFileSync(path.join(fakeOff, "a.html"), "<p>x</p>");
  const bid = "ID1"; fs.mkdirSync(path.join(fakeOff, "_next/static", bid), { recursive: true }); fs.writeFileSync(path.join(fakeOff, "_next/static", bid, "_buildManifest.js"), "x");
  const fakeB = fakeOff + "-b"; fs.cpSync(fakeOff, fakeB, { recursive: true }); fs.writeFileSync(path.join(fakeB, "a.html"), "<p>y</p>");
  check(compare(fakeOff, fakeB).diff.length === 1 && compare(fakeOff, fakeOff).diff.length === 0, "the equivalence probe reports one changed file and none for an identical tree");
  fs.rmSync(fakeOff, { recursive: true, force: true }); fs.rmSync(fakeB, { recursive: true, force: true });
}


// ───────── P36 owner rule: global-first branding, UTC-based deadlines ─────────
// No page of any mode (the ordinary site, announce, open, verify) names a country or a local time zone, states the end as 00:00 or prints the day after the last day without the UTC instant; the
// authoritative expiry instant stays exactly 2026-12-31T22:00:00Z (unix 1798754400) in the code and on the pages.
console.log("\n== UTC and geographic neutrality: every mode, every language");
{
  const GEO = /israel|israeli|jerusalem|ישראל|израил/i;
  const NEXT = /(?<!\d)(january 1,? 2027|1 בינואר 2027|1 de enero de 2027|1 января 2027)/i;
  for (const [name, root] of [["off", dirs.off], ["announce", dirs.announce], ["open", dirs.open], ["verify", dirs.verify], ...(ANN_STRIKE ? [["announce-strike", ANN_STRIKE]] : []), ...Object.entries(SS).filter(([, d]) => d).map(([m, d]) => [`ss-${m}`, d]), ...(SS_LINK ? [["ss-link", SS_LINK]] : [])]) {
    const bad = [], mid = [], next = [];
    for (const f of htmlFiles(root)) {
      const raw = fs.readFileSync(f, "utf8"), rel = path.relative(root, f);
      // P39: the registration cutoff ("<date> at 00:00 UTC", the two registration strings of a self-service build) is the ONE allowed 00:00; every other clock stays 22:00 UTC
      const loc = ["he", "es", "ru"].find((x) => rel.startsWith(x + "/")) || "en";
      let t = visibleText(raw);
      if (name.startsWith("ss-")) { const se = ea(loc).ss; for (const v of [se.terms.regValue, se.plan.regValue]) t = t.split(norm(v)).join(" "); }
      const meta = [...raw.matchAll(/<meta[^>]+content="([^"]*)"/g)].map((m) => decode(m[1])).join(" ") + " " + [...raw.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join(" ") + " " + ((raw.match(/<title>([^<]*)<\/title>/) || [])[1] || "");
      if (GEO.test(t) || GEO.test(meta)) bad.push(rel);
      if (/\b00:00\b/.test(t)) mid.push(rel);
      if (NEXT.test(norm(t))) next.push(rel);
    }
    check(bad.length === 0, `${name}: no page (text, meta description, structured data, title) names a country or a local time zone${bad.length ? " -> " + bad.slice(0, 3).join(", ") : ""}`);
    check(mid.length === 0 && next.length === 0, `${name}: no page states the end as 00:00 or prints January 1, 2027 (in any language)${mid.length + next.length ? " -> " + [...mid, ...next].slice(0, 3).join(", ") : ""}`);
  }
  check(EA_CUTOFF_UTC_MS === 1798754400000 && new Date(EA_CUTOFF_UTC_MS).toISOString() === "2026-12-31T22:00:00.000Z", "the expiry instant in the code is exactly 2026-12-31T22:00:00Z (unix 1798754400), not midnight UTC and not moved");
  for (const l of LOCALES) {
    const e = ea(l), P = pre(l);
    const tp = visibleText(htmlOf(dirs.announce, `${P}pricing/index.html`));
    check(tp.includes("22:00 UTC") && /UTC/.test(norm(e.plan.ends)) && !/00:00/.test(norm(e.plan.ends)), `${l}: the exact end is stated once in UTC ("${norm(e.plan.ends)}")`);
    check(/data-ea-cutoff="2026-12-31T22:00:00Z"/.test(htmlOf(dirs.announce, `${P}pricing/index.html`)), `${l}: the Pricing explanation carries data-ea-cutoff="2026-12-31T22:00:00Z"`);
  }
}

console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:launch-offer (${failed})`); process.exit(1); }
console.log("PASS test:launch-offer");
