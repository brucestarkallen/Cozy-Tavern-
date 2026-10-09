/* Cozy Tavern — js/sent.js
 * M347: WHAT THE STORYTELLER WAS SENT, WORD FOR WORD, KEPT WITH THE PAGE. The receipt kept each part's name and size and
 * never its words, so "What the storyteller saw" could not show them. Now every page keeps, beside its receipt:
 *   - each part's words as the assembler made them (the Normal view: tap a part, read it, copy it);
 *   - the request exactly as the provider sent it (the Raw view: the system, user and assistant messages and the settings,
 *     in the order the model received them).
 * It lives in its own database (cozytavern.sent.v1) — never in a backup, never in the book sync, never in the main
 * database's version — because a request can be the size of the whole story. Long texts are cut into pieces at paragraph
 * breaks chosen by their own content and each piece is kept once per tale, so the thousand pages that ride every request
 * are stored once, not once per page. The newest KEEP_PAGES pages of each tale keep their words; older ones let go.
 * Nothing here may ever stop a page: every failure is swallowed. */

const DB_NAME = 'cozytavern.sent.v1';
const PIECES = 'sentChunks';
const PAGES = 'sentPages';
export const KEEP_PAGES = 200;     /* the newest pages of each tale whose words are kept */
const PRUNE_BATCH = 20;            /* let go in batches, not one per page */
const INLINE_BELOW = 512;          /* a string shorter than this stays where it is */
const PIECE_MIN = 1024;
const PIECE_MAX = 16384;
const TEXT_KEY = '$cozyText';

let dbPromise = null;
function openSent() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(PIECES)) d.createObjectStore(PIECES, { keyPath: 'k' }).createIndex('byStory', 'storyId', { unique: false });
      if (!d.objectStoreNames.contains(PAGES)) d.createObjectStore(PAGES, { keyPath: 'id' }).createIndex('byStory', 'storyId', { unique: false });
    };
    req.onsuccess = () => {
      const d = req.result;
      if (d && typeof d.addEventListener === 'function') d.addEventListener('versionchange', () => { try { d.close(); } catch (err) { /* closed */ } dbPromise = null; });
      resolve(d);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function done(req) { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
function finished(tx) { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('aborted')); }); }

/* cyrb53 — a fast 53-bit hash; with the length beside it, two different pieces never share a key in practice */
export function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/* Pieces cut where the text itself says: after a paragraph whose own hash falls on the mark (once a piece is long
 * enough), or at the size limit — so the same pages cut the same way in every request, wherever they sit in it. */
/* M507: A HASH IS COMPUTED ONCE PER TEXT. Every page of the tale rides every request, and keeping the words (M347)
 * hashed the whole request again on every send — 130k tokens of pages that had not changed. The pieces a text cuts into
 * and each piece's hash are remembered by the text itself (a Map keyed by the string: V8 hashes a string once and keeps
 * it), so a page seen before costs a look-up; bounded, the oldest let go. */
const PIECES_OF = new Map();
const HASHES = new Map();
const hashOf = (piece) => {
  let h = HASHES.get(piece);
  if (h === undefined) {
    h = hash53(piece);
    if (HASHES.size > 6000) HASHES.clear();
    HASHES.set(piece, h);
  }
  return h;
};
export function piecesOf(text) {
  const s = String(text || '');
  if (!s) return [];
  const hit = PIECES_OF.get(s);
  if (hit) return hit.slice();
  const paras = s.split(/(?<=\n\n)/);
  const out = [];
  let cur = '';
  for (const p of paras) {
    cur += p;
    if (cur.length >= PIECE_MAX || (cur.length >= PIECE_MIN && hashOf(p) % 4 === 0)) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  if (PIECES_OF.size > 3000) PIECES_OF.clear();
  PIECES_OF.set(s, out.slice());
  return out;
}
const pieceKey = (storyId, piece) => storyId + '|' + hashOf(piece).toString(36) + '|' + piece.length;

/* the keys of every piece a tale already keeps — read once a session, then kept current */
const knownPieces = new Map();
async function piecesKnown(d, storyId) {
  if (knownPieces.has(storyId)) return knownPieces.get(storyId);
  const keys = await done(d.transaction(PIECES, 'readonly').objectStore(PIECES).index('byStory').getAllKeys(storyId));
  const set = new Set(keys || []);
  knownPieces.set(storyId, set);
  return set;
}

function encodeWith(enc) {
  const walk = (v) => {
    if (typeof v === 'string') return v.length >= INLINE_BELOW ? { [TEXT_KEY]: enc(v) } : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; }
    return v;
  };
  return walk;
}
function decodeWith(text) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      if (Array.isArray(v[TEXT_KEY]) && Object.keys(v).length === 1) return text(v[TEXT_KEY]);
      const o = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k]);
      return o;
    }
    return v;
  };
  return walk;
}

