#!/usr/bin/env python3
"""M678: WHAT THE MOVING MAP COSTS — measured in a real Chromium on a phone screen, CPU slowed 6x.

The academy's map walks (footprints), flickers (lamps) and drifts (mist). The law (css/academy.css): only opacity and
transform move, on small elements of their own, so the browser runs them on the compositor and the page's own thread
paints nothing for them; while a story is open nothing on the map moves. This holds the coat to that, against the
house's own coat (Lamplight) on the same story:

  1. IDLE — four seconds of doing nothing, traced: the main thread's paints, style and layout passes and its total busy
     time. The academy may not ask the main thread for a frame of its own: its paints and style passes stay within a
     handful of the plain coat's, on the welcome screen and in a story.
  2. SCROLL — the story scrolled through by touch-sized steps, every frame timed, the two coats taken in turn for four
     rounds in one page: the median frame and the slow (95th) frame against Lamplight's.
  3. THE STATE — opening a story stills the map (<html data-thread="story">, app.js), going back to the welcome brings
     it back to life, and with reduced motion asked for nothing runs at all.

  python3 tests/perf_academy.py
Exit 1 when a budget is broken or the page throws.
"""
import json, os, shutil, subprocess, sys, time
import ast
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-perf-academy'
PORT = os.environ.get('COZY_TEST_PORT', '8168')
BASE = 'http://127.0.0.1:%s/' % PORT
THROTTLE = float(os.environ.get('THROTTLE', '6'))
_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'paint_coats.py')).read()
SEED = next(n.value.value for n in ast.parse(_src).body if isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') == 'SEED')

CATS = ['devtools.timeline', 'disabled-by-default-devtools.timeline']


def main_thread_cost(trace_bytes):
    data = json.loads(trace_bytes)
    events = data['traceEvents'] if isinstance(data, dict) else data
    mains = {(e['pid'], e['tid']) for e in events if e.get('ph') == 'M' and e.get('name') == 'thread_name' and e.get('args', {}).get('name') == 'CrRendererMain'}
    counts = {'Paint': 0, 'UpdateLayoutTree': 0, 'Layout': 0}
    busy = 0.0
    for e in events:
        if (e.get('pid'), e.get('tid')) not in mains:
            continue
        n = e.get('name')
        if n in counts and e.get('ph') in ('X', 'B'):
            counts[n] += 1
        if n == 'RunTask' and e.get('ph') == 'X':
            busy += e.get('dur', 0) / 1000.0
    return counts, round(busy, 1)


SCROLL = """async () => {
  const t = document.getElementById('thread'); t.scrollTop = t.scrollHeight;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const times = []; let last = performance.now();
  for (let i = 0; i < 120; i += 1) {
    t.scrollTop -= 45; if (t.scrollTop <= 0) t.scrollTop = t.scrollHeight;
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now(); times.push(now - last); last = now;
  }
  times.sort((a, b) => a - b);
  return [times[60], times[114]];
}"""


def boot(b, reduced=False):
    ctx = b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        service_workers='block', reduced_motion='reduce' if reduced else 'no-preference')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE, wait_until='load')
    page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=30000)
    page.evaluate("""async () => { const { db } = await import('/js/store.js');
      if (!(await db.settings.get('activeConnectionId'))) {
        const conn = await db.connections.add({ label: 'The house choice', type: 'openai', baseUrl: 'https://x.example/v1', apiKey: 'k', model: 'deepseek-chat' });
        await db.settings.set('activeConnectionId', conn.id); }
      await db.settings.set('welcomeSeen', true); await db.settings.set('theme', 'academy'); }""")
    page.reload(wait_until='load')
    page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=30000)
    page.wait_for_timeout(2500)
    cdp = ctx.new_cdp_session(page)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': THROTTLE})
    return ctx, page, errors


def coat(page, c):
    page.evaluate("(c) => { document.documentElement.dataset.theme = c; }", c)
    page.wait_for_timeout(1500)


def idle(b, page):
    b.start_tracing(page=page, categories=CATS)
    page.wait_for_timeout(4000)
    return main_thread_cost(b.stop_tracing())


def running(page):
    return page.evaluate("() => document.getAnimations().filter((a) => a.playState === 'running').length")


