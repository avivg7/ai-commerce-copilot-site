#!/usr/bin/env python3
"""Release helper for the AICC release tooling (stdlib only, Python 3.9+). Runs on the Mac (build/deploy) and on the host (none of it is needed there).

Sub-commands (all print a one-line result; non-zero exit = refusal):
  assemble-cp   build the Control Plane tree: WordPress core + WooCommerce (pinned, hash-checked) + AICC theme/plugin from a git worktree
  pack          deterministic tarball + SHA256SUMS + manifest.json from a tree
  unpack        safe extraction of such a tarball (no absolute paths, no .., no devices)
  scan          secrets / fixture / forbidden-file scan of a tree
  site-stage    turn a static-site export into a STAGING tree (noindex, robots disallow, identity file, no sitemap)
  site-check    assert the stage / production invariants of a site tree

Reproducibility: entries are sorted, uid/gid 0, mtime = SOURCE_DATE_EPOCH, modes normalised (dirs 0755, files 0644 or 0755 when executable), gzip mtime 0.
Two builds from the same inputs give the same tarball bytes (tested).
"""
import argparse, gzip, hashlib, io, json, os, re, shutil, stat, subprocess, sys, tarfile, time, zipfile

# ---------------------------------------------------------------------------------------------------------------------------------------------------
# constants
WP_PRUNE = [  # removed from the WordPress core tree: unused code, version disclosure, default content
    "readme.html", "license.txt", "wp-config-sample.php",
    "wp-content/plugins/akismet", "wp-content/plugins/hello.php",
    "wp-content/themes/twentytwentyfour", "wp-content/themes/twentytwentythree",
]
# Excluded from OUR components (theme/plugin) and from WooCommerce's vendor tree: tests, VCS, editor/OS junk, env/secret/data files.
EXCLUDE_NAMES = {".git", ".gitignore", ".gitattributes", ".github", ".gitlab-ci.yml", ".DS_Store", "node_modules", "tests", "Tests", "test", "__tests__", "phpunit.xml",
                 "phpunit.xml.dist", ".phpunit.result.cache", "fixtures", ".idea", ".vscode", "composer.lock.bak", "Thumbs.db"}
EXCLUDE_GLOBS = [r".*\.log$", r".*\.sql$", r".*\.sqlite3?$", r".*\.orig$", r".*\.rej$", r".*\.bak$", r".*\.swp$", r"^\.env(\..*)?$", r".*\.phpt$"]
FORBIDDEN_NAME_RES = [r"^\.env(\..*)?$", r".*\.sql$", r".*\.sqlite3?$", r"^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$", r".*\.(pem|key|p12|pfx)$", r"^\.htpasswd$", r"^wp-config\.php$",
                      r".*\.log$", r".*\.bak$", r"^\.DS_Store$"]
