#!/usr/bin/env python3
"""Cozy Tavern — tiny static server on :8080.

No dependencies beyond the standard library. Serves the app shell with the
right MIME types so ES modules and the web manifest load cleanly.
"""
import base64
import errno
import http.server
import ipaddress
import json
import os
import queue
import shutil
import socket
import socketserver
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

PORT = int(os.environ.get('PORT', 8080))
ROOT = os.path.dirname(os.path.abspath(__file__))

# M24: the tavern keeps its own books. The tales live in a real file on the
# device — NOT inside the app folder, so even wiping the app never takes them.
# (The browser stays a working copy; this file is the truth.)
DATA_DIR = os.environ.get('COZY_DATA_DIR') or os.path.join(os.path.expanduser('~'), '.cozytavern')
BOOKS = os.path.join(DATA_DIR, 'books.json')
# M569: HIS TALE OUTGREW IT. A tale's book carries its pages AND up to 180 copies of its ledger (120 checkpoints for
# rewinds and branches, 60 for a page's versions) — measured: a cast of 120 people in 180 copies is a 67.6 MB book, over
# the old 64 MB, and the device refused it on every push (silently, until M557 said so). Parsing a book that size costs
# this server ~180 MB more memory and half a second; 256 MB leaves a long tale years of room and stays inside a phone.
MAX_BOOK_BYTES = 256 * 1024 * 1024


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
_log_lock = threading.RLock()  # M681: re-entered only by restore's last try (it copies the library while holding it still)

# M186: and the log is not allowed to grow forever. It is cleared by the
# twenty-second whole-book push — but if that push never lands (the browser
# closed, the tale is huge, a stumble) the log keeps growing and EVERY read
# of that book parses all of it. Past this it is folded into the snapshot on
# the spot, which is exactly what the whole-book push would have done.
LOG_FOLD_BYTES = 2 * 1024 * 1024

# M675 — ONE COPY AT A TIME, AND ONE HAND ON AN ARCHIVE AT A TIME. Two more locks beside the log's.
# _backup_lock is held for the whole of "take a copy" and the whole of "bring a copy back": two zips written at once
# shared one .part name, and a copy taken while another was being put in place would be a zip of half of each.
# _sent_lock is held for every write to a tale's archive of sent words (sent/<tale>.ndjson), and while an archive is
# read for what it holds.
# THE ORDER, wherever more than one is held: _backup_lock, then _log_lock, then _sent_lock. _backup_lock is a plain
# lock — a thread that takes it twice waits on itself for ever — so nothing that holds it may call make_backup or
# restore_backup. M681: _log_lock and _sent_lock are re-entrant, for ONE caller: restore's last try takes its safety copy
# (which takes them for each tale) while it holds both, so the library holds still between that copy and the swap.
_backup_lock = threading.Lock()
_sent_lock = threading.RLock()  # M681: see _log_lock

# M675 — THE LIBRARY HAS AN EPOCH. A copy brought back replaces every book on the device, but a browser that did not
# bring it back still holds the tales as they were, with NEWER stamps: it never took the restored books and pushed its
# old ones back over them (measured by the reviewer: an older zip restored, the other browser's next boot pulled 0
# books and its next push put its 3-page book back on the device). So the device names the library it holds: a few
# characters in <data>/.epoch, written anew every time a copy is brought back ('' while none ever was). The manifest
# says it; a browser sends the one it knows with every write (the header X-Cozy-Epoch, "-" for none); and a write made
# for another epoch is refused whole with 409 — nothing is written. A browser that sends no such header is answered
# exactly as before. The file is not part of the library: never zipped, never moved or removed by a restore.
EPOCH_FILE = os.path.join(DATA_DIR, '.epoch')


def _epoch():
    """The library's epoch: the first word in the epoch file ('' when there is none) — one word, so that whatever
    stands in the file, a browser can always say it back in a header."""
    try:
        with open(EPOCH_FILE, 'r', encoding='utf-8') as f:
            return (f.read(4096).split() or [''])[0]
    except (OSError, ValueError):
        return ''


def _set_epoch(name):
    """The epoch file says `name` ('' = there is none: the file goes). A half-written name never stands (tmp, then one
    replace). Raises OSError."""
    tmp = EPOCH_FILE + '.tmp'
    if not name:
        for gone in (EPOCH_FILE, tmp):
            try:
                os.remove(gone)
            except FileNotFoundError:
                pass
        return
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(name)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, EPOCH_FILE)


def _stale(headers):
    """None when this write may land; otherwise the answer to give instead (409): the write was made for another
    library than the one the device holds now. No X-Cozy-Epoch header (a browser from before M675, curl): it may land,
    as before. The file is read each time, by a caller that already holds the lock its write needs — a restore writes
    the new epoch while it holds both locks, so it can never slip between this check and the write."""
    sent = headers.get('X-Cozy-Epoch')
    if sent is None:
        return None
    sent = sent.strip()
    now = _epoch()
    if ('' if sent == '-' else sent) == now:
        return None
    return {'ok': False, 'stale': True, 'epoch': now}


def _host_port(value, default_port):
    """(name, port) of a Host header, or of the host part of an Origin — lower-cased, with `default_port` where none is
    written: '[::1]:8080' -> ('[::1]', '8080'); 'LocalHost' -> ('localhost', default_port). M675, see _stranger."""
    v = (value or '').strip().lower()
    if v.startswith('['):
        end = v.find(']')
        name, rest = (v[:end + 1], v[end + 1:]) if end > 0 else (v, '')
    else:
        name, colon, port = v.partition(':')
        rest = colon + port
    port = rest[1:] if rest.startswith(':') else ''
    if name.endswith('.'):
        name = name[:-1]
    return name, (port or default_port)


def _announce(book_id, by_client, more=None):
    said = {'id': book_id, 'by': by_client or '', 'at': time.time()}
    if more:
        said.update(more)  # M675: a copy brought back is announced with the library's new epoch
    line = ('data: ' + json.dumps(said) + '\n\n').encode('utf-8')
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


def _tombstone(book_id):
    """The mark a tale let go leaves behind (M160): books/<id>.json.gone."""
    return os.path.join(DATA_DIR, 'books', book_id + '.json.gone')


# M622: SEARCH EVERY TALE ON THE DEVICE. His word: "a search section on the sidebar so I can search words inside the
# story, from the latest story to oldest". The browser holds only the tales it has opened (M313); the device holds them
# all. Each book is read with its appended pages folded in (_merge_log), its visible pages kept flat and lower-cased in
# a small cache keyed by the files' size and time, so a second search does not read the library again. The reading
# mirrors js/engine/search.js searchPages: his words and the story's, no hidden page, the phrase as typed in any case
# across line breaks, the newest page first, a snippet either side, twenty places kept per tale with the full count.
_SEARCH_CACHE = {}
_SEARCH_MIN = 2
_SEARCH_KEPT = 20
_SEARCH_AROUND = 70


def _search_entry(book_path):
    log_path = _log_path(book_path)
    try:
        st = os.stat(book_path)
        lst = os.stat(log_path) if os.path.exists(log_path) else None
    except OSError:
        return None
    stamp = (st.st_mtime_ns, st.st_size, lst.st_mtime_ns if lst else 0, lst.st_size if lst else 0)
    held = _SEARCH_CACHE.get(book_path)
    if held and held[0] == stamp:
        return held[1]
    try:
        with open(book_path, 'rb') as f:
            book = json.loads(_merge_log(f.read(), log_path))
    except (OSError, ValueError):
        return None
    story = book.get('story') if isinstance(book.get('story'), dict) else {}
    msgs = [m for m in (book.get('messages') or []) if isinstance(m, dict)]
    msgs.sort(key=lambda m: m.get('ts') or 0)
    pages = []
    for m in msgs:
        if m.get('hidden') is True or m.get('role') not in ('user', 'assistant'):
            continue
        flat = ' '.join(str(m.get('text') or '').split())
        if flat:
            pages.append((str(m.get('id') or ''), m.get('role'), flat, flat.lower()))
    entry = {
        'id': str(story.get('id') or os.path.basename(book_path)[:-len('.json')]),
        'title': str(story.get('title') or ''),
        'updatedAt': story.get('updatedAt') or 0,
        'pages': pages,
    }
    _SEARCH_CACHE[book_path] = (stamp, entry)
    return entry


