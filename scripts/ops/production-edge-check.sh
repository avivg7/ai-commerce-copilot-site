#!/usr/bin/env bash
# Read-only public-behaviour check of the PRODUCTION edge, run from the Mac. GET / HEAD only: no cookie is stored, no form is submitted, nothing is written anywhere.
#
#   scripts/ops/production-edge-check.sh --ip <edge IPv4> --cacert <Caddy root.crt> [--port 443] [--http-port 80] [--host www.copilt.org] [--apex copilt.org] [--full-demo-hash] [--expect-hsts 300]
#   scripts/ops/production-edge-check.sh --ip <edge IPv4> --public                          (after the cutover: the certificate must verify against the system trust store)
#
# DARK PRODUCTION (before DNS moves): the edge presents Caddy's INTERNAL CA certificate, so pass --cacert with the root certificate that Caddy created on the host
# (/var/lib/aicc-edge/.local/share/caddy/pki/authorities/local/root.crt; it is a PUBLIC certificate, not a key; copy it with scp). The names are only ever SNI/Host values for a connection forced to
# --ip (curl --resolve): public DNS is never consulted, so a check before the cutover cannot reach the old GitHub Pages site. The script refuses a --ip that is a GitHub Pages address, the API Droplet,
# or not a literal IPv4.
#
# What it checks (each line prints PASS/FAIL): the edge answers /healthz; http redirects in ONE hop to https://www; the apex 301s to www keeping path and query; canonical www and no noindex
# anywhere (header or meta); security headers and the HSTS value (default 300 s, never includeSubDomains/preload); no Server/X-Powered-By/Via/Alt-Svc; the locale pages /he /es /ru; the demo asset
# delivery (Accept-Ranges, a 206 for a Range request, optionally the full-file sha256 against docs/approved-demo.sha256); WordPress-owned pages answer from WordPress; the operator-only surfaces
# (wp-login, wp-admin, wp-cron, xmlrpc) are 403 on the PUBLIC listener; no staging identity route; dependency manifests/secrets paths are not served; unknown Host is refused (421); the branded 404;
# and from this machine the operator listener (8443), the Caddy admin API (12019), AICC Ops (9190), MySQL (3306) and PHP-FPM (9000) are NOT reachable.
# Exit 0 = every check passed, 1 = at least one failed, 2 = usage, 3 = refused target.
set -u
IP=""; PORT=443; HPORT=80; HOST="www.copilt.org"; APEX="copilt.org"; CACERT=""; PUBLIC=0; FULLHASH=0; HSTS=300; HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    --ip) IP="${2:-}"; shift 2 ;; --port) PORT="${2:-}"; shift 2 ;; --http-port) HPORT="${2:-}"; shift 2 ;; --host) HOST="${2:-}"; shift 2 ;; --apex) APEX="${2:-}"; shift 2 ;;
    --cacert) CACERT="${2:-}"; shift 2 ;; --public) PUBLIC=1; shift ;; --full-demo-hash) FULLHASH=1; shift ;; --expect-hsts) HSTS="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,22p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "--ip must be a literal IPv4 address" >&2; exit 2; }
for d in 139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153; do [ "$IP" = "$d" ] && { echo "REFUSED: $IP is the API Droplet or a GitHub Pages address, not the new edge" >&2; exit 3; }; done
[ "$PUBLIC" = 1 ] || { [ -n "$CACERT" ] && [ -r "$CACERT" ] || { echo "dark production needs --cacert <Caddy root.crt> (or --public after the cutover)" >&2; exit 2; }; }
command -v curl >/dev/null && command -v python3 >/dev/null || { echo "curl and python3 are required" >&2; exit 2; }
CA=(); [ "$PUBLIC" = 1 ] || CA=(--cacert "$CACERT")
FAILS=0; PASSES=0
ok() { PASSES=$((PASSES + 1)); printf 'PASS  %s\n' "$*"; }
bad() { FAILS=$((FAILS + 1)); printf 'FAIL  %s\n' "$*"; }
chk() { # chk <description> <condition-exit-status>
  if [ "$2" = 0 ]; then ok "$1"; else bad "$1"; fi; }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/pec.XXXX")"; trap 'rm -rf "$TMP"' EXIT
