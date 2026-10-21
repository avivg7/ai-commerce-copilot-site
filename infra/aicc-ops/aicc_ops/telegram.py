"""Telegram adapter: OUTBOUND ONLY (sendMessage). No inbound commands, no webhook, no long polling.

Secrets (bot token, chat id) are read ONLY at runtime: from systemd credentials ($CREDENTIALS_DIRECTORY/secrets.env, via
LoadCredential= so the source file can stay 0600 root:root) or directly from /etc/aicc-ops/secrets.env (0640 root:aicc-ops).
They never come from the repo or the TOML config. Without secrets the adapter is disabled (logged once).
--dry-run prints exactly what would be sent and never opens a socket. Messages contain no PII by construction
(metric values, rule titles, host label, fixed enums) and are additionally scrubbed by sanitize()."""
from __future__ import annotations

import json
import os
import queue
import re
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

API_BASE = "https://api.telegram.org"
LOOPBACK_BASE_RE = re.compile(r"^http://127\.0\.0\.1:\d{1,5}$")   # the only non-default base URL any code path accepts (tests only)
MAX_LEN = 3500

# --- PII / secret patterns: used by sanitize() AND by the unit test that scans every template ------------------
PII_PATTERNS = {
    "email": re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"),
    "ipv4": re.compile(r"\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b"),
    "ipv6": re.compile(r"\b(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}\b"),
    "telegram_token": re.compile(r"\b\d{6,}:[A-Za-z0-9_\-]{20,}\b"),
    "bearer_or_key": re.compile(r"(?i)\b(?:bearer\s+[A-Za-z0-9._\-]{8,}|sk_(?:live|test)_[A-Za-z0-9]+|AICC-[A-Z0-9]{4}-[A-Z0-9]{4})"),
    "long_secret": re.compile(r"\b[A-Za-z0-9+/_\-]{32,}\b"),
    "cookie": re.compile(r"(?i)\b(?:set-cookie|cookie|wordpress_logged_in\w*|PHPSESSID)\b\s*[:=]"),
    "order_number": re.compile(r"(?i)\border\s*(?:no\.?|number|#)?\s*#?\d{3,}\b|(?<!\w)#\d{3,}\b"),
}


def scan_pii(text: str) -> list:
    return [name for name, rx in PII_PATTERNS.items() if rx.search(text)]


def sanitize(text: str) -> str:
    """Defence in depth: strip control and zero-width/format characters FIRST (so an invisible character cannot split a token or address past the patterns),
    redact anything that matches a PII/secret pattern, cap the length."""
    text = "".join(ch for ch in text if (ch == "\n" or ch >= " ") and unicodedata.category(ch) not in ("Cf", "Cc", "Cs"))
    for name, rx in PII_PATTERNS.items():
        text = rx.sub(f"[redacted:{name}]", text)
    return text[:MAX_LEN]


# --- templates (plain text, no parse_mode => nothing to inject) -------------------------------------------------
TEMPLATES = {
    "WARNING": "[WARNING] {host}\n{title}\n{scope}: {text}\nSince {since} UTC",
    "CRITICAL": "[CRITICAL] {host}\n{title}\n{scope}: {text}\nSince {since} UTC",
    "RECOVERED": "[RECOVERED] {host}\n{title}\n{scope}: {text}\nAt {at} UTC",
    "FLAPPING": "[WARNING] {host}\n{title} is flapping\n{scope}: {text}\nAt {at} UTC",
    "DIGEST": "[DAILY DIGEST] {host}\nCapacity verdict: {verdict}\n{lines}",
    "TEST": "[TEST] {host} - Telegram path check {at} UTC. No action needed.",
}


def render(note, host: str) -> str:
    """note: alerts.Notification. Chooses the template by kind/severity."""
    since = time.strftime("%Y-%m-%d %H:%M", time.gmtime(note.since)) if note.since else "n/a"
    at = time.strftime("%Y-%m-%d %H:%M", time.gmtime(note.ts)) if note.ts else "n/a"
    if note.kind == "RECOVERED":
        key = "RECOVERED"
    elif note.kind == "FLAPPING":
        key = "FLAPPING"
    else:
        key = "CRITICAL" if note.severity == "CRITICAL" else "WARNING"
    txt = TEMPLATES[key].format(host=host, title=note.title, scope=note.scope, text=note.text, since=since, at=at)
    if note.kind in ("REMINDER", "ESCALATED"):
        txt = txt.replace("]", f"] ({'still active' if note.kind == 'REMINDER' else 'escalated'})", 1)
    return sanitize(txt)


