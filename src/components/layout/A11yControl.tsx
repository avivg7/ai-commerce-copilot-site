"use client";
import { useRef, useSyncExternalStore, useId } from "react";
import Link from "next/link";
import { Accessibility, X, RotateCcw } from "lucide-react";
import { a11ySnapshot, a11ySubscribe, a11yServerSnapshot, parseA11y, resetA11y, setA11y, type A11yPrefs } from "@/lib/prefs";

export interface A11yStrings {
  button: string;
  title: string;
  intro: string;
  motion: string;
  motionHelp: string;
  contrast: string;
  contrastHelp: string;
  text: string;
  textHelp: string;
  reset: string;
  close: string;
  statement: string;
  disclaimer: string;
}

/**
 * First-party accessibility settings (not an overlay product). A native <dialog> opened with showModal(), so the
 * browser provides the focus trap, Esc to close, inert background and focus return to the trigger.
 * Sets data-aicc-motion / data-aicc-contrast / data-aicc-text on <html> (the tokens implement them) and remembers
 * them in localStorage; a tiny inline script in <head> re-applies them before first paint. It does not claim to make
 * the site conformant.
 */
export function A11yControl({
  strings,
  statementHref,
  className,
}: {
  strings: A11yStrings;
  statementHref: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const snap = useSyncExternalStore(a11ySubscribe, a11ySnapshot, a11yServerSnapshot);
  const prefs = parseA11y(snap);

  const rows: { key: keyof A11yPrefs; label: string; help: string }[] = [
    { key: "motion", label: strings.motion, help: strings.motionHelp },
    { key: "contrast", label: strings.contrast, help: strings.contrastHelp },
    { key: "text", label: strings.text, help: strings.textHelp },
  ];

  return (
    <>
      <button
        type="button"
        className={className ?? "aicc-iconbtn"}
        onClick={() => ref.current?.showModal()}
        aria-haspopup="dialog"
      >
        <Accessibility size={20} aria-hidden="true" />
        <span>{strings.button}</span>
      </button>
      <dialog
        ref={ref}
        className="aicc-dialog"
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="aicc-dialog__inner">
          <div className="aicc-dialog__head">
            <h2 id={titleId}>{strings.title}</h2>
            <button type="button" className="aicc-iconbtn" onClick={() => ref.current?.close()} aria-label={strings.close}>
              <X size={22} aria-hidden="true" />
            </button>
          </div>
          <p className="aicc-muted aicc-small">{strings.intro}</p>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {rows.map((r) => (
              <button
                key={r.key}
                type="button"
                role="switch"
                aria-checked={prefs[r.key]}
                className="aicc-switch"
                onClick={() => setA11y(r.key, !prefs[r.key])}
              >
                <span className="aicc-switch__text">
                  <strong>{r.label}</strong>
                  <span>{r.help}</span>
                </span>
                <span className="aicc-switch__track" aria-hidden="true" />
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", justifyContent: "space-between" }}>
            <button type="button" className="aicc-btn aicc-btn--quiet" onClick={resetA11y}>
              <RotateCcw size={18} aria-hidden="true" />
              {strings.reset}
            </button>
            <Link href={statementHref} className="aicc-link" onClick={() => ref.current?.close()}>
              {strings.statement}
            </Link>
          </div>
          <p className="aicc-muted aicc-small">{strings.disclaimer}</p>
        </div>
      </dialog>
    </>
  );
}
