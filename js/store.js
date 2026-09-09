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

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const settings = {
  async get(key) {
    const row = await run('settings', 'readonly', (s) => s.get(key));
    return row ? row.value : undefined;
  },
  async set(key, val) {
    await run('settings', 'readwrite', (s) => s.put({ key, value: val }));
    return val;
  },
  /* Additive helpers (M7, see header): list every key (the cast library
   * lists its `cast:` shelf this way), and let a key go for good. */
  async keys() {
    const rows = await run('settings', 'readonly', (s) => s.getAll());
    return rows.map((row) => row.key);
  },
  async delete(key) {
    await run('settings', 'readwrite', (s) => s.delete(key));
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
    /* M8.5: the thinking voice — {effort:'low|medium|high', budgetTokens?}.
     * 'off' (or absence) sends nothing. */
    if (conn.reasoning && typeof conn.reasoning === 'object') row.reasoning = conn.reasoning;
    await run('connections', 'readwrite', (s) => s.put(row));
    return row;
  },
  async update(id, patch) {
    const row = await run('connections', 'readonly', (s) => s.get(id));
    if (!row) return undefined;
    /* M8: a null in the patch lets the dial go entirely — the providers
     * read absence as "the storyteller's own default". */
    const clean = {};
    for (const [key, value] of Object.entries(patch || {})) {
      if (value === null) delete row[key];
      else clean[key] = value;
    }
    const next = { ...row, ...clean, id: row.id };
    await run('connections', 'readwrite', (s) => s.put(next));
    return next;
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
  async create({ title, projectId } = {}) {
    const now = Date.now();
    const row = {
      id: uid(),
      title: (title && title.trim()) || 'An untitled tale',
      createdAt: now,
      updatedAt: now,
    };
    /* M16: a tale may begin already resting on a shelf. */
    if (typeof projectId === 'string' && projectId) row.projectId = projectId;
    await run('stories', 'readwrite', (s) => s.put(row));
    return row;
  },
  /* Additive helper (see header): rename / per-story frame & note overrides. */
  async update(id, patch) {
    const row = await run('stories', 'readonly', (s) => s.get(id));
    if (!row) return undefined;
    const next = { ...row, ...patch, id: row.id, updatedAt: Date.now() };
    await run('stories', 'readwrite', (s) => s.put(next));
    return next;
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
      t.oncomplete = () => resolve();
      t.onerror = () => reject(isQuotaError(t.error) ? new Error(QUOTA_MESSAGE) : t.error);
    });
    await run('settings', 'readwrite', (s) => s.delete('state:' + id));
    /* M6: the keeper's folded pages go with the story too. */
    await run('settings', 'readwrite', (s) => s.delete('memory:' + id));
    /* M7: and its lore shelf as well. The cast library stays — it's
     * app-wide, and other stories may still be carrying those cards. */
    await run('settings', 'readwrite', (s) => s.delete('lore:' + id));
    /* M9: and the workers' ledger line goes with the story too. */
    await run('settings', 'readwrite', (s) => s.delete('workers:' + id));
  },
};

const messages = {
  async list(storyId) {
    const d = await openDB();
    const rows = await new Promise((resolve, reject) => {
      const t = d.transaction('messages', 'readonly');
      const idx = t.objectStore('messages').index('byStory');
      const req = idx.getAll(storyId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
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
          if (s.receipt && typeof s.receipt === 'object') swipe.receipt = s.receipt;
          return swipe;
        });
      if (row.swipes.length) {
        const idx = Number.isFinite(msg.swipeIdx) ? Math.round(msg.swipeIdx) : row.swipes.length - 1;
        row.swipeIdx = Math.min(row.swipes.length - 1, Math.max(0, idx));
        const shown = row.swipes[row.swipeIdx];
        row.text = shown.text;
        if (shown.thinking) row.thinking = shown.thinking;
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
    await run('messages', 'readwrite', (s) => s.put(row));
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
    const all = await messages.list(storyId);
    const found = all.find((m) => m.id === messageId);
    if (!found) return undefined;
    const next = { ...found, ...(patch || {}), id: found.id, storyId: found.storyId };
    await run('messages', 'readwrite', (s) => s.put(next));
    return next;
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
      t.oncomplete = () => { checkStorage(); resolve(); };
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
    const d = await openDB();
    await new Promise((resolve, reject) => {
      const t = d.transaction('messages', 'readwrite');
      const s = t.objectStore('messages');
      for (const m of doomed) s.delete(m.id);
      t.oncomplete = () => resolve();
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

async function importAll(json) {
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
  onStorageWarning,
};
