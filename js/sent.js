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
export function piecesOf(text) {
  const s = String(text || '');
  if (!s) return [];
  const paras = s.split(/(?<=\n\n)/);
  const out = [];
  let cur = '';
  for (const p of paras) {
    cur += p;
    if (cur.length >= PIECE_MAX || (cur.length >= PIECE_MIN && hash53(p) % 4 === 0)) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}
const pieceKey = (storyId, piece) => storyId + '|' + hash53(piece).toString(36) + '|' + piece.length;

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
export async function pruneSent(storyId) {
  try {
    const d = await openSent();
    const all = await done(d.transaction(PAGES, 'readonly').objectStore(PAGES).index('byStory').getAll(storyId));
    if (!Array.isArray(all) || all.length <= KEEP_PAGES) return 0;
    all.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const doomed = all.slice(0, all.length - (KEEP_PAGES - PRUNE_BATCH));
    const kept = all.slice(all.length - (KEEP_PAGES - PRUNE_BATCH));
    const used = new Set();
    const collect = (v) => {
      if (Array.isArray(v)) { v.forEach(collect); return; }
      if (v && typeof v === 'object') { if (Array.isArray(v[TEXT_KEY])) v[TEXT_KEY].forEach((k) => used.add(k)); else Object.values(v).forEach(collect); }
    };
    for (const r of kept) { for (const s of r.slots || []) for (const k of s.t || []) used.add(k); for (const q of r.requests || []) collect(q.body); }
    const known = await piecesKnown(d, storyId);
    const tx = d.transaction([PIECES, PAGES], 'readwrite');
    for (const r of doomed) tx.objectStore(PAGES).delete(r.id);
    const gone = [...known].filter((k) => !used.has(k));
    for (const k of gone) tx.objectStore(PIECES).delete(k);
    await finished(tx);
    for (const k of gone) known.delete(k);
    return doomed.length;
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
