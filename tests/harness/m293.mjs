/* M293 — the audit: a stopped queue settles what it drops; a sync ask waits
 * for its own answer; a pull lets go of what another browser let go. Every
 * law here RUNS the feature and reads what came back. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { enqueueWork, stopWork, queuedCount } from '../../js/agents/queue.js';
import { noteWork, pendingWork } from '../../js/agents/extractor.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('M293-1: a job the writer’s Stop drops is settled — pendingWork is not held for the rest of the session', async () => {
  const storyId = 'm293-stop';
  let release = null;
  const first = enqueueWork(storyId, { name: 'keeper', run: ({ signal }) => new Promise((resolve, reject) => {
    release = resolve;
    signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })));
  }) });
  const second = enqueueWork(storyId, { name: 'auditor', run: async () => ({ silent: true }) });
  const third = enqueueWork(storyId, { name: 'checkpoint', run: async () => ({ silent: true }) });
  noteWork(storyId, first); noteWork(storyId, second); noteWork(storyId, third);
  await tick(20);
  eq(queuedCount(storyId), 2, 'two wait behind the one in flight');
  const t0 = Date.now();
  const stopped = stopWork(storyId);
  assert(stopped, 'the stop found work to stop');
  eq(queuedCount(storyId), 0, 'the queue is emptied');
  const outcomes = await Promise.race([
    Promise.all([first, second, third]),
    tick(2000).then(() => 'hung'),
  ]);
  assert(outcomes !== 'hung', 'every dropped job’s promise settles (it used to hang for ever)');
  eq(outcomes[0].stopped, true, 'the one in flight was stopped by hand');
  eq(outcomes[1].stopped, true, 'a dropped job says it was stopped');
  eq(outcomes[2].stopped, true, 'and the next');
  assert(outcomes.every((o) => o.ok === false), 'none of them claims to have run');
  /* the send path's courtesy wait must come back at once, not after its ceiling */
  const t1 = Date.now();
  const waited = await pendingWork(storyId, 1500);
  const took = Date.now() - t1;
  assert(took < 700, 'pendingWork returns at once after a stop — took ' + took + 'ms (it used to wait the whole ceiling, every time)');
  eq(waited, false, 'nothing is pending any more');
  assert(Date.now() - t0 < 3000, 'the whole stop settled in time');
  if (release) release({ silent: true });
});

/* A worker that answers questions side by side, the way the real one does —
 * and answers them in whichever order the test decides. */
function makeFakeWorkerHost() {
  const asked = [];
  const listeners = new Set();
  class FakeWorker {
    constructor() { this.listeners = listeners; }
    postMessage(m) { asked.push(m); }
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn); }
    removeEventListener(type, fn) { listeners.delete(fn); }
  }
  const answer = (data) => { for (const fn of [...listeners]) fn({ data }); };
  return { FakeWorker, asked, answer };
}

test('M293-2: a sync ask waits for ITS OWN answer — two pulls in flight no longer both resolve on the first `pulledOne`', async () => {
  const host = makeFakeWorkerHost();
  const saved = { Worker: globalThis.Worker, document: globalThis.document, window: globalThis.window, EventSource: globalThis.EventSource, location: globalThis.location };
  const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } };
  globalThis.Worker = host.FakeWorker;
  globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
  globalThis.window = { addEventListener() {} };
  delete globalThis.EventSource;
  try {
    const { initSync } = await import('../../js/sync.js');
    const ctx = { db, toast() {}, getActiveStoryId: () => null, chat: null };
    const statusP = initSync(ctx);
    await tick(10);
    const boot = host.asked.find((m) => m.kind === 'boot');
    assert(boot, 'the room asks the worker to boot');
    host.answer({ kind: 'boot', reachable: true, pulled: 0, pushed: 0, recent: [], rid: boot.rid });
    const status = await statusP;
    assert(typeof status.fetchStory === 'function', 'the live mirror is up');
    let aDone = false; let bDone = false;
    const a = status.fetchStory('tale-a').then((r) => { aDone = true; return r; });
    const b = status.fetchStory('tale-b').then((r) => { bDone = true; return r; });
    await tick(10);
    const askA = host.asked.find((m) => m.kind === 'pullOne' && m.id === 'tale-a');
    const askB = host.asked.find((m) => m.kind === 'pullOne' && m.id === 'tale-b');
    assert(askA && askB, 'each pull is asked');
    /* the second pull answers first — the way a small house book lands before a long tale */
    host.answer({ kind: 'pulledOne', pulled: 1, recent: [], rid: askB.rid });
    await tick(20);
    eq(bDone, true, 'B’s pull resolved on B’s answer');
    eq(aDone, false, 'A’s pull did NOT resolve on B’s answer (it used to — and painted a tale whose pages had not landed)');
    assert(Number.isInteger(askA.rid) && Number.isInteger(askB.rid) && askA.rid !== askB.rid, 'each pull asks with its own id');
    /* a worker error for some other question settles nothing else either */
    host.answer({ kind: 'error', words: 'nope', rid: 999999 });
    await tick(20);
    eq(aDone, false, 'a stray error is not A’s answer');
    host.answer({ kind: 'pulledOne', pulled: 1, recent: [], rid: askA.rid });
    await tick(20);
    eq(aDone, true, 'A resolves on its own answer');
    eq(await a, true); eq(await b, true);
    /* M293: a live announcement from another browser marks the tale as another hand's;
     * a pull's `recent` marks the tale it pulled */
    eq(status.wroteElsewhereAt('tale-a'), 0, 'nothing marked a tale nobody else touched');
    const c = status.fetchStory('tale-c');
    await tick(10);
    const askC = host.asked.find((m) => m.kind === 'pullOne' && m.id === 'tale-c');
    host.answer({ kind: 'pulledOne', pulled: 1, recent: ['tale-c'], rid: askC.rid });
    await c;
    assert(status.wroteElsewhereAt('tale-c') > Date.now() - 2000, 'a tale that moved on the device just now is marked as another hand’s');
  } finally { restore(); }
});

