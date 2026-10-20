#!/usr/bin/env bash
# Health probe for a Control Plane release, used by activate-release.sh as the post-swap gate. Exit 0 = healthy.
# It talks FastCGI directly to the PHP-FPM socket (cgi-fcgi from libfcgi-bin), so it works before Caddy/DNS/TLS exist and it exercises exactly what the edge
# will: wp-config.php (symlink into /srv/aicc/shared), the database connection over the unix socket, WordPress core, WooCommerce and the AICC plugin/theme.
# Request: GET /?rest_route=/  (the REST index; works whatever the permalink setting is). Healthy = HTTP 200, JSON containing "namespaces", no "critical error".
# Environment: AICC_RELEASE_DIR (required: the directory to serve, e.g. /srv/aicc/cp/current), AICC_PHP_SOCKET (default /run/php/aicc-cp.sock), AICC_SMOKE_HOST (default stage.copilt.org)
set -euo pipefail
dir="${AICC_RELEASE_DIR:?AICC_RELEASE_DIR required}"; sock="${AICC_PHP_SOCKET:-/run/php/aicc-cp.sock}"; host="${AICC_SMOKE_HOST:-stage.copilt.org}"
command -v cgi-fcgi >/dev/null 2>&1 || { echo "smoke-cp: cgi-fcgi not installed (apt: libfcgi-bin)" >&2; exit 2; }
[ -S "$sock" ] || { echo "smoke-cp: PHP socket $sock missing" >&2; exit 1; }
real="$(cd "$dir" && pwd -P)"
out="$(REQUEST_METHOD=GET SCRIPT_FILENAME="$real/index.php" SCRIPT_NAME=/index.php DOCUMENT_ROOT="$real" QUERY_STRING='rest_route=/' REQUEST_URI='/?rest_route=/' \
  SERVER_NAME="$host" HTTP_HOST="$host" HTTPS=on REMOTE_ADDR=127.0.0.1 SERVER_PROTOCOL=HTTP/1.1 GATEWAY_INTERFACE=CGI/1.1 HTTP_ACCEPT=application/json \
  cgi-fcgi -bind -connect "$sock" 2>&1)" || { echo "smoke-cp: cgi-fcgi failed" >&2; exit 1; }
status="$(printf '%s\n' "$out" | sed -n 's/^Status: \([0-9]*\).*/\1/p' | head -1)"; status="${status:-200}"
# FIRST INSTALL ONLY (activate-release.sh --allow-uninstalled): before `wp core install` WordPress answers every front-end request with a redirect to
# wp-admin/install.php. Reaching that redirect proves PHP, wp-config.php, the database connection and WordPress core all load; it is accepted once, explicitly.
if [ "${AICC_SMOKE_ALLOW_UNINSTALLED:-0}" = "1" ] && [ "$status" = "302" ] && printf '%s' "$out" | grep -qi '^Location:.*wp-admin/install\.php'; then
  echo "smoke-cp: ok (WordPress is not installed yet: install redirect served from $real; accepted because of --allow-uninstalled)"; exit 0
fi
[ "$status" = "200" ] || { echo "smoke-cp: HTTP $status" >&2; exit 1; }
printf '%s' "$out" | grep -q '"namespaces"' || { echo "smoke-cp: REST index has no namespaces" >&2; exit 1; }
printf '%s' "$out" | grep -qi 'critical error' && { echo "smoke-cp: WordPress critical error page" >&2; exit 1; }
echo "smoke-cp: ok (HTTP 200, REST index served from $real)"
