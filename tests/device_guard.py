#!/usr/bin/env python3
"""M675: THE DEVICE GUARDS ITS OWN LIBRARY. serve.py on real folders and over real HTTP — no browser.

What is held here (each was measured going wrong on the build before, by the audit of the device):
  1. a copy is whole or it is not a copy: a file that cannot be written fails it, no .part is left, the earlier copies
     and the note stay as they were; "nothing changed" is said only when the newest zip really holds every file;
  2. a whole-book push cannot land between a tale's book and its log while they are zipped;
  3. a copy brought back never leaves the library gone: a copy that cannot be put in place, a failure half-way, a kill
     at any step — the library is as it stood, byte for byte; a good copy still replaces it exactly;
  4. the archive of sent words: a cut line is never taken for a whole one and never spoils the next; a write lands
     whole or not at all (and the same for a book's log of appended pages);
  5. a tale let go is not written to again;
  6. a branch's carried pages are copied from its parent's archive;
  7. the library's epoch: a write made for the library as it was before a copy came back is refused;
  8. only the tavern's own page may write, and /api/ answers only under the device's own name;
  11. a copy brought back is taken in on the storage: the server never holds it whole in memory.

The serve.py under test is COZY_TEST_SERVE (default: this repo's) — run against the build before M675 every guard
shows as a MISS. Data lives under a fresh temporary folder (or COZY_TEST_DATA). Exits 1 on any miss."""
import errno, hashlib, http.client, importlib.util, io, itertools, json, os, shutil, socket, subprocess, sys, tempfile, threading, time, zipfile

sys.dont_write_bytecode = True
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVE = os.path.abspath(os.environ.get('COZY_TEST_SERVE') or os.path.join(REPO, 'serve.py'))
BASE_DATA = os.environ.get('COZY_TEST_DATA') or tempfile.mkdtemp(prefix='cozy-device-guard-')
fails = []
_count = itertools.count(1)


def check(ok, words):
    print(('ok   ' if ok else 'MISS ') + words, flush=True)
    if not ok:
        fails.append(words)
    return ok


def scene(name, fn):
    """One scene, run to its end — a scene that stops half-way is a miss, not a crash of the whole file."""
    print('\n— ' + name, flush=True)
    try:
        fn()
    except BaseException as err:  # KeyboardInterrupt too: some scenes cut the server off on purpose
        check(False, name + ': the scene did not run to its end — ' + type(err).__name__ + ': ' + str(err)[:300])


def fresh(label):
    d = os.path.join(BASE_DATA, '%02d-%s' % (next(_count), label))
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    return d


def load(data):
    """serve.py as a module of its own, keeping its library in `data` (it reads COZY_DATA_DIR once, at import)."""
    os.environ['COZY_DATA_DIR'] = data
    spec = importlib.util.spec_from_file_location('serve_under_test_%d' % next(_count), SERVE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert os.path.abspath(mod.DATA_DIR) == os.path.abspath(data)
    return mod


class House:
    """The real handler on a real socket, in this process (so a fault can be put into it), on a port of its own."""
    def __init__(self, label):
        self.data = fresh(label)
        self.serve = load(self.data)
        self.server = self.serve.TavernServer(('127.0.0.1', 0), self.serve.TavernHandler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, method, path, body=None, headers=None, timeout=30, status_only=False):
        return call(self.port, method, path, body, headers, timeout, status_only)

    def path(self, *parts):
        return os.path.join(self.data, *parts)


def call(port, method, path, body=None, headers=None, timeout=30, status_only=False):
    """One request. Returns (status, body bytes, the answer as JSON or None). `headers` may set Host, or 'Host': None
    for a request that carries none at all. A server that does not answer in time is status 0, not a hang.
    `status_only`: the answer's status alone — for /api/events, whose body never ends."""
    headers = dict(headers or {})
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    try:
        conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        host = headers.pop('Host', '127.0.0.1:%d' % port)
        if host is not None:
            conn.putheader('Host', host)
        if body is not None:
            conn.putheader('Content-Length', str(len(body)))
        elif method == 'POST':
            conn.putheader('Content-Length', '0')
        for k, v in headers.items():
            conn.putheader(k, v)
        conn.endheaders(body)
        res = conn.getresponse()
        if status_only:
            return res.status, b'', None
        raw = res.read()
        try:
            said = json.loads(raw) if raw else None
        except ValueError:
            said = None
        return res.status, raw, said
    except (OSError, http.client.HTTPException) as err:
        return 0, repr(err).encode(), None
    finally:
        conn.close()


def tree(data, skip_bak=True):
    """Every file of the library with a hash of its bytes — not the safety copies, not the epoch (it names the library,
    it is not part of it), and by default not a book's .bak1 (the device's own guard, in no copy since M571)."""
    out = {}
    for root, dirs, files in os.walk(data):
        for n in files:
            rel = os.path.relpath(os.path.join(root, n), data).replace(os.sep, '/')
            if rel.startswith('backups/') or rel == '.epoch' or (skip_bak and rel.endswith('.bak1')):
                continue
            with open(os.path.join(root, n), 'rb') as f:
                out[rel] = hashlib.sha1(f.read()).hexdigest()[:12]
    return out


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data if isinstance(data, bytes) else data.encode('utf-8'))


def read(path):
    with open(path, 'rb') as f:
        return f.read()


def zips(data):
    folder = os.path.join(data, 'backups')
    return sorted(n for n in os.listdir(folder) if n.endswith('.zip')) if os.path.isdir(folder) else []


def parts(data):
    folder = os.path.join(data, 'backups')
    return sorted(n for n in os.listdir(folder) if n.endswith('.part')) if os.path.isdir(folder) else []


def leftovers(data):
    return [n for n in ('.restore-stage', '.restore-old') if os.path.lexists(os.path.join(data, n))]


def line(obj):
    """One line of an archive, exactly as the browser writes it (JSON.stringify: no spaces)."""
    return json.dumps(obj, separators=(',', ':'), ensure_ascii=False).encode('utf-8') + b'\n'


def piece(key, text):
    return line({'k': key, 't': text})


def page(page_id, tale, slot_keys=(), body_keys=None):
    record = {'id': page_id, 'storyId': tale, 'ts': 1, 'v': 1, 'slots': [{'name': 'The frame', 't': list(slot_keys)}], 'requests': []}
    if body_keys is not None:
        record['requests'] = [{'url': 'https://api.example/v1/messages', 'body': {'model': 'm', 'messages': [{'role': 'system', 'content': {'$cozyText': list(body_keys)}}, {'role': 'user', 'content': 'short'}]}}]
    return line({'p': record})


def book(tale, pages, at='2026-10-01T00:00:00.000Z'):
    return json.dumps({'namespace': 'cozytavern.v1', 'kind': 'story', 'exportedAt': at, 'story': {'id': tale, 'title': tale},
                       'settings': [{'key': 'state:' + tale, 'value': {'page': len(pages)}}],
                       'messages': [{'id': '%s-m%d' % (tale, i + 1), 'storyId': tale, 'role': 'assistant' if i % 2 else 'user', 'text': t, 'ts': i + 1} for i, t in enumerate(pages)]}).encode('utf-8')


HOUSE = json.dumps({'namespace': 'cozytavern.v1', 'kind': 'house', 'exportedAt': '2026-10-01T00:00:00.000Z', 'settings': [{'key': 'theme', 'value': 'dark'}], 'connections': [], 'stories': []}).encode('utf-8')


def seed_files(data):
    """A library written straight onto the folder: the house, two tales (one with a log of appended pages), a
    tombstone, two archives of sent words."""
    write(os.path.join(data, 'books', '_house.json'), HOUSE)
    write(os.path.join(data, 'books', 'taleA.json'), book('taleA', ['I begin.', 'THE-PAGE-OF-taleA']))
    write(os.path.join(data, 'books', 'taleA.log'), json.dumps({'m': {'id': 'taleA-m3', 'storyId': 'taleA', 'role': 'user', 'text': 'A PAGE IN THE LOG', 'ts': 3}, 'by': 'tab-1', 'at': '2026-10-02T00:00:00.000Z'}) + '\n')
    write(os.path.join(data, 'books', 'taleB.json'), book('taleB', ['hello', 'THE-PAGE-OF-taleB']))
    write(os.path.join(data, 'books', 'taleGone.json.gone'), b'')
    write(os.path.join(data, 'sent', 'taleA.ndjson'), piece('taleA|abc|5', 'WORDS-A') + page('snt_taleA', 'taleA', ['taleA|abc|5']))
    write(os.path.join(data, 'sent', 'taleB.ndjson'), piece('taleB|abc|5', 'WORDS-B') + page('snt_taleB', 'taleB', ['taleB|abc|5']))


