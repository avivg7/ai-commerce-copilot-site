"use client";
import { useState } from "react";
import { FormField, Badge } from "@/components/ui/Primitives";
import { PLANS } from "@/data/plans";
import type { SsInitial } from "@/lib/ssStatus";
import { SsCta, type SsCtaLabels } from "./SsCta";

/**
 * P37/P40: the "Which plan?" finder of a self-service build. Same behaviour as src/components/home/PlanFinder.tsx (which stays untouched so every other build is byte-identical), but the result action is the
 * self-service control (a link to the sign-up page for the suggested plan, state-aware) instead of the inert "Purchases open soon" chip. The result is the plan and its paid capacity only: the dates and the
 * trial conditions are said once per page, in the launch panel.
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

/** The PAID capacity line of each plan ("Paid plan: up to 3 stores"), computed on the server from src/data/plans.ts, in the language the pack is written in. */
export interface SsPlanFinderCapacity { solo: string; studio: string; agency: string; lang?: string; dir?: "ltr" | "rtl" }

export function SsPlanFinder({ s, hrefs, infoHrefs, labels, closedNote, initial, capacity, lang, dir }: { s: SsPlanFinderStrings; hrefs: Record<"solo" | "studio" | "agency", string>; infoHrefs: Record<"solo" | "studio" | "agency", string>; labels: SsCtaLabels; closedNote: string; initial: SsInitial; capacity: SsPlanFinderCapacity; lang?: string; dir?: "ltr" | "rtl" }) {
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
              <div className="aicc-ssfinder__result" data-ss-finder-result>
                <p className="aicc-ssfinder__cap" lang={capacity.lang} dir={capacity.dir} data-ss-finder-cap>{capacity[plan.id]}</p>
              <SsCta href={hrefs[plan.id]} infoHref={infoHrefs[plan.id]} initial={initial} labels={labels} closedNote={closedNote} featured={plan.featured} srName={s.names[plan.id]} lang={capacity.lang} dir={capacity.dir} />
              </div>
            </div>
          ) : (
            <p className="aicc-muted aicc-small">{error ? "" : s.empty}</p>
          )}
        </div>
      </div>
    </form>
  );
}