export function newSentId() {
  const r = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? Array.from(crypto.getRandomValues(new Uint32Array(2))).map((n) => n.toString(36)).join('') : Math.random().toString(36).slice(2);
  return 'snt_' + Date.now().toString(36) + '_' + r;
}

/* A page's words still on their way to the shelf — a sheet opened the moment the page lands waits for them, rather
 * than saying they were never kept. */
const pendingKeeps = new Map();

/* Keep one page's words: its parts [{name, text}] and its requests [{url, body}]. Returns true when kept. */
export function keepSent(args = {}) {
  const p = keepSentNow(args);
  if (args && args.id) {
    pendingKeeps.set(args.id, p);
    p.finally(() => { if (pendingKeeps.get(args.id) === p) pendingKeeps.delete(args.id); });
  }
  return p;
}
async function keepSentNow({ id, storyId, slots = [], requests = [] } = {}) {
  try {
    if (!id || !storyId) return false;
    const d = await openSent();
    const known = await piecesKnown(d, storyId);
    const fresh = new Map();
    const enc = (text) => piecesOf(text).map((p) => { const k = pieceKey(storyId, p); if (!known.has(k) && !fresh.has(k)) fresh.set(k, p); return k; });
    const record = {
      id, storyId, ts: Date.now(), v: 1,
      slots: (Array.isArray(slots) ? slots : []).map((s) => ({ name: String((s && s.name) || ''), t: s && typeof s.text === 'string' && s.text ? enc(s.text) : [] })),
      requests: (Array.isArray(requests) ? requests : []).filter((r) => r && r.body).map((r) => ({ url: String(r.url || ''), body: encodeWith(enc)(r.body) })),
    };
    const tx = d.transaction([PIECES, PAGES], 'readwrite');
    const pieces = tx.objectStore(PIECES);
    for (const [k, t] of fresh) pieces.put({ k, storyId, t });
    tx.objectStore(PAGES).put(record);
    await finished(tx);
    for (const k of fresh.keys()) known.add(k);
    await pruneSent(storyId);
    pushSentLater(storyId); /* M671: and to the device, in a few minutes */
    return true;
  } catch (err) {
    return false;
  }
}

/* One page's words back, whole: {slots: [{name, text}], requests: [{url, body}]}, or null when none were kept. */
export async function loadSent(id) {
  try {
    if (!id) return null;
    if (pendingKeeps.has(id)) await pendingKeeps.get(id);
    const d = await openSent();
    const record = await done(d.transaction(PAGES, 'readonly').objectStore(PAGES).get(id));
    if (!record) return null;
    const need = new Set();
    for (const s of record.slots || []) for (const k of s.t || []) need.add(k);
    const collect = (v) => {
      if (Array.isArray(v)) { v.forEach(collect); return; }
      if (v && typeof v === 'object') { if (Array.isArray(v[TEXT_KEY])) v[TEXT_KEY].forEach((k) => need.add(k)); else Object.values(v).forEach(collect); }
    };
    for (const r of record.requests || []) collect(r.body);
    const store = d.transaction(PIECES, 'readonly').objectStore(PIECES);
    const got = new Map();
    await Promise.all([...need].map(async (k) => { const row = await done(store.get(k)); got.set(k, row ? row.t : null); }));
    if ([...got.values()].some((t) => t === null)) return null; /* a piece gone: better nothing than words that are not what was sent */
    const text = (keys) => keys.map((k) => got.get(k)).join('');
    return {
      ts: record.ts,
      slots: (record.slots || []).map((s) => ({ name: s.name, text: text(s.t || []) })),
      requests: (record.requests || []).map((r) => ({ url: r.url, body: decodeWith(text)(r.body) })),
    };
  } catch (err) {
    return null;
  }
}

/* The newest KEEP_PAGES pages of a tale keep their words; past that, the oldest go in a batch, and every piece no kept
 * page still uses goes with them. */
/* M675 — NEVER A PAGE THE DEVICE HAS NOT GOT. The browser lets go of all but the newest pages because the device keeps them
 * all — but the letting-go never asked whether the device had them: with the tavern's server down for a long sitting
 * (Termux reaped), the oldest pages told since the last push were let go here and had never reached it (the audit, made
 * to happen: 230 pages told while the device did not answer — 188 arrived, 42 were in neither place). Where this browser
 * has a device (it answers now, or has answered before), a page goes only once the device is known to hold it; what it
 * has not got waits here — up to KEEP_HARD pages a tale, past which the oldest go whatever the device holds (a browser
 * must not grow without end for a device that never comes back). With no device at all (a static host) the newest
 * KEEP_PAGES are kept, as before. */
