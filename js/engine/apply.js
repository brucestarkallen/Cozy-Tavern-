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
 *
 * Reversal rides on the log entry as `undo` — a small payload saying what
 * was true before. The spec's documented log shape {ts, words, undone} is
 * kept exactly; `undo` is the additive piece undoLast needs (see AGENTS.md).
 * Pure functions: state is copied, never mutated in place.
 */

import { createClock, setClock, advanceClock, renderClock, MAX_ADVANCE_MINUTES } from './clock.js';

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

function copyState(state) {
  const safe = state && typeof state === 'object' ? state : {};
  return {
    ...safe,
    present: Array.isArray(safe.present) ? safe.present.map((p) => ({ ...p })) : [],
    mode: { ...(safe.mode || {}) },
    log: Array.isArray(safe.log) ? safe.log.slice() : [],
    clock: safe.clock && typeof safe.clock === 'object' ? { ...safe.clock } : safe.clock ?? null,
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
    let words = name + ' came into the scene';
    const detail = [position, attire].filter(Boolean).join(', ');
    if (detail) words += ' — ' + detail;
    words += '.';
    return { words, undo: { kind: 'presence.remove', name: entry.name } };
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
};

/* ---------- the contract ---------- */

export function applyMutations(state, mutations) {
  const next = copyState(state);
  const applied = [];
  const rejected = [];

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
      appendLog(next, result.words, result.undo || null);
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
export function undoLast(state) {
  const next = copyState(state);
  for (let i = next.log.length - 1; i >= 0; i -= 1) {
    const entry = next.log[i];
    if (!entry || entry.undone || !entry.undo) continue;
    const undo = entry.undo;
    let ok = false;

    if (undo.kind === 'clock') {
      next.clock = undo.before ? { ...undo.before } : null;
      ok = true;
    } else if (undo.kind === 'presence.remove') {
      const at = findPresent(next, undo.name || '');
      if (at !== -1) { next.present.splice(at, 1); ok = true; }
    } else if (undo.kind === 'presence.restore') {
      const at = findPresent(next, (undo.before && undo.before.name) || '');
      if (at !== -1) next.present[at] = { ...undo.before };
      else next.present.splice(Math.min(undo.index ?? next.present.length, next.present.length), 0, { ...undo.before });
      ok = true;
    } else if (undo.kind === 'mode') {
      next.mode[undo.flag] = Boolean(undo.before);
      ok = true;
    }

    if (!ok) continue; // the world moved on; look further back
    next.log[i] = { ...entry, undone: true };
    /* The reversal is written down too — carrying no undo payload of its
     * own, so undoLast walks naturally past it. */
    appendLog(next, 'Taken back — ' + entry.words, null);
    return { state: next, words: 'Taken back — ' + entry.words };
  }
  return null;
}
