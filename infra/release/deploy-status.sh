#!/usr/bin/env bash
# Read-only deployment state ON THE HOST (installed as /usr/local/sbin/aicc-deploy-status): what is live, what is the rollback target, exactly which build each is
# (tarball hash prefix + source commit + target) and the last deployments recorded by activate/rollback.
#   aicc-deploy-status [--last N] [--json]
set -euo pipefail
ROOT="${AICC_ROOT:-/srv/aicc}"; LAST=8; JSON=0
while [ $# -gt 0 ]; do case "$1" in --last) LAST="${2:-8}"; shift 2 ;; --json) JSON=1; shift ;; -h|--help) sed -n 2,5p "$0"; exit 0 ;; *) echo "unknown argument: $1" >&2; exit 2 ;; esac; done
[[ "$LAST" =~ ^[0-9]+$ ]] || { echo "--last needs a number" >&2; exit 2; }
LOG="${AICC_DEPLOY_LOG:-/var/lib/aicc/deployments.jsonl}"
describe() { # describe <kind> <link>
  local k="$1" l="$ROOT/$1/$2" id m
  if [ ! -L "$l" ]; then echo "none"; return; fi
  id="$(basename "$(readlink "$l")")"; m="$ROOT/$k/releases/$id.manifest.json"
  if [ -f "$m" ]; then printf '%s sha256=%s commit=%s target=%s' "$id" "$(jq -r '.tarball.sha256 // "?"' "$m" | cut -c1-16)" "$(jq -r '.sources.cp_commit // .sources.site_commit // "?"' "$m" | cut -c1-12)" "$(jq -r '.sources.target // "n/a"' "$m")"
  else printf '%s (no manifest)' "$id"; fi
}
if [ "$JSON" = 1 ]; then
  jq -n -c --arg sc "$(describe site current)" --arg sp "$(describe site previous)" --arg cc "$(describe cp current)" --arg cp "$(describe cp previous)" \
     --argjson recent "$( [ -f "$LOG" ] && tail -n "$LAST" "$LOG" | jq -s -c . || echo '[]')" '{site:{current:$sc,previous:$sp},cp:{current:$cc,previous:$cp},recent:$recent}'
  exit 0
fi
printf 'site  current : %s\nsite  previous: %s\ncp    current : %s\ncp    previous: %s\n' "$(describe site current)" "$(describe site previous)" "$(describe cp current)" "$(describe cp previous)"
echo "--- last $LAST deployments ($LOG)"
if [ -f "$LOG" ]; then tail -n "$LAST" "$LOG" | jq -r '[.ts,.outcome,.kind,.release_id,("prev="+.previous),("commit="+.source_commit),("by="+.operator)]|join("  ")'; else echo "(none recorded yet)"; fi