def render_test(host: str, now: float | None = None) -> str:
    """The one explicit message sent by `telegram-send-test --send`. Host label (with its environment marker) + UTC minute, nothing else."""
    at = time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() if now is None else now))
    return sanitize(TEMPLATES["TEST"].format(host=host, at=at))


def render_digest(host: str, verdict: str, lines: list) -> str:
    return sanitize(TEMPLATES["DIGEST"].format(host=host, verdict=verdict, lines="\n".join(lines[:15])))


# --- secrets ---------------------------------------------------------------------------------------------------
def parse_env_file(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def load_secrets(path: str, environ=None, partial: bool = False):
    """Return (token, chat_id) or (None, None). Checks systemd credentials first, then the env file.
    partial=True (used only by the manual `telegram-check` / `telegram-discover-chat` commands, which need no chat id yet) also
    returns (token, None) when the chat id is missing. The mode rule below is identical either way."""
    environ = os.environ if environ is None else environ
    cred = environ.get("CREDENTIALS_DIRECTORY")
    if cred:
        try:  # preferred: LoadCredential=secrets.env:/etc/aicc-ops/secrets.env (file may stay 0600 root:root)
            with open(os.path.join(cred, "secrets.env")) as fh:
                env = parse_env_file(fh.read())
            if env.get("TELEGRAM_BOT_TOKEN") and (env.get("TELEGRAM_CHAT_ID") or partial):
                return env["TELEGRAM_BOT_TOKEN"], env.get("TELEGRAM_CHAT_ID") or None
        except OSError:
            pass
        try:
            with open(os.path.join(cred, "telegram_bot_token")) as fh:
                t = fh.read().strip()
            try:
                with open(os.path.join(cred, "telegram_chat_id")) as fh:
                    c = fh.read().strip()
            except OSError:
                if not partial:
                    raise
                c = ""
            if t and (c or partial):
                return t, c or None
        except OSError:
            pass
    try:
        st = os.stat(path)
        if st.st_mode & 0o027:
            return None, None  # fail closed: refuse a world-accessible or group-writable secrets file (0600/0640 ok)
        with open(path) as fh:
            env = parse_env_file(fh.read())
        t, c = env.get("TELEGRAM_BOT_TOKEN"), env.get("TELEGRAM_CHAT_ID")
        if t and (c or partial):
            return t, c or None
    except OSError:
        pass
    return None, None


class TelegramAdapter:
    def __init__(self, cfg: dict, host_label: str, dry_run: bool = False, out=None, log=None,
                 test_base_url: str | None = None, environ=None, sleep=time.sleep, clock=time.time):
        self.cfg = cfg
        self.host = host_label
        self.dry_run = dry_run
        self.out = out or sys.stdout
        self.log = log or (lambda m: print(m, file=sys.stderr))
        self.sleep, self.clock = sleep, clock
        self.base = API_BASE
        if test_base_url is not None:  # only tests may redirect; never from the config file
            if not LOOPBACK_BASE_RE.match(test_base_url):
                raise ValueError("test base URL must be http://127.0.0.1:<port>")
            self.base = test_base_url
        self.token = self.chat_id = None
        self.enabled = False
        if cfg.get("enabled", True):
            self.token, self.chat_id = load_secrets(cfg["secrets_file"], environ)
            self.enabled = bool(self.token and self.chat_id)
            if not self.enabled and not dry_run:
                self.log("telegram: disabled (no secrets found); alerts are recorded locally only")
        else:
            self.log("telegram: disabled by config")
        self.q: queue.Queue = queue.Queue(maxsize=100)
        self.sent_times: list = []
        self.stats = {"sent": 0, "failed": 0, "dropped": 0, "rate_limited": 0, "dry_run": 0}
        self._suppressed = 0
        self._last_send = 0.0
        self._stop = threading.Event()
        self._idle = threading.Event()
        self._idle.set()
        self._thread = None

    # -- public -----------------------------------------------------------------------------------------------
    def submit_text(self, text: str) -> bool:
        """Queue a message; NEVER blocks the caller. Returns False if dropped/disabled."""
        text = sanitize(text)
        if self.dry_run:
            self.stats["dry_run"] += 1
            print(f"DRY-RUN telegram sendMessage (no socket opened):\n---\n{text}\n---", file=self.out, flush=True)
            return True
        if not self.enabled:
            return False
        try:
            self._idle.clear()
            self.q.put_nowait(text)
        except queue.Full:
            self.stats["dropped"] += 1
            if self.q.empty():
                self._idle.set()
            return False
        self._ensure_thread()
        return True

    def submit(self, note) -> bool:
        return self.submit_text(render(note, self.host))

    def flush(self, timeout: float = 10.0) -> bool:
        return self._idle.wait(timeout)

    def stop(self):
        self._stop.set()

    # -- worker -----------------------------------------------------------------------------------------------
    def _ensure_thread(self):
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run, name="telegram", daemon=True)
            self._thread.start()

    def _allowed_now(self) -> bool:
        now = self.clock()
        self.sent_times = [t for t in self.sent_times if now - t < 3600]
        return len(self.sent_times) < self.cfg["max_per_hour"]

    def _run(self):
        while not self._stop.is_set():
            try:
                text = self.q.get(timeout=0.2)
            except queue.Empty:
                self._idle.set()
                if self._stop.is_set():
                    return
                continue
            if not self._allowed_now():
                self.stats["rate_limited"] += 1
                self._suppressed += 1
                if self.q.empty():
                    self._idle.set()
                continue
            wait = self.cfg["min_interval_s"] - (self.clock() - self._last_send)
            if wait > 0:
                self.sleep(wait)
            if self._suppressed:
                text += f"\n({self._suppressed} earlier notification(s) were suppressed by the hourly rate limit)"
                self._suppressed = 0
            self._deliver(text)
            self._last_send = self.clock()
            self.sent_times.append(self._last_send)
            if self.q.empty():
                self._idle.set()

    def _deliver(self, text: str) -> bool:
        url = f"{self.base}/bot{self.token}/sendMessage"
        body = urllib.parse.urlencode({"chat_id": self.chat_id, "text": text, "disable_web_page_preview": "true"}).encode()
        delay = self.cfg["backoff_s"]
        for attempt in range(1, int(self.cfg["retries"]) + 1):
            try:
                req = urllib.request.Request(url, data=body, method="POST",
                                             headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "aicc-ops/0.1"})
                with urllib.request.urlopen(req, timeout=10) as r:  # nosec - api.telegram.org (or 127.0.0.1 in tests)
                    r.read(65536)
                self.stats["sent"] += 1
                return True
            except urllib.error.HTTPError as e:
                retry_after = None
                if e.code == 429:
                    try:
                        retry_after = float(json.loads(e.read(4096)).get("parameters", {}).get("retry_after", delay))
                    except Exception:  # noqa: BLE001
                        retry_after = delay
                elif 400 <= e.code < 500:
                    break  # permanent client error: do not hammer
                self.log(f"telegram: HTTP {e.code} (attempt {attempt})")
                if attempt < self.cfg["retries"]:
                    self.sleep(min(retry_after if retry_after is not None else delay, 60))
            except (urllib.error.URLError, OSError, TimeoutError) as e:
                self.log(f"telegram: send failed ({type(e).__name__}) attempt {attempt}")  # never log URL (it holds the token)
                if attempt < self.cfg["retries"]:
                    self.sleep(min(delay, 60))
            except Exception as e:  # noqa: BLE001 - e.g. http.client.InvalidURL embeds the request path (= the token) in its message: the TYPE only, never retry a malformed request
                self.log(f"telegram: send failed ({type(e).__name__}), not retrying")
                break
            delay *= 2
        self.stats["failed"] += 1
        return False