def search_books(query):
    key = ' '.join(str(query or '').split()).lower()
    if len(key) < _SEARCH_MIN:
        return []
    folder = os.path.join(DATA_DIR, 'books')
    try:
        names = os.listdir(folder)
    except OSError:
        return []
    out = []
    for name in names:
        if not name.endswith('.json') or name.startswith('_house'):
            continue
        entry = _search_entry(os.path.join(folder, name))
        if not entry:
            continue
        count = 0
        hits = []
        for mid, role, flat, low in reversed(entry['pages']):
            at = low.find(key)
            if at < 0:
                continue
            count += 1
            if len(hits) >= _SEARCH_KEPT:
                continue
            start = max(0, at - _SEARCH_AROUND)
            end = min(len(flat), at + len(key) + _SEARCH_AROUND)
            hits.append({
                'id': mid, 'role': role,
                'before': ('…' if start > 0 else '') + flat[start:at],
                'match': flat[at:at + len(key)],
                'after': flat[at + len(key):end] + ('…' if end < len(flat) else ''),
            })
        if count:
            out.append({'id': entry['id'], 'title': entry['title'], 'updatedAt': entry['updatedAt'], 'count': count, 'hits': hits})
    out.sort(key=lambda r: r['updatedAt'] or 0, reverse=True)
    return out


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
        # M507: the snapshot's own stamp is kept beside the moved one — a browser that already holds this snapshot
        # (its own push, or a pull it recorded) takes only the appended pages and never the snapshot's older ledger
        # (at the front of the book, where the browser reads stamps without parsing the whole file)
        book = {'snapshotAt': book.get('exportedAt', ''), **{k: v for k, v in book.items() if k != 'snapshotAt'}}
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
        '.webp': 'image/webp',   # M678: the academy's map
        '.woff2': 'font/woff2',  # M678: its type
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

    def _sent_path(self, book_id):
        # M671: what each page's storyteller was sent, word for word -- one file a tale, beside the books (so the copy
        # the device zips holds it, and a copy brought back restores it)
        import re as _re
        if not _re.fullmatch(r'[A-Za-z0-9_\-]{1,80}', book_id or ''):
            return None
        return os.path.join(DATA_DIR, 'sent', book_id + '.ndjson')

    def _drain(self):
        """Read past a body that will not be used, so the answer that refuses it can still be read: a connection closed
        with words unread is reset, and the sender may never see why. Nothing is kept."""
        try:
            left = int(self.headers.get('content-length', 0))
        except ValueError:
            left = 0
        left = min(left, MAX_BOOK_BYTES)
        try:
            while left > 0:
                chunk = self.rfile.read(min(left, 65536))
                if not chunk:
                    break
                left -= len(chunk)
        except Exception:
            pass

    def _take_copy_in(self, n):
        """The body of a copy being brought back, read in pieces into a file with no name (it is gone the moment it is
        closed, or the server dies). Returns (the file, open at its start, '') or (None, why it could not be taken in);
        what is left of the body is read past either way, so the answer can still be heard."""
        import tempfile
        left = max(0, n)
        f = None
        try:
            os.makedirs(BACKUPS_DIR, exist_ok=True)
            f = tempfile.TemporaryFile(dir=BACKUPS_DIR)
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                left -= len(chunk)
                f.write(chunk)
            if left > 0:
                f.close()
                return None, 'the copy did not arrive whole (%d bytes of it are missing) — nothing was touched' % left
            f.seek(0)
            return f, ''
        except Exception as err:
            if f is not None:
                try:
                    f.close()
                except Exception:
                    pass
            try:
                while left > 0:  # past the rest, so the sender hears why
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    left -= len(chunk)
            except Exception:
                pass
            return None, 'the copy could not be taken in (%s) — nothing was touched' % _said(err)

    def _stranger(self, method):
        """M675 — ONLY THE TAVERN'S OWN PAGE MAY WRITE HERE, AND ONLY UNDER THE TAVERN'S OWN NAME MAY ANYTHING BE READ.
        This server listens on 127.0.0.1 alone, but every tab open on the phone can reach it. Measured by the reviewer:
        a POST carrying another site's Origin, as text/plain (a "simple" request no browser asks leave for), answered
        200 — so any page he had open could put a zip in place of the library, let a tale go, or write into an archive.
        And a page that points its own name at 127.0.0.1 (DNS rebinding) is, to the browser, this server's own page: it
        could READ everything, the house book and its API keys included. Two checks, both on what the BROWSER says of
        the request and a page cannot forge:
          - every /api/ request, read or write: the Host it was sent to must be this device's own name (127.0.0.1,
            localhost, [::1]) or one named in COZY_HOSTS (comma-separated — for someone who puts a proxy in front).
            No Host at all (an HTTP/1.0 tool) is let through;
          - every POST: refused when the browser says it comes from elsewhere — Sec-Fetch-Site other than same-origin
            or none, or an Origin that is "null" or is not the address the request itself was sent to (Host, or
            X-Forwarded-Host behind a proxy). No Origin and no Sec-Fetch-Site (curl, the tests, an older tool): let
            through, as before.
        The page's own files are not restricted. Answers True when it refused (403, said)."""
        path = self.path.split('?')[0]
        host = self.headers.get('Host')
        if path.startswith('/api/') and host is not None:
            allowed = {'127.0.0.1', 'localhost', '[::1]'}
            allowed.update(_host_port(h, '')[0] for h in os.environ.get('COZY_HOSTS', '').split(',') if h.strip())
            if _host_port(host, '')[0] not in allowed:
                if method == 'POST':
                    self._drain()
                # M675 — THE REFUSAL SAYS WHY, IN WORDS THE APP CAN READ. It was one line of plain text that nothing showed:
                # a browser opened under another name for this device (a LAN address through a forwarder — it worked on
                # the build before) was answered 403 by every /api/ door, took that for "no tavern here", kept every page
                # to itself and said nothing (the second reviewer, the real app: boot unreachable, pages parked, no word
                # on the screen). The answer is refused exactly as before; it now carries the reason, that it is the NAME
                # that was refused, and the name as COZY_HOSTS takes it — nothing of the library — so the app can say
                # that the tavern is running and how to start it for this address.
                self._send_bytes(json.dumps({'ok': False, 'refused': 'host', 'host': _host_port(host, '')[0][:120],
                                             'why': 'this tavern answers only under its own name (127.0.0.1 or localhost)'}).encode('utf-8'), 403)
                return True
        if method != 'POST':
            # M675: and a READ of /api/ asked for by another site's page is refused as well — it could not see the
            # answer, but the asking alone made the device zip its library (api/backup/now) or held a listener's place
            # (api/events). The browser says where a request comes from; the tavern's own page, a download it starts
            # and an address typed by hand say same-origin or none. No Sec-Fetch-Site at all: let through, as before.
            asked = self.headers.get('Sec-Fetch-Site')
            if path.startswith('/api/') and asked is not None and asked.strip().lower() not in ('same-origin', 'none'):
                body = b'this tavern answers only its own page\n'
                self.send_response(403)
                self.send_header('Content-Type', 'text/plain; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return True
            return False
        why = ''
        site = self.headers.get('Sec-Fetch-Site')
        origin = self.headers.get('Origin')
        if site is not None and site.strip().lower() not in ('same-origin', 'none'):
            why = 'this request comes from another site, not from the tavern’s own page'
        elif origin is not None:
            scheme, sep, there = origin.strip().lower().partition('://')
            default = {'http': '80', 'https': '443'}.get(scheme, '')
            own = [h for h in [host] + (self.headers.get('X-Forwarded-Host') or '').split(',') if h and h.strip()]
            if not sep or not there or not any(_host_port(there, default) == _host_port(h, default) for h in own):
                why = 'this request comes from another page (%s), not from the tavern’s own' % origin.strip()[:120]
        if not why:
            return False
        self._drain()
        self._send_bytes(json.dumps({'ok': False, 'refused': 'origin', 'why': why}).encode('utf-8'), 403)  # (M675: `refused` says it is the PAGE that was turned away, not the name)
        return True

    def _half_swapped(self, method):
        """M675 — NOTHING IS READ FROM, OR WRITTEN INTO, A LIBRARY THAT IS HALF-WAY THROUGH A SWAP. While a copy takes the
        library's place its parts are aside in .restore-old: a manifest read at that moment listed no books (and a
        browser that is told the device holds nothing pushes its own), and a book written then landed among the copy's
        parts. So a request that finds .restore-old waits for the swap to end (_recover_restore waits on the same lock)
        — or, if it was left by a server that died, has it put right first — and then goes on. Only if the library
        could not be put back yet is the request refused: 503, which a browser reads as "the device did not answer" —
        it keeps what it has and asks again, and nothing is written into a library that is about to be put back.
        Answers True when it refused."""
        path = self.path.split('?')[0]
        if not path.startswith(('/api/books', '/api/backup/', '/api/recover/')) or path == '/api/backup/restore':
            return False  # (a copy brought back looks for itself, and says why in its own answer)
        if not os.path.lexists(RESTORE_OLD):
            return False
        why = _recover_restore()
        if not why:
            return False
        if method == 'POST':
            self._drain()
        self._send_bytes(json.dumps({'ok': False, 'why': why}).encode('utf-8'), 503)
        return True

    def _manifest(self):
        # M675: the library's epoch is read BEFORE its books are listed. A copy brought back between the two then gives
        # the old epoch beside the new books — and a write made on that reading is refused (409), so the browser looks
        # again. Read after, it could give the new epoch beside the old books, and that browser's writes would land.
        epoch = _epoch()
        folder = os.path.join(DATA_DIR, 'books')
        out = []
        gone = []
        # M675 — "NO BOOKS" IS SAID ONLY OF A DEVICE THAT HOLDS NONE. Any failure to list the folder was answered as an
        # empty list — and an empty list is what tells a browser "this device holds nothing: send it everything you
        # hold" (whatever epoch that browser remembers: an empty device is never "a copy brought back"). Only a
        # folder that is not there is a device with no books; a folder that cannot be read raises, and the door
        # says so (do_GET: 503 with the reason) — measured: a books folder that could not be listed answered 200
        # {"books": []}.
        try:
            names = sorted(os.listdir(folder))
        except FileNotFoundError:
            names = []
        for name in names:
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
        return json.dumps({'books': out, 'gone': gone, 'epoch': epoch}).encode('utf-8')

    def _send_bytes(self, body, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _unwritten(self, stale):
        """M675: the answer to a write that was NOT made — it was made for another epoch of the library (409, naming
        the epoch the device holds now), or for the archive of a tale that was let go (410)."""
        if stale is not None:
            self._send_bytes(json.dumps(stale).encode('utf-8'), 409)
        else:
            self._send_bytes(b'{"ok":false,"gone":true}', 410)

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

    def _relay_allowed(self, target):
        """M353: https only, and never a machine on his own network — this server carries the storyteller's post to a
        provider, not a way into the phone or the router behind it. (The tests reach a local stand-in with
        COZY_RELAY_TEST=1.)"""
        bits = urllib.parse.urlparse(target)
        testing = os.environ.get('COZY_RELAY_TEST') == '1'
        if bits.scheme != 'https' and not (testing and bits.scheme == 'http'):
            return 'the relay carries https only'
        host = bits.hostname or ''
        if not host:
            return 'the relay needs an address'
        try:
            infos = socket.getaddrinfo(host, None)
        except Exception:
            return 'that address could not be found'
        for info in infos:
            try:
                ip = ipaddress.ip_address(info[4][0])
            except ValueError:
                continue
            if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast) and not testing:
                return 'the relay does not carry to your own network'
        return ''

    def _relay(self):
        """M353: THE PROVIDER THAT REFUSES A WEB PAGE. A page can only call an address that answers a browser with its
        own permission (CORS); a provider that never meant to be called from a page refuses, and curl works where the
        tavern does not. This server stands on the same phone as the tavern: it carries the post as it is, streams the
        answer back as it comes, and keeps nothing — the key is in the headers of one request and is never written down."""
        target = self.headers.get('X-Relay-Url', '')
        why = self._relay_allowed(target)
        if why:
            self._send_bytes(json.dumps({'error': {'message': why}}).encode('utf-8'), 400)
            return
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length > 0 else None
        headers = {'Content-Type': 'application/json', 'Accept': self.headers.get('Accept', '*/*')}
        packed = self.headers.get('X-Relay-Headers', '')
        if packed:
            try:
                given = json.loads(base64.b64decode(packed).decode('utf-8'))
                for key, value in given.items():
                    if isinstance(key, str) and isinstance(value, str) and key.lower() not in ('host', 'content-length', 'origin', 'referer', 'cookie'):
                        headers[key] = value
            except Exception:
                pass
        method = (self.headers.get('X-Relay-Method', 'POST') or 'POST').upper()
        if method not in ('POST', 'GET'):
            self._send_bytes(json.dumps({'error': {'message': 'the relay carries a post or a get'}}).encode('utf-8'), 400)
            return
        req = urllib.request.Request(target, data=body if method == 'POST' else None, headers=headers, method=method)
        try:
            up = urllib.request.urlopen(req, timeout=900)
        except urllib.error.HTTPError as err:  # the provider's own no, word for word, with its own number
            said = b''
            try:
                said = err.read()
            except Exception:
                said = b''
            self.send_response(err.code)
            self.send_header('Content-Type', err.headers.get('Content-Type', 'application/json') if err.headers else 'application/json')
            self.send_header('Content-Length', str(len(said)))
            self.end_headers()
            if said:
                self.wfile.write(said)
            return
        except Exception as err:
            self._send_bytes(json.dumps({'error': {'message': 'the relay could not reach the provider: ' + str(err)}}).encode('utf-8'), 502)
            return
        try:
            self.send_response(up.status)
            self.send_header('Content-Type', up.headers.get('Content-Type', 'application/json'))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()
            while True:
                chunk = up.read1(8192) if hasattr(up, 'read1') else up.read(1)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except Exception:
            pass  # the page went away, or the provider did; that is how a stream ends
        finally:
            try:
                up.close()
            except Exception:
                pass

    def do_GET(self):
        if self._stranger('GET'):  # M675: /api/ answers only under this device's own name
            return
        if self._half_swapped('GET'):  # M675: never a library half-way through a swap
            return
        path = self.path.split('?')[0]
        if path == '/api/relay':  # M353: the tavern asks once whether this house can carry a refused call
            self._send_bytes(json.dumps({'relay': True}).encode('utf-8'))
            return
        if path == '/api/events':
            self._events()
            return
        if path == '/api/version':
            # M157: the version this PROCESS started with — the launcher compares it to the folder
            self._send_bytes(('{"version":"%s"}' % BOOT_VER).encode('utf-8'))
            return
        if path == '/api/books/list':
            # M675: the list is never read half-way through a swap, and a list that could not be read is never "no books".
            # The door looks for a swap BEFORE it lists (_half_swapped, above) — and a copy beginning to take the
            # library's place between that look and the listing moved the books aside under it: the answer was an
            # empty list (measured: 200 {"books": []} with every book standing in .restore-old). If a swap is found
            # once the books are listed, the door waits for the library to stand again and lists it anew.
            try:
                body = self._manifest()
                if os.path.lexists(RESTORE_OLD):
                    if self._half_swapped('GET'):
                        return
                    body = self._manifest()
            except OSError as err:
                self._send_bytes(json.dumps({'ok': False, 'why': 'the books on this device could not be listed (%s)' % (err.strerror or _said(err))}).encode('utf-8'), 503)
                return
            self._send_bytes(body)
            return
        if path == '/api/books/search':
            # M622: every tale on the device, the latest first
            from urllib.parse import urlparse, parse_qs
            q = (parse_qs(urlparse(self.path).query).get('q') or [''])[0]
            self._send_bytes(json.dumps({'ok': True, 'results': search_books(q)}).encode('utf-8'))
            return
        if path == '/api/recover/projects':
            # M311: the names of shelves, wherever this device still holds them
            self._send_bytes(json.dumps({'ok': True, 'projects': recover_projects()}).encode('utf-8'))
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
            # M675 — THE COPY ASKED FOR BY NAME IS THE COPY HANDED OVER. api/backup/now made a copy and said its name;
            # this door then handed over "the newest", which was the last NAME — and a copy is named by the device's
            # local time. With the clock an hour back (a time zone crossed westward, a clock put right), measured by
            # the second reviewer: now made …110000.zip, this door sent …120000.zip — the copy from before, without
            # the page written since, saved under the new one's name. ?name=<the name now gave> is answered with that
            # zip or with nothing: the name must be the name of a copy standing in the backups folder (it is looked
            # for among them, never joined to a path), so nothing else on the device can be asked for through it.
            # Without a name: the copy made last (_backups: in the order they were made).
            from urllib.parse import urlparse, parse_qs
            asked = parse_qs(urlparse(self.path).query, keep_blank_values=True).get('name')
            if asked is not None:
                have = [b for b in have if os.path.basename(b) == asked[0]]
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
        if path.startswith('/api/books/sent/'):  # M671: the archive of what each page was sent -- asked what it holds, or for one page
            sp = self._sent_path(path[len('/api/books/sent/'):])
            if sp is None:
                self.send_response(400); self.end_headers(); return
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            # M675: a tale let go says so (410) — not "no archive yet" (404), which a browser reads as leave to send
            # its words again (see the POST below)
            if os.path.exists(_tombstone(os.path.basename(sp)[:-len('.ndjson')])):
                self._send_bytes(b'{"gone":true}', 410); return
            if not os.path.exists(sp):
                self.send_response(404); self.end_headers(); return
            try:
                if q.get('have'):
                    self._send_bytes(json.dumps(_sent_have(sp)).encode('utf-8'))
                elif q.get('page'):
                    one = _sent_page(sp, q['page'][0])
                    if one is None:
                        self.send_response(404); self.end_headers()
                    else:
                        one['storyId'] = os.path.basename(sp)[:-len('.ndjson')]
                        self._send_bytes(json.dumps(one).encode('utf-8'))
                else:
                    self.send_response(400); self.end_headers()
            except OSError:
                self.send_response(404); self.end_headers()
            return
        if path.startswith('/api/books/one/'):
            bp = self._book_path(path[len('/api/books/one/'):])
            if bp is None:
                self.send_response(400); self.end_headers(); return
            try:
                # M675: the book and its log are read in ONE hold of the log's lock. A whole-book push folds the log
                # into the book and removes it under that lock; read without it, a push landing between the two reads
                # gave the OLD book and no log — a tale missing its newest pages, handed to the browser as the device's
                # (the fault forced for the device's zip, in the same shape, on the read path).
                with _log_lock:
                    with open(bp, 'rb') as f:
                        data = f.read()
                    # M183: the snapshot with its appended pages folded in
                    merged = _merge_log(data, _log_path(bp))
                self._send_bytes(merged)
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
        if self._stranger('POST'):  # M675: only the tavern's own page may write here
            return
        if self._half_swapped('POST'):  # M675: never a library half-way through a swap
            return
        path = self.path.split('?')[0]
        if path == '/api/relay':  # M353
            self._relay()
            return
        if path == '/api/backup/restore':  # M510-47: bring a copy back, on the device
            try:
                n = int(self.headers.get('content-length', 0))
            except ValueError:
                n = 0
            # M675: THE COPY IS TAKEN IN ON THE STORAGE, NEVER WHOLE IN MEMORY. The zip was read into memory in one piece
            # (self.rfile.read(n)) before a byte of it was looked at — measured, bringing back a copy of 96 MB: the
            # most memory the server had used rose by 97 MB, the whole copy; a library's copy only grows, and a phone
            # that cannot spare that much could not bring its own copy back. It is read a megabyte at a time into a
            # nameless file beside the backups and the zip is read from there: the same copy, 2 MB
            # (tests/device_guard.py, scene 11).
            took, why = self._take_copy_in(n)
            try:
                r = restore_backup(took) if took is not None else {'ok': False, 'why': why}
            finally:
                if took is not None:
                    try:
                        took.close()
                    except Exception:
                        pass
            r = dict(r)
            r['folder'] = BACKUPS_DIR
            self._send_bytes(json.dumps(r).encode('utf-8'))
            return
        if path.startswith('/api/books/sent/'):  # M671: new lines are added to the tale's archive; nothing in it is ever rewritten
            sp = self._sent_path(path[len('/api/books/sent/'):])
            if sp is None:
                self.send_response(400); self.end_headers(); return
            try:
                n = int(self.headers.get('content-length', 0))
            except ValueError:
                n = 0
            if n <= 0 or n > MAX_BOOK_BYTES:
                self.send_response(413); self.end_headers(); return
            body = self.rfile.read(n)
            # M675 — A TALE LET GO IS NOT WRITTEN TO AGAIN. This branch made an archive for any name at all, and the
            # browser sends a page's words four minutes after the page: a tale let go inside those minutes had its
            # archive written back beside its tombstone, for good (the reviewer: keep a page, let the tale go, fire
            # the timer — sent/<tale>.ndjson is there again, 33,285 bytes, and in the next zip). While the tombstone
            # stands nothing is written and the answer is 410; the look and the write are one held stretch with the
            # letting-go (which holds _sent_lock too), so neither can land between the other's halves. A whole-book
            # push of that tale clears the tombstone, as before — and then its archive may be written again.
            gone = _tombstone(os.path.basename(sp)[:-len('.ndjson')])
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query, keep_blank_values=True)
            if 'from' in q:
                # M675: a branch's carried pages are copied from the parent's archive into its own (_sent_copy) —
                # POST /api/books/sent/<branch>?from=<parent> with {"pages": [page ids]}, 20,000 at most.
                # from=* : from whichever archive holds them (a branch made before the browser knew to ask, healed
                # when it is opened) — every archive on the device is looked through, this tale's own last
                everywhere = q['from'][0] == '*'
                src = sp if everywhere else self._sent_path(q['from'][0])
                wanted = None
                try:
                    said = json.loads(body)
                    if isinstance(said, dict) and isinstance(said.get('pages'), list) and len(said['pages']) <= 20000 and all(isinstance(x, str) for x in said['pages']):
                        wanted = list(dict.fromkeys(said['pages']))
                except ValueError:
                    pass
                if src is None or wanted is None:
                    self.send_response(400); self.end_headers(); return
                copied, missing = 0, []
                try:
                    with _sent_lock:
                        stale = _stale(self.headers)
                        let_go = os.path.exists(gone)
                        if stale is None and not let_go:
                            if everywhere:
                                missing = wanted
                                folder = os.path.dirname(sp)
                                try:
                                    names = sorted(n for n in os.listdir(folder) if n.endswith('.ndjson'))
                                except OSError:
                                    names = []
                                for name in names:
                                    if not missing:
                                        break
                                    one = os.path.join(folder, name)
                                    if one == sp:
                                        continue
                                    n, missing = _sent_copy(one, sp, missing)
                                    copied += n
                            else:
                                copied, missing = _sent_copy(src, sp, wanted)
                except Exception as err:
                    self._send_bytes(json.dumps({'ok': False, 'why': str(err)}).encode('utf-8'), 500)
                    return
                if stale is not None or let_go:
                    self._unwritten(stale)
                else:
                    self._send_bytes(json.dumps({'ok': True, 'copied': copied, 'missing': missing}).encode('utf-8'))
                return
            lines = [ln for ln in body.split(b'\n') if ln.strip()]
            try:
                for ln in lines:
                    row = json.loads(ln)
                    if not (isinstance(row, dict) and ((isinstance(row.get('k'), str) and isinstance(row.get('t'), str)) or isinstance(row.get('p'), dict))):
                        raise ValueError('not a line of the archive')
            except ValueError:
                self.send_response(400); self.end_headers(); return
            try:
                # M675: one hand at a time, and the lines land whole or not at all (_sent_append)
                with _sent_lock:
                    stale = _stale(self.headers)
                    let_go = os.path.exists(gone)
                    if stale is None and not let_go:
                        _sent_append(sp, [b'\n'.join(lines) + b'\n'])
            except OSError as err:
                self._send_bytes(json.dumps({'ok': False, 'why': str(err)}).encode('utf-8'), 500)
                return
            if stale is not None or let_go:
                self._unwritten(stale)
            else:
                self._send_bytes(json.dumps({'ok': True, 'lines': len(lines)}).encode('utf-8'))
            return
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
                # M675: a book written for another epoch of the library (a copy was brought back since this browser
                # last looked) is refused whole — looked at inside the hold, so no restore can land between the
                # look and the write
                stale = _stale(self.headers)
                if stale is None:
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
            if stale is not None:
                self._unwritten(stale)
                return
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
            # M675: looked at INSIDE the hold below, with the library's epoch — not before it. A tale let go, or a
            # copy brought back, between the look and the write left the page in a log with no snapshot under it
            # after all.
            try:
                # M185: the line records WHO appended it (see _fold_missing)
                row['by'] = self.headers.get('X-Cozy-Client', '')
                lp = _log_path(bp)
                with _log_lock:
                    stale = _stale(self.headers)
                    unseen = not os.path.exists(bp)
                    if stale is None and not unseen:
                        os.makedirs(os.path.dirname(bp), exist_ok=True)
                        # M206: stamped by the DEVICE, not by whichever browser sent it.
                        # The fold below compares this against a browser's own bookStamp,
                        # and two browsers' clocks are not a comparison anyone should rest
                        # a page on.
                        # M675: and stamped once the log is held, not while waiting for it. A copy being taken now
                        # holds the log for as long as one tale takes to zip; a page stamped before that wait, and
                        # written after this browser's own whole-book push had gone in ahead of it, carried a stamp
                        # OLDER than the push — which is how _merge_log knows a page the pusher let go, so the new
                        # page was left out of every read until the next push.
                        row['at'] = _now_stamp()
                        # M675: the line lands whole or not at all (_append_whole). It was written through a buffered
                        # file: a write that failed left the first part of a line, and the next page was written
                        # straight after it on the same line — both unreadable, the next page lost from every read
                        # until a whole-book push (the fault measured in the archive of sent words, in the same shape).
                        _append_whole(lp, [(json.dumps(row, ensure_ascii=False) + '\n').encode('utf-8')])
                        # M186: past the cap, fold the log into the snapshot here
                        # and now — the same thing the whole-book push does, so a
                        # push that never comes cannot make every read slower.
                        try:
                            if os.path.getsize(lp) > LOG_FOLD_BYTES:
                                with open(bp, 'rb') as f:
                                    snap = f.read()
                                merged = _merge_log(snap, lp)
                                # M675: the log goes only when its pages are IN the snapshot. _merge_log hands the
                                # snapshot back untouched when it cannot fold (a snapshot it cannot read, a log it
                                # cannot open) — and the log was removed all the same: its pages were in neither.
                                # Then the log stays, and is folded by the next whole-book push.
                                if merged is not snap:
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
            if stale is not None:
                self._unwritten(stale)
                return
            if unseen:
                self._send_bytes(b'{"ok":false,"whole":true}')
                return
            _announce(os.path.basename(bp)[:-len('.json')], self.headers.get('X-Cozy-Client', ''))
            self._send_bytes(b'{"ok":true}')
            return
        if path.startswith('/api/books/drop/'):
            bp = self._book_path(path[len('/api/books/drop/'):])
            if bp is not None:
                # M160: the tombstone is written whether or not this device
                # held the book, so a tale let go in one browser is let go
                # everywhere — not pushed back up by the next one to open.
                # M675: the letting-go is ONE held stretch, and it took no hold at all. With the log's lock: no page
                # lands between the book going and its tombstone standing, and the library's epoch is looked at
                # inside it (a tale let go by a browser that has not yet seen a copy brought back is not let go in
                # that copy). With the archive's lock: the look-then-write of its sent words (above) cannot straddle
                # the archive going and the tombstone standing.
                with _log_lock, _sent_lock:
                    stale = _stale(self.headers)
                    if stale is None:
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
                            for leftover in (_log_path(bp), bp + '.bak1', bp, os.path.join(DATA_DIR, 'sent', os.path.basename(bp)[:-len('.json')] + '.ndjson')):  # M671: its sent words go with it
                                try:
                                    os.remove(leftover)
                                except OSError:
                                    pass
                            with open(bp + '.gone', 'wb') as f:
                                f.write(b'')
                        except OSError:
                            pass
                        # M675: and what was remembered of its archive goes too
                        _SENT_HELD.pop(os.path.join(DATA_DIR, 'sent', os.path.basename(bp)[:-len('.json')] + '.ndjson'), None)
                if stale is not None:
                    self._unwritten(stale)
                    return
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
            with _log_lock:  # M675: no book is written while a copy is being put in place (restore_backup holds this)
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