FORBIDDEN_DIRS = {".git", ".svn", "node_modules", "fixtures", "test-store", "tests-e2e", ".idea", ".vscode"}
# third-party files that legitimately look forbidden (checked by exact relative path or suffix); everything else must be clean
ALLOWED_NAME_PATHS = ("wp-includes/certificates/ca-bundle.crt",)
SECRET_PATTERNS = [
    ("private key", re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----")),
    ("AWS access key", re.compile(rb"AKIA[0-9A-Z]{16}")),
    ("Slack token", re.compile(rb"xox[baprs]-[0-9A-Za-z-]{10,}")),
    ("GitHub token", re.compile(rb"gh[pousr]_[A-Za-z0-9]{30,}")),
    ("Stripe live key", re.compile(rb"sk_live_[0-9A-Za-z]{16,}")),
    ("non-empty DB_PASSWORD", re.compile(rb"define\(\s*['\"]DB_PASSWORD['\"]\s*,\s*['\"][^'\"]+['\"]")),
    ("WordPress key/salt with a value", re.compile(rb"define\(\s*['\"](?:AUTH|SECURE_AUTH|LOGGED_IN|NONCE)_(?:KEY|SALT)['\"]\s*,\s*['\"][^'\"]{20,}['\"]")),
    ("activation/webhook secret with a value", re.compile(rb"define\(\s*['\"]AICC_(?:ACTIVATION_PROOF|ENTITLEMENT_WEBHOOK)_SECRET['\"]\s*,\s*['\"][^'\"]{8,}['\"]")),
]
FIXTURE_PATTERNS = [  # QA / rehearsal data must never ride along
    ("rehearsal fixture marker", re.compile(rb"AICC_REHEARSAL|aicc_rehearsal|Rehearsal-(?:Admin|Customer)-2026|rehearsal-(?:admin|customer)")),
    ("QA harness path", re.compile(rb"/Users/[A-Za-z0-9._-]+/|qa-acceptance|Local Sites/|\.local/share|/private/tmp/")),
]
TEXT_EXT = {".php", ".js", ".css", ".json", ".txt", ".md", ".html", ".htm", ".xml", ".yml", ".yaml", ".ini", ".cnf", ".sh", ".po", ".pot", ".svg", ".env", ".conf", ".inc", ""}


def die(msg, code=1):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(code)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def walk_sorted(root):
    """Yield (relpath, abspath, kind) for dirs, files, symlinks under root in a stable order (kind: d f l)."""
    out = []
    for dp, dns, fns in os.walk(root, followlinks=False):
        dns.sort()
        for n in sorted(dns):
            p = os.path.join(dp, n)
            out.append((os.path.relpath(p, root), p, "l" if os.path.islink(p) else "d"))
        for n in sorted(fns):
            p = os.path.join(dp, n)
            out.append((os.path.relpath(p, root), p, "l" if os.path.islink(p) else "f"))
    out.sort(key=lambda t: t[0].encode("utf-8", "surrogateescape"))
    return out


def sums_lines(root):
    lines = []
    for rel, p, kind in walk_sorted(root):
        if kind == "f":
            lines.append("%s  %s" % (sha256_file(p), rel))
        elif kind == "l":
            lines.append("@symlink  %s  %s" % (rel, os.readlink(p)))
    return lines


def tree_hash(lines):
    return hashlib.sha256(("\n".join(sorted(lines)) + "\n").encode("utf-8", "surrogateescape")).hexdigest()


def release_id(epoch, thash):
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(epoch)) + "-" + thash[:8]


def safe_extractall(t, dest):
    """extractall with the 'tar' filter where the interpreter has it (3.12+, backports): refuses absolute member paths and strips special mode bits."""
    try:
        t.extractall(dest, filter="tar")
    except TypeError:
        t.extractall(dest)


def safe_member_path(name):
    if name.startswith("/") or ".." in name.split("/") or "\\" in name:
        die("unsafe path in archive: %r" % name)


def is_excluded(name):
    return name in EXCLUDE_NAMES or any(re.match(g, name) for g in EXCLUDE_GLOBS)


def prune_excluded(root):
    removed = 0
    for dp, dns, fns in os.walk(root, topdown=True, followlinks=False):
        for n in list(dns):
            if is_excluded(n):
                shutil.rmtree(os.path.join(dp, n)); dns.remove(n); removed += 1
        for n in fns:
            if is_excluded(n):
                os.remove(os.path.join(dp, n)); removed += 1
    return removed


