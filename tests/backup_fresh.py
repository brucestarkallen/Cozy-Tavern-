#!/usr/bin/env python3
"""M670: "TAKE A COPY" IS THE LIBRARY AS IT STANDS THIS MOMENT. His word: "what matters is I have all the information — when I
import it, it is basically the original, like a Mac's Time Machine." The device zips its own books, and the browser
sends a ledger or a record to the device twenty seconds after it changes (pages go at once, M181): a copy taken
inside those twenty seconds held the pages and a ledger from before them. Against the real serve.py and the real app
in Chromium: a record line written a moment before "Take a copy" is IN the copy."""
import io, json, os, shutil, subprocess, sys, time, urllib.request, zipfile
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-backup-fresh')
PORT = os.environ.get('COZY_TEST_PORT', '8097')
BASE = 'http://127.0.0.1:%s/' % PORT
MARK = 'THE-LINE-WRITTEN-A-MOMENT-AGO-4471'
fails = []
def check(ok, words):
    print(('  ok   ' if ok else '  FAIL ') + words)
    if not ok: fails.append(words)
def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r: return r.read()

shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(2.5)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1100, 'height': 800})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE, wait_until='load')
        pg.wait_for_function("() => window.__cozy && window.__cozy.db", timeout=20000)
        pg.wait_for_timeout(1500)
        sid = pg.evaluate("""async () => { const s = await window.__cozy.db.stories.create({ title: 'A tale for the copy' });
            await window.__cozy.db.messages.append(s.id, { role: 'user', text: 'I begin.' });
            await window.__cozy.db.messages.append(s.id, { role: 'assistant', text: 'The story begins.' }); return s.id; }""")
        # let the pages reach the device (they are sent at once), and the twenty-second wait for everything else run out
        deadline = time.time() + 40
        while time.time() < deadline and not os.path.exists(os.path.join(DATA, 'books', sid + '.json')): time.sleep(0.5)
        check(os.path.exists(os.path.join(DATA, 'books', sid + '.json')), 'the tale is on the device')
        pg.wait_for_timeout(22000)
        # a record line is written -- and the copy is asked for at once
        pg.evaluate("""async (a) => { await window.__cozy.db.settings.set('memory:' + a.sid, { window: 20, nodes: [{ id: 'n1', span: [0, 1], text: a.mark, level: 1, at: 1 }] }); location.hash = '#/settings'; }""", {'sid': sid, 'mark': MARK})
        pg.wait_for_selector('#btn-export', state='attached', timeout=10000)
        pg.evaluate("() => document.getElementById('btn-export').click()")
        pg.wait_for_function("() => /A copy of every book|could not make a copy|could not fold/.test((document.getElementById('backup-note') || {}).textContent || '')", timeout=60000)
        note = pg.evaluate("() => document.getElementById('backup-note').textContent")
        check('A copy of every book' in note, 'the device made the copy: ' + note[:90])
        z = zipfile.ZipFile(io.BytesIO(get('api/backup/file')))
        book = z.read('books/' + sid + '.json').decode('utf-8', 'replace') if ('books/' + sid + '.json') in z.namelist() else ''
        log = z.read('books/' + sid + '.log').decode('utf-8', 'replace') if ('books/' + sid + '.log') in z.namelist() else ''
        check(MARK in book or MARK in log, 'the record line written a moment before is IN the copy')
        check(not errs, 'no error on the page: ' + ' | '.join(errs[:2]))
        b.close()
finally:
    srv.terminate()
    try: srv.wait(timeout=5)
    except Exception: srv.kill()
print('\n' + ('a copy is the library as it stands: all green' if not fails else 'FAILED: ' + ' / '.join(fails)))
sys.exit(1 if fails else 0)
