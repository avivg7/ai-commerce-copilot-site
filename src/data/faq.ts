/**
 * FAQ structure. The question/answer TEXT lives in each locale dictionary under faq.items[id];
 * only structure and review flags live here, so flags cannot drift between languages.
 */
export const FAQ_TOPICS = ["basics", "plans", "billing", "refunds", "pause", "data", "reliability"] as const;
export type FaqTopic = (typeof FAQ_TOPICS)[number];

export interface FaqMeta {
  id: string;
  topic: FaqTopic;
  /** Wording touches rights, retention, refunds or privacy: shows the draft notice until a person with legal authority approves it. */
  legalReview?: boolean;
}

const q = (n: number, topic: FaqTopic, legalReview = false): FaqMeta => ({
  id: `q${String(n).padStart(2, "0")}`,
  topic,
  ...(legalReview ? { legalReview: true } : {}),
});

export const FAQ: readonly FaqMeta[] = [
  q(1, "basics"), q(2, "basics"), q(3, "basics"), q(4, "reliability"), q(5, "reliability"),
  q(6, "basics"), q(7, "basics"), q(8, "plans"), q(9, "plans"), q(10, "plans"),
  q(11, "plans"), q(12, "plans"), q(13, "plans"), q(14, "plans"), q(15, "pause", true),
  q(16, "pause"), q(17, "billing"), q(18, "billing"), q(19, "billing"), q(20, "billing"),
  q(21, "pause", true), q(22, "pause"), q(23, "pause", true), q(24, "pause"), q(25, "pause"),
  q(26, "refunds", true), q(27, "refunds"), q(28, "refunds"), q(29, "refunds"), q(30, "refunds"),
  q(31, "basics"), q(32, "basics"), q(33, "data", true), q(34, "data"), q(35, "data"),
  q(36, "data", true), q(37, "basics"), q(38, "basics"), q(39, "reliability"), q(40, "reliability"),
];

export const faqById = (id: string) => FAQ.find((f) => f.id === id)!;

/** Which questions each page shows. Only these Q&As are visible there, and only these go in that page's FAQPage JSON-LD. */
export const FAQ_SELECTION = {
  home: ["q01", "q02", "q04", "q06", "q09", "q18", "q22", "q26"],
  pricing: ["q09", "q10", "q12", "q13", "q18", "q19", "q20", "q26", "q27", "q28"],
  product: ["q01", "q02", "q31", "q33", "q37", "q38", "q39"],
  questions: FAQ.map((f) => f.id),
} as const;

export type FaqPageKey = keyof typeof FAQ_SELECTION;
