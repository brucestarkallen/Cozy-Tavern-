"""The ledger and Settings, opened and closed on a HEAVY story, measured in a real browser (M310).

A headless Chromium on a phone viewport, CPU slowed 6x, against the real serve.py. The story is
seeded as a long tale is: hundreds of pages, scores of people, forty seats, sixty facts a person,
forty threads, a full journal. Every open and close of the ledger and of Settings is timed, with
the long tasks on the main thread, and one read of the ledger (loadState) is timed alone.

  python3 tests/perf_rooms.py                   # this tree
  REPO_DIR=/tmp/other-tree python3 tests/perf_rooms.py   # another checkout, same data, to compare

Exit 1 when the budget is broken.
"""
import json, os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.environ.get('REPO_DIR') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-rooms')
PORT = os.environ.get('COZY_TEST_PORT', '8097')
THROTTLE = float(os.environ.get('THROTTLE', '6'))
PAGES = int(os.environ.get('PAGES', '300'))
PEOPLE = int(os.environ.get('PEOPLE', '80'))
FACTS = int(os.environ.get('FACTS', '60'))
# M312: THE LIBRARY. One heavy tale never showed the writer's lag — his came "after 3000 pages total from
# all chats". These are the OTHER tales on the shelf: each with the checkpoints a long tale really
# carries (whole copies of its ledger), LIB_MB of them a tale. Nothing here is ever opened.
LIB_TALES = int(os.environ.get('LIB_TALES', '12'))
LIB_MB = float(os.environ.get('LIB_MB', '12'))
BUDGET = {'action_ms': 1200, 'load_state_ms': 120, 'keys_ms': 150, 'house_ms': 400, 'open_during_push_ms': 1500}

