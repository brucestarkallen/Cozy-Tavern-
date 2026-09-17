#!/usr/bin/env python3
"""M302: the kept thinking, proven in a real Chromium (the walk proves it in jsdom).

The real serve.py, a fake model that thinks slowly (SSE, reasoning_content) and
then writes, two browser contexts on one device.

  A  Stop while the storyteller thinks  -> the thinking stays on the page, open,
     whole; its copy button puts the WHOLE thinking on the real clipboard; the
     live block's copy button (pressed mid-stream) held what had streamed so far
  A  reload                              -> still there, after the page it followed
  B  (the other browser)                 -> receives it with the tale's book, drawn
  A  the next page lands                 -> gone in A; after the push, gone in B
  A  the housekeeper, stopped mid-thought -> kept on the sheet; a reload keeps it;
     the next answer takes it away
  no page errors in either browser
Exit 1 on any failure.
"""
import json, os, shutil, subprocess, sys, time, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-cutthinking'
PORT = os.environ.get('COZY_TEST_PORT', '8098')
FAKE = int(os.environ.get('FAKE_PORT', '8198'))
BASE = 'http://127.0.0.1:%s/' % PORT
MODE = {'think_steps': 400, 'gap': 0.02}   # eight seconds of thinking unless stopped


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
        self.send_response(200); self._cors()
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(out)))
        self.end_headers(); self.wfile.write(out)

    def do_POST(self):
        n = int(self.headers.get('Content-Length', '0'))
        body = json.loads(self.rfile.read(n) or b'{}')
        said = json.dumps(body)
        SEEN.append(said)
        hk = 'housekeeper of a cozy tavern' in said.lower()
        worker = ('JSON ONLY' in said or 'keep the ledger' in said) and not hk
        page = '[The Wayward Lantern \u2014 Tuesday, March 4, 2026 | 21:14 | rain | a grey coat | by the door]\n\nShe looked up at last. "You knew," she said, and the rain kept on against the shutters while nobody in the room said the thing they meant.'
        answer = '{"mutations":[],"brief":{"pressure":[],"ripe":[],"twb":null},"deltas":[],"findings":[]}' if worker else ('The tide is right.' if hk else page)
        if not body.get('stream'):
            out = json.dumps({'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': answer}, 'finish_reason': 'stop'}]}).encode()
            self.send_response(200); self._cors()
            self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(out)))
            self.end_headers(); self.wfile.write(out)
            return
        self.send_response(200); self._cors()
        self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache'); self.send_header('Connection', 'close')
        self.end_headers()

        def send(obj):
            self.wfile.write(('data: ' + json.dumps(obj) + '\n\n').encode()); self.wfile.flush()
        try:
            if not worker:
                for i in range(MODE['think_steps']):
                    send({'choices': [{'index': 0, 'delta': {'reasoning_content': 'MAGPIE step %04d, weighing the room. ' % i}}]})
                    time.sleep(MODE['gap'])
            send({'choices': [{'index': 0, 'delta': {'content': answer}}]})
            send({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]})
            self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True


class Threaded(ThreadingMixIn, HTTPServer):
    daemon_threads = True


SEEN = []
fails = []


def check(name, ok, extra=''):
    print(('  ok   \u2014 ' if ok else '  FAIL \u2014 ') + name + ((' :: ' + str(extra)[:240]) if extra else ''))
    if not ok:
        fails.append(name)


def boot(ctx, errors):
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE, wait_until='load')
    page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
    page.wait_for_timeout(1200)
    return page


def push_now(page):
    page.evaluate("async () => { if (window.__cozy.booksStatus && window.__cozy.booksStatus.pushAll) await window.__cozy.booksStatus.pushAll(); }")
    page.wait_for_timeout(700)


KEPT = "() => { const n = document.querySelector('#thread .kept-thinking'); return n ? { label: n.querySelector('.msg-label').textContent, open: n.querySelector('details').open, text: n.querySelector('.thinking-body').textContent, prev: n.previousElementSibling ? n.previousElementSibling.className : '' } : null; }"

