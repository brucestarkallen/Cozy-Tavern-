/* The browser around the update (M720), for the harness: just enough of a page for js/updates.js to run in node, and
 * just enough of a service worker scope for sw.js to install and answer. Nothing here decides anything — the laws run the
 * real startUpdates and the real sw.js handlers and read what they did: what was registered, what was looked for, what
 * the page said, whether it reloaded (counted, never done), what the worker cached and answered.
 *
 * updatePage(): a page that loaded this VERSION, controlled by a worker that serves `controller` (null: no worker yet).
 * The coordinator's own timers of a second or more are kept (page.timeouts / page.intervals) and fired by the law; every
 * other timer runs (the in-memory IndexedDB answers on a zero timer). Date.now is the page's clock: page.advance(ms).
 * page.close() puts every global back. */
import { VERSION } from '../../js/version.js';
import { startUpdates } from '../../js/updates.js';

const GLOBALS = ['navigator', 'document', 'window', 'location', 'sessionStorage'];

function quietDb() {
  const book = () => ({
    async set() {}, async delete() {}, async create() { return { id: 'x' }; }, async update() {}, async remove() {},
    async append() {}, async add() {}, async list() { return []; }, async get() { return null; },
  });
  return { settings: book(), stories: book(), messages: book(), connections: book(), async importAll() {} };
}

/* a book handed to the page is a copy: startUpdates wraps the write methods of what it is given, in place */
export function copyOfDb(db) {
  const copy = (book) => Object.assign({}, book);
  return Object.assign(copy(db), { settings: copy(db.settings), stories: copy(db.stories), messages: copy(db.messages), connections: copy(db.connections) });
}

