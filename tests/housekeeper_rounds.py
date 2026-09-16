"""The housekeeper's second round, in a real browser (M270).

The first answer asks to look something up; the second round then thinks for
longer than the silence watch allows. It used to stream into nothing — the
panel stood still and the watch cut a live answer. It must finish, say which
round it is on, and show the writer's question the moment it is asked.

  python3 tests/housekeeper_rounds.py
"""
import json, os, shutil, subprocess, sys, time, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-rounds')
PORT = os.environ.get('COZY_TEST_PORT', '8094')
FAKE = int(os.environ.get('FAKE_PORT', '8198'))
STALL = 6            # the silence watch, in seconds
ROUND2_SECONDS = 10  # longer than the watch


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
        said = json.dumps(body.get('messages', []))
        second = 'What you asked for, whole' in said
        self.send_response(200); self._cors()
        self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'close'); self.end_headers()

        def send(obj):
            self.wfile.write(('data: ' + json.dumps(obj) + '\n\n').encode()); self.wfile.flush()
        try:
            if not second:
                for i in range(20):
                    send({'choices': [{'index': 0, 'delta': {'reasoning_content': 'first look %d. ' % i}}]}); time.sleep(0.01)
                # written the way a model writes: a piece at a time, frames painted between
                for piece in ['Let me look. ', '<fetch>[', '"find: ', 'seventeen"', ']</fetch>']:
                    send({'choices': [{'index': 0, 'delta': {'content': piece}}]})
                    time.sleep(0.35)
            else:
                steps = 200
                for i in range(steps):
                    send({'choices': [{'index': 0, 'delta': {'reasoning_content': 'weighing the page %03d. ' % i}}]})
                    time.sleep(ROUND2_SECONDS / steps)
                send({'choices': [{'index': 0, 'delta': {'content': 'THE-SECOND-ROUND-ANSWER: nothing needs changing.'}}]})
            send({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]})
            self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True


