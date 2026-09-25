#!/usr/bin/env python3
"""M490: the lone scene-break asterisk, mended in a REAL browser through the real app — seeded as the app stores a page
(text, and swipes), in every character shape a model sends it, mended by the button and by opening the tale, read
back from the store AND from the page on screen. Exits 1 on any miss."""
import os, shutil, subprocess, sys, time, json
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-mend'
PORT = os.environ.get('COZY_TEST_PORT', '8099')
BASE = 'http://127.0.0.1:%s/' % PORT
shutil.rmtree(DATA, ignore_errors=True); os.makedirs(DATA, exist_ok=True)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], cwd=REPO, env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

HEAD = '[Metropolis — Jovan\'s apartment, living room — Wednesday, March 19, 2025 | 07:34 | pale gold | slept-in shirt | on the sofa]\n\n'
BEFORE = '"Breakfast is supposed to taste like familiarity." He waits. "But because I want to get to know you."'
AFTER = "Kara doesn't move right away.\n\nShe's heard demands like artillery and orders like weather."
SHAPES = {
  'plain, paragraph':        '\n\n  *\n\n',
  'extra blank lines':       '\n\n\n  *\n\n\n',
  'whitespace-only lines':   '\n\n \n  *\n \n\n',
  'single newlines':         '\n  *\n',
  'CRLF':                    '\r\n\r\n  *\r\n\r\n',
  'NBSP':                    '\n\n\u00a0\u00a0*\n\n',
  'em space':                '\n\n\u2003*\n\n',
  'thin + narrow nbsp':      '\n\n\u2009\u202f*\n\n',
  'ideographic space':       '\n\n\u3000*\n\n',
  'zero-width after':        '\n\n  *\u200b\n\n',
  'BOM before':              '\n\n\ufeff  *\n\n',
  'fullwidth asterisk':      '\n\n  \uff0a\n\n',
  'asterisk operator':       '\n\n  \u2217\n\n',
  'trailing tab':            '\n\n  *\t\n\n',
}
fails = []
try:
  with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 412, 'height': 915}, service_workers='block')
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(BASE, wait_until='load')
    page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=30000)
    page.wait_for_timeout(1000)
    ids = page.evaluate("""async ({ HEAD, BEFORE, AFTER, SHAPES }) => {
      const { db } = await import('/js/store.js');
      await db.settings.set('welcomeSeen', true);
      const st = await db.stories.create({ title: 'mend in a real browser' });
      const out = {};
      let i = 0;
      for (const [name, shape] of Object.entries(SHAPES)) {
        await db.messages.append(st.id, { role: 'user', text: 'Turn ' + (i += 1) + '.' });
        const text = HEAD + BEFORE + shape + AFTER;
        /* every other one as a swiped page, the way a Try again keeps its versions */
        const m = i % 2 ? await db.messages.append(st.id, { role: 'assistant', text })
                        : await db.messages.append(st.id, { role: 'assistant', text, swipes: [{ text: 'an older version' }, { text }], swipeIdx: 1 });
        out[name] = m.id;
      }
      return { story: st.id, pages: out };
    }""", {'HEAD': HEAD, 'BEFORE': BEFORE, 'AFTER': AFTER, 'SHAPES': SHAPES})
    def read(label):
      got = page.evaluate("""async ({ sid, pages }) => {
        const { db } = await import('/js/store.js');
        const { pageText } = await import('/js/assemble/stack.js');
        const list = await db.messages.list(sid);
        const res = {};
        for (const [name, id] of Object.entries(pages)) {
          const m = list.find((x) => x.id === id);
          const stored = pageText(m);
          const node = document.querySelector('#thread .msg[data-id="' + id + '"] .msg-body');
          res[name] = { stored, shown: node ? node.textContent : null };
        }
        return res;
      }""", {'sid': ids['story'], 'pages': ids['pages']})
      print('\n--', label)
      for name, r in got.items():
        mid = r['stored'][len(HEAD) + len(BEFORE):len(HEAD) + len(BEFORE) + 18] if r['stored'] else ''
        ok_store = '\n\n* * *\n\n' in (r['stored'] or '')
        ok_shown = r['shown'] is not None and '* * *' in r['shown']
        print('  %-24s store %-4s shown %-4s  %s' % (name, 'ok' if ok_store else 'MISS', 'ok' if ok_shown else ('none' if r['shown'] is None else 'MISS'), json.dumps(mid)))
        if label.startswith('after') and (not ok_store or not ok_shown): fails.append(name)
    # open the tale: the on-open mend runs once per tale per build
    page.evaluate("async (sid) => { await window.__cozy.chat.openStory(sid); }", ids['story'])
    page.wait_for_timeout(2500)
    read('after opening the tale (the mend on open)')
    # and the button, by hand, from the ledger
    page.evaluate("() => { const b = document.getElementById('btn-ledger'); if (b) b.click(); }")
    page.wait_for_timeout(700)
    page.evaluate("() => { const c = [...document.querySelectorAll('#drawer-panels .nav-chip')].find((x) => x.dataset.room === 'books'); if (c) c.click(); }")
    page.wait_for_timeout(700)
    toast = page.evaluate("""async () => { const b = [...document.querySelectorAll('#drawer-panels button')].find((x) => x.textContent === 'Mend the pages’ marks'); if (!b) return 'NO BUTTON'; b.click(); await new Promise((r) => setTimeout(r, 1500)); const t = document.querySelector('.toast'); return t ? t.textContent : '(no toast)'; }""")
    print('\nthe button said:', toast)
    read('after the button')
    if errs: fails.append('page error: ' + errs[0])
    b.close()
finally:
  srv.terminate()
print()
print('every shape mended, in the store and on screen' if not fails else 'FAILED: ' + ', '.join(sorted(set(fails))))
sys.exit(1 if fails else 0)
