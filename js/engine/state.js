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
 * State v4 (M6): the canon store (what's true of them, engine/canon.js),
 * the referee's pendingVerdict (consumed by the next buildRequest and
 * cleared) with its lastVerdict echo for the drawer, and memorySettings
 * passed through untouched (the keeper's own store lives at
 * memory:<storyId>). renderStateFacts speaks the ruling and the locked
 * truths alongside the ledgers, still inside the same hard budget.
 * renderStateFacts gained compact sections with a hard budget (see
 * STATE_BUDGET below) so slot 5 never swells past ~400 tokens.
 *
 * State v7 (M21): TRUE rollback — a deep snapshot per turn boundary, keyed
 * by the turn's user-message id under `snapshots:<storyId>` (cap 50).
 * Regenerate-from-here, swipe-creation, and deleteFrom restore the boundary
 * before the doomed turn and drop the newer snapshots; the undo log stays
 * independent.
 *
 * Persistence: kept in the existing settings store under `state:<storyId>`
 * (snapshots under `snapshots:<storyId>`), so both travel with backups and
 * need no schema migration.
 */

import { db } from '../store.js';
import { renderClock } from './clock.js';
import { renderBodies } from './bodies.js';
import { axisWords, AXES } from './relationships.js';
import { renderOffscreen } from './offscreen.js';
import { renderThreads, renderKnowledge, renderFactions } from './world.js'; /* M29: the world beyond the page */
import { renderCanon } from './canon.js';
import { renderFightLine, mcName } from './duels.js';
import { migrateCharacters } from './people.js';

const KEY_PREFIX = 'state:';

/* The state-of-things block rides in front of every story page, so it keeps
 * a strict figure: ~1600 chars ≈ ~400 tokens for the whole block, even when
 * every ledger is full (SPEC.md M4). Section caps below keep it honest, and
 * a final drop-order trims the least vital sections if words ran long. */
/* M29: the state of things may run to ~1000 tokens now. The old 1600 chars
 * starved the world — the storyteller got a name and an hour; the point of
 * a ledger is that the world it hands over is rich and specific while the
 * RULES stay short. Section caps still do the daily work; the shed order
 * still holds when a scene is enormous. */
export const STATE_BUDGET = 4000;
const BODIES_TOP = 4;
const RELATIONSHIPS_TOP = 6;

