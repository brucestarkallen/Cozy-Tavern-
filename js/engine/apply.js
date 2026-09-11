/* Cozy Tavern — engine/apply.js
 * The mutation applier. The extractor (and the ledger's hand controls)
 * propose mutations in the closed v1 vocabulary; this module is the only
 * place they become true. It validates every proposal, applies the sound
 * ones deterministically, writes a plain-words line into state.log for each,
 * and keeps enough on each log line to take the change back.
 *
 * Contract (SPEC.md M3):
 *   applyMutations(state, mutations)
 *     -> {state, applied:[{mutation, words}], rejected:[{mutation, why}]}
 *     words = a human sentence, e.g. "The clock moved on about half an
 *     hour — the walk to the chapel."
 *     Every applied mutation appends to state.log: {ts, words, undone:false}
 *     (cap 200). Validation: names normalize (trim/case), deltas clamp,
 *     unknown types/flags are rejected with a reason.
 *   undoLast(state)   // reverses the most recent undoable mutation
 *
 * The mutation vocabulary (v1 — closed list; anything else is rejected):
 *   clock.set {year,month,day,hour,minute}     clock.advance {minutes, reason}
 *   presence.enter {name, position?, attire?}  presence.leave {name}
 *   presence.update {name, position?, attire?}
 *   mode.set {flag, reason}                    mode.clear {flag}
 * M4 (v2) added the ledgers: body.injure / body.strain / body.heal,
 * rel.shift / rel.set, offscreen.set / offscreen.clear.
 * M6 (v3) adds the canon store: canon.lock {name, key, value} and
 * canon.unlock {name, key} — certainties written down and let go.
 * M12 (v4) adds the character ledger: people.set {name, field, text} —
 * field is core, state, arc or threads; the main character's page takes
 * state and threads only (record-only, enforced in engine/people.js).
 * M72 adds the two writes that used to bypass the journal (and so were lost
 * by every fold): people.note {name, field, text} — the scribe's sparse
 * delta (field core/state/arc/thread/unthread, mergeDeltas' own laws) —
 * and world.word {brief} — the world agent's word for the next turn.
 *
 * Reversal rides on the log entry as `undo` — a small payload saying what
 * was true before. The spec's documented log shape {ts, words, undone} is
 * kept exactly; `undo` is the additive piece undoLast needs (see AGENTS.md).
 * Pure functions: state is copied, never mutated in place.
 */

import { createClock, setClock, advanceClock, renderClock, MAX_ADVANCE_MINUTES } from './clock.js';
import { addInjury, addStrain, findBodyKey, findInjury, SEV_WORDS } from './bodies.js';
import { shift as relShift, findRelationship, axisWords, AXES, MAX_DELTA, MAX_TOTAL } from './relationships.js';
import { seat, findSeat } from './offscreen.js';
import { lockFact, unlockFact, findCanonKey, findFact } from './canon.js';
import { engineSettings, startDuel, startBattle, startWar, teardownFight, mcName } from './duels.js';
import { setPersonField, findPersonKey, mergeDeltas } from './people.js';
import { normalizeBrief } from './world.js'; /* M72: the world's word is a journaled write */
import { setThread, closeThread, findThread, addKnowledge, findKnowledgeKey, setFaction, findFactionKey, STANCES } from './world.js'; /* M29: the world beyond the page */

const LOG_CAP = 200;

export const MODE_FLAGS = ['combat', 'intimate', 'travel', 'socialField', 'isolation', 'group'];

/* Plain words for each scene mood — used in the log lines and shared with
 * the drawer's "mood of the scene" panel so the app speaks one language. */
export const MODE_WORDS = {
  combat: { on: 'A fight is on', off: 'The fight has ebbed' },
  intimate: { on: 'An intimate scene', off: 'The intimacy has passed' },
  travel: { on: 'On the road', off: 'The road has ended, for now' },
  socialField: { on: 'A crowded room, everyone watching everyone', off: 'The room has thinned' },
  isolation: { on: 'Alone, far from help', off: 'Help is nearer now' },
  group: { on: 'In company', off: 'The company has scattered' },
};

/* ---------- small helpers ---------- */

/* The ledger maps are plain JSON data; a JSON round-trip is the deep copy. */
function cloneMap(map) {
  if (!map || typeof map !== 'object') return {};
  try { return JSON.parse(JSON.stringify(map)); } catch (err) { return {}; }
}

function copyState(state) {
  const safe = state && typeof state === 'object' ? state : {};
  return {
    ...safe,
    present: Array.isArray(safe.present) ? safe.present.map((p) => ({ ...p })) : [],
    mode: { ...(safe.mode || {}) },
    log: Array.isArray(safe.log) ? safe.log.slice() : [],
    clock: safe.clock && typeof safe.clock === 'object' ? { ...safe.clock } : safe.clock ?? null,
    bodies: cloneMap(safe.bodies),
    relationships: cloneMap(safe.relationships),
    offscreen: cloneMap(safe.offscreen),
    canon: cloneMap(safe.canon),
    /* M29: the world beyond the page rides the same copy discipline. */
    knowledge: cloneMap(safe.knowledge),
    factions: cloneMap(safe.factions),
    threads: Array.isArray(safe.threads) ? safe.threads.map((t) => (t && typeof t === 'object' ? { ...t } : t)) : [],
    /* M12: the character ledger rides the same copy discipline. */
    characters: cloneMap(safe.characters),
    /* M11: the referee's world — sheet, live fights, strain, and the
     * committed-fate timeline ride the same copy discipline. */
    sheet: safe.sheet && typeof safe.sheet === 'object' ? cloneMap(safe.sheet) : safe.sheet,
    duel: safe.duel && typeof safe.duel === 'object' ? cloneMap({ d: safe.duel }).d : (safe.duel ?? null),
    battle: safe.battle && typeof safe.battle === 'object' ? cloneMap({ b: safe.battle }).b : (safe.battle ?? null),
    refHistory: Array.isArray(safe.refHistory) ? cloneMap({ r: safe.refHistory }).r : [],
  };
}

/* Name normalization: trim, collapse inner whitespace. Matching is
 * case-insensitive ("mira" and "Mira" are the same person); the casing
 * already written in the ledger wins. */