# req <name> <host> <scheme> <path> [curl args...]: writes $TMP/<name>.h (headers) and $TMP/<name>.b (body); status in $TMP/<name>.s. Never follows redirects.
req() {
  local n="$1" h="$2" sch="$3" p="$4"; shift 4
  local port=$PORT; [ "$sch" = http ] && port=$HPORT
  curl -sS --max-time 40 -o "$TMP/$n.b" -D "$TMP/$n.h" -w '%{http_code}' --resolve "$h:$port:$IP" ${CA[@]+"${CA[@]}"} "$@" "$sch://$h:$port$p" > "$TMP/$n.s" 2> "$TMP/$n.e" || echo 000 > "$TMP/$n.s"
}
st() { cat "$TMP/$1.s"; }
hdr() { grep -i "^$2:" "$TMP/$1.h" 2>/dev/null | tail -1 | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r'; }
has_hdr() { grep -qi "^$2:" "$TMP/$1.h" 2>/dev/null; }
body_has() { grep -q -- "$2" "$TMP/$1.b" 2>/dev/null; }
# a Location header with the explicit test port removed (only a non-443 --port, i.e. a high-port twin/rehearsal edge, puts ":PORT" into absolute redirects)
loc() { hdr "$1" location | sed "s#^\(https://[^/]*\):$PORT#\1#; s#^\(http://[^/]*\):$HPORT#\1#"; }
# a response WordPress made: any of the markers a real WordPress sends (REST Link header, nocache Expires date in 1984, X-Redirect-By)
is_wp() { hdr "$1" link | grep -qi 'api.w.org' || hdr "$1" expires | grep -q '1984' || hdr "$1" x-redirect-by | grep -qi wordpress; }

echo "== edge: $HOST / $APEX at $IP:$PORT ($([ "$PUBLIC" = 1 ] && echo 'public CA' || echo "CA file $CACERT")) =="
req health "$HOST" https /healthz
chk "/healthz answers 200 'ok' from Caddy itself" "$([ "$(st health)" = 200 ] && body_has health '^ok$'; echo $?)"
chk "/healthz is never cached" "$(hdr health cache-control | grep -qi 'no-store'; echo $?)"

echo "== headers on every kind of answer =="
for pair in "home:/" "pricing:/pricing/" "e404:/definitely-not-here-$$/" "robots:/robots.txt"; do
  n="${pair%%:*}"; p="${pair#*:}"; req "$n" "$HOST" https "$p"
  chk "$p: HSTS max-age=$HSTS, no includeSubDomains, no preload" "$(hdr "$n" strict-transport-security | grep -Eqx "max-age=$HSTS"; echo $?)"
  chk "$p: X-Content-Type-Options nosniff, Referrer-Policy and X-Frame-Options set" "$( { has_hdr "$n" x-content-type-options && has_hdr "$n" referrer-policy && has_hdr "$n" x-frame-options; } ; echo $?)"
  chk "$p: no Server / X-Powered-By / Via / Alt-Svc header" "$(if has_hdr "$n" server || has_hdr "$n" x-powered-by || has_hdr "$n" via || has_hdr "$n" alt-svc; then echo 1; else echo 0; fi)"
  chk "$p: no X-Robots-Tag (production must never send noindex)" "$(if has_hdr "$n" x-robots-tag; then echo 1; else echo 0; fi)"
  chk "$p: X-Request-Id present" "$(has_hdr "$n" x-request-id; echo $?)"
done
chk "/: 200 from the static site" "$([ "$(st home)" = 200 ]; echo $?)"
chk "/: canonical link is on $HOST (never the staging name, never localhost)" "$(grep -Eqi "rel=\"canonical\"[^>]*href=\"https://$HOST/|href=\"https://$HOST/[^\"]*\"[^>]*rel=\"canonical\"" "$TMP/home.b"; echo $?)"
chk "/: no noindex robots meta" "$(if grep -Eqi '<meta[^>]+name="robots"[^>]*noindex' "$TMP/home.b"; then echo 1; else echo 0; fi)"
chk "/: no staging / localhost / http:// self URL in the HTML" "$(if grep -Eqi 'stage\.copilt\.org|127\.0\.0\.1|localhost|http://www\.copilt\.org' "$TMP/home.b"; then echo 1; else echo 0; fi)"
chk "/: the Content-Security-Policy-Report-Only header is present on static pages (enforced CSP is a later decision)" "$(has_hdr home content-security-policy-report-only; echo $?)"
chk "branded 404 has status 404" "$([ "$(st e404)" = 404 ]; echo $?)"
chk "/robots.txt: 200, no blanket 'Disallow: /', names the sitemap on $HOST" "$( { [ "$(st robots)" = 200 ] && ! grep -Eq '^Disallow:[[:space:]]*/[[:space:]]*$' "$TMP/robots.b" && grep -qi "sitemap: https://$HOST/" "$TMP/robots.b"; }; echo $?)"
req sitemap "$HOST" https /sitemap.xml
chk "/sitemap.xml: 200 and lists only $HOST URLs" "$( { [ "$(st sitemap)" = 200 ] && grep -q "https://$HOST/" "$TMP/sitemap.b" && ! grep -Eqi 'stage\.copilt\.org|<loc>[[:space:]]*http://|localhost' "$TMP/sitemap.b"; }; echo $?)"

