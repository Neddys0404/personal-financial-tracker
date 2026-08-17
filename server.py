"""Minimal companion server for the Ledger finance app.

Serves this folder and persists the ledger into a single data.json next to it:
  GET  /data.json          -> current contents (404 on first run)
  PUT  /data.json          -> save full ledger JSON (atomic write, sane size cap)

Everything else falls through to plain static files. No dependencies beyond the
standard library; works on Windows, macOS and Linux.

Usage:
    python server.py            # http://127.0.0.1:8321
    python server.py 9000       # custom port
"""
import json
import os
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(ROOT, "data.json")
MAX_BODY = 5 * 1024 * 1024  # 5 MB is plenty for a personal ledger


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_PUT(self):
        if self.path.rstrip("/") != "/data.json":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BODY:
            self.send_error(413 if length > MAX_BODY else 400)
            return
        body = self.rfile.read(length)
        try:
            text = body.decode("utf-8")
            data = json.loads(text)
            assert isinstance(data, dict)
        except Exception:
            self.send_error(400, "invalid JSON")
            return

        # Atomic write: temp file in the same directory, then replace.
        fd, tmp = tempfile.mkstemp(dir=ROOT, prefix=".data-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, DATA_FILE)
        except OSError as e:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            self.send_error(500, str(e))
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, fmt, *args):
        sys.stderr.write("[ledger] %s\n" % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8321
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("Ledger running ->  http://0.0.0.0:%d" % port)
    print("Data file      ->  %s" % DATA_FILE)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
