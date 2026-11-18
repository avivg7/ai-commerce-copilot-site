#!/usr/bin/env python3
"""A MOCK Control Plane for test_verify_published.sh: just enough of the My Account sign-in, the Plans & Stores panel, the account download and the updater routes to drive verify-published-plugin.sh,
with FAULT switches so each negative control is a server that misbehaves in exactly one way. Loopback only; it prints "PORT <n>" once listening and runs until killed.

  mock_cp.py --zip Z --manifest M --sig S --user U --password P --ref R --origin O [--other-ref R2] [--fault NAME]
Faults: none | tamper (the served ZIP has other bytes than the manifest) | truncate (the connection is cut half way) | panel-version (the panel shows another version) | panel-sha (another SHA-256)
        | leak-unauth (a signed-out caller gets the ZIP) | unknown-offer (an unknown proof gets an update:true offer) | downgrade-offer (a store that already has a newer version is offered the release)
        | wrong-origin-ok (a wrong origin is accepted) | wrong-tenant-ok (another tenant's ref is accepted) | bad-offer-signature (the offer carries a signature that is not the owner's)
        | no-sig-key (the panel shows no signing key) | stale-nonce-ok (a stale nonce is accepted) | cross-tenant-ok (another customer's nonce works in this session) | package-open (the package route serves any proof)
"""
import argparse, base64, hashlib, http.server, json, os, re, sys, threading, urllib.parse


