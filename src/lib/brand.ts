import { withBase } from "@/lib/site";

/** URL of a brand-kit asset (copied to public/brand-kit by scripts/publish-brand-assets.mjs before dev/build). */
export const kitAsset = (name: string) => withBase(`/brand-kit/${name}`);

/** A configured file path ("/demo/aicc.mp4", served from public/) gets the site base path; a full URL is used as given. */
const asset = (u: string) => (!u ? "" : /^(https?:)?\/\//.test(u) ? u : withBase(u.startsWith("/") ? u : `/${u}`));

/**
 * Optional Watch demo video. NOT enabled by default: with no source set the modal shows a labelled placeholder and `launch:check` reports a blocker.
 * Set NEXT_PUBLIC_DEMO_VIDEO_SRC (a file in public/ such as "/demo/aicc-demo.mp4", or a full URL), and optionally NEXT_PUBLIC_DEMO_VIDEO_POSTER,
 * NEXT_PUBLIC_DEMO_VIDEO_CAPTIONS (a .vtt file) and NEXT_PUBLIC_DEMO_VIDEO_CAPTIONS_LANG (default "en", the language of the video's audio) at build time.
 * The older names NEXT_PUBLIC_AICC_DEMO_VIDEO / _POSTER / _CAPTIONS still work. Details: docs/watch-demo-video.md.
 */
export const DEMO = {
  video: asset(process.env.NEXT_PUBLIC_DEMO_VIDEO_SRC || process.env.NEXT_PUBLIC_AICC_DEMO_VIDEO || ""),
  poster: asset(process.env.NEXT_PUBLIC_DEMO_VIDEO_POSTER || process.env.NEXT_PUBLIC_AICC_DEMO_VIDEO_POSTER || ""),
  captions: asset(process.env.NEXT_PUBLIC_DEMO_VIDEO_CAPTIONS || process.env.NEXT_PUBLIC_AICC_DEMO_VIDEO_CAPTIONS || ""),
  captionsLang: process.env.NEXT_PUBLIC_DEMO_VIDEO_CAPTIONS_LANG || "en",
};
