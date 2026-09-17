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
async function putBook(id, json, base) {
  const headers = { 'content-type': 'application/json', 'x-cozy-client': CLIENT_ID };
  /* M206: what this browser had already taken in, so the device can tell a
   * page the writer DELETED from one this browser has simply never seen. */
  if (base) headers['x-cozy-base'] = base;
  const res = await fetch(api('api/books/one/' + encodeURIComponent(id)), { method: 'POST', headers, body: json, signal: AbortSignal.timeout(LEASH) });
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
    const base = id === HOUSE ? '' : await db.settings.get('bookStamp:' + id);
    if (await putBook(id, json, base)) { await db.settings.set('bookStamp:' + id, stampOf(json)); done.push(id); }
  }
  if (refused.length) {
    /* the browser is the one that is wrong here — take the device's copy */
    for (const id of refused) { try { await db.settings.delete('bookStamp:' + id); } catch (err) { /* fine */ } }
    const books = await manifest();
    if (books) await pullBooks(books.filter((b) => refused.includes(b.id)), { all: true, replace: true });
    /* M190: and TELL THE ROOM. The pages land in the store from this worker,
     * but the main thread is still holding its own cached (empty) list for
     * that tale — so the reader saw a tale with no pages at all until the
     * next reload, while every page sat safe on the device. */
    self.postMessage({ kind: 'healed', ids: refused });
  }
  return done;
}

/* M293: `replace` — a pull also lets go of the local rows the book does not
 * hold (store.js dropMissing), so a row let go in another browser is let go
 * here; the rows in `own` are the exception. */
/* M293: `recent` — an array the caller passes to learn which pulled books
 * moved on the device within the last ten minutes: another hand is at them
 * (or was, a moment ago), and the room keeps its idle repairs off such a
 * tale while that hand's readers may still be writing it. `own` — per book,
 * the rows this browser changed since its last push (store.js keep): a pull
 * neither writes over them nor lets them go. */
const RECENT_MS = 10 * 60000;
async function pullBooks(books, { all = false, replace = false, recent = null, own = null } = {}) {
  const stamps = await localStamps();
  let count = 0;
  /* the house first, then the tales */
  const ordered = [...books].sort((a, b) => (a.id === HOUSE ? -1 : b.id === HOUSE ? 1 : 0));
  for (const b of ordered) {
    const mine = stamps[b.id] || '';
    if (!all && mine && (Date.parse(mine) || 0) >= (Date.parse(b.exportedAt) || 0)) continue;
    const json = await getBook(b.id);
    if (!json) continue;
    const keep = own && Array.isArray(own[b.id]) ? own[b.id] : [];
    if (b.id === HOUSE) await db.importHouse(json, { dropMissing: replace, keep }); else await db.importStory(json, { dropMissing: replace, keep });
    await db.settings.set('bookStamp:' + b.id, stampOf(json));
    count += 1;
    if (Array.isArray(recent) && b.id !== HOUSE && Date.now() - (Date.parse(b.exportedAt) || 0) < RECENT_MS) recent.push(b.id);
  }
  return count;
}

