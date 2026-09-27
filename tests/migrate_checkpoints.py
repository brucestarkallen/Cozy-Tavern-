#!/usr/bin/env python3
"""M507-7: A STORE FROM BEFORE M507 MOVES ITS CHECKPOINTS TO THE NEW ROWS ON ITS FIRST SEND, NOTHING LOST. Real Chromium,
real serve.py, the real app's send. His stores hold `snapshots:<tale>` as one list of checkpoints and `versionState:<tale>`
as one map of version ledgers; after one send both live one to a row with an index, every checkpoint reads back whole,
the whole push carries the new rows to the device, and the old rows are gone.

  python3 tests/migrate_checkpoints.py
"""
import json, os, shutil, subprocess, sys, time, threading, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import perf_send as P
from playwright.sync_api import sync_playwright

DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-migrate')
PORT = os.environ.get('COZY_TEST_PORT', '8099')
FAKE = int(os.environ.get('FAKE_PORT', '8199'))
checks = []


def ok(cond, what):
    checks.append((bool(cond), what))
    print(('  ok   ' if cond else '  FAIL ') + what)


TO_LEGACY = '''async () => {
  const { db } = await import('/js/store.js');
  const { loadSnapshots, loadVersionStates } = await import('/js/engine/state.js');
  const sid = await db.settings.get('activeStoryId');
  const snaps = await loadSnapshots(sid);
  const versions = await loadVersionStates(sid);
  const originals = { snaps: Object.fromEntries(snaps.map((e) => [e.id, JSON.stringify(e.snap, Object.keys(e.snap).sort())])), versions: Object.fromEntries(Object.entries(versions).map(([k, v]) => [k, JSON.stringify(v, Object.keys(v).sort())])) };
  /* the store as it was before M507: one list of whole checkpoints, one map of whole version ledgers, no rows */
  await db.settings.set('snapshots:' + sid, snaps.map((e) => ({ id: e.id, snap: e.snap, at: e.at })));
  await db.settings.set('versionState:' + sid, versions);
  const rows = (await db.settings.keys()).filter((k) => k.endsWith(':' + sid) && (k.startsWith('snap:') || k.startsWith('ver:') || k.startsWith('ckptBankPart:')));
  await db.settings.deleteMany(rows);
  await db.settings.delete('ckptBank:' + sid);
  return { sid, snaps: snaps.length, versions: Object.keys(versions).length, originals };
}'''

AFTER = '''async ([sid, originals]) => {
  const { db } = await import('/js/store.js');
  const { loadSnapshots, loadVersionStates, versionStateOf } = await import('/js/engine/state.js');
  const keys = (await db.settings.keys()).filter((k) => k.endsWith(':' + sid));
  const snapIndex = await db.settings.get('snapshots:' + sid);
  const verIndex = await db.settings.get('versionState:' + sid);
  const snapRows = keys.filter((k) => k.startsWith('snap:'));
  const verRows = keys.filter((k) => k.startsWith('ver:'));
  const snaps = await loadSnapshots(sid);
  let snapsWhole = 0; let snapsChanged = [];
  for (const e of snaps) { const o = originals.snaps[e.id]; if (o === undefined) continue; if (o === JSON.stringify(e.snap, Object.keys(e.snap).sort())) snapsWhole += 1; else snapsChanged.push(e.id); }
  const versions = await loadVersionStates(sid);
  let versionsWhole = 0; let versionsChanged = [];
  for (const [k, v] of Object.entries(versions)) { const o = originals.versions[k]; if (o === undefined) continue; if (o === JSON.stringify(v, Object.keys(v).sort())) versionsWhole += 1; else versionsChanged.push(k); }
  const oneOld = Object.keys(originals.versions)[0];
  const one = await versionStateOf(sid, oneOld);
  return { snapIndexIsIndex: Array.isArray(snapIndex) && snapIndex.every((e) => !('snap' in e)), snapIndexLen: snapIndex.length, snapRows: snapRows.length,
    verIndexIsArray: Array.isArray(verIndex), verIndexLen: verIndex.length, verRows: verRows.length,
    snapsWhole, snapsChanged, snapsTotal: Object.keys(originals.snaps).length, versionsWhole, versionsChanged, versionsTotal: Object.keys(originals.versions).length,
    oneOldWhole: one ? originals.versions[oneOld] === JSON.stringify(one, Object.keys(one).sort()) : false,
    bankParts: keys.filter((k) => k.startsWith('ckptBankPart:')).length };
}'''


def device_book(sid):
    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/books/one/{sid}') as r:
        return json.loads(r.read())


