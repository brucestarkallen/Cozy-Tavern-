#!/usr/bin/env python3
"""M183: a page appended, against a whole book rewritten — and the fold read
back true. Run against the real serve.py."""
import json, os, shutil, subprocess, sys, time, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-append')
PORT = os.environ.get('COZY_TEST_PORT', '8087')
BASE = 'http://127.0.0.1:%s/' % PORT

shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')],
                       env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

fails = []


def check(name, ok, extra=''):
    print(('  ok   — ' if ok else '  FAIL — ') + name + ((' :: ' + extra) if extra else ''))
    if not ok:
        fails.append(name)


def post(p, b, who=''):
    h = {'X-Cozy-Client': who} if who else {}
    return urllib.request.urlopen(urllib.request.Request(BASE + p, data=b, method='POST', headers=h)).read()


def get(p):
    return urllib.request.urlopen(BASE + p).read()



def small3(ids, book_id='t3'):
    return json.dumps({'namespace': 'cozytavern.v1', 'kind': 'story', 'exportedAt': '2026-01-01T00:00:00.000Z',
                       'story': {'id': book_id, 'title': 'T'}, 'settings': [],
                       'messages': [{'id': i, 'text': 'page ' + i} for i in ids]}).encode()


page = 'The rain kept on against the shutters and nobody said the thing they meant. ' * 80


def book(n):
    return json.dumps({
        'namespace': 'cozytavern.v1', 'kind': 'story', 'exportedAt': '2026-01-01T00:00:00.000Z',
        'story': {'id': 't1', 'title': 'A long telling', 'createdAt': 1, 'updatedAt': 2},
        'settings': [{'key': 'state:t1', 'value': {'journal': [0] * 4000}}],
        'messages': [{'id': 'm%d' % i, 'storyId': 't1', 'role': 'assistant', 'text': page} for i in range(n)],
    }).encode()


