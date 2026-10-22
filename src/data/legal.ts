/**
 * Structure of every legal / trust document, plus its review flags.
 * Text lives in each locale dictionary at legal.<doc>.s.<sectionId>.<blockId>; a block is a paragraph (string)
 * or, when `list: true`, a bullet list (string[]).
 *
 * legalReview: true  -> wording touches rights, retention, refunds, privacy or conformance; rendered with the
 *                       "Draft - pending legal review" notice unless NEXT_PUBLIC_LEGAL_DRAFT_NOTICE === "off".
 * translationReview  -> non-English legal text is a draft translation and needs native legal review.
 */
import type { Locale } from "@/i18n/config";

export interface LegalBlock {
  id: string;
  list?: boolean;
  legalReview?: boolean;
}
export interface LegalSection {
  id: string;
  blocks: LegalBlock[];
}
export type LegalDocId = "privacy" | "terms" | "refund" | "dataTrust" | "accessibility";

const p = (id: string, legalReview = false): LegalBlock => ({ id, ...(legalReview ? { legalReview: true } : {}) });
const ul = (id: string, legalReview = false): LegalBlock => ({ id, list: true, ...(legalReview ? { legalReview: true } : {}) });
const s = (id: string, ...blocks: LegalBlock[]): LegalSection => ({ id, blocks });

export const LEGAL_DOCS: Record<LegalDocId, { sections: LegalSection[] }> = {
  privacy: {
    sections: [
      s("who", p("a", true), p("b")),
      s("website", p("a", true), p("b", true)),
      s("account", p("a"), p("b", true)),
      s("storeData", p("a"), ul("b", true), p("c", true), ul("d", true), p("e", true)),
      s("cookies", p("a"), ul("b", true), p("c", true)),
      s("use", ul("a")),
      s("separate", p("a")),
      s("retention", p("a", true), p("b", true), p("c", true), p("d", true)),
      s("requests", p("a", true)),
      s("security", p("a", true)),
      s("transfers", p("a", true)),
      s("rights", p("a", true)),
      s("changes", p("a"), p("b")),
    ],
  },
  terms: {
    sections: [
      s("agreement", p("a", true), p("b", true)),
      s("service", p("a"), p("b")),
      s("account", p("a")),
      s("plans", p("a"), ul("b"), p("c")),
      s("fees", p("a", true), p("b", true)),
      s("refunds", p("a", true)),
      s("yourStore", p("a", true), p("b", true)),
      s("outcomes", p("a", true)),
      s("availability", p("a", true), p("b")),
      s("inactive", p("a", true), p("b", true)),
      s("changes", p("a", true)),
      s("liability", p("a", true), p("b", true)),
      s("law", p("a", true)),
      s("contact", p("a")),
    ],
  },
  refund: {
    sections: [
      s("guarantee", p("a", true), p("b", true)),
      s("start", p("a", true)),
      s("renewals", p("a", true)),
      s("duplicate", p("a", true)),
      s("how", p("a", true), p("b", true)),
      s("exceptions", ul("a", true)),
      s("after", p("a", true), p("b")),
      s("data", p("a", true), p("b", true), p("c", true), p("d", true)),
      s("nothingElse", p("a", true), p("b", true)),
      s("rights", p("a", true)),
    ],
  },
  dataTrust: {
    sections: [
      s("reads", p("a"), ul("b", true)),
      s("never", ul("a", true)),
      s("cookies", p("a", true), ul("b"), p("c", true), ul("d", true)),
      s("apart", p("a")),
      s("woo", p("a")),
      s("outage", p("a"), ul("b", true)),
      s("retention", p("a", true), p("b", true), p("c")),
      s("requests", p("a", true)),
      s("pending", p("a")),
    ],
  },
  accessibility: {
    sections: [
      s("commitment", p("a")),
      s("target", p("a", true)),
      s("done", ul("a")),
      s("limits", ul("a")),
      s("report", p("a")),
      s("review", p("a")),
      s("jurisdiction", p("a", true)),
    ],
  },
};

/** Per-locale status of the legal text. English is the source draft; the rest are drafts of it. */
export const TRANSLATION_REVIEW: Record<Locale, "source-draft-pending-legal-review" | "native-legal-review-required"> = {
  en: "source-draft-pending-legal-review",
  he: "native-legal-review-required",
  es: "native-legal-review-required",
  ru: "native-legal-review-required",
};

/**
 * Marketing copy that is not on a legal page but states something with legal weight (retention, refund, privacy facts).
 * Not rendered with a draft pill (marketing cards stay clean); `npm run launch:check` lists them so a person with legal
 * authority approves them together with the legal pages before launch.
 */
export const LEGAL_REVIEW_KEYS = [
  "home.final.guarantee",
  "home.pricing.confidence.guarantee",
  "pricing.terms.try.body",
  "pricing.terms.renewal.body",
  "pricing.terms.back.body",
  "product.history.p3",
  "product.measure.consent",
  "common.plan.guarantee",
  "common.plan.renewal",
] as const;
