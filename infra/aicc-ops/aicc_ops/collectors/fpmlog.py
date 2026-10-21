"""PHP-FPM max_children pressure from the numbers written by infra/systemd/aicc-fpm-log-status.sh (a root-run oneshot every minute).

AICC Ops has no access to the PHP socket (owner decision) and the FPM log is root-only; the script reduces the log to counts and we read that small file. Schema 1:
{"schema":1,"ts":<epoch>,"events_5m":N,"events_15m":N,"log_present":true}. A stale file is reported as a collector problem, never as 'no pressure'."""
from __future__ import annotations

import json

from . import CollectorError, Result

MAX_BYTES = 4096
STALE_S = 300


def collect(full_cfg, cfg, state, now) -> Result:
    path = cfg["status_file"]
    try:
        with open(path, "r", errors="replace") as fh:
            d = json.loads(fh.read(MAX_BYTES))
    except FileNotFoundError:
        raise CollectorError("fpm log status file absent (is aicc-fpm-log-status.timer enabled?)")
    except (OSError, ValueError) as e:
        raise CollectorError(f"fpm log status unreadable ({type(e).__name__})")
    if not isinstance(d, dict) or d.get("schema") != 1:
        raise CollectorError("fpm log status has an unknown schema")
    ts = d.get("ts")
    e5, e15 = d.get("events_5m"), d.get("events_15m")
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 for v in (ts, e5, e15)):
        raise CollectorError("fpm log status has invalid fields")
    age = max(now - float(ts), 0.0)
    if age > STALE_S:
        raise CollectorError(f"fpm log status is {age:.0f} s old (the timer stopped?)")
    return Result(metrics={"fpm.log_events_5m": float(e5), "fpm.log_events_15m": float(e15), "fpm.log_age_s": age,
                           "fpm.log_present": 1.0 if d.get("log_present") else 0.0})
