/**
 * Early Access campaign copy, English (the contract for ea/he.ts, ea/es.ts, ea/ru.ts).
 * Published only by an Early Access build (src/lib/earlyAccess.ts); a normal build never renders any of it.
 *
 * WHY THIS FILE IS SEPARATE: `npm run copy:check` bans "free", "no credit card" and similar claims everywhere because no free flow existed. The owner has since decided one
 * (Production 20: free until 31 December 2026, fixed end, voluntary paid continuation). Those words are now allowed ONLY in this folder, under a stricter rule set
 * (`scripts/lib/early-access-truth.mjs`): the disclosures below must be present, and "trial", "subscription", "auto-renew", urgency tricks and percent claims stay banned.
 *
 * Every sentence states a fact that is true of the designed flow: no payment details are asked for, nothing converts or bills by itself, the end date is the same for
 * everyone. Do not add a claim here before the Control Plane behaviour it describes is built and tested (docs/cutover/early-access.md lists each one).
 * Dates are written out in words on purpose: the same instant is 2027-01-01 00:00 in Israel (UTC+2), which is why the last day is 31 December 2026 and access ends 1 January 2027.
 * Production 21: the dates are TOKENS ({lastDay}, {lastDayShort}, {endDate}, {firstLastDay}), resolved per extension step (0 = initial end, 1, 2) from src/i18n/eaTokens.ts. There is ONE copy set;
 * an extended build says the new dates in the same sentences and adds `extended.*`. `reservation` is permanent and step-independent: the initial terms already say an extension is possible, so an
 * extension is never a silent change.
 */