function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ');
}

function findPresent(state, name) {
  const wanted = name.toLowerCase();
  return state.present.findIndex((p) => p && typeof p.name === 'string'
    && p.name.trim().toLowerCase() === wanted);
}

function isInt(value) {
  return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value;
}

function appendLog(state, words, undo) {
  const entry = { ts: Date.now(), words, undone: false };
  if (undo) entry.undo = undo;
  state.log.push(entry);
  if (state.log.length > LOG_CAP) state.log = state.log.slice(state.log.length - LOG_CAP);
  return entry;
}

/* M4: the story clock's minutes (null when the clock was never set).
 * M9 (B14): the turn count is state.turn — a monotonic counter, bumped once
 * per applied batch, independent of the capped log (the log's length used to
 * serve, and ages went backwards once the log capped at 200). */
function clockMinutesOf(state) {
  return state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null;
}

function turnOf(state) {
  return Number.isFinite(state.turn) ? state.turn : 0;
}

/* Free text the ledgers accept: cleaned, and capped so no single note can
 * blow the state-of-things render budget. Over-long text is trimmed, not
 * rejected — the meaning usually survives the trim. */
function capText(value, limit) {
  if (typeof value !== 'string') return '';
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length > limit ? clean.slice(0, limit - 1).trimEnd() + '…' : clean;
}

/* ---------- the words the clock speaks ---------- */

function describeDelta(minutes) {
  if (minutes <= 0) return 'no time at all';
  if (minutes < 3) return 'a moment';
  if (minutes === 30) return 'about half an hour';
  if (minutes < 60) return 'about ' + Math.round(minutes) + ' minutes';
  if (minutes < 90) return 'about an hour';
  if (minutes < 60 * 24) {
    const hours = minutes / 60;
    const rounded = Math.round(hours * 2) / 2;
    return 'about ' + rounded + ' hours';
  }
  const days = Math.round(minutes / (60 * 24));
  return days === 1 ? 'about a day' : 'about ' + days + ' days';
}

/* ---------- the individual mutations ---------- */

