"""The SEND, measured in a real browser (M507).

He: "after 80k tokens Cozy Tavern lags every time I press send". A headless Chromium on a phone viewport, CPU slowed
6x (M145's measure of his phone), against the real serve.py and a fake model, with a tale of PAGES pages (~100k tokens
on the wire when the keeper is off) and a ledger shaped like his (forty people with pages, seats, knowledge, threads,
standings, wounds, a journal near its cap, a checkpoint per turn). Then: press send, and time three moments from the
press — his page on the screen, the storyteller's request leaving the browser, the first word of the answer painted —
with every long task on the main thread in between and a CPU profile of the whole send.

  python3 tests/perf_send.py                       # prints JSON with the numbers; exit 1 past BUDGET
  PAGES=160 WORDS=450 KEEPER=0 python3 tests/perf_send.py
  PROFILE=1 python3 tests/perf_send.py             # and the top self-time functions of the send
"""
import json, os, shutil, subprocess, sys, time, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-perf-send')
PORT = os.environ.get('COZY_TEST_PORT', '8097')
FAKE = int(os.environ.get('FAKE_PORT', '8198'))
PAGES = int(os.environ.get('PAGES', '160'))
WORDS = int(os.environ.get('WORDS', '450'))
KEEPER = os.environ.get('KEEPER', '0') == '1'
THROTTLE = float(os.environ.get('THROTTLE', '6'))
PROFILE = os.environ.get('PROFILE') == '1'
# the budget at a 6x throttle: his page within a blink, the request out within two seconds, the screen never frozen
BUDGET = {'user_page_ms': 400, 'request_ms': 2500, 'worst_long_task_ms': 1000}


class Fake(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    got = []

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
        raw = self.rfile.read(n) or b'{}'
        body = json.loads(raw)
        Fake.got.append({'at': time.time(), 'bytes': n, 'stream': bool(body.get('stream')), 'messages': len(body.get('messages') or [])})
        sysm = ' '.join(m.get('content', '') for m in (body.get('messages') or []) if m.get('role') == 'system')
        worker = 'You are telling a story' not in sysm
        if not body.get('stream'):
            answer = '{"check":false}' if 'referee' in sysm.lower() else '{"mutations":[],"brief":{"pressure":[],"ripe":[],"twb":null},"deltas":[],"findings":[],"issues":[]}'
            out = json.dumps({'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': answer}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': n // 4, 'completion_tokens': 20}}).encode()
            self.send_response(200); self._cors(); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(out))); self.end_headers(); self.wfile.write(out)
            return
        self.send_response(200); self._cors(); self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache'); self.send_header('Connection', 'close'); self.end_headers()

        def send(obj):
            self.wfile.write(('data: ' + json.dumps(obj) + '\n\n').encode()); self.wfile.flush()
        try:
            if worker:
                send({'choices': [{'index': 0, 'delta': {'content': '{"mutations":[],"brief":{"pressure":[],"ripe":[],"twb":null},"deltas":[],"findings":[],"issues":[]}'}}]})
            else:
                head = '[The kitchen — Monday, March 3, 2025 | 09:05 | clear | apron | by the stove]\n\n'
                send({'choices': [{'index': 0, 'delta': {'content': head}}]})
                for i in range(120):
                    send({'choices': [{'index': 0, 'delta': {'content': 'word%04d ' % i}}]})
                    time.sleep(0.004)
            send({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]})
            self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True


class Threaded(ThreadingMixIn, HTTPServer):
    daemon_threads = True