RESTORE_STAGE = os.path.join(DATA_DIR, '.restore-stage')  # M510-47: a copy is read out here, whole, before it replaces anything
RESTORE_OLD = os.path.join(DATA_DIR, '.restore-old')  # M675: the library as it stood is set aside here while a copy takes its place


def _outside_library(folder):
    """True for a folder the library does not reach into: the safety copies, and the two a restore works in."""
    here = os.path.abspath(folder)
    return here.startswith(os.path.abspath(BACKUPS_DIR)) or here.startswith(os.path.abspath(RESTORE_STAGE)) or here.startswith(os.path.abspath(RESTORE_OLD))


def _library_files():
    out = []
    top = os.path.abspath(DATA_DIR)
    for root, dirs, files in os.walk(DATA_DIR):
        if _outside_library(root):
            continue
        for name in files:
            if name.endswith('.tmp'):
                continue
            if name == '.epoch' and os.path.abspath(root) == top:
                continue  # M675: the library's epoch names the library; it is not part of it
            # M571: a book's .bak1/.bak2 is this device's own guard against a write cut off mid-way — the copy of the
            # book from the push before. Zipped too, every book was in each safety copy TWICE (it and its last
            # version), five copies kept. A safety copy is itself the earlier version; its books are enough.
            if name.endswith('.bak1') or name.endswith('.bak2'):
                continue
            out.append(os.path.join(root, name))
    return sorted(out)


