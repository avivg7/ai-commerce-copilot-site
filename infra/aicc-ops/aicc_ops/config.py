"""Configuration: documented defaults, TOML overlay (tomllib), validation, redaction.

Nothing secret lives in this file or in the TOML: Telegram credentials are read only from the
runtime secrets file / systemd credentials (see telegram.py)."""
from __future__ import annotations

import copy
import re
import tomllib

MIB = 1024 * 1024

DEFAULTS: dict = {
    "general": {
        "host_label": "aicc-staging",   # shown in alerts; not a secret, not PII
        "banner": "",                    # optional text shown on every page (used to label fixture/demo data)
        "interval_s": 30,
        "proc_root": "/proc",           # tests / fixture mode point this at a fixture dir
        "data_dir": "/var/lib/aicc-ops",
    },
    "server": {
        "bind": "127.0.0.1",            # loopback only; non-loopback needs --unsafe-bind (never set by systemd)
        "port": 9190,
        "max_threads": 8,
        "request_timeout_s": 10,
    },
    "storage": {
        "db_file": "aicc-ops.sqlite3",
        "raw_retention_h": 48,
        "rollup5_retention_d": 35,
        "rollup1h_retention_d": 400,
        "max_db_bytes": 150 * MIB,      # hard cap (db + wal)
        "min_free_pct": 10,             # refuse to write below this free-space percentage
        "maintenance_interval_s": 300,
    },
    "collectors": {
        "host": {
            "enabled": True, "interval_s": 30, "timeout_s": 10,
            "mounts": ["/"],
            "units": ["aicc-edge", "php8.3-fpm", "mysql", "fail2ban", "aicc-backup.timer", "aicc-wp-cron.timer", "aicc-cert-expiry.timer"],
            "systemctl": "systemctl",
            "net_interface": "auto",
            "disk_device": "auto",
        },
        "caddy": {
            "enabled": True, "interval_s": 30, "timeout_s": 5,
            "url": "http://127.0.0.1:12019/metrics",  # Caddy admin API on loopback (AICC_ADMIN_ADDR default); never public
            "dynamic_handlers": ["reverse_proxy"],
        },
        "phpfpm": {
            "enabled": True, "interval_s": 30, "timeout_s": 5,
            "socket": "/run/php/aicc-cp.sock",   # pool socket from infra/php/aicc-pool.conf
            "status_path": "/fpm-status",
            "max_children": 3,           # pm.max_children of the pool (3 in infra/php/aicc-pool.conf); 0 = unknown
        },
        "mysql": {
            "enabled": True, "interval_s": 30, "timeout_s": 8,
            "client": "mysql",
            "socket": "/var/run/mysqld/mysqld.sock",
            "user": "aicc_monitor",
            "database": "",              # schema name for the size query; empty = skip size
        },
        "cp": {
            "enabled": False, "interval_s": 60, "timeout_s": 10,
            "client": "mysql",
            "socket": "/var/run/mysqld/mysqld.sock",
            "user": "aicc_monitor",
            "database": "",
            "prefix": "wp_",
            "window_minutes": 5,
        },
        "backups": {
            "enabled": True, "interval_s": 300, "timeout_s": 5,
            "dir": "/srv/aicc/backups",     # 0751 root: status.json is readable by name, the directory is not listable
            "patterns": ["aicc_cp-*.sql.gz", "aicc-files-*.tar.gz"],
            "status_file": "/srv/aicc/backups/status.json",
        },
        "unitstatus": {
            "enabled": True, "interval_s": 60, "timeout_s": 5,
            "dir": "/var/lib/aicc/status",  # unit-<name>.json files written by aicc-unit-status (OnFailure= hook)
        },
        "cert": {
            "enabled": True, "interval_s": 3600, "timeout_s": 5,
            "hostname": "stage.copilt.org",
            "host": "127.0.0.1", "port": 443,
            "cert_file": "",             # alternative: read a PEM file instead of connecting
        },
        "edge": {
            "enabled": True, "interval_s": 30, "timeout_s": 5,
            "hostname": "stage.copilt.org",
            "host": "127.0.0.1", "port": 443,
            "path": "/healthz", "expect_status": 200,
        },
        "backend_metrics": {             # OPTIONAL, API host only; needs the backend's AICC_METRICS_ENABLED (production change)
            "enabled": False, "interval_s": 30, "timeout_s": 5,
            "url": "http://127.0.0.1:9108/metrics",
            "token_file": "/etc/aicc/metrics.token",   # path only; the token itself is never in this config
        },
        "postgres": {                    # OPTIONAL, API host only; requires a production change; keep disabled
            "enabled": False, "interval_s": 60, "timeout_s": 8,
            "client": "psql", "host": "/var/run/postgresql", "user": "aicc_monitor", "database": "postgres",
        },
    },
    "capacity": {
        # PROPOSED defaults, to be validated on staging; not production-proven.
        "upgrade_ram_p95_pct": 85.0,
        "upgrade_min_available_mib": 150,
        "upgrade_min_available_episodes": 2,
        "upgrade_swap_in_pps": 50.0,
        "upgrade_swap_sustained_min": 10,
        "upgrade_swap_days": 3,
        "upgrade_cpu_p95_pct": 85.0,
        "upgrade_fpm_reached_days": 3,
        "upgrade_latency_ms": 2000.0,
        "latency_sustain_points": 6,     # consecutive 5-minute points
        "latency_min_rps": 0.1,
        "watch_ram_p95_pct": 75.0,
        "watch_cpu_p95_pct": 70.0,
        "watch_swap_in_pps": 1.0,
        "watch_latency_ms": 1500.0,
        "watch_fpm_ratio": 0.8,
        "watch_db_conn_pct": 70.0,
        "upgrade_db_conn_pct": 90.0,
        "watch_load_per_vcpu": 1.5,
        "upgrade_load_per_vcpu": 3.0,
    },
    "alerts": {
        "enabled": True,
        "flap_window_s": 1800,
        "flap_max_transitions": 4,
        # per-rule overrides live under [alerts.rules.<rule_id>] (see alerts.py for ids and defaults)
        "rules": {},
    },
    "telegram": {
        "enabled": True,                 # still disabled at runtime when secrets are absent
        "secrets_file": "/etc/aicc-ops/secrets.env",
        "min_interval_s": 2.0,
        "max_per_hour": 30,
        "retries": 3,
        "backoff_s": 2.0,
        "digest_enabled": False,         # daily digest is OFF by default
    },
}

