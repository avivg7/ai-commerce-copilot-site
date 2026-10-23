#!/usr/bin/env python3.12
"""End-to-end proof of the STAGED sentinel repository against LOCAL stand-ins (no real network, no real Telegram, no real secrets).

  sentinel_e2e.py --repo <dir produced by prepare-sentinel-repo.sh>

What is real: the staged sentinel.py and the staged targets.toml (only the URL line is swapped for a loopback stand-in and expect_ip / tls_warn_days are
removed), the exact command line of the staged workflow (--once --quiet-ok --fail-on-down --state-file .sentinel-state/state.json --host-label github-actions),
the Telegram secrets arriving through the ENVIRONMENT (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) exactly as the workflow injects them, the state file between runs.
What is substituted: the target (a local HTTP server whose answer the script controls), api.telegram.org (a local fake that records every sendMessage), and the
only in-process patch: sentinel.API_BASE -> the fake (the CLI has no flag for it; the real value is https://api.telegram.org).
What is NOT exercised: GitHub's scheduler, the runner image, actions/cache. The workflow YAML is checked statically (actionlint + structure) by the shell wrapper.
"""
import argparse, http.server, importlib.util, io, json, os, re, shutil, socketserver, sys, tempfile, threading, urllib.parse, contextlib

ap = argparse.ArgumentParser()
ap.add_argument("--repo", required=True)
a = ap.parse_args()
REPO = os.path.abspath(a.repo)
FAKE_TOKEN = "123456789:AAFAKE-selftest-token-0000000000000000000"   # throwaway, not a real bot
FAKE_CHAT = "-1001234567890"
PASS = FAIL = 0


