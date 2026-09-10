/* Cozy Tavern — agents/queue.js
 * The workers' channel (M12, SPEC §5). One exclusive channel per story:
 * background jobs run SEQUENTIALLY, never concurrently, in the order they
 * were queued. Each queued job captures the house's epoch; a story switch
 * bumps the epoch and purges every pending job, and a job that wakes up
 * stale is quietly let go — its results never reach a story the writer has
 * already left.
 *
 * Discipline:
 *   - per-call hard timeout, 60 seconds (agents/status.js workerSignal)
 *   - on failure, up to 5 retries with exponential backoff — 2s, 4s, 8s,
 *     16s, 32s, capped at 60s — honoring Retry-After when the house the
 *     worker called asked for longer (an error may carry retryAfterMs)
 *   - every failure lands on the drawer's workers line with one plain word
 *     of why (agents/status.js noteWorkerRun); successes are noted too
 *
 * Never throws into the chat path: enqueueWork resolves {ok, ...} whatever
 * happens. A job's run({signal, stale}) should check stale() before
 * committing results — a stale job's work is discarded, not written.
 */

import { workerSignal, noteWorkerRun, markWorkerRunning } from './status.js';

export const MAX_RETRIES = 5;          /* retries after the first try */
export const BACKOFF_BASE_MS = 2000;   /* the first wait */
export const BACKOFF_CAP_MS = 60000;   /* no wait grows past a minute */

/* The house's clock of attention: bumped on every story switch. */
let epoch = 0;
let activeStoryId = null;
const queues = new Map();   // storyId -> job[]
const running = new Map();  // storyId -> boolean

/* The wait between tries, injectable so the harness can watch the schedule
 * without watching the clock. */
let sleepImpl = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
export function setSleepForHarness(fn) {
  sleepImpl = typeof fn === 'function' ? fn : (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
}

/* The backoff schedule (SPEC: 2s → 60s, exponential). attempt is how many
 * tries have failed so far (the first failure waits 2s). Retry-After sets
 * a floor: a house that asks for a longer wait is honored, even past the
 * cap; the cap governs only our own exponential. */
export function backoffMs(attempt, retryAfterMs) {
  const own = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * (2 ** Math.max(0, attempt - 1)));
  const asked = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 0;
  return Math.max(own, asked);
}

/* One plain word of why, for the workers line. */
function plainWhy(err) {
  const msg = err && err.message ? String(err.message) : '';
  if (msg === 'timeout' || (err && err.name === 'AbortError')) return 'outwaited';
  return msg || 'stumbled';
}

/* A story switch: the pending queue is purged and the epoch turns, so
 * anything still in flight for the story the writer left knows its results
 * are no longer wanted.
 *
 * M33: NOT wired to the app, on purpose. It was imported by app.js from M12
 * and never called; wiring it would throw away the ledger writes of the
 * story the writer just left — a chain finishing for tale A while tale B
 * is open should still land in tale A (the queue is per story, and every
 * job re-checks its page is still there before writing). Kept for the
 * harness and for a future "abandon this tale's workers" control. */
export function switchWorkerStory(storyId) {
  if (activeStoryId === storyId) return;
  activeStoryId = storyId || null;
  epoch += 1;
  /* Purge the pending queues — and settle every purged job's promise as
   * stale, so nothing awaiting it hangs. */
  for (const list of queues.values()) {
    for (const job of list) {
      try {
        job.resolve({ ok: false, stale: true, why: 'left behind' });
      } catch (err) { /* a resolver that can't settle is no one's trouble */ }
    }
  }
  queues.clear();
}

/* Queue a job on a story's channel. job = {name, run({signal, stale})}.
 * Resolves {ok:true, value} | {ok:true, stale:true} | {ok:false, why} —
 * never rejects. The name must be one the workers' ledger knows. */
export function enqueueWork(storyId, job) {
  if (!storyId || !job || typeof job.run !== 'function') {
    return Promise.resolve({ ok: false, why: 'misshapen' });
  }
  const entry = { ...job, storyId, epoch };
  let list = queues.get(storyId);
  if (!list) { list = []; queues.set(storyId, list); }
  return new Promise((resolve) => {
    entry.resolve = resolve;
    list.push(entry);
    drain(storyId);
  });
}

async function drain(storyId) {
  if (running.get(storyId)) return;
  running.set(storyId, true);
  try {
    for (;;) {
      const list = queues.get(storyId);
      if (!list || !list.length) break;
      const job = list.shift();
      job.resolve(await runJob(job));
    }
  } finally {
    running.set(storyId, false);
    /* A job queued while the finally settled still gets its turn. */
    const list = queues.get(storyId);
    if (list && list.length) drain(storyId);
  }
}

async function runJob(job) {
  const { storyId, name } = job;
  const isStale = () => job.epoch !== epoch;
  /* A job queued for a story the writer has since left never starts. */
  if (isStale()) return { ok: false, stale: true, why: 'left behind' };

  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await sleepImpl(backoffMs(attempt, lastErr && lastErr.retryAfterMs));
      if (isStale()) return { ok: false, stale: true, why: 'left behind' };
    }
    const { signal, done } = workerSignal();
    markWorkerRunning(storyId, name, true); /* M46: "reading now…" on the workers line */
    try {
      const value = await job.run({ signal, stale: isStale });
      done();
      markWorkerRunning(storyId, name, false);
      if (isStale()) return { ok: false, stale: true, why: 'left behind' };
      /* The job may ask for silence (a switch was off, nothing to note);
       * every honest run is otherwise written on the workers line. */
      if (!value || value.silent !== true) {
        await noteWorkerRun(storyId, name, { ok: true, detail: value && value.detail, raw: value && value.raw });
      }
      return { ok: true, value };
    } catch (err) {
      done();
      markWorkerRunning(storyId, name, false);
      lastErr = err;
      if (isStale()) return { ok: false, stale: true, why: 'left behind' };
    }
  }
  const why = plainWhy(lastErr);
  await noteWorkerRun(storyId, name, { ok: false, why, raw: lastErr && typeof lastErr.raw === 'string' ? lastErr.raw : '' });
  return { ok: false, why };
}

/* Harness window: how many jobs wait on a story's channel. */
export function queuedCount(storyId) {
  const list = queues.get(storyId);
  return list ? list.length : 0;
}

export function currentEpoch() {
  return epoch;
}