def _library_stamp(files):
    # M675: the newest change to the billionth of a second, not to the second. With whole seconds, a book rewritten at
    # the same length within the second of the last copy left this note unchanged — "nothing changed since the last
    # copy" — and the copy handed over was the one from before that write.
    newest = 0
    total = 0
    for f in files:
        try:
            st = os.stat(f)
            newest = max(newest, st.st_mtime_ns)
            total += st.st_size
        except OSError:
            pass
    return '%d-%d-%d' % (len(files), total, newest)


# M671: THE ARCHIVE OF WHAT EACH PAGE'S STORYTELLER WAS SENT. One file a tale (sent/<tale>.ndjson), one line a thing: a piece of
# text {"k": key, "t": text} or a page's record {"p": {...}} whose parts and requests name their pieces by key. Lines are
# only ever added. The browser keeps the newest pages; this file keeps them all -- so it is asked, never read whole.
#
# M675 — A CUT LINE IS NEVER TAKEN FOR A WHOLE ONE, AND NEVER SPOILS THE NEXT. A write that failed (the storage full, the
# server killed mid-append) left the first part of a line with no end. Two things then went wrong, both measured by the
# reviewer. The next lines were written straight after it, on the same line — so the cut line and the first new one
# were both unreadable though the browser had been answered "ok" (storage filled during page 4's push; room was freed;
# later pushes answered ok; the device listed five pages and page 4 could not be read back). And "what do you hold?"
# was answered from each line's first few characters, so the cut piece was listed as held: the browser never sent it
# again, and every page that used it read back as nothing. Now:
#   - a line is held only when the WHOLE line reads as what it should be (_sent_piece, _sent_record) — the very test
#     the reading of a page uses — and a page only with every piece it names, so what is listed as held is what can
#     be read back, and what an older failure spoiled is asked for again;
#   - before anything is added, an archive that does not end in a line break is given one: the cut line stays alone on
#     its own line (nothing already written is ever rewritten) and the new lines begin clean;
#   - an addition lands whole or not at all: if the write fails, the file is cut back to where it stood (_sent_append);
#   - one hand at a time (_sent_lock).
# Reading every line whole costs more than reading its opening (the reviewer's archive was 133 MB), so what an archive
# holds is remembered (_SENT_HELD) and only the lines added since are read. The memory is dropped when the file is not
# the one that was read — another file under the name, a shorter one, one changed without growing, or different words
# where the last line read used to end — and outright when a tale is let go or a copy is brought back.
_SENT_HELD = {}
SENT_HELD_MAX = 12


