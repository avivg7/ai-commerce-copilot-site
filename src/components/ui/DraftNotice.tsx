import { PencilLine } from "lucide-react";
import { LEGAL_DRAFT_NOTICE } from "@/lib/site";

/** "Draft: pending legal review". Renders only when NEXT_PUBLIC_LEGAL_DRAFT_NOTICE !== "off" (default: visible). */
export function DraftNotice({ label }: { label: string }) {
  if (!LEGAL_DRAFT_NOTICE) return null;
  return (
    <span className="aicc-draft" data-legal-draft="true">
      <PencilLine size={14} aria-hidden="true" />
      {label}
    </span>
  );
}
