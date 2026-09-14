#!/usr/bin/env python3
"""M188: an empty tale must never overwrite a full one on the device.

The one way a writer's pages could be destroyed in a second: a browser
holding a story row with no pages under it pushes that story, and every page
on the device is replaced by nothing.
"""
import json, os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-guard')
PORT = os.environ.get('COZY_TEST_PORT', '8080')
BASE = 'http://127.0.0.1:%s/' % PORT

shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')],
                       env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

RENAME = '''async () => {
  const st = (await window.__cozy.db.stories.list()).find(s => s.title === 'Ravenwood');
  await window.__cozy.db.stories.update(st.id, { title: 'Ravenwood (renamed)' });
  await window.__cozy.booksStatus.pushAll();
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
    page.wait_for_timeout(1500)
    return page


def device_pages(story_id):
    p = os.path.join(DATA, 'books', story_id + '.json')
    if not os.path.exists(p):
        return None
    with open(p) as f:
        return len(json.load(f).get('messages', []))


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        ctx = browser.new_context()
        page = boot(ctx)

        sid = page.evaluate("""async () => {
          const db = window.__cozy.db;
          const st = await db.stories.create({ title: 'Ravenwood' });
          for (let i = 0; i < 40; i += 1) await db.messages.append(st.id, { role: 'assistant', text: 'page ' + i });
          await window.__cozy.booksStatus.pushAll();
          return st.id;
        }""")
        page.wait_for_timeout(1500)
        check('forty pages are on the device', device_pages(sid) == 40, str(device_pages(sid)))

        # THE DISASTER, as it can really happen: a browser holds the story
        # ROW with no pages ever fetched under it — a half-finished pull, a
        # failed import, a story row that arrived without its book — and then
        # pushes. Deleting pages one by one is the WRITER's doing and stays
        # allowed; this is not.
        page.evaluate("""async (sid) => {
          const db = window.__cozy.db;
          const d = await new Promise((res) => { const r = indexedDB.open('cozytavern.v1'); r.onsuccess = () => res(r.result); });
          await new Promise((res) => {
            const t = d.transaction('messages', 'readwrite');
            const s = t.objectStore('messages');
            const q = s.index('byStory').getAllKeys(sid);
            q.onsuccess = () => { for (const k of q.result) s.delete(k); };
            t.oncomplete = res;
          });
        }""", sid)
        page.evaluate("async () => { await window.__cozy.booksStatus.pushAll(); }")
        page.wait_for_timeout(3000)

        left = device_pages(sid)
        check('a browser that never fetched the pages NEVER empties the device',
              left == 40, '%s pages left on the device' % left)

        page.wait_for_timeout(2000)
        back = page.evaluate("""async (sid) => (await window.__cozy.db.messages.list(sid)).length""", sid)
        check('and the browser is given the pages back', back == 40, '%d pages in the browser' % back)

        # a genuinely new tale, with no pages yet, still pushes fine
        page.evaluate("""async () => {
          const st = await window.__cozy.db.stories.create({ title: 'A tale not yet begun' });
          await window.__cozy.booksStatus.pushAll();
        }""")
        page.wait_for_timeout(1500)
        titles = page.evaluate("async () => (await window.__cozy.db.stories.list()).map(s => s.title)")
        check('a genuinely new empty tale is not blocked', 'A tale not yet begun' in titles, str(titles))

        # M189: a SECOND browser must learn the shelf without copying it
        ctx2 = browser.new_context()
        b2 = boot(ctx2)
        b2.wait_for_timeout(2500)
        shelf = b2.evaluate("async () => (await window.__cozy.db.stories.list()).map(s => ({ t: s.title, shallow: !!s.shallow }))")
        check('the second browser knows the whole shelf', len(shelf) == 2, str(shelf))
        check('but holds no pages for a tale it has not opened',
              b2.evaluate("""async () => { const st = (await window.__cozy.db.stories.list()).find(s => s.title === 'Ravenwood'); return (await window.__cozy.db.messages.list(st.id)).length; }""") == 0,
              'pages before opening')
        check('and the tale is marked as not yet fetched',
              any(x['t'] == 'Ravenwood' and x['shallow'] for x in shelf), str(shelf))

        # opening it fetches the pages
        b2.evaluate("""async () => {
          const st = (await window.__cozy.db.stories.list()).find(s => s.title === 'Ravenwood');
          await window.__cozy.chat.openStory(st.id);
        }""")
        b2.wait_for_timeout(2500)
        after_open = b2.evaluate("""async () => { const st = (await window.__cozy.db.stories.list()).find(s => s.title === 'Ravenwood'); return { pages: (await window.__cozy.db.messages.list(st.id)).length, shallow: !!st.shallow }; }""")
        check('opening the tale fetches its pages', after_open['pages'] == 40, str(after_open))
        check('and it is no longer marked unfetched', after_open['shallow'] is False, str(after_open))
        check('the device still holds forty pages', device_pages(sid) == 40, str(device_pages(sid)))
        ctx2.close()

        # M190: renaming a tale whose pages are NOT here yet. Its book cannot
        # be pushed (M188 refuses an empty one), so the device heals the
        # browser — and that heal used to write the book's old title back over
        # the rename, and land the pages from another thread while the room
        # went on showing an empty tale.
        ctx3 = browser.new_context()
        b3 = boot(ctx3)
        b3.wait_for_timeout(2500)
        b3.evaluate(RENAME)
        b3.wait_for_timeout(3500)
        got = b3.evaluate("""async () => {
          const st = (await window.__cozy.db.stories.list()).find(s => /Ravenwood/.test(s.title));
          return { t: st.title, shallow: !!st.shallow, pages: (await window.__cozy.db.messages.list(st.id)).length };
        }""")
        check('a rename of an unfetched tale is not undone by the heal', 'renamed' in got['t'], str(got))
        check('and the healed pages really arrive in the room', got['pages'] == 40, str(got))
        check('the device kept every page throughout', device_pages(sid) == 40, str(device_pages(sid)))
        ctx3.close()
        browser.close()
finally:
    srv.terminate()

print()
print('the guard holds' if not fails else 'FAILED: ' + ', '.join(fails))
sys.exit(1 if fails else 0)