# ---------------------------------------------------------------------------------------------------------------------------------------------------
def cmd_assemble_cp(a):
    wp_tar, wc_zip, repo, out = a.wp_tar, a.wc_zip, a.cp_repo, a.out_tree
    pins = [("WordPress tarball", wp_tar, a.wp_sha256), ("WooCommerce zip", wc_zip, a.wc_sha256), ("Storefront zip", a.sf_zip, a.sf_sha256)]
    if bool(a.pp_zip) != bool(a.pp_sha256) or bool(a.pp_zip) != bool(a.pp_version):
        die("--pp-zip, --pp-sha256 and --pp-version go together (the opt-in PayPlus plugin)")
    if a.pp_zip:
        pins.append(("PayPlus plugin zip", a.pp_zip, a.pp_sha256))
    for label, path, want in pins:
        if not os.path.isfile(path):
            die("%s not found: %s" % (label, path))
        got = sha256_file(path)
        if got != want:
            die("%s SHA-256 mismatch: got %s, pinned %s" % (label, got, want))
    if os.path.exists(out):
        die("output tree exists: " + out)
    git = ["git", "-C", repo]
    head = subprocess.check_output(git + ["rev-parse", "HEAD"]).decode().strip()
    comp = {"theme": "admin/wp-content/themes/aicc-admin", "plugin": "admin/wp-content/plugins/aicc-license-manager"}
    dirty = subprocess.check_output(git + ["status", "--porcelain", "--"] + list(comp.values())).decode().strip()
    if dirty and not a.allow_dirty:
        die("the theme/plugin paths have uncommitted changes (a release must come from a commit; use --allow-dirty to build from the working tree):\n" + dirty)
    os.makedirs(out)
    # 1. WordPress core
    with tarfile.open(wp_tar, "r:gz") as t:
        names = t.getnames()
        for n in names:
            safe_member_path(n)
        top = {n.split("/")[0] for n in names}
        if top != {"wordpress"}:
            die("unexpected top-level entries in the WordPress tarball: %s" % sorted(top))
        tmp = out + ".wp"
        os.makedirs(tmp)
        safe_extractall(t, tmp)
    for item in os.listdir(os.path.join(tmp, "wordpress")):
        shutil.move(os.path.join(tmp, "wordpress", item), os.path.join(out, item))
    shutil.rmtree(tmp)
    for rel in WP_PRUNE:
        p = os.path.join(out, rel)
        if os.path.isdir(p):
            shutil.rmtree(p)
        elif os.path.exists(p):
            os.remove(p)
    # 2. WooCommerce (third party: only directories named tests/Tests/test/__tests__ and *.phpt files are pruned (found: Jest specs in assets/js/frontend/test, vendor PHPT
    #    tests); everything else stays exactly as published)
    with zipfile.ZipFile(wc_zip) as z:
        for n in z.namelist():
            safe_member_path(n)
        if {n.split("/")[0] for n in z.namelist()} != {"woocommerce"}:
            die("unexpected top-level entries in the WooCommerce zip")
        z.extractall(os.path.join(out, "wp-content", "plugins"))
    vend = os.path.join(out, "wp-content", "plugins", "woocommerce")
    pruned = 0
    for dp, dns, fns in os.walk(vend, topdown=True):
        for n in list(dns):
            if n in ("tests", "Tests", "test", "__tests__"):
                shutil.rmtree(os.path.join(dp, n)); dns.remove(n); pruned += 1
        for n in fns:
            if n.endswith(".phpt"):
                os.remove(os.path.join(dp, n)); pruned += 1
    # 2a. OPT-IN pinned third-party payment plugin (only with --pp-zip; the default build never reaches this): as published, hash-checked above. The caller (the owner)
    #     still decides whether this plugin is the gateway; the pin is a build input, not an endorsement.
    if a.pp_zip:
        with zipfile.ZipFile(a.pp_zip) as z:
            for n in z.namelist():
                safe_member_path(n)
            if {n.split("/")[0] for n in z.namelist()} != {"payplus-payment-gateway"}:
                die("unexpected top-level entries in the PayPlus plugin zip")
            z.extractall(os.path.join(out, "wp-content", "plugins"))
    # 2b. Storefront (parent theme of the AICC theme), as published
    with zipfile.ZipFile(a.sf_zip) as z:
        for n in z.namelist():
            safe_member_path(n)
        if {n.split("/")[0] for n in z.namelist()} != {"storefront"}:
            die("unexpected top-level entries in the Storefront zip")
        z.extractall(os.path.join(out, "wp-content", "themes"))
    # 3. AICC theme and plugin from the worktree (git archive of the committed tree, or the working tree with --allow-dirty)
    for kind, rel in comp.items():
        dest = os.path.join(out, "wp-content", "themes" if kind == "theme" else "plugins", os.path.basename(rel))
        os.makedirs(dest)
        if a.allow_dirty:
            src = os.path.join(repo, rel)
            shutil.copytree(src, dest, dirs_exist_ok=True, symlinks=True)
        else:
            data = subprocess.check_output(git + ["archive", "--format=tar", "HEAD:" + rel])
            with tarfile.open(fileobj=io.BytesIO(data)) as t:
                for n in t.getnames():
                    safe_member_path(n)
                safe_extractall(t, dest)
        prune_excluded(dest)
    # 4. links into shared storage (the host provides the targets; they are NOT in the release)
    up = os.path.join(out, "wp-content", "uploads")
    if os.path.lexists(up):
        die("uploads must not exist in the release tree")
    os.symlink("/srv/aicc/shared/uploads", up)
    os.symlink("/srv/aicc/shared/wp-config.php", os.path.join(out, "wp-config.php"))
    info = {"wp_version": a.wp_version, "wc_version": a.wc_version, "storefront_version": a.sf_version, "cp_commit": head, "dirty": bool(dirty), "vendor_test_files_pruned": pruned}
    if a.pp_zip:
        info["payplus_version"] = a.pp_version
    print(json.dumps(info))


