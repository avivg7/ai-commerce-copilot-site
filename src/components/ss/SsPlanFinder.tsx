"use client";
import { useState } from "react";
import { FormField, Badge } from "@/components/ui/Primitives";
import { PLANS } from "@/data/plans";
import type { SsLabelKey } from "@/lib/ssStatus";
import { SsCta } from "./SsCta";

/**
 * P37: the "Which plan?" finder of a self-service build. Same behaviour as src/components/home/PlanFinder.tsx (which stays untouched so every other build is byte-identical), but the result action is the
 * self-service button (a link to the sign-up page for the suggested plan, state-aware) instead of the inert "Purchases open soon" chip.
 */
export interface SsPlanFinderStrings {
  label: string;
  hint: string;
  error: string;
  many: string;
  empty: string;
  suggestion: string;
  results: { solo: string; studio: string; agency: string };
  names: { solo: string; studio: string; agency: string };
}

export function SsPlanFinder({ s, hrefs, labels, lang, dir }: { s: SsPlanFinderStrings; hrefs: Record<"solo" | "studio" | "agency", string>; labels: Record<SsLabelKey, string>; lang?: string; dir?: "ltr" | "rtl" }) {
  const [raw, setRaw] = useState("");
  const [touched, setTouched] = useState(false);
  const n = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  const valid = Number.isInteger(n) && n >= 1 && n <= 10;
  const tooMany = /^\d+$/.test(raw.trim()) && n > 10;
  const error = raw.trim() !== "" && !valid ? (tooMany ? s.many : s.error) : touched && raw.trim() === "" ? s.error : undefined;
  const plan = valid ? PLANS.find((p) => n <= p.stores)! : null;
  return (
    <form className="aicc-card" lang={lang} dir={dir} onSubmit={(e) => { e.preventDefault(); setTouched(true); }} noValidate>
      <div style={{ display: "grid", gap: "1rem" }}>
        <FormField id="plan-stores" label={s.label} hint={s.hint} error={error}>
          {(a) => (<input {...a} type="text" inputMode="numeric" autoComplete="off" value={raw} onChange={(e) => setRaw(e.target.value)} />)}
        </FormField>
        <div aria-live="polite" style={{ minBlockSize: "3.5rem" }}>
          {plan ? (
            <div style={{ display: "grid", gap: "0.75rem", justifyItems: "start" }}>
              <p>
                <Badge tone="success">{s.suggestion}</Badge>{" "}
                <strong>{s.results[plan.id]}</strong>
              </p>
              <SsCta href={hrefs[plan.id]} labels={labels} variant="primary" size="md" srName={s.names[plan.id]} />
            </div>
          ) : (
            <p className="aicc-muted aicc-small">{error ? "" : s.empty}</p>
          )}
        </div>
      </div>
    </form>
  );
}
