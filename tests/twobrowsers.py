#!/usr/bin/env python3
"""Two real Chromium contexts against the real serve.py.

Proves the M160 laws:
  1. the service worker never freezes the device's books
  2. pages written in browser A reach a browser B that has ALREADY booted once
  3. a tale let go in A is let go in B — never resurrected and re-uploaded
"""
import json, os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA', '/tmp/cozydata-two')
PORT = os.environ.get('COZY_TEST_PORT', '8098')
BASE = 'http://127.0.0.1:%s/' % PORT

shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)

env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

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
    page.wait_for_timeout(1200)
    return page


def titles(page):
    return page.evaluate("async () => (await window.__cozy.db.stories.list()).map(s => s.title)")


def pages_of(page, title):
    return page.evaluate("""async (title) => {
      const st = (await window.__cozy.db.stories.list()).find(s => s.title === title);
      if (!st) return null;
      return (await window.__cozy.db.messages.list(st.id)).map(m => m.text);
    }""", title)


def push_now(page):
    page.evaluate("async () => { if (window.__cozy.booksStatus && window.__cozy.booksStatus.pushAll) await window.__cozy.booksStatus.pushAll(); }")
    page.wait_for_timeout(600)


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        A = browser.new_context()
        B = browser.new_context()

        # --- A writes two tales ---------------------------------------
        a = boot(A)
        a.evaluate("""async () => {
          const s1 = await window.__cozy.db.stories.create({ title: 'Ravenwood' });
          await window.__cozy.db.messages.append(s1.id, { role: 'user', text: 'page one' });
          const s2 = await window.__cozy.db.stories.create({ title: 'A tale to let go' });
          await window.__cozy.db.messages.append(s2.id, { role: 'user', text: 'doomed' });
        }""")
        push_now(a)
        check('A wrote two tales', sorted(titles(a)) == ['A tale to let go', 'Ravenwood'], str(titles(a)))

        # --- B boots fresh and receives them --------------------------
        b = boot(B)
        b.wait_for_timeout(1500)
        check('B receives both tales on its first open', sorted(titles(b)) == ['A tale to let go', 'Ravenwood'], str(titles(b)))

        # --- A writes a NEW page; B (already booted once) reopens ------
        a.evaluate("""async () => {
          const st = (await window.__cozy.db.stories.list()).find(s => s.title === 'Ravenwood');
          await window.__cozy.db.messages.append(st.id, { role: 'assistant', text: 'page two, written later' });
        }""")
        push_now(a)
        # the manifest B reads must be the one on the device, not a kept copy
        disk = json.load(open(os.path.join(DATA, 'books', 'list-probe.json'))) if False else None
        seen = b.evaluate("async () => (await (await fetch('api/books/list')).json())")
        ravens = [x for x in seen['books'] if x['id'] not in ('_house',)]
        newest_on_disk = max(
            json.load(open(os.path.join(DATA, 'books', f)))['exportedAt']
            for f in os.listdir(os.path.join(DATA, 'books')) if f.endswith('.json') and f != '_house.json')
        newest_seen = max(x['exportedAt'] for x in ravens)
        check('B reads the device\'s manifest, never a kept copy',
              newest_seen == newest_on_disk, 'read %s / disk %s' % (newest_seen, newest_on_disk))

        b.close()
        b = boot(B)
        b.wait_for_timeout(1800)
        got = pages_of(b, 'Ravenwood') or []
        check('a page written after B first booted still reaches B',
              'page two, written later' in got, str(got))

        # --- A lets a tale go; B reopens ------------------------------
        a.evaluate("""async () => {
          const st = (await window.__cozy.db.stories.list()).find(s => s.title === 'A tale to let go');
          await window.__cozy.db.stories.remove(st.id);
        }""")
        a.wait_for_timeout(800)
        check('A let the tale go', titles(a) == ['Ravenwood'], str(titles(a)))

        b.close()
        b = boot(B)
        b.wait_for_timeout(2500)
        check('the tale stays let go in B — never resurrected', titles(b) == ['Ravenwood'], str(titles(b)))

        # and B must not have pushed it back up
        a.wait_for_timeout(500)
        a.reload(wait_until='load')
        a.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
        a.wait_for_timeout(2500)
        check('nor pushed it back up to A', titles(a) == ['Ravenwood'], str(titles(a)))


        # --- M182: LIVE. A page written in A must reach B with no reload ----
        b_pages_before = pages_of(b, 'Ravenwood') or []
        a.evaluate("""async () => {
          const st = (await window.__cozy.db.stories.list()).find(s => s.title === 'Ravenwood');
          await window.__cozy.db.messages.append(st.id, { role: 'assistant', text: 'a page that should appear live' });
        }""")
        landed = False
        for _ in range(40):                       # up to 8 seconds
            b.wait_for_timeout(200)
            got = pages_of(b, 'Ravenwood') or []
            if 'a page that should appear live' in got:
                landed = True
                break
        check('a page written in A reaches B with no reload',
              landed, '%d pages before, %d after' % (len(b_pages_before), len(pages_of(b, 'Ravenwood') or [])))
        check('and B did not lose anything doing it',
              all(p in (pages_of(b, 'Ravenwood') or []) for p in b_pages_before), 'earlier pages still there')
        # and the writer's own browser never pulls its own write back
        a_pages = pages_of(a, 'Ravenwood') or []
        check('A still holds its own page', 'a page that should appear live' in a_pages, str(len(a_pages)) + ' pages')

        # --- the service worker holds no api answers ------------------
        cached = b.evaluate("""async () => {
          const out = [];
          for (const k of await caches.keys()) {
            const c = await caches.open(k);
            for (const r of await c.keys()) if (r.url.includes('/api/')) out.push(r.url);
          }
          return out;
        }""")
        check('the service worker caches no api answer', cached == [], str(cached))

        browser.close()
finally:
    srv.terminate()

print()
print(('%d checks failed: ' % len(fails)) + ', '.join(fails) if fails else 'two-browser proof: all green')
sys.exit(1 if fails else 0)
