#!/usr/bin/env python3
"""M671: "WHAT THE STORYTELLER SAW" IS IN THE COPY, AND COMES BACK — EVERY PAGE OF IT. His word: "the raw data, everything — I
need it." Against the real serve.py and the real app in Chromium: a page's sent words are kept; "Take a copy" sends
them to the device (sent/<tale>.ndjson — an archive that only grows) and the zip holds them; a second page adds only
its own lines and sending again adds nothing; a page the browser has let go is read back from the device; and the zip,
brought back onto an EMPTY device and opened in a browser that has never seen the tale, shows both pages' words, word
for word."""
import io, json, os, shutil, subprocess, sys, time, urllib.request, zipfile
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-backup-sent')
PORT = os.environ.get('COZY_TEST_PORT', '8098')
BASE = 'http://127.0.0.1:%s/' % PORT
FRAME = 'THE-FRAME-AS-IT-WAS-SENT-7731 ' + ('You are telling a story with one person. ' * 60)
RAW = 'THE-RAW-REQUEST-AS-THE-PROVIDER-GOT-IT-9042 ' + ('Where things stand right now. ' * 60)
fails = []
def check(ok, words):
    print(('  ok   ' if ok else '  FAIL ') + words)
    if not ok: fails.append(words)
def get(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as r: return r.read()
def start(data):
    env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=data)
    p = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    return p
def stop(p):
    p.terminate()
    try: p.wait(timeout=5)
    except Exception: p.kill()

shutil.rmtree(DATA, ignore_errors=True); shutil.rmtree(DATA + '-second', ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
srv = start(DATA)
copy = b''
sid = ''
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1100, 'height': 800})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE, wait_until='load')
        pg.wait_for_function("() => window.__cozy && window.__cozy.db", timeout=20000)
        pg.wait_for_timeout(1500)
        sid = pg.evaluate("""async (a) => { const s = await window.__cozy.db.stories.create({ title: 'A tale whose words are kept' });
            await window.__cozy.db.messages.append(s.id, { role: 'user', text: 'I begin.' });
            await window.__cozy.db.messages.append(s.id, { role: 'assistant', text: 'The story begins.', receipt: { sentId: 'snt_copytest1', slots: [] } });
            const sent = await import('/js/sent.js');
            const kept = await sent.keepSent({ id: 'snt_copytest1', storyId: s.id, slots: [{ name: 'The frame', text: a.frame }], requests: [{ url: 'https://api.example/v1/messages', body: { model: 'm', messages: [{ role: 'system', content: a.raw }, { role: 'user', content: 'I begin.' }] } }] });
            if (!kept) throw new Error('the words were not kept');
            location.hash = '#/settings'; return s.id; }""", {'frame': FRAME, 'raw': RAW})
        deadline = time.time() + 40
        while time.time() < deadline and not os.path.exists(os.path.join(DATA, 'books', sid + '.json')): time.sleep(0.5)
        check(os.path.exists(os.path.join(DATA, 'books', sid + '.json')), 'the tale is on the device')
        check(not os.path.exists(os.path.join(DATA, 'sent', sid + '.ndjson')), 'its sent words are not there yet (they go by themselves in a few minutes, or with the copy)')
        pg.wait_for_selector('#btn-export', state='attached', timeout=10000)
        pg.evaluate("() => document.getElementById('btn-export').click()")
        pg.wait_for_function("() => /A copy of every book|could not make a copy|could not fold/.test((document.getElementById('backup-note') || {}).textContent || '')", timeout=90000)
        arch = os.path.join(DATA, 'sent', sid + '.ndjson')
        first = os.path.getsize(arch) if os.path.exists(arch) else 0
        check(first > 0, 'taking the copy sent the page\'s words to the device (' + str(first) + ' bytes)')
        # a second page: only its own lines are added; sending again adds nothing
        more = pg.evaluate("""async (a) => { const sent = await import('/js/sent.js');
            await sent.keepSent({ id: 'snt_copytest2', storyId: a.sid, slots: [{ name: 'The frame', text: a.frame }, { name: 'The page', text: 'THE-SECOND-PAGE-ONLY-5518 ' + 'A new paragraph of the story. '.repeat(40) }], requests: [] });
            const one = await sent.pushSentToDevice(a.sid); const two = await sent.pushSentToDevice(a.sid); return [one, two]; }""", {'sid': sid, 'frame': FRAME})
        second_size = os.path.getsize(arch)
        lines = [json.loads(ln) for ln in open(arch, encoding='utf-8') if ln.strip()]
        check(more == [True, True] and len([l for l in lines if 'p' in l]) == 2, 'the second page is in the archive: two pages')
        check(len([l for l in lines if l.get('t', '').startswith('THE-FRAME-AS-IT-WAS-SENT')]) == 1, 'the frame both pages share is kept ONCE (only the new page\'s own words were added)')
        pg.evaluate("async (sid) => { const sent = await import('/js/sent.js'); await sent.pushSentToDevice(sid); }", sid)
        check(os.path.getsize(arch) == second_size, 'sending again adds nothing')
        # the browser lets the first page go (it keeps the newest pages only): the device still has it
        let_go = pg.evaluate("""async (sid) => { const sent = await import('/js/sent.js'); await sent.clearSent();
            const here = await sent.loadSent('snt_copytest1'); const r = await sent.loadSentOrPull('snt_copytest1', sid);
            return { here: Boolean(here), text: r ? r.slots[0].text : null }; }""", sid)
        check(let_go['here'] is False and let_go['text'] == FRAME, 'a page this browser has let go is read back from the device, word for word')
        pg.evaluate("() => document.getElementById('btn-export').click()")
        pg.wait_for_timeout(2500)
        pg.wait_for_function("() => /A copy of every book|could not make a copy|could not fold/.test((document.getElementById('backup-note') || {}).textContent || '')", timeout=90000)
        copy = get('api/backup/file')
        z = zipfile.ZipFile(io.BytesIO(copy))
        name = 'sent/' + sid + '.ndjson'
        inside = z.read(name).decode('utf-8', 'replace') if name in z.namelist() else ''
        check(bool(inside), 'the copy holds the tale\'s sent words (' + name + ', ' + str(len(inside)) + ' characters)')
        check('THE-FRAME-AS-IT-WAS-SENT-7731' in inside and 'THE-RAW-REQUEST-AS-THE-PROVIDER-GOT-IT-9042' in inside, 'both the parts and the raw request are in it')
        check(not errs, 'no error on the page: ' + ' | '.join(errs[:2]))
        b.close()
