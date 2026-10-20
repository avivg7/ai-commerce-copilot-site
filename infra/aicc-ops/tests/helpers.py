"""Shared test helpers: fixtures, fake FPM server, fake HTTP servers, temp stores, executable shims."""
from __future__ import annotations

import http.server
import json
import os
import socket
import stat
import tempfile
import threading
import unittest

from aicc_ops import fcgi
from aicc_ops.config import load_config
from aicc_ops.store import Store

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def fixture(*parts) -> str:
    return os.path.join(FIX, *parts)


def read_fixture(*parts) -> str:
    with open(fixture(*parts)) as fh:
        return fh.read()


def make_cfg(tmp: str, **over):
    base = {"general": {"data_dir": tmp, "proc_root": fixture("proc_a")}}
    for k, v in over.items():
        base.setdefault(k, {}).update(v)
    return load_config(None, base)


def make_store(tmp: str, free_pct=50.0, **storage):
    cfg = make_cfg(tmp)
    sc = dict(cfg["storage"]); sc.update(storage)
    return Store(os.path.join(tmp, "t.sqlite3"), sc, free_pct_fn=lambda _p: free_pct)


def write_exe(path: str, body: str) -> str:
    with open(path, "w") as fh:
        fh.write("#!/bin/sh\n" + body)
    os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)
    return path


class TmpCase(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.tmp = self._td.name
        self.addCleanup(self._td.cleanup)


class FakeFpm:
    """FastCGI responder on a unix socket that records the last request's params."""

    def __init__(self, path, body: bytes, status="200 OK", split=False):
        self.path, self.body, self.status, self.split = path, body, status, split
        self.params = None
        self.srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.srv.bind(path)
        self.srv.listen(4)
        self.t = threading.Thread(target=self._serve, daemon=True)
        self.t.start()

    def _serve(self):
        while True:
            try:
                c, _ = self.srv.accept()
            except OSError:
                return
            try:
                data = bytearray()
                for rtype, rid, content in fcgi.read_records(c):
                    if rtype == fcgi.PARAMS:
                        data += content
                    if rtype == fcgi.STDIN and not content:
                        break
                self.params = fcgi.decode_params(bytes(data))
                out = f"Status: {self.status}\r\nContent-Type: application/json\r\n\r\n".encode() + self.body
                if self.split:
                    mid = len(out) // 2
                    c.sendall(fcgi.record(fcgi.STDOUT, rid, out[:mid])); c.sendall(fcgi.record(fcgi.STDOUT, rid, out[mid:]))
                else:
                    c.sendall(fcgi.record(fcgi.STDOUT, rid, out))
                c.sendall(fcgi.record(fcgi.STDOUT, rid))
                c.sendall(fcgi.record(fcgi.END_REQUEST, rid, b"\0" * 8))
            except Exception:
                pass
            finally:
                c.close()

    def close(self):
        try:
            self.srv.close()
        finally:
            if os.path.exists(self.path):
                os.unlink(self.path)


class BodyServer:
    """Plain loopback HTTP server returning a mutable body; records requests."""

    def __init__(self, body=b"", status=200, handler_fn=None):
        outer = self
        self.body, self.status, self.requests = body, status, []
        self.handler_fn = handler_fn

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass

            def _do(self):
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n) if n else b""
                outer.requests.append({"method": self.command, "path": self.path, "body": raw, "headers": dict(self.headers)})
                if outer.handler_fn:
                    st, b = outer.handler_fn(len(outer.requests), self.path)
                else:
                    st, b = outer.status, outer.body
                self.send_response(st)
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)
            do_GET = do_POST = _do

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.srv.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown(); self.srv.server_close()


def put(path: str, text: str) -> str:
    with open(path, "w") as fh:
        fh.write(text)
    return path


def read_text(path: str) -> str:
    with open(path) as fh:
        return fh.read()
