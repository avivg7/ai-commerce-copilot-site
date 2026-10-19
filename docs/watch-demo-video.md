# Watch demo video: how to enable it

Status: **enabled with the owner-approved master.** Every "Watch demo" button opens the Michael V3 main demo at 1.1x (108 s, English narration), served first-party from `public/demo/`:

| File | What it is |
|---|---|
| `public/demo/aicc-demo.mp4` | byte-identical copy of `~/Downloads/AICC-demo/video/final-v3-main-michael-1.1x.mp4` (sha256 pinned in `docs/approved-demo.sha256`; `npm run launch:check` fails if it ever differs) |
| `public/demo/aicc-demo.vtt` | the complete spoken transcript as WebVTT, timestamps divided by 1.1 to match the 1.1x master (the burned-in summaries are inside the video) |
| `public/demo/aicc-demo-poster.jpg` | the still shown before play (Poster V2, 1280x720) |

Do not re-edit, re-encode, re-time or substitute the video (not V1, V2, original-speed V3, Emma or any short cut). The source file stays untouched in Downloads. It does not autoplay: the dialog opens with the poster and native controls, and the viewer starts it.

The defaults live in `src/lib/brand.ts`; the build-time variables below still override them (for a CDN, say).

## Override it (optional)

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
* `npm run test:demo` also asserts the dialog-scoped `::cue` rule in the loaded CSS (CSSOM, since computed `::cue` is not readable everywhere) and its contrast.
* `npm run launch:check` keeps the "demo video" blocker until `NEXT_PUBLIC_DEMO_VIDEO_SRC` (or the older name) is set, and fails the built output while any button still has an empty video.

The modal is a kit module (`brand/js/video-modal.js`); the Control Plane theme uses the same markup (see below).

## Control Plane (same demo, no copy)

The Control Plane's Home page has the same button. It does **not** carry its own copy of the 44 MB video: it references these same canonical paths, `/demo/aicc-demo.mp4`, `/demo/aicc-demo.vtt` and `/demo/aicc-demo-poster.jpg`, same-origin. In production (one host, `https://www.copilt.org/`) the **edge must send `/demo/*` to this static site** (`GET`/`HEAD`, `video/mp4` with byte ranges, `text/vtt`, `image/jpeg`). If the files do not answer on the Control Plane host, its button hides itself (a HEAD probe) rather than showing a placeholder or an empty player. So **these three paths and their file names are a contract: do not rename or move them without changing the Control Plane's defaults** (`inc/brand.php` there, `docs/unified-experience/page-parity.md` > Watch demo). The kit module also still has its placeholder state (for a build with no video); the Control Plane never renders it.

## Captions styling

The shared kit tones down the browser's native caption rendering for this video only: `.aicc-modal video::cue` is near-white (`#fff`) on `rgb(8 12 22 / 0.88)` (about 14:1 even over a white frame; 7:1 is the floor `npm run test:demo` asserts), and from 48 rem up the size is 70% of the native size (the native size is 5% of the video height, which on a wide player covers the dashboard UI; a phone keeps the native size, which is already small). It is plain CSS: no caption engine, no JS, native controls untouched, the viewer's own caption settings still win where the browser supports them. `::cue` accepts only a few properties and browsers differ: Chrome honors the rule (screenshots in the cutover evidence folder `captions/`); Safari/WebKit and Firefox support a subset and Safari may let system caption preferences override it. Those two were not installed in the test Playwright (only Chromium), so they are covered by this note, not by a run. If a browser ignores the rule it falls back to its own default, which is readable.