def mkzip(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in entries:
            z.writestr(name, data)
    return buf.getvalue()


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start(data, env=None):
    """The real serve.py as its own process on a spare port (as tests/backup_sent.py does). Returns (process, port)."""
    port = free_port()
    e = dict(os.environ, PORT=str(port), COZY_DATA_DIR=data, PYTHONDONTWRITEBYTECODE='1')
    e.update(env or {})
    p = subprocess.Popen([sys.executable, '-B', SERVE], env=e, cwd=os.path.dirname(SERVE), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        if call(port, 'GET', '/api/version', timeout=2)[0] == 200:
            break
        time.sleep(0.1)
    return p, port


def stop(p):
    p.terminate()
    try:
        p.wait(timeout=5)
    except Exception:
        p.kill()


class patched:
    """An attribute replaced for the length of a `with`, and always put back."""
    def __init__(self, obj, name, value):
        self.obj, self.name, self.value = obj, name, value

    def __enter__(self):
        self.had = hasattr(self.obj, self.name)  # a module's own `open` is not there until one is put in
        self.was = getattr(self.obj, self.name, None)
        setattr(self.obj, self.name, self.value)
        return self

    def __exit__(self, *a):
        if self.had:
            setattr(self.obj, self.name, self.was)
        else:
            delattr(self.obj, self.name)


def no_room(what=''):
    return OSError(errno.ENOSPC, os.strerror(errno.ENOSPC), what)


# ---------------------------------------------------------------------------------------------------------------------
# 1. A COPY IS WHOLE, OR IT IS NOT A COPY
def scene_backup():
    data = fresh('backup')
    serve = load(data)
    seed_files(data)
    lib = sorted(tree(data, skip_bak=False))
    # a normal run holds every file, byte for byte
    r = serve.make_backup(force=True)
    held = {}
    if r.get('ok'):
        with zipfile.ZipFile(r['path']) as z:
            held = {n: z.read(n) for n in z.namelist()}
    check(r.get('ok') is True and r.get('made') is True and sorted(held) == lib and all(held[n] == read(os.path.join(data, n)) for n in held) and r.get('files') == len(lib),
          'a copy holds every file of the library, byte for byte, and says how many (%s of %d)' % (r.get('files'), len(lib)))
    first = zips(data)
    stamp_was = read(os.path.join(data, 'backups', 'last.stamp'))
    before = {n: read(os.path.join(data, 'backups', n)) for n in first}
    time.sleep(1.1)  # a copy is named by the second it was made in
    write(os.path.join(data, 'books', 'taleB.json'), book('taleB', ['hello', 'THE-PAGE-OF-taleB', 'and one more']))  # the library moved on

    # the storage runs out while one file is being written into the zip
    real_write = zipfile.ZipFile.write
    def write_fails(self, filename, arcname=None, *a, **k):
        if str(arcname if arcname is not None else filename).replace(os.sep, '/').endswith('books/taleB.json'):
            raise no_room(str(filename))
        return real_write(self, filename, arcname, *a, **k)
    with patched(zipfile.ZipFile, 'write', write_fails):
        r = serve.make_backup(force=True)
    check(r.get('ok') is False, 'a file that could not be written into the zip fails the whole copy: ' + json.dumps({k: r.get(k) for k in ('ok', 'made', 'files', 'why')})[:230])
    check('storage' in str(r.get('why', '')), 'and the reason names the storage running out')
    check(parts(data) == [], 'no .part is left behind: ' + str(parts(data)))
    check(zips(data) == first and all(read(os.path.join(data, 'backups', n)) == before[n] for n in first), 'the earlier copies are as they were: ' + str(zips(data)))
    check(read(os.path.join(data, 'backups', 'last.stamp')) == stamp_was, 'and the note of what was last copied is not rewritten')

    # the storage runs out at the very end: the zip's own list of what it holds cannot be written
    real_end = zipfile.ZipFile._write_end_record
    def end_fails(self):
        if str(self.filename).endswith('.part'):
            raise no_room(str(self.filename))
        return real_end(self)
    with patched(zipfile.ZipFile, '_write_end_record', end_fails):
        r = serve.make_backup(force=True)
    check(r.get('ok') is False and parts(data) == [] and zips(data) == first, 'a zip that could not be finished is not a copy either, and leaves no .part: ' + json.dumps({k: r.get(k) for k in ('ok', 'why')})[:160] + ' ' + str(parts(data)))

    # a .part from a run that died is removed by the next run
    write(os.path.join(data, 'backups', 'cozytavern-20200101-000000.zip.part'), b'half a zip from a run that died')
    r = serve.make_backup(force=True)
    with zipfile.ZipFile(r['path']) as z:
        names = sorted(z.namelist())
    check(r.get('ok') is True and names == lib, 'with room again the copy is made, and whole')
    check(parts(data) == [], 'a .part left by a run that died is removed: ' + str(parts(data)))

    # "nothing changed since the last copy" is said only when the newest zip really holds every file
    r = serve.make_backup()
    check(r.get('ok') is True and r.get('made') is False and r.get('files') == len(lib), 'an unchanged library is not zipped twice: ' + json.dumps({k: r.get(k) for k in ('ok', 'made', 'files')}))
    newest = os.path.join(data, 'backups', zips(data)[-1])
    with zipfile.ZipFile(newest) as z:
        kept = [(n, z.read(n)) for n in z.namelist() if n != 'books/taleB.json']
    write(newest, mkzip(kept))  # the newest zip, as the old fault left it: reads back clean, one tale missing
    time.sleep(1.1)
    r = serve.make_backup()
    with zipfile.ZipFile(os.path.join(data, 'backups', zips(data)[-1])) as z:
        names = sorted(z.namelist())
    check(r.get('made') is True and names == lib, 'a newest zip that lacks a tale is not taken for a copy of the library — a new one is made (made: %s; the newest holds %d of %d)' % (r.get('made'), len(names), len(lib)))
    check(r.get('files') == len(names), 'and `files` is the count in the zip (%s)' % r.get('files'))

    # a book rewritten at the very same length within the second of the last copy is a changed library too
    base = (int(time.time()) - 10) * 10 ** 9
    for root, dirs, files in os.walk(data):
        if 'backups' not in root:
            for n in files:
                os.utime(os.path.join(root, n), ns=(base + 100000000, base + 100000000))
    time.sleep(1.1)
    serve.make_backup(force=True)
    r = serve.make_backup()
    victim = os.path.join(data, 'books', 'taleA.json')
    rewritten = read(victim).replace(b'I begin.', b'I BEGIN!')
    write(victim, rewritten)
    os.utime(victim, ns=(base + 200000000, base + 200000000))  # a tenth of a second after the others: the same second
    time.sleep(1.1)
    r2 = serve.make_backup()
    with zipfile.ZipFile(os.path.join(data, 'backups', zips(data)[-1])) as z:
        in_newest = z.read('books/taleA.json')
    check(r.get('made') is False and r2.get('made') is True and in_newest == rewritten, 'a book rewritten at the same length, within the same second as the last copy: a new copy is made, and holds it (made: %s)' % r2.get('made'))

    # an archive of sent words grows while it is being zipped: the copy holds what stood, and ends on a line
    arch = os.path.join(data, 'sent', 'taleA.ndjson')
    stood = read(arch)
    real_open = zipfile.ZipFile.open
    landed = []
    def open_then_append(self, name, mode='r', *a, **k):
        if mode == 'w' and str(getattr(name, 'filename', name)).endswith('sent/taleA.ndjson') and not landed:
            landed.append(1)
            with open(arch, 'ab') as f:  # a push landing at this very moment, seen half-way through its write
                f.write(b'{"k":"taleA|late|9","t":"HALF OF A LI')
        return real_open(self, name, mode, *a, **k)
    time.sleep(1.1)
    with patched(zipfile.ZipFile, 'open', open_then_append):
        r = serve.make_backup(force=True)
    in_zip = b''
    if r.get('ok'):
        with zipfile.ZipFile(r['path']) as z:
            in_zip = z.read('sent/taleA.ndjson')
    check(bool(landed) and r.get('ok') is True and in_zip == stood, 'an archive that grows while it is zipped is copied as it stood — the copy ends on a whole line (%d bytes stood, %d in the copy)' % (len(stood), len(in_zip)))
    write(arch, stood)

    # one copy at a time: two asked for at once both answer, and both zips are whole
    time.sleep(1.1)
    out = []
    ts = [threading.Thread(target=lambda: out.append(serve.make_backup(force=True))) for _ in range(2)]
    [t.start() for t in ts]
    [t.join(60) for t in ts]
    whole = []
    for n in zips(data):
        with zipfile.ZipFile(os.path.join(data, 'backups', n)) as z:
            whole.append(z.testzip() is None)
    check(len(out) == 2 and all(o.get('ok') for o in out) and all(whole) and parts(data) == [], 'two copies asked for at once: both answer ok, every zip reads back whole, no .part')
    check(len(zips(data)) <= 5, 'and only the newest five are kept (%d)' % len(zips(data)))

    # a tale let go between the library being listed and that tale's turn: passed over — and the copy says it was let go
    gone_book = os.path.join(data, 'books', 'taleB.json')
    real_files = serve._library_files
    def list_then_let_go():
        out = real_files()
        if os.path.exists(gone_book):
            os.remove(gone_book)
            write(gone_book + '.gone', b'')
        return out
    time.sleep(1.1)
    with patched(serve, '_library_files', list_then_let_go):
        r = serve.make_backup(force=True)
    names = []
    if r.get('ok'):
        with zipfile.ZipFile(r['path']) as z:
            names = sorted(z.namelist())
    check(r.get('ok') is True and 'books/taleB.json' not in names and 'books/taleB.json.gone' in names and r.get('files') == len(names) == len(lib),
          'a tale let go while the copy is being made does not fail it, and the copy holds its tombstone (so the copy, brought back, does not bring the tale back): ' + str([n for n in names if 'taleB' in n]))


# ---------------------------------------------------------------------------------------------------------------------
# 2. A PUSH CANNOT LAND BETWEEN A TALE'S BOOK AND ITS LOG WHILE THEY ARE ZIPPED
def scene_backup_and_push():
    h = House('race')
    try:
        old = ['I begin.', 'PAGE-TWO']
        new = ['I go on.', 'THE-NEWEST-PAGE']
        mine = {'X-Cozy-Client': 'tab-1'}
        h.call('POST', '/api/books/one/_house', HOUSE)
        h.call('POST', '/api/books/one/taleR', book('taleR', old), mine)
        for i, text in enumerate(new):
            h.call('POST', '/api/books/page/taleR', json.dumps({'m': {'id': 'taleR-m%d' % (3 + i), 'storyId': 'taleR', 'role': 'assistant' if i else 'user', 'text': text, 'ts': 3 + i}}).encode(), mine)
        check(os.path.exists(h.path('books', 'taleR.log')) and b'THE-NEWEST-PAGE' in h.call('GET', '/api/books/one/taleR')[1], 'before the copy the device holds the newest page, in the tale\'s log')
        real_write = zipfile.ZipFile.write
        pushed = []
        fired = []
        def write_then_push(self, filename, arcname=None, *a, **k):
            out = real_write(self, filename, arcname, *a, **k)
            if str(arcname).replace(os.sep, '/').endswith('books/taleR.json') and not fired:
                # the twenty-second whole-book push arrives now: the book is in the zip, its log is not yet
                fired.append(1)
                t = threading.Thread(target=lambda: pushed.append(h.call('POST', '/api/books/one/taleR', book('taleR', old + new, '2026-10-01T00:00:30.000Z'), mine, timeout=60)[0]))
                t.start()
                fired.append(t)
                t.join(1.5)  # it lands at once if nothing holds it back
            return out
        with patched(zipfile.ZipFile, 'write', write_then_push):
            r = h.serve.make_backup(force=True)
        if len(fired) > 1:
            fired[1].join(60)
        in_zip = False
        names = []
        if r.get('ok'):
            with zipfile.ZipFile(r['path']) as z:
                names = sorted(z.namelist())
                in_zip = any(b'THE-NEWEST-PAGE' in z.read(n) for n in names)
        check(bool(fired) and r.get('ok') is True and in_zip, 'a whole-book push arriving between a tale\'s book and its log: THE COPY HOLDS THE NEWEST PAGE (the copy holds %s)' % names)
        check(pushed == [200], 'and the push itself landed, once the tale was zipped: ' + str(pushed))
        check(b'THE-NEWEST-PAGE' in h.call('GET', '/api/books/one/taleR')[1] and not os.path.exists(h.path('books', 'taleR.log')), 'the device holds the page after it, folded into the book')
    finally:
        h.close()


class Gate:
    """Stands in for one of serve.py's locks: the FIRST hand to reach for it is kept waiting until it is let through;
    every other passes as it would the lock itself. So a scene can say exactly: "this write had reached the lock when
    that one landed" — the order a copy being taken (which now holds the lock for as long as a tale takes to zip) makes
    ordinary."""
    def __init__(self, lock):
        self.lock, self.first, self.mine = lock, None, threading.Lock()
        self.waiting, self.go = threading.Event(), threading.Event()

    def acquire(self, *a, **k):
        with self.mine:
            held_back = self.first is None
            if held_back:
                self.first = threading.get_ident()
        if held_back:
            self.waiting.set()
            self.go.wait(30)
        return self.lock.acquire(*a, **k)

    def release(self):
        self.lock.release()

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *a):
        self.release()


def scene_one_stretch():
    h = House('stretch')
    try:
        mine = {'X-Cozy-Client': 'tab-1'}
        pg = lambda tale, text: json.dumps({'m': {'id': tale + '-new', 'storyId': tale, 'role': 'user', 'text': text, 'ts': 9}}).encode()
        texts = lambda tale: [m.get('text') for m in ((h.call('GET', '/api/books/one/' + tale)[2] or {}).get('messages') or [])]
        h.call('POST', '/api/books/one/_house', HOUSE)

        # a page that waited for the lock while this browser's own whole-book push went in ahead of it
        h.call('POST', '/api/books/one/taleW', book('taleW', ['one', 'two']), mine)
        earlier = {'id': 'taleW-earlier', 'storyId': 'taleW', 'role': 'user', 'text': 'an earlier page, in the log', 'ts': 8}
        h.call('POST', '/api/books/page/taleW', json.dumps({'m': earlier}).encode(), mine)
        with_earlier = json.loads(book('taleW', ['one', 'two'], '2026-10-01T00:00:30.000Z'))
        with_earlier['messages'].append(earlier)   # the push holds everything this browser had when it was built — not the page told since
        gate = Gate(h.serve._log_lock)
        got = []
        with patched(h.serve, '_log_lock', gate):
            t = threading.Thread(target=lambda: got.append(h.call('POST', '/api/books/page/taleW', pg('taleW', 'THE PAGE TOLD WHILE THE LOCK WAS HELD'), mine, timeout=60)))
            t.start()
            reached = gate.waiting.wait(10)
            time.sleep(0.05)
            pushed = h.call('POST', '/api/books/one/taleW', json.dumps(with_earlier).encode(), mine, timeout=60)[0]
            gate.go.set()
            t.join(60)
        check(reached and pushed == 200 and bool(got) and got[0][2] == {'ok': True} and 'THE PAGE TOLD WHILE THE LOCK WAS HELD' in texts('taleW'),
              'a page that waited for the lock while this browser\'s own push went in ahead of it is READ BACK (it is stamped when it is written, not when it began to wait): ' + str(texts('taleW')))

        # a page that had reached the lock when its tale was let go: it is not written into a log with no book under it
        h.call('POST', '/api/books/one/taleD', book('taleD', ['one']), mine)
        gate = Gate(h.serve._log_lock)
        got = []
        with patched(h.serve, '_log_lock', gate):
            t = threading.Thread(target=lambda: got.append(h.call('POST', '/api/books/page/taleD', pg('taleD', 'A PAGE FOR A TALE LET GO'), mine, timeout=60)))
            t.start()
            reached = gate.waiting.wait(10)
            time.sleep(0.05)
            dropped = h.call('POST', '/api/books/drop/taleD', b'', mine, timeout=60)[0]
            gate.go.set()
            t.join(60)
        check(reached and dropped == 200 and bool(got) and got[0][2] == {'ok': False, 'whole': True} and not os.path.exists(h.path('books', 'taleD.log')) and os.path.exists(h.path('books', 'taleD.json.gone')),
              'a page that had reached the lock when its tale was let go is not written (no log beside the tombstone); the browser is told to send the whole book: ' + str(got[0][1][:60] if got else None))

        # sent words that had reached the lock when their tale was let go: not written back beside the tombstone
        h.call('POST', '/api/books/one/taleS', book('taleS', ['one']), mine)
        h.call('POST', '/api/books/sent/taleS', piece('taleS|a|1', 'WORDS'))
        lock = getattr(h.serve, '_sent_lock', None)
        got = []
        reached = dropped = False
        if lock is not None:
            gate = Gate(lock)
            with patched(h.serve, '_sent_lock', gate):
                t = threading.Thread(target=lambda: got.append(h.call('POST', '/api/books/sent/taleS', piece('taleS|b|1', 'WORDS SENT AS THE TALE WAS LET GO'), timeout=60)))
                t.start()
                reached = gate.waiting.wait(10)
                time.sleep(0.05)
                dropped = h.call('POST', '/api/books/drop/taleS', b'', mine, timeout=60)[0] == 200
                gate.go.set()
                t.join(60)
        check(lock is not None and reached and dropped and bool(got) and got[0][0] == 410 and not os.path.exists(h.path('sent', 'taleS.ndjson')),
              'sent words that had reached the lock when their tale was let go are refused (410), and no archive is written back: ' + str(got[0][0] if got else 'there is no lock on the archive'))
    finally:
        h.close()


# ---------------------------------------------------------------------------------------------------------------------
# 3. A COPY BROUGHT BACK NEVER LEAVES THE LIBRARY GONE
class Cut(BaseException):
    """The server killed at this very step (not an Exception: nothing in serve.py may catch it and tidy up)."""


def scene_restore():
    data = fresh('restore')
    serve = load(data)
    books, sent, old_dir, stage = [os.path.join(data, n) for n in ('books', 'sent', '.restore-old', '.restore-stage')]

    def reseed(epoch=None):
        for n in os.listdir(data):   # the safety copies too: each sub-scene starts from nothing but the library
            p = os.path.join(data, n)
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
        seed_files(data)
        if epoch:
            write(os.path.join(data, '.epoch'), epoch)
        return tree(data, skip_bak=False)

    def epoch_now():
        return read(os.path.join(data, '.epoch')).decode() if os.path.exists(os.path.join(data, '.epoch')) else ''

    def free(name):
        lock = getattr(serve, name, None)
        if lock is None:
            return False
        got = lock.acquire(timeout=2)
        if got:
            lock.release()
        return got

    # the copy: other books, other sent words — and a top-level file the library does not have (the old single-file book)
    good_files = [('books/_house.json', HOUSE.replace(b'dark', b'light')), ('books/taleA.json', book('taleA', ['AS COPIED'])), ('books.json', b'{"the old single file": true}'),
                  ('sent/taleA.ndjson', piece('taleA|cp|9', 'COPIED WORDS') + page('snt_copied', 'taleA', ['taleA|cp|9']))]
    good = mkzip(good_files)

    # the audit's zip: it passes every check, and holds a FILE named `sent` where the library has the folder sent/
    before = reseed()
    r = serve.restore_backup(mkzip([('books/_house.json', HOUSE), ('books/taleA.json', '{"kind":"story"}'), ('sent', 'x')]))
    after = tree(data, skip_bak=False)
    check(after == before, 'a zip with a file named `sent` (the library has a sent/ folder): THE LIBRARY IS STILL THERE, every file as it was — gone: %s; answer: %s' % (sorted(set(before) - set(after)) or 'none', str(r.get('why'))[:110]))
    check(r.get('ok') is False and leftovers(data) == [], 'and nothing is left behind: ' + str(leftovers(data)))

    # other names a copy may not carry: the folders a restore works in, the safety copies (or a folder named like them,
    # which no copy ever holds), a file where the books are kept
    for label, entries in [('the folder a restore sets the library aside in', [('.restore-old/books/x.json', '{}')]),
                           ('a folder named like the safety copies', [('backups-old/cozytavern-1.zip', 'x')]),
                           ('a file named `books`', [('books', 'x')]),
                           ('a name that is a file and a folder at once', [('books/x', 'file'), ('books/x/y.json', 'inside')])]:
        r = serve.restore_backup(mkzip([('books/_house.json', HOUSE)] + entries))
        check(r.get('ok') is False and tree(data, skip_bak=False) == before and leftovers(data) == [], 'a zip holding %s is not taken, and nothing is touched or left behind (%s)' % (label, str(r.get('why'))[:70]))

    # a copy that is read out and then cannot be put in place: one part is in, the next one fails
    before = reseed()
    real_replace = os.replace
    hits = []
    def fails_into_sent(src, dst, *a, **k):
        d = os.path.abspath(dst)
        if not hits and (d == sent or d.startswith(sent + os.sep)):
            hits.append(d)
            raise OSError(errno.EIO, 'made to fail by the test', dst)
        return real_replace(src, dst, *a, **k)
    with patched(os, 'replace', fails_into_sent):
        r = serve.restore_backup(good)
    after = tree(data, skip_bak=False)
    check(bool(hits) and r.get('ok') is False and after == before, 'a copy that fails half-way into its place: the library is back as it stood, byte for byte — differs: %s' % (sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k)) or 'nothing'))
    check(leftovers(data) == [], 'with no .restore-stage or .restore-old left: ' + str(leftovers(data)))
    check(str(r.get('why', '')).endswith('nothing was changed'), 'the answer says nothing was changed: ' + str(r.get('why'))[:150])
    check(bool(r.get('safety')) and r.get('safety') in zips(data), 'and names the copy of the library that was kept first: ' + str(r.get('safety')))
    check(epoch_now() == '', 'the library\'s epoch is as it was (none)')
    check(all(free(n) for n in ('_log_lock', '_sent_lock', '_backup_lock')), 'and each of the three locks is there and free')

    # the same while the library is being set aside (the first half of the swap)
    before = reseed()
    hits2 = []
    def fails_aside(src, dst, *a, **k):
        if not hits2 and os.path.abspath(dst) == os.path.join(old_dir, 'sent'):
            hits2.append(dst)
            raise OSError(errno.EIO, 'made to fail by the test', dst)
        return real_replace(src, dst, *a, **k)
    with patched(os, 'replace', fails_aside):
        r = serve.restore_backup(good)
    check(bool(hits2) and r.get('ok') is False and tree(data, skip_bak=False) == before and leftovers(data) == [], 'a failure while the library is being set aside: put back as it stood, nothing left behind (the failure was reached: %s)' % bool(hits2))

    # a page another browser appends while the copy is being read out — after the library was zipped, before it goes
    before = reseed()
    late = json.dumps({'m': {'id': 'taleA-late', 'storyId': 'taleA', 'role': 'user', 'text': 'APPENDED WHILE THE COPY WAS BEING READ OUT', 'ts': 9}, 'by': 'tab-2', 'at': '2026-10-03T00:00:00.000Z'}).encode() + b'\n'
    real_copyfileobj = shutil.copyfileobj
    wrote_late = []
    def copy_then_append(src, out, *a, **k):
        if '.restore-stage' in str(getattr(out, 'name', '')) and not wrote_late:
            wrote_late.append(1)
            with open(os.path.join(books, 'taleA.log'), 'ab') as f:
                f.write(late)
        return real_copyfileobj(src, out, *a, **k)
    with patched(shutil, 'copyfileobj', copy_then_append):
        r = serve.restore_backup(good)
    in_kept = b''
    if r.get('safety') and r.get('safety') in zips(data):
        with zipfile.ZipFile(os.path.join(data, 'backups', r['safety'])) as z:
            in_kept = z.read('books/taleA.log') if 'books/taleA.log' in z.namelist() else b''
    check(bool(wrote_late) and r.get('ok') is True and late in in_kept, 'a page appended after the library was zipped and before it went: it IS in the copy kept first (the library is zipped again before it goes)')
    check(len(zips(data)) == 1, 'and that restore still leaves one copy of the library as it stood, not two: ' + str(zips(data)))
    # a library that is written to every time it is looked at. M675 refused the copy then (a page landing between the zip
    # and the swap was in neither); M681: after two tries the library is held still — the safety copy is taken with the
    # write locks held and the swap follows in the same hold — so the copy he asked for is brought back, and NOTHING
    # written meanwhile is lost: every page is in the copy kept first (scene 9 brings a copy back under real writes)
    before = reseed()
    real_print = getattr(serve, '_library_print', None)
    looks = []
    def print_after_a_write():
        looks.append(1)
        with open(os.path.join(books, 'taleA.log'), 'ab') as f:
            f.write(late.replace(b'taleA-late', b'taleA-late-%d' % len(looks)))
        return real_print()
    with patched(serve, '_library_print', print_after_a_write):
        r = serve.restore_backup(good)
    kept_log = b''
    if r.get('safety') and r.get('safety') in zips(data):
        with zipfile.ZipFile(os.path.join(data, 'backups', r['safety'])) as z:
            kept_log = z.read('books/taleA.log') if 'books/taleA.log' in z.namelist() else b''
    lost = [n for n in range(1, len(looks) + 1) if (b'taleA-late-%d"' % n) not in kept_log and (b'taleA-late-%d"' % n) not in read(os.path.join(books, 'taleA.log'))]
    check(real_print is not None and len(looks) >= 3 and r.get('ok') is True and leftovers(data) == [] and not lost,
          'a library written to every time it is looked at (%d looks): held still, the copy is brought back, and no page written meanwhile is lost — lost: %s (%s)' % (len(looks), lost or 'none', str(r.get('why'))[:80]))
    check(len(zips(data)) == 1, 'and one copy of it was kept, not one for each try: ' + str(zips(data)))

    # the storage is full at the very moment the new epoch is to be written: still nothing is changed
    before = reseed('E-before')
    def no_epoch(name):
        raise no_room('.epoch')
    with patched(serve, '_set_epoch', no_epoch):
        r = serve.restore_backup(good)
    check(r.get('ok') is False and tree(data, skip_bak=False) == before and leftovers(data) == [] and epoch_now() == 'E-before', 'no room to write the new epoch: the copy is not put in place, the library and its epoch are as they stood (%s)' % str(r.get('why'))[:90])

    # the worst case: the copy fails half-way AND the library cannot be put back at once — it is kept, and put back later
    before = reseed()
    hits3 = []
    def fails_twice(src, dst, *a, **k):
        d = os.path.abspath(dst)
        if len(hits3) == 0 and d == sent:                                   # the copy's sent/ cannot be placed
            hits3.append(d)
            raise OSError(errno.EIO, 'made to fail by the test', dst)
        if len(hits3) == 1 and os.path.abspath(src).startswith(old_dir + os.sep):   # and the first old part cannot come back
            hits3.append(d)
            raise OSError(errno.EIO, 'made to fail by the test', dst)
        return real_replace(src, dst, *a, **k)
    with patched(os, 'replace', fails_twice):
        r = serve.restore_backup(good)
    check(len(hits3) == 2 and r.get('ok') is False and os.path.isdir(old_dir) and '.restore-old' in str(r.get('why')) and not str(r.get('why')).endswith('nothing was changed'),
          'a copy that fails half-way while the library cannot be put back either: the answer says where the library is kept, and does not say "nothing was changed" (%s)' % str(r.get('why'))[:200])
    r = serve.make_backup(force=True)
    check(r.get('ok') is True and tree(data, skip_bak=False) == before and leftovers(data) == [], 'and the next thing the device does with its library puts it back first: every file as it stood, and the copy then taken is whole')

    # the server KILLED at every step of the swap — then the house puts the library back by itself
    recover = getattr(serve, '_recover_restore', None)
    steps = []
    def counting(src, dst, *a, **k):
        if not os.path.abspath(dst).startswith(os.path.join(data, 'backups') + os.sep):
            steps.append(os.path.relpath(dst, data))
        return real_replace(src, dst, *a, **k)
    reseed('E-before')
    with patched(os, 'replace', counting):
        r = serve.restore_backup(good)
    check(r.get('ok') is True and recover is not None, 'the swap, step by step (%d moves): %s' % (len(steps), steps))
    wrong = []
    for was, at in [(w, a) for w in ('E-before', '') for a in range(len(steps) + 1)]:   # killed just before move number `at`; the last one: just after the final move
        before = reseed(was)
        seen = []
        def cut_at(src, dst, *a, **k):
            if not os.path.abspath(dst).startswith(os.path.join(data, 'backups') + os.sep):
                if len(seen) == at:
                    raise Cut()
                seen.append(dst)
                out = real_replace(src, dst, *a, **k)
                if at == len(steps) and len(seen) == len(steps):
                    raise Cut()
                return out
            return real_replace(src, dst, *a, **k)
        try:
            with patched(os, 'replace', cut_at):
                serve.restore_backup(good)
            wrong.append('step %d: the restore was not cut off' % at)
            continue
        except Cut:
            pass
        mid = os.path.lexists(old_dir)
        said = recover() if recover else 'no _recover_restore'
        now = tree(data, skip_bak=False)
        if at < len(steps):
            if not (mid and said == '' and now == before and leftovers(data) == [] and epoch_now() == was):
                wrong.append('epoch %r, killed before move %d (%s): mid-swap %s, recover said %r, library as it stood %s, left %s, epoch now %r' % (was, at + 1, steps[at], mid, said, now == before, leftovers(data), epoch_now()))
        else:
            copied = {n: hashlib.sha1(b if isinstance(b, bytes) else b.encode()).hexdigest()[:12] for n, b in good_files}
            if not (not mid and said == '' and now == copied and leftovers(data) == [] and epoch_now() not in ('', 'E-before')):
                wrong.append('epoch %r, killed after the last move: the copy stands %s, recover said %r, left %s, epoch now %r' % (was, now == copied, said, leftovers(data), epoch_now()))
        if not all(free(n) for n in ('_log_lock', '_sent_lock', '_backup_lock')):
            wrong.append('step %d: a lock is missing or was left held' % at)
    check(recover is not None and not wrong, 'killed before each of the %d moves, and after the last (with an epoch and with none): the library is put back as it stood each time, epoch and all — or, once the copy stood, left standing: %s' % (len(steps), '; '.join(wrong)[:600] or 'every step'))
    # and the putting-back itself cut off, at each of its own steps: the next run finishes it
    wrong = []
    undo_steps = None
    at = 0
    while recover is not None and (undo_steps is None or at < undo_steps):
        before = reseed('E-before')
        seen = []
        def cut_before_commit(src, dst, *a, **k):
            if os.path.abspath(dst) == os.path.join(stage, '.restore-old'):
                raise Cut()   # everything is in place and the new epoch written; the last move never happens
            return real_replace(src, dst, *a, **k)
        try:
            with patched(os, 'replace', cut_before_commit):
                serve.restore_backup(good)
        except Cut:
            pass
        def undo_cut(src, dst, *a, **k):
            if len(seen) == at:
                raise Cut()
            seen.append(os.path.relpath(dst, data))
            return real_replace(src, dst, *a, **k)
        if undo_steps is None:   # first, count the steps of a putting-back that runs to its end
            counted = []
            def count(src, dst, *a, **k):
                counted.append(os.path.relpath(dst, data))
                return real_replace(src, dst, *a, **k)
            with patched(os, 'replace', count):
                said = recover()
            undo_steps = len(counted)
            if not (said == '' and tree(data, skip_bak=False) == before and epoch_now() == 'E-before'):
                wrong.append('the putting-back did not put the library back (%r)' % said)
            continue
        try:
            with patched(os, 'replace', undo_cut):
                recover()
            wrong.append('step %d: the putting-back was not cut off' % at)
        except Cut:
            pass
        said = recover()
        if not (said == '' and tree(data, skip_bak=False) == before and leftovers(data) == [] and epoch_now() == 'E-before'):
            wrong.append('cut before its move %d: said %r, library as it stood %s, left %s, epoch %r' % (at + 1, said, tree(data, skip_bak=False) == before, leftovers(data), epoch_now()))
        at += 1
    # and cut off while it is clearing away what the copy had put in place
    if recover is not None:
        before = reseed('E-before')
        try:
            with patched(os, 'replace', cut_before_commit):
                serve.restore_backup(good)
        except Cut:
            pass
        real_rmtree = shutil.rmtree
        def rmtree_cut(path, *a, **k):
            if os.path.abspath(path) == sent:
                os.remove(os.path.join(sent, os.listdir(sent)[0]))
                raise Cut()
            return real_rmtree(path, *a, **k)
        try:
            with patched(shutil, 'rmtree', rmtree_cut):
                recover()
            wrong.append('the clearing-away was not cut off')
        except Cut:
            pass
        said = recover()
        if not (said == '' and tree(data, skip_bak=False) == before and leftovers(data) == [] and epoch_now() == 'E-before'):
            wrong.append('cut while clearing the copy away: said %r, library as it stood %s' % (said, tree(data, skip_bak=False) == before))
    check(recover is not None and bool(undo_steps) and not wrong, 'the putting-back cut off before each of its own %s moves, and while clearing the copy away: run again, the library is as it stood, epoch and all — %s' % (undo_steps, '; '.join(wrong)[:500] or 'every step'))

    # killed between the library being set aside and the mark that says so
    before = reseed()
    real_open = open
    def cut_at_mark(file, *a, **k):
        if os.path.abspath(str(file)).startswith(os.path.join(old_dir, '.epoch')):
            raise Cut()
        return real_open(file, *a, **k)
    cut = False
    try:
        with patched(serve, 'open', cut_at_mark):
            serve.restore_backup(good)
    except Cut:
        cut = True
    said = recover() if recover else 'no _recover_restore'
    check(cut and said == '' and tree(data, skip_bak=False) == before and leftovers(data) == [] and epoch_now() == '', 'killed when every part was aside and nothing yet in its place: put back as it stood (cut: %s, said %r)' % (cut, said))

    # a state made by hand, as the brief describes it: the old books moved into .restore-old, the copy's standing in their place
    before = reseed()
    os.mkdir(old_dir)
    os.replace(books, os.path.join(old_dir, 'books'))
    write(os.path.join(books, '_house.json'), b'{"kind":"house","from":"the copy"}')
    write(os.path.join(stage, 'sent', 'taleA.ndjson'), b'the copy, read out and not yet placed')
    said = recover() if recover else 'no _recover_restore'
    check(said == '' and tree(data, skip_bak=False) == before and leftovers(data) == [], 'a swap cut off, made by hand (.restore-old holds the old books, the copy\'s stand in their place): _recover_restore puts the library back — said %r, left %s' % (said, leftovers(data)))

    # and the house does it by itself when it starts, before it serves anything
    before = reseed()
    os.mkdir(old_dir)
    os.replace(books, os.path.join(old_dir, 'books'))
    os.replace(sent, os.path.join(old_dir, 'sent'))
    write(os.path.join(old_dir, '.epoch'), b'\n')  # the mark: every part was aside (and the epoch as it stood: none)
    write(os.path.join(books, '_house.json'), b'{"kind":"house","from":"the copy"}')
    write(os.path.join(data, 'books.json'), b'{"from": "the copy"}')  # a part of the copy the old library has no namesake for
    write(os.path.join(stage, 'sent', 'taleA.ndjson'), b'not yet placed')
    # (a copy was already taken today, so the copy the device takes at every start — which would also put the library
    #  back, a moment later — does not run: what is held here is the house doing it BEFORE it serves anything)
    write(os.path.join(data, 'backups', 'cozytavern-%s-000000.zip' % time.strftime('%Y%m%d')), mkzip([('books/_house.json', HOUSE)]))
    p, port = start(data)   # (waits until the server answers api/version — which asks nothing of the library)
    try:
        check(leftovers(data) == [] and tree(data, skip_bak=False) == before, 'a server started on a library cut off mid-swap has put it back before it is asked anything: every file as it was, nothing of the copy among them (left: %s)' % leftovers(data))
        got = call(port, 'GET', '/api/books/one/taleA')
        check(got[0] == 200 and b'THE-PAGE-OF-taleA' in got[1], 'and serves the library as it stood (status %s)' % got[0])
    finally:
        stop(p)

    # a good copy still replaces the library exactly, and the library as it stood is kept first
    before = reseed()
    write(os.path.join(data, 'books.json.bak1'), b'an old single-file book, one push back')   # the device's own: not the library's
    write(os.path.join(data, 'backups-of-mine', 'keep.txt'), b'his own folder of copies')        # never zipped, so never removed
    write(os.path.join(data, 'backups', 'note.txt'), b'in the backups folder')
    r = serve.restore_backup(mkzip(good_files + [('books.json.bak1', b'a .bak1 from a zip made before M571')]))
    now = tree(data, skip_bak=False)
    copied = {n: hashlib.sha1(b).hexdigest()[:12] for n, b in good_files}
    kept_aside = {'books.json.bak1', 'backups-of-mine/keep.txt'}
    check(r.get('ok') is True and {k: v for k, v in now.items() if k not in kept_aside} == copied, 'a good copy replaces the library exactly: ' + str(sorted(k for k in now if k not in kept_aside)))
    check(r.get('files') == len(good_files) and leftovers(data) == [], 'it says how many files (%s) and leaves nothing behind' % r.get('files'))
    held = {}
    if r.get('safety'):
        with zipfile.ZipFile(os.path.join(data, 'backups', r['safety'])) as z:
            held = {n: hashlib.sha1(z.read(n)).hexdigest()[:12] for n in z.namelist()}
    check(held == before, 'the copy kept first holds the library exactly as it stood (%d files)' % len(held))
    check(read(os.path.join(data, 'books.json.bak1')) == b'an old single-file book, one push back' and os.path.exists(os.path.join(data, 'backups-of-mine', 'keep.txt')) and os.path.exists(os.path.join(data, 'backups', 'note.txt')), 'what is not the library\'s is left where it was (an old .bak1, a folder of his own copies, the backups folder)')
    check(b'COPIED WORDS' in read(os.path.join(sent, 'taleA.ndjson')), 'the copy\'s archive of sent words is in place')

    # a device with nothing on it yet (a new phone): the copy moves in
    empty = fresh('restore-empty')
    serve2 = load(empty)
    r = serve2.restore_backup(good)
    check(r.get('ok') is True and r.get('safety') is None and tree(empty, skip_bak=False) == copied and leftovers(empty) == [], 'a copy brought back onto an empty device: the library is the copy')
    # ...and a copy that fails on its way onto an empty device leaves it empty (there is no old library to put back)
    empty2 = fresh('restore-empty-fails')
    serve4 = load(empty2)
    hits4 = []
    def fails_on_empty(src, dst, *a, **k):
        if not hits4 and os.path.abspath(dst) == os.path.join(empty2, 'sent'):
            hits4.append(dst)
            raise OSError(errno.EIO, 'made to fail by the test', dst)
        return real_replace(src, dst, *a, **k)
    with patched(os, 'replace', fails_on_empty):
        r = serve4.restore_backup(good)
    check(bool(hits4) and r.get('ok') is False and tree(empty2, skip_bak=False) == {} and leftovers(empty2) == [], 'a copy that fails half-way onto an empty device leaves nothing of itself behind: ' + str(sorted(tree(empty2, skip_bak=False))))

    # two copies brought back within the same second: the copy of the library as it first stood is still there
    twice = fresh('restore-twice')
    serve3 = load(twice)
    seed_files(twice)
    first_library = tree(twice, skip_bak=False)
    r1 = serve3.restore_backup(good)
    r2 = serve3.restore_backup(good)
    kept = {}
    for n in zips(twice):
        with zipfile.ZipFile(os.path.join(twice, 'backups', n)) as z:
            kept[n] = {m: hashlib.sha1(z.read(m)).hexdigest()[:12] for m in z.namelist()}
    check(r1.get('ok') is True and r2.get('ok') is True and r1.get('safety') != r2.get('safety') and kept.get(r1.get('safety')) == first_library,
          'two copies brought back one straight after the other: each kept its own copy of the library first (%s, %s) — the first is not written over' % (r1.get('safety'), r2.get('safety')))


