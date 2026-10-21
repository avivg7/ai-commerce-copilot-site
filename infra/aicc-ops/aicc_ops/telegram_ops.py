"""Operator-run Telegram commands: status / check (getMe) / discover-chat (getUpdates) / send-test.

These are MANUAL one-shot commands run by the owner on the host (never by the daemon; telegram.py stays outbound-sendMessage-only,
a test greps it for getUpdates). Rules shared by all of them:
  * the bot token is read at runtime from the same place the daemon reads it (load_secrets) and is only ever put in the URL path of an
    in-process urllib request. It is never printed, never logged, never in argv, never in an exception message we show.
  * output is limited to: ok/fail, HTTP status, exception TYPE, the bot's public @username, token LENGTH, and (discover-chat) chat id/type.
  * a secrets file that is group-writable or world-accessible is REFUSED with a clear message (same 0o027 rule as the daemon).
  * the base URL can only be redirected by tests: env AICC_OPS_TEST_BASE_URL is honoured ONLY when AICC_OPS_TEST_HARNESS=1, and
    only to http://127.0.0.1:<port> (the adapter's rule)."""
from __future__ import annotations

import grp
import json
import os
import pwd
import re
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request

from .telegram import API_BASE, LOOPBACK_BASE_RE, load_secrets, parse_env_file, render_test, sanitize

EXIT_OK, EXIT_FAIL, EXIT_UNUSABLE = 0, 1, 3
CHAT_KEYS = ("message", "edited_message", "channel_post", "edited_channel_post", "my_chat_member", "chat_member", "chat_join_request")


def resolve_base(environ=None, base_url: str | None = None) -> str:
    environ = os.environ if environ is None else environ
    if base_url is None and environ.get("AICC_OPS_TEST_HARNESS") == "1":
        base_url = environ.get("AICC_OPS_TEST_BASE_URL") or None
    if base_url is None:
        return API_BASE
    if not LOOPBACK_BASE_RE.match(base_url):
        raise ValueError("test base URL must be http://127.0.0.1:<port>")
    return base_url


def inspect_secrets(path: str, environ=None) -> dict:
    """Describe where credentials would come from WITHOUT returning them (only lengths / booleans)."""
    environ = os.environ if environ is None else environ
    info = {"source": "none", "path": path, "present": False, "owner": None, "mode": None, "mode_ok": None, "readable": None,
            "token_len": 0, "chat_id_present": False, "usable": False, "detail": ""}
    cred = environ.get("CREDENTIALS_DIRECTORY")
    if cred:
        t, c = load_secrets("/nonexistent-aicc-ops", {"CREDENTIALS_DIRECTORY": cred}, partial=True)
        if t:
            info.update(source="credential-dir", present=True, token_len=len(t), chat_id_present=bool(c), mode_ok=True, readable=True)
            info["usable"] = bool(c)
            info["detail"] = "systemd credential directory (mode check not applicable)" if c else "chat id missing"
            return info
    try:
        st = os.stat(path)
    except OSError as e:
        info["detail"] = f"secrets file not found ({type(e).__name__})"
        return info
    info["present"] = True
    info["source"] = "file"
    try:
        owner = pwd.getpwuid(st.st_uid).pw_name
    except KeyError:
        owner = str(st.st_uid)
    try:
        group = grp.getgrgid(st.st_gid).gr_name
    except KeyError:
        group = str(st.st_gid)
    info["owner"] = f"{owner}:{group}"
    info["mode"] = format(stat.S_IMODE(st.st_mode), "04o")
    info["mode_ok"] = not (st.st_mode & 0o027)
    if not info["mode_ok"]:
        info["detail"] = "REFUSED: file is group-writable or world-accessible (needs 0600 or 0640)"
        return info
    try:
        with open(path) as fh:
            env = parse_env_file(fh.read())
        info["readable"] = True
    except OSError as e:
        info["readable"] = False
        info["detail"] = f"cannot read the file ({type(e).__name__}); run as root or as the aicc-ops user"
        return info
    t, c = env.get("TELEGRAM_BOT_TOKEN"), env.get("TELEGRAM_CHAT_ID")
    info["token_len"] = len(t or "")
    info["chat_id_present"] = bool(c)
    info["usable"] = bool(t and c)
    if not t:
        info["detail"] = "TELEGRAM_BOT_TOKEN missing"
    elif not c:
        info["detail"] = "TELEGRAM_CHAT_ID missing (run telegram-discover-chat, then set-telegram --keep-token)"
    return info


