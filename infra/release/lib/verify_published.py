#!/usr/bin/env python3
"""Post-publication verification of an official AICC Plugin release (P41 R).  Run by infra/release/verify-published-plugin.sh; read that script's header for the contract.

What it proves, in four blocks (every check prints PASS/FAIL; the exit status is 0 only when all of them passed):
  R  release record   offline: manifest + signature + the owner's PUBLIC key list, checked with the Plugin repo's own verify tool (bin/sign-release.php), key_id bound to ONE key of the list,
                      the local ZIP cross-checked (a verify with --pubkeys never looks at the ZIP, so it is run twice), version strictly above the previous one (no downgrade);
  C  customer path    as a customer with an active plan (credentials from a 0600 file or from environment variables NAMED on the command line, never argv): sign in through the My Account form,
                      read Plans & Stores (version, SHA-256, signing key shown), download the ZIP with the page's own nonce link, compare size + SHA-256 with the SIGNED manifest, verify the
                      signature against the ZIP's baked public keys, Version header == manifest version == release record;
  U  uniform refusals signed out / stale nonce / unknown version on the account download; unknown, malformed, wrong-origin and wrong-tenant proofs on the updater's update-check and package
                      routes; a store of the plan is offered the release only when it is newer (no downgrade, no same-version offer) and the offer's signature verifies;
  D  download safety  a truncated or altered download is detected (size / SHA-256 / ZIP structure) and is never left behind under its final name, so nothing installs it.
Never printed or stored: the password, the cookies, the activation ref, the nonce (URLs are redacted). Production mode is read-only except the sign-in POST and the update-check / package POSTs with
fabricated proofs (answered by the server with the same refusal for every reason); the download is the account's own and is logged by the Control Plane like any download.
"""
import argparse, base64, hashlib, http.client, http.cookiejar, html, json, os, re, shutil, socket, stat, subprocess, sys, tempfile, uuid, zipfile
import urllib.error, urllib.parse, urllib.request
from html.parser import HTMLParser

