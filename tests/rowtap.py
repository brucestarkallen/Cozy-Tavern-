#!/usr/bin/env python3
"""M672: A STORY ROW'S SMALL BUTTONS TAKE A FINGERTIP. In real Chromium at a phone's width (390 px, touch), against the real
serve.py: each button on a story's row is a box about 23 x 10 px; a tap 8 px above or below it must still reach THAT
button (not the next one, not the row's own "open the story"), the title must still open the story, and the page must
not scroll sideways."""
import os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-rowtap')
PORT = os.environ.get('COZY_TEST_PORT', '8102')
fails = []
def check(ok, words):
    print(('  ok   ' if ok else '  FAIL ') + words)
    if not ok: fails.append(words)

shutil.rmtree(DATA, ignore_errors=True)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA), cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(2.5)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 800}, has_touch=True, is_mobile=True)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:%s/' % PORT, wait_until='load')
        pg.wait_for_function("() => window.__cozy && window.__cozy.db", timeout=20000)
        pg.evaluate("async () => { await window.__cozy.db.settings.set('welcomeSeen', true); }")
        pg.reload(wait_until='load')
        pg.wait_for_function("() => window.__cozy && window.__cozy.db && window.__cozy.chat", timeout=20000)
        pg.wait_for_timeout(1000)
        pg.evaluate("""async () => { const c = window.__cozy; for (const t of ['The Greyhaven ferry and the long night', 'A second tale']) { const s = await c.db.stories.create({ title: t }); await c.db.messages.append(s.id, { role: 'user', text: 'I begin.' }); await c.db.messages.append(s.id, { role: 'assistant', text: 'The story begins on the quay, in the rain.' }); } await c.chat.refreshStories(); }""")
        on_screen = "() => { const row = document.querySelector('.story-item'); if (!row) return false; const r = row.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.width > 0; }"
        if not pg.evaluate(on_screen):
            pg.evaluate("() => { const b = document.getElementById('btn-stories'); if (b) b.click(); }")
            pg.wait_for_timeout(900)
        check(pg.evaluate(on_screen), 'the shelf is on screen')
        r = pg.evaluate("""() => { const row = document.querySelector('.story-item'); const open = row.querySelector('.story-open'); const out = [];
          for (const btn of row.querySelectorAll('.story-mini')) { const q = btn.getBoundingClientRect(); const cx = q.left + q.width / 2;
            const at = (y) => { const el = document.elementFromPoint(cx, y); return el ? (el.closest('.story-mini') === btn ? 'this' : el.closest('.story-mini') ? 'another button' : el.closest('.story-open') ? 'opens the story' : el.tagName) : 'nothing'; };
            const rr = row.getBoundingClientRect(); const layer = getComputedStyle(btn, '::after'); const up = -parseFloat(layer.top) || 0; const down = -parseFloat(layer.bottom) || 0;
            out.push({ label: (btn.getAttribute('aria-label') || btn.title || '').slice(0, 28), w: Math.round(q.width), h: Math.round(q.height), above: at(q.top - 8), below: at(q.bottom + 8), centre: at(q.top + q.height / 2), tall: Math.round(q.height + up + down), inside: q.top - up >= rr.top - 0.5 && q.bottom + down <= rr.bottom + 0.5 }); }
          const o = open.getBoundingClientRect(); const mid = document.elementFromPoint(o.left + 30, o.top + o.height / 2);
          return { buttons: out, title: Boolean(mid && mid.closest('.story-open')), sideways: document.documentElement.scrollWidth > innerWidth }; }""")
        check(len(r['buttons']) >= 3, 'a story row carries its buttons (%d)' % len(r['buttons']))
        for bt in r['buttons']:
            check(bt['above'] == 'this' and bt['below'] == 'this' and bt['centre'] == 'this', '%s (%dx%d): a tap 8 px above, 8 px below and at the centre reaches it — above: %s, below: %s' % (bt['label'], bt['w'], bt['h'], bt['above'], bt['below']))
            check(bt['tall'] >= 28 and bt['inside'], '%s: the area that takes the tap is %d px tall and stays inside its own row (it never reaches into the story above or below)' % (bt['label'], bt['tall']))
        check(r['title'], 'the title still opens the story')
        check(not r['sideways'], 'the page does not scroll sideways')
        check(not errs, 'no error on the page: ' + ' | '.join(errs[:2]))
        b.close()
finally:
    srv.terminate()
    try: srv.wait(timeout=5)
    except Exception: srv.kill()
print('\n' + ('a story row\'s buttons take a fingertip: all green' if not fails else 'FAILED: ' + ' / '.join(fails)))
sys.exit(1 if fails else 0)
