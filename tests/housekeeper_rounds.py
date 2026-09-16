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
                send({'choices': [{'index': 0, 'delta': {'content': 'Let me look. <fetch>["find: seventeen"]</fetch>'}}]})
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
            page.reload()
            page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000)
            for _ in range(40):
                if page.evaluate("!document.getElementById('hk-sheet').hidden"):
                    break
                page.click('#btn-housekeeper'); time.sleep(0.5)
            page.wait_for_selector('#hk-sheet:not([hidden])', timeout=10000)
            time.sleep(0.5)
            page.evaluate('''() => {
              window.__said = [];
              const s = document.getElementById('hk-status');
              new MutationObserver(() => window.__said.push(s.textContent)).observe(s, { childList: true, characterData: true, subtree: true });
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
            checks.append(('the watch never cut the live round', not any('went silent' in s for s in out['said'] + [out['status']])))
            checks.append(('the second round\u2019s answer arrived', 'THE-SECOND-ROUND-ANSWER' in out['answer']))
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