export const KEEP_HARD = KEEP_PAGES * 3;
export async function pruneSent(storyId) {
  try {
    const d = await openSent();
    const all = await done(d.transaction(PAGES, 'readonly').objectStore(PAGES).index('byStory').getAll(storyId));
    if (!Array.isArray(all) || all.length <= KEEP_PAGES) return 0;
    all.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const past = all.length - (KEEP_PAGES - PRUNE_BATCH); /* how many of the oldest are past the room */
    let onDevice = null; /* the pages the device is known to hold; null: this browser has no device */
    if ((await deviceThere()) || hadDevice()) {
      let held = deviceHolds.get(storyId) || null;
      if (!held) { try { held = await whatDeviceHolds(storyId); } catch (err) { held = null; } }
      onDevice = held && held.pages ? held.pages : new Set(); /* it did not answer: nothing is known to be there */
    }
    const hard = all.length - KEEP_HARD;
    const doomedIds = new Set(all.slice(0, past).filter((r, i) => !onDevice || onDevice.has(r.id) || i < hard).map((r) => r.id));
    if (!doomedIds.size) return 0;
    const used = new Set();
    const collect = (v) => {
      if (Array.isArray(v)) { v.forEach(collect); return; }
      if (v && typeof v === 'object') { if (Array.isArray(v[TEXT_KEY])) v[TEXT_KEY].forEach((k) => used.add(k)); else Object.values(v).forEach(collect); }
    };
    for (const r of all) { if (doomedIds.has(r.id)) continue; for (const s of r.slots || []) for (const k of s.t || []) used.add(k); for (const q of r.requests || []) collect(q.body); }
    const known = await piecesKnown(d, storyId);
    const tx = d.transaction([PIECES, PAGES], 'readwrite');
    for (const id of doomedIds) tx.objectStore(PAGES).delete(id);
    const gone = [...known].filter((k) => !used.has(k));
    for (const k of gone) tx.objectStore(PIECES).delete(k);
    await finished(tx);
    for (const k of gone) known.delete(k);
    return doomedIds.size;
  } catch (err) {
    return 0;
  }
}

/* A tale that is gone takes its kept words with it (run at boot, with the store's own sweep). */
export async function sweepSent(livingIds) {
  try {
    const living = new Set(livingIds || []);
    const d = await openSent();
    const pages = await done(d.transaction(PAGES, 'readonly').objectStore(PAGES).getAll());
    const pieceKeys = await done(d.transaction(PIECES, 'readonly').objectStore(PIECES).getAllKeys());
    const tx = d.transaction([PIECES, PAGES], 'readwrite');
    let n = 0;
    for (const r of pages || []) if (r && !living.has(r.storyId)) { tx.objectStore(PAGES).delete(r.id); n += 1; }
    for (const k of pieceKeys || []) { const sid = String(k).split('|')[0]; if (!living.has(sid)) { tx.objectStore(PIECES).delete(k); knownPieces.delete(sid); } }
    await finished(tx);
    return n;
  } catch (err) {
    return 0;
  }
}

/* how much a tale keeps: its pages, its pieces, and their characters */
export async function sentStats(storyId) {
  try {
    const d = await openSent();
    const pages = await done(d.transaction(PAGES, 'readonly').objectStore(PAGES).index('byStory').getAll(storyId));
    const pieces = await done(d.transaction(PIECES, 'readonly').objectStore(PIECES).index('byStory').getAll(storyId));
    return { pages: (pages || []).length, pieces: (pieces || []).length, chars: (pieces || []).reduce((n, p) => n + ((p && p.t) || '').length, 0) };
  } catch (err) {
    return { pages: 0, pieces: 0, chars: 0 };
  }
}

/* M671 — HIS: "wait, is 'what the storyteller saw' in the backup? The raw data, everything — I need it." It was not: these words
 * live in a database of their own, and M347 kept it out of every backup on purpose (a request can be the size of the
 * story). He takes his copy from the device, which never had them at all — and the browser lets go of all but the
 * newest KEEP_PAGES pages of a tale. Now THE DEVICE KEEPS EVERY PAGE'S WORDS, for good (see "to the device and back"
 * below): they go to it a few minutes after a page is told, and all at once when he takes a copy; the device's zip
 * therefore holds them, a copy brought back restores them, and a page this browser no longer holds — or never held —
 * is read from the device. The browser's own one-file backup carries what the browser holds (exportAllSent /
 * importAllSent); a tale's can be read out and written back whole (exportSent / importSent). Nothing here may ever
 * stop a page. */
