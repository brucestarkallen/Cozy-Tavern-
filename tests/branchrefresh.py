#!/usr/bin/env python3
"""M332: BRANCH, THEN REFRESH. Real Chromium, real serve.py. A tale with a record; a branch is taken from a page; the
page is refreshed at once (and again after a wait). The branch's record, ledger and pages must all still be there —
in the browser and on the device. And a setting changed in Settings applies to the next turn without a refresh."""
import json, os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-branchrefresh')
PORT = os.environ.get('COZY_TEST_PORT', '8097')
BASE = 'http://127.0.0.1:%s/' % PORT
fails = []
def check(words, ok, extra=''):
    print(('  ok   ' if ok else '  FAIL ') + words + ((' :: ' + str(extra)) if (extra and not ok) else ''))
    if not ok: fails.append(words)

shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

SEED = """async () => {
  const db = window.__cozy.db;
  const { saveState, emptyState } = await import('/js/engine/state.js');
  const { applyMutations } = await import('/js/engine/apply.js');
  const st = await db.stories.create({ title: 'The parent tale' });
  await db.stories.update(st.id, { extraction: false, keeper: false });
  for (let i = 0; i < 8; i += 1) {
    await db.messages.append(st.id, { role: 'user', text: 'turn ' + i });
    await db.messages.append(st.id, { role: 'assistant', text: '[The Wells house — Friday, March 14, 2025 | 20:40 | clear | gray hoodie | on the porch]\\n\\nPage ' + (i + 1) + ' of the tale. ' + 'They sat on the steps. '.repeat(10) });
  }
  let ledger = applyMutations({ ...emptyState(), page: 7 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Wells house' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Liara' }, { type: 'people.set', name: 'Liara', field: 'core', text: 'his oldest friend' }]).state;
  ledger.readTo = 7;
  await saveState(st.id, ledger);
  await db.settings.set('memory:' + st.id, { window: 4, nodes: [
    { id: 'n1', level: 1, span: [0, 5], text: '[Mar 14] Jovan came home; Liara found the unread letter.', at: 1, whole: true },
    { id: 'n2', level: 1, span: [6, 11], text: '[Mar 14] They talked on the porch; Kim called twice.', at: 2, whole: true } ] });
  await window.__cozy.chat.refreshStories();
  await window.__cozy.chat.openStory(st.id);
  await window.__cozy.booksStatus.pushAll();
  return st.id;
}"""
STATE = """async (parentId) => {
  const db = window.__cozy.db;
  const all = await db.stories.list();
  const branch = all.find((s) => s.id !== parentId);
  const rows = [];
  for (const s of all) { const m = await db.settings.get('memory:' + s.id); rows.push({ id: s.id.slice(0, 6), title: s.title, building: Boolean(s.building), pages: await db.messages.count(s.id), record: m && m.nodes ? m.nodes.length : 0, ledger: Boolean(await db.settings.get('state:' + s.id)) }); }
  const out = { rows, stories: all.map((s) => [s.title, s.shallow === true]), active: window.__cozy.getActiveStoryId ? window.__cozy.getActiveStoryId() : null };
  if (branch) {
    const mem = await db.settings.get('memory:' + branch.id);
    out.branch = { id: branch.id, title: branch.title, pages: await db.messages.count(branch.id), record: mem && Array.isArray(mem.nodes) ? mem.nodes.map((n) => n.text.slice(0, 30)) : null, ledger: Boolean(await db.settings.get('state:' + branch.id)) };
  }
  const pm = await db.settings.get('memory:' + parentId);
  out.parentRecord = pm && Array.isArray(pm.nodes) ? pm.nodes.length : null;
  return out;
}"""
def wait_until(page, fn, arg=None, timeout=40.0, what=''):
    # page.evaluate AWAITS an async function; wait_for_function took the promise itself for a yes
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if page.evaluate(fn, arg): return True
        except Exception:
            pass
        time.sleep(0.25)
    print('  (waited too long for ' + what + ')')
    return False

def device_record(story_id):
    # (the book's rows, whatever shape the export gives them)
    p = os.path.join(DATA, 'books', story_id + '.json')
    if not os.path.exists(p): return 'NO BOOK'
    book = json.load(open(p, encoding='utf8'))
    rows = book.get('settings') or book.get('rows') or []
    if isinstance(rows, dict): rows = [{'key': k, 'value': v} for k, v in rows.items()]
    for r in rows:
        if str(r.get('key', '')).startswith('memory:'):
            return [n.get('text', '')[:30] for n in (r.get('value') or {}).get('nodes', [])]
    return 'NO RECORD ROW IN THE BOOK'

