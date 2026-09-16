"""Housekeeper streaming, measured in a real browser (M269).

A headless Chromium on a phone viewport, CPU slowed 6x (as M145 measured the
drawer), against the real serve.py and a fake model that streams a long
thinking and an answer in small pieces, the way DeepSeek does. While the
housekeeper streams, every animation frame and every long task on the main
thread is recorded.

  python3 tests/perf_housekeeper.py            # prints JSON with the numbers
  THINK_DELTAS=3000 ANSWER_DELTAS=600 GAP=0.003 python3 tests/perf_housekeeper.py

Exit 1 when the budget is broken (see BUDGET below).
"""
import json, os, shutil, subprocess, sys, time, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-perf')
PORT = os.environ.get('COZY_TEST_PORT', '8096')
FAKE = int(os.environ.get('FAKE_PORT', '8199'))
THINK_DELTAS = int(os.environ.get('THINK_DELTAS', '3000'))
ANSWER_DELTAS = int(os.environ.get('ANSWER_DELTAS', '600'))
GAP = float(os.environ.get('GAP', '0.003'))
THROTTLE = float(os.environ.get('THROTTLE', '6'))
SCENARIO = os.environ.get('SCENARIO', 'housekeeper')  # or 'story': the storyteller's own stream
# the budget: at a 6x throttle, no frame may stall the screen
BUDGET = {'worst_frame_ms': 250, 'long_task_total_ms': 3000}


class Fake(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        out = b'{"data":[{"id":"fake"}]}'
        self.send_response(200)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_POST(self):
        n = int(self.headers.get('Content-Length', '0'))
        body = json.loads(self.rfile.read(n) or b'{}')
        answer = ' '.join('word%04d' % i for i in range(ANSWER_DELTAS))
        if not body.get('stream'):
            out = json.dumps({'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': answer}, 'finish_reason': 'stop'}]}).encode()
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(out)))
            self.end_headers()
            self.wfile.write(out)
            return
        self.send_response(200)
        self._cors()
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'close')
        self.end_headers()

        def send(obj):
            self.wfile.write(('data: ' + json.dumps(obj) + '\n\n').encode())
            self.wfile.flush()
        try:
            for i in range(THINK_DELTAS):
                send({'choices': [{'index': 0, 'delta': {'reasoning_content': 'thinking step %05d, weighing it. ' % i}}]})
                time.sleep(GAP)
            for i in range(ANSWER_DELTAS):
                send({'choices': [{'index': 0, 'delta': {'content': 'word%04d ' % i}}]})
                time.sleep(GAP)
            send({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]})
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True


class Threaded(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def main():
    fake = Threaded(('127.0.0.1', FAKE), Fake)
    threading.Thread(target=fake.serve_forever, daemon=True).start()
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA, exist_ok=True)
    env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
    srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=REPO)
    result = {}
    try:
        time.sleep(1.5)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            # no service worker: its update reload is not what this measures, and it would reload mid-test
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{PORT}/')
            page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000)
            page.evaluate('''async (fake) => {
              const { db } = await import('/js/store.js');
              const conn = await db.connections.add({ label: 'fake', type: 'openai', baseUrl: fake, apiKey: 'x', model: 'fake', contextSize: 300000 });
              await db.settings.set('activeConnectionId', conn.id);
              const st = await db.stories.create({ title: 'perf' });
              await db.stories.update(st.id, { brief: 'A long story. '.repeat(300) });
              for (let i = 0; i < 60; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i + ' ' + 'the words of a long page go on. '.repeat(120) });
              await db.settings.set('activeStoryId', st.id);
              await db.settings.set('welcomeSeen', true); /* a returning writer, past the first-run welcome */
            }''', f'http://127.0.0.1:{FAKE}')
            page.reload()
            page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000)
            if SCENARIO == 'housekeeper':
                # the housekeeper wires itself a moment after the chat does: knock until it opens
                for _ in range(40):
                    if page.evaluate("!document.getElementById('hk-sheet').hidden"):
                        break
                    page.click('#btn-housekeeper')
                    time.sleep(0.5)
                page.wait_for_selector('#hk-sheet:not([hidden])', timeout=10000)
            time.sleep(1.0)
            cdp = ctx.new_cdp_session(page)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': THROTTLE})
            page.evaluate('''() => {
              window.__perf = { frames: [], long: [], on: true, t0: performance.now() };
              try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push(e.duration); }).observe({ type: 'longtask' }); } catch (e) {}
              let last = performance.now();
              const loop = (t) => { window.__perf.frames.push(t - last); last = t; if (window.__perf.on) requestAnimationFrame(loop); };
              requestAnimationFrame(loop);
            }''')
            if SCENARIO == 'housekeeper':
                page.fill('#hk-input', 'How is the story going?')
                page.click('#hk-send')
                page.wait_for_selector('#hk-thread .hk-pending', timeout=20000)
                page.wait_for_function('!document.querySelector("#hk-thread .hk-pending")', timeout=600000, polling=500)
            else:
                page.fill('#composer-input', 'I walk into the kitchen.')
                page.evaluate("document.getElementById('composer').requestSubmit()")
                page.wait_for_selector('.msg.pending', timeout=20000)
                page.wait_for_function('!document.querySelector(".msg.pending")', timeout=600000, polling=500)
            stats = page.evaluate('''() => {
              window.__perf.on = false;
              const f = window.__perf.frames.slice(2);
              const sorted = f.slice().sort((a, b) => a - b);
              const pct = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
              return {
                seconds: Math.round((performance.now() - window.__perf.t0) / 100) / 10,
                frames: f.length,
                worst_frame_ms: Math.round(sorted[sorted.length - 1] || 0),
                p95_frame_ms: Math.round(pct(0.95)),
                frames_over_100ms: f.filter((x) => x > 100).length,
                long_tasks: window.__perf.long.length,
                long_task_total_ms: Math.round(window.__perf.long.reduce((a, b) => a + b, 0)),
                thinking_chars: Math.max(...[...document.querySelectorAll('#hk-thread .hk-thinking, .thinking-body')].map((n) => n.textContent.length), 0),
              };
            }''')
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
            result = {'scenario': SCENARIO, 'throttle': THROTTLE, 'think_deltas': THINK_DELTAS, 'answer_deltas': ANSWER_DELTAS, **stats, 'page_errors': errors[:3]}
            browser.close()
    finally:
        srv.terminate()
        fake.shutdown()
    print(json.dumps(result, indent=1))
    ok = result.get('worst_frame_ms', 1e9) <= BUDGET['worst_frame_ms'] and result.get('long_task_total_ms', 1e9) <= BUDGET['long_task_total_ms'] and not result.get('page_errors')
    print(SCENARIO + ' streaming: ' + ('within budget' if ok else 'OVER BUDGET ' + json.dumps(BUDGET)))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
