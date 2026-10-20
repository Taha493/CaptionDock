"""Tiny local server for the smoke tests.

Serves the project folder, plus:
  /api/timedtext  returns the fixture matching the requested fmt (json3 or srv3)
  /watch          returns tests/smoke/youtube-fake.html (fake YouTube page)
Local only, no internet.

Usage: python3 tests/smoke/server.py PORT [CERT KEY]   (CERT/KEY turn on HTTPS)
"""
import http.server
import os
import ssl
import sys
from urllib.parse import parse_qs, urlparse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FIXTURES = os.path.join(ROOT, "tests", "fixtures")
FAKE_WATCH = os.path.join(ROOT, "tests", "smoke", "youtube-fake.html")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_file(self, path, content_type):
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/timedtext":
            fmt = parse_qs(url.query).get("fmt", ["json3"])[0]
            if fmt == "srv3":
                self.send_file(os.path.join(FIXTURES, "srv3.xml"), "text/xml")
            else:
                self.send_file(os.path.join(FIXTURES, "json3-asr.json"), "application/json")
            return
        if url.path == "/watch":
            self.send_file(FAKE_WATCH, "text/html; charset=utf-8")
            return
        super().do_GET()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    if len(sys.argv) > 3:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(sys.argv[2], sys.argv[3])
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
    server.serve_forever()
