import { dropCaches } from './store.js';
import { notify as notifyState } from './engine/state.js'; /* M182: the ledger's panels wake on a live pull */
import { queuedCount, workIsRunning } from './agents/queue.js'; /* M557: a tale its readers are still writing is never let go */
import { clearSent } from './sent.js'; /* M675: a browser made the device's copy lets go of the words it kept for the library before it */
/* M24 — the tavern keeps its own books.
 * When the little server answers (Termux / any `serve.py` run), every tale is
 * mirrored to a real file on the device (~/.cozytavern/books.json, rotated).
 * Clearing the browser can never take the tales again. On static hosting
 * (GitHub Pages) there is no server — the browser stays the only shelf, and
 * the settings say so plainly.
 *
 * Boot law (decideBoot): the server's file is truth when it's newer; a fresh
 * browser pulls it down; a browser with tales and an empty shelf pushes up.
 */

/* Pure, harness-tested: what should boot do?
 * localJson: string | null (exportAll of the browser shelf, or null when empty)
 * serverJson: string | null (the file on the device, or null when absent)
 * -> 'pull' | 'push' | 'none' */
export function decideBoot(localJson, serverJson) {
  if (serverJson && !localJson) return 'pull';       // fresh browser, real books: take them
  if (serverJson && localJson) {
    let newer = 'none';
    try {
      const a = JSON.parse(localJson); const b = JSON.parse(serverJson);
      const at = Date.parse(a.exportedAt || 0) || 0;
      const bt = Date.parse(b.exportedAt || 0) || 0;
      if (bt > at) newer = 'pull';                   // the device's file is fresher
      else if (at > bt) newer = 'push';              // the browser moved ahead (offline work)
    } catch { newer = 'none'; }
    return newer;
  }
  if (!serverJson && localJson) return 'push';       // fill the empty shelf
  return 'none';
}

/* M510-46: the rows a restore spoke for — every settings key and connection held before it or after it (a device row
 * the restore let go is never taken back in by the house's push, M311). Pure, harness-tested. */