export const eaEn = {
  // The slim announcement bar under the header, on every page.
  bar: {
    label: "Early Access announcement",
    live: "Early Access: free for approved stores until {lastDay}, Israel time.",
    announce: "Early Access is coming: free for approved stores until {lastDay}, Israel time.",
    link: "How it works",
  },
  // Only an EXTENDED build (Production 21): the bar line (OPEN mode) and one short paragraph in the explanation. Both name the clock, say that payment details are not taken and that nothing converts or is charged by itself.
  extended: {
    bar: "Early Access has been extended for every store: free until {lastDay}, Israel time.",
    note: "Early Access was first announced to end on {firstLastDay}. We extended it for every Early Access store. Nothing else changed: no payment is taken and nothing converts or is charged automatically.",
  },
  // Shown INSTEAD of the offer once the end date has passed (set by the page script; see EA_HEAD_SCRIPT).
  after: {
    title: "Early Access has ended.",
    body: "Early Access ended on {endDate}, at 00:00 Israel time. To use AICC from here on, you choose a plan once purchases open. Nothing is charged automatically.",
    cta: "See the plans",
  },
  hero: {
    ctaOpen: "Request free Early Access",
    ctaAnnounce: "How Early Access works",
    note: "No credit card required. Access ends at 00:00 on {endDate}, Israel time, and nothing is charged automatically.",
  },
  // The header button while the offer is live (the ordinary "Get started" returns after the end date).
  header: { cta: "Request Early Access" },
  plan: {
    free: "Free until {lastDay}",
    regular: "Regular price, not charged during Early Access:",
    // Used when the strike-through is off (the default): the same price, said as a plan for the future, not as a reduction.
    planned: "Planned price when purchases open:",
    regularPer: "a year",
    noCard: "No credit card required",
    term: "Early Access term: until {lastDay}, Israel time",
    ends: "Access ends at 00:00 on {endDate}, Israel time (22:00 UTC on {lastDayShort}). A paid plan starts only if you choose to buy one.",
    ctaOpen: "Request free Early Access",
    ctaAnnounce: "Early Access opens soon",
  },
  // The explanation block on the Pricing page (#early-access) and its short form on Home and in the Pricing hero.
  section: {
    title: "Early Access: free until {lastDay}",
    lead: "Use the full product on your WooCommerce store at no cost until {lastDay}. Access ends at 00:00 on {endDate}, Israel time (22:00 UTC on {lastDay}). If you want to continue, you choose a paid plan. Nothing is charged automatically.",
    homeLead: "During Early Access every plan is free for approved stores until {lastDay}, Israel time. Access ends on {endDate}, and a paid plan starts only if you choose to buy one.",
    link: "How Early Access works",
    stepsLabel: "How Early Access works",
    steps: {
      request: { title: "Request access", body: "Ask for Early Access for your WooCommerce store. No credit card is needed. We review each request." },
      use: { title: "Use everything", body: "Connect your store and use the full product until {lastDay}." },
      decide: { title: "Decide at the end", body: "At 00:00 on {endDate}, Israel time, access ends and your store keeps selling as usual. To continue you buy the plan your store holds at that time, once purchases open; if you do not, nothing is charged." },
    },
    whoTitle: "Who it is for",
    who: {
      a: "WooCommerce stores that can connect to AICC (WordPress 6.0, WooCommerce 7.0 and PHP 7.4 or newer).",
      b: "Every approved store ends at the same moment, 00:00 on {endDate}, Israel time, whatever day it joined.",
      c: "One Early Access per account, and we check that a store does not receive it twice. Store limits follow the plan you ask for: Solo 1 store, Studio up to 3, Agency up to 10. Ask for the plan you would want to keep: continuing is simplest on the plan your store holds at the end, and before the end you can ask us to change it (see the questions below).",
      d: "We review each request and not every request will be approved. Early Access can close to new requests at any time, and it is not granted in the final 24 hours before it ends.",
    },
    endTitle: "What happens on {endDate}",
    end: {
      a: "AICC stops showing on your storefront. Your store, orders and checkout carry on as usual.",
      b: "Your AICC data is kept under the retention rules on the Data & Trust page, not deleted on that day.",
      c: "Once purchases open, to continue you buy the plan your store holds at that time, and your connected store picks up the new end date. We explain the steps before you buy. There is no automatic conversion and no automatic charge.",
    },
    terms: "Early Access is the same product as the paid plans. The end date, the absence of automatic charges and the data handling described on this page are part of this offer; the Terms, Privacy and Refund pages describe the rest. Questions? Write to {contactEmail}.",
    // Permanent, in EVERY build (the initial terms already say an extension is possible, so an extension is never a silent change): same text in the terms line and in the questions.
    reservation: "If we extend Early Access, we do it for every Early Access store at once and we say so on this page before the end date; where we can, we also tell you by e-mail. An extension never starts a charge. We cannot extend a single store's access.",
    faqTitle: "Early Access questions",
    faq: {
      free: { q: "Is Early Access really free?", a: "Yes, for approved stores until {lastDay}. We do not ask for payment details, and nothing is charged." },
      end: { q: "What happens on {endDate}?", a: "Access ends for every Early Access store at the same moment, 00:00 Israel time. AICC stops showing on your storefront and your store keeps working as usual. To continue, you buy a plan once purchases open." },
      auto: { q: "Will I be charged automatically?", a: "No. There is no card on file, no automatic renewal and no automatic switch to a paid plan." },
      continue: { q: "How do I continue after Early Access?", a: "You buy the plan your store holds at that time, once purchases open. Your connected store picks up the new end date. To hold a different plan, ask us before Early Access ends (see \"Can I change my plan?\")." },
      change: { q: "Can I change my plan?", a: "Yes, before Early Access ends. Write to {contactEmail} from your account's e-mail address and we change the plan of your Early Access store at no charge. The end date stays the same. Store limits follow the plan, so a smaller plan needs fewer connected stores. To continue after Early Access you buy the plan your store holds at that time, once purchases open." },
      extension: { q: "Could Early Access be extended?", a: "If we extend Early Access, we do it for every Early Access store at once and we say so on this page before the end date; where we can, we also tell you by e-mail. An extension never starts a charge. We cannot extend a single store's access." },
      guarantee: { q: "Does the money-back guarantee apply to Early Access?", a: "No. The 14-day money-back guarantee applies to eligible paid purchases, as set out in the [Refund Policy](route:refund-policy), not to free Early Access. No payment is taken during Early Access, so there is nothing to refund. When purchases open, the [Refund Policy](route:refund-policy) applies to eligible paid purchases." },
      plugin: { q: "What will I see in the plugin when Early Access ends?", a: "At 00:00 on {endDate} (Israel time) the plugin shows that your plan has expired, with a \"Renew plan\" button, and AICC stops showing on your storefront. Your store keeps selling as usual. The plugin does not warn you beforehand, so note the date; your account page shows it too." },
    },
  },
};

export type EaDict = typeof eaEn;
