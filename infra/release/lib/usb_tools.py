#!/usr/bin/env python3
"""Helpers of the P45 passwordless USB signing tools (infra/release/usb-key-ceremony.sh, sign-plugin-release-usb.sh). Run as: python3 -I usb_tools.py <subcommand> ...

  classify --usb PATH [--serial]   decide whether PATH is the mount point of a PHYSICAL removable USB stick; print `key<TAB>value` lines. Exit 0 = accepted, 3 = refused (the reason is on stderr and `refused<TAB>reason` on stdout).
  ed25519  [--openssl]             read ONE line (the base64 64-byte Ed25519 secret key) from STDIN; re-derive the public key from its 32-byte seed with an independent pure-python RFC 8032 implementation
                                   (and optionally with OpenSSL); print the public keys and the fingerprint. The secret never leaves this process except as a pipe to `openssl pkey` (never argv, never a file).
  selftest                         the pure-python Ed25519 against the RFC 8032 test vectors.
  sidecars --dir D                 list `._*` AppleDouble files directly in D.
  jwrite OUT k=v ...               write a flat JSON object (values: strings; `null`, `true`, `false` literal) with exclusive create (never overwrites); mode 0600 where honoured.
  jget FILE key                    print one value of a flat JSON file ('' when missing or null).
  jset FILE k=v ...                update keys of a flat JSON file (atomic rename in the same directory).

Nothing here prints a secret. The harness seam (AICC_TEST_HARNESS=1) is implemented ONLY in `classify` and is documented there."""
import base64
import hashlib
import json
import os
import plistlib
import re
import subprocess
import sys

CLOUD = ("mobile documents", "icloud", "dropbox", "google drive", "googledrive", "onedrive", "cloudstorage", "box sync", "/library/cloudstorage", "pcloud", "nextcloud")
NETFS = ("smbfs", "nfs", "afpfs", "webdav", "cifs", "ftp", "osxfuse", "macfuse", "fuse", "autofs")


def out(k, v):
    print("%s\t%s" % (k, str(v).replace("\n", " ").replace("\t", " ")))


def refuse(msg):
    out("refused", msg)
    sys.stderr.write("REFUSED: %s\n" % msg)
    sys.exit(3)