SECRET_KEY_RE = re.compile(r"(token|secret|password|passwd|credential|chat_id|api_key|apikey)", re.I)


def _merge(base: dict, over: dict, path: str = "") -> dict:
    out = copy.deepcopy(base)
    for k, v in over.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _merge(out[k], v, f"{path}{k}.")
        else:
            out[k] = copy.deepcopy(v)
    return out


class ConfigError(ValueError):
    pass


def validate(cfg: dict) -> None:
    g, s, st = cfg["general"], cfg["server"], cfg["storage"]
    if not isinstance(g["interval_s"], (int, float)) or g["interval_s"] < 5:
        raise ConfigError("general.interval_s must be >= 5")
    if not (1 <= int(s["port"]) <= 65535):
        raise ConfigError("server.port out of range")
    if not (1 <= int(s["max_threads"]) <= 64):
        raise ConfigError("server.max_threads must be 1..64")
    if st["max_db_bytes"] < 5 * MIB:
        raise ConfigError("storage.max_db_bytes must be >= 5 MiB")
    if not (1 <= st["min_free_pct"] <= 50):
        raise ConfigError("storage.min_free_pct must be 1..50")
    if not re.match(r"^[A-Za-z0-9_$]*$", cfg["collectors"]["cp"]["prefix"]):
        raise ConfigError("collectors.cp.prefix has invalid characters")
    for sect in ("mysql", "cp"):
        db = cfg["collectors"][sect]["database"]
        if db and not re.match(r"^[A-Za-z0-9_]{1,64}$", db):
            raise ConfigError(f"collectors.{sect}.database has invalid characters")
        if not re.match(r"^[A-Za-z0-9_\-]{1,32}$", cfg["collectors"][sect]["user"]):
            raise ConfigError(f"collectors.{sect}.user has invalid characters")
    for name, c in cfg["collectors"].items():
        if c.get("interval_s", 30) < 5:
            raise ConfigError(f"collectors.{name}.interval_s must be >= 5")


def load_config(path: str | None = None, overrides: dict | None = None) -> dict:
    cfg = copy.deepcopy(DEFAULTS)
    if path:
        with open(path, "rb") as fh:
            cfg = _merge(cfg, tomllib.load(fh))
    if overrides:
        cfg = _merge(cfg, overrides)
    validate(cfg)
    return cfg


def redact(obj):
    """Return a deep copy with anything secret-looking replaced by '***' (config page + snapshots)."""
    if isinstance(obj, dict):
        return {k: ("***" if SECRET_KEY_RE.search(k) and not k.endswith("_file") and v not in ("", None, False)
                    else redact(v))
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(x) for x in obj]
    return obj