def main():
    fake = P.Threaded(('127.0.0.1', FAKE), P.Fake)
    threading.Thread(target=fake.serve_forever, daemon=True).start()
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA, exist_ok=True)
    env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
    srv = subprocess.Popen([sys.executable, os.path.join(P.REPO, 'serve.py')], env=env, cwd=P.REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.5)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{PORT}/')
            page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000)
            seeded = page.evaluate(P.SEED, [f'http://127.0.0.1:{FAKE}', 80, 120, False])
            legacy = page.evaluate(TO_LEGACY)
            sid = legacy['sid']
            ok(legacy['snaps'] >= 40 and legacy['versions'] >= 40, 'a tale with %d boundary checkpoints and %d version ledgers, stored the old way' % (legacy['snaps'], legacy['versions']))
            time.sleep(25)  # the old-shaped book lands on the device
            book = device_book(sid)
            keys = [r['key'] for r in book['settings']]
            ok(('snapshots:' + sid) in keys and not any(k.startswith('snap:') for k in keys), 'the device holds the old-shaped book')
            page.reload()
            page.wait_for_function('window.__cozy && window.__cozy.chat', timeout=30000)
            page.wait_for_function('!window.__cozy.chat.isBusy()', timeout=60000)
            time.sleep(5)
            cdp = ctx.new_cdp_session(page)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': P.THROTTLE})
            page.evaluate(P.WATCH)
            page.fill('#composer-input', 'I walk into the kitchen. PERF-SEND-MARK')
            page.evaluate("window.__send.t0 = performance.now(); document.getElementById('composer').requestSubmit()")
            page.wait_for_function('window.__send.done !== null', timeout=300000, polling=100)
            first = page.evaluate('({ request: Math.round(window.__send.request), done: Math.round(window.__send.done), worst: Math.round(Math.max(0, ...window.__send.long.map((e) => e.ms))) })')
            page.wait_for_function('''async () => { const { queuedCount, workIsRunning } = await import('/js/agents/queue.js'); const { db } = await import('/js/store.js'); const sid = await db.settings.get('activeStoryId'); return queuedCount(sid) === 0 && !workIsRunning(sid) && !window.__cozy.chat.isBusy(); }''', timeout=300000, polling=300)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
            time.sleep(2)
            after = page.evaluate(AFTER, [sid, legacy['originals']])
            ok(after['snapIndexIsIndex'] and after['snapRows'] == after['snapIndexLen'] and after['snapIndexLen'] >= legacy['snaps'], 'the boundary checkpoints moved to their rows: index %d, rows %d' % (after['snapIndexLen'], after['snapRows']))
            ok(after['verIndexIsArray'] and after['verRows'] == after['verIndexLen'] and after['verIndexLen'] >= min(60, legacy['versions']), 'the version ledgers moved to their rows: index %d, rows %d' % (after['verIndexLen'], after['verRows']))
            ok(after['snapsWhole'] == after['snapsTotal'] and not after['snapsChanged'], 'every old boundary checkpoint reads back whole: %d of %d (changed: %s)' % (after['snapsWhole'], after['snapsTotal'], after['snapsChanged'][:3]))
            ok(after['versionsWhole'] == after['versionsTotal'] and not after['versionsChanged'], 'every old version ledger reads back whole: %d of %d (changed: %s)' % (after['versionsWhole'], after['versionsTotal'], after['versionsChanged'][:3]))
            ok(after['oneOldWhole'], 'one old version asked alone is whole')
            ok(first['request'] < 6000 and first['worst'] < 3000, 'the first send with the move in it: request out at %d ms, worst freeze %d ms, done at %d ms (CPU 6x)' % (first['request'], first['worst'], first['done']))
            time.sleep(25)  # the whole push carries the new rows
            book2 = device_book(sid)
            keys2 = [r['key'] for r in book2['settings']]
            ok(any(k.startswith('snap:') for k in keys2) and any(k.startswith('ver:') for k in keys2), 'the device holds the new rows')
            snapshots_row = next((r for r in book2['settings'] if r['key'] == 'snapshots:' + sid), None)
            ok(snapshots_row is not None and all('snap' not in e for e in snapshots_row['value']), 'and the index in place of the old list')
            ok(not errors, 'no page errors: ' + ' | '.join(errors[:2]))
            browser.close()
    finally:
        srv.terminate()
        fake.shutdown()
    failed = [w for c, w in checks if not c]
    print('the move to rows: ' + ('all green' if not failed else str(len(failed)) + ' FAILED'))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
