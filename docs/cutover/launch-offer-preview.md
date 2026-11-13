# Launch offer: local preview guide (P32)

Nothing here deploys or contacts anything. Every command runs on this machine. Replace `$OUT` with any scratch folder.

## Build each mode (domain-root build, like the www host)

```
AICC_BASE_PATH="" SITE_URL=https://www.copilt.org npm run build && mv out $OUT/off            # OFF (default)
AICC_BASE_PATH="" SITE_URL=https://www.copilt.org NEXT_PUBLIC_AICC_EARLY_ACCESS=announce npm run build && mv out $OUT/announce
AICC_BASE_PATH="" SITE_URL=https://www.copilt.org NEXT_PUBLIC_AICC_EARLY_ACCESS=open NEXT_PUBLIC_AICC_EA_MAIL_PROVIDER="Some Provider" npm run build && mv out $OUT/open
AICC_BASE_PATH="" SITE_URL=https://www.copilt.org NEXT_PUBLIC_AICC_EARLY_ACCESS=verify npm run build && mv out $OUT/verify
```

Remove `out/` and `.next/` between builds. The mail provider value is only a name shown in the form's privacy notice (a placeholder is shown, and `launch:check` blocks, when it is unset).

## Serve one with a mock of the intake API

`scripts/lib/intake-mock.mjs` serves an export and the three routes of the contract on 127.0.0.1 (status, create, confirm); a Turnstile stand-in is injected by the tests. For a manual look: `node -e 'import("./scripts/lib/intake-mock.mjs").then(async m => { const s = await m.startMock({ dir: process.argv[1], port: 3600 }); console.log(s.url) })' $OUT/open`, then open `http://127.0.0.1:3600/request-access/` (the Turnstile script is blocked without internet, so the widget does not render; the tests stub it). `npm run serve:out -- --dir $OUT/open --port 3011` serves a plain static copy (the form then shows the neutral "not open" state, which is the correct inert behaviour).

## Run the checks

```
node scripts/test-launch-offer.mjs --off $OUT/off --announce $OUT/announce --open $OUT/open --verify $OUT/verify [--base <export of the base commit 5907dea, built from the same checkout path and dist directory name>]
node scripts/test-request-form.mjs --open $OUT/open --verify $OUT/verify
node scripts/test-launch-offer-browser.mjs --announce $OUT/announce --open $OUT/open --off $OUT/off --shots $OUT/shots [--expired $OUT/expired-open]
node scripts/ea-check.mjs --out $OUT/open --expect open --compare-off $OUT/off      # also --expect announce / off, --strike
AICC_OUT_DIR=$OUT/open NEXT_PUBLIC_AICC_EARLY_ACCESS=open node scripts/launch-check.mjs   # report-only; AICC_PRODUCTION=1 makes it fail
```

`--expired`: an export built with `NEXT_PUBLIC_AICC_EARLY_ACCESS=open AICC_EA_TEST_SEAM=1 AICC_BUILD_NOW_MS=1798754401000` (one second after the end); it must carry no campaign and no request page.

## Screenshots (`--shots`)

`{announce|open}-{en|he|es|ru}-{home|pricing}-{1440|390}.png`: the launch Hero (badge, headline, two actions, Reco) and Pricing (cards with Regular price, Free until, terms) per mode and language, Hebrew right-to-left. `open-*-request-{1440|390}.png`: the request form (open state, fake bot-check widget). `open-*-confirm-*.png`: the confirm page. `open-{en|he}-request-{closed|done}-390.png`: the neutral closed state and the neutral success state. `off-*-home-1440.png`: the ordinary Hero for comparison.
