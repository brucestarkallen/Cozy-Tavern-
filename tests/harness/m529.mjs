/* Cozy Tavern — harness laws of M529: two workers at once (his question: "can the workers be made faster — a setting to
 * use more than one request at once?"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { enqueueWork, setSideBySide, queuedCount, workIsRunning, stopWork, switchWorkerStory } from '../../js/agents/queue.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const job = (log, name, ms) => ({ name, run: async ({ signal }) => { log.push(name + '>'); await Promise.race([wait(ms), new Promise((_, rej) => signal && signal.addEventListener('abort', () => rej(Object.assign(new Error('stopped'), { name: 'AbortError' }))))]); log.push('<' + name); return { silent: true }; } });

test('M529-1 OFF (AS IT SHIPS): ONE LANE — every worker waits for the one before, side or not, exactly as before', async () => {
  switchWorkerStory('t-off');
  setSideBySide(false);
  const log = [];
  const t0 = Date.now();
  await Promise.all([enqueueWork('t-off', { ...job(log, 'extractor', 120), lane: 'main' }), enqueueWork('t-off', { ...job(log, 'keeper', 120), lane: 'side' })]);
  eq(log.join(' '), 'extractor> <extractor keeper> <keeper', 'one after the other');
  assert(Date.now() - t0 >= 230, 'the sum of both');
});

test('M529-2 ON: THE SIDE LANE RUNS BESIDE THE MAIN ONE — each lane keeps its own order, the page\'s workers finish in the time of the longer lane; the counts and the running light see both lanes', async () => {
  switchWorkerStory('t-on');
  setSideBySide(true);
  const log = [];
  const t0 = Date.now();
  const all = [enqueueWork('t-on', { ...job(log, 'extractor', 150), lane: 'main' }), enqueueWork('t-on', { ...job(log, 'keeper', 150), lane: 'side' }), enqueueWork('t-on', { ...job(log, 'scribe', 150), lane: 'main' }), enqueueWork('t-on', { ...job(log, 'essentials', 150), lane: 'side' })];
  await wait(20);
  eq(queuedCount('t-on'), 2, 'both lanes counted (one waiting in each)');
  assert(workIsRunning('t-on'), 'running');
  await Promise.all(all);
  const took = Date.now() - t0;
  assert(log.indexOf('keeper>') < log.indexOf('<extractor'), 'the keeper started while the extractor was still reading: ' + log.join(' '));
  assert(log.indexOf('<extractor') < log.indexOf('scribe>') && log.indexOf('<keeper') < log.indexOf('essentials>'), 'each lane in its own order');
  assert(took < 450, 'about the time of one lane (two jobs), not all four: ' + took + ' ms');
  assert(!workIsRunning('t-on') && queuedCount('t-on') === 0, 'and settled');
  setSideBySide(false);
});

test('M529-3 A STOP REACHES BOTH LANES — the job in flight in each is aborted and everything queued in each is dropped; a story switch purges both', async () => {
  switchWorkerStory('t-stop');
  setSideBySide(true);
  const log = [];
  const all = [enqueueWork('t-stop', { ...job(log, 'extractor', 2000), lane: 'main' }), enqueueWork('t-stop', { ...job(log, 'keeper', 2000), lane: 'side' }), enqueueWork('t-stop', { ...job(log, 'scribe', 50), lane: 'main' }), enqueueWork('t-stop', { ...job(log, 'plans', 50), lane: 'side' })];
  await wait(30);
  assert(stopWork('t-stop'), 'there was work to stop');
  const out = await Promise.all(all);
  eq(out.filter((o) => o && o.stopped).length, 4, 'all four settled as stopped');
  assert(!log.includes('scribe>') && !log.includes('plans>'), 'nothing queued started');
  assert(!workIsRunning('t-stop'), 'nothing running');
  const left = [enqueueWork('t-stop', { ...job(log, 'scribe', 500), lane: 'main' }), enqueueWork('t-stop', { ...job(log, 'plans', 500), lane: 'side' }), enqueueWork('t-stop', { ...job(log, 'world', 10), lane: 'main' }), enqueueWork('t-stop', { ...job(log, 'ground', 10), lane: 'side' })];
  await wait(20);
  switchWorkerStory('another');
  const out2 = await Promise.all(left);
  assert(out2.filter((o) => o && o.stale).length >= 2, 'a story switch leaves both lanes\' waiting work behind: ' + JSON.stringify(out2));
  setSideBySide(false);
});
