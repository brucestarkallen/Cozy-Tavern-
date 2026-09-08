/* Cozy Tavern — engine/state.js
 * The state of things, per story. M3 woke the engine: the clock, presence
 * (now with position and attire when known), and the scene's mood are
 * written by the mutation applier (engine/apply.js) from what the extractor
 * reads off each finished page — and every change is written down in
 * state.log in plain words, undoable.
 *
 * Contract (SPEC.md M2, extended by M3):
 *   emptyState()                  -> a fresh, untouched state
 *   loadState(storyId)            -> state (emptyState() if none)
 *   saveState(storyId, state)
 *   renderStateFacts(state)       -> human-readable block, '' when nothing set
 *   subscribe(storyId, fn)        -> unsubscribe — the ledger drawer listens
 *   notify(storyId)               -> tell the listeners the state changed
 *
 * State v2 (M3): `log` joins the shape, and present entries may carry
 * position/attire. loadState migrates M2 state objects on the way up —
 * adds log:[], keeps every name and mark it finds, nothing is lost.
 *
 * Persistence: kept in the existing settings store under `state:<storyId>`,
 * so it travels with backups and needs no schema migration.
 */

import { db } from '../store.js';
import { renderClock } from './clock.js';

const KEY_PREFIX = 'state:';

export const emptyState = () => ({
  clock: null,              // {calendar, minutes, label, monthNames?, dayNames?} | null
  present: [],              // [{name, position?, attire?}]
  mode: { combat: false, intimate: false, travel: false, socialField: false, isolation: false, group: false },
  log: [],                  // [{ts, words, undone, undo?}] — what changed and why (M3)
  bodies: {},
  relationships: {},
  offscreen: {},
  factions: {},
  threads: [],
});

/* ---------- pub/sub: the drawer listens for the engine ---------- */

const listeners = new Map(); // storyId -> Set<fn>

export function subscribe(storyId, fn) {
  if (!storyId || typeof fn !== 'function') return () => {};
  let set = listeners.get(storyId);
  if (!set) { set = new Set(); listeners.set(storyId, set); }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(storyId);
  };
}

export function notify(storyId) {
  const set = listeners.get(storyId);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(); } catch (err) { /* a listener's trouble is its own */ }
  }
}

/* ---------- migration & persistence ---------- */

/* Merge whatever was saved over a fresh state, so fields added in later
 * milestones appear even in states written before they existed. v1 → v2:
 * log appears; present entries become objects with room for position and
 * attire; an M2 clock kept only {iso, calendar, label} — the label still
 * renders, and the extractor will set the clock properly the first time the
 * prose marks the hour. Nothing saved is ever dropped. */
function normalize(saved) {
  const fresh = emptyState();
  if (!saved || typeof saved !== 'object') return fresh;
  const next = { ...fresh, ...saved };
  next.mode = { ...fresh.mode, ...(saved.mode || {}) };
  next.present = Array.isArray(saved.present)
    ? saved.present
        .map((p) => {
          if (typeof p === 'string') return { name: p };
          if (p && typeof p === 'object' && typeof p.name === 'string') return { ...p };
          return null;
        })
        .filter((p) => p && p.name.trim())
    : [];
  next.log = Array.isArray(saved.log)
    ? saved.log.filter((e) => e && typeof e === 'object' && typeof e.words === 'string')
    : [];
  next.threads = Array.isArray(saved.threads) ? saved.threads : [];
  return next;
}

export async function loadState(storyId) {
  if (!storyId) return emptyState();
  const saved = await db.settings.get(KEY_PREFIX + storyId);
  return normalize(saved);
}

export async function saveState(storyId, state) {
  if (!storyId) return;
  await db.settings.set(KEY_PREFIX + storyId, normalize(state));
}

/* Render the state as a short block of plain sentences — this is what slot 5
 * ("The state of things") hands to the storyteller. '' when nothing is set,
 * so the slot can be omitted entirely. M3 makes it richer: the clock speaks
 * in its own calendar, and presence carries position and attire when known. */
export function renderStateFacts(state) {
  if (!state || typeof state !== 'object') return '';
  const lines = [];

  if (state.clock && typeof state.clock === 'object') {
    /* Prefer a fresh render (the cached label can lag a hand-edited
     * calendar); an M2 {iso,label} clock falls back to its label. */
    const spoken = renderClock(state.clock) || state.clock.label || state.clock.iso || '';
    if (spoken) lines.push('The hour: ' + spoken + '.');
  }

  const present = Array.isArray(state.present)
    ? state.present
        .map((p) => {
          if (!p || !p.name) return '';
          const detail = [p.position, p.attire]
            .filter((s) => typeof s === 'string' && s.trim())
            .join(', ');
          return detail ? p.name + ' (' + detail + ')' : p.name;
        })
        .filter(Boolean)
    : [];
  if (present.length) {
    lines.push('Here now: ' + present.join(', ') + '.');
  }

  const mode = state.mode || {};
  const moods = [];
  if (mode.combat) moods.push('contested — talk has given way to something sharper');
  if (mode.intimate) moods.push('intimate');
  if (mode.travel) moods.push('on the road');
  if (mode.socialField) moods.push('a crowded room, everyone watching everyone');
  if (mode.isolation) moods.push('alone, far from help');
  if (mode.group) moods.push('in company');
  if (moods.length) {
    lines.push('The scene is ' + moods.join('; ') + '.');
  }

  const threads = Array.isArray(state.threads)
    ? state.threads.map((t) => (typeof t === 'string' ? t : t && (t.label || t.name))).filter(Boolean)
    : [];
  if (threads.length) {
    lines.push('Threads still open: ' + threads.join('; ') + '.');
  }

  /* The object maps are M4 country (bodies, relationships, offscreen,
   * factions have fields but no engines yet). If anything is ever written
   * into them, pass it along plainly: "name: note". */
  const maps = [
    ['bodies', 'Bodies'],
    ['relationships', 'Between them'],
    ['offscreen', 'Elsewhere'],
    ['factions', 'Factions'],
  ];
  for (const [key, label] of maps) {
    const map = state[key];
    if (!map || typeof map !== 'object') continue;
    const entries = Object.entries(map)
      .map(([name, note]) => name + ': ' + (typeof note === 'string' ? note : JSON.stringify(note)));
    if (entries.length) lines.push(label + ' — ' + entries.join('; ') + '.');
  }

  return lines.join('\n');
}
