#!/usr/bin/env python3
"""M675 (the second reading): THE TALE LEFT OPEN IS OPENED WHEN THE APP STARTS, LIKE ANY OTHER.

What the house does for a tale that has just been opened (chat.js taleOpened) was written out in openStory alone, and
the tale open when the app starts never goes through openStory. So for the tale he reads most, its kept pages were never
looked over on a new build and its out-of-character pages were never settled, until he opened another tale and came back.

A headless Chromium against the real serve.py. A tale is written straight into the store with a page the finisher of
M669 ran together into one block and a page that follows an out-of-character message with no receipt (brought in from
another app: it is the story), and it is the tale left open. The page is loaded again — nothing is tapped — and the
store is read back.

  python3 tests/boot_open.py                   # prints "N ok"; exits 1 with what went wrong
  COZY_TEST_REPO=/path/to/another/build python3 tests/boot_open.py
"""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

REPO = os.environ.get('COZY_TEST_REPO') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = os.environ.get('COZY_TEST_PORT', '8153')
BASE = 'http://127.0.0.1:%s/' % PORT

SEED = """async () => { const { db } = await import('/js/store.js');
  const HEAD = '[Yard — Monday, June 2, 2025 | 08:00 | rain | coat | standing]';
  const filler = 'The rain kept on over the yard and the lamps along the wall burned low. '.repeat(5).trim();
  const LINES = ['Rukia crossed the yard. She did not look back.', 'Renji waited by the gate. He said nothing at all.', filler];
  const RULE = 'The World Beyond stays where it cut. Nothing follows it.';
  const asWritten = HEAD + '\\n' + LINES.join('\\n') + ' ' + RULE;
  const asM669LeftIt = HEAD + '\\n\\n' + LINES.join(' ');
  const st = await db.stories.create({ title: 'the tale left open' });
  await db.stories.update(st.id, { extraction: false, keeper: false, continuity: false });
  let ts = Date.now() - 600000;
  const add = (m) => db.messages.append(st.id, { ...m, ts: (ts += 1000) });
  await add({ role: 'user', text: 'One.' });
  const flattened = await add({ role: 'assistant', text: asM669LeftIt, mended: { before: asWritten, why: 'tidied — took off “' + RULE + '” (not the story)', at: Date.now() } });
  await add({ role: 'user', text: '((keep it slow from here))' });
  const broughtIn = await add({ role: 'assistant', text: HEAD + '\\n\\nThe rain kept on, and nobody hurried.' });
  await add({ role: 'user', text: 'Two.' });
  await add({ role: 'assistant', text: HEAD + '\\n\\nThe newest page, as it should be.' });
  await db.settings.set('welcomeSeen', true);
  window.__cozy.setActiveStoryId(st.id);
  await new Promise((r) => setTimeout(r, 300));
  const { VERSION } = await import('/js/version.js');
  return { sid: st.id, flattened: flattened.id, broughtIn: broughtIn.id, want: HEAD + '\\n\\n' + LINES.join('\\n\\n'), was: asM669LeftIt, version: VERSION }; }"""

READ = """async (a) => { const { db } = await import('/js/store.js');
  let mended; let settled;
  for (let i = 0; i < 160; i += 1) {
    mended = await db.settings.get('pagesMended:' + a.sid); settled = await db.settings.get('asidesSettled:' + a.sid);
    if (mended === a.version && settled === 1) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const pages = await db.messages.list(a.sid);
  const by = (id) => pages.find((m) => m.id === id) || {};
  const shown = [...document.querySelectorAll('#thread .msg')].find((n) => n.dataset && n.dataset.id === a.flattened);
  return { open: window.__cozy.getActiveStoryId(), mended, settled, flattened: by(a.flattened).text, ooc: by(a.broughtIn).ooc,
    shownAsThree: shown ? /look back\\.(<br>\\s*){2}Renji waited by the gate\\. He said nothing at all\\.(<br>\\s*){2}The rain kept on/.test(shown.innerHTML) : null }; }"""


def main():
    data = tempfile.mkdtemp(prefix='cozy-boot-open-')
    srv = subprocess.Popen([sys.executable, '-B', os.path.join(REPO, 'serve.py')], cwd=REPO, env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=data), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    bad = []
    ok = 0
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
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.goto(BASE, wait_until='load')
            pg.wait_for_function('!!window.__cozy && !!window.__cozy.chat && !!window.__cozy.booksStatus', timeout=40000)
            pg.wait_for_timeout(1200)
            a = pg.evaluate(SEED)
            pg.wait_for_timeout(2500)  # the pages reach the device, so the start's own pull brings nothing new
            pg.reload(wait_until='load')
            pg.wait_for_function('!!window.__cozy && !!window.__cozy.chat && !!window.__cozy.booksStatus && !!document.documentElement.dataset.version', timeout=40000)
            r = pg.evaluate(READ, a)

            def check(cond, what):
                nonlocal ok
                if cond:
                    ok += 1
                else:
                    bad.append(what)
            check(r['open'] == a['sid'], 'the tale left open is the one open after the start: ' + json.dumps(r['open']))
            check(r['mended'] == a['version'], 'its kept pages were looked over at the start (the mark of this build): ' + json.dumps(r['mended']))
            check(r['flattened'] == a['want'], 'the page run together into one block is three paragraphs again, with nothing tapped: ' + json.dumps(r['flattened'])[:200])
            check(r['flattened'] != a['was'], 'it is not as the old finisher left it')
            check(r['settled'] == 1, 'its out-of-character pages were settled at the start: ' + json.dumps(r['settled']))
            check(r['ooc'] is False, 'the page brought in after an out-of-character message is marked the story: ' + json.dumps(r['ooc']))
            check(r['shownAsThree'] is True, 'and the thread on the screen shows it so: %s' % json.dumps(r['shownAsThree']))
            check(not errors, 'no error on the page: ' + ' | '.join(errors)[:300])
            b.close()
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=5)
        except Exception:
            srv.kill()
        shutil.rmtree(data, ignore_errors=True)
    for w in bad:
        print('FAIL — ' + w)
    print('%d ok, %d failed' % (ok, len(bad)))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
