#!/usr/bin/env python3
"""Cozy Tavern — tiny static server on :8080.

No dependencies beyond the standard library. Serves the app shell with the
right MIME types so ES modules and the web manifest load cleanly.
"""
import http.server
import json
import os
import queue
import shutil
import socketserver
import threading
import time

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



# M182: THE BOOKS ANNOUNCE THEMSELVES. Until now a browser learned of another
# browser's pages only when it next opened — the "in turn" the writer asked
# about. serve.py holds the one copy every browser shares, so it is the only
# thing that can say "this book just changed". A listener holds one long GET
# on /api/events and is handed a line per change; ThreadingMixIn gives each
# its own thread, and there are only ever a handful of browsers.
#
# Every change carries the client that made it, so a browser never pulls back
# its own write — that would replace its newer pages with what it had just
# sent, which is a data loss, not a refresh.
_listeners = []
_listeners_lock = threading.Lock()


def _announce(book_id, by_client):
    line = ('data: ' + json.dumps({'id': book_id, 'by': by_client or '', 'at': time.time()}) + '\n\n').encode('utf-8')
    with _listeners_lock:
        dead = []
        for q in _listeners:
            try:
                q.put_nowait(line)
            except Exception:
                dead.append(q)
        for q in dead:
            try:
                _listeners.remove(q)
            except ValueError:
                pass


# M183: A PAGE IS APPENDED, NOT A BOOK REWRITTEN. Prose goes to the device
# the moment it lands (M181) — and until now "a page landed" meant serializing
# the WHOLE tale and writing it again: 15ms at four hundred pages on a
# desktop, and it grows with every page the writer adds. A page is a few
# kilobytes; the ledger, the snapshots and the sixty version states are what
# make a book heavy, and they can wait for the twenty-second push because the
# readers can rebuild them. So a page is APPENDED to <id>.log — one line,
# fsynced, constant cost whatever the tale's length — and the whole-book push
# folds the log into the snapshot and clears it.
def _log_path(book_path):
    return book_path[:-len('.json')] + '.log'


def _log_stamp(log_path):
    """When the log last moved, as an ISO stamp. M183: the FILE'S MTIME, not
    a field parsed out of it. The first try read the last 4096 bytes and
    regexed for "at" — with six-kilobyte pages that lands in the middle of a
    line and finds nothing, so the manifest reported the snapshot's old stamp
    and no other browser ever learned the tale had changed. Measured exactly
    that. The merged book and the manifest both take the stamp from here, so
    they cannot disagree."""
    try:
        t = os.path.getmtime(log_path)
    except OSError:
        return ''
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(t)) + ('.%03dZ' % int((t % 1) * 1000))