const wholeInFlight = new Map(); /* M295: tale id -> the whole-book push a page fell back to */
self.onmessage = async (e) => {
  const msg = e.data || {};
  /* M293: EVERY ANSWER NAMES ITS QUESTION. The room matched an answer to a
   * question by its kind alone, and this worker answers questions as they
   * come, side by side — so two pulls in flight both took the first
   * `pulledOne` that came back: the room painted a tale whose pages had not
   * landed, and the pull that then landed painted nothing. An answer carries
   * the question's id back (rid), and the room waits for its own. */
  const rid = msg.rid;
  const reply = (m) => self.postMessage(rid === undefined ? m : { ...m, rid });
  try {
    if (msg.kind === 'push') {
      const ids = await pushIds(Array.isArray(msg.ids) ? msg.ids : []);
      reply({ kind: 'pushed', ok: true, ids });
      return;
    }
    if (msg.kind === 'pull') {
      const books = await manifest();
      if (!books) { reply({ kind: 'pulled', ok: false, why: 'the server did not answer' }); return; }
      if (!books.length) { reply({ kind: 'pulled', ok: false, why: 'the device holds no books yet — play a turn in the browser that has them, and wait a moment for the save' }); return; }
      const count = await pullBooks(books, { all: true, replace: true });
      reply({ kind: 'pulled', ok: true, count });
      return;
    }
    /* M182: one book, because the device said it changed. The stamp still
     * decides — a book no newer than ours is left alone, so an echo or a
     * repeat costs nothing. */
    /* M183: a page landed. One line to the device — and if it will not take
     * it, the whole book, exactly as before. */
    if (msg.kind === 'page') {
      let ok = await putPage(msg.id, { at: new Date().toISOString(), m: msg.row });
      if (!ok) {
        /* M295: ONE WHOLE BOOK FOR A TALE THE DEVICE HAS NOT MET, NOT ONE PER
         * PAGE. A page of a tale with no book on the device fell back to a
         * whole-book push — and a branch of a long tale appends every carried
         * page at once, so a three-hundred-page branch sent three hundred
         * whole books of a growing megabyte each, every one fsynced, before
         * the first had landed (they were all in flight together). The first
         * such page pushes the whole book; the pages behind it wait for that
         * push and then append as pages do. */
        const inFlight = wholeInFlight.get(msg.id);
        if (inFlight) await inFlight;
        /* asked again either way: a refusal sent before the book landed may
         * arrive after it has (the pages of a branch are all in flight at
         * once), and the book is there now */
        ok = await putPage(msg.id, { at: new Date().toISOString(), m: msg.row });
        if (!ok) {
          const again = wholeInFlight.get(msg.id);
          if (again) { await again; ok = await putPage(msg.id, { at: new Date().toISOString(), m: msg.row }); }
        }
        if (!ok) {
          const whole = (async () => {
            const json = await db.exportStory(msg.id);
            if (json && await putBook(msg.id, json)) await db.settings.set('bookStamp:' + msg.id, stampOf(json));
          })().finally(() => { if (wholeInFlight.get(msg.id) === whole) wholeInFlight.delete(msg.id); });
          wholeInFlight.set(msg.id, whole);
          await whole;
        }
      }
      reply({ kind: 'paged', ok });
      return;
    }

    if (msg.kind === 'pullOne') {
      const books = await manifest();
      if (!books) { reply({ kind: 'pulledOne', pulled: 0 }); return; }
      const want = books.filter((b) => b && b.id === msg.id);
      const buried = new Set(lastGone);
      if (buried.has(msg.id)) {
        const st = (await db.stories.list()).find((x) => x && x.id === msg.id);
        if (st) { await db.stories.remove(msg.id); await db.settings.delete('bookStamp:' + msg.id); reply({ kind: 'pulledOne', pulled: 1, gone: true }); return; }
      }
      const recent = [];
      const pulled = want.length ? await pullBooks(want, { all: true, replace: msg.replace === true, recent, own: msg.mine || null }) : 0;
      /* M189: its pages are here now — it may be pushed like any other */
      if (pulled) { const st = await db.stories.get(msg.id); if (st && st.shallow) await db.stories.update(msg.id, { shallow: false }); }
      reply({ kind: 'pulledOne', pulled, recent });
      return;
    }

    if (msg.kind === 'boot') {
      if (typeof msg.clientId === 'string' && msg.clientId) CLIENT_ID = msg.clientId;
      const books = await manifest();
      if (!books) { reply({ kind: 'boot', reachable: false, status: lastManifestStatus }); return; }
      /* M189: THE SHELF, NOT EVERY TALE. Boot pulled every book, so opening a
       * browser copied the writer's whole shelf into it — at ten thousand
       * tales that is gigabytes per browser, and a browser is not where a
       * story lives. The house book carries the shelf (titles, order, the
       * connections, the settings) in a few kilobytes; a tale's pages come
       * when the reader opens it. Tales this browser ALREADY holds are still
       * kept up to date at boot, so nothing it has can go stale. */
      const known = new Set((await db.stories.list()).filter((x) => x && !x.shallow).map((x) => x.id));
      const wanted = books.filter((b) => b && (b.id === HOUSE || known.has(b.id)));
      const recent = [];
      const pulled = await pullBooks(wanted, { replace: true, recent, own: msg.mine || null });
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
      reply({ kind: 'boot', reachable: true, pulled: pulled + dropped, pushed: pushed.length, recent });
      return;
    }
  } catch (err) {
    reply({ kind: 'error', words: String(err && err.message || err) });
  }
};
