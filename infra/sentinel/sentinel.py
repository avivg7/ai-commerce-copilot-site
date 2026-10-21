#!/usr/bin/env python3
"""AICC Sentinel: a tiny EXTERNAL availability checker (see DESIGN.md; not installed anywhere until the owner runs the installer).

It is meant to run in a DIFFERENT failure domain than the host it watches (see DESIGN.md). Python 3.11+ stdlib only.

Hard-coded safety rules (not configurable):
  * HTTP GET or HEAD only. Never POST/PUT/DELETE. No request bodies, no cookies, no Authorization, no credentials in URLs.
  * https:// only, unless a target explicitly sets allow_http = true (meant for local tests).
  * Redirects are followed only within the SAME origin (scheme+host+port), at most 3; a redirect anywhere else is a
    failed check ("redirect off-target refused"), never followed.
  * User-Agent is always `AICC-Sentinel/1.0 (availability check)`.
  * Interval is >= 60 s (refused below that).
  * It only contacts URLs listed in the targets file, plus api.telegram.org for outbound alerts (and, only when a target failed at the
    dns/connect stage and `control_host` is set, one bare TCP+TLS handshake to that host to tell "the target is down" from "I am offline").
Telegram semantics are the same as AICC Ops (outbound sendMessage only; disabled without secrets; --dry-run prints and
never opens a socket; no PII). The adapter is vendored here so this file can live alone on another machine.
"""
from __future__ import annotations

import argparse
import http.client
import ipaddress
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import threading
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request

VERSION = "1.1"
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
            "state_file": "sentinel-state.json", "secrets_file": "", "host_label": "aicc-sentinel",
            "stale_after_s": 1800,   # an "up" target whose previous check is older than this starts a fresh window (Mac slept / CI skipped runs)
            "control_host": ""}      # optional: host for a bare TCP+TLS handshake used only to tell "observer offline" from "target down"
TARGET_DEFAULTS = {"method": "GET", "expect_status": 200, "expect_body": "", "expect_header": "", "expect_ip": "", "tls_warn_days": 14,
                   "latency_ms": 2000, "timeout_s": 10, "allow_http": False, "ca_file": "", "enabled": True,
                   "interval_s": 0}   # 0 = use [sentinel].interval_s; per-target value must be >= 60


def load_config(path: str) -> dict:
    with open(path, "rb") as fh:
        raw = tomllib.load(fh)
    s = {**DEFAULTS, **raw.get("sentinel", {})}
    if s["interval_s"] < MIN_INTERVAL:
        raise ConfigError(f"interval_s must be >= {MIN_INTERVAL} (polite polling)")
    if not (1 <= s["fail_n"] <= s["window_m"] <= 50) or not (1 <= s["recover_k"] <= 50):
        raise ConfigError("need 1 <= fail_n <= window_m <= 50 and 1 <= recover_k <= 50")
    if not isinstance(s["stale_after_s"], int) or s["stale_after_s"] < 60:
        raise ConfigError("stale_after_s must be an integer >= 60")
    if s["control_host"] and not re.match(r"^[A-Za-z0-9.\-]{1,253}$", str(s["control_host"])):
        raise ConfigError("control_host must be a bare host name")
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


def as_list(v) -> list:
    """expect_body / expect_ip may be one string or a list of strings; '' / [] mean 'no check'."""
    if v in ("", None):
        return []
    return list(v) if isinstance(v, (list, tuple)) else [v]


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
    bodies = as_list(t["expect_body"])
    if any(not isinstance(b, str) or not b for b in bodies):
        raise ConfigError(f"{t['name']}: expect_body must be a non-empty string or a list of non-empty strings")
    if t["method"] == "HEAD" and bodies:
        raise ConfigError(f"{t['name']}: expect_body needs GET")
    for ip in as_list(t["expect_ip"]):
        try:
            ipaddress.ip_address(ip)
        except ValueError:
            raise ConfigError(f"{t['name']}: expect_ip {ip!r} is not an IP address") from None
    iv = t["interval_s"]
    if not isinstance(iv, int) or isinstance(iv, bool) or (iv != 0 and not (MIN_INTERVAL <= iv <= 86400)):
        raise ConfigError(f"{t['name']}: interval_s must be 0 (inherit) or {MIN_INTERVAL}..86400")


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