def cmd_status(cfg: dict, out=None, environ=None) -> int:
    out = out or sys.stdout
    i = inspect_secrets(cfg["telegram"]["secrets_file"], environ)
    p = lambda k, v: print(f"{k:<16}{v}", file=out)  # noqa: E731
    p("enabled(config)", "yes" if cfg["telegram"].get("enabled", True) else "NO (telegram.enabled=false)")
    p("source", i["source"])
    p("file", i["path"] if i["source"] == "file" else "-")
    p("present", "yes" if i["present"] else "no")
    p("owner", i["owner"] or "-")
    p("mode", i["mode"] or "-")
    p("mode acceptable", {True: "yes", False: "NO", None: "-"}[i["mode_ok"]])
    p("token length", i["token_len"] if i["token_len"] else "missing")
    p("chat id", "present" if i["chat_id_present"] else "missing")
    p("usable", "yes" if i["usable"] and cfg["telegram"].get("enabled", True) else "NO")
    if i["detail"]:
        p("note", i["detail"])
    return EXIT_OK if i["usable"] and cfg["telegram"].get("enabled", True) else EXIT_UNUSABLE


def _credentials(cfg: dict, need_chat: bool, environ=None, err=None):
    """Return ((token, chat), None) or (None, exit_code) after printing why."""
    err = err or sys.stderr
    if not cfg["telegram"].get("enabled", True):
        print("aicc-ops: telegram is disabled by config (telegram.enabled=false)", file=err)
        return None, EXIT_UNUSABLE
    i = inspect_secrets(cfg["telegram"]["secrets_file"], environ)
    if i["source"] == "file" and i["mode_ok"] is False:
        print(f"aicc-ops: {i['detail']} (mode {i['mode']}, owner {i['owner']}); fix with: chmod 0640 and chown root:aicc-ops", file=err)
        return None, EXIT_UNUSABLE
    if i["source"] == "file" and i["readable"] is False:
        print(f"aicc-ops: {i['detail']}", file=err)
        return None, EXIT_UNUSABLE
    t, c = load_secrets(cfg["telegram"]["secrets_file"], os.environ if environ is None else environ, partial=True)
    if not t:
        print("aicc-ops: no Telegram bot token found (run: sudo aicc-ops-secrets set-telegram)", file=err)
        return None, EXIT_UNUSABLE
    if need_chat and not c:
        print("aicc-ops: no Telegram chat id found (run telegram-discover-chat, then: sudo aicc-ops-secrets set-telegram --keep-token)", file=err)
        return None, EXIT_UNUSABLE
    return (t, c), None


class Reply:
    __slots__ = ("status", "exc", "data")

    def __init__(self, status, exc, data):
        self.status, self.exc, self.data = status, exc, data

    @property
    def ok(self) -> bool:
        return self.status == 200 and isinstance(self.data, dict) and self.data.get("ok") is True

    def describe(self) -> str:
        """Failure description that cannot contain the token: an HTTP status or an exception TYPE name."""
        if self.status is not None:
            return f"HTTP {self.status}" + ("" if self.data is not None else " (non-JSON reply)")
        return f"exception {self.exc}"


def api_call(base: str, token: str, method: str, params: dict | None = None, timeout: float = 10.0) -> Reply:
    url = f"{base}/bot{token}/{method}"     # the token lives only in this local string / the request line
    data = urllib.parse.urlencode(params).encode() if params is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET",
                                 headers={"User-Agent": "aicc-ops/0.1", **({"Content-Type": "application/x-www-form-urlencoded"} if data is not None else {})})
    status, body = None, b""
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # nosec - api.telegram.org (or 127.0.0.1 in tests)
            status, body = r.status, r.read(262144)
    except urllib.error.HTTPError as e:
        status = e.code
        try:
            body = e.read(65536)
        except Exception:  # noqa: BLE001
            body = b""
        finally:
            e.close()
    except Exception as e:  # noqa: BLE001 - report the TYPE only; messages from urllib can embed the URL (= the token)
        return Reply(None, type(e).__name__, None)
    try:
        d = json.loads(body)
    except ValueError:
        d = None
    return Reply(status, None, d if isinstance(d, dict) else None)