const HANDLERS = {
  'mc.set'(state, m) {
    /* M28: who the writer plays. Until now the ledger learned the main
     * character's name only from the referee's sheet seeder — after the
     * first fight — or by hand; every worker before that spoke of "the main
     * character" without knowing who that was. The founding read names them
     * on turn one. A name already known is never overwritten by a worker:
     * the hand (How they measure) wins, and a worker's second guess is
     * refused rather than logged. */
    const name = normalizeName(m.name || '');
    if (!name) return { ok: false, why: 'the main character needs a name' };
    if (!state.sheet || typeof state.sheet !== 'object') state.sheet = { actors: {}, playerName: '' };
    const before = typeof state.sheet.playerName === 'string' ? state.sheet.playerName.trim() : '';
    if (before && before.toLowerCase() === name.toLowerCase()) return { ok: false, why: 'the main character is already known as ' + before };
    if (before) return { ok: false, why: 'the main character is already known as ' + before + ' — change it by hand in How they measure' };
    state.sheet = { ...state.sheet, playerName: name.slice(0, 60) };
    return {
      ok: true,
      words: 'The main character is ' + name + '.',
      undo: { kind: 'mc.restore', before },
    };
  },

  /* M47: the mood as a whole board. The reader states EVERY mood that holds
   * on this page; anything not named is cleared. Diffed against the ledger
   * so only real changes are logged. The old mode.set/mode.clear stay for
   * the hand and for a single change. */
  'mode.snapshot'(state, m) {
    const list = Array.isArray(m.flags) ? m.flags : (typeof m.flags === 'string' ? m.flags.split(/[,\s]+/) : []);
    const wanted = new Set(list.map((f) => String(f || '').trim()).filter((f) => MODE_FLAGS.includes(f)));
    const before = { ...state.mode };
    const turnedOn = MODE_FLAGS.filter((f) => wanted.has(f) && !state.mode[f]);
    const turnedOff = MODE_FLAGS.filter((f) => !wanted.has(f) && state.mode[f]);
    if (!turnedOn.length && !turnedOff.length) return { why: 'the mood is as it was' };
    for (const f of turnedOn) state.mode[f] = true;
    for (const f of turnedOff) state.mode[f] = false;
    const on = (f) => (MODE_WORDS[f] && MODE_WORDS[f].on) || f;
    const off = (f) => (MODE_WORDS[f] && MODE_WORDS[f].off) || f;
    const words = [
      turnedOn.length ? turnedOn.map(on).join('; ') : '',
      turnedOff.length ? turnedOff.map(off).join('; ') : '',
    ].filter(Boolean).join('; ') + '.';
    return { words, undo: { kind: 'mode.restore', before } };
  },

  'place.set'(state, m) {
    /* M26: where the scene stands — set when the ground moves or is first named. */
    const name = normalizeName(m.name || m.place || '');
    if (!name) return { ok: false, why: 'a place needs a name' };
    const before = state.place ? state.place.name : null;
    state.place = { name };
    return {
      ok: true,
      words: 'The scene now stands in ' + name + '.',
      undo: { kind: 'place', before },
    };
  },

  'clock.set'(state, m) {
    const { year, month, day, hour, minute } = m;
    if (![year, month, day, hour, minute].every(isInt)) {
      return { why: 'a clock needs a year, month, day, hour and minute, all whole numbers' };
    }
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return { why: 'those numbers don’t land on any calendar' };
    }
    const before = state.clock ? { ...state.clock } : null;
    state.clock = state.clock
      ? setClock(state.clock, { year, month, day, hour, minute })
      : createClock({ calendar: 'real', start: { year, month, day, hour, minute } });
    const words = 'The clock was set — ' + renderClock(state.clock) + '.';
    return { words, undo: { kind: 'clock', before } };
  },

  'clock.advance'(state, m) {
    const minutes = Number(m.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return { why: 'it didn’t say how much time passed' };
    }
    if (!state.clock || typeof state.clock.minutes !== 'number') {
      return { why: 'the clock hasn’t been set yet — nothing to move on from' };
    }
    const clamped = Math.min(MAX_ADVANCE_MINUTES, Math.round(minutes));
    const before = { ...state.clock };
    state.clock = advanceClock(state.clock, clamped, m.reason);
    let words = 'The clock moved on ' + describeDelta(clamped);
    if (clamped > 12 * 60) {
      words += ' — a long stretch, more than twelve hours, so it’s worth a second look';
    }
    if (typeof m.reason === 'string' && m.reason.trim()) {
      words += ' — ' + m.reason.trim().replace(/\.+$/, '');
    }
    words += '.';
    if (minutes > MAX_ADVANCE_MINUTES) {
      words += ' (It asked for longer; the clock only goes so far in one step.)';
    }
    return { words, undo: { kind: 'clock', before } };
  },

  'presence.enter'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    if (findPresent(state, name) !== -1) {
      return { why: name + ' is already written in' };
    }
    const entry = { name };
    const position = typeof m.position === 'string' ? m.position.trim() : '';
    const attire = typeof m.attire === 'string' ? m.attire.trim() : '';
    if (position) entry.position = position;
    if (attire) entry.attire = attire;
    state.present.push(entry);
    /* M57: someone who walks in is no longer passed through */
    { const key = findPersonKey(state.characters, name); if (key && state.characters[key] && state.characters[key].retired) { const { retired, retiredAtTurn, ...rest } = state.characters[key]; state.characters[key] = { ...rest, updatedAtTurn: turnOf(state) }; } }
    let words = name + ' came into the scene';
    const detail = [position, attire].filter(Boolean).join(', ');
    if (detail) words += ' — ' + detail;
    words += '.';
    /* M4: walking back into the scene lets go of the elsewhere note —
     * presence.enter auto-unseats (and the undo puts the seat back). */
    const seated = findSeat(state.offscreen, name);
    if (seated) {
      delete state.offscreen[seated.key];
      words += ' The elsewhere note let go of ' + entry.name + '.';
    }
    return {
      words,
      undo: {
        kind: 'presence.remove',
        name: entry.name,
        offscreenBefore: seated ? { name: seated.key, entry: seated.entry } : null,
      },
    };
  },

  'presence.leave'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const at = findPresent(state, name);
    if (at === -1) return { why: 'no one here answers to ' + name };
    const before = { ...state.present[at] };
    state.present.splice(at, 1);
    return {
      words: before.name + ' stepped out of the scene.',
      undo: { kind: 'presence.restore', before, index: at },
    };
  },

  'presence.update'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const at = findPresent(state, name);
    if (at === -1) return { why: 'no one here answers to ' + name };
    if (m.position === undefined && m.attire === undefined) {
      return { why: 'it didn’t say what changed about ' + name };
    }
    const before = { ...state.present[at] };
    const entry = state.present[at];
    const changed = [];
    if (m.position !== undefined) {
      const position = typeof m.position === 'string' ? m.position.trim() : '';
      if (position) { entry.position = position; changed.push(position); } else { delete entry.position; }
    }
    if (m.attire !== undefined) {
      const attire = typeof m.attire === 'string' ? m.attire.trim() : '';
      if (attire) { entry.attire = attire; changed.push('in ' + attire); } else { delete entry.attire; }
    }
    const words = changed.length
      ? entry.name + ' — now ' + changed.join(', ') + '.'
      : entry.name + ' — the details were let go.';
    return { words, undo: { kind: 'presence.restore', before, index: at } };
  },

  'mode.set'(state, m) {
    const flag = typeof m.flag === 'string' ? m.flag.trim() : '';
    if (!MODE_FLAGS.includes(flag)) {
      return { why: '“' + (flag || '?') + '” isn’t a mood the ledger knows' };
    }
    if (state.mode[flag]) return { why: MODE_WORDS[flag].on.toLowerCase() + ' — that was already so' };
    state.mode[flag] = true;
    let words = MODE_WORDS[flag].on + '.';
    if (typeof m.reason === 'string' && m.reason.trim()) {
      words = words.slice(0, -1) + ' — ' + m.reason.trim().replace(/\.+$/, '') + '.';
    }
    return { words, undo: { kind: 'mode', flag, before: false } };
  },

  'mode.clear'(state, m) {
    const flag = typeof m.flag === 'string' ? m.flag.trim() : '';
    if (!MODE_FLAGS.includes(flag)) {
      return { why: '“' + (flag || '?') + '” isn’t a mood the ledger knows' };
    }
    if (!state.mode[flag]) return { why: 'that mood wasn’t on' };
    state.mode[flag] = false;
    return { words: MODE_WORDS[flag].off + '.', undo: { kind: 'mode', flag, before: true } };
  },

  /* ---------- M4: the three ledgers ---------- */

  'body.injure'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const what = capText(m.what, 140);
    if (!what) return { why: 'it didn’t say what the hurt was' };
    const key = findBodyKey(state.bodies, name) || name;
    const before = state.bodies[key] ? cloneMap({ [key]: state.bodies[key] })[key] : null;
    state.bodies = addInjury(
      state.bodies, key,
      { what, sev: m.sev, treated: m.treated },
      clockMinutesOf(state), turnOf(state)
    );
    const sev = state.bodies[key].injuries[state.bodies[key].injuries.length - 1].sev;
    const words = key + ' was hurt — ' + what + ' (' + (SEV_WORDS[sev] || SEV_WORDS[1])
      + (m.treated ? ', seen to' : ', untreated') + ').';
    return { words, undo: { kind: 'body.restore', name: key, before } };
  },

  'body.strain'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const what = capText(m.what, 140);
    if (!what) return { why: 'it didn’t say what wore them down' };
    const key = findBodyKey(state.bodies, name) || name;
    const before = state.bodies[key] ? cloneMap({ [key]: state.bodies[key] })[key] : null;
    state.bodies = addStrain(state.bodies, key, { what }, clockMinutesOf(state), turnOf(state));
    return {
      words: key + ' is worn — ' + what + '.',
      undo: { kind: 'body.restore', name: key, before },
    };
  },

  'body.heal'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const key = findBodyKey(state.bodies, name);
    const body = key ? state.bodies[key] : null;
    const injury = body ? findInjury(body, m.what) : null;
    if (injury) {
      const before = cloneMap({ [key]: body })[key];
      injury.healed = true;
      return {
        words: key + ' is mended — ' + injury.what + ', healed.',
        undo: { kind: 'body.restore', name: key, before },
      };
    }
    /* A weariness lifts the same way a hurt heals — matched by its words,
     * and simply let go of (strain keeps no healed flag). */
    const wanted = normalizeName(typeof m.what === 'string' ? m.what : '').toLowerCase();
    const strain = body && Array.isArray(body.strain) ? body.strain : [];
    const at = wanted
      ? strain.findIndex((s) => {
          const have = normalizeName(s && s.what).toLowerCase();
          return have === wanted || have.includes(wanted) || wanted.includes(have);
        })
      : -1;
    if (at === -1) {
      return { why: 'the ledger knows no such hurt on ' + name + ' still needing to heal' };
    }
    const before = cloneMap({ [key]: body })[key];
    const lifted = strain[at];
    body.strain.splice(at, 1);
    return {
      words: key + ' has shaken it off — ' + lifted.what + '.',
      undo: { kind: 'body.restore', name: key, before },
    };
  },

  'rel.shift'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const axis = typeof m.axis === 'string' ? m.axis.trim().toLowerCase() : '';
    if (!AXES.includes(axis)) {
      return { why: '“' + (axis || '?') + '” isn’t an axis the ledger keeps (only p, r, s — and only toward the main character)' };
    }
    const raw = Number(m.delta);
    if (!Number.isFinite(raw) || raw === 0) {
      return { why: 'it didn’t say how far the feeling moved' };
    }
    const cause = capText(m.cause, 200);
    if (!cause) {
      return { why: 'a shift between people needs its reason in words — what on the page earned it' };
    }
    const found = findRelationship(state.relationships, name);
    const key = found ? found.key : name;
    const before = found ? cloneMap({ [key]: found.rel })[key] : null;
    state.relationships = relShift(
      state.relationships, key,
      { axis, delta: raw, cause },
      clockMinutesOf(state)
    );
    const total = state.relationships[key][axis];
    let words = key + ' — ' + axisWords(axis, total) + ', after ' + cause.replace(/\.+$/, '') + '.';
    if (Math.abs(raw) > MAX_DELTA) {
      words += ' (It asked for more; a single beat only moves so far.)';
    }
    return { words, undo: { kind: 'rel.restore', name: key, before } };
  },

  'rel.set'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const cause = capText(m.cause, 200);
    if (!cause) {
      return { why: 'writing a standing down by hand still needs its reason in words' };
    }
    const given = {};
    for (const axis of AXES) {
      const raw = Number(m[axis]);
      if (Number.isFinite(raw)) given[axis] = Math.min(MAX_TOTAL, Math.max(-MAX_TOTAL, Math.round(raw)));
    }
    if (!Object.keys(given).length) {
      return { why: 'it didn’t say where any axis stands' };
    }
    const found = findRelationship(state.relationships, name);
    const key = found ? found.key : name;
    const before = found ? cloneMap({ [key]: found.rel })[key] : null;
    if (!found) state.relationships[key] = { p: 0, r: 0, s: 0, history: [] };
    const rel = state.relationships[key];
    for (const [axis, value] of Object.entries(given)) rel[axis] = value;
    rel.history.push({
      atMinutes: clockMinutesOf(state),
      axis: Object.keys(given)[0],
      delta: 0,
      cause: 'set — ' + cause.replace(/\.+$/, ''), /* M50: whose hand, the cause says */
    });
    if (rel.history.length > 30) rel.history = rel.history.slice(rel.history.length - 30);
    const parts = AXES.map((axis) => axisWords(axis, rel[axis])).filter(Boolean);
    const words = key + ' stands ' + (parts.join(', ') || 'neutral all through')
      + ' — set: ' + cause.replace(/\.+$/, '') + '.';
    return { words, undo: { kind: 'rel.restore', name: key, before } };
  },

  /* M50: a standing let go entirely (a mis-parsed or duplicate entry) —
   * undoable like a set. */
  'rel.clear'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const found = findRelationship(state.relationships, name);
    if (!found) return { why: 'no standing stands for ' + name };
    const before = cloneMap({ [found.key]: found.rel })[found.key];
    delete state.relationships[found.key];
    const why = capText(m.cause, 200);
    return { words: found.key + '’s standing was let go' + (why ? ' — ' + why.replace(/\.+$/, '') : '') + '.', undo: { kind: 'rel.restore', name: found.key, before } };
  },

  'offscreen.set'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const location = capText(m.location, 120);
    const activity = capText(m.activity, 140);
    if (!location && !activity) {
      return { why: 'it didn’t say where they went or what they’re at' };
    }
    const seated = findSeat(state.offscreen, name);
    const key = seated ? seated.key : name;
    const before = seated ? { ...seated.entry } : null;
    /* M29: a stance toward the main character and an arrival on the clock
     * may ride the seat. An unknown stance is dropped, never a reason to
     * refuse the seat. */
    const stance = typeof m.stance === 'string' && STANCES.includes(m.stance.trim().toLowerCase())
      ? m.stance.trim().toLowerCase() : '';
    const eta = Number(m.etaMinutes);
    const etaMinutes = Number.isFinite(eta) && eta >= 0 ? Math.min(60 * 24 * 30, Math.round(eta)) : undefined;
    state.offscreen = seat(
      state.offscreen, key,
      { location, activity, agenda: capText(m.agenda, 140), stance, etaMinutes },
      clockMinutesOf(state), turnOf(state)
    );
    let words = 'Elsewhere: ' + key + ' — ' + [location, activity].filter(Boolean).join(', ');
    if (stance === 'toward' || stance === 'seeking') words += ' — ' + (stance === 'toward' ? 'heading this way' : 'looking for ' + mcName(state));
    if (Number.isFinite(etaMinutes)) words += ', about ' + etaMinutes + ' minutes out';
    words += '.';
    return { words, undo: { kind: 'offscreen.restore', name: key, before } };
  },

  'offscreen.clear'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const seated = findSeat(state.offscreen, name);
    if (!seated) return { why: 'the ledger has no elsewhere note for ' + name };
    delete state.offscreen[seated.key];
    return {
      words: seated.key + '’s elsewhere note was let go.',
      undo: { kind: 'offscreen.restore', name: seated.key, before: { ...seated.entry } },
    };
  },

  /* ---------- M6: the canon store ---------- */

  'canon.lock'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const key = capText(m.key, 40);
    if (!key) return { why: 'it didn’t say what the truth is called — hair, eyes, a limp' };
    const value = capText(m.value, 140);
    if (!value) return { why: 'it didn’t say what’s true of ' + name };
    const canonKey = findCanonKey(state.canon, name) || name;
    const before = state.canon[canonKey] ? cloneMap({ [canonKey]: state.canon[canonKey] })[canonKey] : null;
    const held = before ? findFact(before, key) : null;
    state.canon = lockFact(state.canon, canonKey, { key, value }, clockMinutesOf(state));
    const words = held
      ? canonKey + ' — ' + held.entry.key + ' stands corrected: ' + value + ' (it was ' + held.entry.value + ').'
      : canonKey + ' — it is now true: ' + key + ': ' + value + '.';
    return { words, undo: { kind: 'canon.restore', name: canonKey, before } };
  },

  'canon.unlock'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const canonKey = findCanonKey(state.canon, name);
    if (!canonKey) return { why: 'nothing is locked true of ' + name };
    const key = capText(m.key, 40);
    const held = findFact(state.canon[canonKey], key);
    if (!held) return { why: 'no truth called “' + (key || '?') + '” is locked for ' + canonKey };
    const before = cloneMap({ [canonKey]: state.canon[canonKey] })[canonKey];
    state.canon = unlockFact(state.canon, canonKey, key);
    return {
      words: canonKey + ' — “' + held.entry.key + '” is no longer written as certain.',
      undo: { kind: 'canon.restore', name: canonKey, before },
    };
  },

  /* ---------- M12: the character ledger ---------- */

  /* people.set {name, field, text} — the writer's hand on a character's
   * page: core (their nature), state (where they are, how they're doing),
   * arc (how things stand, and why), threads (loose ends, semicolon- or
   * newline-separated). The main character's page is record-only — state
   * and threads, never core or arc (engine/people.js enforces it). */
  /* ---------- M29: the world beyond the page ---------- */

  'thread.set'(state, m) {
    const title = capText(m.title || m.name, 120);
    if (!title) return { why: 'a thread needs a title' };
    const heat = typeof m.heat === 'string' ? m.heat.trim().toLowerCase() : '';
    const before = Array.isArray(state.threads) ? state.threads.map((t) => (t && typeof t === 'object' ? { ...t } : t)) : [];
    const at = findThread(before, title);
    state.threads = setThread(state.threads, {
      title, owner: capText(m.owner, 60), heat: heat === 'cold' ? 'cold' : (heat === 'hot' ? 'hot' : undefined), next: capText(m.next, 200),
    }, turnOf(state));
    const words = (at === -1 ? 'A thread opened: ' : 'A thread moved: ') + title
      + (capText(m.next, 200) ? ' — next, ' + capText(m.next, 200).replace(/\.+$/, '') : '')
      + (heat === 'cold' ? ' (gone cold)' : '') + '.';
    return { words, undo: { kind: 'threads.restore', before } };
  },

  'thread.close'(state, m) {
    const title = capText(m.title || m.name, 120);
    if (!title) return { why: 'a thread needs a title' };
    const before = Array.isArray(state.threads) ? state.threads.map((t) => (t && typeof t === 'object' ? { ...t } : t)) : [];
    if (findThread(before, title) === -1) return { why: 'no thread called ' + title + ' is open' };
    state.threads = closeThread(state.threads, title);
    return { words: 'A thread closed: ' + title + '.', undo: { kind: 'threads.restore', before } };
  },

  'knowledge.add'(state, m) {
    const name = normalizeName(m.name);
    const fact = capText(m.fact || m.text, 200);
    if (!name) return { why: 'no name came with it' };
    if (!fact) return { why: 'it didn’t say what ' + name + ' learned' };
    const key = findKnowledgeKey(state.knowledge, name) || name;
    const before = state.knowledge && Array.isArray(state.knowledge[key]) ? state.knowledge[key].map((k) => ({ ...k })) : null;
    const next = addKnowledge(state.knowledge, key, fact, turnOf(state));
    const after = next[key] || [];
    if (before && after.length === before.length) return { why: key + ' already knows that' };
    state.knowledge = next;
    return { words: key + ' now knows: ' + fact.replace(/\.+$/, '') + '.', undo: { kind: 'knowledge.restore', name: key, before } };
  },

  'faction.set'(state, m) {
    const name = capText(m.name, 80);
    if (!name) return { why: 'a faction needs a name' };
    const stance = capText(m.stance, 140);
    const agenda = capText(m.agenda, 140);
    const move = capText(m.move, 200);
    if (!stance && !agenda && !move) return { why: 'it didn’t say what ' + name + ' wants or did' };
    const key = findFactionKey(state.factions, name) || name;
    const before = state.factions && state.factions[key] ? { ...state.factions[key] } : null;
    state.factions = setFaction(state.factions, key, { stance, agenda, move }, turnOf(state));
    const words = key + (move ? ' moved: ' + move.replace(/\.+$/, '') : (stance ? ' stands ' + stance.replace(/\.+$/, '') : ' wants ' + agenda.replace(/\.+$/, ''))) + '.';
    return { words, undo: { kind: 'faction.restore', name: key, before } };
  },

  /* M57: a passer-through retires — kept, out of the roster and the drawer's
   * main list — and wakes the moment they are on a page again. */
  'people.retire'(state, m) {
    const key = findPersonKey(state.characters, m.name);
    if (!key) return { why: 'no page stands for ' + String(m.name || '?') };
    if (state.characters[key].retired) return { why: key + ' has already passed through' };
    const before = cloneMap({ [key]: state.characters[key] })[key];
    state.characters[key] = { ...state.characters[key], retired: true, retiredAtTurn: turnOf(state) };
    return { words: key + ' passed through — ' + (capText(m.cause, 160) || 'no bond, no seat, no thread, and thirty turns gone') + '.', undo: { kind: 'people.restore', name: key, before } };
  },
  'people.wake'(state, m) {
    const key = findPersonKey(state.characters, m.name);
    if (!key || !state.characters[key].retired) return { why: 'no one by that name is passed through' };
    const before = cloneMap({ [key]: state.characters[key] })[key];
    const { retired, retiredAtTurn, ...rest } = state.characters[key];
    state.characters[key] = { ...rest, updatedAtTurn: turnOf(state) };
    return { words: key + ' is back in the story.', undo: { kind: 'people.restore', name: key, before } };
  },

  'people.set'(state, m) {
    const field = typeof m.field === 'string' ? m.field.trim().toLowerCase() : '';
    const result = setPersonField(state, state.characters, m.name, field, m.text, turnOf(state));
    if (!result.entry) return { why: result.why };
    const before = result.before ? cloneMap({ [result.key]: result.before })[result.key] : null;
    if (result.entry.retired) { const { retired, retiredAtTurn, ...rest } = result.entry; result.entry = rest; } /* M57: a page written wakes them */
    state.characters[result.key] = result.entry;
    const FIELD_WORDS = {
      core: 'their nature',
      state: 'where they are',
      arc: 'how things stand with them',
      threads: 'their loose ends',
    };
    const words = result.key + ' — ' + (FIELD_WORDS[field] || 'their page') + ' was written down'
      + (field === 'threads'
        ? (result.entry.threads.length ? ': ' + result.entry.threads.join('; ') : ' — all let go')
        : ': ' + result.entry[field])
      + '.';
    return { words, undo: { kind: 'people.restore', name: result.key, before } };
  },

  /* M72: the scribe's delta, journaled. Same laws as the merge it replaced
   * (engine/people.js mergeDeltas): the persona redirect, the MC
   * record-only law, the contamination guard, thread/unthread. One delta
   * per mutation so every write has its own line and its own take-back. */
  'people.note'(state, m) {
    const { characters, changes, dropped } = mergeDeltas(state, state.characters, [{ name: m.name, field: m.field, text: m.text }], turnOf(state));
    if (!changes.length) return { why: (dropped[0] && dropped[0].why) || 'the note said nothing new' };
    const key = changes[0].name;
    const before = state.characters && state.characters[key] ? cloneMap({ [key]: state.characters[key] })[key] : null;
    state.characters = characters;
    const field = changes[0].field;
    const FIELD_WORDS = { core: 'their nature', state: 'where they are', arc: 'how things stand with them', thread: 'a loose end', unthread: 'a loose end closed' };
    const shown = field === 'thread' || field === 'unthread'
      ? capText(m.text, 120)
      : capText(state.characters[key][field], 160);
    return {
      words: key + ' — ' + (FIELD_WORDS[field] || 'their page') + ' was noted' + (shown ? ': ' + shown.replace(/\.+$/, '') : '') + '.',
      undo: { kind: 'people.restore', name: key, before },
    };
  },

  /* M72: the world agent's word for the next turn, journaled — so a swipe or
   * a branch gets the same world's word the page it stands on was told, and a
   * fold never hands the storyteller a brief from three pages back. The
   * brief is stamped with this batch's turn; a window opened is remembered
   * (worldShown, the last six) so "never the same beat twice" holds. */
  'world.word'(state, m) {
    const brief = normalizeBrief(m.brief, turnOf(state));
    const before = {
      brief: state.worldBrief ? JSON.parse(JSON.stringify(state.worldBrief)) : null,
      shown: Array.isArray(state.worldShown) ? state.worldShown.map((w) => ({ ...w })) : [],
    };
    state.worldBrief = brief;
    const shown = Array.isArray(state.worldShown) ? state.worldShown.slice() : [];
    if (brief && brief.twb) shown.push({ ...brief.twb, atTurn: brief.atTurn });
    state.worldShown = shown.slice(-6);
    const words = !brief || brief.empty
      ? 'The world had no word to leave this turn.'
      : 'The world left its word for the next turn'
        + (brief.twb ? ' — a window opens' + (brief.twb.who ? ' on ' + brief.twb.who : '') : '')
        + '.';
    return { words, undo: { kind: 'world.restore', before } };
  },

  /* M72: a take-back, journaled. undoEntry/undoLast used to drop the
   * original entry from the journal — a fold from a base taken BEFORE the
   * take-back then put the effect straight back (the base held it; nothing
   * said it was gone). The reversal is an entry of its own now, carrying the
   * original's undo payload, so every fold reverses what the hand reversed. */
  'undo.apply'(state, m) {
    if (!m || !m.undo || typeof m.undo !== 'object') return { why: 'nothing to take back' };
    if (!applyUndo(state, m.undo)) return { why: 'the world moved on; that change cannot be walked back' };
    return { words: 'Taken back — ' + capText(m.of, 200), undo: null };
  },

  /* ---------- M11: the combat ledger bridge ---------- */

  'combat.begin'(state, m) {
    const kind = ['duel', 'battle', 'war'].includes(m.kind) ? m.kind : null;
    if (!kind) return { why: 'it didn’t say what kind of fight — duel, battle, or war' };
    const eng = engineSettings(m.engine && typeof m.engine === 'object' ? m.engine : {});
    const before = {
      duel: state.duel ? cloneMap({ d: state.duel }).d : null,
      battle: state.battle ? cloneMap({ b: state.battle }).b : null,
      combat: state.mode.combat === true,
      sheet: cloneMap(state.sheet),
    };
    const oppEstimate = Number.isFinite(Number(m.opponentRating)) ? Number(m.opponentRating) : null;
    const roster = (v) => (Array.isArray(v) ? v.map((x) => normalizeName(String(x))).filter(Boolean) : []);
    let started = null;
    if (kind === 'duel') {
      const opponent = normalizeName(m.opponent || '');
      if (!opponent) return { why: 'a duel needs an opponent’s name' };
      started = startDuel(state, {
        playerName: mcName(state), oppName: opponent,
        domain: typeof m.domain === 'string' ? m.domain : 'melee',
        oppEstimate, scaleMismatch: m.scaleMismatch,
      }, eng);
    } else if (kind === 'battle') {
      const enemies = roster(m.enemies);
      if (!enemies.length) return { why: 'a battle needs an enemy side' };
      started = startBattle(state, {
        allies: roster(m.allies), enemies,
        domain: typeof m.domain === 'string' ? m.domain : 'melee',
        oppEstimate, scaleMismatch: m.scaleMismatch,
      }, eng);
    } else {
      started = startWar(state, {
        allies: roster(m.allies), enemies: roster(m.enemies),
        enemyCommander: normalizeName(m.enemyCommander || '') || null,
        scaleMismatch: m.scaleMismatch,
      }, eng);
    }
    if (!started) return { why: 'the fight couldn’t be drawn up from what was said' };
    state.mode.combat = true;
    let words;
    if (kind === 'duel') {
      words = 'A duel is joined — ' + state.duel.player.name + ' against ' + state.duel.opp.name + '.';
    } else if (kind === 'battle') {
      words = 'A battle is joined — ' + state.battle.allies.length + ' against ' + state.battle.enemies.length + '.';
    } else {
      words = 'A war is joined — ' + (state.battle.allies.length - 1) + ' formations against ' + state.battle.enemies.length + '.';
    }
    return { words, undo: { kind: 'combat.restore', before } };
  },

  'combat.end'(state, m) {
    if (!state.duel && !state.battle) return { why: 'no fight was on' };
    const before = {
      duel: state.duel ? cloneMap({ d: state.duel }).d : null,
      battle: state.battle ? cloneMap({ b: state.battle }).b : null,
      combat: state.mode.combat === true,
      sheet: cloneMap(state.sheet),
      bodies: cloneMap(state.bodies),
    };
    const hurt = teardownFight(state);
    state.mode.combat = false;
    const bits = [];
    for (const h of hurt) {
      /* The body ledger knows story names, not aliases of the player. */
      if (!h.name || /^(the player|you|player)$/i.test(h.name)) continue;
      const key = findBodyKey(state.bodies, h.name) || h.name;
      const what = capText('wounds taken in the fight with ' + (h.foe || 'their foe'), 140);
      state.bodies = addInjury(state.bodies, key,
        { what, sev: h.injuries >= 2 ? 3 : 2, treated: false },
        clockMinutesOf(state), turnOf(state));
      bits.push(key + ' carries the fight’s marks (' + (SEV_WORDS[h.injuries >= 2 ? 3 : 2] || 'hurt') + ', untreated).');
    }
    const words = 'The fight has ebbed.' + (bits.length ? ' ' + bits.join(' ') : '');
    return { words, undo: { kind: 'combat.restore', before } };
  },
};