try:
    post('api/books/one/t1', book(400))
    whole = book(400)
    t0 = time.perf_counter()
    for _ in range(10):
        post('api/books/one/t1', whole)
    w = (time.perf_counter() - t0) / 10 * 1000
    t0 = time.perf_counter()
    for i in range(10):
        post('api/books/page/t1', json.dumps({'at': 'x', 'm': {'id': 'new%d' % i, 'storyId': 't1', 'role': 'assistant', 'text': page}}).encode())
    a = (time.perf_counter() - t0) / 10 * 1000
    print('  a 400-page tale, one new page lands:')
    print('     whole-book rewrite : %6.2f ms' % w)
    print('     one page appended  : %6.2f ms   (%.0fx cheaper)' % (a, w / a))
    check('appending is far cheaper than rewriting', a * 4 < w, '%.2f vs %.2f ms' % (a, w))

    merged = json.loads(get('api/books/one/t1'))
    check('the read folds the log in', len(merged['messages']) == 410, '%d messages' % len(merged['messages']))
    check('the appended pages are whole', merged['messages'][-1]['text'] == page)
    check('and the older ones untouched', merged['messages'][0]['id'] == 'm0')
    man = json.loads(get('api/books/list'))
    stamp = [b['exportedAt'] for b in man['books'] if b['id'] == 't1'][0]
    check('the manifest reports the log’s stamp, not the snapshot’s',
          stamp == merged['exportedAt'] and stamp > '2026-01-01', '%s' % stamp)

    # a torn last line — a phone killed mid-append — must not cost the rest
    with open(os.path.join(DATA, 'books', 't1.log'), 'a') as f:
        f.write('{"at":"x","m":{"id":"torn","tex')
    merged2 = json.loads(get('api/books/one/t1'))
    check('a torn last line is skipped, the rest still read', len(merged2['messages']) == 410, '%d messages' % len(merged2['messages']))

    # a full push folds the log in and clears it
    post('api/books/one/t1', book(410))
    check('a whole-book push clears the log it now contains',
          not os.path.exists(os.path.join(DATA, 'books', 't1.log')))

    # a page for a tale the device has never seen is refused, not orphaned
    ans = json.loads(post('api/books/page/never-seen', json.dumps({'at': 'x', 'm': {'id': 'a'}}).encode()))
    check('a page with no book under it is refused, so the browser sends the whole tale',
          ans.get('ok') is False and ans.get('whole') is True, str(ans))

    # M184: two browsers, each appending, and one pushing its whole book
    shutil.rmtree(os.path.join(DATA, 'books'), ignore_errors=True)

    def small(ids):
        return json.dumps({'namespace': 'cozytavern.v1', 'kind': 'story', 'exportedAt': '2026-01-01T00:00:00.000Z',
                           'story': {'id': 't2', 'title': 'T'}, 'settings': [],
                           'messages': [{'id': i, 'text': 'page ' + i} for i in ids]}).encode()

    post('api/books/one/t2', small(['m0', 'm1']))
    post('api/books/page/t2', json.dumps({'at': 'x', 'm': {'id': 'A-new', 'text': "Opera's page"}}).encode())
    post('api/books/page/t2', json.dumps({'at': 'x', 'm': {'id': 'B-new', 'text': "Chrome's page"}}).encode())
    both = [m['id'] for m in json.loads(get('api/books/one/t2'))['messages']]
    check('both browsers’ appended pages are on the device', both == ['m0', 'm1', 'A-new', 'B-new'], str(both))
    # Opera's twenty-second whole-book push lands, and its copy has not yet
    # caught Chrome's page
    post('api/books/one/t2', small(['m0', 'm1', 'A-new']))
    after = [m['id'] for m in json.loads(get('api/books/one/t2'))['messages']]
    check('a whole book never sweeps away another browser’s page', 'B-new' in after, str(after))
    check('and does not double the ones it already held', after.count('A-new') == 1, str(after))

    # M185: a page the writer let go must not come back out of the log
    shutil.rmtree(os.path.join(DATA, 'books'), ignore_errors=True)
    post('api/books/one/t3', small3(['m0', 'm1']), 'opera')
    post('api/books/page/t3', json.dumps({'at': 'x', 'm': {'id': 'm2', 'text': 'a page then deleted'}}).encode(), 'opera')
    landed = [m['id'] for m in json.loads(get('api/books/one/t3'))['messages']]
    check('the page lands', landed == ['m0', 'm1', 'm2'], str(landed))
    post('api/books/one/t3', small3(['m0', 'm1']), 'opera')       # the writer lets it go
    after_del = [m['id'] for m in json.loads(get('api/books/one/t3'))['messages']]
    check('a page the writer let go stays gone', 'm2' not in after_del, str(after_del))

    # and the same push must still save a page ANOTHER browser appended
    post('api/books/one/t4', small3(['m0', 'm1'], 't4'), 'opera')
    post('api/books/page/t4', json.dumps({'at': 'x', 'm': {'id': 'A', 'text': "Opera's"}}).encode(), 'opera')
    post('api/books/page/t4', json.dumps({'at': 'x', 'm': {'id': 'B', 'text': "Chrome's"}}).encode(), 'chrome')
    post('api/books/one/t4', small3(['m0', 'm1', 'A'], 't4'), 'opera')
    after_race = [m['id'] for m in json.loads(get('api/books/one/t4'))['messages']]
    check('while another browser’s page still survives it', 'B' in after_race, str(after_race))

    # M186: two browsers appending in the same instant. A page line is
    # several kilobytes, far past the size a single write is atomic for —
    # interleaved, both lines are ruined and both pages lost.
    import threading
    shutil.rmtree(os.path.join(DATA, 'books'), ignore_errors=True)
    big = 'x' * 6000
    post('api/books/one/t5', json.dumps({'namespace': 'cozytavern.v1', 'kind': 'story',
         'exportedAt': '2026-01-01T00:00:00.000Z', 'story': {'id': 't5', 'title': 'T'},
         'settings': [], 'messages': []}).encode(), 'opera')

    def burst(who, n):
        for i in range(n):
            post('api/books/page/t5', json.dumps({'at': 'x', 'm': {'id': who + str(i), 'text': big}}).encode(), who)

    ts = [threading.Thread(target=burst, args=(w, 20)) for w in ('opera', 'chrome')]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    got = json.loads(get('api/books/one/t5'))['messages']
    check('forty pages appended by two browsers at once all arrive', len(got) == 40, '%d read back' % len(got))
    check('and every one of them is whole', all(len(m.get('text', '')) == 6000 for m in got))

    # M186: a log that grows past its cap is folded into the snapshot on the spot
    shutil.rmtree(os.path.join(DATA, 'books'), ignore_errors=True)
    post('api/books/one/t6', json.dumps({'namespace': 'cozytavern.v1', 'kind': 'story',
         'exportedAt': '2026-01-01T00:00:00.000Z', 'story': {'id': 't6', 'title': 'T'},
         'settings': [], 'messages': []}).encode(), 'opera')
    huge = 'y' * 120000
    for i in range(24):                       # ~2.9 MB of pages, past the 2 MB cap
        post('api/books/page/t6', json.dumps({'at': 'x', 'm': {'id': 'p%d' % i, 'text': huge}}).encode(), 'opera')
    lp = os.path.join(DATA, 'books', 't6.log')
    logsize = os.path.getsize(lp) if os.path.exists(lp) else 0
    check('a log past its cap is folded into the snapshot, not left to grow',
          logsize < 2 * 1024 * 1024, '%d bytes left in the log' % logsize)
    kept = json.loads(get('api/books/one/t6'))['messages']
    check('and every page survives the folding', len(kept) == 24, '%d pages' % len(kept))
finally:
    srv.terminate()

print()
print('the append log: sound' if not fails else 'FAILED: ' + ', '.join(fails))
sys.exit(1 if fails else 0)