test('M293-3: a pull lets go of the rows another browser let go — the house’s connections and settings, a tale’s own rows — never a row still waiting to be pushed', async () => {
  /* the house */
  const keep = await db.connections.add({ label: 'kept', type: 'openai', baseUrl: 'https://a', apiKey: 'k', model: 'm' });
  const doomed = await db.connections.add({ label: 'let go elsewhere', type: 'openai', baseUrl: 'https://b', apiKey: 'k', model: 'm' });
  await db.settings.set('theme', 'deep');
  await db.settings.set('cast:card-gone', { id: 'card-gone', name: 'A card let go elsewhere' });
  await db.settings.set('bookStamp:_house', '2026-01-01T00:00:00.000Z');
  const localTale = await db.stories.create({ title: 'a tale only this browser has' });
  await db.settings.set('state:' + localTale.id, { present: [] });
  const house = JSON.parse(await db.exportHouse());
  /* another browser's house book: the connection and the card are gone, the theme stands */
  const theirs = { ...house, connections: house.connections.filter((c) => c.id !== doomed.id), settings: house.settings.filter((r) => r.key !== 'cast:card-gone') };
  await db.importHouse(JSON.stringify(theirs), { dropMissing: false });
  assert((await db.connections.list()).some((c) => c.id === doomed.id), 'without dropMissing the old law stands: nothing is let go');
  await db.importHouse(JSON.stringify(theirs), { dropMissing: true });
  const conns = await db.connections.list();
  assert(conns.some((c) => c.id === keep.id), 'the connection the book holds stays');
  assert(!conns.some((c) => c.id === doomed.id), 'the connection let go elsewhere is let go here');
  eq(await db.settings.get('cast:card-gone'), undefined, 'a cast card let go elsewhere is let go here');
  eq(await db.settings.get('theme'), 'deep', 'a house setting the book holds stays');
  eq(await db.settings.get('bookStamp:_house'), '2026-01-01T00:00:00.000Z', 'the sync’s own stamp is never in scope');
  assert(await db.settings.get('state:' + localTale.id), 'a tale this browser holds keeps its own rows — the house book does not speak for them');
  /* a tale */
  const tale = await db.stories.create({ title: 'a shared tale' });
  await db.messages.append(tale.id, { role: 'user', text: 'page one' });
  await db.settings.set('state:' + tale.id, { present: [{ name: 'Mara' }] });
  await db.settings.set('director:' + tale.id, { text: 'an old directive' });
  await db.settings.set('bookStamp:' + tale.id, '2026-01-01T00:00:00.000Z');
  const book = JSON.parse(await db.exportStory(tale.id));
  const theirTale = { ...book, settings: book.settings.filter((r) => r.key !== 'director:' + tale.id) };
  await db.importStory(JSON.stringify(theirTale), { dropMissing: false });
  assert(await db.settings.get('director:' + tale.id), 'without dropMissing the director stays');
  await db.importStory(JSON.stringify(theirTale), { dropMissing: true });
  eq(await db.settings.get('director:' + tale.id), undefined, 'the director switched off elsewhere is off here');
  assert(await db.settings.get('state:' + tale.id), 'the ledger the book holds stays');
  eq(await db.settings.get('bookStamp:' + tale.id), '2026-01-01T00:00:00.000Z', 'the tale’s stamp is never in scope');
  eq((await db.messages.list(tale.id)).length, 1, 'the pages are the book’s');
  /* a row this browser changed since its last push is its own: neither let go nor written over */
  await db.settings.set('director:' + tale.id, { text: 'written here a moment ago' });
  await db.settings.set('state:' + tale.id, { present: [{ name: 'Mara' }, { name: 'Tomas' }] });
  await db.importStory(JSON.stringify(theirTale), { dropMissing: true, keep: ['director:' + tale.id, 'state:' + tale.id] });
  eq((await db.settings.get('director:' + tale.id)).text, 'written here a moment ago', 'a row written here since the last push is kept though the book lacks it');
  eq((await db.settings.get('state:' + tale.id)).present.length, 2, 'and a row written here is not written over by the book’s older copy');
  const mineConn = await db.connections.add({ label: 'made here just now', type: 'openai', baseUrl: 'https://c', apiKey: 'k', model: 'm' });
  await db.settings.set('theme', 'light');
  await db.importHouse(JSON.stringify(theirs), { dropMissing: true, keep: [mineConn.id, 'theme'] });
  assert((await db.connections.list()).some((c) => c.id === mineConn.id), 'a connection made here since the last push survives a pull of a house book that lacks it');
  eq(await db.settings.get('theme'), 'light', 'and a house setting changed here is not written over');
});