/* ---------- the contract ---------- */

export const JOURNAL_CAP = 6000; /* M69: ~1000 turns of a busy ledger; beyond it the sparse snapshots carry the base */
export function applyMutations(state, mutations) {
  const next = copyState(state);
  const applied = [];
  const rejected = [];
  /* M9 (B14): one batch that writes anything counts as one turn of the
   * story, marked before any handler asks for it. */
  next.turn = turnOf(next) + 1;

  const list = Array.isArray(mutations) ? mutations : [];
  for (const mutation of list) {
    if (!mutation || typeof mutation !== 'object' || typeof mutation.type !== 'string') {
      rejected.push({ mutation, why: 'it isn’t shaped like a mutation at all' });
      continue;
    }
    const handler = HANDLERS[mutation.type];
    if (!handler) {
      rejected.push({ mutation, why: '“' + mutation.type + '” isn’t something the ledger knows how to write' });
      continue;
    }
    const result = handler(next, mutation);
    if (result && result.words) {
      /* M69: the journal — the mutation as applied, stamped with the page, and
       * tied to its log entry so a take-back drops it from the fold */
      if (!Array.isArray(next.journal)) next.journal = [];
      next.journalSeq = (Number.isInteger(next.journalSeq) ? next.journalSeq : 0) + 1;
      const jid = next.journalSeq;
      next.journal.push({ id: jid, p: Number.isInteger(next.page) ? next.page : -1, m: JSON.parse(JSON.stringify(mutation)) });
      if (next.journal.length > JOURNAL_CAP) next.journal = next.journal.slice(next.journal.length - JOURNAL_CAP);
      const logEntry = appendLog(next, result.words, result.undo || null);
      logEntry.jid = jid;
      applied.push({ mutation, words: result.words });
    } else {
      rejected.push({ mutation, why: (result && result.why) || 'it didn’t hold' });
    }
  }

  return { state: next, applied, rejected };
}

