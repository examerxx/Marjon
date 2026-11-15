#!/usr/bin/env python3
"""Local host for the Marjon mobile Flutter Web build.

Why: an iPhone cannot build/run a native Flutter app from Windows, and calling
https://api.marjon.tech directly from a LAN origin is blocked by CORS. This
server publishes `mobile/build/web` and relays API/WebSocket traffic to the
real backend, so page and API share one origin (the PC's LAN address).

Usage (from mobile/, after `flutter build web`):

    python tool/serve_web.py                 # 0.0.0.0:8080
    python tool/serve_web.py --port 8080 --upstream api.marjon.tech

Build the app with the same address so the default server URL matches:

    flutter build web --release \
      --dart-define=MARJON_API=http://<PC_LAN_IP>:8080/api/v1

Routes:
    /api/*  -> https://<upstream>/api/*
    /ws/*   -> wss://<upstream>/ws/*    (raw WebSocket tunnel)
    *       -> static files from build/web
"""
from __future__ import annotations

import argparse
import http.client
import mimetypes
import os
import select
import socket
import ssl
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}
UPSTREAM_HOST = "api.marjon.tech"
UPSTREAM_PORT = 443


class Handler(SimpleHTTPRequestHandler):
    upstream_host = UPSTREAM_HOST
    upstream_port = UPSTREAM_PORT
    protocol_version = "HTTP/1.1"

    # ── proxy ─────────────────────────────────────────────────────────────────

    def _is_api(self) -> bool:
        return self.path == "/api" or self.path.startswith("/api/")

    def _is_ws(self) -> bool:
        return "websocket" in (self.headers.get("Upgrade") or "").lower()

    def _proxy_http(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None

        headers = {
            k: v
            for k, v in self.headers.items()
            if k.lower() not in HOP_BY_HOP and k.lower() != "host"
        }
        conn = http.client.HTTPSConnection(
            self.upstream_host, self.upstream_port, timeout=60
        )
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            payload = resp.read()
            self.send_response_only(resp.status, resp.reason)
            for key, value in resp.getheaders():
                if key.lower() not in HOP_BY_HOP and key.lower() != "content-length":
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)
        except Exception as exc:  # noqa: BLE001 — surface upstream failures to the client
            self.log_error("upstream error: %s", exc)
            msg = f'{{"detail":"upstream error: {exc}"}}'.encode()
            self.send_response_only(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
        finally:
            conn.close()

    def _tunnel_ws(self) -> None:
        """Relay the WebSocket handshake and frames byte-for-byte."""
        try:
            raw = socket.create_connection(
                (self.upstream_host, self.upstream_port), timeout=30
            )
            upstream = ssl.create_default_context().wrap_socket(
                raw, server_hostname=self.upstream_host
            )
        except OSError as exc:
            self.log_error("ws connect failed: %s", exc)
            self.send_error(502, "upstream unavailable")
            return

        lines = [f"GET {self.path} HTTP/1.1", f"Host: {self.upstream_host}"]
        for key, value in self.headers.items():
            if key.lower() in {"host", "connection", "upgrade", "proxy-connection"}:
                continue
            lines.append(f"{key}: {value}")
        lines += ["Connection: Upgrade", "Upgrade: websocket", "", ""]
        upstream.sendall("\r\n".join(lines).encode())

        upstream.settimeout(30)
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = upstream.recv(4096)
            if not chunk:
                break
            head += chunk
        if not head:
            upstream.close()
            self.send_error(502, "empty upstream response")
            return
        self.connection.sendall(head)
        self.close_connection = True

        client = self.connection
        client.settimeout(None)
        upstream.settimeout(None)
        sockets = [client, upstream]
        try:
            while True:
                readable, _, _ = select.select(sockets, [], [], 300)
                if not readable:
                    continue
                for src in readable:
                    data = src.recv(65536)
                    if not data:
                        return
                    (upstream if src is client else client).sendall(data)
        except OSError:
            pass
        finally:
            try:
                upstream.close()
            except OSError:
                pass

    # ── dispatch ──────────────────────────────────────────────────────────────

    def _dispatch(self) -> None:
        if self._is_ws():
            self._tunnel_ws()
        elif self._is_api():
            self._proxy_http()
        elif self.command == "GET":
            super().do_GET()
        elif self.command == "HEAD":
            super().do_HEAD()
        else:
            self.send_error(405)

    def do_GET(self) -> None:  # noqa: N802 — http.server API
        self._dispatch()

    def do_HEAD(self) -> None:  # noqa: N802
        self._dispatch()

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch()

    def do_PUT(self) -> None:  # noqa: N802
        self._dispatch()

    def do_PATCH(self) -> None:  # noqa: N802
        self._dispatch()

    def do_DELETE(self) -> None:  # noqa: N802
        self._dispatch()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._dispatch()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[web] %s %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    default_root = os.path.join(here, "..", "build", "web")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--root", default=os.path.normpath(default_root))
    parser.add_argument("--upstream", default=UPSTREAM_HOST)
    args = parser.parse_args()

    if not os.path.isfile(os.path.join(args.root, "index.html")):
        sys.exit(f"Нет сборки: {args.root}/index.html — сначала `flutter build web`")

    mimetypes.add_type("application/wasm", ".wasm")
    mimetypes.add_type("text/javascript", ".mjs")

    handler = partial(Handler, directory=args.root)
    Handler.upstream_host = args.upstream

    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Marjon mobile web: http://<LAN-IP>:{args.port}  (API -> {args.upstream})")
    print("Ctrl+C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