def scene_half_swapped():
    """Over real HTTP: nothing is read from, or written into, a library half-way through a swap."""
    h = House('half-swapped')
    try:
        seed_files(h.data)
        before = tree(h.data, skip_bak=False)
        good = mkzip([('books/_house.json', HOUSE.replace(b'dark', b'light')), ('books/taleA.json', book('taleA', ['AS COPIED'])), ('books/taleNew.json', book('taleNew', ['ONLY IN THE COPY']))])
        real_replace = os.replace
        # a request that arrives while the copy is moving in: it waits, and then sees the library the copy made
        mid, go = threading.Event(), threading.Event()
        def slow_swap(src, dst, *a, **k):
            if os.path.abspath(dst) == h.path('books') and not mid.is_set():
                mid.set()      # the old library is aside, the copy's books are about to move in
                go.wait(20)
            return real_replace(src, dst, *a, **k)
        answers = {}
        with patched(os, 'replace', slow_swap):
            t = threading.Thread(target=lambda: answers.update(restore=h.call('POST', '/api/backup/restore', good, timeout=60)))
            t.start()
            reached = mid.wait(20)
            r1 = threading.Thread(target=lambda: answers.update(listed=h.call('GET', '/api/books/list', timeout=60), at=time.time()))
            r2 = threading.Thread(target=lambda: answers.update(pushed=h.call('POST', '/api/books/one/taleB', book('taleB', ['pushed mid-swap']), {'X-Cozy-Epoch': '-'}, timeout=60)))
            r1.start()
            r2.start()
            time.sleep(0.6)
            early = dict(answers)   # what has been answered while the swap is still held half-way
            released = time.time()
            go.set()
            [x.join(60) for x in (t, r1, r2)]
        listed = (answers.get('listed') or (0, b'', None))[2] or {}
        check(reached and 'listed' not in early and 'pushed' not in early and answers.get('at', 0) >= released,
              'a read and a write that arrive while a copy is moving in are not answered from the half-swapped library — they wait')
        check((answers.get('restore') or (0, b'', {}))[2].get('ok') is True and sorted(b['id'] for b in listed.get('books', [])) == ['_house', 'taleA', 'taleNew'] and bool(listed.get('epoch')),
              'and then the read lists the library the copy made, with its new epoch: ' + json.dumps(sorted(b['id'] for b in listed.get('books', []))))
        check((answers.get('pushed') or (0,))[0] == 409 and not os.path.exists(h.path('books', 'taleB.json')), 'and the write, made for the library as it was, is refused (409): ' + str((answers.get('pushed') or (0,))[0]))

        # a library left half-way that cannot be put back yet: nothing is read from it or written into it (503), and
        # the first request after the trouble has passed has it put back
        for n in os.listdir(h.data):
            p = h.path(n)
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
        seed_files(h.data)
        before = tree(h.data, skip_bak=False)
        os.mkdir(h.path('.restore-old'))
        os.replace(h.path('books'), h.path('.restore-old', 'books'))
        os.replace(h.path('sent'), h.path('.restore-old', 'sent'))
        write(h.path('.restore-old', '.epoch'), b'\n')
        write(h.path('books', '_house.json'), b'{"kind":"house","from":"the copy"}')
        real_undo = getattr(h.serve, '_undo_swap', None)
        with patched(h.serve, '_undo_swap', lambda: 'made to fail by the test'):
            got = [h.call('GET', '/api/books/list')[0], h.call('GET', '/api/books/one/_house')[0], h.call('GET', '/api/books/sent/taleA?have=1')[0], h.call('GET', '/api/backup/now')[0],
                   h.call('POST', '/api/books/one/taleZ', book('taleZ', ['written into a library half-way']))[0], h.call('POST', '/api/books/page/taleA', json.dumps({'m': {'id': 'z', 'text': 'z'}}).encode())[0],
                   h.call('POST', '/api/books/sent/taleA', piece('taleA|z|1', 'z'))[0], h.call('POST', '/api/books/drop/taleA', b'')[0], h.call('POST', '/api/books', b'{"a": 1}')[0]]
            still = h.call('GET', '/api/version')[0]
        check(real_undo is not None and got == [503] * 9 and still == 200 and not os.path.exists(h.path('books', 'taleZ.json')) and not os.path.exists(h.path('books.json')) and os.path.isdir(h.path('.restore-old')),
              'a library left half-way that cannot be put back yet: every read and write of it answers 503 (the browser keeps what it has and asks again), nothing is written: ' + str(got))
        r = h.call('GET', '/api/books/one/taleA')
        check(r[0] == 200 and b'THE-PAGE-OF-taleA' in r[1] and tree(h.data, skip_bak=False) == before and leftovers(h.data) == [], 'the trouble past, the next request has the library put back first, and is answered from it (%s)' % r[0])
    finally:
        h.close()


