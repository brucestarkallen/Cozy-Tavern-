#!/usr/bin/env python3
"""M676: HIS UPDATE, AS HE DOES IT — the release before, used, updated to this tree by the word he types.

An install of the release before (the newest commit in the history whose js/version.js names another version) is made the
way install.sh makes it, in a Termux of its own (HOME and PREFIX in a scratch folder, a `pkg` that does nothing), and USED:
two pages told through the composer by a scripted storyteller, the device holding its books and the words the storyteller
was sent. Then this tree arrives on the repository it pulls from, and `cozytavern` is typed — the word install.sh left —
and the SAME browser profile, service worker on as on his phone, is opened again: the tab left open, and the new tab the
word opens. Every page, version, setting and key must be as it was; a telling and a "try again" on the new build must
reach the device; and a browser that holds nothing (his site data cleared) must read the tale back from the device.

Found by it, the first time it ran (M676): every update wrote the word back unbaked (tests/launcher.py).

  python3 tests/upgrade_in_place.py               # prints "N ok"; exits 1 with what went wrong (port 8080 is the word's own)
  COZY_TEST_OLD=<commit> python3 tests/upgrade_in_place.py
"""
import json, os, shutil, subprocess, sys, tempfile, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = 'http://127.0.0.1:8080/'
MARK = '__COZY' + '_HOME__'


def git(*args, cwd=None):
    return subprocess.check_output(['git'] + list(args), cwd=cwd or REPO, text=True, stderr=subprocess.STDOUT).strip()


def version_in(text):
    return [ln for ln in text.split('\n') if 'VERSION = ' in ln][0].split("'")[1]


NEW_VER = version_in(open(os.path.join(REPO, 'js', 'version.js'), encoding='utf-8').read())
OLD = os.environ.get('COZY_TEST_OLD') or next(c for c in git('log', '--format=%H', '--', 'js/version.js').split('\n') if version_in(git('show', c + ':js/version.js')) != NEW_VER)
OLD_VER = version_in(git('show', OLD + ':js/version.js'))

T = tempfile.mkdtemp(prefix='cozy-upgrade-')
HOME_T = os.path.join(T, 'home')
PREFIX_T = os.path.join(T, 'usr')
REPO_T = os.path.join(HOME_T, 'cozytavern')
os.makedirs(os.path.join(PREFIX_T, 'bin'))
os.makedirs(HOME_T, exist_ok=True)

ok_n = 0
bad = []
notes = {}


def check(cond, what):
    global ok_n
    if cond:
        ok_n += 1
        print('ok   ' + what, flush=True)
    else:
        bad.append(what)
        print('FAIL ' + what, flush=True)


