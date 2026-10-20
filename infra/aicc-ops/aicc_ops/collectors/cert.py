"""Certificate expiry: read the served certificate on loopback (SNI = configured hostname) or a PEM file.

No network beyond loopback. We fetch the certificate unverified (so an already-expired or wrong cert is still
measured) and parse notAfter from the DER ourselves (stdlib has no public X.509 parser for unverified certs)."""
from __future__ import annotations

import calendar
import re
import socket
import ssl

from . import CollectorError, Result
from ..util import assert_loopback


def _read_len(b: bytes, i: int):
    first = b[i]
    if first < 0x80:
        return first, i + 1
    n = first & 0x7F
    return int.from_bytes(b[i + 1:i + 1 + n], "big"), i + 1 + n


def _tlv(b: bytes, i: int):
    tag = b[i]
    ln, j = _read_len(b, i + 1)
    return tag, j, j + ln  # tag, content start, content end


def der_not_after(der: bytes) -> int:
    """Return notAfter (epoch seconds) of a DER X.509 certificate."""
    _, s, _e = _tlv(der, 0)                 # Certificate SEQUENCE
    _, s, _e2 = _tlv(der, s)                # tbsCertificate SEQUENCE
    i = s
    tag, cs, ce = _tlv(der, i)
    if tag == 0xA0:                         # [0] version
        i = ce
        tag, cs, ce = _tlv(der, i)
    i = ce                                  # skip serialNumber
    _, cs, ce = _tlv(der, i); i = ce        # signature AlgorithmIdentifier
    _, cs, ce = _tlv(der, i); i = ce        # issuer
    _, vs, _ve = _tlv(der, i)               # validity SEQUENCE
    _, ns, ne = _tlv(der, vs)               # notBefore
    tag2, as_, ae = _tlv(der, ne)           # notAfter
    s_ = der[as_:ae].decode("ascii")
    if tag2 == 0x17:                        # UTCTime YYMMDDHHMMSSZ
        m = re.match(r"^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$", s_)
        yy = int(m.group(1)); year = 2000 + yy if yy < 50 else 1900 + yy
        parts = (year,) + tuple(int(x) for x in m.groups()[1:])
    elif tag2 == 0x18:                      # GeneralizedTime YYYYMMDDHHMMSSZ
        m = re.match(r"^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$", s_)
        parts = tuple(int(x) for x in m.groups())
    else:
        raise ValueError("unexpected notAfter encoding")
    return calendar.timegm(parts + (0, 0, 0))


def fetch_der(host: str, port: int, sni: str, timeout: float) -> bytes:
    assert_loopback(host, "cert host")
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with socket.create_connection((host, port), timeout=timeout) as raw:
        with ctx.wrap_socket(raw, server_hostname=sni) as s:
            der = s.getpeercert(binary_form=True)
    if not der:
        raise CollectorError("no certificate presented")
    return der


def collect(full_cfg, cfg, state, now) -> Result:
    if not cfg.get("cert_file"):
        assert_loopback(cfg["host"], "cert host")  # raised outside the try: a bad config is a collector failure
    try:
        if cfg.get("cert_file"):
            with open(cfg["cert_file"], "r") as fh:
                pem = fh.read()
            der = ssl.PEM_cert_to_DER_cert(pem[pem.index("-----BEGIN CERTIFICATE-----"):])
        else:
            der = fetch_der(cfg["host"], int(cfg["port"]), cfg["hostname"], cfg.get("timeout_s", 5))
    except (OSError, ssl.SSLError, ValueError):
        return Result(metrics={"cert.ok": 0.0})
    na = der_not_after(der)
    return Result(metrics={"cert.ok": 1.0, "cert.days_left": (na - now) / 86400.0})
