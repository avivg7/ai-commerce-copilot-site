#!/usr/bin/env bash
# AICC Ops installer. Idempotent, fails closed, never touches secrets, never enables/starts anything unless asked.
#
#   sudo ./install.sh                 install/upgrade files, create user + dirs, install (not enable) the units
#   sudo ./install.sh --enable        also `systemctl enable --now aicc-ops.service`
#   ./install.sh --dry-run            print what would be done, change nothing
#   DESTDIR=/tmp/stage ./install.sh   stage the file tree under DESTDIR (no useradd/chown/systemctl; for local testing)
#
# Requires: Linux, Python >= 3.11 (Ubuntu 24.04 ships 3.12). Standard library only, nothing is downloaded.
set -euo pipefail
umask 022

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESTDIR="${DESTDIR:-}"
OPT="${DESTDIR}/opt/aicc-ops"
ETC="${DESTDIR}/etc/aicc-ops"
VAR="${DESTDIR}/var/lib/aicc-ops"
UNITDIR="${DESTDIR}/etc/systemd/system"
LOGROTATE="${DESTDIR}/etc/logrotate.d"
LOGDIR="${DESTDIR}/var/log/aicc-ops"
SBIN="${DESTDIR}/usr/local/sbin"
SVC_USER="aicc-ops"
DRY=0
ENABLE=0

for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --enable) ENABLE=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "install.sh: unknown argument: $a" >&2; exit 2 ;;
  esac
done

die() { echo "install.sh: ERROR: $*" >&2; exit 1; }
run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

# ---- fail-closed preflight ---------------------------------------------------------------------------------
[ "$(uname -s)" = "Linux" ] || { [ -n "$DESTDIR" ] || die "Linux only (set DESTDIR to stage the file tree on another OS)"; }
if [ -z "$DESTDIR" ] && [ "$DRY" = 0 ] && [ "$(id -u)" -ne 0 ]; then die "must run as root (or use --dry-run / DESTDIR)"; fi
for f in aicc_ops/__init__.py aicc_ops/cli.py aicc_ops/telegram_ops.py bin/aicc-ops bin/aicc-ops-secrets config/aicc-ops.example.toml systemd/aicc-ops.service \
         systemd/aicc-ops-digest.service systemd/aicc-ops-digest.timer systemd/aicc-ops.logrotate sql/monitoring-user.sql; do
  [ -f "$SRC/$f" ] || die "incomplete source tree: missing $f"
