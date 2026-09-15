/* Cozy Tavern — agents/status.js
 * The workers' ledger (M9, SPEC §5): background work is quiet in the story
 * but NEVER silent in the ledger. Each worker (extractor, keeper, referee,
 * continuity) records its last run here — when, whether it ended well, and
 * one plain word of why not when it didn't. The drawer's "The workers" line
 * reads this shelf.
 *
 * Also living here: the workers' timeout. Every background call gets an
 * AbortController and a hard 60-second ceiling (audit A5 — a hung worker
 * fetch used to leak forever). workerSignal() hands out {signal, done};
 * done() releases the timer.
 *
 * Store key `workers:<storyId>` = { [name]: {at, ok, why} } — the settings
 * store, so backups carry it and it is let go with its story (store.js).
 *
 * Never throws: status-keeping must never be a new way to fail.
 */

import { db } from '../store.js';

const KEY_PREFIX = 'workers:';
export const WORKER_TIMEOUT_MS = 60000;
/* M10: the housekeeper's household joins the ledger — the panel talk
 * itself, and the two showrunners. */
/* M12: the scribe joins the ledger — the quiet writer of the character
 * pages. */
export const WORKER_NAMES = ['founder', 'eye', 'extractor', 'world', 'scribe', 'keeper', 'referee', 'continuity', 'auditor', 'ripple', 'housekeeper', 'director', 'editor'];

/* M46: what is running right now, and who wants to know. The drawer's
 * workers panel shows "reading now…" the moment a job starts and re-reads
 * the shelf the moment it settles — the writer could not tell whether the
 * auditor was working or done. In-memory only. */
const running = new Map(); // storyId -> Set<name>
const listeners = new Set();
export function markWorkerRunning(storyId, name, on) {
  if (!storyId || !name) return;
  let set = running.get(storyId);
  if (!set) { set = new Set(); running.set(storyId, set); }
  if (on) set.add(name); else set.delete(name);
  for (const fn of listeners) { try { fn(storyId, name, on); } catch (err) { /* a listener that trips is its own trouble */ } }
}
export function runningWorkers(storyId) {
  return [...(running.get(storyId) || [])];
}
export function onWorkerChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* A per-call abort signal with a hard timeout. done() clears the timer —
 * callers must settle it in a finally. */
export function workerSignal(timeoutMs = WORKER_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  return {
    signal: controller.signal,
    done: () => clearTimeout(timer),
    /* M207: THE LEASH IS PER CALL, NOT PER JOB. Sixty seconds is right for one
     * worker asking one question. A REBUILD is sixteen questions across a
     * hundred pages, and it shared that single sixty seconds — so on the
     * writer's 98-page tale it was aborted at page 18, every time, and the
     * workers' line read "the keeper stumbled — outwaited". The rebuild could
     * not finish, ever, on any story long enough to need one. A job that
     * works in rounds renews the leash at the top of each round: a hung call
     * is still cut off after sixty seconds, and honest work is never
     * punished for taking more than one minute in total. */
    /* M208: the writer's own stop. An AbortSignal cannot be aborted from
     * outside itself — only its controller can do it, so the controller
     * hands this out with the signal. */
    abort: () => { clearTimeout(timer); controller.abort(new Error('stopped by hand')); },
    renew: () => {
      if (controller.signal.aborted) return false;
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
      return true;
    },
  };
}

function cleanWhy(why) {
  const words = String(why || '').trim().replace(/\s+/g, ' ');
  /* M237: cut on a word — the workers' line is read by the writer. */
  if (words.length <= 80) return words;
  const room = words.slice(0, 79);
  const at = room.lastIndexOf(' ');
  return (at > 40 ? room.slice(0, at) : room).trimEnd().replace(/[,;]$/, '') + '…';
}

/* Record one worker's last run for a story. ok=false wants a why (one plain
 * word of what went wrong, e.g. "no answer", "unreachable"). */
export const RAW_CAP = 2000;

/* M248: DID IT FINISH, OR ONLY STOP? A run was recorded as ok or stumbled and
 * nothing else — so a rebuild that reached batch 15 of 16 and gave up sat in
 * the workers' line looking exactly like one that had finished, and the
 * writer, who had been asleep, had no way to tell. A run that did real work
 * and did not reach the end is a THIRD thing: unfinished. It carries what it
 * would take to finish, so the house (or the writer) can pick it up. */
export async function noteWorkerRun(storyId, name, { ok, why, detail, raw, unfinished, resume } = {}) {
  try {
    if (!storyId || !WORKER_NAMES.includes(name)) return;
    const shelf = (await loadWorkerStatus(storyId)) || {};
    /* M31: what the worker actually said, capped — so "its answer could not
     * be used" can be looked at instead of guessed at. */
    const said = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, RAW_CAP) : '';
    shelf[name] = {
      at: Date.now(),
      ok: ok !== false,
      why: ok === false ? cleanWhy(why) || 'stumbled' : '',
      detail: typeof detail === 'string' ? detail : '',
      raw: said,
      /* M248: green when it finished; amber when it stopped partway */
      unfinished: unfinished === true,
      resume: unfinished === true && typeof resume === 'string' ? resume : '',
    };
    await db.settings.set(KEY_PREFIX + storyId, shelf);
    markWorkerRunning(storyId, name, false); /* M46: settled — the panel re-reads */
  } catch (err) { /* the ledger of workers never makes work of its own */ }
}

export async function loadWorkerStatus(storyId) {
  try {
    if (!storyId) return {};
    const saved = await db.settings.get(KEY_PREFIX + storyId);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    const out = {};
    for (const name of WORKER_NAMES) {
      const row = saved[name];
      if (row && typeof row === 'object' && Number.isFinite(row.at)) {
        /* M31: detail used to be dropped here — the drawer could never say
         * "wrote 3 changes". It rides now, and so does what the worker said. */
        out[name] = {
          at: row.at,
          ok: row.ok !== false,
          why: typeof row.why === 'string' ? row.why : '',
          detail: typeof row.detail === 'string' ? row.detail : '',
          raw: typeof row.raw === 'string' ? row.raw : '',
          /* M253: THE LOADER DROPPED WHAT M248 HAD JUST LEARNED TO WRITE.
           * noteWorkerRun stored `unfinished` and `resume` faithfully; this
           * reader rebuilds each row from a FIXED LIST OF FIELDS and simply
           * did not name them — so every row came back with unfinished
           * undefined, the amber mark could never appear, and the "Finish it"
           * button could never be offered. The whole of M248 was dead on
           * arrival and its law passed, because the law read the source
           * instead of the round trip. */
          unfinished: row.unfinished === true,
          resume: typeof row.resume === 'string' ? row.resume : '',
        };
      }
    }
    return out;
  } catch (err) {
    return {};
  }
}
