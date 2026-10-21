#!/usr/bin/env bash
# Shared functions for the release tooling (sourced by activate-release.sh, rollback-release.sh and, on the Mac, by deploy-release.sh and the build scripts).
# Release model (owner-approved): immutable versioned releases + a `current` symlink + a `previous` symlink, swapped atomically.
#
#   /srv/aicc/<kind>/releases/<id>/            the tree (kind = site | cp); never modified after activation
#   /srv/aicc/<kind>/releases/<id>.manifest.json, <id>.SHA256SUMS, <id>.static.txt (site only: chunks this release introduced)
#   /srv/aicc/<kind>/current  -> releases/<id>   what the edge / PHP-FPM serve
#   /srv/aicc/<kind>/previous -> releases/<id>   the one rollback returns to
#
# Release id: UTC timestamp + 8 hex of the tree hash:  20261021T101500Z-1a2b3c4d  (sorts chronologically; compatible with scripts/rehearsal/edge.mjs).

RELEASE_ID_RE='^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$'

rl_ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
rl_log() { printf '%s  %s\n' "$(rl_ts)" "$*"; }
rl_die() { printf '%s  FATAL %s\n' "$(rl_ts)" "$*" >&2; exit "${2:-1}"; }

sha256_cmd() { if command -v sha256sum >/dev/null 2>&1; then echo "sha256sum"; else echo "shasum -a 256"; fi; }
sha256_of_file() { $(sha256_cmd) "$1" | awk '{print $1}'; }

# mv -T is GNU only; os.replace is rename(2) as well, so the swap is atomic on both. Both replace a symlink without following it.
mv_T() {
  if mv -T "$1" "$2" 2>/dev/null; then return 0; fi
  python3 -c 'import os,sys; os.replace(sys.argv[1], sys.argv[2])' "$1" "$2"
}

# atomic_symlink <target> <link>:  ln -sfn to a temp name in the same directory, then rename over the live link (rename(2): readers see old or new, never none)
atomic_symlink() {
  local target="$1" link="$2" tmp
  tmp="$link.tmp.$$"
  rm -f "$tmp"
  ln -sfn "$target" "$tmp"
  mv_T "$tmp" "$link"
}

# rl_warm <command>: the OPcache warm-up after a healthy cp release or rollback (architecture review M-7). NEVER fails the caller: a warm-up problem must not undo or fail a healthy release.
# 60 s hard cap (AICC_WARM_TIMEOUT overrides it, for tests) where `timeout` exists (Ubuntu), so a hung request cannot hold the release lock.
rl_warm() {
  local cmd="${1:-}"
  [ -n "$cmd" ] || return 0
  rl_log "OPcache warm-up: $cmd"
  if command -v timeout >/dev/null 2>&1; then timeout "${AICC_WARM_TIMEOUT:-60}" bash -c "$cmd" || rl_log "warm-up ended with a non-zero status or timeout (ignored: the release is live and healthy)"
  else bash -c "$cmd" || rl_log "warm-up ended with a non-zero status (ignored: the release is live and healthy)"; fi
  return 0
}

# directory lock (portable); stale pid is taken over
rl_lock() { # rl_lock <dir>
  local d="$1" pid
  if mkdir "$d" 2>/dev/null; then echo $$ > "$d/pid"; return 0; fi
  pid="$(cat "$d/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then return 1; fi
  rm -rf "$d"; mkdir "$d" 2>/dev/null && echo $$ > "$d/pid"
}
rl_unlock() { rm -rf "$1" 2>/dev/null || true; }

# release dirs of a kind, newest first
list_releases() { # list_releases <releases-dir>
  local d="$1"
  [ -d "$d" ] || return 0
  find "$d" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | sed 's#.*/##' | grep -E "$RELEASE_ID_RE" | sort -r || true
}

# link_target_id <link>: the release id a symlink points to ("" when missing)
link_target_id() {
  local l="$1" t
  [ -L "$l" ] || return 0
  t="$(readlink "$l")"; basename "$t"
}

