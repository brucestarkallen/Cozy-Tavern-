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

    # --- M155: books per story (SillyTavern's shape — one file per tale) ---
    def _book_path(self, book_id):
        import re as _re
        if not _re.fullmatch(r'[A-Za-z0-9_\-]{1,80}', book_id or ''):
            return None
        return os.path.join(DATA_DIR, 'books', book_id + '.json')

    def _manifest(self):
        import json
        folder = os.path.join(DATA_DIR, 'books')
        out = []
        try:
            for name in sorted(os.listdir(folder)):
                if not name.endswith('.json'):
                    continue
                path = os.path.join(folder, name)
                try:
                    with open(path, 'rb') as f:
                        head = f.read(4096).decode('utf-8', 'ignore')
                    import re as _re
                    m = _re.search(r'"exportedAt"\s*:\s*"([^"]+)"', head)
                    out.append({'id': name[:-5], 'exportedAt': m.group(1) if m else '', 'bytes': os.path.getsize(path)})
                except OSError:
                    pass
        except OSError:
            pass
        return json.dumps({'books': out}).encode('utf-8')

    def _send_bytes(self, body, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/version':
            # M157: the version this PROCESS started with — the launcher compares it to the folder
            self._send_bytes(('{"version":"%s"}' % BOOT_VER).encode('utf-8'))
            return
        if path == '/api/books/list':
            self._send_bytes(self._manifest())
            return
        if path.startswith('/api/books/one/'):
            bp = self._book_path(path[len('/api/books/one/'):])
            if bp is None:
                self.send_response(400); self.end_headers(); return
            try:
                with open(bp, 'rb') as f:
                    data = f.read()
                self._send_bytes(data)
            except OSError:
                self.send_response(404); self.end_headers()
            return
        if self.path.split('?')[0] == '/api/books/stamp':
            # M140: the file's exportedAt alone — boot compares a stamp, never the whole book
            data = _read_books()
            stamp = ''
            if data is not None:
                try:
                    import json
                    head = data[:4096].decode('utf-8', 'ignore')
                    import re as _re
                    m = _re.search(r'"exportedAt"\s*:\s*"([^"]+)"', head)
                    if m:
                        stamp = m.group(1)
                    else:
                        stamp = json.loads(data).get('exportedAt', '') or ''
                except Exception:
                    stamp = ''
            body = ('{"exportedAt":"%s","bytes":%d}' % (stamp, len(data) if data is not None else 0)).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.split('?')[0] == '/api/books':
            data = _read_books()
            if data is None:
                # no books yet — a clean shelf, not an error. (end_headers
                # matters: without it the response never completes and the
                # browser reads ERR_EMPTY_RESPONSE.)
                self.send_response(204)
                self.end_headers()
            else:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]
        if path.startswith('/api/books/one/'):
            bp = self._book_path(path[len('/api/books/one/'):])
            if bp is None:
                self.send_response(400); self.end_headers(); return
            try:
                n = int(self.headers.get('content-length', 0))
            except ValueError:
                n = 0
            if n <= 0 or n > MAX_BOOK_BYTES:
                self.send_response(413); self.end_headers(); return
            body = self.rfile.read(n)
            try:
                import json
                json.loads(body)
            except ValueError:
                self.send_response(400); self.end_headers(); return
            os.makedirs(os.path.dirname(bp), exist_ok=True)
            tmp = bp + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(body)
            if os.path.exists(bp):
                try:
                    os.replace(bp, bp + '.bak1')
                except OSError:
                    pass
            os.replace(tmp, bp)
            self._send_bytes(b'{"ok":true}')
            return
        if path.startswith('/api/books/drop/'):
            bp = self._book_path(path[len('/api/books/drop/'):])
            if bp is not None:
                try:
                    os.replace(bp, bp + '.gone')
                except OSError:
                    pass
            self._send_bytes(b'{"ok":true}')
            return
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


BOOT_VER = _ver()


def _watch_self():
    # M157: the server relights itself when its own file changes (a pull) —
    # the same port, the new code, no hand. Checked every five seconds.
    import threading, time, sys
    me = os.path.abspath(__file__)
    try:
        born = os.path.getmtime(me)
    except OSError:
        return
    def loop():
        while True:
            time.sleep(5)
            try:
                if os.path.getmtime(me) != born:
                    time.sleep(2)  # let the pull finish writing
                    os.execv(sys.executable, [sys.executable, me] + sys.argv[1:])
            except OSError:
                pass
    threading.Thread(target=loop, daemon=True).start()


if __name__ == '__main__':
    _watch_self()
    # Bind AND print 127.0.0.1 (M13): on some Android setups "localhost"
    # resolves to ::1 while the server sits on IPv4 — the printed URL must
    # be the deterministic one.
    with TavernServer(('127.0.0.1', PORT), TavernHandler) as server:
        print('The tavern is warm at http://127.0.0.1:%d  ·  %s' % (PORT, _ver()), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