finally:
    stop(srv)

# an EMPTY device, a browser that has never seen the tale: bring the copy back and read the page's words
second = DATA + '-second'
os.makedirs(second, exist_ok=True)
srv = start(second)
try:
    req = urllib.request.Request(BASE + 'api/backup/restore', data=copy, method='POST', headers={'content-type': 'application/zip'})
    with urllib.request.urlopen(req, timeout=120) as r: back = json.loads(r.read())
    check(back.get('ok') is True, 'the copy is brought back onto an empty device: ' + json.dumps(back)[:120])
    check(os.path.exists(os.path.join(second, 'sent', sid + '.ndjson')), 'and its sent words are on that device')
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1100, 'height': 800})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE, wait_until='load')
        pg.wait_for_function("() => window.__cozy && window.__cozy.db", timeout=20000)
        pg.wait_for_function("async (sid) => (await window.__cozy.db.stories.list()).some((s) => s.id === sid)", arg=sid, timeout=60000)
        got = pg.evaluate("""async (sid) => { const sent = await import('/js/sent.js');
            const here = await sent.loadSent('snt_copytest1');
            const r = await sent.loadSentOrPull('snt_copytest1', sid);
            const r2 = await sent.loadSentOrPull('snt_copytest2', sid);
            return { hadBefore: Boolean(here), slots: r ? r.slots : null, raw: r ? r.requests[0].body.messages[0].content : null, model: r ? r.requests[0].body.model : null, second: r2 ? r2.slots[1].text.slice(0, 25) : null }; }""", sid)
        check(got['hadBefore'] is False, 'this browser never held the page\'s words')
        check(got['slots'] is not None and got['slots'][0]['name'] == 'The frame' and got['slots'][0]['text'] == FRAME, 'and now reads the part that was sent, word for word')
        check(got['raw'] == RAW and got['model'] == 'm', 'and the raw request, word for word')
        check(got['second'] == 'THE-SECOND-PAGE-ONLY-5518', 'and the second page\'s words too')
        check(not errs, 'no error on the page: ' + ' | '.join(errs[:2]))
        b.close()
finally:
    stop(srv)
print('\n' + ('what the storyteller saw is in the copy and comes back: all green' if not fails else 'FAILED: ' + ' / '.join(fails)))
sys.exit(1 if fails else 0)