fake = Threaded(('127.0.0.1', FAKE), Fake)
threading.Thread(target=fake.serve_forever, daemon=True).start()
shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=REPO)
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        A = browser.new_context(viewport={'width': 412, 'height': 915}, service_workers='block')
        A.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE.rstrip('/'))
        B = browser.new_context(viewport={'width': 412, 'height': 915}, service_workers='block')
        errs_a, errs_b = [], []
        a = boot(A, errs_a)
        a.evaluate("""async (fake) => {
          const db = window.__cozy.db;
          await db.settings.set('welcomeSeen', true);
          const conn = await db.connections.add({ label: 'fake', type: 'openai', baseUrl: fake, apiKey: 'x', model: 'fake', contextSize: 300000, reasoning: { effort: 'high' } });
          await db.settings.set('activeConnectionId', conn.id);
          const st = await db.stories.create({ title: 'the cut thought' });
          await db.messages.append(st.id, { role: 'user', text: 'We sit by the lake.' });
          await db.messages.append(st.id, { role: 'assistant', text: 'The lake was flat and grey, and nobody spoke for a while.' });
          await db.stories.update(st.id, { extraction: false, keeper: false, continuity: false });
          window.__cozy.setActiveStoryId(st.id);
        }""", 'http://127.0.0.1:%d/v1' % FAKE)
        a.reload(wait_until='load')
        a.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
        a.wait_for_timeout(1200)

        # --- Stop while it thinks --------------------------------------------
        a.fill('#composer-input', 'Does she say anything?')
        a.press('#composer-input', 'Enter')
        a.wait_for_function("() => { const b = document.querySelector('#thread .msg.pending .thinking-body'); return b && /MAGPIE step 0020/.test(b.textContent); }", timeout=20000)
        a.click('#thread .msg.pending .thinking-copy')
        a.wait_for_timeout(250)
        live_copy = a.evaluate("() => navigator.clipboard.readText()")
        check('the live block\u2019s copy button takes what has streamed so far (it copied nothing before M301)',
              'MAGPIE step 0000' in live_copy and 'MAGPIE step 0020' in live_copy, live_copy[:80])
        a.click('#btn-stop')
        a.wait_for_function("() => !window.__cozy.chat.isBusy()", timeout=15000)
        a.wait_for_timeout(300)
        kept = a.evaluate(KEPT)
        check('after Stop the thinking is still on the page', bool(kept), kept)
        check('open, as it was while it streamed', bool(kept) and kept['open'])
        check('whole, from its first word', bool(kept) and kept['text'].startswith('MAGPIE step 0000') and 'MAGPIE step 0020' in kept['text'], kept and kept['text'][:60])
        check('it says why there is no page', bool(kept) and 'stopped while thinking' in kept['label'], kept and kept['label'])
        check('it stands right after the page it followed', bool(kept) and 'msg-user' in kept['prev'], kept and kept['prev'])
        check('no pending page is left behind', a.evaluate("() => !document.querySelector('#thread .msg.pending')"))
        check('the send button is back', a.evaluate("() => !document.getElementById('btn-send').hidden && document.getElementById('btn-stop').hidden"))
        a.click('#thread .kept-thinking .thinking-copy')
        a.wait_for_timeout(250)
        kept_copy = a.evaluate("() => navigator.clipboard.readText()")
        check('its copy button puts the whole thinking on the clipboard', bool(kept) and kept_copy == kept['text'] and len(kept_copy) > 600, len(kept_copy))
        shot = a.evaluate("() => { const r = document.querySelector('#thread .kept-thinking').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), inView: r.top < innerHeight && r.bottom > 0 }; }")
        check('it is laid out on the screen (not a zero box, not off the page)', shot['w'] > 300 and shot['h'] > 60 and shot['inView'], shot)
        a.screenshot(path='/tmp/cutthinking-stopped.png')

        # --- a reload ----------------------------------------------------------
        push_now(a)
        a.reload(wait_until='load')
        a.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
        a.wait_for_function("() => !!document.querySelector('#thread .kept-thinking')", timeout=15000)
        again = a.evaluate(KEPT)
        check('a reload keeps it, after the page it followed', bool(again) and again['text'] == kept['text'] and 'msg-user' in again['prev'], again and again['prev'])
        check('drawn once', a.evaluate("() => document.querySelectorAll('#thread .kept-thinking').length") == 1)

        # --- the other browser ---------------------------------------------------
        b = boot(B, errs_b)
        b.wait_for_timeout(1500)
        # the way a reader opens it: a fresh browser holds a tale shallow until it is opened (M189)
        b.evaluate("""async () => {
          const st = (await window.__cozy.db.stories.list()).find((s) => s.title === 'the cut thought');
          if (st) await window.__cozy.chat.openStory(st.id);
        }""")
        b.wait_for_timeout(500)
        in_b = b.evaluate(KEPT)
        check('the other browser receives it with the tale\u2019s book, and draws it', bool(in_b) and in_b['text'] == kept['text'], in_b and in_b['label'])

        # --- the next page lands ----------------------------------------------
        MODE['think_steps'] = 5
        before = len(SEEN)
        a.fill('#composer-input', 'I ask her again.')
        a.press('#composer-input', 'Enter')
        a.wait_for_function("() => document.querySelectorAll('#thread .msg-assistant:not(.pending)').length >= 2 && !window.__cozy.chat.isBusy()", timeout=30000)
        a.wait_for_timeout(400)
        check('when the next page lands the kept thinking goes', a.evaluate("() => !document.querySelector('#thread .kept-thinking')"))
        check('and its row with it', a.evaluate("async () => { const st = (await window.__cozy.db.stories.list()).find((s) => s.title === 'the cut thought'); return (await window.__cozy.db.settings.get('cutThinking:' + st.id)) === undefined; }"))
        check('the new page carries its own thinking', a.evaluate("() => { const all = document.querySelectorAll('#thread .msg-assistant'); return !!all[all.length - 1].querySelector('details.thinking'); }"))
        sent = '\n'.join(SEEN[before:])
        check('no request held the cut thinking', 'MAGPIE step 0020' not in sent, len(SEEN) - before)
        push_now(a)
        b.wait_for_timeout(2500)
        check('and it goes in the other browser too, live', b.evaluate("() => !document.querySelector('#thread .kept-thinking')"))
        check('B holds the new page', b.evaluate("() => document.querySelectorAll('#thread .msg-assistant').length") >= 2)

        # --- the housekeeper ----------------------------------------------------
        MODE['think_steps'] = 400
        a.click('#btn-housekeeper')
        a.wait_for_function("() => !document.getElementById('hk-sheet').hidden && !document.getElementById('hk-send').disabled", timeout=15000)
        a.fill('#hk-input', 'is the tide right?')
        a.click('#hk-send')
        a.wait_for_function("() => { const d = document.querySelector('#hk-thread details.hk-thinking'); return d && /MAGPIE step 0020/.test(d.textContent); }", timeout=20000)
        check('the housekeeper\u2019s live thinking has its copy button while it thinks', a.evaluate("() => !!document.querySelector('#hk-thread details.hk-thinking .thinking-copy')"))
        a.click('#hk-stop')
        a.wait_for_function("() => !document.getElementById('hk-send').disabled", timeout=15000)
        a.wait_for_timeout(300)
        cut = a.evaluate("() => { const d = document.querySelector('#hk-thread details.hk-cut'); return d ? { open: d.open, text: d.textContent } : null; }")
        check('the housekeeper\u2019s thinking stays on the sheet after Stop', bool(cut) and 'MAGPIE step 0020' in cut['text'] and cut['open'], cut and cut['text'][:60])
        check('the question is back in its box', a.evaluate("() => document.getElementById('hk-input').value") == 'is the tide right?')
        a.reload(wait_until='load')
        a.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
        a.wait_for_timeout(800)
        a.click('#btn-housekeeper')
        a.wait_for_function("() => !document.getElementById('hk-sheet').hidden", timeout=15000)
        a.wait_for_function("() => !!document.querySelector('#hk-thread details.hk-cut')", timeout=15000)
        check('a reload keeps the housekeeper\u2019s cut thinking', True)
        MODE['think_steps'] = 5
        a.wait_for_function("() => !document.getElementById('hk-send').disabled", timeout=15000)
        a.fill('#hk-input', 'is the tide right?')
        a.click('#hk-send')
        a.wait_for_function("() => [...document.querySelectorAll('#hk-thread .hk-bubble')].some((x) => /The tide is right/.test(x.textContent)) && !document.getElementById('hk-send').disabled", timeout=30000)
        check('the next answer takes it away', a.evaluate("() => !document.querySelector('#hk-thread details.hk-cut')"))

        check('no page errors in A', not errs_a, errs_a)
        check('no page errors in B', not errs_b, errs_b)
        browser.close()
finally:
    srv.terminate()
    fake.shutdown()

print()
print('the kept thinking, in a real browser: all green' if not fails else 'FAILED: ' + '; '.join(fails))
sys.exit(1 if fails else 0)
