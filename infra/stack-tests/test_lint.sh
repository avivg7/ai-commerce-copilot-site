#!/usr/bin/env bash
# Negative tests of infra/stack-tests/lint.py: every deliberately broken copy of the infra tree MUST make the linter fail.
# Run: bash infra/stack-tests/test_lint.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
T_SUITE="lint"; . "$HERE/lib/t.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fresh() { rm -rf "$TMP/w"; mkdir -p "$TMP/w/scripts"; for d in provision systemd backup release php mysql fail2ban logrotate stack-tests; do mkdir -p "$TMP/w/infra"; cp -R "$REPO/infra/$d" "$TMP/w/infra/$d"; done; cp -R "$REPO/scripts/ops" "$TMP/w/scripts/ops"; }
LINT() { AICC_LINT_INFRA="$TMP/w/infra" python3 "$REPO/infra/stack-tests/lint.py"; }
neg() { local out; out="$(LINT 2>&1)"; local rc=$?; if [ "$rc" != 0 ] && printf '%s' "$out" | grep -qF -- "$2"; then t_pass "$1"; else t_bad "$1" "rc=$rc, expected message '$2' in: $(printf '%s' "$out" | grep 'LINT FAIL' | head -3 | tr '\n' '|')"; fi; }
fresh; t_ok "the unmodified copy passes" LINT
fresh; sed -i.bak 's/^MemoryMax=320M/MemoryMaxx=320M/' "$TMP/w/infra/systemd/aicc-edge.service"; neg "a misspelled systemd key is caught" 'unknown/misplaced key MemoryMaxx'
fresh; sed -i.bak 's#^ReadWritePaths=/srv/aicc/backups /var/lib/aicc/status#ReadWritePaths=/srv/aicc/backups /var/lib/aicc/nonexistent#' "$TMP/w/infra/systemd/aicc-backup.service"; neg "a ReadWritePaths directory the installer never creates is caught" 'installer does not create this directory'
fresh; sed -i.bak 's#^ExecStart=/usr/local/sbin/aicc-backup .*#ExecStart=/usr/local/sbin/aicc-backup-typo --label scheduled#' "$TMP/w/infra/systemd/aicc-backup.service"; neg "an ExecStart path that is not installed is caught" 'aicc-backup-typo'
fresh; sed -i.bak 's/^OnFailure=aicc-notify-failure@%n.service/OnFailure=nonexistent@%n.service/' "$TMP/w/infra/systemd/aicc-wp-cron.service"; neg "an OnFailure= template that does not exist is caught" 'template unit nonexistent@.service not found'
fresh; sed -i.bak 's/^After=network-online.target php8.3-fpm.service mysql.service/After=network-online.target/' "$TMP/w/infra/systemd/aicc-edge.service"; neg "losing the php-fpm ordering of aicc-edge is caught" 'must be After=php8.3-fpm.service'
fresh; sed -i.bak 's/^set -euo pipefail$/set -u/' "$TMP/w/infra/backup/aicc-backup.sh"; neg "a script without set -euo pipefail is caught" 'aicc-backup.sh: missing `set -euo pipefail`'
fresh; sed -i.bak 's/139\.59\.157\.231/0.0.0.0/g' "$TMP/w/infra/release/deploy-release.sh"; neg "a deploy script without the production IP deny list is caught" 'deploy-release.sh: production API IP'
fresh; echo 'DB_PASS="password: hunter2hunter2"' >> "$TMP/w/infra/provision/create-staging-db.sh"; sed -i.bak 's/password: hunter2hunter2/password = "hunter2hunter2"/' "$TMP/w/infra/provision/create-staging-db.sh"; neg "a literal password is caught" 'password with a value'
fresh; printf '%s\n' "# $(printf 'a%.0s' $(seq 1 3))$(openssl rand -hex 24)" >> "$TMP/w/infra/provision/install-stack.sh"; neg "an unexpected long hex string is caught" 'unexpected long hex string'
fresh; echo '# server 203.0.113.9 and 8.8.4.4' >> "$TMP/w/infra/provision/install-stack.sh"; neg "a public IPv4 literal is caught" 'public-looking IPv4 literal: 8.8.4.4'
fresh; sed -i.bak 's/^pm.max_children = 3/pm.max_children = 12/' "$TMP/w/infra/php/aicc-pool.conf"; neg "a pool that breaks the memory budget is caught" 'budget: PHP-FPM worst case exceeds'
fresh; sed -i.bak 's/dry-run/dryrun/g' "$TMP/w/infra/backup/pull-offhost.sh"; neg "a script without --dry-run is caught" 'pull-offhost.sh: no --dry-run option'
fresh; sed -i.bak 's/must run as root/must be someone/; s/id -u/id -g/g' "$TMP/w/infra/provision/harden-stage2.sh"; neg "a root-only script without the non-root refusal is caught" 'harden-stage2.sh: no non-root refusal'
t_summary
