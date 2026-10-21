"""Backup freshness, driven by the backup job's `status.json` (schema 1, written by infra/backup/aicc-backup.sh).

The backup directory is 0751 root: AICC Ops can open `status.json` BY NAME but cannot list the directory, so the status
file is the primary source. Directory scanning is only a fallback for hosts where the directory is listable."""
from __future__ import annotations

import fnmatch
import calendar
import json
import time
import os
import re

from . import Result

MAX_STATUS_BYTES = 65536
DEFAULT_OFFHOST_ACK = "/srv/aicc/backups/offhost-ack.json"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
MAX_FUTURE_S = 3600     # an ack dated further ahead than this is invalid (clock skew / bogus), not "fresh forever"
# backup.offhost_reason codes (0 = valid): see alerts.OFFHOST_REASONS
R_OK, R_JSON, R_SCHEMA, R_UNVERIFIED, R_FIELDS, R_UNREADABLE = 0, 1, 2, 3, 4, 5


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


def offhost_metrics(text: str, now: float) -> dict:
    """Parse the ack the owner's Mac writes after it pulled AND verified a backup set (schema 1). Never raises.
    Always returns present=1; verified=1 only for a well-formed, verified, schema-1 ack that is not dated in the future."""
    m = {"backup.offhost_present": 1.0, "backup.offhost_verified": 0.0, "backup.offhost_reason": float(R_JSON)}
    try:
        d = json.loads(text)
    except ValueError:
        return m
    if not isinstance(d, dict):
        return m
    m["backup.offhost_reason"] = float(R_SCHEMA)
    if d.get("schema") != 1 or isinstance(d.get("schema"), bool):
        return m
    m["backup.offhost_reason"] = float(R_FIELDS)
    at = _num(d.get("acked_at"))
    if at is None or at <= 0 or at > now + MAX_FUTURE_S:
        return m
    m["backup.offhost_age_s"] = max(now - at, 0.0)
    if d.get("verified") is not True:
        m["backup.offhost_reason"] = float(R_UNVERIFIED)
        return m
    if not isinstance(d.get("dump_sha256"), str) or not HEX64.match(d["dump_sha256"]):
        return m
    if d.get("files_sha256") not in (None, "") and not (isinstance(d["files_sha256"], str) and HEX64.match(d["files_sha256"])):
        return m
    m["backup.offhost_verified"] = 1.0
    m["backup.offhost_reason"] = float(R_OK)
    # age of the SET that was acknowledged (from its UTC timestamp): re-acknowledging an old set must not look fresh (security review F10)
    st = d.get("set_ts")
    if isinstance(st, str) and re.fullmatch(r"\d{8}T\d{6}Z", st):
        try:
            m["backup.offhost_set_age_s"] = max(now - calendar.timegm(time.strptime(st, "%Y%m%dT%H%M%SZ")), 0.0)
        except (ValueError, OverflowError):
            pass
    return m


def collect_offhost(cfg, now):
    """-> (metrics, errors). A missing file is normal on a new host (present=0, no error). Unreadable is a collector error."""
    path = cfg.get("offhost_ack_file", DEFAULT_OFFHOST_ACK)
    if not path:
        return {}, []
    try:
        with open(path, "r", errors="replace") as fh:
            return offhost_metrics(fh.read(MAX_STATUS_BYTES), now), []
    except FileNotFoundError:
        return {"backup.offhost_present": 0.0, "backup.offhost_verified": 0.0}, []
    except OSError as e:
        return ({"backup.offhost_present": 1.0, "backup.offhost_verified": 0.0, "backup.offhost_reason": float(R_UNREADABLE)},
                [f"off-host ack unreadable: {type(e).__name__}"])


def collect(full_cfg, cfg, state, now) -> Result:
    off_m, off_err = collect_offhost(cfg, now)
    r = _collect_dump(cfg, now)
    r.metrics.update(off_m)
    r.errors.extend(off_err)
    return r


def _collect_dump(cfg, now) -> Result:
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
