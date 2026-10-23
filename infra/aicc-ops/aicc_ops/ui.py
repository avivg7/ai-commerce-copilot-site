"""Operator-only web UI + export endpoints. Loopback-bound, GET-only, no cookies, no JavaScript, no external requests."""
from __future__ import annotations

import html
import ipaddress
import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

from . import __version__
from .charts import line_chart
from .config import redact
from . import export as exp
from .util import fmt_capacity, fmt_bytes, fmt_duration, iso, GIB, is_loopback_host, host_from_header

CSP = ("default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; "
       "img-src 'none'; script-src 'none'; connect-src 'none'")
SEC_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
}
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}
UI_RANGES = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}

CSS = """
:root{--bg:#f6f7f9;--fg:#15181d;--mut:#566070;--card:#fff;--bd:#d5dae1;--ok:#17653a;--warn:#8a5a00;--crit:#a31d1d;--link:#0b4fa8;
--s1:#0b5cad;--s2:#b34700;--s3:#1a7f4b;--s4:#7a3db8;--s5:#a3194f;--band:.18}
@media (prefers-color-scheme:dark){:root{--bg:#101318;--fg:#e8ebef;--mut:#9aa5b4;--card:#181c23;--bd:#2c333d;--ok:#5fd18c;--warn:#f1b24a;--crit:#ff7b7b;--link:#7db4ff;
--s1:#6db1ff;--s2:#ffa061;--s3:#63d69a;--s4:#c79bff;--s5:#ff8fb8;--band:.25}}
*{box-sizing:border-box}html{font-size:16px}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--link)}a:focus-visible,summary:focus-visible{outline:3px solid var(--link);outline-offset:2px}
.skip{position:absolute;left:-999px}.skip:focus{left:8px;top:8px;background:var(--card);padding:8px;z-index:9}
header.top{border-bottom:1px solid var(--bd);background:var(--card);padding:10px 16px}
header.top h1{font-size:1.1rem;margin:0 0 6px}
nav ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px 14px}
nav a{display:inline-block;padding:6px 2px;min-height:32px}nav a[aria-current=page]{font-weight:700;text-decoration:none;border-bottom:3px solid var(--link)}
main{max-width:1180px;margin:0 auto;padding:16px}
.banner{background:#fff3cd;color:#4a3b00;border:1px solid #e3c766;padding:8px 12px;margin:0 0 12px;border-radius:6px;font-weight:600}
h2{font-size:1.15rem;margin:22px 0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:12px}
.card h3{margin:0 0 4px;font-size:.85rem;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.card .v{font-size:1.15rem;font-weight:650;overflow-wrap:anywhere}.card .s{color:var(--mut);font-size:.85rem}
.st-ok{color:var(--ok)}.st-warn{color:var(--warn)}.st-crit{color:var(--crit)}
.pill{display:inline-block;border:1px solid currentColor;border-radius:99px;padding:1px 10px;font-weight:700;font-size:.9rem}
table{border-collapse:collapse;width:100%;background:var(--card)}th,td{border:1px solid var(--bd);padding:6px 8px;text-align:left;font-size:.92rem;vertical-align:top}
th{background:rgba(127,127,127,.12)}.wrap{overflow-x:auto}.sr{position:absolute;left:-999px}
.fig{margin:0 0 18px;background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:10px}
.fig figcaption{font-weight:650}.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:.85rem;color:var(--mut);margin:2px 0 4px}
.key:before{content:"";display:inline-block;width:14px;height:3px;margin-right:6px;vertical-align:middle;background:currentColor}
svg.chart{width:100%;height:auto;display:block}.grid{} line.grid{stroke:var(--bd);stroke-width:1}
text.axis{fill:var(--mut);font-size:11px}
.line{stroke-width:1.8}.s1{stroke:var(--s1);color:var(--s1)}.s2{stroke:var(--s2);color:var(--s2)}.s3{stroke:var(--s3);color:var(--s3)}.s4{stroke:var(--s4);color:var(--s4)}.s5{stroke:var(--s5);color:var(--s5)}
.band{stroke:none;opacity:var(--band)}.band.s1{fill:var(--s1)}.band.s2{fill:var(--s2)}.band.s3{fill:var(--s3)}.band.s4{fill:var(--s4)}.band.s5{fill:var(--s5)}
.dot{fill:currentColor}.tabs{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.tabs a{border:1px solid var(--bd);border-radius:6px;padding:4px 10px;background:var(--card);text-decoration:none}
.tabs a[aria-current=true]{border-color:var(--link);font-weight:700}pre{background:var(--card);border:1px solid var(--bd);padding:10px;overflow-x:auto;font-size:.85rem}
footer{max-width:1180px;margin:0 auto;padding:12px 16px 32px;color:var(--mut);font-size:.85rem}
details.sum summary{cursor:pointer;color:var(--mut);font-size:.85rem}.note{color:var(--mut);font-size:.9rem}
@media (max-width:480px){main{padding:12px}h2{font-size:1.05rem}.card .v{font-size:1.05rem}}
"""

