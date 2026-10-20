"""Failed-unit status files written by infra/systemd/aicc-unit-status.sh (OnFailure= hook of the AICC units).

Directory /var/lib/aicc/status (0755 root), files unit-<name>.json (schema 1): {"unit","state","status","since_epoch","result",...}.
Failure files are sticky until the unit next succeeds. We only read them; metric names come from a strict allow-list regex."""
from __future__ import annotations

import json
import os
import re

from . import Result
from ..util import safe_name

NAME_RE = re.compile(r"^unit-([A-Za-z0-9][A-Za-z0-9._@:-]{0,127}\.(?:service|timer))\.json$")
MAX_FILES = 64


def collect(full_cfg, cfg, state, now) -> Result:
    d = cfg["dir"]
    m, errors = {}, []
    try:
        names = sorted(os.listdir(d))
    except FileNotFoundError:
        return Result(metrics={"unitfail.dir_present": 0.0})
    except OSError as e:
        return Result(metrics={}, errors=[f"cannot list {d}: {type(e).__name__}"])
    m["unitfail.dir_present"] = 1.0
    failed = 0
    for fn in names[:MAX_FILES]:
        mt = NAME_RE.match(fn)
        if not mt:
            continue
        try:
            with open(os.path.join(d, fn), "r", errors="replace") as fh:
                data = json.loads(fh.read(8192))
        except (OSError, ValueError):
            errors.append(f"unreadable status file for {mt.group(1)}")
            continue
        label = "unitfail." + safe_name(mt.group(1).replace(".", "_"))
        is_failed = str(data.get("status", data.get("state", ""))).lower() == "failed"
        m[f"{label}.failed"] = 1.0 if is_failed else 0.0
        failed += is_failed
        since = data.get("since_epoch")
        if isinstance(since, (int, float)) and is_failed:
            m[f"{label}.age_s"] = max(now - since, 0.0)
    m["unitfail.failed_count"] = float(failed)
    return Result(metrics=m, errors=errors)