def resolve(host: str, port: int, timeout: float) -> list:
    """System resolver (getaddrinfo) with a hard timeout; returns the sorted, de-duplicated address strings. Raises socket.gaierror / socket.timeout."""
    box: dict = {}

    def work():
        try:
            box["r"] = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError as e:
            box["e"] = e

    th = threading.Thread(target=work, daemon=True)
    th.start()
    th.join(timeout)
    if th.is_alive():
        raise socket.timeout("dns timeout")
    if "e" in box:
        raise box["e"]
    return sorted({str(ipaddress.ip_address(ai[4][0].split("%")[0])) for ai in box["r"]})


def probe(t: dict, now: float | None = None) -> dict:
    """One check. Returns {ok, stage, reason, status, latency_ms, tls_days, dns}. Never raises.

    `stage` names the part that failed: dns | connect | tls | http | body | header | latency ("" when ok). Order of the checks:
    DNS (+ expect_ip) -> TCP connect -> TLS handshake/verification -> HTTP status -> expect_body -> expect_header -> latency ceiling."""
    res = {"ok": False, "stage": "", "reason": "", "status": None, "latency_ms": None, "tls_days": None, "dns": None}

    def fail(stage: str, reason: str) -> dict:
        res["stage"], res["reason"] = stage, reason
        return res

    url = t["url"]
    first = urllib.parse.urlsplit(url)
    start_origin = origin(first)
    t0 = time.monotonic()
    # ---- dns: the system resolver, and (optionally) an assertion on the answer so a changed or hijacked record is a failure
    try:
        addrs = resolve(first.hostname or "", first.port or (443 if first.scheme == "https" else 80), t["timeout_s"])
    except socket.timeout:
        return fail("dns", f"DNS resolution timed out after {t['timeout_s']} s")
    except OSError:
        return fail("dns", "DNS resolution failed")
    res["dns"] = addrs
    want = {str(ipaddress.ip_address(x)) for x in as_list(t["expect_ip"])}
    if want:
        unexpected = [a for a in addrs if a not in want]
        if not addrs or unexpected:
            return fail("dns", f"DNS answer differs from expect_ip ({len(unexpected)} of {len(addrs)} resolved address(es) not expected)")
    stage = "connect"
    try:
        for hop in range(MAX_REDIRECTS + 1):
            u = urllib.parse.urlsplit(url)
            if origin(u) != start_origin:
                return fail("http", "redirect off-target refused")
            if u.scheme == "http" and not t["allow_http"]:
                return fail("http", "non-https redirect refused")
            conn = _connect(u, t, t["timeout_s"])
            try:
                stage = "connect"
                conn.connect()          # TCP, then the TLS handshake and certificate verification for https
                stage = "http"
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
            return fail("http", "too many redirects")
    except ssl.SSLCertVerificationError:
        return fail("tls", "TLS certificate verification failed")
    except ssl.SSLError:
        return fail("tls", "TLS error")
    except socket.timeout:
        return fail(stage, f"timeout after {t['timeout_s']} s")
    except socket.gaierror:
        return fail("dns", "DNS resolution failed")
    except ConnectionRefusedError:
        return fail("connect", "connection refused")
    except (OSError, http.client.HTTPException) as e:
        return fail(stage, f"connection error ({type(e).__name__})")
    res["latency_ms"] = (time.monotonic() - t0) * 1000.0
    res["status"] = status
    bodies = as_list(t["expect_body"])
    missing = next((i for i, b in enumerate(bodies) if b.encode() not in body), None)
    if status != t["expect_status"]:
        return fail("http", f"HTTP {status} (expected {t['expect_status']})")
    if missing is not None:
        return fail("body", "expected body text not found" + (f" (item {missing + 1} of {len(bodies)})" if len(bodies) > 1 else ""))
    if t["expect_header"] and not header_matches(t["expect_header"], hdrs):
        return fail("header", "expected header not found")
    if res["latency_ms"] > t["latency_ms"]:
        return fail("latency", f"slow response ({res['latency_ms']:.0f} ms > {t['latency_ms']} ms)")
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