/* Reverse the most recent change that can still be taken back. Returns
 * {state, words} — words a plain sentence about the reversal — or null when
 * there's nothing left to undo. The reversal itself is written into the log
 * (marked already-undone, so undoLast walks past it). */
/* M49: what an undo payload touches — one word for the kind, one for the
 * target — so a later change to the same thing can be seen. */
export function undoTarget(undo) {
  if (!undo || typeof undo !== 'object') return '';
  const k = String(undo.kind || '');
  if (k === 'mode' || k === 'mode.restore') return 'mode';
  if (k === 'mc.restore') return 'mc';
  if (k === 'place') return 'place';
  if (k === 'clock') return 'clock';
  if (k === 'threads.restore') return 'threads';
  if (k === 'combat.restore') return 'combat';
  if (k === 'world.restore') return 'world';
  const name = String(undo.name || (undo.before && undo.before.name) || '').trim().toLowerCase();
  /* M72: the undo of an entrance (presence.remove) and the undo of a later
   * change to the same person (presence.restore) are the same target — they
   * used to read as two, so an entrance could be taken back under a
   * standing later change, and taking that back then seated a ghost. */
  return k.replace(/\.(restore|remove)$/, '') + ':' + name;
}

/* M49: take back ONE entry, anywhere in the log — refused when a later
 * standing entry touched the same thing (take those back first). Returns
 * {state, words} | {refused: why} | null. */