const SENT_KIND = 'cozytavern.sent';
export async function exportSent(storyId) {
  try {
    if (!storyId) return null;
    const d = await openSent();
    const pages = await done(d.transaction(PAGES, 'readonly').objectStore(PAGES).index('byStory').getAll(storyId));
    if (!Array.isArray(pages) || !pages.length) return null;
    const pieces = await done(d.transaction(PIECES, 'readonly').objectStore(PIECES).index('byStory').getAll(storyId));
    return { kind: SENT_KIND, v: 1, storyId, pages, pieces: (pieces || []).map((p) => ({ k: p.k, t: p.t })) };
  } catch (err) {
    return null;
  }
}
/* written back: every piece and page of that tale in the file. `replace` lets go of what the browser held for the tale
 * first (a copy brought back is the copy); otherwise what is here stays and the file fills in what is missing. */
export async function importSent(data, { replace = false } = {}) {
  try {
    if (!data || data.kind !== SENT_KIND || typeof data.storyId !== 'string' || !data.storyId || !Array.isArray(data.pages) || !Array.isArray(data.pieces)) return 0;
    const storyId = data.storyId;
    const d = await openSent();
    if (replace) {
      const oldPages = await done(d.transaction(PAGES, 'readonly').objectStore(PAGES).index('byStory').getAllKeys(storyId));
      const oldPieces = await done(d.transaction(PIECES, 'readonly').objectStore(PIECES).index('byStory').getAllKeys(storyId));
      const wipe = d.transaction([PIECES, PAGES], 'readwrite');
      for (const k of oldPages || []) wipe.objectStore(PAGES).delete(k);
      for (const k of oldPieces || []) wipe.objectStore(PIECES).delete(k);
      await finished(wipe);
    }
    const tx = d.transaction([PIECES, PAGES], 'readwrite');
    for (const p of data.pieces) if (p && typeof p.k === 'string' && typeof p.t === 'string' && p.k.startsWith(storyId + '|')) tx.objectStore(PIECES).put({ k: p.k, storyId, t: p.t });
    let n = 0;
    for (const r of data.pages) if (r && typeof r.id === 'string' && r.id && r.storyId === storyId) { tx.objectStore(PAGES).put(r); n += 1; }
    await finished(tx);
    knownPieces.delete(storyId);
    return n;
  } catch (err) {
    return 0;
  }
}
/* everything the browser keeps, for its own one-file backup */
export async function exportAllSent() {
  try {
    const d = await openSent();
    const pages = await done(d.transaction(PAGES, 'readonly').objectStore(PAGES).getAll());
    if (!Array.isArray(pages) || !pages.length) return null;
    const pieces = await done(d.transaction(PIECES, 'readonly').objectStore(PIECES).getAll());
    return { kind: SENT_KIND + '.all', v: 1, pages, pieces: pieces || [] };
  } catch (err) {
    return null;
  }
}
export async function clearSent() {
  try {
    const d = await openSent();
    const tx = d.transaction([PIECES, PAGES], 'readwrite');
    tx.objectStore(PIECES).clear();
    tx.objectStore(PAGES).clear();
    await finished(tx);
    knownPieces.clear();
    forgetDevice();
    return true;
  } catch (err) {
    return false;
  }
}
export async function importAllSent(data) {
  try {
    if (!data || data.kind !== SENT_KIND + '.all' || !Array.isArray(data.pages) || !Array.isArray(data.pieces)) return 0;
    await clearSent();
    const d = await openSent();
    const tx = d.transaction([PIECES, PAGES], 'readwrite');
    for (const p of data.pieces) if (p && typeof p.k === 'string' && typeof p.t === 'string' && typeof p.storyId === 'string') tx.objectStore(PIECES).put({ k: p.k, storyId: p.storyId, t: p.t });
    let n = 0;
    for (const r of data.pages) if (r && typeof r.id === 'string' && r.id && typeof r.storyId === 'string') { tx.objectStore(PAGES).put(r); n += 1; }
    await finished(tx);
    return n;
  } catch (err) {
    return 0;
  }
}

/* ---- to the device and back ----
 * THE DEVICE KEEPS THEM ALL; THE BROWSER KEEPS THE NEWEST. A tale's file on the device (sent/<tale>.ndjson) is an archive
 * that only grows: one line a piece of text or a page's record. The browser sends only what the device does not have
 * yet (it asks once a session what the device holds), so a push after a page is that page's new words, not the tale's
 * whole history — and the device's file is never rewritten. A page whose words this browser has let go (it keeps the
 * newest KEEP_PAGES) is read from the device, that one page alone. */