def cmd_pack(a):
    tree = a.tree
    if not os.path.isdir(tree):
        die("tree not found: " + tree)
    epoch = int(a.epoch)
    lines = sums_lines(tree)
    th = tree_hash(lines)
    rid = release_id(epoch, th)
    os.makedirs(a.out_dir, exist_ok=True)
    base = os.path.join(a.out_dir, "%s-%s" % (a.kind, rid))
    tar_path = base + ".tar.gz"
    bio = io.BytesIO()
    nfiles = nlinks = nbytes = 0
    with gzip.GzipFile(filename="", mode="wb", fileobj=bio, mtime=0, compresslevel=9) as gz:
        with tarfile.open(fileobj=gz, mode="w", format=tarfile.GNU_FORMAT) as t:
            for rel, p, kind in walk_sorted(tree):
                ti = tarfile.TarInfo(rel)
                ti.mtime = epoch; ti.uid = ti.gid = 0; ti.uname = ti.gname = "root"
                if kind == "d":
                    ti.type = tarfile.DIRTYPE; ti.mode = 0o755; t.addfile(ti)
                elif kind == "l":
                    ti.type = tarfile.SYMTYPE; ti.linkname = os.readlink(p); ti.mode = 0o777; t.addfile(ti); nlinks += 1
                else:
                    st = os.stat(p)
                    ti.size = st.st_size; ti.mode = 0o755 if st.st_mode & 0o111 else 0o644
                    with open(p, "rb") as f:
                        t.addfile(ti, f)
                    nfiles += 1; nbytes += st.st_size
    with open(tar_path, "wb") as f:
        f.write(bio.getvalue())
    with open(base + ".SHA256SUMS", "w", encoding="utf-8", errors="surrogateescape") as f:
        f.write("\n".join(lines) + "\n")
    meta = json.loads(a.meta) if a.meta else {}
    manifest = {
        "schema": 1, "kind": a.kind, "release_id": rid,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch)), "source_date_epoch": epoch,
        "tree_sha256": th, "file_count": nfiles, "symlink_count": nlinks, "bytes": nbytes,
        "tarball": {"name": os.path.basename(tar_path), "sha256": sha256_file(tar_path), "bytes": os.path.getsize(tar_path)},
        "sources": meta,
    }
    with open(base + ".manifest.json", "w") as f:
        json.dump(manifest, f, indent=2, sort_keys=True); f.write("\n")
    print(json.dumps({"release_id": rid, "tarball": tar_path, "manifest": base + ".manifest.json", "sums": base + ".SHA256SUMS", "tarball_sha256": manifest["tarball"]["sha256"]}))


def cmd_unpack(a):
    os.makedirs(a.dest, exist_ok=True)
    if os.listdir(a.dest):
        die("destination not empty: " + a.dest)
    with tarfile.open(a.tarball, "r:gz") as t:
        for m in t.getmembers():
            safe_member_path(m.name)
            if m.isdev() or m.isfifo():
                die("device/fifo in archive: " + m.name)
            if m.islnk():
                die("hard link in archive: " + m.name)
        safe_extractall(t, a.dest)
    print("unpacked to " + a.dest)


