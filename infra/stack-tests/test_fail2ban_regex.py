#!/usr/bin/env python3
"""Executes the fail2ban filter regexes of infra/fail2ban with Python `re` (fail2ban itself is not installed on the authoring Mac) against
(a) REAL access-log lines written by Caddy 2.11.7 during the edge rehearsal (~/aicc-rehearsal/logs/aicc-edge.log): the first lines are the OLD shape (request.headers / resp_headers maps), the last
    lines the CURRENT shape (header allow-list: flat req_* / resp_* fields after "status"; architecture review H-5), both are replayed, and
(b) synthetic variants of those lines in BOTH shapes (same field order; method/uri/status replaced), and compares the matches with a ground truth computed by JSON parsing.
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
    if j["status"] == 421:      # misdirected-request answers (unknown Host, e.g. scanners using the IP address) do not count (review M-6)
        return False
    return 400 <= j["status"] <= 499


log = os.path.expanduser("~/aicc-rehearsal/logs/aicc-edge.log")
lines = []
if os.path.exists(log):
    with open(log) as f:
        allp = [l.rstrip("\n") for l in f if l.startswith('{"level"') and '"handled request"' in l]
    lines = allp[:12000] + allp[-4000:]            # oldest lines (old shape) + newest lines (current shape)
real = len(lines)
OLD_SHAPE = '{"level":"info","ts":1792517469.398648,"logger":"http.log.access.log3","msg":"handled request","request":{"remote_ip":"203.0.113.9","remote_port":"58764","client_ip":"203.0.113.9","proto":"HTTP/2.0","method":"GET","host":"stage.copilt.org","uri":"/x","headers":{"User-Agent":["curl/8"]},"tls":{"resumed":false}},"bytes_read":0,"user_id":"","duration":0.0003,"size":364,"status":200,"resp_headers":{"Cache-Control":["no-store"]},"request_id":"abc","upstream":""}'
# the CURRENT shape, as written by the template's (edge_log) since the header allow-list: no header maps; the allow-listed headers are flat fields AFTER "status"
NEW_SHAPE = '{"level":"info","ts":1792517469.398648,"logger":"http.log.access.log3","msg":"handled request","request":{"remote_ip":"203.0.113.9","remote_port":"58764","client_ip":"203.0.113.9","proto":"HTTP/2.0","method":"GET","host":"stage.copilt.org","uri":"/x","tls":{"resumed":false,"version":772,"cipher_suite":4865,"proto":"h2","server_name":"stage.copilt.org"}},"bytes_read":0,"user_id":"","duration":0.0003,"size":364,"status":200,"uuid":"u1","resp_content_range":"","resp_location":"","resp_cache_control":"no-store","resp_content_encoding":"","resp_content_length":"","resp_content_type":"text/html","req_if_none_match":"","req_range":"","req_content_length":"","req_content_type":"","req_accept_language":"en","req_referer":"","req_user_agent":"curl/8","listener":"public","upstream":"","request_id":"abc"}'
bases = [json.loads(OLD_SHAPE), json.loads(NEW_SHAPE)]
if not real:
    print("no real Caddy access-log lines found: using hand-written samples of both shapes")


def synth(method, uri, status, ip="198.51.100.7", ua=None, referer=None, shape=1):
    j = json.loads(json.dumps(bases[shape]))
    j["request"]["method"] = method; j["request"]["uri"] = uri; j["request"]["remote_ip"] = ip; j["request"]["client_ip"] = ip; j["status"] = status
    if shape == 0:
        if ua is not None: j["request"]["headers"]["User-Agent"] = [ua]
        if referer is not None: j["request"]["headers"]["Referer"] = [referer]
    else:
        if ua is not None: j["req_user_agent"] = ua
        if referer is not None: j["req_referer"] = referer
    return json.dumps(j, separators=(",", ":"))


syn = []
for shape in (0, 1):
    for m in ("GET", "POST"):
        for uri in ("/my-account/", "/my-account", "/he/my-account/", "/my-account/lost-password/", "/my-account/?redirect=1", "/wp-login.php", "/wp-login.php?action=logout", "/checkout/", "/pricing/", "/wp-json/aicc/v1/x", "/my-account/orders/"):
            for st in (200, 302, 400, 403, 404, 421, 429, 500):
                syn.append(synth(m, uri, st, shape=shape))
    for uri in ("/xmlrpc.php", "/wp-admin/", "/wp-admin/options.php", "/wp-cron.php", "/WP-LOGIN.PHP", "/pricing/?next=/wp-login.php"):
        for st in (200, 403, 421, 429, 404):
            syn.append(synth("GET", uri, st, shape=shape))
    # review M-6: 421 answers to unknown Hosts (a scanner using the IP as host name) are not counted by the flood jail, whatever the path; its neighbours 420, 422 and 400-499 are
    for st in (419, 420, 421, 422, 429, 400, 499):
        syn.append(synth("GET", "/", st, ip="203.0.113.50", shape=shape))
    syn.append(synth("GET", "/robots.txt", 404, shape=shape))
    syn.append(synth("GET", "/robots.txt", 421, shape=shape))
# forgery attempts: header/query content that LOOKS like log fields must not count (inner quotes are escaped in JSON)
forged = []
for shape in (0, 1):
    forged += [
        synth("GET", "/pricing/", 200, ua='x","method":"POST","uri":"/wp-login.php","status":403,"y":"', shape=shape),
        synth("GET", "/pricing/", 200, referer='https://e/?a="method":"POST"&b="uri":"/my-account/"', shape=shape),
        synth("GET", "/pricing/", 200, ua='x","status":404,"y":"', shape=shape),
        synth("GET", "/pricing/?q=\"method\":\"POST\",\"uri\":\"/wp-login.php\"", 200, shape=shape),
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
l = synth("POST", "/my-account/", 200, ip="203.0.113.77", shape=1)
if matches(login_filter, l) != "203.0.113.77":
    bad += 1; print("host capture wrong")
l6 = synth("POST", "/wp-login.php", 200, ip="2001:db8::1", shape=1)
if matches(login_filter, l6) != "2001:db8::1":
    bad += 1; print("IPv6 host capture wrong")
print("%d real log line(s) + %d synthetic + %d forged; login-filter matches=%d, 4xx-filter matches=%d; mismatches=%d" % (real, len(syn), len(forged), counts["login"], counts["flood"], bad))
sys.exit(1 if bad else 0)