VER_RE = re.compile(r"^\d{1,4}\.\d{1,4}\.\d{1,4}$")
B64KEY_RE = re.compile(r"^[A-Za-z0-9+/]{43}=$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
SLUG = "ai-commerce-copilot"
PROD_HOST = "www.copilt.org"
STAGE_HOST = "stage.copilt.org"
MAX_BODY = 4 * 1024 * 1024
MAX_ZIP = 50 * 1024 * 1024

RESULTS = []          # (id, label, ok, detail)
QUIET = False


def report(cid, label, ok, detail=""):
    RESULTS.append((cid, label, bool(ok), str(detail)[:400]))
    print("%s  %-5s %s%s" % ("PASS" if ok else "FAIL", cid, label, ("  [" + str(detail)[:300] + "]") if detail and not ok else ""))
    sys.stdout.flush()
    return bool(ok)


def die(code, msg):
    sys.stderr.write("verify-published-plugin: %s\n" % msg)
    sys.exit(code)


def redact(url):
    return re.sub(r"(_wpnonce=)[^&#]+", r"\1<redacted>", url)


def fingerprint(raw):
    h = hashlib.sha256(raw).hexdigest()[:16]
    return "-".join(h[i:i + 4] for i in range(0, 16, 4))


def parse_keys(listing):
    out = []
    for part in (listing or "").split(","):
        part = part.strip()
        if not part:
            continue
        if not B64KEY_RE.match(part):
            return None
        try:
            raw = base64.b64decode(part, validate=True)
        except Exception:
            return None
        if len(raw) != 32 or part in [k[0] for k in out]:
            return None
        out.append((part, raw))
    return out if 1 <= len(out) <= 2 else None


def _b64len(v):
    try:
        return len(base64.b64decode(str(v or ""), validate=True))
    except Exception:
        return -1


def vtuple(v):
    return tuple(int(x) for x in v.split("."))


# ---------------------------------------------------------------------------------------------------------------- the Plugin repo's verify tool
class Tool:
    def __init__(self, php, plugin_dir):
        self.php = php
        self.plugin_dir = plugin_dir
        self.script = os.path.join(plugin_dir, "bin", "sign-release.php")

    def verify(self, manifest, sig, pubkeys=None, zip_path=None):
        cmd = [self.php, self.script, "verify", "--manifest", manifest, "--sig", sig]
        if pubkeys:
            cmd += ["--pubkeys", pubkeys]
        if zip_path:
            cmd += ["--zip", zip_path]
        try:
            r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60, env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")}, stdin=subprocess.DEVNULL)
        except Exception as e:
            return False, "could not run the verify tool: %s" % e
        lines = [l for l in r.stdout.decode("utf-8", "replace").splitlines() if l.strip() and not l.startswith(("Deprecated", "PHP Deprecated", "Warning"))]
        return r.returncode == 0, (lines[-1] if lines else "no output")[:300]


# ---------------------------------------------------------------------------------------------------------------- HTTP (no redirects followed automatically, cookies kept)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


class Resp:
    def __init__(self, status, headers, body, location=""):
        self.status, self.headers, self.body, self.location = status, headers, body, location

    def text(self):
        return self.body.decode("utf-8", "replace")

    def json(self):
        try:
            return json.loads(self.body.decode("utf-8"))
        except Exception:
            return None


class Http:
    def __init__(self, base, timeout=30):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(self.jar))
        self.ua = "aicc-verify-published-plugin/1"

    def has_cookie(self, prefix):
        return any(c.name.startswith(prefix) for c in self.jar)

    def abs(self, path_or_url):
        return path_or_url if re.match(r"^https?://", path_or_url) else self.base + "/" + path_or_url.lstrip("/")

    def req(self, method, url, data=None, headers=None, follow=0, cookies=True):
        url = self.abs(url)
        for _ in range(follow + 1):
            h = {"User-Agent": self.ua, "Accept": "*/*"}
            h.update(headers or {})
            rq = urllib.request.Request(url, data=data, method=method, headers=h)
            op = self.op if cookies else urllib.request.build_opener(NoRedirect())
            try:
                r = op.open(rq, timeout=self.timeout)
                status, hdrs, fp = r.status, r, r
            except urllib.error.HTTPError as e:
                status, hdrs, fp = e.code, e, e
            body = fp.read(MAX_BODY + 1)
            if len(body) > MAX_BODY:
                body = body[:MAX_BODY]
            lh = {k.lower(): v for k, v in hdrs.headers.items()} if hasattr(hdrs, "headers") else {}
            loc = lh.get("location", "")
            if follow and status in (301, 302, 303, 307, 308) and loc:
                nxt = urllib.parse.urljoin(url, loc)
                if urllib.parse.urlparse(nxt).netloc != urllib.parse.urlparse(self.base).netloc:
                    return Resp(status, lh, body, nxt)
                url, method, data = nxt, "GET", None
                follow -= 1
                continue
            return Resp(status, lh, body, loc)
        return Resp(0, {}, b"")

    def get(self, url, **k):
        return self.req("GET", url, **k)

    def post_form(self, url, fields, **k):
        return self.req("POST", url, data=urllib.parse.urlencode(fields).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"}, **k)

    def post_json(self, url, obj, **k):
        return self.req("POST", url, data=json.dumps(obj).encode(), headers={"Content-Type": "application/json"}, **k)

    def download(self, url, dest_dir, final_name, expect_size, expect_sha):
        """Stream url into <dest_dir>/.<final_name>.part; only a download that equals expect_size AND expect_sha AND is a ZIP is renamed to final_name. Returns (path|None, problem, headers, status)."""
        url = self.abs(url)
        part = os.path.join(dest_dir, "." + final_name + ".part")
        final = os.path.join(dest_dir, final_name)
        for p in (part, final):
            if os.path.lexists(p):
                os.unlink(p)
        rq = urllib.request.Request(url, headers={"User-Agent": self.ua, "Accept": "application/zip,*/*"})
        got, h, status, problem = 0, hashlib.sha256(), 0, ""
        lh = {}
        try:
            r = self.op.open(rq, timeout=self.timeout)
            status = r.status
            lh = {k.lower(): v for k, v in r.headers.items()}
            declared = int(lh["content-length"]) if lh.get("content-length", "").isdigit() else None
            with open(part, "wb") as f:
                while True:
                    try:
                        chunk = r.read(65536)
                    except (http.client.IncompleteRead, socket.timeout, ConnectionError, OSError) as e:
                        problem = "download interrupted (%s)" % type(e).__name__
                        break
                    if not chunk:
                        break
                    got += len(chunk)
                    if got > MAX_ZIP:
                        problem = "download larger than the %d byte ceiling" % MAX_ZIP
                        break
                    h.update(chunk)
                    f.write(chunk)
            if not problem and declared is not None and got != declared:
                problem = "truncated: received %d of %d announced bytes" % (got, declared)
        except urllib.error.HTTPError as e:
            status, problem = e.code, "HTTP %d instead of the ZIP" % e.code
            lh = {k.lower(): v for k, v in e.headers.items()}
        except Exception as e:
            problem = "transport error (%s)" % type(e).__name__
        if not problem and status != 200:
            problem = "HTTP %d instead of 200" % status
        if not problem and got != expect_size:
            problem = "size %d differs from the signed manifest's %d" % (got, expect_size)
        if not problem and h.hexdigest() != expect_sha:
            problem = "SHA-256 differs from the signed manifest"
        if not problem:
            with open(part, "rb") as f:
                if f.read(4) != b"PK\x03\x04":
                    problem = "not a ZIP (no PK header)"
        if not problem:
            try:
                with zipfile.ZipFile(part) as z:
                    bad = z.testzip()
                    if bad:
                        problem = "ZIP member fails its CRC: %s" % bad
            except Exception as e:
                problem = "ZIP cannot be opened (%s)" % type(e).__name__
        if problem:
            if os.path.lexists(part):
                os.unlink(part)
            return None, problem, lh, status
        os.replace(part, final)
        return final, "", lh, status


class PanelParser(HTMLParser):
    """Plans & Stores: Current version, SHA-256, signing key, the download link (class names are the Control Plane's: aicc-plugin-sha256, aicc-plugin-sigkey, dt 'Current version')."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.version, self.sha, self.key, self.links = [], "", "", "", []
        self._dt, self._want = "", ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class", "") or ""
        if tag == "a" and "download" in a and a.get("href") and "aicc_lm_dl=" in a["href"]:
            self.links.append(a["href"])
        if tag == "code" and "aicc-plugin-sha256" in cls:
            self._want = "sha"
        elif tag == "code" and "aicc-plugin-sigkey" in cls:
            self._want = "key"
        elif tag == "dt":
            self._dt = ""
            self._want = "dt"
        elif tag == "bdi" and self._dt == "Current version" and not self.version:
            self._want = "version"

    def handle_data(self, data):
        d = data.strip()
        if not d:
            return
        if self._want == "sha":
            self.sha = d
        elif self._want == "key":
            self.key = d
        elif self._want == "dt":
            self._dt = d
        elif self._want == "version":
            self.version = d
        self._want = "" if self._want in ("sha", "key", "version") else self._want

    def handle_endtag(self, tag):
        if tag == "dt":
            self._want = ""


class InputParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inputs = {}

    def handle_starttag(self, tag, attrs):
        if tag == "input":
            a = dict(attrs)
            if a.get("name"):
                self.inputs[a["name"]] = a.get("value", "")


# ---------------------------------------------------------------------------------------------------------------- credentials (a file or NAMED environment variables; never argv)
def read_secret_file(path, keys):
    if os.path.islink(path) or not os.path.isfile(path):
        die(3, "%s is not a regular file" % path)
    st = os.stat(path)
    if st.st_mode & 0o077:
        die(3, "refusing %s: mode %04o lets group/other read it (chmod 600)" % (path, st.st_mode & 0o777))
    if st.st_uid != os.geteuid():
        die(3, "refusing %s: not owned by the current user" % path)
    out = {}
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        if k in keys and k not in out:
            out[k] = v
    return out


# ---------------------------------------------------------------------------------------------------------------- ZIP inspection
def zip_facts(path):
    """Version header, AICC_VERSION, baked public keys, structure problems of a plugin ZIP."""
    facts = {"version_header": "", "const_version": "", "baked": [], "problems": []}
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        tops = {n.split("/")[0] for n in names}
        if tops != {SLUG}:
            facts["problems"].append("top-level folders are %s, expected exactly %s/" % (sorted(tops)[:3], SLUG))
        for i in z.infolist():
            if i.filename.startswith("/") or ".." in i.filename.split("/"):
                facts["problems"].append("unsafe member name")
            if (i.external_attr >> 16) & 0o170000 == 0o120000:
                facts["problems"].append("symlink member")
        main = z.read("%s/%s.php" % (SLUG, SLUG)).decode("utf-8", "replace") if "%s/%s.php" % (SLUG, SLUG) in names else ""
        m = re.search(r"^\s*\*\s*Version:\s*(\S+)", main, re.M)
        facts["version_header"] = m.group(1) if m else ""
        m = re.search(r"define\(\s*'AICC_VERSION'\s*,\s*'([^']*)'", main)
        facts["const_version"] = m.group(1) if m else ""
        d = z.read("%s/includes/aicc-release-defaults.php" % SLUG).decode("utf-8", "replace") if "%s/includes/aicc-release-defaults.php" % SLUG in names else ""
        m = re.search(r"const PUBLIC_KEYS = '([A-Za-z0-9+/=,]*)';", d)
        facts["baked"] = [k for k in (m.group(1).split(",") if m else []) if k]
    return facts


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


# ---------------------------------------------------------------------------------------------------------------- R: the release record
def check_record(a, tool, keys):
    ok_all = True
    try:
        man = json.load(open(a.manifest, encoding="utf-8"))
    except Exception as e:
        report("R1", "manifest is readable JSON", False, e)
        return None
    sha = str(man.get("sha256", ""))
    good = (man.get("slug") == SLUG and man.get("version") == a.version and man.get("dirty") is False and re.fullmatch(r"[0-9a-f]{40}", str(man.get("built_from_commit", ""))) is not None
            and sha == a.sha256 and isinstance(man.get("size"), int) and man.get("filename") == "%s-%s.zip" % (SLUG, a.version))
    ok_all &= report("R1", "manifest is the clean build of %s %s with the expected SHA-256 (second channel) and file name" % (SLUG, a.version), good,
                     "version=%r sha-match=%s dirty=%r" % (man.get("version"), sha == a.sha256, man.get("dirty")))
    try:
        sig = json.load(open(a.sig, encoding="utf-8"))
    except Exception as e:
        report("R2", "signature file is readable JSON", False, e)
        return man
    sigok = sig.get("alg") == "ed25519" and re.fullmatch(r"[0-9a-f-]{1,64}", str(sig.get("key_id", ""))) and _b64len(sig.get("signature")) == 64 \
        and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", str(sig.get("issued_at", ""))) and os.path.basename(a.sig) == "%s-%s.manifest.sig" % (SLUG, a.version)
    ok_all &= report("R2", "signature file is well formed and named for the version", bool(sigok))
    ok, msg = tool.verify(a.manifest, a.sig, pubkeys=a.pubkeys)
    ok_all &= report("R3", "signature verifies against the owner's PUBLIC key list (Plugin repo verify tool)", ok, msg)
    by_fp = {fingerprint(raw): b64 for b64, raw in keys}
    signer = by_fp.get(str(sig.get("key_id", "")))
    ok_all &= report("R4a", "key_id %s is the fingerprint of exactly one key of the list" % sig.get("key_id", "?"), signer is not None, "list fingerprints: %s" % ",".join(sorted(by_fp)))
    if signer:
        ok, msg = tool.verify(a.manifest, a.sig, pubkeys=signer)
        ok_all &= report("R4b", "the signature verifies with THAT key alone (the key_id is a hint, not trusted)", ok, msg)
    if a.expect_key_id:
        ok_all &= report("R4c", "key_id equals the expected primary fingerprint %s" % a.expect_key_id, sig.get("key_id") == a.expect_key_id, "key_id=%s" % sig.get("key_id"))
    if a.previous_version:
        ok_all &= report("R5", "version %s is strictly newer than the previous release %s (no downgrade, no re-publish)" % (a.version, a.previous_version),
                         VER_RE.match(a.previous_version) is not None and vtuple(a.version) > vtuple(a.previous_version))
    if a.local_zip:
        try:
            lsha = sha256_file(a.local_zip)
            ok_all &= report("R6a", "local ZIP SHA-256 and size equal the signed manifest", lsha == sha and os.path.getsize(a.local_zip) == man.get("size"), "sha %s" % lsha[:16])
            ok, msg = tool.verify(a.manifest, a.sig, zip_path=a.local_zip)
            ok_all &= report("R6b", "verify with --zip alone (the ZIP's own baked keys; the tool also re-hashes the ZIP)", ok, msg)
            f = zip_facts(a.local_zip)
            ok_all &= report("R6c", "ZIP structure clean; Version header == AICC_VERSION == manifest version == %s" % a.version, not f["problems"] and f["version_header"] == f["const_version"] == man.get("version") == a.version, "%s %s/%s" % (f["problems"], f["version_header"], f["const_version"]))
            listed = {b64 for b64, _ in keys}
            ok_all &= report("R6d", "every public key baked into the ZIP is on the owner's list, and the signing key is one of them", bool(f["baked"]) and set(f["baked"]) <= listed and (signer in f["baked"] if signer else False), "baked=%d" % len(f["baked"]))
        except Exception as e:
            report("R6", "local ZIP checks", False, e)
    return man


# ---------------------------------------------------------------------------------------------------------------- C: customer path
def login(http, user, pw):
    """Sign in through the My Account form. Returns (ok, note). The password is only ever in the POST body."""
    page = http.get("/my-account/", follow=3)
    inp = InputParser()
    inp.feed(page.text())
    nonce = inp.inputs.get("woocommerce-login-nonce", "")
    if page.status != 200 or not nonce:
        return False, "the sign-in form is not reachable (HTTP %d, login nonce %s)" % (page.status, "present" if nonce else "absent")
    fields = {"username": user, "password": pw, "woocommerce-login-nonce": nonce, "_wp_http_referer": inp.inputs.get("_wp_http_referer", "/my-account/"), "login": "Log in"}
    r = http.post_form("/my-account/", fields, follow=3)
    del fields
    return http.has_cookie("wordpress_logged_in_"), "HTTP %d" % r.status


def customer_flow(a, http, man, tool, keys, workdir):
    user, pw = a.creds
    sha, size, ver = man["sha256"], man["size"], man["version"]
    ok_login, note = login(http, user, pw)
    if not report("C1", "sign in with the test customer's own credentials (%s, session cookie set)" % note, ok_login, "no session cookie: wrong credentials, login throttle, or Turnstile on sign-in; %s" % note):
        return False
    pg = http.get("/my-account/aicc-licenses/", follow=3)
    pp = PanelParser()
    pp.feed(pg.text())
    ok = pg.status == 200 and pp.version == ver and pp.sha == sha and bool(pp.links)
    report("C2", "Plans & Stores offers the plugin: version %s and SHA-256 equal the signed manifest, a download link is present" % ver, ok, "HTTP %d version=%r sha-match=%s links=%d" % (pg.status, pp.version, pp.sha == sha, len(pp.links)))
    sig = json.load(open(a.sig))
    report("C3", "the page shows the signing key fingerprint of the signature (%s)" % sig.get("key_id"), pp.key == sig.get("key_id"), "page shows %r" % pp.key)
    if not pp.links:
        return False
    link = html.unescape(pp.links[0])
    os.makedirs(workdir, exist_ok=True)
    fname = "%s-%s.zip" % (SLUG, ver)
    path, problem, hdrs, status = http.download(link, workdir, fname, size, sha)
    report("C4", "download from the account link: HTTP 200, application/zip, size and SHA-256 equal the signed manifest", path is not None, problem)
    if path is None:
        return False
    report("C5", "response headers: X-AICC-SHA256 == manifest, Content-Type application/zip, nosniff, no-store", hdrs.get("x-aicc-sha256") == sha and hdrs.get("content-type", "").startswith("application/zip")
           and hdrs.get("x-content-type-options") == "nosniff" and "no-store" in hdrs.get("cache-control", ""), "%s" % {k: hdrs.get(k) for k in ("x-aicc-sha256", "content-type", "cache-control")})
    ok, msg = tool.verify(a.manifest, a.sig, zip_path=path)
    report("C6", "the DOWNLOADED ZIP verifies against the signed manifest with its baked public keys (Plugin repo verify tool)", ok, msg)
    f = zip_facts(path)
    listed = {b64 for b64, _ in keys}
    by_fp = {fingerprint(raw): b64 for b64, raw in keys}
    signer = by_fp.get(str(sig.get("key_id", "")))
    report("C7", "Version header == AICC_VERSION == manifest version == release record (%s); baked keys are on the owner's list and include the signing key (key_id %s)" % (ver, sig.get("key_id")),
           not f["problems"] and f["version_header"] == f["const_version"] == ver and bool(f["baked"]) and set(f["baked"]) <= listed and signer is not None and signer in f["baked"],
           "%s %s/%s baked=%s signer-baked=%s" % (f["problems"], f["version_header"], f["const_version"], len(f["baked"]), signer in f["baked"] if signer else "unknown key_id"))
    http.downloaded = path
    return True


def cross_tenant_download(a, http, base, man):
    """Another tenant's session and nonce: a nonce is bound to the session that rendered the page, so it is useless in the other customer's hands (and the reverse)."""
    user, pw = a.other_creds
    other = Http(base)
    ok_login, note = login(other, user, pw)
    if not report("U21", "the OTHER test customer signs in (%s)" % note, ok_login, "needed for the cross-tenant download check"):
        return

    def link(client):
        pg = client.get("/my-account/aicc-licenses/", follow=3)
        pp = PanelParser()
        pp.feed(pg.text())
        return html.unescape(pp.links[0]) if pp.links else ""
    la, lb = link(http), link(other)
    if not la or not lb:
        return report("U22", "both customers' panels carry a download link (the other account needs an active plan too)", False, "links: A=%s other=%s" % (bool(la), bool(lb)))
    for label, client, url in (("this customer's session with the OTHER customer's nonce link", http, lb), ("the other customer's session with THIS customer's nonce link", other, la)):
        r = client.get(url)
        report("U22", "%s: HTTP 403, no ZIP" % label, r.status == 403 and r.body[:2] != b"PK" and "x-aicc-sha256" not in r.headers, "HTTP %d" % r.status)


# ---------------------------------------------------------------------------------------------------------------- U: uniform refusals
def account_refusals(a, http, man, anon_base):
    """Signed-out and stale-nonce callers get the same refusal whatever the reason; no ZIP header ever."""
    ver = man["version"]
    anon = Http(anon_base)
    r = anon.get("/my-account/aicc-licenses/?aicc_lm_dl=%s&_wpnonce=0123456789" % ver)
    bad = ("zip" in r.headers.get("content-type", "")) or "x-aicc-sha256" in r.headers or r.body[:2] == b"PK"
    report("U1", "signed-out download request is refused (HTTP %d), no ZIP, no X-AICC-SHA256" % r.status, r.status in (302, 303, 403, 404) and not bad, "HTTP %d" % r.status)
    r2 = anon.get("/my-account/aicc-licenses/?aicc_lm_dl=current&_wpnonce=")
    report("U2", "signed-out request for 'current' without a nonce gets the same answer (HTTP %d vs %d)" % (r2.status, r.status), r2.status == r.status and r2.body == r.body, "HTTP %d" % r2.status)
    if http.has_cookie("wordpress_logged_in_"):
        s = http.get("/my-account/aicc-licenses/?aicc_lm_dl=%s&_wpnonce=deadbeef00" % ver)
        report("U3", "signed in but with a stale/foreign nonce: HTTP 403, no ZIP", s.status == 403 and b"PK" != s.body[:2] and "x-aicc-sha256" not in s.headers, "HTTP %d" % s.status)
        pg = http.get("/my-account/aicc-licenses/", follow=3)
        pp = PanelParser()
        pp.feed(pg.text())
        if pp.links:
            good = html.unescape(pp.links[0])
            for label, new in (("an unknown version", re.sub(r"aicc_lm_dl=[^&]+", "aicc_lm_dl=9.9.9", good)), ("a traversal version", re.sub(r"aicc_lm_dl=[^&]+", "aicc_lm_dl=..%2F..%2Fwp-config", good))):
                t = http.get(new)
                report("U4", "valid nonce but %s: HTTP 404 'Not found.', no ZIP" % label, t.status == 404 and t.body[:2] != b"PK" and "x-aicc-sha256" not in t.headers, "HTTP %d" % t.status)


def updater_refusals(a, http_anon, man):
    """Fabricated proofs: every reason gets the identical answer."""
    ep = "/wp-json/aicc-license/v1/plugin"
    ver = man["version"]

    def probe(label, route, body, expect_status, expect_json, cid):
        r = http_anon.post_json(ep + route, body)
        report(cid, label, r.status == expect_status and r.json() == expect_json and "x-aicc-sha256" not in r.headers and r.body[:2] != b"PK", "HTTP %d %s" % (r.status, r.body[:80]))
        return r
    rnd = str(uuid.uuid4())
    o = "https://shop-%s.example" % uuid.uuid4().hex[:8]
    probe("update-check, unknown activation_ref + foreign origin: HTTP 200 {\"update\":false}", "/update-check", {"activation_ref": rnd, "site_origin": o, "version": "0.0.1"}, 200, {"update": False}, "U5")
    probe("update-check, malformed ref and malformed origin: the same answer", "/update-check", {"activation_ref": "not-a-ref", "site_origin": "javascript:alert(1)", "version": "0.0.1"}, 200, {"update": False}, "U6")
    probe("update-check, a proof in the URL query string only is ignored: no offer", "/update-check?activation_ref=%s&site_origin=%s" % (rnd, urllib.parse.quote(o, safe="")), {"activation_ref": rnd, "site_origin": o, "version": "0.0.1"}, 200, {"update": False}, "U7")
    probe("package, unknown proof asking for the current version: HTTP 404 {\"error\":\"not_available\"}", "/package", {"activation_ref": rnd, "site_origin": o, "version": ver}, 404, {"error": "not_available"}, "U8")
    probe("package, malformed proof: the same refusal", "/package", {"activation_ref": "x", "site_origin": "y", "version": ver}, 404, {"error": "not_available"}, "U9")


def store_flow(a, http_anon, man, tool, keys, workdir):
    """A store of an active plan (named in --store-file; the fixture creates it, in production it is the owner's own test store): offered only a NEWER, SIGNED release; wrong origin and another tenant's ref get the refusal."""
    sf = read_secret_file(a.store_file, {"AICC_STORE_ACTIVATION_REF", "AICC_STORE_ORIGIN", "AICC_OTHER_ACTIVATION_REF", "AICC_OTHER_ORIGIN"})
    ref, origin = sf.get("AICC_STORE_ACTIVATION_REF", ""), sf.get("AICC_STORE_ORIGIN", "")
    if not ref or not origin:
        return report("U10", "store file holds AICC_STORE_ACTIVATION_REF and AICC_STORE_ORIGIN", False)
    ep = "/wp-json/aicc-license/v1/plugin"
    ver, sha, size = man["version"], man["sha256"], man["size"]
    older = "0.0.1"
    r = http_anon.post_json(ep + "/update-check", {"activation_ref": ref, "site_origin": origin, "version": older})
    offer = r.json() or {}
    sig = json.load(open(a.sig))
    ok = r.status == 200 and offer.get("update") is True and offer.get("version") == ver and offer.get("sha256") == sha and offer.get("size") == size and offer.get("key_id") == sig.get("key_id") \
        and offer.get("signature") == sig.get("signature") and offer.get("signed_at") == sig.get("issued_at")
    report("U10", "update-check from an older store: update:true, version/sha256/size/key_id/signature equal the signed release", ok, "HTTP %d keys=%s" % (r.status, sorted(offer)[:6]))
    if offer.get("update") is True:
        tmp = tempfile.mkdtemp(prefix="aicc-offer-")
        try:
            m2 = {"slug": SLUG, "version": offer.get("version"), "sha256": offer.get("sha256"), "size": offer.get("size"), "requires_wp": offer.get("requires"), "requires_php": offer.get("requires_php"), "requires_wc": offer.get("requires_wc"), "dirty": False}
            s2 = {"schema": 1, "alg": "ed25519", "key_id": offer.get("key_id"), "issued_at": offer.get("signed_at"), "signature": offer.get("signature")}
            json.dump(m2, open(os.path.join(tmp, "m.json"), "w"))
            json.dump(s2, open(os.path.join(tmp, "s.sig"), "w"))
            ok, msg = tool.verify(os.path.join(tmp, "m.json"), os.path.join(tmp, "s.sig"), pubkeys=a.pubkeys)
            report("U11", "the signature carried by the update-check ANSWER verifies against the owner's public keys (what a store checks before it installs)", ok, msg)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        opf = os.path.join(os.path.dirname(os.path.abspath(__file__)), "updater_offer_check.php")
        pk = a.pubkeys
        for label, cur, want_valid in (("installed version == offered (%s)" % ver, ver, False), ("installed version NEWER than offered (9.9.9): a downgrade", "9.9.9", False), ("installed version older (0.0.1)", older, True)):
            res = offer_check(a.php, opf, a.plugin_dir, offer, cur, pk)
            report("U12", "the Plugin's own updater logic (validate_offer + verify_offer): %s -> %s" % (label, "accepted" if want_valid else "refused"),
                   res is not None and (res.get("validate") is True) == want_valid and (not want_valid or res.get("verify") == ""), str(res))
        bad = base64.b64encode(os.urandom(32)).decode()
        res = offer_check(a.php, opf, a.plugin_dir, offer, older, bad)
        report("U13", "the same offer is REFUSED by a store whose baked key is not the owner's (verify_offer says bad_signature)", res is not None and res.get("verify") not in ("", None), str(res))
    for cur, label in ((ver, "the same version"), ("9.9.9", "a newer installed version (a downgrade is never offered)")):
        r = http_anon.post_json(ep + "/update-check", {"activation_ref": ref, "site_origin": origin, "version": cur})
        report("U14", "update-check from a store that has %s: {\"update\":false}" % label, r.status == 200 and r.json() == {"update": False}, "HTTP %d %s" % (r.status, r.body[:80]))
    wrong = "https://wrong-%s.example" % uuid.uuid4().hex[:8]
    r = http_anon.post_json(ep + "/update-check", {"activation_ref": ref, "site_origin": wrong, "version": older})
    report("U15", "WRONG ORIGIN with a valid activation_ref: the uniform {\"update\":false}", r.status == 200 and r.json() == {"update": False}, "HTTP %d" % r.status)
    r = http_anon.post_json(ep + "/package", {"activation_ref": ref, "site_origin": wrong, "version": ver})
    report("U16", "WRONG ORIGIN on the package route: 404 {\"error\":\"not_available\"}, no bytes", r.status == 404 and r.json() == {"error": "not_available"} and r.body[:2] != b"PK", "HTTP %d" % r.status)
    other_ref = sf.get("AICC_OTHER_ACTIVATION_REF")
    if other_ref:
        r = http_anon.post_json(ep + "/update-check", {"activation_ref": other_ref, "site_origin": origin, "version": older})
        report("U17", "WRONG TENANT (another store's ref with this store's origin): the uniform refusal", r.status == 200 and r.json() == {"update": False}, "HTTP %d" % r.status)
        r = http_anon.post_json(ep + "/package", {"activation_ref": other_ref, "site_origin": origin, "version": ver})
        report("U18", "WRONG TENANT on the package route: 404 {\"error\":\"not_available\"}", r.status == 404 and r.json() == {"error": "not_available"}, "HTTP %d" % r.status)
    if a.package_download:
        os.makedirs(workdir, exist_ok=True)
        pkg = http_anon.abs(ep + "/package")
        path, problem = package_download(http_anon, pkg, {"activation_ref": ref, "site_origin": origin, "version": ver}, workdir, "%s-%s.updater.zip" % (SLUG, ver), size, sha)
        report("U19", "the updater's package download (POST proof in the body) returns exactly the signed release", path is not None, problem)
        if path:
            ok, msg = tool.verify(a.manifest, a.sig, zip_path=path)
            report("U20", "...and that package verifies against the signed manifest with its baked keys", ok, msg)


def package_download(http, url, body, dest_dir, fname, size, sha):
    part, final = os.path.join(dest_dir, "." + fname + ".part"), os.path.join(dest_dir, fname)
    for p in (part, final):
        if os.path.lexists(p):
            os.unlink(p)
    rq = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "User-Agent": http.ua}, method="POST")
    got, h, problem = 0, hashlib.sha256(), ""
    try:
        r = http.op.open(rq, timeout=http.timeout)
        with open(part, "wb") as f:
            while True:
                c = r.read(65536)
                if not c:
                    break
                got += len(c)
                if got > MAX_ZIP:
                    problem = "larger than the ceiling"
                    break
                h.update(c)
                f.write(c)
        decl = r.headers.get("Content-Length")
        if not problem and decl and decl.isdigit() and int(decl) != got:
            problem = "truncated: %d of %s bytes" % (got, decl)
    except urllib.error.HTTPError as e:
        problem = "HTTP %d" % e.code
    except Exception as e:
        problem = "transport error (%s)" % type(e).__name__
    if not problem and (got != size or h.hexdigest() != sha):
        problem = "size/SHA-256 differ from the signed manifest"
    if problem:
        if os.path.lexists(part):
            os.unlink(part)
        return None, problem
    os.replace(part, final)
    return final, ""


def offer_check(php, script, plugin_dir, offer, current, pubkeys):
    try:
        r = subprocess.run([php, script, plugin_dir, current, pubkeys], input=json.dumps(offer).encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60, env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")})
        return json.loads(r.stdout.decode().strip().splitlines()[-1])
    except Exception:
        return None


# ---------------------------------------------------------------------------------------------------------------- D: truncated / altered download
def download_safety(a, client, man, workdir):
    """Proof, against the live answer, that the client side refuses a bad download: a cut-off copy and a flipped byte are detected by the SAME routine the customer check used and leave nothing behind."""
    path = getattr(client, "downloaded", None)
    if not path or not os.path.isfile(path):
        return
    data = open(path, "rb").read()
    sha, size = man["sha256"], man["size"]
    bad_dir = os.path.join(workdir, "neg")
    os.makedirs(bad_dir, exist_ok=True)
    import http.server as hs
    import threading

    class H(hs.BaseHTTPRequestHandler):
        mode = "truncate"

        def log_message(self, *x):
            pass

        def do_GET(self):
            body = data
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            if H.mode == "truncate":
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body[: len(body) // 2])
                self.wfile.flush()
                self.close_connection = True
                return
            if H.mode == "flip":
                body = bytearray(body)
                body[len(body) // 2] ^= 0xFF
                body = bytes(body)
            if H.mode == "short-no-length":
                body = body[: len(body) // 2]
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    srv = hs.ThreadingHTTPServer(("127.0.0.1", 0), H)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        for mode, label in (("truncate", "a connection cut half way through the ZIP"), ("flip", "one byte of the ZIP changed in transit"), ("short-no-length", "a complete-looking but shorter ZIP")):
            H.mode = mode
            c = Http("http://127.0.0.1:%d" % srv.server_address[1])
            p, problem, _, _ = c.download("/x.zip", bad_dir, "evil.zip", size, sha)
            left = [f for f in os.listdir(bad_dir)]
            report("D1", "%s is detected (%s) and nothing is left to install" % (label, problem or "NOT DETECTED"), p is None and bool(problem) and not left, "left behind: %s" % left)
    finally:
        srv.shutdown()


# ---------------------------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(add_help=False)
    for n in ("mode", "base_url", "version", "sha256", "plugin_dir", "manifest", "sig", "pubkeys", "expect_key_id", "previous_version", "local_zip", "credentials_file", "other_credentials_file", "user_env", "pass_env", "store_file", "out", "php", "anon_base_url"):
        ap.add_argument("--" + n.replace("_", "-"), dest=n, default="")
    ap.add_argument("--no-updater-probes", action="store_true")
    ap.add_argument("--package-download", action="store_true")
    ap.add_argument("--allow-http-loopback", action="store_true")
    a = ap.parse_args()
    if a.mode not in ("fixture", "stage", "production", "offline"):
        die(2, "--mode must be offline, fixture, stage or production")
    if not VER_RE.match(a.version or ""):
        die(2, "--version must be a strict X.Y.Z (a pre-release is never published to production)")
    if not SHA_RE.match(a.sha256 or ""):
        die(2, "--sha256 must be the 64-hex SHA-256 of the ZIP from the build machine's .sha256 file (second channel)")
    for n in ("manifest", "sig", "plugin_dir"):
        if not getattr(a, n):
            die(2, "--%s is required" % n.replace("_", "-"))
    a.php = a.php or "php"
    keys = parse_keys(a.pubkeys)
    if a.pubkeys == "" and os.path.isfile(os.path.join(a.plugin_dir, "release", "endpoints.conf")):
        for line in open(os.path.join(a.plugin_dir, "release", "endpoints.conf")):
            if line.startswith("UPDATE_PUBLIC_KEYS="):
                a.pubkeys = line.split("=", 1)[1].strip()
        keys = parse_keys(a.pubkeys)
    if keys is None:
        die(2, "--pubkeys (or release/endpoints.conf UPDATE_PUBLIC_KEYS in --plugin-dir) must be one or two base64 32-byte public keys")
    if not os.path.isfile(os.path.join(a.plugin_dir, "bin", "sign-release.php")):
        die(2, "--plugin-dir has no bin/sign-release.php (the Plugin repo's verify tool)")
    if a.expect_key_id and not re.fullmatch(r"[0-9a-f]{4}(-[0-9a-f]{4}){3}", a.expect_key_id):
        die(2, "--expect-key-id must look like 9d49-041f-0ced-13ac")
    tool = Tool(a.php, a.plugin_dir)
    workdir = a.out or tempfile.mkdtemp(prefix="aicc-verify-")
    os.makedirs(workdir, exist_ok=True)
    os.chmod(workdir, 0o700)
    print("verify-published-plugin  mode=%s  version=%s  sha256=%s...  work=%s" % (a.mode, a.version, a.sha256[:16], workdir))
    man = check_record(a, tool, keys)
    if a.mode != "offline":
        if not a.base_url:
            die(2, "--base-url is required unless --mode offline")
        pu = urllib.parse.urlparse(a.base_url)
        host = pu.hostname or ""
        if pu.path not in ("", "/") or pu.query or pu.username:
            die(3, "--base-url is an origin only")
        if a.mode == "production" and not (pu.scheme == "https" and host == PROD_HOST and pu.port in (None, 443)):
            die(3, "production mode talks to https://%s only (got %s)" % (PROD_HOST, a.base_url))
        if a.mode == "stage" and not (pu.scheme == "https" and host == STAGE_HOST):
            die(3, "stage mode talks to https://%s only" % STAGE_HOST)
        if a.mode == "fixture" and not (host in ("127.0.0.1", "localhost", "::1") and pu.scheme in ("http", "https")):
            die(3, "fixture mode talks to a loopback address only (got %s)" % a.base_url)
        a.creds = None
        a.other_creds = None
        if a.other_credentials_file:
            c = read_secret_file(a.other_credentials_file, {"AICC_VERIFY_USER", "AICC_VERIFY_PASS"})
            if not (c.get("AICC_VERIFY_USER") and c.get("AICC_VERIFY_PASS")):
                die(2, "the other credentials file must hold AICC_VERIFY_USER=... and AICC_VERIFY_PASS=...")
            a.other_creds = (c["AICC_VERIFY_USER"], c["AICC_VERIFY_PASS"])
        if a.credentials_file:
            c = read_secret_file(a.credentials_file, {"AICC_VERIFY_USER", "AICC_VERIFY_PASS"})
            if c.get("AICC_VERIFY_USER") and c.get("AICC_VERIFY_PASS"):
                a.creds = (c["AICC_VERIFY_USER"], c["AICC_VERIFY_PASS"])
            else:
                die(2, "the credentials file must hold AICC_VERIFY_USER=... and AICC_VERIFY_PASS=...")
        elif a.user_env and a.pass_env:
            if os.environ.get(a.user_env) and os.environ.get(a.pass_env):
                a.creds = (os.environ[a.user_env], os.environ[a.pass_env])
            else:
                die(2, "the environment variables %s / %s are not set" % (a.user_env, a.pass_env))
        if man is None:
            die(1, "the release record could not be read; nothing further was checked")
        http = Http(a.base_url)
        if a.creds:
            good = customer_flow(a, http, man, tool, keys, workdir)
            account_refusals(a, http, man, a.base_url)
            if good and a.other_creds:
                cross_tenant_download(a, http, a.base_url, man)
            if good:
                download_safety(a, http, man, workdir)
        else:
            print("NOTE  no credentials given: the customer download checks (C*, D*) were NOT run")
            account_refusals(a, http, man, a.base_url)
        if not a.no_updater_probes:
            anon = Http(a.base_url)
            updater_refusals(a, anon, man)
            if a.store_file:
                store_flow(a, anon, man, tool, keys, workdir)
            else:
                print("NOTE  no --store-file: the entitled-store checks (U10-U20) were NOT run")
    fails = [r for r in RESULTS if not r[2]]
    print("\nverify-published-plugin: %d checks, %d passed, %d FAILED" % (len(RESULTS), len(RESULTS) - len(fails), len(fails)))
    try:
        with open(os.path.join(workdir, "verify-report.json"), "w") as f:
            json.dump({"mode": a.mode, "version": a.version, "sha256": a.sha256, "results": [{"id": i, "label": l, "ok": o, "detail": d} for i, l, o, d in RESULTS]}, f, indent=1)
    except OSError:
        pass
    sys.exit(0 if not fails and RESULTS else 1)


if __name__ == "__main__":
    main()