const sentUrl = (storyId, query = '') => new URL('api/books/sent/' + encodeURIComponent(storyId) + query, document.baseURI);
const onAPage = () => typeof document !== 'undefined' && typeof fetch === 'function' && /^https?:/.test(String(document.baseURI || ''));
const deviceHolds = new Map(); /* storyId -> { pages: Set, pieces: Set }, once asked */
const pulledFromDevice = new Set();
const pushedMark = new Map();

/* M675 — IS THERE A TAVERN'S SERVER BEHIND THIS PAGE AT ALL? Nothing here asked. "What does the device hold of this tale?"
 * was answered 404 by a host that is no tavern (GitHub Pages — a locked target), 404 was read as "no archive yet", and
 * the tale's words were then POSTed to that host: the storyteller's whole request — the story — sent to a web server that
 * is not the provider he chose, on every "Take a copy" and four minutes after every page (the audit, against a plain
 * static server: 5 GETs and 5 POSTs carrying 266,727 bytes). Now nothing of a tale leaves this page until the server has
 * shown itself to be the tavern's: its own list of books, read as JSON. A host that does not is asked again at most once
 * a minute, with that one GET and nothing else. */
let deviceProof = { at: 0, ok: false, refused: false };
const HAD_DEVICE = 'cozy.device'; /* (one name with js/sync.js: the tavern's server has answered this browser before) */
const hadDevice = () => { try { return typeof localStorage !== 'undefined' && localStorage.getItem(HAD_DEVICE) === '1'; } catch (err) { return false; } };
/* M675: `fresh` — look NOW, whatever was found a moment ago. A look that failed is remembered for a minute (a host that
 * is no tavern is not asked on every page); "Take a copy" and "Bring a copy back", pressed inside that minute — the
 * tavern just started again — were answered "no device" from memory, sent nothing and said nothing (the second
 * reviewer: 0 requests, 0 ms). What he asks for by hand is looked for afresh (pushAllSentToDevice). */
/* M675: …and `refused` — the tavern ANSWERED that look, and turned this page away by name (serve.py: 403 { refused }; a
 * browser opened under an address the tavern was not started for). That is neither "no tavern's server behind this page"
 * nor "the tavern is not answering", and whoever asks is told which it is (loadSentOrPull, sendSentOf). */
async function deviceThere(fresh = false) {
  if (!onAPage()) return false;
  if (deviceProof.ok) return true;
  if (!fresh && Date.now() - deviceProof.at < 60000) return false;
  deviceProof = { at: Date.now(), ok: false, refused: false };
  try {
    const res = await fetch(new URL('api/books/list', document.baseURI), { cache: 'no-store' });
    if (res && res.ok) { const j = await res.json(); deviceProof.ok = Boolean(j && Array.isArray(j.books)); }
    else if (res && res.status === 403) { const j = await res.json(); deviceProof.refused = Boolean(j && typeof j.refused === 'string' && j.refused); }
  } catch (err) { /* nothing answers here */ }
  if (deviceProof.ok) { try { localStorage.setItem(HAD_DEVICE, '1'); } catch (err) { /* this sitting knows it */ } }
  return deviceProof.ok;
}
/* M675: the library's epoch as this browser's books know it (sync.js; '' = none was ever set) rides every write, so words
 * kept for the library as it was before a copy was brought back are never added to the copy (serve.py refuses them, 409).
 * Until the books' own sync has said what it knows, no epoch is claimed and the device answers as it always did. */
let epochKnown = null;
export function sentDevice({ epoch } = {}) { epochKnown = typeof epoch === 'function' ? epoch : null; }
const epochHeader = () => { let e = null; try { e = epochKnown ? epochKnown() : null; } catch (err) { e = null; } return typeof e === 'string' ? { 'x-cozy-epoch': e || '-' } : {}; };

/* M675 — A TALE LET GO TAKES ITS WORDS WITH IT, NOW. The push that follows a page by four minutes was never called off: a
 * tale let go inside those minutes had its words written back to the device beside its tombstone, for good (the audit:
 * keep a page, let the tale go, fire the timer — the archive is there again, and in the next copy). The device refuses
 * that now (410); here the tale's push is called off and its words are let go the moment it goes — and a tale the DEVICE
 * says was let go (by another browser) is let go here the same way when it answers so. */