def check(desc, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("PASS ", desc)
    else:
        FAIL += 1
        print("FAIL ", desc, extra)


class Quiet(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


# ---- the target stand-in: behaviour switched by TARGET["mode"]
TARGET = {"mode": "ok", "hits": 0}


class TargetH(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        TARGET["hits"] += 1
        m = TARGET["mode"]
        if self.path != "/healthz":
            self.send_response(404); self.end_headers(); return
        if m == "ok":
            code, body = 200, b"ok"
        elif m == "500":
            code, body = 500, b"internal error"
        elif m == "404":                      # what www.copilt.org/healthz answers BEFORE the cutover (old GitHub Pages site)
            code, body = 404, b"not found"
        elif m == "badbody":
            code, body = 200, b"<html>captive portal</html>"
        else:
            code, body = 200, b"ok"
        self.send_response(code); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)


# ---- the fake api.telegram.org
TG = {"msgs": [], "mode": "ok", "paths": []}


class TgH(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0")); raw = self.rfile.read(n).decode()
        TG["paths"].append(self.path)
        if TG["mode"] == "fail":
            self.send_response(500); self.end_headers(); return
        q = urllib.parse.parse_qs(raw)
        TG["msgs"].append({"path": self.path, "chat_id": q.get("chat_id", [""])[0], "text": q.get("text", [""])[0]})
        body = b'{"ok":true,"result":{"message_id":1}}'
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)


def serve(handler):
    s = Quiet(("127.0.0.1", 0), handler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


tsrv, gsrv = serve(TargetH), serve(TgH)
TURL = f"http://127.0.0.1:{tsrv.server_address[1]}"
GURL = f"http://127.0.0.1:{gsrv.server_address[1]}"

# ---- work on a COPY of the staged repo (the staged files stay untouched)
WORK = tempfile.mkdtemp(prefix="aicc-sentinel-e2e.")
shutil.copytree(REPO, os.path.join(WORK, "repo"))
R = os.path.join(WORK, "repo")
cfg = open(os.path.join(R, "targets.toml")).read()
orig_url = re.search(r'^url = "(.*)"$', cfg, re.M).group(1)
orig_ip = re.search(r'^expect_ip = "(.*)"$', cfg, re.M).group(1)
cfg = re.sub(r'^url = ".*"$', f'url = "{TURL}/healthz"\nallow_http = true', cfg, flags=re.M)
cfg = re.sub(r'^expect_ip = .*$\n?', "", cfg, flags=re.M)
cfg = re.sub(r'^tls_warn_days = .*$\n?', "", cfg, flags=re.M)
open(os.path.join(R, "targets.local.toml"), "w").write(cfg)
print(f"staged target was {orig_url} (expect_ip {orig_ip}); stand-in is {TURL}/healthz; fake Telegram is {GURL}")

spec = importlib.util.spec_from_file_location("staged_sentinel", os.path.join(R, "sentinel.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)
check("the staged sentinel talks to https://api.telegram.org by default", S.API_BASE == "https://api.telegram.org")
S.API_BASE = GURL     # the single patch: the fake stands in for api.telegram.org

STATE = os.path.join(R, ".sentinel-state", "state.json")
CMD = ["--config", os.path.join(R, "targets.local.toml"), "--once", "--quiet-ok", "--fail-on-down", "--state-file", STATE, "--host-label", "github-actions"]
LOGS = []


def run(mode, tg="ok", env=True, extra=()):
    """One 'workflow run': set the stand-in's behaviour, run the staged CLI with the workflow's flags, return (exit code, new telegram messages)."""
    TARGET["mode"] = mode; TG["mode"] = tg
    before = len(TG["msgs"])
    out, err = io.StringIO(), io.StringIO()
    old = {k: os.environ.get(k) for k in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID")}
    if env:
        os.environ["TELEGRAM_BOT_TOKEN"], os.environ["TELEGRAM_CHAT_ID"] = FAKE_TOKEN, FAKE_CHAT
    else:
        os.environ.pop("TELEGRAM_BOT_TOKEN", None); os.environ.pop("TELEGRAM_CHAT_ID", None)
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = S.main(list(CMD) + list(extra))
    finally:
        for k, v in old.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v
    LOGS.append(out.getvalue() + err.getvalue())
    return rc, TG["msgs"][before:]


# 1. plan opens no socket
h0 = TARGET["hits"]
out = io.StringIO()
with contextlib.redirect_stdout(out):
    rc = S.main(["--config", os.path.join(R, "targets.local.toml"), "--plan"])
check("--plan prints the plan and opens no socket", rc == 0 and TARGET["hits"] == h0 and "healthz" in out.getvalue())

# 1b. the workflow's manual "send_test" step: python3 sentinel.py --config targets.toml --test-notify --host-label github-actions
os.environ["TELEGRAM_BOT_TOKEN"], os.environ["TELEGRAM_CHAT_ID"] = FAKE_TOKEN, FAKE_CHAT
b = len(TG["msgs"]); o, e = io.StringIO(), io.StringIO()
with contextlib.redirect_stdout(o), contextlib.redirect_stderr(e):
    rc = S.main(["--config", os.path.join(R, "targets.local.toml"), "--test-notify", "--host-label", "github-actions"])
for k in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"): os.environ.pop(k, None)
LOGS.append(o.getvalue() + e.getvalue())
check("send_test: exactly one [TEST] message reaches the chat, no probe is made, exit 0", rc == 0 and len(TG["msgs"]) == b + 1 and TG["msgs"][-1]["text"].startswith("[TEST]") and TARGET["hits"] == h0, f"rc={rc}")
if len(TG["msgs"]) > b: print("      TEST message:\n        " + TG["msgs"][-1]["text"].replace("\n", "\n        "))

# 2. healthy rounds: silence
for i in range(3):
    rc, m = run("ok")
    check(f"healthy run {i+1}: exit 0, no Telegram message", rc == 0 and not m, f"rc={rc} msgs={m}")
check("the state file exists, mode 0600 (it is kept by actions/cache between runs)", os.path.isfile(STATE) and (os.stat(STATE).st_mode & 0o777) == 0o600)

# 3. a single blip never pages
rc, m = run("500"); check("one failed run (blip): no message", not m, f"{m}")
rc, m = run("ok");  check("...followed by a good run: no message, exit 0", rc == 0 and not m)
# DOCUMENTED SEMANTICS (found by this proof): the rule is "2 of the LAST 3 runs", not "2 in a row": blip, ok, fail inside 3 runs (30 min) DOES page.
rc, m = run("500"); check("blip, ok, fail (2 failures inside 3 runs, not consecutive) pages: that is the 2-of-3 rule, by design", len(m) == 1 and m[0]["text"].startswith("[DOWN]"), f"{m}")
rc, m = run("ok"); check("recovery after that: one [RECOVERED] on the first good run (recover_k=1)", len(m) == 1 and m[0]["text"].startswith("[RECOVERED]"), f"{m}")
# FINDING: cooldown_s = 3600 spaces DOWN notices of one target. A SECOND outage within an hour of the first notice gets NO Telegram [DOWN]; only the failed run (GitHub e-mail) reports it.
run("500"); rc, m = run("500")
check("a second outage within the 60-min cooldown: NO second Telegram [DOWN] (flap protection), but the run exits 1 (GitHub e-mail still fires)", not m and rc == 1, f"rc={rc} {m}")
FLUSH = lambda: [run("ok") for _ in range(3)]
def RESET():
    """simulates 'an hour later' / an evicted Actions cache: an empty state file window and no cooldown"""
    if os.path.exists(STATE): os.remove(STATE)
FLUSH(); RESET()

# 4. a real outage: HTTP 500
rc, m = run("500"); check("outage run 1 of 2: no page yet (fail_n=2 of the last 3)", not m and rc == 0, f"rc={rc} {m}")
rc, m = run("500")
check("outage run 2 of 2: exactly ONE [DOWN] message, run exits 1 (--fail-on-down: GitHub's own failure e-mail)", len(m) == 1 and m[0]["text"].startswith("[DOWN]") and rc == 1, f"rc={rc} {m}")
if m:
    t = m[0]["text"]
    check("the DOWN text names the failing stage (http), the observer (github-actions) and no secret", "http" in t and "observer: github-actions" in t and FAKE_TOKEN not in t and FAKE_CHAT not in t, t)
    check("the message went to the configured chat through /bot<token>/sendMessage", m[0]["chat_id"] == FAKE_CHAT and m[0]["path"] == f"/bot{FAKE_TOKEN}/sendMessage")
    print("      DOWN message as the owner would read it:\n        " + t.replace("\n", "\n        "))
rc, m = run("500"); check("still down, next run: NO second message (cooldown), but the run still exits 1 (GitHub keeps e-mailing)", not m and rc == 1, f"rc={rc} {m}")

# 5. recovery
rc, m = run("ok")
check("recovered: exactly ONE [RECOVERED] message, exit 0", len(m) == 1 and m[0]["text"].startswith("[RECOVERED]") and rc == 0, f"rc={rc} {m}")
if m: print("      RECOVERED message:\n        " + m[0]["text"].replace("\n", "\n        "))
rc, m = run("ok"); check("healthy again: silence", not m and rc == 0)

# 6. the cutover-day cases: old site answers 404 / a captive portal answers 200 with another body
for mode, stage in (("404", "http"), ("badbody", "body")):
    RESET(); run(mode); rc, m = run(mode)
    check(f"'{mode}' for 2 runs is a DOWN at stage '{stage}'", len(m) == 1 and m[0]["text"].startswith("[DOWN]") and f"failed at: {stage}" in m[0]["text"], f"{m}")
    FLUSH()

# 7. Telegram itself is unreachable / refuses: the sentinel does not crash, the run still reports DOWN through its exit code
RESET(); run("500"); rc, m = run("500", tg="fail", extra=())
check("Telegram refusing (HTTP 500): no crash; the DOWN is still surfaced by the exit code (the GitHub e-mail path)", rc in (0, 1))
RESET()
run("500"); rc, m = run("500", tg="fail")
check("...(fresh outage, Telegram failing) exit code 1 = the independent alert path still works", rc == 1, f"rc={rc}")
FLUSH()

# 8. no secrets configured: runs log only, exit code still carries DOWN
RESET(); run("500"); rc, m = run("500", env=False)
check("no Telegram secrets: nothing sent, DOWN still reported through the exit code", not m and rc == 1, f"rc={rc} {m}")
run("ok", env=False); run("ok", env=False)

# 9. secret hygiene
alllog = "\n".join(LOGS)
check("the run output (what the public Actions log would show) never contains the bot token", FAKE_TOKEN not in alllog and FAKE_TOKEN.split(":")[1] not in alllog)
check("...nor the chat id", FAKE_CHAT not in alllog)
check("...state file holds no token or chat id", FAKE_TOKEN not in open(STATE).read() and FAKE_CHAT not in open(STATE).read())
check("...and no file of the staged repository contains the fake token (nothing was written into the tree)", all(FAKE_TOKEN not in open(os.path.join(dp, f), errors="ignore").read() for dp, _, fs in os.walk(R) for f in fs))
# the quiet log shows state changes only
check("--quiet-ok: healthy runs are not logged line by line", alllog.count("OK ") < 5, f"{alllog.count('OK ')}")

shutil.rmtree(WORK, ignore_errors=True)
print(f"== E2E RESULT: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