def why(res: dict) -> str:
    """Operator-facing failure text that names the failing part (dns / connect / tls / http / body / header / latency)."""
    r = res.get("reason") or "check failed"
    return f"{r} (failed at: {res['stage']})" if res.get("stage") else r


def step(tstate: dict, res: dict, cfg: dict, now: float, name: str) -> list:
    """Advance one target; returns [(kind, text)] where kind in DOWN/RECOVERED/REMINDER/WARNING. N-of-M down, K-successes up."""
    s = cfg
    notes = []
    tstate["last"] = {"ts": now, "ok": res["ok"], "stage": res.get("stage", ""), "reason": res["reason"], "status": res["status"],
                      "latency_ms": res["latency_ms"], "tls_days": res.get("tls_days")}
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
                notes.append(("DOWN", f"{why(res)} ({fails} of last {len(tstate['window'])} checks failed)"))
    else:
        if tstate["ok_streak"] >= s["recover_k"]:
            dur = now - (tstate["since"] or now)
            if tstate["down_notified"]:
                notes.append(("RECOVERED", f"back up after {int(dur // 60)} min ({tstate['ok_streak']} consecutive good checks)"))
            tstate["status"], tstate["since"], tstate["window"], tstate["down_notified"] = "up", None, [], False
        elif not tstate["down_notified"] and now - tstate["last_down_notice"] >= s["cooldown_s"]:
            tstate["down_notified"] = True
            tstate["last_down_notice"] = tstate["last_notice"] = now
            notes.append(("DOWN", f"{why(res)} (still failing)"))
        elif s["remind_s"] and now - tstate["last_notice"] >= s["remind_s"] and tstate["down_notified"]:
            tstate["last_notice"] = now
            notes.append(("REMINDER", f"still down since {int((now - tstate['since']) // 60)} min: {why(res)}"))
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
    tok, chat = environ.get("TELEGRAM_BOT_TOKEN", ""), environ.get("TELEGRAM_CHAT_ID", "")   # CI: secrets injected through env:
    return (tok, chat) if tok and chat else (None, None)


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
        head = {"DOWN": "[DOWN]", "RECOVERED": "[RECOVERED]", "REMINDER": "[DOWN, still]", "WARNING": "[WARNING]", "TEST": "[TEST]"}[kind]
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


# --------------------------------------------------------------------------------------------------- local helpers
LOCAL_TITLES = {"DOWN": "AICC Sentinel: a target is DOWN", "RECOVERED": "AICC Sentinel: a target recovered",
                "REMINDER": "AICC Sentinel: a target is still DOWN", "WARNING": "AICC Sentinel: warning"}
OSASCRIPT = "/usr/bin/osascript"


def macos_notify(kind: str, runner=subprocess.run, platform: str = sys.platform) -> bool:
    """Opt-in local fallback (macOS only). The text is FIXED: no target name, URL, reason or secret ever reaches osascript. Details are in the log."""
    title = LOCAL_TITLES.get(kind)
    if platform != "darwin" or title is None:
        return False
    script = f'display notification "See the sentinel log for details." with title "{title}"'
    try:
        runner([OSASCRIPT, "-e", script], timeout=10, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def control_check(host: str, timeout: float = 5.0) -> bool:
    """A bare TCP + TLS handshake (no HTTP request). True = this machine has a working network/DNS path to the internet."""
    try:
        with socket.create_connection((host, 443), timeout=timeout) as raw:
            with ssl.create_default_context().wrap_socket(raw, server_hostname=host):
                return True
    except OSError:
        return False


def write_private(path: str, data: str) -> None:
    """Atomic write, directory 0700 if created here, file 0600."""
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, mode=0o700, exist_ok=True)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(data)
    os.replace(tmp, path)


def default_heartbeat_path() -> str:
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/aicc-sentinel/last-run.json")
    return os.path.expanduser("~/.local/state/aicc-sentinel/last-run.json")


