#!/usr/bin/env python3
"""M675: NOTHING OF A TALE IS SENT TO A HOST THAT IS NOT THE TAVERN'S SERVER. The page runs from GitHub Pages as well as from
serve.py. Measured on the build before, against a plain static file server (as Pages is): two pages written, thirty
seconds — 10 POSTs carrying 76,455 bytes to that host: every page, the tale's book, the house book (the connections
and their API keys in it) and what the storyteller was sent. And a first visit was told to restart Termux.

The real app in Chromium against `python -m http.server`: a tale is made, two pages and their sent words are kept, a
ledger row is written, the tale is searched, a copy is taken, a tale is let go — and not one POST goes to the host;
/api/ is asked only for the list of books (the question "is this the tavern's server?"), a few times; nothing tells
him to restart a server that never was. COZY_TEST_REPO runs it against another build. Exits 1 on any miss."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.environ.get('COZY_TEST_REPO') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = os.environ.get('COZY_TEST_PORT', '8113')
BASE = 'http://127.0.0.1:%s' % PORT
fails = []
def check(ok, words):
    print(('  ok   ' if ok else '  FAIL ') + words)
    if not ok: fails.append(words)

srv = subprocess.Popen([sys.executable, '-m', 'http.server', PORT, '--bind', '127.0.0.1'], cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
posts, gets, toasts = [], [], []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 420, 'height': 860}, accept_downloads=True)
        def on_req(r):
            if '/api/' in r.url:
                (posts if r.method == 'POST' else gets).append((r.method, r.url.split(BASE)[1], len(r.post_data or '') if r.method == 'POST' else 0))
        pg.on('request', on_req)
        pg.add_init_script("""(() => { const seen = []; window.__toasts = seen;
            new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) seen.push(n.textContent.trim()); })
              .observe(document, { childList: true, subtree: true }); })();""")
        pg.goto(BASE + '/', wait_until='load')
        pg.wait_for_function("() => window.__cozy && window.__cozy.db", timeout=30000)
        pg.wait_for_timeout(7000)  # the boot's own three-second grace, and its toast if it has one
        first = pg.evaluate("() => window.__toasts.slice()")
        check(not any('Termux' in t or 'serve.py' in t or 'server' in t for t in first), 'a first visit on a host that is not the tavern is not told to restart a server: %s' % json.dumps(first, ensure_ascii=False)[:200])
        pg.evaluate("""async () => { const db = window.__cozy.db; const s = await db.stories.create({ title: 'A tale on a static host' });
            await db.messages.append(s.id, { role: 'user', text: 'THE-WRITER-WORDS ' + 'x'.repeat(2000) });
            await db.messages.append(s.id, { role: 'assistant', text: 'THE-STORY-PAGE ' + 'y'.repeat(4000), receipt: { sentId: 'snt_static1', slots: [] } });
            const sent = await import('/js/sent.js');
            await sent.keepSent({ id: 'snt_static1', storyId: s.id, slots: [{ name: 'The frame', text: 'THE-FRAME ' + 'z'.repeat(3000) }], requests: [{ url: 'https://api.example/v1/messages', body: { messages: [{ role: 'user', content: 'THE-REQUEST ' + 'q'.repeat(3000) }] } }] });
            await db.settings.set('state:' + s.id, { page: 1 });
            await db.connections.add({ name: 'mine', type: 'openai', baseUrl: 'https://api.example/v1', apiKey: 'sk-THE-KEY-THAT-MUST-NOT-LEAVE', model: 'm' });
            const other = await db.stories.create({ title: 'A tale to let go' });
            await db.messages.append(other.id, { role: 'user', text: 'short-lived' });
            await db.stories.remove(other.id);
            window.__sid = s.id; }""")
        pg.wait_for_timeout(26000)  # past the twenty seconds a ledger waits before it is pushed
        # what the sheet and "Take a copy" would do
        pulled = pg.evaluate("""async () => { const sent = await import('/js/sent.js'); const why = {};
            const pushed = await sent.pushSentToDevice(window.__sid);
            const all = await sent.pushAllSentToDevice([window.__sid]);
            const gone = await sent.loadSentOrPull('snt_never_kept', window.__sid, why);
            return { pushed, all, gone: gone === null, why: why.why }; }""")
        # (M675: sending every tale's words answers with what did NOT reach a device, tale by tale and why — here: this
        # tale's one page, because there is no device at all; settings.js says nothing of that, the browser's own file holds them)
        check(pulled == {'pushed': False, 'all': {'reached': 0, 'behind': [{'storyId': pg.evaluate("() => window.__sid"), 'pages': 1, 'why': 'no device'}]}, 'gone': True, 'why': 'no device'},
              'asked to send a tale\'s words, the app says there is no device — and a page it does not hold is "no device", not "the device does not have it": %s' % json.dumps(pulled))
        if hasattr(pg, 'expect_download'):
            try:
                with pg.expect_download(timeout=20000) as dl:
                    pg.evaluate("() => { location.hash = '#/settings'; }")
                    pg.wait_for_timeout(600)
                    pg.evaluate("() => document.getElementById('btn-export').click()")
                name = dl.value.suggested_filename
                check(name.startswith('cozy-tavern-backup-') and name.endswith('.json'), 'Take a copy still hands over the browser\'s own one-file copy (%s)' % name)
                path = dl.value.path()
                body = json.load(open(path, encoding='utf-8'))
                check('partial' not in body and any(m.get('text', '').startswith('THE-STORY-PAGE') for m in body.get('messages', [])) and 'sent' in body, 'and it is whole: the pages and what the storyteller was sent are in it, and it is not called partial')
            except Exception as err:
                check(False, 'Take a copy on a static host: ' + str(err)[:200])
        pg.wait_for_timeout(1500)
        toasts = pg.evaluate("() => window.__toasts.slice()")
        b.close()
finally:
    srv.terminate()

print('  POSTs to the host: %d, carrying %d bytes' % (len(posts), sum(x[2] for x in posts)))
for x in posts[:8]: print('     ', x)
seen = {}
for x in gets: seen[x[1].split('?')[0]] = seen.get(x[1].split('?')[0], 0) + 1
print('  GETs of /api/: %s' % json.dumps(seen))
check(len(posts) == 0, 'NOT ONE POST goes to a host that is not the tavern\'s server (the build before: 10, carrying 76,455 bytes — the house book and its keys among them)')
check(set(seen) <= {'/api/books/list', '/api/events', '/api/backup/now'}, 'and /api/ is asked only "is this the tavern\'s server?" (its list of books), for the stream of changes, and for a copy: %s' % sorted(seen))
check(seen.get('/api/books/list', 0) <= 8, 'that question is asked a handful of times, not on every change (%d)' % seen.get('/api/books/list', 0))
check(not any('isn’t saved to your phone' in t or 'Termux' in t for t in toasts), 'nothing says his phone refused a save, or asks after Termux: %s' % json.dumps([t for t in toasts if 'phone' in t or 'Termux' in t], ensure_ascii=False)[:300])
print('\n' + ('static host: all green' if not fails else '%d FAILED' % len(fails)))
sys.exit(1 if fails else 0)
