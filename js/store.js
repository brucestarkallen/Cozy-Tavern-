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
async function run(storeName, mode, build) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(storeName, mode);
    const request = build(t.objectStore(storeName));
    t.oncomplete = () => resolve(request ? request.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
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
    await run('connections', 'readwrite', (s) => s.put(row));
    return row;
  },
  async update(id, patch) {
    const row = await run('connections', 'readonly', (s) => s.get(id));
    if (!row) return undefined;
    const next = { ...row, ...patch, id: row.id };
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
  async create({ title } = {}) {
    const now = Date.now();
    const row = {
      id: uid(),
      title: (title && title.trim()) || 'An untitled tale',
      createdAt: now,
      updatedAt: now,
    };
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
      t.onerror = () => reject(t.error);
    });
    await run('settings', 'readwrite', (s) => s.delete('state:' + id));
    /* M6: the keeper's folded pages go with the story too. */
    await run('settings', 'readwrite', (s) => s.delete('memory:' + id));
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
    await run('messages', 'readwrite', (s) => s.put(row));
    // Touch the story so last-active sorting stays honest.
    const story = await stories.get(storyId);
    if (story) await stories.update(storyId, {});
    return row;
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
      t.onerror = () => reject(t.error);
    });
    return doomed.length;
  },
};

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
  const d = await openDB();
  await new Promise((resolve, reject) => {
    const t = d.transaction(STORES, 'readwrite');
    for (const name of STORES) {
      const s = t.objectStore(name);
      s.clear();
      const rows = Array.isArray(envelope[name]) ? envelope[name] : [];
      for (const row of rows) s.put(row);
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  settings,
  connections,
  stories,
  messages,
  exportAll,
  importAll,
};