/* M72: the reversal rides the journal (undo.apply) — stamped with the
 * ledger's current page, so a fold to any later page reverses it too. */
function journalUndo(next, entry) {
  if (!Array.isArray(next.journal)) next.journal = [];
  next.journalSeq = (Number.isInteger(next.journalSeq) ? next.journalSeq : 0) + 1;
  next.journal.push({ id: next.journalSeq, p: Number.isInteger(next.page) ? next.page : -1, m: { type: 'undo.apply', undo: JSON.parse(JSON.stringify(entry.undo)), of: entry.words } });
  if (next.journal.length > JOURNAL_CAP) next.journal = next.journal.slice(next.journal.length - JOURNAL_CAP);
  const logEntry = appendLog(next, 'Taken back — ' + entry.words, null);
  logEntry.jid = next.journalSeq;
}

export function undoEntry(state, index) {
  const next = copyState(state);
  const entry = next.log[index];
  if (!entry || entry.undone || !entry.undo) return null;
  const target = undoTarget(entry.undo);
  for (let j = index + 1; j < next.log.length; j += 1) {
    const later = next.log[j];
    if (!later || later.undone || !later.undo) continue;
    if (undoTarget(later.undo) === target) return { refused: 'a later change touched the same thing — take that one back first: ' + later.words };
  }
  const applied = applyUndo(next, entry.undo);
  if (!applied) return { refused: 'the world moved on; that change cannot be walked back' };
  next.log[index] = { ...entry, undone: true };
  journalUndo(next, entry);
  return { state: next, words: 'Taken back — ' + entry.words };
}

