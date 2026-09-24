#!/usr/bin/env python3
"""M468-2: the page mark, measured in a real Chromium on a phone screen.

A tale of forty pages, the last one short. Scrolled to the end, the mark must say the LAST page (it said 154 of 155
on the writer's tale — a reading line fixed at 45% of the screen never reached a short last page). Scrolled to the
top, the first page drawn. Dragged to the foot and back, both ends again. Exits 1 on any miss."""
import os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-pagemark'
PORT = os.environ.get('COZY_TEST_PORT', '8098')
BASE = 'http://127.0.0.1:%s/' % PORT
shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], cwd=REPO, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

SEED = """async () => {
  const { db } = await import('/js/store.js');
  const st = await db.stories.create({ title: 'a numbered tale' });
  const long = 'The rain kept on against the shutters, and nobody said the thing they meant. '.repeat(14);
  for (let i = 1; i <= 40; i += 1) {
    await db.messages.append(st.id, { role: 'user', text: 'Turn ' + i + '.' });
    await db.messages.append(st.id, { role: 'assistant', text: '[The Lantern — Monday | 21:' + String(i).padStart(2, '0') + ' | rain | a coat | by the door]\\n\\n' + (i === 40 ? 'The last page is one short line.' : long) });
  }
  await db.settings.set('welcomeSeen', true);
  await db.settings.set('turnsShown', 100);
  window.__cozy.setActiveStoryId(st.id);
  await window.__cozy.chat.renderThread({ structural: true, opening: true });
  return st.id;
}"""
fails = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True, service_workers='block')
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until='load')
        page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=30000)
        page.wait_for_timeout(1200)
        page.evaluate(SEED)
        page.wait_for_timeout(800)
        page.evaluate("() => { const w = document.getElementById('welcome-overlay'); if (w) { w.classList.remove('open'); w.hidden = true; } }")
        mark = lambda: page.evaluate("() => { const m = document.getElementById('page-mark'); return m ? m.textContent : ''; }")
        under = lambda: page.evaluate("() => window.__cozy && window.__cozy.pageMark ? window.__cozy.pageMark.pageUnderEye() : null")
        def check(what, want):
            got = under()
            print('  %-42s %s (mark: %s)' % (what, got, mark()))
            if got != want: fails.append('%s: got %s, wanted %s' % (what, got, want))
        pages = page.evaluate("() => document.getElementById('thread').dataset.pages")
        if pages != '40': fails.append('forty pages numbered, got ' + str(pages))
        page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = t.scrollHeight; }")
        page.wait_for_timeout(250)
        check('at the end (opened there)', 40)
        page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = 0; }")
        page.wait_for_timeout(250)
        check('at the top', 1)
        page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = (t.scrollHeight - t.clientHeight) / 2; }")
        page.wait_for_timeout(250)
        mid = under()
        print('  %-42s %s' % ('halfway', mid))
        if not (10 <= (mid or 0) <= 30): fails.append('halfway named page %s' % mid)
        # the drag: to the foot, then back to the head
        page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = 200; }")
        page.wait_for_timeout(250)
        box = page.evaluate("() => { const m = document.getElementById('page-mark'); const r = m.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }")
        tb = page.evaluate("() => { const r = document.getElementById('thread').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }")
        page.mouse.move(box['x'], box['y']); page.mouse.down(); page.mouse.move(box['x'], tb['bottom'] - 2, steps=8); page.mouse.up()
        page.wait_for_timeout(250)
        check('dragged to the foot', 40)
        box = page.evaluate("() => { const m = document.getElementById('page-mark'); const r = m.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }")
        page.mouse.move(box['x'], box['y']); page.mouse.down(); page.mouse.move(box['x'], tb['top'] + 2, steps=8); page.mouse.up()
        page.wait_for_timeout(250)
        check('dragged to the head', 1)
        if errors: fails.append('the page threw: ' + errors[0])
        b.close()
finally:
    srv.terminate()
print()
print('the page mark names the right page at both ends and under a drag' if not fails else 'FAILED: ' + ' | '.join(fails))
sys.exit(1 if fails else 0)
