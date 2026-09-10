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
  try {
    const res = await fetch('api/books', { signal: AbortSignal.timeout(2500) });
    if (!res.ok && res.status !== 204) throw new Error('no shelf');
    /* The server answered — the tavern keeps its own books here. */
    status.backed = true;
    status.words = 'on this device, in files — the tavern keeps its own books';
    const serverJson = res.status === 204 ? null : await res.text();

    const localStories = await ctx.db.stories.list();
    const localJson = localStories.length ? await ctx.db.exportAll() : null;
    const move = decideBoot(localJson, serverJson);
    if (move === 'pull') await ctx.db.importAll(serverJson);
    if (move === 'push') await push();

    /* Live mirror: every write schedules a push (debounced — a busy minute
     * of writing means one save at its end, not forty). */
    let timer = null;
    const wrap = (obj, names) => {
      for (const name of names) {
        if (!obj || typeof obj[name] !== 'function') continue;
        const orig = obj[name].bind(obj);
        obj[name] = (...args) => {
          const out = orig(...args);
          clearTimeout(timer);
          timer = setTimeout(push, 1500);
          return out;
        };
      }
    };
    wrap(ctx.db.settings, ['set']);
    wrap(ctx.db.stories, ['create', 'update', 'remove']);
    wrap(ctx.db.messages, ['append', 'remove', 'deleteFrom']);
    wrap(ctx.db.connections, ['add', 'update', 'remove']);
    wrap(ctx.db, ['importAll']);

    async function push() {
      try {
        const json = await ctx.db.exportAll();
        await fetch('api/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json });
      } catch { /* the shelf is unreachable — the browser copy still holds */ }
    }
  } catch { /* no server here (static hosting) — browser-only, said plainly */ }
  return status;
}
