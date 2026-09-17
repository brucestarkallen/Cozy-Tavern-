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

# M186: ONE HAND ON THE LOG AT A TIME. Two browsers can append in the same
# instant, and a page line is several kilobytes — far past the size a single
# write() is atomic for. Interleaved, both lines are ruined and both pages
# lost. Threads share this process, so one lock is all it takes.
_log_lock = threading.Lock()

# M186: and the log is not allowed to grow forever. It is cleared by the
# twenty-second whole-book push — but if that push never lands (the browser
# closed, the tale is huge, a stumble) the log keeps growing and EVERY read
# of that book parses all of it. Past this it is folded into the snapshot on
# the spot, which is exactly what the whole-book push would have done.
LOG_FOLD_BYTES = 2 * 1024 * 1024


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
            # M293: a listener that cannot keep up is not merely forgotten — its
            # stream is ended, so the browser reconnects and looks the books
            # over (sync.js catchUp). Left open, it went on receiving the
            # keep-alives and never another change, and never knew.
            q.dead = True
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


def _now_stamp():
    t = time.time()
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(t)) + ('.%03dZ' % int((t % 1) * 1000))


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
    # M295: a page the snapshot lacks is folded in by the rule the snapshot was
    # pushed under (_fold_missing): a line the pusher wrote, or one it had
    # already seen, is a page it let go — not one to put back.
    pushed_by = str(book.get('pushedBy') or '')
    pushed_base = str(book.get('pushedBase') or '')
    pushed_at = str(book.get('pushedAt') or '')  # a line the pusher wrote AFTER its push is a new page, not one let go
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
                    stamped = row.get('at') if isinstance(row.get('at'), str) else ''
                    if pushed_by and row.get('by') == pushed_by and pushed_at and stamped <= pushed_at:
                        continue  # the pusher's own line, older than its push, absent from its book: let go
                    if pushed_base and stamped and stamped <= pushed_base:
                        continue  # a line it had already seen and left out: let go
                    order.append(mid)
                by_id[mid] = m
    except OSError:
        return book_bytes
    book['messages'] = [by_id[i] for i in order]
    if newest:
        book['exportedAt'] = newest
    return json.dumps(book).encode('utf-8')



