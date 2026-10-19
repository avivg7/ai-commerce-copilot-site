import { Play } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { txProps, type Dictionary } from "@/i18n";
import { DEMO, kitAsset } from "@/lib/brand";

/** Secondary (glass) "Watch demo" button. The modal is built by brand/js/video-modal.js on first click; no footage unless configured. */
export function WatchDemo({ locale, t, size = "lg" }: { locale: Locale; t: Dictionary; size?: "md" | "lg" }) {
  return (
    <button
      type="button"
      className={`aicc-btn aicc-btn--secondary${size === "lg" ? " aicc-btn--lg" : ""}`}
      data-aicc-demo-trigger
      data-locale={locale}
      data-strings={JSON.stringify(t.brand.modal)}
      data-demo-video={DEMO.video}
      data-demo-poster={DEMO.poster || kitAsset("reco-hero-poster.jpg")}
      data-demo-captions={DEMO.captions}
      data-demo-captions-lang={DEMO.captionsLang}
      {...(({ lang, dir }) => ({ lang, dir }))(txProps(locale, "brand.watchDemo"))}
    >
      {t.brand.watchDemo}
      <span className="aicc-btn__icon"><Play size={16} aria-hidden="true" /></span>
    </button>
  );
}
