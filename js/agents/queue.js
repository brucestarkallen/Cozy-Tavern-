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
/* M682: visible page numbers change before the housekeeper asks chat to rebase its books. Every old reading is stale
 * from the visibility write itself; work begun inside that window is stale too, even if it answers after the rebase. */
const pageLayouts = new Map();
const changingLayouts = new Map();
export function pageLayoutChanged(storyId) {
  if (storyId) pageLayouts.set(storyId, (pageLayouts.get(storyId) || 0) + 1);
}
export function holdPageLayout(storyId) {
  changingLayouts.set(storyId, (changingLayouts.get(storyId) || 0) + 1);
  return () => {
    const left = (changingLayouts.get(storyId) || 1) - 1;
    if (left > 0) changingLayouts.set(storyId, left);
    else changingLayouts.delete(storyId);
  };
}

/* M208: THE WRITER MAY STOP WHAT THE WRITER STARTED. A rebuild is minutes of
 * work and there was no way to call it off — the only way out was closing the
 * tab, which is not a control. A stop aborts the call in flight, drops
 * everything still queued for that story, and is honest about it: the work
 * already done stands (a part-built record is kept and resumed, M205), and
 * the banner says it was stopped by hand, not that it failed. */
const stopping = new Map();   // lane (a story's id, or its side lane) -> a live abort for the job in flight

/* M529: HELPERS SIDE BY SIDE. His question: "can the workers be faster — a setting to use more than one request at once?"
 * The page chain ran one helper at a time: the page's readers of the ledger, then the record keeper, the essentials, the
 * plans keeper, the sensors, the placer and the world keeper — each waiting for the one before. The second group reads the
 * pages and the record and writes only its own books; with his switch on it runs in a lane of its own, beside the ledger's
 * readers, so a page's helpers finish in the time of the longer lane, not the sum of both. Off (as it ships), there is one
 * lane and every helper runs as it always has. */
const SIDE = '\u0001side';
let sideBySide = false;
export function setSideBySide(on) { sideBySide = on === true; }
export function sideBySideOn() { return sideBySide; }
const laneOf = (storyId, job) => (sideBySide && job && job.lane === 'side' ? storyId + SIDE : storyId);

/* M530: WHEN THE PROVIDER TURNS AWAY TWO AT ONCE. He cannot know how many requests at once his workers' provider takes.
 * With both of a story's lanes in flight, a call turned away as "too many" (429; a refusal that says concurrent, too many
 * or rate limit) puts the house back to ONE AT A TIME by itself: the side lane's waiting workers join the main lane in order,
 * the refused call is tried again as any refused call is, and the handler the app gave (app.js) keeps the switch off and
 * says why where the switch is. Nothing is lost; it only goes back to how it always ran. */
let onTooMany = null;
export function setTooManyHandler(fn) { onTooMany = typeof fn === 'function' ? fn : null; }
export function refusedAsTooMany(err) {
  const msg = String((err && err.message) || '');
  return Boolean(err && (err.status === 429 || /concurren|too many requests|too many simultaneous|rate.?limit/i.test(msg)));
}
function backToOneAtATime(storyId, err) {
  if (!sideBySide) return;
  sideBySide = false;
  const side = queues.get(storyId + SIDE) || [];
  if (side.length) {
    const main = queues.get(storyId) || [];
    for (const j of side.splice(0, side.length)) { j.lane = storyId; main.push(j); }
    queues.set(storyId, main);
    drain(storyId);
  }
  if (onTooMany) { try { onTooMany(err); } catch (e) { /* the handler's trouble is not the queue's */ } }
}
const lanesOf = (storyId) => [storyId, storyId + SIDE];

export function stopWork(storyId) {
  if (!storyId) return false;
  let queued = 0;
  let wasLive = false;
  for (const lane of lanesOf(storyId)) {
  const list = queues.get(lane);
  queued += list ? list.length : 0;
  /* M293: A DROPPED JOB IS SETTLED, NEVER LEFT HANGING. The queue was emptied
   * and the promises of the jobs in it were never resolved — so every
   * pendingWork() for that tale waited its whole ceiling on the first of them
   * for the rest of the session (five seconds before every send, two minutes
   * before every replay), and a replay's tail that was dropped never let go
   * of `replaying`, which gated every edit, swipe, delete and branch behind
   * "try once more in a moment". A purge settles what it drops (as a story
   * switch always has). */
  if (list) {
    const dropped = list.splice(0, list.length);   /* nothing more of this run starts */
    for (const job of dropped) {
      try { job.resolve({ ok: false, stopped: true, why: 'stopped by hand' }); } catch (err) { /* a resolver that can't settle is no one's trouble */ }
    }
  }
  const live = stopping.get(lane);
  if (live && typeof live.abort === 'function') { try { live.abort(); } catch (err) { /* fine */ } }
  wasLive = wasLive || Boolean(live);
  }
  return wasLive || queued > 0;
}

