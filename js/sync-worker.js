/* Cozy Tavern — js/sync-worker.js (M140)
 * The books are kept off the main thread. This worker owns the export of
 * the whole store to JSON and the POST to the little server, so a save
 * never freezes the room. It also answers the boot question — pull, push
 * or nothing — by comparing STAMPS, never whole files.
 *   { kind: 'boot', localStamp }  -> { kind: 'boot', move, serverStamp, pulled }
 *   { kind: 'push' }              -> { kind: 'pushed', ok, stamp }
 */
import { db } from './store.js';

async function serverStamp() {
  try {
    const res = await fetch('api/books/stamp', { signal: AbortSignal.timeout(2500) });
    if (res.ok) { const j = await res.json(); return { reachable: true, stamp: (j && j.exportedAt) || '', bytes: (j && j.bytes) || 0 }; }
    if (res.status === 404) {
      /* an older serve.py (not restarted since M140): fall back to reading the
       * file, once — with a long leash; a big book takes seconds to arrive */
      const full = await fetch('api/books', { signal: AbortSignal.timeout(120000) });
      if (full.status === 204) return { reachable: true, stamp: '', bytes: 0 };
      if (!full.ok) return { reachable: false };
      const text = await full.text();
      const m = /"exportedAt"\s*:\s*"([^"]+)"/.exec(text.slice(0, 4096));
      return { reachable: true, stamp: m ? m[1] : '', bytes: text.length, text };
    }
    return { reachable: false };
  } catch (err) { return { reachable: false }; }
}

async function push() {
  const json = await db.exportAll();
  const stamp = (/"exportedAt"\s*:\s*"([^"]+)"/.exec(json.slice(0, 4096)) || [])[1] || new Date().toISOString();
  const res = await fetch('api/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json });
  return { ok: res.ok, stamp };
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.kind === 'push') {
      const r = await push();
      self.postMessage({ kind: 'pushed', ok: r.ok, stamp: r.stamp });
      return;
    }
    if (msg.kind === 'pull') {
      /* M154: the device's books, on demand — the whole file, whatever the stamps say */
      const full = await fetch('api/books', { signal: AbortSignal.timeout(120000) });
      if (full.status === 204) { self.postMessage({ kind: 'pulled', ok: false, why: 'the device holds no books yet' }); return; }
      if (!full.ok) { self.postMessage({ kind: 'pulled', ok: false, why: 'the server did not answer' }); return; }
      const text = await full.text();
      await db.importAll(text);
      const m = /"exportedAt"\s*:\s*"([^"]+)"/.exec(text.slice(0, 4096));
      self.postMessage({ kind: 'pulled', ok: true, stamp: m ? m[1] : '' });
      return;
    }
    if (msg.kind === 'boot') {
      const s = await serverStamp();
      if (!s.reachable) { self.postMessage({ kind: 'boot', move: 'none', reachable: false }); return; }
      const localStamp = String(msg.localStamp || '');
      const localHas = Boolean(msg.localHasStories);
      const at = Date.parse(localStamp) || 0;
      const bt = Date.parse(s.stamp) || 0;
      let move = 'none';
      if (s.stamp && !localHas) move = 'pull';
      else if (s.stamp && localHas) move = bt > at ? 'pull' : (at > bt ? 'push' : 'none');
      else if (!s.stamp && localHas) move = 'push';
      let pulled = false;
      if (move === 'pull') {
        const text = s.text || await (await fetch('api/books')).text();
        await db.importAll(text);
        pulled = true;
      }
      let stamp = s.stamp;
      if (move === 'push') { const r = await push(); stamp = r.stamp; }
      self.postMessage({ kind: 'boot', move, reachable: true, serverStamp: stamp, pulled });
      return;
    }
  } catch (err) {
    self.postMessage({ kind: 'error', words: String(err && err.message || err) });
  }
};
