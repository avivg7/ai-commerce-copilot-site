#!/usr/bin/env python3
"""Strict target-address check for the stage tooling (security review L5, 2026-10-21). stdlib only.

    ip-guard.py <value>      exit 0 and print the canonical address when <value> is a plain, canonical IPv4 or IPv6 address that is NOT a production address;
                             exit 3 and print the reason otherwise (fail closed).

Why a parser and not a string compare: `139.073.157.231` (leading zero) is 139.59.157.231 to glibc's octal reading, `0x8b.0x3b.0x9d.0xe7` and the decimal `2336...` are the same
address in other notations, `::ffff:8b3b:9de7` is the IPv4-mapped form, NAT64 `64:ff9b::8b3b:9de7` and 6to4 `2002:8b3b:9de7::` embed it, and a trailing dot is a name, not an address.
Rules: IPv4 must be canonical dotted decimal (no leading zeros, exactly four octets 0-255); IPv6 must parse, carry no zone id, and must NOT be an IPv4-mapped, IPv4-compatible,
NAT64 (64:ff9b::/96, 64:ff9b:1::/48), 6to4 (2002::/16) or Teredo (2001::/32) form at all (a staging target is a plain address); and neither the address nor any IPv4 it embeds
may be a known production address (the API droplet, GitHub Pages IPv4 and 2606:50c0:8000::/46)."""
import ipaddress
import re
import sys

PROD_V4 = {"139.59.157.231", "185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"}
PROD_V6 = [ipaddress.ip_network("2606:50c0:8000::/46")]
V4_RE = re.compile(r"^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$")


def check(raw):
    v = raw
    if v != v.strip() or not v:
        return None, "surrounding whitespace or empty"
    if v.startswith("[") and v.endswith("]"):
        v = v[1:-1]
    if "%" in v:
        return None, "an IPv6 zone id is not accepted"
    if ":" not in v:
        if not V4_RE.match(v) or any(int(o) > 255 for o in v.split(".")):
            return None, "not a canonical dotted-decimal IPv4 address (leading zero, hex/octal/decimal notation, short form, trailing dot or garbage)"
        if v in PROD_V4:
            return None, "a known PRODUCTION / public-site address (API droplet or GitHub Pages)"
        return v, None
    try:
        a = ipaddress.IPv6Address(v)
    except ValueError:
        return None, "not a valid IPv6 address"
    b = a.packed
    embedded = []
    if a.ipv4_mapped is not None:
        embedded.append(("IPv4-mapped", a.ipv4_mapped))
    if b[:12] == b"\0" * 12 and b[12:] not in (b"\0\0\0\0", b"\0\0\0\1"):
        embedded.append(("IPv4-compatible", ipaddress.IPv4Address(b[12:])))
    if b[:12] == bytes.fromhex("0064ff9b" + "00" * 8):
        embedded.append(("NAT64 64:ff9b::/96", ipaddress.IPv4Address(b[12:])))
    if b[:6] == bytes.fromhex("0064ff9b0001"):
        embedded.append(("NAT64 local-use 64:ff9b:1::/48", None))
    if a.sixtofour is not None:
        embedded.append(("6to4 2002::/16", a.sixtofour))
    if a.teredo is not None:
        embedded.append(("Teredo 2001::/32", a.teredo[0]))
        embedded.append(("Teredo client", a.teredo[1]))
    for kind, v4 in embedded:
        if v4 is not None and str(v4) in PROD_V4:
            return None, "a %s form of the PRODUCTION address %s" % (kind, v4)
    if any(a in n for n in PROD_V6):
        return None, "inside a known PRODUCTION / public-site IPv6 range (GitHub Pages 2606:50c0:8000::/46)"
    if embedded:
        return None, "an IPv4-embedding IPv6 form (%s) is not accepted as a target: use the plain IPv4 or global IPv6 address" % embedded[0][0]
    return str(a), None


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: ip-guard.py <address>", file=sys.stderr)
        sys.exit(2)
    ip, why = check(sys.argv[1])
    if why:
        print(why)
        sys.exit(3)
    print(ip)