export function workIsRunning(storyId) {
  return lanesOf(storyId).some((lane) => Boolean(stopping.get(lane)) || Boolean((queues.get(lane) || []).length));
}
/* M675 (the second reading) — WHO IS OUT FOR A TALE: the names of its jobs, in flight and waiting, on both lanes. "Is this
 * page still being read?" was asked as "is anything out at all?" — and a tale's own opening sends helpers out (the
 * essentials, where it began, its world: they write their own books, never the ledger). Whoever asked after them was
 * told the readers were still on the page: the ledger's healing on open and the finishing of a chain cut short
 * (ui/chat.js) worked only when they happened to ask first. The caller says which names it means. */
export function workOut(storyId) {
  if (!storyId) return [];
  const names = [];
  for (const lane of lanesOf(storyId)) {
    const live = stopping.get(lane);
    if (live && live.name) names.push(live.name);
    for (const job of queues.get(lane) || []) if (job && job.name) names.push(job.name);
  }
  return names;
}
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
/* M259: A JOB IN THE PAGE'S CHAIN. The chain wrapped each job to add its own
 * staleness — and passed on only {signal, stale}, so the leash's renew never
 * reached a single worker in the chain: the keeper, which renews before every
 * call when it is handed the leash (M213), shared one minute across up to nine
 * calls; the auditor could not lengthen its leash for a whole-ledger reading. */
export function chainJob(run, isOld) {
  return ({ signal, stale, renew } = {}) => run({
    signal,
    stale: () => Boolean((typeof stale === 'function' && stale()) || (typeof isOld === 'function' && isOld())),
    renew,
  });
}