SEED = """
async ({ pages, people, facts, lib }) => {
  const { db } = await import('/js/store.js');
  const { saveState, emptyState } = await import('/js/engine/state.js');
  const names = [];
  const first = ['Abel','Bruna','Cedric','Dalia','Emeric','Fenna','Goran','Hedda','Ivo','Jorun','Kasimir','Lotte','Marek','Nives','Osric','Petra','Quillon','Rosalind','Stellan','Tamsin','Ulric','Vesna','Wystan','Xanthe','Yorick','Zelda','Anselm','Beatrix','Caspian','Delphine'];
  const last = ['Moreau','Katz','Vale','Orne','Stahl','Quist','Pell','Ruiz','Marchetti','Ashby','Lund','Brandt','Oyelaran','Corbin','Thane','Vogel'];
  for (let i = 0; i < people; i += 1) names.push(first[i % first.length] + ' ' + last[(i * 7 + Math.floor(i / first.length)) % last.length] + (i >= first.length * 2 ? ' the ' + (i + 1) + 'th' : ''));
  const story = await db.stories.create({ title: 'a long tale' });
  await db.stories.update(story.id, { brief: ('Jovan comes home for one last summer. ' + names.slice(0, 20).join(', ') + ' live in town. ').repeat(60), castNotes: 'Who is in it. '.repeat(300) });
  for (let i = 0; i < pages; i += 1) await db.messages.append(story.id, { role: i % 2 ? 'assistant' : 'user', text: (i % 2 ? '[The Wells house — Friday, March 14, 2025 | 20:40 | clear | gray hoodie | on the porch]\\n\\n' : '') + ('They talked with ' + names[i % names.length] + ' about the fair and the ferry. ').repeat(i % 2 ? 22 : 2) });
  const st = emptyState();
  st.sheet = { actors: {}, playerName: 'Jovan' };
  st.clock = { calendar: 'gregorian', minutes: 1064800, label: '' };
  st.place = { name: 'The Wells house' };
  st.present = [{ name: 'Jovan', position: 'on the porch' }, { name: names[0], position: 'beside him' }, { name: names[1] }, { name: names[2] }];
  st.page = pages - 1; st.readTo = pages - 1; st.tidiedGen = 999; st.turn = pages * 3;
  names.forEach((n, i) => {
    st.characters[n] = { core: 'Someone of the town; ' + 'steady, watchful, slow to trust. '.repeat(6), state: 'about their evening', arc: i % 3 ? 'warmed to Jovan after the fair; still wary of his leaving' : '', threads: i % 4 ? ['owes the ferryman a favour', 'means to ask about the letter'] : [], updatedAtTurn: pages / 2 - (i % 40), firstSeenTurn: i, ...(i >= people - 20 ? { retired: true } : {}) };
    if (i >= 4 && i < 44) st.offscreen[n] = { location: 'the ' + (i % 2 ? 'market' : 'harbour'), activity: 'closing up for the night', agenda: i % 3 ? 'catch Jovan before he leaves' : undefined, stance: ['toward', 'seeking', 'tense', 'busy', 'waiting'][i % 5], sinceMinutes: 1064800 - i * 11, atTurn: pages / 2 - i };
    if (i < 30) st.relationships[n] = { p: (i * 3) % 60, r: i % 20, s: 0, history: Array.from({ length: 30 }, (_, k) => ({ atMinutes: 1000000 + k, axis: 'p', delta: 2, cause: 'the page showed warmth number ' + k })) };
    if (i < 15) st.knowledge[n] = Array.from({ length: facts }, (_, k) => ({ fact: 'saw Jovan at the ' + ['market', 'harbour', 'chapel', 'ferry', 'school'][k % 5] + ' on occasion ' + k + ', speaking with ' + names[(i + k) % names.length] + ' about matter ' + (k * 13 + i), atTurn: k }));
    if (i < 12) st.canon[n] = { facts: [{ key: 'kin', value: 'a cousin of ' + names[(i + 1) % names.length], atMinutes: 1 }] };
  });
  st.threads = Array.from({ length: 40 }, (_, i) => ({ title: names[i] + ' and the ' + ['letter', 'debt', 'ferry', 'wedding', 'boat'][i % 5] + ' of ' + names[(i + 9) % names.length], owner: names[i], heat: i < 3 ? 'hot' : 'cold', next: 'wait for the fair, then speak', atTurn: i }));
  st.journal = Array.from({ length: 1500 }, (_, i) => ({ id: i + 1, p: Math.floor(i / 5), m: { type: 'presence.update', name: names[i % names.length], position: 'by the stove, turning the letter over, number ' + i } }));
  st.journalSeq = 1500;
  st.log = Array.from({ length: 200 }, (_, i) => ({ ts: Date.now() - i * 1000, words: names[i % names.length] + ' — now by the stove.', undone: false, jid: 1500 - i }));
  await saveState(story.id, st);
  await db.settings.set('activeStoryId', story.id);
  await db.settings.set('cast:card1', { id: 'card1', name: 'Rias Gremory', description: 'heir of her house', importedAt: 1 });
  /* the rest of the library: tales never opened in this run, each carrying its checkpoints */
  const chunk = 'x'.repeat(256 * 1024);
  for (let t = 0; t < lib.tales; t += 1) {
    const other = await db.stories.create({ title: 'another tale ' + t });
    const snaps = [];
    for (let k = 0; k < Math.max(1, Math.round(lib.mb * 4)); k += 1) snaps.push({ id: 'turn' + k, snap: { page: k, journal: [], filler: chunk + k } });
    await db.settings.set('snapshots:' + other.id, snaps);
  }
  return { id: story.id, stateBytes: JSON.stringify(st).length };
}
"""

MEASURE = """
async ({ open, close, settle }) => {
  const long = [];
  const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(e.duration); });
  try { obs.observe({ entryTypes: ['longtask'] }); } catch (e) {}
  const t0 = performance.now();
  open();
  await settle();
  const opened = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 400));
  const longOpen = long.reduce((a, b) => a + b, 0); long.length = 0;
  const t1 = performance.now();
  close();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const closed = performance.now() - t1;
  await new Promise((r) => setTimeout(r, 400));
  const longClose = long.reduce((a, b) => a + b, 0);
  obs.disconnect();
  return { open_ms: Math.round(opened), long_open_ms: Math.round(longOpen), close_ms: Math.round(closed), long_close_ms: Math.round(longClose) };
}
"""


