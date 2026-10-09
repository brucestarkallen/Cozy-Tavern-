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
import { db, keepWhatWasNeverLetGo } from './store.js'; /* M311 */

const HOUSE = '_house';
const LEASH = 120000;
/* M155: a relative fetch inside a worker resolves against the WORKER's own
 * URL (/js/…), not the page's — every books request since M140 had been
 * asking /js/api/books and getting a 404, which is why a second browser
 * never received a thing. The endpoints are built from the worker's
 * location, one level up. */
const api = (path) => new URL('../' + path, self.location.href).toString();

let lastGone = [];
/* M675 — THE LIBRARY'S EPOCH. When a copy is brought back on the device (api/backup/restore) every book there is replaced
 * — by OLDER books. A browser that did not bring the copy back still held the tales as they were, with newer stamps: it
 * never took the restored books (boot pulls only a newer stamp) and its next push laid its old tale back over the copy
 * (the audit, with the real worker, store and server: an older zip restored, the other browser's next boot pulled 0
 * books and kept its 3 pages, and its next push put the 3-page book back on the device). The device now names the
 * library it holds — its epoch, new each time a copy is brought back — in the manifest; this browser keeps the epoch
 * its own books belong to (the room keeps it, in localStorage, and hands it over with every question: EPOCH) and says
 * it with every write. A manifest that names another epoch means this browser's books are another library's: boot
 * says so (restored) and neither pulls nor pushes — the room then makes this browser the device's copy exactly. And a
 * write that still gets out is refused by the device itself (409, stale), and reported the same way.
 * EPOCH is null when the room keeps no epoch (a browser without localStorage): nothing is claimed, and the device
 * answers as it always did. The epoch a look at the list saw (look().epoch) is null when the device does not name one
 * (an older server). */
let EPOCH = null;
/* M675 — AN EPOCH THIS WORKER TOOK FOR THE ROOM'S IS KEPT UNTIL THE ROOM KNOWS IT. When the start takes the device's epoch
 * as this browser's own (a browser new to the device; a device that holds no books, or names no epoch — see boot),
 * the room hears of it only with the start's answer, after every book has been sent. Until then each question of the
 * room's still carries the epoch it remembers — and each question set EPOCH back to that. Made to happen (scene 9 of
 * tests/device_pair.py):
 * the device's folder emptied, the page looking again and sending its books, and a page written meanwhile — the page
 * was refused as "another library's", the rest of the books were refused after it, and the room then read in "the
 * device's copy": the two books that had got there. Two tales that had not yet been sent were let go from this browser,
 * the only place they were. `adopted` says which epoch was taken for which: a question that still carries the old one
 * is answered for the new; the first question that carries anything else ends it. */
let adopted = null; /* { was, is } */
const epochHeader = () => (typeof EPOCH === 'string' ? { 'x-cozy-epoch': EPOCH || '-' } : {});
/* was this write refused because it was made for another epoch of the library? (409 {stale: true} — nothing was written) */
/* (M675: that answer names the epoch the device holds NOW — handed back with the refusal ({ epoch }: '' when the device
 * names none, null when the answer does not say) — so the room knows what is true of the device: a copy was brought
 * back there, or none ever was — sync.js wentStale) */
const refusedAsStale = async (res) => {
  if (!res || res.status !== 409) return false;
  try { const j = await res.json(); return j && j.stale === true ? { epoch: typeof j.epoch === 'string' ? j.epoch : null } : false; } catch (err) { return false; }
};
/* M675 — NOTHING IS SENT TO A HOST THAT IS NOT THE TAVERN'S SERVER. The page runs from GitHub Pages as well as from serve.py
 * (a locked target), and nothing here asked which it was: with no server behind the page every page appended, every book
 * and the house book — the connections and their API keys in it — were POSTed to whatever host served the page, on every
 * change (measured on the build before, against a plain static server: two pages written, thirty seconds — 10 POSTs
 * carrying 76,455 bytes, the house book among them). A book or a page is sent only once the server has shown itself
 * to be the tavern's: its own list of books read as JSON, now (deviceProven) or at some earlier time in this browser
 * (deviceEver — the room keeps that, so a tavern that is merely not running is still sent to, and tried again). A
 * host that never did is asked for that list at most once a minute, and sent nothing. */
