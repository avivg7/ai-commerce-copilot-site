"""Small shared helpers: formatting, percentiles, loopback guard, safe names."""
from __future__ import annotations

import ipaddress
import math
import re
import time

GIB = 1024 ** 3
MIB = 1024 ** 2
_NAME_RE = re.compile(r"^[a-z0-9_.\-]{1,80}$")
LOOPBACK_NAMES = {"localhost", "127.0.0.1", "::1"}


def now_ts() -> int:
    return int(time.time())


_AUTHORITY_RE = re.compile(r"^(?P<h>\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9][A-Za-z0-9.-]*)(?::(?P<p>[0-9]{1,5}))?$")


def host_from_header(value) -> "str | None":
    """The host part of an HTTP Host header, or None when the value is not a plain `host[:port]` authority (security review I2: `localhost:9190@evil` used to be
    cut at the last colon and accepted as `localhost`). No userinfo (`@`), whitespace, slash, `?`, `#`, backslash or control character; a numeric port <= 65535."""
    if not isinstance(value, str) or not value or len(value) > 255:
        return None
    m = _AUTHORITY_RE.match(value)
    if not m or (m.group("p") is not None and int(m.group("p")) > 65535):
        return None
    return m.group("h").lower()


def is_loopback_host(host: str) -> bool:
    if host in LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def assert_loopback(host: str, what: str = "target") -> None:
    """SSRF guard: collectors only ever talk to loopback."""
    if not is_loopback_host(host):
        raise ValueError(f"{what} must be a loopback address, got {host!r}")


def safe_name(s: str) -> str:
    """Normalise a unit/mount/interface label into a metric-name segment."""
    s = re.sub(r"\.service$", "", s.strip().lower())
    s = re.sub(r"[^a-z0-9_]+", "_", s).strip("_")
    return s or "root"


def valid_metric_name(s: str) -> bool:
    return bool(_NAME_RE.match(s))


def percentile(values, q: float):
    """Linear-interpolated percentile (q in 0..100). Returns None for empty input."""
    vs = sorted(v for v in values if v is not None and not (isinstance(v, float) and math.isnan(v)))
    if not vs:
        return None
    if len(vs) == 1:
        return float(vs[0])
    k = (len(vs) - 1) * q / 100.0
    f = math.floor(k)
    c = min(f + 1, len(vs) - 1)
    return float(vs[f] + (vs[c] - vs[f]) * (k - f))


def fmt_bytes(n: float) -> str:
    n = float(n)
    for unit, div in (("GiB", GIB), ("MiB", MIB), ("KiB", 1024)):
        if abs(n) >= div:
            return f"{n / div:.1f} {unit}"
    return f"{n:.0f} B"


def fmt_gib(n: float) -> str:
    return f"{n / GIB:.1f} GiB"


def fmt_capacity(used: float, total: float) -> str:
    """`1.3 GiB / 2.0 GiB — 65%` (em dash is part of the product wording)."""
    if not total:
        return f"{fmt_gib(used)} / n/a"
    return f"{fmt_gib(used)} / {fmt_gib(total)} — {100.0 * used / total:.0f}%"


def fmt_duration(sec: float) -> str:
    sec = int(sec)
    d, r = divmod(sec, 86400)
    h, r = divmod(r, 3600)
    m, _ = divmod(r, 60)
    if d:
        return f"{d}d {h}h"
    if h:
        return f"{h}h {m}m"
    return f"{m}m"


def iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))
