#!/usr/bin/env python3
"""M571: the device's safety copy holds every book ONCE.

His question: "does the automatic backup file have duplicates?" It did: each book's .bak1 (the device's own guard against a
write cut off mid-way — the book as it was one push before) was zipped beside the book, so every tale was in each safety copy
twice. Against the real serve.py: a library with a book and its .bak1, a second book, the house book and its .bak1 — the zip
made now holds each book once, no .bak1 or .bak2, and each book byte for byte. Exits 1 on a miss."""
import io, json, os, shutil, subprocess, sys, time, urllib.request, zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-backupdupes'
PORT = os.environ.get('COZY_TEST_PORT', '8134')
BASE = 'http://127.0.0.1:%s/' % PORT
shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(os.path.join(DATA, 'books'), exist_ok=True)
files = {
    'books/tale-a.json': json.dumps({'kind': 'story', 'story': {'id': 'tale-a'}, 'messages': ['now'] * 50}).encode(),
    'books/tale-a.json.bak1': json.dumps({'kind': 'story', 'story': {'id': 'tale-a'}, 'messages': ['before'] * 50}).encode(),
    'books/tale-b.json': json.dumps({'kind': 'story', 'story': {'id': 'tale-b'}, 'messages': ['b'] * 50}).encode(),
    'books/_house.json': json.dumps({'kind': 'house', 'settings': []}).encode(),
    'books/_house.json.bak1': json.dumps({'kind': 'house', 'settings': ['old']}).encode(),
}
for rel, body in files.items():
    open(os.path.join(DATA, rel), 'wb').write(body)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], cwd=REPO, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails = []
def check(ok, words):
    print(('  ok   ' if ok else '  FAIL ') + words)
    if not ok:
        fails.append(words)
try:
    for _ in range(40):
        try:
            urllib.request.urlopen(BASE + 'api/version', timeout=1).read(); break
        except Exception:
            time.sleep(0.25)
    time.sleep(1.5)  # the copy made at start
    json.loads(urllib.request.urlopen(BASE + 'api/backup/now', timeout=30).read().decode('utf-8'))
    z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(BASE + 'api/backup/file', timeout=30).read()))
    names = sorted(z.namelist())
    print('  in the copy:', ', '.join(names))
    check(not any(n.endswith('.bak1') or n.endswith('.bak2') for n in names), 'no previous-version file is in the copy')
    for rel in ('books/tale-a.json', 'books/tale-b.json', 'books/_house.json'):
        check(rel in names and z.read(rel) == files[rel], rel + ' is in it once, byte for byte')
    check(len([n for n in names if 'tale-a' in n]) == 1, 'the tale with a previous version is in it once')
finally:
    srv.terminate()
if fails:
    print('MISS ' + '\nMISS '.join(fails)); sys.exit(1)
print('the safety copy holds every book once')