def status_report(path: str, now: float | None = None, stale_s: int = 900) -> tuple:
    """Human text + exit code for --status: 0 alive and nothing down, 1 stale or a target down, 2 no heartbeat. Contains no secrets by construction."""
    now = time.time() if now is None else now
    try:
        with open(path) as fh:
            hb = json.load(fh)
        ts = float(hb["ts"])
    except (OSError, ValueError, KeyError, TypeError):
        return f"no heartbeat at {path}: the sentinel has not run here (or this is the wrong path)", 2
    age = max(now - ts, 0)
    stale = age > max(stale_s, 3 * int(hb.get("interval_s") or 0))
    lines = [f"observer {hb.get('observer', '?')} v{hb.get('version', '?')}: last run {age / 60:.1f} min ago ({hb.get('time', '?')})"
             + ("  ** STALE: the Mac was asleep/offline or the agent is not loaded **" if stale else "  alive"),
             f"telegram: {hb.get('telegram', '?')}; macos-notify: {'on' if hb.get('macos_notify') else 'off'}"
             + ("; LAST ROUND DISCARDED: observer looked offline" if hb.get("observer_offline") else "")]
    down = 0
    for name, v in sorted((hb.get("targets") or {}).items()):
        down += v.get("status") == "down"
        lat = f" {v['latency_ms']:.0f}ms" if isinstance(v.get("latency_ms"), (int, float)) else ""
        lines.append(f"  {name}: {v.get('status', '?').upper()} {'ok' if v.get('ok') else 'FAIL'}{lat}"
                     + (f" [{v['stage']}] {v.get('reason', '')}" if v.get("stage") else ""))
    return "\n".join(lines), (1 if stale or down else 0)


