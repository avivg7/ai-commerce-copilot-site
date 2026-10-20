import os
import socket
import struct
import threading
import unittest

from aicc_ops import fcgi
from tests.helpers import TmpCase, FakeFpm


class FcgiTests(TmpCase):
    def test_length_encoding_roundtrip(self):
        params = {"A": "b", "LONG_" * 30: "v" * 300, "EMPTY": ""}
        self.assertEqual(fcgi.decode_params(fcgi.encode_params(params)), params)
        self.assertEqual(fcgi.encode_length(127), b"\x7f")
        self.assertEqual(fcgi.encode_length(128), b"\x80\x00\x00\x80")

    def test_record_padding_and_header(self):
        r = fcgi.record(fcgi.STDIN, 1, b"abc")
        self.assertEqual(len(r) % 8, 0)
        ver, t, rid, clen, plen = struct.unpack(">BBHHB", r[:7])
        self.assertEqual((ver, t, rid, clen, plen), (1, fcgi.STDIN, 1, 3, 5))

    def test_request_layout(self):
        raw = fcgi.build_request({"REQUEST_METHOD": "GET"})
        types = []
        i = 0
        while i < len(raw):
            _, t, _rid, clen, plen = struct.unpack(">BBHHB", raw[i:i + 7])
            types.append((t, clen))
            i += 8 + clen + plen
        self.assertEqual([t for t, _ in types], [fcgi.BEGIN_REQUEST, fcgi.PARAMS, fcgi.PARAMS, fcgi.STDIN])
        self.assertEqual(types[0][1], 8)
        self.assertEqual(types[2][1], 0)  # empty PARAMS terminator
        self.assertEqual(types[3][1], 0)  # empty STDIN

    def test_get_against_fake_server_including_split_stdout(self):
        for split in (False, True):
            path = os.path.join(self.tmp, f"s{int(split)}.sock")
            srv = FakeFpm(path, b'{"ok":true}', split=split)
            try:
                status, headers, body = fcgi.fcgi_get(path, "/fpm-status", "json", timeout=2)
                self.assertEqual(status, 200)
                self.assertEqual(body, b'{"ok":true}')
                self.assertEqual(headers["content-type"], "application/json")
                self.assertEqual(srv.params["REQUEST_METHOD"], "GET")
                self.assertEqual(srv.params["SCRIPT_FILENAME"], "/fpm-status")
            finally:
                srv.close()

    def test_status_header_parsed(self):
        path = os.path.join(self.tmp, "n.sock")
        srv = FakeFpm(path, b"nope", status="403 Forbidden")
        try:
            self.assertEqual(fcgi.fcgi_get(path, "/x", timeout=2)[0], 403)
        finally:
            srv.close()

    def test_server_closing_midway_raises(self):
        path = os.path.join(self.tmp, "c.sock")
        srv = socket.socket(socket.AF_UNIX); srv.bind(path); srv.listen(1)

        def serve():
            c, _ = srv.accept(); c.recv(100); c.close()
        threading.Thread(target=serve, daemon=True).start()
        with self.assertRaises(fcgi.FcgiError):
            fcgi.fcgi_get(path, "/x", timeout=2)
        srv.close()

    def test_bad_version_rejected(self):
        path = os.path.join(self.tmp, "v.sock")
        srv = socket.socket(socket.AF_UNIX); srv.bind(path); srv.listen(1)

        def serve():
            c, _ = srv.accept(); c.recv(1000); c.sendall(b"\x09\x06\x00\x01\x00\x00\x00\x00"); c.close()
        threading.Thread(target=serve, daemon=True).start()
        with self.assertRaises(fcgi.FcgiError):
            fcgi.fcgi_get(path, "/x", timeout=2)
        srv.close()

    def test_connect_error_is_oserror(self):
        with self.assertRaises(OSError):
            fcgi.fcgi_get(os.path.join(self.tmp, "missing.sock"), "/x", timeout=1)


    def test_parse_cgi_response_edge_cases(self):
        self.assertEqual(fcgi.parse_cgi_response(b"Content-Type: x\n\nbody")[2], b"body")
        with self.assertRaises(fcgi.FcgiError):
            fcgi.parse_cgi_response(b"garbage without terminator")
        with self.assertRaises(fcgi.FcgiError):
            fcgi.parse_cgi_response(b"Status: abc\r\n\r\n")


if __name__ == "__main__":
    unittest.main()
