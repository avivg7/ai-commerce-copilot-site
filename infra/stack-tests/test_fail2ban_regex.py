#!/usr/bin/env python3
"""Executes the fail2ban filter regexes of infra/fail2ban with Python `re` (fail2ban itself is not installed on the authoring Mac) against
(a) REAL access-log lines written by Caddy 2.11.7 during the edge rehearsal (~/aicc-rehearsal/logs/aicc-edge.log), and
(b) synthetic variants of those lines (same field order; method/uri/status replaced), and compares the matches with a ground truth computed by JSON parsing.
What this proves: the patterns match exactly the lines they are meant to match in the real log shape, and cannot be forged from headers or query strings.
What it does NOT prove: fail2ban's own date parsing (datepattern) and ban actions: verify on the host with fail2ban-regex (documented)."""
import json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
HOST_RE = r"(?P<host>(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+)"


def load(path):
    text = open(path).read()
    m = re.search(r"(?ms)^failregex\s*=\s*(.*?)^(?:ignoreregex|datepattern)", text)
    regs = [l.strip() for l in m.group(1).splitlines() if l.strip()]
    ig = re.search(r"(?m)^ignoreregex\s*=\s*(.*)$", text)
    ignore = [ig.group(1).strip()] if ig and ig.group(1).strip() else []
    # NOTE: compiled WITHOUT re.I on purpose: fail2ban compiles failregex case-sensitively (verified on the real thing), so the patterns must carry (?i:...) themselves
    return ([re.compile(r.replace("<HOST>", HOST_RE)) for r in regs], [re.compile(r.replace("<HOST>", HOST_RE)) for r in ignore])


def matches(filt, line):
    fails, ignores = filt
    if any(i.search(line) for i in ignores):
        return None
    for f in fails:
        m = f.search(line)
        if m:
            return m.group("host")
    return None


login_filter = load(os.path.join(ROOT, "../fail2ban/filter.d-aicc-wp-login.conf"))
flood_filter = load(os.path.join(ROOT, "../fail2ban/filter.d-caddy-4xx-flood.conf"))

LOGIN_PATHS = re.compile(r"^(?:/(?:he|es|ru))?/(?:my-account(?:/lost-password)?/?|wp-login\.php)$")
PROBE_TOK = ("/wp-login.php", "/xmlrpc.php", "/wp-admin/", "/wp-cron.php")


def truth_login(j):
    req = j["request"]; uri = req["uri"].split("?")[0].lower(); st = j["status"]
    a = req["method"] == "POST" and bool(LOGIN_PATHS.match(uri))
    b = st in (403, 429) and any(t in uri for t in PROBE_TOK)
    return a or b


def truth_flood(j):
    uri = j["request"]["uri"]
    if uri.startswith(("/.well-known/acme-challenge/", "/favicon.ico")):
        return False
    return 400 <= j["status"] <= 499


log = os.path.expanduser("~/aicc-rehearsal/logs/aicc-edge.log")
lines = []
if os.path.exists(log):
    with open(log) as f:
        for i, l in enumerate(f):
            if i >= 20000:
                break
            if l.startswith('{"level"') and '"handled request"' in l:
                lines.append(l.rstrip("\n"))
real = len(lines)
base = next((json.loads(l) for l in lines if '"method":"GET"' in l), None)
if base is None:
    print("no real Caddy access-log lines found: using a hand-written sample of the same shape")
    base = json.loads('{"level":"info","ts":1792517469.398648,"logger":"http.log.access.log3","msg":"handled request","request":{"remote_ip":"203.0.113.9","remote_port":"58764","client_ip":"203.0.113.9","proto":"HTTP/2.0","method":"GET","host":"stage.copilt.org","uri":"/x","headers":{"User-Agent":["curl/8"]},"tls":{"resumed":false}},"bytes_read":0,"user_id":"","duration":0.0003,"size":364,"status":200,"resp_headers":{"Cache-Control":["no-store"]},"request_id":"abc","upstream":""}')


def synth(method, uri, status, ip="198.51.100.7", ua=None, referer=None):
    j = json.loads(json.dumps(base))
    j["request"]["method"] = method; j["request"]["uri"] = uri; j["request"]["remote_ip"] = ip; j["request"]["client_ip"] = ip; j["status"] = status
    if ua is not None: j["request"]["headers"]["User-Agent"] = [ua]
    if referer is not None: j["request"]["headers"]["Referer"] = [referer]
    return json.dumps(j, separators=(",", ":"))


syn = []
for m in ("GET", "POST"):
    for uri in ("/my-account/", "/my-account", "/he/my-account/", "/my-account/lost-password/", "/my-account/?redirect=1", "/wp-login.php", "/wp-login.php?action=logout", "/checkout/", "/pricing/", "/wp-json/aicc/v1/x", "/my-account/orders/"):
        for st in (200, 302, 403, 404, 429, 500):
            syn.append(synth(m, uri, st))
for uri in ("/xmlrpc.php", "/wp-admin/", "/wp-admin/options.php", "/wp-cron.php", "/WP-LOGIN.PHP", "/pricing/?next=/wp-login.php"):
    for st in (200, 403, 429, 404):
        syn.append(synth("GET", uri, st))
# forgery attempts: header/query content that LOOKS like log fields must not count (inner quotes are escaped in JSON)
forged = [
    synth("GET", "/pricing/", 200, ua='x","method":"POST","uri":"/wp-login.php","status":403,"y":"'),
    synth("GET", "/pricing/", 200, referer='https://e/?a="method":"POST"&b="uri":"/my-account/"'),
    synth("GET", "/pricing/?q=\"method\":\"POST\",\"uri\":\"/wp-login.php\"", 200),
]
allv = lines + syn + forged
bad = 0; counts = {"login": 0, "flood": 0}
for l in allv:
    j = json.loads(l)
    want = truth_login(j); got = matches(login_filter, l) is not None
    if want != got:
        bad += 1; print("LOGIN MISMATCH want=%s got=%s %s %s %s" % (want, got, j["request"]["method"], j["request"]["uri"], j["status"]))
    counts["login"] += got
    want = truth_flood(j); got = matches(flood_filter, l) is not None
    if want != got:
        bad += 1; print("FLOOD MISMATCH want=%s got=%s %s %s" % (want, got, j["request"]["uri"], j["status"]))
    counts["flood"] += got
for l in forged:
    if matches(login_filter, l) is not None:
        bad += 1; print("FORGED LINE COUNTED: " + l[:120])
# the captured address is the TCP peer, not something else
l = synth("POST", "/my-account/", 200, ip="203.0.113.77")
if matches(login_filter, l) != "203.0.113.77":
    bad += 1; print("host capture wrong")
l6 = synth("POST", "/wp-login.php", 200, ip="2001:db8::1")
if matches(login_filter, l6) != "2001:db8::1":
    bad += 1; print("IPv6 host capture wrong")
print("%d real log line(s) + %d synthetic + %d forged; login-filter matches=%d, 4xx-filter matches=%d; mismatches=%d" % (real, len(syn), len(forged), counts["login"], counts["flood"], bad))
sys.exit(1 if bad else 0)