done
PY="$(command -v python3 || true)"
[ -n "$PY" ] || die "python3 not found"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' || die "Python >= 3.11 required (tomllib); found $("$PY" -V 2>&1)"
"$PY" -c 'import sqlite3, ssl, tomllib, http.server' || die "required stdlib modules missing"
"$PY" -m py_compile "$SRC"/aicc_ops/*.py "$SRC"/aicc_ops/collectors/*.py || die "source does not compile"
case "$(command -v mysql || true)" in "") echo "install.sh: note: 'mysql' client not found; the MySQL collector will report a failure until it is installed" >&2 ;; esac

# ---- user and directories ----------------------------------------------------------------------------------
if [ -z "$DESTDIR" ]; then
  if ! id -u "$SVC_USER" >/dev/null 2>&1; then
    run useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$SVC_USER"
  fi
fi
run install -d -m 0755 "$OPT" "$OPT/bin" "$OPT/aicc_ops" "$OPT/aicc_ops/collectors" "$OPT/config" "$OPT/sql" "$OPT/systemd"
run install -d -m 0750 "$ETC"
run install -d -m 0750 "$VAR"
run install -d -m 0750 "$LOGDIR"
if [ -z "$DESTDIR" ]; then
  run chown root:"$SVC_USER" "$ETC"
  run chown "$SVC_USER":"$SVC_USER" "$VAR" "$LOGDIR"
fi

# ---- files (code is root-owned and not writable by the service user) -------------------------------------------
for f in "$SRC"/aicc_ops/*.py; do run install -m 0644 "$f" "$OPT/aicc_ops/$(basename "$f")"; done
for f in "$SRC"/aicc_ops/collectors/*.py; do run install -m 0644 "$f" "$OPT/aicc_ops/collectors/$(basename "$f")"; done
run install -m 0755 "$SRC/bin/aicc-ops" "$OPT/bin/aicc-ops"
run install -m 0755 "$SRC/measure-overhead.sh" "$OPT/bin/measure-overhead.sh"
# operator helper for the Telegram credentials (root only; reads the token from the terminal, never from argv/env)
run install -d -m 0755 "$SBIN"
run install -m 0750 "$SRC/bin/aicc-ops-secrets" "$SBIN/aicc-ops-secrets"
[ -n "$DESTDIR" ] || run chown root:root "$SBIN/aicc-ops-secrets"
run install -m 0644 "$SRC/config/aicc-ops.example.toml" "$OPT/config/aicc-ops.example.toml"
run install -m 0644 "$SRC/sql/monitoring-user.sql" "$OPT/sql/monitoring-user.sql"
run install -m 0644 "$SRC/systemd/php-fpm-status.conf.snippet" "$OPT/systemd/php-fpm-status.conf.snippet"
run install -m 0644 "$SRC/README.md" "$OPT/README.md"

# config: create only if absent; never overwrite an operator-edited file
if [ -e "$ETC/aicc-ops.toml" ]; then
  echo "install.sh: keeping existing $ETC/aicc-ops.toml"
else
  run install -m 0640 "$SRC/config/aicc-ops.example.toml" "$ETC/aicc-ops.toml"
  [ -n "$DESTDIR" ] || run chown root:"$SVC_USER" "$ETC/aicc-ops.toml"
fi

# secrets: NEVER created or modified here. Only report on an existing file.
if [ -e "$ETC/secrets.env" ]; then
  mode="$(stat -c '%a' "$ETC/secrets.env" 2>/dev/null || echo '?')"
  case "$mode" in 600|640) echo "install.sh: $ETC/secrets.env present (mode $mode): left untouched" ;;
                  *) echo "install.sh: WARNING $ETC/secrets.env has mode $mode; AICC Ops will refuse it unless it is 0600 or 0640 (not touched)" >&2 ;; esac
else
  echo "install.sh: no $ETC/secrets.env: Telegram stays disabled (alerts are recorded locally). Create it with: sudo aicc-ops-secrets set-telegram (README: Telegram credentials: operator procedure)."
fi

# systemd + logrotate (installed, NOT enabled; the digest timer is never enabled by this script)
run install -d -m 0755 "$UNITDIR"
run install -m 0644 "$SRC/systemd/aicc-ops.service" "$UNITDIR/aicc-ops.service"
run install -m 0644 "$SRC/systemd/aicc-ops-digest.service" "$UNITDIR/aicc-ops-digest.service"
run install -m 0644 "$SRC/systemd/aicc-ops-digest.timer" "$UNITDIR/aicc-ops-digest.timer"
run install -d -m 0755 "$LOGROTATE"
run install -m 0644 "$SRC/systemd/aicc-ops.logrotate" "$LOGROTATE/aicc-ops"

if [ -z "$DESTDIR" ]; then
  command -v systemctl >/dev/null 2>&1 && run systemctl daemon-reload || true
  if [ "$DRY" = 0 ]; then
    runuser -u "$SVC_USER" -- "$PY" "$OPT/bin/aicc-ops" --config "$ETC/aicc-ops.toml" check-config >/dev/null \
      || die "configuration check failed (nothing was enabled)"
  fi
  if [ "$ENABLE" = 1 ]; then run systemctl enable --now aicc-ops.service; fi
fi

cat <<MSG

AICC Ops files installed under ${OPT}.
Next (owner): 1) review ${ETC}/aicc-ops.toml  2) sudo mysql < ${OPT}/sql/monitoring-user.sql
              3) apply the PHP-FPM snippet  4) (optional) sudo aicc-ops-secrets set-telegram  5) systemctl enable --now aicc-ops
The UI listens on 127.0.0.1:9190 only; reach it with: ssh -L 9190:127.0.0.1:9190 <host>
MSG
