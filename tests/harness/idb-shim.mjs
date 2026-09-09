/* An in-memory IndexedDB good enough for store.js: open with
 * onupgradeneeded, transactions, put/get/getAll/getAllKeys/delete/clear,
 * and the messages store's byStory index. Writes can be told to fail with
 * QuotaExceededError (the quota-guard harness). */
const KEY_PATHS = { settings: 'key', connections: 'id', stories: 'id', messages: 'id' };
const INDEX_KEY_PATHS = { byStory: 'storyId' };
const stores = {};
for (const n of Object.keys(KEY_PATHS)) stores[n] = new Map();
let failBudget = 0;
export function failWritesWithQuota(n) { failBudget = n == null ? Infinity : n; }
export function clearQuotaFailure() { failBudget = 0; }

function makeReq(result) {
  const r = { result, error: null, onsuccess: null, onerror: null };
  setTimeout(() => { if (r.onsuccess) r.onsuccess(); }, 0);
  return r;
}
class FakeStore {
  constructor(name, tx) { this.name = name; this.tx = tx; }
  _fail() {
    if (failBudget > 0) {
      failBudget -= 1;
      this.tx._fail(new DOMException('The shelf is full.', 'QuotaExceededError'));
      return true;
    }
    return false;
  }
  put(row) { if (!this._fail()) stores[this.name].set(row[KEY_PATHS[this.name]], structuredClone(row)); return makeReq(row[KEY_PATHS[this.name]]); }
  get(key) { const v = stores[this.name].get(key); return makeReq(v === undefined ? undefined : structuredClone(v)); }
  getAll() { return makeReq([...stores[this.name].values()].map((v) => structuredClone(v))); }
  getAllKeys() { return makeReq([...stores[this.name].keys()]); }
  delete(key) { if (!this._fail()) stores[this.name].delete(key); return makeReq(undefined); }
  clear() { if (!this._fail()) stores[this.name].clear(); return makeReq(undefined); }
  index(indexName) {
    const storeName = this.name;
    const keyPath = INDEX_KEY_PATHS[indexName] || indexName;
    return {
      getAll: (v) => makeReq([...stores[storeName].values()].filter((r) => r && r[keyPath] === v).map((x) => structuredClone(x))),
      /* M14: the shelf's page counts ride this. */
      count: (v) => makeReq([...stores[storeName].values()].filter((r) => r && r[keyPath] === v).length),
    };
  }
}
class FakeTx {
  constructor() { this.error = null; this._failed = false; }
  objectStore(name) { return new FakeStore(name, this); }
  _fail(err) { this._failed = true; this.error = err; }
}
globalThis.indexedDB = {
  open() {
    const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    setTimeout(() => {
      const db = {
        objectStoreNames: { contains: () => false },
        createObjectStore(n) { if (!stores[n]) stores[n] = new Map(); return { createIndex() {} }; },
        transaction() {
          const tx = new FakeTx();
          setTimeout(() => {
            if (tx._failed) { if (tx.onabort) tx.onabort(); else if (tx.onerror) tx.onerror(); }
            else if (tx.oncomplete) tx.oncomplete();
          }, 0);
          return tx;
        },
      };
      req.result = db;
      if (req.onupgradeneeded) req.onupgradeneeded();
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  },
};