def scene_roundtrip():
    """The audit's r_roundtrip: books, a log, a tombstone and archives -> the device's zip -> the library damaged -> the zip
    brought back -> every file what it was. Over real HTTP, against serve.py as its own process."""
    data = fresh('roundtrip')
    p, port = start(data)
    try:
        post = lambda path, body, headers=None: call(port, 'POST', path, body, headers)
        for tid in ('taleA', 'taleB', 'taleGone'):
            post('/api/books/one/' + tid, book(tid, ['hello']))
            post('/api/books/one/' + tid, book(tid, ['hello']))  # twice: a .bak1 beside it, as in life
            post('/api/books/sent/' + tid, piece(tid + '|abc|5', 'WORDS') + page('snt_' + tid, tid, [tid + '|abc|5']))
        post('/api/books/one/_house', HOUSE)
        post('/api/books/page/taleA', json.dumps({'m': {'id': 'taleA-m3', 'storyId': 'taleA', 'role': 'user', 'text': 'A PAGE IN THE LOG', 'ts': 3}}).encode())
        post('/api/books/drop/taleGone', b'')
        t0 = tree(data)
        time.sleep(1.1)
        made = call(port, 'GET', '/api/backup/now', timeout=60)[2] or {}
        good = call(port, 'GET', '/api/backup/file', timeout=60)[1]
        names = sorted(zipfile.ZipFile(io.BytesIO(good)).namelist()) if made.get('ok') else []
        check(made.get('ok') is True and names == sorted(t0), 'the device\'s zip holds the books, the log, the tombstone and the archives: ' + str(names))
        # the library moves on and is damaged
        post('/api/books/drop/taleB', b'')
        with open(os.path.join(data, 'books', 'taleA.json'), 'ab') as f:
            f.write(b'GARBAGE')
        write(os.path.join(data, 'books', '_house.json'), b'{"cut":')
        write(os.path.join(data, 'stray.txt'), b'stray')
        post('/api/books/sent/taleA', piece('taleA|later|9', 'LATER WORDS'))
        post('/api/books/sent/taleNew', piece('taleNew|x|1', 'NEW'))
        damaged = tree(data)
        time.sleep(1.1)
        back = post('/api/backup/restore', good)[2] or {}
        t1 = tree(data)
        check(back.get('ok') is True and t1 == t0, 'the zip brought back over a damaged library: every file is what it was when the copy was taken — only before: %s, only after: %s, differ: %s' % (sorted(set(t0) - set(t1)), sorted(set(t1) - set(t0)), sorted(k for k in t0 if k in t1 and t0[k] != t1[k])))
        held = {}
        if back.get('safety'):
            with zipfile.ZipFile(os.path.join(data, 'backups', back['safety'])) as z:
                held = {n: hashlib.sha1(z.read(n)).hexdigest()[:12] for n in z.namelist()}
        check(held == damaged, 'the "library as it stood" zip holds the damaged library exactly')
        one = call(port, 'GET', '/api/books/sent/taleA?page=snt_taleA')[2] or {}
        have = call(port, 'GET', '/api/books/sent/taleA?have=1')[2] or {}
        check((one.get('pieces') or [{}])[0].get('t') == 'WORDS' and have == {'pages': ['snt_taleA'], 'pieces': ['taleA|abc|5']}, 'after it the device reads a page\'s words, and holds what the copy held (not the words added later): ' + json.dumps(have))
        check(call(port, 'GET', '/api/books/sent/taleGone?have=1')[0] in (404, 410) and not os.path.exists(os.path.join(data, 'sent', 'taleGone.ndjson')), 'the tale let go before the copy is still let go')
    finally:
        stop(p)


