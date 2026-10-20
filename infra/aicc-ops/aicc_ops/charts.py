"""Server-rendered SVG line charts: no JavaScript, no external requests. Colours come from CSS classes (CSP-safe)."""
from __future__ import annotations

import html
import math
import time

W, H = 720, 210
ML, MR, MT, MB = 72, 10, 10, 26


def nice_max(v: float) -> float:
    if v <= 0:
        return 1.0
    exp = 10 ** math.floor(math.log10(v))
    for m in (1, 1.2, 1.6, 2, 2.4, 3, 4, 6, 8, 10):  # all divisible into 4 tidy gridline steps
        if v <= m * exp:
            return m * exp
    return 10 * exp


def fmt_axis(v: float, unit: str) -> str:
    if unit == "pct":
        return f"{v:.0f}%"
    if unit == "bytes":
        for d, s in ((1 << 30, "G"), (1 << 20, "M"), (1 << 10, "K")):
            if abs(v) >= d:
                return f"{v / d:.1f}{s}"
        return f"{v:.0f}"
    if unit == "bps":
        for d, s in ((1 << 20, "MB/s"), (1 << 10, "KB/s")):
            if abs(v) >= d:
                return f"{v / d:.1f}{s}"
        return f"{v:.0f}B/s"
    if unit == "ms":
        return f"{v:.0f}ms" if v < 1000 else f"{v / 1000:.1f}s"
    if abs(v) >= 1000:
        return f"{v / 1000:.1f}k"
    return f"{v:.2f}".rstrip("0").rstrip(".") if v < 10 else f"{v:.0f}"


def fmt_x(ts: float, span: float) -> str:
    t = time.gmtime(ts)
    return time.strftime("%H:%M", t) if span <= 2 * 86400 else time.strftime("%m-%d", t)


def line_chart(title: str, series: list, start: float, end: float, unit: str = "num", step: int = 30,
               ymax: float | None = None, desc: str = "") -> str:
    """series: [{"label": str, "points": [(ts, avg, mn, mx, p95)], "cls": "s1"}]. Returns an <svg> string + summary table."""
    span = max(end - start, 1)
    vals = [p[3] if p[3] is not None else p[1] for s in series for p in s["points"] if p[1] is not None]
    top = ymax if ymax is not None else nice_max(max(vals) if vals else 1.0)
    pw, ph = W - ML - MR, H - MT - MB

    def X(ts):
        return ML + pw * (ts - start) / span

    def Y(v):
        return MT + ph * (1 - min(max(v, 0), top) / top)

    uid = abs(hash(title)) % 10**8
    out = [f'<svg class="chart" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t{uid} d{uid}" preserveAspectRatio="xMidYMid meet">',
           f'<title id="t{uid}">{html.escape(title)}</title>',
           f'<desc id="d{uid}">{html.escape(desc or title)}</desc>']
    for i in range(5):
        v = top * i / 4
        y = Y(v)
        out.append(f'<line class="grid" x1="{ML}" y1="{y:.1f}" x2="{W - MR}" y2="{y:.1f}"/>')
        out.append(f'<text class="axis" x="{ML - 6}" y="{y + 4:.1f}" text-anchor="end">{html.escape(fmt_axis(v, unit))}</text>')
    for i in range(5):
        ts = start + span * i / 4
        anchor = "start" if i == 0 else "end" if i == 4 else "middle"
        out.append(f'<text class="axis" x="{X(ts):.1f}" y="{H - 8}" text-anchor="{anchor}">{fmt_x(ts, span)}</text>')
    gap = max(step * 3.5, 90)
    for s in series:
        pts = [p for p in s["points"] if p[1] is not None]
        segs, cur = [], []
        for p in pts:
            if cur and p[0] - cur[-1][0] > gap:
                segs.append(cur)
                cur = []
            cur.append(p)
        if cur:
            segs.append(cur)
        cls = s.get("cls", "s1")
        for seg in segs:
            if len(seg) >= 2 and s.get("band", True) and any(p[2] is not None and p[3] is not None for p in seg):
                up = " ".join(f"{X(p[0]):.1f},{Y(p[3] if p[3] is not None else p[1]):.1f}" for p in seg)
                dn = " ".join(f"{X(p[0]):.1f},{Y(p[2] if p[2] is not None else p[1]):.1f}" for p in reversed(seg))
                out.append(f'<polygon class="band {cls}" points="{up} {dn}"/>')
            if len(seg) == 1:
                out.append(f'<circle class="dot {cls}" cx="{X(seg[0][0]):.1f}" cy="{Y(seg[0][1]):.1f}" r="2"/>')
            else:
                out.append(f'<polyline class="line {cls}" fill="none" points="' + " ".join(f"{X(p[0]):.1f},{Y(p[1]):.1f}" for p in seg) + '"/>')
    if not vals:
        out.append(f'<text class="axis" x="{W / 2}" y="{H / 2}" text-anchor="middle">no data in this range</text>')
    out.append("</svg>")
    legend = "".join(f'<span class="key {s.get("cls", "s1")}">{html.escape(s["label"])}</span>' for s in series if len(series) > 1 or True)
    rows = []
    for s in series:
        a = [p[1] for p in s["points"] if p[1] is not None]
        lo = [p[2] for p in s["points"] if p[2] is not None]
        hi = [p[3] for p in s["points"] if p[3] is not None]
        if a:
            rows.append(f"<tr><th scope='row'>{html.escape(s['label'])}</th><td>{fmt_axis(min(lo or a), unit)}</td><td>{fmt_axis(sum(a) / len(a), unit)}</td><td>{fmt_axis(max(hi or a), unit)}</td></tr>")
    table = ("<details class='sum'><summary>Values</summary><table><caption class='sr'>" + html.escape(title) +
             " summary</caption><thead><tr><th scope='col'>Series</th><th scope='col'>Min</th><th scope='col'>Avg</th><th scope='col'>Max</th></tr></thead><tbody>" +
             "".join(rows) + "</tbody></table></details>") if rows else ""
    return f'<figure class="fig"><figcaption>{html.escape(title)}</figcaption><div class="legend">{legend}</div>{"".join(out)}{table}</figure>'