def main():
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA, exist_ok=True)
    env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
    srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], cwd=REPO, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out = {'repo': REPO, 'throttle': THROTTLE, 'pages': PAGES, 'people': PEOPLE, 'facts': FACTS}
    try:
        time.sleep(1.5)
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True, service_workers='block')
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto('http://127.0.0.1:%s/' % PORT)
            page.wait_for_selector('#composer-input', timeout=30000)
            page.wait_for_timeout(5000)  # the first open may reload itself once when its books arrive; seed after it has settled
            page.wait_for_selector('#composer-input', timeout=30000)
            seeded = page.evaluate(SEED, {'pages': PAGES, 'people': PEOPLE, 'facts': FACTS, 'lib': {'tales': LIB_TALES, 'mb': LIB_MB}})
            out['library_mb'] = round(LIB_TALES * LIB_MB)
            out['state_bytes'] = seeded['stateBytes']
            page.wait_for_timeout(4000)   # let the seeded books reach the device (the push follows the writes)
            page.reload()
            page.wait_for_selector('#composer-input', timeout=30000)
            page.wait_for_timeout(15000)  # a boot whose books arrive late reloads the page ONCE by itself; measure after it
            page.wait_for_selector('#composer-input', timeout=30000)
            cdp = ctx.new_cdp_session(page)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': THROTTLE})
            # one read of the ledger, alone
            out['load_state_ms'] = page.evaluate("""async (id) => { const { loadState } = await import('/js/engine/state.js'); const t = []; for (let i = 0; i < 5; i += 1) { const a = performance.now(); await loadState(id); t.push(performance.now() - a); } t.sort((x, y) => x - y); return Math.round(t[2]); }""", seeded['id'])
            # M312: the two reads that touched EVERY row of EVERY tale, timed alone
            out['keys_ms'] = page.evaluate("async () => { const { db } = await import('/js/store.js'); const a = performance.now(); const k = await db.settings.keys(); return Math.round(performance.now() - a); }")
            out['house_ms'] = page.evaluate("async () => { const { db } = await import('/js/store.js'); const a = performance.now(); const j = await db.exportHouse(); return Math.round(performance.now() - a); }")
            out['house_bytes'] = page.evaluate("async () => { const { db } = await import('/js/store.js'); return (await db.exportHouse()).length; }")
            # and the ledger opened WHILE the house book is being folded for a push, as it is after every page
            out['open_during_push_ms'] = page.evaluate("""async () => {
              const { db } = await import('/js/store.js');
              const busy = db.exportHouse();
              const t0 = performance.now();
              document.querySelector('#btn-ledger').click();
              const until = performance.now() + 60000;
              while (performance.now() < until) { if (!document.querySelector('#drawer').hidden && document.querySelectorAll('#drawer-panels .ledger-panel').length > 0) break; await new Promise((r) => setTimeout(r, 16)); }
              const ms = Math.round(performance.now() - t0);
              await busy;
              document.querySelector('#btn-ledger').click();
              await new Promise((r) => setTimeout(r, 400));
              return ms;
            }""")
            runs = {}
            for name, opener, closer, shown in [
                ('ledger', "document.querySelector('#btn-ledger').click()", "document.querySelector('#btn-ledger').click()", "!document.querySelector('#drawer').hidden && document.querySelectorAll('#drawer-panels .ledger-panel').length > 0"),
                ('settings', "document.querySelector('#btn-settings').click()", "document.querySelector('#btn-settings').click()", "!document.querySelector('#view-settings').hidden"),
            ]:
                res = []
                for _ in range(3):
                    r = page.evaluate("(async () => { const f = %s; return await f({ open: () => { %s; }, close: () => { %s; }, settle: async () => { const until = performance.now() + 20000; while (performance.now() < until) { if (%s) { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return; } await new Promise((r) => setTimeout(r, 16)); } } }); })()" % (MEASURE, opener, closer, shown))
                    res.append(r)
                    page.wait_for_timeout(500)
                runs[name] = res
            out['runs'] = runs
            out['page_errors'] = errors
            b.close()
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=5)
        except Exception:
            srv.kill()
    print(json.dumps(out, indent=1))
    worst = max(max(r['open_ms'] + r['long_close_ms'] for r in rs) for rs in out['runs'].values())
    ok = (worst <= BUDGET['action_ms'] and out['load_state_ms'] <= BUDGET['load_state_ms'] and out['keys_ms'] <= BUDGET['keys_ms']
          and out['house_ms'] <= BUDGET['house_ms'] and out['open_during_push_ms'] <= BUDGET['open_during_push_ms'] and not out['page_errors'])
    print('the rooms on a heavy story: ' + ('within budget' if ok else 'OVER BUDGET'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