# ---------------------------------------------------------------------------------------------------------------------
# 4. THE ARCHIVE OF SENT WORDS: A CUT LINE IS NEVER TAKEN FOR A WHOLE ONE, AND NEVER SPOILS THE NEXT
class Half:
    """A file whose write takes the first half and then finds the storage full."""
    def __init__(self, real):
        self.real = real

    def write(self, data):
        self.real.write(data[:len(data) // 2])
        self.real.flush()
        raise no_room()

    def __getattr__(self, name):
        return getattr(self.real, name)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.real.close()
        return False


def breaking(target):
    """An `open` for serve.py that hands back a Half for one file, when it is opened to be added to."""
    target = os.path.abspath(target)
    def fake(file, mode='r', *a, **k):
        real = open(file, mode, *a, **k)
        if 'a' in mode and os.path.abspath(str(file)) == target:
            return Half(real)
        return real
    return fake


def scene_archive():
    h = House('archive')
    try:
        T = 'taleS'
        arch = h.path('sent', T + '.ndjson')
        url = '/api/books/sent/' + T
        frame, one, two, three = [T + '|' + n + '|5' for n in ('frame', 'one', 'two', 'three')]
        TWO = 'PAGE TWO WORDS — ' + 'x' * 300
        have = lambda: h.call('GET', url + '?have=1')[2] or {}
        words = lambda pid: {p.get('k'): p.get('t') for p in ((h.call('GET', url + '?page=' + pid)[2] or {}).get('pieces') or [])}
        h.call('POST', '/api/books/one/' + T, book(T, ['one']))
        r = h.call('POST', url, piece(frame, 'THE FRAME') + piece(one, 'PAGE ONE WORDS') + page('snt_1', T, [frame, one]))
        check(r[0] == 200 and have() == {'pages': ['snt_1'], 'pieces': sorted([frame, one])}, 'a page\'s words are kept, and the device says what it holds')
        whole = read(arch)
        # the kill: the append of page two's lines stopped partway through its first line (no closing quote, no line break)
        with open(arch, 'ab') as f:
            f.write(piece(two, TWO)[:120])
        h1 = have()
        check(two not in h1.get('pieces', [two]) and h1.get('pages') == ['snt_1'], 'an archive ending in a cut line: the device does NOT claim to hold the piece whose line was cut')
        # the next push: a new piece and a new page, written after the cut line
        r = h.call('POST', url, piece(three, 'PAGE THREE WORDS') + page('snt_3', T, [frame], body_keys=[three]))
        w3 = words('snt_3')
        check(r[0] == 200 and w3 == {frame: 'THE FRAME', three: 'PAGE THREE WORDS'}, 'lines added after a cut line read back whole — the first of them is not glued to it: ' + str(sorted(w3)))
        h2 = have()
        check(two not in h2.get('pieces', [two]) and three in h2.get('pieces', []) and 'snt_3' in h2.get('pages', []), 'asked again (it remembers what it read): still not the cut piece, and the new piece and page are listed')
        check(read(arch).startswith(whole + piece(two, TWO)[:120] + b'\n'), 'nothing already written was rewritten: the cut line stands alone on its own line')
        # a page whose own record is whole but whose piece was cut (the old fault: the browser was told the piece was held)
        h.call('POST', url, page('snt_2', T, [frame, two]))
        h3 = have()
        check('snt_2' not in h3.get('pages', ['snt_2']), 'a page whose piece was cut is not listed as held (so the browser sends it, and the piece, again)')
        check(two not in words('snt_2'), 'and its cut piece is not handed back as words')
        r = h.call('POST', url, piece(two, TWO))  # the browser sends the cut piece again, whole
        check(r[0] == 200 and words('snt_2') == {frame: 'THE FRAME', two: TWO}, 'the cut piece sent again: its page reads back whole, word for word')
        h4 = have()
        check(two in h4.get('pieces', []) and sorted(h4.get('pages', [])) == ['snt_1', 'snt_2', 'snt_3'], 'and now the device says it holds that piece and that page: ' + json.dumps(h4.get('pages')))

        # what the device remembers of an archive is dropped when the file is no longer the one it read
        write(arch, piece(frame, 'ANOTHER FRAME') + page('snt_9', T, [frame]) + piece(T + '|pad|5', 'p' * 2000))  # put there by hand, longer, same name
        check(have() == {'pages': ['snt_9'], 'pieces': sorted([frame, T + '|pad|5'])}, 'another file put under the same name (longer): the device reads it anew')
        write(arch, piece(frame, 'A THIRD FRAME') + page('snt_8', T, [frame]))  # shorter
        check(have() == {'pages': ['snt_8'], 'pieces': [frame]}, 'and a shorter one too')
        size = os.path.getsize(arch)
        time.sleep(0.05)
        write(arch, piece(frame, 'B THIRD FRAME') + page('snt_7', T, [frame]))  # the very same length, other words
        check(os.path.getsize(arch) == size and have() == {'pages': ['snt_7'], 'pieces': [frame]}, 'and one of the very same length')

        # a last line that has no end yet is not held — and is, once the next write has given it its end
        write(arch, piece(frame, 'A FIFTH FRAME') + piece(T + '|tail|5', 'WHOLE WORDS, NO LINE BREAK YET')[:-1])
        h5 = have()
        r = h.call('POST', url, page('snt_6', T, [frame, T + '|tail|5']))
        h6 = have()
        check(h5 == {'pages': [], 'pieces': [frame]} and r[0] == 200 and h6 == {'pages': ['snt_6'], 'pieces': sorted([frame, T + '|tail|5'])} and words('snt_6').get(T + '|tail|5') == 'WHOLE WORDS, NO LINE BREAK YET',
              'a last line with no line break yet is not listed as held; after the next write it has its end, is listed and read: ' + json.dumps(h5.get('pieces')) + ' -> ' + json.dumps(h6.get('pieces')))
        write(arch, piece(frame, 'B THIRD FRAME') + page('snt_7', T, [frame]))

        # a write that fails half-way leaves no half line
        stood = read(arch)
        with patched(h.serve, 'open', breaking(arch)):
            r = h.call('POST', url, piece(T + '|four|5', 'PAGE FOUR WORDS ' * 20) + page('snt_4', T, [frame, T + '|four|5']))
        check(r[0] == 500 and read(arch) == stood, 'a write that runs out of storage half-way: the answer is 500 and the archive is exactly as it stood (%d bytes before, %d after)' % (len(stood), os.path.getsize(arch)))
        r = h.call('POST', url, piece(T + '|four|5', 'PAGE FOUR WORDS ' * 20) + page('snt_4', T, [frame, T + '|four|5']))
        check(r[0] == 200 and words('snt_4').get(T + '|four|5') == 'PAGE FOUR WORDS ' * 20 and 'snt_4' in have().get('pages', []), 'with room again the same lines land, read back, and are listed')
        fresh_arch = h.path('sent', 'taleNew.ndjson')
        with patched(h.serve, 'open', breaking(fresh_arch)):
            r = h.call('POST', '/api/books/sent/taleNew', piece('taleNew|a|1', 'FIRST WORDS OF A NEW TALE'))
        check(r[0] == 500 and not os.path.exists(fresh_arch), 'a first write that fails leaves no archive at all')

        # the same holds for a book's log of appended pages
        log = h.path('books', T + '.log')
        pg = lambda n, text: json.dumps({'m': {'id': '%s-p%d' % (T, n), 'storyId': T, 'role': 'user', 'text': text, 'ts': 10 + n}}).encode()
        texts = lambda: [m.get('text') for m in ((h.call('GET', '/api/books/one/' + T)[2] or {}).get('messages') or [])]
        h.call('POST', '/api/books/page/' + T, pg(1, 'APPENDED ONE'))
        with open(log, 'ab') as f:
            f.write(b'{"m": {"id": "' + T.encode() + b'-cut", "text": "A PAGE CUT SH')  # a kill mid-append
        r = h.call('POST', '/api/books/page/' + T, pg(2, 'APPENDED AFTER THE CUT'))
        check(r[0] == 200 and 'APPENDED AFTER THE CUT' in texts() and 'APPENDED ONE' in texts(), 'a page appended after a cut line in a book\'s log is read back (it is not glued to the cut line): ' + str(texts()))
        stood = read(log)
        with patched(h.serve, 'open', breaking(log)):
            r = h.call('POST', '/api/books/page/' + T, pg(3, 'A PAGE THAT DOES NOT FIT ' * 10))
        check(r[0] == 500 and read(log) == stood, 'a page whose write fails half-way leaves the log exactly as it stood')
        r = h.call('POST', '/api/books/page/' + T, pg(4, 'APPENDED LAST'))
        check(r[0] == 200 and texts()[-1] == 'APPENDED LAST' and 'APPENDED AFTER THE CUT' in texts(), 'and the next page lands and reads back')
    finally:
        h.close()


# ---------------------------------------------------------------------------------------------------------------------
# 5. A TALE LET GO IS NOT WRITTEN TO AGAIN
def scene_tombstone():
    h = House('tombstone')
    try:
        T = 'taleD'
        arch = h.path('sent', T + '.ndjson')
        lines = piece(T + '|a|1', 'WORDS') + page('snt_d', T, [T + '|a|1'])
        h.call('POST', '/api/books/one/' + T, book(T, ['one']))
        check(h.call('POST', '/api/books/sent/' + T, lines)[0] == 200 and os.path.exists(arch), 'a tale\'s sent words are kept')
        h.call('GET', '/api/books/sent/' + T + '?have=1')
        r = h.call('POST', '/api/books/drop/' + T, b'')
        check(r[0] == 200 and not os.path.exists(arch) and os.path.exists(h.path('books', T + '.json.gone')), 'the tale let go: its archive goes with it, its tombstone stands')
        r = h.call('POST', '/api/books/sent/' + T, lines)  # the browser's four-minute timer fires after the tale was let go
        check(r[0] == 410 and r[2] == {'ok': False, 'gone': True}, 'its words sent afterwards are refused — 410 {"ok": false, "gone": true}: %s %s' % (r[0], r[1][:60]))
        check(not os.path.exists(arch), 'and NO archive is written back beside the tombstone')
        r = h.call('GET', '/api/books/sent/' + T + '?have=1')
        check(r[0] == 410 and r[2] == {'gone': True}, 'asked what it holds of that tale: 410 {"gone": true} (%s)' % r[0])
        r = h.call('GET', '/api/books/sent/' + T + '?page=snt_d')
        check(r[0] == 410 and r[2] == {'gone': True}, 'asked for one of its pages: 410 {"gone": true} (%s)' % r[0])
        r = h.call('POST', '/api/books/sent/' + T + '?from=taleOther', json.dumps({'pages': ['x']}).encode())
        check(r[0] == 410 and not os.path.exists(arch), 'pages copied into it: 410 too (%s)' % r[0])
        # a whole-book push of that tale clears the tombstone, as it always did — and then its words are kept again
        h.call('POST', '/api/books/one/' + T, book(T, ['one', 'two']))
        r = h.call('POST', '/api/books/sent/' + T, lines)
        got = h.call('GET', '/api/books/sent/' + T + '?have=1')
        check(not os.path.exists(h.path('books', T + '.json.gone')) and r[0] == 200 and got[2] == {'pages': ['snt_d'], 'pieces': [T + '|a|1']}, 'the tale pushed again stands again, and its words are kept and listed (not what was remembered of the archive that went)')
    finally:
        h.close()


# ---------------------------------------------------------------------------------------------------------------------
# 6. A BRANCH'S CARRIED PAGES ARE COPIED FROM ITS PARENT'S ARCHIVE
def scene_copy():
    h = House('copy')
    try:
        P, B = 'taleParent', 'taleBranch'
        src, dst = h.path('sent', P + '.ndjson'), h.path('sent', B + '.ndjson')
        k1, k2, k3, k9 = [P + '|k%d|9' % n for n in (1, 2, 3, 9)]
        h.call('POST', '/api/books/one/' + P, book(P, ['one']))
        h.call('POST', '/api/books/one/' + B, book(B, ['one']))
        h.call('POST', '/api/books/sent/' + P, piece(k1, 'WORDS ONE') + piece(k2, 'WORDS TWO — “curly”, é, a quote " and a backslash \\') + page('snt_p1', P, [k1, k2]))
        h.call('POST', '/api/books/sent/' + P, piece(k3, 'WORDS THREE — ' + 'y' * 800) + page('snt_p2', P, [k2], body_keys=[k3]))
        h.call('POST', '/api/books/sent/' + P, page('snt_p3', P, [k1, k9]))  # names a piece the archive never got
        h.call('POST', '/api/books/sent/' + P, page('snt_p1', P, [k1, k2, k3]))  # page one, written again: the last record stands
        ask = lambda pages, to=B, frm=P, headers=None: h.call('POST', '/api/books/sent/%s?from=%s' % (to, frm), json.dumps({'pages': pages}).encode(), headers)
        r = ask(['snt_p1', 'snt_p2', 'snt_p3', 'snt_never'])
        check(r[0] == 200 and r[2] == {'ok': True, 'copied': 2, 'missing': ['snt_p3', 'snt_never']}, 'two pages copied; the page with a missing piece and the unknown page are named as missing: %s %s' % (r[0], r[1][:120]))
        copied = read(dst).split(b'\n') if os.path.exists(dst) else []
        source = read(src).split(b'\n')
        check(bool(copied) and all(ln in source for ln in copied) and sum(1 for ln in copied if ln.startswith(b'{"k":')) == 3 and sum(1 for ln in copied if ln.startswith(b'{"p":')) == 2,
              'the branch\'s archive holds the three pieces and the two pages, each line byte for byte as the parent holds it')
        kinds = [ln[:4] for ln in copied if ln]
        check(bool(kinds) and kinds == sorted(kinds, key=lambda x: x != b'{"k"'), 'pieces first, pages last')
        one = h.call('GET', '/api/books/sent/%s?page=snt_p1' % B)[2] or {}
        got = {p['k']: p['t'] for p in one.get('pieces', [])}
        check(one.get('storyId') == B and got == {k1: 'WORDS ONE', k2: 'WORDS TWO — “curly”, é, a quote " and a backslash \\', k3: 'WORDS THREE — ' + 'y' * 800} and (one.get('pages') or [{}])[0].get('slots', [{}])[0].get('t') == [k1, k2, k3],
              'the copied page reads back under the branch\'s own name, with every piece — and it is the page\'s LAST record that was copied')
        two = h.call('GET', '/api/books/sent/%s?page=snt_p2' % B)[2] or {}
        check({p['k'] for p in two.get('pieces', [])} == {k2, k3}, 'a page whose pieces are named inside its request reads back too')
        have = h.call('GET', '/api/books/sent/%s?have=1' % B)[2] or {}
        check(have == {'pages': ['snt_p1', 'snt_p2'], 'pieces': sorted([k1, k2, k3])}, 'and the device lists them as held by the branch')
        size = os.path.getsize(dst) if os.path.exists(dst) else -1
        r = ask(['snt_p1', 'snt_p2', 'snt_p3'])
        check(r[2] == {'ok': True, 'copied': 2, 'missing': ['snt_p3']} and os.path.getsize(dst) == size, 'asked again: nothing new is written (%d bytes still), the two pages are counted as there' % size)
        check(read(src) == b'\n'.join(source), 'the parent\'s archive is untouched')
        r = ask(['snt_p1'], frm='taleNoArchive')
        check(r[0] == 200 and r[2] == {'ok': True, 'copied': 0, 'missing': ['snt_p1']}, 'a parent with no archive: nothing copied, every page named as missing')
        check(ask(['snt_p1'], frm='..%2Fx')[0] == 400 and ask(['snt_p1'], to='bad.id')[0] == 400 and h.call('POST', '/api/books/sent/%s?from=%s' % (B, P), b'{"pages": "not a list"}')[0] == 400 and ask(['x'] * 3 + [5])[0] == 400,
              'a name that is not a tale\'s, or a body that is not a list of page ids: 400')
        check(ask(['p%d' % i for i in range(20001)])[0] == 400 and ask(['p%d' % i for i in range(20000)])[0] == 200, 'at most 20,000 ids are taken at once')
        # the write lands whole or not at all
        C = 'taleBranchTwo'
        dst2 = h.path('sent', C + '.ndjson')
        with patched(h.serve, 'open', breaking(dst2)):
            r = ask(['snt_p1', 'snt_p2'], to=C)
        check(r[0] == 500 and not os.path.exists(dst2), 'a copy that runs out of storage half-way writes nothing (500, no archive)')
        r = ask(['snt_p1', 'snt_p2'], to=C)
        check(r[2] == {'ok': True, 'copied': 2, 'missing': []} and {p['k'] for p in (h.call('GET', '/api/books/sent/%s?page=snt_p1' % C)[2] or {}).get('pieces', [])} == {k1, k2, k3}, 'and with room again it is copied whole')
        # the parent let go afterwards: the branch still reads its carried pages
        h.call('POST', '/api/books/drop/' + P, b'')
        check(not os.path.exists(src) and {p['k'] for p in (h.call('GET', '/api/books/sent/%s?page=snt_p1' % B)[2] or {}).get('pieces', [])} == {k1, k2, k3}, 'the parent let go: its archive is gone, and the branch still reads its carried page')
    finally:
        h.close()


# ---------------------------------------------------------------------------------------------------------------------
# 7. THE LIBRARY'S EPOCH: A WRITE MADE FOR THE LIBRARY AS IT WAS BEFORE A COPY CAME BACK IS REFUSED
def listen(port, seen, ready):
    """A browser's long GET on /api/events: every line the device announces is put into `seen`."""
    try:
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=60)
        conn.request('GET', '/api/events')
        res = conn.getresponse()
        while True:
            ln = res.fp.readline()
            if not ln:
                break
            ready.set()
            if ln.startswith(b'data: '):
                seen.append(json.loads(ln[6:]))
    except Exception:
        ready.set()


def scene_epoch():
    h = House('epoch')
    try:
        T, O = 'taleE', 'taleOther'
        manifest = lambda: h.call('GET', '/api/books/list')[2] or {}
        E = lambda v: {'X-Cozy-Epoch': v}
        pg = lambda n: json.dumps({'m': {'id': '%s-p%d' % (T, n), 'storyId': T, 'role': 'user', 'text': 'APPENDED %d' % n, 'ts': 10 + n}}).encode()
        words = lambda n: piece('%s|w%d|5' % (T, n), 'WORDS %d' % n) + page('snt_e%d' % n, T, ['%s|w%d|5' % (T, n)])
        def writes(headers, n):
            """One of each write that changes a book or an archive; returns their statuses and answers."""
            return [h.call('POST', '/api/books/one/' + O, book(O, ['pushed %d' % n]), headers),
                    h.call('POST', '/api/books/page/' + T, pg(n), headers),
                    h.call('POST', '/api/books/sent/' + T, words(n), headers),
                    h.call('POST', '/api/books/sent/%s?from=%s' % (O, T), json.dumps({'pages': ['snt_e1']}).encode(), headers),
                    h.call('POST', '/api/books/drop/taleDropped%d' % n, b'', headers)]
        m = manifest()
        check(m.get('epoch') == '' and 'books' in m and 'gone' in m, 'the manifest names the library\'s epoch beside its books — none yet: ' + json.dumps({k: m.get(k) for k in ('epoch',)}))
        h.call('POST', '/api/books/one/_house', HOUSE, E('-'))
        h.call('POST', '/api/books/one/' + T, book(T, ['one']), E('-'))
        rs = writes(E('-'), 1)
        check([r[0] for r in rs] == [200] * 5 and rs[1][2] == {'ok': True}, 'a browser that knows of no epoch ("-") writes to a library that has none: ' + str([r[0] for r in rs]))
        stood = tree(h.data, skip_bak=False)
        rs = writes(E('1700000000000-deadbeef'), 2)
        check([r[0] for r in rs] == [409] * 5 and all(r[2] == {'ok': False, 'stale': True, 'epoch': ''} for r in rs), 'a write made for an epoch the device does not hold is refused, 409 {"ok": false, "stale": true, "epoch": ""}: ' + str([r[0] for r in rs]))
        check(tree(h.data, skip_bak=False) == stood, 'and NOTHING was written (no book, no page, no line, no tombstone)')

        seen, ready = [], threading.Event()
        threading.Thread(target=listen, args=(h.port, seen, ready), daemon=True).start()
        ready.wait(10)
        time.sleep(1.1)
        made = h.call('GET', '/api/backup/now', timeout=60)[2] or {}
        good = h.call('GET', '/api/backup/file', timeout=60)[1]
        h.call('POST', '/api/books/one/' + T, book(T, ['one', 'told after the copy was taken']), {'X-Cozy-Client': 'tab-9'})
        time.sleep(1.1)
        back = h.call('POST', '/api/backup/restore', good, timeout=60)[2] or {}
        new = manifest().get('epoch')
        check(made.get('ok') is True and back.get('ok') is True and bool(new) and new != '', 'a copy brought back gives the library a new epoch: %r' % new)
        check(back.get('epoch') == new and os.path.exists(h.path('.epoch')) and read(h.path('.epoch')).decode().strip() == new, 'the answer to the restore names it, and it stands in <data>/.epoch')
        for _ in range(50):
            if any(s.get('id') == '_restored' for s in seen):
                break
            time.sleep(0.1)
        told = [s for s in seen if s.get('id') == '_restored']
        check(len(told) == 1 and told[0].get('epoch') == new and told[0].get('by') == '' and isinstance(told[0].get('at'), (int, float)), 'every listening browser is told: ' + json.dumps(told)[:160])
        check(any(s.get('id') == T and s.get('by') == 'tab-9' for s in seen), 'and an ordinary change is still announced as it always was (the tale, and who wrote it)')

        # the other browser: it did not bring the copy back, and still writes for the library as it was
        stood = tree(h.data, skip_bak=False)
        rs = writes(E('-'), 3)
        check([r[0] for r in rs] == [409] * 5 and all(r[2] == {'ok': False, 'stale': True, 'epoch': new} for r in rs), 'after the copy came back, a write made for the old library is refused and told the new epoch — a book, a page, sent words, a copy of pages, a tale let go: ' + str([r[0] for r in rs]))
        check(tree(h.data, skip_bak=False) == stood and b'told after the copy was taken' not in h.call('GET', '/api/books/one/' + T)[1], 'and the restored library is untouched')
        rs = writes(E(new or 'no-epoch-was-given'), 4)
        check([r[0] for r in rs] == [200] * 5, 'with the new epoch the same writes land: ' + str([r[0] for r in rs]))
        rs = writes({}, 5)
        check([r[0] for r in rs] == [200] * 5, 'and a browser that sends no epoch at all is answered as before: ' + str([r[0] for r in rs]))
        check(b'APPENDED 4' in h.call('GET', '/api/books/one/' + T)[1] and b'APPENDED 5' in h.call('GET', '/api/books/one/' + T)[1] and b'APPENDED 3' not in h.call('GET', '/api/books/one/' + T)[1], 'the pages that landed are there, the refused one is not')

        # the epoch is not part of the library: no copy holds it, and a copy brought back never moves or removes it
        time.sleep(1.1)
        r = h.serve.make_backup(force=True)
        with zipfile.ZipFile(r['path']) as z:
            names = z.namelist()
        check(r.get('ok') is True and os.path.exists(h.path('.epoch')) and '.epoch' not in names and not any(n.startswith('.') for n in names), 'the epoch stands beside the library and is in no copy of it: ' + str(sorted(names))[:200])
        r = h.serve.restore_backup(mkzip([('books/_house.json', HOUSE), ('.epoch', 'an-epoch-from-a-zip')]))
        check(r.get('ok') is False and manifest().get('epoch') == new, 'a zip that carries an epoch of its own is not taken (%s)' % str(r.get('why'))[:70])
        time.sleep(1.1)
        back = h.call('POST', '/api/backup/restore', good, timeout=60)[2] or {}
        newer = manifest().get('epoch')
        check(back.get('ok') is True and bool(newer) and newer not in ('', new), 'brought back again: another epoch (%r)' % newer)

        # the look at the epoch and the write are ONE held stretch: a write that had reached its lock, made for the
        # epoch of that moment, when a copy was brought back — it lands on nothing
        kinds = [('a book', '_log_lock', lambda hd: h.call('POST', '/api/books/one/' + O, book(O, ['pushed as the copy came back']), hd, timeout=60)),
                 ('a page', '_log_lock', lambda hd: h.call('POST', '/api/books/page/' + T, pg(77), hd, timeout=60)),
                 ('a tale let go', '_log_lock', lambda hd: h.call('POST', '/api/books/drop/' + T, b'', hd, timeout=60)),
                 ('sent words', '_sent_lock', lambda hd: h.call('POST', '/api/books/sent/' + T, words(77), hd, timeout=60)),
                 ('a copy of pages', '_sent_lock', lambda hd: h.call('POST', '/api/books/sent/%s?from=%s' % (O, T), json.dumps({'pages': ['snt_e1']}).encode(), hd, timeout=60))]
        wrong = []
        for label, lock_name, write_it in kinds:
            lock = getattr(h.serve, lock_name, None)
            if lock is None:
                wrong.append(label + ': there is no ' + lock_name)
                continue
            was_epoch = manifest().get('epoch')
            gate = Gate(lock)
            got = []
            with patched(h.serve, lock_name, gate):
                t = threading.Thread(target=lambda: got.append(write_it(E(was_epoch or '-'))))
                t.start()
                reached = gate.waiting.wait(10)
                back = h.call('POST', '/api/backup/restore', good, timeout=60)[2] or {}
                stood = tree(h.data, skip_bak=False)
                gate.go.set()
                t.join(60)
            now_epoch = manifest().get('epoch')
            if not (reached and back.get('ok') is True and got and got[0][0] == 409 and got[0][2] == {'ok': False, 'stale': True, 'epoch': now_epoch} and now_epoch != was_epoch and tree(h.data, skip_bak=False) == stood):
                wrong.append('%s: reached the lock %s, restore ok %s, answered %s %s, library untouched %s' % (label, reached, back.get('ok'), got[0][0] if got else None, got[0][1][:70] if got else b'', tree(h.data, skip_bak=False) == stood))
        check(not wrong, 'a write that had reached its lock when a copy was brought back — a book, a page, a tale let go, sent words, a copy of pages — is refused (409) and leaves the restored library untouched: ' + ('; '.join(wrong)[:500] or 'all five'))

        # an epoch file written by hand (a line break after it, as an editor leaves one): the epoch is still one word a browser can say back
        write(h.path('.epoch'), b'  put-here-by-hand\n')
        said = manifest().get('epoch')
        r = h.call('POST', '/api/books/page/' + T, pg(88), E('put-here-by-hand'))
        check(said == 'put-here-by-hand' and r[0] == 200, 'an epoch file with a line break after the word reads as the word, and a write that says the word lands (%r, %s)' % (said, r[0]))
    finally:
        h.close()


# ---------------------------------------------------------------------------------------------------------------------
# 8. ONLY THE TAVERN'S OWN PAGE MAY WRITE, AND /api/ ANSWERS ONLY UNDER THE DEVICE'S OWN NAME
def scene_stranger():
    h = House('stranger')
    try:
        T = 'taleO'
        own = 'http://127.0.0.1:%d' % h.port
        h.call('POST', '/api/books/one/_house', HOUSE)
        h.call('POST', '/api/books/one/' + T, book(T, ['one']))
        h.call('POST', '/api/books/sent/' + T, piece(T + '|a|1', 'KEPT WORDS') + page('snt_o', T, [T + '|a|1']))
        stood = tree(h.data, skip_bak=False)
        n = [0]
        def posts(headers):
            """Each kind of write, as another page would send it (a "simple" request: text/plain, no leave asked)."""
            n[0] += 1
            hd = dict({'Content-Type': 'text/plain'}, **headers)
            return [h.call('POST', '/api/backup/restore', mkzip([('books/_house.json', HOUSE)]), hd),
                    h.call('POST', '/api/books/drop/' + T, b'', hd),
                    h.call('POST', '/api/books/sent/' + T, piece(T + '|a|1', 'REPLACED BY A STRANGER %d' % n[0]), hd),
                    h.call('POST', '/api/books/sent/taleMadeUp%d' % n[0], piece('x|a|1', 'A TALE THAT DOES NOT EXIST'), hd),
                    h.call('POST', '/api/books/one/' + T, book(T, ['a stranger\'s book']), hd),
                    h.call('POST', '/api/books/page/' + T, json.dumps({'m': {'id': 'x%d' % n[0], 'text': 'a stranger\'s page'}}).encode(), hd),
                    h.call('POST', '/api/books', b'{"a": 1}', hd),
                    h.call('POST', '/api/relay', b'{}', hd)]
        def refused(rs):
            return [r[0] for r in rs] == [403] * len(rs) and all(isinstance(r[2], dict) and r[2].get('ok') is False and r[2].get('why') for r in rs)
        rs = posts({'Origin': 'http://evil.example'})
        check(refused(rs), 'a POST carrying another site\'s Origin is refused, 403 with a reason — a copy brought back, a tale let go, sent words, a book, a page, the old single file, the relay: ' + str([r[0] for r in rs]))
        check(tree(h.data, skip_bak=False) == stood and zips(h.data) == [] and not os.path.exists(h.path('books.json')), 'and NOTHING was written: the library is as it stood, no tale was let go, no archive was made, no copy was taken')
        words = {p['k']: p['t'] for p in ((h.call('GET', '/api/books/sent/%s?page=snt_o' % T)[2] or {}).get('pieces') or [])}
        check(words == {T + '|a|1': 'KEPT WORDS'}, 'the kept words were not replaced')
        for label, headers in [('an Origin of "null"', {'Origin': 'null'}),
                               ('the browser saying it is cross-site', {'Sec-Fetch-Site': 'cross-site'}),
                               ('the browser saying it is same-site (another port of this device)', {'Sec-Fetch-Site': 'same-site'}),
                               ('cross-site, whatever Origin is claimed', {'Sec-Fetch-Site': 'cross-site', 'Origin': own}),
                               ('another site\'s Origin, whatever else is claimed', {'Sec-Fetch-Site': 'same-origin', 'Origin': 'http://evil.example'}),
                               ('this device\'s address on another port', {'Origin': 'http://127.0.0.1:1'}),
                               ('another name for this device than the one asked', {'Origin': 'http://localhost:%d' % h.port}),
                               ('an Origin that is not an address', {'Origin': 'evil.example'})]:
            rs = posts(headers)
            check(refused(rs) and tree(h.data, skip_bak=False) == stood, 'refused too, nothing written: ' + label + ' ' + str(sorted(set(r[0] for r in rs))))
        big = h.call('POST', '/api/backup/restore', b'z' * (6 * 1024 * 1024), {'Origin': 'http://evil.example', 'Content-Type': 'text/plain'}, timeout=60)
        big2 = h.call('POST', '/api/books/one/' + T, b'z' * (6 * 1024 * 1024), {'Host': 'evil.example:%d' % h.port}, timeout=60)
        check(big[0] == 403 and big2[0] == 403 and tree(h.data, skip_bak=False) == stood, 'a large body from elsewhere is read past and refused — the answer still arrives (403, 403): %s %s' % (big[0], big2[0]))
        # the tavern's own page, and what never says where it comes from, are answered as before
        one = lambda headers, m='POST', path=None, body=None: h.call(m, path or ('/api/books/page/' + T), body if body is not None else json.dumps({'m': {'id': 'p-%d' % next(_count), 'text': 'a page of his own'}}).encode(), headers)[0]
        ok_cases = [('its own Origin', {'Origin': own}),
                    ('its own Origin, same-origin', {'Origin': own, 'Sec-Fetch-Site': 'same-origin'}),
                    ('typed into the address bar (none)', {'Sec-Fetch-Site': 'none'}),
                    ('no Origin at all (curl, the tests, an older tool)', {}),
                    ('its own page, opened as localhost', {'Origin': 'http://localhost:%d' % h.port, 'Host': 'localhost:%d' % h.port}),
                    ('its own page, in capitals', {'Origin': 'HTTP://LOCALHOST:%d' % h.port, 'Host': 'LocalHost:%d' % h.port}),
                    ('its own page, over IPv6', {'Origin': 'http://[::1]:%d' % h.port, 'Host': '[::1]:%d' % h.port}),
                    ('behind a proxy that names the address asked (X-Forwarded-Host)', {'Origin': 'https://tavern.example', 'X-Forwarded-Host': 'tavern.example'}),
                    ('no Host header at all (an HTTP/1.0 tool)', {'Host': None})]
        got = [(label, one(headers)) for label, headers in ok_cases]
        check(all(s == 200 for _, s in got), 'the tavern\'s own page writes as before: ' + '; '.join('%s %s' % (label, s) for label, s in got))
        # reading: /api/ answers only under the device's own name (a page that points its own name at 127.0.0.1)
        evil = {'Host': 'evil.example:%d' % h.port}
        r = h.call('GET', '/api/books/list', None, evil)
        check(r[0] == 403 and b'books' not in r[1], 'GET /api/books/list asked under another name (Host: evil.example) is refused, 403: %s %s' % (r[0], r[1][:60]))
        reads = ['/api/books/one/_house', '/api/books/one/' + T, '/api/books/sent/%s?have=1' % T, '/api/books/sent/%s?page=snt_o' % T, '/api/books/search?q=one', '/api/backup/list', '/api/backup/now', '/api/backup/file', '/api/recover/projects', '/api/version', '/api/relay', '/api/events', '/api/books/stamp', '/api/books']
        got = [h.call('GET', p, None, evil, status_only=(p == '/api/events'))[0] for p in reads]
        check(got == [403] * len(reads) and zips(h.data) == [], 'and so is every other /api/ read — the house book (his keys), a tale, sent words, the search, the copies: ' + str(sorted(set(got))))
        check(one(dict(evil, Origin='http://evil.example:%d' % h.port)) == 403 and one(evil) == 403, 'and a write under another name, even from "its own" page')
        got = [h.call('GET', p, None, evil)[0] for p in ('/index.html', '/', '/js/app.js', '/css/base.css' if os.path.exists(os.path.join(os.path.dirname(SERVE), 'css', 'base.css')) else '/manifest.webmanifest')]
        check(got == [200] * 4, 'the page\'s own files are served whatever the name: ' + str(got))
        got = [h.call('GET', '/api/books/list', None, {'Host': name})[0] for name in ('127.0.0.1:%d' % h.port, 'localhost:%d' % h.port, '[::1]:%d' % h.port, 'LOCALHOST', '127.0.0.1')]
        check(got == [200] * 5 and h.call('GET', '/api/books/list', None, {'Host': None})[0] == 200, 'under its own names — 127.0.0.1, localhost, [::1], with or without a port — and with no Host at all, it answers: ' + str(got))
        with patched(os, 'environ', dict(os.environ, COZY_HOSTS='tavern.example, evil.example:8443')):
            got = [h.call('GET', '/api/books/list', None, {'Host': name})[0] for name in ('evil.example:%d' % h.port, 'tavern.example', 'other.example')]
        check(got == [200, 200, 403], 'a name given in COZY_HOSTS is answered, another is still refused: ' + str(got))
    finally:
        h.close()
    # and from the start: serve.py as its own process, COZY_HOSTS in its environment
    data = fresh('stranger-process')
    p, port = start(data, {'COZY_HOSTS': 'tavern.example'})
    try:
        got = [call(port, 'GET', '/api/books/list', None, {'Host': name})[0] for name in ('tavern.example', 'evil.example:%d' % port, '127.0.0.1:%d' % port)]
        r = call(port, 'POST', '/api/books/one/taleP', book('taleP', ['one']), {'Origin': 'http://evil.example'})
        check(got == [200, 403, 200] and r[0] == 403 and not os.path.exists(os.path.join(data, 'books', 'taleP.json')), 'the same from a server started by itself: ' + str(got) + ' ' + str(r[0]))
    finally:
        stop(p)


# ---------------------------------------------------------------------------------------------------------------------
# 9. ALL OF IT AT ONCE: NOTHING WAITS FOR EVER, NOTHING IS TORN
def scene_together():
    h = House('together')
    try:
        tales = ['taleT%d' % i for i in range(3)]
        h.call('POST', '/api/books/one/_house', HOUSE)
        for t in tales:
            h.call('POST', '/api/books/one/' + t, book(t, ['one']))
        time.sleep(1.1)
        first = h.call('GET', '/api/backup/now', timeout=60)[2] or {}
        good = h.call('GET', '/api/backup/file', timeout=60)[1]
        wrong = []
        ended = []
        back = threading.Event()
        def writer(t):
            after = 0
            for n in range(600):   # until the copy has been brought back, and ten writes more
                if back.is_set():
                    after += 1
                    if after > 10:
                        break
                a = h.call('POST', '/api/books/page/' + t, json.dumps({'m': {'id': '%s-p%d' % (t, n), 'storyId': t, 'role': 'user', 'text': 'APPENDED %d' % n, 'ts': 10 + n}}).encode(), {'X-Cozy-Client': 'tab-' + t}, timeout=60)[0]
                b = h.call('POST', '/api/books/sent/' + t, piece('%s|w%d|5' % (t, n), 'WORDS %d ' % n * 40) + page('snt_%s_%d' % (t, n), t, ['%s|w%d|5' % (t, n)]), timeout=60)[0]
                if a != 200 or b != 200:
                    wrong.append('%s write %d: page %s, words %s' % (t, n, a, b))
                time.sleep(0.03)
            ended.append(time.time())
        def comes_and_goes():
            for n in range(8):
                t = 'taleBrief'
                h.call('POST', '/api/books/one/' + t, book(t, ['here %d' % n]), timeout=60)
                h.call('POST', '/api/books/sent/' + t, piece('%s|w%d|5' % (t, n), 'BRIEF WORDS'), timeout=60)
                h.call('GET', '/api/books/sent/%s?have=1' % t, timeout=60)
                h.call('POST', '/api/books/sent/%s?from=%s' % (t, tales[0]), json.dumps({'pages': ['snt_%s_%d' % (tales[0], n)]}).encode(), timeout=60)
                h.call('POST', '/api/books/drop/' + t, b'', timeout=60)
        landed = []
        def copier():
            for n in range(4):
                r = h.call('GET', '/api/backup/now', timeout=60)
                if r[0] != 200 or not (r[2] or {}).get('ok'):
                    wrong.append('copy %d: %s %s' % (n, r[0], r[1][:120]))
                if n == 1:  # mid-way, while the others write: the first copy is brought back
                    r = h.call('POST', '/api/backup/restore', good, timeout=60)
                    landed.append(time.time())
                    back.set()
                    if r[0] != 200 or not (r[2] or {}).get('ok'):
                        wrong.append('the copy brought back mid-way: %s %s' % (r[0], r[1][:160]))
                time.sleep(0.05)
            back.set()
        ts = [threading.Thread(target=writer, args=(t,)) for t in tales] + [threading.Thread(target=comes_and_goes), threading.Thread(target=copier)]
        t0 = time.time()
        [t.start() for t in ts]
        [t.join(90) for t in ts]
        check(not any(t.is_alive() for t in ts), 'pages, sent words, a tale that comes and goes, copies taken and one brought back, all at once: every hand finished (%.1f s)' % (time.time() - t0))
        check(first.get('ok') is True and not wrong, 'and every one of them was answered as it should be: ' + ('; '.join(wrong)[:300] or 'all'))
        check(bool(landed) and bool(ended) and landed[0] < min(ended), 'the copy was brought back while the others were still writing')
        torn = []
        for folder, ending in (('sent', '.ndjson'), ('books', '.log')):
            d = h.path(folder)
            for name in sorted(os.listdir(d)) if os.path.isdir(d) else []:
                if name.endswith(ending):
                    raw = read(os.path.join(d, name))
                    for ln in raw.split(b'\n')[:-1]:
                        try:
                            json.loads(ln)
                        except ValueError:
                            torn.append(folder + '/' + name)
                    if raw and not raw.endswith(b'\n'):
                        torn.append(folder + '/' + name + ' (no end)')
        check(not torn, 'no line of any archive or log is torn: ' + (str(sorted(set(torn)))[:200] if torn else 'every line reads'))
        check(leftovers(h.data) == [] and parts(h.data) == [], 'nothing of a restore or a copy is left behind')
        locks = [getattr(h.serve, n, None) for n in ('_log_lock', '_sent_lock', '_backup_lock')]
        check(all(l is not None and l.acquire(timeout=2) and (l.release() or True) for l in locks), 'each of the three locks is there and free')
        time.sleep(1.1)
        r = h.serve.make_backup(force=True)
        lib = sorted(tree(h.data, skip_bak=True))
        with zipfile.ZipFile(r['path']) as z:
            names = sorted(z.namelist())
        check(r.get('ok') is True and names == lib, 'and a copy taken after it all holds the whole library (%d files)' % len(names))
    finally:
        h.close()


# ---------------------------------------------------------------------------------------------------------------------
# 10. SIX SMALLER GUARDS (the main session's own, on top of the seven)
def scene_smaller():
    # (a) a file dated before 1980 does not stop every copy
    h = House('before-1980')
    try:
        seed_files(h.data)
        for rel in (('books', 'taleB.json'), ('sent', 'taleB.ndjson')):
            os.utime(h.path(*rel), (86400 * 365 * 5, 86400 * 365 * 5))  # 1975: a phone whose clock was reset when it wrote
        r = h.serve.make_backup(force=True)
        names = sorted(zipfile.ZipFile(r['path']).namelist()) if r.get('ok') and r.get('path') else []
        check(r.get('ok') is True and 'books/taleB.json' in names and 'sent/taleB.ndjson' in names,
              'a book and an archive dated 1975 are in the copy — one old date does not stop every copy: %s' % json.dumps({k: r.get(k) for k in ('ok', 'files', 'why')}))
        if r.get('ok'):
            with zipfile.ZipFile(r['path']) as z:
                check(z.read('books/taleB.json') == read(h.path('books', 'taleB.json')) and z.read('sent/taleB.ndjson') == read(h.path('sent', 'taleB.ndjson')), 'and they read back byte for byte')
    finally:
        h.close()

    # (b) a log is let go only once its pages are in the snapshot
    h = House('fold-keeps')
    try:
        T = 'taleF'
        write(h.path('books', '_house.json'), HOUSE)
        # a snapshot the fold cannot fold into (its pages are not a list) — and a log past the cap
        write(h.path('books', T + '.json'), json.dumps({'namespace': 'cozytavern.v1', 'kind': 'story', 'exportedAt': '2026-10-01T00:00:00.000Z', 'story': {'id': T}, 'messages': 'not a list'}))
        with patched(h.serve, 'LOG_FOLD_BYTES', 10):
            r = h.call('POST', '/api/books/page/' + T, json.dumps({'at': 'x', 'm': {'id': 'p1', 'storyId': T, 'role': 'assistant', 'text': 'THE-APPENDED-PAGE'}}).encode())
        log = h.path('books', T + '.log')
        check(r[0] == 200 and os.path.exists(log) and b'THE-APPENDED-PAGE' in read(log),
              'a log that could not be folded into its snapshot is KEPT — the page is still on the device (it was removed: the page was in neither): status %s, log %s' % (r[0], os.path.exists(log)))
        # and one that can be folded still is
        T2 = 'taleG'
        write(h.path('books', T2 + '.json'), book(T2, ['one']))
        with patched(h.serve, 'LOG_FOLD_BYTES', 10):
            r = h.call('POST', '/api/books/page/' + T2, json.dumps({'at': 'x', 'm': {'id': 'p2', 'storyId': T2, 'role': 'assistant', 'text': 'A-PAGE-THAT-FOLDS'}}).encode())
        check(r[0] == 200 and not os.path.exists(h.path('books', T2 + '.log')) and b'A-PAGE-THAT-FOLDS' in read(h.path('books', T2 + '.json')), 'a log that folds is folded into the snapshot and let go, as before')
    finally:
        h.close()

    # (c) a book is read with its log in one hold: a read asked for while a push holds the lock waits for it
    h = House('read-waits')
    try:
        T = 'taleR'
        write(h.path('books', '_house.json'), HOUSE)
        write(h.path('books', T + '.json'), book(T, ['one', 'two']))
        write(h.path('books', T + '.log'), json.dumps({'m': {'id': T + '-m3', 'storyId': T, 'role': 'user', 'text': 'IN-THE-LOG', 'ts': 3}, 'by': 'tab-1', 'at': '2026-10-02T00:00:00.000Z'}) + '\n')
        got = {}
        def ask():
            got['r'] = h.call('GET', '/api/books/one/' + T)
        h.serve._log_lock.acquire()  # a whole-book push in progress
        try:
            t = threading.Thread(target=ask, daemon=True)
            t.start()
            t.join(0.6)
            waited = t.is_alive()
            # the push: the new book (the log's page folded in, and one more) lands, the log goes — as the handler does it
            write(h.path('books', T + '.json'), book(T, ['one', 'two', 'IN-THE-LOG', 'THE-NEWEST-PAGE'], at='2026-10-03T00:00:00.000Z'))
            os.remove(h.path('books', T + '.log'))
        finally:
            h.serve._log_lock.release()
        t.join(10)
        body = (got.get('r') or (0, b'', None))[1]
        check(waited, 'a book asked for while a whole-book push holds the log waits for the push (it was answered at once, from the book before and whatever log stood)')
        check(b'THE-NEWEST-PAGE' in body and b'IN-THE-LOG' in body, 'and is answered as the book stands after it — never the old book without its log')
    finally:
        h.close()

    # (d) a read of /api/ asked for by another site's page is refused
    h = House('cross-site-read')
    try:
        seed_files(h.data)
        made = lambda: len(zips(h.data))
        before = made()
        r = h.call('GET', '/api/backup/now', headers={'Sec-Fetch-Site': 'cross-site'})
        check(r[0] == 403 and made() == before, 'GET /api/backup/now from another site\'s page: 403, and no copy was made (%s)' % r[0])
        r = h.call('GET', '/api/books/list', headers={'Sec-Fetch-Site': 'same-site'})
        check(r[0] == 403, 'the manifest asked for by a page on another port of this phone (same-site): 403 (%s)' % r[0])
        check(h.call('GET', '/api/events', headers={'Sec-Fetch-Site': 'cross-site'}, status_only=True)[0] == 403, 'the stream of changes: 403')
        oks = [h.call('GET', '/api/books/list', headers=hd)[0] for hd in ({'Sec-Fetch-Site': 'same-origin'}, {'Sec-Fetch-Site': 'none'}, {})]
        check(oks == [200, 200, 200], 'the tavern\'s own page, an address typed by hand, and a tool that says nothing are answered as before: %s' % oks)
        check(h.call('GET', '/index.html', headers={'Sec-Fetch-Site': 'cross-site'})[0] == 200, 'the page\'s own files are served wherever they are asked from')
    finally:
        h.close()

    # (f) pages copied from WHEREVER they are (from=*): a branch made before the browser knew to ask is healed when opened
    h = House('copy-anywhere')
    try:
        write(h.path('books', '_house.json'), HOUSE)
        for t in ('taleX', 'taleY', 'taleZ', 'taleNew'):
            write(h.path('books', t + '.json'), book(t, ['one']))
        kx, ky, kz = 'taleX|a|7', 'taleY|b|7', 'taleZ|c|7'
        write(h.path('sent', 'taleX.ndjson'), piece(kx, 'WORDS-X') + page('snt_x1', 'taleX', [kx]))
        write(h.path('sent', 'taleY.ndjson'), piece(ky, 'WORDS-Y') + page('snt_y1', 'taleY', [ky]) + page('snt_y2', 'taleY', [ky]))
        write(h.path('sent', 'taleZ.ndjson'), piece(kz, 'WORDS-Z') + page('snt_z1', 'taleZ', [kz], body_keys=[kz]))
        ask = lambda pages, to='taleNew': h.call('POST', '/api/books/sent/%s?from=*' % to, json.dumps({'pages': pages}).encode())
        r = ask(['snt_y2', 'snt_z1', 'snt_nowhere'])
        check(r[0] == 200 and r[2] == {'ok': True, 'copied': 2, 'missing': ['snt_nowhere']}, 'two pages kept under two other tales are found and copied; the one kept nowhere is named: %s %s' % (r[0], r[1][:120]))
        got = lambda pid: {x['k']: x['t'] for x in (h.call('GET', '/api/books/sent/taleNew?page=' + pid)[2] or {}).get('pieces', [])}
        check(got('snt_y2') == {ky: 'WORDS-Y'} and got('snt_z1') == {kz: 'WORDS-Z'}, 'each reads back under the tale\'s own name, with its words')
        size = os.path.getsize(h.path('sent', 'taleNew.ndjson'))
        r = ask(['snt_y2', 'snt_z1', 'snt_x1'])
        check(r[2] == {'ok': True, 'copied': 3, 'missing': []} and got('snt_x1') == {kx: 'WORDS-X'}, 'asked again with one more: the third is copied, the two already there are counted, nothing is missing: %s' % r[1][:100])
        check(os.path.getsize(h.path('sent', 'taleNew.ndjson')) > size and read(h.path('sent', 'taleNew.ndjson')).count(b'"id":"snt_y2"') == 1, 'and a page already there is not written twice')
        many = ['snt_none%d' % i for i in range(80)] + ['snt_y1']
        r = ask(many)
        check(r[0] == 200 and r[2] and r[2].get('copied') == 1 and len(r[2].get('missing') or []) == 80 and got('snt_y1') == {ky: 'WORDS-Y'}, 'a long list (every page line read whole) finds its one page too: copied %s' % (r[2] or {}).get('copied'))
        check(ask(['snt_x1'], to='..%2Fbad')[0] == 400, 'the tale\'s own name is still checked')
    finally:
        h.close()

    # (e) what is remembered of the archives is bounded, and an archive forgotten is simply read again
    h = House('held-bounded')
    try:
        write(h.path('books', '_house.json'), HOUSE)
        tales = ['t%d' % i for i in range(5)]
        for t in tales:
            write(h.path('books', t + '.json'), book(t, ['one']))
            write(h.path('sent', t + '.ndjson'), piece(t + '|a|1', 'WORDS-' + t) + page('snt_' + t, t, [t + '|a|1']))
        if hasattr(h.serve, 'SENT_HELD_MAX'):
            with patched(h.serve, 'SENT_HELD_MAX', 2):
                answers = [h.call('GET', '/api/books/sent/' + t + '?have=1')[2] for t in tales]
                check(len(h.serve._SENT_HELD) <= 2, 'five archives asked about, two remembered: %d' % len(h.serve._SENT_HELD))
                again = h.call('GET', '/api/books/sent/' + tales[0] + '?have=1')[2]
            check(all(a == {'pages': ['snt_' + t], 'pieces': [t + '|a|1']} for a, t in zip(answers, tales)) and again == answers[0], 'each was answered rightly — and the first, forgotten since, is answered the same when asked again')
        else:
            check(False, 'what is remembered of the archives is bounded (SENT_HELD_MAX)')
    finally:
        h.close()


def scene_large_copy():
    """A copy brought back is taken in on the storage — the server never holds it whole in memory; a copy cut off on its
    way, or one there is no room to take in, changes nothing and says so."""
    def most_used(pid):
        try:
            with open('/proc/%d/status' % pid) as f:
                for l in f:
                    if l.startswith('VmHWM:'):
                        return int(l.split()[1]) // 1024
        except OSError:
            pass
        return None
    data = fresh('large-copy')
    seed_files(data)
    p, port = start(data)
    try:
        before = most_used(p.pid)
        big = os.urandom(1 << 20) * 96  # 96 MB that will not squeeze
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_STORED) as z:
            z.writestr('books/_house.json', HOUSE)
            z.writestr('books/taleA.json', book('taleA', ['I begin.', 'THE-PAGE-OF-taleA']))
            z.writestr('sent/taleA.ndjson', big)
        copy = buf.getvalue()
        del buf
        status, raw, said = call(port, 'POST', '/api/backup/restore', copy, timeout=300)
        check(status == 200 and bool(said) and said.get('ok') is True, '11 a copy of %d MB is brought back (%s)' % (len(copy) >> 20, (said or {}).get('why') or status))
        there = os.path.join(data, 'sent', 'taleA.ndjson')
        check(os.path.isfile(there) and hashlib.sha1(read(there)).hexdigest() == hashlib.sha1(big).hexdigest(), '11 …and every byte of it is in place')
        after = most_used(p.pid)
        if before is None or after is None:
            print('     (not measured here: this system does not say how much memory a process has used)', flush=True)
        else:
            check(after - before < 48, '11 the server never held the copy in memory: the most it used rose by %d MB while a copy of %d MB came back (it rose by the whole copy)' % (after - before, len(copy) >> 20))
        check(not leftovers(data) and not [n for n in os.listdir(os.path.join(data, 'backups')) if not n.endswith(('.zip', '.stamp'))], '11 nothing of the taking-in is left beside the backups: %s' % sorted(os.listdir(os.path.join(data, 'backups'))))
        # a copy cut off on its way
        stood = tree(data)
        small = mkzip([('books/_house.json', HOUSE), ('books/taleZ.json', book('taleZ', ['never', 'PLACED']))])
        s = socket.create_connection(('127.0.0.1', port), timeout=30)
        try:
            s.sendall(('POST /api/backup/restore HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nContent-Type: application/zip\r\nContent-Length: %d\r\n\r\n' % (port, len(small))).encode() + small[:len(small) // 2])
            s.shutdown(socket.SHUT_WR)
            heard = b''
            while True:
                chunk = s.recv(65536)
                if not chunk:
                    break
                heard += chunk
        finally:
            s.close()
        check(b'did not arrive whole' in heard and b'nothing was touched' in heard, '11 a copy cut off on its way is refused, and the answer says it did not arrive whole: %s' % heard[-160:].decode('utf-8', 'replace'))
        check(tree(data) == stood, '11 …and the library is as it stood')
    finally:
        stop(p)
    # no room to take the copy in: nothing is touched, and the sender hears why
    h = House('large-copy-no-room')
    try:
        seed_files(h.data)
        stood = tree(h.data)
        small = mkzip([('books/_house.json', HOUSE), ('books/taleZ.json', book('taleZ', ['never', 'PLACED']))])

        def full(*a, **k):
            raise no_room('the copy')
        with patched(tempfile, 'TemporaryFile', full):
            status, raw, said = h.call('POST', '/api/backup/restore', small)
        check(status == 200 and bool(said) and said.get('ok') is False and 'ran out of storage' in str(said.get('why')) and 'nothing was touched' in str(said.get('why')), '11 no room to take the copy in: it says so, and that nothing was touched (%s)' % ((said or {}).get('why') or status))
        check(tree(h.data) == stood, '11 …and the library is as it stood')
        status, raw, said = h.call('POST', '/api/backup/restore', small)
        check(status == 200 and bool(said) and said.get('ok') is True and os.path.isfile(h.path('books', 'taleZ.json')), '11 with room again the same copy is brought back (%s)' % ((said or {}).get('why') or status))
    finally:
        h.close()


# ---------------------------------------------------------------------------------------------------------------------
# 12. THE COPY HANDED OVER IS THE COPY JUST MADE — WHATEVER THE CLOCK SAYS
class NameClock:
    """serve.py's clock for the NAME of a copy alone (cozytavern-<date>-<time>.zip): every other question goes to the
    real clock. A copy is named by the device's local time; local time steps back when a time zone is crossed
    westward, when the autumn hour comes, when a clock that ran ahead is put right."""
    def __init__(self):
        self.name = ''

    def __getattr__(self, n):
        return getattr(time, n)

    def strftime(self, fmt, *a):
        return self.name if (fmt == '%Y%m%d-%H%M%S' and not a and self.name) else time.strftime(fmt, *a)


def scene_clock():
    def holds(raw, words):
        """Does this zip's taleB hold `words`? (None: it is not a zip at all.)"""
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                return words.encode() in z.read('books/taleB.json')
        except Exception:
            return None

    def moved_on(h, words):
        """The library moves on: taleB is pushed whole, with one more page."""
        return h.call('POST', '/api/books/one/taleB', book('taleB', ['hello', 'THE-PAGE-OF-taleB', words]))[0]

    # (a) the local clock steps back an hour between two copies
    h = House('clock-back')
    try:
        seed_files(h.data)
        clock = NameClock()
        with patched(h.serve, 'time', clock):
            clock.name = '20261009-120000'
            first = h.call('GET', '/api/backup/now')[2] or {}
            moved_on(h, 'WRITTEN-AFTER-THE-FIRST-COPY')
            clock.name = '20261009-110000'  # an hour EARLIER than the copy before
            second = h.call('GET', '/api/backup/now')[2] or {}
            check(first.get('ok') is True and second.get('ok') is True and second.get('made') is True and second.get('name') == 'cozytavern-20261009-110000.zip' and second.get('name') != first.get('name'),
                  'fixture: a copy, the library moves on, the clock steps back an hour, a second copy is made and named: %s then %s' % (first.get('name'), second.get('name')))
            r = h.call('GET', '/api/backup/file?name=' + str(second.get('name')))
            check(r[0] == 200 and holds(r[1], 'WRITTEN-AFTER-THE-FIRST-COPY') is True,
                  'the download asks for the copy by the name it was just given, and is handed THAT copy — it holds the page written since (it was handed the copy from before, the last by name): status %s, holds it: %s' % (r[0], holds(r[1], 'WRITTEN-AFTER-THE-FIRST-COPY')))
            r = h.call('GET', '/api/backup/file')
            check(r[0] == 200 and holds(r[1], 'WRITTEN-AFTER-THE-FIRST-COPY') is True, 'asked for with no name, "the newest" is the copy made last — not the last name: holds the page written since: %s' % holds(r[1], 'WRITTEN-AFTER-THE-FIRST-COPY'))
            again = h.call('GET', '/api/backup/now')[2] or {}
            check(again.get('ok') is True and again.get('made') is False and again.get('name') == second.get('name'),
                  'asked again with nothing changed: "nothing changed" names the copy that holds this library — the one just made (it named the older one): made %s, %s' % (again.get('made'), again.get('name')))
            listed = [c.get('name') for c in ((h.call('GET', '/api/backup/list')[2] or {}).get('copies') or [])]
            check(listed[-1:] == [second.get('name')], 'and the copies are listed in the order they were made, the newest last: %s' % listed)
            # a name that is not a copy in the backups folder is answered with no file at all — never with another zip
            tricks = ['../books/_house.json', '..%2Fbooks%2F_house.json', str(second.get('name')) + '/../../books/_house.json', '%2Fetc%2Fpasswd', 'last.stamp',
                      'cozytavern-19990101-000000.zip', '..%2Fbackups%2F' + str(second.get('name')), os.path.join(h.data, 'backups', str(second.get('name'))).replace('/', '%2F')]
            got = [h.call('GET', '/api/backup/file?name=' + t) for t in tricks]
            check(all(g[0] == 404 and g[1] == b'' for g in got), 'a name with a path in it, a file that is not a copy, a copy that does not exist: 404 and nothing sent — never another zip in its place: %s' % [g[0] for g in got])
    finally:
        h.close()

    # (b) five copies kept, all named LATER than the clock now reads: the copy just made is not the one let go
    h = House('clock-five')
    try:
        seed_files(h.data)
        clock = NameClock()
        with patched(h.serve, 'time', clock):
            made = []
            for i in range(5):
                clock.name = '20261009-12000%d' % i
                moved_on(h, 'PAGE-BEFORE-%d' % i)
                made.append((h.call('GET', '/api/backup/now')[2] or {}).get('name'))
                time.sleep(0.02)
            check(zips(h.data) == sorted(made) and len(made) == 5, 'fixture: five copies are kept: %s' % zips(h.data))
            moved_on(h, 'THE-NEWEST-PAGE-OF-ALL')
            clock.name = '20261009-110000'
            said = h.call('GET', '/api/backup/now')[2] or {}
            check(said.get('ok') is True and said.get('made') is True and said.get('name') == 'cozytavern-20261009-110000.zip',
                  'with five copies kept and the clock an hour back, a copy is made and named (it was made, let go at once as "the oldest", and the answer was an error): %s' % json.dumps({k: said.get(k) for k in ('ok', 'made', 'name', 'why')})[:200])
            r = h.call('GET', '/api/backup/file?name=cozytavern-20261009-110000.zip')
            check(r[0] == 200 and holds(r[1], 'THE-NEWEST-PAGE-OF-ALL') is True, 'and it is there to be handed over, holding the newest page: %s' % r[0])
            check(len(zips(h.data)) == 5 and made[0] not in zips(h.data) and all(n in zips(h.data) for n in made[1:]), 'five are still kept — the one let go is the one made FIRST, not the one just written: %s' % zips(h.data))
            # and "Bring a copy back" keeps the library as it stands first, in a copy that is still there afterwards
            back = h.call('POST', '/api/backup/restore', mkzip([('books/_house.json', HOUSE), ('books/taleZ.json', book('taleZ', ['from', 'THE COPY']))]))[2] or {}
            kept = os.path.join(h.data, 'backups', str(back.get('safety')))
            check(back.get('ok') is True and os.path.isfile(kept) and holds(read(kept), 'THE-NEWEST-PAGE-OF-ALL') is True,
                  'a copy can be brought back, and the library as it stood is kept in a zip that is still there (it was refused: "could not be kept first"): %s' % json.dumps({k: back.get(k) for k in ('ok', 'safety', 'why')})[:200])
    finally:
        h.close()

    # (c) the clock ITSELF was put back (the times of the files step back too): the copy made now is still the newest
    h = House('clock-itself')
    try:
        seed_files(h.data)
        clock = NameClock()
        with patched(h.serve, 'time', clock):
            made = []
            for i in range(2):
                clock.name = '20261009-12000%d' % i
                moved_on(h, 'PAGE-BEFORE-%d' % i)
                made.append((h.call('GET', '/api/backup/now')[2] or {}).get('name'))
            ahead = (int(time.time()) + 86400) * 10 ** 9  # as they stand once the clock is put back a day: dated "tomorrow"
            for n in zips(h.data):
                os.utime(os.path.join(h.data, 'backups', n), ns=(ahead, ahead))
            moved_on(h, 'WRITTEN-AFTER-THE-CLOCK-WAS-PUT-BACK')
            clock.name = '20261008-120000'
            said = h.call('GET', '/api/backup/now')[2] or {}
            r = h.call('GET', '/api/backup/file')
            check(said.get('ok') is True and said.get('made') is True and r[0] == 200 and holds(r[1], 'WRITTEN-AFTER-THE-CLOCK-WAS-PUT-BACK') is True,
                  'the clock itself put back a day: the copy made now is the one handed over as the newest — it holds the page just written: %s' % holds(r[1], 'WRITTEN-AFTER-THE-CLOCK-WAS-PUT-BACK'))
            later = [said.get('name')]
            for i in range(4):
                clock.name = '20261008-12000%d' % (i + 1)
                moved_on(h, 'AND-ON-%d' % i)
                later.append((h.call('GET', '/api/backup/now')[2] or {}).get('name'))
            check(sorted(zips(h.data)) == sorted(later), 'four more copies: the five kept are the five made last — the two from before the clock was put back are the ones let go, never a newer one: %s' % zips(h.data))
            listed = [c.get('name') for c in ((h.call('GET', '/api/backup/list')[2] or {}).get('copies') or [])]
            check(listed == later, 'and they are listed in the order they were made: %s' % listed)
    finally:
        h.close()


# ---------------------------------------------------------------------------------------------------------------------
# 13. A REFUSAL BY NAME IS SAID: the answer to a browser that asked under another name carries the reason, as words
def scene_refusal_said():
    h = House('refusal-said')
    try:
        seed_files(h.data)
        stood = tree(h.data, skip_bak=False)
        lan = {'Host': 'Tablet.Lan:%d' % h.port}
        r = h.call('GET', '/api/books/list', None, lan)
        said = r[2] if isinstance(r[2], dict) else {}
        check(r[0] == 403 and said.get('ok') is False and said.get('refused') == 'host' and said.get('host') == 'tablet.lan' and isinstance(said.get('why'), str) and len(said.get('why')) > 10,
              'the list of books asked for under another name: 403, and the answer says in words why, that it is the NAME that was refused, and which name (so the app can say how to start the tavern for it): %s %s' % (r[0], r[1][:160]))
        check(b'taleA' not in r[1] and b'books/' not in r[1], 'and nothing of the library is in that answer')
        r = h.call('POST', '/api/books/page/taleA', json.dumps({'m': {'id': 'lan-1', 'text': 'a page from the tablet'}}).encode(), dict(lan, Origin='http://tablet.lan:%d' % h.port))
        said = r[2] if isinstance(r[2], dict) else {}
        check(r[0] == 403 and said.get('refused') == 'host' and said.get('host') == 'tablet.lan' and tree(h.data, skip_bak=False) == stood, 'a page written under that name: refused the same way, with the same words, and nothing was written: %s %s' % (r[0], r[1][:120]))
        r = h.call('POST', '/api/books/page/taleA', json.dumps({'m': {'id': 'evil-1', 'text': 'a stranger\'s page'}}).encode(), {'Origin': 'http://evil.example'})
        said = r[2] if isinstance(r[2], dict) else {}
        check(r[0] == 403 and said.get('refused') == 'origin' and said.get('why') and tree(h.data, skip_bak=False) == stood, 'a write from another page says it is the PAGE that was refused: %s %s' % (r[0], r[1][:120]))
        with patched(os, 'environ', dict(os.environ, COZY_HOSTS='tablet.lan')):
            ok = h.call('GET', '/api/books/list', None, lan)
            wrote = h.call('POST', '/api/books/page/taleA', json.dumps({'m': {'id': 'lan-2', 'text': 'a page from the tablet'}}).encode(), dict(lan, Origin='http://tablet.lan:%d' % h.port))
        check(ok[0] == 200 and wrote[0] == 200 and (wrote[2] or {}).get('ok') is True, 'started with COZY_HOSTS naming it, the tavern answers under that name and takes its page: %s %s' % (ok[0], wrote[0]))
    finally:
        h.close()


# ---------------------------------------------------------------------------------------------------------------------
# 14. "NO BOOKS" IS SAID ONLY OF A DEVICE THAT HOLDS NONE (a browser told so sends everything it holds, as to a new device)
def scene_no_books_is_true():
    # (a) the list asked for at the very moment a copy begins to take the library's place
    h = House('list-mid-swap')
    try:
        seed_files(h.data)
        stood = tree(h.data, skip_bak=False)
        real_epoch = h.serve._epoch
        staged = []

        def epoch_then_swap_begins():
            # _manifest reads the epoch first; a copy brought back begins its swap right then: the library's parts go aside
            if not staged:
                staged.append(1)
                os.mkdir(h.serve.RESTORE_OLD)
                for name in ('books', 'sent'):
                    os.replace(h.path(name), os.path.join(h.serve.RESTORE_OLD, name))
            return real_epoch()
        with patched(h.serve, '_epoch', epoch_then_swap_begins):
            r = h.call('GET', '/api/books/list')
        listed = sorted(b.get('id') for b in ((r[2] or {}).get('books') or [])) if isinstance(r[2], dict) else None
        check(bool(staged) and (r[0] == 503 or (r[0] == 200 and listed == ['_house', 'taleA', 'taleB'])),
              'the list asked for as a swap begins is not answered "no books": it waits for the library to stand again and lists it (or says it cannot yet) — it was answered with an empty list: %s %s' % (r[0], r[1][:120]))
        check(tree(h.data, skip_bak=False) == stood and not leftovers(h.data), 'and the library stands as it stood')
    finally:
        h.close()

    # (b) a books folder that cannot be read is not a device with no books
    h = House('list-unreadable')
    try:
        seed_files(h.data)
        real_listdir = os.listdir

        def listdir(path='.'):
            if os.path.abspath(str(path)) == os.path.abspath(h.path('books')):
                raise PermissionError(errno.EACCES, os.strerror(errno.EACCES), str(path))
            return real_listdir(path)
        with patched(os, 'listdir', listdir):
            r = h.call('GET', '/api/books/list')
        check(r[0] == 503 and isinstance(r[2], dict) and r[2].get('ok') is False and r[2].get('why') and 'books' not in (r[2] or {}),
              'a books folder that cannot be listed: the answer says so (503, with the reason) — it was 200 with an empty list, which a browser reads as "this device holds nothing": %s %s' % (r[0], r[1][:140]))
        r = h.call('GET', '/api/books/list')
        check(r[0] == 200 and len((r[2] or {}).get('books') or []) == 3, 'readable again, it is listed as before')
    finally:
        h.close()

    # (c) a device with no books folder at all holds none, and says so as before
    h = House('list-none')
    try:
        r = h.call('GET', '/api/books/list')
        check(r[0] == 200 and r[2] == {'books': [], 'gone': [], 'epoch': ''}, 'a device that holds nothing says so: %s' % r[1][:80])
    finally:
        h.close()


SCENES = [
    ('1 a copy is whole, or it is not a copy', scene_backup),
    ('2 a push cannot land between a tale\'s book and its log while they are zipped', scene_backup_and_push),
    ('2b a write that waited for the lock lands on the library as it is then, not as it was when it began to wait', scene_one_stretch),
    ('3 a copy brought back never leaves the library gone', scene_restore),
    ('3a nothing is read from, or written into, a library half-way through a swap', scene_half_swapped),
    ('3b the round trip: the device\'s zip, the library damaged, the zip brought back', scene_roundtrip),
    ('4 the archive of sent words: a cut line never spoils it, a write lands whole or not at all', scene_archive),
    ('5 a tale let go is not written to again', scene_tombstone),
    ('6 a branch\'s carried pages are copied from its parent\'s archive', scene_copy),
    ('7 the library\'s epoch', scene_epoch),
    ('8 only the tavern\'s own page may write; /api/ answers only under the device\'s own name', scene_stranger),
    ('9 all of it at once', scene_together),
    ('10 six smaller guards: an old date, a log that cannot fold, a read during a push, a read from another site, pages copied from anywhere, the memory of archives', scene_smaller),
    ('11 a copy brought back is taken in on the storage, never whole in memory', scene_large_copy),
    ('12 the copy handed over is the copy just made, whatever the clock says', scene_clock),
    ('13 a refusal by name is said: the reason, and the name, in the answer', scene_refusal_said),
    ('14 "no books" is said only of a device that holds none', scene_no_books_is_true),
]

def give_up():
    print('MISS the whole run took more than ten minutes — something waits for ever (a lock left held?)', flush=True)
    os._exit(1)


if __name__ == '__main__':
    only = sys.argv[1:]  # scene numbers, to run some alone: python3 tests/device_guard.py 3 3b
    print('the device guards its library — serve.py under test: ' + SERVE)
    watch = threading.Timer(600, give_up)
    watch.daemon = True
    watch.start()
    try:
        for name, fn in SCENES:
            if not only or name.split()[0] in only:
                scene(name, fn)
    finally:
        if not os.environ.get('COZY_TEST_DATA'):
            shutil.rmtree(BASE_DATA, ignore_errors=True)
    print('\n' + ('the device guards its library: all green' if not fails else '%d MISSED:\n  - ' % len(fails) + '\n  - '.join(f[:160] for f in fails)))
    sys.exit(1 if fails else 0)
