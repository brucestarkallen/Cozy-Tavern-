#!/usr/bin/env python3
"""M507: A PAGE APPENDED MOVES THE BOOK'S STAMP, NOT ITS LEDGER. Real Chromium, real serve.py.

The device stamps a book with its newest appended page, so a book this browser pushed looks newer the moment a page
lands. Before M507, when the whole push carrying the newer ledger had not landed (the app closed within its twenty
seconds), the next open pulled the book and wrote the snapshot's OLDER state over the browser's newer one. Now such a
pull takes the pages only. A snapshot pushed by another browser since is newer and is still taken whole.

  python3 tests/bootpull.py
"""
import json, os, shutil, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-bootpull')
PORT = os.environ.get('COZY_TEST_PORT', '8098')
BASE = f'http://127.0.0.1:{PORT}'
checks = []


def ok(cond, what):
    checks.append((bool(cond), what))
    print(('  ok   ' if cond else '  FAIL ') + what)


SEED = '''async () => {
  const { db } = await import('/js/store.js');
  const { applyMutations } = await import('/js/engine/apply.js');
  const { saveState, emptyState, snapshotState, markPageRead } = await import('/js/engine/state.js');
  await db.settings.set('welcomeSeen', true);
  const st = await db.stories.create({ title: 'boot pull' });
  let state = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the kitchen' }, { type: 'presence.enter', name: 'Jovan' }]).state;
  let k = 0;
  for (let i = 0; i < 8; i += 1) {
    const role = i % 2 ? 'assistant' : 'user';
    const saved = await db.messages.append(st.id, { role, text: (role === 'assistant' ? '[the kitchen — Monday, March 3, 2025 | 09:0' + i + ' | clear | coat | by the door]\\n\\n' : '') + 'page ' + i + ' of the tale.' });
    state.page = k;
    if (role === 'user') { await snapshotState(st.id, saved.id, state); continue; }
    state = applyMutations(state, [{ type: 'presence.enter', name: 'Guest' + i + ' Hale' }]).state;
    markPageRead(state, k); k += 1;
    await saveState(st.id, state);
  }
  await db.settings.set('activeStoryId', st.id);
  return st.id;
}'''

PROBE = '''async (sid) => {
  const { db } = await import('/js/store.js');
  const { loadState } = await import('/js/engine/state.js');
  const st = await loadState(sid);
  return { people: st.present.map((p) => p.name), pages: (await db.messages.list(sid)).length, stamp: (await db.settings.get('bookStamp:' + sid)) || '' };
}'''


def device_book(sid):
    with urllib.request.urlopen(f'{BASE}/api/books/one/{sid}') as r:
        return json.loads(r.read())


