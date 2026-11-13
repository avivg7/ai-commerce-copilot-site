"use client";
import { useEffect, useRef, useState } from "react";
import { postConfirm } from "./api";

export interface RequestConfirmStrings { lead: string; button: string; working: string; outcome: string; error: string; unavailable: string; noLink: string }

/** The confirmation token (base64url, 24 h life, up to 64 characters) arrives in the URL FRAGMENT so it never reaches a server log or a Referer header. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The confirm page: reads `#t=<token>` once, removes it from the address bar at once (history.replaceState) and keeps it in memory only. Nothing is sent until the visitor presses
 * the button (a mail scanner that prefetches the link cannot confirm anything). Any outcome of the server (confirmed, invalid, expired, already used) reads as the same one sentence.
 */
export function RequestConfirm({ s }: { s: RequestConfirmStrings }) {
  const token = useRef<string | null>(null);
  const read = useRef(false);
  const [state, setState] = useState<"init" | "ready" | "working" | "done" | "retry" | "unavailable" | "nolink">("init");
  const result = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const m = /^#t=([^&]*)/.exec(window.location.hash);
    if (m && TOKEN_RE.test(m[1])) token.current = m[1];
    // the fragment leaves the address bar (and the session history entry) immediately, whether or not it was a token
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    // The site's language menu (brand kit, shared with the Control Plane theme and therefore not edited here) copies location.hash into its links on load; the token must not live in any href either
    document.querySelectorAll<HTMLAnchorElement>('a[href*="#t="]').forEach((a) => a.setAttribute("href", (a.getAttribute("href") || "").replace(/#t=[^&#]*/, "")));
    setState(token.current ? "ready" : "nolink");
  }, []);

  useEffect(() => { if (state === "done" || state === "retry" || state === "unavailable" || state === "nolink") result.current?.focus(); }, [state]);

  async function go() {
    if (!token.current || state === "working") return;
    setState("working");
    const out = await postConfirm(token.current);
    if (out === "done") { token.current = null; setState("done"); } else setState(out === "unavailable" ? "unavailable" : "retry");
  }

  return (
    <div className="aicc-card aicc-req__state" data-req-confirm={state}>
      {state === "init" ? null : state === "nolink" ? (
        <p role="status" tabIndex={-1} ref={result} data-req-result>{s.noLink}</p>
      ) : state === "done" ? (
        <p role="status" tabIndex={-1} ref={result} data-req-result>{s.outcome}</p>
      ) : (
        <>
          <p>{s.lead}</p>
          <div><button type="button" className="aicc-btn aicc-btn--primary aicc-btn--lg" onClick={go} disabled={state === "working"}>{state === "working" ? s.working : s.button}</button></div>
          {state === "retry" || state === "unavailable" ? <p role="status" tabIndex={-1} ref={result} className="aicc-field__error" data-req-result>{state === "unavailable" ? s.unavailable : s.error}</p> : null}
        </>
      )}
    </div>
  );
}