/* The reversal of one payload against a copy of the state. Shared by
 * undoLast and undoEntry. Returns true when it could be applied. */
function applyUndo(next, undo) {
    let ok = false;

    if (undo.kind === 'mode.restore') {
      next.mode = { ...next.mode, ...(undo.before || {}) };
      ok = true;
    } else if (undo.kind === 'mc.restore') {
      next.sheet = { ...(next.sheet || { actors: {} }), playerName: undo.before || '' };
      ok = true;
    } else if (undo.kind === 'place') {
      next.place = undo.before ? { name: undo.before } : null;
      ok = true;
    } else if (undo.kind === 'clock') {
      next.clock = undo.before ? { ...undo.before } : null;
      ok = true;
    } else if (undo.kind === 'presence.remove') {
      const at = findPresent(next, undo.name || '');
      if (at !== -1) {
        next.present.splice(at, 1);
        /* M4: if coming in let go of an elsewhere note, put it back. */
        if (undo.offscreenBefore && undo.offscreenBefore.entry) {
          next.offscreen[undo.offscreenBefore.name] = { ...undo.offscreenBefore.entry };
        }
        ok = true;
      }
    } else if (undo.kind === 'presence.restore') {
      const at = findPresent(next, (undo.before && undo.before.name) || '');
      if (at !== -1) next.present[at] = { ...undo.before };
      else next.present.splice(Math.min(undo.index ?? next.present.length, next.present.length), 0, { ...undo.before });
      ok = true;
    } else if (undo.kind === 'mode') {
      next.mode[undo.flag] = Boolean(undo.before);
      ok = true;
    } else if (undo.kind === 'body.restore') {
      const key = findBodyKey(next.bodies, undo.name) || undo.name;
      if (undo.before) next.bodies[key] = cloneMap({ [key]: undo.before })[key];
      else delete next.bodies[key];
      ok = true;
    } else if (undo.kind === 'rel.restore') {
      const found = findRelationship(next.relationships, undo.name);
      const key = found ? found.key : undo.name;
      if (undo.before) next.relationships[key] = cloneMap({ [key]: undo.before })[key];
      else delete next.relationships[key];
      ok = true;
    } else if (undo.kind === 'offscreen.restore') {
      const seated = findSeat(next.offscreen, undo.name);
      const key = seated ? seated.key : undo.name;
      if (undo.before) next.offscreen[key] = { ...undo.before };
      else delete next.offscreen[key];
      ok = true;
    } else if (undo.kind === 'combat.restore') {
      const b = undo.before || {};
      next.duel = b.duel ? cloneMap({ d: b.duel }).d : null;
      next.battle = b.battle ? cloneMap({ b: b.battle }).b : null;
      next.mode.combat = b.combat === true;
      if (b.sheet) next.sheet = cloneMap(b.sheet);
      if (b.bodies) next.bodies = cloneMap(b.bodies);
      ok = true;
    } else if (undo.kind === 'canon.restore') {
      const key = findCanonKey(next.canon, undo.name) || undo.name;
      if (undo.before) next.canon[key] = cloneMap({ [key]: undo.before })[key];
      else delete next.canon[key];
      ok = true;
    } else if (undo.kind === 'threads.restore') {
      next.threads = Array.isArray(undo.before) ? undo.before.map((t) => (t && typeof t === 'object' ? { ...t } : t)) : [];
      ok = true;
    } else if (undo.kind === 'knowledge.restore') {
      const key = findKnowledgeKey(next.knowledge, undo.name) || undo.name;
      if (undo.before) next.knowledge[key] = undo.before.map((k) => ({ ...k }));
      else delete next.knowledge[key];
      ok = true;
    } else if (undo.kind === 'faction.restore') {
      const key = findFactionKey(next.factions, undo.name) || undo.name;
      if (undo.before) next.factions[key] = { ...undo.before };
      else delete next.factions[key];
      ok = true;
    } else if (undo.kind === 'world.restore') {
      const b = undo.before || {};
      next.worldBrief = b.brief ? JSON.parse(JSON.stringify(b.brief)) : null;
      next.worldShown = Array.isArray(b.shown) ? b.shown.map((w) => ({ ...w })) : [];
      ok = true;
    } else if (undo.kind === 'people.restore') {
      const key = findPersonKey(next.characters, undo.name) || undo.name;
      if (undo.before) next.characters[key] = cloneMap({ [key]: undo.before })[key];
      else delete next.characters[key];
      ok = true;
    }

    return ok;
}

export function undoLast(state) {
  const next = copyState(state);
  for (let i = next.log.length - 1; i >= 0; i -= 1) {
    const entry = next.log[i];
    if (!entry || entry.undone || !entry.undo) continue;
    if (!applyUndo(next, entry.undo)) continue; // the world moved on; look further back
    next.log[i] = { ...entry, undone: true };
    journalUndo(next, entry);
    return { state: next, words: 'Taken back — ' + entry.words };
  }
  return null;
}
