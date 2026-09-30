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

import { setTooManyHandler, refusedAsTooMany, sideBySideOn, setSleepForHarness } from '../../js/agents/queue.js';

test('M530-1 THE PROVIDER TURNS AWAY TWO AT ONCE: with both lanes in flight, a call refused as too many puts the house back to one at a time by itself — the handler is told once, the side lane\'s waiting workers join the main lane in order, and the refused call is tried again and lands', async () => {
  switchWorkerStory('t-429');
  setSideBySide(true);
  setSleepForHarness(() => Promise.resolve()); /* the waits between tries, instant here */
  const told = [];
  setTooManyHandler((err) => told.push(err.status));
  const log = [];
  let tries = 0;
  const refusedOnce = { name: 'keeper', lane: 'side', run: async () => { tries += 1; log.push('keeper>' + tries); await wait(30); if (tries === 1) throw Object.assign(new Error('Too Many Requests'), { status: 429 }); log.push('<keeper'); return { silent: true }; } };
  const all = [enqueueWork('t-429', { ...job(log, 'extractor', 200), lane: 'main' }), enqueueWork('t-429', refusedOnce), enqueueWork('t-429', { ...job(log, 'essentials', 20), lane: 'side' }), enqueueWork('t-429', { ...job(log, 'scribe', 20), lane: 'main' })];
  const out = await Promise.all(all);
  eq(sideBySideOn(), false, 'back to one at a time');
  eq(JSON.stringify(told), '[429]', 'the handler was told once');
  assert(out.every((o) => o && o.ok), 'every worker landed: ' + JSON.stringify(out));
  assert(log.includes('<keeper') && tries === 2, 'the refused call was tried again and landed');
  assert(log.indexOf('<scribe') < log.indexOf('essentials>'), 'the side lane\'s waiting worker joined the main lane, after what was already there: ' + log.join(' '));
  setTooManyHandler(null);
  setSleepForHarness((ms) => new Promise((r) => setTimeout(r, ms))); /* the real waits back, for every law after this one */
  setSideBySide(false);
});

test('M530-2 NOT EVERY REFUSAL IS "TOO MANY AT ONCE": a 429 with only one lane in flight leaves two at once on; the words that mean too many are known', async () => {
  switchWorkerStory('t-429b');
  setSideBySide(true);
  setSleepForHarness(() => Promise.resolve());
  let n = 0;
  await enqueueWork('t-429b', { name: 'keeper', lane: 'side', run: async () => { n += 1; if (n === 1) throw Object.assign(new Error('busy'), { status: 429 }); return { silent: true }; } });
  eq(sideBySideOn(), true, 'one in flight: a plain busy, not a refusal of two');
  for (const yes of [{ status: 429 }, { message: 'Too many concurrent requests' }, { message: 'rate limit exceeded' }]) eq(refusedAsTooMany(yes), true, JSON.stringify(yes));
  for (const no of [{ status: 500 }, { message: 'timeout' }, { status: 401 }]) eq(refusedAsTooMany(no), false, JSON.stringify(no));
  setSideBySide(false);
  setSleepForHarness((ms) => new Promise((r) => setTimeout(r, ms)));
});