const goneTales = new Set();
export async function forgetSentOf(storyId) {
  try {
    if (!storyId) return false;
    goneTales.add(storyId);
    clearTimeout(pushTimers.get(storyId));
    pushTimers.delete(storyId);
    deviceHolds.delete(storyId);
    healed.delete(storyId);
    const d = await openSent();
    const pages = await done(d.transaction(PAGES, 'readonly').objectStore(PAGES).index('byStory').getAllKeys(storyId));
    const pieces = await done(d.transaction(PIECES, 'readonly').objectStore(PIECES).index('byStory').getAllKeys(storyId));
    const tx = d.transaction([PIECES, PAGES], 'readwrite');
    for (const k of pages || []) tx.objectStore(PAGES).delete(k);
    for (const k of pieces || []) tx.objectStore(PIECES).delete(k);
    await finished(tx);
    knownPieces.delete(storyId);
    return true;
  } catch (err) {
    return false;
  }
}
/* what the device holds of a tale: { pages, pieces } — or { gone: true } when it says the tale was let go — or null when
 * it did not answer. Asked once a sitting, then kept current by what is sent. */
async function whatDeviceHolds(storyId) {
  if (deviceHolds.has(storyId)) return deviceHolds.get(storyId);
  const res = await fetch(sentUrl(storyId, '?have=1'), { cache: 'no-store' });
  let held = null;
  if (res && res.status === 410) return { gone: true, pages: new Set(), pieces: new Set() };
  if (res && res.status === 404) held = { pages: new Set(), pieces: new Set() }; /* no archive yet */
  else if (res && res.ok) { const j = await res.json(); held = { pages: new Set(Array.isArray(j.pages) ? j.pages : []), pieces: new Set(Array.isArray(j.pieces) ? j.pieces : []) }; }
  if (held) deviceHolds.set(storyId, held);
  return held;
}
const keysOfRecord = (record) => {
  const need = new Set();
  const collect = (v) => {
    if (Array.isArray(v)) { v.forEach(collect); return; }
    if (v && typeof v === 'object') { if (Array.isArray(v[TEXT_KEY]) && Object.keys(v).length === 1) v[TEXT_KEY].forEach((k) => need.add(k)); else Object.values(v).forEach(collect); }
  };
  for (const s of record.slots || []) for (const k of s.t || []) need.add(k);
  for (const r of record.requests || []) collect(r.body);
  return need;
};
const PUSH_BATCH_CHARS = 3000000;
/* M675 — WHAT DID NOT REACH THE DEVICE IS KNOWN, AND WHY. This answered true or false, and whoever asked for every tale's
 * words to be sent ("Take a copy", "Bring a copy back") heard only a count of the tales that went: words that could
 * NOT go — the device not answering, or turning them away — were reported by nobody, the copy was handed over as if
 * it held them, and a copy brought back then cleared them from this browser for good (the second reviewer). One
 * tale's sending now answers { ok, pages, why }: ok — everything this browser keeps of the tale is on the device (or
 * it keeps nothing of it); otherwise `pages` — how many pages' words are NOT there — and `why`: 'no device' (no
 * tavern's server behind this page), 'no answer' (there is one, and it did not answer), 'refused' (it answered, and
 * would not take them), 'stale' (it holds another library now), 'gone' (the tale was let go). A page with a piece
 * this browser no longer holds cannot be sent and cannot be read here either: it is not counted. */
