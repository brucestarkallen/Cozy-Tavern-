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
export const WORKER_NAMES = ['extractor', 'world', 'scribe', 'keeper', 'referee', 'continuity', 'auditor', 'housekeeper', 'director', 'editor'];

/* A per-call abort signal with a hard timeout. done() clears the timer —
 * callers must settle it in a finally. */
export function workerSignal(timeoutMs = WORKER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  return {
    signal: controller.signal,
    done: () => clearTimeout(timer),
  };
}

function cleanWhy(why) {
  const words = String(why || '').trim().replace(/\s+/g, ' ');
  return words.length > 80 ? words.slice(0, 79).trimEnd() + '…' : words;
}

/* Record one worker's last run for a story. ok=false wants a why (one plain
 * word of what went wrong, e.g. "no answer", "unreachable"). */
export const RAW_CAP = 2000;

export async function noteWorkerRun(storyId, name, { ok, why, detail, raw } = {}) {
  try {
    if (!storyId || !WORKER_NAMES.includes(name)) return;
    const shelf = (await loadWorkerStatus(storyId)) || {};
    /* M31: what the worker actually said, capped — so "its answer could not
     * be used" can be looked at instead of guessed at. */
    const said = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, RAW_CAP) : '';
    shelf[name] = { at: Date.now(), ok: ok !== false, why: ok === false ? cleanWhy(why) || 'stumbled' : '', detail: typeof detail === 'string' ? detail : '', raw: said };
    await db.settings.set(KEY_PREFIX + storyId, shelf);
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
        };
      }
    }
    return out;
  } catch (err) {
    return {};
  }
}