def _sent_piece(ln):
    """A piece's line, read whole: (key, text). None for any other line — a cut one, one that is not a piece, or one
    whose key the reading of a page could not find by (_sent_page looks for a piece by the line's opening bytes)."""
    if not ln.startswith(b'{"k":"'):
        return None
    end = ln.find(b'"', 6)
    if end <= 6:
        return None
    try:
        row = json.loads(ln)
    except ValueError:
        return None
    if not isinstance(row, dict) or not isinstance(row.get('k'), str) or not isinstance(row.get('t'), str):
        return None
    if ln[6:end].decode('utf-8', 'replace') != row['k']:
        return None
    return row['k'], row['t']


def _sent_record(ln):
    """A page's line, read whole: its record, a dict with a string id. None for any other line — a cut one, one that
    is not a page's, or one whose id is not where the reading of a page looks for it (the line's first 400 bytes)."""
    if not ln.startswith(b'{"p":'):
        return None
    try:
        row = json.loads(ln)
    except ValueError:
        return None
    record = row.get('p') if isinstance(row, dict) else None
    if not isinstance(record, dict) or not isinstance(record.get('id'), str) or not record['id']:
        return None
    if ('"id":' + json.dumps(record['id'])).encode('utf-8') not in ln[:400]:
        return None
    return record


def _sent_keys(record):
    """Every piece a page's record names: the lists of its parts (slots[].t) and each {"$cozyText": [keys]} in the
    bodies of its requests."""
    need = set()
    def walk(v):
        if isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, dict):
            keys = v.get('$cozyText')
            if isinstance(keys, list) and len(v) == 1:
                need.update(k for k in keys if isinstance(k, str))
            else:
                for x in v.values():
                    walk(x)
    for slot in record.get('slots') or []:
        if isinstance(slot, dict):
            need.update(k for k in (slot.get('t') or []) if isinstance(k, str))
    for req in record.get('requests') or []:
        if isinstance(req, dict):
            walk(req.get('body'))
    return need


def _sent_held(path):
    """What an archive holds — {'pages': ids with a whole record, 'pieces': keys with a whole line, 'lacking': {page id:
    the keys its record names that no whole line holds}, …} — read once, and after that only where it has grown.
    The caller holds _sent_lock. Raises OSError when there is no archive to read."""
    st = os.stat(path)
    was = _SENT_HELD.get(path)
    if was is not None:
        if was['file'] != (st.st_dev, st.st_ino) or st.st_size < was['read'] or (st.st_size == was['size'] and st.st_mtime_ns != was['mtime']):
            was = None  # another file under this name, a shorter one, or one changed without growing: read it all again
        elif st.st_size == was['size']:
            return was  # nothing was added since it was last read
    with open(path, 'rb') as f:
        if was is not None and was['tail']:
            f.seek(was['read'] - len(was['tail']))
            if f.read(len(was['tail'])) != was['tail']:
                was = None  # longer, but not the lines that were read (a file put in its place by hand): read it all again
        held = was if was is not None else {'file': (st.st_dev, st.st_ino), 'read': 0, 'tail': b'', 'pages': set(), 'pieces': set(), 'lacking': {}}
        f.seek(held['read'])
        for ln in f:
            if not ln.endswith(b'\n'):
                break  # a last line with no end (a write cut short): not held, and looked at again once it has one
            piece = _sent_piece(ln)
            if piece is not None:
                held['pieces'].add(piece[0])
            else:
                record = _sent_record(ln)
                if record is not None:
                    # the last record written for a page stands (_sent_page): what THAT one lacks is what the page lacks
                    held['pages'].add(record['id'])
                    lack = _sent_keys(record) - held['pieces']
                    if lack:
                        held['lacking'][record['id']] = lack
                    else:
                        held['lacking'].pop(record['id'], None)
            held['read'] += len(ln)
            held['tail'] = ln[-64:]
    for page_id in [i for i, lack in held['lacking'].items() if lack <= held['pieces']]:
        del held['lacking'][page_id]  # its missing piece has been written since (the browser sent it again)
    held['size'] = st.st_size
    held['mtime'] = st.st_mtime_ns
    _SENT_HELD.pop(path, None)
    _SENT_HELD[path] = held  # (the one read last is the newest in the dict)
    # M675: the archives of the dozen tales asked about last are remembered, no more — "take a copy" asks about every
    # tale this browser has words for, and each memory holds every key of its archive
    while len(_SENT_HELD) > SENT_HELD_MAX:
        _SENT_HELD.pop(next(iter(_SENT_HELD)))
    return held


def _sent_have(path):
    """Which pages and which pieces the archive holds -- each one a line that reads whole (M675: not just a line's
    opening; see _SENT_HELD above). A page is held only with every piece its record names: the browser sends a page's
    pieces first and its record last, so a record whose piece is missing is the mark of an older failure (the next
    lines glued to a cut one; a cut piece listed as held and so never sent) — left out of this list, the browser
    sends that page and its missing pieces again, and it reads whole."""
    with _sent_lock:
        held = _sent_held(path)
        return {'pages': sorted(held['pages'] - held['lacking'].keys()), 'pieces': sorted(held['pieces'])}


def _sent_page(path, page_id):
    """One page's record with exactly the pieces it names -- {kind, v, pages: [record], pieces: [{k, t}]} -- or None."""
    record = None
    mark = ('"id":' + json.dumps(page_id)).encode('utf-8')
    with open(path, 'rb') as f:
        for ln in f:
            if ln.startswith(b'{"p":') and mark in ln[:400]:
                row = _sent_record(ln)
                if row is not None and row['id'] == page_id:
                    record = row  # the last one written stands
    if record is None:
        return None
    need = _sent_keys(record)
    pieces = {}
    with open(path, 'rb') as f:
        for ln in f:
            if ln.startswith(b'{"k":"'):
                end = ln.find(b'"', 6)
                if end > 6 and ln[6:end].decode('utf-8', 'replace') in need:
                    piece = _sent_piece(ln)
                    if piece is None:
                        continue  # a cut line: a whole copy of the piece, earlier or later in the file, is the one read (M675)
                    pieces[piece[0]] = piece[1]
    return {'kind': 'cozytavern.sent', 'v': 1, 'pages': [record], 'pieces': [{'k': k, 't': t} for k, t in pieces.items()]}


def _write_all(f, data):
    """Every byte of `data` through an unbuffered file. One write may take only part (the storage filling); a write
    that takes nothing is a failure, not a reason to ask again for ever."""
    view = memoryview(data)
    while len(view):
        n = f.write(view)
        if not n:
            raise OSError(errno.EIO, 'the write took nothing')
        view = view[n:]


def _append_whole(path, chunks):
    """M675 — LINES ADDED TO A FILE THAT ONLY GROWS: ALL OF THEM, OR NONE. `chunks` yields bytes that together are whole
    lines, each ending in a line break. A file left ending mid-line by an older failure is given its line break first,
    so the cut line stands alone on its own line (nothing already written is ever rewritten) and the new lines begin
    clean. If anything fails, the file is cut back to the length it had (or removed, if it was not there), so no half
    line is left for the next write to be glued to. Unbuffered on purpose: a buffered file that failed to flush tries
    again when it is closed, and would write the rest AFTER the file was cut back.
    For a tale's archive of sent words (under _sent_lock) and a book's log of appended pages (under _log_lock).
    Raises OSError (or whatever `chunks` raises), with the file as it stood."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        size = os.path.getsize(path)
        stood = True
    except OSError:
        size, stood = 0, False
    try:
        cut = False
        if size:
            with open(path, 'rb') as f:
                f.seek(size - 1)
                cut = f.read(1) != b'\n'
        with open(path, 'ab', buffering=0) as f:
            if cut:
                _write_all(f, b'\n')
            for chunk in chunks:
                _write_all(f, chunk)
            os.fsync(f.fileno())
    except BaseException:
        try:
            if stood:
                os.truncate(path, size)
            else:
                os.remove(path)
        except OSError:
            pass
        raise


def _sent_append(path, chunks):
    """Lines added to a tale's archive of sent words, all of them or none (_append_whole). The caller holds _sent_lock."""
    try:
        _append_whole(path, chunks)
    except BaseException:
        _SENT_HELD.pop(path, None)  # what was remembered of it may have seen lines that are gone again
        raise


