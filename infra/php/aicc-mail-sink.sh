#!/usr/bin/env bash
# sendmail replacement for the STAGING host: PHP mail() pipes the message to this program; we write it to a file and send NOTHING.
# Installed as /usr/local/sbin/aicc-mail-sink (mode 0755) and referenced by sendmail_path in the pool and CLI ini.
# Runs as the PHP user (aicc-cp). Files: /var/lib/aicc-cp/mail/<utc-timestamp>-<random>.eml, mode 0600. At most 200 files are kept.
# Why a file: staging must never email real customers by accident; the operator can read the files to verify password-reset flows.
set -euo pipefail
umask 077
dir="${AICC_MAIL_SINK_DIR:-/var/lib/aicc-cp/mail}"
mkdir -p "$dir"
name="$(date -u +%Y%m%dT%H%M%S)-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n').eml"
cat > "$dir/$name"
# retention: newest 200 only (ls -t is fine for a flat directory of our own files)
# shellcheck disable=SC2012
ls -1t "$dir"/*.eml 2>/dev/null | tail -n +201 | while IFS= read -r old; do rm -f -- "$old"; done
exit 0
