"""Command line: run | check-config | telegram-test | telegram-status | telegram-check | telegram-discover-chat | telegram-send-test | digest."""
from __future__ import annotations

import argparse
import os
import signal
import sys
import threading

from .config import load_config, redact, ConfigError
from .store import Store
from .telegram import TelegramAdapter, TEMPLATES, render, sanitize
from .alerts import Notification
from .app import Runtime
from .ui import make_server, UnsafeBind


def _cfg(args):
    over = {}
    if getattr(args, "fixture_proc", None):
        over.setdefault("general", {})["proc_root"] = args.fixture_proc
    if getattr(args, "data_dir", None):
        over.setdefault("general", {})["data_dir"] = args.data_dir
    if getattr(args, "port", None):
        over.setdefault("server", {})["port"] = args.port
    if getattr(args, "bind", None):
        over.setdefault("server", {})["bind"] = args.bind
    return load_config(args.config, over)


def cmd_run(args) -> int:
    cfg = _cfg(args)
    try:
        # fail closed BEFORE touching anything else
        from .ui import validate_bind
        validate_bind(cfg["server"]["bind"], args.unsafe_bind)
    except UnsafeBind as e:
        print(f"aicc-ops: {e}", file=sys.stderr)
        return 2
    store = Store(os.path.join(cfg["general"]["data_dir"], cfg["storage"]["db_file"]), cfg["storage"])
    tg = TelegramAdapter(cfg["telegram"], cfg["general"]["host_label"], dry_run=args.dry_run_telegram)
    rt = Runtime(cfg, store, tg)
    if args.once:
        r = rt.cycle()
        print(f"cycle ok: {r['metrics']} metrics, {len(r['notifications'])} notification(s)")
        return 0
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    srv = None
    if not args.no_ui:
        srv = make_server(rt, cfg["server"]["bind"], cfg["server"]["port"], args.unsafe_bind, cfg["server"]["max_threads"], cfg["server"]["request_timeout_s"])
        threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 1.0}, name="ui", daemon=True).start()
        print(f"aicc-ops: UI on http://{cfg['server']['bind']}:{cfg['server']['port']}/ (operator-only)", file=sys.stderr, flush=True)
    rt.run(stop)
    if srv:
        srv.shutdown()
    tg.stop()
    store.close()
    return 0


def cmd_check_config(args) -> int:
    cfg = _cfg(args)
    import json
    print(json.dumps(redact(cfg), indent=2, sort_keys=True))
    return 0


def cmd_telegram_test(args) -> int:
    cfg = _cfg(args)
    tg = TelegramAdapter(cfg["telegram"], cfg["general"]["host_label"], dry_run=True)
    import time
    now = time.time()
    for n in (Notification("FIRING", "WARNING", "ram_high", "High memory use", "host", "memory used 91% (warn >= 90, critical >= 96)", now, now),
              Notification("FIRING", "CRITICAL", "db_down", "MySQL unavailable", "mysql", "MySQL is unreachable on its socket", now, now),
              Notification("RECOVERED", "CRITICAL", "db_down", "MySQL unavailable", "mysql", "recovered after 7 min", now, now - 420),
              Notification("FLAPPING", "WARNING", "service_down", "Service not running", "php8_3_fpm", "flapping: 4 state changes in 30 min; further notices suppressed until stable", now, now)):
        tg.submit(n)
    if cfg["telegram"].get("digest_enabled"):
        print("(digest is enabled in config)")
    else:
        print("(daily digest is OFF by default; shown below only as a template preview)")
    from .telegram import render_digest
    tg.submit_text(render_digest(cfg["general"]["host_label"], "HEALTHY", ["RAM used: 41%", "Active alerts: 0"]))
    return 0


def cmd_telegram_status(args) -> int:
    from . import telegram_ops
    return telegram_ops.cmd_status(_cfg(args))


def cmd_telegram_check(args) -> int:
    from . import telegram_ops
    return telegram_ops.cmd_check(_cfg(args))


def cmd_telegram_discover_chat(args) -> int:
    from . import telegram_ops
    return telegram_ops.cmd_discover_chat(_cfg(args))


def cmd_telegram_send_test(args) -> int:
    from . import telegram_ops
    cfg = _cfg(args)
    return telegram_ops.cmd_send_test(cfg, cfg["general"]["host_label"], args.send)


def cmd_digest(args) -> int:
    cfg = _cfg(args)
    if not cfg["telegram"].get("digest_enabled") and not args.force:
        print("aicc-ops: daily digest is disabled (telegram.digest_enabled=false); nothing sent", file=sys.stderr)
        return 0
    store = Store(os.path.join(cfg["general"]["data_dir"], cfg["storage"]["db_file"]), cfg["storage"])
    tg = TelegramAdapter(cfg["telegram"], cfg["general"]["host_label"], dry_run=args.dry_run)
    rt = Runtime(cfg, store, tg)
    tg.submit_text(rt.digest_text())
    tg.flush(30)
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="aicc-ops", description="AICC Ops: tiny operator-only observability")
    ap.add_argument("--config", default=None, help="TOML config path")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="collect, alert and serve the loopback UI")
    r.add_argument("--fixture-proc", help="read /proc-format files from this directory (local development)")
    r.add_argument("--data-dir")
    r.add_argument("--bind")
    r.add_argument("--port", type=int)
    r.add_argument("--unsafe-bind", action="store_true", help="allow a non-loopback bind (NEVER used by the systemd unit)")
    r.add_argument("--dry-run-telegram", action="store_true", help="print would-be Telegram messages; never open a socket")
    r.add_argument("--once", action="store_true", help="run a single collection cycle and exit")
    r.add_argument("--no-ui", action="store_true")
    r.set_defaults(fn=cmd_run)
    c = sub.add_parser("check-config", help="validate and print the (redacted) effective config")
    c.set_defaults(fn=cmd_check_config)
    t = sub.add_parser("telegram-test", help="print sample alert messages (dry run, no network)")
    t.set_defaults(fn=cmd_telegram_test)
    ts = sub.add_parser("telegram-status", help="secrets presence/owner/mode, token LENGTH, chat id presence (prints no secret); exit 0 usable, 3 not")
    ts.set_defaults(fn=cmd_telegram_status)
    tc = sub.add_parser("telegram-check", help="Bot API getMe: prints the bot's @username and ok (sends no message)")
    tc.set_defaults(fn=cmd_telegram_check)
    td = sub.add_parser("telegram-discover-chat", help="Bot API getUpdates (limit 20): lists chat id/type; send the bot a message first")
    td.set_defaults(fn=cmd_telegram_discover_chat)
    tt = sub.add_parser("telegram-send-test", help="dry run by default; with --send sends exactly one [TEST] message")
    tt.add_argument("--send", action="store_true", help="really send the one test message")
    tt.set_defaults(fn=cmd_telegram_send_test)
    d = sub.add_parser("digest", help="send/print the daily digest (OFF unless enabled)")
    d.add_argument("--dry-run", action="store_true")
    d.add_argument("--force", action="store_true")
    d.set_defaults(fn=cmd_digest)
    args = ap.parse_args(argv)
    try:
        return args.fn(args)
    except ConfigError as e:
        print(f"aicc-ops: config error: {e}", file=sys.stderr)
        return 2
    except PermissionError as e:
        print(f"aicc-ops: permission denied ({type(e).__name__}); run as root or as the aicc-ops user (e.g. sudo)", file=sys.stderr)
        return 3