async function sendSentOf(storyId) {
  let left = 0; /* pages still to send, as far as is known when something goes wrong */
  try {
    if (!storyId) return { ok: false, pages: 0, why: '' };
    if (goneTales.has(storyId)) return { ok: false, pages: 0, why: 'gone' };
    const d = await openSent();
    if (!(await deviceThere())) {
      const kept = await done(d.transaction(PAGES, 'readonly').objectStore(PAGES).index('byStory').getAllKeys(storyId));
      return { ok: false, pages: (kept || []).length, why: deviceProof.refused ? 'refused' : hadDevice() ? 'no answer' : 'no device' };
    }
    const pages = await done(d.transaction(PAGES, 'readonly').objectStore(PAGES).index('byStory').getAll(storyId));
    /* M675: a tale this browser keeps no words of has nothing to send — and the device is not asked what it holds of it
     * ("Take a copy" walks every tale on the shelf; the device reads an archive whole to answer) */
    if (!Array.isArray(pages) || !pages.length) return { ok: true, pages: 0, why: '' };
    left = pages.length;
    const held = await whatDeviceHolds(storyId);
    if (!held) return { ok: false, pages: left, why: 'refused' }; /* it answered, and not with what it holds */
    if (held.gone) { await forgetSentOf(storyId); return { ok: false, pages: 0, why: 'gone' }; }
    const fresh = pages.filter((r) => r && r.id && !held.pages.has(r.id)).sort((x, y) => (x.ts || 0) - (y.ts || 0));
    left = fresh.length;
    if (!fresh.length) return { ok: true, pages: 0, why: '' };
    let gone = false;
    let why = 'refused';
    const send = async (lines) => {
      const res = await fetch(sentUrl(storyId), { method: 'POST', headers: { 'content-type': 'application/x-ndjson', ...epochHeader() }, body: lines.join('\n') + '\n', cache: 'no-store' });
      if (res && res.status === 410) gone = true;
      if (res && res.status === 409) why = 'stale';
      return Boolean(res && res.ok);
    };
    for (const record of fresh) {
      /* a page goes with every piece of it the device lacks; a page with a piece this browser no longer holds cannot go */
      const lines = [];
      let whole = true;
      const store = d.transaction(PIECES, 'readonly').objectStore(PIECES);
      const adding = [];
      for (const k of keysOfRecord(record)) {
        if (held.pieces.has(k)) continue;
        const row = await done(store.get(k));
        if (!row || typeof row.t !== 'string') { whole = false; break; }
        lines.push(JSON.stringify({ k, t: row.t }));
        adding.push(k);
      }
      if (!whole) { left -= 1; continue; }
      lines.push(JSON.stringify({ p: record }));
      /* in batches a phone can hold: the pieces first, the page's own line last (a page is only "held" with all its pieces) */
      let batch = []; let size = 0; let ok = true;
      for (const ln of lines) {
        if (size + ln.length > PUSH_BATCH_CHARS && batch.length) { ok = await send(batch); if (!ok) break; batch = []; size = 0; }
        batch.push(ln); size += ln.length;
      }
      if (ok && batch.length) ok = await send(batch);
      if (gone) { await forgetSentOf(storyId); return { ok: false, pages: 0, why: 'gone' }; } /* M675: the device says the tale was let go */
      if (!ok) return { ok: false, pages: left, why };
      for (const k of adding) held.pieces.add(k);
      held.pages.add(record.id);
      left -= 1;
    }
    return { ok: true, pages: 0, why: '' };
  } catch (err) {
    return { ok: false, pages: left, why: 'no answer' }; /* the asking itself fell over: the device went quiet under it */
  }
}
export async function pushSentToDevice(storyId) {
  return (await sendSentOf(storyId)).ok;
}
/* every tale's, one after another; returns { reached: how many tales' words are all on the device, behind: [{ storyId,
 * pages, why }] — each tale some of whose pages' words did NOT get there, and why } (M675: it returned the count alone).
 * `fresh`: he asked for this himself — the device is looked for now, not answered from the last minute's memory. */
export async function pushAllSentToDevice(storyIds, { fresh = false } = {}) {
  const out = { reached: 0, behind: [] };
  if (fresh) await deviceThere(true);
  for (const id of Array.isArray(storyIds) ? storyIds : []) {
    const r = await sendSentOf(id);
    if (r.ok) out.reached += 1;
    else if (r.pages > 0) out.behind.push({ storyId: id, pages: r.pages, why: r.why });
  }
  return out;
}

/* M675 — A BRANCH'S CARRIED PAGES ARE GIVEN TO IT, ON THE DEVICE. A branch is a new tale, and the pages it carries kept
 * their words under the tale they were told in: asked under the branch's own name the device had nothing, and letting
 * the first tale go deleted the only copy (the audit: read under the parent — the words; under the branch — "neither
 * this browser nor the device has them"). For the pages of a tale the device does not hold under the tale's own name
 * and this browser does not hold as that tale's (so the ordinary push will not carry them), the device is asked to copy
 * them from where they are — a named tale (`from`: the parent, when a branch is made), or any archive it keeps ('*',
 * when a tale is opened: a branch made before this is healed the same way). Asked once a sitting for a tale. Returns
 * how many pages the device now holds under the tale's own name because of it. Nothing here may ever stop a page. */
