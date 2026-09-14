#!/usr/bin/env python3
"""THE WIPE TEST. Write a shelf, then clear EVERYTHING the browser holds —
IndexedDB, caches, service workers, local/session storage — the way "clear
all browsing data" does. Reopen. Does every story come back whole?"""
import json, os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-wipe')
PORT = os.environ.get('COZY_TEST_PORT', '8090')
BASE = 'http://127.0.0.1:%s/' % PORT

shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

LAST_PAGE = '''async () => {
  const db = window.__cozy.db;
  const st = (await db.stories.list()).find(s => s.title === 'Ravenwood');
  await db.messages.append(st.id, { role: 'assistant', text: 'the very last page, written a heartbeat before the wipe' });
}'''

OPEN_ALL = '''async () => {
  for (const st of await window.__cozy.db.stories.list()) {
    await window.__cozy.chat.openStory(st.id);
  }
}'''

fails = []


def check(name, ok, extra=''):
    print(('  ok   — ' if ok else '  FAIL — ') + name + ((' :: ' + extra) if extra else ''))
    if not ok:
        fails.append(name)


def boot(ctx):
    page = ctx.new_page()
    page.goto(BASE, wait_until='load')
    page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
    try:
        page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=10000)
    except Exception:
        pass
    page.wait_for_timeout(1500)
    return page


def shelf(page):
    return page.evaluate("""async () => {
      const out = {};
      for (const st of await window.__cozy.db.stories.list()) {
        const pages = await window.__cozy.db.messages.list(st.id);
        const state = await window.__cozy.db.settings.get('state:' + st.id);
        out[st.title] = { pages: pages.map(m => m.text), ledger: state ? (state.present || []).map(p => p.name) : null };
      }
      return out;
    }""")


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        ctx = browser.new_context()
        page = boot(ctx)

        # a shelf with real content: pages, a ledger, a connection, house settings
        page.evaluate("""async () => {
          const db = window.__cozy.db;
          for (const [title, n] of [['Ravenwood', 12], ['The Wayward Lantern', 5]]) {
            const st = await db.stories.create({ title });
            for (let i = 0; i < n; i += 1) {
              await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: title + ' page ' + i });
            }
            await db.settings.set('state:' + st.id, { present: [{ name: 'Mara' }, { name: 'Tomas' }], journal: [], log: [] });
          }
          await db.connections.add({ label: 'the house choice', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' });
          await db.settings.set('memoryWindow', 42);
        }""")
        page.evaluate("async () => { await window.__cozy.booksStatus.pushAll(); }")
        page.wait_for_timeout(1200)

        # M181: a page written and then WIPED AT ONCE — no pushAll, no waiting
        # out the debounce, no switching away. The window that used to be
        # twenty seconds wide.
        page.evaluate(LAST_PAGE)
        page.wait_for_timeout(700)   # only as long as the immediate push needs
        before = shelf(page)
        check('a shelf was written', sorted(before) == ['Ravenwood', 'The Wayward Lantern'], str(sorted(before)))
        check('a page written a heartbeat before the wipe is in the browser',
              before['Ravenwood']['pages'][-1].startswith('the very last page'),
              before['Ravenwood']['pages'][-1][:44])
        check('and pushed to the device', len([f for f in os.listdir(os.path.join(DATA, 'books')) if f.endswith('.json')]) >= 3,
              str(sorted(os.listdir(os.path.join(DATA, 'books')))))

        # ---- CLEAR ALL BROWSING DATA ----
        page.evaluate("""async () => {
          for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
          for (const k of await caches.keys()) await caches.delete(k);
          localStorage.clear(); sessionStorage.clear();
          const dbs = (indexedDB.databases ? await indexedDB.databases() : [{ name: 'cozytavern' }]);
          await Promise.all(dbs.map((d) => new Promise((res) => {
            const req = indexedDB.deleteDatabase(d.name); req.onsuccess = req.onerror = req.onblocked = () => res();
          })));
        }""")
        page.close()
        ctx.close()

        # a brand-new context: nothing at all is left of the old browser
        ctx2 = browser.new_context()
        probe = ctx2.new_page()
        probe.goto(BASE, wait_until='load')
        empty = probe.evaluate("""async () => {
          const dbs = indexedDB.databases ? await indexedDB.databases() : [];
          return dbs.length;
        }""")
        probe.close()

        page2 = boot(ctx2)
        page2.wait_for_timeout(2500)

        # M189: the shelf comes back at once; a tale's PAGES come when it is
        # opened, so a browser holds what it is read in, not a copy of
        # everything. Open every tale, as a reader would.
        titles_back = page2.evaluate("async () => (await window.__cozy.db.stories.list()).map(s => s.title)")
        check('the whole shelf comes back at once', sorted(titles_back) == sorted(before), str(sorted(titles_back)))
        page2.evaluate(OPEN_ALL)
        page2.wait_for_timeout(3500)
        after = shelf(page2)

        check('every story came back', sorted(after) == sorted(before), str(sorted(after)))
        for title in before:
            got = after.get(title, {})
            check('“%s” — every page, word for word' % title,
                  got.get('pages') == before[title]['pages'],
                  '%s of %s pages' % (len(got.get('pages') or []), len(before[title]['pages'])))
            check('“%s” — its ledger came too' % title,
                  got.get('ledger') == before[title]['ledger'], str(got.get('ledger')))
        conns = page2.evaluate("async () => (await window.__cozy.db.connections.list()).map(c => c.label)")
        check('the connection came back', conns == ['the house choice'], str(conns))
        win = page2.evaluate("async () => window.__cozy.db.settings.get('memoryWindow')")
        check('and the house settings', win == 42, str(win))

        browser.close()
finally:
    srv.terminate()

print()
print('THE WIPE TEST: nothing was lost' if not fails else 'LOST: ' + ', '.join(fails))
sys.exit(1 if fails else 0)
