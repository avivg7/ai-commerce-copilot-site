#!/usr/bin/env python3
"""AICC Sentinel: a tiny EXTERNAL availability checker (reference implementation, NOT deployed).

It is meant to run in a DIFFERENT failure domain than the host it watches (see DESIGN.md). Python 3.11+ stdlib only.

Hard-coded safety rules (not configurable):
  * HTTP GET or HEAD only. Never POST/PUT/DELETE. No request bodies, no cookies, no Authorization, no credentials in URLs.
  * https:// only, unless a target explicitly sets allow_http = true (meant for local tests).
  * Redirects are followed only within the SAME origin (scheme+host+port), at most 3; a redirect anywhere else is a
    failed check ("redirect off-target refused"), never followed.
  * User-Agent is always `AICC-Sentinel/1.0 (availability check)`.
  * Interval is >= 60 s (refused below that).
  * It only contacts URLs listed in the targets file, plus api.telegram.org for outbound alerts.
Telegram semantics are the same as AICC Ops (outbound sendMessage only; disabled without secrets; --dry-run prints and
never opens a socket; no PII). The adapter is vendored here so this file can live alone on another machine.
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import re
import socket
import ssl
import sys
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request

UA = "AICC-Sentinel/1.0 (availability check)"
MIN_INTERVAL = 60
MAX_BODY = 64 * 1024
MAX_REDIRECTS = 3
API_BASE = "https://api.telegram.org"
NAME_RE = re.compile(r"^[A-Za-z0-9._\- ]{1,60}$")


class ConfigError(ValueError):
    pass


# --------------------------------------------------------------------------------------------------- configuration
DEFAULTS = {"interval_s": 60, "fail_n": 3, "window_m": 5, "recover_k": 2, "cooldown_s": 1800, "remind_s": 21600,
            "state_file": "sentinel-state.json", "secrets_file": "", "host_label": "aicc-sentinel"}
TARGET_DEFAULTS = {"method": "GET", "expect_status": 200, "expect_body": "", "expect_header": "", "tls_warn_days": 14,
                   "latency_ms": 2000, "timeout_s": 10, "allow_http": False, "ca_file": "", "enabled": True}


def load_config(path: str) -> dict:
    with open(path, "rb") as fh:
        raw = tomllib.load(fh)
    s = {**DEFAULTS, **raw.get("sentinel", {})}
    if s["interval_s"] < MIN_INTERVAL:
        raise ConfigError(f"interval_s must be >= {MIN_INTERVAL} (polite polling)")
    if not (1 <= s["fail_n"] <= s["window_m"] <= 50) or not (1 <= s["recover_k"] <= 50):
        raise ConfigError("need 1 <= fail_n <= window_m <= 50 and 1 <= recover_k <= 50")
    targets, names = [], set()
    for t in raw.get("target", []):
        t = {**TARGET_DEFAULTS, **t}
        validate_target(t)
        if t["name"] in names:
            raise ConfigError(f"duplicate target name {t['name']!r}")
        names.add(t["name"])
        targets.append(t)
    if not targets:
        raise ConfigError("no [[target]] defined")
    return {"sentinel": s, "targets": targets}


def validate_target(t: dict) -> None:
    if not NAME_RE.match(str(t.get("name", ""))):
        raise ConfigError("target name must be 1-60 chars of [A-Za-z0-9._- ]")
    u = urllib.parse.urlsplit(str(t.get("url", "")))
    if u.scheme not in ("https", "http") or not u.hostname:
        raise ConfigError(f"{t['name']}: url must be http(s) with a host")
    if u.username or u.password or "@" in u.netloc:
        raise ConfigError(f"{t['name']}: credentials in URLs are not allowed")
    if u.scheme == "http" and not t["allow_http"]:
        raise ConfigError(f"{t['name']}: non-https target refused (set allow_http = true only for local tests)")
    if t["method"] not in ("GET", "HEAD"):
        raise ConfigError(f"{t['name']}: method must be GET or HEAD")
    if not (1 <= t["timeout_s"] <= 30):
        raise ConfigError(f"{t['name']}: timeout_s must be 1..30")
    if t["method"] == "HEAD" and t["expect_body"]:
        raise ConfigError(f"{t['name']}: expect_body needs GET")


# --------------------------------------------------------------------------------------------------- probing
def origin(u: urllib.parse.SplitResult):
    port = u.port or (443 if u.scheme == "https" else 80)
    return (u.scheme, (u.hostname or "").lower(), port)


def _connect(u, t, timeout):
    if u.scheme == "https":
        ctx = ssl.create_default_context(cafile=t["ca_file"] or None)
        conn = http.client.HTTPSConnection(u.hostname, u.port or 443, timeout=timeout, context=ctx)
    else:
        conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=timeout)
    return conn


def probe(t: dict, now: float | None = None) -> dict:
    """One check. Returns {ok, reason, status, latency_ms, tls_days}. Never raises."""
    res = {"ok": False, "reason": "", "status": None, "latency_ms": None, "tls_days": None}
    url = t["url"]
    start_origin = origin(urllib.parse.urlsplit(url))
    t0 = time.monotonic()
    try:
        for hop in range(MAX_REDIRECTS + 1):
            u = urllib.parse.urlsplit(url)
            if origin(u) != start_origin:
                res["reason"] = "redirect off-target refused"
                return res
            if u.scheme == "http" and not t["allow_http"]:
                res["reason"] = "non-https redirect refused"
                return res
            conn = _connect(u, t, t["timeout_s"])
            try:
                path = (u.path or "/") + (("?" + u.query) if u.query else "")
                conn.request(t["method"], path, headers={"User-Agent": UA, "Accept": "*/*", "Connection": "close"})
                if u.scheme == "https" and conn.sock is not None:
                    cert = conn.sock.getpeercert()
                    if cert and "notAfter" in cert:
                        res["tls_days"] = (ssl.cert_time_to_seconds(cert["notAfter"]) - (now or time.time())) / 86400.0
                r = conn.getresponse()
                body = r.read(MAX_BODY) if t["method"] == "GET" else b""
                status = r.status
                loc = r.getheader("Location")
                hdrs = {k.lower(): v for k, v in r.getheaders()}
            finally:
                conn.close()
            if status in (301, 302, 303, 307, 308) and loc:
                url = urllib.parse.urljoin(url, loc)
                continue
            break
        else:
            res["reason"] = "too many redirects"
            return res
    except ssl.SSLCertVerificationError:
        res["reason"] = "TLS certificate verification failed"
        return res
    except ssl.SSLError:
        res["reason"] = "TLS error"
        return res
    except socket.timeout:
        res["reason"] = f"timeout after {t['timeout_s']} s"
        return res
    except socket.gaierror:
        res["reason"] = "DNS resolution failed"
        return res
    except ConnectionRefusedError:
        res["reason"] = "connection refused"
        return res
    except (OSError, http.client.HTTPException) as e:
        res["reason"] = f"connection error ({type(e).__name__})"
        return res
    res["latency_ms"] = (time.monotonic() - t0) * 1000.0
    res["status"] = status
    if status != t["expect_status"]:
        res["reason"] = f"HTTP {status} (expected {t['expect_status']})"
    elif t["expect_body"] and t["expect_body"].encode() not in body:
        res["reason"] = "expected body text not found"
    elif t["expect_header"] and not header_matches(t["expect_header"], hdrs):
        res["reason"] = "expected header not found"
    elif res["latency_ms"] > t["latency_ms"]:
        res["reason"] = f"slow response ({res['latency_ms']:.0f} ms > {t['latency_ms']} ms)"
    else:
        res["ok"] = True
    return res


def header_matches(spec: str, hdrs: dict) -> bool:
    name, _, want = spec.partition(":")
    got = hdrs.get(name.strip().lower())
    return got is not None and want.strip().lower() in got.lower()


# --------------------------------------------------------------------------------------------------- state machine
def new_state():
    return {"status": "up", "window": [], "ok_streak": 0, "since": None, "last_down_notice": 0.0, "last_notice": 0.0,
            "last_tls_notice": 0.0, "down_notified": False, "last": None}


def step(tstate: dict, res: dict, cfg: dict, now: float, name: str) -> list:
    """Advance one target; returns [(kind, text)] where kind in DOWN/RECOVERED/REMINDER/WARNING. N-of-M down, K-successes up."""
    s = cfg
    notes = []
    tstate["last"] = {"ts": now, "ok": res["ok"], "reason": res["reason"], "status": res["status"], "latency_ms": res["latency_ms"]}
    tstate["window"] = (tstate["window"] + [bool(res["ok"])])[-s["window_m"]:]
    fails = tstate["window"].count(False)
    tstate["ok_streak"] = tstate["ok_streak"] + 1 if res["ok"] else 0
    if tstate["status"] == "up":
        if fails >= s["fail_n"] and len(tstate["window"]) >= s["fail_n"]:
            tstate["status"], tstate["since"] = "down", now
            tstate["down_notified"] = False
            if now - tstate["last_down_notice"] >= s["cooldown_s"]:
                tstate["down_notified"] = True
                tstate["last_down_notice"] = tstate["last_notice"] = now
                notes.append(("DOWN", f"{res['reason'] or 'check failed'} ({fails} of last {len(tstate['window'])} checks failed)"))
    else:
        if tstate["ok_streak"] >= s["recover_k"]:
            dur = now - (tstate["since"] or now)
            if tstate["down_notified"]:
                notes.append(("RECOVERED", f"back up after {int(dur // 60)} min ({tstate['ok_streak']} consecutive good checks)"))
            tstate["status"], tstate["since"], tstate["window"], tstate["down_notified"] = "up", None, [], False
        elif not tstate["down_notified"] and now - tstate["last_down_notice"] >= s["cooldown_s"]:
            tstate["down_notified"] = True
            tstate["last_down_notice"] = tstate["last_notice"] = now
            notes.append(("DOWN", f"{res['reason'] or 'check failed'} (still failing)"))
        elif s["remind_s"] and now - tstate["last_notice"] >= s["remind_s"] and tstate["down_notified"]:
            tstate["last_notice"] = now
            notes.append(("REMINDER", f"still down since {int((now - tstate['since']) // 60)} min: {res['reason']}"))
    return notes


def tls_note(tstate: dict, res: dict, target: dict, cfg: dict, now: float):
    d = res.get("tls_days")
    if d is not None and d < target["tls_warn_days"] and now - tstate["last_tls_notice"] >= cfg["cooldown_s"] * 8:
        tstate["last_tls_notice"] = now
        return ("WARNING", f"TLS certificate expires in {max(d, 0):.0f} days")
    return None


# --------------------------------------------------------------------------------------------------- telegram (vendored)
PII = [re.compile(p) for p in (r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", r"\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b",
                               r"\b\d{6,}:[A-Za-z0-9_\-]{20,}\b", r"\b[A-Za-z0-9+/_\-]{32,}\b")]


def sanitize(text: str) -> str:
    for rx in PII:
        text = rx.sub("[redacted]", text)
    return "".join(c for c in text if c == "\n" or c >= " ")[:3500]


def load_secrets(path: str, environ=None):
    environ = os.environ if environ is None else environ
    cred = environ.get("CREDENTIALS_DIRECTORY")
    paths = ([os.path.join(cred, "secrets.env")] if cred else []) + ([os.path.expanduser(path)] if path else [])
    for p in paths:
        try:
            if p != os.path.join(cred or "\0", "secrets.env") and os.stat(p).st_mode & 0o077:
                continue  # fail closed on a group/world accessible secrets file
            env = {}
            with open(p) as fh:
                for line in fh:
                    k, _, v = line.strip().partition("=")
                    if k and not k.startswith("#"):
                        env[k.strip()] = v.strip().strip("\"'")
            if env.get("TELEGRAM_BOT_TOKEN") and env.get("TELEGRAM_CHAT_ID"):
                return env["TELEGRAM_BOT_TOKEN"], env["TELEGRAM_CHAT_ID"]
        except OSError:
            continue
    return None, None


class Notifier:
    def __init__(self, secrets_file: str, host_label: str, dry_run=False, out=None, log=None, test_base_url=None, environ=None, retries=3, backoff=2.0, sleep=time.sleep):
        self.host, self.dry_run, self.out = host_label, dry_run, out or sys.stdout
        self.log = log or (lambda m: print(m, file=sys.stderr))
        self.base = API_BASE
        if test_base_url is not None:
            if not re.match(r"^http://127\.0\.0\.1:\d{1,5}$", test_base_url):
                raise ValueError("test base URL must be http://127.0.0.1:<port>")
            self.base = test_base_url
        self.token, self.chat = load_secrets(secrets_file, environ)
        self.enabled = bool(self.token and self.chat)
        self.retries, self.backoff, self.sleep = retries, backoff, sleep
        self.sent = self.failed = 0
        if not self.enabled and not dry_run:
            self.log("sentinel: Telegram disabled (no secrets); events are logged only")

    def render(self, kind: str, target: str, text: str, since=None) -> str:
        head = {"DOWN": "[DOWN]", "RECOVERED": "[RECOVERED]", "REMINDER": "[DOWN, still]", "WARNING": "[WARNING]"}[kind]
        return sanitize(f"{head} {target}\n{text}\nobserver: {self.host}")

    def send(self, kind, target, text) -> bool:
        msg = self.render(kind, target, text)
        if self.dry_run:
            print(f"DRY-RUN telegram sendMessage (no socket opened):\n---\n{msg}\n---", file=self.out, flush=True)
            return True
        if not self.enabled:
            return False
        body = urllib.parse.urlencode({"chat_id": self.chat, "text": msg, "disable_web_page_preview": "true"}).encode()
        delay = self.backoff
        for attempt in range(1, self.retries + 1):
            try:
                req = urllib.request.Request(f"{self.base}/bot{self.token}/sendMessage", data=body, method="POST",
                                             headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA})
                with urllib.request.urlopen(req, timeout=10) as r:  # nosec - fixed API host (127.0.0.1 only in tests)
                    r.read(4096)
                self.sent += 1
                return True
            except urllib.error.HTTPError as e:
                if 400 <= e.code < 500 and e.code != 429:
                    break
            except (urllib.error.URLError, OSError):
                pass
            if attempt < self.retries:
                self.sleep(min(delay, 60))
                delay *= 2
        self.failed += 1
        return False


# --------------------------------------------------------------------------------------------------- runner
class Sentinel:
    def __init__(self, cfg: dict, notifier: Notifier, state_path: str | None = None, log=None):
        self.cfg, self.n = cfg, notifier
        self.state_path = state_path or cfg["sentinel"]["state_file"]
        self.log = log or (lambda m: print(m, flush=True))
        self.state = self._load()

    def _load(self) -> dict:
        try:
            with open(self.state_path) as fh:
                d = json.load(fh)
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self):
        tmp = self.state_path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(self.state, fh)
        os.replace(tmp, self.state_path)

    def run_once(self, now: float | None = None) -> list:
        now = time.time() if now is None else now
        events = []
        for t in self.cfg["targets"]:
            if not t["enabled"]:
                continue
            ts = self.state.setdefault(t["name"], new_state())
            for k, v in new_state().items():
                ts.setdefault(k, v)
            res = probe(t, now)
            notes = step(ts, res, self.cfg["sentinel"], now, t["name"])
            tn = tls_note(ts, res, t, self.cfg["sentinel"], now)
            if tn:
                notes.append(tn)
            self.log(f"{time.strftime('%H:%M:%S', time.gmtime(now))} {t['name']}: {'ok' if res['ok'] else 'FAIL'} "
                     f"{res['status'] or '-'} {('%.0fms' % res['latency_ms']) if res['latency_ms'] else ''} {res['reason']} [{ts['status']}]")
            for kind, text in notes:
                events.append((t["name"], kind, text))
                self.n.send(kind, t["name"], text)
        try:
            self._save()
        except OSError as e:
            self.log(f"state not saved: {e}")
        return events

    def plan(self) -> str:
        lines = [f"interval {self.cfg['sentinel']['interval_s']} s; DOWN after {self.cfg['sentinel']['fail_n']} of {self.cfg['sentinel']['window_m']} failures; "
                 f"RECOVERED after {self.cfg['sentinel']['recover_k']} successes; state file {self.state_path}"]
        for t in self.cfg["targets"]:
            lines.append(f"{'on ' if t['enabled'] else 'OFF'} {t['method']} {t['url']} expect {t['expect_status']}"
                         + (f" body~{t['expect_body']!r}" if t["expect_body"] else "") + f" latency<={t['latency_ms']}ms tls_warn<{t['tls_warn_days']}d")
        return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="AICC Sentinel (external availability checker)")
    ap.add_argument("--config", required=True)
    ap.add_argument("--once", action="store_true", help="run one round and exit (cron/launchd/CI friendly)")
    ap.add_argument("--dry-run", action="store_true", help="print would-be Telegram messages; probes still run, Telegram is never contacted")
    ap.add_argument("--plan", action="store_true", help="print what would be probed and exit; opens no socket at all")
    ap.add_argument("--state")
    a = ap.parse_args(argv)
    try:
        cfg = load_config(a.config)
    except (ConfigError, OSError, tomllib.TOMLDecodeError) as e:
        print(f"sentinel: config error: {e}", file=sys.stderr)
        return 2
    n = Notifier(cfg["sentinel"]["secrets_file"], cfg["sentinel"]["host_label"], dry_run=a.dry_run or a.plan)
    s = Sentinel(cfg, n, a.state)
    if a.plan:
        print(s.plan())
        return 0
    if a.once:
        s.run_once()
        return 0
    while True:
        t0 = time.monotonic()
        s.run_once()
        time.sleep(max(cfg["sentinel"]["interval_s"] - (time.monotonic() - t0), 1))


if __name__ == "__main__":
    sys.exit(main())