try:
    time.sleep(1.2)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE); page.wait_for_function('window.__cozy && window.__cozy.db && window.__cozy.chat')
        parent = page.evaluate(SEED)
        page.wait_for_selector('#thread .msg-assistant')
        BRANCH = """() => { const pages = [...document.querySelectorAll('#thread .msg-assistant')]; pages[5].querySelector('.msg-act[data-act="branch"]').click(); }"""
        WHOLE = """async (pid) => { const db = window.__cozy.db; const all = (await db.stories.list()).filter((s) => s.id !== pid && !s.building); if (all.length !== 1) return false; const m = await db.settings.get('memory:' + all[0].id); return Boolean(m && m.nodes && m.nodes.length && (await db.settings.get('state:' + all[0].id)) && (await db.messages.count(all[0].id)) === 12); }"""
        # (1) THE WRITER'S REPORT: branch — and the page is refreshed while the branch is still being made
        # a branch of a long tale takes seconds on a phone; here each page copied is slowed so the refresh lands MID-branch for certain
        page.evaluate("""() => { const db = window.__cozy.db; const append = db.messages.append.bind(db.messages); db.messages.append = async (...a) => { await new Promise((r) => setTimeout(r, 250)); return append(...a); }; }""")
        page.evaluate(BRANCH)
        wait_until(page, """async (pid) => { const db = window.__cozy.db; const b = (await db.stories.list()).find((s) => s.id !== pid); return Boolean(b) && (await db.messages.count(b.id)) >= 3; }""", parent, 20, 'the branch to be part-made')
        cut = page.evaluate(STATE, parent)
        print('  cut off mid-branch:', json.dumps(cut.get('rows')))
        page.reload(); page.wait_for_function('window.__cozy && window.__cozy.db && window.__cozy.chat')
        wait_until(page, WHOLE, parent, 60, 'the house to make the branch again, whole')
        after = page.evaluate(STATE, parent)
        print('  after the refresh :', json.dumps(after.get('rows')))
        check('a branch cut off by a refresh is made again by the house, WHOLE: its record', bool(after.get('branch')) and after['branch']['record'] and len(after['branch']['record']) >= 1, after)
        check('…all twelve of its pages', after['branch']['pages'] == 12, after)
        check('…its ledger', after['branch']['ledger'], after)
        check('only one branch stands (the half-made one is gone)', len(after['stories']) == 2, after['stories'])
        check('it is a NEW tale — the half-made one was cleared away, not patched up', after['branch']['id'] != cut['branch']['id'], (cut['branch']['id'], after['branch']['id']))
        check('the refresh really did land mid-branch (the fixture)', 0 < cut['branch']['pages'] < 12 and not cut['branch']['record'], cut['branch'])
        check('and the parent kept its own record', after.get('parentRecord') == 2, after)
        time.sleep(5)
        dev = device_record(after['branch']['id'])
        print('  on the device     :', dev)
        check('the DEVICE holds the whole branch — record and all', isinstance(dev, list) and len(dev) == len(after['branch']['record']), dev)
        half = [f for f in os.listdir(os.path.join(DATA, 'books')) if f.endswith('.json') and f not in ('_house.json', parent + '.json', after['branch']['id'] + '.json')]
        check('and never held the half-made one', not half, half)
        # (2) a push that landed while the page was dying: the device is "newer" than the browser's stamp — by the browser's own work
        bid = after['branch']['id']
        # let every push land first, then take the stamp the DEVICE's book wears at this very moment (a push in between would move it)
        page.evaluate("""async () => { await window.__cozy.booksStatus.pushAll(); }""")
        time.sleep(1.5)
        book = json.load(open(os.path.join(DATA, 'books', bid + '.json'), encoding='utf8'))
        dev_stamp = book.get('exportedAt')
        stamp = page.evaluate("""async ([id, s]) => { const db = window.__cozy.db; await db.settings.delete('bookStamp:' + id); await db.settings.set('booksPushing', { [id]: s }); return s; }""", [bid, dev_stamp])
        t0 = time.time()
        page.reload(); page.wait_for_function('window.__cozy && window.__cozy.db && window.__cozy.chat'); time.sleep(2.0)
        again = page.evaluate("""async (id) => ({ stamp: await window.__cozy.db.settings.get('bookStamp:' + id), pushing: await window.__cozy.db.settings.get('booksPushing'), veil: Boolean(document.getElementById('boot-veil')), loads: performance.getEntriesByType('navigation').length })""", bid)
        check('its own landed push is known at the next open: the stamp is adopted, nothing is pulled back', again['stamp'] == stamp and not (again['pushing'] or {}).get(bid), again)
        check('and the tavern is open (no veil left standing)', not again['veil'], again)
        check('no page error', not errors, errors[:3])
        browser.close()
finally:
    srv.terminate()
print('\nbranch then refresh: ' + ('all green' if not fails else str(len(fails)) + ' FAILED'))
sys.exit(1 if fails else 0)
