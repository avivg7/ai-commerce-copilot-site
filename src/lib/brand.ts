import { withBase } from "@/lib/basePath";

/** URL of a brand-kit asset (copied to public/brand-kit by scripts/publish-brand-assets.mjs before dev/build). */
export const kitAsset = (name: string) => withBase(`/brand-kit/${name}`);

/** A configured file path ("/demo/aicc.mp4", served from public/) gets the site base path; a full URL is used as given. */
const asset = (u: string) => (!u ? "" : /^(https?:)?\/\//.test(u) ? u : withBase(u.startsWith("/") ? u : `/${u}`));

/**
 * Watch demo video: the owner-approved master (Michael V3 main demo at 1.1x), served first-party from public/demo/.
 * The files are copied byte-for-byte from the approved source; docs/approved-demo.sha256 pins the video's hash and `npm run launch:check` verifies it.
 * Build-time overrides still work: NEXT_PUBLIC_DEMO_VIDEO_SRC / _POSTER / _CAPTIONS / _CAPTIONS_LANG (older names NEXT_PUBLIC_AICC_DEMO_VIDEO / _POSTER / _CAPTIONS).
 * Details: docs/watch-demo-video.md.
 */
export const DEMO = {
  video: asset(process.env.NEXT_PUBLIC_DEMO_VIDEO_SRC || process.env.NEXT_PUBLIC_AICC_DEMO_VIDEO || "/demo/aicc-demo.mp4"),
  poster: asset(process.env.NEXT_PUBLIC_DEMO_VIDEO_POSTER || process.env.NEXT_PUBLIC_AICC_DEMO_VIDEO_POSTER || "/demo/aicc-demo-poster.jpg"),
  captions: asset(process.env.NEXT_PUBLIC_DEMO_VIDEO_CAPTIONS || process.env.NEXT_PUBLIC_AICC_DEMO_VIDEO_CAPTIONS || "/demo/aicc-demo.vtt"),
  captionsLang: process.env.NEXT_PUBLIC_DEMO_VIDEO_CAPTIONS_LANG || "en",
};
