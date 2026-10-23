#!/usr/bin/env bash
# Stages the files of the DEDICATED sentinel repository in a new local directory. It contacts no network, creates no repository, uploads nothing and never sees a secret: the owner runs the
# printed commands (an owner gate: creating a public repository and storing the Telegram secrets).
#
#   infra/sentinel/github/prepare-sentinel-repo.sh --out ~/aicc-sentinel-repo
#
# Refuses: an --out that exists and is not empty; an --out inside an existing git work tree (it must be its OWN repository, never this one: a push of the site's main would redeploy the old site).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; SENT="$(cd "$HERE/.." && pwd)"
OUT=""
while [ $# -gt 0 ]; do case "$1" in --out) OUT="${2:-}"; shift 2 ;; -h|--help) sed -n 2,9p "${BASH_SOURCE[0]}"; exit 0 ;; *) echo "unknown argument: $1" >&2; exit 2 ;; esac; done
[ -n "$OUT" ] && [[ "$OUT" == /* ]] || { echo "usage: $0 --out <absolute directory>" >&2; exit 2; }
if [ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ]; then echo "REFUSED: $OUT exists and is not empty" >&2; exit 3; fi
PARENT="$(dirname "$OUT")"; mkdir -p "$PARENT"
if git -C "$PARENT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "REFUSED: $OUT is inside an existing git work tree; the sentinel is its own repository" >&2; exit 3; fi
mkdir -p "$OUT/.github/workflows"
install -m 644 "$SENT/sentinel.py" "$OUT/sentinel.py"
install -m 644 "$HERE/targets.github.toml" "$OUT/targets.toml"
install -m 644 "$HERE/aicc-sentinel.workflow.yml" "$OUT/.github/workflows/aicc-sentinel.yml"
install -m 644 "$HERE/PUBLIC-README.md" "$OUT/README.md"   # the PUBLIC README (README.md next to this script is the owner's guide and names private repositories: it is never published)
( cd "$OUT" && for f in sentinel.py targets.toml .github/workflows/aicc-sentinel.yml README.md; do printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$f"; done > SHA256SUMS )
cat <<MSG
Staged $OUT (sentinel.py, targets.toml, the workflow, README.md, SHA256SUMS). Nothing was published.

OWNER GATE (creates a PUBLIC repository and stores two secrets; read infra/sentinel/github/README.md in the site repository first; the staged README.md is the short PUBLIC one):
  cd "$OUT" && git init -b main && git add -A && git commit -m "AICC external sentinel"
  gh repo create <your-github-user>/aicc-sentinel --public --source . --push
  gh secret set TELEGRAM_BOT_TOKEN --repo <your-github-user>/aicc-sentinel     # hidden prompt; paste the token, press Enter
  gh secret set TELEGRAM_CHAT_ID   --repo <your-github-user>/aicc-sentinel
  gh workflow run aicc-sentinel --repo <your-github-user>/aicc-sentinel        # first run now; then: gh run list --repo <your-github-user>/aicc-sentinel --limit 3
MSG
