#!/usr/bin/env bash
# Rewrites the ONE [[target]] of a staged/cloned sentinel repository's targets.toml for the current phase of the launch. Local file edit only; you commit and push it yourself.
#   sentinel-phase.sh --repo <dir holding targets.toml> --phase stage|dark|www
#   stage : https://stage.copilt.org/healthz      (today, until promotion; answers 200 "ok", Reserved IP 206.189.248.204)
#   dark  : https://api.copilt.org/health         (dark-production phase: the promoted host has only an internal certificate, www is still the old site)
#   www   : https://www.copilt.org/healthz        (after the DNS cutover; this is the file prepare-sentinel-repo.sh stages)
set -euo pipefail
REPO=""; PHASE=""
while [ $# -gt 0 ]; do case "$1" in --repo) REPO="${2:-}"; shift 2;; --phase) PHASE="${2:-}"; shift 2;; *) echo "usage: $0 --repo DIR --phase stage|dark|www" >&2; exit 2;; esac; done
[ -f "$REPO/targets.toml" ] || { echo "no $REPO/targets.toml" >&2; exit 2; }
case "$PHASE" in stage|dark|www) ;; *) echo "--phase must be stage, dark or www" >&2; exit 2;; esac
python3 - "$REPO/targets.toml" "$PHASE" <<'PY'
import re, sys
p, phase = sys.argv[1:3]
t = open(p).read()
head = t.split("[[target]]", 1)[0]
blocks = {
 "www": '''[[target]]
name = "www-edge"
url = "https://www.copilt.org/healthz"
interval_s = 300
expect_status = 200
expect_body = "ok"
expect_ip = "206.189.248.204"
latency_ms = 3000
timeout_s = 15
tls_warn_days = 14
''',
 "stage": '''[[target]]
name = "stage-edge"
url = "https://stage.copilt.org/healthz"
interval_s = 300
expect_status = 200
expect_body = "ok"
expect_ip = "206.189.248.204"
latency_ms = 3000
timeout_s = 15
tls_warn_days = 14
''',
 "dark": '''[[target]]
name = "api-health"
url = "https://api.copilt.org/health"
interval_s = 300
expect_status = 200
latency_ms = 3000
timeout_s = 15
tls_warn_days = 14
''',
}
open(p, "w").write(head + blocks[phase])
print("targets.toml set to phase '%s'" % phase)
PY
if [ -f "$REPO/SHA256SUMS" ]; then
  ( cd "$REPO" && for f in sentinel.py targets.toml .github/workflows/aicc-sentinel.yml README.md; do [ -f "$f" ] && printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$f"; done > SHA256SUMS ) && echo "SHA256SUMS refreshed"
fi