def _sent_copy(src, dst, wanted):
    """M675 — A BRANCH'S CARRIED PAGES GO WITH IT. A branch is a new tale, and the pages it carries kept their sent words
    under the PARENT's name: asked under its own name the device had nothing (the reviewer: the page read under the
    parent — words; under the branch — 404), and letting the parent go deleted the only copy. The browser now asks,
    when a branch is made, for those pages to be copied from the parent's archive into the branch's.
    For each page id in `wanted`: the last whole record of it in `src` and the last whole line of every piece it names
    (the walk _sent_page does). A page with a piece missing is not copied. Added to `dst`, as one addition that lands
    whole or not at all (_sent_append): the piece lines `dst` does not hold, then the page lines it does not hold —
    the very bytes of `src`, pieces first, pages last. The caller holds _sent_lock.
    Returns (how many pages are now in dst — copied or already there, [the ids that could not be copied])."""
    want = set(wanted)
    pages = {}   # page id -> (where its last whole record starts, its length, the keys it names)
    where = {}   # piece key -> (where its last whole line starts, its length)
    # (a few pages looked for in a large archive: a page's line is read whole only when one of their ids stands where a
    # record keeps its id — the line's first 400 bytes, as _sent_page looks; many pages: every page line is read)
    marks = [('"id":' + json.dumps(i)).encode('utf-8') for i in want] if len(want) <= 64 else None
    try:
        with open(src, 'rb') as f:
            at = 0
            for ln in f:
                here, at = at, at + len(ln)
                if ln.startswith(b'{"p":'):
                    if marks is not None:
                        head = ln[:400]
                        if not any(m in head for m in marks):
                            continue
                    record = _sent_record(ln)
                    if record is not None and record['id'] in want:
                        pages[record['id']] = (here, len(ln), _sent_keys(record))
            need = set()
            for found in pages.values():
                need |= found[2]
            if need:
                f.seek(0)
                at = 0
                for ln in f:
                    here, at = at, at + len(ln)
                    if ln.startswith(b'{"k":"'):
                        end = ln.find(b'"', 6)
                        if end > 6 and ln[6:end].decode('utf-8', 'replace') in need and _sent_piece(ln) is not None:
                            where[ln[6:end].decode('utf-8', 'replace')] = (here, len(ln))
    except FileNotFoundError:
        return 0, list(wanted)
    try:
        there = _sent_held(dst)
        held_pages, held_pieces = there['pages'] - there['lacking'].keys(), there['pieces']
    except OSError:
        held_pages, held_pieces = set(), set()
    missing = []
    add_pieces = {}
    add_pages = {}
    copied = 0
    for page_id in wanted:
        found = pages.get(page_id)
        if found is None or any(k not in where for k in found[2]):
            missing.append(page_id)
            continue
        copied += 1
        for k in found[2]:
            if k not in held_pieces:
                add_pieces[k] = where[k]
        if page_id not in held_pages:
            add_pages[page_id] = found[:2]
    order = sorted(add_pieces.values()) + sorted(add_pages.values())
    if order:
        def lines():
            with open(src, 'rb') as f:
                for start, length in order:
                    f.seek(start)
                    ln = f.read(length)
                    yield ln if ln.endswith(b'\n') else ln + b'\n'
        _sent_append(dst, lines())
    return copied, missing


def _backups():
    """The safety copies, in the order they were made — the newest LAST.
    M675: by the time each was made, not by its name. They were sorted by name, and a copy is named by the device's
    local time: with the clock stepped back (a time zone crossed westward, the autumn hour, a clock that ran ahead put
    right) "the newest" was an older copy — handed over as the copy just made, taken for the copy that "already holds
    this library", and kept while the one just written was let go as "the oldest" (the second reviewer, all three
    measured; tests/device_guard.py scene 12). The time made is the zip's own (_make_backup sees to it that a new copy
    is never dated before an older one); two with the very same time fall back to their names."""
    try:
        names = [n for n in os.listdir(BACKUPS_DIR) if n.startswith('cozytavern-') and n.endswith('.zip')]
    except OSError:
        names = []

    def made(n):
        try:
            return (os.stat(os.path.join(BACKUPS_DIR, n)).st_mtime_ns, n)
        except OSError:
            return (0, n)
    return [os.path.join(BACKUPS_DIR, n) for n in sorted(names, key=made)]


def _said(err):
    """An error in plain words: running out of storage is named for what it is."""
    if isinstance(err, OSError) and err.errno in (errno.ENOSPC, getattr(errno, 'EDQUOT', errno.ENOSPC)):
        return 'the device ran out of storage'
    return str(err)


def _zip_names(path):
    """The names a zip holds, or None when it cannot be read as a zip."""
    import zipfile
    try:
        with zipfile.ZipFile(path) as z:
            return z.namelist()
    except Exception:
        return None


def _tale_of(name):
    """Which tale a file in books/ belongs to (its book, its log of appended pages, its tombstone), or None."""
    for ending in ('.json.gone', '.json', '.log'):
        if name.endswith(ending):
            return name[:-len(ending)]
    return None


def make_backup(force=False):
    """Zip the whole library. Returns {ok, path, bytes, files, made} — made False when the newest
    copy already holds exactly this library. Never raises: a backup that cannot be made says why.
    M675: one at a time, and never while a copy is being brought back (_backup_lock). It takes _log_lock itself, a tale
    at a time — so it must not be called by anything that holds _log_lock."""
    with _backup_lock:
        return _backup_now(force)


def _backup_now(force, mid_restore=False):
    """make_backup, for a caller that already holds _backup_lock (restore_backup's safety copy). Never raises."""
    try:
        return _make_backup(force, mid_restore)
    except Exception as err:  # never take the server down for a backup
        return {'ok': False, 'why': _said(err)}


def _make_backup(force, mid_restore=False):
    # M675 — A COPY IS WHOLE, OR IT IS NOT A COPY. What went wrong, measured by the reviewer on the real server with the
    # storage nearly full: an 11-file library with 408 KB free answered {"ok": true, "files": 5} — a zip that read back
    # clean with six tales missing, served as the copy, and "made: false, files: 11" when asked again; at other sizes
    # the answer was a failure that left cozytavern-*.zip.part for ever, on a device with no room. The causes: a file
    # that could not be written into the zip was passed over (`except OSError: pass`); the zip was judged only by what
    # had got into it, never against what it was meant to hold; nothing removed a .part; and "nothing changed since the
    # last copy" trusted a note (last.stamp) without looking at the copy. And one more, forced by the reviewer: a
    # whole-book push landing between a tale's book and its log being zipped gave a copy with the OLD book and no log —
    # the newest pages in neither. Now:
    #   - a file that cannot be written fails the whole copy, and the reason names the storage when that is it; only a
    #     file that is no longer there (a tale let go meanwhile) is passed over;
    #   - a tale's book, its log and its tombstone are zipped in ONE hold of the log's lock, as they stand at that
    #     moment — a push folds the log into the book under that same lock, so it lands before or after, never between;
    #   - an archive of sent words only grows, and may grow while it is zipped: exactly the bytes that stood when it
    #     was looked at (under the archive's lock, where every addition is whole) are zipped, so it ends on a line;
    #   - the finished zip must read back clean AND hold exactly the names that were written into it;
    #   - whatever happens the .part is removed; on a failure the note is not rewritten and no older copy is let go;
    #   - a .part found at the start is from a run that died, and is removed;
    #   - "made: false" is said only when the newest zip really holds every file the library has now.
    import zipfile
    if not mid_restore:  # (a restore has looked already — and the copy it has read out beside the library is not a leftover)
        left = _recover_restore_locked()
        if left:
            return {'ok': False, 'why': left}
    files = _library_files()
    if not files:
        return {'ok': False, 'why': 'there are no books on this device yet'}
    os.makedirs(BACKUPS_DIR, exist_ok=True)
    for stale in os.listdir(BACKUPS_DIR):
        if stale.startswith('cozytavern-') and stale.endswith('.zip.part'):
            try:
                os.remove(os.path.join(BACKUPS_DIR, stale))
            except OSError:
                pass
    stamp = _library_stamp(files)
    mark = os.path.join(BACKUPS_DIR, 'last.stamp')
    have = _backups()
    # M675: the note says what the library was made of when it was last copied — and, on its second line, WHICH copy
    # that was. "Nothing changed" then speaks of that copy by name: it used to speak of "the newest" (the last name),
    # which after the clock stepped back was an older zip with the same file names and other pages in them. A note
    # from an older build names no copy: the one made last is looked at, as before. A note that names a copy no
    # longer there describes nothing — a new copy is made.
    try:
        with open(mark) as f:
            noted = f.read().split('\n')
    except OSError:
        noted = []
    last = noted[0].strip() if noted else ''
    last_name = noted[1].strip() if len(noted) > 1 else ''
    if have and last == stamp and not force:
        spoken = next((b for b in have if os.path.basename(b) == last_name), None) if last_name else have[-1]
        held = _zip_names(spoken) if spoken else None
        if held is not None and sorted(held) == sorted(os.path.relpath(f, DATA_DIR).replace(os.sep, '/') for f in files):
            return {'ok': True, 'made': False, 'path': spoken, 'bytes': os.path.getsize(spoken), 'files': len(held)}
    name = 'cozytavern-%s.zip' % time.strftime('%Y%m%d-%H%M%S')
    final = os.path.join(BACKUPS_DIR, name)
    # M675: a copy is named by the second it was made in, and one made this very second was simply written over — the
    # copy of the library as it stood, if two copies were brought back in one second. The next second is waited for.
    for _ in range(40):
        if not os.path.exists(final):
            break
        time.sleep(0.05)
        name = 'cozytavern-%s.zip' % time.strftime('%Y%m%d-%H%M%S')
        final = os.path.join(BACKUPS_DIR, name)
    tmp = final + '.part'
    books = os.path.join(DATA_DIR, 'books')
    sent = os.path.join(DATA_DIR, 'sent')
    wrote = []
    at = ['']
    failed = None
    try:
        # M675: a file dated before 1980 (a phone whose clock was reset when the book was written) is zipped with the
        # earliest date a zip can carry — zipfile refused it ("ZIP does not support timestamps before 1980"), and with
        # one such file no copy could be made at all
        z = zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, allowZip64=True, strict_timestamps=False)
        try:
            def put(path, src=None, st=None):
                """One file into the zip — or, given the file already open and as it stood when it was looked at (`st`),
                just the bytes it had then. A file no longer there is passed over."""
                arc = os.path.relpath(path, DATA_DIR).replace(os.sep, '/')
                at[0] = arc
                try:
                    if src is None:
                        z.write(path, arc)
                    else:
                        info = zipfile.ZipInfo(arc, max(time.localtime(st.st_mtime)[:6], (1980, 1, 1, 0, 0, 0)))  # (never before 1980: see strict_timestamps above)
                        info.external_attr = (st.st_mode & 0xFFFF) << 16
                        info.file_size = st.st_size
                        info.compress_type = zipfile.ZIP_DEFLATED
                        left = st.st_size
                        with z.open(info, 'w') as out:
                            while left > 0:
                                chunk = src.read(min(left, 1024 * 256))
                                if not chunk:
                                    break
                                out.write(chunk)
                                left -= len(chunk)
                except FileNotFoundError:
                    if os.path.exists(path):
                        raise
                    return
                wrote.append(arc)
            done = set()
            for f in files:
                if f in done:
                    continue
                folder, base = os.path.split(f)
                tale = _tale_of(base) if folder == books else None
                try:
                    if tale is not None:
                        with _log_lock:
                            for ending in ('.json', '.log', '.json.gone'):
                                one = os.path.join(books, tale + ending)
                                done.add(one)
                                if os.path.exists(one):
                                    put(one)
                    elif folder == sent and base.endswith('.ndjson'):
                        done.add(f)
                        with _sent_lock:  # opened and measured in one hold: these bytes end on a whole line
                            try:
                                src = open(f, 'rb')
                            except FileNotFoundError:
                                src = None  # its tale was let go meanwhile
                            stood = os.fstat(src.fileno()) if src is not None else None
                        if src is not None:
                            with src:
                                put(f, src, stood)
                    else:
                        done.add(f)
                        put(f)
                except Exception as err:
                    failed = 'the copy could not be written (%s, at %s)' % (_said(err), at[0] or os.path.relpath(f, DATA_DIR))
                    break
        finally:
            try:
                z.close()
            except Exception as err:  # the zip's own list of what it holds could not be written
                failed = failed or 'the copy could not be finished (%s)' % _said(err)
        if failed:
            return {'ok': False, 'why': failed + ' — no copy was made, and the earlier ones are as they were'}
        # a copy is kept only if it can be read back, whole
        with zipfile.ZipFile(tmp) as z:
            bad = z.testzip()
            if bad is not None:
                return {'ok': False, 'why': 'the copy could not be read back (%s)' % bad}
            held = z.namelist()
        if sorted(held) != sorted(wrote):
            return {'ok': False, 'why': 'the copy does not hold every file that was put into it — no copy was made, and the earlier ones are as they were'}
        os.replace(tmp, final)
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    # M675: THE COPY JUST MADE IS THE NEWEST, WHATEVER THE CLOCK SAYS. If the clock itself was put back, this zip is
    # dated before the older ones: it is dated just after the latest of them instead (two seconds: the coarsest clock a
    # storage keeps), so the order the copies were made in is the order of their own times. If the storage will not
    # take a time, the copy is still handed over by its name and is never the one let go (below).
    try:
        latest = max((os.stat(b).st_mtime_ns for b in _backups() if b != final), default=0)
        if os.stat(final).st_mtime_ns <= latest:
            os.utime(final, ns=(latest + 2 * 10 ** 9, latest + 2 * 10 ** 9))
    except OSError:
        pass
    try:
        with open(mark, 'w') as f:
            f.write(stamp + '\n' + name)  # (M675: and which copy it is — see where the note is read)
    except OSError:
        pass  # the copy stands and is whole; without the note the next one is simply made again
    # M675: the newest BACKUPS_KEPT are kept BY THE TIME THEY WERE MADE, and the copy just written is never the one
    # let go. By name, with the clock an hour back and five copies kept, the new copy was removed here the moment it
    # was made: "Take a copy" answered "[Errno 2] No such file…", a copy could not be brought back at all ("could not
    # be kept first"), and — the note above already rewritten — the next press handed over an old zip as "nothing
    # changed" (the second reviewer, measured).
    others = [b for b in _backups() if b != final]
    for old in others[:max(0, len(others) - (BACKUPS_KEPT - 1))]:
        try:
            os.remove(old)
        except OSError:
            pass
    return {'ok': True, 'made': True, 'path': final, 'bytes': os.path.getsize(final), 'files': len(held)}


