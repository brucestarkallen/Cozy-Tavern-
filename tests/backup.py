#!/usr/bin/env python3
"""M310: THE DEVICE KEEPS ITS OWN SAFETY COPIES. Against the real serve.py: a copy is made at start,
on demand it is whole (every book file is inside, byte for byte), an unchanged library is not zipped
twice, a changed one is, only the newest five are kept, and the download is the same zip."""
import io, json, os, shutil, subprocess, sys, time, urllib.request, zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-backup')
PORT = os.environ.get('COZY_TEST_PORT', '8093')
BASE = 'http://127.0.0.1:%s/' % PORT
fails = []
def check(ok, words):
    print(('  ok   ' if ok else '  FAIL ') + words)
    if not ok: fails.append(words)
def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r: return r.read()

shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(os.path.join(DATA, 'books'), exist_ok=True)
books = {}
for i in range(12):
    body = json.dumps({'id': 'tale%02d' % i, 'pages': ['page %d of tale %d — ' % (k, i) + 'the river rose another hand. ' * 40 for k in range(250)]}).encode()
    books['books/tale%02d.json' % i] = body
    open(os.path.join(DATA, 'books', 'tale%02d.json' % i), 'wb').write(body)
house = json.dumps({'connections': [{'label': 'mine'}], 'stories': list(range(12))}).encode()
books['books/_house.json'] = house
open(os.path.join(DATA, 'books', '_house.json'), 'wb').write(house)

env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(2.5)
    folder = os.path.join(DATA, 'backups')
    zips = lambda: sorted(n for n in os.listdir(folder) if n.endswith('.zip')) if os.path.isdir(folder) else []
    check(len(zips()) == 1, 'a safety copy is made when the tavern starts, with no browser open: ' + str(zips()))
    r = json.loads(get('api/backup/now'))
    check(r.get('ok') and r.get('made') is False and len(zips()) == 1, 'an unchanged library is not zipped twice: ' + json.dumps(r)[:160])
    z = zipfile.ZipFile(io.BytesIO(get('api/backup/file')))
    inside = {n: z.read(n) for n in z.namelist()}
    check(all(inside.get(k) == v for k, v in books.items()), 'the download holds every book file, byte for byte (%d files, 3000 pages)' % len(inside))
    check(not any(n.startswith('backups') for n in inside), 'and never a backup of the backups')
    # the library changes: a new copy
    time.sleep(1.1)
    open(os.path.join(DATA, 'books', 'tale00.json'), 'ab').write(b' ')
    r2 = json.loads(get('api/backup/now'))
    check(r2.get('made') is True and len(zips()) == 2, 'a changed library earns a new copy: ' + str(zips()))
    for k in range(6):
        time.sleep(1.1)
        open(os.path.join(DATA, 'books', 'tale01.json'), 'ab').write(b' ')
        get('api/backup/now')
    check(len(zips()) == 5, 'only the newest five are kept: ' + str(len(zips())))
    newest = zipfile.ZipFile(os.path.join(folder, zips()[-1]))
    check(newest.testzip() is None and len(newest.namelist()) == 13, 'and the newest reads back whole')
    lst = json.loads(get('api/backup/list'))
    check(len(lst.get('copies', [])) == 5 and lst.get('folder', '').endswith('backups'), 'the list says what is kept and where')
finally:
    srv.terminate()
    try: srv.wait(timeout=5)
    except Exception: srv.kill()
print('the device keeps its own safety copies: ' + ('all green' if not fails else '%d FAILED' % len(fails)))
sys.exit(1 if fails else 0)