def measure(p):
    b = p.chromium.launch(args=['--no-sandbox'])
    out = {'lamplight': {}, 'academy': {}, 'academy_reduced_motion': {}}
    ctx, page, errors = boot(b)
    page.wait_for_function("document.documentElement.dataset.thread === 'welcome' && !!document.querySelector('#thread > .hearth')", timeout=15000)
    for c, key in (('dark', 'lamplight'), ('academy', 'academy')):
        coat(page, c)
        out[key]['running_animations_welcome'] = running(page)
        out[key]['welcome'] = idle(b, page)
    # a story opened: the thread says so, and the map stands still
    page.evaluate(SEED.replace("await db.settings.set('welcomeSeen', true);", "await db.settings.set('welcomeSeen', true); await db.settings.set('theme', 'academy');"))
    page.wait_for_function("document.documentElement.dataset.thread === 'story'", timeout=15000)
    page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = t.scrollHeight; }")
    for c, key in (('dark', 'lamplight'), ('academy', 'academy')):
        coat(page, c)
        out[key]['running_animations_story'] = running(page)
        out[key]['story_idle'] = idle(b, page)
    # scrolling: the two coats taken in turn, four rounds, in the same page (a single run is noise on a busy machine)
    rounds = {'lamplight': [], 'academy': []}
    for _ in range(4):
        for c, key in (('dark', 'lamplight'), ('academy', 'academy')):
            coat(page, c)
            rounds[key].append(page.evaluate(SCROLL))
    for key, rs in rounds.items():
        meds = sorted(r[0] for r in rs)
        p95s = sorted(r[1] for r in rs)
        out[key]['scroll'] = {'median': round((meds[1] + meds[2]) / 2, 1), 'p95': round((p95s[1] + p95s[2]) / 2, 1), 'rounds': [[round(x, 1) for x in r] for r in rs]}
    # back to a welcome: the last page gone, the thread says so and the map moves again
    page.evaluate("async () => { window.__cozy.setActiveStoryId(null); await window.__cozy.chat.renderThread({ structural: true, opening: true }); }")
    page.wait_for_timeout(800)
    out['academy']['back_to_welcome'] = page.evaluate("() => ({ thread: document.documentElement.dataset.thread, hearth: !!document.querySelector('#thread > .hearth'), running: document.getAnimations().filter((a) => a.playState === 'running').length })")
    out['errors'] = list(errors)
    ctx.close()
    ctx, page, errors = boot(b, reduced=True)
    out['academy_reduced_motion']['running_animations_welcome'] = running(page)
    out['academy_reduced_motion']['welcome'] = idle(b, page)
    out['errors'] += errors
    ctx.close()
    b.close()
    return out


def main():
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA, exist_ok=True)
    srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], cwd=REPO, env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    fails = []
    try:
        with sync_playwright() as p:
            out = measure(p)
    finally:
        srv.terminate()
    print(json.dumps(out, indent=1))
    plain, academy, still = out['lamplight'], out['academy'], out['academy_reduced_motion']
    for room in ('welcome', 'story_idle'):
        (pc, pb), (ac, ab) = plain[room], academy[room]
        for k in ('Paint', 'UpdateLayoutTree', 'Layout'):
            if ac[k] > pc[k] + 6:
                fails.append('%s: %d main-thread %s passes in 4 s (Lamplight %d)' % (room, ac[k], k, pc[k]))
        if ab > pb + 120:
            fails.append('%s: main thread busy %.0f ms in 4 s (Lamplight %.0f)' % (room, ab, pb))
    if academy['running_animations_welcome'] < 10:
        fails.append('the map does not move on the welcome screen (%d animations running)' % academy['running_animations_welcome'])
    if academy['running_animations_story'] > plain['running_animations_story']:
        fails.append('the map still moves while a story is open (%d animations running; Lamplight %d)' % (academy['running_animations_story'], plain['running_animations_story']))
    back = academy['back_to_welcome']
    if back['thread'] != 'welcome' or not back['hearth'] or back['running'] < 10:
        fails.append('back on the welcome, the map did not come back to life: %r' % back)
    if still['running_animations_welcome'] > 0:
        fails.append('reduced motion asked for, yet %d animations still run' % still['running_animations_welcome'])
    if academy['scroll']['median'] > plain['scroll']['median'] * 1.1 + 1 or academy['scroll']['p95'] > plain['scroll']['p95'] * 1.2 + 3:
        fails.append('scrolling slower than Lamplight: %r vs %r' % (academy['scroll'], plain['scroll']))
    if out['errors']:
        fails.append('the page threw: %r' % out['errors'][:3])
    print('\n'.join(['FAILED: ' + f for f in fails]) if fails else 'the moving map costs the page nothing it can feel')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
