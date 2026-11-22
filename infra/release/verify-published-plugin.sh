#!/usr/bin/env bash
# POST-PUBLICATION VERIFICATION of an official AICC Plugin release (P41). Real checks, not a reminder: run it after `publish-plugin-release.sh --apply --set-current`, and in a local fixture before.
# Version, ZIP SHA-256 and the signed manifest are ARGUMENTS (nothing is hard-coded to a release). Read-only against the Control Plane except where stated below.
#
#   verify-published-plugin.sh --mode production|stage|fixture|offline
#        --version X.Y.Z --sha256 <64 hex, from the build machine's .sha256 file> --manifest <...X.manifest.json> --sig <...X.manifest.sig> --plugin-dir <Plugin repo or build dir with bin/sign-release.php>
#        [--pubkeys <b64[,b64]>]            the owner's PUBLIC key list (default: release/endpoints.conf UPDATE_PUBLIC_KEYS of --plugin-dir)
#        [--expect-key-id 5a8f-1d62-ac6e-ce00]   the primary key's fingerprint the owner read from keygen
#        [--previous-version X.Y.Z]         the release that was current before: the new one must be strictly newer
#        [--local-zip <ZIP>]                the ZIP as built/signed on this Mac (cross-checked against the manifest and, by the verify tool's --zip, against its own baked keys)
#        [--base-url https://www.copilt.org]   production: exactly that origin; stage: https://stage.copilt.org; fixture: a loopback origin
#        [--credentials-file F | --user-env NAME --pass-env NAME]   a customer with an ACTIVE plan (the owner's own test account): F is a regular file, mode 0600, owned by you, lines
#                                           AICC_VERIFY_USER=<login or e-mail> and AICC_VERIFY_PASS=<password>. The password is never an argument, never printed, never written to a report.
#        [--other-credentials-file F]       a SECOND customer (same format): the cross-tenant download check (this session with the other customer's nonce link and the reverse must both be 403). Fixture: created. Production: optional.
#        [--store-file F]                   0600 file: AICC_STORE_ACTIVATION_REF / AICC_STORE_ORIGIN of a store of an active plan (+ optional AICC_OTHER_ACTIVATION_REF of another tenant's store).
#                                           Fixture: created for you. Production: omit it unless the owner has a connected TEST store of the test account (then it is read-only: update-check only).
#        [--package-download]               also download through the updater's package route (fixture/stage; it is logged as a system download, so not on production by default)
#        [--no-updater-probes]              skip the POSTs to /wp-json/aicc-license/v1/plugin/* (production: those probes send FABRICATED proofs; the server answers every reason the same way)
#        [--out DIR]                        work/evidence directory (0700; holds the downloaded ZIP and verify-report.json; no password, cookie or nonce)
#
# CHECKS (each prints PASS or FAIL; exit 0 only when every one passed; 1 any failure; 2 usage; 3 refused by a safety rule such as a production mode pointed at another host):
#   R  release record, offline: manifest clean + SHA-256 equals the second channel; signature well formed; verifies against the owner's public keys with the Plugin repo's own tool; key_id belongs to exactly one
#      key of the list and that key alone verifies it; (--expect-key-id); strictly newer than --previous-version; the local ZIP re-hashed AND verified with the tool's --zip form (the --pubkeys form of
#      `sign-release.php verify` never looks at the ZIP: that is why both forms run); Version header == AICC_VERSION == manifest version; baked keys on the owner's list.
#   C  customer path: My Account sign-in, Plans & Stores shows version + SHA-256 + signing key, download through the page's own nonce link, size/SHA-256 equal the SIGNED manifest, the downloaded ZIP verifies with its
#      baked keys, header/constant/manifest versions agree.
#   U  uniform refusals: signed-out / stale nonce / unknown or traversal version on the account download; unknown, malformed, query-string, wrong-origin and wrong-tenant proofs on update-check ({"update":false}) and
#      package (404 {"error":"not_available"}); a real store is offered only a NEWER, SIGNED release (the answer's own signature is verified; the Plugin's validate_offer/verify_offer refuse same-version, downgrade
#      and a foreign baked key).
#   D  download safety: a connection cut half way, a flipped byte and a shorter ZIP are detected by the client routine and leave nothing behind under the final name, so nothing installs.
# STATE CHANGES ON PRODUCTION: sign-in (a session on the test account), the account download (the Control Plane records plugin_downloaded for that account, like any download), and the fabricated-proof POSTs
# (counted by the rate limiter only). Nothing else. Never run with a real customer's credentials.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in -h|--help|"") sed -n 2,32p "${BASH_SOURCE[0]}"; [ -n "${1:-}" ] && exit 0 || exit 2 ;; esac
command -v python3 >/dev/null 2>&1 || { echo "verify-published-plugin: python3 is required" >&2; exit 2; }
exec python3 -I "$HERE/lib/verify_published.py" "$@"