# --------------------------------------------------------------------------------------------------- runner
class Sentinel:
    def __init__(self, cfg: dict, notifier: Notifier, state_path: str | None = None, log=None, heartbeat_path: str | None = None,
                 control=None, local_notify=None, quiet_ok: bool = False):
        self.cfg, self.n = cfg, notifier
        self.state_path = os.path.expanduser(state_path or cfg["sentinel"]["state_file"])
        self.heartbeat_path = os.path.expanduser(heartbeat_path or "")
        self.log = log or (lambda m: print(m, flush=True))
        host = cfg["sentinel"].get("control_host", "")
        self.control = control if control is not None else ((lambda: control_check(host)) if host else None)
        self.local_notify, self.quiet_ok = local_notify, quiet_ok
        self.observer_offline = False
        self.state = self._load()

    def _load(self) -> dict:
        try:
            with open(self.state_path) as fh:
                d = json.load(fh)
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self):
        write_private(self.state_path, json.dumps(self.state))

    def interval_of(self, t: dict) -> int:
        return t["interval_s"] or self.cfg["sentinel"]["interval_s"]

    def min_interval(self) -> int:
        return min([self.interval_of(t) for t in self.cfg["targets"] if t["enabled"]] or [self.cfg["sentinel"]["interval_s"]])

    def _due(self, t: dict, ts: dict, now: float) -> bool:
        last = (ts.get("last") or {}).get("ts")
        if last is None or now < last:
            return True
        iv = self.interval_of(t)
        return now - last >= iv - min(20.0, iv * 0.15)     # small slop so a 120 s timer does not skip a 120 s target by a second

    def run_once(self, now: float | None = None, due_only: bool = False) -> list:
        """One round. due_only: probe only targets whose own interval has elapsed since their last stored check (launchd/CI use)."""
        now = time.time() if now is None else now
        s = self.cfg["sentinel"]
        todo = []
        for t in self.cfg["targets"]:
            if not t["enabled"]:
                continue
            ts = self.state.setdefault(t["name"], new_state())
            for k, v in new_state().items():
                ts.setdefault(k, v)
            if due_only and not self._due(t, ts, now):
                continue
            todo.append((t, ts, probe(t, now)))
        # Observer-offline guard: dns/connect failures are only believed if a bare handshake to the control host works from here.
        netfail = any(not r["ok"] and r["stage"] in ("dns", "connect") for _, _, r in todo)
        self.observer_offline = bool(netfail and self.control is not None and not self.control())
        events = []
        for t, ts, res in todo:
            if self.observer_offline and not res["ok"] and res["stage"] in ("dns", "connect"):
                self.log(f"{time.strftime('%H:%M:%S', time.gmtime(now))} {t['name']}: inconclusive [{res['stage']}] {res['reason']}; "
                         f"control check failed so this machine looks offline: result discarded")
                continue
            prev = (ts.get("last") or {}).get("ts")
            if ts["status"] == "up" and prev is not None and now - prev > s["stale_after_s"]:
                ts["window"], ts["ok_streak"] = [], 0       # old evidence (Mac slept, CI run skipped) must not combine with one new failure
            notes = step(ts, res, s, now, t["name"])
            tn = tls_note(ts, res, t, s, now)
            if tn:
                notes.append(tn)
            if not res["ok"] or not self.quiet_ok:
                extra = f" dns={','.join(res['dns'])}" if res["stage"] == "dns" and res["dns"] else ""
                self.log(f"{time.strftime('%H:%M:%S', time.gmtime(now))} {t['name']}: {'ok' if res['ok'] else 'FAIL'}"
                         f"{'[' + res['stage'] + ']' if res['stage'] else ''} {res['status'] or '-'} "
                         f"{('%.0fms' % res['latency_ms']) if res['latency_ms'] else ''} {res['reason']}{extra} [{ts['status']}]")
            for kind, text in notes:
                events.append((t["name"], kind, text))
                self.log(f"EVENT {kind} {t['name']}: {text}")        # always in the log, whatever the notification channels do
                sent = self.n.send(kind, t["name"], text)
                if self.local_notify and not sent:
                    self.local_notify(kind)                         # fallback only: Telegram absent or failed
                if kind == "DOWN" and self.n.enabled and not sent:
                    ts["down_notified"], ts["last_down_notice"] = False, -1e18   # delivery failed: retry on the next round, do not stay silent
        try:
            self._save()
        except OSError as e:
            self.log(f"state not saved: {e}")
        self.write_heartbeat(now)
        return events

    def any_down(self) -> bool:
        return any(isinstance(v, dict) and v.get("status") == "down" for v in self.state.values())

    def write_heartbeat(self, now: float) -> None:
        if not self.heartbeat_path:
            return
        hb = {"schema": 1, "ts": now, "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), "observer": self.cfg["sentinel"]["host_label"],
              "version": VERSION, "telegram": "enabled" if self.n.enabled else "disabled", "macos_notify": bool(self.local_notify),
              "observer_offline": self.observer_offline, "interval_s": self.min_interval(), "targets": {}}
        for t in self.cfg["targets"]:
            ts = self.state.get(t["name"]) or {}
            last = ts.get("last") or {}
            if t["enabled"] and last:
                hb["targets"][t["name"]] = {"status": ts.get("status"), "ok": last.get("ok"), "stage": last.get("stage", ""), "reason": last.get("reason", ""),
                                            "last_ts": last.get("ts"), "latency_ms": last.get("latency_ms"), "tls_days": last.get("tls_days")}
        try:
            write_private(self.heartbeat_path, json.dumps(hb, indent=1))
        except OSError as e:
            self.log(f"heartbeat not written: {e}")

    def plan(self) -> str:
        sc = self.cfg["sentinel"]
        lines = [f"default interval {sc['interval_s']} s; DOWN after {sc['fail_n']} of {sc['window_m']} failures; RECOVERED after {sc['recover_k']} successes; "
                 f"stale window reset after {sc['stale_after_s']} s; state file {self.state_path}"]
        for t in self.cfg["targets"]:
            lines.append(f"{'on ' if t['enabled'] else 'OFF'} {t['method']} {t['url']} every {self.interval_of(t)} s expect {t['expect_status']}"
                         + (f" ip in {as_list(t['expect_ip'])}" if t["expect_ip"] else "")
                         + "".join(f" body~{b!r}" for b in as_list(t["expect_body"]))
                         + (f" header~{t['expect_header']!r}" if t["expect_header"] else "")
                         + f" latency<={t['latency_ms']}ms tls_warn<{t['tls_warn_days']}d")
        return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="AICC Sentinel (external availability checker)")
    ap.add_argument("--config")
    ap.add_argument("--once", action="store_true", help="run one round and exit (cron/launchd/CI friendly)")
    ap.add_argument("--due-only", action="store_true", help="with --once: probe only targets whose own interval_s has elapsed since their last stored check")
    ap.add_argument("--dry-run", action="store_true", help="print would-be Telegram messages; probes still run, Telegram is never contacted")
    ap.add_argument("--plan", action="store_true", help="print what would be probed and exit; opens no socket at all")
    ap.add_argument("--state", "--state-file", dest="state", metavar="PATH", help="state file (N-of-M window, cooldown); keep it between one-shot runs")
    ap.add_argument("--heartbeat", metavar="PATH", help="write a small last-run.json (timestamp + target states, no secrets) after every round")
    ap.add_argument("--status", action="store_true", help="print the heartbeat file (default location, or --heartbeat) and exit; no network")
    ap.add_argument("--macos-notify", action="store_true", help="macOS only: show a fixed-text notification on DOWN/RECOVERED when Telegram is absent or failed")
    ap.add_argument("--quiet-ok", action="store_true", help="do not log successful checks (failures and events are always logged)")
    ap.add_argument("--fail-on-down", action="store_true", help="with --once: exit 1 when any target is in the DOWN state afterwards (CI: GitHub also emails failed runs)")
    ap.add_argument("--test-notify", action="store_true", help="send one [TEST] Telegram message (or print it with --dry-run) and exit")
    ap.add_argument("--host-label", help="override [sentinel].host_label (shown as 'observer:' in messages), e.g. github-actions")
    ap.add_argument("--fail-n", type=int)
    ap.add_argument("--window-m", type=int)
    a = ap.parse_args(argv)
    if a.status:
        text, rc = status_report(os.path.expanduser(a.heartbeat or default_heartbeat_path()))
        print(text)
        return rc
    if not a.config:
        ap.error("--config is required")
    try:
        cfg = load_config(a.config)
        if a.fail_n is not None:
            cfg["sentinel"]["fail_n"] = a.fail_n
        if a.window_m is not None:
            cfg["sentinel"]["window_m"] = a.window_m
        if a.host_label:
            if not NAME_RE.match(a.host_label):
                raise ConfigError("host label must be 1-60 chars of [A-Za-z0-9._- ]")
            cfg["sentinel"]["host_label"] = a.host_label
        sc = cfg["sentinel"]
        if not (1 <= sc["fail_n"] <= sc["window_m"] <= 50):
            raise ConfigError("need 1 <= fail_n <= window_m <= 50")
    except (ConfigError, OSError, tomllib.TOMLDecodeError) as e:
        print(f"sentinel: config error: {e}", file=sys.stderr)
        return 2
    n = Notifier(cfg["sentinel"]["secrets_file"], cfg["sentinel"]["host_label"], dry_run=a.dry_run or a.plan)
    if a.test_notify:
        if not (n.enabled or n.dry_run):
            print("sentinel: Telegram is not configured (no secrets); nothing sent", file=sys.stderr)
            return 1
        ok = n.send("TEST", "sentinel", "Test message: Telegram delivery from this observer works.")
        print("test message sent" if ok else "test message FAILED to send", file=sys.stderr)
        return 0 if ok else 1
    local = macos_notify if (a.macos_notify and sys.platform == "darwin") else None
    s = Sentinel(cfg, n, a.state, heartbeat_path=a.heartbeat, local_notify=local, quiet_ok=a.quiet_ok)
    if a.plan:
        print(s.plan())
        return 0
    if a.once:
        s.run_once(due_only=a.due_only)
        return 1 if (a.fail_on_down and s.any_down()) else 0
    while True:
        t0 = time.monotonic()
        s.run_once(due_only=True)
        time.sleep(max(s.min_interval() - (time.monotonic() - t0), 1))


if __name__ == "__main__":
    sys.exit(main())
