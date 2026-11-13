/**
 * Launch offer campaign copy, English (the contract for ea/he.ts, ea/es.ts, ea/ru.ts).
 * Published only by a campaign build (src/lib/earlyAccess.ts, NEXT_PUBLIC_AICC_EARLY_ACCESS=announce|open); a normal build never renders any of it.
 * P32: the public name of the offer is "launch offer" in all four languages. The older word "Early Access" is NOT used anywhere in this pack (P35: the live Terms and Privacy pages do not use it; ea:check enforces it); so a visitor never meets three names for one thing. The word "trial" stays banned by the copy rules.
 *
 * WHY THIS FILE IS SEPARATE: `npm run copy:check` bans "free", "no credit card" and similar claims everywhere because no free flow existed. The owner has since decided one
 * (free until 31 December 2026, fixed end, an explicit renewal decision to continue). Those words are now allowed ONLY in this folder, under a stricter rule set
 * (`scripts/lib/early-access-truth.mjs`): the disclosures below must be present, and "trial", "subscription", "auto-renew", urgency tricks and percent claims stay banned.
 *
 * Every sentence states a fact that is true of the designed flow: no payment details are asked for, nothing converts or bills by itself, the end date is the same for
 * everyone, paid purchases are not open, and nothing promises that a paid plan will be available in 2027. Do not add a claim here before the Control Plane behaviour it describes is built and tested.
 * Dates are written out in words on purpose: the same instant is 2027-01-01 00:00 in Israel (UTC+2), which is why the last day is 31 December 2026 and access ends 1 January 2027.
 * The dates are TOKENS ({lastDay}, {lastDayShort}, {endDate}, {firstLastDay}), resolved per extension step (0 = initial end, 1, 2) from src/i18n/eaTokens.ts. There is ONE copy set;
 * an extended build says the new dates in the same sentences and adds `extended.*`. `reservation` is permanent and step-independent.
 */
