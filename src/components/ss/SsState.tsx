"use client";
import { useEffect, useSyncExternalStore } from "react";
import { CircleCheck, Clock, Pause } from "lucide-react";
import { ssLine, ssRegClosedServerSnapshot, ssRegClosedSnapshot, ssRegClosedSubscribe, ssServerSnapshot, ssSnapshot, ssStart, ssSubscribe, type SsInitial } from "@/lib/ssStatus";

export type SsStateStrings = { soon: string; paused: string; open: string; waitlist: string; demo: string };

/**
 * P41: the ONE compact status line of the pricing section (`.aicc-pstate`, above the cards). It says what the visitor can do right now, from the same state table as the controls: registration not open (off / static): the fact plus the
 * Live Demo link; paused: the fact plus the Live Demo link; waitlist and open: the plain state. It is rendered nowhere else (never under every card). Registration closed (browser clock at or after the cutoff, or an answer
 * closed_cutoff) renders nothing: the closed view has its own closed cards and ONE announcement (the band). `role="status"` is truthful: this is the live region whose text changes with the answer.
 */
export function SsState({ strings, demoHref, initial, lang, dir }: { strings: SsStateStrings; demoHref: string; initial: SsInitial; lang?: string; dir?: "ltr" | "rtl" }) {
  const view = useSyncExternalStore(ssSubscribe, ssSnapshot, ssServerSnapshot);
  useEffect(() => { void ssStart(); }, []);
  const closedByClock = useSyncExternalStore(ssRegClosedSubscribe, ssRegClosedSnapshot, ssRegClosedServerSnapshot);
  const key = ssLine(view, initial, closedByClock);
  if (key === "closed") return null;
  const Icon = key === "open" ? CircleCheck : key === "paused" ? Pause : Clock;
  const state = closedByClock ? "closed_cutoff" : view;
  return (
    <p className="aicc-pstate" role="status" id="ss-state-line" data-ss-state={state} data-ss-line={key} lang={lang} dir={dir}>
      <span className="aicc-pstate__icon" aria-hidden="true"><Icon size={18} focusable="false" /></span>
      <span className="aicc-pstate__text">{strings[key]}</span>
      {key === "soon" || key === "paused" ? <a className="aicc-pstate__link" href={demoHref}>{strings.demo}</a> : null}
    </p>
  );
}
