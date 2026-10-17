"use client";
import { useState } from "react";
import { FormField, Badge } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { PLANS } from "@/data/plans";
import { planUrl } from "@/lib/site";

export interface PlanFinderStrings {
  label: string;
  hint: string;
  error: string;
  many: string;
  empty: string;
  suggestion: string;
  results: { solo: string; studio: string; agency: string };
  names: { solo: string; studio: string; agency: string };
  choose: string; // already contains the plan name placeholder {plan}
}

/** Tiny helper: how many stores -> which plan. Validates on blur/submit, error tied to the field with aria-describedby. */
export function PlanFinder({ s, lang, dir }: { s: PlanFinderStrings; lang?: string; dir?: "ltr" | "rtl" }) {
  const [raw, setRaw] = useState("");
  const [touched, setTouched] = useState(false);
  const n = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  const valid = Number.isInteger(n) && n >= 1 && n <= 10;
  // Invalid input is reported as soon as it is typed (not only after the field loses focus); more than 10 stores gets its own path to support.
  const tooMany = /^\d+$/.test(raw.trim()) && n > 10;
  const error = raw.trim() !== "" && !valid ? (tooMany ? s.many : s.error) : touched && raw.trim() === "" ? s.error : undefined; // "touched" now means "submitted": tabbing through the empty field is not an error
  const plan = valid ? PLANS.find((p) => n <= p.stores)! : null;

  return (
    <form
      className="aicc-card"
      lang={lang}
      dir={dir}
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
      }}
      noValidate
    >
      <div style={{ display: "grid", gap: "1rem" }}>
        <FormField id="plan-stores" label={s.label} hint={s.hint} error={error}>
          {(a) => (
            <input
              {...a}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          )}
        </FormField>
        <div aria-live="polite" style={{ minBlockSize: "3.5rem" }}>
          {plan ? (
            <div style={{ display: "grid", gap: "0.75rem", justifyItems: "start" }}>
              <p>
                <Badge tone="success">{s.suggestion}</Badge>{" "}
                <strong>{s.results[plan.id]}</strong>
              </p>
              <Button href={planUrl(plan.id)} variant="primary">
                {s.choose.replace("{plan}", s.names[plan.id])}
              </Button>
            </div>
          ) : (
            <p className="aicc-muted aicc-small">{error ? "" : s.empty}</p>
          )}
        </div>
      </div>
    </form>
  );
}
