// The ONE definition of "a valid attestation reference" (P35: shared by `launch:check` and by the release gate `scripts/ea-release-gate.mjs`, so that the release path enforces exactly the same rules).
import fs from "node:fs";
import path from "node:path";

/** @param env the environment (AICC_EVIDENCE_DIR, HOME) @param eaRefIsPlaceholder from src/lib/earlyAccess.ts @returns (value) => boolean */
export function makeAttested(env, eaRefIsPlaceholder) {
  // An attestation is a REFERENCE to evidence, recorded and never verified here: either the path of an existing evidence file, or a token of the shape "letters, a separator, ..., at least one digit"
  // (cp-dark/p33/intake-evidence, counsel-2026-11-30, TICKET-114). No spaces; not a placeholder or answer word (pending, false, later, unknown, "not done", "yes yes", digits only, ok-1 ...).
  const BAD_WORDS = new Set(["pending", "false", "true", "yes", "no", "later", "unknown", "none", "not", "done", "todo", "tbd", "tba", "na", "ref", "test", "xxx", "placeholder", "verified", "approved", "signed", "ok", "soon", "waiting", "wip"]);
  // Review P34-3: a FILE reference counts only when it is a regular file (no symlink) inside the evidence directory (AICC_EVIDENCE_DIR, default the owner's launch-evidence folder);
  // any other existing file (package.json, README.md, /etc/hosts) clears nothing. A token is at least 8 characters, and a placeholder word with a numeric or one-letter suffix
  // (approved-1, todo1-x, yes_2026, ok-1, true-2026, x-1) is refused.
  const EVIDENCE_DIR = path.resolve(env.AICC_EVIDENCE_DIR || path.join(env.HOME || "", "aviv_files/AICC/commerce_copilot_images/AICC-launch-evidence"));
  const PLACEHOLDER_SUFFIXED = /^(?=.{0,200}$)(?:yes|no|true|false|ok|okay|todo|tbd|tba|na|x+|test|pending|approved|verified|signed|done|ref|wip|placeholder)(?:\d*)(?:[-_.:/#@](?:[a-z]|\d+|yes|no|true|ok|x+|todo|tbd))*$/i;
  const attested = (v) => {
    if (typeof v !== "string") return false;
    const t = v.trim();
    if (t.length < 8 || t.length > 200 || /[\r\n]/.test(t)) return false;
    if (path.isAbsolute(t) || /^[.~]/.test(t) || /\.(md|txt|pdf|json|log|png|jpe?g|html?)$/i.test(t)) {
      try { const real = fs.realpathSync(t); const st = fs.lstatSync(t); return st.isFile() && !st.isSymbolicLink() && real.startsWith(fs.realpathSync(EVIDENCE_DIR) + path.sep); } catch { return false; }
    }
    if (!/^[A-Za-z]{2,}[-_:#/][A-Za-z0-9._:/#@-]*[0-9][A-Za-z0-9._:/#@-]*$/.test(t) || eaRefIsPlaceholder(t) || PLACEHOLDER_SUFFIXED.test(t)) return false;
    const words = t.split(/[-_:#/.@]+/).map((w) => w.toLowerCase().replace(/^\d+|\d+$/g, "")).filter(Boolean);
    return words.length > 0 && !words.every((w) => BAD_WORDS.has(w) || w.length === 1);
  };
  return attested;
}
