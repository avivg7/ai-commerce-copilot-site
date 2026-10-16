import ReactDOM from "react-dom";
import { renderRecoHeroHTML } from "../../../brand/js/reco-hero.js";
import { kitAsset } from "@/lib/brand";

/** The animated Reco hero. Markup comes from the kit's own renderer (same string the theme can emit); behaviour from initBrand(). */
export function RecoHero({ labels }: { labels: string[] }) {
  const assets = { video: kitAsset("reco-hero.mp4"), poster: kitAsset("reco-hero-poster.jpg") };
  // The poster is the LCP image: fetch it early at high priority. The video itself is metadata-only until it is in view.
  ReactDOM.preload(assets.poster, { as: "image", fetchPriority: "high" });
  return <div dangerouslySetInnerHTML={{ __html: renderRecoHeroHTML({ labels, assets }) }} />;
}