export const eaEn = {
  // The public name of the offer, used by tests to prove that every surface in every language names it the same way.
  offerName: "Launch offer",
  meta: {
    pricingDescription: "Every plan has the full AICC product. Regular prices: Solo {priceSolo}, Studio {priceStudio}, Agency {priceAgency} per year, priced by store count. No automatic renewal.",
  },
  // The slim announcement bar under the header, on every page. P34 (owner wording): one short line. The bar names the last day only; its link leads to the explanation, and the plan
  // cards and the explanation state the exact end instant (00:00 on {endDate}, Israel time = 22:00 UTC on {lastDayShort}) and that requests are reviewed.
  bar: {
    label: "Launch offer announcement",
    live: "Launch Offer: Free for approved stores until {lastDay}",
    announce: "Launch Offer coming soon: Free for approved stores until {lastDay}",
    link: "How it works",
  },
  // Only an EXTENDED build: the bar line (OPEN mode) and one short paragraph in the explanation. Both name the clock, say that payment details are not taken and that nothing converts or is charged by itself.
  extended: {
    bar: "The launch offer has been extended for every store: free until {lastDay}, Israel time.",
    barAnnounce: "Launch offer coming soon and its end date has moved: free for approved stores until {lastDay}, Israel time.",
    noteAnnounce: "The launch offer was first announced to end on {firstLastDay}, Israel time. The end date has moved. Nothing can be requested yet, no payment is taken and nothing converts or is charged automatically.",
    barClosed: "The launch offer has been extended for every store already in it: free until {lastDay}, Israel time. New requests closed at the original end date.",
    closedNote: "New requests closed at the original end date. The extension is for stores that were already in the launch offer.",
    note: "The launch offer was first announced to end on {firstLastDay}, Israel time. We extended it for every launch-offer store. Nothing else changed: no payment is taken and nothing converts or is charged automatically.",
  },
  // Shown INSTEAD of the offer once the end date has passed (set by the page script; see EA_HEAD_SCRIPT).
  after: {
    title: "The launch offer has ended.",
    body: "The launch offer ended on {endDate}, at 00:00 Israel time. Continued service needs an explicit renewal decision, and paid purchases are not open yet. Nothing is charged automatically.",
    cta: "See the plans",
  },
  // The Home hero in a campaign build. P34 (owner request): the pill reads [badgeTag] badge; under the buttons there are only the short support lines below (never a paragraph or a
  // disclaimer: the full facts are on the cards, in the bar link and in the explanation).
  hero: {
    badgeTag: "Launch Offer",
    badgeTagAnnounce: "Launch Offer coming soon",
    // the pill is not next to the cards, so it carries the approved-stores qualifier itself (review P34-4)
    badge: "Free for approved stores until {lastDay}",
    ctaOpen: "Request Free Access",
    ctaAnnounce: "Free access requests open soon",
    supportLabel: "Launch offer at a glance",
    support: {
      noCard: "No credit card required",
      // true: nothing renews or is charged by itself; continuing needs the merchant's explicit renewal decision
      manual: "Manual renewal only",
      // rendered ONLY with NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on (owner attestation required by launch:check): each request is reviewed, approvals are capped, the offer can close at any time
      limited: "Limited availability",
    },
  },
  // The header button while the offer is live (the ordinary "Get started" returns after the end date).
  header: { cta: "Request Free Access" },
  plan: {
    // the small label on every plan card (P34)
    pill: "Launch Offer",
    free: "Free until {lastDay}, Israel time",
    // review P34-5: "planned", because no plan has ever been sold or charged at this price
    regular: "Planned regular price, not charged during the launch offer:",
    // Used when the strike-through is off (the default): the regular price as a plain fact, never as a reduction.
    planned: "Planned regular price:",
    regularPer: "a year",
    approved: "Available to approved stores",
    noCard: "No credit card required",
    noAuto: "No automatic renewal",
    term: "Launch offer term: until {lastDay}, Israel time",
    ends: "Access ends at 00:00 on {endDate}, Israel time (22:00 UTC on {lastDayShort}).",
    ctaOpen: "Request Free Access",
    ctaAnnounce: "Free access requests open soon",
    ctaClosed: "New requests are closed",
  },
  // The terms that apply to every plan, said once under the plan cards (Pricing) so the cards stay short.
  pricing: {
    note: "Paid purchases are not open yet. Accounts are created for approved launch-offer requests.",
    decision: "After the offer ends, continued service requires an explicit renewal decision.",
    notOpen: "Paid purchases are not currently open.",
    label: "Launch offer terms",
    // P34 (owner list): three short lines right under the plan cards, on Home and on Pricing
    support: {
      noCard: "No credit card required during the launch offer",
      manual: "Manual renewal only",
      regular: "Regular pricing applies once purchases open",
    },
  },
  // The explanation block on the Pricing page (#early-access) and its short form on Home and in the Pricing hero.
  section: {
    title: "Launch offer: free until {lastDay}, Israel time",
    lead: "Use the full product on your WooCommerce store at no cost until {lastDay}. Access ends at 00:00 on {endDate}, Israel time (22:00 UTC on {lastDay}). Continued service after that needs your explicit renewal decision. Nothing is charged automatically.",
    leadAnnounce: "When requests open, approved stores can use the full product on their WooCommerce store at no cost until {lastDay}. Access will end at 00:00 on {endDate}, Israel time (22:00 UTC on {lastDay}). Continued service after that will need your explicit renewal decision. Nothing is charged automatically.",
    homeLead: "During the launch offer every plan is free for approved stores until {lastDay}, Israel time. Access ends on {endDate}, and continued service after that needs your explicit renewal decision.",
    homeLeadAnnounce: "The launch offer is coming soon: every plan will be free for approved stores until {lastDay}, Israel time. Requests are not open yet. Access will end on {endDate}, and continued service after that will need your explicit renewal decision.",
    homeLeadClosed: "The launch offer has been extended for stores already in it: every plan is free until {lastDay}, Israel time. Access ends on {endDate}, and continued service after that needs your explicit renewal decision. New requests closed at the original end date.",
    intakeCutoff: "Requests close 24 hours before it ends.",
    intakeCutoffExt: "Requests close 24 hours before the original end date.",
    link: "How the launch offer works",
    stepsLabel: "How the launch offer works",
    steps: {
      request: { title: "Request access", body: "Ask for free access for your WooCommerce store. No credit card is needed. We review each request." },
      requestAnnounce: { title: "Requests open soon", body: "Free access requests are not open yet. When they open, you ask for access for your WooCommerce store. No credit card is needed. We review each request." },
      requestClosed: { title: "New requests are closed", body: "Requests closed at the original end date. Stores already in the launch offer keep access until {lastDay}, Israel time." },
      use: { title: "Use everything", body: "Connect your store and use the full product until {lastDay}, Israel time." },
      useAnnounce: { title: "Use everything", body: "Once approved, connect your store and use the full product until {lastDay}, Israel time." },
      decide: { title: "Decide at the end", body: "At 00:00 on {endDate}, Israel time, access ends and your store keeps selling as usual. Continued service needs your explicit renewal decision, and paid purchases are not open yet. Nothing is charged automatically." },
    },
    whoTitle: "Who it is for",
    who: {
      a: "WooCommerce stores that can connect to AICC (WordPress 6.0, WooCommerce 7.0 and PHP 7.4 or newer).",
      b: "Every approved store ends at the same moment, 00:00 on {endDate}, Israel time, whatever day it joined.",
      c: "One launch offer per account, and we may check that a store does not receive it twice. Store limits follow the plan you ask for: Solo 1 store, Studio up to 3, Agency up to 10. Before the end you can ask us to change the plan (see the questions below).",
      d: "We review each request and not every request will be approved. The launch offer can close to new requests at any time, and it is not granted in the final 24 hours before it ends.",
      dExtended: "We review each request and not every request will be approved. The launch offer can close to new requests at any time. It is not granted in the final 24 hours before the original end date, and new requests are closed from that date.",
      cClosed: "Store limits follow the plan: Solo 1 store, Studio up to 3, Agency up to 10. Before the end you can ask us to change the plan (see the questions below).",
      dClosed: "New requests are closed. The launch offer is no longer open to new stores.",
    },
    endTitle: "What happens on {endDate}",
    end: {
      a: "AICC stops showing on your storefront. Your store, orders and checkout carry on as usual.",
      b: "Your AICC data is kept under the retention rules on the Data & Trust page, not deleted on that day.",
      c: "Continued service after that date needs your explicit renewal decision. Paid purchases are not open yet, and we explain the steps before anything can be bought. There is no automatic conversion and no automatic charge.",
    },
    terms: "The launch offer is the same product as the paid plans. The end date, the absence of automatic charges and the data handling described on this page are part of this offer; the Terms, Privacy and Refund pages describe the rest. Requests close 24 hours before the offer ends. Questions? Write to {contactEmail}.",
    notice: "When you ask for the launch offer we use your e-mail address, store address and chosen plan to review the request and contact you about it. Giving them is voluntary; without them we cannot review your request. The operator named in the [privacy policy](route:privacy) keeps them as described there. You can ask to see or correct them.",
    // Permanent, in EVERY build (the initial terms already say an extension is possible, so an extension is never a silent change): same text in the terms line and in the questions.
    reservation: "If we extend the launch offer, we do it for every launch-offer store at once and we say so on this page before the end date; where we can, we also tell you by e-mail. An extension never starts a charge. We cannot extend a single store's access.",
    faqTitle: "Launch offer questions",
    faq: {
      free: { q: "Is the launch offer really free?", a: "Yes, for approved stores until {lastDay}, Israel time. We do not ask for payment details, and nothing is charged.", aAnnounce: "Yes, once requests open: approved stores will have access at no cost until {lastDay}, Israel time. We do not ask for payment details, and nothing is charged." },
      eligible: { q: "Who can get free access?", a: "A live WooCommerce store that you operate. We review each request, and not every request will be approved." },
      end: { q: "What happens on {endDate}?", a: "Access ends for every launch-offer store at the same moment, 00:00 Israel time. AICC stops showing on your storefront and your store keeps working as usual. Continued service needs your explicit renewal decision, and paid purchases are not open yet." },
      auto: { q: "Will I be charged automatically?", a: "No. There is no card on file, no automatic renewal and no automatic switch to a paid plan." },
      continue: { q: "How do I continue after the launch offer?", a: "After the offer ends, continued service requires an explicit renewal decision from you. Paid purchases are not open yet, so there is nothing to buy today, and we explain the steps before anything can be bought. To hold a different plan, ask us before the launch offer ends (see \"Can I change my plan?\")." },
      change: { q: "Can I change my plan?", a: "Yes, before the launch offer ends. Write to {contactEmail} from your account's e-mail address and we change the plan of your launch-offer store at no charge. The end date stays the same. Store limits follow the plan, so a smaller plan needs fewer connected stores." },
      extension: { q: "Could the launch offer be extended?", a: "If we extend the launch offer, we do it for every launch-offer store at once and we say so on this page before the end date; where we can, we also tell you by e-mail. An extension never starts a charge. We cannot extend a single store's access." },
      guarantee: { q: "Does the money-back guarantee apply to the launch offer?", a: "No. The 14-day money-back guarantee applies only to eligible paid purchases, as set out in the [Refund Policy](route:refund-policy), not to the free launch offer. No payment is taken during the launch offer, so there is nothing to refund. When paid purchases open, the [Refund Policy](route:refund-policy) applies to eligible paid purchases." },
      plugin: { q: "What will I see in the plugin when the launch offer ends?", a: "At 00:00 on {endDate} (Israel time) the plugin shows that your plan has expired, with a \"Renew plan\" button, and AICC stops showing on your storefront. Your store keeps selling as usual. The plugin does not warn you beforehand, so note the date; your account page shows it too." },
    },
  },
  // The request pages (/request-access/ and /request-access/confirm/). They exist only in an OPEN build and talk only to the Control Plane routes of the intake contract.
  // Every message is generic on purpose: the page never says whether an address, a store or a request exists.
  request: {
    verifyBanner: "Verification page, not public",
    pageTitle: "Request free access",
    title: "Request free access",
    lead: "Tell us about your WooCommerce store. The launch offer is free for approved stores until {lastDay}, Israel time. We review each request, and nothing is granted automatically.",
    checking: "Checking whether requests are open...",
    closedTitle: "Requests are not open at the moment",
    closedBody: "Requests are not open at the moment. Please come back later.",
    formLabel: "Request free access",
    email: "Work e-mail",
    emailHint: "We send one confirmation link to this address.",
    store: "Store address",
    storeHint: "The https address of your WooCommerce store",
    plan: "Plan you would like",
    operator: "This is a live WooCommerce store I operate",
    consent: "I accept the [Terms](route:terms) and have read the [Privacy Policy](route:privacy)",
    submit: "Request Free Access",
    sending: "Sending...",
    success: "If the details look valid, we sent a confirmation link to that address.",
    successHint: "Open the link from your e-mail to confirm. We review each confirmed request, and nothing is granted automatically.",
    errorGeneric: "We could not send your request. Please check the details and try again later.",
    errorBusy: "Too many requests right now. Please try again later.",
    errorBot: "We could not complete the bot check. Please try again.",
    errorTooBig: "Some details are too long to send. Please shorten them and try again.",
    retry: "Try again",
    errorNetwork: "We could not reach the server. Please check your connection and try again.",
    fieldRequired: "This field is required.",
    emailInvalid: "Enter a valid e-mail address.",
    storeInvalid: "Enter the https address of your store.",
    checkRequired: "Please tick this box to continue.",
    summary: "Please fix the fields marked below.",
    botLabel: "Bot check",
    botFailed: "The bot check could not load. Reload the page and try again.",
    // The processors named next to the form. {mailProvider} is the e-mail delivery provider, a build-time value the owner supplies (launch:check blocks an open build until it is real).
    notice: "Privacy: we use your e-mail address, store address and chosen plan only to confirm and review your request and to contact you about it. To limit abuse we keep short-lived counters keyed by a hash of your connection. To protect this form from bots we use Cloudflare Turnstile, which runs in your browser and may process technical data such as your IP address and browser details. The confirmation e-mail is delivered by {mailProvider}. Read the [Privacy Policy](route:privacy) for the details.",
    noticeLabel: "Privacy notice",
    confirm: {
      pageTitle: "Confirm your request",
      title: "Confirm your request",
      lead: "Press the button to confirm your e-mail address.",
      button: "Confirm",
      working: "Confirming...",
      outcome: "Thank you. If the link was valid, your e-mail address is confirmed and your request is in review. If it was not valid or has expired, nothing changed.",
      error: "We could not reach the server. Please check your connection and try again.",
      unavailable: "This is temporarily unavailable. Please try again later.",
      noLink: "This page needs the link from your confirmation e-mail. Open that link again.",
    },
  },
};

export type EaDict = typeof eaEn;
