import { Play } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { txProps, type Dictionary } from "@/i18n";
import { DEMO, kitAsset } from "@/lib/brand";

/**
 * "Watch demo" button (secondary glass by default). The modal is built by brand/js/video-modal.js on first click and plays the owner-approved demo.
 * The home hero uses it as the PRIMARY call to action under the label "See it in action" (`variant="primary"`, `label`, `labelKey`): same trigger, same dialog.
 */
export function WatchDemo({
  locale, t, size = "lg", variant = "secondary", label, labelKey = "brand.watchDemo",
}: { locale: Locale; t: Dictionary; size?: "md" | "lg"; variant?: "primary" | "secondary"; label?: string; labelKey?: string }) {
  return (
    <button
      type="button"
      className={`aicc-btn aicc-btn--${variant}${size === "lg" ? " aicc-btn--lg" : ""}`}
      data-aicc-demo-trigger
      data-locale={locale}
      data-strings={JSON.stringify(t.brand.modal)}
      data-demo-video={DEMO.video}
      data-demo-poster={DEMO.poster || kitAsset("reco-hero-poster.jpg")}
      data-demo-captions={DEMO.captions}
      data-demo-captions-lang={DEMO.captionsLang}
      {...(({ lang, dir }) => ({ lang, dir }))(txProps(locale, labelKey))}
    >
      {label ?? t.brand.watchDemo}
      <span className="aicc-btn__icon"><Play size={16} aria-hidden="true" /></span>
    </button>
  );
}
