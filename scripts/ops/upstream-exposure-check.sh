#!/usr/bin/env bash
# Is the WordPress upstream reachable from somewhere it must not be?  (Only meaningful for the reverse_proxy form: with php_fastcgi over a unix socket there is NO network upstream, see scripts/ops/edge-listener-audit.sh.)
#  (runbook 1.1 precondition, security review: "add a readiness check")
#
#   scripts/ops/upstream-exposure-check.sh --target <address-of-the-upstream-as-others-see-it>:<port>  [--expect-reachable]
#
# The Control Plane believes X-Forwarded-For / X-Forwarded-Proto / Host from any peer whose address is in AICC_LM_TRUSTED_PROXIES (the edge). Anything else that can open
# a connection to the upstream port can therefore forge its client address (defeating every per-IP rate limit) and its Host. The upstream must listen on a private interface
# AND be firewalled to the edge. This script proves the negative from the vantage point where it runs:
#   1. can I open a TCP connection to <target>?                              reachable -> EXPOSED (exit 1)
#   2. if it is reachable anyway: does a forged X-Forwarded-For request get an HTTP answer?   (reported; the connection alone is already the failure)
# Run it from a machine that is NOT the edge (another server, your laptop through the VPN, a cloud shell) against the upstream's private AND public addresses, and from the
# edge host itself with --expect-reachable as the positive control (the edge MUST reach it). Exit codes: 0 as expected, 1 not as expected (exposed / edge cannot reach), 3 cannot tell.
set -u
TARGET=""; EXPECT=0
while [ $# -gt 0 ]; do case "$1" in --target) TARGET="$2"; shift 2 ;; --expect-reachable) EXPECT=1; shift ;; *) echo "usage: $0 --target host:port [--expect-reachable]" >&2; exit 3 ;; esac; done
[[ "$TARGET" == *:* ]] || { echo "usage: $0 --target host:port [--expect-reachable]" >&2; exit 3; }
host="${TARGET%:*}"; port="${TARGET##*:}"
# FAIL CLOSED (same rule as scripts/lib/target-guard.mjs): this probe sends a request with a production Host header, so the TARGET must never be a production name or a known production address.
case "$host" in
	www.copilt.org|copilt.org|api.copilt.org|139.59.157.231|185.199.108.153|185.199.109.153|185.199.110.153|185.199.111.153|::ffff:139.59.157.231)
		echo "REFUSED: $host is a production name/address; this probe never talks to production. Nothing was sent." >&2; exit 3 ;;
	*.copilt.org) case "$host" in stage*.copilt.org) ;; *) echo "REFUSED: $host is under the production domain and is not a stage* name. Nothing was sent." >&2; exit 3 ;; esac ;;
esac
reachable=0
if command -v timeout >/dev/null 2>&1; then ( timeout 5 bash -c "exec 3<>/dev/tcp/$host/$port" ) 2>/dev/null && reachable=1
else ( bash -c "exec 3<>/dev/tcp/$host/$port" ) 2>/dev/null && reachable=1; fi
forged=""
if [ "$reachable" = 1 ] && command -v curl >/dev/null 2>&1; then
	forged="$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H 'Host: www.copilt.org' -H 'X-Forwarded-For: 203.0.113.9' -H 'X-Forwarded-Proto: https' "http://$host:$port/wp-json/" 2>/dev/null)"
fi
if [ "$EXPECT" = 1 ]; then
	if [ "$reachable" = 1 ]; then echo "OK: $TARGET is reachable from here (positive control; forged-XFF request answered: ${forged:-n/a})"; exit 0; fi
	echo "FAIL: $TARGET is NOT reachable from here, but this vantage point is supposed to be the edge" >&2; exit 1
fi
if [ "$reachable" = 1 ]; then
	echo "EXPOSED: $TARGET accepts connections from this vantage point; a forged X-Forwarded-For/Host request was answered with HTTP ${forged:-?}. Bind the upstream to a private interface and firewall it to the edge." >&2
	exit 1
fi
echo "OK: $TARGET is not reachable from this vantage point (connection refused / filtered)"
exit 0
