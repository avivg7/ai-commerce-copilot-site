#!/usr/bin/env bash
# Backup / verify / restore of the edge's Caddy storage (the ACME account key, issued certificates and keys, the local CA if any).
#
#   scripts/ops/caddy-storage-backup.sh backup  <storage-dir> <backup-dir> [--keep N] [--passphrase-file FILE]
#   scripts/ops/caddy-storage-backup.sh verify  <archive> [--passphrase-file FILE]
#   scripts/ops/caddy-storage-backup.sh restore <archive> <storage-dir> [--passphrase-file FILE] [--force]
#
# <storage-dir> is the directory Caddy uses for its data: $XDG_DATA_HOME/caddy (the systemd unit sets XDG_DATA_HOME=/var/lib/aicc-edge, so /var/lib/aicc-edge/caddy), or the
# `storage file_system <dir>` of the rehearsal. It holds PRIVATE KEYS: the archive is written 0600 into a 0700 directory, optionally encrypted with
# `openssl enc -aes-256-cbc -pbkdf2` (give --passphrase-file; keep that file elsewhere). Store backups OFF the edge host.
# Why: losing the storage loses the ACME account and every certificate; Caddy re-issues on the next start, which needs working public DNS and counts against CA rate limits (and
# an Option A host loses the only copy of its pre-issued key). Restore refuses to run while a Caddy process runs (unless --force) and restores owner-only permissions; start the
# edge afterwards (the preflight checks the files). Exit codes: 0 ok, 1 failure, 2 usage.
set -eu
umask 077
cmd="${1:-}"; shift || true
PASSFILE=""; KEEP=14; FORCE=0
args=(); while [ $# -gt 0 ]; do case "$1" in --passphrase-file) PASSFILE="$2"; shift 2 ;; --keep) KEEP="$2"; shift 2 ;; --force) FORCE=1; shift ;; *) args+=("$1"); shift ;; esac; done
enc_cmd() { if [ -n "$PASSFILE" ]; then openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASSFILE" "$@"; else cat; fi; }
case "$cmd" in
	backup)
		src="${args[0]:-}"; dst="${args[1]:-}"
		[ -d "$src" ] && [ -n "$dst" ] || { echo "usage: $0 backup <storage-dir> <backup-dir> [--keep N] [--passphrase-file F]" >&2; exit 2; }
		mkdir -p "$dst"; chmod 700 "$dst"
		suffix=""; if [ -n "$PASSFILE" ]; then suffix=".enc"; fi
		name="caddy-storage-$(date -u +%Y%m%dT%H%M%SZ).tar.gz$suffix"
		( cd "$(dirname "$src")" && tar -czpf - "$(basename "$src")" ) | enc_cmd -e > "$dst/$name"
		chmod 600 "$dst/$name"
		# the archive must list and contain certificates or keys, or the backup is worthless
		n="$("$0" verify "$dst/$name" ${PASSFILE:+--passphrase-file "$PASSFILE"} | tail -1)"
		echo "backup written: $dst/$name ($n)"
		ls -1t "$dst"/caddy-storage-*.tar.gz* 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old"; echo "pruned $old"; done
		;;
	verify)
		arc="${args[0]:-}"; [ -r "$arc" ] || { echo "usage: $0 verify <archive>" >&2; exit 2; }
		lst="$(enc_cmd -d < "$arc" | tar -tzf - 2>/dev/null)" || { echo "archive unreadable or wrong passphrase" >&2; exit 1; }
		echo "$lst" | grep -Eq '\.crt$|\.key$|acme/' || { echo "archive contains no certificate, key or ACME account" >&2; exit 1; }
		echo "$(echo "$lst" | grep -c '\.crt$') certificate file(s), $(echo "$lst" | grep -c '\.key$') key file(s), acme/ present: $(echo "$lst" | grep -c 'acme/')"
		;;
	restore)
		arc="${args[0]:-}"; dst="${args[1]:-}"
		[ -r "$arc" ] && [ -n "$dst" ] || { echo "usage: $0 restore <archive> <storage-dir> [--force]" >&2; exit 2; }
		if [ "$FORCE" != 1 ] && pgrep -x caddy >/dev/null 2>&1; then echo "a caddy process is running: stop the edge first (or --force)" >&2; exit 1; fi
		"$0" verify "$arc" ${PASSFILE:+--passphrase-file "$PASSFILE"} >/dev/null
		tmp="$(mktemp -d "$(dirname "$dst")/.restore.XXXXXX")"; trap 'rm -rf "$tmp"' EXIT
		enc_cmd -d < "$arc" | tar -xzpf - -C "$tmp"
		top="$(ls -1 "$tmp" | head -1)"
		[ -d "$dst" ] && mv "$dst" "$dst.before-restore.$(date -u +%Y%m%dT%H%M%SZ)"
		mv "$tmp/$top" "$dst"; chmod -R go-rwx "$dst"; chmod 700 "$dst"
		echo "restored into $dst (previous contents kept next to it as *.before-restore.*); owner-only permissions applied. Start the edge; run cert-expiry-check.sh afterwards."
		;;
	*) sed -n 2,12p "$0"; exit 2 ;;
esac
