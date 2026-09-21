/* Cozy Tavern — store.js
 * The whole memory of the tavern, kept in IndexedDB. Promise-based.
 * Namespace: 'cozytavern.v1' — the database name and the backup envelope
 * both carry it, so future versions can migrate without stepping on M1 data.
 *
 * Contract (SPEC.md):
 *   db.settings.get(key) / set(key, val)
 *   db.connections.list() / add(conn) / update(id, patch) / remove(id)
 *   db.stories.list() / create({title}) / remove(id)
 *   db.messages.list(storyId) / append(storyId, msg)
 *   db.exportAll() -> JSON string; db.importAll(json) -> restore
 *
 * Two additive helpers beyond the M1 contract, needed by the chat UI the spec
 * requires (rename, regenerate): db.stories.update(id, patch) and
 * db.messages.deleteFrom(storyId, messageId).
 *
 * M2 additions: messages keep an optional `receipt` (the record of what was
 * sent that turn — see js/assemble/receipt.js), and letting go of a story
 * also lets go of its ledger state (stored under the settings key
 * `state:<storyId>`). Both ride along in backups through the existing
 * stores — no schema change.
 *
 * M3 addition: messages may also carry `extraction` — what the background
 * worker made of the finished turn (js/agents/extractor.js), passed through
 * by append the same way the receipt is.
 *
 * M6 additions: messages may also carry `findings` — the continuity
 * reader's drift notes (js/agents/continuity.js), same re-ink passthrough.
 * A story's memory nodes live in the settings store under
 * `memory:<storyId>` and are let go with the story, the way its ledger is.
 *
 * M7 additions: the cast library (app-wide character cards) lives in the
 * settings store under `cast:<cardId>`, and a story's lore shelf under
 * `lore:<storyId>`. Both ride along in backups the same way; letting go of
 * a story lets its lore go with it, while the cast library stays on its
 * shelf (letting go of a cast MEMBER un-invites them from every story —
 * that's import/cards.js's doing). Stories may carry `castIds`: the ids of
 * the cast invited into that tale. Two additive helpers ride with these:
 * db.settings.keys() (every setting key, so the library can be listed) and
 * db.settings.delete(key) (so a card can be let go for good).
 *
 * M8/M8.5 additions: connections may carry sampling dials (`temperature`,
 * `topP`, `maxTokens`), a `contextSize` (the ember bar's measure of the
 * model's room), and a `reasoning` object ({effort, budgetTokens?}) — all
 * optional, all omitted from the wire when unset. Messages may carry
 * `thinking` (the storyteller's reasoning channel, rendered folded above
 * the prose) and `stopped` (the page was stopped by hand mid-sentence).
 * One more additive helper: db.messages.remove(storyId, messageId) lets a
 * single page go.
 *
 * M9 additions: messages may carry `swipes` (every version of the page,
 * [{text, thinking, ts, receipt}] with `swipeIdx` marking which is shown;
 * msg.text always mirrors the shown swipe), `hidden` (the continue nudge's
 * user message — on the wire once, never rendered, excluded from history),
 * `cutShort` (the reply ran out of room), and `ooc` (an out-of-character
 * aside, kept out of the workers' reading). db.messages.update(id, patch)
 * re-inks chosen fields of one page (edit, swipe) without rebuilding the
 * row, and db.messages.appendAll(storyId, msgs) writes many pages in ONE
 * transaction (B17 — chat imports are atomic per story). importAll now
 * validates every row BEFORE clearing a thing (B17): a bad backup fails
 * kindly with nothing touched.
 *
 * M9 quota guard (B1): a QuotaExceededError from any write is re-thrown as
 * a kind, named Error ('The shelf is full…') so callers can show it and
 * keep the writer's words; and after writes, when storage crosses 80% full,
 * the registered onStorageWarning listener hears about it (once per
 * crossing) — the chat view turns that into a toast.
 *
 * M10 additions: the housekeeper's per-story session lives under
 * `hk:<storyId>`, the director's marching orders under `director:<storyId>`,
 * and the editor's standing critique under `editor:<storyId>` — all in the
 * settings store, all riding backups, all let go with their story.
 *
 * M16 additions: the shelves. A project is a shelf that gathers tales —
 * {id, name, createdAt}, kept as one list under the settings key
 * `projects` (so it rides backups the way every other setting does), and
 * a story may carry `projectId` naming its shelf. db.projects offers
 * list/create/rename/remove; taking a shelf down NEVER deletes a tale —
 * its stories simply stand loose again. shelvesOf(stories, projects) is
 * the pure grouping the sidebar renders (and the harness checks).
 */

const DB_NAME = 'cozytavern.v1';
const DB_VERSION = 1;
const NAMESPACE = 'cozytavern.v1';

const STORES = ['settings', 'connections', 'stories', 'messages'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('settings')) {
        d.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!d.objectStoreNames.contains('connections')) {
        d.createObjectStore('connections', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('stories')) {
        d.createObjectStore('stories', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('messages')) {
        const s = d.createObjectStore('messages', { keyPath: 'id' });
        s.createIndex('byStory', 'storyId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/* Run one request inside a transaction; resolve with the request result
 * when the transaction completes. */
/* ---------- the quota guard (M9, B1) ---------- */

export const QUOTA_MESSAGE = 'The shelf is full — this device has no room left for new pages. Export a backup, let an old tale go, and try again.';

function isQuotaError(err) {
  return err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

/* The 80% storage-full warning: a single listener, notified once per
 * crossing (it re-arms if usage later falls back under the line). */
let storageWarningListener = null;
let storageWarned = false;

export function onStorageWarning(fn) {
  storageWarningListener = typeof fn === 'function' ? fn : null;
}

async function checkStorage() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage
      || typeof navigator.storage.estimate !== 'function') return;
    const { usage, quota } = await navigator.storage.estimate();
    if (!quota) return;
    const ratio = usage / quota;
    if (ratio >= 0.8 && !storageWarned) {
      storageWarned = true;
      if (storageWarningListener) storageWarningListener(ratio);
    } else if (ratio < 0.7) {
      storageWarned = false;
    }
  } catch (err) { /* an estimate that won't come is no reason to fail */ }
}

async function run(storeName, mode, build) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(storeName, mode);
    const request = build(t.objectStore(storeName));
    t.oncomplete = () => {
      if (mode === 'readwrite') checkStorage();
      resolve(request ? request.result : undefined);
    };
    t.onerror = () => reject(isQuotaError(t.error) ? new Error(QUOTA_MESSAGE) : t.error);
    t.onabort = () => reject(isQuotaError(t.error) ? new Error(QUOTA_MESSAGE) : t.error);
  });
}