# ---------------------------------------------------------------- a storyteller and its helpers, answering by what they are asked
class Fake(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    answer = 'TOLD-0'
    told = 0
    calls = 0

    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.send_header('Content-Length', '0'); self.end_headers()

    def do_GET(self):
        out = b'{"data":[{"id":"fake"}]}'
        self.send_response(200); self._cors(); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(out))); self.end_headers(); self.wfile.write(out)

    def do_POST(self):
        n = int(self.headers.get('Content-Length', '0'))
        body = json.loads(self.rfile.read(n) or b'{}')
        Fake.calls += 1

        def flat(c):
            if isinstance(c, list):
                return ' '.join(str(p.get('text', '')) for p in c if isinstance(p, dict))
            return str(c or '')
        sysm = ' '.join(flat(m.get('content')) for m in (body.get('messages') or []) if m.get('role') == 'system')
        teller = 'You are telling a story' in sysm
        low = sysm.lower()
        if teller:
            Fake.told += 1
            words = '[The hall — Monday, March 3, 2025 | 09:%02d | clear | coat | by the door]\n\n%s The lamp turned and the hall went quiet.\n\nShe waited by the door, and nobody hurried.' % (10 + Fake.told, Fake.answer)
        elif 'narrative-state tracker' in low:
            words = 'The scene turned again; the page moved on; nothing else changed.'
        elif 'referee' in low:
            words = '{"check":false}'
        elif 'continuity reader' in low:
            words = '{"findings":[]}'
        elif 'auditor of the ledger' in low:
            words = '{"issues":[]}'
        elif 'character scribe' in low:
            words = '{"deltas":[]}'
        else:
            words = '{"mutations":[],"brief":{"pressure":[],"ripe":[],"twb":null},"deltas":[],"findings":[],"issues":[]}'
        if not body.get('stream'):
            out = json.dumps({'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': words}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': n // 4, 'completion_tokens': 20}}).encode()
            self.send_response(200); self._cors(); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(out))); self.end_headers(); self.wfile.write(out)
            return
        self.send_response(200); self._cors(); self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache'); self.send_header('Connection', 'close'); self.end_headers()
        try:
            for piece in ([words[i:i + 40] for i in range(0, len(words), 40)] if teller else [words]):
                self.wfile.write(('data: ' + json.dumps({'choices': [{'index': 0, 'delta': {'content': piece}}]}) + '\n\n').encode()); self.wfile.flush()
                if teller:
                    time.sleep(0.01)
            self.wfile.write(('data: ' + json.dumps({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': n // 4, 'completion_tokens': 40}}) + '\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True


class Threaded(ThreadingMixIn, HTTPServer):
    daemon_threads = True


fake = Threaded(('127.0.0.1', 0), Fake)
threading.Thread(target=fake.serve_forever, daemon=True).start()
FAKE = 'http://127.0.0.1:%d/v1' % fake.server_address[1]


# ---------------------------------------------------------------- the device, read as a browser reads it
def get(path, timeout=10):
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path), timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa
        return None, str(e).encode()


def version_served():
    st, body = get('api/version', 2)
    try:
        return json.loads(body).get('version') if st == 200 else None
    except ValueError:
        return None


def device_book(sid):
    st, body = get('api/books/one/' + sid)
    try:
        return json.loads(body) if st == 200 else None
    except ValueError:
        return None


def device_rows(sid):
    """the device keeps a book's pages in the store's own order (by id), not the tale's: read by id"""
    b = device_book(sid) or {}
    return sorted([[m.get('id'), m.get('role'), m.get('text'), [v.get('text') for v in (m.get('swipes') or [])]] for m in (b.get('messages') or [])])


def sent_have(sid):
    st, body = get('api/books/sent/%s?have=1' % sid)
    try:
        return json.loads(body) if st == 200 else {'status': st}
    except ValueError:
        return {'status': st}


def sent_page(sid, pid):
    st, body = get('api/books/sent/%s?page=%s' % (sid, pid))
    try:
        return json.loads(body) if st == 200 else None
    except ValueError:
        return None


# ---------------------------------------------------------------- the browser
STORE = """async () => { const { db } = await import('/js/store.js'); const out = {};
  for (const s of await db.stories.list()) { const ms = await db.messages.list(s.id);
    out[s.id] = { title: s.title, pages: ms.map((m) => [m.id, m.role, m.text, (m.swipes || []).map((v) => v.text), Number.isFinite(m.swipeIdx) ? m.swipeIdx : null, Boolean(m.hidden)]) }; }
  return out; }"""
SETTINGS = """async () => { const { db } = await import('/js/store.js'); return { active: await db.settings.get('activeConnectionId'), welcome: await db.settings.get('welcomeSeen'),
  conns: (await db.connections.list()).map((c) => [c.id, c.apiKey, c.baseUrl, c.model]) }; }"""
STATE = """async (sid) => { const q = await import('/js/agents/queue.js'); const { db } = await import('/js/store.js'); const ms = await db.messages.list(sid);
  const told = ms.filter((m) => m.role === 'assistant' && !m.hidden); const last = told[told.length - 1] || {};
  return { told: told.length, swipes: (last.swipes || []).length, lastText: last.text || '', lastId: last.id || '', lastSent: (last.receipt && last.receipt.sentId) || '', busy: window.__cozy.chat.isBusy(),
    replay: typeof window.__cozy.chat.isReplaying === 'function' ? window.__cozy.chat.isReplaying() : false, queued: q.queuedCount(sid), running: q.workIsRunning(sid) }; }"""


def watch(page):
    page.errors = []
    page.navs = 0
    page.dialogs = []
    page.on('dialog', lambda d: (page.dialogs.append(d.message), d.accept()))
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    page.on('framenavigated', lambda f: setattr(page, 'navs', page.navs + 1) if f == page.main_frame else None)
    page.add_init_script("""(() => { const seen = []; window.__toasts = seen;
        new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) seen.push(n.textContent.trim()); })
          .observe(document, { childList: true, subtree: true }); })();""")
    return page


def ver_of(page):
    try:
        return page.evaluate("() => (window.__cozy && window.__cozy.chat && window.__cozy.booksStatus) ? document.documentElement.dataset.version || null : null")
    except Exception:
        return None


def until_version(page, want, seconds):
    end = time.time() + seconds
    seen = []
    while time.time() < end:
        v = ver_of(page)
        if v and (not seen or seen[-1] != v):
            seen.append(v)
        if v == want:
            return True, seen
        time.sleep(0.25)
    return False, seen


def ev(page, js, arg=None, tries=40):
    for i in range(tries):
        try:
            return page.evaluate(js, arg) if arg is not None else page.evaluate(js)
        except Exception as e:  # a page reloading under us
            last = e
            time.sleep(0.5)
    raise last


def tell(page, sid, words, want_told, what):
    page.fill('#composer-input', words)
    page.click('#btn-send')
    end = time.time() + 120
    st = None
    while time.time() < end:
        st = ev(page, STATE, sid)
        if st['told'] == want_told and not st['busy'] and not st['replay'] and st['queued'] == 0 and not st['running']:
            return st
        time.sleep(0.4)
    raise RuntimeError(what + ' never settled: ' + json.dumps(st))


def until_device(sid, want, seconds=60):
    end = time.time() + seconds
    rows = None
    while time.time() < end:
        rows = device_rows(sid)
        if want(rows):
            return rows
        time.sleep(0.5)
    return rows


def port_free():
    import socket
    s = socket.socket()
    try:
        return s.connect_ex(('127.0.0.1', 8080)) != 0
    finally:
        s.close()


srv_old = None
ORIGIN = os.path.join(T, 'origin')
try:
    if not port_free():
        print('FAIL port 8080 is taken — the word lights the tavern there; free it first')
        sys.exit(1)
    # ------------------------------------------------------------ the repository he pulls from: the release before now, this tree later
    git('clone', '-q', REPO, ORIGIN)
    git('checkout', '-q', '-b', 'under-test', cwd=ORIGIN)
    changed = [f for f in git('diff', '--name-only', 'HEAD').split('\n') + git('ls-files', '--others', '--exclude-standard').split('\n') if f]
    for f in changed:
        if os.path.exists(os.path.join(REPO, f)):
            os.makedirs(os.path.dirname(os.path.join(ORIGIN, f)), exist_ok=True)
            shutil.copy2(os.path.join(REPO, f), os.path.join(ORIGIN, f))
        elif os.path.exists(os.path.join(ORIGIN, f)):
            os.remove(os.path.join(ORIGIN, f))
    if changed:
        git('add', '-A', cwd=ORIGIN)
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'the tree under test', cwd=ORIGIN)
    NEW = git('rev-parse', 'HEAD', cwd=ORIGIN)
    git('checkout', '-q', '-B', 'main', OLD, cwd=ORIGIN)
    # ------------------------------------------------------------ his phone before the update: the release before, installed as install.sh installs it
    git('clone', '-q', ORIGIN, REPO_T)
    pkg = os.path.join(PREFIX_T, 'bin', 'pkg')
    open(pkg, 'w').write('#!/bin/sh\nexit 0\n')  # Termux's package manager: everything is already there
    os.chmod(pkg, 0o755)
    ENV = {k: v for k, v in os.environ.items() if k not in ('PORT', 'COZY_DATA_DIR', 'COZY_HOSTS', 'COZY_HOME', 'COZY_TEST_PORT', 'COZY_TEST_REPO')}
    ENV.update(HOME=HOME_T, PREFIX=PREFIX_T, PATH=os.path.join(PREFIX_T, 'bin') + ':' + os.environ.get('PATH', ''))
    inst = subprocess.run(['bash', os.path.join(REPO_T, 'install.sh')], cwd=HOME_T, env=ENV, capture_output=True, text=True, timeout=180)
    word = os.path.join(PREFIX_T, 'bin', 'cozytavern')
    check(inst.returncode == 0 and os.path.exists(word) and git('rev-parse', 'HEAD', cwd=REPO_T) == git('rev-parse', OLD), 'fixture: the release before (%s, %s) is installed as install.sh installs it' % (OLD_VER, OLD[:7]))
    old_log = open(os.path.join(T, 'old_server.log'), 'w')
    srv_old = subprocess.Popen(['python3', os.path.join(REPO_T, 'serve.py')], cwd=REPO_T, env=ENV, stdout=old_log, stderr=subprocess.STDOUT)  # as the word lights it
    for _ in range(80):
        if version_served():
            break
        time.sleep(0.25)
    check(version_served() == OLD_VER, 'fixture: the release before is what the phone serves: %s' % version_served())

    with sync_playwright() as p:
        profile = os.path.join(T, 'profile')
        ctx = p.chromium.launch_persistent_context(profile, headless=True, args=['--no-sandbox'], viewport={'width': 412, 'height': 915})
        old_tab = watch(ctx.new_page())
        old_tab.goto(BASE, wait_until='load')
        old_tab.wait_for_function('!!window.__cozy && !!window.__cozy.chat && !!window.__cozy.booksStatus', timeout=40000)
        old_tab.wait_for_function('!!navigator.serviceWorker && !!navigator.serviceWorker.controller', timeout=40000)
        check(ver_of(old_tab) == OLD_VER, 'fixture: the browser runs the release before, its service worker in charge')
        ids = ev(old_tab, """async (fake) => { const { db } = await import('/js/store.js');
          await db.settings.set('welcomeSeen', true);
          const conn = await db.connections.add({ label: 'his provider', type: 'openai', baseUrl: fake, apiKey: 'sk-HIS-KEY-123', model: 'fake', contextSize: 128000, maxTokens: 2000 });
          await db.settings.set('activeConnectionId', conn.id);
          const A = await db.stories.create({ title: 'the tale he reads' });
          const rows = []; let ts = Date.now() - 3600000;
          for (let i = 1; i <= 6; i += 1) {
            rows.push({ role: 'user', text: 'Turn ' + i + ', his words.', ts: (ts += 1000) });
            const page = '[The hall — Monday, March 3, 2025 | 09:0' + i + ' | clear | coat | by the door]\\n\\nSEEDED-' + i + ' The lamp burned low.\\n\\nNobody spoke for a while.';
            if (i === 4) rows.push({ role: 'assistant', text: page + ' (second telling)', swipes: [{ text: page, ts }, { text: page + ' (second telling)', ts: ts + 1 }], swipeIdx: 1, ts: (ts += 1000) });
            else rows.push({ role: 'assistant', text: page, ts: (ts += 1000) });
          }
          await db.messages.appendAll(A.id, rows);
          const B = await db.stories.create({ title: 'another tale' });
          await db.messages.appendAll(B.id, [{ role: 'user', text: 'Hello.', ts: (ts += 1000) }, { role: 'assistant', text: 'OTHER-1 The rain.', ts: (ts += 1000) }, { role: 'user', text: 'Again.', ts: (ts += 1000) }, { role: 'assistant', text: 'OTHER-2 The rain again.', ts: (ts += 1000) }]);
          window.__cozy.setActiveStoryId(A.id);
          return { A: A.id, B: B.id }; }""", FAKE)
        old_tab.reload(wait_until='load')
        old_tab.wait_for_function('!!window.__cozy && !!window.__cozy.chat && !!window.__cozy.booksStatus', timeout=40000)
        old_tab.wait_for_timeout(1500)
        ev(old_tab, "async (sid) => { await window.__cozy.chat.openStory(sid); }", ids['A'])
        Fake.answer = 'TOLD-OLD-1'
        s1 = tell(old_tab, ids['A'], 'I open the door.', 7, 'the first telling on the build before')
        Fake.answer = 'TOLD-OLD-2'
        s2 = tell(old_tab, ids['A'], 'I step inside.', 8, 'the second telling on the build before')
        check('TOLD-OLD-2' in s2['lastText'], 'fixture: two pages told on the build before')
        ev(old_tab, "async () => { await window.__cozy.booksStatus.pushAll(); }")
        rowsA = until_device(ids['A'], lambda r: r and len(r) == 16 and any('TOLD-OLD-2' in (x[2] or '') for x in r))
        rowsB = until_device(ids['B'], lambda r: r and len(r) == 4)
        check(rowsA and len(rowsA) == 16 and rowsB and len(rowsB) == 4, 'fixture: the device holds both books, every page (%s and %s rows)' % (len(rowsA or []), len(rowsB or [])))
        pushed_old = ev(old_tab, "async (sid) => (await import('/js/sent.js')).pushSentToDevice(sid)", ids['A'])
        have_before = sent_have(ids['A'])
        words_old = sent_page(ids['A'], s2['lastSent'])
        notes['sent_words_on_device_before'] = bool(words_old)
        check(pushed_old is True and bool(words_old) and len(have_before.get('pages', [])) == 2, 'fixture: what the storyteller was sent for the two pages told is on the device (the push that follows a page by four minutes, called now): %s pages' % len(have_before.get('pages', [])))
        BEFORE = ev(old_tab, STORE)
        SET_BEFORE = ev(old_tab, SETTINGS)
        DEV_BEFORE = {k: device_rows(v) for k, v in ids.items()}
        caches_before = ev(old_tab, "async () => (await caches.keys())")
        check(caches_before == ['cozytavern-shell-' + OLD_VER], 'fixture: the browser keeps the release before: %s' % caches_before)
        errors_old_phase = list(old_tab.errors)
        check(not errors_old_phase, 'fixture: no error on the build before: %s' % errors_old_phase[:3])

        # ------------------------------------------------------------ HIS UPDATE: this tree reaches the repository, and he types `cozytavern`
        git('checkout', '-q', '-B', 'main', NEW, cwd=ORIGIN)
        t0 = time.time()
        r = subprocess.run([word], cwd=HOME_T, env=ENV, capture_output=True, text=True, timeout=240)
        notes['launcher_seconds'] = round(time.time() - t0, 1)
        notes['launcher_said'] = r.stdout.strip().split('\n')[-5:]
        check(r.returncode == 0, 'the launcher ends cleanly (exit %s)%s' % (r.returncode, '' if r.returncode == 0 else ': ' + r.stderr.strip()[-300:]))
        check(('Fresh coat on: the tavern is now at %s.' % NEW_VER) in r.stdout, 'it says the tavern is now at %s%s' % (NEW_VER, '' if ('Fresh coat on: the tavern is now at %s.' % NEW_VER) in r.stdout else ': ' + json.dumps(r.stdout.strip().split('\n')[-6:])))
        check('Couldn' not in r.stdout + r.stderr, 'and nothing about a pull that failed')
        head = subprocess.check_output(['git', '-C', REPO_T, 'rev-parse', 'HEAD'], text=True).strip()
        check(head == NEW, 'the folder is the tree under test, fast-forwarded (%s)' % head[:7])
        check(subprocess.check_output(['git', '-C', REPO_T, 'status', '--porcelain'], text=True).strip() == '', 'and has nothing of its own left over')
        try:
            srv_old.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        check(srv_old.poll() is not None, 'the old server is put out (it would have answered the new pages with the old code)')
        for _ in range(40):
            if version_served() == NEW_VER:
                break
            time.sleep(0.25)
        check(version_served() == NEW_VER, 'the server now answering is the new build: %s' % version_served())

        r2 = subprocess.run([word], cwd=HOME_T, env=ENV, capture_output=True, text=True, timeout=240)
        notes['second_run_said'] = r2.stdout.strip().split('\n')
        check(r2.returncode == 0 and ('Already on %s — the tavern is current.' % NEW_VER) in r2.stdout, 'typed again, the word as the update left it finds the tavern and says it is current (exit %s)' % r2.returncode)
        for _ in range(40):
            if version_served() == NEW_VER:
                break
            time.sleep(0.25)
        check(version_served() == NEW_VER, 'and the tavern is lit again on %s' % NEW_VER)
        rearmed = open(word, encoding='utf-8').read()
        check(MARK not in rearmed and rearmed == open(os.path.join(REPO_T, 'cozytavern.sh'), encoding='utf-8').read().replace(MARK, REPO_T), 'and the word itself is now the new launcher, baked with his folder (the release before wrote it back unbaked at every other update)')

        # ------------------------------------------------------------ the browser: the tab the launcher opens (termux-open-url), the old tab still open
        t1 = time.time()
        new_tab = watch(ctx.new_page())
        new_tab.goto(BASE, wait_until='load')
        got, seen = until_version(new_tab, NEW_VER, 90)
        notes['new_tab_versions_seen'] = seen
        notes['new_tab_seconds_to_new'] = round(time.time() - t1, 1)
        notes['new_tab_loads'] = new_tab.navs
        manual = False
        if not got:
            manual = True
            new_tab.reload(wait_until='load')
            got, seen2 = until_version(new_tab, NEW_VER, 60)
            notes['after_manual_reload'] = seen2
        notes['needed_a_manual_reload'] = manual
        check(got, 'the tab the word opens comes up on %s (seen: %s, %.1f s, %s)' % (NEW_VER, seen, notes['new_tab_seconds_to_new'], 'after a pull-down' if manual else 'by itself'))
        got_old, seen_old = until_version(old_tab, NEW_VER, 30)
        notes['old_tab_versions_seen'] = seen_old
        check(got_old, 'the tab left open on the release before reloads itself onto %s too (seen: %s)' % (NEW_VER, seen_old))
        new_tab.wait_for_timeout(2500)
        caches_after = ev(new_tab, "async () => (await caches.keys())")
        check(caches_after == ['cozytavern-shell-' + NEW_VER], 'the browser keeps the new build alone: %s' % caches_after)
        ev(new_tab, "async (sid) => { await window.__cozy.chat.openStory(sid); }", ids['A'])
        marks = None
        for _ in range(60):
            marks = ev(new_tab, """async (sid) => { const { db } = await import('/js/store.js'); return [await db.settings.get('pagesMended:' + sid), await db.settings.get('asidesSettled:' + sid)]; }""", ids['A'])
            if marks == [NEW_VER, 1]:
                break
            time.sleep(0.5)
        check(marks == [NEW_VER, 1], 'the new build looked the tale over once, as it does on a first open (%s)' % marks)
        AFTER = ev(new_tab, STORE)
        check(sorted(AFTER) == sorted(BEFORE) and all(AFTER[k]['title'] == BEFORE[k]['title'] for k in BEFORE), 'both tales are on the shelf, by the same names')
        for k in BEFORE:
            same = AFTER[k]['pages'] == BEFORE[k]['pages']
            diff = [] if same else [(a, b) for a, b in zip(BEFORE[k]['pages'], AFTER[k]['pages']) if a != b][:2]
            check(same, 'every page of “%s” is as it was — words, versions, the version shown (%d pages)%s' % (BEFORE[k]['title'], len(BEFORE[k]['pages']), '' if same else ': ' + json.dumps(diff)[:400]))
        SET_AFTER = ev(new_tab, SETTINGS)
        check(SET_AFTER == SET_BEFORE, 'his provider, its key and the welcome are as they were')
        thread = ev(new_tab, """() => ({ pages: document.querySelectorAll('#thread .msg-assistant').length, last: ([...document.querySelectorAll('#thread .msg-assistant')].pop() || {}).textContent || '',
          all: (document.querySelector('#thread') || {}).textContent || '' })""")
        check(thread['pages'] >= 1 and 'TOLD-OLD-2' in thread['last'], 'the thread shows the tale, its newest page last (%d pages drawn)' % thread['pages'])
        check('not in this browser' not in thread['all'] and 'Ask again' not in thread['all'], 'and says nothing of missing pages or a failed telling')
        check(DEV_BEFORE == {k: device_rows(v) for k, v in ids.items()}, 'the device still holds both books exactly as before')

        # ------------------------------------------------------------ on the new build: a telling, then "try again" under his own newest message
        old_tab.close()  # two tabs of one tale is its own scenario (tests/twohands.py); his phone shows one
        Fake.answer = 'TOLD-NEW-1'
        s3 = tell(new_tab, ids['A'], 'I sit by the fire.', 9, 'a telling on the new build')
        check('TOLD-NEW-1' in s3['lastText'], 'a page is told on the new build')
        Fake.answer = 'TOLD-NEW-1-AGAIN'
        pressed = ev(new_tab, """() => { const his = [...document.querySelectorAll('#thread .msg-user')].pop(); const b = his && his.querySelector('.msg-act[data-act="try again"]');
          if (!b) return 'no try again under his newest message'; b.click(); return his.textContent.trim().slice(0, 40); }""")
        check('I sit by the fire' in pressed, 'fixture: “try again” pressed under his own newest message (%s)' % pressed)
        end = time.time() + 120
        s4 = None
        while time.time() < end:
            s4 = ev(new_tab, STATE, ids['A'])
            if s4['swipes'] == 2 and not s4['busy'] and not s4['replay'] and s4['queued'] == 0 and not s4['running']:
                break
            time.sleep(0.4)
        check(s4 and s4['told'] == 9 and s4['swipes'] == 2 and 'TOLD-NEW-1-AGAIN' in s4['lastText'], '"try again" under his message tells the page again as a second version, nothing lost (%s)' % json.dumps({k: s4.get(k) for k in ('told', 'swipes')} if s4 else None))
        ev(new_tab, "async () => { await window.__cozy.booksStatus.pushAll(); }")
        newest = lambda r: [x for x in (r or []) if x[0] == s4['lastId']]
        rowsA2 = until_device(ids['A'], lambda r: r and len(r) == 18 and newest(r) and 'TOLD-NEW-1-AGAIN' in (newest(r)[0][2] or '') and len(newest(r)[0][3]) == 2)
        check(rowsA2 and len(rowsA2) == 18 and newest(rowsA2) and 'TOLD-NEW-1-AGAIN' in (newest(rowsA2)[0][2] or '') and len(newest(rowsA2)[0][3]) == 2, 'the device holds the new page and both its versions')
        before_ids = set(x[0] for x in DEV_BEFORE['A'])
        check(rowsA2 and [x for x in rowsA2 if x[0] in before_ids] == DEV_BEFORE['A'], 'and every page from before, untouched')
        pushed_new = ev(new_tab, "async (sid) => (await import('/js/sent.js')).pushSentToDevice(sid)", ids['A'])
        have_after = sent_have(ids['A'])
        notes['sent_pages_on_device_after'] = len(have_after.get('pages', []))
        check(pushed_new is True and bool(s4['lastSent']) and s4['lastSent'] in have_after.get('pages', []), 'what the storyteller was sent for the page told on the new build reaches the device (%s)' % pushed_new)
        check(set(have_before.get('pages', [])) <= set(have_after.get('pages', [])) and bool(sent_page(ids['A'], s2['lastSent'])), 'and the words sent before the update are still there, readable')
        errs = list(new_tab.errors) + [e for e in old_tab.errors if e not in errors_old_phase]
        check(not errs, 'no error on any page after the update: %s' % errs[:3])
        notes['toasts_new_tab'] = ev(new_tab, "() => (window.__toasts || []).slice()")
        notes['dialogs_new_tab'] = list(new_tab.dialogs)
        ctx.close()

        # ------------------------------------------------------------ a browser that holds nothing (his site data cleared, another browser)
        b = p.chromium.launch(args=['--no-sandbox'])
        c2 = b.new_context(viewport={'width': 412, 'height': 915})
        fresh = watch(c2.new_page())
        fresh.goto(BASE, wait_until='load')
        fresh.wait_for_function('!!window.__cozy && !!window.__cozy.chat && !!window.__cozy.booksStatus', timeout=40000)
        fresh.wait_for_timeout(2500)
        shelf = None
        for _ in range(60):
            shelf = ev(fresh, "async () => { const { db } = await import('/js/store.js'); return (await db.stories.list()).map((s) => s.title).sort(); }")
            if shelf == sorted(['the tale he reads', 'another tale']):
                break
            time.sleep(0.5)
        check(shelf == sorted(['the tale he reads', 'another tale']), 'a browser that holds nothing finds both tales on the device: %s' % shelf)
        ev(fresh, "async (sid) => { await window.__cozy.chat.openStory(sid); }", ids['A'])
        held = None
        for _ in range(90):
            held = ev(fresh, """async (sid) => { const { db } = await import('/js/store.js'); return (await db.messages.list(sid)).map((m) => [m.id, m.role, m.text, (m.swipes || []).map((v) => v.text)]); }""", ids['A'])
            if held and len(held) == 18:
                break
            time.sleep(0.5)
        check(sorted(held or []) == device_rows(ids['A']), 'and opening the tale brings every page in, as the device holds it (%d)' % len(held or []))
        seen_words = ev(fresh, """async ([sid, pid]) => { const s = await import('/js/sent.js'); const r = await s.loadSentOrPull(pid, sid); return Boolean(r && (r.slots || r.requests)); }""", [ids['A'], s2['lastSent']])
        check(seen_words is True, 'and what the storyteller was sent for a page told before the update can be read there')
        check(not fresh.errors, 'no error there either: %s' % fresh.errors[:3])
        b.close()
finally:
    subprocess.run(['pkill', '-f', os.path.join(REPO_T, 'serve.py')])
    if srv_old and srv_old.poll() is None:
        srv_old.kill()
    fake.shutdown()
    shutil.rmtree(T, ignore_errors=True)

print(json.dumps(notes, indent=1, ensure_ascii=False))
for w in bad:
    print('FAIL — ' + w)
print('%d ok, %d failed' % (ok_n, len(bad)))
sys.exit(1 if bad else 0)