NAV = [("/", "Overview"), ("/history", "History"), ("/alerts", "Alerts"), ("/capacity", "Capacity"), ("/config", "Config"), ("/export", "Export")]

GROUPS = {
    "host": ("Host", [
        ("CPU used", [("cpu.used_pct", "CPU %", "s1"), ("cpu.iowait_pct", "iowait %", "s2"), ("cpu.steal_pct", "steal %", "s3")], "pct", 100),
        ("Load average", [("load.1", "1 min", "s1"), ("load.5", "5 min", "s2"), ("load.15", "15 min", "s3")], "num", None),
        ("Memory used", [("mem.used_pct", "RAM used %", "s1"), ("swap.used_pct", "swap used %", "s2")], "pct", 100),
        ("Swap activity (pages/s)", [("swap.in_pps", "swap-in", "s1"), ("swap.out_pps", "swap-out", "s2")], "num", None),
        ("Disk used", [("disk.root.used_pct", "/ used %", "s1"), ("disk.root.inodes_used_pct", "/ inodes %", "s2")], "pct", 100),
        ("Disk I/O", [("io.read_bps", "read", "s1"), ("io.write_bps", "write", "s2")], "bps", None),
        ("Network", [("net.rx_bps", "in", "s1"), ("net.tx_bps", "out", "s2")], "bps", None),
    ]),
    "caddy": ("Caddy edge", [
        ("Requests per second by status class", [("caddy.rate_2xx", "2xx", "s3"), ("caddy.rate_3xx", "3xx", "s1"), ("caddy.rate_4xx", "4xx", "s2"), ("caddy.rate_5xx", "5xx", "s5")], "num", None),
        ("Request latency", [("caddy.lat_p50_ms", "p50", "s3"), ("caddy.lat_p95_ms", "p95", "s1"), ("caddy.lat_p99_ms", "p99", "s2")], "ms", None),
        ("Dynamic-route latency p95", [("caddy.dyn_lat_p95_ms", "dynamic p95", "s4")], "ms", None),
        ("In flight", [("caddy.in_flight", "in flight", "s1")], "num", None),
        ("Response / request bytes per second", [("caddy.resp_bytes_ps", "response", "s1"), ("caddy.req_bytes_ps", "request", "s2")], "bps", None),
    ]),
    "phpfpm": ("PHP-FPM", [
        ("Processes", [("fpm.active", "active", "s2"), ("fpm.idle", "idle", "s3"), ("fpm.total", "total", "s1")], "num", None),
        ("Listen queue", [("fpm.listen_queue", "queue", "s2")], "num", None),
        ("Active / total ratio", [("fpm.active_ratio", "ratio", "s1")], "num", 1.0),
        ("max_children reached (per interval)", [("fpm.max_children_reached_delta", "reached", "s5")], "num", None),
    ]),
    "mysql": ("MySQL", [
        ("Connections", [("mysql.threads_connected", "connected", "s1"), ("mysql.threads_running", "running", "s2")], "num", None),
        ("Connection pressure", [("mysql.conn_pressure_pct", "% of max_connections", "s1")], "pct", 100),
        ("Queries per second", [("mysql.qps", "qps", "s1")], "num", None),
        ("Slow queries / aborted connects (per interval)", [("mysql.slow_queries_delta", "slow", "s2"), ("mysql.aborted_connects_delta", "aborted", "s5")], "num", None),
    ]),
    "cp": ("Control Plane counters", [
        ("Accounts and logins (per minute)", [("cp.registrations_per_min", "registrations", "s1"), ("cp.login_success_per_min", "login ok", "s3"), ("cp.login_failure_per_min", "login failed", "s5")], "num", None),
        ("Checkout (approximate) and orders (per minute)", [("cp.checkout_start_per_min", "checkout start (approx.)", "s1"), ("cp.order_completed_per_min", "order completed", "s3"), ("cp.refund_per_min", "refund", "s2")], "num", None),
        ("Orders per checkout start (approximate ratio)", [("cp.order_per_checkout_ratio", "ratio", "s3")], "num", None),
        ("Licensing (per minute)", [("cp.license_issued_per_min", "issued", "s3"), ("cp.license_lifecycle_failure_per_min", "lifecycle failure", "s5"), ("cp.store_connection_per_min", "store connection", "s1")], "num", None),
        ("Scheduled actions", [("cp.action_scheduler_pending", "pending", "s1"), ("cp.action_scheduler_failed", "failed (24h)", "s5")], "num", None),
        ("Entitlement delivery to the Backend (gauges)", [("cp.entitlement_outbox_pending", "retrying", "s1"), ("cp.entitlement_outbox_abandoned", "abandoned", "s5")], "num", None),
        ("Oldest undelivered entitlement event (s)", [("cp.entitlement_outbox_oldest_pending_age_s", "age", "s3")], "num", None),
    ]),
    "backend": ("API backend (optional)", [
        ("API requests per second by class", [("backend.rate_2xx", "2xx", "s3"), ("backend.rate_4xx", "4xx", "s2"), ("backend.rate_5xx", "5xx", "s5")], "num", None),
        ("API latency", [("backend.lat_p50_ms", "p50", "s3"), ("backend.lat_p95_ms", "p95", "s1"), ("backend.lat_p99_ms", "p99", "s2")], "ms", None),
        ("Recommendation reads", [("backend.reco_rate", "requests/s", "s1"), ("backend.reco_serious_fail_rate", "server_error/unavailable per s", "s5")], "num", None),
        ("Database pool pressure", [("backend.pool_pressure_pct", "% of pool+overflow", "s1")], "pct", 100),
    ]),
    "system": ("Monitoring itself", [
        ("AICC Ops memory (RSS)", [("ops.rss_bytes", "RSS", "s1")], "bytes", None),
        ("AICC Ops database size", [("ops.db_bytes", "db + wal", "s1")], "bytes", None),
        ("Collection cycle time (ms)", [("ops.cycle_ms", "cycle", "s1")], "ms", None),
        ("Backup age (s)", [("backup.newest_age_s", "newest dump age", "s1")], "num", None),
        ("Certificate days left", [("cert.days_left", "days", "s3")], "num", None),
    ]),
}