export function enqueueWork(storyId, job) {
  if (!storyId || !job || typeof job.run !== 'function') {
    return Promise.resolve({ ok: false, why: 'misshapen' });
  }
  const lane = laneOf(storyId, job);
  const entry = { ...job, storyId, lane, epoch, pageLayout: pageLayouts.get(storyId) || 0, duringLayout: Boolean(changingLayouts.get(storyId)) && job.layoutRebased !== true };
  let list = queues.get(lane);
  if (!list) { list = []; queues.set(lane, list); }
  return new Promise((resolve) => {
    entry.resolve = resolve;
    list.push(entry);
    drain(lane);
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
  const laneKey = job.lane || storyId; /* M529: each lane's job in flight has its own stop */
  const isStale = () => job.epoch !== epoch || job.duringLayout || job.pageLayout !== (pageLayouts.get(storyId) || 0);
  /* A job queued for a story the writer has since left never starts. */
  if (isStale()) return { ok: false, stale: true, why: 'left behind' };

  let lastErr = null;
  /* M675 — A JOB THE HOUSE STARTED BY ITSELF IS TRIED ONCE (job.once). A page's own readers are tried again here, two
   * seconds, four, eight … apart: the page is waiting for them. A reading the house sends while nothing is being asked
   * of it (the continuous audit, the ledger's catch-up) has its own wait between looks — and while one of them slept
   * out this ladder with its call failed, nothing was in flight to step aside: a send waited its whole five seconds
   * for it, every time (measured with the real queue: 1,710 ms for a send landing in the first wait, 5,005 ms — the
   * whole ceiling — in the 8-second one), and a rewind waited out the rest of the minute. Such a job fails at once,
   * says why on the workers' line as any failure does, and its own next look asks again. */
  const tries = job.once === true ? 0 : MAX_RETRIES;
  /* M675 — THE LANE IS HELD FOR AS LONG AS THE JOB IS, AND NOT A MOMENT LONGER. The stop for "the job in flight" was set
   * at the top of each try and taken away only when a try ran well or was stopped — so (measured with this file alone):
   *   - A JOB THAT FAILED FOR GOOD LEFT ITS STOP BEHIND, and workIsRunning() said the tale's work was running until
   *     some later job on the lane ran well: "Summarize now" answered "A pass is finishing — try again in a moment"
   *     to every press, and the house's own healers (the ledger's catch-up, the record's gap, the continuous audit —
   *     each asks workIsRunning first) never came back by themselves after a reading that failed, whatever the lamp
   *     said, until he wrote another page;
   *   - HIS STOP, PRESSED WHILE A FAILED JOB WAITED FOR ITS NEXT TRY, STOPPED NOTHING: it reached the try that had
   *     already ended, and the job woke and asked its model again — up to five more times.
   * One stop for the whole job now: it ends the call in flight or the wait between tries, whichever the job is in,
   * and it is taken away however the job ends. */
  let stoppedByHand = false;
  let abortNow = null;   /* the call in flight, while there is one */
  let wake = null;       /* the wait between two tries, while it is being waited */
  const hold = { name, abort: () => { stoppedByHand = true; if (abortNow) abortNow(); if (wake) wake(); } };
  stopping.set(laneKey, hold);
  const stopped = async () => {
    stopping.delete(laneKey);
    markWorkerRunning(storyId, name, false);
    await noteWorkerRun(storyId, name, { ok: false, detail: 'stopped by hand' });
    return { ok: false, stopped: true, why: 'stopped by hand' };
  };
  try {
    for (let attempt = 0; attempt <= tries; attempt += 1) {
      if (attempt > 0) {
        await Promise.race([sleepImpl(backoffMs(attempt, lastErr && lastErr.retryAfterMs)), new Promise((resolve) => { wake = resolve; })]);
        wake = null;
        if (stoppedByHand) return await stopped(); /* M675: stopped while it waited — it does not wake and ask again */
        if (isStale()) return { ok: false, stale: true, why: 'left behind' };
      }
      const { signal, done, renew, abort } = workerSignal();
      /* M208: the writer's own stop reaches the call in flight */
      abortNow = abort;
      markWorkerRunning(storyId, name, true); /* M46: "reading now…" on the workers line */
      try {
        /* M207: a job that works in rounds renews its leash each round */
        const value = await job.run({ signal, stale: isStale, renew });
        done();
        if (stoppedByHand) return await stopped(); /* M685: a reader may save partial work and return normally after abort; his Stop still wins. */
        if (isStale()) { markWorkerRunning(storyId, name, false); return { ok: false, stale: true, why: 'left behind' }; }
        if (signal.aborted) throw signal.reason || new Error('timeout'); /* M685: returning partial work cannot turn an expired call into success either. */
        /* The job may ask for silence (a switch was off, nothing to note);
         * every honest run is otherwise written on the workers line. */
        if (!value || value.silent !== true) {
          /* M248: a job may say it did real work and did not reach the end */
          await noteWorkerRun(storyId, name, {
            ok: true,
            detail: value && value.detail,
            raw: value && value.raw,
            unfinished: Boolean(value && value.unfinished),
            resume: value && value.resume,
          });
        }
        /* M275: SETTLED AFTER THE RESULT IS WRITTEN. It was marked settled first,
         * and the light, which looks the moment a worker settles, read the result
         * before this one — green for an instant after a job that stopped partway. */
        markWorkerRunning(storyId, name, false);
        stopping.delete(laneKey);
        return { ok: true, value };
      } catch (err) {
        done();
        abortNow = null;
        if (stoppedByHand) return await stopped();
        markWorkerRunning(storyId, name, false);
        lastErr = err;
        /* M530: two in flight for this story, and this one turned away as too many — back to one at a time */
        if (sideBySide && refusedAsTooMany(err) && stopping.has(storyId) && stopping.has(storyId + SIDE)) backToOneAtATime(storyId, err);
        if (isStale()) return { ok: false, stale: true, why: 'left behind' };
      }
    }
    const why = plainWhy(lastErr);
    await noteWorkerRun(storyId, name, { ok: false, why, raw: lastErr && typeof lastErr.raw === 'string' ? lastErr.raw : '' });
    return { ok: false, why };
  } finally {
    if (stopping.get(laneKey) === hold) stopping.delete(laneKey); /* M675: however it ended */
  }
}

/* Harness window: how many jobs wait on a story's channel. */
export function queuedCount(storyId) {
  return lanesOf(storyId).reduce((n, lane) => n + ((queues.get(lane) || []).length), 0);
}

export function currentEpoch() {
  return epoch;
}
