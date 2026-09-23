#!/usr/bin/env python3
"""M313: THE BROWSER HOLDS THE OPEN TALE; THE DEVICE HOLDS THE LIBRARY. Real Chromium, real serve.py.

Three tales with pages, a ledger and checkpoints. The one that is open stays whole. The others are
let go from the browser — only once the device is proven to hold all of them — and come back,
page for page and ledger for ledger, when they are opened. A tale holding something the device
lacks is never let go: it is pushed first."""
import json, os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-holdsone')
PORT = os.environ.get('COZY_TEST_PORT', '8098')
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
  const ids = [];
  for (let t = 0; t < 3; t += 1) {
    const st = await db.stories.create({ title: 'Tale ' + (t + 1) });
    for (let i = 0; i < 5; i += 1) {
      await db.messages.append(st.id, { role: 'user', text: 'turn ' + i + ' of tale ' + (t + 1) });
      await db.messages.append(st.id, { role: 'assistant', text: '[The Wells house — Friday, March 14, 2025 | 20:40 | clear | gray hoodie | on the porch]\\n\\nPage ' + i + ' of tale ' + (t + 1) + '. ' + 'They talked until the street went quiet. '.repeat(20) });
    }
    /* a real ledger: the scene, the people, the world */
    const ledger = applyMutations({ ...emptyState(), page: 4 }, [
      { type: 'mc.set', name: 'Jovan' }, { type: 'clock.set', year: 2025, month: 3, day: 14, hour: 20, minute: 40 }, { type: 'place.set', name: 'The Wells house ' + (t + 1) },
      { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Liara', position: 'on the porch steps' },
      { type: 'people.set', name: 'Liara', field: 'core', text: 'his oldest friend, tale ' + (t + 1) },
      { type: 'rel.shift', name: 'Liara', axis: 'p', delta: 12, cause: 'he walked her home' },
      { type: 'offscreen.set', name: 'Kim', location: 'the 6:10 bus', activity: 'riding in', agenda: 'find Jovan', stance: 'toward', etaMinutes: 25 },
      { type: 'thread.set', title: 'Kim and the sighting', owner: 'Kim', heat: 'hot', next: 'confront him' },
      { type: 'knowledge.add', name: 'Liara', fact: 'saw Jovan leave the letter unread' },
    ]).state;
    await saveState(st.id, ledger);
    await db.settings.set('snapshots:' + st.id, [{ id: 'turn1', snap: { page: 1, filler: 'x'.repeat(200000) } }]);
    await db.settings.set('memory:' + st.id, { nodes: [{ id: 'n1', level: 1, span: [0, 3], text: 'Pages 1-4 of tale ' + (t + 1) }] });
    ids.push(st.id);
  }
  await window.__cozy.chat.refreshStories();
  await window.__cozy.chat.openStory(ids[0]);
  /* what the browser holds BEFORE anything is let go (the letting go may begin the moment the push lands) */
  const held = {};
  for (const id of ids) held[id] = { pages: await db.messages.count(id), ledger: await db.settings.get('state:' + id), snaps: Boolean(await db.settings.get('snapshots:' + id)) };
  await window.__cozy.booksStatus.pushAll();
  return { ids, held };
}"""
HELD = """async (id) => {
  const db = window.__cozy.db;
  const row = await db.stories.get(id);
  const raw = (store, key) => new Promise((res) => { const r = indexedDB.open('cozy-tavern'); r.onsuccess = () => { const d = r.result; const q = d.transaction(store).objectStore(store).get(key); q.onsuccess = () => { res(q.result); d.close(); }; q.onerror = () => { res(undefined); d.close(); }; }; });
  return { shallow: Boolean(row && row.shallow), pagesOnRow: row && row.pages, pages: await db.messages.count(id), state: JSON.stringify((await raw('settings', 'state:' + id) || {}).value || null), snaps: Boolean(await raw('settings', 'snapshots:' + id)), title: row && row.title };
}"""
try:
    time.sleep(1.5)
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 412, 'height': 915}, service_workers='block')
        ctx.add_init_script("globalThis.__cozyEvictEveryMs = 1200;")
        a = ctx.new_page()
        errors = []
        a.on('pageerror', lambda e: errors.append(str(e)))
        a.goto(BASE)
        a.wait_for_selector('#composer-input', timeout=30000)
        a.wait_for_timeout(1500)
        dbname = a.evaluate("async () => (await indexedDB.databases()).map((d) => d.name)")
        # M414: the tavern's own database by NAME — since M347 the browser also holds 'cozytavern.sent.v1' (the words each
        # page was sent), and it can list first: the first name read a database with no settings table and the probe died
        HELD = HELD.replace("'cozy-tavern'", json.dumps(next(n for n in dbname if n == 'cozytavern.v1')))
        seeded = a.evaluate(SEED)
        ids = seeded['ids']
        a.wait_for_timeout(2500)
        canon = lambda v: json.dumps(v if not isinstance(v, str) else json.loads(v), sort_keys=True)  # a ledger is compared value for value, whatever order its keys were written in
        files = {i: os.path.join(DATA, 'books', i + '.json') for i in ids}
        check('every tale’s book is on the device', all(os.path.exists(f) for f in files.values()))
        ledger_before = {i: canon(seeded['held'][i]['ledger']) for i in ids}
        check('fixture: the browser held all three whole', all(seeded['held'][i]['pages'] == 10 and seeded['held'][i]['snaps'] for i in ids), seeded['held'])
        bytes_before = {i: open(files[i], 'rb').read() for i in ids}
        # --- the two that are not open are let go, one at a time ---
        deadline = time.time() + 40
        while time.time() < deadline:
            h = [a.evaluate(HELD, i) for i in ids[1:]]
            if all(x['shallow'] for x in h): break
            a.wait_for_timeout(700)
        h1, h2, h3 = [a.evaluate(HELD, i) for i in ids]
        check('the tale that is OPEN is held whole, untouched', h1['pages'] == 10 and not h1['shallow'] and canon(h1['state']) == ledger_before[ids[0]] and h1['snaps'], h1)
        check('the two that are not open are let go from the browser: no pages, no ledger, no checkpoints here', all(x['shallow'] and x['pages'] == 0 and x['state'] == 'null' and not x['snaps'] for x in (h2, h3)), (h2, h3))
        check('their shelf rows still say who they are and how long they are', h2['title'] == 'Tale 2' and h2['pagesOnRow'] == 10 and h3['pagesOnRow'] == 10, (h2, h3))
        shelf = a.evaluate("() => [...document.querySelectorAll('#story-list .story-item, #story-list li')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim()).join(' || ')")
        check('and the shelf on screen still counts their pages', 'Tale 2' in shelf and shelf.count('10') >= 2, shelf[:300])
        check('nothing on the device was touched by the letting go', all(open(files[i], 'rb').read() == bytes_before[i] for i in ids[1:]))
        dev = json.loads(open(files[ids[1]], encoding='utf-8').read())
        check('the device holds every page and the whole ledger of a tale the browser let go', len(dev['messages']) == 10 and any(r['key'] == 'state:' + ids[1] and json.dumps(r['value'], separators=(',', ':')) for r in dev['settings']))
        # --- opened again: page for page, ledger for ledger ---
        a.evaluate("async (id) => { await window.__cozy.chat.openStory(id); }", ids[1])
        a.wait_for_timeout(1500)
        back = a.evaluate(HELD, ids[1])
        check('opened, it is whole again: ten pages', back['pages'] == 10 and not back['shallow'], back)
        check('and its ledger is the SAME ledger — the scene, the people, the world, value for value', canon(back['state']) == ledger_before[ids[1]], back['state'][:200])
        devrow = [r for r in dev['settings'] if r['key'] == 'state:' + ids[1]][0]['value']
        check('the same ledger the device kept all along', canon(devrow) == ledger_before[ids[1]])
        led = a.evaluate("async (id) => { const { loadState } = await import('/js/engine/state.js'); const s = await loadState(id); return { place: s.place && s.place.name, here: s.present.map((p) => p.name), liara: s.characters.Liara && s.characters.Liara.core, p: s.relationships.Liara && s.relationships.Liara.p, kim: s.offscreen.Kim && s.offscreen.Kim.location, threads: s.threads.map((t) => t.title), knows: (s.knowledge.Liara || []).map((k) => k.fact) }; }", ids[1])
        check('read through the engine: the ground, who is here, her page, her standing, Kim’s seat, the thread, what she knows', led == {'place': 'The Wells house 2', 'here': ['Jovan', 'Liara'], 'liara': 'his oldest friend, tale 2', 'p': 12, 'kim': 'the 6:10 bus', 'threads': ['Kim and the sighting'], 'knows': ['saw Jovan leave the letter unread']}, led)
        text = a.evaluate("() => document.querySelector('#thread').textContent")
        check('and its pages are on the screen', 'Page 4 of tale 2' in text, text[-200:])
        # --- the tale now behind it (tale 1) goes in its turn; a tale AHEAD of the device never does ---
        a.evaluate("""async (id) => {
          /* a row written straight into the store, as a write the push never learned of (a tab killed mid-turn) */
          const name = 'cozytavern.v1'; /* M414: the tavern's own database — never the first in the list (the sent words' database can list first) */
          await new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => { const d = r.result; const t = d.transaction('settings', 'readwrite'); t.objectStore('settings').put({ key: 'director:' + id, value: { note: 'written here, never pushed' } }); t.oncomplete = () => { d.close(); res(); }; }; });
        }""", ids[0])
        deadline = time.time() + 70   # the open marked the house; the evictor waits for that push (twenty seconds), then finds this tale ahead and pushes it at once
        pushed = False
        while time.time() < deadline:
            dev1 = json.loads(open(files[ids[0]], encoding='utf-8').read())
            pushed = any(r['key'] == 'director:' + ids[0] for r in dev1['settings'])
            if pushed: break
            a.wait_for_timeout(800)
        check('a tale holding something the device lacks is PUSHED, not let go: the row reaches the device', pushed)
        deadline = time.time() + 60   # looked at again half a minute after the push
        while time.time() < deadline:
            if a.evaluate(HELD, ids[0])['shallow']: break
            a.wait_for_timeout(800)
        gone = a.evaluate(HELD, ids[0])
        dev1 = json.loads(open(files[ids[0]], encoding='utf-8').read())
        check('and only then is it let go — with that row safe on the device', gone['shallow'] and any(r['key'] == 'director:' + ids[0] for r in dev1['settings']) and len(dev1['messages']) == 10, gone)
        # --- a second browser opens: the house and nothing else ---
        ctx2 = b.new_context(viewport={'width': 412, 'height': 915}, service_workers='block')
        c = ctx2.new_page()
        c.on('pageerror', lambda e: errors.append('B: ' + str(e)))
        c.goto(BASE)
        c.wait_for_selector('#composer-input', timeout=30000)
        c.wait_for_timeout(3500)
        fresh = c.evaluate("async () => { const db = window.__cozy.db; const rows = await db.stories.list(); let pages = 0; for (const r of rows) pages += await db.messages.count(r.id); return { tales: rows.length, shallow: rows.filter((r) => r.shallow).length, pages, counts: rows.map((r) => r.pages) }; }")
        check('another browser opens with the shelf alone: three tales named and counted, not one page pulled', fresh['tales'] == 3 and fresh['pages'] == 0 and sorted(fresh['counts']) == [10, 10, 10], fresh)
        check('no page errors', not errors, errors[:3])
        b.close()
finally:
    srv.terminate()
    try: srv.wait(timeout=5)
    except Exception: srv.kill()
print('the browser holds the open tale: ' + ('all green' if not fails else '%d FAILED' % len(fails)))
sys.exit(1 if fails else 0)
