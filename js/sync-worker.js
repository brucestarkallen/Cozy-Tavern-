/* Cozy Tavern — js/sync-worker.js (M140, M155)
 * The books are kept off the main thread, ONE FILE PER TALE on the device
 * (SillyTavern's shape): api/books/one/<storyId> for each story, and
 * api/books/one/_house for what is nobody's tale (connections, the stories
 * list, the house settings). Boot reads the manifest (api/books/list) and
 * pulls every book the browser lacks or that is newer than its stamp;
 * pushes carry only the books that changed.
 *   { kind: 'boot' }                 -> { kind: 'boot', reachable, pulled: n, pushed: n }
 *   { kind: 'push', ids: [...] }     -> { kind: 'pushed', ok, ids }
 *   { kind: 'pull' }                 -> { kind: 'pulled', ok, count }
 */
import { db } from './store.js';

const HOUSE = '_house';
const LEASH = 120000;
/* M155: a relative fetch inside a worker resolves against the WORKER's own
 * URL (/js/…), not the page's — every books request since M140 had been
 * asking /js/api/books and getting a 404, which is why a second browser
 * never received a thing. The endpoints are built from the worker's
 * location, one level up. */
const api = (path) => new URL('../' + path, self.location.href).toString();

let lastManifestStatus = 0;
let lastGone = [];
async function manifest() {
  try {
    const res = await fetch(api('api/books/list'), { signal: AbortSignal.timeout(4000) });
    lastManifestStatus = res.status;
    if (!res.ok) return null;
    const j = await res.json();
    lastGone = Array.isArray(j && j.gone) ? j.gone : [];
    return Array.isArray(j && j.books) ? j.books : [];
  } catch (err) { lastManifestStatus = 0; lastGone = []; return null; }
}
async function getBook(id) {
  const res = await fetch(api('api/books/one/' + encodeURIComponent(id)), { signal: AbortSignal.timeout(LEASH) });
  if (!res.ok) return null;
  return res.text();
}
async function putBook(id, json) {
  const res = await fetch(api('api/books/one/' + encodeURIComponent(id)), { method: 'POST', headers: { 'content-type': 'application/json', 'x-cozy-client': CLIENT_ID }, body: json, signal: AbortSignal.timeout(LEASH) });
  return res.ok;
}
const stampOf = (json) => (/"exportedAt"\s*:\s*"([^"]+)"/.exec(String(json).slice(0, 4096)) || [])[1] || '';

async function localStamps() {
  const keys = await db.settings.keys();
  const out = {};
  for (const k of keys) if (k.startsWith('bookStamp:')) out[k.slice(10)] = await db.settings.get(k);
  return out;
}

/* M182: THIS BROWSER'S OWN NAME. Every push carries it, the server echoes it
 * on the change it announces, and a browser skips its own — pulling back a
 * write you just made would replace your newer pages with what you had just
 * sent, which is a loss, not a refresh. */
let CLIENT_ID = '';
export function clientId() { return CLIENT_ID; }

/* M183: one page, appended. Returns false when the device wants the whole
 * book instead (it has no snapshot for this tale yet), so the caller falls
 * back to the push it always did — a page must never end up in a log with
 * nothing under it. */
async function putPage(id, row) {
  try {
    const res = await fetch(api('api/books/page/' + encodeURIComponent(id)), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cozy-client': CLIENT_ID },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(LEASH),
    });
    if (!res.ok) return false;
    const answer = await res.json().catch(() => ({}));
    return answer && answer.ok === true;
  } catch (err) { return false; }
}

/* M188: AN EMPTY TALE NEVER OVERWRITES A FULL ONE. This is the one way a
 * writer's pages could be destroyed in a second: a browser that holds a
 * story row with no pages under it pushes that story, and the device's copy
 * — every page of it — is replaced by nothing. It can happen from a failed
 * import, a half-finished pull, a story row that arrived without its book.
 * A push that would REMOVE pages from the device is refused and the tale is
 * pulled back instead. Nothing legitimate is blocked: a genuinely new tale
 * has no book on the device to empty, and a writer deleting pages one by one
 * still leaves pages behind. Only "all of them, at once, from a browser that
 * has none" is stopped, which is never something a writer did. */
async function wouldEmptyTheBook(id, json) {
  let mine = 0;
  try { mine = (JSON.parse(json).messages || []).length; } catch (err) { return false; }
  if (mine > 0) return false;
  try {
    const res = await fetch(api('api/books/one/' + encodeURIComponent(id)), { signal: AbortSignal.timeout(LEASH) });
    if (!res.ok) return false;                       /* no book there: nothing to empty */
    const theirs = ((await res.json()).messages || []).length;
    return theirs > 0;
  } catch (err) { return true; }                     /* cannot tell: refuse, and keep the pages */
}

async function pushIds(ids) {
  const done = [];
  const refused = [];
  for (const id of ids) {
    const json = id === HOUSE ? await db.exportHouse() : await db.exportStory(id);
    if (!json) continue;
    if (id !== HOUSE && await wouldEmptyTheBook(id, json)) { refused.push(id); continue; }
    if (await putBook(id, json)) { await db.settings.set('bookStamp:' + id, stampOf(json)); done.push(id); }
  }
  if (refused.length) {
    /* the browser is the one that is wrong here — take the device's copy */
    for (const id of refused) { try { await db.settings.delete('bookStamp:' + id); } catch (err) { /* fine */ } }
    const books = await manifest();
    if (books) await pullBooks(books.filter((b) => refused.includes(b.id)), { all: true });
    /* M190: and TELL THE ROOM. The pages land in the store from this worker,
     * but the main thread is still holding its own cached (empty) list for
     * that tale — so the reader saw a tale with no pages at all until the
     * next reload, while every page sat safe on the device. */
    self.postMessage({ kind: 'healed', ids: refused });
  }
  return done;
}

