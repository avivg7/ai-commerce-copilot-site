#!/usr/bin/env bash
# Tiny test harness for infra/stack-tests (bash 3.2 compatible: runs on the Mac). Source it, call t_ok / t_fail / t_eq / t_contains, finish with t_summary.
T_PASS=0; T_FAIL=0; T_SKIP=0; T_FAILED_NAMES=""
t_pass() { T_PASS=$((T_PASS + 1)); printf 'ok      %s\n' "$1"; }
t_bad()  { T_FAIL=$((T_FAIL + 1)); T_FAILED_NAMES="$T_FAILED_NAMES\n  - $1"; printf 'NOT OK  %s\n' "$1"; [ -n "${2:-}" ] && printf '        %s\n' "$2"; return 0; }
t_skip() { T_SKIP=$((T_SKIP + 1)); printf 'skip    %s (%s)\n' "$1" "$2"; }
# t_ok <name> <cmd...>: passes when the command exits 0 (output hidden, shown on failure)
t_ok() { local n="$1"; shift; local out; if out="$("$@" 2>&1)"; then t_pass "$n"; else t_bad "$n" "$(printf '%s' "$out" | tail -5 | tr '\n' '|')"; fi; }
# t_fail <name> <cmd...>: passes when the command exits NON-zero
t_fail() { local n="$1"; shift; local out; if out="$("$@" 2>&1)"; then t_bad "$n" "expected a non-zero exit but got 0: $(printf '%s' "$out" | tail -3 | tr '\n' '|')"; else t_pass "$n"; fi; }
# t_rc <name> <expected-rc> <cmd...>
t_rc() { local n="$1" want="$2"; shift 2; local out rc=0; out="$("$@" 2>&1)" || rc=$?; if [ "$rc" = "$want" ]; then t_pass "$n"; else t_bad "$n" "exit $rc, wanted $want: $(printf '%s' "$out" | tail -3 | tr '\n' '|')"; fi; }
t_eq() { if [ "$2" = "$3" ]; then t_pass "$1"; else t_bad "$1" "expected '$3' got '$2'"; fi; }
t_contains() { case "$2" in *"$3"*) t_pass "$1" ;; *) t_bad "$1" "output lacks '$3': $(printf '%s' "$2" | tail -3 | tr '\n' '|')" ;; esac; }
t_not_contains() { case "$2" in *"$3"*) t_bad "$1" "output contains '$3'" ;; *) t_pass "$1" ;; esac; }
t_summary() {
  printf '\n%s: %d passed, %d failed, %d skipped\n' "${T_SUITE:-suite}" "$T_PASS" "$T_FAIL" "$T_SKIP"
  [ "$T_FAIL" = 0 ] || { printf 'failed:%b\n' "$T_FAILED_NAMES"; return 1; }
  return 0
}
