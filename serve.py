#!/usr/bin/env python3
"""Cozy Tavern — tiny static server on :8080.

No dependencies beyond the standard library. Serves the app shell with the
right MIME types so ES modules and the web manifest load cleanly.
"""
import http.server
import os
import socketserver

PORT = int(os.environ.get('PORT', 8080))
ROOT = os.path.dirname(os.path.abspath(__file__))

# M24: the tavern keeps its own books. The tales live in a real file on the
# device — NOT inside the app folder, so even wiping the app never takes them.
# (The browser stays a working copy; this file is the truth.)
DATA_DIR = os.environ.get('COZY_DATA_DIR') or os.path.join(os.path.expanduser('~'), '.cozytavern')
BOOKS = os.path.join(DATA_DIR, 'books.json')
MAX_BOOK_BYTES = 64 * 1024 * 1024  # 64MB of tales is a library, not a nightstand


def _ver():
    try:
        import re as _re
        src = open(os.path.join(ROOT, 'js', 'version.js')).read()
        return _re.search(r"VERSION = '([^']+)'", src).group(1)
    except Exception:
        return 'the current coat'


class TavernServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """Many hands, no waiting: browsers hold connections open, and a
    single-threaded server would make the whole tavern queue behind one."""
    daemon_threads = True
    allow_reuse_address = True


def _read_books():
    try:
        with open(BOOKS, 'rb') as f:
            return f.read()
    except OSError:
        return None


def _write_books(body):
    os.makedirs(DATA_DIR, exist_ok=True)
    # Rotate the last two copies before writing — a bad save never erases history.
    for older, newer in ((BOOKS + '.bak2', BOOKS + '.bak1'), (BOOKS + '.bak1', BOOKS)):
        if os.path.exists(newer):
            try:
                os.replace(newer, older)
            except OSError:
                pass
    tmp = BOOKS + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(body)
    os.replace(tmp, BOOKS)  # atomic — a half-written book never lands


class TavernHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.webmanifest': 'application/manifest+json',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.css': 'text/css',
        '.png': 'image/png',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Always serve fresh files while you tinker at the desk.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet; the tavern hums, it doesn't chatter

    # --- M24: the books endpoints (the keeper's core lives at module scope) ---

    def do_GET(self):
        if self.path.split('?')[0] == '/api/books':
            data = _read_books()
            if data is None:
                self.send_response(204)  # no books yet — a clean shelf, not an error
            else:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split('?')[0] == '/api/books':
            try:
                n = int(self.headers.get('content-length', 0))
            except ValueError:
                n = 0
            if n <= 0 or n > MAX_BOOK_BYTES:
                self.send_response(413)
                self.end_headers()
                return
            body = self.rfile.read(n)
            try:
                import json
                json.loads(body)  # the books must be true JSON, never a smudge
            except ValueError:
                self.send_response(400)
                self.end_headers()
                return
            _write_books(body)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"kept": true}')
            return
        self.send_response(404)
        self.end_headers()


if __name__ == '__main__':
    # Bind AND print 127.0.0.1 (M13): on some Android setups "localhost"
    # resolves to ::1 while the server sits on IPv4 — the printed URL must
    # be the deterministic one.
    with TavernServer(('127.0.0.1', PORT), TavernHandler) as server:
        print('The tavern is warm at http://127.0.0.1:%d  ·  %s' % (PORT, _ver()), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
