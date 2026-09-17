#!/usr/bin/env python3
"""The device's read is idempotent with its fold (M295). No browser: HTTP only.

A page the pusher let go must stay gone even when the log it came from is
still beside the snapshot — a process kill between the snapshot's replace and
the log's removal leaves exactly that. And a page ANOTHER browser appended,
newer than what the pusher had seen, is still folded in (nothing is lost).

  python3 tests/foldcrash.py
"""
import json, os, shutil, subprocess, sys, time, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-foldcrash')
PORT = os.environ.get('COZY_TEST_PORT', '8102')
BASE = 'http://127.0.0.1:%s/' % PORT
TALE = 'tale-fold-crash'
fails = []


def check(name, ok, extra=''):
    print(('  ok   — ' if ok else '  FAIL — ') + name + ((' :: ' + extra) if extra else ''))
    if not ok:
        fails.append(name)


def call(method, path, body=None, headers=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=dict({'Content-Type': 'application/json'}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, None


def page(pid, text):
    return {'id': pid, 'storyId': TALE, 'role': 'assistant', 'text': text, 'ts': int(time.time() * 1000)}


def book(pages, stamp):
    return {'namespace': 'cozytavern.v1', 'kind': 'story', 'exportedAt': stamp, 'story': {'id': TALE, 'title': 'fold'}, 'settings': [], 'messages': pages}


def stamp_now(offset=0.0):
    t = time.time() + offset
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(t)) + '.%03dZ' % int((t % 1) * 1000)


def main():
    shutil.rmtree(DATA, ignore_errors=True); os.makedirs(DATA, exist_ok=True)
    srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=REPO)
    try:
        time.sleep(1.5)
        bp = os.path.join(DATA, 'books', TALE + '.json')
        lp = bp[:-5] + '.log'
        # A pushes the whole book with one page
        st1 = stamp_now()
        code, _ = call('POST', 'api/books/one/' + TALE, book([page('p1', 'one')], st1), {'X-Cozy-Client': 'browser-A'})
        check('A pushes a book', code == 200)
        # A appends p2, B appends p3 (B's page, unseen by A)
        code, ans = call('POST', 'api/books/page/' + TALE, {'m': page('p2', 'two')}, {'X-Cozy-Client': 'browser-A'})
        check('A appends a page', code == 200 and ans and ans.get('ok'), str(ans))
        time.sleep(0.05)
        code, ans = call('POST', 'api/books/page/' + TALE, {'m': page('p3', 'three, from B')}, {'X-Cozy-Client': 'browser-B'})
        check('B appends a page', code == 200 and ans and ans.get('ok'), str(ans))
        log_lines = open(lp, encoding='utf-8').read()
        check('both ride the log', log_lines.count('\n') == 2)
        # A lets p2 go and pushes its whole book: p1 only, base = the stamp A last pulled (before B's page)
        st2 = stamp_now()
        code, _ = call('POST', 'api/books/one/' + TALE, book([page('p1', 'one')], st2), {'X-Cozy-Client': 'browser-A', 'X-Cozy-Base': st1})
        check('A pushes without p2', code == 200)
        code, got = call('GET', 'api/books/one/' + TALE)
        ids = [m['id'] for m in got['messages']]
        check('after the fold: p2 stays gone, B’s p3 is kept', ids == ['p1', 'p3'], str(ids))
        check('the log was folded away', not os.path.exists(lp))
        snap = json.load(open(bp, encoding='utf-8'))
        check('the snapshot remembers who pushed it and what they had seen', snap.get('pushedBy') == 'browser-A' and snap.get('pushedBase') == st1, str({k: snap.get(k) for k in ('pushedBy', 'pushedBase')}))
        # --- the kill window: the log is still there beside the new snapshot ---
        with open(lp, 'w', encoding='utf-8') as f:
            f.write(log_lines)
        code, got = call('GET', 'api/books/one/' + TALE)
        ids = [m['id'] for m in got['messages']]
        check('a read with the old log still beside the snapshot puts no let-go page back (p2 stays gone)', 'p2' not in ids, str(ids))
        check('and still keeps B’s page', 'p3' in ids, str(ids))
        # a genuinely new line by B after the push is folded in too
        time.sleep(0.05)
        code, ans = call('POST', 'api/books/page/' + TALE, {'m': page('p4', 'four, from B, later')}, {'X-Cozy-Client': 'browser-B'})
        code, got = call('GET', 'api/books/one/' + TALE)
        ids = [m['id'] for m in got['messages']]
        check('a page B appends after A’s push is read (nothing lost)', ids == ['p1', 'p3', 'p4'], str(ids))
        # the manifest still reports the newest stamp
        code, man = call('GET', 'api/books/list')
        mine = [b for b in man['books'] if b['id'] == TALE]
        check('the manifest still stamps the tale', bool(mine) and mine[0]['exportedAt'] >= st2, str(mine))
    finally:
        srv.terminate()
    print()
    print(('%d checks failed: ' % len(fails)) + ', '.join(fails) if fails else 'the fold is idempotent: all green')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
