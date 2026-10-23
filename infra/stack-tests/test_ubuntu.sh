#!/usr/bin/env bash
# OPTIONAL Docker-based test on a real Ubuntu 24.04 userland: runs infra/stack-tests/ubuntu-inner.sh in a throwaway container.
# Skipped (exit 0, "skipped") when the Docker daemon is not running. Needs network access to the Ubuntu archive for the first image build only (apt: php8.3, mysql-server-8.0,
# fail2ban, systemd, openssh-server; nothing from GitHub or any third-party repository); the image is cached as aicc-stack-test:base.
# What it proves and what it cannot: see the header of ubuntu-inner.sh. Owner fixtures/ports are untouched (the container publishes no ports and mounts the repo read-only).
# The container gets CAP_SYS_PTRACE only because a real host root has it (the two-session scripts read /proc/<pid>/environ and `ss -p` of other users' processes).
# Run: bash infra/stack-tests/test_ubuntu.sh [--rebuild-image]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
IMG="aicc-stack-test:base"; NAME="aicc-stack-test-run"
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then echo "ubuntu: skipped (Docker daemon not running)"; exit 0; fi
[ "${1:-}" = "--rebuild-image" ] && docker rmi -f "$IMG" >/dev/null 2>&1
WP_PHAR="${AICC_WPCLI_PHAR:-/opt/homebrew/Cellar/wp-cli/2.12.0/bin/wp}"
[ -f "$WP_PHAR" ] || { echo "ubuntu: skipped (set AICC_WPCLI_PHAR to the pinned wp-cli 2.12.0 phar)"; exit 0; }
[ "$(shasum -a 256 "$WP_PHAR" | cut -d' ' -f1)" = "ce34ddd838f7351d6759068d09793f26755463b4a4610a5a5c0a97b68220d85c" ] || { echo "ubuntu: REFUSED: $WP_PHAR is not the pinned wp-cli phar"; exit 1; }
TMP="$(mktemp -d)"; trap 'docker rm -f "$NAME" >/dev/null 2>&1; rm -rf "$TMP"' EXIT
if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "building $IMG (one-off, several minutes: apt install of php8.3, mysql-server-8.0, fail2ban, systemd, openssh-server) ..."
  docker rm -f "$NAME-base" >/dev/null 2>&1
  docker run -d --init --name "$NAME-base" ubuntu:24.04 sleep infinity >/dev/null || exit 1
  docker exec "$NAME-base" bash -c 'export DEBIAN_FRONTEND=noninteractive; printf "#!/bin/sh\nexit 101\n" > /usr/sbin/policy-rc.d; chmod +x /usr/sbin/policy-rc.d; apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends ca-certificates curl jq sudo acl rsync logrotate python3 openssl procps less php8.3-fpm php8.3-cli php8.3-common php8.3-curl php8.3-mbstring php8.3-xml php8.3-zip php8.3-gd php8.3-intl php8.3-mysql php8.3-opcache libfcgi-bin mysql-server-8.0 mysql-client-8.0 fail2ban systemd openssh-server iproute2 >/tmp/apt.log 2>&1' || { echo "apt failed"; docker rm -f "$NAME-base" >/dev/null; exit 1; }
  docker commit "$NAME-base" "$IMG" >/dev/null; docker rm -f "$NAME-base" >/dev/null
fi
echo "building the Control Plane release for the container ..."
bash "$REPO/infra/release/build-cp-release.sh" --cp-worktree "${AICC_TEST_CP_WORKTREE:-/Users/avivgerman/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/launch-integration}" --out-dir "$TMP/art" >/dev/null 2>&1 || { echo "ubuntu: CP build failed (are the pinned sources cached in ~/.cache/aicc-release?)"; exit 1; }
docker run -d --init --cap-add SYS_PTRACE --name "$NAME" --hostname aicc-cp-stage -v "$REPO/infra":/bundle/infra:ro -v "$REPO/scripts/ops":/bundle/scripts/ops:ro "$IMG" sleep infinity >/dev/null || exit 1
docker cp "$TMP/art" "$NAME:/art" >/dev/null && docker cp "$WP_PHAR" "$NAME:/opt/wp-cli.phar" >/dev/null
LOG="$HOME/aicc-rehearsal/logs/aicc-edge.log"
# the sample = the oldest lines (old header-map shape) + the newest lines (header allow-list shape)
if [ -f "$LOG" ]; then { head -3000 "$LOG"; tail -2000 "$LOG"; } | grep '^{"level"' > "$TMP/f2b-sample.log"; docker cp "$TMP/f2b-sample.log" "$NAME:/tmp/f2b-sample.log" >/dev/null; fi
if command -v node >/dev/null 2>&1 && [ -f "$REPO/scripts/ops/render-edge.mjs" ]; then node "$REPO/scripts/ops/render-edge.mjs" --mode stage --out "$TMP/Caddyfile.stage" >/dev/null 2>&1 && docker cp "$TMP/Caddyfile.stage" "$NAME:/tmp/Caddyfile.stage" >/dev/null; fi
docker exec "$NAME" bash /bundle/infra/stack-tests/ubuntu-inner.sh
