/**
 * FAQ: structure, text and per-page selections come from the shared content pack in brand/content/ (one file for the marketing site
 * AND the Control Plane). Nothing about a question lives in the locale dictionaries any more.
 *   brand/content/faq.en.json   canonical English (schema 2): layers, 8 topics, "most asked before buying", per-page selections, retired ids, every active question
 *   brand/content/faq.<l>.json  translations: ONLY q/a per id, plus reviewStatus and optional layer/topic titles.
 * A question that has no translation (or whose English meaning changed since it was translated) is shown in English with
 * lang="en" dir="ltr" and counted as needing translation. See brand/content/README.md.
 */
import type { Locale } from "@/i18n/config";
import faqEn from "../../brand/content/faq.en.json";
import faqHe from "../../brand/content/faq.he.json";
import faqEs from "../../brand/content/faq.es.json";
import faqRu from "../../brand/content/faq.ru.json";

export interface FaqPack {
  schema: number;
  locale: string;
  reviewStatus?: string;
  titles?: { layers?: Record<string, string>; topics?: Record<string, string> };
  items: Record<string, { q: string; a: string }>;
}

const TRANSLATIONS: Record<Exclude<Locale, "en">, FaqPack> = { he: faqHe as FaqPack, es: faqEs as FaqPack, ru: faqRu as FaqPack };

export const FAQ_LAYERS = faqEn.layers as readonly { id: string; title: string }[];
export const FAQ_TOPICS = faqEn.topics as readonly { id: string; title: string }[];
export type FaqLayer = (typeof faqEn.layers)[number]["id"];
export type FaqTopic = (typeof faqEn.topics)[number]["id"];
/** "Most asked before buying": the questions a buyer reads first (owner-curated order). */
export const FAQ_MOST_ASKED = (faqEn as unknown as { mostAskedBeforeBuying: string[] }).mostAskedBeforeBuying as readonly string[];
export const FAQ_RETIRED = faqEn.retired as Record<string, { mergedInto: string; reason: string }>;

export interface FaqMeta {
  id: string;
  layer: string;
  topic: string;
  /** Wording touches rights, retention, refunds or privacy: stays out of FAQPage JSON-LD until a person with legal authority approves it. */
  legalReview?: boolean;
}

const EN_ITEMS = faqEn.items as Record<string, { layer: string; topic: string; q: string; a: string; legalReview?: boolean }>;

/** Active questions in canonical order (layer, then topic order, then the order they appear in the pack). */
export const FAQ: readonly FaqMeta[] = Object.entries(EN_ITEMS).map(([id, it]) => ({
  id, layer: it.layer, topic: it.topic, ...(it.legalReview ? { legalReview: true } : {}),
}));

export const faqById = (id: string) => FAQ.find((f) => f.id === id)!;

/** Which questions each page shows. Only these Q&As are visible there, and only these go in that page's FAQPage JSON-LD. */
const SEL = faqEn.selection as unknown as Record<string, string[] | "all">;
export type FaqPageKey = "home" | "product" | "pricing" | "questions";
export function faqSelection(page: FaqPageKey): readonly string[] {
  const s = SEL[page];
  return s === "all" ? FAQ.map((f) => f.id) : s;
}

export interface FaqText { q: string; a: string; fallback: boolean }
/** Question and answer in the page language, or the English text flagged as fallback. */
export function faqText(locale: Locale, id: string): FaqText {
  const en = EN_ITEMS[id];
  if (locale === "en") return { q: en.q, a: en.a, fallback: false };
  const tr = TRANSLATIONS[locale].items[id];
  return tr ? { q: tr.q, a: tr.a, fallback: false } : { q: en.q, a: en.a, fallback: true };
}

export function faqTitle(locale: Locale, kind: "layers" | "topics", id: string): { title: string; fallback: boolean } {
  const en = (kind === "layers" ? FAQ_LAYERS : FAQ_TOPICS).find((x) => x.id === id)!.title;
  if (locale === "en") return { title: en, fallback: false };
  const tr = TRANSLATIONS[locale].titles?.[kind]?.[id];
  return tr ? { title: tr, fallback: false } : { title: en, fallback: true };
}

/** Number of questions per locale that still need translation (used by tests and docs). */
export function faqFallbackIds(locale: Locale): string[] {
  return FAQ.filter((f) => faqText(locale, f.id).fallback).map((f) => f.id);
}