def cmd_scan(a):
    problems = []
    root = a.tree
    for rel, p, kind in walk_sorted(root):
        parts = rel.split("/")
        base = parts[-1]
        if kind == "d":
            if base in FORBIDDEN_DIRS:
                problems.append("forbidden directory: " + rel)
            continue
        if kind == "l":
            if rel not in ("wp-config.php", "wp-content/uploads") and a.kind == "cp":
                problems.append("unexpected symlink: %s -> %s" % (rel, os.readlink(p)))
            elif a.kind == "cp" and not os.readlink(p).startswith("/srv/aicc/shared/"):
                problems.append("symlink outside shared storage: " + rel)
            continue
        if rel in ALLOWED_NAME_PATHS:
            continue
        for rx in FORBIDDEN_NAME_RES:
            if re.match(rx, base):
                # third-party trees are allowed to carry .pem/.key-named files only when they contain no private key: content scan below decides
                if rx.endswith(r"\.(pem|key|p12|pfx)$") and not rel.startswith(("wp-content/themes/aicc-admin", "wp-content/plugins/aicc-license-manager")):
                    break
                problems.append("forbidden file name: " + rel)
                break
        ext = os.path.splitext(base)[1].lower()
        if ext in TEXT_EXT or os.path.getsize(p) < 200000:
            try:
                with open(p, "rb") as f:
                    data = f.read(2_000_000)
            except OSError:
                continue
            ours = rel.startswith(("wp-content/themes/aicc-admin/", "wp-content/plugins/aicc-license-manager/"))
            for label, rx in SECRET_PATTERNS:
                if label == "private key" or ours:
                    if rx.search(data):
                        # core's wp-config-sample style defaults are pruned, so any hit is real
                        problems.append("%s in %s" % (label, rel))
            if ours:
                for label, rx in FIXTURE_PATTERNS:
                    if rx.search(data):
                        problems.append("%s in %s" % (label, rel))
    if problems:
        for p in problems[:50]:
            print("SCAN FAIL: " + p, file=sys.stderr)
        sys.exit(1)
    print("scan clean: no secrets, fixtures, VCS data or forbidden files")


# ---------------------------------------------------------------------------------------------------------------------------------------------------
# Error pages are legitimately noindex in production (Next's not-found export and the edge's 50x page); every other page must be indexable.
ERROR_PAGES = {"404.html", "404/index.html", "_not-found/index.html", "50x.html"}
NOINDEX_META = '<meta name="robots" content="noindex, nofollow, noarchive, nosnippet"/>'
STAGE_ROBOTS = "# STAGING: not for indexing\nUser-agent: *\nDisallow: /\n"
HEAD_RE = re.compile(rb"<head(\s[^>]*)?>", re.I)


def cmd_site_stage(a):
    if not re.fullmatch(r"[0-9a-f]{32}", a.stage_id):
        die("--stage-id must be 32 lowercase hex characters")
    if not re.fullmatch(r"stage[a-z0-9-]*\.copilt\.org", a.host):
        die("--host must be a stage*.copilt.org name")
    n = 0
    for rel, p, kind in walk_sorted(a.tree):
        if kind == "f" and rel.lower().endswith((".html", ".htm")):
            data = open(p, "rb").read()
            if NOINDEX_META.encode() in data:
                continue
            m = HEAD_RE.search(data)
            if not m:
                die("no <head> in " + rel)
            data = data[:m.end()] + NOINDEX_META.encode() + data[m.end():]
            open(p, "wb").write(data); n += 1
    open(os.path.join(a.tree, "robots.txt"), "w").write(STAGE_ROBOTS)
    sm = os.path.join(a.tree, "sitemap.xml")
    if os.path.exists(sm):
        os.remove(sm)
    wk = os.path.join(a.tree, ".well-known")
    os.makedirs(wk, exist_ok=True)
    with open(os.path.join(wk, "aicc-stage-identity"), "w") as f:
        # same compact shape as the Caddyfile's identity route ({"env","host","id"}), so the file and the live route answer identically
        f.write(json.dumps({"env": "staging", "host": a.host, "id": a.stage_id}, separators=(",", ":")) + "\n")
    print("stage transform: noindex injected into %d html file(s), robots.txt disallow-all, sitemap removed, identity file written" % n)