let deviceProven = false;
let deviceEver = false;
let probedAt = 0;
async function deviceKnown() {
  if (deviceProven || deviceEver) return true;
  if (Date.now() - probedAt < 60000) return false;
  probedAt = Date.now();
  await manifest();
  return deviceProven;
}
/* M675 — WHAT A REFUSAL SAID, IN THE TAVERN'S OWN WORDS. The tavern refuses with a reason (serve.py: a name it does not
 * answer under — 403 {refused: 'host', host, why}; a page that is not its own — {refused: 'origin'}; a library half-way
 * through a swap — 503 {why}) and nothing here read it: every refusal was "the server did not answer", and the room
 * said so, or said nothing at all. Read from an answer that is not ok; null when it carries no words of its own (a
 * static host's 404 page). */
async function saidBy(res) {
  try {
    const j = await res.json();
    if (!j || typeof j.why !== 'string' || !j.why) return null;
    return { status: res.status, why: j.why, refused: typeof j.refused === 'string' ? j.refused : '', host: typeof j.host === 'string' ? j.host : '' };
  } catch (err) { return null; }
}
/* M675 — ONE LOOK AT THE LIST, AND WHAT THAT LOOK SAW. The epoch the list named was kept in a variable of this worker's
 * own (lastEpoch), written by EVERY look at the list — and set to nothing by a look that failed. A read-in asked the
 * list, read every book (seconds, minutes) and then answered with that variable as it stood by THEN: another look
 * that had failed meanwhile (the four-second leash, a tale opened, the evict timer) had left it null, the room noted no
 * epoch, and the next start took the device for "a copy brought back" and read the whole library in a second time (the
 * second reviewer, made to happen; tests/device_pair.py scene 15). A look now hands back what IT saw —
 * { books, epoch, status, said } — and whoever asked keeps that: books is null when the list was not answered (status
 * 0: no answer at all; otherwise the tavern answered, and `said` is its reason when it gave one); epoch is the list's
 * own, or null when it names none; gone is the list's own tales let go. (lastGone is still this worker's own as well:
 * evict and pullOne read it at once after their look. The start does not — it reads books in between — and takes
 * `gone` from its own look: read from the variable after those seconds, a look that had failed meanwhile had emptied
 * it, and a tale let go in another browser was sent back to the device as "a tale the device lacks" — its tombstone
 * cleared, the tale standing again in every browser; made to happen, tests/device_pair.py scene 15.) */
