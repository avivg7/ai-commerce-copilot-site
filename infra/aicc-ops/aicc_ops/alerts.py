"""Alert engine: rules -> observations -> a state machine with sustain, hysteresis, cooldown, dedupe, flap control.

Per (rule, scope) key the engine keeps: status (ok/firing), consecutive breach/clear counters, whether the current
episode was notified, last notification time, and recent transitions (for flap suppression). State is persisted in
SQLite so a restart does not re-fire (or forget) alerts.

All thresholds below are PROVISIONAL conservative defaults. They are configurable under [alerts.rules.<id>] and are
to be tuned from staging measurements."""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field

WARNING, CRITICAL = "WARNING", "CRITICAL"
FIRING, RECOVERED, ESCALATED, FLAPPING, REMINDER = "FIRING", "RECOVERED", "ESCALATED", "FLAPPING", "REMINDER"


@dataclass
class Obs:
    """One instantaneous observation of a rule for one scope. breach=None means 'no data' (state unchanged)."""
    rule: str
    scope: str
    breach: bool | None
    clear: bool = False         # strictly below the hysteresis (clear) threshold
    severity: str = WARNING
    text: str = ""


@dataclass
class Notification:
    kind: str           # FIRING / RECOVERED / ESCALATED / FLAPPING / REMINDER
    severity: str
    rule: str
    title: str
    scope: str
    text: str
    ts: float
    since: float | None = None


@dataclass
class RuleSpec:
    id: str
    title: str
    fn: object
    params: dict = field(default_factory=dict)
    for_samples: int = 2
    clear_samples: int = 2
    crit_samples: int | None = None     # consecutive CRITICAL observations before reporting CRITICAL (default for_samples)
    cooldown_s: int = 1800              # min seconds between FIRING notifications for the same key
    renotify_s: int = 0                 # repeat reminders while firing (0 = never)
    renotify_critical_s: int = 21600    # reminders for CRITICAL only (6 h); WARNING never repeats unless renotify_s set
    enabled: bool = True


# ---- in-memory recent window (also warms from SQLite after restart) -------------------------------------------
class Window:
    def __init__(self, interval_s: float = 30, horizon_s: int = 3900, stale=None, default_stale_s: int = 600):
        self.maxlen = int(horizon_s / max(interval_s, 1)) + 5
        self.data: dict = {}
        self.stale = stale or {}
        self.default_stale_s = default_stale_s
        self.now = time.time()

    def push(self, ts: float, metrics: dict):
        self.now = ts
        for k, v in metrics.items():
            if k.startswith("_") or v is None or v != v:
                continue
            d = self.data.get(k)
            if d is None:
                d = self.data[k] = deque(maxlen=self.maxlen)
            d.append((ts, float(v)))

    def _limit(self, name):
        for p, s in self.stale.items():
            if name.startswith(p):
                return s
        return self.default_stale_s

    def latest(self, name):
        d = self.data.get(name)
        if not d:
            return None
        ts, v = d[-1]
        return v if self.now - ts <= self._limit(name) else None

    def recent(self, name, n):
        d = self.data.get(name)
        return [v for _, v in list(d)[-n:]] if d else []

    def names(self, prefix, suffix):
        return sorted(k for k in self.data if k.startswith(prefix) and k.endswith(suffix) and self.latest(k) is not None)


# ---- rules ------------------------------------------------------------------------------------------------------
def _sev(v, warn, crit, higher=True):
    if higher:
        return CRITICAL if v >= crit else WARNING if v >= warn else None
    return CRITICAL if v <= crit else WARNING if v <= warn else None


def r_service_down(ctx, p):
    out = []
    for n in ctx.names("svc.", ".active"):
        unit = n[4:-7]
        active = ctx.latest(n)
        failed = ctx.latest(f"svc.{unit}.failed")
        present = ctx.latest(f"svc.{unit}.present")
        why = "not installed/loaded" if present == 0 else "failed" if failed else "not active"
        out.append(Obs("service_down", unit, active == 0, clear=active == 1, severity=CRITICAL, text=f"service {unit} is {why}"))
    return out


def r_edge_probe(ctx, p):
    up = ctx.latest("edge.up")
    if up is None:
        return []
    st = ctx.latest("edge.status")
    return [Obs("edge_probe", "loopback-https", up == 0, clear=up == 1, severity=CRITICAL,
                text="loopback HTTPS probe of the edge failed" + (f" (HTTP {st:.0f})" if st else " (no response)"))]


def r_caddy_admin(ctx, p):
    up = ctx.latest("caddy.up")
    return [] if up is None else [Obs("caddy_admin", "metrics", up == 0, clear=up == 1, severity=WARNING,
                                      text="Caddy admin metrics endpoint unreachable (edge itself may still be serving)")]