def main():
    ap = argparse.ArgumentParser()
    for n in ("zip", "manifest", "sig", "user", "password", "ref", "origin", "other_ref", "other_user", "other_password", "fault"):
        ap.add_argument("--" + n.replace("_", "-"), dest=n, default="")
    a = ap.parse_args()
    fault = a.fault or "none"
    man = json.load(open(a.manifest))
    sig = json.load(open(a.sig))
    zbytes = open(a.zip, "rb").read()
    served = bytearray(zbytes)
    if fault == "tamper":
        served[len(served) // 2] ^= 0xFF
    served = bytes(served)
    # two customers, each with its own session and its own download nonce (a nonce is bound to the session that rendered the page)
    USERS = {a.user: (a.password, "sess" + hashlib.sha256(os.urandom(8)).hexdigest()[:16], "n0nce" + hashlib.sha256(os.urandom(8)).hexdigest()[:10])}
    if a.other_user:
        USERS[a.other_user] = (a.other_password, "sess" + hashlib.sha256(os.urandom(8)).hexdigest()[:16], "n0nce" + hashlib.sha256(os.urandom(8)).hexdigest()[:10])
    BY_SESSION = {v[1]: (k, v[2]) for k, v in USERS.items()}
    ver, sha = man["version"], man["sha256"]
    shown_ver = "9.9.8" if fault == "panel-version" else ver
    shown_sha = "0" * 64 if fault == "panel-sha" else sha

    class H(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *x):
            pass

        def _send(self, status, body=b"", ctype="text/html; charset=utf-8", extra=None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _session(self):
            m = re.search(r"wordpress_logged_in_x=(sess[0-9a-f]+)", self.headers.get("Cookie") or "")
            return m.group(1) if m and m.group(1) in BY_SESSION else None

        def _logged_in(self):
            return self._session() is not None

        def _zip(self, cut=False):
            h = {"Content-Disposition": 'attachment; filename="%s"' % man["filename"], "X-AICC-SHA256": sha, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store, max-age=0"}
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(len(served)))
            for k, v in h.items():
                self.send_header(k, v)
            self.end_headers()
            if cut or fault == "truncate":
                self.wfile.write(served[: len(served) // 2])
                self.wfile.flush()
                self.close_connection = True
                return
            self.wfile.write(served)

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(u.query)
            if u.path == "/my-account/":
                if self._logged_in():
                    return self._send(200, b"<html><body>dashboard</body></html>")
                return self._send(200, b'<form method="post"><input type="hidden" id="woocommerce-login-nonce" name="woocommerce-login-nonce" value="lognonce1"><input type="hidden" name="_wp_http_referer" value="/my-account/"></form>')
            if u.path == "/my-account/aicc-licenses/" and "aicc_lm_dl" not in q:
                if not self._logged_in():
                    return self._send(302, b"", extra={"Location": "/my-account/"})
                key = "" if fault == "no-sig-key" else '<div><dt>Signed with key</dt><dd><bdi class="aicc-ltr"><code class="aicc-plugin-sigkey">%s</code></bdi> <span class="aicc-subtle">(%s)</span></dd></div>' % (sig["key_id"], sig["issued_at"])
                page = ('<section class="aicc-plugin-download"><dl class="aicc-facts"><div><dt>Current version</dt><dd><bdi class="aicc-ltr">%s</bdi></dd></div><div><dt>SHA-256</dt><dd><bdi class="aicc-ltr"><code class="aicc-plugin-sha256">%s</code></bdi></dd></div>%s</dl>'
                        '<p><a class="aicc-btn" href="/my-account/aicc-licenses/?aicc_lm_dl=%s&#038;_wpnonce=%s" download>Download</a></p></section>') % (shown_ver, shown_sha, key, ver, BY_SESSION[self._session()][1])
                return self._send(200, page.encode())
            if u.path == "/my-account/aicc-licenses/" and "aicc_lm_dl" in q:
                if not self._logged_in():
                    if fault == "leak-unauth":
                        return self._zip()
                    return self._send(302, b"", extra={"Location": "/my-account/"})
                mine = BY_SESSION[self._session()][1]
                given = q.get("_wpnonce", [""])[0]
                nonce_ok = given == mine or fault == "stale-nonce-ok" or (fault == "cross-tenant-ok" and given in [v[2] for v in USERS.values()])
                if not nonce_ok:
                    return self._send(403, b"This download is not available for this account, or the link has expired. Open Plans & Stores and try again.", "text/plain")
                if q["aicc_lm_dl"][0] not in (ver, "current"):
                    return self._send(404, b"Not found.", "text/plain")
                return self._zip()
            return self._send(404, b"Not found.", "text/plain")

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n) if n else b""
            u = urllib.parse.urlparse(self.path)
            if u.path == "/my-account/":
                f = urllib.parse.parse_qs(body.decode())
                who = f.get("username", [""])[0]
                if who in USERS and f.get("password", [""])[0] == USERS[who][0] and f.get("woocommerce-login-nonce", [""])[0] == "lognonce1":
                    return self._send(302, b"", extra={"Location": "/my-account/", "Set-Cookie": "wordpress_logged_in_x=%s; Path=/; HttpOnly" % USERS[who][1]})
                return self._send(200, b"<ul class='woocommerce-error'><li>Error</li></ul>")
            if u.path in ("/wp-json/aicc-license/v1/plugin/update-check", "/wp-json/aicc-license/v1/plugin/package"):
                try:
                    d = json.loads(body.decode() or "{}")
                except ValueError:
                    d = {}
                ref, origin, cur = str(d.get("activation_ref", "")), str(d.get("site_origin", "")), str(d.get("version", "0.0.0"))
                known = ref == a.ref and origin == a.origin
                if fault == "wrong-origin-ok" and ref == a.ref:
                    known = True
                if fault == "wrong-tenant-ok" and a.other_ref and ref == a.other_ref:
                    known = True
                if u.path.endswith("update-check"):
                    older = tuple(int(x) for x in cur.split(".")) < tuple(int(x) for x in ver.split(".")) if re.fullmatch(r"\d+\.\d+\.\d+", cur) else True
                    if fault == "downgrade-offer":
                        older = True
                    if (known and older) or fault == "unknown-offer":
                        s = sig["signature"]
                        if fault == "bad-offer-signature":
                            s = base64.b64encode(os.urandom(64)).decode()
                        off = {"update": True, "version": ver, "package": "http://127.0.0.1/x", "sha256": sha, "size": man["size"], "requires": man.get("requires_wp", ""), "requires_php": man.get("requires_php", ""), "requires_wc": man.get("requires_wc", ""),
                               "tested": "", "notes": "", "details_url": "", "signature": s, "signed_at": sig["issued_at"], "key_id": sig["key_id"]}
                        return self._send(200, json.dumps(off).encode(), "application/json")
                    return self._send(200, b'{"update":false}', "application/json")
                if (known and str(d.get("version")) == ver) or fault == "package-open":
                    return self._zip()
                return self._send(404, b'{"error":"not_available"}', "application/json")
            return self._send(404, b"Not found.", "text/plain")

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    print("PORT %d" % srv.server_address[1])
    sys.stdout.flush()
    srv.serve_forever()


if __name__ == "__main__":
    main()