SEED = '''async ([fake, pages, words, keeper]) => {
  const { db } = await import('/js/store.js');
  const { applyMutations } = await import('/js/engine/apply.js');
  const { saveState, emptyState, snapshotState, markPageRead } = await import('/js/engine/state.js');
  const conn = await db.connections.add({ label: 'fake', type: 'openai', baseUrl: fake, apiKey: 'x', model: 'fake', contextSize: 500000, maxTokens: 30000 });
  await db.settings.set('activeConnectionId', conn.id);
  await db.settings.set('memoryKeeper', keeper);
  await db.settings.set('welcomeSeen', true);
  const st = await db.stories.create({ title: 'perf send' });
  await db.stories.update(st.id, { brief: 'A long story in a great house. '.repeat(120), castNotes: Array.from({ length: 30 }, (_, i) => 'Person' + i + ' — a member of the household with a life of their own.').join('\\n') });
  const firsts = ['Mara', 'Tobin', 'Elise', 'Rowan', 'Sable', 'Idris', 'Wren', 'Corin', 'Nell', 'Havel', 'Juno', 'Piers', 'Tamsin', 'Ludo', 'Orla', 'Bastian', 'Ines', 'Kestrel', 'Dorian', 'Maud'];
  const lasts = ['Vell', 'Ashcombe', 'Draper', 'Holloway', 'Pike', 'Marlowe', 'Crane', 'Fenwick', 'Stroud', 'Ballard', 'Quill', 'Harrow', 'Ives', 'Lockett', 'Penrose', 'Ryder', 'Thorne', 'Wexley', 'Yates', 'Ambrose'];
  const names = Array.from({ length: 40 }, (_, i) => firsts[i % 20] + ' ' + lasts[(i * 7 + Math.floor(i / 20)) % 20]);
  const places = ['the kitchen', 'the great hall', 'the garden', 'the library', 'the stables', 'the west wing'];
  let state = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: places[0] }, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 9, minute: 5 }, { type: 'presence.enter', name: 'Jovan', position: 'by the door' }]).state;
  const body = (i) => 'page ' + i + ' in ' + places[i % places.length] + '. ' + names[i % 40] + ' spoke to Jovan about the day. ' + ('the words of a long page go on and on, with names and hours and things carried and said. ').repeat(Math.max(1, Math.floor(words / 16)));
  let k = 0;
  for (let i = 0; i < pages; i += 1) {
    const role = i % 2 ? 'assistant' : 'user';
    const text = role === 'assistant' ? '[' + places[i % places.length] + ' — Monday, March 3, 2025 | ' + String(9 + Math.floor(i / 12)).padStart(2, '0') + ':' + String((i * 5) % 60).padStart(2, '0') + ' | clear | coat | by the door]\\n\\n' + body(i) : body(i);
    const saved = await db.messages.append(st.id, { role, text });
    /* the app's stamp: state.page is the index of the coming page (send), the boundary is taken then, the readers write under it */
    state.page = k;
    if (role === 'user') { await snapshotState(st.id, saved.id, state); continue; }
    /* the page's reads, the way the readers write them: a person in, a person seated, a fact, a thread, a wound, a standing */
    const who = names[i % 40]; const other = names[(i + 7) % 40];
    const muts = [
      { type: 'place.set', name: places[i % places.length] },
      { type: 'presence.enter', name: who, position: 'by the window' },
      { type: 'people.set', name: who, field: 'core', text: who + ' is a member of the household who keeps to their own affairs and speaks plainly.' },
      { type: 'people.set', name: who, field: 'state', text: 'By the window, telling Jovan about the day.' },
      { type: 'people.set', name: who, field: 'arc', text: 'Warming to Jovan by degrees.' },
      { type: 'offscreen.set', name: other, location: places[(i + 3) % places.length], activity: 'going about their day', stance: 'busy', agenda: 'find Jovan before evening' },
      { type: 'knowledge.add', name: who, fact: 'Jovan was in ' + places[i % places.length] + ' on page ' + i },
      { type: 'thread.set', title: 'What ' + who + ' wants on page ' + i, owner: who, next: 'ask Jovan at supper' },
      { type: 'rel.shift', name: who, axis: 'r', delta: 1, cause: 'a kind word at the window' },
      ...(i % 10 === 5 ? [{ type: 'body.injure', name: who, part: 'left hand', severity: 'minor', what: 'a scrape from the door' }] : []),
      ...(i % 6 === 3 ? [{ type: 'presence.leave', name: names[(i + 2) % 40] }] : []),
      { type: 'clock.advance', minutes: 5 },
    ];
    state = applyMutations(state, muts).state;
    markPageRead(state, k); k += 1;
    await saveState(st.id, state);
  }
  await db.settings.set('activeStoryId', st.id);
  return { pages, people: Object.keys(state.characters).length, seats: Object.keys(state.offscreen).length, journal: (state.journal || []).length, log: (state.log || []).length, knowledge: Object.values(state.knowledge || {}).reduce((a, b) => a + (Array.isArray(b) ? b.length : (b && b.facts ? b.facts.length : 0)), 0), threads: (state.threads || []).length };
}'''

