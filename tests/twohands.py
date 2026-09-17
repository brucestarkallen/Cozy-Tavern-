#!/usr/bin/env python3
"""Two real Chromium contexts on ONE tale, the real serve.py, a fake model (M293).

Browser A writes a page and its readers go to work — the fake model holds the
extractor's answer for a few seconds, the way a real one takes its time.
Browser B holds the same tale open and is handed the page at once (M182). Its
light sees a ledger a page behind and, before M293, sent B's OWN readers at the
page: two extractors on one page, a standing moved twice, and each browser's
whole-book push laying its ledger over the other's mid-chain. Now B keeps its
idle repairs off a tale another hand wrote within the last minutes — and the
page is still read exactly once, by the browser that wrote it.

  python3 tests/twohands.py
"""
import json, os, shutil, subprocess, sys, time, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-twohands')
PORT = os.environ.get('COZY_TEST_PORT', '8097')
FAKE = int(os.environ.get('FAKE_PORT', '8197'))
BASE = 'http://127.0.0.1:%s/' % PORT
EXTRACTOR_HOLD = 6.0   # seconds the fake model sits on the extractor's answer

PAGE = ('[The Wells kitchen — Friday, March 14, 2025 | 14:30 | ☀ clear | grey hoodie | at the table]\n\n'
        'Mara set the cup down in front of him and did not sit. "You knew," she said.')
EMPTY = '{"mutations":[],"brief":{"pressure":[],"ripe":[],"twb":null},"deltas":[],"findings":[],"issues":[],"resolved":[]}'
EXTRACT = json.dumps({'mutations': [
    {'type': 'presence.enter', 'name': 'Mara', 'position': 'by the table'},
    {'type': 'rel.shift', 'name': 'Mara', 'axis': 'p', 'delta': 10, 'cause': 'she brought him the cup and stayed standing'},
    {'type': 'mode.snapshot', 'flags': []},   # the whole mood board, so the reader is not asked a second time (M92)
], 'resolved': []})

a_calls = []          # what A's browser asked the fake model
lock = threading.Lock()


def kind_of(body):
    sys_text = ' '.join(m.get('content', '') if isinstance(m.get('content'), str) else '' for m in body.get('messages', []) if m.get('role') == 'system')
    if 'You are telling a story' in sys_text: return 'story'
    if 'You keep the ledger' in sys_text: return 'extractor'
    if 'world beyond the page' in sys_text: return 'world'
    return 'worker'


def sse_body(answer):
    return ('data: ' + json.dumps({'choices': [{'index': 0, 'delta': {'content': answer}}]}) + '\n\n'
            + 'data: ' + json.dumps({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]}) + '\n\n'
            + 'data: [DONE]\n\n')


class Fake(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

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
        self.send_response(200); self._cors(); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(out))); self.end_headers(); self.wfile.write(out)

    def do_POST(self):
        n = int(self.headers.get('Content-Length', '0'))
        body = json.loads(self.rfile.read(n) or b'{}')
        kind = kind_of(body)
        with lock:
            a_calls.append(kind)
        answer = PAGE if kind == 'story' else EXTRACT if kind == 'extractor' else EMPTY
        if kind == 'extractor':
            time.sleep(EXTRACTOR_HOLD)
        out = sse_body(answer).encode('utf-8')
        self.send_response(200); self._cors()
        self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'close'); self.send_header('Content-Length', str(len(out))); self.end_headers()
        try:
            self.wfile.write(out); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True


class Threaded(ThreadingMixIn, HTTPServer):
    daemon_threads = True


fails = []


def check(name, ok, extra=''):
    print(('  ok   — ' if ok else '  FAIL — ') + name + ((' :: ' + extra) if extra else ''))
    if not ok:
        fails.append(name)


def boot(ctx):
    page = ctx.new_page()
    page.goto(BASE, wait_until='load')
    page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
    page.wait_for_timeout(1200)
    return page