def _fold_missing(book_bytes, log_path, by_client='', base=''):
    """The incoming book, plus any appended page it does not already hold —
    except the ones THIS browser appended itself.

    M184 folded back everything the book lacked, which saved another
    browser's page. M185: it also resurrected pages the writer had DELETED.
    "Let this page go" put the page straight back, proven the first time it
    was tried. A timestamp cannot tell the two apart — a browser can export a
    book after a page it has not yet received — but the LOG LINE can, because
    it records which browser appended it:

      a line this browser wrote, missing from this browser's own book
        -> it deleted the page. It stays deleted.
      a line ANOTHER browser wrote, missing from this browser's book
        -> it never had it. It is folded in, and nothing is lost.
    """
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
    mine = str(by_client or '')
    # M206: WHAT THE PUSHER COULD HAVE KNOWN. The by-client rule alone only
    # protected a browser's deletions of its OWN appended pages: a page CHROME
    # appended, which Opera then pulled and the writer deleted in Opera, was
    # folded straight back — "let this page go" undone across browsers. The
    # browser's own bookStamp says what it had already taken in. A line older
    # than that stamp was known to it, so its absence is a deletion; a line
    # newer than it could not have been known, so its absence is the race
    # M184 exists for.
    seen_upto = str(base or '')
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
                if mine and row.get('by') == mine:
                    continue  # this browser appended it and its own book omits it: let go
                stamped = row.get('at')
                if seen_upto and isinstance(stamped, str) and stamped <= seen_upto:
                    continue  # it had this page and left it out: a deletion, not a race
                msgs.append(m)
                have.add(m['id'])
                added += 1
    except OSError:
        return book_bytes
    # M295: THE SNAPSHOT REMEMBERS THE RULE IT WAS FOLDED BY. Who pushed it and
    # what they had seen are written into it, so a read that still finds a
    # log beside it — a kill between the replace and the log's removal, or
    # the fold a big log earns — folds by the same rule instead of by "last
    # line wins", which put back the pages the pusher had let go.
    book['pushedBy'] = mine
    book['pushedBase'] = seen_upto
    book['pushedAt'] = _now_stamp()
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
                if getattr(q, 'dead', False):
                    break  # M293: the browser is told the stream ended; it reconnects and catches up
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
        if path == '/api/backup/now' or path == '/api/backup/list':
            # M310: a safety copy made by the DEVICE, from the files — whatever the library's size
            r = make_backup(force=False) if path.endswith('/now') else {'ok': True}
            r = dict(r)
            r['folder'] = BACKUPS_DIR
            r['copies'] = [{'name': os.path.basename(b), 'bytes': os.path.getsize(b)} for b in _backups()]
            if 'path' in r:
                r['name'] = os.path.basename(r.pop('path'))
            self._send_bytes(json.dumps(r).encode('utf-8'))
            return
        if path == '/api/backup/file':
            have = _backups()
            if not have:
                self.send_response(404); self.end_headers(); return
            newest = have[-1]
            try:
                size = os.path.getsize(newest)
                self.send_response(200)
                self.send_header('Content-Type', 'application/zip')
                self.send_header('Content-Length', str(size))
                self.send_header('Content-Disposition', 'attachment; filename="%s"' % os.path.basename(newest))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                with open(newest, 'rb') as f:
                    while True:
                        chunk = f.read(1024 * 256)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            except (OSError, ConnectionError):
                pass
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
            # M186: the fold, the write and the clear are ONE held stretch —
            # no append may land between reading the log and removing it, or
            # that page is in neither the snapshot nor the log. `with` and not
            # acquire/release: an os error anywhere in here would otherwise
            # leave the lock held and deadlock every later write.
            with _log_lock:
                body = _fold_missing(body, _log_path(bp), self.headers.get('X-Cozy-Client', ''),
                                     self.headers.get('X-Cozy-Base', ''))
                os.makedirs(os.path.dirname(bp), exist_ok=True)
                tmp = bp + '.tmp'
                with open(tmp, 'wb') as f:
                    f.write(body)
                    f.flush()
                    os.fsync(f.fileno())
                # M160: the old copy is COPIED aside, then the new one lands in
                # a single atomic replace. The old order (move the book to
                # .bak1, then move .tmp into place) left a gap in which the
                # book did not exist at all — the other browser's GET met a 404
                # and skipped that tale for the whole boot.
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
                # M185: the line records WHO appended it (see _fold_missing)
                row['by'] = self.headers.get('X-Cozy-Client', '')
                # M206: stamped by the DEVICE, not by whichever browser sent it.
                # The fold below compares this against a browser's own bookStamp,
                # and two browsers' clocks are not a comparison anyone should rest
                # a page on.
                row['at'] = _now_stamp()
                lp = _log_path(bp)
                with _log_lock:
                    with open(lp, 'a', encoding='utf-8') as f:
                        f.write(json.dumps(row, ensure_ascii=False) + '\n')
                        f.flush()
                        os.fsync(f.fileno())
                    # M186: past the cap, fold the log into the snapshot here
                    # and now — the same thing the whole-book push does, so a
                    # push that never comes cannot make every read slower.
                    try:
                        if os.path.getsize(lp) > LOG_FOLD_BYTES:
                            with open(bp, 'rb') as f:
                                snap = f.read()
                            merged = _merge_log(snap, lp)
                            tmp = bp + '.tmp'
                            with open(tmp, 'wb') as f:
                                f.write(merged)
                                f.flush()
                                os.fsync(f.fileno())
                            os.replace(tmp, bp)
                            os.remove(lp)
                    except OSError:
                        pass
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
                    # M187: A TOMBSTONE IS A MARKER, NOT THE WHOLE BOOK. The
                    # drop renamed <id>.json to <id>.json.gone, so letting a
                    # tale go freed NOTHING — a 160-page tale measured 0.6 MB
                    # still sitting there, and the shelf's total did not move.
                    # The manifest only ever reads the tombstone's NAME. The
                    # book, its safety copy and its log all go; an empty file
                    # keeps the name, so the other browser still learns the
                    # tale was let go.
                    for leftover in (_log_path(bp), bp + '.bak1', bp):
                        try:
                            os.remove(leftover)
                        except OSError:
                            pass
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