# ------------------------------------------------------------------ Ed25519, RFC 8032 section 6 reference (independent of libsodium)
_P = 2 ** 255 - 19
_D = -121665 * pow(121666, _P - 2, _P) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _recover_x(y, sign):
    xx = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P) % _P
    x = pow(xx, (_P + 3) // 8, _P)
    if (x * x - xx) % _P != 0:
        x = x * _I % _P
    if (x * x - xx) % _P != 0:
        raise ValueError("no square root")
    if x & 1 != sign:
        x = _P - x
    return x


_BY = 4 * pow(5, _P - 2, _P) % _P
_BASE = (_recover_x(_BY, 0), _BY, 1, _recover_x(_BY, 0) * _BY % _P)


def _add(a, b):
    A = (a[1] - a[0]) * (b[1] - b[0]) % _P
    B = (a[1] + a[0]) * (b[1] + b[0]) % _P
    C = 2 * a[3] * b[3] * _D % _P
    Dd = 2 * a[2] * b[2] % _P
    E, F, G, H = B - A, Dd - C, Dd + C, B + A
    return (E * F % _P, G * H % _P, F * G % _P, E * H % _P)


def _mul(s, pt):
    q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            q = _add(q, pt)
        pt = _add(pt, pt)
        s >>= 1
    return q


def _compress(pt):
    zi = pow(pt[2], _P - 2, _P)
    x, y = pt[0] * zi % _P, pt[1] * zi % _P
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def ed25519_public(seed):
    if len(seed) != 32:
        raise ValueError("seed must be 32 bytes")
    h = hashlib.sha512(seed).digest()
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return _compress(_mul(a, _BASE))


def fingerprint(pub):
    h = hashlib.sha256(pub).hexdigest()[:16]
    return "-".join(h[i:i + 4] for i in (0, 4, 8, 12))


RFC_VECTORS = (
    ("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"),
    ("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c"),
)


def selftest():
    for sk, pk in RFC_VECTORS:
        if ed25519_public(bytes.fromhex(sk)).hex() != pk:
            return False
    return True


def openssl_public(seed):
    """Public key through OpenSSL: the secret seed goes in through a PIPE as a PKCS#8 DER document. Returns raw bytes, or None when this openssl cannot do Ed25519."""
    der = bytes.fromhex("302e020100300506032b657004220420") + seed
    for exe in ("/usr/bin/openssl", "openssl"):
        try:
            r = subprocess.run([exe, "pkey", "-inform", "DER", "-pubout", "-outform", "DER"], input=der, capture_output=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            continue
        if r.returncode == 0 and len(r.stdout) == 44 and r.stdout[:12] == bytes.fromhex("302a300506032b6570032100"):
            return r.stdout[-32:]
    return None


def cmd_ed25519(args):
    if not selftest():
        sys.stderr.write("the built-in Ed25519 self-test FAILED: refusing to rely on it\n")
        sys.exit(1)
    line = sys.stdin.readline().strip()
    try:
        raw = base64.b64decode(line, validate=True)
    except Exception:
        raw = b""
    if len(raw) != 64:
        sys.stderr.write("the key file is not a base64 64-byte Ed25519 secret key\n")
        sys.exit(1)
    seed, stored = raw[:32], raw[32:]
    pub = ed25519_public(seed)
    out("pub_python", base64.b64encode(pub).decode())
    out("pub_stored", base64.b64encode(stored).decode())
    out("fingerprint", fingerprint(pub))
    out("python_equals_stored", "yes" if pub == stored else "no")
    if "--openssl" in args:
        o = openssl_public(seed)
        out("pub_openssl", base64.b64encode(o).decode() if o else "unavailable")
        out("openssl_equals_python", ("yes" if o == pub else "no") if o else "unavailable")
    sys.exit(0 if pub == stored else 1)


# ------------------------------------------------------------------ classification of the volume
def run(cmd, timeout=30):
    r = subprocess.run(cmd, capture_output=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr.decode("utf-8", "replace")


def tmp_roots():
    roots = set(["/private/tmp", "/tmp", "/private/var/folders", "/var/folders"])
    # deliberately NOT derived from $TMPDIR: an environment variable must not be able to widen the harness seam
    return sorted(r for r in roots if r and r != "/")


def under(path, roots):
    return any(path == r or path.startswith(r + "/") for r in roots)


def mount_flags(real):
    rc, so, _ = run(["mount"])
    for line in so.decode("utf-8", "replace").splitlines():
        m = re.match(r"^(\S+) on (.*) \(([^)]*)\)$", line)
        if m and os.path.realpath(m.group(2)) == real:
            return m.group(1), [f.strip() for f in m.group(3).split(",")]
    return None, []


def diskinfo(target):
    rc, so, se = run(["diskutil", "info", "-plist", target])
    if rc != 0:
        return None
    try:
        return plistlib.loads(so)
    except Exception:
        return None


def walk_io(x):
    if isinstance(x, list):
        for i in x:
            for j in walk_io(i):
                yield j
    elif isinstance(x, dict):
        yield x
        for c in x.get("IORegistryEntryChildren", []):
            for j in walk_io(c):
                yield j


def io_marker(whole, part):
    """The IORegistry entry ids of the whole-disk and partition IOMedia objects: a NEW id is assigned every time the stick is (re-)enumerated by macOS, so a different value means the stick was unplugged/ejected and plugged in again."""
    rc, so, _ = run(["ioreg", "-a", "-r", "-c", "IOMedia", "-k", "BSD Name"], timeout=30)
    if rc != 0 or not so:
        return None
    try:
        d = plistlib.loads(so)
    except Exception:
        return None
    ids = {}
    for e in walk_io(d):
        n = e.get("BSD Name")
        if n in (whole, part) and "IORegistryEntryID" in e:
            ids[n] = int(e["IORegistryEntryID"])
    if whole in ids and part in ids:
        return "%d/%d" % (ids[whole], ids[part])
    return None


def usb_serial(whole):
    try:
        rc, so, _ = run(["system_profiler", "-json", "SPUSBDataType"], timeout=40)
        d = json.loads(so.decode("utf-8", "replace"))
    except Exception:
        return None

    def rec(items):
        for it in items:
            for m in it.get("Media", []) or []:
                if m.get("bsd_name") == whole:
                    return it
            sub = rec(it.get("_items", []) or [])
            if sub:
                return sub
        return None
    hit = rec(d.get("SPUSBDataType", []))
    if not hit:
        return None
    return "%s | vendor %s | product %s | serial %s" % (hit.get("_name", "?"), hit.get("vendor_id", "?"), hit.get("product_id", "?"), hit.get("serial_num", "(none reported)"))


def boot_time():
    rc, so, _ = run(["sysctl", "-n", "kern.boottime"])
    m = re.search(r"sec = (\d+)", so.decode("utf-8", "replace"))
    return m.group(1) if m else ""


def cmd_classify(args):
    path = ""
    want_serial = "--serial" in args
    if "--usb" in args:
        path = args[args.index("--usb") + 1] if args.index("--usb") + 1 < len(args) else ""
    if not path or not path.startswith("/") or "\0" in path or "/../" in path + "/" or path.endswith("/.."):
        refuse("--usb must be an absolute mount path such as /Volumes/<NAME> (no .. components)")
    harness = os.environ.get("AICC_TEST_HARNESS") == "1"
    roots = tmp_roots()
    if harness:
        # the seam: a throwaway disk image attached UNDER the system temp dir stands in for the stick. The literal path is checked BEFORE any filesystem access (so a real /Volumes/KEY_n is never even looked at).
        if not under(path.rstrip("/"), roots):
            refuse("AICC_TEST_HARNESS=1 is set, but %s is not under the system temp dir: the harness only accepts a throwaway disk image mounted there (this is never accepted for a real stick, e.g. /Volumes/KEY_n)" % path)
    if not os.path.isdir(path):
        refuse("%s is not a mounted volume (no such directory)" % path)
    real = os.path.realpath(path)
    low = real.lower()
    for c in CLOUD:
        if c in low:
            refuse("%s is inside a cloud-synced location (%s): a signing key must never be there" % (real, c))
    q = real
    while True:
        if os.path.exists(os.path.join(q, ".git")):
            refuse("%s is inside a git repository: a signing key must never be in a repo" % real)
        if q == "/":
            break
        q = os.path.dirname(q)
    if harness and not under(real, roots):
        refuse("AICC_TEST_HARNESS=1: %s resolves to %s, outside the system temp dir" % (path, real))
    info = diskinfo(real)
    if info is None:
        refuse("%s is not the mount point of a volume (diskutil cannot describe it): a plain folder is not a stick; give the stick's mount point, e.g. /Volumes/<NAME>" % real)
    mp = info.get("MountPoint", "")
    if not mp or os.path.realpath(mp) != real:
        refuse("%s is not the mount point of a volume (it is a folder on %s, an internal or other disk): give the stick's mount point, e.g. /Volumes/<NAME>" % (real, info.get("VolumeName", "?")))
    proto = info.get("BusProtocol", "")
    whole = info.get("ParentWholeDisk", "")
    # is it a disk image? (hdiutil knows every attached image; a stick is never one)
    img_path = None
    rc, so, _ = run(["hdiutil", "info", "-plist"])
    if rc == 0:
        try:
            for im in plistlib.loads(so).get("images", []):
                for e in im.get("system-entities", []):
                    mpt = e.get("mount-point")
                    if mpt and os.path.realpath(mpt) == real:
                        img_path = os.path.realpath(im.get("image-path", ""))
        except Exception:
            pass
    if harness:
        if not img_path:
            refuse("AICC_TEST_HARNESS=1: %s is not a mounted disk image (hdiutil does not list it): the harness accepts only a throwaway disk image" % real)
        if not under(img_path, roots):
            refuse("AICC_TEST_HARNESS=1: the disk image behind %s is %s, which is not under the system temp dir" % (real, img_path))
        if proto != "Disk Image":
            refuse("AICC_TEST_HARNESS=1: %s does not report the Disk Image protocol (%s)" % (real, proto))
    else:
        if img_path or proto == "Disk Image":
            refuse("%s is a mounted DISK IMAGE, not a physical USB stick" % real)
        if proto != "USB":
            refuse("%s is not on a USB bus (diskutil reports protocol '%s', internal=%s): signing keys live only on a dedicated USB stick" % (real, proto or "?", info.get("Internal")))
        if info.get("Internal") is True:
            refuse("%s is an INTERNAL device" % real)
        if not (info.get("Removable") or info.get("RemovableMedia") or info.get("Ejectable") or info.get("RemovableMediaOrExternalDevice")):
            refuse("%s is not removable/ejectable media" % real)
        if info.get("VirtualOrPhysical") == "Virtual" or info.get("SystemImage"):
            refuse("%s is a virtual device" % real)
    fstype = str(info.get("FilesystemType", ""))
    src, flags = mount_flags(real)
    if fstype in NETFS or any(n == fstype for n in NETFS) or (src or "").startswith("//") or ":" in (src or "/"):
        refuse("%s is a network filesystem (%s)" % (real, fstype))
    if "local" not in flags and src is not None:
        refuse("%s is not a local mount (%s)" % (real, ",".join(flags)))
    winfo = diskinfo("/dev/" + whole) if whole else None
    out("mount_point", real)
    out("harness", "yes" if harness else "no")
    out("bus_protocol", proto)
    out("internal", info.get("Internal"))
    out("removable", "yes" if (info.get("Removable") or info.get("RemovableMedia")) else "no")
    out("ejectable", "yes" if info.get("Ejectable") else "no")
    out("fs_type", fstype)
    out("fs_name", info.get("FilesystemName", ""))
    out("volume_name", info.get("VolumeName", ""))
    out("volume_uuid", info.get("VolumeUUID", ""))
    out("device_node", info.get("DeviceNode", ""))
    out("whole_disk", whole)
    out("media_name", (winfo or {}).get("MediaName") or info.get("MediaName") or (winfo or {}).get("IORegistryEntryName") or "")
    out("size_bytes", info.get("TotalSize", info.get("Size", "")))
    out("free_bytes", info.get("FreeSpace", ""))
    out("writable", "yes" if info.get("WritableVolume", info.get("Writable")) else "no")
    out("mount_flags", ",".join(flags))
    out("io_marker", io_marker(whole, info.get("DeviceIdentifier", "")) or "")
    out("boot_time", boot_time())
    if want_serial:
        out("usb_identity", "(disk image: no USB device)" if harness else (usb_serial(whole) or "(not reported by system_profiler)"))
    sys.exit(0)


def cmd_sidecars(args):
    d = args[args.index("--dir") + 1]
    try:
        for n in sorted(os.listdir(d)):
            if n.startswith("._"):
                print(n)
    except OSError:
        pass


def _val(v):
    return {"null": None, "true": True, "false": False}.get(v, v)


def _pairs(items):
    d = {}
    for it in items:
        k, _, v = it.partition("=")
        d[k] = _val(v)
    return d


def cmd_jwrite(args):
    old = os.umask(0o077)
    try:
        fd = os.open(args[0], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except OSError as e:
        sys.stderr.write("cannot create %s (exists or not writable): %s\n" % (args[0], e.strerror))
        sys.exit(1)
    finally:
        os.umask(old)
    with os.fdopen(fd, "w") as f:
        json.dump(_pairs(args[1:]), f, indent=2, sort_keys=True)
        f.write("\n")


def cmd_jget(args):
    try:
        v = json.load(open(args[0])).get(args[1])
    except Exception:
        v = None
    print("" if v is None else v)


def cmd_jset(args):
    d = json.load(open(args[0]))
    d.update(_pairs(args[1:]))
    tmp = "%s.tmp.%d" % (args[0], os.getpid())
    with open(tmp, "w") as f:
        json.dump(d, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, args[0])


def main():
    if len(sys.argv) < 2:
        sys.stderr.write(__doc__)
        sys.exit(2)
    c, a = sys.argv[1], sys.argv[2:]
    if c == "classify":
        cmd_classify(a)
    elif c == "ed25519":
        cmd_ed25519(a)
    elif c == "selftest":
        ok = selftest()
        print("ed25519 pure-python self-test: %s" % ("ok" if ok else "FAILED"))
        sys.exit(0 if ok else 1)
    elif c == "sidecars":
        cmd_sidecars(a)
    elif c == "jwrite":
        cmd_jwrite(a)
    elif c == "jget":
        cmd_jget(a)
    elif c == "jset":
        cmd_jset(a)
    else:
        sys.stderr.write("unknown subcommand\n")
        sys.exit(2)


if __name__ == "__main__":
    main()