export const emptyState = () => ({
  clock: null,              // {calendar, minutes, label, monthNames?, dayNames?} | null
  place: null,               // {name} — where the scene stands (M26)
  present: [],              // [{name, position?, attire?}]
  mode: { combat: false, intimate: false, travel: false, socialField: false, isolation: false, group: false },
  log: [],                  // [{ts, words, undone, undo?}] — what changed and why (M3)
  bodies: {},
  relationships: {},
  offscreen: {},
  canon: {},                // {[name]: {facts:[{key, value, atMinutes}]}} — what's true of them (M6)
  pendingVerdict: null,     // the referee's ruling, consumed by the next buildRequest (M6; the directive rides the "The house has ruled" tail slot in M11)
  lastVerdict: null,        // its echo, kept for the drawer's "The house has ruled" line (M6)
  factions: {},             // {[name]: {stance, agenda, move, atTurn}} — M29 engine/world.js
  threads: [],              // [{title, owner, heat, next, atTurn}] — M29 engine/world.js
  knowledge: {},            // {[name]: [{fact, atTurn}]} — who knows what (M29)
  worldBrief: null,         // the world agent's word for the next turn (M29) — {pressure, ripe, twb, atTurn}
  worldShown: [],           // windows beyond the page already opened — [{who, where, changed, atTurn}] cap 6 (M30)
  audit: null,              // the auditor's last report — {at, turn, issues:[{what, fix, fixable}]} (M41)
  /* M11: the referee's world. */
  sheet: { actors: {}, playerName: '' }, // how they measure — 0-10 ratings, domains, lasting conditions
  duel: null,             // the live duel engine state (engine/duels.js), null when no duel is joined
  battle: null,           // the live battle/war engine state, null when none is joined
  composure: null,        // the player's nerve pool (null = untouched; starts at the setting's max)
  refHistory: [],         // the committed-fate timeline: [{key, msgId, verdict, snap, at}] cap 12
  seedDueAfterFight: false, // set when a fight lets go — the sheet seeder's cue
  /* M12 (v6): the character ledger — who each person is (core/state/arc/
   * threads), written by the scribe and by hand (engine/people.js). The
   * main character's entry is record-only (state + threads). */
  characters: {},
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

/* v4: the canon store. Every fact it can read is kept — key and value
 * tidied, the clock mark coerced — and unknown extra fields ride along. */
function migrateCanon(canon) {
  if (!canon || typeof canon !== 'object') return {};
  const out = {};
  for (const [name, entry] of Object.entries(canon)) {
    if (!entry || typeof entry !== 'object') continue;
    const facts = (Array.isArray(entry.facts) ? entry.facts : [])
      .filter((f) => f && typeof f === 'object'
        && typeof f.key === 'string' && f.key.trim()
        && typeof f.value === 'string' && f.value.trim())
      .map((f) => ({ ...f, key: f.key.trim(), value: f.value.trim(), atMinutes: numOrNull(f.atMinutes) }));
    if (facts.length) out[name] = { ...entry, facts };
  }
  return out;
}

/* v4: a verdict rides only if it's shaped like one; anything else is let
 * go (a half-written ruling should never reach the storyteller). M6-era
 * verdicts carried {dc, roll, outcome, words}; M11 verdicts carry
 * {kind, tier, words, directive}. Both speak plain words — that is the
 * shape that matters here. */
function migrateVerdict(verdict) {
  if (!verdict || typeof verdict !== 'object') return null;
  if (typeof verdict.words !== 'string' || !verdict.words.trim()) return null;
  return { ...verdict };
}

/* v5 (M11): the referee's world — the actor sheet, live fights, the nerve
 * pool, and the committed-fate timeline. */
function migrateSheet(sheet) {
  if (!sheet || typeof sheet !== 'object') return { actors: {}, playerName: '' };
  const actors = {};
  const raw = sheet.actors && typeof sheet.actors === 'object' ? sheet.actors : {};
  for (const [name, a] of Object.entries(raw)) {
    if (!a || typeof a !== 'object') continue;
    const entry = { ...a };
    entry.default = Number.isFinite(a.default) ? Math.min(10, Math.max(0, a.default)) : 5;
    const domains = {};
    if (a.domains && typeof a.domains === 'object') {
      for (const [d, v] of Object.entries(a.domains)) {
        if (Number.isFinite(v)) domains[String(d).toLowerCase()] = Math.min(10, Math.max(0, v));
      }
    }
    entry.domains = domains;
    if (Array.isArray(a.conditions)) {
      entry.conditions = a.conditions
        .filter((c) => c && typeof c === 'object' && typeof c.name === 'string' && c.name.trim() && Number.isFinite(c.mod))
        .slice(0, 8);
      if (!entry.conditions.length) delete entry.conditions;
    } else {
      delete entry.conditions;
    }
    if (!name.trim()) continue;
    actors[name.trim()] = entry;
  }
  return {
    actors,
    playerName: typeof sheet.playerName === 'string' ? sheet.playerName.trim().slice(0, 60) : '',
  };
}

function migrateFight(fight) {
  if (!fight || typeof fight !== 'object' || fight.active !== true) return null;
  return fight; /* shape is the engine's own; it coerces defensively as it runs */
}

function migrateRefHistory(hist) {
  if (!Array.isArray(hist)) return [];
  return hist
    .filter((e) => e && typeof e === 'object' && typeof e.key === 'string')
    .slice(-12);
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
  /* M9 (B14): the turn counter is monotonic and never resets, even when the
   * log caps. States from before it existed start from the log's length —
   * the count the ledgers used as turns until now. */
  next.turn = Number.isFinite(saved.turn) && saved.turn >= 0
    ? Math.floor(saved.turn)
    : (Array.isArray(saved.log) ? saved.log.length : 0);
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
  /* M29 (v7): knowledge and the world brief — no-loss; legacy string
   * threads keep rendering (renderStateFacts tolerates both shapes). */
  next.knowledge = saved.knowledge && typeof saved.knowledge === 'object' ? saved.knowledge : {};
  next.worldBrief = saved.worldBrief && typeof saved.worldBrief === 'object' ? saved.worldBrief : null;
  next.worldShown = Array.isArray(saved.worldShown) ? saved.worldShown.filter((w) => w && typeof w === 'object') : [];
  next.audit = saved.audit && typeof saved.audit === 'object' ? saved.audit : null; /* M41 */
  next.canon = migrateCanon(saved.canon);
  next.pendingVerdict = migrateVerdict(saved.pendingVerdict);
  next.lastVerdict = migrateVerdict(saved.lastVerdict);
  /* M11 (v5). */
  next.sheet = migrateSheet(saved.sheet);
  next.duel = migrateFight(saved.duel);
  next.battle = migrateFight(saved.battle);
  next.composure = Number.isFinite(saved.composure) ? Math.max(0, saved.composure) : null;
  next.refHistory = migrateRefHistory(saved.refHistory);
  next.seedDueAfterFight = saved.seedDueAfterFight === true;
  /* M12 (v6): the character ledger — no-loss, coerced by engine/people.js. */
  next.characters = migrateCharacters(saved.characters);
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

/* ---------- M21: TRUE rollback — turn-boundary snapshots ----------
 * Before the worker chain (and the referee) commits a turn's mutations,
 * the send path saves a deep snapshot of the state object keyed by that
 * turn's user-message id. The rewind law: regenerate-from-here,
 * swipe-creation, and deleteFrom restore the snapshot taken at the
 * boundary BEFORE that message, then drop the newer snapshots — so the
 * ledger never carries consequences of a page that no longer exists. The
 * undo log (state.log / apply.js undoLast) stays independent. */

const SNAP_PREFIX = 'snapshots:';
export const SNAP_CAP = 50;

const deepCopy = (v) => (typeof structuredClone === 'function'
  ? structuredClone(v)
  : JSON.parse(JSON.stringify(v)));

export async function loadSnapshots(storyId) {
  const saved = await db.settings.get(SNAP_PREFIX + storyId);
  return (Array.isArray(saved) ? saved : [])
    .filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && e.snap && typeof e.snap === 'object');
}

export async function saveSnapshots(storyId, list) {
  await db.settings.set(SNAP_PREFIX + storyId, list.slice(-SNAP_CAP));
}

/* Save a deep snapshot of the state as it stands at a turn boundary.
 * `turnId` is that turn's user-message id; `state` is the already-loaded
 * state (loadState runs again when it isn't handed over). Re-keying the
 * same boundary simply re-takes the snapshot. */
export async function snapshotState(storyId, turnId, state) {
  if (!storyId || typeof turnId !== 'string' || !turnId) return;
  const current = state && typeof state === 'object' ? state : await loadState(storyId);
  const list = await loadSnapshots(storyId);
  const entry = { id: turnId, snap: deepCopy(current), at: Date.now() };
  const at = list.findIndex((e) => e.id === turnId);
  if (at === -1) list.push(entry);
  else list[at] = entry;
  await saveSnapshots(storyId, list);
}

/* Restore the snapshot taken at the boundary BEFORE the given user
 * message, then drop the newer snapshots. Returns the restored state, or
 * null when no such boundary was ever taken (the ledger stays as it is). */
export async function restoreSnapshot(storyId, turnId) {
  if (!storyId || typeof turnId !== 'string' || !turnId) return null;
  const list = await loadSnapshots(storyId);
  const at = list.findIndex((e) => e.id === turnId);
  if (at === -1) return null;
  const restored = deepCopy(list[at].snap);
  await saveState(storyId, restored);
  await saveSnapshots(storyId, list.slice(0, at + 1));
  notify(storyId); // the ledger drawer re-reads what stands now
  return restored;
}

/* Render the state as a short block of plain sentences — this is what slot 5
 * ("The state of things") hands to the storyteller. '' when nothing is set,
 * so the slot can be omitted entirely.
 *
 * Section order (law): the referee's ruling first when one stands (M6 — it
 * is the freshest fact, and binding this turn), then the clock, presence,
 * what's true of them (canon, present characters only), how they're holding
 * up (top 4 most recent unhealed; strain when no injuries), the standings
 * between people (nonzero only, top 6 by |total|), elsewhere (top 6, never
 * anyone present), then the mood words. Threads (M3) trail last. Sections
 * with nothing to say are omitted. The whole block stays inside
 * STATE_BUDGET: the caps do the daily work, and if words still ran long the
 * lowest-priority sections are let go until it fits — canon sheds after the
 * body ledger (SPEC.md M6), and the ruling, the hour, and who's here
 * always stay. */
export function renderStateFacts(state) {
  if (!state || typeof state !== 'object') return '';

  const clockMinutes = state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null;
  const turnCount = Array.isArray(state.log) ? state.log.length : 0;
  const present = Array.isArray(state.present) ? state.present : [];

  /* Sections, most vital first. `shed` ranks what goes first when the
   * budget pinches (higher sheds sooner). */
  const sections = [];

  /* M11: a fight that stands is the freshest fact of the scene and never
   * sheds. (The referee's ruling itself no longer rides here — it has its
   * own "The house has ruled" slot in the dynamic tail, assemble/stack.js.) */
  const fightLine = renderFightLine(state);
  if (fightLine) sections.push({ shed: 0, text: fightLine });

  /* M11: the player's nerve, when it's fraying — the storyteller should
   * let strain show without ever speaking numbers. The pool's max rides the
   * settings (3..12); half of the smallest pool is 1.5, so "fraying" below
   * 3 is a fair reading of the ported schedule across every setting. */
  if (Number.isFinite(state.composure)) {
    if (state.composure < 1.5) sections.push({ shed: 1, text: mcName(state) + ' is near breaking — the strain shows.' });
    else if (state.composure < 3) sections.push({ shed: 1, text: mcName(state) + '\'s nerve is fraying.' });
  }

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

  /* M6: what's true of them — locked facts for whoever is in the scene.
   * Counts toward the budget and sheds after the body ledger. */
  const canonLines = renderCanon(state.canon, present.map((p) => p && p.name));
  if (canonLines) sections.push({ shed: 2, text: 'True of them: ' + canonLines.split('\n').join('\n') });

  const bodyLines = renderBodies(state.bodies, clockMinutes, turnCount)
    .split('\n').filter(Boolean).slice(0, BODIES_TOP);
  if (bodyLines.length) sections.push({ shed: 3, text: bodyLines.join('\n') });

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
  if (standings.length) sections.push({ shed: 4, text: standings.join('\n') });

  /* M29: who knows what — the present only, so the storyteller never has
   * to search the transcript for whether Liara was in the room. */
  const knowledgeLines = renderKnowledge(state.knowledge, present);
  if (knowledgeLines) sections.push({ shed: 2, text: 'Who knows what: ' + knowledgeLines.split('\n').join('\n') });

  const elsewhere = renderOffscreen(state.offscreen, present, clockMinutes);
  if (elsewhere) sections.push({ shed: 5, text: 'Elsewhere: ' + elsewhere.split('\n').join('\n') });

  const factionLines = renderFactions(state.factions);
  if (factionLines) sections.push({ shed: 6, text: 'Factions: ' + factionLines.split('\n').join('\n') });

  const mode = state.mode || {};
  const moods = [];
  if (mode.combat) moods.push('contested — talk has given way to something sharper');
  if (mode.intimate) moods.push('intimate');
  if (mode.travel) moods.push('on the road');
  if (mode.socialField) moods.push('a crowded room, everyone watching everyone');
  if (mode.isolation) moods.push('alone, far from help');
  if (mode.group) moods.push('in company');
  if (moods.length) sections.push({ shed: 1, text: 'The scene is ' + moods.join('; ') + '.' });

  /* Threads: M29's structured threads render with owner and next move;
   * legacy string/label threads still speak. */
  const structured = Array.isArray(state.threads) ? state.threads.filter((t) => t && typeof t === 'object' && typeof t.title === 'string') : [];
  const legacy = Array.isArray(state.threads)
    ? state.threads.map((t) => (typeof t === 'string' ? t : t && !t.title && (t.label || t.name))).filter(Boolean)
    : [];
  const threadText = [renderThreads(structured), legacy.join('; ')].filter(Boolean).join('\n');
  if (threadText) sections.push({ shed: 5, text: 'Threads still open: ' + threadText.split('\n').join('\n') });

  /* The budget: shed the least vital until the block fits. The ruling, the
   * hour, and who's here (shed 0) always stay. */
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

/* M26: the masthead — the house writes the header line itself, from the
 * ledger's own truth, so no model ever forgets it or invents it. */
export function renderMasthead(state) {
  if (!state) return null;
  const bits = [];
  const place = state.place && state.place.name;
  const time = state.clock ? renderClock(state.clock) : null;
  if (!place && !time) return null;
  let line = '';
  if (place) line += place;
  if (time) line += (place ? ' — ' : '') + time;
  bits.push(line);
  const here = (state.present || []).map((p) => p.name).filter(Boolean);
  if (here.length) bits.push('here: ' + here.join(', '));
  return bits.join('  ·  ');
}
