#!/usr/bin/env python3
"""M510-47: serve.py restore_backup on a real library folder — a zip that is not one, one holding a path outside the
library, or one with no house book changes nothing; a copy replaces the library exactly; the library as it stood is
kept in backups first. Exits 1 on any miss."""
import os, sys, zipfile, io, json, importlib.util, shutil
shutil.rmtree('/tmp/cozy-restore-unit', ignore_errors=True)
fails = []
def say(ok, *words):
    # M675: a miss is counted — this file printed MISS and still left with 0, so the gate could not see it
    print(('ok   ' if ok else 'MISS ') + str(words[0]), *words[1:])
    if not ok: fails.append(str(words[0]))
os.environ['COZY_DATA_DIR'] = '/tmp/cozy-restore-unit/lib'
spec = importlib.util.spec_from_file_location('serve', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'serve.py')); serve = importlib.util.module_from_spec(spec); spec.loader.exec_module(serve)
os.makedirs('/tmp/cozy-restore-unit/lib/books', exist_ok=True)
def write(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'w').write(s)
write('/tmp/cozy-restore-unit/lib/books/_house.json', json.dumps({'kind': 'house', 'stories': [{'id': 'A'}, {'id': 'B'}]}))
write('/tmp/cozy-restore-unit/lib/books/A.json', '{"story":"A now"}'); write('/tmp/cozy-restore-unit/lib/books/B.json', '{"story":"B made after the copy"}')
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w') as z:
    z.writestr('books/_house.json', json.dumps({'kind': 'house', 'stories': [{'id': 'A'}]})); z.writestr('books/A.json', '{"story":"A as copied"}')
copy = buf.getvalue()
def lib():
    # M675: the device's own note of which library it holds (.epoch, written when a copy is brought back) names the
    # library and is not part of it — it is in no copy and is not counted here
    return sorted(os.path.relpath(os.path.join(r, n), '/tmp/cozy-restore-unit/lib') for r, d, fs in os.walk('/tmp/cozy-restore-unit/lib') for n in fs if '/backups' not in r and not (n == '.epoch' and r == '/tmp/cozy-restore-unit/lib'))
before = lib()
for label, data in [('not a zip', b'hello'), ('a path outside', None), ('no house book', None)]:
    if label == 'a path outside':
        b = io.BytesIO(); z = zipfile.ZipFile(b, 'w'); z.writestr('books/_house.json', '{}'); z.writestr('../escape.txt', 'x'); z.close(); data = b.getvalue()
    if label == 'no house book':
        b = io.BytesIO(); z = zipfile.ZipFile(b, 'w'); z.writestr('books/A.json', '{}'); z.close(); data = b.getvalue()
    r = serve.restore_backup(data)
    _ok = ( (not r['ok'] and lib() == before and not os.path.exists('/tmp/cozy-restore-unit/escape.txt')) ); say(_ok, label + ': refused, nothing touched — ' + r['why'][:60])
r = serve.restore_backup(copy)
_ok = ( r['ok'] ); say(_ok, 'the copy brought back:', r)
_ok = ( lib() == ['books/A.json', 'books/_house.json'] ); say(_ok, 'the library is the copy:', lib())
_ok = ( open('/tmp/cozy-restore-unit/lib/books/A.json').read() == '{"story":"A as copied"}' ); say(_ok, 'A reads as copied')
safety = os.path.join('/tmp/cozy-restore-unit/lib/backups', r['safety'])
names = zipfile.ZipFile(safety).namelist()
_ok = ( 'books/B.json' in names ); say(_ok, 'the library as it stood is kept first — B is in', r['safety'])
sys.exit(1 if fails else 0)
