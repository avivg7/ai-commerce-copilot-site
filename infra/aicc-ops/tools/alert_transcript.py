#!/usr/bin/env python3.12
"""Drive the REAL alert engine + REAL default rules + Telegram dry-run adapter through a scripted incident timeline with a
simulated clock, and print a transcript. FIXTURE scenario; nothing touches a network (dry-run adapter never opens a socket)."""
import io
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from aicc_ops.alerts import AlertEngine, Window, build_rules  # noqa: E402
from aicc_ops.config import load_config  # noqa: E402
from aicc_ops.store import Store  # noqa: E402
from aicc_ops.telegram import TelegramAdapter  # noqa: E402

T0 = 1_800_000_000


def main():
    cfg = load_config(None, {"general": {"host_label": "aicc-staging (FIXTURE scenario)"}})
    td = tempfile.mkdtemp(prefix="aicc-transcript-")
    st = Store(os.path.join(td, "t.sqlite3"), cfg["storage"], free_pct_fn=lambda _p: 80.0)
    out = io.StringIO()
    tg = TelegramAdapter(cfg["telegram"], cfg["general"]["host_label"], dry_run=True, out=out, log=lambda m: None, environ={})
    eng = AlertEngine(build_rules(cfg), st, cfg["alerts"]["flap_window_s"], cfg["alerts"]["flap_max_transitions"])
    win = Window(30)
    base = {"mem.used_pct": 55.0, "cpu.used_pct": 20.0, "mysql.up": 1.0, "svc.mysql.active": 1.0, "svc.mysql.failed": 0.0, "svc.mysql.present": 1.0,
            "svc.php8_3_fpm.active": 1.0, "svc.php8_3_fpm.failed": 0.0, "svc.php8_3_fpm.present": 1.0, "disk.root.used_pct": 30.0, "swap.in_pps": 0.0, "swap.out_pps": 0.0,
            "ops.write_blocked": 0.0}
    timeline = [  # (minutes, overrides, label)
        (6, {}, "normal operation"),
        (3, {"mysql.up": 0.0, "svc.mysql.active": 0.0, "svc.mysql.failed": 1.0}, "MySQL goes down"),
        (4, {}, "MySQL recovers"),
        (12, {"mem.used_pct": 92.0}, "memory climbs to 92% (WARNING after 10 min sustained)"),
        (8, {"mem.used_pct": 97.5}, "memory reaches 97.5% (escalates to CRITICAL after 5 min)"),
        (6, {"mem.used_pct": 60.0}, "memory falls back"),
        (2, {"mem.used_pct": 92.0}, "memory spikes again 2 min (shorter than the 10 min sustain: NO alert)"),
        (6, {}, "memory normal"),
    ]
    # flapping php-fpm: alternate down/up every minute for 10 minutes, then stable
    for i in range(10):
        timeline.append((1, {"svc.php8_3_fpm.active": 0.0 if i % 2 == 0 else 1.0}, f"php8.3-fpm {'down' if i % 2 == 0 else 'up'} (flap test)"))
    timeline.append((40, {}, "stable again (flapping window expires)"))
    t = T0
    lines = []
    for minutes, over, label in timeline:
        lines.append(f"--- {time.strftime('%H:%M', time.gmtime(t))} UTC  {label}")
        for _ in range(int(minutes * 2)):
            m = {**base, **over}
            win.push(t, m)
            for n in eng.evaluate(win, t):
                tg.submit(n)
                lines.append(f"  [{time.strftime('%H:%M:%S', time.gmtime(t))}] {n.kind:<9} {n.severity:<8} {n.rule}:{n.scope}  {n.text}")
            t += 30
    print("\n".join(lines))
    print("\n=== Telegram DRY-RUN output (exactly what would be sent; no socket was opened) ===")
    print(out.getvalue())
    print("=== alert history persisted in SQLite ===")
    for ts, rule, scope, sev, kind, msg in reversed(st.alert_history(100)):
        print(f"{time.strftime('%H:%M:%S', time.gmtime(ts))} {kind:<10} {sev:<8} {rule}:{scope}  {msg}")


if __name__ == "__main__":
    main()