export async function updatePage({ controller = VERSION, db = quietDb(), session = new Map() } = {}) {
  const realNow = Date.now;
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  const saved = Object.fromEntries(GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let clock = realNow();
  const listeners = { document: {}, window: {}, sw: {}, registration: {}, installing: {} };
  const on = (bag) => (type, fn) => { (bag[type] = bag[type] || []).push(fn); };
  const shown = { getClientRects: () => [{}] };
  const toasts = { append(el) { page.notices.push(el); } };
  const page = {
    VERSION,
    reloads: 0,
    looks: 0,
    registered: [],
    timeouts: [],
    intervals: [],
    notices: [],
    session,
    controllerVersion: controller,
    worker: null,
    busy: false, replaying: false, syncing: false, attachment: false,
    visibility: 'visible', settingsOpen: false, open: [], focused: null,
    composer: { id: 'composer-input', tagName: 'TEXTAREA', value: '', matches: (sel) => /(^|[\s,])textarea\b/.test(sel), getClientRects: () => [{}] },
    registration: {
      waiting: null,
      installing: null,
      addEventListener: on(listeners.registration),
      async update() { page.looks += 1; },
    },
    get notice() { const n = page.notices[page.notices.length - 1]; return n ? n.textContent : ''; },
    advance(ms) { clock += ms; },
    fire(where, type, event = {}) { for (const fn of (listeners[where][type] || []).slice()) fn(event); },
    /* the kept timers of exactly `ms`, fired once each */
    async runTimers(ms) { for (const t of page.timeouts.filter((x) => x.ms === ms && !x.ran)) { t.ran = true; t.fn(); } await page.flush(); },
    async runIntervals(ms) { for (const t of page.intervals.filter((x) => x.ms === ms)) t.fn(); await page.flush(); },
    /* let the worker's answer, the page's own awaits and the zero timers run */
    async flush() { for (let i = 0; i < 12; i += 1) await new Promise((resolve) => realSetTimeout(resolve, 1)); },
    /* a new worker comes: found, installed, then active and in control (`controllerchange`: whether this page hears that) */
    async newWorker(version, { controllerchange = true } = {}) {
      const installing = { addEventListener: on(listeners.installing), postMessage() {} };
      page.registration.installing = installing;
      page.fire('registration', 'updatefound');
      page.fire('installing', 'statechange'); /* installed: the old worker still controls the page */
      await page.flush();
      page.registration.installing = null;
      page.controllerVersion = version;
      page.worker = makeWorker();
      page.fire('installing', 'statechange'); /* activated, and it claimed the page */
      if (controllerchange) page.fire('sw', 'controllerchange');
      await page.flush();
    },
    /* a worker this page never saw install (another tab found it) takes the page over: only controllerchange is heard */
    async takenOverBy(version) {
      page.controllerVersion = version;
      page.worker = makeWorker();
      page.fire('sw', 'controllerchange');
      await page.flush();
    },
    close() {
      for (const t of page.timeouts.filter((x) => x.ms === 3000 && !x.ran)) { t.ran = true; try { t.fn(); } catch (err) { /* a closed port */ } }
      Date.now = realNow;
      globalThis.setTimeout = realSetTimeout;
      globalThis.setInterval = realSetInterval;
      for (const k of GLOBALS) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    },
  };
  const makeWorker = () => ({
    postMessage(msg, ports) { if (msg && msg.kind === 'appVersion' && ports && ports[0]) ports[0].postMessage({ version: page.controllerVersion }); },
  });
  if (controller != null) page.worker = makeWorker();
  const set = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
  set('navigator', {
    serviceWorker: {
      get controller() { return page.controllerVersion == null ? null : page.worker; },
      async register(url, options) { page.registered.push({ url, options }); return page.registration; },
      addEventListener: on(listeners.sw),
    },
  });
  set('document', {
    get visibilityState() { return page.visibility; },
    get activeElement() { return page.focused; },
    body: toasts,
    createElement: (tag) => ({ tagName: String(tag).toUpperCase(), className: '', id: '', textContent: '', attributes: {}, setAttribute(k, v) { this.attributes[k] = String(v); } }),
    getElementById: (id) => (id === 'toasts' ? toasts : id === 'composer-input' ? page.composer : null),
    querySelector: (sel) => (/^#view-settings/.test(sel) && page.settingsOpen ? shown : null),
    querySelectorAll: () => page.open,
    addEventListener: on(listeners.document),
  });
  set('window', { addEventListener: on(listeners.window) });
  set('location', { protocol: 'http:', reload() { page.reloads += 1; } });
  set('sessionStorage', { getItem: (k) => (page.session.has(k) ? page.session.get(k) : null), setItem: (k, v) => { page.session.set(k, String(v)); } });
  Date.now = () => clock;
  /* only the coordinator's own timers are kept; anything else (a job some earlier law left running) keeps real time */
  const fromUpdates = () => /\/js\/updates\.js/.test(String(new Error().stack));
  globalThis.setTimeout = (fn, ms, ...rest) => (Number(ms) >= 1000 && fromUpdates() ? (page.timeouts.push({ fn, ms: Number(ms) }), { kept: true }) : realSetTimeout(fn, ms, ...rest));
  globalThis.setInterval = (fn, ms, ...rest) => (fromUpdates() ? (page.intervals.push({ fn, ms: Number(ms) }), { kept: true }) : realSetInterval(fn, ms, ...rest));
  page.ctx = {
    db,
    chat: { isBusy: () => page.busy, isReplaying: () => page.replaying, hasDraft: () => Boolean(page.composer.value) || page.attachment },
    booksStatus: { updateBlocked: () => page.syncing },
  };
  try {
    page.updates = startUpdates(page.ctx);
    await page.flush();
  } catch (err) { page.close(); throw err; }
  return page;
}

/* sw.js in a scope of its own: `self`, `caches` and `Request` as a worker has them. `unreachable`: shell files that will
 * not come. Each call loads the worker afresh (its handlers are bound to this scope). */
let scopes = 0;
export async function serviceWorkerScope({ unreachable = [] } = {}) {
  const names = ['self', 'caches', 'Request'];
  const saved = Object.fromEntries(names.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const scope = { log: [], handlers: {}, opened: [], added: [] };
  const cache = {
    async add(request) {
      scope.log.push('add');
      scope.added.push({ url: request.url, cache: request.cache });
      if (unreachable.includes(request.url)) throw new TypeError('Failed to fetch ' + request.url);
    },
    async addAll() { scope.log.push('addAll'); throw new TypeError('all or nothing'); },
    async keys() { return []; }, async delete() { return true; }, async put() {},
  };
  const set = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
  set('caches', { async open(name) { scope.log.push('open'); scope.opened.push(name); return cache; }, async keys() { return []; }, async delete() { return true; }, async match() { return undefined; } });
  set('Request', class { constructor(url, init = {}) { this.url = String(url); this.cache = init.cache; } });
  set('self', {
    addEventListener(type, fn) { scope.handlers[type] = fn; },
    skipWaiting() { scope.log.push('skipWaiting'); return Promise.resolve(); },
    clients: { async claim() { scope.log.push('claim'); } },
    location: { origin: 'http://127.0.0.1:8080' },
  });
  scope.close = () => { for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; } };
  try { await import('../../sw.js?scope=' + (scopes += 1)); } catch (err) { scope.close(); throw err; }
  scope.install = async () => { let waited = null; scope.handlers.install({ waitUntil(p) { waited = p; } }); return waited; };
  scope.message = (data) => { const replies = []; scope.handlers.message({ data, ports: [{ postMessage: (m) => replies.push(m) }] }); return replies; };
  return scope;
}
