#!/usr/bin/env bash
# SENTINEL (option B) SELF-TEST: stage the dedicated sentinel repository with the Site's real prepare-sentinel-repo.sh, check it statically, then run it end to end against a
# local stand-in target and a local fake Telegram. Nothing is published, no network is used, no real secret exists.
#   sentinel-e2e-selftest.sh --site-repo <Site checkout with infra/sentinel/github/prepare-sentinel-repo.sh> [--out <dir to leave the staged repo in>]
set -uo pipefail
SITE=""; OUT=""
while [ $# -gt 0 ]; do case "$1" in --site-repo) SITE="${2:-}"; shift 2;; --out) OUT="${2:-}"; shift 2;; *) echo "usage: $0 --site-repo DIR [--out DIR]" >&2; exit 2;; esac; done
PREP="$SITE/infra/sentinel/github/prepare-sentinel-repo.sh"; [ -f "$PREP" ] || { echo "no $PREP" >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SB="$(mktemp -d "${TMPDIR:-/tmp}/aicc-sentinel-selftest.XXXXXX")"; chmod 700 "$SB"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS  $1"; }; bad() { FAIL=$((FAIL+1)); echo "FAIL  $1"; }
cleanup() { rm -rf "$SB"; }; trap cleanup EXIT
STAGED="${OUT:-$SB/sentinel-repo}"

echo "== 1. stage the repository with the real script (no network, no git remote)"
bash "$PREP" --out "$STAGED" >"$SB/prep.out" 2>&1 && ok "prepare-sentinel-repo.sh staged $STAGED" || { bad "prepare failed"; cat "$SB/prep.out"; exit 1; }
for f in sentinel.py targets.toml .github/workflows/aicc-sentinel.yml README.md SHA256SUMS; do [ -s "$STAGED/$f" ] && ok "staged: $f" || bad "missing $f"; done
( cd "$STAGED" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 ) && ok "SHA256SUMS verifies" || bad "SHA256SUMS"
cmp -s "$STAGED/sentinel.py" "$SITE/infra/sentinel/sentinel.py" && ok "sentinel.py is byte-identical to the tested one" || bad "sentinel.py differs"
[ ! -d "$STAGED/.git" ] && ok "no .git directory (the owner runs git init: it is its OWN repository)" || bad ".git present"
n="$(find "$STAGED" -type f | wc -l | tr -d ' ')"; [ "$n" = 5 ] && ok "exactly 5 files are public (sentinel.py, targets.toml, workflow, public README.md, SHA256SUMS)" || { bad "unexpected file count $n"; find "$STAGED" -type f; }
if grep -rIE '(bot[0-9]{6,}:[A-Za-z0-9_-]{20,}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|dop_v1_[a-f0-9]{20,})' "$STAGED" >/dev/null; then bad "secret-shaped string in the staged repo"; else ok "no secret-shaped string in any staged file"; fi
grep -rIl -E '(/Users/|avivgerman|avivg)' "$STAGED" >/dev/null && bad "local username/path leaked into the public tree: $(grep -rIl -E '(/Users/|avivgerman|avivg)' "$STAGED")" || ok "no local path or personal name in the public tree"

echo "== 2. the workflow, statically"
W="$STAGED/.github/workflows/aicc-sentinel.yml"
actionlint "$W" >"$SB/al.out" 2>&1 && ok "actionlint: clean" || { bad "actionlint"; cat "$SB/al.out"; }
grep -q 'fail-on-down' "$W" && ok "uses --fail-on-down (GitHub's own failure e-mail = alert path independent of Telegram)" || bad "no --fail-on-down"
grep -E '^\s+- cron:' "$W" | sed 's/^/      /'
python3 - "$W" <<'PY' && ok "triggers = schedule + workflow_dispatch only; permissions contents:read; actions pinned to 40-hex SHAs; secrets only via env:" || bad "workflow structure"
import re,sys
t=open(sys.argv[1]).read()
on=t.split("\non:",1)[1].split("\npermissions:",1)[0]
assert re.findall(r"^  (\w+):",on,re.M)==["schedule","workflow_dispatch"], on
assert re.search(r"\npermissions:\n  contents: read\n",t)
uses=re.findall(r"uses: (\S+)",t); assert uses and all(re.search(r"@[0-9a-f]{40}$",u) for u in uses), uses
for m in re.finditer(r"secrets\.\w+",t):
    line=t[:m.start()].rsplit("\n",1)[1]; assert re.match(r"\s+TELEGRAM_\w+: \$\{\{",line), line
assert not re.search(r"pull_request|issues:|push:",on)
mins=[int(x) for x in re.search(r'cron: "([\d,]+) ',t).group(1).split(",")]
gaps={(b-a) for a,b in zip(mins,mins[1:])}; assert min(gaps)>=5, gaps
PY

echo "== 2b. phase switching (stage -> dark -> www) rewrites only the target and every phase is a valid config"
cp "$STAGED/targets.toml" "$SB/targets.orig"
for ph in stage dark www; do
  bash "$HERE/sentinel-phase.sh" --repo "$STAGED" --phase "$ph" >/dev/null 2>&1 && python3.12 -I "$STAGED/sentinel.py" --config "$STAGED/targets.toml" --plan >"$SB/plan.$ph" 2>&1 && ( cd "$STAGED" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 ) && ok "phase $ph: valid config, SHA256SUMS refreshed and verifying, plan: $(grep -o 'https://[^ ]*' "$SB/plan.$ph" | head -1)" || { bad "phase $ph"; cat "$SB/plan.$ph"; }
done
cmp -s "$STAGED/targets.toml" "$SB/targets.orig" && ok "phase www is byte-identical to what prepare-sentinel-repo.sh staged" || bad "www phase differs from the staged file"
( cd "$STAGED" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 ) && ok "SHA256SUMS still matches after the round trip" || bad "SHA256SUMS mismatch"

echo "== 3. end to end against local stand-ins (python3.12)"
python3.12 -I "$HERE/sentinel_e2e.py" --repo "$STAGED" 2>&1 | tee "$SB/e2e.out"
grep -q "E2E RESULT: .* 0 failed" "$SB/e2e.out" && ok "end-to-end scenario run: 0 failures" || bad "end-to-end scenario run"
echo "== RESULT (wrapper checks): $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