def _merge_log(book_bytes, log_path):
    """The snapshot with its appended pages folded in. Pages merge by id,
    last one wins, so an appended edit replaces the page it edits."""
    try:
        if not os.path.exists(log_path):
            return book_bytes
        book = json.loads(book_bytes)
    except (ValueError, OSError):
        return book_bytes
    msgs = book.get('messages')
    if not isinstance(msgs, list):
        return book_bytes
    by_id = {}
    order = []
    for m in msgs:
        mid = m.get('id') if isinstance(m, dict) else None
        if mid is None:
            continue
        if mid not in by_id:
            order.append(mid)
        by_id[mid] = m
    newest = _log_stamp(log_path)
    try:
        with open(log_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue  # a torn last line from a kill mid-write: skip it, keep the rest
                m = row.get('m') if isinstance(row, dict) else None
                if not isinstance(m, dict) or m.get('id') is None:
                    continue
                mid = m['id']
                if mid not in by_id:
                    order.append(mid)
                by_id[mid] = m
    except OSError:
        return book_bytes
    book['messages'] = [by_id[i] for i in order]
    if newest:
        book['exportedAt'] = newest
    return json.dumps(book).encode('utf-8')



def _fold_missing(book_bytes, log_path):
    """The incoming book, plus any appended page it does not already hold.
    See M184: without this, a whole-book push from one browser erased a page
    another browser had appended but not yet handed over."""
    try:
        if not os.path.exists(log_path):
            return book_bytes
        book = json.loads(book_bytes)
    except (ValueError, OSError):
        return book_bytes
    msgs = book.get('messages')
    if not isinstance(msgs, list):
        return book_bytes
    have = set()
    for m in msgs:
        if isinstance(m, dict) and m.get('id') is not None:
            have.add(m['id'])
    added = 0
    try:
        with open(log_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                m = row.get('m') if isinstance(row, dict) else None
                if not isinstance(m, dict) or m.get('id') is None or m['id'] in have:
                    continue
                msgs.append(m)
                have.add(m['id'])
                added += 1
    except OSError:
        return book_bytes
    if not added:
        return book_bytes
    book['messages'] = msgs
    return json.dumps(book).encode('utf-8')

def _book_stamp(book_path):
    """What the manifest reports: the snapshot's own stamp, or the newest
    appended page's, whichever is later — so another browser knows a tale
    changed even when only its log moved."""
    stamp = ''
    try:
        with open(book_path, 'rb') as f:
            head = f.read(4096).decode('utf-8', 'ignore')
        import re as _re
        m = _re.search(r'"exportedAt"\s*:\s*"([^"]+)"', head)
        if m:
            stamp = m.group(1)
    except OSError:
        pass
    moved = _log_stamp(_log_path(book_path))
    return moved if moved > stamp else stamp

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
        folder = os.path.join(DATA_DIR, 'books')
        out = []
        gone = []
        try:
            for name in sorted(os.listdir(folder)):
                # M160: a tale let go leaves a tombstone (<id>.json.gone). The
                # manifest names it, so the OTHER browser lets the tale go too
                # instead of pushing its own copy back up — a tale deleted in
                # one browser used to be resurrected by the next one to open.
                if name.endswith('.json.gone'):
                    gone.append(name[:-len('.json.gone')])
                    continue
                if not name.endswith('.json'):
                    continue
                path = os.path.join(folder, name)
                try:
                    # M183: the later of the snapshot's own stamp and its
                    # newest appended page — a tale whose log alone moved has
                    # still changed, and the other browser must be told.
                    out.append({'id': name[:-5], 'exportedAt': _book_stamp(path), 'bytes': os.path.getsize(path)})
                except OSError:
                    pass
        except OSError:
            pass
        return json.dumps({'books': out, 'gone': gone}).encode('utf-8')

    def _send_bytes(self, body, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _events(self):
        """One long-lived GET. A line per book change, a comment every twenty
        seconds so a sleeping phone's proxy doesn't reap the connection."""
        q = queue.Queue(maxsize=64)
        with _listeners_lock:
            _listeners.append(q)
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'keep-alive')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()
            self.wfile.write(b': the tavern is listening\n\n')
            self.wfile.flush()
            while True:
                try:
                    line = q.get(timeout=20)
                except queue.Empty:
                    line = b': still here\n\n'
                self.wfile.write(line)
                self.wfile.flush()
        except Exception:
            pass  # the browser went away; that is how a stream ends
        finally:
            with _listeners_lock:
                try:
                    _listeners.remove(q)
                except ValueError:
                    pass

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/events':
            self._events()
            return
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
                # M183: the snapshot with its appended pages folded in
                self._send_bytes(_merge_log(data, _log_path(bp)))
            except OSError:
                self.send_response(404); self.end_headers()
            return
        if self.path.split('?')[0] == '/api/books/stamp':
            # M140: the file's exportedAt alone — boot compares a stamp, never the whole book
            data = _read_books()
            stamp = ''
            if data is not None:
                try:
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
                json.loads(body)
            except ValueError:
                self.send_response(400); self.end_headers(); return
            # M184: A WHOLE BOOK NEVER SWEEPS AWAY ANOTHER BROWSER'S PAGE.
            # The whole-book push clears the log, because the snapshot is
            # meant to contain it. But the pushing browser's copy only holds
            # what IT knew — and a page another browser appended seconds ago,
            # which had not yet reached it, was in that log and nowhere else.
            # Proven: Opera and Chrome each append a page, Opera's twenty-
            # second push lands first, and Chrome's page is simply gone.
            # Anything in the log the incoming book does not already hold is
            # folded into it first; only then is the log cleared.
            body = _fold_missing(body, _log_path(bp))
            os.makedirs(os.path.dirname(bp), exist_ok=True)
            tmp = bp + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(body)
                f.flush()
                os.fsync(f.fileno())
            # M160: the old copy is COPIED aside, then the new one lands in a
            # single atomic replace. The old order (move the book to .bak1,
            # then move .tmp into place) left a gap in which the book did not
            # exist at all — the other browser's GET met a 404 and skipped
            # that tale for the whole boot.
            if os.path.exists(bp):
                try:
                    shutil.copy2(bp, bp + '.bak1')
                except OSError:
                    pass
            os.replace(tmp, bp)
            # M160: a tale pushed again is a tale that stands — clear any
            # tombstone from an earlier delete, or it would never come back.
            try:
                os.remove(bp + '.gone')
            except OSError:
                pass
            # M183: the snapshot now holds everything the log did
            try:
                os.remove(_log_path(bp))
            except OSError:
                pass
            # M182: tell every other browser at once
            _announce(os.path.basename(bp)[:-len('.json')], self.headers.get('X-Cozy-Client', ''))
            self._send_bytes(b'{"ok":true}')
            return
        if path.startswith('/api/books/page/'):
            # M183: ONE PAGE, APPENDED. A few hundred bytes and an fsync,
            # whatever the tale's length — instead of serializing and
            # rewriting the whole book because one page landed.
            bp = self._book_path(path[len('/api/books/page/'):])
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
                row = json.loads(body)
            except ValueError:
                self.send_response(400); self.end_headers(); return
            if not isinstance(row, dict) or not isinstance(row.get('m'), dict) or row['m'].get('id') is None:
                self.send_response(400); self.end_headers(); return
            # a page appended to a tale the device has never seen would sit in
            # a log with no snapshot under it; the browser is told to send the
            # whole book instead.
            if not os.path.exists(bp):
                self._send_bytes(b'{"ok":false,"whole":true}')
                return
            try:
                os.makedirs(os.path.dirname(bp), exist_ok=True)
                with open(_log_path(bp), 'a', encoding='utf-8') as f:
                    f.write(json.dumps(row, ensure_ascii=False) + '\n')
                    f.flush()
                    os.fsync(f.fileno())
            except OSError:
                self.send_response(500); self.end_headers(); return
            _announce(os.path.basename(bp)[:-len('.json')], self.headers.get('X-Cozy-Client', ''))
            self._send_bytes(b'{"ok":true}')
            return
        if path.startswith('/api/books/drop/'):
            bp = self._book_path(path[len('/api/books/drop/'):])
            if bp is not None:
                # M160: the tombstone is written whether or not this device
                # held the book, so a tale let go in one browser is let go
                # everywhere — not pushed back up by the next one to open.
                try:
                    os.makedirs(os.path.dirname(bp), exist_ok=True)
                    try:
                        os.remove(_log_path(bp))
                    except OSError:
                        pass
                    if os.path.exists(bp):
                        os.replace(bp, bp + '.gone')
                    else:
                        with open(bp + '.gone', 'wb') as f:
                            f.write(b'')
                except OSError:
                    pass
                _announce(os.path.basename(bp)[:-len('.json')], self.headers.get('X-Cozy-Client', ''))
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