def cmd_site_check(a):
    problems = []
    ident = os.path.join(a.tree, ".well-known", "aicc-stage-identity")
    robots = os.path.join(a.tree, "robots.txt")
    noindex_re = re.compile(rb"<meta[^>]+name=[\"']robots[\"'][^>]*noindex", re.I)
    html = 0; with_noindex = 0; stage_marked = 0; bad_noindex = []
    for rel, p, kind in walk_sorted(a.tree):
        if kind == "f" and rel.lower().endswith((".html", ".htm")):
            html += 1
            data = open(p, "rb").read()
            if noindex_re.search(data):
                with_noindex += 1
                if rel not in ERROR_PAGES:
                    bad_noindex.append(rel)
            if NOINDEX_META.encode() in data:
                stage_marked += 1
    rtxt = open(robots).read() if os.path.exists(robots) else ""
    blanket = re.search(r"(?mi)^\s*Disallow:\s*/\s*$", rtxt) is not None
    if a.target == "stage":
        if not os.path.exists(ident):
            problems.append("identity file missing")
        else:
            j = json.load(open(ident))
            if j.get("id") != a.stage_id or j.get("env") != "staging":
                problems.append("identity file does not carry the expected stage id")
        if html == 0 or stage_marked != html:
            problems.append("the staging noindex meta is missing on %d of %d html files" % (html - stage_marked, html))
        if not blanket:
            problems.append("robots.txt does not disallow everything")
        if os.path.exists(os.path.join(a.tree, "sitemap.xml")):
            problems.append("sitemap.xml present in a staging tree")
        # A staging page must never point a visitor at PRODUCTION (an account link or a client bundle that fell back to the default origin did exactly that once).
        leaks = []
        for rel, p, kind in walk_sorted(a.tree):
            if kind == "f" and rel.lower().endswith((".html", ".htm", ".js", ".txt", ".json", ".xml", ".css")):
                data = open(p, "rb").read()
                if b"www.copilt.org" in data:
                    leaks.append(rel)
        if leaks:
            problems.append("%d file(s) in the staging tree reference the production host www.copilt.org: %s" % (len(leaks), ", ".join(leaks[:4])))
    else:
        if os.path.exists(ident) or os.path.isdir(os.path.join(a.tree, ".well-known")) and any("stage" in n for n in os.listdir(os.path.join(a.tree, ".well-known"))):
            problems.append("a stage identity file exists in a production tree")
        if bad_noindex:
            problems.append("content page(s) carry noindex in a production tree: %s" % ", ".join(bad_noindex[:5]))
        if stage_marked:
            problems.append("%d html file(s) carry the staging noindex marker in a production tree" % stage_marked)
        if blanket:
            problems.append("robots.txt disallows everything in a production tree")
        for rel, p, kind in walk_sorted(a.tree):
            if kind == "f" and b"aicc-stage-identity" in open(p, "rb").read(500000) and rel.endswith((".html", ".txt", ".js")):
                problems.append("reference to the stage identity in " + rel); break
    if problems:
        for p in problems:
            print("SITE CHECK FAIL (%s): %s" % (a.target, p), file=sys.stderr)
        sys.exit(1)
    print("site check ok (%s): %d html files" % (a.target, html))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("assemble-cp")
    for k in ("wp-tar", "wc-zip", "sf-zip", "cp-repo", "out-tree", "wp-sha256", "wc-sha256", "sf-sha256", "wp-version", "wc-version", "sf-version"):
        p.add_argument("--" + k, required=True)
    for k in ("pp-zip", "pp-sha256", "pp-version"):
        p.add_argument("--" + k, default="")
    p.add_argument("--allow-dirty", action="store_true"); p.set_defaults(fn=cmd_assemble_cp)
    p = sp.add_parser("pack")
    p.add_argument("--tree", required=True); p.add_argument("--kind", required=True, choices=["cp", "site"]); p.add_argument("--out-dir", required=True)
    p.add_argument("--epoch", required=True); p.add_argument("--meta", default=""); p.set_defaults(fn=cmd_pack)
    p = sp.add_parser("unpack"); p.add_argument("--tarball", required=True); p.add_argument("--dest", required=True); p.set_defaults(fn=cmd_unpack)
    p = sp.add_parser("scan"); p.add_argument("--tree", required=True); p.add_argument("--kind", required=True, choices=["cp", "site"]); p.set_defaults(fn=cmd_scan)
    p = sp.add_parser("site-stage"); p.add_argument("--tree", required=True); p.add_argument("--stage-id", required=True); p.add_argument("--host", required=True); p.set_defaults(fn=cmd_site_stage)
    p = sp.add_parser("site-check"); p.add_argument("--tree", required=True); p.add_argument("--target", required=True, choices=["stage", "production"]); p.add_argument("--stage-id", default="")
    p.set_defaults(fn=cmd_site_check)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
