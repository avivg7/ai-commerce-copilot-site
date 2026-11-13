# P35: the minimal Site launch-offer line (what it is, what it depends on)

Branch `feat/p35-site-launch-minimal` = the live P24 Site (`5907dea`) plus ONLY the launch-offer work of P32/P34. No P22 legal, privacy, terms, refund, FAQ or accessibility text is in it. OFF (the default) is byte-identical to a build of `5907dea` from the same path.

## Announce depends on the Control Plane: do not publish it alone
The `announce` build points visitors at `/pricing/#early-access` (bar link "How it works", card text, "Free access requests open soon"). On Production `/pricing/` is a WordPress page served from the Control Plane theme, and the anchor `#early-access` exists there only when the Control Plane launch-offer mode is `announce` or `open` (`AICC_EA_LAUNCH_OFFER_MODE`). An announce-only Site deploy therefore has a dead anchor and promises an offer with no explanation page and no intake. Publish announce only together with the matching Control Plane mode; recommended: keep the campaign OFF until the intake works and use `open`.

## Release gates (the release path enforces them, not only `launch:check`)
`infra/release/build-site-release.sh --target production` runs `scripts/ea-release-gate.mjs` on the packaged tree: an export that shows the struck-through price (`aicc-plan__regular--strike`) is refused unless `AICC_EA_STRIKE_COUNSEL_APPROVED` is a valid attestation; an export that shows "Limited availability" (`data-ea-limited`) is refused unless `AICC_EA_LIMITED_ATTESTED` is valid. "Valid" is the same rule as `launch:check` (`scripts/lib/ea-attest.mjs`: an evidence-folder file or a real reference token). The gate reads the built markup, whatever the owner's `AICC_EA_RELEASE_APPROVED` word says. Tests: `infra/stack-tests/test_release.sh` (including a mutation that removes the gate).

## After the offer ends: redeploy the OFF build
The campaign pages revert by themselves at 2026-12-31 22:00 UTC (head script), but the Home plan cards of a campaign build never show the 14-day money-back line again (it is removed from the DOM in campaign builds, also in the ended view), while the live Terms and Refund pages still grant the guarantee for the initial purchase. So: redeploy the OFF build right after the end date (checklist item), which restores the cards exactly as live P24.

## Naming
No sentence in the launch pack says the Terms or Privacy pages call the offer "Early Access": the live pages do not. `ea:check` fails if the old name appears anywhere in `src/i18n/ea`.

## Privacy notices
`request.notice`, `request.consent` and the explanation's `section.notice` (Turnstile, mail provider, data used, link to the Privacy Policy) render only in OPEN or VERIFY builds. They rely on a Privacy Policy that names the operator, Cloudflare Turnstile and the mail provider; that policy is the P22 legal publication, which this line does not carry. Do not publish an open or verify build before that publication and `AICC_EA_LEGAL_SIGNOFF`.
