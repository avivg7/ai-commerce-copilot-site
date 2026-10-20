"""Backup freshness, driven by the backup job's `status.json` (schema 1, written by infra/backup/aicc-backup.sh).

The backup directory is 0751 root: AICC Ops can open `status.json` BY NAME but cannot list the directory, so the status
file is the primary source. Directory scanning is only a fallback for hosts where the directory is listable."""
from __future__ import annotations

import fnmatch
import json
import os

from . import Result

MAX_STATUS_BYTES = 65536


def parse_status_json(text: str):
    """Return the parsed object or None. Plain `status=ok` / `ok` forms are accepted for hand-made files."""
    t = text.strip()
    if not t:
        return None
    if t.startswith("{"):
        try:
            d = json.loads(t)
        except ValueError:
            return None
        return d if isinstance(d, dict) else None
    val = None
    for line in t.splitlines():
        k, _, v = line.partition("=")
        if k.strip().lower() == "status":
            val = v.strip().lower()
    if val is None and "=" not in t:
        val = t.splitlines()[0].strip().lower()
    return {"status": val} if val else None


def parse_status(text: str):
    """True / False / None for the top-level status."""
    d = parse_status_json(text)
    if not d:
        return None
    s = str(d.get("status", "")).lower()
    if s in ("ok", "success", "succeeded", "0"):
        return True
    if s in ("fail", "failed", "error", "1"):
        return False
    return None


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def metrics_from_status(d: dict, now: float) -> dict:
    m = {}
    ok = parse_status(json.dumps(d))
    if ok is not None:
        m["backup.status_ok"] = 1.0 if ok else 0.0
    fin = _num(d.get("finished_epoch"))
    if fin:
        m["backup.last_run_age_s"] = max(now - fin, 0.0)
        m["backup.status_age_s"] = m["backup.last_run_age_s"]
    ls = d.get("last_success") if isinstance(d.get("last_success"), dict) else None
    ok_epoch = _num(ls.get("finished_epoch")) if ls else (fin if ok else None)
    if ok_epoch:
        m["backup.newest_age_s"] = max(now - ok_epoch, 0.0)   # age of the last SUCCESSFUL backup
    dump = d.get("db_dump") if isinstance(d.get("db_dump"), dict) else {}
    if _num(dump.get("bytes")) is not None:
        m["backup.newest_size_bytes"] = _num(dump["bytes"])
    rc = str(dump.get("restore_check", "")).lower()
    if rc in ("ok", "failed"):
        m["backup.restore_check_ok"] = 1.0 if rc == "ok" else 0.0
    if _num(d.get("disk_free_pct")) is not None:
        m["backup.disk_free_pct"] = _num(d["disk_free_pct"])
    return m


def collect(full_cfg, cfg, state, now) -> Result:
    m = {}
    d = cfg["dir"]
    if not os.path.isdir(d):
        m["backup.dir_present"] = 0.0
        return Result(metrics=m)
    m["backup.dir_present"] = 1.0
    sf = cfg.get("status_file")
    status = None
    if sf:
        try:
            with open(sf, "r", errors="replace") as fh:
                status = parse_status_json(fh.read(MAX_STATUS_BYTES))
            m["backup.status_present"] = 1.0 if status is not None else 0.0
        except OSError:
            m["backup.status_present"] = 0.0
    if status:
        m.update(metrics_from_status(status, now))
        return Result(metrics=m)
    # fallback: newest dump file by mtime (needs a listable directory)
    newest, count = None, 0
    try:
        with os.scandir(d) as it:
            for e in it:
                if e.is_file(follow_symlinks=False) and any(fnmatch.fnmatch(e.name, p) for p in cfg["patterns"]):
                    st = e.stat(follow_symlinks=False)
                    count += 1
                    if newest is None or st.st_mtime > newest[0]:
                        newest = (st.st_mtime, st.st_size)
    except PermissionError:
        return Result(metrics=m)       # directory exists but cannot be listed (0751): not an error, status.json is the source
    except OSError:
        pass
    m["backup.count"] = float(count)
    if newest:
        m["backup.newest_age_s"] = max(now - newest[0], 0.0)
        m["backup.newest_size_bytes"] = float(newest[1])
    return Result(metrics=m)