def cmd_check(cfg: dict, out=None, err=None, environ=None, base_url=None) -> int:
    out, err = out or sys.stdout, err or sys.stderr
    creds, rc = _credentials(cfg, need_chat=False, environ=environ, err=err)
    if creds is None:
        return rc
    base = resolve_base(environ, base_url)
    if base != API_BASE:
        print("(test harness: base URL redirected to loopback)", file=err)
    r = api_call(base, creds[0], "getMe")
    if not r.ok:
        print(f"getMe: FAILED ({r.describe()})", file=out)
        return EXIT_FAIL
    uname = (r.data.get("result") or {}).get("username")
    uname = uname if isinstance(uname, str) and re.fullmatch(r"[A-Za-z0-9_]{1,64}", uname) else "(no username)"
    print(f"getMe: ok  bot @{uname}", file=out)
    return EXIT_OK


def _clean(s, n=64) -> str:
    return sanitize("".join(ch for ch in str(s) if ch >= " ")[:n])


def extract_chats(updates) -> list:
    seen, out = set(), []
    for u in updates if isinstance(updates, list) else []:
        if not isinstance(u, dict):
            continue
        for k in CHAT_KEYS:
            obj = u.get(k)
            chat = obj.get("chat") if isinstance(obj, dict) else None
            if isinstance(chat, dict) and isinstance(chat.get("id"), int) and not isinstance(chat.get("id"), bool) and chat["id"] not in seen:
                seen.add(chat["id"])
                out.append({"id": chat["id"], "type": _clean(chat.get("type", "?"), 16),
                            # private chats: id and type ONLY (no person's name or @handle); groups/channels: public title / @handle
                            "title": _clean(chat["title"]) if chat.get("type") != "private" and chat.get("title") else None,
                            "username": _clean(chat["username"]) if chat.get("type") != "private" and chat.get("username") else None})
    return out


def cmd_discover_chat(cfg: dict, out=None, err=None, environ=None, base_url=None) -> int:
    out, err = out or sys.stdout, err or sys.stderr
    creds, rc = _credentials(cfg, need_chat=False, environ=environ, err=err)
    if creds is None:
        return rc
    base = resolve_base(environ, base_url)
    if base != API_BASE:
        print("(test harness: base URL redirected to loopback)", file=err)
    # no `offset` => nothing is acknowledged; Telegram keeps the updates (up to 24 h) so the daemon/other tools are unaffected.
    r = api_call(base, creds[0], "getUpdates", {"limit": 20, "timeout": 2}, timeout=10.0)
    if not r.ok:
        extra = " - a webhook may be set on this bot (getUpdates is refused while one is)" if r.status == 409 else ""
        print(f"getUpdates: FAILED ({r.describe()}){extra}", file=out)
        return EXIT_FAIL
    chats = extract_chats(r.data.get("result"))
    if not chats:
        print("getUpdates: ok, but no chats found. Open Telegram, find your bot, press Start and send it any message (a group: add the bot and send a message there), then run this again.", file=out)
        return EXIT_OK
    print(f"getUpdates: ok, {len(chats)} chat(s) found:", file=out)
    for c in chats:
        line = f"  chat_id={c['id']}  type={c['type']}"
        if c["title"]:
            line += f"  title={c['title']!r}"
        if c["username"]:
            line += f"  username=@{c['username']}"
        print(line, file=out)
    print("Use the chat id of YOUR chat with: sudo aicc-ops-secrets set-telegram --keep-token", file=out)
    return EXIT_OK


def cmd_send_test(cfg: dict, host_label: str, send: bool, out=None, err=None, environ=None, base_url=None, now=None) -> int:
    out, err = out or sys.stdout, err or sys.stderr
    text = render_test(host_label, now)
    if not send:
        print("DRY-RUN (nothing sent; pass --send to send exactly this one message):\n---\n" + text + "\n---", file=out)
        return EXIT_OK
    creds, rc = _credentials(cfg, need_chat=True, environ=environ, err=err)
    if creds is None:
        return rc
    base = resolve_base(environ, base_url)
    if base != API_BASE:
        print("(test harness: base URL redirected to loopback)", file=err)
    r = api_call(base, creds[0], "sendMessage", {"chat_id": creds[1], "text": text, "disable_web_page_preview": "true"})
    if r.ok:
        print(f"sendMessage: ok (HTTP {r.status})", file=out)
        return EXIT_OK
    print(f"sendMessage: FAILED ({r.describe()})", file=out)
    return EXIT_FAIL