def story_id(page, title):
    return page.evaluate("async (t) => { const s = (await window.__cozy.db.stories.list()).find(x => x.title === t); return s ? s.id : null; }", title)


def main():
    fake = Threaded(('127.0.0.1', FAKE), Fake)
    threading.Thread(target=fake.serve_forever, daemon=True).start()
    shutil.rmtree(DATA, ignore_errors=True); os.makedirs(DATA, exist_ok=True)
    srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=REPO)
    try:
        time.sleep(1.5)
        with sync_playwright() as p:
            browser = p.chromium.launch(args=['--no-sandbox'])
            A = browser.new_context(service_workers='block')
            B = browser.new_context(service_workers='block')
            b_calls = []
            errors = []

            # B never reaches the fake model: its calls are counted and answered here
            def b_route(route, request):
                try:
                    body = json.loads(request.post_data or '{}')
                except Exception:
                    body = {}
                b_calls.append(kind_of(body))
                route.fulfill(status=200, headers={'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*'}, body=sse_body(EMPTY))
            B.route('**/v1/chat/completions', b_route)

            a = boot(A)
            a.on('pageerror', lambda e: errors.append('A: ' + str(e)))
            a.evaluate("""async (fake) => {
              const db = window.__cozy.db;
              const conn = await db.connections.add({ label: 'the house choice', type: 'openai', baseUrl: fake, apiKey: 'x', model: 'fake', contextSize: 128000 });
              await db.settings.set('activeConnectionId', conn.id);
              await db.settings.set('welcomeSeen', true);
              const st = await db.stories.create({ title: 'Ravenwood' });
              /* an established tale: begun long ago, its ledger founded — a fresh tale's
               * young ledger is left to the page chain, and a tale made in the last minute
               * is never resumed, which is right and beside the point here */
              await db.stories.update(st.id, { createdAt: Date.now() - 20 * 60000 });
              const { loadState, saveState } = await import('/js/engine/state.js');
              const seed = await loadState(st.id);
              seed.place = 'The Wells kitchen';
              seed.present = [{ name: 'Jovan', position: 'at the table' }];
              seed.sheet = { ...(seed.sheet || {}), playerName: 'Jovan' };
              await saveState(st.id, seed);
              await window.__cozy.chat.openStory(st.id);
              if (window.__cozy.booksStatus && window.__cozy.booksStatus.pushAll) await window.__cozy.booksStatus.pushAll();
            }""", 'http://127.0.0.1:%d' % FAKE)
            a.wait_for_timeout(800)

            b = boot(B)
            b.on('pageerror', lambda e: errors.append('B: ' + str(e)))
            b.wait_for_timeout(1000)
            tid_b = story_id(b, 'Ravenwood')
            check('B knows the tale and the connection', bool(tid_b) and b.evaluate("async () => (await window.__cozy.db.connections.list()).length") == 1)
            b.evaluate("async (id) => { await window.__cozy.chat.openStory(id); }", tid_b)
            b.wait_for_timeout(600)

            # --- A writes a page and its readers go to work ---------------
            tid = story_id(a, 'Ravenwood')
            a.evaluate("""async (id) => {
              const db = window.__cozy.db;
              await db.messages.append(id, { role: 'user', text: 'I wait for Mara in the kitchen.' });
              await db.messages.append(id, { role: 'assistant', text: %s });
              await window.__cozy.chat.renderThread({ structural: true });
              await window.__cozy.chat.rescanLedger();
            }""" % json.dumps(PAGE), tid)

            # --- B receives the page live, while A's extractor is still out ----
            landed = False
            for _ in range(40):
                b.wait_for_timeout(200)
                n = b.evaluate("async (id) => (await window.__cozy.db.messages.list(id)).length", tid_b)
                if n >= 2:
                    landed = True
                    break
            check('B is handed the page at once (M182)', landed)
            # B reopens the tale mid-chain, as a writer switching browsers would
            b.reload(wait_until='load')
            b.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
            b.wait_for_timeout(1500)

            # --- A's chain lands; A pushes the whole book -------------------
            for _ in range(60):
                a.wait_for_timeout(500)
                if a.evaluate("() => window.__cozy.chat.isBusy() ? true : false"):
                    continue
                done = a.evaluate("""async (id) => {
                  const { readMark } = await import('/js/engine/state.js');
                  const { loadState } = await import('/js/engine/state.js');
                  const st = await loadState(id);
                  return readMark(st) >= 0 && Array.isArray(st.present) && st.present.some(p => p.name === 'Mara');
                }""", tid)
                if done:
                    break
            a.evaluate("async () => { if (window.__cozy.booksStatus && window.__cozy.booksStatus.pushAll) await window.__cozy.booksStatus.pushAll(); }")
            a.wait_for_timeout(4000)   # B's live pull of the whole book, and any idle repair it would start

            a_extract = [k for k in a_calls if k == 'extractor']
            b_extract = [k for k in b_calls if k in ('extractor', 'world', 'worker', 'story')]
            check('A read the page once, with its own readers', len(a_extract) == 1, 'A extractor calls: %d' % len(a_extract))
            check('B never sent its own readers at a page A’s readers were still at', not b_calls, 'B model calls: %s' % b_calls)

            standing = a.evaluate("""async (id) => {
              const { loadState } = await import('/js/engine/state.js');
              const st = await loadState(id);
              const r = st.relationships && (st.relationships['Mara'] || st.relationships['mara']);
              return r ? (r.p ?? r.P ?? null) : null;
            }""", tid)
            check('the standing moved exactly once, in A (P:10, not 20)', standing == 10, 'Mara P = %r' % (standing,))
            standing_b = b.evaluate("""async (id) => {
              const { loadState } = await import('/js/engine/state.js');
              const st = await loadState(id);
              const r = st.relationships && st.relationships['Mara'];
              return r ? r.p : null;
            }""", tid_b)
            check('and B holds the same ledger A wrote', standing_b == 10, 'Mara P in B = %r' % (standing_b,))
            check('no page errors', not errors, str(errors))

            # --- and the writer's OWN killed tab still finishes its page (M127) ----
            # A writes another page and its readers go out; the tab is closed under
            # them and opened again: the boot pull finds the book moved — by A's own
            # hand — so A's resume runs at once and reads the page it never finished.
            before_a = len([k for k in a_calls if k == 'extractor'])
            a.evaluate("""async (id) => {
              const db = window.__cozy.db;
              await db.messages.append(id, { role: 'user', text: 'I ask her what she means.' });
              await db.messages.append(id, { role: 'assistant', text: %s.replace('14:30', '14:35') });
              await window.__cozy.chat.renderThread({ structural: true });
              await window.__cozy.chat.rescanLedger();
            }""" % json.dumps(PAGE), tid)
            a.wait_for_timeout(1500)          # the extractor is out, held by the fake model
            a.close()                          # the tab dies under its readers
            time.sleep(EXTRACTOR_HOLD + 1)     # the held answer lands on a closed page
            a = boot(A)
            a.on('pageerror', lambda e: errors.append('A2: ' + str(e)))
            resumed = False
            for _ in range(60):
                a.wait_for_timeout(500)
                if len([k for k in a_calls if k == 'extractor']) >= before_a + 2:
                    resumed = True
                    break
            check('A’s own killed tab reads its unfinished page again on open — its own hand is not another’s', resumed,
                  'A extractor calls %d → %d' % (before_a, len([k for k in a_calls if k == 'extractor'])))
            a.wait_for_timeout(3000)
            check('and B still never read a page it did not write', not b_calls, 'B model calls: %s' % b_calls)
            check('no page errors after the reopen', not errors, str(errors))

            browser.close()
    finally:
        srv.terminate()
        fake.shutdown()

    print()
    print(('%d checks failed: ' % len(fails)) + ', '.join(fails) if fails else 'two hands on one tale: all green')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
