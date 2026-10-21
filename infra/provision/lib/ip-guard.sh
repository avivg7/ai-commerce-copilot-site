#!/usr/bin/env bash
# Sourced library: aicc_ip_guard <value> [label]  ->  returns 0 for a canonical, non-production address; prints "REFUSED: ..." to stderr and returns 3 otherwise.
# One implementation (ip-guard.py) for every Mac-side tool that takes a target address (security review L5): never a string compare against a deny list.
AICC_IPGUARD_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ip-guard.py"
aicc_ip_guard() {
  local v="${1-}" what="${2:-the address} " out
  command -v python3 >/dev/null 2>&1 || { echo "REFUSED: python3 is required to check ${what}(fail closed)" >&2; return 3; }
  if ! out="$(python3 -I "$AICC_IPGUARD_PY" "$v" 2>&1)"; then echo "REFUSED: ${what}'${v}': ${out}" >&2; return 3; fi
  return 0
}