/* M59: read-modify-write, serialized per row. Two updates that overlapped —
 * a worker's status beside a shelf move, a mend beside a swipe — used to
 * read in one transaction and write in another, and the later write could
 * carry the earlier row: a lost update, seen as a flaky shelf. A per-row
 * lock (a promise chain) makes each update wait for the one before it. */
const rowLocks = new Map();
async function modify(storeName, key, change) {
  const lockKey = storeName + ':' + String(key);
  const prev = rowLocks.get(lockKey) || Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  /* M160: the map held `prev.then(() => mine)`, never `mine` itself, so the
   * cleanup test below could never be true and every row ever modified left
   * an entry behind — a Map that grew for the life of the page (one key per
   * page edited, per swipe, per worker write-back, on a six-hundred-page
   * shelf). The chain is kept under its own token, and the token is what the
   * cleanup compares. */
  const chained = prev.then(() => mine);
  rowLocks.set(lockKey, chained);
  try {
    await prev;
    const row = await run(storeName, 'readonly', (s) => s.get(key));
    if (!row) return undefined;
    const next = change(row);
    if (next === undefined) return undefined;
    await run(storeName, 'readwrite', (s) => s.put(next));
    return next;
  } finally {
    release();
    if (rowLocks.get(lockKey) === chained) rowLocks.delete(lockKey);
  }
}

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* M137: THE READ CACHE. Every action in the room read the same rows from
 * IndexedDB again and again — a story's whole page list dozens of times per
 * turn, the ledger's state a dozen more — and on a phone each read of a
 * long story is a hundred milliseconds of deserializing. Reads come from
 * memory now; every write to a key or a story's pages invalidates it. A
 * settings read hands out a clone (a caller may mutate what it gets, as it
 * always could); a page list hands out shallow copies of its rows. */
const settingsCache = new Map();
const messagesCache = new Map();
const cloneValue = (v) => {
  if (v === undefined || v === null || typeof v !== 'object') return v;
  try { return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)); } catch (err) { return JSON.parse(JSON.stringify(v)); }
};
export function dropCaches() { settingsCache.clear(); messagesCache.clear(); }

const settings = {
  async get(key) {
    if (settingsCache.has(key)) return cloneValue(settingsCache.get(key));
    const row = await run('settings', 'readonly', (s) => s.get(key));
    const value = row ? row.value : undefined;
    settingsCache.set(key, cloneValue(value));
    return value;
  },
  async set(key, val) {
    await run('settings', 'readwrite', (s) => s.put({ key, value: val }));
    settingsCache.set(key, cloneValue(val));
    return val;
  },
  /* Additive helpers (M7, see header): list every key (the cast library
   * lists its `cast:` shelf this way), and let a key go for good. */
  async keys() {
    /* M312: THE KEYS, NOT EVERY ROW OF EVERY TALE. This asked the store for getAll() — every settings
     * row WHOLE, which is every checkpoint of every tale on the shelf (the writer's library: over a
     * gigabyte) — to hand back their names. The cast library lists itself through here, so the
     * ledger's cast panel and Settings' people room each read the whole library off the disk to
     * show a handful of cards; measured at a 144 MB library, 6x CPU: 1,440 ms, growing with every
     * page ever written in ANY tale. getAllKeys() reads no values at all. */
    const keys = await run('settings', 'readonly', (s) => s.getAllKeys());
    return (keys || []).filter((k) => typeof k === 'string');
  },
  async delete(key) {
    await run('settings', 'readwrite', (s) => s.delete(key));
    settingsCache.delete(key);
  },
};

const connections = {
  async list() {
    const rows = await run('connections', 'readonly', (s) => s.getAll());
    return rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },
  async add(conn) {
    const row = {
      id: conn.id || uid(),
      label: conn.label || 'A connection',
      type: conn.type === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: conn.baseUrl || '',
      apiKey: conn.apiKey || '',
      model: conn.model || '',
      createdAt: conn.createdAt || Date.now(),
    };
    /* M8: sampling dials and the ember bar's idea of the model's room.
     * Unset means "the storyteller's own defaults" — the providers send
     * nothing for a dial that was never turned. */
    if (typeof conn.temperature === 'number') row.temperature = conn.temperature;
    if (typeof conn.topP === 'number') row.topP = conn.topP;
    if (typeof conn.maxTokens === 'number') row.maxTokens = conn.maxTokens;
    if (typeof conn.contextSize === 'number') row.contextSize = conn.contextSize;
    /* M8.5: the thinking voice — {effort:'low|…|max', budgetTokens?}.
     * 'off' (or absence) sends nothing. */
    if (conn.reasoning && typeof conn.reasoning === 'object') row.reasoning = conn.reasoning;
    /* M22: the preset the form started from (the ladder reads it), the
     * per-connection web-search switch and its ceiling, and the prefill
     * ("start the reply for it"). The refusal memories (reasoningDownAt /
     * prefillDownAt) land later through update(). */
    if (typeof conn.preset === 'string' && conn.preset) row.preset = conn.preset;
    if (conn.searchOn === true) row.searchOn = true;
    if (typeof conn.searchMaxUses === 'number' && conn.searchMaxUses > 0) {
      row.searchMaxUses = Math.round(conn.searchMaxUses);
    }
    if (typeof conn.prefill === 'string' && conn.prefill) row.prefill = conn.prefill;
    await run('connections', 'readwrite', (s) => s.put(row));
    return row;
  },
  async update(id, patch) {
    return modify('connections', id, (row) => {
      /* M8: a null in the patch lets the dial go entirely — the providers
       * read absence as "the storyteller's own default". */
      const clean = {};
      const base = { ...row };
      for (const [key, value] of Object.entries(patch || {})) {
        if (value === null) delete base[key];
        else clean[key] = value;
      }
      return { ...base, ...clean, id: row.id };
    });
  },
  async remove(id) {
    await run('connections', 'readwrite', (s) => s.delete(id));
  },
};

