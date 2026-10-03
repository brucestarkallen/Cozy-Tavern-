#!/usr/bin/env python3
"""M569: a tale whose book outgrew 64 MB is taken by the device and read back whole.

His toast: a tale "could not be saved to the device — it has grown past what the device takes in one piece". A book carries
up to 180 copies of the ledger; a cast of 140 people makes it ~80 MB. Here the real serve.py is started, a ~80 MB book is
pushed the way the sync worker pushes one (POST api/books/one/<id>), and read back: it must land (200) and come back whole.
Also measured: the server's peak memory while it takes the book. Exits 1 on a miss."""
import json, os, shutil, subprocess, sys, time, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-bigbook'
PORT = os.environ.get('COZY_TEST_PORT', '8133')
BASE = 'http://127.0.0.1:%s/' % PORT
shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)

def ledger(i):
    chars = {('Person %d' % k): {'core': 'x' * 400, 'state': 'y' * 200, 'arc': 'z' * 300, 'threads': ['t' * 80] * 8, 'knowledge': ['k' * 90] * 10} for k in range(140)}
    return {'characters': chars, 'relationships': {('Person %d' % k): {'p': 10, 'r': 5, 's': 0, 'history': ['h' * 60] * 6} for k in range(120)}, 'clock': {'minutes': i}}

sid = 'big-tale'
book = {'namespace': 'cozytavern', 'kind': 'story', 'exportedAt': '2026-10-04T00:00:00.000Z', 'story': {'id': sid, 'title': 'The long war'},
        'settings': [{'key': 'snap:t%d:%s' % (i, sid), 'value': ledger(i)} for i in range(180)],
        'messages': [{'id': 'm%d' % i, 'storyId': sid, 'role': 'assistant' if i % 2 else 'user', 'text': 'p' * 3000, 'ts': i} for i in range(600)]}
body = json.dumps(book).encode('utf-8')
mb = round(len(body) / 1048576, 1)
print('  the book: %s MB' % mb)

srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], cwd=REPO, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails = []
try:
    for _ in range(40):
        try:
            urllib.request.urlopen(BASE + 'api/version', timeout=1).read(); break
        except Exception:
            time.sleep(0.25)
    req = urllib.request.Request(BASE + 'api/books/one/' + sid, data=body, method='POST', headers={'Content-Type': 'application/json', 'X-Cozy-Client': 'test'})
    try:
        status = urllib.request.urlopen(req, timeout=120).status
    except urllib.error.HTTPError as e:
        status = e.code
    except urllib.error.URLError as e:
        status = 'refused (' + str(e.reason) + ')'  # the old server closed the line on a body past its limit
    print('  the device answered: %s' % status)
    if status != 200:
        fails.append('the device refused a %s MB book (%s)' % (mb, status))
    else:
        got = json.loads(urllib.request.urlopen(BASE + 'api/books/one/' + sid, timeout=120).read().decode('utf-8'))
        whole = len(got.get('settings', [])) == 180 and len(got.get('messages', [])) == 600
        print('  read back whole: %s' % whole)
        if not whole:
            fails.append('the book did not come back whole')
    try:
        rss = int([l for l in open('/proc/%d/status' % srv.pid) if l.startswith('VmHWM')][0].split()[1]) // 1024
        print('  the server\'s peak memory: %s MB' % rss)
    except Exception:
        pass
finally:
    srv.terminate()

if fails:
    print('MISS ' + '\nMISS '.join(fails)); sys.exit(1)
print('a book past the old 64 MB is taken by the device and read back whole')
