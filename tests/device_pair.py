#!/usr/bin/env python3
"""M675: THE BROWSER AND THE DEVICE, TOGETHER — the real app in Chromium against the real serve.py.

Each scene was measured going wrong on the build before (the audit of the device, and what was found on the way):
  1. A COPY BROUGHT BACK IS THE LIBRARY, IN EVERY BROWSER. The browser that brings it back sends what it still owes
     first (so the copy kept of "the library as it stood" holds it); a second browser open at the time, one that was
     closed, and one that never heard the announcement all become the device's copy — none of them pushes its old tale
     back over it (the audit: the other browser kept its 3 pages and its next push put the 3-page book back).
  2. "TAKE A COPY" RIGHT AFTER THE TAVERN CAME BACK holds what a failed push had left waiting (the audit: the zip was
     made of the device's old book while the tale was still owed).
  3. A TALE LET GO takes its sent words with it at once, and they are not written back to the device four minutes on.
  4. A BRANCH READS ITS CARRIED PAGES' WORDS FROM THE DEVICE under its own name — and still does when the first tale
     is let go; a branch made before this is healed by being opened.
  5. THE BROWSER NEVER LETS GO OF WORDS THE DEVICE HAS NOT GOT (the audit: 230 pages told while the device was down —
     42 were afterwards in neither place); and a sheet opened while the tavern is not running says so, not "not kept".
  6. WITH THE TAVERN NOT ANSWERING, "TAKE A COPY" SAYS ITS COPY IS PARTIAL (the audit: one tale's pages, every other
     tale a name with nothing in it, handed over as "A copy is in your downloads"); and when the sent words cannot be
     folded into that one file, the stories still come and the note says what is not in it (one try wrapped both).
  7. WHAT A COPY LACKS IS SAID: the device will not take a tale's newest changes — the zip is made of what the device
     holds, and the note beside the button names the tale (the zip was handed over with the words of a whole copy).
  8. …AND WHEN THE SENDING IS STILL ON ITS WAY after three minutes the copy is made anyway and the note says so
     (about three and a half minutes: the device never answers the two books it is sent).
  9. AN EMPTY DEVICE IS NEVER "A COPY BROUGHT BACK" (the second reviewer: the device's folder emptied, a browser that
     had once brought a copy back — it was told a copy had been brought back and that the tavern was not answering,
     its kept words were wiped, and nothing it held could reach the device, for good).
 10. A REFUSAL BY NAME IS SAID: opened under another name for the device the app went quietly browser-only; it now
     says the tavern is running, that it does not serve this address, and how to start it so that it does.
 11. SENT WORDS THAT COULD NOT GO ARE REPORTED, and looked for afresh when he asks for a copy (a look that failed
     inside the last minute sent nothing and said nothing; "Bring a copy back" then cleared them).
 12. THE FILE SAVED UNDER A COPY'S NAME IS THAT COPY (the download asked for "the newest", whichever that was by then).
 13. A SITTING BEGUN WITHOUT THE TAVERN LEARNS THAT IT CAME BACK: Settings says where the tales live, and the search
     asks the device again (it said "the device did not answer" without asking, until the page was loaded again).
 14. A REFUSAL IS NOT "NO ANSWER": "Take a copy" shows the tavern's reason and makes no partial file of its own; the
     note that a copy could not be read in says what is true of the cause.
 15. THE EPOCH NOTED AFTER A READ-IN IS THAT READ-IN'S OWN (another look at the list failing meanwhile left it
     un-noted, and the next start read the whole library in a second time) — and so are the tales let go: a tale let
     go in another browser was sent back to the device when a look failed while the look-again was reading a book in.
 16. A PARTIAL FILE SAYS SO BEFORE IT REPLACES ANYTHING (it said so afterwards).
 17. TWO BROWSERS, AND THE DEVICE'S FOLDER EMPTIED: NO TALE IS LOST. Each browser holds whole the tale it has open and
     the other's by name. The first to open sent the tale it held by name as an EMPTY book; the second — the only
     place that tale's pages were — read the empty book in over them (measured on the build before: 2 pages, then 0
     in the browser and 0 on the device). And once a copy had ever been brought back, the second browser was made
     "the device's copy" outright. Now a name is never sent as a book, and a device that names no epoch is joined,
     not copied: at the start, and when a page is written while the page stays open.
 18. PAGES WRITTEN INTO A TALE HELD BY NAME ONLY ARE ADDED TO ITS BOOK ON THE DEVICE — never sent as the book (a tale
     opened while the tavern was not answering shows no pages; one exchange written into it replaced the device's
     whole book of that tale with that exchange).

COZY_TEST_REPO runs it against another build (the one before M675 misses every scene). Exits 1 on any miss."""
import io, json, os, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.error, zipfile
from playwright.sync_api import sync_playwright

REPO = os.environ.get('COZY_TEST_REPO') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('COZY_TEST_DATA') or tempfile.mkdtemp(prefix='cozy-device-pair-')
PORT = os.environ.get('COZY_TEST_PORT', '8136')
BASE = 'http://127.0.0.1:%s/' % PORT
ONLY = sys.argv[1:]
fails = []


def check(ok, words):
    print(('  ok   ' if ok else '  FAIL ') + words, flush=True)
    if not ok:
        fails.append(words)
    return ok


def start(extra=None):
    env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA, PYTHONDONTWRITEBYTECODE='1')
    env.pop('COZY_HOSTS', None)
    env.update(extra or {})
    p = subprocess.Popen([sys.executable, '-B', os.path.join(REPO, 'serve.py')], cwd=REPO, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + 'api/version', timeout=1).read()
            return p
        except Exception:
            time.sleep(0.25)
    return p


def stop(p):
    p.terminate()
    try:
        p.wait(timeout=10)
    except Exception:
        p.kill()


def get(path, timeout=30):
    """(status, bytes) — 0 when the server does not answer."""
    try:
        with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()
    except Exception:
        return 0, b''


def post(path, body, headers=None, timeout=120):
    """(status, bytes) — as another browser, or a tool, would send it."""
    req = urllib.request.Request(BASE + path, data=body, headers=headers or {}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()
    except Exception:
        return 0, b''


def device_list():
    try:
        return json.loads(get('api/books/list')[1] or b'{}')
    except ValueError:
        return {}


def bring_back_its_own_copy():
    """The device's own zip, taken and brought back (as a browser would): the library is the same, and has a new epoch."""
    get('api/backup/now', timeout=120)
    copy = get('api/backup/file', timeout=120)[1]
    st, raw = post('api/backup/restore', copy, {'Content-Type': 'application/zip'})
    try:
        return json.loads(raw or b'{}').get('epoch') if st == 200 else None
    except ValueError:
        return None


def wipe_device(srv_box):
    """The device's folder emptied (Termux's data cleared, the folder removed): the tavern starts again with no books at all."""
    stop(srv_box[0])
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA, exist_ok=True)
    srv_box[0] = start()


def toasts_of(page):
    try:
        return page.evaluate("() => (window.__toasts || []).slice()")
    except Exception:
        return []


def device_book(sid):
    st, body = get('api/books/one/' + sid)
    try:
        return json.loads(body) if st == 200 else None
    except ValueError:
        return None


def device_pages(sid):
    b = device_book(sid)
    return [m.get('text', '') for m in (b or {}).get('messages', [])]


def device_words(sid, page_id):
    """The words the device reads back for one page under one tale's name: {piece key: text}, or None."""
    st, body = get('api/books/sent/%s?page=%s' % (sid, page_id))
    if st != 200:
        return None
    one = json.loads(body)
    return ' '.join(p['t'] for p in one.get('pieces', []))


def zips_on_device():
    folder = os.path.join(DATA, 'backups')
    return sorted(n for n in os.listdir(folder) if n.endswith('.zip')) if os.path.isdir(folder) else []


def newest_zip():
    folder = os.path.join(DATA, 'backups')
    names = sorted(n for n in os.listdir(folder) if n.endswith('.zip')) if os.path.isdir(folder) else []
    return os.path.join(folder, names[-1]) if names else None


def open_tavern(context, block_events=False, base=None):
    page = context.new_page()
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    if block_events:
        page.route('**/api/events', lambda route: route.abort())
    page.add_init_script("""(() => { const seen = []; window.__toasts = seen;
        new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) seen.push(n.textContent.trim()); })
          .observe(document, { childList: true, subtree: true }); })();""")
    page.goto(base or BASE, wait_until='load')
    page.wait_for_function('!!window.__cozy && !!window.__cozy.chat && !!window.__cozy.booksStatus', timeout=40000)
    page.wait_for_timeout(1200)
    return page


def ready(page, timeout=60000):
    """After a reload the page is the tavern again."""
    page.wait_for_function('!!window.__cozy && !!window.__cozy.chat && !!window.__cozy.booksStatus', timeout=timeout)
    page.wait_for_timeout(800)


PAGES_OF = """async (sid) => { const { db } = await import('/js/store.js'); const st = await db.stories.get(sid); if (!st) return null; return (await db.messages.list(sid)).map((m) => m.text); }"""
OPEN = """async (sid) => { await window.__cozy.chat.openStory(sid); const { db } = await import('/js/store.js'); return (await db.messages.list(sid)).map((m) => m.text); }"""
APPEND = """async ([sid, text]) => { const { db } = await import('/js/store.js'); await db.messages.append(sid, { role: 'user', text: 'and then' }); await db.messages.append(sid, { role: 'assistant', text }); }"""


def wait_pages(page, sid, want, what, timeout=90):
    """Poll (through reloads) until the browser holds exactly `want` for the tale; returns what it holds at the end."""
    held = None
    end = time.time() + timeout
    while time.time() < end:
        try:
            held = page.evaluate(PAGES_OF, sid)
        except Exception:
            held = None  # the page is reloading
        if held is not None and want(held):
            return held
        time.sleep(0.5)
    return held


