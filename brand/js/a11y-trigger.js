// The quiet accessibility-settings trigger: a small icon button (44px target) whose accessible name is the settings label ("Accessibility settings").
// The page owns the dialog; this only renders the button and announces the intent with a DOM event the page listens for (default "aicc:a11y-open").
// Markup contract (the Control Plane may render the same HTML in PHP):
//   <button type="button" class="aicc-iconbtn aicc-a11y-trigger" aria-haspopup="dialog" aria-label="Accessibility settings" data-aicc-a11y-open>[accessibility icon]</button>
import { icon } from "./icons.js";
import { esc } from "./motion.js";

export function renderA11yTriggerHTML({ label }) {
  return `<button type="button" class="aicc-iconbtn aicc-a11y-trigger" aria-haspopup="dialog" aria-label="${esc(label)}" data-aicc-a11y-open>${icon("accessibility", 20)}</button>`;
}

/** Wires every [data-aicc-a11y-open] under root to dispatch the page's open event. Idempotent. */
export function initA11yTrigger(root = document, eventName = "aicc:a11y-open") {
  root.querySelectorAll("[data-aicc-a11y-open]").forEach((b) => {
    if (b.dataset.aiccReady) return;
    b.dataset.aiccReady = "1";
    b.addEventListener("click", () => window.dispatchEvent(new Event(eventName)));
  });
}
