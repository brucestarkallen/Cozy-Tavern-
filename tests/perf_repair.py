#!/usr/bin/env python3
"""M675: THE STORED-PAGE REPAIR NEVER HOLDS THE SCREEN (the audit: 2.3 ms a page, all of it in one turn).

The first time a tale is opened on a new build the house looks over every kept page once (the finisher's own repair,
chat.js mendAllPages). It did that in one go: measured on the build before, a tale of 1,000 turns held the screen for
1,242 ms the moment it was opened — nothing scrolled, no tap landed. It works in short turns now.

A headless Chromium on a phone viewport against the real serve.py; a tale of TURNS turns is written straight into the
store and opened; every long task on the main thread and every gap between two animation frames is recorded until the
repair has left its mark.

  python3 tests/perf_repair.py                 # prints JSON with the numbers; exits 1 when the budget is broken
  TURNS=3000 THROTTLE=4 python3 tests/perf_repair.py
  COZY_TEST_REPO=/path/to/another/build python3 tests/perf_repair.py
"""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

REPO = os.environ.get('COZY_TEST_REPO') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = os.environ.get('COZY_TEST_PORT', '8152')
TURNS = int(os.environ.get('TURNS', '1000'))
THROTTLE = float(os.environ.get('THROTTLE', '1'))
BASE = 'http://127.0.0.1:%s/' % PORT
# the budget, at this machine's own speed: no single hold of the screen past a quarter of a second (it was 1,242 ms; it is 57)
BUDGET = {'longest_task_ms': 250, 'worst_frame_gap_ms': 300}

SEED = """async (n) => { const { db } = await import('/js/store.js');
  const st = await db.stories.create({ title: 'a long tale' });
  const para = 'The rain kept on over the yard and the lamps along the wall burned low while Rukia crossed to the gate and Renji waited there with nothing to say. ';
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    rows.push({ role: 'user', text: 'I wait a while longer, number ' + i + '.', ts: 1000 + i * 2 });
    rows.push({ role: 'assistant', text: '[The yard — Monday, June 2, 2025 | 08:' + String(i % 60).padStart(2, '0') + ' | rain | coat | standing]\\n\\n' + para.repeat(6) + '\\n\\n"' + para.trim() + '" she said. ' + i + '\\n\\n' + para.repeat(4), ts: 1001 + i * 2 });
  }
  await db.messages.appendAll(st.id, rows);
  await db.stories.update(st.id, { extraction: false, keeper: false });
  await db.settings.set('welcomeSeen', true);
  const other = await db.stories.create({ title: 'another tale' });
  await window.__cozy.chat.openStory(other.id);
  return st.id; }"""

OPEN = """async (sid) => { const { db } = await import('/js/store.js');
  const tasks = [];
  const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) tasks.push(Math.round(e.duration)); });
  po.observe({ entryTypes: ['longtask'] });
  let worst = 0; let last = performance.now(); let going = true;
  const tick = () => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; if (going) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const t0 = performance.now();
  await window.__cozy.chat.openStory(sid);
  const opened = performance.now() - t0;
  let marked = false;
  for (let i = 0; i < 1200 && !marked; i += 1) { marked = Boolean(await db.settings.get('pagesMended:' + sid)); if (!marked) await new Promise((res) => setTimeout(res, 50)); }
  const done = performance.now() - t0;
  await new Promise((res) => setTimeout(res, 200));
  going = false; po.disconnect();
  return { opened_ms: Math.round(opened), repaired_after_ms: Math.round(done), repaired: marked, worst_frame_gap_ms: Math.round(worst), long_tasks: tasks.length, longest_task_ms: Math.max(0, ...tasks), long_task_total_ms: tasks.reduce((a, b) => a + b, 0) }; }"""


def main():
    data = tempfile.mkdtemp(prefix='cozy-perf-repair-')
    srv = subprocess.Popen([sys.executable, '-B', os.path.join(REPO, 'serve.py')], cwd=REPO, env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=data), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(80):
            try:
                urllib.request.urlopen(BASE + 'api/version', timeout=1).read()
                break
            except Exception:
                time.sleep(0.25)
        with sync_playwright() as p:
            b = p.chromium.launch(args=['--no-sandbox'])
            ctx = b.new_context(viewport={'width': 412, 'height': 915}, service_workers='block')
            pg = ctx.new_page()
            pg.goto(BASE, wait_until='load')
            pg.wait_for_function('!!window.__cozy && !!window.__cozy.chat && !!window.__cozy.booksStatus', timeout=40000)
            pg.wait_for_timeout(1500)
            sid = pg.evaluate(SEED, TURNS)
            pg.wait_for_timeout(1500)
            if THROTTLE > 1:
                ctx.new_cdp_session(pg).send('Emulation.setCPUThrottlingRate', {'rate': THROTTLE})
            r = pg.evaluate(OPEN, sid)
            r['turns'] = TURNS
            r['throttle'] = THROTTLE
            b.close()
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=5)
        except Exception:
            srv.kill()
        shutil.rmtree(data, ignore_errors=True)
    broken = [k for k, v in BUDGET.items() if r.get(k, 0) > v * max(1.0, THROTTLE)]
    if not r.get('repaired'):
        broken.append('the repair never finished')
    r['budget'] = BUDGET
    r['broken'] = broken
    print(json.dumps(r))
    sys.exit(1 if broken else 0)


if __name__ == '__main__':
    main()