def _library_tops():
    """The library's own top-level names in the data folder — every folder _library_files walks into and every file
    it would zip. What a copy brought back takes the place of; nothing else in the data folder is moved or removed
    (the safety copies, the two folders a restore works in, the epoch, a .tmp still being written, an old .bak1/.bak2)."""
    tops = []
    for name in sorted(os.listdir(DATA_DIR)):
        full = os.path.join(DATA_DIR, name)
        if name in ('.epoch', '.epoch.tmp'):
            continue
        if os.path.isdir(full):
            if os.path.islink(full) or _outside_library(full):
                continue
        elif name.endswith(('.tmp', '.bak1', '.bak2')):
            continue
        tops.append(name)
    return tops


def _clear(path):
    """Whatever stands at `path` is removed — a folder with all that is in it, a file, a link. Nothing there: nothing done."""
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    elif os.path.lexists(path):
        os.remove(path)


def _undo_swap():
    """The library put back exactly as it stood before a copy began to take its place (see restore_backup). For a
    caller that holds _log_lock and _sent_lock. Returns '' when it is back; otherwise why not — .restore-old then
    stays, and the next start, copy or restore tries again. Safe to run twice, and after being cut off itself."""
    try:
        if not os.path.isdir(RESTORE_OLD) or os.path.islink(RESTORE_OLD):
            _clear(RESTORE_OLD)  # not a folder: nothing of a library is in it
        else:
            mark = os.path.join(RESTORE_OLD, '.epoch')
            was = os.path.join(RESTORE_OLD, '.epoch.tmp')
            if os.path.isfile(mark):
                # The mark is written once EVERY part of the old library has been set aside — so whatever stands in
                # the library's place now came from the copy, and goes. Then the mark is renamed: from there on the
                # old parts come back one by one, and a second run (this one was cut off) must not take them for the
                # copy's. (Neither name can be a part of the library: _library_tops leaves both where they are.)
                for name in _library_tops():
                    _clear(os.path.join(DATA_DIR, name))
                os.replace(mark, was)
            for name in sorted(os.listdir(RESTORE_OLD)):
                if name in ('.epoch', '.epoch.tmp'):
                    continue
                there = os.path.join(DATA_DIR, name)
                _clear(there)
                os.replace(os.path.join(RESTORE_OLD, name), there)
            # last, the epoch as the mark kept it — only if the copy had got as far as changing it. Last, so that a
            # device with no room to write it has its library back all the same.
            if os.path.isfile(was):
                with open(was, 'r', encoding='utf-8') as f:
                    epoch = f.read()
                if epoch.endswith('\n') and _epoch() != epoch.strip():  # (no line break: the mark itself was cut short — nothing had moved in)
                    _set_epoch(epoch.strip())
                try:
                    os.remove(EPOCH_FILE + '.tmp')  # a new epoch half-way to being written when the server died
                except OSError:
                    pass
            shutil.rmtree(RESTORE_OLD)
        shutil.rmtree(RESTORE_STAGE, ignore_errors=True)
        return ''
    except Exception as err:
        return _said(err)


def _recover_restore_locked():
    """_recover_restore, for a caller that already holds _backup_lock (and neither of the other two locks)."""
    if os.path.lexists(RESTORE_OLD):
        with _log_lock, _sent_lock:
            why = _undo_swap()
            _SENT_HELD.clear()
        if why:
            return 'a copy that was being brought back was cut off, and the library as it stood could not be put back yet (%s) — it is kept in %s, and nothing was touched' % (why, RESTORE_OLD)
    elif os.path.lexists(RESTORE_STAGE):
        shutil.rmtree(RESTORE_STAGE, ignore_errors=True)  # a copy read out and never put in place: only a copy
    return ''


def _recover_restore():
    """M675 — A RESTORE CUT OFF IS PUT RIGHT BY THE HOUSE ITSELF. While a copy takes the library's place, the library as
    it stood is set aside in <data>/.restore-old; that folder is gone the moment the copy stands. So if it is found —
    the server was killed mid-way (Android reaps Termux), or an earlier undo could not finish — the swap never
    finished: the library is put back as it stood, and .restore-old and the copy read out beside it are removed.
    Run when the server starts, before it serves, and before every copy taken or brought back.
    Returns '' when the library is whole, or the reason it could not be put back yet."""
    with _backup_lock:
        return _recover_restore_locked()


def restore_backup(data):
    """M510-47: BRING A COPY BACK, ON THE DEVICE. "Take a copy" hands the writer the device's zip of the library (M310) —
    and "Bring a copy back" read only a browser's .json, so the zip had no way home. Here the zip replaces the library:
    it is read whole first (a zip that is not one, holds a path outside the library, holds no house book, or cannot be
    read back changes nothing); the library as it stands is zipped into backups/ before anything goes (the restore can be
    undone from there); the copy is read out beside the library, and only then do the library's files go and the copy's
    take their place. The backups folder is never touched. Returns {ok, files, safety} or {ok: False, why}; never raises.

    M675 — THE LIBRARY IS NEVER LEFT GONE. The library's files were deleted one by one and the copy's then moved in one
    by one: a copy that passed every check but could not be put in place left nothing (the reviewer: a zip with the
    house book and a FILE named `sent`, on a library with a sent/ folder — "[Errno 21] Is a directory", every book,
    log and archive deleted, the safety zip not named), and so would a kill between the two. Now the swap moves whole
    top-level entries and can be undone: each part of the library is moved aside into .restore-old, each part of the
    copy is moved in, and only when all of it stands is .restore-old let go — in one move, so there is no moment at
    which half of it is deleted. If anything fails, what was moved in is removed, what was moved aside comes back, and
    the answer ends "nothing was changed"; if the server dies mid-way, _recover_restore does the same at the next
    start. No book, page or archive line is written while the swap runs (it holds _log_lock and _sent_lock), and no
    other copy is taken or brought back (_backup_lock). A copy that stands gives the library a new epoch (see
    EPOCH_FILE), told to every listening browser as {"id": "_restored", "epoch": …} and returned as `epoch`."""
    import io, zipfile
    try:
        try:
            # M675: the copy as bytes, or as a file it was taken in to (TavernHandler._take_copy_in) — read from where it lies
            z = zipfile.ZipFile(data if hasattr(data, 'read') else io.BytesIO(data or b''))
        except zipfile.BadZipFile:
            return {'ok': False, 'why': 'that file is not a copy of the tavern (it is not a zip) — nothing was touched'}
        with z:
            plan = []
            for info in z.infolist():
                if info.is_dir():
                    continue
                rel = os.path.normpath(info.filename.replace('\\', '/')).replace('\\', '/')
                parts = rel.split('/')
                if os.path.isabs(rel) or rel.startswith('/') or '..' in parts or parts[0] in ('backups', '.restore-stage', '.restore-old', '.epoch') or rel.endswith('.tmp') or (len(parts) > 1 and _outside_library(os.path.join(DATA_DIR, parts[0]))):
                    return {'ok': False, 'why': 'that copy holds a path outside the library (%s) — nothing was touched' % info.filename}
                if rel in ('books', 'sent'):
                    # M675: the reviewer's zip. Put in place it would stand as the library — a FILE where every tale's
                    # book, or every page's sent words, is kept in a folder — and nothing could be written after it.
                    return {'ok': False, 'why': 'that copy holds a file named %s where the library keeps a folder — it is not a copy of the tavern; nothing was touched' % rel}
                if len(parts) == 1 and rel.endswith(('.bak1', '.bak2')):
                    continue  # M675: a top-level .bak1/.bak2 (zips from before M571 hold them) is not the library's: the device keeps its own
                plan.append((info, rel))
            if not any(rel == 'books/_house.json' for _, rel in plan):
                return {'ok': False, 'why': 'that copy holds no house book — it is not a copy of the tavern; nothing was touched'}
            bad = z.testzip()
            if bad is not None:
                return {'ok': False, 'why': 'that copy cannot be read whole (%s) — nothing was touched' % bad}
            with _backup_lock:
                return _restore(z, plan)
    except Exception as err:  # never take the server down for a restore
        return {'ok': False, 'why': str(err)}


