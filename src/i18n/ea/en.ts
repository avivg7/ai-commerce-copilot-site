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
 */
export const eaEn = {
  // The slim announcement bar above the header, on every page.
  bar: {
    label: "Early Access announcement",
    live: "Early Access: AICC is free until December 31, 2026.",
    announce: "Early Access is coming: AICC will be free until December 31, 2026.",
    link: "How it works",
  },
  // Shown INSTEAD of the offer once the end date has passed (set by the page script; see EA_HEAD_SCRIPT).
  after: {
    title: "Early Access has ended.",
    body: "Early Access ended on January 1, 2027. To use AICC from here on, you choose a plan. Nothing is charged automatically.",
    cta: "See the plans",
  },
  hero: {
    ctaOpen: "Get free Early Access",
    ctaAnnounce: "How Early Access works",
    note: "No credit card required. Access ends on January 1, 2027, and nothing is charged automatically.",
  },
  plan: {
    free: "Free until December 31, 2026",
    regular: "Regular price",
    regularPer: "a year",
    regularNote: "not charged during Early Access",
    ends: "Access ends on January 1, 2027. A paid plan starts only if you choose to buy one.",
    ctaOpen: "Get free Early Access",
    ctaAnnounce: "Early Access opens soon",
  },
  // The explanation block on the Pricing page (#early-access) and its short form on Home.
  section: {
    title: "Early Access: free until the end of 2026",
    lead: "Use the full product on your WooCommerce store at no cost until December 31, 2026. On January 1, 2027 access ends. If you want to continue, you choose a paid plan. Nothing is charged automatically.",
    homeLead: "Every plan is free until December 31, 2026 during Early Access. Access ends on January 1, 2027, and a paid plan starts only if you choose to buy one.",
    link: "How Early Access works",
    stepsLabel: "How Early Access works",
    steps: {
      request: { title: "Request access", body: "Ask for Early Access for your WooCommerce store. No credit card is needed." },
      use: { title: "Use everything", body: "Connect your store and use the full product until December 31, 2026." },
      decide: { title: "Decide at the end", body: "On January 1, 2027 access ends and your store keeps selling as usual. To continue you choose a plan; if you do not, nothing is charged." },
    },
    whoTitle: "Who it is for",
    who: {
      a: "WooCommerce stores that can connect to AICC (WordPress 6.0, WooCommerce 7.0 and PHP 7.4 or newer).",
      b: "Every approved store ends on the same day, January 1, 2027, whatever day it joined.",
      c: "One Early Access per store and per account. Store limits follow the plan you ask for: Solo 1 store, Studio up to 3, Agency up to 10.",
      d: "We approve each request, and Early Access can close to new requests at any time.",
    },
    endTitle: "What happens on January 1, 2027",
    end: {
      a: "AICC stops showing on your storefront. Your store, orders and checkout carry on as usual.",
      b: "Your AICC data is kept under the retention rules on the Data & Trust page, not deleted on that day.",
      c: "To continue you choose and buy a plan yourself. There is no automatic conversion and no automatic charge.",
    },
    terms: "Early Access is the same product as the paid plans. Support is by e-mail at {contactEmail}. The terms, privacy and refund pages apply; the end date, the absence of automatic charges and the data handling above are part of the offer.",
    faqTitle: "Early Access questions",
    faq: {
      free: { q: "Is Early Access really free?", a: "Yes, until December 31, 2026. We do not ask for payment details, and nothing is charged." },
      end: { q: "What happens on January 1, 2027?", a: "Access ends for every Early Access store at the same time. AICC stops showing on your storefront and your store keeps working as usual. To continue, you choose and buy a plan." },
      auto: { q: "Will I be charged automatically?", a: "No. There is no card on file, no automatic renewal and no automatic switch to a paid plan." },
      continue: { q: "How do I continue after Early Access?", a: "You choose a plan and buy it when purchases are open. We explain the steps before you buy, including what happens to your connected store." },
    },
  },
};

export type EaDict = typeof eaEn;
