# Watch demo video: how to enable it

Status: **prepared, not enabled.** No footage exists on the site. Until a source is set, the "Watch demo" button opens a calm, clearly labelled placeholder ("A short product video is coming. Meanwhile, try the interactive demo.") with a button to the interactive demo, and `npm run launch:check` reports it as a launch blocker. Do not point the variables at placeholder or stock footage.

## Enable it

1. Put the finished files where the site can serve them. Either:
   * drop them into `public/` (for example `public/demo/aicc-demo.mp4`, `public/demo/aicc-demo-poster.jpg`, `public/demo/aicc-demo.en.vtt`), which the static export copies as-is; or
   * host them elsewhere and use full `https://` URLs.
2. Set these at build time (they are inlined into the static export):

| Variable | Required | Meaning |
|---|---|---|
| `NEXT_PUBLIC_DEMO_VIDEO_SRC` | yes | the video file: a path under `public/` such as `/demo/aicc-demo.mp4` (the site's base path is added for you) or a full URL. MP4 (H.264 + AAC) plays everywhere |
| `NEXT_PUBLIC_DEMO_VIDEO_POSTER` | recommended | the still shown before play. Unset falls back to the Reco poster in the brand kit |
| `NEXT_PUBLIC_DEMO_VIDEO_CAPTIONS` | required for launch | a WebVTT (`.vtt`) captions file. A video without captions is not accessible |
| `NEXT_PUBLIC_DEMO_VIDEO_CAPTIONS_LANG` | optional | language of the captions and spoken audio, default `en` |

The older names `NEXT_PUBLIC_AICC_DEMO_VIDEO`, `NEXT_PUBLIC_AICC_DEMO_VIDEO_POSTER` and `NEXT_PUBLIC_AICC_DEMO_VIDEO_CAPTIONS` still work.

3. Rebuild (`AICC_BASE_PATH="" npm run build`, or the production build). Every "Watch demo" button (home hero, product page and the other CTAs) then opens the same dialog with `<video controls playsinline preload="metadata">`, the poster, and a `<track kind="captions" default>`. The dialog traps focus, closes on Escape or a click outside, pauses and rewinds on close, and returns focus to the button.

## Checks

* `npm run test:video` mounts the modal in both states (placeholder, and video with poster and captions) and checks the markup, the captions track, Escape and focus return.
* `npm run test:approved` builds with the variables set and asserts the built pages carry `data-demo-video`, `data-demo-poster`, `data-demo-captions` and `data-demo-captions-lang`.
* `npm run launch:check` keeps the "demo video" blocker until `NEXT_PUBLIC_DEMO_VIDEO_SRC` (or the older name) is set, and fails the built output while any button still has an empty video.

The modal is a kit module (`brand/js/video-modal.js`); the Control Plane theme uses the same markup, so a video enabled here needs its own variables or attributes there.
