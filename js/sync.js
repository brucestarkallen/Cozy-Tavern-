import { dropCaches } from './store.js';
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
  let inFlight = false;
  const ask = (msg) => new Promise((resolve) => {
    const onmsg = (e) => { if (e.data && (e.data.kind === msg.expect || e.data.kind === 'error')) { worker.removeEventListener('message', onmsg); resolve(e.data); } };
    worker.addEventListener('message', onmsg);
    worker.postMessage(msg);
  });
  const pushNow = async () => {
    if (inFlight || !dirty.size) return;
    const ids = [...dirty]; dirty.clear(); inFlight = true;
    try { await ask({ kind: 'push', ids, expect: 'pushed' }); } finally { inFlight = false; if (dirty.size) schedule(); }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(pushNow, 20000); };
  const mark = (id) => { if (id) { dirty.add(id); schedule(); } };
  const storyOfKey = (key) => { const at = String(key).lastIndexOf(':'); return at > 0 ? String(key).slice(at + 1) : ''; };

  /* boot: with a three-second grace; a longer pull finishes behind a toast and reloads once */
  const boot = ask({ kind: 'boot', expect: 'boot' });
  const first = await Promise.race([boot, new Promise((r) => setTimeout(() => r({ late: true }), 3000))]);
  const settle = async (b) => {
    if (b && b.kind === 'boot' && b.reachable) {
      status.backed = true; status.words = 'on this device, in files — one book per tale';
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
  const knownIds = new Set((await ctx.db.stories.list()).map((s) => s.id));
  const wrap = (obj, name, pick) => {
    if (!obj || typeof obj[name] !== 'function') return;
    const orig = obj[name].bind(obj);
    obj[name] = (...args) => { const out = orig(...args); try { pick(args, out); } catch (err) { /* fine */ } return out; };
  };
  wrap(ctx.db.settings, 'set', ([key]) => { if (/^bookStamp:/.test(key) || key === 'booksStamp') return; const id = storyOfKey(key); mark(id && knownIds.has(id) ? id : '_house'); });
  wrap(ctx.db.settings, 'delete', ([key]) => { const id = storyOfKey(key); mark(id && knownIds.has(id) ? id : '_house'); });
  wrap(ctx.db.stories, 'create', (args, out) => { Promise.resolve(out).then((st) => { if (st && st.id) { knownIds.add(st.id); mark(st.id); mark('_house'); } }); });
  wrap(ctx.db.stories, 'update', ([id]) => { mark(id); mark('_house'); });
  wrap(ctx.db.stories, 'remove', ([id]) => { knownIds.delete(id); mark('_house'); try { fetch('api/books/drop/' + encodeURIComponent(id), { method: 'POST' }).catch(() => {}); } catch (err) { /* fine */ } });
  wrap(ctx.db.messages, 'append', ([id]) => mark(id));
  wrap(ctx.db.messages, 'update', ([id]) => mark(id));
  wrap(ctx.db.messages, 'remove', ([id]) => mark(id));
  wrap(ctx.db.messages, 'deleteFrom', ([id]) => mark(id));
  wrap(ctx.db.connections, 'add', () => mark('_house'));
  wrap(ctx.db.connections, 'update', () => mark('_house'));
  wrap(ctx.db.connections, 'remove', () => mark('_house'));
  wrap(ctx.db, 'importAll', () => { for (const id of knownIds) mark(id); mark('_house'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty.size) { clearTimeout(timer); pushNow(); } });
  window.addEventListener('pagehide', () => { if (dirty.size) { clearTimeout(timer); pushNow(); } });

  /* on demand: Settings → The house → "Bring the books from the device" */
  status.pullNow = async () => {
    const r = await ask({ kind: 'pull', expect: 'pulled' });
    if (r && r.ok) { dropCaches(); location.reload(); }
    return r;
  };
  /* on demand: push every tale now (a first save of a browser's whole shelf) */
  status.pushAll = async () => { for (const id of knownIds) dirty.add(id); dirty.add('_house'); clearTimeout(timer); await pushNow(); };
  return status;
}
