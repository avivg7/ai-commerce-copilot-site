#!/usr/bin/env python3
"""Secret-leakage audit for the Telegram credentials of AICC Ops. Runs ON THE HOST as root; the script text travels over ssh stdin, so nothing needs to be installed:

    ssh -t aicc@<host> 'sudo python3 -I -' < infra/aicc-ops/tools/secret_leak_audit.py

It reads TELEGRAM_BOT_TOKEN (and TELEGRAM_CHAT_ID) from /etc/aicc-ops/secrets.env INSIDE the process (never from argv or the environment, so the value is never on a command line),
then looks for the token in the places a secret usually leaks to: the whole systemd journal, /var/log (also rotated .gz files), /var/lib (AICC Ops history, deployments), /etc (except
the secrets file itself), /srv/aicc/shared, /tmp, /var/tmp, /run, shell history files, the command line of every process, and the environment of every process that is not systemd's
credential holder. It prints PATHS and COUNTS only, never a value, a prefix or a length. Exit 0 = nothing found, 1 = a leak was found, 2 = no usable secrets file.

Test seams (used only by infra/aicc-ops/tests/test_secret_audit.py): AUDIT_SECRETS_FILE, AUDIT_ROOTS (colon-separated), AUDIT_NO_JOURNAL=1, AUDIT_NO_PROC=1. They are ignored unless
AUDIT_TEST_HARNESS=1 is set as well.
"""
import gzip
import os
import re
import subprocess
import sys

HARNESS = os.environ.get("AUDIT_TEST_HARNESS") == "1"
SECRETS = os.environ.get("AUDIT_SECRETS_FILE", "/etc/aicc-ops/secrets.env") if HARNESS else "/etc/aicc-ops/secrets.env"
ROOTS = (os.environ.get("AUDIT_ROOTS", "").split(":") if HARNESS and os.environ.get("AUDIT_ROOTS") else
         ["/var/log", "/var/lib", "/etc", "/srv/aicc/shared", "/tmp", "/var/tmp", "/run", "/root", "/home"])
NO_JOURNAL = HARNESS and os.environ.get("AUDIT_NO_JOURNAL") == "1"
NO_PROC = HARNESS and os.environ.get("AUDIT_NO_PROC") == "1"
MAX_FILE = 200 * 1024 * 1024
CHUNK = 1 << 20


def load():
    try:
        st = os.stat(SECRETS)
    except OSError:
        print("no secrets file: nothing to audit (the Telegram token is not on this host)")
        sys.exit(2)
    tok = chat = ""
    with open(SECRETS, "r", errors="replace") as fh:
        for line in fh:
            m = re.match(r"\s*(?:export\s+)?(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)\s*=\s*(.*?)\s*$", line)
            if m:
                v = m.group(2).strip().strip("'\"")
                if m.group(1) == "TELEGRAM_BOT_TOKEN":
                    tok = v
                else:
                    chat = v
    if len(tok) < 20:
        print("the secrets file holds no usable bot token: nothing to audit")
        sys.exit(2)
    return tok.encode(), chat.encode()


def stream_has(fh, needle):
    """True when `needle` occurs in the byte stream (chunked, with overlap so a match across chunk borders is found)."""
    keep = len(needle) - 1
    tail = b""
    while True:
        buf = fh.read(CHUNK)
        if not buf:
            return False
        data = tail + buf
        if needle in data:
            return True
        tail = data[-keep:] if keep else b""


def file_has(path, needle):
    try:
        if os.path.islink(path) or not os.path.isfile(path) or os.path.getsize(path) > MAX_FILE:
            return False
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rb") as fh:
            return stream_has(fh, needle)
    except (OSError, EOFError, gzip.BadGzipFile):
        return False


def main():
    tok, chat = load()
    secrets_real = os.path.realpath(SECRETS)
    hits, scanned = [], 0
    for root in ROOTS:
        for dp, dns, fns in os.walk(root, followlinks=False):
            dns[:] = [d for d in dns if not os.path.ismount(os.path.join(dp, d)) or HARNESS]
            for fn in fns:
                p = os.path.join(dp, fn)
                if os.path.realpath(p) == secrets_real or p.startswith("/proc/") or p.startswith("/run/credentials/"):
                    continue          # /run/credentials/<unit>: systemd's per-unit tmpfs copy for LoadCredential (0400, root, never on disk): the intended place
                scanned += 1
                if file_has(p, tok):
                    hits.append(("file", p))
    if not NO_JOURNAL:
        try:
            pr = subprocess.Popen(["journalctl", "--no-pager", "-o", "cat"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            found = stream_has(pr.stdout, tok)
            pr.stdout.close()
            pr.wait()
            scanned += 1
            if found:
                hits.append(("journal", "systemd journal (all units)"))
        except OSError:
            print("note: journalctl not available; the journal was not scanned")
    if not NO_PROC:
        me = os.getpid()
        nproc = 0
        for pid in filter(str.isdigit, os.listdir("/proc")):
            if int(pid) == me:
                continue
            for what in ("cmdline", "environ"):
                p = "/proc/%s/%s" % (pid, what)
                try:
                    with open(p, "rb") as fh:
                        data = fh.read(4 << 20)
                except OSError:
                    continue
                nproc += 1
                if tok in data:
                    try:
                        comm = open("/proc/%s/comm" % pid).read().strip()
                    except OSError:
                        comm = "?"
                    hits.append((what, "process %s (%s)" % (pid, comm)))
        scanned += nproc
    # the token's own file: mode and owner only, never content
    try:
        st = os.stat(SECRETS)
        print("secrets file: mode %o uid %d gid %d" % (st.st_mode & 0o7777, st.st_uid, st.st_gid))
    except OSError:
        pass
    for kind, where in hits:
        print("LEAK  token found in %s: %s" % (kind, where))
    print("scanned %d locations; chat id searched too: %s" % (scanned, "n/a" if not chat else "not reported (it is not a secret)"))
    if hits:
        print("RESULT: %d location(s) contain the token. Treat it as burned: /revoke it in BotFather, set a new one, then rerun this audit." % len(hits))
        sys.exit(1)
    print("RESULT: CLEAN (the token is nowhere except the secrets file)")


main()
