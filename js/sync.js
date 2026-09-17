import { dropCaches } from './store.js';
import { notify as notifyState } from './engine/state.js'; /* M182: the ledger's panels wake on a live pull */
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
  let askSeq = 0;
  const ask = (msg) => new Promise((resolve) => {
    const rid = ++askSeq;
    const onmsg = (e) => { if (e.data && e.data.rid === rid && (e.data.kind === msg.expect || e.data.kind === 'error')) { worker.removeEventListener('message', onmsg); resolve(e.data); } };
    worker.addEventListener('message', onmsg);
    worker.postMessage({ ...msg, rid });
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
  const pushNow = () => {
    if (running) return running;
    if (!dirty.size) return Promise.resolve();
    running = (async () => {
      try {
        while (dirty.size) {
          const ids = [...dirty];
          dirty.clear();
          const began = Date.now();
          const r = await ask({ kind: 'push', ids, expect: 'pushed' });
          for (const id of (r && Array.isArray(r.ids)) ? r.ids : []) pushedAt.set(id, began);
        }
      } finally { running = null; }
    })();
    return running;
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(pushNow, 20000); };
  const mark = (id) => { if (id) { dirty.add(id); schedule(); noteWroteHere(id); } };
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
    noteWroteHere(id);
    clearTimeout(timer);
    Promise.resolve().then(pushNow);
  };

  /* boot: with a three-second grace; a longer pull finishes behind a toast and reloads once */
  const boot = ask({ kind: 'boot', clientId, expect: 'boot' });
  const first = await Promise.race([boot, new Promise((r) => setTimeout(() => r({ late: true }), 3000))]);
  const settle = async (b) => {
    if (b && b.kind === 'boot' && b.reachable) {
      status.backed = true; status.words = 'on this device, in files — one book per tale';
      noteElsewhere(b.recent, { unlessMine: true });
      if (b.pulled > 0) { dropCaches(); location.reload(); return true; }
    } else if (b && b.kind === 'boot' && !b.reachable && !localHasStories && ctx.toast) {
      /* M156: say which of the two it is — an old server answers 404 to the books' list */
      ctx.toast(b.status === 404
        ? 'The tavern’s server is an older version — in Termux, stop it (Ctrl-C) and start it again, then refresh this page.'
        : 'No books reached this browser — is the tavern’s server (serve.py) running? Start it and refresh.');
    }
    return false;
  };
  if (first.late) {
    if (!localHasStories && ctx.toast) ctx.toast('Reading the device’s books — the tavern will open again when they are in.');
    boot.then(settle);
  } else if (await settle(first)) return status;

  /* the live mirror: what changed, and only that */
  knownIds = new Set((await ctx.db.stories.list()).map((s) => s.id));
  const wrap = (obj, name, pick) => {
    if (!obj || typeof obj[name] !== 'function') return;
    const orig = obj[name].bind(obj);
    obj[name] = (...args) => { const out = orig(...args); try { pick(args, out); } catch (err) { /* fine */ } return out; };
  };
  wrap(ctx.db.settings, 'set', ([key]) => { if (/^bookStamp:/.test(key) || key === 'booksStamp') return; noteKey(key); const id = storyOfKey(key); mark(id && knownIds.has(id) ? id : '_house'); });
  wrap(ctx.db.settings, 'delete', ([key]) => { noteKey(key); const id = storyOfKey(key); mark(id && knownIds.has(id) ? id : '_house'); });
  wrap(ctx.db.stories, 'create', (args, out) => { Promise.resolve(out).then((st) => { if (st && st.id) { knownIds.add(st.id); mark(st.id); mark('_house'); } }); });
  wrap(ctx.db.stories, 'update', ([id]) => { mark(id); mark('_house'); });
  wrap(ctx.db.stories, 'remove', ([id]) => { knownIds.delete(id); mark('_house'); try { ctx.db.settings.delete('bookStamp:' + id); } catch (err) { /* fine */ } try { fetch('api/books/drop/' + encodeURIComponent(id), { method: 'POST' }).catch(() => {}); } catch (err) { /* fine */ } });
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
    ask({ kind: 'page', id, row, expect: 'paged' });
  };
  wrap(ctx.db.messages, 'append', ([id], out) => { Promise.resolve(out).then((row) => pageNow(id, row)).catch(() => markNow(id)); });
  wrap(ctx.db.messages, 'update', ([id], out) => { Promise.resolve(out).then((row) => pageNow(id, row)).catch(() => markNow(id)); });
  wrap(ctx.db.messages, 'remove', ([id]) => markNow(id)); /* M181: prose, at once */
  wrap(ctx.db.messages, 'deleteFrom', ([id]) => markNow(id)); /* M181: prose, at once */
  wrap(ctx.db.connections, 'add', ([conn]) => { if (conn && conn.id) noteKey('conn:' + conn.id); mark('_house'); });
  /* M293: the house's own probe of a model's room (providers/detect.js) is
   * bookkeeping, not the writer's hand — it never marks the house dirty and
   * never makes the row this browser's; it rides the next push that comes. */
  const PROBE_ONLY = /^(?:detectedContext|detectedFor|detectTriedFor|detectTriedAt)$/;
  wrap(ctx.db.connections, 'update', ([id, patch]) => { if (patch && typeof patch === 'object' && Object.keys(patch).length && Object.keys(patch).every((k) => PROBE_ONLY.test(k))) return; noteKey('conn:' + id); mark('_house'); });
  wrap(ctx.db.connections, 'remove', ([id]) => { noteKey('conn:' + id); mark('_house'); });
  wrap(ctx.db, 'importAll', () => { for (const id of knownIds) mark(id); mark('_house'); });
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
        const b = await ask({ kind: 'boot', clientId, expect: 'boot', mine });
        caughtUpAt = Date.now();
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
  /* on demand: push every tale now (a first save of a browser's whole shelf) */
  /* M189: fetch one tale's pages, on demand, when the reader opens it. */
  status.fetchStory = async (id) => {
    if (!id) return false;
    const answer = await ask({ kind: 'pullOne', id, expect: 'pulledOne', replace: true, mine: { [id]: mineFor(id) } });
    if (answer && answer.pulled) { dropCaches(); noteElsewhere(answer.recent, { unlessMine: true }); }
    return Boolean(answer && answer.pulled);
  };
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