echo "== redirects: http -> https://www in one hop, apex -> www =="
req h1 "$HOST" http "/x?y=1"
chk "http://$HOST/x?y=1 -> 301 https://$HOST/x?y=1 (one hop)" "$( { [ "$(st h1)" = 301 ] && [ "$(loc h1)" = "https://$HOST/x?y=1" ]; }; echo $?)"
req h2 "$APEX" http "/x?y=1"
chk "http://$APEX/x?y=1 -> 301 https://$HOST/x?y=1 (one hop, no http->https->www chain)" "$( { [ "$(st h2)" = 301 ] && [ "$(loc h2)" = "https://$HOST/x?y=1" ]; }; echo $?)"
req a1 "$APEX" https "/pricing/?plan=studio"
chk "https://$APEX/pricing/?plan=studio -> 301 https://$HOST/pricing/?plan=studio" "$( { [ "$(st a1)" = 301 ] && [ "$(loc a1)" = "https://$HOST/pricing/?plan=studio" ]; }; echo $?)"
chk "the apex redirect also carries HSTS $HSTS" "$(hdr a1 strict-transport-security | grep -Eqx "max-age=$HSTS"; echo $?)"
req hx evil.example http /
chk "an unknown Host is refused with 421 (no redirect to a foreign host)" "$([ "$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "http://$IP:$HPORT/" 2>/dev/null)" = 421 ]; echo $?)"

echo "== locale routing =="
for l in he es ru; do
  req "l$l" "$HOST" https "/$l/"
  chk "/$l/: 200, <html lang=\"$l\"...>" "$( { [ "$(st l$l)" = 200 ] && grep -Eqi "<html[^>]*lang=\"$l" "$TMP/l$l.b"; }; echo $?)"
done
chk "/he/ is right-to-left" "$(grep -Eqi '<html[^>]*dir="rtl"' "$TMP/lhe.b"; echo $?)"
chk "/he/ canonical stays on $HOST" "$(grep -Eqi "rel=\"canonical\"[^>]*href=\"https://$HOST/he/|href=\"https://$HOST/he/\"[^>]*rel=\"canonical\"" "$TMP/lhe.b"; echo $?)"
req hepr "$HOST" https /he/pricing/
chk "/he/pricing/ is served by WordPress under the language prefix" "$( { [ "$(st hepr)" = 200 ] && is_wp hepr; }; echo $?)"

echo "== demo asset delivery =="
req dh "$HOST" https /demo/aicc-demo.mp4 -I
chk "/demo/aicc-demo.mp4: 200, video/mp4, Accept-Ranges: bytes" "$( { [ "$(st dh)" = 200 ] && hdr dh content-type | grep -qi 'video/mp4' && hdr dh accept-ranges | grep -qi bytes; }; echo $?)"
req dr "$HOST" https /demo/aicc-demo.mp4 -H 'Range: bytes=0-1023'
chk "a Range request returns 206 with 1024 bytes" "$( { [ "$(st dr)" = 206 ] && [ "$(wc -c < "$TMP/dr.b" | tr -d ' ')" = 1024 ]; }; echo $?)"
req dv "$HOST" https /demo/aicc-demo.vtt
chk "/demo/aicc-demo.vtt (captions) 200 and starts with WEBVTT" "$( { [ "$(st dv)" = 200 ] && head -c 6 "$TMP/dv.b" | grep -q WEBVTT; }; echo $?)"
req dp "$HOST" https /demo/aicc-demo-poster.jpg -I
chk "/demo/aicc-demo-poster.jpg 200" "$([ "$(st dp)" = 200 ]; echo $?)"
if [ "$FULLHASH" = 1 ]; then
  WANT="$(cut -d' ' -f1 "$HERE/../../docs/approved-demo.sha256" 2>/dev/null | head -1)"
  curl -sS --max-time 300 --resolve "$HOST:$PORT:$IP" ${CA[@]+"${CA[@]}"} -o "$TMP/demo.mp4" "https://$HOST:$PORT/demo/aicc-demo.mp4" 2>/dev/null
  GOT="$(shasum -a 256 "$TMP/demo.mp4" 2>/dev/null | cut -d' ' -f1)"
  chk "the served demo video is byte-identical to the approved master (sha256 ${WANT:0:16}...)" "$([ -n "$WANT" ] && [ "$GOT" = "$WANT" ]; echo $?)"