WATCH = '''() => {
  window.__send = { t0: null, userPage: null, request: null, firstToken: null, long: [], frames: [] };
  const mo = new MutationObserver(() => {
    if (window.__send.t0 === null) return;
    if (window.__send.userPage === null && document.querySelector('.msg-user[data-id]') && [...document.querySelectorAll('.msg-user')].some((n) => /PERF-SEND-MARK/.test(n.textContent))) window.__send.userPage = performance.now() - window.__send.t0;
    if (window.__send.firstToken === null) { const p = document.querySelector('.msg.pending .msg-body, .msg.streaming .msg-body'); if (p && /word0000/.test(p.textContent)) window.__send.firstToken = performance.now() - window.__send.t0; }
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  const realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    try {
      const body = opts && typeof opts.body === 'string' ? opts.body : '';
      if (window.__send.t0 !== null && window.__send.request === null && /PERF-SEND-MARK/.test(body) && /You are telling a story/.test(body)) { window.__send.request = performance.now() - window.__send.t0; window.__send.body = body; }
    } catch (e) {}
    return realFetch(url, opts);
  };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__send.long.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask' }); } catch (e) {}
  /* every IndexedDB request during the send: which store, how long from request to answer */
  window.__send.idb = [];
  const wrap = (proto, name) => { const real = proto[name]; if (!real) return; proto[name] = function (...args) { const req = real.apply(this, args); const t = performance.now(); const store = this.objectStore ? this.objectStore.name + '.' + this.name : this.name; req.addEventListener('success', () => { if (window.__send.t0 !== null) window.__send.idb.push({ at: t - window.__send.t0, ms: performance.now() - t, op: name, store, n: Array.isArray(req.result) ? req.result.length : 1 }); }); return req; }; };
  for (const n of ['get', 'getAll', 'getAllKeys', 'put', 'add', 'delete', 'count', 'openCursor']) wrap(IDBObjectStore.prototype, n);
  for (const n of ['get', 'getAll', 'getAllKeys', 'count', 'openCursor']) wrap(IDBIndex.prototype, n);
  /* how many regular expressions are compiled and how many structured clones made during the send */
  window.__send.regexps = 0; window.__send.regexpMs = 0; window.__send.clones = 0; window.__send.cloneMs = 0;
  const RealRegExp = window.RegExp;
  window.__send.regexpBy = {};
  const Wrapped = function (...args) { const a = performance.now(); const r = new RealRegExp(...args); if (window.__send.t0 !== null) { window.__send.regexps += 1; window.__send.regexpMs += performance.now() - a; const k = String(args[0]).slice(0, 28); window.__send.regexpBy[k] = (window.__send.regexpBy[k] || 0) + 1; } return r; };
  Wrapped.prototype = RealRegExp.prototype; Object.setPrototypeOf(Wrapped, RealRegExp);
  window.RegExp = Wrapped;
  const realClone = window.structuredClone;
  window.structuredClone = function (v, o) { const a = performance.now(); const r = realClone(v, o); if (window.__send.t0 !== null) { window.__send.clones += 1; window.__send.cloneMs += performance.now() - a; } return r; };
  let last = performance.now();
  const loop = (t) => { window.__send.frames.push(t - last); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}'''


