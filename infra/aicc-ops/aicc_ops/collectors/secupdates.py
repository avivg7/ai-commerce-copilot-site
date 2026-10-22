"""Security-update freshness, driven by the hourly job's `security-updates.json` (schema 1, written by infra/systemd/aicc-security-updates.sh).

We only read numbers: no package versions and no log text reach the metrics, so alert messages cannot leak package details. Why this exists: the daily Ubuntu
timer left a critical PHP fix uninstalled for up to ~24 h (USN-8948-1); the hourly job closes that window and this collector makes a stuck job or a lingering
pending update visible."""
from __future__ import annotations

import json
import os

from . import Result

MAX_BYTES = 65536


def collect(full_cfg, cfg, state, now) -> Result:
    path = cfg["status_file"]
    try:
        with open(path, "r", errors="replace") as fh:
            raw = fh.read(MAX_BYTES)
    except FileNotFoundError:
        return Result(metrics={"secupdates.status_present": 0.0})
    except OSError as e:
        return Result(metrics={}, errors=[f"cannot read {os.path.basename(path)}: {type(e).__name__}"])
    try:
        d = json.loads(raw)
    except ValueError:
        return Result(metrics={"secupdates.status_present": 1.0}, errors=["security-updates.json is not valid JSON"])
    if not isinstance(d, dict) or d.get("schema") != 1:
        return Result(metrics={"secupdates.status_present": 1.0}, errors=["security-updates.json has an unknown schema"])
    m = {"secupdates.status_present": 1.0}
    fin = d.get("finished_epoch")
    if isinstance(fin, (int, float)) and not isinstance(fin, bool):
        m["secupdates.last_run_age_s"] = max(now - float(fin), 0.0)
    if isinstance(d.get("ok"), bool):
        m["secupdates.last_ok"] = 1.0 if d["ok"] else 0.0
    pc = d.get("pending_count")
    if isinstance(pc, int) and not isinstance(pc, bool) and pc >= 0:
        m["secupdates.pending_count"] = float(pc)
        oldest = d.get("pending_oldest_epoch")
        if pc > 0 and isinstance(oldest, (int, float)) and not isinstance(oldest, bool):
            m["secupdates.pending_oldest_age_s"] = max(now - float(oldest), 0.0)
        else:
            m["secupdates.pending_oldest_age_s"] = 0.0
    st = d.get("stale_services")
    if isinstance(st, list):
        m["secupdates.stale_services"] = float(len([s for s in st if isinstance(s, str)]))
    return Result(metrics=m)