fi

echo "== WordPress-owned routes answer from WordPress; operator surfaces are closed on the public listener =="
req acc "$HOST" https /my-account/
chk "/my-account/: answered by WordPress (200, or WordPress's own one canonical redirect only when testing on a non-443 port)" "$( { { [ "$(st acc)" = 200 ] || { [ "$PORT" != 443 ] && [ "$(st acc)" = 301 ]; }; } && is_wp acc; }; echo $?)"
chk "/my-account/ is never cached publicly" "$(hdr acc cache-control | grep -Eqi 'no-store|private|no-cache'; echo $?)"
chk "/my-account/: any WordPress cookie it sets is Secure and SameSite" "$(if grep -i '^set-cookie:' "$TMP/acc.h" | grep -viq 'secure'; then echo 1; elif grep -i '^set-cookie:' "$TMP/acc.h" | grep -i 'wordpress_\|wp-settings' | grep -viq 'samesite'; then echo 1; else echo 0; fi)"
req pr "$HOST" https /pricing/
chk "/pricing/: 200 from WordPress, canonical on $HOST, no noindex" "$( { [ "$(st pr)" = 200 ] && is_wp pr && grep -Eqi "rel=\"canonical\"[^>]*href=\"https://$HOST/pricing/|href=\"https://$HOST/pricing/\"[^>]*rel=\"canonical\"" "$TMP/pr.b" && ! grep -Eqi '<meta[^>]+name=.robots.[^>]*noindex' "$TMP/pr.b"; }; echo $?)"
req wcajax "$HOST" https "/?wc-ajax=get_refreshed_fragments"
chk "/?wc-ajax=get_refreshed_fragments is WordPress JSON, never cached" "$( { [ "$(st wcajax)" = 200 ] && hdr wcajax cache-control | grep -qi 'no-store\|private\|no-cache' && ! grep -qi '<html' "$TMP/wcajax.b"; }; echo $?)"
for p in /wp-login.php /wp-admin/ /wp-cron.php /xmlrpc.php; do req "x$$" "$HOST" https "$p"; chk "public listener: $p is 403" "$([ "$(st "x$$")" = 403 ]; echo $?)"; done
req lo "$HOST" https "/wp-login.php?loggedout=true"
chk "the GET ?loggedout=true shape of wp-login.php is public (customer logout lands there), every other shape is 403" "$([ "$(st lo)" != 403 ]; echo $?)"
req lp "$HOST" https "/wp-login.php?action=lostpassword"
chk "/wp-login.php?action=lostpassword is 403 on the public listener (customers use /my-account/lost-password/)" "$([ "$(st lp)" = 403 ]; echo $?)"
req idn "$HOST" https /.well-known/aicc-stage-identity
chk "no staging identity route (404; a rehearsal or staging edge FAILS this on purpose)" "$([ "$(st idn)" = 404 ]; echo $?)"
for p in /package.json /composer.json /.env /.git/config /wp-config.php /readme.html /wp-content/debug.log /license.txt /plugin-releases/ /plugin-releases/current /srv/aicc/shared/plugin-releases/current /.git/HEAD /.htaccess /.DS_Store /backup.sql /db.dump /site.zip /export.tar.gz /config.yml /wp-content/uploads/woocommerce_uploads/x.pdf /wp-content/uploads/wc-logs/fatal-errors.log /wp-content/uploads/wc-logs/a.log.gz /wp-content/backups/db.txt; do
  req "m$$" "$HOST" https "$p"; c="$(st "m$$")"; chk "$p is not served ($c)" "$([ "$c" = 404 ] || [ "$c" = 403 ] || [ "$c" = 301 ] || [ "$c" = 308 ]; echo $?)"
done

echo "== listeners that must NOT be reachable from here =="
for pp in 8443 12019 9190 3306 9000 33060; do
  if nc -z -G 4 "$IP" "$pp" >/dev/null 2>&1 || nc -z -w 4 "$IP" "$pp" >/dev/null 2>&1; then bad "port $pp on $IP is OPEN (must be closed from the internet; a loopback test of a local rehearsal edge legitimately shows its own admin port)"; else ok "port $pp on $IP is closed or filtered"; fi
done
if nc -z -G 4 "$IP" "$PORT" >/dev/null 2>&1 || nc -z -w 4 "$IP" "$PORT" >/dev/null 2>&1; then ok "port $PORT is open (expected)"; else bad "port $PORT is NOT reachable"; fi

echo; echo "production-edge-check: $PASSES passed, $FAILS failed"
[ "$FAILS" = 0 ]
