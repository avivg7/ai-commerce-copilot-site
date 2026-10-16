import { withBase } from "@/lib/site";

/** URL of a brand-kit asset (copied to public/brand-kit by scripts/publish-brand-assets.mjs before dev/build). */
export const kitAsset = (name: string) => withBase(`/brand-kit/${name}`);

/** Optional demo video (no fake footage: unset means the modal shows the labelled placeholder, a launch blocker). */
export const DEMO = {
  video: process.env.NEXT_PUBLIC_AICC_DEMO_VIDEO || "",
  poster: process.env.NEXT_PUBLIC_AICC_DEMO_VIDEO_POSTER || "",
  captions: process.env.NEXT_PUBLIC_AICC_DEMO_VIDEO_CAPTIONS || "",
};