def r_http_5xx(ctx, p):
    n = p["window_samples"]
    r5 = ctx.recent("caddy.rate_5xx", n)
    tot = ctx.recent("caddy.req_rate", n)
    if len(tot) < max(n // 2, 1):
        return []
    reqs = sum(tot) * p["interval_s"]
    share = 100.0 * sum(r5) / sum(tot) if sum(tot) > 0 else 0.0
    if reqs < p["min_requests"]:
        return [Obs("http_5xx", "edge", False, clear=True)]
    sev = _sev(share, p["warn"], p["crit"])
    return [Obs("http_5xx", "edge", sev is not None, clear=share < p["clear"], severity=sev or WARNING,
                text=f"{share:.1f}% of {reqs:.0f} requests in the last {n * p['interval_s'] / 60:.0f} min returned 5xx (warn >= {p['warn']:g}%, critical >= {p['crit']:g}%)")]


def _simple_high(rule, scope, metric, label, fmt="{:.0f}%"):
    def fn(ctx, p):
        v = ctx.latest(metric)
        if v is None:
            return []
        sev = _sev(v, p["warn"], p["crit"])
        return [Obs(rule, scope, sev is not None, clear=v < p["clear"], severity=sev or WARNING,
                    text=f"{label} {fmt.format(v)} (warn >= {p['warn']}, critical >= {p['crit']})")]
    return fn


MIB = 1024 * 1024


def r_ram_available(ctx, p):
    """LOW available memory (MiB): the figure that matters on a 2 GiB host with no headroom (ram_high is on used%)."""
    v = ctx.latest("mem.available_bytes")
    if v is None:
        return []
    mib = v / MIB
    sev = CRITICAL if mib < p["crit_mib"] else WARNING if mib < p["warn_mib"] else None
    return [Obs("ram_available_low", "host", sev is not None, clear=mib > p["clear_mib"], severity=sev or WARNING,
                text=f"available memory {mib:.0f} MiB (warn < {p['warn_mib']} MiB, critical < {p['crit_mib']} MiB)")]


def r_swap(ctx, p):
    i, o = ctx.latest("swap.in_pps"), ctx.latest("swap.out_pps")
    if i is None and o is None:
        return []
    i, o = i or 0.0, o or 0.0
    sev = CRITICAL if i >= p["crit_in"] else WARNING if (i >= p["warn_in"] or o >= p["warn_out"]) else None
    return [Obs("swap_activity", "host", sev is not None, clear=i < p["clear_in"] and o < p["clear_out"], severity=sev or WARNING,
                text=f"swap activity: {i:.0f} pages/s in, {o:.0f} pages/s out (warn: in >= {p['warn_in']} or out >= {p['warn_out']}; critical: in >= {p['crit_in']})")]


def r_disk(ctx, p):
    out = []
    for n in ctx.names("disk.", ".used_pct"):
        mount = n[5:-9]
        v = ctx.latest(n)
        sev = _sev(v, p["warn"], p["crit"])
        out.append(Obs("disk_low", mount, sev is not None, clear=v < p["clear"], severity=sev or WARNING,
                       text=f"disk {mount} is {v:.0f}% full (warn >= {p['warn']}%, critical >= {p['crit']}%)"))
    return out


def r_inodes(ctx, p):
    out = []
    for n in ctx.names("disk.", ".inodes_used_pct"):
        mount = n[5:-16]
        v = ctx.latest(n)
        sev = _sev(v, p["warn"], p["crit"])
        out.append(Obs("inodes_low", mount, sev is not None, clear=v < p["clear"], severity=sev or WARNING,
                       text=f"inodes on {mount} are {v:.0f}% used (warn >= {p['warn']}%, critical >= {p['crit']}%)"))
    return out


def r_fpm_down(ctx, p):
    up = ctx.latest("fpm.up")
    return [] if up is None else [Obs("fpm_down", "pool", up == 0, clear=up == 1, severity=CRITICAL, text="PHP-FPM status endpoint not answering")]


def r_fpm_sat(ctx, p):
    if ctx.latest("fpm.up") != 1:
        return []
    reached = sum(ctx.recent("fpm.max_children_reached_delta", p["window_samples"]))
    q = ctx.latest("fpm.listen_queue") or 0.0
    ratio = ctx.latest("fpm.active_ratio") or 0.0
    breach = reached > 0 or q >= p["queue_warn"] or ratio >= p["ratio_warn"]
    crit = q >= p["queue_crit"]
    bits = []
    if reached > 0:
        bits.append(f"max_children reached {reached:.0f}x recently")
    if q >= p["queue_warn"]:
        bits.append(f"listen queue {q:.0f}")
    if ratio >= p["ratio_warn"]:
        bits.append(f"active/total {ratio:.2f}")
    return [Obs("fpm_saturation", "pool", breach, clear=reached == 0 and q == 0 and ratio < p["ratio_clear"],
                severity=CRITICAL if crit else WARNING, text="PHP-FPM saturation: " + ", ".join(bits or ["recovering"]))]


def r_fpm_log(ctx, p):
    """max_children pressure seen in the PHP-FPM log (counts from the root timer): the pool ran out of workers, requests queued."""
    e15 = ctx.latest("fpm.log_events_15m")
    if e15 is None:
        return []
    e5 = ctx.latest("fpm.log_events_5m") or 0.0
    sev = CRITICAL if e15 >= p["crit_events"] else WARNING
    return [Obs("fpm_max_children", "pool", e15 >= p["warn_events"], clear=e15 == 0, severity=sev,
                text=f"PHP-FPM reached pm.max_children {e15:.0f}x in the last 15 min ({e5:.0f}x in the last 5): the pool is out of workers "
                     f"(warn >= {p['warn_events']:.0f}, critical >= {p['crit_events']:.0f} events per 15 min). The CPU is the usual cause on 1 vCPU: see the capacity verdict.")]


def r_db_down(ctx, p):
    up = ctx.latest("mysql.up")
    return [] if up is None else [Obs("db_down", "mysql", up == 0, clear=up == 1, severity=CRITICAL, text="MySQL is unreachable on its socket")]


def r_db_conn(ctx, p):
    v = ctx.latest("mysql.conn_pressure_pct")
    if v is None:
        return []
    sev = _sev(v, p["warn"], p["crit"])
    return [Obs("db_conn_pressure", "mysql", sev is not None, clear=v < p["clear"], severity=sev or WARNING,
                text=f"MySQL connections at {v:.0f}% of max_connections (warn >= {p['warn']}%, critical >= {p['crit']}%)")]


def r_backup_stale(ctx, p):
    age = ctx.latest("backup.newest_age_s")
    if age is None:
        if ctx.latest("backup.dir_present") == 0:
            return [Obs("backup_stale", "dump", True, severity=WARNING, text="backup directory is missing")]
        if ctx.latest("backup.status_present") == 0:
            return [Obs("backup_stale", "dump", True, severity=WARNING, text="no backup status file yet (has the first backup run?)")]
        return []
    h = age / 3600
    sev = _sev(h, p["warn_h"], p["crit_h"])
    return [Obs("backup_stale", "dump", sev is not None, clear=h < p["clear_h"], severity=sev or WARNING,
                text=f"newest backup is {h:.0f} h old (warn >= {p['warn_h']} h, critical >= {p['crit_h']} h)")]


OFFHOST_REASONS = {1: "the ack file is not valid JSON", 2: "the ack file has a schema this version does not understand",
                   3: "the ack file says the copy was NOT verified", 4: "the ack file has missing or invalid fields", 5: "the ack file cannot be read"}
OFFHOST_ACTION = "Mac asleep/offline? Run infra/backup/pull-offhost.sh."


def r_offhost(ctx, p):
    """The owner's Mac writes backups/offhost-ack.json after pulling AND verifying a backup set. Stale = no verified copy confirmed lately."""
    present = ctx.latest("backup.offhost_present")
    if present is None:
        return []
    if present == 0:
        up, newest = ctx.latest("uptime.seconds"), ctx.latest("backup.newest_age_s")
        if up is None:
            return []                                    # cannot tell a new host from an old one: hold state
        up_h = up / 3600
        if newest is None or up_h <= p["absent_after_uptime_h"]:
            return [Obs("offhost_stale", "offhost", False, clear=True)]   # brand-new host or no successful backup yet: no ack is expected
        return [Obs("offhost_stale", "offhost", True, severity=WARNING,
                    text=f"no off-host confirmation file exists although the host has been up {up_h:.0f} h (limit {p['absent_after_uptime_h']} h) "
                         f"and a backup exists: the owner's Mac has never confirmed a verified copy. Run infra/backup/pull-offhost.sh.")]
    if ctx.latest("backup.offhost_verified") != 1:
        code = int(ctx.latest("backup.offhost_reason") or 4)
        return [Obs("offhost_stale", "offhost", True, severity=WARNING,
                    text=f"off-host confirmation is invalid: {OFFHOST_REASONS.get(code, OFFHOST_REASONS[4])}, so there is no verified off-host copy. Run infra/backup/pull-offhost.sh.")]
    age = ctx.latest("backup.offhost_age_s")
    if age is None:
        return []
    # also how far the ACKNOWLEDGED SET lags behind the newest backup on the host: a Mac (or a stolen pull key) that keeps re-acknowledging an old set refreshes
    # acked_at but not the set, so the effective age is the larger of the two
    set_age, newest = ctx.latest("backup.offhost_set_age_s"), ctx.latest("backup.newest_age_s")
    if set_age is not None and newest is not None:
        age = max(age, set_age - newest)
    h = age / 3600
    sev = _sev(h, p["warn_h"], p["crit_h"])
    return [Obs("offhost_stale", "offhost", sev is not None, clear=h < p["clear_h"], severity=sev or WARNING,
                text=f"the owner's Mac has not confirmed a verified copy of the newest backup in {h:.0f} h "
                     f"(warn >= {p['warn_h']} h, critical >= {p['crit_h']} h). {OFFHOST_ACTION}")]


def r_backup_failed(ctx, p):
    out = []
    ok = ctx.latest("backup.status_ok")
    if ok is not None:
        out.append(Obs("backup_failed", "status", ok == 0, clear=ok == 1, severity=CRITICAL, text="last backup job reported failure"))
    rc = ctx.latest("backup.restore_check_ok")
    if rc is not None:
        out.append(Obs("backup_failed", "restore-check", rc == 0, clear=rc == 1, severity=CRITICAL, text="backup restore smoke check failed"))
    return out


def r_unit_failed(ctx, p):
    out = []
    for n in ctx.names("unitfail.", ".failed"):
        unit = n[9:-7]
        v = ctx.latest(n)
        out.append(Obs("unit_failed", unit, v == 1, clear=v == 0, severity=CRITICAL, text=f"systemd reported failure of {unit} (status file; see journalctl)"))
    return out


def r_cert(ctx, p):
    out = []
    d = ctx.latest("cert.days_left")
    if d is not None:
        sev = _sev(d, p["warn_days"], p["crit_days"], higher=False)
        out.append(Obs("cert_expiry", "edge-cert", sev is not None, clear=d > p["clear_days"], severity=sev or WARNING,
                       text=f"certificate expires in {d:.0f} days (warn <= {p['warn_days']}, critical <= {p['crit_days']})"))
    ok = ctx.latest("cert.ok")
    if ok is not None:
        out.append(Obs("cert_unreadable", "edge-cert", ok == 0, clear=ok == 1, severity=WARNING, text="could not read the served certificate on loopback"))
    return out


def r_restarts(ctx, p):
    out = []
    n = p["window_samples"]
    for name in ctx.names("svc.", ".restarts"):
        unit = name[4:-9]
        vals = ctx.recent(name, n)
        if len(vals) < 2:
            continue
        delta = sum(max(b - a, 0) if b >= a else b for a, b in zip(vals, vals[1:]))
        sev = _sev(delta, p["warn"], p["crit"])
        out.append(Obs("process_restart", unit, sev is not None, clear=delta < 1, severity=sev or WARNING,
                       text=f"service {unit} restarted {delta:.0f} time(s) in the last {n * p['interval_s'] / 60:.0f} min (warn >= {p['warn']}, critical >= {p['crit']})"))
    return out


def r_collector(ctx, p):
    out = []
    for n in ctx.names("collector.", ".ok"):
        c = n[10:-3]
        ok = ctx.latest(n)
        out.append(Obs("collector_failure", c, ok == 0, clear=ok == 1, severity=WARNING, text=f"collector '{c}' is failing"))
    return out


def r_cap(ctx, p):
    b, cap = ctx.latest("ops.db_bytes"), p["cap_bytes"]
    if b is None or not cap:
        return []
    pct = 100.0 * b / cap
    sev = _sev(pct, p["warn"], p["crit"])
    return [Obs("monitoring_disk_cap", "ops-db", sev is not None, clear=pct < p["clear"], severity=sev or WARNING,
                text=f"AICC Ops database at {pct:.0f}% of its size cap (warn >= {p['warn']}%, critical >= {p['crit']}%; oldest data is pruned at 100%)")]


def r_write_blocked(ctx, p):
    w = ctx.latest("ops.write_blocked")
    free = ctx.latest("ops.fs_free_pct")
    return [] if w is None else [Obs("monitoring_write_blocked", "fs-free-space", w == 1, clear=w == 0, severity=CRITICAL,
                                     text=f"monitoring writes REFUSED: filesystem free space {free:.1f}% is below the safety floor" if free is not None else "monitoring writes REFUSED: low free space")]


WP_CRON_CADENCE_S = 120  # infra/systemd/aicc-wp-cron.timer: OnCalendar=*:0/2 (architecture review H-2)


def r_reboot_required(ctx, p):
    """WARNING only, never CRITICAL, and it clears ONLY when the marker file is gone (a reboot removes it): a value of 1 is 'hold', never 'clear'."""
    v = ctx.latest("host.reboot_required")
    if v is None:
        return []
    age = ctx.latest("host.reboot_required_age_s")
    since = f" for {age / 86400:.1f} days" if age is not None and age >= 3600 else ""
    return [Obs("reboot_required", "host", v == 1, clear=v == 0, severity=WARNING,
                text=f"a reboot is pending{since}: updates were installed that stay inactive until the host is restarted (schedule a maintenance window; restart is NOT automatic)")]


def r_secupd_pending(ctx, p):
    """The hourly job should install a security update within about an hour; one that stays pending is held back or failing. Numbers only: no package names in the message."""
    cnt = ctx.latest("secupdates.pending_count")
    if cnt is None:
        return []
    h = (ctx.latest("secupdates.pending_oldest_age_s") or 0) / 3600
    sev = _sev(h, p["warn_h"], p["crit_h"]) if cnt > 0 else None
    return [Obs("security_updates_pending", "pending", sev is not None, clear=cnt == 0 or h < p["clear_h"], severity=sev or WARNING,
                text=f"{int(cnt)} security update(s) have been waiting {h:.0f} h although the hourly job runs (warn >= {p['warn_h']} h, critical >= {p['crit_h']} h): "
                     f"see `systemctl status aicc-security-updates` and /var/log/unattended-upgrades/")]


def r_secupd_stale(ctx, p):
    """Is the hourly security-update job itself completing? A missing status file only matters once the host has been up for a while."""
    age = ctx.latest("secupdates.last_run_age_s")
    if age is None:
        if ctx.latest("secupdates.status_present") == 0:
            up = ctx.latest("uptime.seconds")
            if up is not None and up / 3600 < p["absent_after_h"]:
                return [Obs("security_updates_stale", "run", False, clear=True)]
            return [Obs("security_updates_stale", "run", True, severity=WARNING,
                        text="no security-update status file yet: the hourly job (aicc-security-updates.timer) has never completed on this host")]
        return []
    h = age / 3600
    sev = _sev(h, p["warn_h"], p["crit_h"])
    out = [Obs("security_updates_stale", "run", sev is not None, clear=h < p["clear_h"], severity=sev or WARNING,
               text=f"the hourly security-update job has not completed for {h:.0f} h (warn >= {p['warn_h']} h, critical >= {p['crit_h']} h): new security fixes would not be installed")]
    ok = ctx.latest("secupdates.last_ok")
    if ok is not None:
        out.append(Obs("security_updates_stale", "result", ok == 0, clear=ok == 1, severity=WARNING,
                       text="the last security-update run reported an error (package list refresh or unattended-upgrade failed)"))
    return out


def r_secupd_services(ctx, p):
    """After an update a running service can still execute the replaced binary or library. PHP-FPM is reloaded by the job itself; this fires if anything is left."""
    n = ctx.latest("secupdates.stale_services")
    if n is None:
        return []
    return [Obs("services_need_restart", "services", n > 0, clear=n == 0, severity=WARNING,
                text=f"{int(n)} running service(s) still use replaced code after a security update (PHP-FPM is reloaded automatically; MySQL or SSH need a planned restart): "
                     f"read /var/lib/aicc/status/security-updates.json on the host")]


def r_cron(ctx, p):
    v = ctx.latest("cp.wc_cron_last_run_age_seconds")
    if v is None:
        return []
    sev = _sev(v, p["warn_s"], p["crit_s"])
    return [Obs("wc_cron_stale", "action-scheduler", sev is not None, clear=v < p["clear_s"], severity=sev or WARNING,
                text=f"last completed scheduled action finished {v / 60:.0f} min ago (warn >= {p['warn_s'] / 60:.0f} min, critical >= {p['crit_s'] / 60:.0f} min)")]


def r_backend_down(ctx, p):
    out = []
    up = ctx.latest("backend.up")
    if up is not None:
        out.append(Obs("backend_down", "api-metrics", up == 0, clear=up == 1, severity=WARNING, text="API metrics endpoint not answering (API host collector)"))
    pg = ctx.latest("backend.postgres_up")
    if pg is not None:
        out.append(Obs("backend_postgres_down", "postgres", pg == 0, clear=pg == 1, severity=CRITICAL, text="API reports PostgreSQL probe failing"))
    h = ctx.latest("backend.health_ok")
    if h is not None:
        out.append(Obs("backend_health_degraded", "health", h == 0, clear=h == 1, severity=WARNING, text="API /health reports degraded"))
    return out


def r_backend_pool(ctx, p):
    v = ctx.latest("backend.pool_pressure_pct")
    if v is None:
        return []
    sev = _sev(v, p["warn"], p["crit"])
    return [Obs("backend_pool_pressure", "db-pool", sev is not None, clear=v < p["clear"], severity=sev or WARNING,
                text=f"API database pool at {v:.0f}% of capacity (warn >= {p['warn']}%, critical >= {p['crit']}%)")]


def r_backend_5xx(ctx, p):
    n = p["window_samples"]
    r5, tot = ctx.recent("backend.rate_5xx", n), ctx.recent("backend.req_rate", n)
    if len(tot) < max(n // 2, 1):
        return []
    reqs = sum(tot) * p["interval_s"]
    if reqs < p["min_requests"]:
        return [Obs("backend_5xx", "api", False, clear=True)]
    share = 100.0 * sum(r5) / sum(tot) if sum(tot) > 0 else 0.0
    sev = _sev(share, p["warn"], p["crit"])
    return [Obs("backend_5xx", "api", sev is not None, clear=share < p["clear"], severity=sev or WARNING,
                text=f"{share:.1f}% of {reqs:.0f} API requests returned 5xx (warn >= {p['warn']:g}%, critical >= {p['crit']:g}%)")]


def default_rules(cfg: dict) -> list:
    iv = cfg["general"]["interval_s"]
    w10 = max(int(300 / iv), 1)
    cap = cfg["storage"]["max_db_bytes"]
    return [
        RuleSpec("service_down", "Service not running", r_service_down, for_samples=2, clear_samples=2, cooldown_s=900),
        RuleSpec("edge_probe", "Edge health probe failing", r_edge_probe, for_samples=3, clear_samples=2, cooldown_s=900),
        RuleSpec("caddy_admin", "Caddy metrics unreachable", r_caddy_admin, for_samples=4, clear_samples=4, cooldown_s=3600),
        RuleSpec("http_5xx", "Elevated 5xx rate", r_http_5xx, dict(window_samples=w10, interval_s=iv, min_requests=20, warn=5.0, crit=25.0, clear=2.0), for_samples=2, clear_samples=4),
        RuleSpec("ram_high", "High memory use", _simple_high("ram_high", "host", "mem.used_pct", "memory used"), dict(warn=90, crit=96, clear=85), for_samples=w10 * 2, clear_samples=w10, crit_samples=w10),
        # available MiB, not used%: this host has 2 GiB and ~1059 MiB was the measured minimum available under load. Sustained 5 min.
        RuleSpec("ram_available_low", "Low available memory", r_ram_available, dict(warn_mib=200, crit_mib=120, clear_mib=300), for_samples=w10, clear_samples=w10, crit_samples=w10),
        RuleSpec("swap_activity", "Meaningful swap activity", r_swap, dict(warn_in=100, warn_out=300, crit_in=1000, clear_in=10, clear_out=30), for_samples=w10 * 2, clear_samples=w10),
        RuleSpec("cpu_saturation", "Sustained CPU saturation", _simple_high("cpu_saturation", "host", "cpu.used_pct", "CPU"), dict(warn=90, crit=98, clear=80), for_samples=w10 * 2, clear_samples=w10, crit_samples=w10 * 4),
        RuleSpec("disk_low", "Low disk space", r_disk, dict(warn=85, crit=93, clear=80), for_samples=2, clear_samples=4, cooldown_s=3600),
        RuleSpec("inodes_low", "Low inodes", r_inodes, dict(warn=85, crit=95, clear=80), for_samples=2, clear_samples=4, cooldown_s=3600),
        RuleSpec("fpm_down", "PHP-FPM not answering", r_fpm_down, for_samples=2, clear_samples=2, cooldown_s=900),
        RuleSpec("fpm_saturation", "PHP-FPM saturation", r_fpm_sat, dict(window_samples=w10 * 2, queue_warn=1, queue_crit=10, ratio_warn=0.9, ratio_clear=0.7), for_samples=4, clear_samples=w10, cooldown_s=3600),
        RuleSpec("fpm_max_children", "PHP-FPM out of workers (log)", r_fpm_log, dict(warn_events=5, crit_events=40), for_samples=2, clear_samples=w10, cooldown_s=3600),
        RuleSpec("db_down", "MySQL unavailable", r_db_down, for_samples=2, clear_samples=2, cooldown_s=900),
        RuleSpec("db_conn_pressure", "MySQL connection pressure", r_db_conn, dict(warn=80, crit=95, clear=70), for_samples=w10 * 2, clear_samples=w10, crit_samples=4),
        RuleSpec("backup_stale", "Backup is stale", r_backup_stale, dict(warn_h=3, crit_h=12, clear_h=2), for_samples=1, clear_samples=2, cooldown_s=21600),
        # off-host copy confirmed by the owner's Mac (offhost-ack.json). 36 h = one missed daily pull plus slack; 96 h = four days without a verified copy.
        RuleSpec("offhost_stale", "Off-host backup copy is stale", r_offhost, dict(warn_h=36, crit_h=96, clear_h=30, absent_after_uptime_h=48), for_samples=2, clear_samples=2, cooldown_s=21600),
        RuleSpec("unit_failed", "AICC unit reported failure", r_unit_failed, for_samples=1, clear_samples=2, cooldown_s=3600),
        RuleSpec("backup_failed", "Backup job failed", r_backup_failed, for_samples=1, clear_samples=2, cooldown_s=21600),
        RuleSpec("cert_expiry", "Certificate nearing expiry", r_cert, dict(warn_days=14, crit_days=5, clear_days=21), for_samples=1, clear_samples=2, cooldown_s=43200, renotify_critical_s=43200),
        RuleSpec("cert_unreadable", "Certificate unreadable", lambda c, p: [], for_samples=3),  # emitted by cert_expiry's fn
        RuleSpec("process_restart", "Repeated process restart", r_restarts, dict(window_samples=int(3600 / iv), interval_s=iv, warn=3, crit=6), for_samples=1, clear_samples=2, cooldown_s=3600),
        RuleSpec("collector_failure", "Collector failing", r_collector, for_samples=4, clear_samples=2, cooldown_s=3600),
        RuleSpec("monitoring_disk_cap", "Monitoring storage near its cap", r_cap, dict(cap_bytes=cap, warn=85, crit=95, clear=75), for_samples=2, clear_samples=4, cooldown_s=21600),
        RuleSpec("monitoring_write_blocked", "Monitoring writes refused (low disk)", r_write_blocked, for_samples=1, clear_samples=2, cooldown_s=1800),
        RuleSpec("backend_down", "API metrics unavailable", r_backend_down, for_samples=4, clear_samples=2, cooldown_s=3600),
        RuleSpec("backend_pool_pressure", "API database pool pressure", r_backend_pool, dict(warn=80, crit=95, clear=70), for_samples=w10, clear_samples=w10, cooldown_s=3600),
        RuleSpec("backend_5xx", "Elevated API 5xx rate", r_backend_5xx, dict(window_samples=w10, interval_s=iv, min_requests=20, warn=5.0, crit=25.0, clear=2.0), for_samples=2, clear_samples=4),
        # architecture review M-2: unattended-upgrades never reboots (Automatic-Reboot false); this tells the operator a reboot is waiting. Sustain 1 sample, one notice per day at most.
        RuleSpec("reboot_required", "Host reboot pending", r_reboot_required, for_samples=1, clear_samples=1, cooldown_s=86400),
        # security-update freshness (WS14): the hourly job replaces the once-a-day apt timer as the thing that installs fixes; these three tell the operator when it stops doing so.
        RuleSpec("security_updates_pending", "Security updates waiting", r_secupd_pending, dict(warn_h=6, crit_h=24, clear_h=3), for_samples=2, clear_samples=2, cooldown_s=21600),
        RuleSpec("security_updates_stale", "Security-update job not completing", r_secupd_stale, dict(warn_h=4, crit_h=12, clear_h=2, absent_after_h=3), for_samples=2, clear_samples=2, cooldown_s=21600),
        RuleSpec("services_need_restart", "Running services use replaced code", r_secupd_services, for_samples=10, clear_samples=2, cooldown_s=43200),
        # The system cron (aicc-wp-cron.timer) runs every 2 minutes (WP_CRON_CADENCE_S); the thresholds below must stay far above it (tests/test_alerts.py::CronCadence).
        RuleSpec("wc_cron_stale", "Scheduled actions stale", r_cron, dict(warn_s=3600, crit_s=14400, clear_s=1800), for_samples=2, clear_samples=2, cooldown_s=3600),
    ]


def build_rules(cfg: dict) -> list:
    """Default rules with [alerts.rules.<id>] overrides applied (params keys + spec fields)."""
    over = cfg["alerts"].get("rules", {})
    rules = default_rules(cfg)
    for r in rules:
        o = over.get(r.id, {})
        for k, v in o.items():
            if k in ("enabled", "for_samples", "clear_samples", "crit_samples", "cooldown_s", "renotify_s", "renotify_critical_s"):
                setattr(r, k, v)
            else:
                r.params[k] = v
    return rules


# ---- state machine ----------------------------------------------------------------------------------------------
def _new_state():
    return {"status": "ok", "breach": 0, "crit": 0, "clear": 0, "severity": WARNING, "since": None, "notified": False,
            "last_fire_notice": 0.0, "last_notice": 0.0, "transitions": [], "flapping": False, "text": "", "last_seen": 0.0}


class AlertEngine:
    def __init__(self, rules, store=None, flap_window_s=1800, flap_max=4, enabled=True):
        self.rules = {r.id: r for r in rules}
        self.store = store
        self.flap_window_s = flap_window_s
        self.flap_max = flap_max
        self.enabled = enabled
        self.state: dict = {}
        if store is not None:
            try:
                self.state = {k: {**_new_state(), **v} for k, v in store.load_alert_states().items()}
            except Exception:  # noqa: BLE001 - never block startup on state loading
                self.state = {}
        self._dirty: set = set()

    # -- helpers
    def _record(self, now, key, rule, scope, severity, kind, msg):
        if self.store is not None:
            try:
                self.store.add_alert_event(now, key, rule, scope, severity, kind, msg)
            except Exception:  # noqa: BLE001
                pass

    def _persist(self):
        if self.store is None:
            return
        for k in list(self._dirty):
            try:
                self.store.save_alert_state(k, self.state[k])
            except Exception:  # noqa: BLE001 - disk-full etc. must not break alerting
                pass
        self._dirty.clear()

    def collect_obs(self, ctx):
        obs = []
        for r in self.rules.values():
            if not r.enabled or r.id == "cert_unreadable":
                continue
            try:
                p = {**r.params}
                for o in r.fn(ctx, p):
                    obs.append(o)
            except Exception as e:  # noqa: BLE001 - a bad rule must never stop others
                obs.append(Obs("collector_failure", f"rule:{r.id}", True, severity=WARNING, text=f"rule {r.id} errored: {type(e).__name__}"))
        return obs

    def evaluate(self, ctx, now: float) -> list:
        if not self.enabled:
            return []
        return self.process(self.collect_obs(ctx), now)

    def process(self, observations, now: float) -> list:
        notes = []
        seen = set()
        for o in observations:
            key = f"{o.rule}:{o.scope}"
            seen.add(key)
            spec = self.rules.get(o.rule)
            if spec is None:
                spec = RuleSpec(o.rule, o.rule, None)
            st = self.state.setdefault(key, _new_state())
            st["last_seen"] = now
            before = (st["status"], st["severity"], st["notified"], st["flapping"], st["breach"], st["clear"], st["crit"])
            n = self._step(spec, key, st, o, now)
            notes.extend(n)
            if before != (st["status"], st["severity"], st["notified"], st["flapping"], st["breach"], st["clear"], st["crit"]) or n:
                self._dirty.add(key)
        # flap recovery for keys that stopped being observed is not needed: state only changes with observations
        self._persist()
        return notes

    def _transition(self, st, now):
        st["transitions"] = [t for t in st["transitions"] if now - t <= self.flap_window_s] + [now]

    def _step(self, spec, key, st, o, now):
        notes = []
        crit_needed = spec.crit_samples if spec.crit_samples is not None else spec.for_samples

        def note(kind, sev, text):
            notes.append(Notification(kind, sev, spec.id, spec.title, o.scope, text, now, st.get("since")))
            st["last_notice"] = now

        # flap exit check (quiet for a full window)
        if st["flapping"] and not [t for t in st["transitions"] if now - t <= self.flap_window_s]:
            st["flapping"] = False
            self._record(now, key, spec.id, o.scope, st["severity"], "STABLE", "alert stopped flapping")
            if st["status"] == "firing":
                st["notified"] = True
                st["last_fire_notice"] = now
                note(FIRING, st["severity"], st["text"] or o.text)
            else:
                note(RECOVERED, st["severity"], "condition is clear and stable (flapping ended)")

        if o.breach is None:
            return notes
        if o.breach:
            st["breach"] += 1
            st["clear"] = 0
            st["crit"] = st["crit"] + 1 if o.severity == CRITICAL else 0
            sev = CRITICAL if st["crit"] >= max(crit_needed, 1) else WARNING
            st["text"] = o.text
            if st["status"] != "firing":
                if st["breach"] >= spec.for_samples:
                    st["status"], st["severity"], st["since"], st["notified"] = "firing", sev, now, False
                    self._transition(st, now)
                    self._record(now, key, spec.id, o.scope, sev, FIRING, o.text)
            else:
                if sev == CRITICAL and st["severity"] != CRITICAL:
                    st["severity"] = CRITICAL
                    self._record(now, key, spec.id, o.scope, sev, ESCALATED, o.text)
                    if not st["flapping"]:
                        st["notified"] = True
                        st["last_fire_notice"] = now
                        note(ESCALATED, CRITICAL, o.text)
            if st["status"] == "firing":
                self._maybe_flap(spec, key, st, o, now, notes)
                if not st["flapping"]:
                    if not st["notified"]:
                        if now - st["last_fire_notice"] >= spec.cooldown_s:
                            st["notified"] = True
                            st["last_fire_notice"] = now
                            note(FIRING, st["severity"], o.text)
                        elif not st.get("cooldown_logged"):
                            st["cooldown_logged"] = True
                            self._record(now, key, spec.id, o.scope, st["severity"], "SUPPRESSED", f"cooldown ({spec.cooldown_s}s) active; will notify when it ends if still firing")
                    else:
                        rn = spec.renotify_s or (spec.renotify_critical_s if st["severity"] == CRITICAL else 0)
                        if rn and now - st["last_notice"] >= rn:
                            note(REMINDER, st["severity"], o.text)
        elif o.clear:
            st["clear"] += 1
            st["breach"] = 0
            st["crit"] = 0
            if st["status"] == "firing" and st["clear"] >= spec.clear_samples:
                was_notified = st["notified"]
                dur = now - (st["since"] or now)
                st["status"] = "ok"
                st["cooldown_logged"] = False
                self._transition(st, now)
                self._record(now, key, spec.id, o.scope, st["severity"], RECOVERED, f"recovered after {int(dur)}s")
                self._maybe_flap(spec, key, st, o, now, notes)
                if was_notified and not st["flapping"]:
                    note(RECOVERED, st["severity"], f"recovered after {int(dur // 60)} min" if dur >= 60 else f"recovered after {int(dur)} s")
                st["notified"] = False
                st["since"] = None
        else:
            # between breach and clear thresholds: hold, but a pending (not yet firing) breach streak is broken
            if st["status"] != "firing":
                st["breach"] = 0
            st["clear"] = 0
        return notes

    def _maybe_flap(self, spec, key, st, o, now, notes):
        recent = [t for t in st["transitions"] if now - t <= self.flap_window_s]
        if not st["flapping"] and len(recent) >= self.flap_max:
            st["flapping"] = True
            self._record(now, key, spec.id, o.scope, WARNING, FLAPPING, f"{len(recent)} state changes in {self.flap_window_s // 60} min; notifications suppressed")
            notes.append(Notification(FLAPPING, WARNING, spec.id, spec.title, o.scope,
                                      f"flapping: {len(recent)} state changes in {self.flap_window_s // 60} min; further notices suppressed until stable",
                                      now, st.get("since")))
            st["last_notice"] = now

    def active(self) -> list:
        out = []
        for key, st in self.state.items():
            if st["status"] == "firing":
                rule, _, scope = key.partition(":")
                spec = self.rules.get(rule)
                out.append({"rule": rule, "title": spec.title if spec else rule, "scope": scope, "severity": st["severity"],
                            "since": st["since"], "text": st["text"], "flapping": st["flapping"], "notified": st["notified"]})
        return sorted(out, key=lambda a: (a["severity"] != CRITICAL, a["since"] or 0))
