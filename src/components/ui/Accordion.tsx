import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface AccordionItem {
  id: string;
  question: ReactNode;
  answer: ReactNode;
  /** Text is English on a page of another language: marked lang="en" dir="ltr" and tagged. */
  fallback?: boolean;
  /** Language and direction of this item's own text (set on every item of a non-English page; a translated item inside an English block must reset the language). */
  lang?: string;
  dir?: "ltr" | "rtl";
  /** Retired ids that resolve to this item (rendered as plain anchors before it, and resolved by FaqHash). */
  aliases?: string[];
  tag?: string;
}

/**
 * Accordion built on native <details>/<summary>: keyboard (Enter/Space), expanded state and find-in-page work with
 * no JavaScript. Answers are in the DOM so the same Q&As can be described in FAQPage JSON-LD. Every item has a stable anchor (its id).
 */
export function Accordion({ items, className }: { items: AccordionItem[]; className?: string }) {
  return (
    <div className={`aicc-accordion ${className ?? ""}`}>
      {items.map((it) => (
        <div key={it.id} className="aicc-accordion__item">
          {(it.aliases ?? []).map((a) => <span key={a} id={a} className="aicc-anchor" />)}
          <details id={it.id} data-aliases={it.aliases?.join(" ") || undefined}>
            <summary>
              <span {...(it.fallback ? { lang: "en", dir: "ltr" as const, "data-needs-translation": it.id } : it.lang ? { lang: it.lang, dir: it.dir } : {})}>
                {it.question}
                {it.fallback && it.tag ? <span className="aicc-fallbacktag" aria-hidden="true" lang={it.lang} dir={it.dir}>{it.tag}</span> : null}
              </span>
              <ChevronDown size={22} aria-hidden="true" />
            </summary>
            <div className="aicc-accordion__body" {...(it.fallback ? { lang: "en", dir: "ltr" as const } : it.lang ? { lang: it.lang, dir: it.dir } : {})}>{it.answer}</div>
          </details>
        </div>
      ))}
    </div>
  );
}
