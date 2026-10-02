#!/usr/bin/env python3
"""M557: a page written while the tavern on the phone is not answering reaches it once it answers again — by itself.

The push took the tale off its dirty list BEFORE pushing, and a book the device did not take was dropped: it reached the
device only when that tale was written again. Here: a tale pushed whole; the server stopped; a page written; the server
started again (same port, same files); NO further write — the page must be on the device within the retries. Exits 1 on a
miss."""
import json, os, shutil, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-pushretry'
PORT = os.environ.get('COZY_TEST_PORT', '8132')
BASE = 'http://127.0.0.1:%s/' % PORT
shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)


def start():
    p = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], cwd=REPO, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            urllib.request.urlopen(BASE + 'api/version', timeout=1).read()
            return p
        except Exception:
            time.sleep(0.25)
    return p


def device_book(sid):
    try:
        return json.loads(urllib.request.urlopen(BASE + 'api/books/one/' + sid, timeout=3).read().decode('utf-8'))
    except Exception:
        return None


SEED = """async () => {
  const { db } = await import('/js/store.js');
  const st = await db.stories.create({ title: 'the long night' });
  await db.messages.append(st.id, { role: 'user', text: 'I wait.' });
  await db.messages.append(st.id, { role: 'assistant', text: '[the gate — Monday | 21:00]\\n\\nThe rain kept on.' });
  await db.settings.set('welcomeSeen', true);
  window.__cozy.setActiveStoryId(st.id);
  await window.__cozy.chat.renderThread({ structural: true });
  await window.__cozy.booksStatus.pushAll();
  return st.id;
}"""

fails = []
srv = start()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 412, 'height': 915}, service_workers='block')
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until='load')
        page.wait_for_function('!!window.__cozy && !!window.__cozy.chat && !!window.__cozy.booksStatus', timeout=30000)
        page.wait_for_timeout(1500)
        sid = page.evaluate(SEED)
        first = device_book(sid)
        if not first or 'The rain kept on.' not in json.dumps(first):
            fails.append('the tale was not on the device before the test began')
        print('  on the device before:', bool(first))
        srv.terminate(); srv.wait(timeout=10)
        print('  the server stopped')
        page.evaluate("""async (sid) => { const { db } = await import('/js/store.js');
          await db.messages.append(sid, { role: 'user', text: 'I open the door.' });
          await db.messages.append(sid, { role: 'assistant', text: '[the gate — Monday | 21:05]\\n\\nSOMEONE-AT-THE-DOOR stood in the rain.' });
          await window.__cozy.booksStatus.pushAll(); }""", sid)
        page.wait_for_timeout(3000)
        srv = start()
        print('  the server started again — no further write')
        landed = None
        t0 = time.time()
        while time.time() - t0 < 120:
            got = device_book(sid)
            if got and 'SOMEONE-AT-THE-DOOR' in json.dumps(got):
                landed = round(time.time() - t0, 1)
                break
            time.sleep(2)
        print('  the page written while it was down reached the device after %s s' % landed)
        if landed is None:
            fails.append('the page written while the server was down never reached the device (120 s, no further write)')
        if errors:
            fails.append('page errors: ' + ' | '.join(errors[:3]))
        b.close()
finally:
    try:
        srv.terminate()
    except Exception:
        pass

if fails:
    print('MISS ' + '\nMISS '.join(fails))
    sys.exit(1)
print('a page written while the tavern was not answering reached it by itself once it answered')