def _library_print():
    """What the library is made of at this moment: every file of it, with its size and the time it last changed."""
    out = []
    for f in _library_files():
        try:
            st = os.stat(f)
            out.append((f, st.st_size, st.st_mtime_ns))
        except OSError:
            out.append((f, -1, -1))
    return out


def _swap(stage):
    """The copy read out in `stage` takes the library's place — or nothing changes. For a caller that holds _log_lock
    and _sent_lock (and _backup_lock). Returns (why it could not be put in place or '', why the library could not be
    put back at once or '', the library's new epoch)."""
    try:
        os.mkdir(RESTORE_OLD)
        for name in _library_tops():
            os.replace(os.path.join(DATA_DIR, name), os.path.join(RESTORE_OLD, name))
        # every part of the library is aside: the mark that says so, holding the epoch as it stood (_undo_swap).
        # Written whole under another name and then renamed, so a mark that is there is never half a mark.
        with open(os.path.join(RESTORE_OLD, '.epoch.tmp'), 'w', encoding='utf-8') as f:
            f.write(_epoch() + '\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(os.path.join(RESTORE_OLD, '.epoch.tmp'), os.path.join(RESTORE_OLD, '.epoch'))
        for name in sorted(os.listdir(stage)):
            there = os.path.join(DATA_DIR, name)
            if os.path.lexists(there):
                raise RuntimeError('%s stands in the data folder and is not part of the library' % name)
            os.replace(os.path.join(stage, name), there)
        epoch = '%d-%s' % (int(time.time() * 1000), os.urandom(4).hex())
        _set_epoch(epoch)
        os.replace(RESTORE_OLD, os.path.join(stage, '.restore-old'))  # the copy stands: the old library goes, in one move
        return '', '', epoch
    except Exception as err:
        return _said(err), _undo_swap(), ''


def _restore(z, plan):
    """restore_backup, once the copy has been read and found whole. The caller holds _backup_lock."""
    left = _recover_restore_locked()
    if left:
        return {'ok': False, 'why': left}
    seen = _library_print()
    safety = _backup_now(True, True) if seen else {'ok': True}
    if not safety.get('ok'):
        return {'ok': False, 'why': 'the library as it stands could not be kept first (%s) — nothing was touched' % safety.get('why')}
    kept = os.path.basename(safety['path']) if safety.get('path') else None
    stage = os.path.abspath(RESTORE_STAGE)
    shutil.rmtree(stage, ignore_errors=True)
    try:
        os.makedirs(stage)
        for info, rel in plan:
            dest = os.path.abspath(os.path.join(stage, rel))
            if not dest.startswith(stage + os.sep):
                shutil.rmtree(stage, ignore_errors=True)
                return {'ok': False, 'why': 'that copy holds a path outside the library (%s) — nothing was touched' % info.filename}
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with z.open(info) as src, open(dest, 'wb') as out:
                shutil.copyfileobj(src, out)
        placed = sum(len(names) for _, _, names in os.walk(stage))
    except Exception as err:
        # M675: a copy that could not be read out (no room, a name that is a file and a folder at once) left
        # .restore-stage behind; it is removed, and the library has not been touched
        shutil.rmtree(stage, ignore_errors=True)
        return {'ok': False, 'why': 'the copy could not be read out beside the library (%s) — nothing was changed' % _said(err), 'safety': kept}
    try:
        os.sync()  # the copy read out, and the library as it stood in its zip, are on the storage before anything moves
    except Exception:
        pass
    # M675: THE COPY KEPT FIRST HOLDS THE LIBRARY AS IT IS WHEN IT GOES. The library was zipped, and then the copy was
    # read out (seconds, for a large one) before the swap: a page another browser appended in between was in neither —
    # not in the zip, and gone with the library. So, with the locks of the swap held (nothing can be written now), the
    # library is looked at again: if anything was written since it was zipped, it is zipped again first. A library
    # that will not hold still for three tries is not replaced at all.
    # M681 — A LIBRARY THAT IS WRITTEN TO WITHOUT A PAUSE IS HELD STILL, NOT GIVEN UP ON (found when the device gate's
    # "all of it at once" failed on a busy machine — made to happen on m680-001 with the CPU loaded: 2 runs of 5). The
    # copy kept first is zipped while the library is open to writes, then looked at again under the locks; three tales
    # writing a page every 30 ms changed it inside every zip, three tries in a row, and the copy he asked to bring back was
    # refused ("bring the copy back again when no tale is being told") — whether it was depended on how fast the device
    # zipped. After two such tries the safety copy is taken WITH the locks held, and the swap follows in the same hold:
    # nothing can be written between them, so it is always whole and always the library as it went. A page sent meanwhile
    # waits for the swap (as it already waits for the swap itself) and is never refused.
    tries = 0
    while True:
        with _log_lock, _sent_lock:
            if tries >= 2:
                for gone in ([safety['path'], os.path.join(BACKUPS_DIR, 'last.stamp')] if safety.get('path') else []):
                    try:
                        os.remove(gone)
                    except OSError:
                        pass
                seen = _library_print()
                safety = _backup_now(True, True) if seen else {'ok': True}
                if not safety.get('ok'):
                    shutil.rmtree(stage, ignore_errors=True)
                    return {'ok': False, 'why': 'the library as it stands could not be kept first (%s) — nothing was touched' % safety.get('why')}
                kept = os.path.basename(safety['path']) if safety.get('path') else None
                still = True
            else:
                still = _library_print() == seen
            if still:
                why, undone, epoch = _swap(stage)
                _SENT_HELD.clear()  # every archive is another file now (or the same one again): what was remembered of them goes
        if still:
            break
        tries += 1
        if tries >= 2:
            continue  # the next try holds the library still and takes its own copy (above)
        # the copy taken a moment ago is replaced by the one taken now, not added to (only five are kept) — and the
        # note that described it goes with it, so nothing older is ever taken for "the newest copy of this library"
        for gone in ([safety['path'], os.path.join(BACKUPS_DIR, 'last.stamp')] if safety.get('path') else []):
            try:
                os.remove(gone)
            except OSError:
                pass
        seen = _library_print()
        safety = _backup_now(True, True) if seen else {'ok': True}
        if not safety.get('ok'):
            shutil.rmtree(stage, ignore_errors=True)
            return {'ok': False, 'why': 'the library as it stands could not be kept first (%s) — nothing was touched' % safety.get('why')}
        kept = os.path.basename(safety['path']) if safety.get('path') else None
    if why and undone:
        return {'ok': False, 'why': 'the copy could not be put in place (%s), and the library as it stood could not be put back yet (%s) — it is kept in %s and is put back when the tavern next starts' % (why, undone, RESTORE_OLD), 'safety': kept}
    if why:
        return {'ok': False, 'why': 'the copy could not be put in place (%s) — nothing was changed' % why, 'safety': kept}
    shutil.rmtree(stage, ignore_errors=True)
    _announce('_restored', '', {'epoch': epoch})
    return {'ok': True, 'files': placed, 'safety': kept, 'epoch': epoch}


def recover_projects():
    """M311: every shelf row ({id, name, createdAt}) this device can still find, by id — read from the
    house book and its safety copy, the old single-file books (books.json and its .bak1/.bak2, from
    before one-file-per-tale) and the safety zips. Older files are read first, so a newer name wins.
    Read-only; never raises."""
    import zipfile
    found = {}

    def take(doc):
        try:
            rows = doc.get('settings') if isinstance(doc, dict) else None
            for row in rows or []:
                if isinstance(row, dict) and row.get('key') == 'projects' and isinstance(row.get('value'), list):
                    for pr in row['value']:
                        if isinstance(pr, dict) and isinstance(pr.get('id'), str) and isinstance(pr.get('name'), str) and pr['name'].strip():
                            found[pr['id']] = {'name': pr['name'].strip(), 'createdAt': pr.get('createdAt')}
        except Exception:
            pass

    def read(path):
        try:
            if os.path.getsize(path) > MAX_BOOK_BYTES * 4:
                return
            with open(path, 'rb') as f:
                take(json.loads(f.read().decode('utf-8', 'ignore')))
        except Exception:
            pass

    for old in (BOOKS + '.bak2', BOOKS + '.bak1', BOOKS):
        read(old)
    for z in _backups():
        try:
            with zipfile.ZipFile(z) as zf:
                for n in zf.namelist():
                    if n.endswith('_house.json') or n.endswith('_house.json.bak1') or n.endswith('books.json'):
                        take(json.loads(zf.read(n).decode('utf-8', 'ignore')))
        except Exception:
            pass
    house = os.path.join(DATA_DIR, 'books', '_house.json')
    read(house + '.bak1')
    read(house)
    return found


def _daily_backup():
    have = _backups()
    today = 'cozytavern-' + time.strftime('%Y%m%d')
    if have and os.path.basename(have[-1]).startswith(today):
        return
    make_backup()


if __name__ == '__main__':
    _watch_self()
    try:
        _recover_restore()  # M675: a restore cut off by a kill is put right before anything is served or zipped
    except Exception:
        pass
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