const stories = {
  async list() {
    const rows = await run('stories', 'readonly', (s) => s.getAll());
    // Last-active first: the tale you were just telling waits on top.
    return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  async get(id) {
    return run('stories', 'readonly', (s) => s.get(id));
  },
  async create({ title, projectId, building } = {}) {
    const now = Date.now();
    const row = {
      id: uid(),
      title: (title && title.trim()) || 'An untitled tale',
      createdAt: now,
      updatedAt: now,
    };
    /* M332: a tale that is still being MADE (a branch) says so from its very first write — there is no moment at which
     * it stands in the store looking finished */
    if (building && typeof building === 'object') row.building = building;
    /* M16: a tale may begin already resting on a shelf. */
    if (typeof projectId === 'string' && projectId) row.projectId = projectId;
    await run('stories', 'readwrite', (s) => s.put(row));
    return row;
  },
  /* Additive helper (see header): rename / per-story frame & note overrides. */
  async update(id, patch) {
    return modify('stories', id, (row) => ({ ...row, ...patch, id: row.id, updatedAt: Date.now() }));
  },
  async remove(id) {
    await run('stories', 'readwrite', (s) => s.delete(id));
    // Let the story's pages go with it, and its ledger state too (M2).
    const pages = await messages.list(id);
    const d = await openDB();
    await new Promise((resolve, reject) => {
      const t = d.transaction('messages', 'readwrite');
      const s = t.objectStore('messages');
      for (const m of pages) s.delete(m.id);
      t.oncomplete = () => { messagesCache.delete(id); resolve(); };
      t.onerror = () => reject(isQuotaError(t.error) ? new Error(QUOTA_MESSAGE) : t.error);
    });
    /* M160: EVERYTHING OF A TALE GOES WITH THE TALE. Five prefixes were
     * named here by hand (state:, memory:, lore:, workers:, snapshots:) and
     * seven were not — versionState: above all, which holds up to sixty
     * whole ledgers, plus hk:, director:, editor:, memoryBackup:,
     * peopleBackup: and the tale's own bookStamp:. Those rows outlived every
     * tale the writer ever let go, and because exportHouse keeps any row
     * whose suffix is not a LIVING tale's id, each one was written into
     * _house.json on every push — the house book grew for the rest of the
     * shelf's life. The rule is the suffix, not a list: any key ending in
     * ':<this tale's id>' is this tale's. */
    const keys = await storyKeys(id);
    if (keys.length) {
      const d2 = await openDB();
      await new Promise((resolve, reject) => {
        const t = d2.transaction('settings', 'readwrite');
        const s = t.objectStore('settings');
        for (const key of keys) s.delete(key);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(isQuotaError(t.error) ? new Error(QUOTA_MESSAGE) : t.error);
        t.onabort = () => reject(isQuotaError(t.error) ? new Error(QUOTA_MESSAGE) : t.error);
      });
      for (const key of keys) settingsCache.delete(key);
    }
  },
};

/* M160: the settings keys that belong to one tale, read from the KEY LIST
 * alone. getAllKeys deserializes nothing; the old exportStory read every
 * settings row of every tale (each one's sixty version ledgers and hundred
 * and twenty snapshots) to find the handful it wanted — once per dirty book,
 * every push, on a store the room is reading from at the same time. */
async function storyKeys(storyId) {
  if (!storyId) return [];
  const all = await run('settings', 'readonly', (s) => s.getAllKeys());
  const tail = ':' + storyId;
  return (all || []).filter((k) => typeof k === 'string' && k.endsWith(tail));
}

const messages = {
  async list(storyId) {
    if (messagesCache.has(storyId)) return messagesCache.get(storyId).map((r) => ({ ...r }));
    const d = await openDB();
    const rows = await new Promise((resolve, reject) => {
      const t = d.transaction('messages', 'readonly');
      const idx = t.objectStore('messages').index('byStory');
      const req = idx.getAll(storyId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const sorted = rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    messagesCache.set(storyId, sorted);
    return sorted.map((r) => ({ ...r }));
  },
  /* M14: how many pages a tale holds, without reading them — the story
   * shelf shows the count beside each title. */
  async count(storyId) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const t = d.transaction('messages', 'readonly');
      const idx = t.objectStore('messages').index('byStory');
      const req = idx.count(storyId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async append(storyId, msg) {
    const row = {
      id: msg.id || uid(),
      storyId,
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      text: typeof msg.text === 'string' ? msg.text : '',
      ts: msg.ts || Date.now(),
    };
    /* The Receipt (M2): a per-turn record of what was sent, kept right on
     * the assistant message it describes. */
    if (msg.receipt && typeof msg.receipt === 'object') row.receipt = msg.receipt;
    /* M3: what the extractor made of the turn ({appliedWords, rejectedCount}),
     * written back onto the same assistant message once the workers finish.
     * Appending a message with an existing id simply re-inks the page, so
     * this passthrough is how the extraction lands after the fact. */
    if (msg.extraction && typeof msg.extraction === 'object') row.extraction = msg.extraction;
    /* M6: the continuity reader's drift notes ([{words, severity}]), same
     * re-ink passthrough — they land on the page after the fact. */
    if (Array.isArray(msg.findings)) row.findings = msg.findings;
    /* M8.5: what the storyteller weighed before writing (the reasoning
     * channel), kept on the page it preceded. Pages from before the voice
     * woke simply carry no `thinking` and render exactly as they always
     * did. */
    if (typeof msg.thinking === 'string' && msg.thinking) row.thinking = msg.thinking;
    /* M46: how long it weighed (ms) — the page's own clock, kept beside the thought. */
    if (Number.isFinite(msg.thinkingMs) && msg.thinkingMs >= 0) row.thinkingMs = msg.thinkingMs;
    /* M26/M35: the house's masthead and a mend ride an append too (a branch
     * copies pages through append; a re-ink through update). */
    if (typeof msg.masthead === 'string' && msg.masthead) row.masthead = msg.masthead;
    /* M85: the voices the world agent heard elsewhere after this page —
     * [{icon, speaker, channel, content}] — shown under the page. */
    if (Array.isArray(msg.voices)) {
      const voices = msg.voices
        .filter((v) => v && typeof v === 'object' && typeof v.content === 'string' && v.content && typeof v.speaker === 'string' && v.speaker)
        .slice(0, 4)
        .map((v) => ({ icon: typeof v.icon === 'string' ? v.icon.slice(0, 8) : '💬', speaker: v.speaker.slice(0, 60), channel: typeof v.channel === 'string' ? v.channel.slice(0, 90) : '', content: v.content.slice(0, 280) }));
      if (voices.length) row.voices = voices;
    }
    if (msg.mended && typeof msg.mended === 'object' && typeof msg.mended.before === 'string') row.mended = msg.mended;
    /* M27: a page may carry a picture ({image: {dataUrl, mediaType}}). Kept
     * on the page, shown as a keepsake, and ridden on the wire only on its
     * own turn (the assembler's picture law). */
    if (msg.image && typeof msg.image === 'object' && msg.image.dataUrl) row.image = msg.image;
    /* M8: a page stopped by hand keeps this mark, so the "stopped
     * mid-sentence" label survives a reload. */
    if (msg.stopped === true) row.stopped = true;
    /* M9: every version of the page (swipes) and which one is shown.
     * msg.text always mirrors swipes[swipeIdx].text — the wire, the
     * thread, and the receipt all read the same words. */
    if (Array.isArray(msg.swipes) && msg.swipes.length) {
      row.swipes = msg.swipes
        .filter((s) => s && typeof s === 'object' && typeof s.text === 'string')
        .map((s) => {
          const swipe = { text: s.text, ts: Number.isFinite(s.ts) ? s.ts : Date.now() };
          if (typeof s.thinking === 'string' && s.thinking) swipe.thinking = s.thinking;
          if (Number.isFinite(s.thinkingMs) && s.thinkingMs >= 0) swipe.thinkingMs = s.thinkingMs;
          if (s.receipt && typeof s.receipt === 'object') swipe.receipt = s.receipt;
          return swipe;
        });
      if (row.swipes.length) {
        const idx = Number.isFinite(msg.swipeIdx) ? Math.round(msg.swipeIdx) : row.swipes.length - 1;
        row.swipeIdx = Math.min(row.swipes.length - 1, Math.max(0, idx));
        const shown = row.swipes[row.swipeIdx];
        row.text = shown.text;
        if (shown.thinking) row.thinking = shown.thinking;
        if (Number.isFinite(shown.thinkingMs)) row.thinkingMs = shown.thinkingMs;
        if (shown.receipt) row.receipt = shown.receipt;
      }
    }
    /* M9: a hidden page (the continue nudge's "Go on.") stays in the store
     * for the audit but never renders and never joins history. */
    if (msg.hidden === true) row.hidden = true;
    /* M9: the reply ran out of room (finish reason max_tokens / length). */
    if (msg.cutShort === true) row.cutShort = true;
    /* M9: an out-of-character aside (#question, ((…)), //…) — kept out of
     * the workers' reading. */
    if (msg.ooc === true) row.ooc = true;
    /* M382: WHAT HE TYPED, KEPT. M379 sent a shortcut to the storyteller "as he typed it" from a `typed` field this
     * append never kept — so the field was dropped on the way into the store, and a bare "#story" reached the
     * storyteller as the house's own placeholder, "A new tale — you choose it.", as if he had written that. */
    if (typeof msg.typed === 'string' && msg.typed.trim()) row.typed = msg.typed.trim().slice(0, 4000);
    /* M22-C: where the storyteller looked things up ([{title, url}]),
     * folded under the page it informed. */
    if (Array.isArray(msg.sources) && msg.sources.length) {
      row.sources = msg.sources
        .filter((s) => s && typeof s.url === 'string' && s.url)
        .map((s) => ({ title: typeof s.title === 'string' && s.title ? s.title : s.url, url: s.url }));
      if (!row.sources.length) delete row.sources;
    }
    await run('messages', 'readwrite', (s) => s.put(row));
    messagesCache.delete(storyId);
    // Touch the story so last-active sorting stays honest.
    const story = await stories.get(storyId);
    if (story) await stories.update(storyId, {});
    return row;
  },
  /* M9 additive helper: re-ink chosen fields of one page (an edit, a swipe
   * change) without rebuilding the whole row from memory. Unknown ids are
   * a quiet no-op returning undefined — the workers rely on this when the
   * page they were reading has gone (B5). */
  async update(storyId, messageId, patch) {
    messagesCache.delete(storyId);
    const out = await modify('messages', messageId, (found) => (found.storyId !== storyId ? undefined : { ...found, ...(patch || {}), id: found.id, storyId: found.storyId }));
    messagesCache.delete(storyId);
    return out;
  },
  /* M9 additive helper (B17): write many pages of one story in a SINGLE
   * transaction — a chat import either lands whole or not at all. */
  async appendAll(storyId, msgs) {
    const list = (Array.isArray(msgs) ? msgs : []).filter((m) => m && typeof m === 'object');
    if (!storyId || !list.length) return [];
    const rows = list.map((msg, i) => ({
      id: msg.id || uid(),
      storyId,
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      text: typeof msg.text === 'string' ? msg.text : '',
      ts: Number.isFinite(msg.ts) ? msg.ts : Date.now() + i,
    }));
    const d = await openDB();
    await new Promise((resolve, reject) => {
      const t = d.transaction('messages', 'readwrite');
      const s = t.objectStore('messages');
      for (const row of rows) s.put(row);
      t.oncomplete = () => { checkStorage(); messagesCache.clear(); resolve(); };
      t.onerror = () => reject(isQuotaError(t.error) ? new Error(QUOTA_MESSAGE) : t.error);
      t.onabort = () => reject(isQuotaError(t.error) ? new Error(QUOTA_MESSAGE) : t.error);
    });
    const story = await stories.get(storyId);
    if (story) await stories.update(storyId, {});
    return rows;
  },
  /* Additive helper (see header): remove the message with `messageId` and
   * everything written after it — the backing store for "Rewrite from here". */
  async deleteFrom(storyId, messageId) {
    const all = await messages.list(storyId);
    const at = all.findIndex((m) => m.id === messageId);
    if (at === -1) return 0;
    const doomed = all.slice(at);
    messagesCache.delete(storyId);
    const d = await openDB();
    await new Promise((resolve, reject) => {
      const t = d.transaction('messages', 'readwrite');
      const s = t.objectStore('messages');
      for (const m of doomed) s.delete(m.id);
      t.oncomplete = () => { messagesCache.delete(storyId); resolve(); };
      t.onerror = () => reject(isQuotaError(t.error) ? new Error(QUOTA_MESSAGE) : t.error);
    });
    return doomed.length;
  },
  /* M8 additive helper: let one single page go (the delete action in the
   * thread). Everything around it stays exactly as written. */
  async remove(storyId, messageId) {
    const all = await messages.list(storyId);
    const found = all.find((m) => m.id === messageId);
    if (!found) return false;
    await run('messages', 'readwrite', (s) => s.delete(messageId));
    messagesCache.delete(storyId);
    return true;
  },
};

/* M16: the shelves. The whole list rests under one settings key, so it
 * rides backups like every other setting — no schema change. */
const PROJECTS_KEY = 'projects';

const projects = {
  async list() {
    const rows = await settings.get(PROJECTS_KEY);
    return (Array.isArray(rows) ? rows : [])
      .filter((p) => p && typeof p === 'object' && typeof p.id === 'string' && p.id)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },
  async create({ name } = {}) {
    const rows = await projects.list();
    const row = {
      id: uid(),
      name: (name && name.trim()) || 'A new shelf',
      createdAt: Date.now(),
    };
    await settings.set(PROJECTS_KEY, [...rows, row]);
    return row;
  },
  async rename(id, name) {
    const rows = await projects.list();
    const row = rows.find((p) => p.id === id);
    if (!row) return undefined;
    const next = (name && name.trim()) || row.name;
    await settings.set(PROJECTS_KEY, rows.map((p) => (p.id === id ? { ...p, name: next } : p)));
    return { ...row, name: next };
  },
  /* M311: A SHELF THAT LOST ITS ROW IS PUT BACK — THE TALES STILL KNOW WHERE THEY STOOD. The
   * whole list of shelves is ONE settings row ("projects"), and every tale carries the id of its
   * shelf (projectId). When that one row was lost — a browser that did not hold it pushed a house
   * book without it, and every other browser's pull then let it go (M293) — every tale "stood
   * loose", forty of them, and the writer was left to re-shelve each by hand. Nothing was
   * actually lost: the ids are on the tales. For every shelf id a tale names that the list does
   * not hold, the shelf is written back under that SAME id (so no tale is touched); its name
   * comes from `names` (what the device could find in its older files) or reads "Recovered
   * shelf N" for the writer to rename — once per shelf, never once per tale. Returns the rows
   * it put back. Pure of side effects when nothing is orphaned. */
  async heal(names = {}) {
    const rows = await projects.list();
    const known = new Set(rows.map((p) => p.id));
    const all = await stories.list();
    const orphaned = new Map(); /* shelf id -> the oldest tale's birth, to keep shelf order steady */
    for (const st of all) {
      const pid = st && typeof st.projectId === 'string' ? st.projectId : '';
      if (!pid || known.has(pid)) continue;
      const born = Number(st.createdAt) || Date.now();
      orphaned.set(pid, Math.min(orphaned.get(pid) || born, born));
    }
    if (!orphaned.size) return [];
    const back = [];
    let n = 0;
    for (const [id, born] of [...orphaned.entries()].sort((a, b) => a[1] - b[1])) {
      n += 1;
      const found = names && typeof names === 'object' ? names[id] : null;
      const name = found && typeof found.name === 'string' && found.name.trim() ? found.name.trim() : 'Recovered shelf ' + n;
      back.push({ id, name, createdAt: found && Number(found.createdAt) ? Number(found.createdAt) : born - 1, recovered: true });
    }
    await settings.set(PROJECTS_KEY, [...rows, ...back]);
    return back;
  },
  /* Taking a shelf down NEVER deletes a tale — every story it held simply
   * stands loose again (projectId let go). */
  async remove(id) {
    const rows = await projects.list();
    const next = rows.filter((p) => p.id !== id);
    if (next.length === rows.length) return false;
    await settings.set(PROJECTS_KEY, next);
    const shelved = await stories.list();
    for (const story of shelved) {
      if (story.projectId === id) await stories.update(story.id, { projectId: null });
    }
    return true;
  },
};

/* M16: group the tale list onto its shelves — the pure logic the sidebar
 * renders and the harness walks. Stories keep the caller's order
 * (stories.list() hands them over last-active-first, so each shelf reads
 * in interaction-recency order); a missing or unknown projectId simply
 * stands loose. Shelves come back in shelf order, loose tales last. */
export function shelvesOf(storyList, projectList) {
  const shelfList = Array.isArray(projectList) ? projectList : [];
  const byShelf = new Map(shelfList.map((p) => [p.id, []]));
  const loose = [];
  for (const story of Array.isArray(storyList) ? storyList : []) {
    const bucket = story && story.projectId ? byShelf.get(story.projectId) : undefined;
    if (bucket) bucket.push(story);
    else loose.push(story);
  }
  return {
    shelves: shelfList.map((project) => ({ project, stories: byShelf.get(project.id) })),
    loose,
  };
}

async function exportAll() {
  const envelope = {
    namespace: NAMESPACE,
    exportedAt: new Date().toISOString(),
    settings: await run('settings', 'readonly', (s) => s.getAll()),
    connections: await run('connections', 'readonly', (s) => s.getAll()),
    stories: await run('stories', 'readonly', (s) => s.getAll()),
    messages: await run('messages', 'readonly', (s) => s.getAll()),
  };
  return JSON.stringify(envelope, null, 2);
}

/* M155: BOOKS PER STORY. exportStory(id) is one tale whole — its row, its
 * pages, and every settings row that belongs to it (state:, memory:,
 * snapshots:, versionState:, workers:, hk:, lore:, and any other key that
 * ends in ':' + id); exportHouse() is everything that is nobody's tale —
 * connections, the stories list, and the settings rows with no story
 * suffix. Import replaces within that scope only. */
const STORY_ROW = (key, ids) => { const at = key.lastIndexOf(':'); return at > 0 && ids.has(key.slice(at + 1)); };
async function exportStory(storyId) {
  const story = await stories.get(storyId);
  if (!story) return null;
  /* M160: by key, not by reading the shelf. This runs in the sync worker
   * every twenty seconds for each changed tale, and IndexedDB serializes
   * transactions per database across threads — a full settings.getAll() here
   * held the store the room itself reads the ledger from. */
  const keys = await storyKeys(storyId);
  const mine = [];
  for (const key of keys) {
    const row = await run('settings', 'readonly', (s) => s.get(key));
    if (row) mine.push(row);
  }
  const msgs = await run('messages', 'readonly', (s) => s.index('byStory').getAll(storyId));
  return JSON.stringify({ namespace: NAMESPACE, kind: 'story', exportedAt: new Date().toISOString(), story, settings: mine, messages: msgs });
}
/* M160: the prefixes a settings row wears when it belongs to one tale. Used
 * twice: the house book refuses them for a tale that no longer stands, and
 * the boot sweep lets those orphans go for good. `cast:` is NOT here — the
 * cast library is app-wide and its suffix is a card's id, not a tale's. */
const STORY_PREFIXES = ['state', 'memory', 'lore', 'workers', 'snapshots', 'versionState', 'ckptBank', /* M314: the tale's bank of journal and log entries its checkpoints name */ 'hk', 'director', 'editor', 'memoryBackup', 'peopleBackup', 'bookStamp', 'cutThinking', 'hkCut', 'hkDraft'];
const STORY_PREFIXED = new RegExp('^(?:' + STORY_PREFIXES.join('|') + '):.+$');

/* M160: every tale-shaped row whose tale is gone, let go for good. Stores
 * that lost tales before M160 carry them still — a deleted tale's sixty
 * version ledgers and hundred and twenty snapshots, kept forever and written
 * into _house.json on every push. Run once at boot; returns how many went. */
async function sweepOrphans() {
  const all = await run('stories', 'readonly', (s) => s.getAll());
  const living = new Set((all || []).map((x) => x && x.id).filter(Boolean));
  /* M161: THE HOUSE IS NOT AN ORPHAN. `_house` is a book like a tale's, and
   * its bookStamp wears the same shape — but it is nobody's tale, so the
   * living set did not hold it and the M160 sweep ate its stamp on every
   * boot. With no stamp the house book was pulled again on every open, and
   * importHouse would lay the device's copy over settings this browser had
   * changed but not yet pushed (the push waits twenty seconds). */
  living.add('_house');
  const keys = await run('settings', 'readonly', (s) => s.getAllKeys());
  const doomed = (keys || []).filter((k) => {
    if (typeof k !== 'string' || !STORY_PREFIXED.test(k)) return false;
    const at = k.indexOf(':');
    const id = k.slice(at + 1);
    return Boolean(id) && !living.has(id);
  });
  if (!doomed.length) return 0;
  const d = await openDB();
  await new Promise((resolve, reject) => {
    const t = d.transaction('settings', 'readwrite');
    const s = t.objectStore('settings');
    for (const key of doomed) s.delete(key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  for (const key of doomed) settingsCache.delete(key);
  return doomed.length;
}

async function exportHouse() {
  const all = await run('stories', 'readonly', (s) => s.getAll());
  const ids = new Set(all.map((x) => x.id));
  /* M312: THE HOUSE'S OWN ROWS, BY KEY. The house book is a few kilobytes — connections, the shelf, the
   * house settings — and it is folded after EVERY page (a tale's update marks it). This read getAll()
   * first: every checkpoint of every tale, loaded to be thrown away by the filter below. Measured
   * at a 144 MB library, 6x CPU: 1,978 ms to write 33 KB, holding the store the rooms read from
   * (IndexedDB serializes transactions across threads) — the ledger and Settings waited behind it.
   * The keys are read alone, and only the house's rows are fetched. */
  const allKeys = (await run('settings', 'readonly', (s) => s.getAllKeys())) || [];
  /* M160: a tale-shaped row whose tale is gone is nobody's — never the
   * house's. Before this, every orphan rode _house.json on every push. */
  const houseKeys = allKeys.filter((k) => typeof k === 'string' && !STORY_ROW(k, ids) && !STORY_PREFIXED.test(k) && k !== 'booksStamp' && k !== 'booksPushing');
  const house = [];
  for (const key of houseKeys) {
    const row = await run('settings', 'readonly', (s) => s.get(key));
    if (row && typeof row.key === 'string') house.push(row);
  }
  return JSON.stringify({ namespace: NAMESPACE, kind: 'house', exportedAt: new Date().toISOString(), settings: house, connections: await run('connections', 'readonly', (s) => s.getAll()), stories: await Promise.all(all.map(async (x) => ({ id: x.id, title: x.title, createdAt: x.createdAt, updatedAt: x.updatedAt, projectId: x.projectId,
    /* M313: how many pages the tale has, so a shelf that holds only the open tale still says it truly */
    pages: x.shallow && Number.isFinite(x.pages) ? x.pages : await run('messages', 'readonly', (st) => st.index('byStory').count(x.id)).catch(() => (Number.isFinite(x.pages) ? x.pages : 0)),
    ...(typeof x.preview === 'string' && x.preview ? { preview: x.preview } : {}) }))) });
}
/* M311: A BROWSER SPEAKS ONLY FOR THE ROWS IT CHANGED. The house book was pushed WHOLE from whatever
 * this browser happened to hold — so a browser holding only part of the house (one that crashed
 * while it was first filling, a store the phone had half-evicted) pushed a book WITHOUT the rows it
 * lacked, and every other browser's next pull let those rows go (M293: "a row the book does not
 * hold is let go here"). That is how one settings row — the list of shelves — vanished from every
 * browser at once; the cast library, the rulebook and the connections stood in the same line. A
 * tale has had this guard since M188 (an empty tale never overwrites a full one); the house had none.
 *   keepWhatWasNeverLetGo(localJson, deviceJson, mine) -> { json, adopt: {settings, connections} }
 * Every settings row and connection the DEVICE holds and this browser lacks rides the push as the
 * device has it — unless this browser itself let it go (`mine`: the keys and connection ids it
 * wrote or deleted since its last push). `adopt` is what this browser was missing, for it to take
 * in. Tale-shaped rows are never the house's and are left out as before. Pure. */
export function keepWhatWasNeverLetGo(localJson, deviceJson, mine = []) {
  const local = typeof localJson === 'string' ? JSON.parse(localJson) : localJson;
  let device = null;
  try { device = typeof deviceJson === 'string' ? JSON.parse(deviceJson) : deviceJson; } catch (err) { device = null; }
  const adopt = { settings: [], connections: [] };
  if (!local || local.kind !== 'house' || !device || device.kind !== 'house') return { json: typeof localJson === 'string' ? localJson : JSON.stringify(local), adopt };
  const spoke = new Set(Array.isArray(mine) ? mine : []);
  const ids = new Set([...(local.stories || []), ...(device.stories || [])].map((x) => x && x.id).filter(Boolean));
  const haveKeys = new Set((local.settings || []).map((r) => r && r.key));
  for (const row of (device.settings || [])) {
    if (!row || typeof row.key !== 'string' || haveKeys.has(row.key) || spoke.has(row.key)) continue;
    if (STORY_ROW(row.key, ids) || STORY_PREFIXED.test(row.key) || row.key === 'booksStamp' || row.key === 'booksPushing') continue;
    adopt.settings.push(row);
  }
  const haveConn = new Set((local.connections || []).map((c) => c && c.id));
  for (const c of (device.connections || [])) {
    if (!c || typeof c.id !== 'string' || haveConn.has(c.id) || spoke.has(c.id)) continue;
    adopt.connections.push(c);
  }
  if (!adopt.settings.length && !adopt.connections.length) return { json: typeof localJson === 'string' ? localJson : JSON.stringify(local), adopt };
  const merged = { ...local, settings: [...(local.settings || []), ...adopt.settings], connections: [...(local.connections || []), ...adopt.connections] };
  return { json: JSON.stringify(merged), adopt };
}
/* what this browser was missing, taken in — never over a row it holds */
async function adoptHouseRows({ settings: rows = [], connections: conns = [] } = {}) {
  if (!rows.length && !conns.length) return 0;
  const d = await openDB();
  await new Promise((resolve, reject) => {
    const t = d.transaction(['connections', 'settings'], 'readwrite');
    const ss = t.objectStore('settings');
    for (const r of rows) if (r && typeof r.key === 'string') ss.put(r);
    const cs = t.objectStore('connections');
    for (const c of conns) if (c && c.id) cs.put(c);
    t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
  dropCaches();
  return rows.length + conns.length;
}

/* M313: THE BROWSER HOLDS THE TALE THAT IS OPEN — THE DEVICE HOLDS THE LIBRARY. A browser kept, whole and
 * for good, every tale it had ever opened: every page and every checkpoint, over a gigabyte on the
 * writer's phone, refreshed at every open. SillyTavern's shape is the other way round — the files
 * on the device ARE the library, and the browser holds what is being read. A tale that is not open
 * is let go here, but ONLY once everything this browser holds of it is PROVEN to be on the device:
 *   provenOnDevice(id, deviceBook) -> { ok, why }
 * compares every local row of the tale (its ledger, its record, its checkpoints… — read one at a
 * time, never folded into one string) and every local page against the device's book, value for
 * value. A row the device lacks, or holds differently, is NOT proven — the tale stays, and the
 * caller pushes it. The device holding MORE than this browser is fine: nothing is lost by letting go.
 *   evictStory(id) -> pages let go
 * then removes the tale's pages and rows from this browser and leaves its shelf row `shallow`, with
 * its page count and preview kept — exactly the row M189 gives a browser that has never opened the
 * tale, which fetches the book when the reader opens it, and which M188 will not let push. */
async function provenOnDevice(storyId, deviceJson) {
  let book = null;
  try { book = typeof deviceJson === 'string' ? JSON.parse(deviceJson) : deviceJson; } catch (err) { return { ok: false, why: 'the device’s book could not be read' }; }
  if (!book || book.kind !== 'story' || !book.story || book.story.id !== storyId) return { ok: false, why: 'the device’s book is not this tale’s' };
  const theirRows = new Map((book.settings || []).filter((r) => r && typeof r.key === 'string').map((r) => [r.key, JSON.stringify(r.value)]));
  const theirPages = new Map((book.messages || []).filter((m) => m && m.id).map((m) => [m.id, JSON.stringify(m)]));
  const keys = await storyKeys(storyId);
  for (const key of keys) {
    if (key === 'bookStamp:' + storyId) continue; /* the sync's own mark, never part of the tale */
    const row = await run('settings', 'readonly', (st) => st.get(key));
    if (!row) continue;
    if (!theirRows.has(key)) return { ok: false, ahead: true, why: 'the device does not hold ' + key };
    if (theirRows.get(key) !== JSON.stringify(row.value)) return { ok: false, ahead: true, why: key + ' differs on the device' };
  }
  const mine = await run('messages', 'readonly', (st) => st.index('byStory').getAll(storyId));
  for (const m of mine || []) {
    if (!theirPages.has(m.id)) return { ok: false, ahead: true, why: 'a page here is not on the device' };
    if (theirPages.get(m.id) !== JSON.stringify(m)) return { ok: false, ahead: true, why: 'a page differs on the device' };
  }
  return { ok: true, pages: (mine || []).length, rows: keys.length };
}
async function evictStory(storyId) {
  const story = await run('stories', 'readonly', (st) => st.get(storyId));
  if (!story || story.shallow) return 0;
  const keys = await storyKeys(storyId);
  const pages = await run('messages', 'readonly', (st) => st.index('byStory').getAll(storyId));
  let preview = typeof story.preview === 'string' ? story.preview : '';
  if (!preview) {
    const last = [...(pages || [])].reverse().find((m) => m && !m.hidden && typeof m.text === 'string' && m.text.trim());
    if (last) preview = last.text.trim().replace(/\s+/g, ' ').slice(0, 160);
  }
  const d = await openDB();
  await new Promise((resolve, reject) => {
    const t = d.transaction(['messages', 'settings', 'stories'], 'readwrite');
    const ms = t.objectStore('messages');
    for (const m of pages || []) ms.delete(m.id);
    const ss = t.objectStore('settings');
    for (const key of keys) ss.delete(key);
    /* the shelf row stands, untouched but for the mark: no new date, so the shelf keeps its order */
    t.objectStore('stories').put({ ...story, shallow: true, pages: (pages || []).length, ...(preview ? { preview } : {}) });
    t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
  dropCaches();
  return (pages || []).length;
}

/* M190: A TALE'S BOOK MUST NOT UNDO WHAT THE SHELF KNOWS. importStory wrote
 * `data.story` over the local row wholesale — so a title changed in this
 * browser was silently reverted the moment that tale's book was fetched (the
 * book still carried the old name, because a tale whose pages are not here
 * cannot be pushed). Renaming a tale you had not opened simply undid itself.
 * The newer row wins: if this browser's row was touched more recently than
 * the book was exported, its title and shelf stand. */
function mergeStoryRow(incoming, local) {
  if (!local) return incoming;
  const mine = Number(local.updatedAt) || 0;
  const theirs = Number(incoming && incoming.updatedAt) || 0;
  if (theirs >= mine) return { ...local, ...incoming };
  return { ...incoming, ...local };
}

/* M293: A ROW LET GO ELSEWHERE IS LET GO HERE. A pull PUT every row the book
 * carried and never removed a local row the book lacked — so a connection
 * removed in one browser, a cast member let go, the settings reset, a
 * director switched off: each stayed in the other browser, rode its next
 * push back to the device, and came home to the browser that had let it go.
 * Deletions never propagated; they resurrected. With dropMissing, a pull
 * also lets go of the rows in its scope that the book does not hold — a
 * tale's own rows for a tale, the house's rows for the house. `keep` names
 * the rows this browser changed since its last push of that book (sync.js
 * mineFor): those it neither writes over nor lets go, so a row written here
 * a moment ago is never taken by a pull. The sync's own stamps (bookStamp:)
 * are never in scope. */
async function importStory(json, { dropMissing = false, keep = [] } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.kind !== 'story' || !data.story || !data.story.id) throw new Error('not a story book');
  const id = data.story.id;
  const d = await openDB();
  /* M190: read the local row BEFORE the write, so the newer one wins. */
  const localRow = await run('stories', 'readonly', (s) => s.get(id));
  /* M293: a row this browser changed since its last push is this browser's —
   * the book does not speak for it: neither written over nor let go. */
  const mine = new Set(Array.isArray(keep) ? keep : []);
  const incoming = new Set((data.settings || []).filter((r) => r && typeof r.key === 'string').map((r) => r.key));
  const gone = dropMissing
    ? (await storyKeys(id)).filter((k) => !incoming.has(k) && !mine.has(k) && !k.startsWith('bookStamp:'))
    : [];
  await new Promise((resolve, reject) => {
    const t = d.transaction(['stories', 'messages', 'settings'], 'readwrite');
    /* the pages are here now, so it is no longer a tale we only know of */
    const merged = mergeStoryRow(data.story, localRow);
    delete merged.shallow;
    t.objectStore('stories').put(merged);
    const ms = t.objectStore('messages');
    const idx = ms.index('byStory');
    const req = idx.getAllKeys(id);
    req.onsuccess = () => { for (const k of req.result || []) ms.delete(k); for (const m of (data.messages || [])) ms.put(m); };
    const ss = t.objectStore('settings');
    for (const r of (data.settings || [])) if (r && typeof r.key === 'string' && !mine.has(r.key)) ss.put(r);
    for (const k of gone) ss.delete(k);
    t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
  dropCaches();
  return id;
}
async function importHouse(json, { dropMissing = false, keep = [] } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.kind !== 'house') throw new Error('not the house book');
  const d = await openDB();
  /* M293: rows this browser changed since its last push — settings keys and
   * connection ids — are this browser's; the book does not speak for them. */
  const mine = new Set(Array.isArray(keep) ? keep : []);
  /* M189: which tales this browser already holds, read BEFORE the write —
   * a get-then-put nested inside the transaction never landed. */
  const held = new Set((await run('stories', 'readonly', (s) => s.getAllKeys())) || []);
  const shallowHere = new Map(((await run('stories', 'readonly', (s) => s.getAll())) || []).filter((x) => x && x.shallow).map((x) => [x.id, x])); /* M313 */
  /* M293: the house's own rows this browser holds and the book does not —
   * a row is the house's when it wears no tale's suffix (a tale known here or
   * named by the book) and no tale-shaped prefix; the sync's stamps stay. */
  let goneKeys = [];
  let goneConnections = [];
  if (dropMissing) {
    const ids = new Set([...held, ...((data.stories || []).map((x) => x && x.id).filter(Boolean))]);
    const incoming = new Set((data.settings || []).filter((r) => r && typeof r.key === 'string').map((r) => r.key));
    const keys = (await run('settings', 'readonly', (s) => s.getAllKeys())) || [];
    goneKeys = keys.filter((k) => typeof k === 'string' && !incoming.has(k) && !STORY_ROW(k, ids) && !STORY_PREFIXED.test(k) && k !== 'booksStamp' && k !== 'booksPushing');
    const have = new Set((data.connections || []).map((c) => c && c.id).filter(Boolean));
    goneConnections = ((await run('connections', 'readonly', (s) => s.getAllKeys())) || []).filter((cid) => !have.has(cid));
  }
  goneKeys = goneKeys.filter((k) => !mine.has(k));
  goneConnections = goneConnections.filter((cid) => !mine.has(cid));
  await new Promise((resolve, reject) => {
    const t = d.transaction(['connections', 'settings', 'stories'], 'readwrite');
    const cs = t.objectStore('connections');
    for (const c of (data.connections || [])) if (c && c.id && !mine.has(c.id)) cs.put(c);
    for (const cid of goneConnections) cs.delete(cid);
    const ss = t.objectStore('settings');
    for (const r of (data.settings || [])) if (r && typeof r.key === 'string' && !mine.has(r.key)) ss.put(r);
    for (const k of goneKeys) ss.delete(k);
    /* M189: THE HOUSE BOOK CARRIES THE SHELF, AND IT WAS BEING THROWN AWAY.
     * exportHouse has always written the story list — id, title, when it was
     * made, which shelf it sits on — and the `stories` store was even named
     * in this transaction's scope, but nothing was ever written to it. Every
     * browser therefore had to pull EVERY TALE'S BOOK just to know what was
     * on the shelf. With the list applied here a browser knows the shelf from
     * a few kilobytes and fetches a tale's pages when the reader opens it.
     * A row that arrives this way is marked `shallow` — its pages are not
     * here yet, and M188's guard will not let it push over the device's copy.
     * A tale this browser already holds is left exactly as it stands. */
    const sts = t.objectStore('stories');
    for (const row of (data.stories || [])) {
      if (!row || typeof row.id !== 'string') continue;
      if (held.has(row.id)) {
        /* M313: a tale this browser holds only as a shelf row learns its title, shelf and page count
         * from the house — it has no pages of its own to count. A tale it holds whole is left as it stands. */
        const local = shallowHere.get(row.id);
        if (local && !mine.has(row.id)) sts.put({ ...local, ...row, shallow: true });
        continue;
      }
      sts.put({ ...row, shallow: true });
    }
    t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
  dropCaches();
}

async function importAll(json) {
  dropCaches(); /* M137: a restore replaces every row */
  let envelope;
  try {
    envelope = typeof json === 'string' ? JSON.parse(json) : json;
  } catch (err) {
    throw new Error('That file doesn’t read like a Cozy Tavern backup.');
  }
  if (!envelope || envelope.namespace !== NAMESPACE) {
    throw new Error('That file doesn’t read like a Cozy Tavern backup.');
  }
  /* M9 (B17): every row is read and checked BEFORE anything is cleared —
   * a backup with a bent row fails kindly with everything left as it was. */
  const checked = {};
  const keyOf = { settings: 'key', connections: 'id', stories: 'id', messages: 'id' };
  for (const name of STORES) {
    const rows = envelope[name] == null ? [] : envelope[name];
    if (!Array.isArray(rows)) {
      throw new Error(`That backup’s “${name}” shelf isn’t a list — nothing was touched.`);
    }
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const key = keyOf[name];
      if (!row || typeof row !== 'object' || Array.isArray(row)
        || typeof row[key] !== 'string' || !row[key]) {
        throw new Error(`Row ${i + 1} of that backup’s “${name}” shelf wouldn’t read — nothing was touched.`);
      }
    }
    if (name === 'messages') {
      for (const row of rows) {
        if (typeof row.storyId !== 'string' || !row.storyId) {
          throw new Error('A page in that backup doesn’t say which tale it belongs to — nothing was touched.');
        }
      }
    }
    checked[name] = rows;
  }
  const d = await openDB();
  await new Promise((resolve, reject) => {
    const t = d.transaction(STORES, 'readwrite');
    for (const name of STORES) {
      const s = t.objectStore(name);
      s.clear();
      dropCaches();
      for (const row of checked[name]) s.put(row);
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(isQuotaError(t.error) ? new Error(QUOTA_MESSAGE) : t.error);
    t.onabort = () => reject(isQuotaError(t.error) ? new Error(QUOTA_MESSAGE) : t.error);
  });
}

export const db = {
  settings,
  connections,
  stories,
  messages,
  projects,
  exportAll,
  importAll,
  exportStory,
  exportHouse,
  importStory,
  importHouse,
  adoptHouseRows, /* M311 */
  provenOnDevice, evictStory, /* M313 */
  sweepOrphans,
  onStorageWarning,
};
