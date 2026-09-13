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
  /* M140: THE BOOKS OFF THE MAIN THREAD. The old boot exported the whole
   * store to JSON to compare with the server's file, and every write
   * re-exported it 1.5s later — during play, every couple of seconds, on the
   * main thread: the twenty-second open and the lag on every press. Now a
   * worker owns export and POST; boot compares STAMPS (the server's
   * api/books/stamp, the browser's last push stamp); pushes are debounced to
   * a quiet minute and forced when the page hides. Without a Worker (a test
   * runtime), the old path runs once at boot and never mirrors live. */
  const canWorker = typeof Worker === 'function' && typeof document !== 'undefined';
  if (!canWorker) {
    try {
      const res = await fetch('api/books', { signal: AbortSignal.timeout(2500) });
      if (!res.ok && res.status !== 204) throw new Error('no shelf');
      status.backed = true;
      status.words = 'on this device, in files — the tavern keeps its own books';
    } catch { /* no server here */ }
    return status;
  }
  let worker = null;
  try { worker = new Worker(new URL('./sync-worker.js', import.meta.url), { type: 'module' }); } catch (err) { worker = null; }
  if (!worker) return status;
  const localHasStories = (await ctx.db.stories.list()).length > 0;
  const localStamp = (await ctx.db.settings.get('booksStamp')) || '';
  const bootAnswer = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'boot', move: 'none', reachable: false, late: true }), 3000);
    worker.onmessage = (e) => { if (e.data && e.data.kind === 'boot') { clearTimeout(timer); resolve(e.data); } else if (e.data && e.data.kind === 'error') { clearTimeout(timer); resolve({ kind: 'boot', move: 'none', reachable: false }); } };
    worker.postMessage({ kind: 'boot', localStamp, localHasStories });
  });
  if (bootAnswer.reachable) {
    status.backed = true;
    status.words = 'on this device, in files — the tavern keeps its own books';
    if (bootAnswer.serverStamp) await ctx.db.settings.set('booksStamp', bootAnswer.serverStamp);
    if (bootAnswer.pulled) dropCaches();
  } else if (bootAnswer.late) {
    /* the worker is still deciding (a big pull) — let it finish in the background and refresh the shelf when it does */
    status.words = 'in this browser; the device’s books are being read…';
    if (ctx.toast) ctx.toast('Reading the device’s books — the tavern will open again when they are in.');
    worker.onmessage = async (e) => {
      if (e.data && e.data.kind === 'boot' && e.data.reachable) {
        status.backed = true; status.words = 'on this device, in files — the tavern keeps its own books';
        if (e.data.serverStamp) await ctx.db.settings.set('booksStamp', e.data.serverStamp);
        /* M147: a late pull brought a whole store — the active story, the settings, the
         * shelves; the page reloads once so all of it takes, instead of a refreshed shelf
         * beside a room that booted empty (the writer saw "the data is not there") */
        if (e.data.pulled) { dropCaches(); location.reload(); }
      }
    };
  }
  if (!status.backed && !bootAnswer.late) return status;

  /* Live mirror, quietly: a push at most once a quiet minute, and at once when the page hides */
  let timer = null;
  let pending = false;
  const pushNow = () => {
    pending = false;
    worker.onmessage = async (e) => { if (e.data && e.data.kind === 'pushed' && e.data.ok && e.data.stamp) { try { await ctx.db.settings.set('booksStamp', e.data.stamp); } catch (err) { /* fine */ } } };
    worker.postMessage({ kind: 'push' });
  };
  const schedule = () => { pending = true; clearTimeout(timer); timer = setTimeout(pushNow, 60000); };
  const wrap = (obj, names) => {
    for (const name of names) {
      if (!obj || typeof obj[name] !== 'function') continue;
      const orig = obj[name].bind(obj);
      obj[name] = (...args) => { const out = orig(...args); if (!(name === 'set' && args[0] === 'booksStamp')) schedule(); return out; };
    }
  };
  wrap(ctx.db.settings, ['set']);
  wrap(ctx.db.stories, ['create', 'update', 'remove']);
  wrap(ctx.db.messages, ['append', 'remove', 'deleteFrom']);
  wrap(ctx.db.connections, ['add', 'update', 'remove']);
  wrap(ctx.db, ['importAll']);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pending) { clearTimeout(timer); pushNow(); } });
  window.addEventListener('pagehide', () => { if (pending) { clearTimeout(timer); pushNow(); } });
  return status;
}