export async function rowsHeld(db) {
  return { keys: (await db.settings.keys()) || [], conns: ((await db.connections.list()) || []).map((c) => c && c.id).filter(Boolean) };
}
export function restoreSpeaksFor(before, after) {
  const keys = new Set();
  for (const side of [before, after]) {
    for (const key of (side && Array.isArray(side.keys) ? side.keys : [])) if (typeof key === 'string' && key && !/^bookStamp:/.test(key) && key !== 'booksStamp' && key !== 'booksPushing') keys.add(key);
    for (const id of (side && Array.isArray(side.conns) ? side.conns : [])) if (typeof id === 'string' && id) keys.add('conn:' + id);
  }
  return [...keys];
}
export async function initSync(ctx) {
  const status = { backed: false, words: 'in this browser only' };
  /* M155: BOOKS PER STORY, like SillyTavern. A worker keeps one file per
   * tale on the device (and one for the house). Boot pulls every book the
   * browser lacks or that is newer, and pushes the tales the device lacks;
   * after that, a change to a tale marks that tale dirty and only that book
   * is pushed, twenty seconds after the last write and at once when the page
   * hides. No whole-store export ever runs on the main thread again. */
  const canWorker = typeof Worker === 'function' && typeof document !== 'undefined';
  if (!canWorker) {
    try {
      const res = await fetch('api/books/list', { signal: AbortSignal.timeout(2500) });
      if (res.ok) { status.backed = true; status.words = 'on this device, in files — one book per tale'; }
    } catch { /* no server here */ }
    return status;
  }
  let worker = null;
  try { worker = new Worker(new URL('./sync-worker.js', import.meta.url), { type: 'module' }); } catch (err) { worker = null; }
  if (!worker) return status;
  const localHasStories = (await ctx.db.stories.list()).length > 0;

  const dirty = new Set();
  const EVICT_EVERY_MS = Number(globalThis.__cozyEvictEveryMs) > 0 ? Number(globalThis.__cozyEvictEveryMs) : 45000; /* M313: one tale at a time */
  let timer = null;
  let running = null;
  let knownIds = new Set(); /* the tales this browser holds — filled once the books have settled */
  /* M293: AN ASK WAITS FOR ITS OWN ANSWER. It took the first answer of the
   * right KIND, and the worker answers questions side by side — so two pulls
   * in flight (a page announced beside the house, a tale opened beside a live
   * pull) both resolved on the first `pulledOne` back: the room painted a tale
   * whose pages had not landed, the pull that then landed painted nothing,
   * and a worker's error settled whatever else was waiting. Every question
   * carries an id the worker echoes; only that answer resolves it. */
  /* M675 — THE EPOCH THIS BROWSER'S BOOKS BELONG TO (see sync-worker.js: the library's epoch). Kept in localStorage — this
   * browser's alone, never in a book, a copy or a restore (a mark that rode the house book would tell every browser the
   * same thing) — and handed to the worker with every question. A browser that cannot keep it (no localStorage) keeps
   * none: it claims nothing and is never made the device's copy by itself, exactly as before. */
  /* M675: HAS THE TAVERN'S SERVER EVER ANSWERED THIS BROWSER? Kept in localStorage (with js/sent.js, under one name). A
   * page served by a host that is not the tavern's (GitHub Pages) is never sent a book, a page or a word of a tale —
   * see sync-worker.js deviceKnown; a tavern that is merely not running still is, and tried again. */
  const DEVICE_KEY = 'cozy.device';
  const hadDevice = () => { try { return localStorage.getItem(DEVICE_KEY) === '1'; } catch (err) { return false; } };
  const noteDevice = () => { try { localStorage.setItem(DEVICE_KEY, '1'); } catch (err) { /* this sitting knows it */ } };
  const parked = new Set(); /* tales changed while no tavern's server has ever answered: sent when one does */
  /* M675 — A REFUSAL BY NAME IS SAID. serve.py answers /api/ only under the device's own name (127.0.0.1, localhost, or a
   * name given in COZY_HOSTS). Opened under any other name for the device — a LAN address through a forwarder, which
   * worked on the build before — every door answered 403, the app took that for "no tavern here" and went quietly
   * browser-only: pages kept to this browser alone, "Where the tales live: in this browser only", not a word of why
   * (the second reviewer, the real app). The tavern's refusal now carries its reason (sync-worker.js saidBy): the room
   * says ONCE a sitting that the tavern is running, that it does not answer under this address, and how to start it
   * so that it does — and Settings and "Take a copy" say the same (status.words, status.refusedWords). */
  const BACKED_WORDS = 'on this device, in files — one book per tale';
  const refusedWords = (said) => {
    const name = String((said && said.host) || (typeof location !== 'undefined' && location.hostname) || 'this address');
    if (said && said.refused === 'host') return 'The tavern is running, but it does not answer under this address (' + name + '), so nothing written here reaches the device. Start it with COZY_HOSTS=' + name + ' (in Termux: COZY_HOSTS=' + name + ' cozytavern), then refresh this page.';
    return 'The tavern is running, but it turned this page away' + (said && said.why ? ' — ' + said.why : '') + '. Nothing written here reaches the device until that is put right.';
  };
  status.refusedWords = refusedWords;
  let toldRefused = false;
  const sayRefused = (said) => {
    if (!said || !said.refused) return;
    status.refused = said;
    if (said.refused === 'host') status.backed = false; /* every door of the books is shut to this address, whatever an earlier look found */
    if (!status.backed) status.words = said.refused === 'host'
      ? 'in this browser only — the tavern is running, but it does not answer under this address; started with COZY_HOSTS=' + String(said.host || (typeof location !== 'undefined' && location.hostname) || '') + ' it keeps what is written here'
      : 'in this browser only — the tavern is running, but it turned this page away';
    if (toldRefused || typeof ctx.toast !== 'function') return;
    toldRefused = true;
    ctx.toast(refusedWords(said));
  };
  /* M675: THE TAVERN IS THERE — said by every look that finds it, not by the first alone. `backed` was set once, when the
   * page opened: a sitting that began while the tavern was not running (the page then comes from the service worker's
   * shelf) never learned that it had been started — the books went to the device again, while Settings went on saying
   * "in this browser only", a zip could not be brought back ("Start the tavern…") and the search said "the device did
   * not answer" without asking it (the second reviewer: a catch-up boot reachable, two books pushed, backed still false). */
  const foundTavern = () => { status.backed = true; status.words = BACKED_WORDS; status.refused = null; noteDevice(); };
  const EPOCH_KEY = 'cozy.epoch';
  const epochKept = (() => { try { const k = EPOCH_KEY + '.try'; localStorage.setItem(k, '1'); const ok = localStorage.getItem(k) === '1'; localStorage.removeItem(k); return ok; } catch (err) { return false; } })();
  const epochRead = () => { if (!epochKept) return null; try { const v = localStorage.getItem(EPOCH_KEY); return typeof v === 'string' && v.startsWith('e:') ? v.slice(2) : undefined; } catch (err) { return null; } };
  const epochWrite = (e) => { if (!epochKept || typeof e !== 'string') return; try { localStorage.setItem(EPOCH_KEY, 'e:' + e); } catch (err) { /* asked again at the next start */ } };
  /* what a write claims: the epoch noted ('' while none was ever brought back — also before any was noted), or null */
  const epochNow = () => { const e = epochRead(); return e === null ? null : (e || ''); };
  status.epoch = epochNow;
  let askSeq = 0;
  const ask = (msg) => new Promise((resolve) => {
    const rid = ++askSeq;
    const onmsg = (e) => { if (e.data && e.data.rid === rid && (e.data.kind === msg.expect || e.data.kind === 'error')) { worker.removeEventListener('message', onmsg); resolve(e.data); } };
    worker.addEventListener('message', onmsg);
    worker.postMessage({ ...msg, rid, epoch: epochNow(), epochKnown: typeof epochRead() === 'string', hadDevice: hadDevice() });
  });
  const storyOfKey = (key) => { const at = String(key).lastIndexOf(':'); return at > 0 ? String(key).slice(at + 1) : ''; };
  /* M182: this browser's own name, for the life of the tab. */
  const clientId = 'tab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  /* M293: ANOTHER HAND AT A TALE. When a tale changed under this browser —
   * another browser announced a write to it, or a pull found it moved on the
   * device within the last minutes — that browser's readers may still be
   * writing its ledger. The room's idle repairs (a ledger gap read, a record
   * gap folded, an unfinished last page resumed) keep off such a tale for a
   * while, or two browsers read the same page and write the same beat twice
   * (ui/chat.js otherHandAt). A tale's own writes here never mark it. */
  /* The marks live in localStorage — this browser's alone, never in the
   * house book (a mark that rode the book would tell both browsers the same
   * thing), and kept through the reload a boot pull makes. In memory when the
   * browser has none. */
  const marks = new Map();
  const markGet = (key) => { try { const v = Number(localStorage.getItem(key)); if (v) return v; } catch (err) { /* no store */ } return marks.get(key) || 0; };
  const markSet = (key, at) => { marks.set(key, at); try { localStorage.setItem(key, String(at)); } catch (err) { /* memory holds it */ } };
  const RECENT_MS = 10 * 60000;
  /* a tale this browser wrote within the window is this browser's own — a
   * boot pull that finds it moved is its own killed tab catching up, not
   * another hand (a live announcement from another browser is always theirs) */
  const wroteHereAt = (id) => markGet('cozy.wrote:' + id);
  const noteWroteHere = (id) => { if (id && id !== '_house') markSet('cozy.wrote:' + id, Date.now()); };
  const noteElsewhere = (ids, { unlessMine = false } = {}) => {
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      if (!id || id === '_house') continue;
      if (unlessMine && Date.now() - wroteHereAt(id) < RECENT_MS) continue;
      markSet('cozy.elsewhere:' + id, Date.now());
    }
  };
  status.wroteElsewhereAt = (id) => markGet('cozy.elsewhere:' + id);
  /* M293: WHAT IS THIS BROWSER'S. Every settings key and connection this
   * browser writes is remembered with the moment; a push that lands records
   * the moment for its book. A row changed here since the book's last push
   * is this browser's own — a pull neither writes over it nor lets it go
   * (store.js keep) — while every other row is the book's, so a row let go
   * elsewhere is let go here. */
  const wroteKeyAt = new Map();      /* 'key' or 'conn:' + id -> when */
  const pushedAt = new Map();        /* bookId -> when its last push landed */
  const noteKey = (key) => { if (key) wroteKeyAt.set(key, Date.now()); };
  const mineFor = (bookId) => {
    const since = pushedAt.get(bookId) || 0;
    const out = [];
    for (const [key, at] of wroteKeyAt) {
      if (at <= since) continue;
      const conn = key.startsWith('conn:');
      const owner = conn ? '_house' : (storyOfKey(key) && knownIds.has(storyOfKey(key)) ? storyOfKey(key) : '_house');
      if (owner === bookId) out.push(conn ? key.slice(5) : key);
    }
    return out;
  };

  /* M181: A PUSH ASKED FOR WHILE ONE RUNS IS NOT A PUSH REFUSED. The old
   * guard returned at once when a push was in flight, so anything marked
   * during it fell to a fresh twenty-second timer — and "push everything
   * now" (Settings, and the page-hide hook) could land mid-flight and
   * silently push NOTHING. Measured: writing two tales and asking for a push
   * saved one of them and left the other, the connection and the house
   * settings on the floor. Pushes are serialized and drained instead: the
   * runner keeps going while anything is dirty, so a mark made during a push
   * rides the same drain, and every caller awaits a promise that is only
   * done when the shelf is clean. */
  /* M558: WHAT IS OWED TO THE DEVICE OUTLIVES THE TAB. The dirty list lived only while the page was open: a change whose push
   * did not land, and the tab then closed (or the phone reaped it) before the tavern answered again, sat in this browser
   * alone until that tale was written again — the boot pushes only tales the device has no book of. Each mark is kept in
   * this browser's localStorage until its push lands, and the next start pushes whatever is still owed. */
  const OWED_KEY = 'cozyPushOwed';
  const owedRead = () => { try { const o = JSON.parse(localStorage.getItem(OWED_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (err) { return {}; } };
  const owedWrite = (o) => { try { if (Object.keys(o).length) localStorage.setItem(OWED_KEY, JSON.stringify(o)); else localStorage.removeItem(OWED_KEY); } catch (err) { /* a browser without room keeps the list in memory only */ } };
  const owe = (id) => { if (!id) return; const o = owedRead(); if (!o[id]) { o[id] = Date.now(); owedWrite(o); } };
  const paid = (ids) => { const o = owedRead(); let moved = false; for (const id of ids) if (o[id]) { delete o[id]; moved = true; } if (moved) owedWrite(o); };
  /* M557: what did not land, how many times, and when it goes again */
  const failedPushes = new Map(); /* id -> { tries, timer, told } */
  const pushLater = { now: null }; /* the push, once it is defined below */
  const pushAgainLater = (id, f) => {
    const was = failedPushes.get(id) || { tries: 0, timer: null, told: false };
    was.tries += 1;
    clearTimeout(was.timer);
    const wait = Math.min(600000, 20000 * Math.pow(2, Math.min(was.tries - 1, 5)));
    was.timer = setTimeout(() => { dirty.add(id); if (pushLater.now) pushLater.now(); }, wait);
    failedPushes.set(id, was);
    if (was.tries >= 3 && !was.told && typeof ctx.toast === 'function') {
      was.told = true;
      const code = f && Number.isFinite(f.status) ? f.status : -1;
      /* M569: in plain words, and which tale — "a tale you wrote in… grown past what the device takes in one piece" told him
       * nothing he could use */
      const say = (title) => {
        const what = id === '_house' ? 'Your settings and connections' : (title ? '“' + title + '”' : 'One of your tales');
        const reason = code === 413 ? 'it is too big for the save on your phone (over 256 MB)'
          : code === 0 ? 'the tavern on your phone is not answering — is Termux still running?'
            : 'your phone refused the save' + (code > 0 ? ' (' + code + ')' : '');
        ctx.toast(what + ' isn’t saved to your phone yet: ' + reason + '. It is safe in this browser, and the app keeps trying.');
      };
      if (id === '_house' || !ctx.db || !ctx.db.stories) say('');
      else ctx.db.stories.get(id).then((st) => say(st && st.title ? String(st.title) : '')).catch(() => say(''));
    }
  };
  let holding = false; /* M510-47: while the device's restored copy is read in, nothing of this browser's is pushed */
  /* M675: WHAT A HOLD SETS ASIDE IS PUT BACK WHEN NO COPY IS READ IN. A hold let go of everything that was waiting to be
   * sent (the copy being read in was to replace it) — and a hold can end with nothing read in: the device holds no
   * other library after all (wentStale: `empty`, `unnamed`, `same`), or the read-in is asked again later. What was
   * waiting when the hold began, and what was marked while it stood, is kept here and waits to be sent again. */
  const heldBack = new Set();
  /* M510-47: THE BROWSER BECOMES THE DEVICE'S COPY, EXACTLY — after the device took a copy back (api/backup/restore).
   * Every push is held first (a push now would lay this browser's old books over the copy); every book the device holds
   * is read in whole; a tale this browser holds that the copy does not is let go here (the whole pull alone kept it, and
   * boot would have pushed it back to the device); then the page reloads on the copy. */
  /* M675: one at a time (the browser that brought the copy back is also told of it by the device's own announcement);
   * the words this browser kept for the library as it was go too (they are the device's now, js/sent.js); and the epoch
   * of the library read in is noted, so this browser's writes are the copy's from here on. */
  let mirrorRun = null;
  const mirror = () => {
    if (mirrorRun) return mirrorRun;
    mirrorRun = (async () => {
      holding = true;
      for (const id of dirty) heldBack.add(id);
      dirty.clear();
      clearTimeout(timer);
      try { if (running) await running; } catch (err) { /* what was in flight is overwritten by the copy */ }
      const r = await ask({ kind: 'pull', exact: true, expect: 'pulled' });
      if (r && r.ok) {
        /* M675: THE WORDS KEPT HERE GO ONLY ONCE THE COPY IS IN — never before. They were cleared first, and a read-in that
         * then failed (the device not answering, or holding nothing at all) left this browser with its books and none
         * of the words it had been keeping for the device (the second reviewer: 3 pages' words -> 0, nothing read in). */
        try { await clearSent(); } catch (err) { /* they are swept at the next start */ }
        if (typeof r.epoch === 'string') epochWrite(r.epoch);
        owedWrite({}); /* M558: the device's copy is what stands — nothing of this browser's is owed */
        noteMirrored(); /* (M675: said after the reload — and only now that it is true) */
        dropCaches(); location.reload(); return r;
      }
      holding = false;
      for (const id of heldBack) { dirty.add(id); owe(id); } /* M675: no copy was read in — see heldBack */
      heldBack.clear();
      return r;
    })().finally(() => { mirrorRun = null; });
    return mirrorRun;
  };
  /* M675 — THIS BROWSER'S BOOKS ARE ANOTHER LIBRARY'S: the device said so (its announcement of a copy brought back, a
   * boot that found another epoch, a write refused as stale). Nothing of this browser's is sent from here on (the
   * device would refuse it), a page being told is let finish, and this browser is made the device's copy — tried
   * again every twenty seconds until the device answers, and said once if it does not at first. */
  /* M675 — WHAT IS SAID IS TRUE OF THE STATE. Three things were said that were not always so (the second reviewer):
   *   - "a copy was brought back" — of a device that names NO epoch: none was ever brought back there (its folder was
   *     emptied, or changed). Such a device is not another library to become at all (sync-worker.js boot, and the
   *     read-in's `unnamed`): nothing is said of it, because nothing is wrong — see below;
   *   - "…this browser now shows that copy", after the reload — noted BEFORE the read-in, so a read-in that failed and a
   *     reload by hand said it of a browser that showed no such thing: noted when the copy is in (mirror);
   *   - "the tavern is not answering" — for every read-in that failed, also when the tavern HAD answered (a library
   *     half-way through a swap says so with its reason; a book that would not read): the reason is the one that was
   *     given (whyNot).
   * And a device that holds NO books (`empty`), that names no epoch (`unnamed`), or whose books are this browser's own
   * (`same`) is not stale at all: reached here by a write refused while the page was open, this browser keeps
   * everything, takes the device's epoch, and sends what it owes the device and what the device has no book of. */
  const MIRRORED_NOTE = 'cozy.mirrored';
  const noteMirrored = () => { try { sessionStorage.setItem(MIRRORED_NOTE, '1'); } catch (err) { /* said nowhere, done all the same */ } };
  const whyNot = (r) => {
    if (r && r.kind === 'error') return /fetch|network|abort|timed? ?out/i.test(String(r.words || '')) ? 'the tavern stopped answering part-way' : 'it stumbled while reading it in' + (r.words ? ' (' + r.words + ')' : '');
    if (r && r.said && r.said.why) return 'the tavern answered: ' + r.said.why;
    if (r && Number(r.status) > 0) return 'the tavern answered, but not with its list of books';
    return 'the tavern is not answering';
  };
  let staleRun = null;
  const wentStale = (deviceEpoch) => {
    if (staleRun) return staleRun;
    staleRun = (async () => {
      holding = true;
      let told = false;
      for (;;) {
        while (ctx.chat && typeof ctx.chat.isBusy === 'function' && ctx.chat.isBusy()) await new Promise((r) => setTimeout(r, 600));
        const r = await mirror();
        if (r && r.ok) return; /* the page reloads */
        if (r && (r.empty || r.unnamed || r.same)) {
          /* `empty`: the device holds no books at all. `unnamed`: it names no epoch — no copy was ever brought back
           * there. `same`: its books are this browser's own (the start took the device's epoch and is sending them).
           * In each case this browser is not stale. It keeps everything and takes the device's epoch; what was
           * waiting to be sent — the page just refused with it — is sent (the read-in put it back: heldBack); and
           * the tales the device has no book of go to it as at any start (the worker's boot, `sendOnly`).
           * Nothing more: a tale held here whole and unchanged is NOT sent — the device's book of it may be newer
           * (another browser's), and this one's old state would go over it (made to happen, scene 17 of
           * tests/device_pair.py). And nothing is read in: a look reads the device's newer book in over the open
           * tale, and the page that was refused is in no book but this one. */
          staleRun = null;
          holding = false;
          if (typeof r.epoch === 'string') epochWrite(r.epoch);
          foundTavern();
          if (!r.same) {
            const mine = {};
            for (const id of [...knownIds, '_house']) { const m = mineFor(id); if (m.length) mine[id] = m; }
            const b = await ask({ kind: 'boot', clientId, expect: 'boot', mine, sendOnly: true, active: ctx.getActiveStoryId() || null });
            if (b && b.kind === 'boot' && b.reachable && (b.restored || b.stale)) { wentStale(b.restored ? b.epoch : b.staleEpoch); return; } /* (a copy was brought back there meanwhile, after all) */
            if (b && b.kind === 'boot' && b.reachable && typeof b.epoch === 'string') epochWrite(b.epoch);
          }
          clearTimeout(timer);
          pushNow();
          return;
        }
        holding = true; /* (mirror lets go of the hold when it fails: kept, the device would refuse the push anyway) */
        /* (a device known to name no epoch — the refusal said so — has had no copy brought back: nothing is said of one; the read-in is asked again, and answers `unnamed` or `empty`) */
        if (!told && deviceEpoch !== '' && typeof ctx.toast === 'function') { told = true; ctx.toast('A copy of your books was brought back on this device, and this browser could not read it in yet — ' + whyNot(r) + '. It keeps trying; until it is in, what is written here is not kept.'); }
        await new Promise((r2) => setTimeout(r2, 20000));
      }
    })();
    return staleRun;
  };
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(MIRRORED_NOTE)) {
      sessionStorage.removeItem(MIRRORED_NOTE);
      if (typeof ctx.toast === 'function') setTimeout(() => ctx.toast('A copy of your books was brought back on this device — this browser now shows that copy.'), 1200);
    }
  } catch (err) { /* no note, the copy is in all the same */ }
  const pushNow = () => {
    if (holding) { for (const id of dirty) heldBack.add(id); paid([...dirty]); dirty.clear(); return Promise.resolve(); } /* M558: the device's restored copy is what stands — nothing of this browser's is owed (M675: set aside, should no copy be read in after all — heldBack) */
    if (running) return running;
    if (!dirty.size) return Promise.resolve();
    running = (async () => {
      try {
        while (dirty.size) {
          const ids = [...dirty];
          dirty.clear();
          const began = Date.now();
          const r = await ask({ kind: 'push', ids, expect: 'pushed', mine: { _house: mineFor('_house') } }); /* M311: what this browser itself let go — everything else the device holds is kept */
          /* M675: no tavern's server has ever answered this browser (a static host): nothing was sent, nothing is tried
           * again on a timer and nothing is said — the tales wait (still owed, M558) for a server to show itself */
          if (r && r.nodevice) { for (const id of ids) parked.add(id); continue; }
          if (parked.size && r && r.kind === 'pushed') { for (const id of parked) dirty.add(id); parked.clear(); }
          for (const id of (r && Array.isArray(r.ids)) ? r.ids : []) { pushedAt.set(id, began); const f = failedPushes.get(id); if (f) clearTimeout(f.timer); failedPushes.delete(id); }
          paid([...((r && Array.isArray(r.ids)) ? r.ids : []), ...((r && Array.isArray(r.refused)) ? r.refused : []), ...((r && Array.isArray(r.gone)) ? r.gone : [])]); /* M558 */
          /* M557: A PUSH THAT DID NOT LAND IS PUSHED AGAIN. The ids were taken off the dirty list before the push, and a book
           * the device did not take (the server down — Termux reaped — a timeout, a refusal) was simply dropped: it went
           * to the device only when that tale was written again, and the open tale and the house's own settings could sit
           * in this browser alone. Now each one is tried again, later and later (20 s, doubling, at most ten minutes), and
           * when one keeps not landing he is told once, in plain words, that it is safe here and not yet on the device. */
          const landed = new Set((r && Array.isArray(r.ids)) ? r.ids : []);
          const held = new Set([...((r && Array.isArray(r.waiting)) ? r.waiting : []), ...((r && Array.isArray(r.refused)) ? r.refused : []), ...((r && Array.isArray(r.gone)) ? r.gone : [])]); /* held back, taken from the device, or no longer here */
          const why = new Map(((r && Array.isArray(r.failed)) ? r.failed : []).map((f) => [f.id, f]));
          if (r && r.stale) { for (const id of ids) if (!landed.has(id) && !held.has(id)) heldBack.add(id); wentStale(r.staleEpoch); return; } /* M675: the device holds another library — this browser becomes its copy; nothing of the old one is tried again (set aside, should it turn out to hold no other library after all — heldBack) */
          for (const f of why.values()) if (f && f.said && f.said.refused) { sayRefused(f.said); break; } /* M675: turned away by name, or as another page's — said once, with the tavern's reason */
          for (const id of ids) if (!landed.has(id) && !held.has(id)) pushAgainLater(id, why.get(id) || { status: r && r.kind === 'error' ? 0 : -1 });
          /* M430: a tale held back while it is still being made is not lost to the device: letting go of `building`
           * (its last write) sends it at once — the stories.update wrap below */
        }
      } finally { running = null; }
    })();
    return running;
  };
  pushLater.now = pushNow;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(pushNow, 20000); };
  /* M670 — HIS: "as for backup, what matters is I have all the information — when I import it, it's basically the original, like
   * a Mac's Time Machine." The device's copy is made of the device's books, and a ledger, a record or a setting goes to
   * the device twenty seconds after it changes (only pages go at once, M181): a copy taken inside those twenty seconds
   * held the newest pages and the ledger from before them (made to happen: tests/backup_fresh.py). "Take a copy" asks
   * for everything still waiting to be sent NOW, and waits for it, before the device zips. */
  /* M675 — AND WHAT A FAILED PUSH LEFT WAITING GOES WITH IT. A push that did not land is taken off the list and tried again
   * later (twenty seconds, doubling, up to ten minutes): "Take a copy" pressed inside that wait asked for "everything
   * still waiting" and sent nothing — the zip was made of the device's old book (the audit: one failed push, then
   * pushBooksNow() asked the worker for 0 books while the tale was still owed). Every tale whose push is parked, and
   * every one an earlier tab still owed, is on the list again before it is sent. */
  ctx.pushBooksNow = async () => {
    clearTimeout(timer);
    for (const id of failedPushes.keys()) dirty.add(id);
    for (const id of Object.keys(owedRead())) dirty.add(id);
    await pushNow();
    if (dirty.size) await pushNow(); /* a drain already running took its ids before these were added (M181) */
    return { owed: Object.keys(owedRead()).filter((id) => failedPushes.has(id) || dirty.has(id)) }; /* what still did not land */
  };
  const mark = (id) => { if (id) { dirty.add(id); owe(id); schedule(); noteWroteHere(id); } };
  /* M181: PROSE GOES TO THE DEVICE AT ONCE. Every write waited on the same
   * twenty-second debounce, so a page the writer had just read sat only in
   * the browser for twenty seconds — and a browser whose data is cleared in
   * that window, or a phone that reaps the tab before visibilitychange
   * fires, takes those words with it. A ledger can be rebuilt from the
   * pages; the pages cannot be rebuilt from anything. So a MESSAGE write
   * pushes now, not in twenty seconds. Settings and ledger churn (three to
   * five writes a turn from the workers) keep the debounce — pushing on each
   * would rewrite the whole book five times a turn for something the
   * readers can make again. The push runs in the sync worker, off the
   * thread the writer is reading on. */
  const markNow = (id) => {
    if (!id) return;
    dirty.add(id);
    owe(id); /* M558 */
    noteWroteHere(id);
    clearTimeout(timer);
    Promise.resolve().then(pushNow);
  };

  /* boot: with a three-second grace; a longer pull finishes behind a toast and reloads once */
  const boot = ask({ kind: 'boot', clientId, expect: 'boot', active: ctx.getActiveStoryId() || (await ctx.db.settings.get('activeStoryId')) || null }); /* M313: the house and the open tale */
  const first = await Promise.race([boot, new Promise((r) => setTimeout(() => r({ late: true }), 3000))]);
  const settle = async (b) => {
    if (b && b.kind === 'boot' && b.reachable) {
      foundTavern(); /* M675: the tavern's server has answered this browser (and is said to be there: backed, the words for Settings) */
      /* M675: the device holds another library than this browser's books belong to (a copy was brought back since this
       * browser last looked): this browser becomes the device's copy, exactly — before anything of it is pushed */
      if (b.restored) {
        const veil = document.getElementById('boot-veil') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'boot-veil' }));
        veil.setAttribute('role', 'status');
        veil.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;background:var(--bg, #0b0f12);color:var(--ink, #d8d2c4);font:1.05rem/1.5 Georgia, serif;';
        veil.textContent = 'A copy of your books was brought back on this device — reading it into this browser. The tavern opens the moment it is in.';
        const m = await mirror();
        if (m && m.ok) return true; /* the page reloads on the copy */
        veil.remove();
        wentStale(b.epoch); /* it could not be read in yet: nothing of this browser's is sent meanwhile, and it is tried again */
        return false;
      }
      if (typeof b.epoch === 'string') epochWrite(b.epoch);
      if (b.stale) { wentStale(b.staleEpoch); return false; }
      noteElsewhere(b.recent, { unlessMine: true });
      if (b.pulled > 0) { dropCaches(); location.reload(); return true; }
      { const owed = Object.keys(owedRead()); if (owed.length) { for (const id of owed) dirty.add(id); clearTimeout(timer); Promise.resolve().then(pushNow); } } /* M558: what an earlier tab still owed */
    } else if (b && b.kind === 'boot' && !b.reachable && b.said && b.said.refused) {
      sayRefused(b.said); /* M675: the tavern answered, and does not serve this address (or this page): said, with how to put it right */
    } else if (b && b.kind === 'boot' && !b.reachable && b.said && b.said.why && ctx.toast && hadDevice()) {
      /* M675: the tavern ANSWERED and could not open its books (a library half-way through a swap says why): its reason
       * is said — "is the tavern's server running?" was asked of a server that had just answered, or nothing was said */
      ctx.toast('The tavern answered, but it cannot open its books just now: ' + b.said.why + '. What you write is safe in this browser, and the app keeps trying.');
    } else if (b && b.kind === 'boot' && !b.reachable && !localHasStories && ctx.toast && hadDevice()) {
      /* M675: only in a browser the tavern's server has answered before — on a host that never was one (GitHub Pages) a
       * first visit was told to restart Termux */
      /* M156: say which of the two it is — an old server answers 404 to the books' list */
      ctx.toast(b.status === 404
        ? 'The tavern’s server is an older version — in Termux, stop it (Ctrl-C) and start it again, then refresh this page.'
        : 'No books reached this browser — is the tavern’s server (serve.py) running? Start it and refresh.');
    }
    return false;
  };
  if (first.late) {
    /* M332: THE TAVERN STAYS CLOSED WHILE THE BOOT IS STILL PULLING. After three seconds the house used to open anyway,
     * let the writer work — and, when the pull finished, lay the device's copy over whatever he had done meanwhile
     * (a boot pull protects nothing: it is asked before the page has written anything) and RELOAD THE PAGE under
     * his hands. A setting changed in those seconds was gone after the reload ("I need to refresh for it to
     * apply"); a branch being made was cut in half ("all the record gone"). SillyTavern does not let you type
     * into a chat it is still loading; neither does this. The wait is said, and it ends by itself. */
    const veil = document.createElement('div');
    veil.id = 'boot-veil';
    veil.setAttribute('role', 'status');
    veil.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;background:var(--bg, #0b0f12);color:var(--ink, #d8d2c4);font:1.05rem/1.5 Georgia, serif;';
    veil.textContent = 'Reading this device’s newer copy of your books — the tavern opens the moment it is in. Nothing is lost.';
    document.body.appendChild(veil);
    /* …and it never stays closed for ever: the worker answers when the pull is done; two minutes with no answer is a
     * worker that will not — the tavern opens on what this browser holds, and says so */
    const late = await Promise.race([boot.catch(() => null), new Promise((r) => setTimeout(() => r({ gaveUp: true }), 120000))]);
    if (late && late.gaveUp) {
      veil.remove();
      if (ctx.toast) ctx.toast('The device’s books took too long to read — the tavern opened on what this browser holds. Nothing here was changed.');
    } else {
      const reloaded = await settle(late);
      if (reloaded) return status;
      veil.remove();
    }
  } else if (await settle(first)) return status;

  /* the live mirror: what changed, and only that */
  knownIds = new Set((await ctx.db.stories.list()).map((s) => s.id));
  const wrap = (obj, name, pick) => {
    if (!obj || typeof obj[name] !== 'function') return;
    const orig = obj[name].bind(obj);
    obj[name] = (...args) => { const out = orig(...args); try { pick(args, out); } catch (err) { /* fine */ } return out; };
  };
  /* M558: the sync's own bookkeeping (a book's stamp, the pushes in flight) is never a change of a tale's — for a delete as
   * for a set: a deleted stamp marked its tale owed, and the next start pushed a book nothing had changed */
  const ownKey = (key) => /^bookStamp:/.test(key) || key === 'booksStamp' || key === 'booksPushing';
  wrap(ctx.db.settings, 'set', ([key]) => { if (ownKey(key)) return; noteKey(key); const id = storyOfKey(key); mark(id && knownIds.has(id) ? id : '_house'); });
  wrap(ctx.db.settings, 'delete', ([key]) => { if (ownKey(key)) return; noteKey(key); const id = storyOfKey(key); mark(id && knownIds.has(id) ? id : '_house'); });
  wrap(ctx.db.stories, 'create', (args, out) => { Promise.resolve(out).then((st) => { if (st && st.id) { knownIds.add(st.id); mark(st.id); mark('_house'); } }); });
  /* M430: A BRANCH GOES TO THE DEVICE THE MOMENT IT IS WHOLE (chat.js branchFrom lets go of `building` after its last row)
   * — at once, like a page, never twenty seconds later with the device holding nothing of it (or, before M430, a half) */
  /* (after the write has landed — the hook runs as the write BEGINS, and a push asked for at once read the row still
   * `building` in the worker's own connection, held the branch back, and nothing asked again) */
  wrap(ctx.db.stories, 'update', ([id, patch], out) => { if (patch && patch.building === false) { const go = () => markNow(id); Promise.resolve(out).then(go, go); } else mark(id); mark('_house'); });
  wrap(ctx.db.stories, 'remove', ([id]) => { knownIds.delete(id); mark('_house'); try { ctx.db.settings.delete('bookStamp:' + id); } catch (err) { /* fine */ } try { if (!status.backed && !hadDevice()) return; /* M675: never to a host that is not the tavern's server */ const e = epochNow(); fetch('api/books/drop/' + encodeURIComponent(id), { method: 'POST', headers: typeof e === 'string' ? { 'x-cozy-epoch': e || '-' } : {} }).then(async (res) => { if (res && res.status === 409) { let now; try { now = (await res.json()).epoch; } catch (err) { now = undefined; } wentStale(now); } }).catch(() => {}); } catch (err) { /* fine */ } }); /* M675: a tale let go for the library as it was is not let go in a copy brought back since */
  /* M183: A PAGE IS APPENDED, NOT A BOOK REWRITTEN. M181 sent prose to the
   * device the moment it landed — and "a page landed" meant serializing the
   * WHOLE tale and writing it again: fifteen milliseconds at four hundred
   * pages, growing with every page the writer adds. The page itself is a few
   * kilobytes. It goes on its own now (measured 13x cheaper, and CONSTANT
   * whatever the tale's length); the ledger, the snapshots and the version
   * states still ride the twenty-second whole-book push, because the readers
   * can rebuild those and the prose cannot be rebuilt from anything.
   * A page the device will not take falls back to the whole book at once. */
  const pageNow = (id, row) => {
    if (!id || !row || !row.id) { markNow(id); return; }
    dirty.add(id);              /* the whole book still owes a push for its ledger */
    schedule();
    noteWroteHere(id);
    ask({ kind: 'page', id, row, expect: 'paged' }).then((r) => { if (r && r.stale) wentStale(r.staleEpoch); else if (r && r.said) sayRefused(r.said); }); /* M675 */
  };
  wrap(ctx.db.messages, 'append', ([id], out) => { Promise.resolve(out).then((row) => pageNow(id, row)).catch(() => markNow(id)); });
  wrap(ctx.db.messages, 'update', ([id], out) => { Promise.resolve(out).then((row) => pageNow(id, row)).catch(() => markNow(id)); });
  /* M675: …and a page changed through the store's guarded door (db.messages.change — a mend, the stored-page repair) goes
   * the same way. That door was added without this line: a mended page reached the device only when something else of
   * the tale happened to be written afterwards. A change that decided to leave the page as it is writes nothing, and
   * sends nothing. */
  wrap(ctx.db.messages, 'change', ([id], out) => { Promise.resolve(out).then((row) => { if (row) pageNow(id, row); }).catch(() => markNow(id)); });
  wrap(ctx.db.messages, 'remove', ([id]) => markNow(id)); /* M181: prose, at once */
  wrap(ctx.db.messages, 'deleteFrom', ([id]) => markNow(id)); /* M181: prose, at once */
  wrap(ctx.db.connections, 'add', ([conn]) => { if (conn && conn.id) noteKey('conn:' + conn.id); mark('_house'); });
  /* M293: the house's own probe of a model's room (providers/detect.js) is
   * bookkeeping, not the writer's hand — it never marks the house dirty and
   * never makes the row this browser's; it rides the next push that comes. */
  /* M431: EVERY NOTE THE HOUSE KEEPS ABOUT A CONNECTION ON ITS OWN — not only the room it asked of (M293): who the model is
   * (detect.js: identFor, modelHf, modelEfforts, identTried*), that the web page was refused and the tavern's server carried
   * the call (relay.js: viaRelay), what the model taught it or refused (effort.js: learned*, reasoningDown*, prefillDown*),
   * and a refused late system message (latesystem.js). Only viaRelay and identTried* were missing — and they were enough:
   * the other browser, having probed the connection he deleted here, took it for its own ("changed in this browser
   * since its last push"), kept it through his deletion and pushed it back to the device and to this browser. */
  const PROBE_ONLY = /^(?:detectedContext|detectedFor|detectTriedFor|detectTriedAt|identFor|identTriedFor|identTriedAt|modelHf|modelEfforts|viaRelay|learnedFor|learnedAt|learnedEfforts|learnedDrop|learnedOffThinks|reasoningDownAt|reasoningDownShape|reasoningDownRechecked|prefillDownAt|prefillDownShape|systemAfterRefusedFor|systemAfterRefused)$/;
  wrap(ctx.db.connections, 'update', ([id, patch]) => { if (patch && typeof patch === 'object' && Object.keys(patch).length && Object.keys(patch).every((k) => PROBE_ONLY.test(k))) return; noteKey('conn:' + id); mark('_house'); });
  wrap(ctx.db.connections, 'remove', ([id]) => { noteKey('conn:' + id); mark('_house'); });
  /* M510-46: A RESTORE SPEAKS FOR EVERY ROW IT REPLACED. "Bring a copy back" replaces everything here — but with the
   * tavern's server running, the house's next push is held against the device's copy (M311) and every house row the
   * device held that this browser lacked "and did not itself let go" was taken back in: a connection or a setting made
   * after the copy was taken came back over the restore. And the books pushed were the tales known BEFORE it (knownIds
   * never refreshed), so the restored tales waited for the next boot. Now the restore notes every settings key and
   * connection it touched — before and after — as this browser's own word, learns the tales it now holds, and pushes
   * them and the house. */
  if (ctx.db && typeof ctx.db.importAll === 'function') {
    const restore = ctx.db.importAll.bind(ctx.db);
    ctx.db.importAll = async (...args) => {
      let before = { keys: [], conns: [] };
      try { before = await rowsHeld(ctx.db); } catch (err) { /* the restore goes on */ }
      const out = await restore(...args);
      try {
        const after = await rowsHeld(ctx.db);
        for (const key of restoreSpeaksFor(before, after)) noteKey(key);
        knownIds = new Set((await ctx.db.stories.list()).map((s) => s.id));
      } catch (err) { /* the push still goes */ }
      for (const id of knownIds) mark(id);
      mark('_house');
      return out;
    };
  }
  /* M182: THE BOOKS ANNOUNCE THEMSELVES, AND THE ROOM LISTENS. serve.py holds
   * the one copy every browser shares and streams a line when a book changes;
   * this pulls just that book and refreshes in place. No polling, no reload,
   * and no waiting for the next open — the "in turn" is gone. A change this
   * browser made is skipped by name: pulling back your own write would put
   * your newer pages under what you had just sent. */
  let live = null;
  /* M186: NEVER OVER A PAGE BEING WRITTEN. A live pull re-renders the thread,
   * and a structural render rebuilds it from the store — which would take the
   * streaming page, a node that exists only in the DOM until it lands, out
   * from under the writer mid-sentence. The pull itself is safe and happens
   * at once (the words reach the device either way); only the redraw waits
   * for the turn to finish. */
  let refreshOwed = null;
  const busyNow = () => Boolean(ctx.chat && typeof ctx.chat.isBusy === 'function' && ctx.chat.isBusy());
  /* M293: a pull lets go of the local rows the book does not hold — except
   * the rows this browser changed since its last push of that book (mineFor),
   * which it neither writes over nor lets go: a row written here a moment ago
   * is never taken by another browser's push. */
  const liveRefresh = async (bookId) => {
    noteElsewhere(bookId); /* M293: announced by another browser */
    /* M313: a tale held here only as a shelf row is read from the device when it is opened — an
     * announcement must not bring the whole book back into this browser */
    if (bookId !== '_house') { try { const row = await ctx.db.stories.get(bookId); if (!row || row.shallow) return; } catch (err) { return; } }
    const answer = await ask({ kind: 'pullOne', id: bookId, expect: 'pulledOne', replace: true, mine: { [bookId]: mineFor(bookId) } });
    if (!answer || !answer.pulled) return;
    if (busyNow()) {
      refreshOwed = bookId;
      const wait = setInterval(() => {
        if (busyNow() || !refreshOwed) return;
        clearInterval(wait);
        const owed = refreshOwed;
        refreshOwed = null;
        paint(owed);
      }, 600);
      return;
    }
    await paint(bookId);
  };
  const paint = async (bookId) => {
    dropCaches();
    try {
      if (ctx.chat && typeof ctx.chat.refreshStories === 'function') await ctx.chat.refreshStories(true);
      if (bookId === ctx.getActiveStoryId()) {
        notifyState(bookId);
        if (ctx.chat && typeof ctx.chat.renderThread === 'function') await ctx.chat.renderThread({ structural: true });
      }
      if (ctx.onStoriesChanged) ctx.onStoriesChanged();
    } catch (err) { /* a refresh that stumbles is not worth a broken room */ }
  };
  /* M190: a tale the worker had to heal (its pages pulled back after a push
   * the device refused) has landed in the store from another thread. Drop the
   * caches and redraw, or the reader keeps looking at an empty tale. */
  worker.addEventListener('message', (e) => {
    const msg = e && e.data;
    if (!msg || msg.kind !== 'healed' || !Array.isArray(msg.ids)) return;
    dropCaches();
    for (const id of msg.ids) liveRepaint(id);
  });
  const liveRepaint = (bookId) => {
    if (busyNow()) { refreshOwed = bookId; return; }
    paint(bookId).catch(() => {});
  };
  let catchingUp = null;
  let caughtUpAt = 0;
  const catchUp = () => {
    if (catchingUp) return catchingUp;
    if (Date.now() - caughtUpAt < 5000) return Promise.resolve();
    catchingUp = (async () => {
      try {
        const mine = {};
        for (const id of [...knownIds, '_house']) { const m = mineFor(id); if (m.length) mine[id] = m; }
        const b = await ask({ kind: 'boot', clientId, expect: 'boot', mine, active: ctx.getActiveStoryId() || null }); /* M313 */
        caughtUpAt = Date.now();
        if (b && b.kind === 'boot' && b.reachable) foundTavern(); /* M675: …and said to be there (it was only noted: `backed` stayed as the page's first look left it) */
        else if (b && b.kind === 'boot' && b.said && b.said.refused) sayRefused(b.said); /* M675 */
        if (b && b.kind === 'boot' && b.reachable && (b.restored || b.stale)) { wentStale(b.restored ? b.epoch : b.staleEpoch); return; } /* M675: a copy was brought back while this browser slept */
        if (b && b.kind === 'boot' && b.reachable && typeof b.epoch === 'string') epochWrite(b.epoch);
        if (b && b.kind === 'boot' && b.reachable) noteElsewhere(b.recent, { unlessMine: true });
        if (b && b.kind === 'boot' && b.reachable && b.pulled > 0) liveRepaint(ctx.getActiveStoryId() || '_house');
      } catch (err) { /* the next event or open looks again */ } finally { catchingUp = null; }
    })();
    return catchingUp;
  };
  status.catchUp = catchUp;
  const listen = () => {
    if (typeof EventSource !== 'function' || live) return;
    try { live = new EventSource('api/events'); } catch (err) { live = null; return; }
    live.onmessage = (e) => {
      let msg = null;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg || typeof msg.id !== 'string' || !msg.id) return;
      /* M675: a copy was brought back on the device — by this browser (it is already reading it in: mirror is one at a
       * time) or by another: every book this browser holds is the old library's */
      if (msg.id === '_restored') { if (typeof msg.epoch === 'string' && epochNow() !== null && msg.epoch !== epochNow()) wentStale(msg.epoch); return; }
      if (msg.by === clientId) return;            /* our own write, come home */
      liveRefresh(msg.id);
    };
    /* the browser reconnects an EventSource on its own; a stream that will
     * not open at all simply leaves the house on its boot-time pull */
    /* M293: A STREAM THAT DROPPED IS CAUGHT UP ON. A phone in the background
     * loses the stream (the network is put to sleep; a proxy reaps it), the
     * browser quietly reconnects — and every change the other browser made
     * in between was announced to nobody: this room stayed as it was until
     * the next change happened to come, or a reload. On the stream's return,
     * and whenever the page comes back into view, the books are looked over
     * as at boot (the manifest's stamps against ours — a few kilobytes) and
     * what moved is painted in place. */
    let dropped = false;
    live.onerror = () => { dropped = true; };
    live.onopen = () => { if (dropped) { dropped = false; catchUp(); } };
  };
  listen();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') catchUp(); });
  window.addEventListener('pagehide', () => { if (live) { try { live.close(); } catch (err) { /* fine */ } live = null; } });

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty.size) { clearTimeout(timer); pushNow(); } });
  window.addEventListener('pagehide', () => { if (dirty.size) { clearTimeout(timer); pushNow(); } });

  /* on demand: Settings → The house → "Bring the books from the device" */
  status.pullNow = async () => {
    const r = await ask({ kind: 'pull', expect: 'pulled' });
    if (r && r.ok) { dropCaches(); location.reload(); }
    return r;
  };
  status.mirrorDevice = () => mirror(); /* M510-47, M675: defined above, beside the hold it takes */
  /* on demand: push every tale now (a first save of a browser's whole shelf) */
  /* M189: fetch one tale's pages, on demand, when the reader opens it. */
  /* M675 — WHAT WAS WRITTEN INTO IT GOES TO THE DEVICE BEFORE ITS BOOK IS READ IN. A tale held by name only opens with no
   * pages when its book cannot be read just then; a page written into it then waits here for its push. Opened again
   * before that push — the tavern started, the tale tapped once more, which is what anyone does on seeing it empty —
   * the device's book was read in OVER what was written: the exchange was in neither place (made to happen,
   * tests/device_pair.py scene 18). Whatever this browser still owes the device of the tale is sent first (the worker
   * adds the pages to the device's book and reads it in whole — addedToItsBook); if it could not go, the book is
   * not read in over it: the tale opens as it stands here, and the pages go when the device takes them. And while
   * a hold stands (a write was refused, and what the device holds is not settled yet) nothing that waits is sent, so
   * nothing is read in over it either — the last part of that scene: the exchange was read over while the hold stood. */
  status.fetchStory = async (id) => {
    if (!id) return false;
    if (dirty.has(id) || failedPushes.has(id) || heldBack.has(id) || owedRead()[id]) {
      if (holding) return false;
      dirty.add(id);
      clearTimeout(timer);
      await pushNow();
      if (dirty.has(id)) await pushNow(); /* a drain already running took its ids before this one was added (M181) */
      if (dirty.has(id) || failedPushes.has(id)) return false;
    }
    const answer = await ask({ kind: 'pullOne', id, expect: 'pulledOne', replace: true, mine: { [id]: mineFor(id) } });
    if (answer && answer.pulled) { dropCaches(); noteElsewhere(answer.recent, { unlessMine: true }); }
    return Boolean(answer && answer.pulled);
  };
  /* M313: a tale held here is looked at when the reader opens it — taken again only if the device's moved on */
  status.freshen = async (id) => {
    if (!id || dirty.has(id) || heldBack.has(id)) return false; /* (M675: …nor a tale whose changes a hold has set aside — they wait to be sent all the same; tests/device_pair.py scene 18) */
    const answer = await ask({ kind: 'pullOne', id, expect: 'pulledOne', replace: true, ifNewer: true, mine: { [id]: mineFor(id) } });
    if (answer && answer.pulled) { dropCaches(); noteElsewhere(answer.recent, { unlessMine: true }); }
    return Boolean(answer && answer.pulled);
  };
  /* M313: THE BROWSER HOLDS THE OPEN TALE. One tale at a time, when nothing is being written and
   * nothing waits to be pushed: a tale that is not open is let go from this browser once the device
   * is proven to hold all of it (store.js provenOnDevice). A tale the device lacks something of is
   * pushed instead, and looked at again later. */
  status.evictOne = async () => {
    if (!status.backed || busyNow() || dirty.size || running) return null; /* nothing being written, nothing waiting, no push in flight */
    const active = ctx.getActiveStoryId();
    const rows = await ctx.db.stories.list();
    /* M557 (the audit): never a tale whose readers are still at work. "Busy" was the storyteller alone — after he switched
     * tales, the last one's readers went on writing its ledger, and a write landing between the device's proof and the
     * letting-go was let go with it, never pushed */
    const next = rows.find((st) => st && !st.shallow && st.id !== active && !dirty.has(st.id) && !evictSkip.has(st.id) && queuedCount(st.id) === 0 && !workIsRunning(st.id));
    if (!next) return null;
    const answer = await ask({ kind: 'evict', id: next.id, expect: 'evicted' });
    if (answer && answer.ok) { dropCaches(); if (ctx.chat && typeof ctx.chat.refreshStories === 'function') { try { await ctx.chat.refreshStories(true); } catch (err) { /* the shelf redraws on its next change */ } } return { id: next.id, ok: true, pages: answer.pages }; }
    /* this browser holds something the device does not: it goes to the device NOW (not on the twenty-second
     * wait), and the tale is looked at again in half a minute; any other no is asked again in ten */
    const ahead = Boolean(answer && answer.ahead);
    evictSkip.add(next.id);
    setTimeout(() => evictSkip.delete(next.id), ahead ? 30000 : 10 * 60000);
    if (ahead) { mark(next.id); clearTimeout(timer); pushNow(); }
    return { id: next.id, ok: false, ahead, why: answer && answer.why };
  };
  const evictSkip = new Set();
  setInterval(() => { status.evictOne().catch(() => {}); }, EVICT_EVERY_MS);
  status.pushAll = async () => {
    for (const id of knownIds) dirty.add(id);
    dirty.add('_house');
    clearTimeout(timer);
    /* M181: await the drain, then once more — a drain already running took
     * its ids before these were added, and its own loop may have finished
     * before they landed. Two awaits leave the shelf clean either way. */
    await pushNow();
    if (dirty.size) await pushNow();
  };
  return status;
}