def esc(s) -> str:
    return html.escape(str(s), quote=True)


def classify(v, warn, crit, higher=True):
    if v is None:
        return ""
    if (v >= crit) if higher else (v <= crit):
        return "st-crit"
    if (v >= warn) if higher else (v <= warn):
        return "st-warn"
    return "st-ok"


def page(title: str, body: str, active: str, cfg: dict, now: float, refresh: bool = False) -> bytes:
    nav = "".join(f'<li><a href="{h}"{" aria-current=\"page\"" if h == active else ""}>{n}</a></li>' for h, n in NAV)
    banner = f'<p class="banner" role="note">{esc(cfg["general"]["banner"])}</p>' if cfg["general"].get("banner") else ""
    meta_refresh = '<meta http-equiv="refresh" content="60">' if refresh else ""
    doc = (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
           f'<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">{meta_refresh}'
           f'<title>{esc(title)} | AICC Ops</title><link rel="stylesheet" href="/assets/ops.css"></head><body>'
           f'<a class="skip" href="#main">Skip to content</a><header class="top"><h1>AICC Ops <span class="note">{esc(cfg["general"]["host_label"])}</span></h1>'
           f'<nav aria-label="Primary"><ul>{nav}</ul></nav></header><main id="main">{banner}{body}</main>'
           f'<footer>Operator-only view on loopback. Generated {iso(now)}. AICC Ops {__version__}. No data leaves this host. '
           f'Alert and capacity thresholds are provisional until tuned from staging measurements.</footer></body></html>')
    return doc.encode()


