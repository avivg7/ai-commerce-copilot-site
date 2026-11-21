#!/usr/bin/env bash
# infra:test  --  runs every stack test and prints the total. No network, no ssh, no server; owner fixtures are touched only as documented in test_backup.sh.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
total_pass=0; total_fail=0; total_skip=0; failed=""
SUITES="test_lint.sh test_provision.sh test_p37_wpconfig.sh test_p38_brevo.sh test_p38_key.sh test_p38_rotation.sh test_p41_lineage.sh test_p42_turnstile_key.sh test_p42_activation.sh test_p44_trustanchor.sh test_promote.sh test_backup.sh test_release.sh test_plugin_publish.sh test_verify_published.sh test_verify_published_fixture.sh"   # the last one skips unless AICC_VERIFY_FIXTURE=1
[ "${AICC_INFRA_TEST_UBUNTU:-1}" = "0" ] || SUITES="$SUITES test_ubuntu.sh"      # needs the Docker daemon; prints "skipped" without it
for t in $SUITES; do
  echo; echo "################ $t"
  out="$(bash "$HERE/$t" 2>&1)"; rc=$?
  printf '%s\n' "$out" | grep -vE '^ok ' 
  line="$(printf '%s\n' "$out" | grep -E '^[a-z0-9.-]+: [0-9]+ passed' | tail -1)"
  p="$(echo "$line" | sed -n 's/.*: \([0-9]*\) passed.*/\1/p')"; f="$(echo "$line" | sed -n 's/.* \([0-9]*\) failed.*/\1/p')"; s="$(echo "$line" | sed -n 's/.* \([0-9]*\) skipped.*/\1/p')"
  total_pass=$((total_pass + ${p:-0})); total_fail=$((total_fail + ${f:-0})); total_skip=$((total_skip + ${s:-0}))
  [ "$rc" = 0 ] || failed="$failed $t"
done
echo; echo "================ infra:test TOTAL: $total_pass passed, $total_fail failed, $total_skip skipped"
[ -z "$failed" ] || { echo "failed suites:$failed"; exit 1; }