async function pullBooks(books, { all = false } = {}) {
  const stamps = await localStamps();
  let count = 0;
  /* the house first, then the tales */
  const ordered = [...books].sort((a, b) => (a.id === HOUSE ? -1 : b.id === HOUSE ? 1 : 0));
  for (const b of ordered) {
    const mine = stamps[b.id] || '';
    if (!all && mine && (Date.parse(mine) || 0) >= (Date.parse(b.exportedAt) || 0)) continue;
    const json = await getBook(b.id);
    if (!json) continue;
    if (b.id === HOUSE) await db.importHouse(json); else await db.importStory(json);
    await db.settings.set('bookStamp:' + b.id, stampOf(json));
    count += 1;
  }
  return count;
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.kind === 'push') {
      const ids = await pushIds(Array.isArray(msg.ids) ? msg.ids : []);
      self.postMessage({ kind: 'pushed', ok: true, ids });
      return;
    }
    if (msg.kind === 'pull') {
      const books = await manifest();
      if (!books) { self.postMessage({ kind: 'pulled', ok: false, why: 'the server did not answer' }); return; }
      if (!books.length) { self.postMessage({ kind: 'pulled', ok: false, why: 'the device holds no books yet — play a turn in the browser that has them, and wait a moment for the save' }); return; }
      const count = await pullBooks(books, { all: true });
      self.postMessage({ kind: 'pulled', ok: true, count });
      return;
    }
    /* M182: one book, because the device said it changed. The stamp still
     * decides — a book no newer than ours is left alone, so an echo or a
     * repeat costs nothing. */
    /* M183: a page landed. One line to the device — and if it will not take
     * it, the whole book, exactly as before. */
    if (msg.kind === 'page') {
      const ok = await putPage(msg.id, { at: new Date().toISOString(), m: msg.row });
      if (!ok) {
        const json = await db.exportStory(msg.id);
        if (json && await putBook(msg.id, json)) await db.settings.set('bookStamp:' + msg.id, stampOf(json));
      }
      self.postMessage({ kind: 'paged', ok });
      return;
    }

    if (msg.kind === 'pullOne') {
      const books = await manifest();
      if (!books) { self.postMessage({ kind: 'pulledOne', pulled: 0 }); return; }
      const want = books.filter((b) => b && b.id === msg.id);
      const buried = new Set(lastGone);
      if (buried.has(msg.id)) {
        const st = (await db.stories.list()).find((x) => x && x.id === msg.id);
        if (st) { await db.stories.remove(msg.id); await db.settings.delete('bookStamp:' + msg.id); self.postMessage({ kind: 'pulledOne', pulled: 1, gone: true }); return; }
      }
      const pulled = want.length ? await pullBooks(want, { all: true }) : 0;
      /* M189: its pages are here now — it may be pushed like any other */
      if (pulled) { const st = await db.stories.get(msg.id); if (st && st.shallow) await db.stories.update(msg.id, { shallow: false }); }
      self.postMessage({ kind: 'pulledOne', pulled });
      return;
    }

    if (msg.kind === 'boot') {
      if (typeof msg.clientId === 'string' && msg.clientId) CLIENT_ID = msg.clientId;
      const books = await manifest();
      if (!books) { self.postMessage({ kind: 'boot', reachable: false, status: lastManifestStatus }); return; }
      /* M189: THE SHELF, NOT EVERY TALE. Boot pulled every book, so opening a
       * browser copied the writer's whole shelf into it — at ten thousand
       * tales that is gigabytes per browser, and a browser is not where a
       * story lives. The house book carries the shelf (titles, order, the
       * connections, the settings) in a few kilobytes; a tale's pages come
       * when the reader opens it. Tales this browser ALREADY holds are still
       * kept up to date at boot, so nothing it has can go stale. */
      const known = new Set((await db.stories.list()).filter((x) => x && !x.shallow).map((x) => x.id));
      const wanted = books.filter((b) => b && (b.id === HOUSE || known.has(b.id)));
      const pulled = await pullBooks(wanted);
      /* M160: a tale the device has buried is let go here too — before this,
       * boot saw the book missing from the manifest and PUSHED the local copy
       * back up, so a tale deleted in one browser was resurrected by the next
       * one to open, and re-uploaded for good measure. */
      const buried = new Set(lastGone);
      let dropped = 0;
      if (buried.size) {
        for (const st of await db.stories.list()) {
          if (!buried.has(st.id)) continue;
          await db.stories.remove(st.id);
          await db.settings.delete('bookStamp:' + st.id);
          dropped += 1;
        }
      }
      /* push what the device lacks: every local story with no book, and the house when absent */
      const have = new Set(books.map((b) => b.id));
      const local = await db.stories.list();
      const toPush = local.filter((st) => !have.has(st.id) && !buried.has(st.id)).map((st) => st.id);
      if (!have.has(HOUSE) && (local.length || (await db.connections.list()).length)) toPush.push(HOUSE);
      const pushed = toPush.length ? await pushIds(toPush) : [];
      self.postMessage({ kind: 'boot', reachable: true, pulled: pulled + dropped, pushed: pushed.length });
      return;
    }
  } catch (err) {
    self.postMessage({ kind: 'error', words: String(err && err.message || err) });
  }
};