async function look() {
  try {
    const res = await fetch(api('api/books/list'), { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { books: null, status: res.status, said: await saidBy(res) };
    const j = await res.json();
    if (!j || !Array.isArray(j.books)) return { books: null, status: res.status, said: null }; /* M675: an answer that is not the tavern's list of books (a host that serves its front page for every address) is no answer */
    deviceProven = true;
    lastGone = Array.isArray(j.gone) ? j.gone : [];
    return { books: j.books, gone: lastGone, epoch: typeof j.epoch === 'string' ? j.epoch : null, status: res.status, said: null };
  } catch (err) { lastGone = []; return { books: null, status: 0, said: null }; }
}
async function manifest() { return (await look()).books; }
async function getBook(id) {
  const res = await fetch(api('api/books/one/' + encodeURIComponent(id)), { signal: AbortSignal.timeout(LEASH) });
  if (!res.ok) return null;
  return res.text();
}
async function putBook(id, json, base) {
  const headers = { 'content-type': 'application/json', 'x-cozy-client': CLIENT_ID, ...epochHeader() };
  /* M206: what this browser had already taken in, so the device can tell a
   * page the writer DELETED from one this browser has simply never seen. */
  if (base) headers['x-cozy-base'] = base;
  /* M557: what the device answered (0: it did not answer at all) — a push that did not land is pushed again, and the
   * room is told why when it keeps not landing */
  try {
    const res = await fetch(api('api/books/one/' + encodeURIComponent(id)), { method: 'POST', headers, body: json, signal: AbortSignal.timeout(LEASH) });
    const stale = await refusedAsStale(res);
    if (stale) return { ok: false, status: 409, stale: true, epoch: stale.epoch }; /* M675 */
    if (res.status === 403) { const said = await saidBy(res); if (said && said.refused) return { ok: false, status: 403, said }; } /* M675: turned away by name, or as another page's — the reason goes up */
    return { ok: res.ok, status: res.status };
  } catch (err) { return { ok: false, status: 0 }; }
}
const stampOf = (json) => (/"exportedAt"\s*:\s*"([^"]+)"/.exec(String(json).slice(0, 4096)) || [])[1] || '';
const snapshotAtOf = (json) => (/"snapshotAt"\s*:\s*"([^"]*)"/.exec(String(json).slice(0, 4096)) || [])[1] || ''; /* M507 */

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
async function putPage(id, row, seen = null) {
  try {
    const res = await fetch(api('api/books/page/' + encodeURIComponent(id)), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cozy-client': CLIENT_ID, ...epochHeader() },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(LEASH),
    });
    const stale = await refusedAsStale(res);
    if (stale) { if (seen) { seen.stale = true; seen.epoch = stale.epoch; } return false; } /* M675: made for another epoch of the library — nothing was written */
    if (res.status === 403 && seen) { const said = await saidBy(res); if (said && said.refused) seen.said = said; } /* M675: turned away by name, or as another page's */
    if (!res.ok) return false;
    const answer = await res.json().catch(() => ({}));
    if (seen && answer && answer.whole === true) seen.whole = true; /* M675: the device has no book of this tale at all (serve.py: "send the whole book") */
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

/* M675 — A TALE HELD BY NAME ONLY HAS NO BOOK TO GIVE. A browser holds whole the tale that is open; of every other it keeps
 * the shelf row (`shallow`) and the device keeps the pages. When the device had NO book for such a tale — its folder
 * emptied, a new folder — that row was sent as the tale's book: a book with no pages. The device then "held" the tale,
 * so the browser that did hold it whole never sent it ("the device lacks nothing"), and read the empty book in over
 * its own pages at its next start, or when the tale was opened. Measured on the build before, two browsers and the
 * device's folder emptied: the tale had 2 pages in the second browser — afterwards 0 there and 0 on the device, with
 * no word said (tests/device_pair.py scene 17). An empty book made from a shelf row is not sent: the tale stays a name
 * in this browser, and its pages reach the device from a browser that has them. (A device that DOES hold its pages
 * is asked first, above, as before; pages written here into such a tale are another matter — addedToItsBook, below.) */
async function heldByNameOnly(id, json) {
  try {
    const row = await db.stories.get(id);
    if (!row || !row.shallow) return false;
    return ((JSON.parse(json).messages || []).length === 0);
  } catch (err) { return false; }
}

/* M675 — …AND PAGES WRITTEN INTO SUCH A TALE ARE ADDED TO ITS BOOK, NEVER SENT AS THE BOOK. A tale held by name only opens
 * with no pages when its book cannot be read just then (the tavern not running, or not answering for a moment), and
 * nothing stops a page being written into it. The row then had pages — two, say — so "an empty tale never overwrites a
 * full one" (M188) let it through, and it went to the device as THE BOOK: the device's book of that tale, every page
 * it held, was replaced by the two written here. Measured on the build before (tests/device_pair.py scene 18): a tale
 * of 2 pages on the device, held by name here; opened while the tavern was down, one exchange written, the tavern
 * started again — the device's book held the new exchange and nothing else (the old pages in one .bak1, until the
 * next push), and this browser had never held them. While the device holds a book of the tale, what was written here
 * is added to it page by page (as every page is, M183); pushIds then reads the device's book in — its pages and
 * these — and the tale is whole here. Only when the device has NO book of it is what is here all there is: it goes
 * as the book. Answers 'added'; 'no answer' (the device's list could not be read) or 'not taken' (it would not take
 * a page) — nothing is sent as the book, and it is tried again; or null (not such a tale, or no book of it on the
 * device: pushed as any tale is). */
async function addedToItsBook(id, json, seen) {
  let pages = [];
  try {
    const row = await db.stories.get(id);
    if (!row || !row.shallow) return null;
    pages = JSON.parse(json).messages || [];
  } catch (err) { return null; }
  if (!pages.length) return null;
  const books = await manifest();
  if (!books) return 'no answer';
  if (!books.some((b) => b && b.id === id)) return null;
  for (const m of pages) if (!(await putPage(id, { at: new Date().toISOString(), m }, seen))) return 'not taken';
  return 'added';
}

/* M311: the house is pushed only after it is held against the device's — every row the device holds
 * that this browser lacks and did not itself let go rides as the device has it (store.js
 * keepWhatWasNeverLetGo), and is taken in here. No device copy, or one that cannot be read: the
 * book goes as it is, as before. */
async function houseForPush(json, mine) {
  try {
    const res = await fetch(api('api/books/one/' + HOUSE), { signal: AbortSignal.timeout(LEASH), cache: 'no-store' });
    if (!res.ok) return json;
    const kept = keepWhatWasNeverLetGo(json, await res.text(), mine);
    if (kept.adopt.settings.length || kept.adopt.connections.length) {
      await db.adoptHouseRows(kept.adopt);
      self.postMessage({ kind: 'healed', ids: [HOUSE] });
    }
    return kept.json;
  } catch (err) { return json; }
}

/* M332: A PUSH THAT LANDED IS KNOWN AS THIS BROWSER'S OWN — EVEN IF THE PAGE DIED BEFORE IT COULD SAY SO.
 * Every session ends with a push (pagehide). The device takes the book; the page is gone before the worker can
 * write the book's stamp. So at the NEXT open the device's book looked NEWER than anything this browser had
 * taken in — its own push — and boot pulled the whole tale back (tens of megabytes on the writer's phone),
 * and then RELOADED THE PAGE under his hands: the "sudden refresh" that cut a branch in half. The stamp a push
 * is ABOUT to carry is noted first (one small row, never part of any book); a device book wearing exactly that
 * stamp is this browser's own work come home, and is not pulled. */
const PUSHING = 'booksPushing';
async function notePushing(id, stamp) {
  try {
    const m = { ...((await db.settings.get(PUSHING)) || {}) };
    if (stamp) m[id] = stamp; else delete m[id];
    await db.settings.set(PUSHING, m);
  } catch (err) { /* bookkeeping only */ }
}

async function pushIds(ids, mine = {}, waiting = [], failed = [], refusedOut = [], gone = [], seen = null) {
  const done = [];
  const refused = [];
  for (const id of ids) {
    /* M332: a branch still being made is nobody's book yet (chat.js branchFrom marks it `building` until its last row is in)
     * M430: held back, it is named in the answer (waiting); it goes to the device the moment its last write lets go of
     * `building` (sync.js stories.update) */
    if (id !== HOUSE) { const row = await db.stories.get(id); if (row && row.building && typeof row.building === 'object') { waiting.push(id); continue; } }
    let json = id === HOUSE ? await db.exportHouse() : await db.exportStory(id);
    if (!json) { gone.push(id); continue; } /* M557: a tale no longer here has nothing to push — never tried again */
    if (id === HOUSE) json = await houseForPush(json, (mine && mine[HOUSE]) || []);
    if (id !== HOUSE && await wouldEmptyTheBook(id, json)) { refused.push(id); continue; }
    if (id !== HOUSE && await heldByNameOnly(id, json)) { gone.push(id); continue; } /* M675: nothing of it is here to send — see heldByNameOnly */
    if (id !== HOUSE) {
      /* M675: pages written into a tale held by name only are added to the device's book of it — see addedToItsBook */
      const added = await addedToItsBook(id, json, seen);
      if (added === 'added') { refused.push(id); continue; } /* …and that book is read in whole, below: the tale is whole here */
      if (added) { failed.push({ id, status: seen && seen.stale ? 409 : added === 'no answer' ? 0 : -1, bytes: json.length, ...(seen && seen.said ? { said: seen.said } : {}) }); if (seen && seen.stale) break; continue; }
    }
    const base = id === HOUSE ? '' : await db.settings.get('bookStamp:' + id);
    await notePushing(id, stampOf(json));
    const put = await putBook(id, json, base);
    const landed = put.ok;
    if (landed) { await db.settings.set('bookStamp:' + id, stampOf(json)); done.push(id); } else failed.push({ id, status: put.status, bytes: json.length, ...(put.said ? { said: put.said } : {}) });
    await notePushing(id, null); /* settled either way: the stamp says so now, or the push did not land */
    if (put.stale) { if (seen) { seen.stale = true; seen.epoch = put.epoch; } break; } /* M675: this browser's books are another library's — nothing more of them is sent */
  }
  refusedOut.push(...refused);
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
  const pushing = (await db.settings.get(PUSHING)) || {};
  for (const b of ordered) {
    const mine = stamps[b.id] || '';
    if (!all && mine && (Date.parse(mine) || 0) >= (Date.parse(b.exportedAt) || 0)) continue;
    /* M332: the device's "newer" book is this browser's own last push, landed after the page had gone */
    if (!all && pushing[b.id] && pushing[b.id] === b.exportedAt) { await db.settings.set('bookStamp:' + b.id, pushing[b.id]); await notePushing(b.id, null); continue; }
    const json = await getBook(b.id);
    if (!json) continue;
    const keep = own && Array.isArray(own[b.id]) ? own[b.id] : [];
    /* M507: A PAGE APPENDED MOVES THE BOOK'S STAMP — NOT ITS LEDGER. The device stamps the book with its newest appended
     * page, so a book this browser itself pushed looks newer the moment a page lands; when the whole push that carries
     * the newer ledger has not landed (the app closed within its twenty seconds), the next open pulled the book and
     * importStory wrote the snapshot's OLDER state and record over this browser's newer ones. The served book carries
     * the snapshot's own stamp (serve.py snapshotAt): a snapshot no newer than what this browser last took in or pushed
     * is one it already holds — only its pages are taken. A snapshot pushed by another browser since is newer, and is
     * taken whole, as before. */
    const snapAt = b.id === HOUSE ? '' : (snapshotAtOf(json) || stampOf(json));
    const pagesOnly = !all && b.id !== HOUSE && Boolean(mine) && Boolean(snapAt) && (Date.parse(snapAt) || 0) <= (Date.parse(mine) || 0);
    if (b.id === HOUSE) await db.importHouse(json, { dropMissing: replace, keep }); else await db.importStory(json, { dropMissing: replace, keep, pagesOnly });
    await db.settings.set('bookStamp:' + b.id, stampOf(json));
    if (pushing[b.id]) await notePushing(b.id, null); /* M332: a note of a push that never landed (the device moved on past it) is let go with the pull */
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
  /* M675: the epoch this browser's books belong to, as the room keeps it (a string — '' while no copy was ever brought
   * back — or null: the room keeps none) */
  if ('epoch' in msg) {
    EPOCH = typeof msg.epoch === 'string' ? msg.epoch : null;
    if (adopted) { if (EPOCH === adopted.was) EPOCH = adopted.is; else adopted = null; } /* M675: the room has not heard yet of an epoch taken at the start */
  }
  if (msg.hadDevice === true) deviceEver = true; /* M675: this browser has been answered by the tavern's server before */
  try {
    if (msg.kind === 'push') {
      const waiting = []; const failed = []; const refused = []; const gone = [];
      /* M675: never to a host that is not the tavern's server */
      if (!(await deviceKnown())) { reply({ kind: 'pushed', ok: true, ids: [], waiting, failed, refused, gone, nodevice: true }); return; }
      const seen = { stale: false };
      const ids = await pushIds(Array.isArray(msg.ids) ? msg.ids : [], msg.mine || {}, waiting, failed, refused, gone, seen);
      reply({ kind: 'pushed', ok: true, ids, waiting, failed, refused, gone, ...(seen.stale ? { stale: true, staleEpoch: seen.epoch } : {}) }); /* M557: what did not land, and why */
      return;
    }
    if (msg.kind === 'pull') {
      const sight = await look();
      const books = sight.books;
      /* M675: when the tavern ANSWERED and refused, its own reason goes up with the status (0: it did not answer at all) */
      if (!books) { reply({ kind: 'pulled', ok: false, why: sight.said ? sight.said.why : 'the server did not answer', status: sight.status, ...(sight.said ? { said: sight.said } : {}) }); return; }
      /* M675: a device that holds no books at all says so (`empty`) and names its epoch — the room then knows nothing was
       * brought back there (sync.js mirror) */
      if (!books.length) { reply({ kind: 'pulled', ok: false, empty: true, epoch: sight.epoch, why: 'the device holds no books yet — play a turn in the browser that has them, and wait a moment for the save' }); return; }
      /* M675: A BROWSER IS MADE THE DEVICE'S COPY ONLY WHEN THE DEVICE HOLDS ANOTHER LIBRARY. `exact` lets go of every tale
       * the device does not list — right when a copy was brought back, and the loss of everything not yet sent when
       * the device's books are simply this browser's own, still on their way (a write refused a moment before the
       * start took the device's epoch — see `adopted` — asked for the read-in while the start was sending). When the
       * list names the very epoch this browser's books belong to, there is no other library to become: `same`. */
      if (msg.exact && typeof EPOCH === 'string' && sight.epoch === EPOCH) { reply({ kind: 'pulled', ok: false, same: true, epoch: sight.epoch, why: 'this browser’s books are the device’s own' }); return; }
      /* M675: …nor of a device that names NO epoch (`unnamed`): no copy was ever brought back there (see boot) */
      if (msg.exact && typeof EPOCH === 'string' && sight.epoch === '') { reply({ kind: 'pulled', ok: false, unnamed: true, epoch: '', why: 'no copy was brought back on the device' }); return; }
      const count = await pullBooks(books, { all: true, replace: true });
      /* M510-47: exact — the tales the device does not hold are let go here too, with their pages and rows */
      let letGo = 0;
      if (msg.exact) {
        const onDevice = new Set(books.map((b) => b && b.id).filter((id) => id && id !== HOUSE));
        for (const st of (await db.stories.list()) || []) {
          if (st && st.id && !onDevice.has(st.id)) { await db.stories.remove(st.id); try { await db.settings.delete('bookStamp:' + st.id); } catch (err) { /* fine */ } letGo += 1; }
        }
      }
      reply({ kind: 'pulled', ok: true, count, letGo, epoch: sight.epoch }); /* M675: the epoch of the library that was read in — the one that came with THIS read-in's own list (see look) */
      return;
    }
    /* M182: one book, because the device said it changed. The stamp still
     * decides — a book no newer than ours is left alone, so an echo or a
     * repeat costs nothing. */
    /* M183: a page landed. One line to the device — and if it will not take
     * it, the whole book, exactly as before. */
    if (msg.kind === 'page') {
      /* M430: A BRANCH STILL BEING MADE SENDS NOTHING — not a page, and not the whole-book fallback below. pushIds kept
       * M332's law and this door did not: the first carried page of a branch found no book on the device and pushed the
       * half-made branch WHOLE — pages, no ledger, no record — the very book M332 says must never exist. The pages
       * wait with the rest; the branch goes to the device whole the moment it is whole (sync.js). */
      { const row = await db.stories.get(msg.id); if (row && row.building && typeof row.building === 'object') { reply({ kind: 'paged', ok: false, waiting: true }); return; } }
      if (!(await deviceKnown())) { reply({ kind: 'paged', ok: false, nodevice: true }); return; } /* M675: never to a host that is not the tavern's server */
      const seen = { stale: false };
      let ok = await putPage(msg.id, { at: new Date().toISOString(), m: msg.row }, seen);
      if (seen.stale) { reply({ kind: 'paged', ok: false, stale: true, staleEpoch: seen.epoch }); return; } /* M675: never the whole-book fallback for a library that was replaced */
      if (seen.said) { reply({ kind: 'paged', ok: false, said: seen.said }); return; } /* M675: turned away by name or as another page's — the whole book would be turned away too */
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
        ok = await putPage(msg.id, { at: new Date().toISOString(), m: msg.row }, seen);
        if (!ok && !seen.stale) {
          const again = wholeInFlight.get(msg.id);
          if (again) { await again; ok = await putPage(msg.id, { at: new Date().toISOString(), m: msg.row }, seen); }
        }
        /* M675: never the whole-book fallback for a tale held by name only whose book the device may hold — the page
         * waits for the push, which adds it to that book (addedToItsBook). The fallback is for a tale the device has
         * not met: it says so (`whole`). */
        if (!ok && !seen.stale && !seen.whole) { const row = await db.stories.get(msg.id); if (row && row.shallow) { reply({ kind: 'paged', ok: false }); return; } }
        if (!ok && !seen.stale) {
          const whole = (async () => {
            const json = await db.exportStory(msg.id);
            const put = json ? await putBook(msg.id, json) : { ok: false };
            if (put.stale) { seen.stale = true; seen.epoch = put.epoch; }
            if (put.ok) await db.settings.set('bookStamp:' + msg.id, stampOf(json));
          })().finally(() => { if (wholeInFlight.get(msg.id) === whole) wholeInFlight.delete(msg.id); });
          wholeInFlight.set(msg.id, whole);
          await whole;
        }
      }
      reply({ kind: 'paged', ok, ...(seen.stale ? { stale: true, staleEpoch: seen.epoch } : {}), ...(seen.said ? { said: seen.said } : {}) });
      return;
    }

    if (msg.kind === 'evict') {
      /* M313: let a tale go from this browser — only when the device is PROVEN to hold all of it */
      const books = await manifest();
      const onDevice = books && books.some((b) => b && b.id === msg.id) && !lastGone.includes(msg.id);
      if (!onDevice) { reply({ kind: 'evicted', ok: false, ahead: Boolean(books), why: books ? 'the device has no book for it' : 'the device did not answer' }); return; }
      const json = await getBook(msg.id);
      if (!json) { reply({ kind: 'evicted', ok: false, why: 'the book could not be read' }); return; }
      const proof = await db.provenOnDevice(msg.id, json);
      if (!proof.ok) { reply({ kind: 'evicted', ok: false, ahead: proof.ahead === true, why: proof.why }); return; }
      const pages = await db.evictStory(msg.id);
      reply({ kind: 'evicted', ok: true, pages });
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
      /* M313: `ifNewer` — a tale held here is only taken again when the device's copy has moved past it */
      const pulled = want.length ? await pullBooks(want, { all: msg.ifNewer !== true, replace: msg.replace === true, recent, own: msg.mine || null }) : 0;
      /* M189: its pages are here now — it may be pushed like any other */
      if (pulled) { const st = await db.stories.get(msg.id); if (st && st.shallow) await db.stories.update(msg.id, { shallow: false }); }
      reply({ kind: 'pulledOne', pulled, recent });
      return;
    }

    if (msg.kind === 'boot') {
      if (typeof msg.clientId === 'string' && msg.clientId) CLIENT_ID = msg.clientId;
      const sight = await look();
      const books = sight.books;
      if (!books) { reply({ kind: 'boot', reachable: false, status: sight.status, ...(sight.said ? { said: sight.said } : {}) }); return; } /* M675: and what the tavern said, when it answered and refused */
      const bootEpoch = sight.epoch; /* M675: the epoch that came with THIS list (see look) */
      /* M675: THE DEVICE HOLDS ANOTHER LIBRARY THAN THIS BROWSER'S BOOKS BELONG TO — a copy was brought back since this
       * browser last looked. Nothing is pulled by stamp (the copy's books are OLDER) and nothing is pushed (this
       * browser's tales would be laid back over the copy): the room is told, and makes this browser the device's copy.
       * A browser that never noted an epoch and holds no tale at all is new here: the device's epoch is simply its own. */
      /* M675 — AN EMPTY DEVICE IS NEVER "A COPY BROUGHT BACK". A copy that is brought back holds the house book at the least;
       * a device whose list holds NO books has had nothing brought back — its folder was emptied (Termux's data
       * cleared, a new folder). A browser that knew an epoch from a copy brought back before took that for a restore:
       * it tried to read in a library of nothing, for ever, said "a copy was brought back… the tavern is not answering",
       * wiped the words it was keeping, and nothing it held — by then the only copy — could reach the device (the
       * second reviewer, the real room, worker and server: the device stayed {"books": []}). The device's epoch is
       * simply taken, and what this browser holds goes to the device below, as to any device that lacks it. */
      /* M675 — …NOR IS A DEVICE THAT NAMES NO EPOCH. An epoch is written when a copy is brought back, and at no other time
       * (serve.py): a device that names none has had no copy brought back in the folder it keeps now — whatever
       * books it holds were sent to it by browsers. A browser that remembers an epoch and finds such a device (its
       * folder was emptied, and another browser has since sent it what THAT one held) was made "the device's copy":
       * every tale only this browser held was let go, with no word of it — measured, two browsers and the folder
       * emptied: the second lost the tale it alone held whole (tests/device_pair.py scene 17). It takes the device's
       * epoch and joins it as any browser joins a device: what the device holds newer is read, what it lacks is sent. */
      if (typeof EPOCH === 'string' && bootEpoch !== null && bootEpoch !== EPOCH) {
        const fresh = books.length === 0 || bootEpoch === '' || (msg.epochKnown !== true && ((await db.stories.list()) || []).length === 0);
        if (!fresh) { reply({ kind: 'boot', reachable: true, restored: true, epoch: bootEpoch, pulled: 0, pushed: 0, recent: [] }); return; }
        adopted = { was: EPOCH, is: bootEpoch }; /* (until the room has heard — see `adopted`) */
        EPOCH = bootEpoch;
      }
      /* M189: THE SHELF, NOT EVERY TALE. Boot pulled every book, so opening a
       * browser copied the writer's whole shelf into it — at ten thousand
       * tales that is gigabytes per browser, and a browser is not where a
       * story lives. The house book carries the shelf (titles, order, the
       * connections, the settings) in a few kilobytes; a tale's pages come
       * when the reader opens it. Tales this browser ALREADY holds are still
       * kept up to date at boot, so nothing it has can go stale. */
      /* M313: THE HOUSE AND THE OPEN TALE. Every tale this browser held was refreshed here at every
       * open — with a library, minutes of reading before the first tap. The tale that is open is kept
       * current; any other is looked at when the reader opens it (pullOne, ifNewer). */
      const known = new Set((await db.stories.list()).filter((x) => x && !x.shallow).map((x) => x.id));
      const wanted = books.filter((b) => b && (b.id === HOUSE || (known.has(b.id) && (!msg.active || b.id === msg.active))));
      const recent = [];
      /* M675: `sendOnly` — the room asks only for what the device lacks to be sent (sync.js wentStale): nothing is read in */
      const pulled = msg.sendOnly === true ? 0 : await pullBooks(wanted, { replace: true, recent, own: msg.mine || null });
      /* M160: a tale the device has buried is let go here too — before this,
       * boot saw the book missing from the manifest and PUSHED the local copy
       * back up, so a tale deleted in one browser was resurrected by the next
       * one to open, and re-uploaded for good measure. */
      const buried = new Set(sight.gone || []); /* M675: what THIS start's own look at the list said was let go (see look) */
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
      /* M675: …but never the row of a tale held by name only (pushIds, heldByNameOnly) — left out here, so a device
       * without those books is not asked about each of them at every start */
      const toPush = [];
      for (const st of local) {
        if (have.has(st.id) || buried.has(st.id)) continue;
        if (st.shallow && !(await db.messages.count(st.id).catch(() => 0))) continue;
        toPush.push(st.id);
      }
      if (!have.has(HOUSE) && (local.length || (await db.connections.list()).length)) toPush.push(HOUSE);
      const seen = { stale: false };
      const pushed = toPush.length ? await pushIds(toPush, msg.mine || {}, [], [], [], [], seen) : [];
      reply({ kind: 'boot', reachable: true, pulled: pulled + dropped, pushed: pushed.length, recent, epoch: bootEpoch, ...(seen.stale ? { stale: true, staleEpoch: seen.epoch } : {}) });
      return;
    }
  } catch (err) {
    reply({ kind: 'error', words: String(err && err.message || err) });
  }
};