class Pages:
    """Renders pages from a runtime object (cfg, store, latest(), engine, capacity())."""

    def __init__(self, rt):
        self.rt = rt

    # -- helpers
    def L(self, name):
        v = self.rt.latest().get(name)
        return None if v is None else v[0]

    def card(self, label, value, sub="", cls=""):
        return f'<div class="card"><h3>{esc(label)}</h3><div class="v {cls}">{value}</div><div class="s">{sub}</div></div>'

    # -- overview
    def overview(self, now):
        L, rt = self.L, self.rt
        cards = []
        mt, mu, ma = L("mem.total_bytes"), L("mem.used_bytes"), L("mem.available_bytes")
        if mt:
            pct = 100 * mu / mt
            cards.append(self.card("RAM", esc("RAM " + fmt_capacity(mu, mt)), f"available {fmt_bytes(ma)} (from MemAvailable)", classify(pct, 80, 92)))
        st = L("swap.total_bytes")
        if st is not None:
            su = L("swap.used_bytes") or 0
            sub = f"in {L('swap.in_pps') or 0:.0f} / out {L('swap.out_pps') or 0:.0f} pages/s"
            cards.append(self.card("Swap", esc("Swap " + fmt_capacity(su, st)) if st else "none", sub, classify(L("swap.in_pps"), 1, 100)))
        dt = L("disk.root.total_bytes")
        if dt:
            du = L("disk.root.used_bytes")
            cards.append(self.card("Disk /", esc("Disk " + fmt_capacity(du, dt)), f"inodes {L('disk.root.inodes_used_pct') or 0:.0f}% used; I/O read {fmt_bytes(L('io.read_bps') or 0)}/s write {fmt_bytes(L('io.write_bps') or 0)}/s", classify(100 * du / dt, 80, 92)))
        vc = L("cpu.vcpus")
        if L("cpu.used_pct") is not None:
            cards.append(self.card(f"CPU ({vc:.0f} vCPU)" if vc else "CPU", f"CPU {L('cpu.used_pct'):.0f}%", f"iowait {L('cpu.iowait_pct') or 0:.1f}%, steal {L('cpu.steal_pct') or 0:.1f}%", classify(L("cpu.used_pct"), 75, 92)))
        if L("load.1") is not None:
            cards.append(self.card("Load average", f"{L('load.1'):.2f} / {L('load.5'):.2f} / {L('load.15'):.2f}", f"1/5/15 min; {L('load.per_vcpu') or 0:.2f} per vCPU", classify(L("load.per_vcpu"), 1.5, 3)))
        if L("uptime.seconds") is not None:
            cards.append(self.card("Uptime", esc(fmt_duration(L("uptime.seconds"))), "host"))
        if L("net.rx_bps") is not None:
            cards.append(self.card("Network", f"in {esc(fmt_bytes(L('net.rx_bps')))}/s", f"out {esc(fmt_bytes(L('net.tx_bps') or 0))}/s (public interface)"))
        if L("backup.newest_age_s") is not None:
            h = L("backup.newest_age_s") / 3600
            cards.append(self.card("Newest backup", f"{h:.1f} h old", f"{fmt_bytes(L('backup.newest_size_bytes') or 0)}; job status {'ok' if L('backup.status_ok') == 1 else 'FAILED' if L('backup.status_ok') == 0 else 'unknown'}", classify(h, 36, 72)))
        if L("cert.days_left") is not None:
            cards.append(self.card("Certificate", f"{L('cert.days_left'):.0f} days left", "served on loopback", classify(L("cert.days_left"), 14, 5, higher=False)))
        cards.append(self.card("Collectors", f"{int(sum(1 for k, v in rt.latest().items() if k.startswith('collector.') and k.endswith('.ok') and v[0] == 1))} ok / "
                               f"{int(sum(1 for k, v in rt.latest().items() if k.startswith('collector.') and k.endswith('.ok') and v[0] == 0))} failing", "see table below"))
        out = ['<h2>Capacity verdict</h2>', self.capacity_summary(), '<h2>Active alerts</h2>', self.active_alerts(),
               '<h2>Resources</h2><div class="grid">' + "".join(cards) + "</div>"]
        out.append(self.services_table())
        out.append(self.caddy_block())
        out.append(self.app_block())
        out.append(self.collectors_table())
        return "".join(out)

    def capacity_summary(self):
        cap = self.rt.capacity()
        v = cap["verdict"]
        cls = {"HEALTHY": "st-ok", "WATCH": "st-warn"}.get(v, "st-crit")
        rs = "".join(f"<li>{esc(r['text'])}</li>" for r in cap["reasons"]) or "<li>No threshold reached in the 24 h or 7 d windows.</li>"
        return (f'<div class="card"><div class="v"><span class="pill {cls}">{esc(v)}</span></div><ul>{rs}</ul>'
                + "".join(f'<div class="s">{esc(n)}</div>' for n in cap.get("notes", []))
                + f'<div class="s">{esc(cap["disclaimer"])} <a href="/capacity">Details</a></div></div>')

    def active_alerts(self):
        act = self.rt.engine.active() if self.rt.engine else []
        if not act:
            return '<p class="st-ok">No active alerts.</p>'
        rows = "".join(f'<tr><td class="{"st-crit" if a["severity"] == "CRITICAL" else "st-warn"}"><b>{esc(a["severity"])}</b></td><td>{esc(a["title"])}</td><td>{esc(a["scope"])}</td><td>{esc(a["text"])}</td><td>{esc(iso(a["since"]) if a["since"] else "")}</td><td>{"flapping" if a["flapping"] else ""}</td></tr>' for a in act)
        return f'<div class="wrap"><table><caption class="sr">Active alerts</caption><thead><tr><th scope="col">Severity</th><th scope="col">Alert</th><th scope="col">Scope</th><th scope="col">Detail</th><th scope="col">Since (UTC)</th><th scope="col">Note</th></tr></thead><tbody>{rows}</tbody></table></div>'

    def services_table(self):
        L = self.L
        names = sorted(k for k in self.rt.latest() if k.startswith("svc.") and k.endswith(".active"))
        if not names:
            return ""
        rows = ""
        for n in names:
            u = n[4:-7]
            a = L(n)
            rows += (f'<tr><th scope="row">{esc(u)}</th><td class="{"st-ok" if a == 1 else "st-crit"}">{"active" if a == 1 else "NOT ACTIVE"}</td>'
                     f'<td>{esc(f"{L(f"svc.{u}.restarts"):.0f}") if L(f"svc.{u}.restarts") is not None else "n/a"}</td>'
                     f'<td>{esc(fmt_duration(L(f"svc.{u}.uptime_s"))) if L(f"svc.{u}.uptime_s") is not None else "n/a"}</td></tr>')
        return f'<h2>Services</h2><div class="wrap"><table><caption class="sr">systemd services</caption><thead><tr><th scope="col">Unit</th><th scope="col">State</th><th scope="col">Restarts (NRestarts)</th><th scope="col">Up for</th></tr></thead><tbody>{rows}</tbody></table></div>'

    def caddy_block(self):
        L = self.L
        if L("caddy.up") is None:
            return ""
        c = []
        c.append(self.card("Caddy admin metrics", "reachable" if L("caddy.up") == 1 else "UNREACHABLE", f"in flight {L('caddy.in_flight') or 0:.0f}", "st-ok" if L("caddy.up") == 1 else "st-crit"))
        if L("caddy.req_rate") is not None:
            c.append(self.card("Requests / s", f"{L('caddy.req_rate'):.2f}", f"2xx {L('caddy.rate_2xx') or 0:.2f} · 3xx {L('caddy.rate_3xx') or 0:.2f} · 4xx {L('caddy.rate_4xx') or 0:.2f} · 5xx {L('caddy.rate_5xx') or 0:.2f}", classify(L("caddy.rate_5xx"), 0.01, 0.5)))
        if L("caddy.lat_p95_ms") is not None:
            c.append(self.card("Latency p50 / p95 / p99", f"{L('caddy.lat_p50_ms') or 0:.0f} / {L('caddy.lat_p95_ms'):.0f} / {L('caddy.lat_p99_ms') or 0:.0f} ms", "from histogram bucket deltas (last interval)", classify(L("caddy.lat_p95_ms"), 1500, 2000)))
        if L("caddy.upstream_healthy_min") is not None:
            c.append(self.card("Upstreams healthy", "all" if L("caddy.upstream_healthy_min") == 1 else "DEGRADED", f"{L('caddy.upstream_count') or 0:.0f} upstream(s)", "st-ok" if L("caddy.upstream_healthy_min") == 1 else "st-crit"))
        if L("edge.up") is not None:
            c.append(self.card("Edge probe (loopback HTTPS)", "up" if L("edge.up") == 1 else "FAILING", f"{L('edge.latency_ms') or 0:.0f} ms", "st-ok" if L("edge.up") == 1 else "st-crit"))
        return '<h2>Edge</h2><div class="grid">' + "".join(c) + "</div>"

    def app_block(self):
        L = self.L
        c = []
        if L("fpm.up") is not None:
            c.append(self.card("PHP-FPM", f"{L('fpm.active') or 0:.0f} active / {L('fpm.idle') or 0:.0f} idle / {L('fpm.total') or 0:.0f} total" if L("fpm.up") == 1 else "NOT ANSWERING",
                               f"queue {L('fpm.listen_queue') or 0:.0f}, max_children reached {L('fpm.max_children_reached') or 0:.0f} (since start), slow {L('fpm.slow_requests') or 0:.0f}", classify(L("fpm.active_ratio"), 0.8, 0.95)))
        if L("mysql.up") is not None:
            c.append(self.card("MySQL", f"{L('mysql.threads_connected') or 0:.0f} / {L('mysql.max_connections') or 0:.0f} connections" if L("mysql.up") == 1 else "UNAVAILABLE",
                               f"running {L('mysql.threads_running') or 0:.0f}, max used {L('mysql.max_used_connections') or 0:.0f}, DB {fmt_bytes(L('mysql.db_size_bytes') or 0)}", classify(L("mysql.conn_pressure_pct"), 70, 90) if L("mysql.up") == 1 else "st-crit"))
        cp = [(k, v[0]) for k, v in self.rt.latest().items() if k.startswith("cp.") and k.endswith("_per_min") and ".r." not in k]
        if cp:
            tot = {k[3:-8]: v for k, v in cp}
            lines = " · ".join(f"{k.replace('_', ' ')} {v:.2f}" for k, v in sorted(tot.items()) if v)
            ratio = L("cp.order_per_checkout_ratio")
            rtxt = f"orders per checkout start ≈ {ratio:.2f} (checkout_start is approximate, not an exact funnel); " if ratio is not None else ""
            c.append(self.card("Control Plane counters (per min)", esc(lines or "all zero in the last interval"),
                               f"{rtxt}scheduled actions pending {L('cp.action_scheduler_pending') or 0:.0f}, failed(24h) {L('cp.action_scheduler_failed') or 0:.0f}"))
        if L("cp.outbox_reporting") is not None:
            if L("cp.outbox_reporting") == 1:
                ab, ag = L("cp.entitlement_outbox_abandoned") or 0, L("cp.entitlement_outbox_oldest_pending_age_s") or 0
                c.append(self.card("Entitlement delivery (CP to Backend)", f"{L('cp.entitlement_outbox_pending') or 0:.0f} retrying, {ab:.0f} abandoned",
                                   f"oldest undelivered event {ag / 60:.0f} min old (warn above 15 min; abandoned above 0 is critical)", "st-crit" if ab > 0 else "st-warn" if ag > 900 else "st-ok"))
            else:
                c.append(self.card("Entitlement delivery (CP to Backend)", "not reporting", "the outbox gauges are unavailable (table missing, no SELECT grant, or an older Control Plane): no alert is raised for this"))
        if L("backend.up") is not None:
            c.append(self.card("API backend (loopback metrics)", "answering" if L("backend.up") == 1 else "NOT ANSWERING",
                               f"{L('backend.req_rate') or 0:.2f} req/s, 5xx {L('backend.rate_5xx') or 0:.2f}/s, postgres {'up' if L('backend.postgres_up') == 1 else 'DOWN' if L('backend.postgres_up') == 0 else 'n/a'}",
                               "st-ok" if L("backend.up") == 1 else "st-crit"))
        return ('<h2>Application tier</h2><div class="grid">' + "".join(c) + "</div>") if c else ""

    def collectors_table(self):
        lt = self.rt.latest()
        names = sorted(k[10:-3] for k in lt if k.startswith("collector.") and k.endswith(".ok"))
        errs = self.rt.collector_errors()
        rows = "".join(f'<tr><th scope="row">{esc(n)}</th><td class="{"st-ok" if lt[f"collector.{n}.ok"][0] == 1 else "st-crit"}">{"ok" if lt[f"collector.{n}.ok"][0] == 1 else "FAILING"}</td>'
                       f'<td>{lt.get(f"collector.{n}.duration_ms", (0,))[0]:.0f} ms</td><td>{esc(errs.get(n, ""))}</td></tr>' for n in names)
        me = f"AICC Ops RSS {fmt_bytes(L)}" if (L := self.L("ops.rss_bytes")) else ""
        return (f'<h2>Collectors</h2><div class="wrap"><table><caption class="sr">Collector health</caption><thead><tr><th scope="col">Collector</th><th scope="col">Status</th><th scope="col">Last duration</th><th scope="col">Last error</th></tr></thead><tbody>{rows}</tbody></table></div>'
                f'<p class="note">{esc(me)} · database {fmt_bytes(self.L("ops.db_bytes") or 0)} of {fmt_bytes(self.rt.cfg["storage"]["max_db_bytes"])} cap</p>')

    # -- history
    def history(self, group, rng, now):
        title, charts = GROUPS[group]
        secs = UI_RANGES[rng]
        store = self.rt.store
        conn = store.reader()
        try:
            gtabs = "".join(f'<a href="/history?group={g}&amp;range={rng}"{" aria-current=\"true\"" if g == group else ""}>{esc(GROUPS[g][0])}</a>' for g in GROUPS)
            rtabs = "".join(f'<a href="/history?group={group}&amp;range={r}"{" aria-current=\"true\"" if r == rng else ""}>{r}</a>' for r in UI_RANGES)
            out = [f'<h2>History: {esc(title)}</h2><div class="tabs" role="group" aria-label="Group">{gtabs}</div><div class="tabs" role="group" aria-label="Range">{rtabs}</div>']
            tier = None
            for ctitle, series, unit, ymax in charts:
                ss = []
                step = 30
                for metric, label, cls in series:
                    tier, step, rows = store.series(metric, now - secs, now, 360, conn=conn)
                    ss.append({"label": label, "points": rows, "cls": cls})
                out.append(line_chart(ctitle, ss, now - secs, now, unit, step=step, ymax=ymax, desc=f"{ctitle}, last {rng}, resolution {step} s"))
            out.append(f'<p class="note">Range {rng}: resolution {step} s ({tier} tier). Line = average; shaded band = min..max within each step. Export: <a href="/export.csv?range={rng}">CSV</a> · <a href="/export.json?range={rng}">JSON</a></p>')
            return "".join(out)
        finally:
            conn.close()

    # -- alerts
    def alerts(self, now):
        conn = self.rt.store.reader()
        try:
            rows = self.rt.store.alert_history(200, conn=conn)
        finally:
            conn.close()
        body = "".join(f"<tr><td>{esc(iso(ts))}</td><td>{esc(sev)}</td><td>{esc(kind)}</td><td>{esc(rule)}</td><td>{esc(scope)}</td><td>{esc(msg)}</td></tr>" for ts, rule, scope, sev, kind, msg in rows)
        rules = "".join(f"<tr><th scope='row'>{esc(r.id)}</th><td>{esc(r.title)}</td><td>{r.for_samples}</td><td>{r.cooldown_s // 60} min</td><td>{esc(json.dumps({k: v for k, v in r.params.items() if k not in ('interval_s',)}))}</td></tr>" for r in (self.rt.engine.rules.values() if self.rt.engine else []))
        return (f'<h2>Active alerts</h2>{self.active_alerts()}<h2>Alert history (latest 200)</h2><div class="wrap"><table><caption class="sr">Alert history</caption>'
                f'<thead><tr><th scope="col">Time (UTC)</th><th scope="col">Severity</th><th scope="col">Event</th><th scope="col">Rule</th><th scope="col">Scope</th><th scope="col">Detail</th></tr></thead><tbody>{body or "<tr><td colspan=6>No alert events yet.</td></tr>"}</tbody></table></div>'
                f'<p><a href="/export.csv?kind=alerts">Export CSV</a> · <a href="/export.json?kind=alerts">JSON</a></p>'
                f'<h2>Rule catalogue (provisional defaults)</h2><div class="wrap"><table><caption class="sr">Alert rules</caption><thead><tr><th scope="col">Rule</th><th scope="col">Title</th><th scope="col">Sustain (samples)</th><th scope="col">Cooldown</th><th scope="col">Thresholds</th></tr></thead><tbody>{rules}</tbody></table></div>')

    def capacity(self, now):
        cap = self.rt.capacity()
        cls = {"HEALTHY": "st-ok", "WATCH": "st-warn"}.get(cap["verdict"], "st-crit")
        reasons = "".join(f"<tr><td>{esc(r['level'])}</td><td>{esc(r['window'])}</td><td>{esc(r['text'])}</td></tr>" for r in cap["reasons"]) or "<tr><td colspan=3>No rule triggered.</td></tr>"
        figs = "".join(f"<tr><th scope='row'>{esc(f['label'])}</th><td>{esc(f['window'])}</td><td>{esc(f['text'])}</td></tr>" for f in cap["figures"])
        thr = "".join(f"<tr><th scope='row'>{esc(k)}</th><td>{esc(v)}</td></tr>" for k, v in self.rt.cfg["capacity"].items())
        return (f'<h2>Capacity verdict</h2><p><span class="pill {cls}">{esc(cap["verdict"])}</span></p><p class="note">{esc(cap["disclaimer"])}</p>'
                + "".join(f'<p class="note">{esc(n)}</p>' for n in cap.get("notes", [])) +
                f'<h2>Reasons</h2><div class="wrap"><table><caption class="sr">Reasons</caption><thead><tr><th scope="col">Level</th><th scope="col">Window</th><th scope="col">Reason</th></tr></thead><tbody>{reasons}</tbody></table></div>'
                f'<h2>Measured figures</h2><div class="wrap"><table><caption class="sr">Figures</caption><thead><tr><th scope="col">Measure</th><th scope="col">Window</th><th scope="col">Value</th></tr></thead><tbody>{figs}</tbody></table></div>'
                f'<h2>Thresholds in effect (proposed, to be validated on staging)</h2><div class="wrap"><table><caption class="sr">Thresholds</caption><tbody>{thr}</tbody></table></div>'
                f'<p class="note">p95 = 95th percentile of 5-minute averages (so a short spike alone cannot trigger a recommendation); peak = highest 5-minute maximum.</p>')

    def config(self, now):
        red = redact(self.rt.cfg)
        return ('<h2>Configuration (read-only, secrets redacted)</h2><p class="note">Telegram credentials are never part of this configuration; they are read at runtime from a protected secrets file.</p>'
                f'<pre>{esc(json.dumps(red, indent=2, sort_keys=True))}</pre>')

    def export_index(self, now):
        conn = self.rt.store.reader()
        try:
            names = self.rt.store.metric_names(conn)
        finally:
            conn.close()
        return ('<h2>Export</h2><p>GET only. Parameters: <code>range</code> (1h, 6h, 24h, 7d, 30d, 90d, 365d), <code>metrics</code> (comma list, max 20), <code>kind</code> (metrics or alerts), <code>limit</code>.</p>'
                '<ul><li><a href="/export.json?range=24h">/export.json?range=24h</a></li><li><a href="/export.csv?range=24h">/export.csv?range=24h</a></li>'
                '<li><a href="/export.csv?kind=alerts">/export.csv?kind=alerts</a></li></ul>'
                f'<h2>Known metrics ({len(names)})</h2><pre>{esc(chr(10).join(names))}</pre>')