# M310: THE DEVICE KEEPS ITS OWN SAFETY COPIES — NO BROWSER INVOLVED. "Take a copy" asked the
# BROWSER to fold the whole store into one JSON string (every tale, every page, every checkpoint);
# on a library of thousands of pages a phone's browser cannot hold that string, the button did
# nothing, and the writer had no way to back up the stories he could not afford to lose. The books
# are FILES here; copying files needs no browser at all. At every start, and at most once a day,
# serve.py zips the whole data folder into <data>/backups/ (the newest BACKUPS_KEPT are kept, and an
# unchanged library is not zipped twice); /api/backup/now makes one on demand and /api/backup/file
# hands the newest to the browser as an ordinary download, streamed from disk.
BACKUPS_DIR = os.path.join(DATA_DIR, 'backups')
BACKUPS_KEPT = 5


def _library_files():
    out = []
    for root, dirs, files in os.walk(DATA_DIR):
        if os.path.abspath(root).startswith(os.path.abspath(BACKUPS_DIR)):
            continue
        for name in files:
            if name.endswith('.tmp'):
                continue
            out.append(os.path.join(root, name))
    return sorted(out)


def _library_stamp(files):
    newest = 0.0
    total = 0
    for f in files:
        try:
            st = os.stat(f)
            newest = max(newest, st.st_mtime)
            total += st.st_size
        except OSError:
            pass
    return '%d-%d-%d' % (len(files), total, int(newest))


def _backups():
    try:
        names = sorted(n for n in os.listdir(BACKUPS_DIR) if n.startswith('cozytavern-') and n.endswith('.zip'))
    except OSError:
        names = []
    return [os.path.join(BACKUPS_DIR, n) for n in names]


def make_backup(force=False):
    """Zip the whole library. Returns {ok, path, bytes, files, made} — made False when the newest
    copy already holds exactly this library. Never raises: a backup that cannot be made says why."""
    import zipfile
    try:
        files = _library_files()
        if not files:
            return {'ok': False, 'why': 'there are no books on this device yet'}
        os.makedirs(BACKUPS_DIR, exist_ok=True)
        stamp = _library_stamp(files)
        mark = os.path.join(BACKUPS_DIR, 'last.stamp')
        have = _backups()
        try:
            last = open(mark).read().strip()
        except OSError:
            last = ''
        if have and last == stamp and not force:
            return {'ok': True, 'made': False, 'path': have[-1], 'bytes': os.path.getsize(have[-1]), 'files': len(files)}
        name = 'cozytavern-%s.zip' % time.strftime('%Y%m%d-%H%M%S')
        final = os.path.join(BACKUPS_DIR, name)
        tmp = final + '.part'
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as z:
            for f in files:
                try:
                    z.write(f, os.path.relpath(f, DATA_DIR))
                except OSError:
                    pass
        # a copy is kept only if it can be read back, whole
        with zipfile.ZipFile(tmp) as z:
            bad = z.testzip()
            if bad is not None:
                os.remove(tmp)
                return {'ok': False, 'why': 'the copy could not be read back (%s)' % bad}
            count = len(z.namelist())
        os.replace(tmp, final)
        with open(mark, 'w') as f:
            f.write(stamp)
        for old in _backups()[:-BACKUPS_KEPT]:
            try:
                os.remove(old)
            except OSError:
                pass
        return {'ok': True, 'made': True, 'path': final, 'bytes': os.path.getsize(final), 'files': count}
    except Exception as err:  # never take the server down for a backup
        return {'ok': False, 'why': str(err)}


def _daily_backup():
    have = _backups()
    today = 'cozytavern-' + time.strftime('%Y%m%d')
    if have and os.path.basename(have[-1]).startswith(today):
        return
    make_backup()


if __name__ == '__main__':
    _watch_self()
    try:
        threading.Thread(target=_daily_backup, daemon=True).start()  # M310: a safety copy at every start, once a day
    except Exception:
        pass
    # Bind AND print 127.0.0.1 (M13): on some Android setups "localhost"
    # resolves to ::1 while the server sits on IPv4 — the printed URL must
    # be the deterministic one.
    with TavernServer(('127.0.0.1', PORT), TavernHandler) as server:
        print('The tavern is warm at http://127.0.0.1:%d  ·  %s' % (PORT, _ver()), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
