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


def open_tale(page, title):
    """M313: a browser holds the tale that is OPEN. A tale is read from the device when the reader opens
    it — so a check about what a browser shows opens the tale first, as a reader would."""
    page.evaluate("""async (title) => {
      const st = (await window.__cozy.db.stories.list()).find(s => s.title === title);
      if (st) await window.__cozy.chat.openStory(st.id);
    }""", title)
    page.wait_for_timeout(900)


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
        # M313: this read B's store WITHOUT opening the tale — it held every tale whole, refreshed at every
        # boot (the design the writer ordered out: a gigabyte per browser, and Chrome dead on opening).
        # B now reads a tale from the device when it is opened, and the page must be there then.
        open_tale(b, 'Ravenwood')
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
        # M313: …in the tale B has OPEN. A tale B is not showing is not B's business until it is opened.
        open_tale(b, 'Ravenwood')
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

        # --- M293: A ROW LET GO IN A IS LET GO IN B, AND NEVER COMES HOME -------
        a.evaluate("""async () => {
          const db = window.__cozy.db;
          await db.connections.add({ id: 'conn-keep', label: 'the house choice', type: 'openai', baseUrl: 'https://api.example/v1', apiKey: 'k', model: 'm' });
          await db.connections.add({ id: 'conn-gone', label: 'a spare', type: 'openai', baseUrl: 'https://spare.example/v1', apiKey: 'k', model: 'm' });
          await db.settings.set('cast:card-gone', { id: 'card-gone', name: 'A card let go' });
        }""")
        push_now(a)
        b.wait_for_timeout(2000)
        conns_b = b.evaluate("async () => (await window.__cozy.db.connections.list()).map(c => c.id)")
        check('B receives both connections live', sorted(conns_b) == ['conn-gone', 'conn-keep'], str(conns_b))
        # M431: B's house has probed the spare on its own (the model's room and identity, a web page refused and carried by
        # the tavern's server) — bookkeeping, never B's hand: it must not make the row B's, or B keeps it through A's
        # deletion and pushes it home again (the flake: whether B's probe ran before A's deletion)
        b.evaluate("""async () => {
          await window.__cozy.db.connections.update('conn-gone', { viaRelay: true, identTriedFor: 'm@https://spare.example/v1', identTriedAt: Date.now(), detectTriedFor: 'm@https://spare.example/v1', detectTriedAt: Date.now() });
        }""")
        a.evaluate("""async () => {
          const db = window.__cozy.db;
          await db.connections.remove('conn-gone');
          await db.settings.delete('cast:card-gone');
        }""")
        push_now(a)
        gone_in_b = False
        for _ in range(40):
            b.wait_for_timeout(200)
            ids = b.evaluate("async () => (await window.__cozy.db.connections.list()).map(c => c.id)")
            if 'conn-gone' not in ids:
                gone_in_b = True
                break
        check('a connection let go in A is let go in B, live', gone_in_b, str(ids))
        check('and so is a cast card', b.evaluate("async () => (await window.__cozy.db.settings.get('cast:card-gone')) === undefined"))
        check('while the connection that stands, stands', 'conn-keep' in ids, str(ids))
        # B writes to the house and pushes: the dead row must not ride back up
        b.evaluate("async () => { await window.__cozy.db.settings.set('theme', 'deep'); }")
        push_now(b)
        a.wait_for_timeout(2500)
        ids_a = a.evaluate("async () => (await window.__cozy.db.connections.list()).map(c => c.id)")
        check('B’s next push does not bring the let-go connection home to A', ids_a == ['conn-keep'], str(ids_a))
        on_disk = json.load(open(os.path.join(DATA, 'books', '_house.json')))
        check('nor to the device', [c['id'] for c in on_disk['connections']] == ['conn-keep'], str([c['id'] for c in on_disk['connections']]))

        # --- M293: a row made HERE and not yet pushed survives the other's push ----
        b.evaluate("""async () => {
          await window.__cozy.db.connections.add({ id: 'conn-new-in-b', label: 'made in B just now', type: 'openai', baseUrl: 'https://new.example/v1', apiKey: 'k', model: 'm' });
        }""")
        a.evaluate("async () => { await window.__cozy.db.settings.set('theme', 'light'); }")
        push_now(a)                              # A's house book has no idea of B's new connection
        b.wait_for_timeout(2500)                 # B pulls it live
        ids_b = b.evaluate("async () => (await window.__cozy.db.connections.list()).map(c => c.id)")
        check('a connection made in B, not yet pushed, survives A’s push of a house that lacks it', 'conn-new-in-b' in ids_b, str(ids_b))
        push_now(b)
        a.wait_for_timeout(2500)
        ids_a = a.evaluate("async () => (await window.__cozy.db.connections.list()).map(c => c.id)")
        check('and reaches A on B’s own push', 'conn-new-in-b' in ids_a, str(ids_a))

        # --- M295: A BRANCH OF A LONG TALE SENDS ONE WHOLE BOOK, NOT ONE PER PAGE ---
        long_id = a.evaluate("""async () => {
          const db = window.__cozy.db;
          const st = await db.stories.create({ title: 'A long tale' });
          for (let i = 0; i < 60; i++) {
            await db.messages.append(st.id, { role: 'user', text: 'turn ' + i });
            await db.messages.append(st.id, { role: 'assistant', text: 'The evening drew on, page ' + i + '. ' + 'Words. '.repeat(200) });
          }
          await window.__cozy.chat.openStory(st.id);
          return st.id;
        }""")
        push_now(a)
        a.wait_for_timeout(1500)
        a.evaluate("""async (id) => {
          const last = (await window.__cozy.db.messages.list(id)).pop();
          document.querySelector('.msg[data-id="' + last.id + '"] .msg-act[data-act="branch"]').click();
        }""", long_id)
        # M430 (with M332): a branch still being made is nobody's book — the device holds NOTHING of it until it is whole,
        # and then ONE whole book, at once. (M295's first form of this check wanted the half-made branch on the device
        # with its pages trickling into the log — the very half-book M332 forbids; the page door kept pushing it until M430.)
        branch_id = None
        whole = False
        seen_half = False
        t0 = time.time()
        while time.time() - t0 < 60:
            row = a.evaluate("async () => { const s = (await window.__cozy.db.stories.list()).find(x => /a branch/.test(x.title)); return s ? { id: s.id, building: Boolean(s.building) } : null; }")
            if row:
                branch_id = row['id']
                if row['building'] and os.path.exists(os.path.join(DATA, 'books', branch_id + '.json')): seen_half = True
                if not row['building']: whole = True; break
            a.wait_for_timeout(150)
        check('the branch stands in A, whole', bool(branch_id) and whole)
        check('while it was being made, the device held no book of it', not seen_half)
        bfile = os.path.join(DATA, 'books', str(branch_id) + '.json')
        t0 = time.time()
        while time.time() - t0 < 10 and not os.path.exists(bfile): time.sleep(0.2)
        check('whole, its book reached the device at once', os.path.exists(bfile))
        check('one whole book, not one per page (no second whole push has landed)', not os.path.exists(bfile + '.bak1'))
        on_device = json.loads(a.evaluate("async (id) => { const r = await fetch('api/books/one/' + id); return r.ok ? JSON.stringify(await r.json()) : '{\"messages\": []}'; }", branch_id))
        check('and every carried page is on the device, in that one book', len(on_device['messages']) == 120, '%d pages' % len(on_device['messages']))

        # --- M293: A STREAM THAT DROPPED IS CAUGHT UP ON ----------------------
        # the server goes down; while it is down another hand appends a page to the
        # log on the device; the server comes back; B's stream reconnects and B
        # must learn of the page with no reload and no further event.
        srv.terminate(); srv.wait()
        rid = a.evaluate("async () => (await window.__cozy.db.stories.list()).find(s => s.title === 'Ravenwood').id")
        log_path = os.path.join(DATA, 'books', rid + '.log')
        stamp = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime()) + '.000Z'
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(json.dumps({'m': {'id': 'ghost-page', 'storyId': rid, 'role': 'assistant', 'text': 'a page written while the stream was down', 'ts': int(time.time() * 1000)},
                                'by': 'ghost-browser', 'at': stamp}) + '\n')
        time.sleep(1.0)
        srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        caught = False
        for _ in range(60):                       # the browser reconnects in a few seconds; then the catch-up
            b.wait_for_timeout(500)
            got = pages_of(b, 'Ravenwood') or []
            if 'a page written while the stream was down' in got:
                caught = True
                break
        check('a page that landed while B’s stream was down reaches B when the stream returns — no reload, no event', caught,
              '%d pages' % len(pages_of(b, 'Ravenwood') or []))
        shown = b.evaluate("() => Array.from(document.querySelectorAll('#thread .msg-body')).map(n => n.textContent)")
        check('and it is painted in the room', any('while the stream was down' in t for t in shown), '%d pages drawn' % len(shown))

        browser.close()
finally:
    srv.terminate()

print()
print(('%d checks failed: ' % len(fails)) + ', '.join(fails) if fails else 'two-browser proof: all green')
sys.exit(1 if fails else 0)
