#!/usr/bin/env python3
"""
Read-only static server for the trace viewer, with HTTP Range support so the
front-end can tail a growing trace file by fetching only the newly appended bytes.

usage:
    python3 serve.py [directory] [-p PORT]

Then open the printed http://localhost:PORT/ address.  Nothing is ever written
to disk by this server -- GET/HEAD only.
"""
import argparse
import http.server
import mimetypes
import os
import re
import socket
import socketserver
import sys
import urllib.parse

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # ---- read-only: refuse everything except GET / HEAD / OPTIONS ----
    def do_POST(self): self.send_error(405, "read-only server")
    do_PUT = do_DELETE = do_PATCH = do_POST

    def do_OPTIONS(self):
        self.send_response(204)
        self._common()
        self.send_header("Allow", "GET, HEAD, OPTIONS")
        self.end_headers()

    def _common(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Content-Length")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")

    def end_headers(self):
        super().end_headers()

    def log_message(self, fmt, *a):
        if "--verbose" in sys.argv:
            super().log_message(fmt, *a)

    # ---- GET with byte-range ----
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            for idx in ("index.html", "trace-viewer.html"):
                cand = os.path.join(path, idx)
                if os.path.exists(cand):
                    path = cand
                    break
            else:
                return self.list_directory(path)

        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "not found")
            return None

        try:
            size = os.fstat(f.fileno())[6]
            ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
            if path.endswith((".txt", ".log", ".trace")):
                ctype = "text/plain; charset=utf-8"

            rng = self.headers.get("Range")
            m = RANGE_RE.match(rng) if rng else None
            if m:
                start = int(m.group(1)) if m.group(1) else 0
                end = int(m.group(2)) if m.group(2) else size - 1
                if start >= size:
                    # nothing new yet -- tell the client politely
                    self.send_response(416)
                    self._common()
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    f.close()
                    return None
                end = min(end, size - 1)
                length = end - start + 1
                f.seek(start)
                self.send_response(206)
                self._common()
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.send_header("Content-Length", str(length))
                self.end_headers()
                return _Limited(f, length)

            self.send_response(200)
            self._common()
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(size))
            self.end_headers()
            return f
        except Exception:
            f.close()
            raise


class _Limited:
    """file wrapper that yields at most n bytes (for 206 responses)"""

    def __init__(self, f, n):
        self.f, self.n = f, n

    def read(self, k=-1):
        if self.n <= 0:
            return b""
        if k is None or k < 0:
            k = self.n
        data = self.f.read(min(k, self.n))
        self.n -= len(data)
        return data

    def close(self):
        self.f.close()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("directory", nargs="?", default=".", help="目录（默认当前目录）")
    ap.add_argument("-p", "--port", type=int, default=8777)
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()

    root = os.path.abspath(a.directory)
    os.chdir(root)

    port = a.port
    for _ in range(30):
        try:
            httpd = Server(("0.0.0.0", port), Handler)
            break
        except OSError:
            port += 1
    else:
        sys.exit("no free port")

    here = os.path.dirname(os.path.abspath(__file__))
    viewer = None
    for cand in (os.path.join(root, "trace-viewer.html"), os.path.join(here, "trace-viewer.html")):
        if os.path.exists(cand):
            viewer = cand
            break

    traces = sorted(
        (f for f in os.listdir(root) if f.endswith((".txt", ".log", ".trace"))),
        key=lambda f: -os.path.getsize(os.path.join(root, f)),
    )[:8]

    bar = "=" * 66
    print(bar)
    print("  Trace Viewer  —  只读服务已启动")
    print(bar)
    print(f"  目录 : {root}")
    if viewer and os.path.dirname(viewer) != root:
        print(f"  注意 : trace-viewer.html 不在该目录，请把它复制过来：")
        print(f"         cp {viewer} {root}/")
    print(f"\n  打开 : http://localhost:{port}/trace-viewer.html")
    if traces:
        t = urllib.parse.quote(traces[0])
        print(f"  直连 : http://localhost:{port}/trace-viewer.html?url={t}&live=1")
        print("\n  可用 trace 文件:")
        for f in traces:
            print(f"    - {f}  ({os.path.getsize(os.path.join(root, f)) / 1048576:.2f} MB)")
    try:
        ip = socket.gethostbyname(socket.gethostname())
        print(f"\n  局域网: http://{ip}:{port}/trace-viewer.html")
    except Exception:
        pass
    print(f"\n  只读 · 支持 Range 增量拉取 · Ctrl-C 停止")
    print(bar, flush=True)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
