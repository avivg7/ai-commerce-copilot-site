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
fresh; sed -i.bak 's/^MemoryMax=450M/MemoryMaxx=450M/' "$TMP/w/infra/systemd/aicc-edge.service"; neg "a misspelled systemd key is caught" 'unknown/misplaced key MemoryMaxx'
fresh; sed -i.bak 's#^IPAddressDeny=.*#IPAddressDeny=169.254.0.0/16#' "$TMP/w/infra/systemd/overrides/php8.3-fpm.service.d/aicc.conf"; neg "an FPM drop-in that no longer denies the loopback is caught (review M1)" 'IPAddressDeny must cover'
fresh; sed -i.bak 's#^IPAddressAllow=.*#IPAddressAllow=127.0.0.1/32#' "$TMP/w/infra/systemd/aicc-wp-cron.service"; neg "allowing 127.0.0.1 for the cron user is caught" 'IPAddressAllow must be exactly the resolver stub'
fresh; sed -i.bak 's#TURNSTILE_HOST = "challenges.cloudflare.com"#TURNSTILE_HOST = "challenges.cloudflare.net"#' "$TMP/w/infra/provision/lib/owner_facts.py"; neg "a wrong Turnstile verification host in the owner-facts renderer is caught (P32)" 'Turnstile verification host must be exactly'
fresh; sed -i.bak 's#facts.get("AICC_TURNSTILE_ENABLED") == "true"#True#' "$TMP/w/infra/provision/lib/owner_facts.py"; neg "adding the Turnstile host without the explicit owner fact is caught (P32)" 'only by the explicit AICC_TURNSTILE_ENABLED=true'
fresh; sed -i.bak "s#'stage.copilt.org'#'stage.copilt.org,localhost,127.0.0.1'#" "$TMP/w/infra/provision/wp-config.stage.template.php"; neg "localhost / 127.0.0.1 back in WP_ACCESSIBLE_HOSTS is caught" 'WP_ACCESSIBLE_HOSTS must not contain localhost'
fresh; sed -i.bak 's#^ProtectSystem=strict#ProtectSystem=full#' "$TMP/w/infra/systemd/overrides/php8.3-fpm.service.d/20-aicc-sandbox.conf"; neg "a weakened FPM sandbox is caught" 'ProtectSystem=strict and NoNewPrivileges=yes required'
fresh; printf 'MemoryDenyWriteExecute=yes\n' >> "$TMP/w/infra/systemd/overrides/php8.3-fpm.service.d/20-aicc-sandbox.conf"; neg "MemoryDenyWriteExecute (breaks PCRE JIT) is caught" 'deliberately absent'
fresh; sed -i.bak 's/--confirm-production/--confirm-prod/g' "$TMP/w/infra/provision/render-wp-config.sh"; neg "render-wp-config.sh losing its production confirmation gate is caught" 'production gate lost'
fresh; sed -i.bak "s#define( 'WP_ACCESSIBLE_HOSTS', 'api.copilt.org' )#define( 'WP_ACCESSIBLE_HOSTS', 'api.copilt.org,stage.copilt.org' )#" "$TMP/w/infra/provision/wp-config.production.template.php"; neg "a production template whose allow-list is no longer exactly the API host is caught" 'WP_ACCESSIBLE_HOSTS exactly the API host'
fresh; printf '\n# uses wp-config.production.template.php\n' >> "$TMP/w/infra/provision/install-stack.sh"; neg "a script that starts using the production template is caught" 'references the production wp-config template'
fresh; sed -i.bak 's/never shipped in a release/shipped in a release/' "$TMP/w/infra/release/deploy-release.sh"; neg "deploy-release.sh losing its refusal of a wp-config template is caught" 'must refuse an artifact that carries a wp-config template'
fresh; sed -i.bak 's/^MemoryHigh=320M/MemoryHigh=200M/' "$TMP/w/infra/systemd/aicc-edge.service"; neg "Caddy MemoryHigh below its measured footprint is caught (review M-1)" 'MemoryHigh is below Caddy'
fresh; sed -i.bak 's/GOMEMLIMIT=256MiB/GOMEMLIMIT=400MiB/' "$TMP/w/infra/systemd/aicc-edge.service"; neg "GOMEMLIMIT above MemoryHigh is caught" 'GOMEMLIMIT must stay below MemoryHigh'
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
fresh; python3 - "$TMP/w/infra/provision/wp-config.production.template.php" <<'PYEOF'
import sys
p = sys.argv[1]; t = open(p).read(); t = t.replace("// @@OWNER_FACTS_BEGIN@@\n", "").replace("// @@OWNER_FACTS_END@@\n", ""); open(p, "w").write(t)
PYEOF
neg "a production template that loses its owner-facts region markers is caught" 'exactly one owner-facts region'
fresh; sed -i.bak "s#^define( 'AICC_ENTITLEMENT_WEBHOOK_SECRET'#define( 'AICC_LEGAL_ENTITY_NAME', 'Hard Coded Ltd' );\ndefine( 'AICC_ENTITLEMENT_WEBHOOK_SECRET'#" "$TMP/w/infra/provision/wp-config.production.template.php"; neg "an owner fact defined in the template (it would hide an unset value) is caught" 'must not be defined in the template'
fresh; sed -i.bak 's/--owner-facts-file/--owner-facts/g' "$TMP/w/infra/provision/render-wp-config.sh"; neg "the renderer losing its owner-facts test seam / gate is caught" 'owner-facts gate lost'
fresh; echo 'echo x > "$OWNERF"' >> "$TMP/w/infra/provision/render-wp-config.sh"; neg "a renderer that writes the owner-facts file is caught" 'must never write the owner-facts file'
fresh; echo 'import subprocess' >> "$TMP/w/infra/provision/lib/owner_facts.py"; neg "an owner-facts validator that imports subprocess is caught" 'pure string handling'
fresh; sed -i.bak 's/aicc-owner-facts/aicc-owner-x/' "$TMP/w/infra/provision/install-stack.sh"; neg "an installer that no longer installs the owner-facts tool is caught" 'must install the owner-facts tool'
t_summary
