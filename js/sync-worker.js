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
async function manifest() {
  try {
    const res = await fetch(api('api/books/list'), { signal: AbortSignal.timeout(4000) });
    lastManifestStatus = res.status;
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j && j.books) ? j.books : [];
  } catch (err) { lastManifestStatus = 0; return null; }
}
async function getBook(id) {
  const res = await fetch(api('api/books/one/' + encodeURIComponent(id)), { signal: AbortSignal.timeout(LEASH) });
  if (!res.ok) return null;
  return res.text();
}
async function putBook(id, json) {
  const res = await fetch(api('api/books/one/' + encodeURIComponent(id)), { method: 'POST', headers: { 'content-type': 'application/json' }, body: json, signal: AbortSignal.timeout(LEASH) });
  return res.ok;
}
const stampOf = (json) => (/"exportedAt"\s*:\s*"([^"]+)"/.exec(String(json).slice(0, 4096)) || [])[1] || '';

async function localStamps() {
  const keys = await db.settings.keys();
  const out = {};
  for (const k of keys) if (k.startsWith('bookStamp:')) out[k.slice(10)] = await db.settings.get(k);
  return out;
}

async function pushIds(ids) {
  const done = [];
  for (const id of ids) {
    const json = id === HOUSE ? await db.exportHouse() : await db.exportStory(id);
    if (!json) continue;
    if (await putBook(id, json)) { await db.settings.set('bookStamp:' + id, stampOf(json)); done.push(id); }
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
    if (msg.kind === 'boot') {
      const books = await manifest();
      if (!books) { self.postMessage({ kind: 'boot', reachable: false, status: lastManifestStatus }); return; }
      const pulled = await pullBooks(books);
      /* push what the device lacks: every local story with no book, and the house when absent */
      const have = new Set(books.map((b) => b.id));
      const local = await db.stories.list();
      const toPush = local.filter((st) => !have.has(st.id)).map((st) => st.id);
      if (!have.has(HOUSE) && (local.length || (await db.connections.list()).length)) toPush.push(HOUSE);
      const pushed = toPush.length ? await pushIds(toPush) : [];
      self.postMessage({ kind: 'boot', reachable: true, pulled, pushed: pushed.length });
      return;
    }
  } catch (err) {
    self.postMessage({ kind: 'error', words: String(err && err.message || err) });
  }
};