# verify_tree <dir> <SHA256SUMS> :  every listed file matches, and NO file exists that is not listed (symlinks are listed as "SYMLINK  <path>  <target>" lines).
# SHA256SUMS format (produced by release_tool.py): "<sha256>  <relative path>" for regular files, "@symlink  <relative path>  <target>" for symlinks.
verify_tree() { # verify_tree <dir> <SHA256SUMS> [tolerated-unlisted-prefix]   (site releases tolerate carried-forward chunks under _next/static/)
  python3 -I - "$1" "$2" "${3:-}" <<'PY'
import hashlib, os, sys
root, sums, tolerate = sys.argv[1], sys.argv[2], sys.argv[3]
want_files, want_links = {}, {}
for line in open(sums, encoding="utf-8"):
    line = line.rstrip("\n")
    if not line: continue
    if line.startswith("@symlink  "):
        _, rel, target = line.split("  ", 2); want_links[rel] = target
    else:
        h, rel = line.split("  ", 1); want_files[rel] = h
seen_files, seen_links, bad = set(), set(), []
for dp, dns, fns in os.walk(root, followlinks=False):
    for n in list(dns):
        p = os.path.join(dp, n)
        if os.path.islink(p):
            rel = os.path.relpath(p, root); seen_links.add(rel)
            if want_links.get(rel) != os.readlink(p): bad.append("symlink differs: " + rel)
            dns.remove(n)
    for n in fns:
        p = os.path.join(dp, n); rel = os.path.relpath(p, root)
        if os.path.islink(p):
            seen_links.add(rel)
            if want_links.get(rel) != os.readlink(p): bad.append("symlink differs: " + rel)
            continue
        seen_files.add(rel)
        if rel not in want_files:
            if tolerate and rel.startswith(tolerate): continue
            bad.append("unexpected file: " + rel); continue
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
        if h.hexdigest() != want_files[rel]: bad.append("hash mismatch: " + rel)
for rel in want_files:
    if rel not in seen_files: bad.append("missing file: " + rel)
for rel in want_links:
    if rel not in seen_links: bad.append("missing symlink: " + rel)
if bad:
    for b in bad[:20]: print("VERIFY FAIL: " + b, file=sys.stderr)
    if len(bad) > 20: print("VERIFY FAIL: ... and %d more" % (len(bad) - 20), file=sys.stderr)
    sys.exit(1)
print("verified %d files and %d symlinks" % (len(want_files), len(want_links)))
PY
}

# list chunk files of a release's _next/static (relative to _next/static), one per line, sorted
static_chunks() { # static_chunks <release-dir>
  local base="$1/_next/static"
  [ -d "$base" ] || return 0
  ( cd "$base" && find . -type f -print | sed 's#^\./##' | sort )
}

