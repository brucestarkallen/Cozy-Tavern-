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
SCENARIO = os.environ.get('SCENARIO', 'housekeeper')  # or 'story': the storyteller's own stream; 'bigfetch': two big rounds with a look-up
PAGES = int(os.environ.get('PAGES', '150' if os.environ.get('SCENARIO') == 'bigfetch' else '60'))
HISTORY_TURNS = int(os.environ.get('HISTORY_TURNS', '0'))  # past turns already in the session, each with a big thinking
PAGE_WORDS = int(os.environ.get('PAGE_WORDS', '260' if os.environ.get('SCENARIO') == 'bigfetch' else '120'))
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
        second = 'What you asked for, whole' in json.dumps(body.get('messages', []))
        lookup = SCENARIO == 'bigfetch' and not second
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
            if lookup:
                refs = ['%d' % k for k in range(2, 26, 2)] + ['find: kitchen', 'find: the words of', 'find: long page']
                send({'choices': [{'index': 0, 'delta': {'content': ' <fetch>' + json.dumps(refs) + '</fetch>'}}]})
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
            page.evaluate('''async ([fake, pages, words, history]) => {
              const { db } = await import('/js/store.js');
              const conn = await db.connections.add({ label: 'fake', type: 'openai', baseUrl: fake, apiKey: 'x', model: 'fake', contextSize: 300000 });
              await db.settings.set('activeConnectionId', conn.id);
              const st = await db.stories.create({ title: 'perf' });
              await db.stories.update(st.id, { brief: 'A long story. '.repeat(300) });
              for (let i = 0; i < pages; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i + ' in the kitchen ' + 'the words of a long page go on. '.repeat(words) });
              await db.settings.set('activeStoryId', st.id);
              await db.settings.set('welcomeSeen', true); /* a returning writer, past the first-run welcome */
              if (history > 0) {
                const turns = [];
                for (let k = 0; k < history; k += 1) {
                  turns.push({ role: 'writer', text: 'old question ' + k, ts: k });
                  turns.push({ role: 'housekeeper', text: 'old answer ' + k + ' '.padEnd(400, 'a'), ts: k, thinking: ('old thinking ' + k + ' ').repeat(6000), raw: 'raw '.repeat(6000) });
                }
                await db.settings.set('hk:' + st.id, { sessions: [{ id: 1, name: 'Session 1', turns }], activeId: 1, batches: [] });
              }
            }''', [f'http://127.0.0.1:{FAKE}', PAGES, PAGE_WORDS, HISTORY_TURNS])
            page.reload()
            page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000)
            time.sleep(3.0)  # the app's own first drawing of the story is not the housekeeper's
            cdp0 = ctx.new_cdp_session(page)
            cdp0.send('Emulation.setCPUThrottlingRate', {'rate': THROTTLE})
            if os.environ.get('PROFILE_OPEN'):
                cdp0.send('Profiler.enable'); cdp0.send('Profiler.setSamplingInterval', {'interval': 200}); cdp0.send('Profiler.start')
            page.evaluate('''() => { window.__openLong = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__openLong.push(e.duration); }).observe({ type: 'longtask' }); } catch (e) {} }''')
            open_t0 = time.time()
            if SCENARIO in ('housekeeper', 'bigfetch'):
                # the housekeeper wires itself a moment after the chat does: knock until it opens
                for _ in range(40):
                    if page.evaluate("!document.getElementById('hk-sheet').hidden"):
                        break
                    page.click('#btn-housekeeper')
                    time.sleep(0.5)
                page.wait_for_selector('#hk-sheet:not([hidden])', timeout=10000)
            page.wait_for_function("document.querySelectorAll('#hk-thread .hk-bubble').length >= " + str(HISTORY_TURNS * 2), timeout=120000) if HISTORY_TURNS and SCENARIO != 'story' else None
            open_seconds = round(time.time() - open_t0, 2)
            time.sleep(1.0)
            open_long = page.evaluate('window.__openLong.reduce((a, b) => a + b, 0)')
            if os.environ.get('PROFILE_OPEN'):
                prof = cdp0.send('Profiler.stop')['profile']
                nodes = {n['id']: n for n in prof['nodes']}
                self_ms = {}
                deltas = prof.get('timeDeltas', [])
                for sid, dt in zip(prof.get('samples', []), deltas):
                    fn = nodes[sid]['callFrame']
                    key = (fn.get('functionName') or '(anon)') + ' ' + fn.get('url', '').split('/')[-1] + ':' + str(fn.get('lineNumber', 0) + 1)
                    self_ms[key] = self_ms.get(key, 0) + dt / 1000
                top = sorted(self_ms.items(), key=lambda kv: -kv[1])[:14]
                print('OPEN PROFILE (self ms):')
                for k, v in top:
                    print('  %7.1f  %s' % (v, k))
            cdp = cdp0
            page.evaluate('''() => {
              window.__perf = { frames: [], long: [], on: true, t0: performance.now() };
              try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push(e.duration); }).observe({ type: 'longtask' }); } catch (e) {}
              let last = performance.now();
              const loop = (t) => { window.__perf.frames.push(t - last); last = t; if (window.__perf.on) requestAnimationFrame(loop); };
              requestAnimationFrame(loop);
            }''')
            if SCENARIO in ('housekeeper', 'bigfetch'):
                page.fill('#hk-input', 'How is the story going?')
                page.click('#hk-send')
                page.wait_for_selector('#hk-thread .hk-pending', timeout=20000)
                page.wait_for_function('!document.querySelector("#hk-thread .hk-pending")', timeout=600000, polling=500)
            else:
                page.fill('#composer-input', 'I walk into the kitchen.')
                page.evaluate("document.getElementById('composer').requestSubmit()")
                page.wait_for_selector('.msg.pending', timeout=20000)
                page.wait_for_function('!document.querySelector(".msg.pending")', timeout=600000, polling=500)
            stats = page.evaluate('''async () => {
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
                thinking_chars: await (async () => {
                  /* what was kept: the housekeeper's stored turn, or the storyteller's live fold */
                  const { db } = await import('/js/store.js');
                  const sid = await db.settings.get('activeStoryId');
                  const root = await db.settings.get('hk:' + sid);
                  const turns = root && root.sessions ? root.sessions.flatMap((x) => x.turns || []) : [];
                  const last = turns.filter((t) => t.role === 'housekeeper').pop();
                  const kept = last && typeof last.thinking === 'string' ? last.thinking.length : 0;
                  const fold = Math.max(0, ...[...document.querySelectorAll('.thinking-body')].map((n) => n.textContent.length));
                  return Math.max(kept, fold);
                })(),
              };
            }''')
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
            result = {'scenario': SCENARIO, 'history_turns': HISTORY_TURNS, 'open_seconds': open_seconds, 'open_long_task_ms': round(open_long), 'throttle': THROTTLE, 'think_deltas': THINK_DELTAS, 'answer_deltas': ANSWER_DELTAS, **stats, 'page_errors': errors[:3]}
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
