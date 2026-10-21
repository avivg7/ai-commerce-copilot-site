#!/usr/bin/env bash
# infra:lint  --  bash -n on every script, the custom static checks (lint.py), and ShellCheck when it is installed (never installed by this repo).
# ShellCheck severity: warnings and errors. SC2034 (variable looks unused: many are used by sourced files or the caller), SC2154 and SC2120 are excluded
# because the files are split into sourced libraries; each exclusion was reviewed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; INFRA="$(cd "$HERE/.." && pwd)"
rc=0
python3 "$HERE/lint.py" || rc=1
if command -v shellcheck >/dev/null 2>&1; then
  echo "== shellcheck $(shellcheck --version | sed -n 's/^version: //p') (warnings and errors) =="
  # shellcheck disable=SC2046
  shellcheck -x -S warning -e SC2034,SC2154,SC2120 $(find "$INFRA/provision" "$INFRA/systemd" "$INFRA/backup" "$INFRA/release" "$INFRA/php" "$INFRA/sentinel" "$INFRA/stack-tests" -name '*.sh' ! -name verify-droplet.sh ! -name render-cloud-init.sh | sort) && echo "shellcheck: clean" || rc=1
else
  echo "shellcheck: NOT RUN (not installed)"
fi
exit "$rc"