# carry_forward <releases-dir> <new-release-dir> <new-id> <keep>
# Logic of scripts/rehearsal/edge.mjs release(): the new release = the new build + the _next/static files that the previous <keep> releases INTRODUCED
# (hashed names never collide with the new build's, so a copy cannot shadow anything). Each release records the chunks of ITS OWN build in <id>.static.txt,
# so a chunk is carried for exactly <keep> further releases and then dropped. Prints "own=N carried=M".
carry_forward() {
  local rdir="$1" ndir="$2" nid="$3" keep="$4" own carried=0 prev mf rel from to
  own="$(static_chunks "$ndir")"
  local prevs; prevs="$(list_releases "$rdir" | grep -vx "$nid" | head -n "$keep" || true)"
  for prev in $prevs; do
    mf="$rdir/$prev.static.txt"
    [ -f "$mf" ] || continue
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      case "$rel" in /*|*..*) continue ;; esac            # a manifest line may never point outside _next/static
      from="$rdir/$prev/_next/static/$rel"; to="$ndir/_next/static/$rel"
      [ -f "$to" ] && continue
      [ -f "$from" ] || continue
      mkdir -p "$(dirname "$to")"; cp -p "$from" "$to"; carried=$((carried + 1))
    done < "$mf"
  done
  printf '%s\n' "$own" | sed '/^$/d' > "$rdir/$nid.static.txt"
  echo "own=$(printf '%s\n' "$own" | sed '/^$/d' | wc -l | tr -d ' ') carried=$carried"
}

# prune_releases <releases-dir> <keep> <protected-id>...  : keep the newest <keep> release dirs plus every protected id; remove the rest and their metadata
prune_releases() {
  local rdir="$1" keep="$2"; shift 2
  local id n=0 prot
  for id in $(list_releases "$rdir"); do
    n=$((n + 1))
    [ "$n" -le "$keep" ] && continue
    prot=0; for p in "$@"; do [ -n "$p" ] && [ "$p" = "$id" ] && prot=1; done
    [ "$prot" = 1 ] && continue
    rm -rf -- "${rdir:?}/${id:?}"; rm -f -- "$rdir/$id.manifest.json" "$rdir/$id.SHA256SUMS" "$rdir/$id.static.txt"
    rl_log "pruned release $id"
  done
}

# fresh_dump_ok <backup-status.json> <max-age-seconds> <backup-dir>
# The pre-release gate for the Control Plane: the last successful backup finished < max-age ago, its status is ok, its restore check did not fail,
# and the dump file and its sha256 sidecar still exist and agree. Prints the reason on failure.
fresh_dump_ok() {
  local st="$1" max="$2" dir="$3" fin now age file sha want
  command -v jq >/dev/null 2>&1 || { echo "jq missing"; return 1; }
  [ -f "$st" ] || { echo "no backup status file ($st): run aicc-backup --label pre-release first"; return 1; }
  fin="$(jq -r '.last_success.finished_epoch // 0' "$st" 2>/dev/null)" || { echo "unreadable status.json"; return 1; }
  [[ "$fin" =~ ^[0-9]+$ ]] || { echo "status.json has no last_success"; return 1; }
  now="$(date -u +%s)"; age=$((now - fin))
  [ "$age" -ge 0 ] || { echo "backup timestamp is in the future"; return 1; }
  [ "$age" -le "$max" ] || { echo "newest successful backup is ${age}s old (limit ${max}s): run aicc-backup --label pre-release"; return 1; }
  [ "$(jq -r '.status' "$st")" = "ok" ] || echo "note: the latest run failed ($(jq -r '.reason' "$st")) but an earlier success is fresh enough" >&2
  [ "$(jq -r '.db_dump.restore_check // "ok"' "$st")" != "failed" ] || { echo "the last restore check failed"; return 1; }
  file="$(jq -r '.last_success.db_dump_file // empty' "$st")"
  [[ "$file" =~ ^[A-Za-z0-9_.-]+\.sql\.gz$ ]] || { echo "status.json names no valid dump file"; return 1; }
  [ -f "$dir/$file" ] || { echo "dump $file is missing from $dir"; return 1; }
  [ -f "$dir/$file.sha256" ] || { echo "dump $file has no .sha256 sidecar"; return 1; }
  want="$(awk '{print $1}' "$dir/$file.sha256")"; sha="$(sha256_of_file "$dir/$file")"
  [ "$want" = "$sha" ] || { echo "dump $file does not match its sha256 sidecar"; return 1; }
  gzip -t "$dir/$file" 2>/dev/null || { echo "dump $file fails gzip -t"; return 1; }
  echo "fresh dump OK: $file (${age}s old)"
  return 0
}

# release_identity <manifest>: "sha256=<16> commit=<id>" -- what exactly went live (the tarball hash and the source commit recorded at build time)
release_identity() {
  local m="$1"
  [ -f "$m" ] || { echo "sha256=? commit=?"; return 0; }
  printf 'sha256=%s commit=%s target=%s' "$(jq -r '.tarball.sha256 // "?"' "$m" | cut -c1-16)" "$(jq -r '.sources.cp_commit // .sources.site_commit // "?"' "$m" | cut -c1-12)" "$(jq -r '.sources.target // "n/a"' "$m")"
}
# record_deployment <outcome> <kind> <id> <previous-id> <manifest>: one JSON line in $AICC_DEPLOY_LOG (default /var/lib/aicc/deployments.jsonl, 0644). Never fails a release.
record_deployment() {
  local outcome="$1" kind="$2" id="$3" prev="$4" m="$5" log="${AICC_DEPLOY_LOG:-/var/lib/aicc/deployments.jsonl}" who="${SUDO_USER:-${USER:-unknown}}"
  [ "${SANDBOX:-0}" = 1 ] && log="${AICC_DEPLOY_LOG:-$ROOT/deployments.jsonl}"
  mkdir -p "$(dirname "$log")" 2>/dev/null || return 0
  jq -n -c --arg ts "$(rl_ts)" --arg o "$outcome" --arg k "$kind" --arg id "$id" --arg p "$prev" --arg who "$who" \
     --arg sha "$(jq -r '.tarball.sha256 // ""' "$m" 2>/dev/null)" --arg c "$(jq -r '.sources.cp_commit // .sources.site_commit // ""' "$m" 2>/dev/null)" \
     --arg t "$(jq -r '.sources.target // ""' "$m" 2>/dev/null)" --arg h "$(hostname | tr -cd 'A-Za-z0-9.-')" \
     '{ts:$ts,outcome:$o,kind:$k,release_id:$id,previous:$p,operator:$who,tarball_sha256:$sha,source_commit:$c,target:$t,host:$h}' >> "$log" 2>/dev/null || true
  chmod 644 "$log" 2>/dev/null || true
}