def main():
    fake = Threaded(('127.0.0.1', FAKE), Fake)
    threading.Thread(target=fake.serve_forever, daemon=True).start()
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA, exist_ok=True)
    env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
    srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=REPO)
    result = {}
    try:
        time.sleep(1.5)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block')
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{PORT}/')
            page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000)
            seeded = page.evaluate(SEED, [f'http://127.0.0.1:{FAKE}', PAGES, WORDS, KEEPER])
            time.sleep(25.0)  # the whole book's push lands (twenty seconds after the last write) before the page is reloaded
            page.reload()
            page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000)
            page.wait_for_selector('.msg-assistant', timeout=60000)
            # the opening's own work (the mend of the pages, the heals) is not the send's
            page.wait_for_function('!window.__cozy.chat.isBusy()', timeout=60000)
            time.sleep(6.0)
            cdp = ctx.new_cdp_session(page)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': THROTTLE})
            page.evaluate(WATCH)
            page.evaluate('''async () => { const { db } = await import('/js/store.js'); const real = db.settings.get.bind(db.settings); window.__send.gets = {}; window.__send.sets = {}; const realSet = db.settings.set.bind(db.settings); db.settings.set = async (key, val) => { const a = performance.now(); const r = await realSet(key, val); if (window.__send.t0 !== null && window.__send.request === null) { const k = String(key).replace(/:[^:]*$/, ':*').replace(/^snap:[^:]*/, 'snap:*'); const e = window.__send.sets[k] = window.__send.sets[k] || { n: 0, ms: 0, bytes: 0 }; e.n += 1; e.ms += performance.now() - a; try { e.bytes += JSON.stringify(val).length; } catch (x) {} } return r; };
window.__send.stateCallers = {}; db.settings.get = async (key) => { const a = performance.now(); if (window.__send.t0 !== null && /^state:/.test(key) && window.__send.request === null) { const st = String(new Error().stack).split(String.fromCharCode(10)).slice(2, 6).map((l) => l.trim().replace(/^at /, '').replace(/https?:[^ )]*[/]/, '').replace(/[()]/g, '')).join(' < '); window.__send.stateCallers[st] = (window.__send.stateCallers[st] || 0) + 1; } const r = await real(key); if (window.__send.t0 !== null) { const k = String(key).replace(/:[^:]*$/, ':*').replace(/^snap:[^:]*/, 'snap:*'); const e = window.__send.gets[k] = window.__send.gets[k] || { n: 0, ms: 0 }; e.n += 1; e.ms += performance.now() - a; } return r; }; }''')
            if PROFILE:
                cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': 250}); cdp.send('Profiler.start')
            page.fill('#composer-input', 'I walk into the kitchen. PERF-SEND-MARK')
            page.evaluate("window.__send.t0 = performance.now(); document.getElementById('composer').requestSubmit()")
            page.wait_for_function('window.__send.request !== null', timeout=120000, polling=50)
            top_before = []
            if PROFILE:
                # the profile of the press-to-request stretch alone
                prof = cdp.send('Profiler.stop')['profile']
                nodes = {n['id']: n for n in prof['nodes']}
                self_ms = {}
                for sid, dt in zip(prof.get('samples', []), prof.get('timeDeltas', [])):
                    fn = nodes[sid]['callFrame']
                    key = (fn.get('functionName') or '(anon)') + ' ' + fn.get('url', '').split('/')[-1] + ':' + str(fn.get('lineNumber', 0) + 1)
                    self_ms[key] = self_ms.get(key, 0) + dt / 1000
                top_before = [(round(v), k) for k, v in sorted(self_ms.items(), key=lambda kv: -kv[1])[:25]]
                cdp.send('Profiler.start')
            page.wait_for_selector('.msg.pending, .msg.streaming', timeout=60000)
            page.wait_for_function('!document.querySelector(".msg.pending") && !document.querySelector(".msg.streaming")', timeout=300000, polling=200)
            done_ms = page.evaluate('performance.now() - window.__send.t0')
            top = []
            if PROFILE:
                prof = cdp.send('Profiler.stop')['profile']
                nodes = {n['id']: n for n in prof['nodes']}
                self_ms = {}
                for sid, dt in zip(prof.get('samples', []), prof.get('timeDeltas', [])):
                    fn = nodes[sid]['callFrame']
                    key = (fn.get('functionName') or '(anon)') + ' ' + fn.get('url', '').split('/')[-1] + ':' + str(fn.get('lineNumber', 0) + 1)
                    self_ms[key] = self_ms.get(key, 0) + dt / 1000
                top = [(round(v), k) for k, v in sorted(self_ms.items(), key=lambda kv: -kv[1])[:25]]
            stats = page.evaluate('''() => {
              const s = window.__send;
              const upTo = (t) => s.long.filter((e) => e.at - s.t0 <= t);
              const f = s.frames.slice(2).sort((a, b) => a - b);
              return { user_page_ms: Math.round(s.userPage), request_ms: Math.round(s.request), first_token_ms: Math.round(s.firstToken),
                long_tasks_before_request: upTo(s.request).length, long_ms_before_request: Math.round(upTo(s.request).reduce((a, e) => a + e.ms, 0)),
                worst_long_task_ms: Math.round(Math.max(0, ...s.long.map((e) => e.ms))), long_tasks_total: s.long.length, long_ms_total: Math.round(s.long.reduce((a, e) => a + e.ms, 0)),
                worst_frame_ms: Math.round(f[f.length - 1] || 0), frames: f.length };
            }''')
            phases = {}
            if os.environ.get('PHASES') == '1':
                phases = page.evaluate('''async () => {
                  const { db } = await import('/js/store.js');
                  const { loadState, loadSnapshots, snapshotState } = await import('/js/engine/state.js');
                  const { keepSent, newSentId } = await import('/js/sent.js');
                  const sid = await db.settings.get('activeStoryId');
                  const t = async (name, fn) => { const a = performance.now(); const r = await fn(); return [name, Math.round(performance.now() - a), r]; };
                  const out = [];
                  out.push(await t('messages.list #1', async () => (await db.messages.list(sid)).length));
                  out.push(await t('messages.list #2', async () => (await db.messages.list(sid)).length));
                  out.push(await t('loadState', async () => Object.keys((await loadState(sid)).characters).length));
                  const st = await loadState(sid);
                  out.push(await t('deep copy state', async () => JSON.stringify(st).length));
                  out.push(await t('loadSnapshots', async () => (await loadSnapshots(sid)).length));
                  out.push(await t('snapshotState (one more)', async () => { await snapshotState(sid, 'probe-' + Date.now(), st); return 1; }));
                  out.push(await t('keepSent (the body)', async () => keepSent({ id: newSentId(), storyId: sid, slots: [], requests: [{ url: 'x', body: JSON.parse(window.__send.body) }] })));
                  out.push(await t('JSON.stringify body', async () => JSON.stringify(JSON.parse(window.__send.body)).length));
                  const idb = window.__send.idb; const req = window.__send.request;
                  const sum = (list) => { const by = {}; for (const e of list) { const k = e.store + ':' + e.op; by[k] = by[k] || { n: 0, ms: 0, rows: 0 }; by[k].n += 1; by[k].ms += e.ms; by[k].rows += e.n; } return Object.entries(by).map(([k, v]) => [k, v.n, Math.round(v.ms), v.rows]).sort((a, b) => b[2] - a[2]); };
                  const gets = window.__send.gets || {};
                  return { set_top: Object.entries(window.__send.sets || {}).map(([k, v]) => [k, v.n, Math.round(v.ms), v.bytes]).sort((a, b) => b[2] - a[2]).slice(0, 10), state_callers: Object.entries(window.__send.stateCallers || {}).sort((a, b) => b[1] - a[1]).slice(0, 20), regexp_top: Object.entries(window.__send.regexpBy).sort((a, b) => b[1] - a[1]).slice(0, 12), get_top: Object.entries(gets).map(([k, v]) => [k, v.n, Math.round(v.ms)]).sort((a, b) => b[2] - a[2]).slice(0, 12), regexps: window.__send.regexps, regexp_ms: Math.round(window.__send.regexpMs), clones: window.__send.clones, clone_ms: Math.round(window.__send.cloneMs), phases: out, idb_before_request: sum(idb.filter((e) => e.at <= req)), idb_after_request: sum(idb.filter((e) => e.at > req)).slice(0, 12), long_tasks: window.__send.long.map((e) => [Math.round(e.at - window.__send.t0), Math.round(e.ms)]) };
                }''')
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
            story_calls = [g for g in Fake.got if g['stream'] and g['messages'] > 3]
            result = {'pages': PAGES, 'words': WORDS, 'keeper': KEEPER, 'throttle': THROTTLE, 'seeded': seeded, **stats, 'done_ms': round(done_ms),
                      'request_bytes': story_calls[0]['bytes'] if story_calls else None, 'request_tokens_est': (story_calls[0]['bytes'] // 4) if story_calls else None, 'page_errors': errors[:3]}
            if PROFILE:
                result['profile_top_self_ms'] = top
                result['profile_before_request_ms'] = top_before
            if phases:
                result.update(phases)
            browser.close()
    finally:
        srv.terminate()
        fake.shutdown()
    print(json.dumps(result, indent=1))
    ok = result.get('user_page_ms', 1e9) <= BUDGET['user_page_ms'] and result.get('request_ms', 1e9) <= BUDGET['request_ms'] and result.get('worst_long_task_ms', 1e9) <= BUDGET['worst_long_task_ms'] and not result.get('page_errors')
    print('the send: ' + ('within budget' if ok else 'OVER BUDGET ' + json.dumps(BUDGET)))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