class Threaded(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def open_housekeeper(page):
    """After a reload the old page can answer for a moment: knock until the new one is up and the sheet is open."""
    for _ in range(80):
        try:
            if page.evaluate("document.readyState === 'complete' && !!(window.__cozy && window.__cozy.housekeeper) && !document.getElementById('hk-sheet').hidden"):
                return
            if page.evaluate("document.readyState === 'complete' && !!(window.__cozy && window.__cozy.housekeeper)"):
                page.click('#btn-housekeeper', timeout=2000)
        except Exception:
            pass
        time.sleep(0.5)


def main():
    fake = Threaded(('127.0.0.1', FAKE), Fake)
    threading.Thread(target=fake.serve_forever, daemon=True).start()
    shutil.rmtree(DATA, ignore_errors=True); os.makedirs(DATA, exist_ok=True)
    srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=REPO)
    checks = []
    try:
        time.sleep(1.5)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{PORT}/')
            page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000)
            page.evaluate('''async ([fake, stall]) => {
              const { db } = await import('/js/store.js');
              const conn = await db.connections.add({ label: 'fake', type: 'openai', baseUrl: fake, apiKey: 'x', model: 'fake' });
              await db.settings.set('activeConnectionId', conn.id);
              const st = await db.stories.create({ title: 'rounds' });
              await db.stories.update(st.id, { brief: 'Jovan is sixteen.' });
              await db.messages.append(st.id, { role: 'user', text: 'I come home.' });
              await db.messages.append(st.id, { role: 'assistant', text: 'Jovan, seventeen, dropped his bag.' });
              await db.settings.set('activeStoryId', st.id);
              await db.settings.set('welcomeSeen', true);
              await db.settings.set('hkStallSec', stall);
            }''', [f'http://127.0.0.1:{FAKE}', STALL])
            page.reload(wait_until='load')
            open_housekeeper(page)
            page.wait_for_selector('#hk-sheet:not([hidden])', timeout=10000)
            time.sleep(0.5)
            page.evaluate('''() => {
              window.__said = [];
              window.__live = [];
              const s = document.getElementById('hk-status');
              new MutationObserver(() => window.__said.push(s.textContent)).observe(s, { childList: true, characterData: true, subtree: true });
              const th = document.getElementById('hk-thread');
              new MutationObserver(() => { const b = th.querySelector('.hk-pending'); if (b) window.__live.push(b.textContent); }).observe(th, { childList: true, characterData: true, subtree: true });
            }''')
            page.fill('#hk-input', 'Jovan is 16 — fix the page that says seventeen')
            page.click('#hk-send')
            time.sleep(0.3)
            asked = page.evaluate('''() => ({
              writer: [...document.querySelectorAll('#hk-thread .hk-writer')].some((b) => /fix the page that says seventeen/.test(b.textContent)),
              empty: !!document.querySelector('#hk-thread .hk-empty'),
            })''')
            checks.append(('the question stands in the thread at once', asked['writer']))
            checks.append(('"Nothing asked yet" is gone', not asked['empty']))
            page.wait_for_function('!document.querySelector("#hk-thread .hk-pending")', timeout=120000, polling=250)
            out = page.evaluate('''() => ({
              said: window.__said,
              answer: [...document.querySelectorAll('#hk-thread .hk-housekeeper')].map((b) => b.textContent).join(' | '),
              status: document.getElementById('hk-status').textContent,
            })''')
            checks.append(('the second round streamed and was named', any('reading what it looked up (round 2)' in s for s in out['said'])))
            live = page.evaluate('window.__live')
            checks.append(('the live answer never shows the wire’s blocks', bool(live) and not any('<fetch>' in t or '</fetch>' in t for t in live)))
            checks.append(('it says it is looking something up instead', any('looking something up' in t for t in live)))
            checks.append(('the watch never cut the live round', not any('went silent' in s for s in out['said'] + [out['status']])))
            checks.append(('the second round\u2019s answer arrived', 'THE-SECOND-ROUND-ANSWER' in out['answer']))
            # --- M271: the housekeeper works on behind a closed sheet, and its history stays ---
            page.evaluate('''() => { window.__toasts = []; const real = window.__cozy.toast; window.__cozy.toast = (w) => { window.__toasts.push(String(w)); return real ? real(w) : undefined; }; }''')
            page.fill('#hk-input', 'SECOND-QUESTION: is Rias at home?')
            page.click('#hk-send')
            time.sleep(1.5)
            page.click('#btn-hk-close')
            time.sleep(0.5)
            checks.append(('closing the sheet leaves it working (the lamp is lit)', page.evaluate("document.getElementById('btn-housekeeper').classList.contains('is-working')")))
            time.sleep(1.5)
            page.click('#btn-housekeeper')
            page.wait_for_selector('#hk-sheet:not([hidden])', timeout=10000)
            time.sleep(0.5)
            mid = page.evaluate('''() => ({
              question: [...document.querySelectorAll('#hk-thread .hk-writer')].some((b) => /SECOND-QUESTION/.test(b.textContent)),
              pending: !!document.querySelector('#hk-thread .hk-pending'),
            })''')
            checks.append(('reopened mid-answer, the question is still there', mid['question']))
            checks.append(('and the answer is still coming', mid['pending']))
            page.click('#btn-hk-close')
            page.wait_for_function("!document.getElementById('btn-housekeeper').classList.contains('is-working')", timeout=120000, polling=250)
            checks.append(('it finished behind the closed sheet and said so', page.evaluate("window.__toasts.some((w) => /housekeeper answered/.test(w))")))
            page.click('#btn-housekeeper')
            page.wait_for_selector('#hk-sheet:not([hidden])', timeout=10000)
            time.sleep(0.5)
            hist = page.evaluate('''() => ({
              writers: [...document.querySelectorAll('#hk-thread .hk-writer')].map((b) => b.textContent).join(' | '),
              answers: [...document.querySelectorAll('#hk-thread .hk-housekeeper')].length,
              pending: !!document.querySelector('#hk-thread .hk-pending'),
            })''')
            checks.append(('the history holds both questions', 'fix the page that says seventeen' in hist['writers'] and 'SECOND-QUESTION' in hist['writers']))
            checks.append(('and both answers, nothing left pending', hist['answers'] >= 2 and not hist['pending']))
            # a reload mid-ask puts the question back in the box
            page.fill('#hk-input', 'THIRD-QUESTION: what did Chloe post?')
            page.click('#hk-send')
            time.sleep(1.0)
            page.reload(wait_until='load')
            open_housekeeper(page)
            time.sleep(0.8)
            back = page.evaluate("({ box: document.getElementById('hk-input').value, status: document.getElementById('hk-status').textContent })")
            checks.append(('after a reload mid-ask, the question is back in the box', 'THIRD-QUESTION' in back['box']))
            checks.append(('and the house says so', 'back in the box' in back['status']))
            checks.append(('no page errors', not errors))
            browser.close()
    finally:
        srv.terminate(); fake.shutdown()
    bad = 0
    for name, ok in checks:
        print(('  ok   — ' if ok else '  FAIL — ') + name)
        bad += 0 if ok else 1
    print('housekeeper rounds: ' + ('all green' if not bad else str(bad) + ' failed'))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
