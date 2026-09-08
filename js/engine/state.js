/* Cozy Tavern — engine/state.js
 * The state of things, per story. M3 woke the engine: the clock, presence
 * (now with position and attire when known), and the scene's mood are
 * written by the mutation applier (engine/apply.js) from what the extractor
 * reads off each finished page — and every change is written down in
 * state.log in plain words, undoable. M4 filled the last three ledgers:
 * bodies (who's hurt, and is it healing), relationships (P:R:S toward the
 * main character), and the off-screen world (where the absent have gone).
 *
 * Contract (SPEC.md M2, extended by M3 and M4):
 *   emptyState()                  -> a fresh, untouched state
 *   loadState(storyId)            -> state (emptyState() if none)
 *   saveState(storyId, state)
 *   renderStateFacts(state)       -> human-readable block, '' when nothing set
 *   subscribe(storyId, fn)        -> unsubscribe — the ledger drawer listens
 *   notify(storyId)               -> tell the listeners the state changed
 *
 * State v3 (M4): bodies / relationships / offscreen are real ledgers now
 * (engine/bodies.js, relationships.js, offscreen.js). loadState migrates
 * v1/v2 state objects on the way up — adds log:[], presence fields, and the
 * three ledgers — keeping every name and mark it finds; nothing is lost.
 * renderStateFacts gained compact sections with a hard budget (see
 * STATE_BUDGET below) so slot 5 never swells past ~400 tokens.
 *
 * Persistence: kept in the existing settings store under `state:<storyId>`,
 * so it travels with backups and needs no schema migration.
 */

import { db } from '../store.js';
import { renderClock } from './clock.js';
import { renderBodies } from './bodies.js';
import { axisWords, AXES } from './relationships.js';
import { renderOffscreen } from './offscreen.js';

const KEY_PREFIX = 'state:';

/* The state-of-things block rides in front of every story page, so it keeps
 * a strict figure: ~1600 chars ≈ ~400 tokens for the whole block, even when
 * every ledger is full (SPEC.md M4). Section caps below keep it honest, and
 * a final drop-order trims the least vital sections if words ran long. */
export const STATE_BUDGET = 1600;
const BODIES_TOP = 4;
const RELATIONSHIPS_TOP = 6;

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

/* ---------- v3 ledger migration (no-loss) ---------- */

function numOrNull(v) {
  return Number.isFinite(v) ? v : null;
}

/* Each migration keeps every entry it can read and coerces the shape;
 * unknown extra fields ride along untouched (spread), so nothing a later
 * milestone (or a hand edit) wrote is ever dropped. */
function migrateBodies(bodies) {
  if (!bodies || typeof bodies !== 'object') return {};
  const out = {};
  for (const [name, body] of Object.entries(bodies)) {
    if (!body || typeof body !== 'object') continue;
    const injuries = (Array.isArray(body.injuries) ? body.injuries : [])
      .filter((i) => i && typeof i === 'object' && typeof i.what === 'string' && i.what.trim())
      .map((i) => ({
        ...i,
        what: i.what.trim(),
        sev: [1, 2, 3].includes(i.sev) ? i.sev : 1,
        atMinutes: numOrNull(i.atMinutes),
        atTurn: numOrNull(i.atTurn),
        treated: Boolean(i.treated),
        healed: Boolean(i.healed),
      }));
    const strain = (Array.isArray(body.strain) ? body.strain : [])
      .filter((s) => s && typeof s === 'object' && typeof s.what === 'string' && s.what.trim())
      .map((s) => ({ ...s, what: s.what.trim(), atMinutes: numOrNull(s.atMinutes), atTurn: numOrNull(s.atTurn) }));
    out[name] = { ...body, injuries, strain };
  }
  return out;
}

function migrateRelationships(relationships) {
  if (!relationships || typeof relationships !== 'object') return {};
  const out = {};
  for (const [name, rel] of Object.entries(relationships)) {
    if (!rel || typeof rel !== 'object') continue;
    const history = (Array.isArray(rel.history) ? rel.history : [])
      .filter((h) => h && typeof h === 'object')
      .map((h) => ({
        ...h,
        atMinutes: numOrNull(h.atMinutes),
        axis: AXES.includes(h.axis) ? h.axis : 'p',
        delta: Number.isFinite(h.delta) ? h.delta : 0,
        cause: typeof h.cause === 'string' ? h.cause : '',
      }));
    out[name] = {
      ...rel,
      p: Number.isFinite(rel.p) ? rel.p : 0,
      r: Number.isFinite(rel.r) ? rel.r : 0,
      s: Number.isFinite(rel.s) ? rel.s : 0,
      history,
    };
  }
  return out;
}

function migrateOffscreen(offscreen) {
  if (!offscreen || typeof offscreen !== 'object') return {};
  const out = {};
  for (const [name, entry] of Object.entries(offscreen)) {
    if (!entry || typeof entry !== 'object') continue;
    const location = typeof entry.location === 'string' ? entry.location.trim() : '';
    const activity = typeof entry.activity === 'string' ? entry.activity.trim() : '';
    if (!location && !activity) continue; // a note with neither says nothing
    out[name] = {
      ...entry,
      location,
      activity,
      agenda: typeof entry.agenda === 'string' ? entry.agenda.trim() : undefined,
      sinceMinutes: numOrNull(entry.sinceMinutes),
      atTurn: numOrNull(entry.atTurn),
    };
  }
  return out;
}