# ---------------------------------------------------------------------------------------------------------------------
def scene_copy_brought_back(b):
    a_ctx, b_ctx, c_ctx, e_ctx = [b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block') for _ in range(4)]
    A = open_tavern(a_ctx)
    sid = A.evaluate("""async () => { const { db } = await import('/js/store.js');
        const st = await db.stories.create({ title: 'the tale that is copied' });
        await db.messages.append(st.id, { role: 'user', text: 'I begin.' });
        await db.messages.append(st.id, { role: 'assistant', text: 'PAGE-ONE of the tale.' });
        await db.messages.append(st.id, { role: 'user', text: 'I go on.' });
        await db.messages.append(st.id, { role: 'assistant', text: 'PAGE-TWO of the tale.' });
        await db.settings.set('welcomeSeen', true);
        window.__cozy.setActiveStoryId(st.id);
        await window.__cozy.chat.renderThread({ structural: true });
        await window.__cozy.booksStatus.pushAll();
        return st.id; }""")
    made = json.loads(get('api/backup/now')[1] or b'{}')
    copy = get('api/backup/file', timeout=120)[1]
    check(bool(made.get('ok')) and len(copy) > 100 and len(device_pages(sid)) == 4, 'the copy is taken while the tale has two pages (%s files)' % made.get('files'))
    copy_path = os.path.join(DATA, '..', os.path.basename(DATA) + '-the-copy.zip')
    with open(copy_path, 'wb') as f:
        f.write(copy)
    # after the copy: a third page — and its sent words, which the browser sends only four minutes later
    A.evaluate("""async (sid) => { const { db } = await import('/js/store.js'); const sent = await import('/js/sent.js');
        await db.messages.append(sid, { role: 'user', text: 'After the copy.' });
        await db.messages.append(sid, { role: 'assistant', text: 'PAGE-THREE-AFTER-THE-COPY.', receipt: { sentId: 'snt_three', slots: [] } });
        await sent.keepSent({ id: 'snt_three', storyId: sid, slots: [{ name: 'The frame', text: 'THE-WORDS-OF-PAGE-THREE ' + 'w'.repeat(1500) }], requests: [] }); }""", sid)
    time.sleep(1.5)
    check(len(device_pages(sid)) == 6, 'the third page is on the device (appended at once)')
    # three more browsers that hold the tale as it is now: B stays open, C is closed, E never hears the device's announcements
    B, C, E = open_tavern(b_ctx), open_tavern(c_ctx), open_tavern(e_ctx, block_events=True)
    held = [pg.evaluate(OPEN, sid) for pg in (B, C, E)]
    check(all(len(h) == 6 for h in held), 'three other browsers each hold the tale with its three pages: %s' % [len(h) for h in held])
    C.close()
    # A brings the copy back through the real control
    A.on('dialog', lambda d: d.accept())
    A.evaluate("() => { location.hash = '#/settings'; }")
    A.wait_for_timeout(500)
    A.set_input_files('#import-file', copy_path)
    back = wait_pages(A, sid, lambda h: len(h) == 4, 'A reads the copy in', 120)
    check(back is not None and len(back) == 4 and not any('PAGE-THREE' in t for t in back), 'the browser that brought the copy back shows the copy: two pages (%s)' % (len(back) if back else None))
    check(len(device_pages(sid)) == 4, 'the device holds the copy: two pages')
    epoch = json.loads(get('api/books/list')[1] or b'{}').get('epoch')
    check(isinstance(epoch, str) and len(epoch) > 0, 'the device names the library it now holds (its epoch): %r' % epoch)
    # C7: what A had not sent yet is in the copy the device kept of the library as it stood
    safety = None
    for n in sorted(os.listdir(os.path.join(DATA, 'backups'))):
        if n.endswith('.zip'):
            with zipfile.ZipFile(os.path.join(DATA, 'backups', n)) as z:
                names = z.namelist()
                whole = b''.join(z.read(x) for x in names if x.startswith('books/' + sid))
                if b'PAGE-THREE-AFTER-THE-COPY' in whole:
                    safety = (n, 'sent/%s.ndjson' % sid in names and b'THE-WORDS-OF-PAGE-THREE' in z.read('sent/%s.ndjson' % sid))
    check(safety is not None, 'the library as it stood (three pages) is kept in a copy on the device')
    check(bool(safety and safety[1]), 'and that copy holds what the storyteller was sent for the third page — it was sent to the device before the copy took the library\'s place (it was in no copy, no browser and no device afterwards)')
    # B was open: it is told, and becomes the copy
    held_b = wait_pages(B, sid, lambda h: len(h) == 4, 'B becomes the copy', 90)
    check(held_b is not None and len(held_b) == 4, 'the browser that was open at the time now shows the copy too — two pages, by itself (%s)' % (len(held_b) if held_b else None))
    b_epoch, b_toasts = None, []
    try:
        ready(B)
        b_epoch = B.evaluate("() => localStorage.getItem('cozy.epoch')")
        for _ in range(16):  # the note is said a moment after the tavern is up again
            b_toasts = B.evaluate("() => (window.__toasts || []).slice()")
            if any('brought back' in t for t in b_toasts):
                break
            time.sleep(0.5)
    except Exception:
        pass
    check(b_epoch == 'e:' + str(epoch), 'and knows which library its books belong to (%r)' % b_epoch)
    check(any('brought back' in t for t in b_toasts), 'and says so once: %s' % json.dumps(b_toasts, ensure_ascii=False)[:200])
    # E never heard the announcement and still holds three pages: what it writes is refused, and it becomes the copy
    before_e = E.evaluate(PAGES_OF, sid)
    E.evaluate(APPEND, [sid, 'PAGE-WRITTEN-BY-THE-BROWSER-THAT-DID-NOT-KNOW.'])
    held_e = wait_pages(E, sid, lambda h: len(h) == 4, 'E becomes the copy', 90)
    check(before_e is not None and len(before_e) == 6 and held_e is not None and len(held_e) == 4, 'a browser that never heard of it and wrote a page: the write is refused by the device, and it becomes the copy (held %s, then %s)' % (len(before_e) if before_e else None, len(held_e) if held_e else None))
    on_device = device_pages(sid)
    check(len(on_device) == 4 and not any('PAGE-THREE' in t or 'DID-NOT-KNOW' in t for t in on_device), 'the device still holds the copy and nothing of the library before it: %s' % [t[:24] for t in on_device])
    # C was closed: opened again, it becomes the copy before it can push anything — and what it then writes is added to the copy
    C2 = open_tavern(c_ctx)
    held_c = wait_pages(C2, sid, lambda h: len(h) == 4, 'C becomes the copy', 90)
    check(held_c is not None and len(held_c) == 4, 'the browser that was closed at the time, opened again, shows the copy (%s)' % (len(held_c) if held_c else None))
    try:
        ready(C2)
        C2.evaluate(OPEN, sid)
        C2.evaluate(APPEND, [sid, 'PAGE-WRITTEN-IN-THE-COPY.'])
        C2.evaluate("async () => { await window.__cozy.booksStatus.pushAll(); }")
    except Exception as err:
        check(False, 'the browser that was closed can write again: ' + str(err)[:160])
    time.sleep(2)
    on_device = device_pages(sid)
    check(len(on_device) == 6 and 'PAGE-WRITTEN-IN-THE-COPY.' in on_device and 'PAGE-ONE of the tale.' in on_device and 'PAGE-TWO of the tale.' in on_device and not any('PAGE-THREE' in t for t in on_device),
          'and its next page is added to the copy — the old third page is NOT pushed back over it: %s' % sorted(t[:26] for t in on_device))
    for c in (a_ctx, b_ctx, c_ctx, e_ctx):
        c.close()


# ---------------------------------------------------------------------------------------------------------------------
def scene_parked_push(b, srv_box):
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block', accept_downloads=True)
    A = open_tavern(ctx)
    sid = A.evaluate("""async () => { const { db } = await import('/js/store.js');
        const st = await db.stories.create({ title: 'the tale whose push is parked' });
        await db.messages.append(st.id, { role: 'user', text: 'I begin.' });
        await db.messages.append(st.id, { role: 'assistant', text: 'The first page.' });
        await db.settings.set('state:' + st.id, { note: 'THE-LEDGER-BEFORE' });
        await db.settings.set('welcomeSeen', true);
        window.__cozy.setActiveStoryId(st.id);
        await window.__cozy.chat.renderThread({ structural: true });
        await window.__cozy.booksStatus.pushAll();
        return st.id; }""")
    check('THE-LEDGER-BEFORE' in json.dumps(device_book(sid) or {}), 'the tale and its ledger are on the device')
    # Settings is open already (opening it can itself touch the open tale, which would send it for another reason)
    A.evaluate("() => { location.hash = '#/settings'; }")
    A.wait_for_timeout(1500)
    A.evaluate("async () => { await window.__cozy.booksStatus.pushAll(); }")
    stop(srv_box[0])
    # the ledger changes while the tavern is not running: the push fails and is parked (twenty seconds, doubling)
    A.evaluate("""async (sid) => { const { db } = await import('/js/store.js'); await db.settings.set('state:' + sid, { note: 'THE-LEDGER-AFTER' }); await window.__cozy.booksStatus.pushAll(); }""", sid)
    A.wait_for_timeout(1500)
    srv_box[0] = start()
    check('THE-LEDGER-AFTER' not in json.dumps(device_book(sid) or {}), 'the tavern is back, and the device still holds the ledger from before (the failed push waits to be tried again)')
    try:
        with A.expect_download(timeout=60000) as dl:
            A.evaluate("() => document.getElementById('btn-export').click()")
        path = dl.value.path()
        name = dl.value.suggested_filename
        with zipfile.ZipFile(path) as z:
            book = b''.join(z.read(x) for x in z.namelist() if x.startswith('books/' + sid))
        check(name.endswith('.zip') and b'THE-LEDGER-AFTER' in book, '"Take a copy" pressed at once: the copy holds the ledger as it is NOW — the parked push was sent first (%s)' % name)
        note = A.evaluate("() => document.getElementById('backup-note').textContent")
        check('does not hold yet' not in note, 'and the note does not say anything was left behind: %s' % note[:120])
    except Exception as err:
        check(False, '"Take a copy" after the tavern came back: ' + str(err)[:200])
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------
def scene_tale_let_go(b):
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block')
    A = open_tavern(ctx)
    sid = A.evaluate("""async () => { const { db } = await import('/js/store.js'); const sent = await import('/js/sent.js');
        const st = await db.stories.create({ title: 'the tale that is let go' });
        await db.messages.append(st.id, { role: 'user', text: 'I begin.' });
        await db.messages.append(st.id, { role: 'assistant', text: 'A page.', receipt: { sentId: 'snt_gone1', slots: [] } });
        await sent.keepSent({ id: 'snt_gone1', storyId: st.id, slots: [{ name: 'The frame', text: 'WORDS-OF-A-TALE-LET-GO ' + 'g'.repeat(1500) }], requests: [] });
        await window.__cozy.booksStatus.pushAll();
        return st.id; }""")
    time.sleep(1)
    gone = A.evaluate("""async (sid) => { const { db } = await import('/js/store.js'); const sent = await import('/js/sent.js');
        const before = (await sent.sentStats(sid)).pages;
        await db.stories.remove(sid);
        await new Promise((r) => setTimeout(r, 400));
        const after = (await sent.sentStats(sid)).pages;
        const pushed = await sent.pushSentToDevice(sid);   /* what the four-minute timer would do */
        return { before, after, pushed }; }""", sid)
    check(gone == {'before': 1, 'after': 0, 'pushed': False}, 'the tale let go: its sent words go from this browser at once, and nothing of it is sent afterwards: %s' % json.dumps(gone))
    time.sleep(1)
    check(not os.path.exists(os.path.join(DATA, 'sent', sid + '.ndjson')) and os.path.exists(os.path.join(DATA, 'books', sid + '.json.gone')), 'on the device its tombstone stands and NO archive of its words was written back beside it')
    st, body = get('api/books/sent/%s?have=1' % sid)
    check(st == 410, 'and the device says the tale was let go when asked what it holds of it (410): %s' % st)
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------
def scene_page_changed_in_place(b):
    """M675 (the second reading): a page changed through the store's guarded door (db.messages.change — a mend, the
    repair of stored pages) reaches the device like any other change. The door was new in M675 and the device was
    never told of what went through it: the mended words stayed in this browser until something else moved the tale."""
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block')
    A = open_tavern(ctx)
    made = A.evaluate("""async () => { const { db } = await import('/js/store.js');
        const st = await db.stories.create({ title: 'a page changed in place' });
        await db.messages.append(st.id, { role: 'user', text: 'I begin.' });
        const page = await db.messages.append(st.id, { role: 'assistant', text: 'AS-FIRST-TOLD the hall was quiet.' });
        await db.settings.set('welcomeSeen', true);
        await window.__cozy.chat.openStory(st.id);
        await window.__cozy.booksStatus.pushAll();
        return { sid: st.id, pid: page.id }; }""")
    time.sleep(1.5)
    check(any('AS-FIRST-TOLD' in t for t in device_pages(made['sid'])), 'fixture: the device holds the page as first told')
    changed = A.evaluate("""async (a) => { const { db } = await import('/js/store.js');
        const row = await db.messages.change(a.sid, a.pid, (now) => ({ text: 'AS-MENDED the hall was quiet, and cold.', mended: { before: now.text, why: 'a mend', at: Date.now() } }));
        return Boolean(row); }""", made)
    check(changed is True, 'fixture: the page was changed through the guarded door')
    reached = False
    for _ in range(16):   # nothing is pressed: the change goes to the device by itself, as a page does (well inside the twenty-second push)
        time.sleep(0.5)
        if any('AS-MENDED' in t for t in device_pages(made['sid'])):
            reached = True
            break
    check(reached, 'the device holds the page as changed, with nothing pressed (it kept the words as first told): %s' % json.dumps(device_pages(made['sid']))[:200])
    refused = A.evaluate("""async (a) => { const { db } = await import('/js/store.js');
        const row = await db.messages.change(a.sid, a.pid, () => undefined); return row === null || row === undefined || row === false; }""", made)
    check(refused is True, 'and a change that decides to write nothing sends nothing and breaks nothing')
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------
def scene_branch(b):
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block')
    A = open_tavern(ctx)
    A.on('dialog', lambda d: d.accept())
    parent = A.evaluate("""async () => { const { db } = await import('/js/store.js'); const sent = await import('/js/sent.js');
        const st = await db.stories.create({ title: 'the first tale' });
        await db.messages.append(st.id, { role: 'user', text: 'I begin.' });
        await db.messages.append(st.id, { role: 'assistant', text: '[The yard — Monday, March 3, 2025 | 09:00 | clear | coat | by the gate]\\n\\nTHE-CARRIED-PAGE stood in the yard.', receipt: { sentId: 'snt_carried', slots: [] } });
        await sent.keepSent({ id: 'snt_carried', storyId: st.id, slots: [{ name: 'The frame', text: 'WHAT-THE-STORYTELLER-SAW-FOR-THE-CARRIED-PAGE ' + 'c'.repeat(1500) }], requests: [] });
        await db.settings.set('welcomeSeen', true);
        await db.stories.update(st.id, { extraction: false, keeper: false });
        window.__cozy.setActiveStoryId(st.id);
        await window.__cozy.chat.renderThread({ structural: true });
        await window.__cozy.booksStatus.pushAll();
        return st.id; }""")
    # the real control: "branch" under the storyteller's page (its words have NOT been sent to the device yet)
    A.wait_for_selector('#thread .msg-assistant .msg-act[data-act="branch"]', state='attached', timeout=20000)
    A.evaluate("() => document.querySelector('#thread .msg-assistant .msg-act[data-act=\"branch\"]').click()")
    branch = None
    for _ in range(80):
        branch = A.evaluate("""async (parent) => { const { db } = await import('/js/store.js'); const all = await db.stories.list(); const other = all.find((s) => s.id !== parent && /first tale/.test(s.title || '') && !s.building); return other ? other.id : null; }""", parent)
        if branch:
            break
        time.sleep(0.5)
    check(bool(branch), 'a branch was made from the page')
    words = None
    for _ in range(60):
        words = device_words(branch, 'snt_carried') if branch else None
        if words:
            break
        time.sleep(0.5)
    check(bool(words) and 'WHAT-THE-STORYTELLER-SAW-FOR-THE-CARRIED-PAGE' in words, 'the device reads the carried page\'s words back under the BRANCH\'s own name (it had nothing under it)')
    # the first tale let go: the branch still reads them
    A.evaluate("""async (parent) => { const { db } = await import('/js/store.js'); await db.stories.remove(parent); }""", parent)
    time.sleep(1.5)
    words = device_words(branch, 'snt_carried') if branch else None
    sheet = A.evaluate("""async ([branch]) => { const sent = await import('/js/sent.js'); const why = {}; const got = await sent.loadSentOrPull('snt_carried', branch, why); return { text: got ? got.slots.map((s) => s.text).join(' ').slice(0, 44) : null, why: why.why || null }; }""", [branch])
    check(bool(words) and 'WHAT-THE-STORYTELLER-SAW' in words and sheet.get('text') and 'WHAT-THE-STORYTELLER-SAW' in sheet['text'], 'the first tale let go: the branch still reads its carried page\'s words, on the device and in the sheet (%s)' % json.dumps(sheet))
    # a branch made BEFORE this (its words kept only under another tale's name on the device) is healed by being opened
    old = A.evaluate("""async () => { const { db } = await import('/js/store.js'); const sent = await import('/js/sent.js');
        const first = await db.stories.create({ title: 'an older first tale' });
        await db.messages.append(first.id, { role: 'user', text: 'I begin.' });
        await db.messages.append(first.id, { role: 'assistant', text: 'AN-OLDER-CARRIED-PAGE.', receipt: { sentId: 'snt_older', slots: [] } });
        await sent.keepSent({ id: 'snt_older', storyId: first.id, slots: [{ name: 'The frame', text: 'WORDS-KEPT-UNDER-THE-OLDER-FIRST-TALE ' + 'o'.repeat(1500) }], requests: [] });
        await window.__cozy.booksStatus.pushAll();
        await sent.pushSentToDevice(first.id);
        /* the branch as the build before made it: the page copied whole, its words left under the first tale's name */
        const br = await db.stories.create({ title: 'an older branch' });
        await db.messages.append(br.id, { role: 'user', text: 'I begin.' });
        await db.messages.append(br.id, { role: 'assistant', text: 'AN-OLDER-CARRIED-PAGE.', receipt: { sentId: 'snt_older', slots: [] } });
        await db.stories.update(br.id, { extraction: false, keeper: false });
        await window.__cozy.booksStatus.pushAll();
        return { first: first.id, branch: br.id }; }""")
    check(device_words(old['first'], 'snt_older') is not None and device_words(old['branch'], 'snt_older') is None, 'an older branch: the device holds its carried page\'s words under the first tale only')
    A.evaluate("async (id) => { await window.__cozy.chat.openStory(id); }", old['branch'])
    words = None
    for _ in range(60):
        words = device_words(old['branch'], 'snt_older')
        if words:
            break
        time.sleep(0.5)
    check(bool(words) and 'WORDS-KEPT-UNDER-THE-OLDER-FIRST-TALE' in words, 'opened, it is healed: the device now reads them under the branch\'s own name')
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------
def scene_not_let_go(b, srv_box):
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block')
    A = open_tavern(ctx)
    sid = A.evaluate("""async () => { const { db } = await import('/js/store.js'); const sent = await import('/js/sent.js');
        const st = await db.stories.create({ title: 'the long sitting' });
        await db.messages.append(st.id, { role: 'user', text: 'I begin.' });
        await db.messages.append(st.id, { role: 'assistant', text: 'A page.', receipt: { sentId: 'snt_long_0', slots: [] } });
        await sent.keepSent({ id: 'snt_long_0', storyId: st.id, slots: [{ name: 'The frame', text: 'WORDS-0 ' + 'a'.repeat(600) }], requests: [] });
        await window.__cozy.booksStatus.pushAll();
        await sent.pushSentToDevice(st.id);
        return st.id; }""")
    check(device_words(sid, 'snt_long_0') is not None, 'the tale\'s first page of words is on the device')
    stop(srv_box[0])
    # a long sitting with the tavern not running: 230 pages told (the browser keeps the newest 200 of a tale)
    kept = A.evaluate("""async (sid) => { const sent = await import('/js/sent.js');
        for (let i = 1; i <= 230; i += 1) await sent.keepSent({ id: 'snt_long_' + i, storyId: sid, slots: [{ name: 'The frame', text: 'WORDS-' + i + ' ' + String(i).repeat(200) }], requests: [] });
        const why = {}; const got = await sent.loadSentOrPull('snt_not_here', sid, why);
        let unsent = 0; for (let i = 1; i <= 230; i += 1) if (await sent.loadSent('snt_long_' + i)) unsent += 1;
        return { pages: (await sent.sentStats(sid)).pages, unsent, got: got === null, why: why.why || null }; }""", sid)
    check(kept.get('unsent') == 230, 'with the tavern not running, the browser lets go of NONE of the 230 pages the device has not got (it keeps the newest 200 of a tale otherwise): %s still here, %s in all' % (kept.get('unsent'), kept.get('pages')))
    check(kept.get('why') == 'no answer', 'and a sheet opened for a page this browser does not hold says the tavern is not answering — not that the words were never kept: %r' % kept.get('why'))
    srv_box[0] = start()
    pushed = A.evaluate("""async (sid) => { const sent = await import('/js/sent.js'); sent.forgetDevice(); const ok = await sent.pushSentToDevice(sid); return ok; }""", sid)
    have = json.loads(get('api/books/sent/%s?have=1' % sid)[1] or b'{}')
    check(pushed is True and len(have.get('pages', [])) == 231, 'the tavern back: every one of the 231 pages reaches the device (the build before: 188 arrived, 42 were in neither place): %s' % len(have.get('pages', [])))
    after = A.evaluate("""async (sid) => { const sent = await import('/js/sent.js'); await sent.pruneSent(sid); const why = {}; const got = await sent.loadSentOrPull('snt_long_3', sid, why); return { pages: (await sent.sentStats(sid)).pages, read: Boolean(got) }; }""", sid)
    check(after.get('pages', 999) <= 200 and after.get('read') is True, 'and only now does the browser let the oldest go — they are read back from the device (%s kept here)' % after.get('pages'))
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------
def scene_partial_copy(b, srv_box):
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block', accept_downloads=True)
    A = open_tavern(ctx)
    ids = A.evaluate("""async () => { const { db } = await import('/js/store.js');
        const made = [];
        for (const title of ['the open tale', 'a tale on the shelf', 'another on the shelf']) {
          const st = await db.stories.create({ title });
          await db.messages.append(st.id, { role: 'user', text: 'I begin ' + title + '.' });
          await db.messages.append(st.id, { role: 'assistant', text: 'THE-PAGE-OF ' + title + '.' });
          made.push(st.id);
        }
        await db.settings.set('welcomeSeen', true);
        await window.__cozy.chat.openStory(made[0]);
        await window.__cozy.booksStatus.pushAll();
        return made; }""")
    # the house lets go of the tales that are not open, once the device is proven to hold them (M313)
    shallow = 0
    for _ in range(40):
        A.evaluate("async () => { try { await window.__cozy.booksStatus.evictOne(); } catch (err) { /* asked again */ } }")
        shallow = A.evaluate("async (mine) => { const { db } = await import('/js/store.js'); return (await db.stories.list()).filter((s) => s.shallow && mine.includes(s.id)).length; }", ids[1:])  # this scene's own two — the device may hold other tales by name
        if shallow >= 2:
            break
        time.sleep(0.5)
    check(shallow >= 2, 'the two tales that are not open live on the device; this browser keeps their names (%d)' % shallow)
    stop(srv_box[0])
    A.evaluate("() => { location.hash = '#/settings'; }")
    A.wait_for_timeout(500)
    try:
        with A.expect_download(timeout=90000) as dl:
            A.evaluate("() => document.getElementById('btn-export').click()")
        name = dl.value.suggested_filename
        body = json.load(open(dl.value.path(), encoding='utf-8'))
        note = A.evaluate("() => document.getElementById('backup-note').textContent")
        toasts = A.evaluate("() => (window.__toasts || []).slice()")
        check('PARTIAL' in name, 'with the tavern not answering, the file is NAMED partial: %s' % name)
        check('NOT a whole copy' in note and 'a tale on the shelf' in note and 'another on the shelf' in note and 'A copy is in your downloads. Keep it somewhere warm.' not in note, 'the note says it is not a whole copy and names the tales that are not in it: %s' % note[:230])
        check(any('PARTIAL' in t for t in toasts), 'and so does the toast: %s' % json.dumps(toasts[-2:], ensure_ascii=False)[:200])
        missing = sorted(t.get('title', '') for t in (body.get('partial') or {}).get('missing', []))
        check(missing == ['a tale on the shelf', 'another on the shelf'] and any('THE-PAGE-OF the open tale' in m.get('text', '') for m in body.get('messages', [])), 'the file itself says what it lacks, and holds the open tale\'s pages: %s' % missing)
    except Exception as err:
        check(False, '"Take a copy" with the tavern not answering: ' + str(err)[:200])
    # 6b. the sent words cannot be folded into the one file (they can be the story's size many times over): the stories
    # still come — one try wrapped both, and a failure folding the words left him with no copy at all
    try:
        A.evaluate("""async (sid) => { const sent = await import('/js/sent.js');
            await sent.keepSent({ id: 'snt_the_open_tale', storyId: sid, slots: [{ name: 'The frame', text: 'WORDS THAT WERE SENT. '.repeat(40) }], requests: [] });
            const real = JSON.stringify;
            JSON.stringify = function (v, ...rest) { if (v && typeof v === 'object' && /\\.all$/.test(String(v.kind || ''))) throw new RangeError('Invalid string length'); return real.call(JSON, v, ...rest); }; }""", ids[0])
        with A.expect_download(timeout=30000) as dl:
            A.evaluate("() => document.getElementById('btn-export').click()")
        body = json.load(open(dl.value.path(), encoding='utf-8'))
        note = A.evaluate("() => document.getElementById('backup-note').textContent")
        check(any('THE-PAGE-OF the open tale' in m.get('text', '') for m in body.get('messages', [])) and 'sent' not in body, 'the sent words could not be folded in: the file still holds the stories (there was no file at all)')
        check('could not be folded in' in note and 'Invalid string length' in note and 'every story, page and ledger this browser holds is in the file' in note, 'and the note says what is not in it: %s' % note[-200:])
    except Exception as err:
        check(False, '"Take a copy" when the sent words cannot be folded in: ' + str(err)[:200])
    srv_box[0] = start()
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------
def scene_copy_lacks(b, hang):
    """The device does not take the tale's newest changes (it answers 500 to the push; or, `hang`, never answers it at
    all): "Take a copy" still hands over the zip of what the device holds — and says what is not in it."""
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block', accept_downloads=True)
    turned = {'away': False, 'n': 0, 'held': []}

    def books(route, request):
        if request.method == 'POST' and turned['away']:
            turned['n'] += 1
            if hang:
                turned['held'].append(route)  # never answered
            else:
                route.fulfill(status=500, content_type='application/json', body='{"ok":false,"why":"no"}')
            return
        route.continue_()
    ctx.route('**/api/books/one/**', books)
    A = open_tavern(ctx)
    title = 'the tale still on its way' if hang else 'the tale the device will not take'
    sid = A.evaluate("""async (title) => { const { db } = await import('/js/store.js');
        const st = await db.stories.create({ title });
        await db.messages.append(st.id, { role: 'user', text: 'I begin.' });
        await db.messages.append(st.id, { role: 'assistant', text: 'The first page.' });
        await db.settings.set('state:' + st.id, { note: 'THE-LEDGER-BEFORE' });
        await db.settings.set('welcomeSeen', true);
        window.__cozy.setActiveStoryId(st.id);
        await window.__cozy.chat.renderThread({ structural: true });
        await window.__cozy.booksStatus.pushAll();
        return st.id; }""", title)
    check('THE-LEDGER-BEFORE' in json.dumps(device_book(sid) or {}), 'the tale and its ledger are on the device')
    A.evaluate("() => { location.hash = '#/settings'; }")
    A.wait_for_timeout(1500)
    A.evaluate("async () => { await window.__cozy.booksStatus.pushAll(); }")
    turned['away'] = True
    A.evaluate("""async (sid) => { const { db } = await import('/js/store.js'); await db.settings.set('state:' + sid, { note: 'THE-LEDGER-AFTER' }); }""", sid)
    if hang:
        # two books to send, each waited for two minutes by the sender itself: together they outlast the three the copy waits
        A.evaluate("async () => { const { db } = await import('/js/store.js'); await db.settings.set('memoryWindow', 21); }")
    began = time.time()
    try:
        with A.expect_download(timeout=330000 if hang else 120000) as dl:
            A.evaluate("() => document.getElementById('btn-export').click()")
        took = time.time() - began
        with zipfile.ZipFile(dl.value.path()) as z:
            book = b''.join(z.read(x) for x in z.namelist() if x.startswith('books/' + sid))
        note = A.evaluate("() => document.getElementById('backup-note').textContent")
        toasts = A.evaluate("() => (window.__toasts || []).slice()")
        check(turned['n'] > 0 and b'THE-LEDGER-BEFORE' in book and b'THE-LEDGER-AFTER' not in book, 'fixture: the device did not take the newest ledger (%d pushes turned away), and the zip is what the device holds' % turned['n'])
        if hang:
            check(170 <= took <= 320, 'the sending is waited for three minutes, not for ever (%d s)' % took)
            check('One thing this copy does not hold yet' in note and 'still on their way to the device' in note, 'the note says the latest changes were still on their way: %s' % note[-230:])
        else:
            check('One thing this copy does not hold yet' in note and title in note and 'the device did not take them' in note, 'the note names what the copy lacks: %s' % note[-230:])
        check(any('what had not reached the device yet' in t for t in toasts), 'and the toast points at the note: %s' % json.dumps(toasts[-2:], ensure_ascii=False)[:200])
    except Exception as err:
        check(False, '"Take a copy" while the device does not take a push: ' + str(err)[:200])
    turned['away'] = False
    for route in turned['held']:
        try:
            route.abort()
        except Exception:
            pass
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------
NEW_TALE = """async ([title, first, second]) => { const { db } = await import('/js/store.js');
    const st = await db.stories.create({ title });
    await db.messages.append(st.id, { role: 'user', text: first });
    await db.messages.append(st.id, { role: 'assistant', text: second });
    await db.settings.set('welcomeSeen', true);
    window.__cozy.setActiveStoryId(st.id);
    await window.__cozy.chat.renderThread({ structural: true });
    await window.__cozy.booksStatus.pushAll();
    return st.id; }"""
KEEP_WORDS = """async ([sid, id, words]) => { const sent = await import('/js/sent.js'); return await sent.keepSent({ id, storyId: sid, slots: [{ name: 'The frame', text: words + ' ' + 'w'.repeat(1500) }], requests: [] }); }"""
WORDS_KEPT = """async (sid) => { const sent = await import('/js/sent.js'); return (await sent.sentStats(sid)).pages; }"""
FALSE_WORDS = ('brought back', 'not answering', 'is not kept')


def knows_epoch(page, epoch, timeout=60):
    """Poll (through the reload a read-in ends with) until this browser has noted `epoch`; returns what it holds."""
    held = None
    end = time.time() + timeout
    while time.time() < end:
        try:
            held = page.evaluate("() => localStorage.getItem('cozy.epoch')")
        except Exception:
            held = None
        if held == 'e:' + str(epoch):
            return held
        time.sleep(0.5)
    return held


def scene_empty_device(b, srv_box):
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block')
    ctx.add_init_script("window.__cozyEvictEveryMs = 3600000;")  # (no tale is let go by itself while the scene reads what this browser holds)
    A = open_tavern(ctx)
    sid = A.evaluate(NEW_TALE, ['the only copy there is', 'I begin.', 'PAGE-ONE held by this browser.'])
    # a copy is brought back once: from here on the device names an epoch, and this browser knows it
    epoch = bring_back_its_own_copy()
    knows = knows_epoch(A, epoch)
    check(bool(epoch) and knows == 'e:' + str(epoch), 'fixture: a copy was brought back once — the device has an epoch and this browser knows it (%r)' % knows)
    try:
        ready(A)
        A.evaluate("async (sid) => { await window.__cozy.chat.openStory(sid); }", sid)
        A.evaluate(APPEND, [sid, 'PAGE-TWO told since.'])
        A.evaluate(KEEP_WORDS, [sid, 'snt_only', 'THE-WORDS-ONLY-THIS-BROWSER-KEEPS'])
        time.sleep(1.5)
    except Exception as err:
        check(False, 'fixture: the browser goes on writing after the copy: ' + str(err)[:160])
    # THE DEVICE'S FOLDER IS EMPTIED (Termux's data cleared): the tavern starts with no books and no epoch
    wipe_device(srv_box)
    check(device_list() == {'books': [], 'gone': [], 'epoch': ''}, 'fixture: the device holds no books at all: %s' % json.dumps(device_list()))
    A.reload(wait_until='load')
    ready(A)
    on_device = []
    for _ in range(40):
        on_device = device_pages(sid)
        if len(on_device) == 4:
            break
        time.sleep(0.5)
    check(sorted(on_device) == sorted(['I begin.', 'PAGE-ONE held by this browser.', 'and then', 'PAGE-TWO told since.']),
          'the tavern opened on an empty device: what this browser holds — the only copy — reaches the device (nothing did, for good): %s' % [t[:22] for t in on_device])
    A.wait_for_timeout(2500)
    toasts = toasts_of(A)
    check(not any(w in t for t in toasts for w in FALSE_WORDS), 'and nothing says a copy was brought back, that the tavern is not answering, or that what is written is not kept: %s' % json.dumps(toasts, ensure_ascii=False)[:260])
    check(A.evaluate(WORDS_KEPT, sid) == 1, 'the words this browser was keeping for the device are still here (they were wiped before anything was read in)')
    check(A.evaluate("() => localStorage.getItem('cozy.epoch')") == 'e:', 'and this browser now holds the device\'s epoch — none: %r' % A.evaluate("() => localStorage.getItem('cozy.epoch')"))
    check(A.evaluate("() => !document.getElementById('boot-veil')"), 'the tavern is open (no veil left standing)')
    # …and the same while the page stays OPEN: a copy brought back once more (an epoch again), then the folder emptied
    epoch = bring_back_its_own_copy()
    knows = knows_epoch(A, epoch)
    try:
        ready(A)
        A.evaluate("async (sid) => { await window.__cozy.chat.openStory(sid); }", sid)
    except Exception:
        pass
    check(bool(epoch) and knows == 'e:' + str(epoch), 'fixture: a copy brought back again, and this browser knows the new epoch (%r)' % knows)
    A.wait_for_timeout(2500)  # (what is said of THAT copy — truly brought back — has been said by now, and is not what is looked at below)
    A.evaluate("() => { (window.__toasts || []).length = 0; }")
    # (the stream of the device's announcements does not come back after the restart: nothing makes this page look
    # again by itself — the only way it learns is the device refusing the page it writes)
    ctx.route('**/api/events', lambda route, request: route.abort())
    wipe_device(srv_box)
    try:
        A.evaluate(APPEND, [sid, 'PAGE-WRITTEN-AFTER-THE-FOLDER-WAS-EMPTIED.'])
    except Exception as err:
        check(False, 'a page is written while the page stays open: ' + str(err)[:160])
    on_device = []
    for _ in range(120):
        on_device = device_pages(sid)
        if 'PAGE-WRITTEN-AFTER-THE-FOLDER-WAS-EMPTIED.' in on_device:
            break
        time.sleep(0.5)
    check(len(on_device) == 6 and 'PAGE-WRITTEN-AFTER-THE-FOLDER-WAS-EMPTIED.' in on_device and 'PAGE-ONE held by this browser.' in on_device,
          'the folder emptied while the page was open, and a page written: the whole tale reaches the device, the new page with it: %s' % [t[:22] for t in on_device])
    toasts = toasts_of(A)
    check(not any(w in t for t in toasts for w in FALSE_WORDS), 'and still nothing false is said: %s' % json.dumps(toasts, ensure_ascii=False)[:260])
    # …and the hardest moment: the page LOOKS AGAIN by itself (the stream of announcements came back) just as a page is
    # written. The look finds an empty device and begins to send what this browser holds; the page, written with the
    # epoch this browser still remembered, is refused as "another library's". Nothing of this browser's may be let go
    # for that — the device holds only what this browser has sent it so far, never "a copy" to become.
    epoch = bring_back_its_own_copy()
    try:
        A.evaluate("() => { window.__cozy.booksStatus.catchUp(); }")  # (its stream of announcements is shut: it is made to look)
    except Exception:
        pass
    knows = knows_epoch(A, epoch)
    try:
        ready(A)
        A.evaluate("async (sid) => { await window.__cozy.chat.openStory(sid); }", sid)
        A.wait_for_timeout(2500)
        other = A.evaluate("""async () => { const { db } = await import('/js/store.js');
            const made = [];
            for (const n of [1, 2, 3]) { const st = await db.stories.create({ title: 'another tale only this browser holds ' + n });
              await db.messages.append(st.id, { role: 'assistant', text: 'ITS-ONLY-PAGE-' + n + ' ' + 'x'.repeat(60000) }); made.push(st.id); }
            await window.__cozy.booksStatus.pushAll();
            (window.__toasts || []).length = 0; window.__stayed = 1;
            return made; }""")
    except Exception as err:
        other = []
        check(False, 'fixture: more tales are written in this browser: ' + str(err)[:160])
    A.evaluate(KEEP_WORDS, [sid, 'snt_third', 'WORDS-KEPT-FOR-THE-THIRD-TIME'])
    check(bool(epoch) and knows == 'e:' + str(epoch) and len(other) == 3, 'fixture: a copy brought back a third time; this browser knows the epoch and holds four tales whole (%r)' % knows)
    ctx.route('**/api/events', lambda route, request: route.abort())
    slowed = {'n': 0}

    def slow_books(route, request):
        if request.method == 'POST':
            slowed['n'] += 1
            time.sleep(0.5)  # each book takes its time on the way to the device: the look is still sending when the page is written
        route.continue_()
    ctx.route('**/api/books/one/**', slow_books)
    wipe_device(srv_box)
    try:
        A.evaluate("""async ([sid, text]) => { const { db } = await import('/js/store.js');
            const look = window.__cozy.booksStatus.catchUp();     /* what the stream coming back, or the page coming into view, does */
            await new Promise((r) => setTimeout(r, 1300));         /* …it has found the device empty, and some of the books have reached it */
            await db.messages.append(sid, { role: 'assistant', text });
            await look; }""", [sid, 'PAGE-WRITTEN-AS-THE-PAGE-LOOKED-AGAIN.'])
    except Exception as err:
        check(False, 'the page looks again as a page is written: ' + str(err)[:160])
    listed = []
    for _ in range(120):
        listed = [x.get('id') for x in device_list().get('books', [])]
        if all(t in listed for t in [sid] + other) and 'PAGE-WRITTEN-AS-THE-PAGE-LOOKED-AGAIN.' in device_pages(sid):
            break
        time.sleep(0.5)
    A.wait_for_timeout(3000)
    try:
        here = A.evaluate("""async (ids) => { const { db } = await import('/js/store.js'); const out = [];
            for (const id of ids) { const st = await db.stories.get(id); out.push(st ? (await db.messages.list(id)).length : -1); }
            return { pages: out, stayed: window.__stayed === 1 }; }""", [sid] + other)
    except Exception as err:
        here = {'pages': [], 'stayed': False, 'err': str(err)[:120]}
    check(here.get('pages') == [7, 1, 1, 1], 'the page looked again just as a page was written: every tale this browser held is STILL here, whole (a read-in of "the device\'s copy" then would have let go of whatever had not been sent yet): %s' % json.dumps(here))
    check(all(t in listed for t in [sid] + other) and 'PAGE-WRITTEN-AS-THE-PAGE-LOOKED-AGAIN.' in device_pages(sid), 'and all of it is on the device, the page just written with it: %d books, the page there: %s' % (len(listed), 'PAGE-WRITTEN-AS-THE-PAGE-LOOKED-AGAIN.' in device_pages(sid)))
    toasts = toasts_of(A)
    check(A.evaluate(WORDS_KEPT, sid) >= 1 and not any(w in t for t in toasts for w in FALSE_WORDS), 'its kept words are still here, and nothing false was said: %s' % json.dumps(toasts, ensure_ascii=False)[:200])
    check(A.evaluate("() => localStorage.getItem('cozy.epoch')") == 'e:', 'and it holds the device\'s epoch — none (%r)' % A.evaluate("() => localStorage.getItem('cozy.epoch')"))
    check(slowed['n'] >= 4, 'fixture: the books were on their way while the page was written (%d sendings slowed)' % slowed['n'])
    ctx.unroute('**/api/books/one/**', slow_books)
    # …and "become the device's copy" is never done of a device whose books are this browser's OWN (the same epoch):
    # it lets go of every tale the device does not list — here, a tale that has not been sent yet
    shut = {'on': True}

    def no_sending(route, request):
        if shut['on'] and request.method == 'POST':
            route.abort()
        else:
            route.continue_()
    ctx.route('**/api/books/**', no_sending)
    try:
        unsent = A.evaluate("""async () => { const { db } = await import('/js/store.js');
            const st = await db.stories.create({ title: 'a tale that has not been sent yet' });
            await db.messages.append(st.id, { role: 'assistant', text: 'ITS-ONLY-PAGE, in this browser alone.' });
            window.__stayed = 2;
            const m = await window.__cozy.booksStatus.mirrorDevice();
            await new Promise((r) => setTimeout(r, 1500));
            return { id: st.id, ok: Boolean(m && m.ok), same: Boolean(m && m.same) }; }""")
    except Exception as err:
        unsent = {'err': str(err)[:160]}
    try:
        ready(A)
        still = A.evaluate("""async (id) => { const { db } = await import('/js/store.js'); const st = id ? await db.stories.get(id) : null;
            const sent = await import('/js/sent.js');
            return { pages: st ? (await db.messages.list(id)).length : -1, stayed: window.__stayed === 2 }; }""", unsent.get('id'))
    except Exception as err:
        still = {'err': str(err)[:160]}
    check(unsent.get('same') is True and unsent.get('ok') is False and still.get('pages') == 1 and still.get('stayed') is True and A.evaluate(WORDS_KEPT, sid) >= 1,
          'asked to become the copy of a device that holds this browser\'s own books: it does not — a tale not yet sent is still here, the page did not reload, the kept words are here (it was let go, with the words): %s %s' % (json.dumps(unsent), json.dumps(still)))
    shut['on'] = False
    ctx.unroute('**/api/books/**', no_sending)
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------
OTHER_NAME = 'tavern.test'  # (Chromium is started knowing this name as another name for this device — see the launch below)


def scene_refused_by_name(b, srv_box):
    lan = 'http://%s:%s/' % (OTHER_NAME, PORT)
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block', accept_downloads=True)
    downloads = []
    A = open_tavern(ctx, base=lan)
    A.on('download', lambda d: downloads.append(d.suggested_filename))
    A.wait_for_timeout(3500)
    st = A.evaluate("() => ({ backed: window.__cozy.booksStatus.backed, words: window.__cozy.booksStatus.words })")
    toasts = toasts_of(A)
    told = [t for t in toasts if 'COZY_HOSTS=' + OTHER_NAME in t]
    check(st.get('backed') is False and len(told) == 1 and 'running' in told[0] and 'reaches' in told[0],
          'opened under another name for the device: the app SAYS the tavern is running, that it does not serve this address, and how to start it so that it does (it said nothing): %s' % json.dumps(toasts, ensure_ascii=False)[:300])
    check('COZY_HOSTS=' + OTHER_NAME in str(st.get('words')) and 'did not answer' not in str(st.get('words')), 'and so does "Where the tales live": %s' % str(st.get('words'))[:200])
    sid = A.evaluate("""async () => { const { db } = await import('/js/store.js');
        const s = await db.stories.create({ title: 'told on the tablet' });
        await db.messages.append(s.id, { role: 'user', text: 'I begin.' });
        await db.messages.append(s.id, { role: 'assistant', text: 'A-PAGE-TOLD-ON-THE-TABLET.' });
        await db.settings.set('welcomeSeen', true);
        return s.id; }""")
    A.wait_for_timeout(1500)
    A.evaluate("() => { location.hash = '#/settings'; }")
    A.wait_for_timeout(800)
    live = A.evaluate("() => document.getElementById('books-live').textContent")
    check('COZY_HOSTS=' + OTHER_NAME in live, 'the Settings line says the same: %s' % live[:200])
    A.evaluate("() => document.getElementById('btn-export').click()")
    note = ''
    for _ in range(60):
        note = A.evaluate("() => document.getElementById('backup-note').textContent")
        if note and 'Making a copy' not in note and 'Sending' not in note:
            break
        time.sleep(0.5)
    A.wait_for_timeout(2000)
    check('COZY_HOSTS=' + OTHER_NAME in note and 'did not answer' not in note and not downloads,
          '"Take a copy" there says the same — not that the tavern "did not answer" — and hands over no file as if it were absent: %s (files: %s)' % (note[:220], downloads))
    # …and "Bring a copy back", handed the device's zip there, says the same (it said "Start the tavern" of a tavern that is running)
    zip_path = os.path.join(DATA, '..', os.path.basename(DATA) + '-tablet-copy.zip')
    with zipfile.ZipFile(zip_path, 'w') as z:
        z.writestr('books/_house.json', '{}')
    A.on('dialog', lambda d: d.accept())
    A.set_input_files('#import-file', zip_path)
    note = ''
    for _ in range(20):
        note = A.evaluate("() => document.getElementById('backup-note').textContent")
        if '.zip copy' in note:
            break
        time.sleep(0.5)
    check('COZY_HOSTS=' + OTHER_NAME in note and 'running' in note and 'Start the tavern (' not in note, '"Bring a copy back" there says the same of the device\'s zip — not "Start the tavern": %s' % note[:260])
    try:
        os.remove(zip_path)
    except OSError:
        pass
    check(len([t for t in toasts_of(A) if 'COZY_HOSTS=' + OTHER_NAME in t]) == 1, 'it is said once a sitting, not at every look')
    # …and the sheet of a page whose words this browser does not hold says the same — not "no tavern's server behind this page", nor "not answering"
    sheet = A.evaluate("""async (sid) => { const sent = await import('/js/sent.js'); const why = {};
        const got = await sent.loadSentOrPull('snt_never_kept_here', sid, why);
        const view = await import('/js/ui/receiptview.js');
        view.openReceipt({ sentId: 'snt_never_kept_here', slots: [{ name: 'The frame', tokens: 12 }] }, null, null, { storyId: sid });
        let note = '';
        for (let i = 0; i < 40; i += 1) { note = document.getElementById('receipt-words-note').textContent; if (note && !/Fetching/.test(note)) break; await new Promise((r) => setTimeout(r, 250)); }
        view.closeReceipt();
        return { got: got === null, why: why.why, note }; }""", sid)
    check(sheet.get('got') is True and sheet.get('why') == 'refused' and 'does not answer under this address' in str(sheet.get('note')) and 'no tavern' not in str(sheet.get('note')) and 'not answering' not in str(sheet.get('note')),
          'a page\'s sheet there, for words this browser does not hold: it says the tavern is running and does not answer under this address (it said there was no tavern\'s server behind the page): %s' % json.dumps(sheet, ensure_ascii=False)[:300])
    # a tale this browser holds by name alone (as a partial copy brought back leaves it): the search cannot ask the tavern for it — and says why
    A.evaluate("() => { location.hash = '#/'; }")
    found = A.evaluate("""async () => { const { db } = await import('/js/store.js');
        const s = await db.stories.create({ title: 'held by name on the tablet' });
        await db.stories.update(s.id, { shallow: true });
        await window.__cozy.search.run('TABLET');
        return document.getElementById('search-results').textContent; }""")
    check('does not answer under this address' in found and 'did not answer' not in found, 'and the search says the tavern does not answer under this address — not that the device "did not answer": %s' % found[-200:])
    check(device_book(sid) is None, 'fixture: nothing written there has reached the device')
    # started as the words say, the tavern serves that address — and what was written there reaches it
    stop(srv_box[0])
    srv_box[0] = start({'COZY_HOSTS': OTHER_NAME})
    A.reload(wait_until='load')
    ready(A)
    on_device = []
    for _ in range(40):
        on_device = device_pages(sid)
        if on_device:
            break
        time.sleep(0.5)
    st = A.evaluate("() => ({ backed: window.__cozy.booksStatus.backed, words: window.__cozy.booksStatus.words })")
    check('A-PAGE-TOLD-ON-THE-TABLET.' in on_device and st.get('backed') is True and 'COZY_HOSTS' not in str(st.get('words')),
          'started with COZY_HOSTS=%s, the tavern answers there: the tale reaches the device, and nothing more is said of it: %s / %s' % (OTHER_NAME, [t[:26] for t in on_device], str(st.get('words'))[:80]))
    ctx.close()
    stop(srv_box[0])
    srv_box[0] = start()


# ---------------------------------------------------------------------------------------------------------------------
def scene_words_reported(b, srv_box):
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block', accept_downloads=True)
    A = open_tavern(ctx)
    title = 'the tale whose words wait'
    sid = A.evaluate(NEW_TALE, [title, 'I begin.', 'A page whose words wait.'])
    A.evaluate(KEEP_WORDS, [sid, 'snt_wait1', 'THE-WORDS-THAT-WAITED-ONE'])
    A.evaluate("() => { location.hash = '#/settings'; }")
    A.wait_for_timeout(1500)
    A.evaluate("async () => { await window.__cozy.booksStatus.pushAll(); }")
    # (a) one look for the device fails while the tavern is not running; it is started again and he asks for a copy at once
    stop(srv_box[0])
    looked = A.evaluate("async (sid) => { const sent = await import('/js/sent.js'); return await sent.pushSentToDevice(sid); }", sid)
    srv_box[0] = start()
    copy_path = os.path.join(DATA, '..', os.path.basename(DATA) + '-words-copy.zip')
    try:
        with A.expect_download(timeout=90000) as dl:
            A.evaluate("() => document.getElementById('btn-export').click()")
        dl.value.save_as(copy_path)
        with zipfile.ZipFile(copy_path) as z:
            names = z.namelist()
            words = z.read('sent/%s.ndjson' % sid) if 'sent/%s.ndjson' % sid in names else b''
        note = A.evaluate("() => document.getElementById('backup-note').textContent")
        check(looked is False and b'THE-WORDS-THAT-WAITED-ONE' in words,
              'a look for the device had failed a moment before; the tavern is back and "Take a copy" is pressed: it looks afresh, and the copy holds what the storyteller was sent (the copy held none of it, and the note said nothing): in the copy: %s' % (b'THE-WORDS-THAT-WAITED-ONE' in words))
        check('does not hold yet' not in note, 'and the note has nothing to add: %s' % note[:140])
    except Exception as err:
        check(False, '"Take a copy" right after the tavern came back: ' + str(err)[:200])
    # (b) the device will not take a tale's words: the copy is still made — and the note says what it lacks
    A.evaluate(KEEP_WORDS, [sid, 'snt_wait2', 'THE-WORDS-THE-DEVICE-WOULD-NOT-TAKE'])
    turned = {'n': 0}

    def words_door(route, request):
        if request.method == 'POST':
            turned['n'] += 1
            route.fulfill(status=500, content_type='application/json', body='{"ok":false,"why":"no"}')
            return
        route.continue_()
    ctx.route('**/api/books/sent/**', words_door)
    try:
        with A.expect_download(timeout=90000) as dl:
            A.evaluate("() => document.getElementById('btn-export').click()")
        dl.value.path()
        note = A.evaluate("() => document.getElementById('backup-note').textContent")
        check(turned['n'] > 0 and 'does not hold yet' in note and 'what the storyteller was sent' in note and title in note and '1 page' in note,
              'the device would not take a page\'s sent words: the copy is handed over, and the note names the tale and how many pages\' words it lacks (it said nothing): %s' % note[-260:])
    except Exception as err:
        check(False, '"Take a copy" while the device does not take the words: ' + str(err)[:200])
    # …and "Bring a copy back" asks before they are lost for good (it cleared them without a word)
    epoch_before = device_list().get('epoch')
    asked = []

    def on_dialog(d):
        asked.append(d.message)
        if len(asked) == 1:
            d.accept()
        else:
            d.dismiss()
    A.on('dialog', on_dialog)
    try:
        A.set_input_files('#import-file', copy_path)
        note = ''
        for _ in range(60):
            note = A.evaluate("() => document.getElementById('backup-note').textContent")
            if 'Nothing was changed' in note or len(asked) >= 2:
                break
            time.sleep(0.5)
        A.wait_for_timeout(1500)
        note = A.evaluate("() => document.getElementById('backup-note').textContent")
        check(len(asked) == 2 and 'what the storyteller was sent' in asked[1] and title in asked[1],
              '"Bring a copy back": before anything is replaced he is asked — the question names the words that have not reached the device (%d question(s)): %s' % (len(asked), (asked[1] if len(asked) > 1 else '')[:240]))
        check('Nothing was changed' in note and device_list().get('epoch') == epoch_before and A.evaluate(WORDS_KEPT, sid) == 2,
              'told no: nothing is changed — the device\'s library is the same one, and the words are still here: %s' % note[:120])
    except Exception as err:
        check(False, '"Bring a copy back" while words have not reached the device: ' + str(err)[:200])
    ctx.unroute('**/api/books/sent/**', words_door)
    ctx.close()
    try:
        os.remove(copy_path)
    except OSError:
        pass


# ---------------------------------------------------------------------------------------------------------------------
def scene_named_copy(b, srv_box):
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block', accept_downloads=True)
    A = open_tavern(ctx)
    sid = A.evaluate(NEW_TALE, ['the tale copied by name', 'I begin.', 'THE-PAGE-IN-THE-COPY-HE-ASKED-FOR.'])
    A.evaluate("() => { location.hash = '#/settings'; }")
    A.wait_for_timeout(1500)
    A.evaluate("async () => { await window.__cozy.booksStatus.pushAll(); }")
    state = {'done': False, 'his': ''}

    def then_another(route, request):
        # his copy is made (the device answers with its name) — and before the page is told, ANOTHER copy is made on
        # the device, of a library that has moved on (another browser wrote a page and took a copy; the device's own
        # daily copy). A download cannot be held on its way, so the answer that names his copy is.
        answer = route.fetch()
        if not state['done']:
            state['done'] = True
            try:
                state['his'] = json.loads(answer.text()).get('name') or ''
            except Exception:
                state['his'] = ''
            book = device_book(sid) or {}
            book['messages'] = (book.get('messages') or []) + [{'id': 'elsewhere-1', 'storyId': sid, 'role': 'assistant', 'text': 'WRITTEN-ELSEWHERE-AFTER-HIS-COPY.', 'ts': int(time.time() * 1000)}]
            post('api/books/one/' + sid, json.dumps(book).encode('utf-8'), {'Content-Type': 'application/json'})
            time.sleep(1.2)  # a copy is named by the second it is made in
            get('api/backup/now', timeout=120)
        route.fulfill(response=answer)
    ctx.route('**/api/backup/now', then_another)
    try:
        with A.expect_download(timeout=90000) as dl:
            A.evaluate("() => document.getElementById('btn-export').click()")
        name = dl.value.suggested_filename
        got = open(dl.value.path(), 'rb').read()
        there = os.path.join(DATA, 'backups', name)
        on_device = open(there, 'rb').read() if os.path.isfile(there) else b''
        with zipfile.ZipFile(io.BytesIO(got)) as z:
            book = b''.join(z.read(x) for x in z.namelist() if x.startswith('books/' + sid))
        check(state['done'] and name == state['his'] and len(zips_on_device()) >= 2, 'fixture: his copy was made (%s), and another after it before it was handed over (%d copies)' % (state['his'], len(zips_on_device())))
        check(len(got) > 100 and got == on_device and b'WRITTEN-ELSEWHERE-AFTER-HIS-COPY' not in book and b'THE-PAGE-IN-THE-COPY-HE-ASKED-FOR' in book,
              'the file saved as %s IS that copy, byte for byte (it was whichever copy was "the newest" by then, saved under his copy\'s name): the same bytes: %s, holds the page written elsewhere since: %s' % (name, got == on_device, b'WRITTEN-ELSEWHERE-AFTER-HIS-COPY' in book))
    except Exception as err:
        check(False, '"Take a copy" while another copy is made: ' + str(err)[:200])
    ctx.unroute('**/api/backup/now', then_another)
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------
def scene_found_later(b, srv_box):
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block')
    A = open_tavern(ctx)
    ids = A.evaluate("""async () => { const { db } = await import('/js/store.js');
        const made = [];
        for (const [title, page] of [['the tale that is open', 'A page of the open tale.'], ['a tale kept on the device', 'Here the XYLOPHONEWORD is told, once.']]) {
          const st = await db.stories.create({ title });
          await db.messages.append(st.id, { role: 'user', text: 'I begin ' + title + '.' });
          await db.messages.append(st.id, { role: 'assistant', text: page });
          made.push(st.id);
        }
        await db.settings.set('welcomeSeen', true);
        await window.__cozy.chat.openStory(made[0]);
        await window.__cozy.booksStatus.pushAll();
        return made; }""")
    shallow = 0
    for _ in range(40):
        A.evaluate("async () => { try { await window.__cozy.booksStatus.evictOne(); } catch (err) { /* asked again */ } }")
        shallow = A.evaluate("async (id) => { const { db } = await import('/js/store.js'); return (await db.stories.list()).filter((s) => s.shallow && s.id === id).length; }", ids[1])
        if shallow >= 1:
            break
        time.sleep(0.5)
    check(shallow >= 1, 'fixture: the tale that is not open lives on the device; this browser keeps its name')
    # the next sitting begins while the tavern does not answer (in his hands the page then comes from the service
    # worker's own shelf; here the page is served and every /api/ door is shut for as long as the boot looks)
    shut = {'on': True}

    def doors(route, request):
        if shut['on']:
            route.abort()
        else:
            route.continue_()
    ctx.route('**/api/**', doors)
    A.reload(wait_until='load')
    ready(A)
    before = A.evaluate("() => ({ backed: window.__cozy.booksStatus.backed, words: window.__cozy.booksStatus.words })")
    check(before.get('backed') is False and 'in this browser only' in str(before.get('words')), 'fixture: a sitting that began with the tavern not answering: %s' % json.dumps(before))
    shut['on'] = False  # the tavern is started
    A.evaluate("async () => { await window.__cozy.booksStatus.catchUp(); }")  # what coming back to the page does
    A.wait_for_timeout(500)
    after = A.evaluate("() => ({ backed: window.__cozy.booksStatus.backed, words: window.__cozy.booksStatus.words })")
    check(after.get('backed') is True and 'on this device' in str(after.get('words')), 'the tavern is started and the page looks again: it knows the tavern is there (it never learned it, until the page was loaded again): %s' % json.dumps(after))
    A.evaluate("() => { location.hash = '#/settings'; }")
    A.wait_for_timeout(800)
    live = A.evaluate("() => document.getElementById('books-live').textContent")
    check('on this device' in live and 'in this browser only' not in live, 'Settings says where the tales live: %s' % live[:120])
    A.evaluate("() => { location.hash = '#/'; }")
    A.wait_for_timeout(500)
    found = A.evaluate("""async () => { await window.__cozy.search.run('XYLOPHONEWORD'); return document.getElementById('search-results').textContent; }""")
    check('a tale kept on the device' in found and 'did not answer' not in found, 'and the search asks the device again — it finds the word in the tale this browser does not hold (it said "the device did not answer" without asking): %s' % found[:200])
    ctx.unroute('**/api/**', doors)
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------
def scene_refusal_is_not_silence(b, srv_box):
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block', accept_downloads=True)
    A = open_tavern(ctx)
    sid = A.evaluate(NEW_TALE, ['the tale of a tavern that answers no', 'I begin.', 'A page.'])
    downloads = []
    A.on('download', lambda d: downloads.append(d.suggested_filename))
    why = 'a copy that was being brought back was cut off, and the library as it stood could not be put back yet (Permission denied) — it is kept in .restore-old, and nothing was touched'

    def refuse(route, request):
        route.fulfill(status=503, content_type='application/json', body=json.dumps({'ok': False, 'why': why}))
    # (a) "Take a copy": the tavern ANSWERS, and refuses
    ctx.route('**/api/backup/now', refuse)
    A.evaluate("() => { location.hash = '#/settings'; }")
    A.wait_for_timeout(1200)
    A.evaluate("() => document.getElementById('btn-export').click()")
    note = ''
    for _ in range(80):
        note = A.evaluate("() => document.getElementById('backup-note').textContent")
        if note and 'Making a copy' not in note and 'Sending' not in note:
            break
        time.sleep(0.5)
    A.wait_for_timeout(2500)
    note = A.evaluate("() => document.getElementById('backup-note').textContent")
    check('could not be put back yet' in note and 'did not answer' not in note and not downloads,
          'the tavern answered "Take a copy" with a refusal and its reason: the reason is shown, nothing says it "did not answer", and no file of the browser\'s own is handed over in the copy\'s place: %s (files: %s)' % (note[:200], downloads))
    ctx.unroute('**/api/backup/now', refuse)
    # (b) a copy is brought back by another browser, and this one cannot read it in — because the tavern REFUSES, not because it is silent
    A.evaluate("() => { location.hash = '#/'; }")
    ctx.route('**/api/books/list', refuse)
    epoch = bring_back_its_own_copy()
    said = []
    for _ in range(60):
        said = [t for t in toasts_of(A) if 'could not read' in t]
        if said:
            break
        time.sleep(0.5)
    check(bool(epoch) and len(said) >= 1 and 'not answering' not in said[0] and 'could not be put back yet' in said[0],
          'a copy brought back that this browser cannot read in because the tavern refuses: the note says what the tavern said — not that it "is not answering": %s' % json.dumps(said, ensure_ascii=False)[:300])
    ctx.unroute('**/api/books/list', refuse)
    knows = knows_epoch(A, epoch, 60)  # it keeps trying, and reads the copy in
    check(knows == 'e:' + str(epoch), 'with the tavern answering again the copy is read in by itself (%r)' % knows)
    # (c) …and when the tavern really is silent, that is what is said
    try:
        ready(A)
        ctx.route('**/api/books/list', lambda route, request: route.abort())
        epoch = bring_back_its_own_copy()
        said = []
        for _ in range(60):
            said = [t for t in toasts_of(A) if 'could not read' in t]
            if said:
                break
            time.sleep(0.5)
        check(len(said) >= 1 and 'not answering' in said[0], 'a tavern that does not answer at all is still said to be not answering: %s' % json.dumps(said, ensure_ascii=False)[:200])
        ctx.unroute('**/api/books/list')
        knows_epoch(A, epoch, 60)
    except Exception as err:
        check(False, 'the silent tavern: ' + str(err)[:200])
    # (d) …and at the START: the tavern answers that it cannot open its books — its reason is said (nothing was, to a
    # browser that holds tales; a browser that held none was asked whether the tavern was running)
    try:
        ready(A)
        ctx.route('**/api/books/list', refuse)
        A.reload(wait_until='load')
        ready(A)
        A.wait_for_timeout(2500)
        said = [t for t in toasts_of(A) if 'could not be put back yet' in t]
        check(len(said) == 1 and 'answered' in said[0] and 'running?' not in said[0], 'the tavern opened while its library cannot be put back yet: its own reason is said, once: %s' % json.dumps(toasts_of(A), ensure_ascii=False)[:300])
        ctx.unroute('**/api/books/list', refuse)
    except Exception as err:
        check(False, 'the start, with a tavern that answers and cannot open its books: ' + str(err)[:200])
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------
def scene_epoch_of_the_read_in(b, srv_box):
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block')
    A = open_tavern(ctx, block_events=True)  # it hears nothing of the device by itself
    t1 = A.evaluate(NEW_TALE, ['the tale that is open (epoch)', 'I begin.', 'A page.'])
    t2 = A.evaluate("""async () => { const { db } = await import('/js/store.js'); const st = await db.stories.create({ title: 'another tale held here' });
        await db.messages.append(st.id, { role: 'assistant', text: 'Its page.' }); await window.__cozy.booksStatus.pushAll(); return st.id; }""")
    epoch = bring_back_its_own_copy()
    seen = {'reads': 0, 'books': 0, 'failed': 0}

    def book_door(route, request):
        if request.method == 'GET':
            seen['books'] += 1
            if request.url.endswith('/api/books/one/' + t1):
                seen['reads'] += 1
            time.sleep(0.5)  # a book takes its time on the way
        route.continue_()

    def list_door(route, request):
        # the read-in's own look at the list is answered; ONE other look, made while its books are on their way, fails
        if seen['books'] >= 1 and not seen['failed']:
            seen['failed'] = 1
            route.abort()
            return
        route.continue_()
    ctx.route('**/api/books/one/**', book_door)
    ctx.route('**/api/books/list', list_door)
    try:
        A.evaluate("""async (t2) => { const m = window.__cozy.booksStatus.mirrorDevice(); await new Promise((r) => setTimeout(r, 250));
            window.__cozy.booksStatus.freshen(t2).catch(() => {}); try { await m; } catch (err) { /* the page reloads */ } }""", t2)
    except Exception:
        pass  # the page reloaded under the call
    knows = knows_epoch(A, epoch, 60)
    A.wait_for_timeout(4000)  # a second read-in, if there is one, has begun by now
    try:
        ready(A)
    except Exception:
        pass
    check(bool(epoch) and seen['failed'] == 1, 'fixture: a copy was brought back, and one look at the list failed while this browser was reading it in')
    check(knows == 'e:' + str(epoch) and seen['reads'] == 1,
          'the epoch noted is the one that came with the read-in\'s own list: this browser knows the device\'s epoch after ONE read-in (the failed look left it un-noted, and the next start read the whole library in again): epoch %r, the open tale read in %d time(s)' % (knows, seen['reads']))
    ctx.unroute('**/api/books/one/**', book_door)
    ctx.unroute('**/api/books/list', list_door)
    # …and so are the tales the device says were LET GO: a look-again reads that from its own look at the list, not from
    # what another look left behind while its books were on their way
    try:
        ready(A)
        A.evaluate("async (sid) => { await window.__cozy.chat.openStory(sid); }", t1)
        t3 = A.evaluate("""async () => { const { db } = await import('/js/store.js'); const st = await db.stories.create({ title: 'a tale let go in another browser' });
            await db.messages.append(st.id, { role: 'assistant', text: 'Its page.' }); await window.__cozy.pushBooksNow(); return st.id; }""")
        for _ in range(20):
            if device_book(t3) is not None:
                break
            time.sleep(0.5)
        A.wait_for_timeout(1500)
        A.evaluate("async () => { await window.__cozy.pushBooksNow(); }")
        # another browser lets it go, and changes the house (so this one's look-again has a book to read): this one hears nothing
        st_drop, _ = post('api/books/drop/' + t3, b'{}', {'Content-Type': 'application/json'})
        house = device_book('_house') or {}
        house['exportedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S.999Z', time.gmtime(time.time() + 5))
        st_house, _ = post('api/books/one/_house', json.dumps(house).encode('utf-8'), {'Content-Type': 'application/json'})
        listed = device_list()
        check(st_drop == 200 and st_house == 200 and t3 in (listed.get('gone') or []) and device_book(t3) is None and A.evaluate(PAGES_OF, t3) is not None,
              'fixture: a tale this browser holds was let go in another browser (the device names it gone), and this browser has not heard: gone %s' % (listed.get('gone') or [])[-3:])
        seen2 = {'books': 0, 'failed': 0}

        def book_door2(route, request):
            if request.method == 'GET':
                seen2['books'] += 1
                time.sleep(0.6)  # the house takes its time on the way
            route.continue_()

        def list_door2(route, request):
            if seen2['books'] >= 1 and not seen2['failed']:
                seen2['failed'] = 1
                route.abort()
                return
            route.continue_()
        ctx.route('**/api/books/one/**', book_door2)
        ctx.route('**/api/books/list', list_door2)
        A.evaluate("""async (t1) => { const look = window.__cozy.booksStatus.catchUp(); await new Promise((r) => setTimeout(r, 300));
            window.__cozy.booksStatus.freshen(t1).catch(() => {}); await look; await new Promise((r) => setTimeout(r, 1500)); }""", t1)
        ctx.unroute('**/api/books/one/**', book_door2)
        ctx.unroute('**/api/books/list', list_door2)
        listed = device_list()
        here = A.evaluate(PAGES_OF, t3)
        check(seen2['failed'] == 1 and seen2['books'] >= 1, 'fixture: one look at the list failed while the look-again was reading a book in (%d read, %d failed)' % (seen2['books'], seen2['failed']))
        check(device_book(t3) is None and t3 in (listed.get('gone') or []) and here is None,
              'the tale let go elsewhere is let go here, and is NOT sent back to the device (it was: "a tale the device lacks" — the tombstone cleared, the tale standing again everywhere): on the device %s, named gone: %s, here: %s' % (device_book(t3) is not None, t3 in (listed.get('gone') or []), here))
    except Exception as err:
        check(False, 'a tale let go elsewhere, and a look that failed meanwhile: ' + str(err)[:200])
    ctx.close()


# ---------------------------------------------------------------------------------------------------------------------
def scene_partial_asks_first(b, srv_box):
    wipe_device(srv_box)  # (no tale of another scene's on the device: the file made here lacks the two tales made here, and no other)
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block', accept_downloads=True)
    A = open_tavern(ctx)
    ids = A.evaluate("""async () => { const { db } = await import('/js/store.js');
        const made = [];
        for (const title of ['the tale open then', 'held by name alone', 'also by name alone']) {
          const st = await db.stories.create({ title });
          await db.messages.append(st.id, { role: 'user', text: 'I begin ' + title + '.' });
          await db.messages.append(st.id, { role: 'assistant', text: 'THE-PAGE-OF ' + title + '.' });
          made.push(st.id);
        }
        await db.settings.set('welcomeSeen', true);
        await window.__cozy.chat.openStory(made[0]);
        await window.__cozy.booksStatus.pushAll();
        return made; }""")
    shallow = 0
    for _ in range(40):
        A.evaluate("async () => { try { await window.__cozy.booksStatus.evictOne(); } catch (err) { /* asked again */ } }")
        shallow = A.evaluate("async (mine) => { const { db } = await import('/js/store.js'); return (await db.stories.list()).filter((s) => s.shallow && mine.includes(s.id)).length; }", ids[1:])
        if shallow >= 2:
            break
        time.sleep(0.5)
    stop(srv_box[0])
    A.evaluate("() => { location.hash = '#/settings'; }")
    A.wait_for_timeout(500)
    partial_path = os.path.join(DATA, '..', os.path.basename(DATA) + '-partial.json')
    try:
        with A.expect_download(timeout=90000) as dl:
            A.evaluate("() => document.getElementById('btn-export').click()")
        dl.value.save_as(partial_path)
        body = json.load(open(partial_path, encoding='utf-8'))
        lacking = sorted(str(t.get('title')) for t in (body.get('partial') or {}).get('missing', []))
        check(shallow >= 2 and lacking == ['also by name alone', 'held by name alone'], 'fixture: a PARTIAL file, made while the tavern was not answering — two tales are in it by name only: %s' % lacking)
    except Exception as err:
        check(False, 'fixture: a partial file is made: ' + str(err)[:200])
    srv_box[0] = start()
    # one of those two tales is opened: this browser now holds its pages
    held = []
    try:
        A.evaluate("() => { location.hash = '#/'; }")
        A.evaluate("async () => { await window.__cozy.booksStatus.catchUp(); }")
        for _ in range(20):
            held = A.evaluate(OPEN, ids[1])
            if len(held) == 2:
                break
            time.sleep(0.5)
    except Exception as err:
        check(False, 'fixture: a tale the file lacks is opened here: ' + str(err)[:200])
    check(len(held) == 2, 'fixture: this browser holds the pages of a tale the file has by name only (%d)' % len(held))
    asked = []

    def say_no(d):
        asked.append(d.message)
        d.dismiss()
    A.on('dialog', say_no)
    A.evaluate("() => { location.hash = '#/settings'; }")
    A.wait_for_timeout(500)
    A.set_input_files('#import-file', partial_path)
    for _ in range(20):
        if asked:
            break
        time.sleep(0.5)
    A.wait_for_timeout(1500)
    check(len(asked) == 1 and 'PARTIAL' in asked[0] and '2 ' in asked[0] and 'held by name alone' in asked[0] and 'also by name alone' in asked[0] and 'replace' in asked[0],
          'a PARTIAL file says so BEFORE it replaces anything: the question names how many tales it lacks, which, and that everything here is replaced (it asked only "Carry on?", and said so afterwards): %s' % json.dumps(asked, ensure_ascii=False)[:400])
    still = A.evaluate(PAGES_OF, ids[1])
    check(still is not None and len(still) == 2 and len(A.evaluate(PAGES_OF, ids[0]) or []) == 2, 'told no: nothing changes — the tale\'s pages are still here')
    A.remove_listener('dialog', say_no)
    A.on('dialog', lambda d: d.accept())
    A.set_input_files('#import-file', partial_path)
    note = ''
    for _ in range(40):
        note = A.evaluate("() => document.getElementById('backup-note').textContent")
        if 'PARTIAL copy' in note:
            break
        time.sleep(0.5)
    check('PARTIAL copy' in note and 'by name only' in note, 'told yes: it is brought back, and the note says again what it lacks: %s' % note[:200])
    ctx.close()
    try:
        os.remove(partial_path)
    except OSError:
        pass


# ---------------------------------------------------------------------------------------------------------------------
SHELF = """async () => { const { db } = await import('/js/store.js'); const out = {};
    for (const s of await db.stories.list()) out[s.id] = { shallow: Boolean(s.shallow), pages: (await db.messages.list(s.id)).length };
    return out; }"""


def shelf_of(page):
    """(Through a reload) what this browser holds: {tale id: {shallow, pages}}."""
    for _ in range(40):
        try:
            return page.evaluate(SHELF)
        except Exception:
            time.sleep(0.5)
    return {}


def holds_by_name(page, sid, tries=90):
    """This browser lets the tale go once the device is proven to hold all of it, and keeps its name (M313)."""
    for _ in range(tries):
        try:
            if (page.evaluate(SHELF).get(sid) or {}).get('shallow'):
                return True
            page.evaluate("async () => { try { await window.__cozy.pushBooksNow(); await window.__cozy.booksStatus.evictOne(); } catch (err) { /* asked again */ } }")
        except Exception:
            pass
        time.sleep(0.5)
    return False


def book_pages(sid):
    """How many pages the device's book of the tale holds — None when the device has no book for it at all."""
    book = device_book(sid)
    return None if book is None else len(book.get('messages') or [])


def scene_two_browsers_emptied(b, srv_box):
    wipe_device(srv_box)  # (a device with no epoch at all: no copy was ever brought back here)
    ca = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block')
    cb = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block')
    cb.add_init_script("window.__cozyEvictEveryMs = 3600000;")  # (the second browser lets a tale go only when this scene asks it to)
    A = open_tavern(ca)
    ta = A.evaluate(NEW_TALE, ['the tale the first browser holds', 'I begin.', 'A-PAGE-ONLY-THE-FIRST-BROWSER-HOLDS.'])
    B = open_tavern(cb)

    def quiet(route, request):
        route.abort()

    def hush(on):
        """The second browser hears nothing of the device by itself (its stream of announcements does not come back): it
        learns of the emptied folder when it is opened again, or when a page it writes is refused — not a moment before."""
        if on:
            cb.route('**/api/events', quiet)
        else:
            cb.unroute('**/api/events', quiet)

    def a_tale_of_the_second(n):
        """A tale made in the second browser (each part of the scene has its own, so no part stands on another's outcome)."""
        # (what it has changed is sent — pushBooksNow; never "every tale it holds", which would lay an older state of
        # another browser's tale over the device's)
        tb = B.evaluate("""async ([title, first, second]) => { const { db } = await import('/js/store.js');
            const st = await db.stories.create({ title });
            await db.messages.append(st.id, { role: 'user', text: first });
            await db.messages.append(st.id, { role: 'assistant', text: second });
            await db.settings.set('welcomeSeen', true);
            await window.__cozy.chat.openStory(st.id);
            await window.__cozy.pushBooksNow();
            return st.id; }""", ['the tale the second browser holds, %s' % n, 'I begin.', 'A-PAGE-ONLY-THE-SECOND-BROWSER-HOLDS.'])
        for _ in range(20):
            if book_pages(tb) == 2:
                break
            time.sleep(0.5)
        A.evaluate("async () => { await window.__cozy.booksStatus.catchUp(); }")
        return tb

    def each_holds_its_own(tb, what):
        ok = holds_by_name(A, tb) and holds_by_name(B, ta)
        a, bb = shelf_of(A), shelf_of(B)
        return check(ok and (a.get(ta) or {}).get('pages') == 2 and not (a.get(ta) or {}).get('shallow') and (bb.get(tb) or {}).get('pages') == 2 and not (bb.get(tb) or {}).get('shallow')
                     and book_pages(ta) == 2 and book_pages(tb) == 2,
                     'fixture (%s): each browser holds whole the tale it has open and the other\'s by name; the device holds both: the first %s / %s, the second %s / %s' % (what, a.get(ta), a.get(tb), bb.get(ta), bb.get(tb)))

    def a_copy_comes_back(tb):
        """A copy is brought back (the device names an epoch from here on); both browsers read it in, and each opens its own tale again."""
        epoch = bring_back_its_own_copy()
        ka, kb = knows_epoch(A, epoch), knows_epoch(B, epoch)
        for page, sid in ((A, ta), (B, tb)):
            try:
                ready(page)
                page.evaluate("async (sid) => { await window.__cozy.chat.openStory(sid); }", sid)
            except Exception:
                pass
        A.wait_for_timeout(2500)  # (what is said of THAT copy — truly brought back — has been said by now)
        for page in (A, B):
            try:
                page.evaluate("() => { (window.__toasts || []).length = 0; }")
            except Exception:
                pass
        return check(bool(epoch) and ka == 'e:' + str(epoch) and kb == 'e:' + str(epoch), 'fixture: a copy was brought back, and both browsers know its epoch (%r, %r)' % (ka, kb))

    def the_first_opens(tb, what):
        """The folder is emptied, and the first browser is opened again: it sends what it holds — and no book of a name."""
        hush(True)
        wipe_device(srv_box)
        A.reload(wait_until='load')
        ready(A)
        for _ in range(40):
            if book_pages(ta) == 2:
                break
            time.sleep(0.5)
        check(book_pages(ta) == 2 and book_pages(tb) is None,
              '%s — the first browser opens on the emptied device: its own tale is there again, and the tale it holds by NAME ONLY is not sent as a book with no pages (it was: the device then "held" that tale, empty): the first\'s tale %s page(s), the second\'s: %s' % (what, book_pages(ta), book_pages(tb)))

    def the_second_opens(tb, what, lost_words):
        hush(False)
        B.reload(wait_until='load')
        for _ in range(60):
            if book_pages(tb) == 2:
                break
            time.sleep(0.5)
        try:
            ready(B)
        except Exception:
            pass
        B.wait_for_timeout(2500)
        held = (shelf_of(B).get(tb) or {})
        check(held.get('pages') == 2 and book_pages(tb) == 2 and book_pages(ta) == 2,
              '%s — the second browser opens: the tale only IT held whole is still here, whole, and has reached the device (%s): %s page(s) here, %s on the device' % (what, lost_words, held.get('pages'), book_pages(tb)))
        toasts = toasts_of(B)
        check(not any(w in t for t in toasts for w in FALSE_WORDS) and B.evaluate("() => localStorage.getItem('cozy.epoch')") == 'e:',
              'and nothing false is said there; it holds the device\'s epoch — none: %s' % json.dumps(toasts, ensure_ascii=False)[:200])

    # (a) no copy was ever brought back: no epoch anywhere
    tb = a_tale_of_the_second('one')
    each_holds_its_own(tb, 'no copy ever brought back')
    the_first_opens(tb, 'no copy ever brought back')
    # …nor is an empty book of it sent when the first browser changes that tale's name and sends the change
    try:
        A.evaluate("""async (sid) => { const { db } = await import('/js/store.js');
            await db.stories.update(sid, { title: 'the tale the second browser holds (named anew in the first)' });
            await window.__cozy.pushBooksNow(); }""", tb)
        A.wait_for_timeout(1500)
    except Exception as err:
        check(False, 'the first browser renames the tale it holds by name: ' + str(err)[:160])
    check(book_pages(tb) is None, '…nor when its name is changed there and the change is sent: still no empty book of it on the device (%s)' % book_pages(tb))
    the_second_opens(tb, 'no copy ever brought back', 'it read the empty book in over its pages: 0 here, 0 on the device')

    # (b) a copy was brought back once: both browsers remember an epoch, and the emptied device names none
    tb = a_tale_of_the_second('two')
    a_copy_comes_back(tb)
    each_holds_its_own(tb, 'a copy brought back once')
    the_first_opens(tb, 'a copy brought back once')
    the_second_opens(tb, 'a copy brought back once', 'it was made "the device\'s copy": the tale was let go, or emptied')

    # (c) …and the second browser's page stays OPEN: the first re-seeds the emptied device, then a page is written in the second
    tb = a_tale_of_the_second('three')
    a_copy_comes_back(tb)
    each_holds_its_own(tb, 'the page stays open')
    try:
        B.evaluate("() => { window.__stayed = 17; }")
    except Exception:
        pass
    the_first_opens(tb, 'the page stays open')  # (the second hears nothing of it: it learns from the page it writes being refused)
    try:
        B.evaluate(APPEND, [tb, 'A-PAGE-WRITTEN-IN-THE-SECOND-BROWSER-AFTERWARDS.'])
    except Exception as err:
        check(False, 'a page is written in the second browser: ' + str(err)[:160])
    on_device = []
    for _ in range(80):
        on_device = device_pages(tb)
        if 'A-PAGE-WRITTEN-IN-THE-SECOND-BROWSER-AFTERWARDS.' in on_device:
            break
        time.sleep(0.5)
    B.wait_for_timeout(2500)
    held = (shelf_of(B).get(tb) or {})
    try:
        stayed = B.evaluate("() => window.__stayed === 17")
    except Exception:
        stayed = False
    check(held.get('pages') == 4 and len(on_device) == 4 and 'A-PAGE-ONLY-THE-SECOND-BROWSER-HOLDS.' in on_device and 'A-PAGE-WRITTEN-IN-THE-SECOND-BROWSER-AFTERWARDS.' in on_device and stayed,
          'the page stays open — a page is written in the second browser: its tale is still here, whole, the new page with it, and all of it reaches the device (the tale was let go, the page with it): %s page(s) here, on the device: %s' % (held.get('pages'), [t[:30] for t in on_device]))
    toasts = toasts_of(B)
    check(not any(w in t for t in toasts for w in FALSE_WORDS) and book_pages(ta) == 2, 'nothing false is said there, and the first browser\'s tale stands on the device as it was sent: %s' % json.dumps(toasts, ensure_ascii=False)[:200])
    hush(False)

    # (d) …and joining is not overwriting: a tale the second browser holds whole but has NOT changed — in an older state
    # than the first browser has since sent — is not laid back over the device's newer book
    tb = a_tale_of_the_second('four')
    a_copy_comes_back(tb)  # (both have read the copy in whole: the second holds the first's tale too, and does not have it open)
    hush(True)
    try:
        B.reload(wait_until='load')  # (its stream of announcements is gone from here on: it does not hear what the first writes next)
        ready(B)
        B.evaluate("async (sid) => { await window.__cozy.chat.openStory(sid); }", tb)
        B.wait_for_timeout(1500)
        B.evaluate("() => { (window.__toasts || []).length = 0; }")
    except Exception as err:
        check(False, 'fixture: the second browser is opened again, hearing nothing: ' + str(err)[:160])
    try:
        A.evaluate(APPEND, [ta, 'WRITTEN-IN-THE-FIRST-AFTER-THE-SECOND-LAST-SAW-IT.'])
        A.wait_for_timeout(1200)
        A.evaluate("async () => { await window.__cozy.pushBooksNow(); }")
    except Exception as err:
        check(False, 'the first browser writes on in its tale: ' + str(err)[:160])
    stale = (shelf_of(B).get(ta) or {})
    check(book_pages(ta) == 4 and stale.get('pages') == 2 and stale.get('shallow') is False and (shelf_of(B).get(tb) or {}).get('pages') == 2,
          'fixture: the first browser\'s tale has moved on (4 pages on the device); the second still holds it whole as it was (2 pages), unchanged and not open: %s' % json.dumps(stale))
    wipe_device(srv_box)
    A.reload(wait_until='load')
    ready(A)
    for _ in range(40):
        if book_pages(ta) == 4:
            break
        time.sleep(0.5)
    try:
        B.evaluate(APPEND, [tb, 'A-PAGE-WRITTEN-IN-THE-SECOND-BROWSER-AT-THE-END.'])
    except Exception as err:
        check(False, 'a page is written in the second browser: ' + str(err)[:160])
    on_device = []
    for _ in range(80):
        on_device = device_pages(tb)
        if 'A-PAGE-WRITTEN-IN-THE-SECOND-BROWSER-AT-THE-END.' in on_device:
            break
        time.sleep(0.5)
    B.wait_for_timeout(3000)
    firsts = device_pages(ta)
    check(len(on_device) == 4 and (shelf_of(B).get(tb) or {}).get('pages') == 4, 'fixture: the page written in the second browser, and its tale, reach the re-seeded device: %s' % [t[:30] for t in on_device])
    check(len(firsts) == 4 and 'WRITTEN-IN-THE-FIRST-AFTER-THE-SECOND-LAST-SAW-IT.' in firsts,
          'joining is not overwriting: the first browser\'s tale, which the second holds in an older state and has not changed, stands on the device as the first sent it (the second sent every tale it held whole — its old book went over the newer one): %s' % [t[:30] for t in firsts])
    hush(False)

    # (e) …and what the second browser HAS changed still goes, when it is a whole book that is refused and not a page: the
    # first browser's tale (the second holds it whole, as the copy left it, and does not have it open), renamed in the second
    tb = a_tale_of_the_second('five')
    a_copy_comes_back(tb)
    hush(True)
    try:
        B.reload(wait_until='load')
        ready(B)
        B.evaluate("async (sid) => { await window.__cozy.chat.openStory(sid); }", tb)
        B.wait_for_timeout(1500)
        B.evaluate("async () => { await window.__cozy.pushBooksNow(); }")  # (nothing of its own is waiting to be sent)
    except Exception as err:
        check(False, 'fixture: the second browser is opened again, hearing nothing: ' + str(err)[:160])
    wipe_device(srv_box)
    A.reload(wait_until='load')
    ready(A)
    for _ in range(40):
        if book_pages(tb) == 2 and book_pages(ta) == 4:
            break
        time.sleep(0.5)
    held = (shelf_of(B).get(ta) or {})
    check(book_pages(ta) == 4 and held.get('pages') == 4 and held.get('shallow') is False, 'fixture: the re-seeded device holds a book of the first browser\'s tale, and the second holds that tale whole, as it is: %s' % json.dumps(held))
    try:
        B.evaluate("""async (sid) => { const { db } = await import('/js/store.js');
            await db.stories.update(sid, { title: 'NAMED-ANEW-IN-THE-SECOND-BROWSER' });
            await window.__cozy.pushBooksNow(); }""", ta)
    except Exception as err:
        check(False, 'the second browser renames a tale: ' + str(err)[:160])
    title = ''
    for _ in range(16):  # (eight seconds: well inside the twenty a later change would wait before it is sent)
        title = ((device_book(ta) or {}).get('story') or {}).get('title')
        if title == 'NAMED-ANEW-IN-THE-SECOND-BROWSER':
            break
        time.sleep(0.5)
    check(title == 'NAMED-ANEW-IN-THE-SECOND-BROWSER' and book_pages(ta) == 4 and B.evaluate("() => localStorage.getItem('cozy.epoch')") == 'e:',
          'a change sent as a whole book and refused (the device names no epoch now) is sent again once the device is joined — it was let go of with the hold: the device\'s book is named %r, %s pages' % (title, book_pages(ta)))
    hush(False)
    ca.close()
    cb.close()


# ---------------------------------------------------------------------------------------------------------------------
def scene_pages_into_a_name(b, srv_box):
    wipe_device(srv_box)
    ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block')
    ctx.add_init_script("window.__cozyEvictEveryMs = 3600000;")  # (this browser lets a tale go only when the scene asks it to — what it holds is read below)
    A = open_tavern(ctx)
    ids = A.evaluate("""async () => { const { db } = await import('/js/store.js');
        const made = [];
        for (const title of ['the tale that is open', 'opened while the tavern was down', 'written into while it answered', 'no book of it on the device', 'the page door stumbles for it', 'opened again before its page had gone', 'opened again while a hold stands']) {
          const st = await db.stories.create({ title });
          await db.messages.append(st.id, { role: 'user', text: 'I begin ' + title + '.' });
          await db.messages.append(st.id, { role: 'assistant', text: 'THE-OLD-PAGE-OF ' + title + '.' });
          made.push(st.id);
        }
        await db.settings.set('welcomeSeen', true);
        await window.__cozy.chat.openStory(made[0]);
        await window.__cozy.booksStatus.pushAll();
        return made; }""")
    by_name = all([holds_by_name(A, sid) for sid in ids[1:]])
    held = shelf_of(A)
    check(by_name and all((held.get(sid) or {}).get('pages') == 0 for sid in ids[1:]) and all(book_pages(sid) == 2 for sid in ids[1:]),
          'fixture: six tales are held here by name only — their pages are on the device (2 each): %s' % [held.get(sid) for sid in ids[1:]])
    old = lambda sid: [t for t in device_pages(sid) if t.startswith('THE-OLD-PAGE-OF') or t.startswith('I begin')]

    # (a) the tavern is not running; a tale held by name is opened (it shows no pages) and one exchange is written into it
    stop(srv_box[0])
    try:
        A.evaluate("async (sid) => { await window.__cozy.chat.openStory(sid); }", ids[1])
        A.evaluate(APPEND, [ids[1], 'WRITTEN-WHILE-THE-TAVERN-WAS-DOWN.'])
        A.wait_for_timeout(1000)
    except Exception as err:
        check(False, 'a page is written into a tale held by name while the tavern is down: ' + str(err)[:160])
    srv_box[0] = start()
    try:
        A.evaluate("async () => { await window.__cozy.booksStatus.catchUp(); await window.__cozy.pushBooksNow(); }")  # what coming back to the page does
    except Exception:
        pass
    on_device = []
    for _ in range(80):
        on_device = device_pages(ids[1])
        if 'WRITTEN-WHILE-THE-TAVERN-WAS-DOWN.' in on_device:
            break
        try:
            A.evaluate("async () => { await window.__cozy.pushBooksNow(); }")
        except Exception:
            pass
        time.sleep(0.5)
    A.wait_for_timeout(2500)
    on_device = device_pages(ids[1])
    check(len(on_device) == 4 and len(old(ids[1])) == 2 and 'WRITTEN-WHILE-THE-TAVERN-WAS-DOWN.' in on_device,
          'a tale held by name, opened while the tavern was down, one exchange written into it; the tavern is back: the device\'s book holds its OLD pages and the new exchange (it held the new exchange alone — every page it had was replaced): %s' % [t[:34] for t in on_device])
    here = (shelf_of(A).get(ids[1]) or {})
    check(here.get('pages') == 4 and here.get('shallow') is False, 'and this browser now holds that tale whole — the old pages read in under the new: %s' % json.dumps(here))

    # (b) …and with the tavern answering all along: a page lands in a tale held by name only (it was opened in a moment the
    # tavern did not answer its book, and the turn was written once it did)
    try:
        A.evaluate("async (sid) => { await window.__cozy.chat.openStory(sid); }", ids[0])
        A.evaluate(APPEND, [ids[2], 'WRITTEN-INTO-A-NAME-WHILE-THE-TAVERN-ANSWERED.'])
        A.wait_for_timeout(800)
        A.evaluate("async () => { await window.__cozy.pushBooksNow(); }")  # (the push that follows every change by twenty seconds)
    except Exception as err:
        check(False, 'a page is written into a tale held by name: ' + str(err)[:160])
    A.wait_for_timeout(2500)
    on_device = device_pages(ids[2])
    here = (shelf_of(A).get(ids[2]) or {})
    check(len(on_device) == 4 and len(old(ids[2])) == 2 and 'WRITTEN-INTO-A-NAME-WHILE-THE-TAVERN-ANSWERED.' in on_device and here.get('pages') == 4,
          'the tavern answering all along: the page is added to the device\'s book, and the push that follows does not replace that book with the new exchange alone: on the device %s, here %s' % ([t[:34] for t in on_device], json.dumps(here)))

    # (c) only when the device has NO book of the tale is what is here all there is: it goes as the book
    for name in os.listdir(os.path.join(DATA, 'books')):
        if name.startswith(ids[3] + '.'):
            os.remove(os.path.join(DATA, 'books', name))
    try:
        A.evaluate(APPEND, [ids[3], 'ALL-THERE-IS-OF-THIS-TALE-NOW.'])
        A.wait_for_timeout(800)
        A.evaluate("async () => { await window.__cozy.pushBooksNow(); }")
    except Exception as err:
        check(False, 'a page is written into a tale the device has no book of: ' + str(err)[:160])
    on_device = []
    for _ in range(40):
        on_device = device_pages(ids[3])
        if 'ALL-THERE-IS-OF-THIS-TALE-NOW.' in on_device:
            break
        time.sleep(0.5)
    check(sorted(on_device) == sorted(['and then', 'ALL-THERE-IS-OF-THIS-TALE-NOW.']) and (shelf_of(A).get(ids[3]) or {}).get('pages') == 2,
          'a tale the device has no book of at all: what was written here is all there is, and it reaches the device as the book: %s' % [t[:34] for t in on_device])

    # (d) …and a page the device would not take as a page (its page door stumbles) is not sent as the book in its place
    stumbles = {'n': 0}

    def page_door(route, request):
        stumbles['n'] += 1
        route.fulfill(status=500, body='')
    ctx.route('**/api/books/page/**', page_door)
    try:
        A.evaluate(APPEND, [ids[4], 'WRITTEN-WHILE-THE-PAGE-DOOR-STUMBLED.'])
        A.wait_for_timeout(2500)
    except Exception as err:
        check(False, 'a page is written while the page door stumbles: ' + str(err)[:160])
    on_device = device_pages(ids[4])
    check(stumbles['n'] >= 2 and len(on_device) == 2 and len(old(ids[4])) == 2,
          'the device would not take a page of a tale held by name as a page: the tale is NOT sent as the book in its place — the device\'s book stands as it was (it was replaced by the new exchange alone): %s' % [t[:34] for t in on_device])
    ctx.unroute('**/api/books/page/**', page_door)
    try:
        A.evaluate("async () => { await window.__cozy.pushBooksNow(); }")
    except Exception:
        pass
    for _ in range(40):
        on_device = device_pages(ids[4])
        if 'WRITTEN-WHILE-THE-PAGE-DOOR-STUMBLED.' in on_device:
            break
        try:
            A.evaluate("async () => { await window.__cozy.pushBooksNow(); }")
        except Exception:
            pass
        time.sleep(0.5)
    A.wait_for_timeout(1500)
    check(len(on_device) == 4 and len(old(ids[4])) == 2 and (shelf_of(A).get(ids[4]) or {}).get('pages') == 4, 'and once the door takes pages again, the exchange is added to that book and the tale is whole here: %s' % [t[:34] for t in on_device])

    # (e) …and the tale is opened AGAIN before what was written into it has gone to the device (the tavern is started, and
    # the tale that showed no pages is tapped once more): the device's book is not read in over the exchange
    stop(srv_box[0])
    try:
        A.evaluate("async (sid) => { await window.__cozy.chat.openStory(sid); }", ids[5])
        A.evaluate(APPEND, [ids[5], 'WRITTEN-BEFORE-IT-WAS-OPENED-AGAIN.'])
        A.wait_for_timeout(800)
    except Exception as err:
        check(False, 'a page is written into a tale held by name while the tavern is down: ' + str(err)[:160])
    srv_box[0] = start()
    try:
        A.evaluate("async (sid) => { await window.__cozy.chat.openStory(sid); }", ids[5])
    except Exception as err:
        check(False, 'the tale is opened again: ' + str(err)[:160])
    on_device = []
    for _ in range(80):
        on_device = device_pages(ids[5])
        if 'WRITTEN-BEFORE-IT-WAS-OPENED-AGAIN.' in on_device:
            break
        time.sleep(0.5)
    A.wait_for_timeout(1500)
    here = A.evaluate(PAGES_OF, ids[5]) or []
    check(len(here) == 4 and 'WRITTEN-BEFORE-IT-WAS-OPENED-AGAIN.' in here and len(on_device) == 4 and len(old(ids[5])) == 2,
          'opened again before its page had gone: the exchange is still here, with the old pages under it, and all of it is on the device (the device\'s book was read in over the exchange — it was in neither place): here %s, on the device %s' % ([t[:30] for t in here], [t[:30] for t in on_device]))

    # (f) …and the same while a hold stands: the page was refused (the device's folder was emptied and it names no epoch
    # now), the look that would settle it has not been answered yet, and the tale's book is asked for again meanwhile
    # (what opening the tale does — asked of the books directly here, so that none of the house's own jobs begins and
    # keeps the look waiting)
    epoch = bring_back_its_own_copy()
    knows = knows_epoch(A, epoch)
    try:
        ready(A)
        A.wait_for_timeout(2500)
    except Exception:
        pass
    named = holds_by_name(A, ids[6])
    for _ in range(240):  # (the house is at rest: a look that would settle a hold waits for a page being told)
        try:
            if not A.evaluate("() => window.__cozy.chat.isBusy()"):
                break
        except Exception:
            pass
        time.sleep(0.5)
    book6 = device_book(ids[6])
    ctx.route('**/api/events', lambda route, request: route.abort())  # (it hears nothing of the device by itself)
    wipe_device(srv_box)
    st6, _ = post('api/books/one/' + ids[6], json.dumps(book6 or {}).encode('utf-8'), {'Content-Type': 'application/json'})  # (another browser has sent the tale to the emptied device)
    check(bool(epoch) and knows == 'e:' + str(epoch) and named and st6 == 200 and book_pages(ids[6]) == 2 and device_list().get('epoch') == '',
          'fixture: this browser knows an epoch and holds the tale by name; the device\'s folder was emptied and holds that tale again, with no epoch: %s' % json.dumps(device_list())[:160])
    looks = {'n': 0}

    def list_door(route, request):
        looks['n'] += 1
        if looks['n'] <= 2:
            route.abort()  # the tale's book cannot be read when it is opened; and the look that follows the refusal is not answered
        else:
            route.continue_()
    ctx.route('**/api/books/list', list_door)
    fetched = []
    try:
        fetched.append(A.evaluate("async (sid) => await window.__cozy.booksStatus.fetchStory(sid)", ids[6]))
        A.evaluate(APPEND, [ids[6], 'WRITTEN-AND-REFUSED-WHILE-NOTHING-WAS-SETTLED.'])
        A.wait_for_timeout(1500)
        fetched.append(A.evaluate("async (sid) => await window.__cozy.booksStatus.fetchStory(sid)", ids[6]))  # asked for again: the hold stands
    except Exception as err:
        check(False, 'a page is written, refused, and the tale\'s book asked for again: ' + str(err)[:160])
    meanwhile = A.evaluate(PAGES_OF, ids[6]) or []
    on_device = []
    for _ in range(120):  # (the look is asked again twenty seconds on)
        on_device = device_pages(ids[6])
        if 'WRITTEN-AND-REFUSED-WHILE-NOTHING-WAS-SETTLED.' in on_device:
            break
        A.wait_for_timeout(500)  # (not a sleep: the list's door above is answered from here)
    A.wait_for_timeout(2500)
    here = A.evaluate(PAGES_OF, ids[6]) or []
    check(looks['n'] >= 3 and fetched == [False, False] and 'WRITTEN-AND-REFUSED-WHILE-NOTHING-WAS-SETTLED.' in meanwhile,
          'while a hold stands, the device\'s book is not read in over the exchange that waits (it was: the exchange was gone from this browser, and had never reached the device): asked for twice %s, here meanwhile %s' % (fetched, [t[:30] for t in meanwhile]))
    check(len(here) == 4 and 'WRITTEN-AND-REFUSED-WHILE-NOTHING-WAS-SETTLED.' in here and len(on_device) == 4 and len(old(ids[6])) == 2,
          'and once the device is joined the exchange is added to its book, and the tale is whole here: here %s, on the device %s' % ([t[:30] for t in here], [t[:30] for t in on_device]))
    ctx.unroute('**/api/books/list', list_door)

    # (g) …and a tale held WHOLE is kept the same way while a hold stands: what waits was set aside by something that
    # asked for it to be sent (the push that follows a page by twenty seconds; "Take a copy"), and the tale is looked at
    # again (what opening it does) while the device holds a newer book of it, sent there by another browser
    epoch = bring_back_its_own_copy()
    try:
        A.evaluate("() => { window.__cozy.booksStatus.catchUp(); }")  # (its stream of announcements is shut: it is made to look)
    except Exception:
        pass
    knows = knows_epoch(A, epoch)
    try:
        ready(A)
        A.wait_for_timeout(2500)
    except Exception:
        pass
    for _ in range(240):
        try:
            if not A.evaluate("() => window.__cozy.chat.isBusy()"):
                break
        except Exception:
            pass
        time.sleep(0.5)
    whole = (shelf_of(A).get(ids[0]) or {})
    book0 = device_book(ids[0]) or {}
    book0['messages'] = (book0.get('messages') or []) + [{'id': 'elsewhere-18g', 'storyId': ids[0], 'role': 'assistant', 'text': 'WRITTEN-ELSEWHERE-SINCE.', 'ts': int(time.time() * 1000)}]
    book0['exportedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S.999Z', time.gmtime(time.time() + 60))
    wipe_device(srv_box)
    st0, _ = post('api/books/one/' + ids[0], json.dumps(book0).encode('utf-8'), {'Content-Type': 'application/json'})  # (another browser has sent the emptied device a newer state of the tale)
    check(bool(epoch) and knows == 'e:' + str(epoch) and whole.get('pages') == 2 and whole.get('shallow') is False and st0 == 200 and book_pages(ids[0]) == 3 and device_list().get('epoch') == '',
          'fixture: this browser knows an epoch and holds the tale whole (2 pages); the emptied device holds a newer book of it (3 pages), with no epoch: %s' % json.dumps(whole))
    looks2 = {'n': 0}

    def list_door2(route, request):
        looks2['n'] += 1
        if looks2['n'] <= 1:
            route.abort()  # the look that follows the refusal is not answered
        else:
            route.continue_()
    ctx.route('**/api/books/list', list_door2)
    fresh = None
    try:
        A.evaluate(APPEND, [ids[0], 'WRITTEN-HERE-AND-REFUSED.'])
        A.wait_for_timeout(1500)
        A.evaluate("async () => { await window.__cozy.pushBooksNow(); }")  # (what waits is asked to be sent: under the hold it is set aside)
        fresh = A.evaluate("async (sid) => await window.__cozy.booksStatus.freshen(sid)", ids[0])
    except Exception as err:
        check(False, 'a page is written, refused, and the tale looked at again: ' + str(err)[:160])
    meanwhile = A.evaluate(PAGES_OF, ids[0]) or []
    on_device = []
    for _ in range(120):
        on_device = device_pages(ids[0])
        if 'WRITTEN-HERE-AND-REFUSED.' in on_device:
            break
        A.wait_for_timeout(500)
    A.wait_for_timeout(1500)
    here = A.evaluate(PAGES_OF, ids[0]) or []
    check(looks2['n'] >= 2 and fresh is False and 'WRITTEN-HERE-AND-REFUSED.' in meanwhile,
          'a tale held whole, its page refused and set aside by a hold: the device\'s newer book is not read in over it (it was — the exchange was gone from this browser, and had never reached the device): looked at again %s, here meanwhile %s' % (fresh, [t[:30] for t in meanwhile]))
    check('WRITTEN-HERE-AND-REFUSED.' in here and 'WRITTEN-HERE-AND-REFUSED.' in on_device, 'and once the device is joined the exchange reaches it: here %s, on the device %s' % ([t[:30] for t in here], [t[:30] for t in on_device]))
    ctx.unroute('**/api/books/list', list_door2)
    ctx.close()


if __name__ == '__main__':
    print('the browser and the device, together — build under test: ' + REPO)
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA, exist_ok=True)
    srv_box = [start()]
    scenes = [
        ('1', 'a copy brought back is the library, in every browser', lambda b: scene_copy_brought_back(b)),
        ('2', '"Take a copy" right after the tavern came back holds what a failed push left waiting', lambda b: scene_parked_push(b, srv_box)),
        ('3', 'a tale let go takes its sent words with it', lambda b: scene_tale_let_go(b)),
        ('4', 'a branch reads its carried pages\' words from the device', lambda b: scene_branch(b)),
        ('5', 'the browser never lets go of words the device has not got', lambda b: scene_not_let_go(b, srv_box)),
        ('6', 'with the tavern not answering, "Take a copy" says its copy is partial', lambda b: scene_partial_copy(b, srv_box)),
        ('7', 'what a copy lacks is said: the device would not take a tale\'s newest changes', lambda b: scene_copy_lacks(b, False)),
        ('8', 'what a copy lacks is said: the sending was still on its way after three minutes', lambda b: scene_copy_lacks(b, True)),
        ('9', 'an empty device is never "a copy brought back"', lambda b: scene_empty_device(b, srv_box)),
        ('10', 'a refusal by name is said, and how to start the tavern for that address', lambda b: scene_refused_by_name(b, srv_box)),
        ('11', 'sent words that could not go are reported, and looked for afresh', lambda b: scene_words_reported(b, srv_box)),
        ('12', 'the file saved under a copy\'s name is that copy', lambda b: scene_named_copy(b, srv_box)),
        ('13', 'a sitting begun without the tavern learns that it came back', lambda b: scene_found_later(b, srv_box)),
        ('14', 'a refusal is not "no answer"', lambda b: scene_refusal_is_not_silence(b, srv_box)),
        ('15', 'the epoch noted after a read-in is that read-in\'s own', lambda b: scene_epoch_of_the_read_in(b, srv_box)),
        ('16', 'a PARTIAL file says so before it replaces anything', lambda b: scene_partial_asks_first(b, srv_box)),
        ('17', 'two browsers, and the device\'s folder emptied: no tale is lost', lambda b: scene_two_browsers_emptied(b, srv_box)),
        ('18', 'pages written into a tale held by name only are added to its book, never sent as the book', lambda b: scene_pages_into_a_name(b, srv_box)),
        ('19', 'a page changed in place (a mend) reaches the device', lambda b: scene_page_changed_in_place(b)),
    ]
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=['--no-sandbox', '--host-resolver-rules=MAP %s 127.0.0.1' % OTHER_NAME])  # (scene 10: another name for this device)
            for num, name, fn in scenes:
                if ONLY and num not in ONLY:
                    continue
                print('\n— %s. %s' % (num, name), flush=True)
                try:
                    fn(browser)
                except Exception as err:
                    check(False, 'scene %s did not run to its end — %s: %s' % (num, type(err).__name__, str(err)[:300]))
                if srv_box[0].poll() is not None:
                    srv_box[0] = start()  # a scene that stopped the tavern and fell over leaves it running for the next
            browser.close()
    finally:
        stop(srv_box[0])
        if not os.environ.get('COZY_TEST_DATA'):
            shutil.rmtree(DATA, ignore_errors=True)
            try:
                os.remove(os.path.join(os.path.dirname(DATA), os.path.basename(DATA) + '-the-copy.zip'))
            except OSError:
                pass
    print('\n' + ('the browser and the device: all green' if not fails else '%d FAILED:\n  - ' % len(fails) + '\n  - '.join(f[:170] for f in fails)))
    sys.exit(1 if fails else 0)