def main():
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA, exist_ok=True)
    env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
    srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.5)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(service_workers='block')
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(BASE + '/')
            page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000)
            sid = page.evaluate(SEED)
            time.sleep(25)  # the whole book lands (twenty seconds after the last write)
            book = device_book(sid)
            state_row = next(r for r in book['settings'] if r['key'] == 'state:' + sid)
            ok(len(book['messages']) == 8 and 'Guest7 Hale' in [q['name'] for q in state_row['value']['present']], 'the device holds the whole book: eight pages, the ledger to page seven')
            # the next turn: a page lands (appended at once) and the ledger moves on — but the whole push never lands
            page.route('**/api/books/one/*', lambda route: route.abort() if route.request.method == 'POST' else route.continue_())
            page.evaluate('''async (sid) => {
              const { db } = await import('/js/store.js');
              const { applyMutations } = await import('/js/engine/apply.js');
              const { saveState, loadState } = await import('/js/engine/state.js');
              await db.messages.append(sid, { role: 'user', text: 'page 8, the writer' });
              await db.messages.append(sid, { role: 'assistant', text: '[the kitchen — Monday, March 3, 2025 | 09:30 | clear | coat | by the door]\\n\\npage 9: Newcomer Vale walks in.' });
              const st = await loadState(sid); st.page = 4;
              const next = applyMutations(st, [{ type: 'presence.enter', name: 'Newcomer Vale' }]).state;
              await saveState(sid, next);
              /* the readers finished the page: its version checkpoint stands (else the next open re-reads it, by M127) */
              const { saveVersionStates } = await import('/js/engine/state.js');
              const last = (await db.messages.list(sid)).filter((m) => m.role === 'assistant').pop();
              await saveVersionStates(sid, { [last.id + ':0']: JSON.parse(JSON.stringify(next)) });
            }''', sid)
            time.sleep(3)  # the two pages are appended to the device's log; the whole push (twenty seconds) is blocked
            before = page.evaluate(PROBE, sid)
            ok('Newcomer Vale' in before['people'] and before['pages'] == 10, 'the browser holds the newer ledger and ten pages')
            log = device_book(sid)
            ok(len(log['messages']) == 10 and 'Newcomer Vale' not in [q['name'] for q in next(r for r in log['settings'] if r['key'] == 'state:' + sid)['value']['present']], 'the device holds the ten pages (appended) but the OLDER ledger (the whole push never landed)')
            ok(log.get('snapshotAt') and log['exportedAt'] > log['snapshotAt'], 'the served book carries the snapshot’s own stamp beside the moved one')
            # the app closes and opens again: the page-hide push is blocked too
            page.reload()
            page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000)
            time.sleep(6)
            after = page.evaluate(PROBE, sid)
            ok('Newcomer Vale' in after['people'], 'after the open the browser STILL holds its newer ledger — the pull took only the pages')
            ok(after['pages'] == 10, 'and all ten pages')
            ok(after['stamp'] and after['stamp'] >= log['exportedAt'], 'the browser recorded the device’s moved stamp, so it is not pulled again')
            # now let the whole push land, and open once more
            page.unroute('**/api/books/one/*')
            page.evaluate('''async (sid) => { const { db } = await import('/js/store.js'); const { saveState, loadState } = await import('/js/engine/state.js'); await saveState(sid, await loadState(sid)); }''', sid)
            time.sleep(25)
            landed = device_book(sid)
            ok('Newcomer Vale' in [q['name'] for q in next(r for r in landed['settings'] if r['key'] == 'state:' + sid)['value']['present']], 'the whole push carried the newer ledger to the device')
            page.reload(); page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000); time.sleep(4)
            again = page.evaluate(PROBE, sid)
            ok('Newcomer Vale' in again['people'] and again['pages'] == 10, 'and the next open keeps it')
            # ANOTHER browser's newer whole push is still taken whole: a book with a later snapshot and a different ledger
            other = dict(landed)
            other['exportedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(time.time() + 5)) + '.000Z'
            other.pop('snapshotAt', None)
            for r in other['settings']:
                if r['key'] == 'state:' + sid:
                    r['value']['present'] = [q for q in r['value']['present'] if q['name'] != 'Newcomer Vale'] + [{'name': 'Other Browser'}]
            req = urllib.request.Request(f'{BASE}/api/books/one/{sid}', data=json.dumps(other).encode(), method='POST', headers={'content-type': 'application/json', 'x-cozy-client': 'tab-other'})
            urllib.request.urlopen(req).read()
            page.reload(); page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000); time.sleep(6)
            theirs = page.evaluate(PROBE, sid)
            ok('Other Browser' in theirs['people'] and 'Newcomer Vale' not in theirs['people'], 'a newer snapshot from another browser is taken whole, as before (last push wins on the ledger)')
            ok(not errors, 'no page errors: ' + ' | '.join(errors[:2]))
            browser.close()
    finally:
        srv.terminate()
    failed = [w for c, w in checks if not c]
    print('boot pull: ' + ('all green' if not failed else str(len(failed)) + ' FAILED'))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