class UnsafeBind(Exception):
    pass


def validate_bind(host: str, unsafe: bool = False):
    """Fail closed: only loopback literals are accepted unless the explicit unsafe flag is passed."""
    try:
        ok = ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        ok = host == "localhost"
    if not ok and not unsafe:
        raise UnsafeBind(f"refusing to bind to non-loopback address {host!r} (AICC Ops is operator-only; use an SSH tunnel)")


class OpsServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 16

    def __init__(self, addr, handler, max_threads=8):
        self._sem = threading.BoundedSemaphore(max_threads)
        super().__init__(addr, handler)

    def process_request(self, request, client_address):
        if not self._sem.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            except OSError:
                pass
            self.shutdown_request(request)
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._sem.release()


def make_server(rt, bind="127.0.0.1", port=9190, unsafe=False, max_threads=8, timeout=10):
    validate_bind(bind, unsafe)
    pages = Pages(rt)
    started = time.time()

    class Handler(BaseHTTPRequestHandler):
        server_version = "AICCOps"
        sys_version = ""
        protocol_version = "HTTP/1.1"

        def setup(self):
            self.timeout = timeout
            super().setup()

        def log_message(self, fmt, *args):  # no request logging: paths/queries could be sensitive, and journald is noisy
            return

        def _send(self, code, body: bytes, ctype="text/html; charset=utf-8", extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            for k, v in SEC_HEADERS.items():
                self.send_header(k, v)
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _err(self, code, msg):
            self._send(code, page(f"{code}", f"<h2>{code}</h2><p>{esc(msg)}</p>", "", rt.cfg, time.time()), extra={"Allow": "GET"} if code == 405 else None)

        def _method_not_allowed(self):
            self._err(405, "This service is read-only: GET only.")

        do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = do_TRACE = do_CONNECT = _method_not_allowed

        def do_GET(self):
            host = host_from_header(self.headers.get("Host") or "")
            if host is None or host not in ALLOWED_HOSTS:
                return self._err(403, "Host header not allowed (DNS-rebinding protection).")
            if len(self.path) > 2048:
                return self._err(414, "URI too long.")
            u = urlsplit(self.path)
            qs = parse_qs(u.query, keep_blank_values=True, max_num_fields=12)
            now = time.time()
            try:
                self._route(u.path, qs, now)
            except exp.ExportError as e:
                self._err(400, str(e))
            except BrokenPipeError:
                pass
            except Exception:  # noqa: BLE001 - never leak internals
                self._err(500, "Internal error.")

        def _route(self, path, qs, now):
            if path == "/assets/ops.css":
                return self._send(200, CSS.encode(), "text/css; charset=utf-8")
            if path == "/healthz":
                return self._send(200, b"ok\n", "text/plain; charset=utf-8")
            if path in ("/", "/overview"):
                return self._send(200, page("Overview", pages.overview(now), "/", rt.cfg, now, refresh=True))
            if path == "/history":
                group = qs.get("group", ["host"])[0]
                rng = qs.get("range", ["24h"])[0]
                if group not in GROUPS or rng not in UI_RANGES:
                    raise exp.ExportError("unknown group or range")
                return self._send(200, page(f"History {GROUPS[group][0]} {rng}", pages.history(group, rng, now), "/history", rt.cfg, now))
            if path == "/alerts":
                return self._send(200, page("Alerts", pages.alerts(now), "/alerts", rt.cfg, now))
            if path == "/capacity":
                return self._send(200, page("Capacity", pages.capacity(now), "/capacity", rt.cfg, now))
            if path == "/config":
                return self._send(200, page("Config", pages.config(now), "/config", rt.cfg, now))
            if path == "/export":
                return self._send(200, page("Export", pages.export_index(now), "/export", rt.cfg, now))
            if path in ("/export.json", "/export.csv"):
                conn = rt.store.reader()
                try:
                    p = exp.parse_params(qs, set(rt.store.metric_names(conn)))
                    is_csv = path.endswith(".csv")
                    if p["kind"] == "alerts":
                        rows = exp.alerts_rows(rt.store, conn, p["limit"])
                        body = exp.alerts_csv(rows) if is_csv else exp.alerts_json(rows)
                    else:
                        data = exp.collect_metrics(rt.store, conn, p, now)
                        body = exp.metrics_csv(data) if is_csv else exp.to_json(data)
                finally:
                    conn.close()
                ctype = "text/csv; charset=utf-8" if is_csv else "application/json; charset=utf-8"
                return self._send(200, body, ctype, {"Content-Disposition": f'attachment; filename="aicc-ops-export.{"csv" if is_csv else "json"}"'})
            return self._err(404, "Not found.")

    srv = OpsServer((bind, port), Handler, max_threads=max_threads)
    return srv