/* Merge whatever was saved over a fresh state, so fields added in later
 * milestones appear even in states written before they existed. v1 → v2:
 * log appears; present entries become objects with room for position and
 * attire; an M2 clock kept only {iso, calendar, label} — the label still
 * renders, and the extractor will set the clock properly the first time the
 * prose marks the hour. v2 → v3: the three ledgers are coerced into shape.
 * Nothing saved is ever dropped. */
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
  next.bodies = migrateBodies(saved.bodies);
  next.relationships = migrateRelationships(saved.relationships);
  next.offscreen = migrateOffscreen(saved.offscreen);
  next.factions = saved.factions && typeof saved.factions === 'object' ? saved.factions : {};
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
 * so the slot can be omitted entirely.
 *
 * M4 section order (SPEC.md, law): the clock, presence, how they're holding
 * up (top 4 most recent unhealed; strain when no injuries), the standings
 * between people (nonzero only, top 6 by |total|), elsewhere (top 6, never
 * anyone present), then the mood words. Threads (M3) trail last. Sections
 * with nothing to say are omitted. The whole block stays inside
 * STATE_BUDGET: the caps do the daily work, and if words still ran long the
 * lowest-priority sections are let go until it fits. */
export function renderStateFacts(state) {
  if (!state || typeof state !== 'object') return '';

  const clockMinutes = state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null;
  const turnCount = Array.isArray(state.log) ? state.log.length : 0;
  const present = Array.isArray(state.present) ? state.present : [];

  /* Sections, most vital first. `shed` ranks what goes first when the
   * budget pinches (higher sheds sooner). */
  const sections = [];

  if (state.clock && typeof state.clock === 'object') {
    /* Prefer a fresh render (the cached label can lag a hand-edited
     * calendar); an M2 {iso,label} clock falls back to its label. */
    const spoken = renderClock(state.clock) || state.clock.label || state.clock.iso || '';
    if (spoken) sections.push({ shed: 0, text: 'The hour: ' + spoken + '.' });
  }

  const here = present
    .map((p) => {
      if (!p || !p.name) return '';
      const detail = [p.position, p.attire]
        .filter((s) => typeof s === 'string' && s.trim())
        .join(', ');
      return detail ? p.name + ' (' + detail + ')' : p.name;
    })
    .filter(Boolean);
  if (here.length) sections.push({ shed: 0, text: 'Here now: ' + here.join(', ') + '.' });

  const bodyLines = renderBodies(state.bodies, clockMinutes, turnCount)
    .split('\n').filter(Boolean).slice(0, BODIES_TOP);
  if (bodyLines.length) sections.push({ shed: 2, text: bodyLines.join('\n') });

  /* Standings: nonzero only, top 6 by how strongly they feel (|p|+|r|+|s|). */
  const rel = state.relationships && typeof state.relationships === 'object' ? state.relationships : {};
  const standings = Object.entries(rel)
    .filter(([, r]) => r && typeof r === 'object')
    .map(([name, r]) => ({
      name,
      rel: r,
      magnitude: Math.abs(r.p || 0) + Math.abs(r.r || 0) + Math.abs(r.s || 0),
    }))
    .filter((row) => row.magnitude > 0)
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, RELATIONSHIPS_TOP)
    .map((row) => row.name + ' — '
      + AXES.map((axis) => axisWords(axis, row.rel[axis])).filter(Boolean).join(', '));
  if (standings.length) sections.push({ shed: 3, text: standings.join('\n') });

  const elsewhere = renderOffscreen(state.offscreen, present);
  if (elsewhere) sections.push({ shed: 4, text: 'Elsewhere: ' + elsewhere.split('\n').join('\n') });

  const mode = state.mode || {};
  const moods = [];
  if (mode.combat) moods.push('contested — talk has given way to something sharper');
  if (mode.intimate) moods.push('intimate');
  if (mode.travel) moods.push('on the road');
  if (mode.socialField) moods.push('a crowded room, everyone watching everyone');
  if (mode.isolation) moods.push('alone, far from help');
  if (mode.group) moods.push('in company');
  if (moods.length) sections.push({ shed: 1, text: 'The scene is ' + moods.join('; ') + '.' });

  const threads = Array.isArray(state.threads)
    ? state.threads.map((t) => (typeof t === 'string' ? t : t && (t.label || t.name))).filter(Boolean)
    : [];
  if (threads.length) sections.push({ shed: 5, text: 'Threads still open: ' + threads.join('; ') + '.' });

  /* The budget: shed the least vital until the block fits. The hour and
   * who's here (shed 0) always stay. */
  const kept = sections.slice();
  const join = () => kept.map((s) => s.text).join('\n');
  while (join().length > STATE_BUDGET && kept.some((s) => s.shed > 0)) {
    let worst = 0;
    for (let i = 1; i < kept.length; i += 1) {
      if (kept[i].shed > kept[worst].shed) worst = i;
    }
    kept.splice(worst, 1);
  }
  return join();
}
