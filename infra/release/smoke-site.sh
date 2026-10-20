#!/usr/bin/env bash
# Health probe for a static-site release (post-swap gate). Exit 0 = healthy.
# Checks that the active tree has the three pages the edge preflight demands (index.html, 404.html, 50x.html), that _next/static exists, and, when
# AICC_SMOKE_URL is set, that the live edge answers 200 for it (curl --resolve is added by the caller through AICC_SMOKE_RESOLVE=host:port:ip).
# When AICC_EXPECT_STAGE_ID is set the tree must carry /.well-known/aicc-stage-identity with exactly that stage id (a production tree has none).
# Environment: AICC_RELEASE_DIR (required), AICC_SMOKE_URL, AICC_SMOKE_RESOLVE, AICC_EXPECT_STAGE_ID
set -euo pipefail
dir="${AICC_RELEASE_DIR:?AICC_RELEASE_DIR required}"
for f in index.html 404.html 50x.html; do [ -s "$dir/$f" ] || { echo "smoke-site: $dir/$f missing or empty" >&2; exit 1; }; done
[ -d "$dir/_next/static" ] || { echo "smoke-site: _next/static missing" >&2; exit 1; }
if [ -n "${AICC_EXPECT_STAGE_ID:-}" ]; then
  grep -q "\"id\":\"${AICC_EXPECT_STAGE_ID}\"" "$dir/.well-known/aicc-stage-identity" 2>/dev/null || { echo "smoke-site: stage identity file missing or for another stage" >&2; exit 1; }
fi
if [ -n "${AICC_SMOKE_URL:-}" ]; then
  # -k: this probe talks to our own loopback listener to see that the SITE answers; certificate validity is a separate concern (aicc-cert-expiry, and the first start deliberately uses
  # the Let's Encrypt STAGING CA whose certificates no client trusts)
  args=(-ksS -o /dev/null -w '%{http_code}' --max-time 8)
  [ -n "${AICC_SMOKE_RESOLVE:-}" ] && args+=(--resolve "$AICC_SMOKE_RESOLVE")
  code="$(curl "${args[@]}" "$AICC_SMOKE_URL" 2>/dev/null || true)"
  [ "$code" = "200" ] || { echo "smoke-site: $AICC_SMOKE_URL answered '$code'" >&2; exit 1; }
fi
echo "smoke-site: ok ($dir)"
