"""Minimal FastCGI responder client over a unix socket (stdlib only).

Implements just enough of the FastCGI 1.0 spec to GET the PHP-FPM status page:
BEGIN_REQUEST, PARAMS (name/value pairs), empty PARAMS, empty STDIN, then reads
STDOUT/STDERR/END_REQUEST records. One request per connection (no multiplexing)."""
from __future__ import annotations

import socket
import struct

FCGI_VERSION = 1
BEGIN_REQUEST, ABORT_REQUEST, END_REQUEST, PARAMS, STDIN, STDOUT, STDERR = 1, 2, 3, 4, 5, 6, 7
RESPONDER = 1
MAX_BODY = 1 << 20  # 1 MiB cap on a status response


class FcgiError(Exception):
    pass


def encode_length(n: int) -> bytes:
    if n < 128:
        return bytes([n])
    return struct.pack(">I", n | 0x80000000)


def encode_params(params: dict) -> bytes:
    out = bytearray()
    for k, v in params.items():
        kb, vb = k.encode(), v.encode()
        out += encode_length(len(kb)) + encode_length(len(vb)) + kb + vb
    return bytes(out)


def decode_params(data: bytes) -> dict:
    """Inverse of encode_params; used by the fake FPM server in tests."""
    out, i = {}, 0

    def read_len(i):
        b = data[i]
        if b < 128:
            return b, i + 1
        return struct.unpack(">I", data[i:i + 4])[0] & 0x7FFFFFFF, i + 4

    while i < len(data):
        kl, i = read_len(i)
        vl, i = read_len(i)
        out[data[i:i + kl].decode()] = data[i + kl:i + kl + vl].decode()
        i += kl + vl
    return out


def record(rtype: int, request_id: int, content: bytes = b"") -> bytes:
    if len(content) > 0xFFFF:
        raise ValueError("record content too large")
    pad = (-len(content)) % 8
    return struct.pack(">BBHHBx", FCGI_VERSION, rtype, request_id, len(content), pad) + content + b"\0" * pad


def build_request(params: dict, request_id: int = 1) -> bytes:
    body = struct.pack(">HB5x", RESPONDER, 0)  # role, flags (no keep-conn)
    out = record(BEGIN_REQUEST, request_id, body)
    enc = encode_params(params)
    for i in range(0, len(enc), 0xFFF8):
        out += record(PARAMS, request_id, enc[i:i + 0xFFF8])
    out += record(PARAMS, request_id)
    out += record(STDIN, request_id)
    return out


def _read_exact(sock, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise FcgiError("connection closed mid-record")
        buf += chunk
    return buf


def read_records(sock):
    """Yield (type, request_id, content) until the stream ends."""
    while True:
        try:
            head = _read_exact(sock, 8)
        except FcgiError:
            return
        ver, rtype, rid, clen, plen = struct.unpack(">BBHHB", head[:7])
        if ver != FCGI_VERSION:
            raise FcgiError(f"unexpected FastCGI version {ver}")
        content = _read_exact(sock, clen) if clen else b""
        if plen:
            _read_exact(sock, plen)
        yield rtype, rid, content


def parse_cgi_response(raw: bytes):
    """Split a CGI-style response into (status_code, headers dict, body)."""
    sep = raw.find(b"\r\n\r\n")
    if sep < 0:
        sep2 = raw.find(b"\n\n")
        if sep2 < 0:
            raise FcgiError("no header terminator in FastCGI response")
        head, body = raw[:sep2], raw[sep2 + 2:]
    else:
        head, body = raw[:sep], raw[sep + 4:]
    headers, status = {}, 200
    for line in head.decode("latin-1").splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        headers[k.strip().lower()] = v.strip()
    if "status" in headers:
        try:
            status = int(headers["status"].split()[0])
        except (ValueError, IndexError):
            raise FcgiError("bad Status header")
    return status, headers, body


def fcgi_get(socket_path: str, script_name: str, query: str = "", timeout: float = 5.0):
    """GET `script_name` from the FPM pool listening on `socket_path`. Returns (status, headers, body)."""
    params = {
        "REQUEST_METHOD": "GET",
        "SCRIPT_NAME": script_name,
        "SCRIPT_FILENAME": script_name,
        "REQUEST_URI": script_name + (("?" + query) if query else ""),
        "QUERY_STRING": query,
        "SERVER_PROTOCOL": "HTTP/1.1",
        "GATEWAY_INTERFACE": "CGI/1.1",
        "SERVER_SOFTWARE": "aicc-ops",
        "REMOTE_ADDR": "127.0.0.1",
        "SERVER_NAME": "localhost",
        "SERVER_PORT": "80",
    }
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(socket_path)
        s.sendall(build_request(params))
        out, err, ended = bytearray(), bytearray(), False
        for rtype, _rid, content in read_records(s):
            if rtype == STDOUT:
                out += content
            elif rtype == STDERR:
                err += content
            elif rtype == END_REQUEST:
                ended = True
                break
            if len(out) > MAX_BODY:
                raise FcgiError("response too large")
        if not ended and not out:
            raise FcgiError("empty FastCGI response")
        return parse_cgi_response(bytes(out))
    finally:
        s.close()
