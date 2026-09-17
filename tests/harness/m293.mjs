/* M293 — the audit: a stopped queue settles what it drops; a sync ask waits
 * for its own answer; a pull lets go of what another browser let go. Every
 * law here RUNS the feature and reads what came back. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
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
