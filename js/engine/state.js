/* Cozy Tavern — engine/state.js
 * The state of things, per story. In M2 this is a hand-editable stub: the
 * "Who's here" panel in the ledger adds and removes names, and everything
 * else waits for the M3 engine to fill it automatically. The shape below is
 * the seam the engine will write into — don't rename the keys.
 *
 * Contract (SPEC.md M2):
 *   emptyState()                  -> a fresh, untouched state
 *   loadState(storyId)            -> state (emptyState() if none)
 *   saveState(storyId, state)
 *   renderStateFacts(state)       -> human-readable block, '' when nothing set
 *
 * Persistence: kept in the existing settings store under `state:<storyId>`,
 * so it travels with backups and needs no schema migration. M3 owns clock,
 * mode, bodies & friends; M2 only writes `present` by hand.
 */

import { db } from '../store.js';

const KEY_PREFIX = 'state:';

export const emptyState = () => ({
  clock: null,              // {iso, calendar:'real'|'fantasy', label} | null (M3 engine owns)
  present: [],              // [{name}]  — M2: hand-edited via the ledger drawer
  mode: { combat: false, intimate: false, travel: false, socialField: false, isolation: false, group: false },
  bodies: {},
  relationships: {},
  offscreen: {},
  factions: {},
  threads: [],
});

/* Merge whatever was saved over a fresh state, so fields added in later
 * milestones appear even in states written before they existed. */
function normalize(saved) {
  const fresh = emptyState();
  if (!saved || typeof saved !== 'object') return fresh;
  const next = { ...fresh, ...saved };
  next.mode = { ...fresh.mode, ...(saved.mode || {}) };
  next.present = Array.isArray(saved.present) ? saved.present : [];
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
 * so the slot can be omitted entirely. */
export function renderStateFacts(state) {
  if (!state || typeof state !== 'object') return '';
  const lines = [];

  if (state.clock && (state.clock.label || state.clock.iso)) {
    lines.push('The hour: ' + (state.clock.label || state.clock.iso) + '.');
  }

  const present = Array.isArray(state.present)
    ? state.present.map((p) => p && p.name).filter(Boolean)
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

  /* The object maps are engine country (M3+). If anything is ever written
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
