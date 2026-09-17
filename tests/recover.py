#!/usr/bin/env python3
"""M311: the device finds the names of shelves in its older files (read-only), newest name winning."""
import json, os, shutil, subprocess, sys, time, urllib.request
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-recover')
PORT = os.environ.get('COZY_TEST_PORT', '8095')
fails = []
def check(ok, words):
    print(('  ok   ' if ok else '  FAIL ') + words)
    if not ok: fails.append(words)
shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(os.path.join(DATA, 'books'), exist_ok=True)
row = lambda shelves: {'namespace': 'cozy-tavern', 'settings': [{'key': 'theme', 'value': 'magma'}, {'key': 'projects', 'value': shelves}]}
# the old single file, from before one-file-per-tale: two shelves, one since renamed
json.dump(row([{'id': 'p1', 'name': 'Ravenwod', 'createdAt': 1}, {'id': 'p2', 'name': 'High School DxD', 'createdAt': 2}]), open(os.path.join(DATA, 'books.json'), 'w'))
# the house book's safety copy: the rename, and a third shelf
json.dump(dict(row([{'id': 'p1', 'name': 'Ravenwood', 'createdAt': 1}, {'id': 'p3', 'name': 'One-shots', 'createdAt': 3}]), kind='house'), open(os.path.join(DATA, 'books', '_house.json.bak1'), 'w'))
# the house book as it stands now: the row is GONE
json.dump({'namespace': 'cozy-tavern', 'kind': 'house', 'settings': [{'key': 'theme', 'value': 'magma'}]}, open(os.path.join(DATA, 'books', '_house.json'), 'w'))
before = {f: open(os.path.join(dp, f), 'rb').read() for dp, _, fs in os.walk(DATA) for f in fs}
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(2.0)
    r = json.loads(urllib.request.urlopen('http://127.0.0.1:%s/api/recover/projects' % PORT, timeout=20).read())
    got = r.get('projects', {})
    check(set(got) == {'p1', 'p2', 'p3'}, 'every shelf the device still knows of, from any of its files: ' + json.dumps(got))
    check(got.get('p1', {}).get('name') == 'Ravenwood', 'the newer name wins over the older file’s')
    after = {f: open(os.path.join(dp, f), 'rb').read() for dp, _, fs in os.walk(DATA) if 'backups' not in dp for f in fs}
    check(all(after.get(k) == v for k, v in before.items()), 'and nothing on the device was written to')
finally:
    srv.terminate()
    try: srv.wait(timeout=5)
    except Exception: srv.kill()
print('the device finds the shelves’ names: ' + ('all green' if not fails else '%d FAILED' % len(fails)))
sys.exit(1 if fails else 0)
