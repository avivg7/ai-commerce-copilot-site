import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface AccordionItem {
  id: string;
  question: ReactNode;
  answer: ReactNode;
}

/**
 * Accordion built on native <details>/<summary>: keyboard (Enter/Space), expanded state and find-in-page work with
 * no JavaScript. Answers are in the DOM so the same Q&As can be described in FAQPage JSON-LD.
 */
export function Accordion({ items, className }: { items: AccordionItem[]; className?: string }) {
  return (
    <div className={`aicc-accordion ${className ?? ""}`}>
      {items.map((it) => (
        <details key={it.id} id={it.id}>
          <summary>
            <span>{it.question}</span>
            <ChevronDown size={22} aria-hidden="true" />
          </summary>
          <div className="aicc-accordion__body">{it.answer}</div>
        </details>
      ))}
    </div>
  );
}