export const DEVICE_KEEPS_SINCE = Date.UTC(2026, 9, 7); /* M671: no page told before the device began to keep them can be in an archive */
const healed = new Map(); /* storyId -> Set of page ids already asked for this sitting */
export async function giveSentToTale(storyId, pages, { from = '*' } = {}) {
  try {
    if (!storyId || goneTales.has(storyId) || !Array.isArray(pages) || !pages.length || !(await deviceThere())) return 0;
    const asked = healed.get(storyId) || new Set();
    healed.set(storyId, asked);
    const wanted = [...new Set(pages.filter((p) => p && typeof p.id === 'string' && p.id && !asked.has(p.id) && !(Number.isFinite(p.ts) && p.ts < DEVICE_KEEPS_SINCE)).map((p) => p.id))];
    if (!wanted.length) return 0;
    const held = await whatDeviceHolds(storyId);
    if (!held || held.gone) return 0;
    const d = await openSent();
    const mine = new Set(((await done(d.transaction(PAGES, 'readonly').objectStore(PAGES).index('byStory').getAll(storyId))) || []).map((r) => r && r.id));
    const lacking = wanted.filter((id) => !held.pages.has(id) && !mine.has(id));
    for (const id of wanted) asked.add(id);
    if (!lacking.length) return 0;
    let got = 0;
    /* from the tale named first (a branch's parent — one archive read), and what it does not hold from anywhere on the
     * device (a branch of a branch: the pages its parent carried are kept under the tale they were first told in) */
    let left = lacking;
    for (const where of (from && from !== '*' ? [from, '*'] : ['*'])) {
      const still = [];
      for (let i = 0; i < left.length; i += 5000) {
        const part = left.slice(i, i + 5000);
        const res = await fetch(sentUrl(storyId, '?from=' + encodeURIComponent(where)), { method: 'POST', headers: { 'content-type': 'application/json', ...epochHeader() }, body: JSON.stringify({ pages: part }), cache: 'no-store' });
        if (!(res && res.ok)) { for (const id of part) asked.delete(id); continue; } /* asked again another time */
        const j = await res.json();
        const missing = new Set(Array.isArray(j && j.missing) ? j.missing : []);
        for (const id of part) { if (missing.has(id)) still.push(id); else { held.pages.add(id); got += 1; } }
      }
      left = still;
      if (!left.length) break;
    }
    return got;
  } catch (err) {
    return 0;
  }
}
/* what this browser believes the device holds is forgotten (a copy was brought back: the device is asked again) */
export function forgetDevice() { deviceHolds.clear(); pulledFromDevice.clear(); pushedMark.clear(); healed.clear(); goneTales.clear(); }
/* one page's words — from this browser, or, when it has let them go or never had them, from the device's archive */
/* M675: and when there are none, WHY is said (`report.why`, when the caller hands an object): 'no device' — this page has
 * no tavern's server behind it; 'no answer' — it has one and the device did not answer (the words may well be there:
 * the sheet said "neither this browser nor the device has them" for a tavern that was merely not running);
 * 'refused' — the tavern is running and does not serve the address this page was opened under (deviceThere);
 * 'not kept' — the device answered and does not hold this page whole. */
export async function loadSentOrPull(id, storyId, report = null) {
  const say = (why) => { if (report && typeof report === 'object') report.why = why; return null; };
  const here = await loadSent(id);
  if (here || !id || !storyId) return here;
  if (!onAPage()) return say('no device');
  try {
    if (!(await deviceThere())) return say(deviceProof.refused ? 'refused' : hadDevice() ? 'no answer' : 'no device'); /* (M675 `refused`: it answered, and does not serve this address) */
    let res = null;
    try { res = await fetch(sentUrl(storyId, '?page=' + encodeURIComponent(id)), { cache: 'no-store' }); } catch (err) { return say('no answer'); }
    if (!res || res.status >= 500 || res.status === 0) return say('no answer');
    if (!res.ok) return say('not kept');
    const data = await res.json();
    const record = data && Array.isArray(data.pages) ? data.pages.find((r) => r && r.id === id) : null;
    if (!record) return say('not kept');
    const got = new Map((Array.isArray(data.pieces) ? data.pieces : []).filter((p) => p && typeof p.k === 'string' && typeof p.t === 'string').map((p) => [p.k, p.t]));
    if ([...keysOfRecord(record)].some((k) => !got.has(k))) return say('not kept'); /* a piece gone: better nothing than words that are not what was sent */
    const text = (keys) => keys.map((k) => got.get(k)).join('');
    return {
      ts: record.ts,
      slots: (record.slots || []).map((s) => ({ name: s.name, text: text(s.t || []) })),
      requests: (record.requests || []).map((r) => ({ url: r.url, body: decodeWith(text)(r.body) })),
    };
  } catch (err) {
    return say('no answer');
  }
}
/* a few minutes after a tale's page is told, its words go to the device by themselves (one push for a run of pages) */
const SENT_PUSH_AFTER_MS = 4 * 60 * 1000;
const pushTimers = new Map();
function pushSentLater(storyId) {
  if (!storyId || goneTales.has(storyId) || !onAPage() || typeof setTimeout !== 'function') return;
  clearTimeout(pushTimers.get(storyId));
  pushTimers.set(storyId, setTimeout(() => { pushTimers.delete(storyId); pushSentToDevice(storyId).catch(() => {}); }, SENT_PUSH_AFTER_MS));
}
