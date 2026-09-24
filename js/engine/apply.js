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
import { setPersonField, findPersonKey, mergeDeltas, sameLooseEnd, isMc, seatForPerson } from './people.js';
import { samePersonName, isHere, foldName, oneMeaning, nameCore, hasTitle, nameOnPage } from './names.js'; /* M396: one answer to "the same person?"; M414: one meaning; M444: named on the page */
import { normalizeBrief } from './world.js'; /* M72: the world's word is a journaled write */
import { renameInState } from '../agents/ripple.js'; /* M100: the ripple's rename */
import { setThread, closeThread, findThread, addKnowledge, findKnowledgeKey, setFaction, findFactionKey, STANCES, sameFact, factKey, brokenOff } from './world.js'; /* M29: the world beyond the page */

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
    /* M76: the journal was the one ledger not copied — every apply pushed its
     * entries into the CALLER's journal array as well (a dry run on a copy of
     * the state grew the live state's journal). Entries are never mutated
     * after they are written, so a fresh array is the copy. The windows the
     * world opened ride the same way. */
    journal: Array.isArray(safe.journal) ? safe.journal.slice() : [],
    worldShown: Array.isArray(safe.worldShown) ? safe.worldShown.map((w) => ({ ...w })) : [],
    /* M386: the series' truths the writer let go — never shared with the caller's copy */
    canonLetGo: Array.isArray(safe.canonLetGo) ? safe.canonLetGo.slice() : [],
  };
}

/* M386: one spelling for "this person's this truth, let go" — lower case, the way every reader compares */
export function letGoMark(name, key) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase() + '|' + String(key || '').trim().toLowerCase();
}

/* Name normalization: trim, collapse inner whitespace. Matching is
 * case-insensitive ("mira" and "Mira" are the same person); the casing
 * already written in the ledger wins. */
/* Plain tidying for free text that is NOT a name — the words of a hurt, a
 * reason, a cause. M166's name guard must never touch these: a wound is not
 * an object key, and refusing to heal one called "constructor" would be a
 * law applied where it does not live. */
function tidyWords(text) {
  if (typeof text !== 'string') return '';
  return text.trim().replace(/\s+/g, ' ');
}

/* M166: THE MAGIC KEYS ARE NOT NAMES. Every ledger stores its people under
 * their name as an object key, and `next['__proto__'] = entry` on a plain
 * object invokes the prototype setter instead of storing anything — so a
 * glitch token from a cheap model landed as a page the applier REPORTED as
 * written (words in the log, an undo entry, a line in the journal) while
 * the ledger held nothing at all: the log and the world disagreed, and the
 * take-back reached for a key that was never there. duels.js hardened its
 * own key writes against exactly this (safeKey) and the ledgers did not.
 * A name that is one of these is refused, plainly, like any other bad
 * mutation. */
const UNSAFE_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
function normalizeName(name) {
  if (typeof name !== 'string') return '';
  const clean = name.trim().replace(/\s+/g, ' ');
  return UNSAFE_NAMES.has(clean.toLowerCase()) ? '' : clean;
}

/* M257: THE SEAT AND THE PAGE MUST AGREE ON WHO SOMEONE IS. This matched a
 * name EXACTLY while the people ledger resolved short names, surnames, near
 * spellings and truncations (M238, M257) — so "Vanessa" was a stranger to the
 * scene and a known person to her page, and the new guard below could be
 * walked straight past by writing her first name. One question, asked the
 * same way everywhere. */
export function findPresent(state, name, { strict = false } = {}) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return -1;
  const exact = state.present.findIndex((p) => p && typeof p.name === 'string'
    && p.name.trim().toLowerCase() === wanted);
  if (exact !== -1) return exact;
  /* M257: a SEAT is not a page. findPersonKey also merges near SPELLINGS —
   * right for a character page, where a misheard name should find its person,
   * and WRONG here: it made "Person2" the same seat as "Person1", one letter
   * apart, and six laws caught it at once. Seating is a hard fact. Only a
   * name that is plainly the SAME name resolves: a first name, a surname, or
   * one cut short — never a near miss. M396: the one matcher every book uses
   * (engine/names.js) — letters folded (Suì-Fēng is Sui-Feng) and the story's
   * canon knowledge of who answers to which names (Soi Fon is Suì-Fēng). */
  const sameName = (other) => samePersonName(other, wanted);
  const hits = state.present.filter((p) => p && typeof p.name === 'string' && sameName(p.name));
  if (hits.length !== 1) return -1;
  /* M414: STRICT — "IS SOMEONE WHO COMES IN ALREADY HERE?" A name that could mean two people the ledger knows ("Kuchiki"
   * with Rukia in the scene and Byakuya on his page) is not "already here": taken as Rukia, Byakuya walking in was
   * swallowed as "already written in" and could never be put right (the auditor asks the same question). Leaving and
   * moving stay with the scene's own people (only someone here can leave). */
  if (strict && !oneMeaning(state, name)) return -1;
  return state.present.indexOf(hits[0]);
}

/* M419: ONE PERSON, ONE NAME, IN EVERY BOOK — THE BODY LEDGER, THE STANDINGS AND WHO-KNOWS-WHAT TOO. M320's law ("never
 * look a person up in ANY ledger book by exact key") reached the pages and the seats; injuries and standings still matched
 * EXACT letters, and who-knows-what first and last names only — so "Rukia" hurt on one page and "Rukia Kuchiki" on the
 * next were two bodies, and her standing two standings, each holding half its history. An entry is found by the book's
 * own finder first, then by the one matcher (engine/names.js) when exactly one entry answers and the name means one
 * person; a NEW entry is written under the name the person's page stands under. */
export function personBookKey(state, book, name, finder) {
  const map = book && typeof book === 'object' ? book : {};
  const found = typeof finder === 'function' ? finder(map, name) : null;
  if (found) return found;
  /* "you", "I", "the player" and his story name are one person: the main character's own entry */
  if (isMc(state, name) && mcName(state) !== 'the player') return Object.keys(map).find((k) => isMc(state, k)) || null;
  const same = Object.keys(map).filter((k) => samePersonName(k, name));
  return same.length === 1 && oneMeaning(state, name) ? same[0] : null;
}
/* M423: the page a NEW entry is written under is found the way a seat is (M257 — a hard fact): the same letters, or the
 * one matcher when exactly one page answers and the name means one person — never a near spelling. M419 first used the
 * page finder, whose near spelling is right for a misheard name on a page and wrong here: Mira's burned hand and her
 * standing landed on Mara, the innkeeper. */
function strictPageKey(state, name) {
  const pages = Object.keys(state.characters && typeof state.characters === 'object' ? state.characters : {});
  const wanted = String(name || '').trim().toLowerCase();
  const exact = pages.find((k) => k.trim().toLowerCase() === wanted);
  if (exact) return exact;
  const same = pages.filter((k) => samePersonName(k, name));
  return same.length === 1 && oneMeaning(state, name) ? same[0] : '';
}
/* M444: the name a person's page stands under, found the way a seat is (the same letters, or the one matcher when exactly
 * one page answers and the name means one person) — for the house's own writes of who is here */
export function pageNameFor(state, name) { return strictPageKey(state, name); }
function newBookKey(state, name) {
  if (isMc(state, name) && mcName(state) !== 'the player') return strictPageKey(state, mcName(state)) || mcName(state);
  return strictPageKey(state, name) || name;
}
const relKeyOf = (map, name) => { const f = findRelationship(map, name); return f ? f.key : null; };
function findPersonRel(state, name) {
  const key = personBookKey(state, state.relationships, name, relKeyOf);
  return key ? { key, rel: state.relationships[key] } : null;
}

function isInt(value) {
  return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value;
}

export function appendLog(state, words, undo) {
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

/* M162: THE STORY TURN, AND THE WRITE COUNTER, ARE TWO DIFFERENT THINGS.
 * state.turn counts mutation BATCHES — the extractor's, the world agent's,
 * the scribe's, five more on any turn the auditor runs — and every age in
 * the house was stamped and read in that unit. Measured: after twelve pages
 * a wound taken on page one was handed to the storyteller as "24 turns on",
 * and a character noted the same page read "last seen 24 turns ago". Worse,
 * the body ledger READ its ages off state.log.length, which is capped at
 * 200 — so past that the same wound flipped to "just now" and stayed there
 * forever. Every AGE is stamped and read in pages told, which is what a
 * reader means by a turn. state.turn keeps its own meaning (B14's monotonic
 * write counter) and its own tests. */
export function storyTurn(state) {
  if (!state || typeof state !== 'object') return 0;
  return Number.isInteger(state.page) && state.page >= 0 ? state.page + 1 : turnOf(state);
}

/* Free text the ledgers accept: cleaned, and capped so no single note can
 * blow the state-of-things render budget. Over-long text is trimmed, not
 * rejected — the meaning usually survives the trim. */
/* M266: every limit below guards against a runaway answer; none is meant to
 * cut a note a reader wrote in earnest (they were 40–200, and cut them). */
function capText(value, limit) {
  if (typeof value !== 'string') return '';
  const clean = value.trim().replace(/\s+/g, ' ');
  /* M237: cut on a WORD. This chopped at the limit exactly, so a ledger
   * field — a person's core, their state, their arc — could end mid-word
   * with nothing to say what was lost. The same fault as M235's record cut
   * and M236's loose end; this is the third door. */
  if (clean.length <= limit) return clean;
  const room = clean.slice(0, limit - 1);
  const at = Math.max(room.lastIndexOf(' '), room.lastIndexOf('; '), room.lastIndexOf(', '));
  return (at > Math.floor(limit / 2) ? room.slice(0, at) : room).trimEnd().replace(/[,;]$/, '') + '…';
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
    if (before && before.toLowerCase() === name.toLowerCase()) return { ok: false, why: 'the main character is already known as ' + before, same: true }; /* M259: already so */
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
    /* M259: a change that changes nothing is not a change — the header line
     * re-sends its place on every page, and the auditor, shown no ground at
     * all, re-set one the ledger already held and called it a fix.
     * M261: "The Wells Residence" and "Wells Residence" are one place. */
    if (typeof before === 'string' && samePlace(before, name)) return { ok: false, why: 'the scene already stands in ' + before, same: true };
    /* M304: the ground the scene stood on when THIS PAGE began — whoever leaves on
     * a page that also moved the ground was certainly there, and only perhaps
     * at the new one (presence.leave reads this for where they were last seen).
     * Stamped with the page, so it means nothing on any later page; the first
     * move of a page is the one kept. */
    const groundWasBefore = state.groundWas && typeof state.groundWas === 'object' ? { ...state.groundWas } : null;
    if (typeof before === 'string' && before && !(groundWasBefore && groundWasBefore.page === state.page)) state.groundWas = { name: before, page: Number.isInteger(state.page) ? state.page : -1 };
    state.place = { name };
    /* M261: WHERE EACH STOOD BELONGS TO THE OLD GROUND. "By the stove" went on
     * being read to the storyteller after the scene had moved to the garden.
     * The ground moving lets every position go (dress stays); the page's own
     * reader writes the new ones in the same batch, and a take-back puts the
     * old ones back. */
    const positions = [];
    for (const p of Array.isArray(state.present) ? state.present : []) {
      if (p && typeof p.position === 'string' && p.position.trim()) {
        positions.push({ name: p.name, position: p.position, keys: Object.keys(p) });
        delete p.position;
      }
    }
    /* M272: THE MAIN CHARACTER'S "WHERE THEY ARE" BELONGS TO THE OLD GROUND TOO.
     * Jovan's page still read "arrives at the Bluebird" five hours and three
     * places later, and every reader of the whole ledger took it for now. A
     * move lets it go (the writer's own words stay); a take-back restores it. */
    let mcState = null;
    if (typeof before === 'string' && before) {
      for (const [k, entry] of Object.entries(state.characters && typeof state.characters === 'object' ? state.characters : {})) {
        if (!entry || typeof entry.state !== 'string' || !entry.state.trim() || (entry.hand && entry.hand.state) || !isMc(state, k)) continue;
        mcState = { key: k, state: entry.state, ...(entry.nowAt ? { nowAt: entry.nowAt } : {}) };
        const rest = { ...entry };
        delete rest.state;
        delete rest.nowAt; /* M424: a now let go takes the ground it was written on with it (people.set clear does the same) */
        state.characters = { ...state.characters, [k]: rest };
        break;
      }
    }
    return {
      ok: true,
      words: 'The scene now stands in ' + name + '.',
      undo: { kind: 'place', before, positions, mcState, groundWas: groundWasBefore },
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
    const target = state.clock
      ? setClock(state.clock, { year, month, day, hour, minute })
      : createClock({ calendar: 'real', start: { year, month, day, hour, minute } });
    /* M259: the same hour is no change */
    if (before && Number.isFinite(before.minutes) && target && target.minutes === before.minutes) return { why: 'the clock already reads ' + (renderClock(before) || 'that'), same: true };
    state.clock = target;
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
    if (findPresent(state, name, { strict: true }) !== -1) { /* M414 */
      /* M259: someone already here who "comes in" at a new spot has MOVED —
       * the position or dress the page gave is written, not thrown away
       * with a refusal. With nothing new it is already so, not a refusal. */
      const pos = typeof m.position === 'string' ? m.position.trim() : '';
      const att = typeof m.attire === 'string' ? m.attire.trim() : '';
      if (pos || att) {
        const moved = HANDLERS['presence.update'](state, { type: 'presence.update', name, ...(pos ? { position: pos } : {}), ...(att ? { attire: att } : {}) });
        if (moved && moved.same) return { why: name + ' is already written in', same: true };
        return moved;
      }
      return { why: name + ' is already written in', same: true };
    }
    const entry = { name };
    const position = typeof m.position === 'string' ? m.position.trim() : '';
    const attire = typeof m.attire === 'string' ? m.attire.trim() : '';
    if (position) entry.position = position;
    if (attire) entry.attire = attire;
    state.present.push(entry);
    /* M57: someone who walks in is no longer passed through */
    { const key = findPersonKey(state.characters, name); if (key && state.characters[key] && state.characters[key].retired) { const { retired, retiredAtTurn, ...rest } = state.characters[key]; state.characters[key] = { ...rest, updatedAtTurn: storyTurn(state) }; } }
    let words = name + ' came into the scene';
    const detail = [position, attire].filter(Boolean).join(', ');
    if (detail) words += ' — ' + detail;
    const cause = capText(m.cause, 300); /* M444: why the house wrote them in, when it was the house */
    if (cause) words += ' — ' + cause.replace(/\.+$/, '');
    words += '.';
    /* M4: walking back into the scene lets go of the elsewhere note —
     * presence.enter auto-unseats (and the undo puts the seat back). */
    const seated = seatForPerson(state, name); /* M320 */
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
    /* M444: A NAME THAT COULD BE TWO PEOPLE TAKES NOBODY OUT. His Bleach story: Byakuya left the room — the page reader
     * wrote "Captain Kuchiki" — and Byakuya was not written in, so the one Kuchiki who was, Rukia, stepped out of the
     * scene and was noted "last seen" at the very room she stood in. M414 made ENTERING strict and left leaving loose on
     * "only someone here can leave" — but someone standing in the scene unwritten can leave too. The strict answer, the
     * same as entering: a name the ledger knows as two people is nobody's to move. */
    const at = findPresent(state, name, { strict: true });
    if (at === -1) return { why: findPresent(state, name) !== -1 ? '“' + name + '” could be more than one person the story knows — nobody here is taken out on it' : 'no one here answers to ' + name };
    const before = { ...state.present[at] };
    state.present.splice(at, 1);
    /* M304: SOMEONE WHO LEAVES THE PAGE IS NEVER NOWHERE (see engine/offscreen.js).
     * Walking in lets a seat go; walking out wrote nothing, so the people the
     * main character had just been with were the ones the world had no
     * whereabouts for. The house keeps what it knows for certain — where they
     * were last seen and when — unless a seat already says (the prose named
     * where they went, earlier in this batch). The main character is never
     * seated. A take-back of the leaving takes this with it. */
    let seatAdded = null;
    if (!seatForPerson(state, before.name) && !isMc(state, before.name)) { /* M320 */
      const moved = state.groundWas && typeof state.groundWas === 'object' && state.groundWas.page === state.page && typeof state.groundWas.name === 'string' && state.groundWas.name.trim();
      const ground = moved ? state.groundWas.name.trim() : (state.place && typeof state.place.name === 'string' ? state.place.name.trim() : '');
      state.offscreen = seat(state.offscreen, before.name, { location: ground || 'where the scene stood', activity: '', lastSeen: true }, clockMinutesOf(state), storyTurn(state));
      seatAdded = before.name;
    }
    const cause = capText(m.cause, 300);
    return {
      words: before.name + ' stepped out of the scene' + (cause ? ' — ' + cause.replace(/\.+$/, '') : '') + '.',
      undo: { kind: 'presence.restore', before, index: at, ...(seatAdded ? { seatAdded } : {}) },
    };
  },

  'presence.update'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const at = findPresent(state, name, { strict: true }); /* M444: a name that could be two people moves nobody */
    if (at === -1) return { why: findPresent(state, name) !== -1 ? '“' + name + '” could be more than one person the story knows — nobody here is moved on it' : 'no one here answers to ' + name };
    if (m.position === undefined && m.attire === undefined) {
      return { why: 'it didn’t say what changed about ' + name };
    }
    const before = { ...state.present[at] };
    const entry = state.present[at];
    /* M259: the same position and dress is no change */
    {
      const same = (field) => m[field] === undefined || (typeof m[field] === 'string' ? m[field].trim() : '') === (typeof entry[field] === 'string' ? entry[field].trim() : '');
      if (same('position') && same('attire')) return { why: entry.name + ' is already so', same: true };
    }
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
    const what = capText(m.what, 1000);
    if (!what) return { why: 'it didn’t say what the hurt was' };
    const key = personBookKey(state, state.bodies, name, findBodyKey) || newBookKey(state, name); /* M419 */
    const before = state.bodies[key] ? cloneMap({ [key]: state.bodies[key] })[key] : null;
    state.bodies = addInjury(
      state.bodies, key,
      { what, sev: m.sev, treated: m.treated },
      clockMinutesOf(state), storyTurn(state)
    );
    const sev = state.bodies[key].injuries[state.bodies[key].injuries.length - 1].sev;
    const words = key + ' was hurt — ' + what + ' (' + (SEV_WORDS[sev] || SEV_WORDS[1])
      + (m.treated ? ', seen to' : ', untreated') + ').';
    return { words, undo: { kind: 'body.restore', name: key, before } };
  },

  'body.strain'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const what = capText(m.what, 1000);
    if (!what) return { why: 'it didn’t say what wore them down' };
    const key = personBookKey(state, state.bodies, name, findBodyKey) || newBookKey(state, name); /* M419 */
    const before = state.bodies[key] ? cloneMap({ [key]: state.bodies[key] })[key] : null;
    state.bodies = addStrain(state.bodies, key, { what }, clockMinutesOf(state), storyTurn(state));
    return {
      words: key + ' is worn — ' + what + '.',
      undo: { kind: 'body.restore', name: key, before },
    };
  },

  'body.heal'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const key = personBookKey(state, state.bodies, name, findBodyKey); /* M419 */
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
    /* M170: the WORDS of a hurt, not a name — tidied, never name-guarded. */
    const wanted = tidyWords(m.what).toLowerCase();
    const strain = body && Array.isArray(body.strain) ? body.strain : [];
    const at = wanted
      ? strain.findIndex((s) => {
          const have = tidyWords(s && s.what).toLowerCase();
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
    /* M277: a standing is what someone feels toward the main character — never his own */
    if (isMc(state, name)) return { why: 'the main character holds no standing — standings are what others feel toward him' };
    const axis = typeof m.axis === 'string' ? m.axis.trim().toLowerCase() : '';
    if (!AXES.includes(axis)) {
      return { why: '“' + (axis || '?') + '” isn’t an axis the ledger keeps (only p, r, s — and only toward the main character)' };
    }
    const raw = Number(m.delta);
    if (!Number.isFinite(raw) || raw === 0) {
      return { why: 'it didn’t say how far the feeling moved' };
    }
    const cause = capText(m.cause, 1000);
    if (!cause) {
      return { why: 'a shift between people needs its reason in words — what on the page earned it' };
    }
    const found = findPersonRel(state, name); /* M419 */
    const key = found ? found.key : newBookKey(state, name);
    const before = found ? cloneMap({ [key]: found.rel })[key] : null;
    /* M261: A BEAT IS COUNTED ONCE. The page's reader now sees the pages before
     * it; a beat from one of them, sent again, would move a standing twice.
     * The same beat (the same words, in any order, or nearly all of them) in
     * this standing's recent causes, on the same axis and the same way, is
     * already counted. */
    if (found && Array.isArray(found.rel.history)) {
      const recent = found.rel.history.slice(-BEAT_WINDOW);
      if (recent.some((h) => h && h.axis === axis && Math.sign(Number(h.delta) || 0) === Math.sign(raw) && sameBeat(h.cause, cause))) {
        return { why: key + ' — that beat is already counted', same: true };
      }
    }
    state.relationships = relShift(
      state.relationships, key,
      { axis, delta: raw, cause },
      clockMinutesOf(state)
    );
    if (m.byHand === true && state.relationships[key]) state.relationships[key] = { ...state.relationships[key], hand: true }; /* M263 */
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
    if (isMc(state, name) && ['p', 'r', 's'].some((ax) => Number(m[ax]))) return { why: 'the main character holds no standing — standings are what others feel toward him' }; /* M277 */
    const cause = capText(m.cause, 1000);
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
    const found = findPersonRel(state, name); /* M419 */
    const key = found ? found.key : newBookKey(state, name);
    const before = found ? cloneMap({ [key]: found.rel })[key] : null;
    /* M259: a standing already at every number given is no change */
    if (found && Object.entries(given).every(([axis, value]) => (Number(found.rel[axis]) || 0) === value)) return { why: key + ' already stands so', same: true };
    /* M278: "neutral all through" for someone with no standing writes nothing — none is kept at zero */
    if (!found && Object.values(given).every((v) => v === 0)) return { why: key + ' has no standing, and none is kept at zero', same: true };
    if (!found) state.relationships[key] = { p: 0, r: 0, s: 0, history: [] };
    const rel = state.relationships[key];
    for (const [axis, value] of Object.entries(given)) rel[axis] = value;
    if (m.byHand === true) rel.hand = true; /* M263: a standing the writer set is his */
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
    const found = findPersonRel(state, name); /* M419 */
    if (!found) return { why: 'no standing stands for ' + name };
    const before = cloneMap({ [found.key]: found.rel })[found.key];
    delete state.relationships[found.key];
    const why = capText(m.cause, 1000);
    return { words: found.key + '’s standing was let go' + (why ? ' — ' + why.replace(/\.+$/, '') : '') + '.', undo: { kind: 'rel.restore', name: found.key, before } };
  },

  'offscreen.set'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const location = capText(m.location, 500);
    const activity = capText(m.activity, 1000);
    if (!location && !activity) {
      return { why: 'it didn’t say where they went or what they’re at' };
    }
    /* M257: NOBODY IS IN TWO PLACES. The world agent writes where the ABSENT
     * are; presence.enter clears a seat when someone walks in. But nothing
     * stopped a seat being written for someone who is STANDING IN THE ROOM —
     * so the writer's ledger had Mi-na Song and Vanessa Reynolds in the Wells
     * kitchen AND on the road to it, "overdue by about 2 minutes", and the
     * auditor cleared them by hand every few turns. A guard at the door costs
     * nothing and ends it. */
    /* M320: THE SEAT IS WRITTEN UNDER THE PERSON'S OWN NAME — the name their page stands under, when they have
     * one ("Rias" is seated as "Rias Gremory"); a seat they already hold under another form of their name is
     * taken over, never left beside the new one. */
    const pageKey = findPersonKey(state.characters || {}, name);
    if (findPresent(state, name, { strict: true }) !== -1 || (pageKey && findPresent(state, pageKey, { strict: true }) !== -1) || isHere(state, name) || (pageKey && isHere(state, pageKey))) { /* M414: strict */
      return { why: (pageKey || name) + ' is in the scene — they cannot be written elsewhere' };
    }
    /* M396: ELSEWHERE IS NEVER WHERE THE SCENE IS. The world agent seated Rose "in the Tenth Division courtyard, the
     * galleries, watching the yard" while the scene was the duel in that very courtyard: someone there is IN the scene
     * (the page shows who is seen) or on the way to it — "toward", with an arrival — never "elsewhere" at the same
     * place. Judged on the place's first part ("Tenth Division courtyard"), and only for a place of two words or more
     * (a whole city is no one spot). */
    const movingIn = m.stance === 'toward' || m.stance === 'seeking';
    /* M444: THE SCENE'S PLACE, WHOLE — never only its first part. Since M410 the header's place is the whole place
     * ("13th Division Barracks — Captain's Office"), so a first-part test read the COMPOUND: every seat anywhere in it —
     * "13th Division Barracks — the third seats' office", "…, the training yard" — walked into the captain's office, and
     * every one of his people stood beside the main character. The seat is at the scene only when it names every part
     * of the scene's place, and not as a place she is outside of or on the way to (seatAtScene). */
    if (!movingIn && seatAtScene(location, state.place && state.place.name)) {
      /* M402: SOMEONE THE WORLD PUTS WHERE THE SCENE IS, IS IN THE SCENE. Refusing the seat (M396) left them stuck: a
       * "last seen at <the scene's own ground>" note the world agent could never move on — Kyōraku "elsewhere" at the
       * courtyard the duel was in. They walk in instead (their note lets go on its own), and the quiet ones in the room
       * keep them alive (M401). */
      const entered = HANDLERS['presence.enter'](state, { type: 'presence.enter', name: pageKey || name });
      if (entered && entered.words) return { words: (pageKey || name) + ' is where the scene is (' + location + ') — in the scene. ' + entered.words, undo: entered.undo };
      return { why: (pageKey || name) + ' is where the scene is — in the scene already', same: true };
    }
    const seated = seatForPerson(state, pageKey || name) || seatForPerson(state, name);
    const key = pageKey || (seated ? seated.key : name);
    const before = seated && seated.key === key ? { ...seated.entry } : null;
    const moved = seated && seated.key !== key ? { name: seated.key, entry: { ...seated.entry } } : null;
    if (moved) { state.offscreen = { ...state.offscreen }; delete state.offscreen[moved.name]; }
    /* M29: a stance toward the main character and an arrival on the clock
     * may ride the seat. An unknown stance is dropped, never a reason to
     * refuse the seat. */
    const stance = typeof m.stance === 'string' && STANCES.includes(m.stance.trim().toLowerCase())
      ? m.stance.trim().toLowerCase() : '';
    /* M396: an arrival never rides a stance that stays put — "taken up with someone else, due now" said both */
    const eta = Number(m.etaMinutes);
    const etaMinutes = stance !== 'busy' && stance !== 'waiting' && Number.isFinite(eta) && eta >= 0 ? Math.min(60 * 24 * 30, Math.round(eta)) : undefined;
    state.offscreen = seat(
      state.offscreen, key,
      { location, activity, agenda: capText(m.agenda, 1000), stance, etaMinutes },
      clockMinutesOf(state), storyTurn(state)
    );
    let words = 'Elsewhere: ' + key + ' — ' + [location, activity].filter(Boolean).join(', ');
    if (stance === 'toward' || stance === 'seeking') words += ' — ' + (stance === 'toward' ? 'heading this way' : 'looking for ' + mcName(state));
    if (Number.isFinite(etaMinutes)) words += ', about ' + etaMinutes + ' minutes out';
    words += '.';
    return { words, undo: { kind: 'offscreen.restore', name: key, before, ...(moved ? { moved } : {}) } };
  },

  /* M320: a seat standing under another form of its person's name is put under the name their page stands
   * under (the house's own upkeep asks for this; nothing about the seat itself changes). Two seats for one
   * person: the fresher stays. */
  'offscreen.rekey'(state, m) {
    const from = normalizeName(m.from); const to = normalizeName(m.to);
    const seats = state.offscreen && typeof state.offscreen === 'object' ? state.offscreen : {};
    const fromKey = Object.keys(seats).find((k) => k.trim().toLowerCase() === from.toLowerCase());
    if (!from || !to || !fromKey || from.toLowerCase() === to.toLowerCase()) return { why: 'no such seat to rename', same: true };
    const toKey = Object.keys(seats).find((k) => k.trim().toLowerCase() === to.toLowerCase());
    const a = { ...seats[fromKey] }; const b = toKey ? { ...seats[toKey] } : null;
    const fresher = (x, y) => ((Number(x.sinceMinutes) || 0) - (Number(y.sinceMinutes) || 0)) || ((Number(x.atTurn) || 0) - (Number(y.atTurn) || 0));
    const keep = b && fresher(b, a) >= 0 ? b : a;
    state.offscreen = { ...seats };
    delete state.offscreen[fromKey];
    if (toKey) delete state.offscreen[toKey];
    state.offscreen[to] = keep;
    return { words: 'Elsewhere: ' + fromKey + ' is ' + to + ' — one seat, under the name their page stands under.', undo: { kind: 'offscreen.rekey', from: fromKey, fromEntry: a, to, toKey: toKey || null, toEntry: b } };
  },

  'offscreen.clear'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const seated = seatForPerson(state, name); /* M320 */
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
    const key = capText(m.key, 120);
    if (!key) return { why: 'it didn’t say what the truth is called — hair, eyes, a limp' };
    const value = capText(m.value, 1000);
    if (!value) return { why: 'it didn’t say what’s true of ' + name };
    const canonKey = personBookKey(state, state.canon, name, findCanonKey) || newBookKey(state, name); /* M419: what's true of them, one person one entry */
    const before = state.canon[canonKey] ? cloneMap({ [canonKey]: state.canon[canonKey] })[canonKey] : null;
    const held = before ? findFact(before, key) : null;
    /* M386: canon verification writes only where nothing of anyone else's is written — a truth the brief, the writer or a
     * reader holds under that name is theirs, whatever the series says. Its OWN earlier truth it may correct (a page
     * looked up again). */
    const fromCanon = m.source === 'canon';
    if (fromCanon && held && held.entry.source !== 'canon') return { why: canonKey + ' — ' + held.entry.key + ' is already written (' + held.entry.value + ')', same: true };
    if (fromCanon && Array.isArray(state.canonLetGo) && state.canonLetGo.includes(letGoMark(canonKey, key))) return { why: canonKey + ' — ' + key + ' was let go, and stays so', same: true };
    /* M259: a truth already locked in those words is no change */
    const sameWords = held && String(held.entry.value || '').trim().toLowerCase() === value.trim().toLowerCase();
    if (sameWords && Boolean(held.entry.source) === fromCanon) return { why: canonKey + ' — ' + held.entry.key + ' is already locked as ' + held.entry.value, same: true };
    state.canon = lockFact(state.canon, canonKey, { key, value, source: fromCanon ? 'canon' : '' }, clockMinutesOf(state));
    const words = sameWords
      ? canonKey + ' — ' + held.entry.key + ': ' + value + ' is now written as their own, not only the series\u2019.'
      : held
        ? canonKey + ' — ' + held.entry.key + ' stands corrected: ' + value + ' (it was ' + held.entry.value + ').'
        : canonKey + ' — it is now true: ' + key + ': ' + value + (fromCanon ? ' (as the series has it).' : '.');
    return { words, undo: { kind: 'canon.restore', name: canonKey, before, ...(fromCanon ? { source: 'canon', key } : {}) } };
  },

  'canon.unlock'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name came with it' };
    const canonKey = personBookKey(state, state.canon, name, findCanonKey); /* M419 */
    if (!canonKey) return { why: 'nothing is locked true of ' + name };
    const key = capText(m.key, 120);
    const held = findFact(state.canon[canonKey], key);
    if (!held) return { why: 'no truth called “' + (key || '?') + '” is locked for ' + canonKey };
    /* M386: the series takes back only its own truths (a page it no longer holds, a name he blocked) — never one the brief,
     * the writer or a reader wrote — and doing so is no letting-go of his */
    const byCanon = m.source === 'canon';
    if (byCanon && held.entry.source !== 'canon') return { why: canonKey + ' — ' + held.entry.key + ' is not the series’ to take back', same: true };
    const before = cloneMap({ [canonKey]: state.canon[canonKey] })[canonKey];
    state.canon = unlockFact(state.canon, canonKey, key);
    /* M386: a truth the series gave, let go — by the writer's hand, the auditor or the housekeeper — stays let go: canon
     * verification never writes it again on this timeline (the mark is journaled with the unlock, so a branch from before
     * it has the truth back, and taking the unlock back takes the mark back) */
    const mark = held.entry.source === 'canon' && !byCanon ? letGoMark(canonKey, held.entry.key) : '';
    if (mark) state.canonLetGo = [...new Set([...(Array.isArray(state.canonLetGo) ? state.canonLetGo : []), mark])];
    return {
      words: canonKey + ' — “' + held.entry.key + '” is no longer written as certain.',
      undo: { kind: 'canon.restore', name: canonKey, before, ...(mark ? { letGo: mark } : {}) },
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
    const title = capText(m.title || m.name, 300);
    if (!title) return { why: 'a thread needs a title' };
    const heat = typeof m.heat === 'string' ? m.heat.trim().toLowerCase() : '';
    const before = Array.isArray(state.threads) ? state.threads.map((t) => (t && typeof t === 'object' ? { ...t } : t)) : [];
    const at = findThread(before, title);
    /* M272: a next step that breaks off mid-phrase ("Vanessa means to") is not written — the old one stands */
    const nextRaw = capText(m.next, 1000);
    const nextStep = nextRaw && !brokenOff(nextRaw) ? nextRaw : '';
    state.threads = setThread(state.threads, {
      title, owner: capText(m.owner, 120), with: capText(m.with, 120), heat: heat === 'cold' ? 'cold' : (heat === 'hot' ? 'hot' : undefined), next: nextStep,
    }, storyTurn(state), { mc: mcName(state) }); /* M368: between any two people; his own let go last */
    const words = (at === -1 ? 'A thread opened: ' : 'A thread moved: ') + title
      + (nextStep ? ' — next, ' + nextStep.replace(/\.+$/, '') : '')
      + (nextRaw && !nextStep ? ' (its next step broke off mid-phrase, so the old one stands)' : '')
      + (heat === 'cold' ? ' (gone cold)' : '') + '.';
    return { words, undo: { kind: 'threads.restore', before } };
  },

  'thread.close'(state, m) {
    const title = capText(m.title || m.name, 300);
    if (!title) return { why: 'a thread needs a title' };
    const before = Array.isArray(state.threads) ? state.threads.map((t) => (t && typeof t === 'object' ? { ...t } : t)) : [];
    const at = findThread(before, title);
    if (at === -1) return { why: 'no thread called ' + title + ' is open' };
    state.threads = closeThread(state.threads, title);
    return { words: 'A thread closed: ' + before[at].title + '.', undo: { kind: 'threads.restore', before } };
  },

  /* M272: A FACT LET GO — one the person does not know after all, or a copy
   * written twice. The ledger could only ever add to what someone knew. Every
   * line that answers to the quoted fact goes; a take-back restores them. */
  'knowledge.forget'(state, m) {
    const name = normalizeName(m.name);
    const fact = capText(m.fact || m.text, 1000);
    if (!name) return { why: 'no name came with it' };
    if (!fact) return { why: 'it didn’t say which fact to let go' };
    const key = personBookKey(state, state.knowledge, name, findKnowledgeKey); /* M419 */
    const list = key && state.knowledge && Array.isArray(state.knowledge[key]) ? state.knowledge[key] : [];
    if (!list.length) return { why: (key || name) + ' has nothing written down to let go' };
    const want = factKey(fact);
    const keep = list.filter((k) => !(sameFact(k.fact, fact) || (want.length >= 12 && factKey(k.fact).includes(want))));
    if (keep.length === list.length) return { why: 'no line of what ' + key + ' knows answers to “' + fact.slice(0, 80) + '”' };
    const before = list.map((k) => ({ ...k }));
    const gone = list.length - keep.length;
    state.knowledge = { ...state.knowledge, [key]: keep };
    if (!keep.length) delete state.knowledge[key];
    return { words: key + ' no longer knows: ' + fact.replace(/\.+$/, '') + ' (' + gone + (gone === 1 ? ' line' : ' lines') + ' let go).', undo: { kind: 'knowledge.restore', name: key, before } };
  },

  'knowledge.add'(state, m) {
    const name = normalizeName(m.name);
    const fact = capText(m.fact || m.text, 1000);
    if (!name) return { why: 'no name came with it' };
    if (!fact) return { why: 'it didn’t say what ' + name + ' learned' };
    const key = personBookKey(state, state.knowledge, name, findKnowledgeKey) || newBookKey(state, name); /* M419 */
    const before = state.knowledge && Array.isArray(state.knowledge[key]) ? state.knowledge[key].map((k) => ({ ...k })) : null;
    const next = addKnowledge(state.knowledge, key, fact, storyTurn(state));
    const after = next[key] || [];
    if (before && after.length === before.length) return { why: key + ' already knows that' };
    state.knowledge = next;
    return { words: key + ' now knows: ' + fact.replace(/\.+$/, '') + '.', undo: { kind: 'knowledge.restore', name: key, before } };
  },

  'faction.set'(state, m) {
    /* M170: a faction is stored under its name as an object key, the same as
     * a person — and this door took capText, which does not carry M166's
     * guard. So a faction called "__proto__" was REPORTED as moved ("burned
     * the bridge") while the ledger stored nothing at all. Names go through
     * the name door, whoever they belong to. */
    const name = capText(normalizeName(m.name), 200);
    if (!name) return { why: 'a faction needs a name' };
    const stance = capText(m.stance, 500);
    const agenda = capText(m.agenda, 1000);
    const move = capText(m.move, 1000);
    if (!stance && !agenda && !move) return { why: 'it didn’t say what ' + name + ' wants or did' };
    const key = findFactionKey(state.factions, name) || name;
    const before = state.factions && state.factions[key] ? { ...state.factions[key] } : null;
    state.factions = setFaction(state.factions, key, { stance, agenda, move }, storyTurn(state));
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
    state.characters[key] = { ...state.characters[key], retired: true, retiredAtTurn: storyTurn(state) };
    return { words: key + ' passed through — ' + (capText(m.cause, 1000) || 'no bond, no seat, no thread, and thirty turns gone') + '.', undo: { kind: 'people.restore', name: key, before } };
  },
  /* M100: people.rename — a name changed by the writer's hand is changed
   * everywhere the ledger holds it (keys and fields). Undoable whole. */
  'people.rename'(state, m) {
    const from = normalizeName(m.from); const to = normalizeName(m.to);
    if (!from || !to) return { why: 'a rename needs the old name and the new' };
    if (from.toLowerCase() === to.toLowerCase()) return { why: 'the same name' };
    const keys = ['characters', 'offscreen', 'relationships', 'knowledge', 'canon', 'bodies', 'present', 'threads', 'factions', 'sheet'];
    const before = {};
    for (const k of keys) before[k] = JSON.parse(JSON.stringify(state[k] === undefined ? null : state[k]));
    const { state: renamed, count } = renameInState(state, from, to);
    if (!count) return { why: 'nothing in the ledger is called ' + from };
    for (const k of keys) if (renamed[k] !== undefined) state[k] = renamed[k];
    return { words: from + ' is ' + to + ' now — ' + count + ' ' + (count === 1 ? 'place' : 'places') + ' in the ledger follow' + (m.cause ? ' (' + capText(m.cause, 1000) + ')' : '') + '.', undo: { kind: 'people.renamed', before } };
  },
  /* M96: people.forget — a person who was never the story's (a leaked example,
   * a mistaken name) is erased for good: page, seat, standing, knowledge, locks,
   * presence. Undoable — the whole of it comes back on a take-back. */
  'people.forget'(state, m) {
    const name = normalizeName(m.name);
    if (!name) return { why: 'no name to forget' };
    const lower = name.toLowerCase();
    const same = (k) => String(k || '').trim().toLowerCase() === lower;
    const pageKey = findPersonKey(state.characters, name);
    const seatKey = Object.keys(state.offscreen || {}).find(same);
    const relKey = Object.keys(state.relationships || {}).find(same);
    const knowKey = Object.keys(state.knowledge || {}).find(same);
    const canonKey = Object.keys(state.canon || {}).find(same);
    const bodyKey = Object.keys(state.bodies || {}).find(same);
    const presentAt = (state.present || []).findIndex((p) => p && same(p.name));
    if (!pageKey && !seatKey && !relKey && !knowKey && !canonKey && presentAt === -1) return { why: 'nothing is written of ' + name };
    const before = {
      page: pageKey ? { key: pageKey, value: cloneMap({ [pageKey]: state.characters[pageKey] })[pageKey] } : null,
      seat: seatKey ? { key: seatKey, value: JSON.parse(JSON.stringify(state.offscreen[seatKey])) } : null,
      rel: relKey ? { key: relKey, value: JSON.parse(JSON.stringify(state.relationships[relKey])) } : null,
      know: knowKey ? { key: knowKey, value: JSON.parse(JSON.stringify(state.knowledge[knowKey])) } : null,
      canon: canonKey ? { key: canonKey, value: JSON.parse(JSON.stringify(state.canon[canonKey])) } : null,
      body: bodyKey ? { key: bodyKey, value: JSON.parse(JSON.stringify(state.bodies[bodyKey])) } : null,
      present: presentAt !== -1 ? { at: presentAt, value: { ...state.present[presentAt] } } : null,
    };
    if (pageKey) delete state.characters[pageKey];
    if (seatKey) delete state.offscreen[seatKey];
    if (relKey) delete state.relationships[relKey];
    if (knowKey) delete state.knowledge[knowKey];
    if (canonKey) delete state.canon[canonKey];
    if (bodyKey) delete state.bodies[bodyKey];
    if (presentAt !== -1) state.present.splice(presentAt, 1);
    if (Array.isArray(state.threads)) state.threads = state.threads.filter((t) => !(t && typeof t === 'object' && same(t.owner)));
    return { words: name + ' was never the story\'s — forgotten for good' + (m.cause ? ' (' + capText(m.cause, 1000) + ')' : '') + '.', undo: { kind: 'people.forgotten', name, before } };
  },
  'people.wake'(state, m) {
    const key = findPersonKey(state.characters, m.name);
    if (!key || !state.characters[key].retired) return { why: 'no one by that name is passed through' };
    const before = cloneMap({ [key]: state.characters[key] })[key];
    const { retired, retiredAtTurn, ...rest } = state.characters[key];
    state.characters[key] = { ...rest, updatedAtTurn: storyTurn(state) };
    return { words: key + ' is back in the story.', undo: { kind: 'people.restore', name: key, before } };
  },

  'people.set'(state, m) {
    const field = typeof m.field === 'string' ? m.field.trim().toLowerCase() : '';
    const result = setPersonField(state, state.characters, m.name, field, m.text, storyTurn(state), { clear: m.clear === true });
    if (!result.entry) return { why: result.why };
    const before = result.before ? cloneMap({ [result.key]: result.before })[result.key] : null;
    if (result.entry.retired) { const { retired, retiredAtTurn, ...rest } = result.entry; result.entry = rest; } /* M57: a page written wakes them */
    /* M263: WHAT THE WRITER WROTE BY HAND IS MARKED HIS, so no re-reading of
     * the pages ever writes over it; a later write by a reader is the story's
     * again, and the mark for that field goes */
    result.entry.hand = markHand(result.entry.hand, field, m.byHand === true);
    if (!Object.keys(result.entry.hand).length) delete result.entry.hand;
    /* M409: A NOW KNOWS THE GROUND IT WAS WRITTEN ON — so a move makes it stale by fact, not by guessing at its words
     * (the journal's history of grounds is trimmed by folds and rewinds; this is not) */
    if (field === 'state') {
      if (m.clear === true || !String(result.entry.state || '').trim()) delete result.entry.nowAt;
      else if (state.place && typeof state.place.name === 'string' && state.place.name.trim()) result.entry.nowAt = state.place.name.trim();
    }
    state.characters[result.key] = result.entry;
    const FIELD_WORDS = {
      core: 'their nature',
      state: 'where they are',
      arc: 'how things stand with them',
      threads: 'their loose ends',
    };
    const words = result.key + ' — ' + (FIELD_WORDS[field] || 'their page') + (m.clear === true ? ' was let go' : ' was written down')
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
    const { characters, changes, dropped } = mergeDeltas(state, state.characters, [{ name: m.name, field: m.field, text: m.text }], storyTurn(state));
    if (!changes.length) return { why: (dropped[0] && dropped[0].why) || 'the note said nothing new' };
    const key = changes[0].name;
    const before = state.characters && state.characters[key] ? cloneMap({ [key]: state.characters[key] })[key] : null;
    state.characters = characters;
    const field = changes[0].field;
    /* M263: a loose end written or closed by hand marks the list his */
    if (state.characters[key]) {
      const hand = markHand(state.characters[key].hand, field === 'thread' || field === 'unthread' ? 'threads' : field, m.byHand === true);
      const { hand: _old, ...rest } = state.characters[key];
      state.characters[key] = Object.keys(hand).length ? { ...rest, hand } : rest;
    }
    const FIELD_WORDS = { core: 'their nature', state: 'where they are', arc: 'how things stand with them', thread: 'a loose end', unthread: 'a loose end closed' };
    const shown = field === 'thread' || field === 'unthread'
      ? capText(m.text, 1000)
      : capText(state.characters[key][field], 4000);
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
    /* M162: stamped with the PAGE it was written for as well as the batch
     * count — the batch count is bumped by every writer in the chain. */
    const brief = normalizeBrief(m.brief, storyTurn(state), Number.isInteger(state.page) ? state.page : null);
    const before = {
      brief: state.worldBrief ? JSON.parse(JSON.stringify(state.worldBrief)) : null,
      shown: Array.isArray(state.worldShown) ? state.worldShown.map((w) => ({ ...w })) : [],
    };
    state.worldBrief = brief;
    const shown = Array.isArray(state.worldShown) ? state.worldShown.slice() : [];
    if (brief && brief.twb) shown.push({ ...brief.twb, atTurn: brief.atTurn });
    state.worldShown = shown.slice(-6);
    const nVoices = brief && Array.isArray(brief.voices) ? brief.voices.length : 0;
    const words = !brief || brief.empty
      ? 'The world had no word to leave this turn.'
      : 'The world left its word for the next turn'
        + (brief.twb ? ' — a window opens' + (brief.twb.who ? ' on ' + brief.twb.who : '') : '')
        + (nVoices ? ' — ' + nVoices + (nVoices === 1 ? ' voice' : ' voices') + ' heard elsewhere' : '')
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
    return { words: 'Taken back — ' + capText(m.of, 1000), undo: null };
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
      const key = personBookKey(state, state.bodies, h.name, findBodyKey) || newBookKey(state, h.name); /* M419 */
      const what = capText('wounds taken in the fight with ' + (h.foe || 'their foe'), 1000);
      state.bodies = addInjury(state.bodies, key,
        { what, sev: h.injuries >= 2 ? 3 : 2, treated: false },
        clockMinutesOf(state), storyTurn(state));
      bits.push(key + ' carries the fight’s marks (' + (SEV_WORDS[h.injuries >= 2 ? 3 : 2] || 'hurt') + ', untreated).');
    }
    const words = 'The fight has ebbed.' + (bits.length ? ' ' + bits.join(' ') : '');
    return { words, undo: { kind: 'combat.restore', before } };
  },
};

/* ---------- the contract ---------- */

export const JOURNAL_CAP = 1500; /* M147: ~250 turns of a busy ledger (was 6000 — a 2MB row cloned on every read, the data-proportional lag); beyond it the checkpoints and snapshots carry the base */
/* M95: the placeholders the workers' prompts use in their examples, and the
 * example names of older coats that a model could still have learned to echo. */
export const PLACEHOLDER_NAMES = ['name', 'other name', 'new name', 'name surname', 'main character', 'a public figure', 'old words', 'new words'];
export const RETIRED_EXAMPLE_NAMES = ['kris jenner', 'kendall jenner', 'dmitri volkov', 'aurora sterling'];
export function placeholderIn(mutation) {
  const fields = ['name', 'owner', 'title'];
  for (const f of fields) {
    const v = mutation && typeof mutation[f] === 'string' ? mutation[f].trim().toLowerCase() : '';
    if (v && PLACEHOLDER_NAMES.includes(v)) return mutation[f].trim();
  }
  return '';
}

/* M263: the hand mark of a person's page, field by field */
function markHand(hand, field, byHand) {
  const next = hand && typeof hand === 'object' ? { ...hand } : {};
  if (!field) return next;
  if (byHand) next[field] = true;
  else delete next[field];
  return next;
}

/* M405: A "NOW" OF A GROUND THE SCENE HAS LEFT. Before M405 a move let only the main character's now go, so ledgers hold
 * present people whose now still names a place the scene stood in before ("inside the assembly hall at 1st Division HQ"
 * in the 10th Division courtyard). This names them — present, never the main character, never his hand's words — for
 * the readers' chain to let go as a journaled change (people.set state clear) before the world agent and the scribe
 * write the true ones. (Not a law of every batch: it reads the journal, and a fold must replay changes, not re-judge.) */
export function staleNows(state, { ground = '' } = {}) {
  /* M409: judged against the ground the PAGE stands on (its header) when it says — a ledger ground an audit moved
   * wrongly made the courtyard's true nows look stale and the assembly hall's look current (Rukia cleared, Kyōraku kept) */
  const where = String(ground || '').trim() || (state && state.place && typeof state.place.name === 'string' ? state.place.name : '');
  if (!state || !where || !Array.isArray(state.present) || !state.characters) return [];
  const spot = (n) => foldName(String(n || '').split(/\s*(?:—|—|–|,|;|\()\s*/)[0]);
  const here = spot(where);
  const past = [...new Set((Array.isArray(state.journal) ? state.journal : [])
    .map((j) => (j && j.m && j.m.type === 'place.set' ? spot(j.m.name || j.m.place) : ''))
    .filter((g) => g && g !== here && g.split(' ').length >= 2))];
  if (!here) return [];
  const out = [];
  for (const p of state.present) {
    const k = p && p.name ? findPersonKey(state.characters, p.name) : '';
    const entry = k ? state.characters[k] : null;
    if (!entry || isMc(state, k) || typeof entry.state !== 'string' || !entry.state.trim() || (entry.hand && entry.hand.state)) continue;
    /* M409: written on another ground (recorded when written) — stale by fact. M421: judged by the ledger's own ONE place
     * matcher (samePlace — the rule a place.set moves by), not by the place's first part: "10th Division HQ — training
     * courtyard" to "10th Division HQ — captain's office" is a move (it lets every position go), so a now written in the
     * courtyard ("at the rail, watching the sand") is of a place the scene has left, not of the HQ it is still in */
    if (entry.nowAt && String(entry.nowAt).trim() && !samePlace(entry.nowAt, where)) { out.push(k); continue; }
    if (entry.nowAt) continue;
    const now = foldName(entry.state);
    if (past.some((g) => now.includes(g)) && !now.includes(here)) out.push(k);
  }
  return out;
}

/* M406: ONE PERSON, TWO PAGES — FOUND AND JOINED. Before M405 "Rose" and "Rōjūrō Otoribashi (Rose)" became two pages;
 * the fix stops new ones, and ledgers already holding both are joined here: a page whose name finds exactly one OTHER
 * page (folded letters, canon's other name, a first or last name, a nickname in brackets — findPersonKey's own rules)
 * is renamed onto it (people.rename loses nothing, M163; journaled, undoable). Never the main character. */
export function duplicatePages(state) {
  const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  const out = [];
  const taken = new Set();
  for (const name of Object.keys(chars)) {
    if (taken.has(name) || isMc(state, name)) continue;
    const others = Object.fromEntries(Object.entries(chars).filter(([k]) => k !== name && !taken.has(k)));
    const to = findPersonKey(others, name);
    if (!to || isMc(state, to)) continue;
    let from = name;
    let into = to;
    if (nameCore(to) === nameCore(name)) {
      /* M418: THE SAME NAME, ONE PAGE WRITTEN WITH A RANK. Since M414 "Rukia Kuchiki" finds "Lieutenant Rukia Kuchiki" —
       * and the longer letters would have made the RANK the page's name. A rank changes (Rukia may be a captain one
       * day); the page stands under the name, and the titled page joins it. Two titled or two untitled forms: no join. */
      if (hasTitle(name) === hasTitle(to)) continue;
      if (!hasTitle(name)) { from = to; into = name; }
    } else if (nameCore(to).length <= nameCore(name).length) {
      /* only a SHORTER name joins a fuller one — never two full names that merely look alike; judged on the name itself,
       * so "Captain Hitsugaya" joins "Toshiro Hitsugaya" (M418 — the rank is not part of the name's length) */
      continue;
    }
    out.push({ from, to: into });
    taken.add(from);
  }
  return out;
}

/* M419: A BOOK ENTRY UNDER ANOTHER FORM OF SOMEONE'S NAME, JOINED TO THEIR PAGE. Ledgers written before M419 hold
 * injuries, standings and knowledge under a short or other form of a person's name ("Rukia" beside her page "Rukia
 * Kuchiki"); an entry with no page of its own whose name the one matcher gives to exactly one page — the name meaning one
 * person — is renamed onto that page (people.rename: every book follows, entries merged, nothing lost; journaled,
 * undoable). "you" and the main character's labels join his own name. */
export function strayBookKeys(state) {
  const s = state && typeof state === 'object' ? state : {};
  const pages = Object.keys(s.characters && typeof s.characters === 'object' ? s.characters : {});
  const isPage = (k) => pages.some((p) => p.trim().toLowerCase() === String(k).trim().toLowerCase());
  const out = [];
  const seen = new Set();
  for (const book of ['bodies', 'relationships', 'knowledge', 'canon']) {
    for (const key of Object.keys(s[book] && typeof s[book] === 'object' ? s[book] : {})) {
      const low = key.trim().toLowerCase();
      if (!low || seen.has(low) || isPage(key)) continue;
      seen.add(low);
      let to = '';
      if (isMc(s, key)) {
        const mc = mcName(s);
        if (mc === 'the player' || mc.trim().toLowerCase() === low) continue;
        to = findPersonKey(s.characters || {}, mc) || mc;
      } else {
        const hits = pages.filter((p) => samePersonName(p, key));
        if (hits.length !== 1 || !oneMeaning(s, key)) continue;
        to = hits[0];
      }
      if (to && to.trim().toLowerCase() !== low) out.push({ from: key, to });
    }
  }
  return out;
}

/* M261: two names for one place — case, a leading "the", punctuation */
function placeKey(name) {
  return String(name || '').toLowerCase().replace(/^\s*the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function samePlace(a, b) {
  const x = placeKey(a);
  return Boolean(x) && x === placeKey(b);
}

/* M444: IS THIS SEAT WHERE THE SCENE IS? The seat names EVERY part of the scene's place — "13th Division Barracks" AND
 * "Captain's Office", in any order and any punctuation, a plural or a possessive aside — so another room of the same
 * compound is elsewhere. A part is named when it stands as the seat's own part ("…, Captain's Office"), opens it with
 * where-in-it words after ("Captain's Office, by the window", "…of the 13th Division Barracks"), or follows "in", "at",
 * "inside", "within" or "of". Named after "outside", "near", "to" or "behind", or run on into another place ("the
 * Bluebird parking lot"), it is where she is NOT. A one-word place, or a town, a city or a district with nothing more
 * specific, is no one spot (M396). */
const PLACE_FILL = new Set(['the', 'a', 'an', 's']);
const PLACE_REGION = new Set(['town', 'city', 'village', 'district', 'ward', 'prefecture', 'province', 'county', 'kingdom', 'empire', 'realm', 'country', 'island', 'world', 'capital', 'suburb', 'neighborhood', 'neighbourhood', 'quarter', 'region', 'continent', 'metropoli', 'borough', 'township', 'hamlet']);
/* the words as placeWordsOf leaves them ("across" → acros) */
const PLACE_IN = new Set(['in', 'at', 'inside', 'within', 'of']);
const PLACE_WITHIN = new Set(['by', 'beside', 'near', 'against', 'behind', 'next', 'at', 'on', 'in', 'of', 'with', 'facing', 'opposite', 'under', 'along', 'acros', 'close', 'watching', 'standing', 'sitting', 'seated', 'waiting', 'leaning', 'kneeling', 'working', 'doorway', 'corner', 'window']);
const placeWordsOf = (text) => foldName(text).split(' ').filter(Boolean).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).filter((w) => !PLACE_FILL.has(w));
const placeParts = (text) => String(text || '').split(/\s*(?:—|–|,|;|\(|\)|\s-\s)\s*/).map(placeWordsOf).filter((ws) => ws.length);
export function seatAtScene(location, sceneName) {
  const scene = String(sceneName || '').trim();
  const where = String(location || '').trim();
  if (!scene || !where) return false;
  const parts = placeParts(scene);
  const all = parts.flat();
  /* M396's measure, kept: two words or more as written ("the Bluebird" is a spot, "Tokyo" is not) */
  if (!all.length || foldName(scene).split(' ').filter(Boolean).length < 2) return false;
  if (parts.length === 1 && PLACE_REGION.has(all[all.length - 1])) return false;
  const seatParts = placeParts(where);
  const named = (p) => seatParts.some((q) => {
    for (let i = 0; i + p.length <= q.length; i += 1) {
      if (!p.every((w, k) => q[i + k] === w)) continue;
      const before = i > 0 ? q[i - 1] : '';
      const after = i + p.length < q.length ? q[i + p.length] : '';
      if ((!before || PLACE_IN.has(before)) && (!after || PLACE_WITHIN.has(after))) return true;
    }
    return false;
  });
  return parts.every(named);
}

/* M444: CLEARED IS NEVER NOWHERE. The world agent is told that someone the page shows arriving is the page reader's to
 * write in and its own only to let go of the elsewhere note; the auditor was told the same ("offscreen.clear"). When the
 * page reader had not written her in, the note went and nothing put her in the scene: Rukia, beside him on the page, was
 * "whereabouts not yet written" in the ledger while her own "now" said she stood there. A worker's clearing of someone's
 * elsewhere note, when the page (before any window) names her, she is not already here, the name means one person and
 * the same answer does not seat her somewhere else, is her walking in — presence.enter, which lets the note go itself. */
export function clearsThatArrive(state, mutations, sceneText) {
  const list = Array.isArray(mutations) ? mutations : [];
  const text = narrationOf(sceneText); /* named by the telling, not only in someone's line ("Where is Renji?") */
  if (!text.trim() || !state || typeof state !== 'object') return list;
  const seatedAgain = (name) => list.some((x) => x && x.type === 'offscreen.set' && typeof x.name === 'string' && samePersonName(x.name, name));
  return list.map((m) => {
    if (!m || m.type !== 'offscreen.clear' || typeof m.name !== 'string' || !m.name.trim()) return m;
    const name = normalizeName(m.name);
    if (!name || isMc(state, name) || isHere(state, name) || !seatForPerson(state, name) || seatedAgain(name) || !oneMeaning(state, name)) return m;
    const key = strictPageKey(state, name) || name;
    if (!shownOnPage(state, text, name) && !shownOnPage(state, text, key)) return m;
    return { type: 'presence.enter', name: key, cause: 'the page shows them here' };
  });
}

/* M444: IS THIS PERSON THEMSELF NAMED IN THIS TEXT — by their whole name, or by a word of it no one else the ledger
 * knows shares. "Kuchiki-taichō nodded" names Byakuya, never Rukia Kuchiki; "Rukia" names her. (nameOnPage counts a
 * shared family name for both — right for "might they be here?", wrong for writing someone into the scene.) */
export function shownOnPage(state, text, name) {
  const s = state && typeof state === 'object' ? state : {};
  if (!nameOnPage(text, name)) return false;
  const bare = nameCore(name);
  if (bare && bare.includes(' ') && nameOnPage(text, bare)) {
    const folded = ' ' + foldName(text) + ' ';
    if (folded.includes(' ' + foldName(bare) + ' ')) return true; /* the whole name, as it stands */
  }
  const others = [
    ...Object.keys(s.characters && typeof s.characters === 'object' ? s.characters : {}),
    ...(Array.isArray(s.present) ? s.present : []).map((p) => (p && typeof p.name === 'string' ? p.name : '')),
    ...Object.keys(s.offscreen && typeof s.offscreen === 'object' ? s.offscreen : {}),
  ].filter((n) => n && !samePersonName(n, name));
  const shared = new Set(others.flatMap((n) => nameCore(n).split(' ')));
  return nameCore(name).split(' ').filter((w) => w.length >= 2 && !shared.has(w)).some((w) => nameOnPage(text, w));
}

/* M444: THE ROOM BEFORE ANY WINDOW — the part of a story page that is the scene (after *** The World Beyond *** is
 * another place, M129) */
export function scenePartOf(pageText) {
  const t = String(pageText || '');
  const cut = t.indexOf('*** The World Beyond ***');
  return cut === -1 ? t : t.slice(0, cut);
}
/* M444: the telling without its spoken lines — someone only talked about ("Byakuya would never allow it") is not shown
 * there; the quote marks the auditor's departure reader sets aside (showsDeparture) */
export function narrationOf(text) {
  return String(text || '').replace(/"[^"\n]*"|“[^”]*”|«[^»]*»|「[^」]*」|『[^』]*』/g, ' ');
}

/* M414: DOES THIS SENTENCE SHOW SOMEONE GOING? M413's word list let a side pass for a going — "Rukia stood to his left",
 * "her left hand", "Don't leave" (someone SAYING it) — so an auditor's wrong "stepped out" found its permission in any
 * sentence with a direction in it. A going is narrated: words in quotation marks are what someone says, and are set
 * aside; "left" is a going only when it is not a side ("to his left", "on the left", "her left hand"); "leave" is one
 * only when nothing says it did not or has not happened yet ("didn't leave", "wanted to leave"). */
const GOING = /\b(?:(?:walk|stride|strode|stalk|storm|hurr(?:y|ie)|head|march|stomp|limp|wander|trudge|dash|rush|run|ran|file|flash[- ]?step|shunpo)\w*\s+(?:out|off|away|home|outside)\b|slip\w*\s+(?:out|off|away)\b|step\w*\s+(?:out|outside)\b|(?:go|goes|going|went|gone)\s+(?:out|off|home|away)\b|depart(?:s|ed|ing)?\b|exit(?:s|ed|ing)?\b(?!\s+(?:wound|strategy|interview))|(?:is|was|were|are)\s+gone\b|vanish(?:es|ed|ing)?\b|disappear(?:s|ed|ing)?\b|took\s+(?:his|her|their)\s+leave\b)/i;
const LEAVE_WORD = /\b(leave|leaves|leaving|left)\b/gi;
const SIDE_BEFORE = /(?:\b(?:to|on|at|by|from|toward|towards|onto|into)\s+(?:the|his|her|their|my|your|its|our)\s+|\b(?:his|her|their|my|your|its|the)\s+(?:far\s+|own\s+)?)$/i;
const SIDE_AFTER = /^\s+(?:hand|hands|side|arm|arms|leg|legs|foot|feet|eye|eyes|ear|ears|shoulder|shoulders|hip|wing|flank|cheek|temple|wrist|knee|elbow|palm|fist|breast|chest|brow|thigh|ankle|heel|finger|fingers|thumb|pocket|sleeve|corner|edge|turn|fork|lane|half|rear|wall|window|hook|jab|cross|field|column|over|unsaid|unspoken|untouched|unanswered|unfinished|alone|intact|behind)\b/i;
/* "was left", "been left" — something left behind, nobody going */
const LEFT_PASSIVE = /\b(?:was|were|is|are|been|being|be|get|gets|got)\s+$/i;
/* "left the door open", "left the sword on the table" — a thing left in a state, nobody going */
const LEFT_THING = /^\s+(?:the|his|her|their|a|an|it|them|him|my|your|its|our)\b[^.,;!?]{0,40}?\b(?:untouched|open|unopened|ajar|unlocked|unsaid|unspoken|unanswered|unfinished|uneaten|half[- ]eaten|alone|intact|lying|standing|hanging|cold|running|burning|on\s+the\s+(?:table|floor|desk|counter|ground|bench|bed|chair|shelf|sand))\b/i;
const NOT_YET = /(?:\b(?:not|never|to|would|could|should|might|must|will|can|cannot|shall|didn['’]?t|don['’]?t|doesn['’]?t|won['’]?t|can['’]?t|couldn['’]?t|wouldn['’]?t|shouldn['’]?t|refused\s+to|about\s+to|ready\s+to|wanted\s+to|wants\s+to|tried\s+to)\s+)$/i;
export function showsDeparture(sentence) {
  const said = String(sentence || '').replace(/"[^"]*"|“[^”]*”|«[^»]*»|「[^」]*」/g, ' ');
  if (GOING.test(said)) return true;
  for (const m of said.matchAll(LEAVE_WORD)) {
    const before = said.slice(0, m.index);
    const after = said.slice(m.index + m[0].length);
    const w = m[0].toLowerCase();
    if (w === 'left') { if (SIDE_BEFORE.test(before) || SIDE_AFTER.test(after) || LEFT_PASSIVE.test(before) || LEFT_THING.test(after)) continue; }
    else if (NOT_YET.test(before)) continue;
    return true;
  }
  return false;
}

/* M446: IS THIS PERSON GONE AT THE END OF THE PAGE? His Rukia was put "elsewhere — last seen at" the very office she stood
 * in, Byakuya never having left: the page reader may take someone out when the page merely NAMES them (M402), so a
 * leave-and-come-back, a walk across the room or a slip took her out and kept her out. A page shows someone gone when
 * the LAST sentence of its scene (before any window) that names them as themself — never by a family name another
 * person shares (shownOnPage) — narrates them going (showsDeparture: spoken words set aside), with the sentences right
 * after it that go on about them by a pronoun ("Rukia rose. She bowed once and left.") — only when neither names anyone
 * else, by name or by rank ("Rukia glanced at Kuchiki-taichō. He left." is his going). A later sentence that names them
 * without going means they are here; a page that never names them as themself does not show them going. */
const RANKED = /\b(?:captain|lieutenant|commander|general|sergeant|officer|detective|mr|mrs|ms|miss|dr|lady|lord|sir|madam|master)\.?\s+\p{Lu}|\p{L}+-(?:taich|fukutaich|s[oō]taich|san\b|sama\b|kun\b|chan\b|dono\b|sensei\b|senpai\b)/iu;
export function goneAtTheEnd(state, pageText, name) {
  const s = state && typeof state === 'object' ? state : {};
  const sentences = scenePartOf(pageText).split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const others = [...new Set([
    ...Object.keys(s.characters && typeof s.characters === 'object' ? s.characters : {}),
    ...(Array.isArray(s.present) ? s.present : []).map((p) => (p && typeof p.name === 'string' ? p.name : '')),
    ...Object.keys(s.offscreen && typeof s.offscreen === 'object' ? s.offscreen : {}),
    mcName(s) !== 'the player' ? mcName(s) : '',
  ])].filter((n) => n && !samePersonName(n, name));
  const someoneElse = (t) => RANKED.test(narrationOf(t)) || others.some((n) => shownOnPage(s, t, n));
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    if (!shownOnPage(s, sentences[i], name)) continue;
    const run = [sentences[i]];
    if (!someoneElse(sentences[i])) {
      for (let j = i + 1; j < sentences.length && /^(?:she|he|they|her|his|their)\b/i.test(sentences[j]) && !someoneElse(sentences[j]); j += 1) run.push(sentences[j]);
    }
    return run.some((t) => showsDeparture(t));
  }
  return false;
}

/* M452: THE HOUSE HEALS WHO IS HERE BY ITSELF, FROM THE NEWEST PAGE — NO BUTTON, NO MODEL. He asked why he should press
 * "read again" at all: a smart house knows what is wrong and mends it. A note that says someone is elsewhere AT the very
 * place the scene stands — the house's own "last seen" there, or a seat at the scene's whole place — while the newest
 * page's telling names them as themself (never by a family name another shares, never only in a spoken line, never in
 * the window) and does not end on them going: they are here. Each is written in (presence.enter, which lets the note go
 * — journaled, undoable). Someone on their way in (toward, seeking) is left on the road. Run when a story opens and
 * after every page. */
export function hereByTheNewestPage(state, pageText) {
  const s = state && typeof state === 'object' ? state : null;
  if (!s || !s.place || typeof s.place.name !== 'string' || !s.place.name.trim()) return [];
  const ground = s.place.name;
  const told = narrationOf(scenePartOf(pageText));
  if (!told.trim()) return [];
  const out = [];
  for (const [key, seated] of Object.entries(s.offscreen && typeof s.offscreen === 'object' ? s.offscreen : {})) {
    if (!seated || typeof seated !== 'object' || seated.stance === 'toward' || seated.stance === 'seeking') continue;
    const atTheScene = (seated.lastSeen === true && samePlace(seated.location, ground)) || seatAtScene(seated.location, ground);
    if (!atTheScene || isMc(s, key) || isHere(s, key) || !oneMeaning(s, key)) continue;
    const name = strictPageKey(s, key) || key;
    if (!shownOnPage(s, told, key) && !shownOnPage(s, told, name)) continue;
    if (goneAtTheEnd(s, pageText, name)) continue;
    if (out.some((m) => samePersonName(m.name, name))) continue;
    out.push({ type: 'presence.enter', name, cause: 'the page shows them here' });
  }
  return out;
}

/* M444: WHO WALKED IN FROM ANOTHER ROOM. Until M444 a seat anywhere in the scene's compound walked its person into the
 * scene (the first-part test above). A ledger written then holds people in "Here now" who never came in: here, not the
 * main character, the last word the journal holds about where they are is that seat, the seat by today's test is NOT
 * where the scene stood, and no story page since (before its window) has named them. They are put back where the
 * world had them — never someone a page has shown since, never one his hand wrote in, never the main character.
 * storyPages: the story's pages as the page reader counts them ([{text}], the storyteller's pages only). */
export function wrongWalkIns(state, storyPages = []) {
  const s = state && typeof state === 'object' ? state : {};
  const present = Array.isArray(s.present) ? s.present : [];
  const journal = Array.isArray(s.journal) ? s.journal : [];
  const pages = Array.isArray(storyPages) ? storyPages : [];
  if (!present.length || !journal.length) return [];
  const WHERE = new Set(['presence.enter', 'presence.leave', 'offscreen.set', 'offscreen.clear', 'people.rename', 'people.forget']);
  const out = [];
  for (const p of present) {
    const name = p && typeof p.name === 'string' ? p.name : '';
    if (!name || isMc(s, name)) continue;
    let at = -1;
    for (let i = journal.length - 1; i >= 0; i -= 1) {
      const m = journal[i] && journal[i].m;
      if (!m || !WHERE.has(m.type)) continue;
      const who = [m.name, m.from, m.to].filter((x) => typeof x === 'string' && x.trim());
      /* the same letters, or another form of the name that means one person (never a bare "Kuchiki" for Rukia) */
      if (who.some((x) => x.trim().toLowerCase() === name.trim().toLowerCase() || (samePersonName(x, name) && oneMeaning(s, x)))) { at = i; break; }
    }
    if (at === -1) continue;
    const entry = journal[at];
    const seatM = entry.m;
    if (seatM.type !== 'offscreen.set' || seatM.stance === 'toward' || seatM.stance === 'seeking') continue;
    /* the ground the scene stood on when that seat was written */
    let ground = '';
    for (let i = at - 1; i >= 0; i -= 1) { const m = journal[i] && journal[i].m; if (m && m.type === 'place.set') { ground = String(m.name || m.place || ''); break; } }
    if (!ground) {
      if (journal.slice(at + 1).some((j) => j && j.m && j.m.type === 'place.set')) continue; /* the journal no longer reaches it */
      ground = s.place && typeof s.place.name === 'string' ? s.place.name : '';
    }
    if (!ground || seatAtScene(seatM.location, ground)) continue;
    const since = Number.isInteger(entry.p) ? entry.p : -1;
    const key = findPersonKey(s.characters || {}, name);
    const shown = pages.some((pg, i) => i > since && pg && (nameOnPage(scenePartOf(pg.text), name) || (key && nameOnPage(scenePartOf(pg.text), key))));
    if (shown) continue;
    out.push({ type: 'presence.leave', name, cause: 'never in it — the world had put them in another part of ' + String(ground).split(/\s*(?:—|–|,|;|\()\s*/)[0] });
    out.push({ type: 'offscreen.set', name, location: seatM.location, ...(seatM.activity ? { activity: seatM.activity } : {}), ...(seatM.agenda ? { agenda: seatM.agenda } : {}), ...(seatM.stance ? { stance: seatM.stance } : {}) });
  }
  return out;
}

/* M261: the same beat — the same words in any order, or nearly all of them */
export const BEAT_WINDOW = 6;
function beatWords(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 || /\d/.test(w)); /* a figure is never noise: 20 dollars is not 50 */
}
export function sameBeat(a, b) {
  const x = beatWords(a); const y = beatWords(b);
  if (!x.length || !y.length) return false;
  if ([...x].sort().join(' ') === [...y].sort().join(' ')) return true;
  /* different figures are different beats, however alike the rest */
  const figures = (list) => list.filter((w) => /\d/.test(w)).sort().join(' ');
  if (figures(x) !== figures(y)) return false;
  const sx = new Set(x); const sy = new Set(y);
  if (sx.size < 3 || sy.size < 3) return false;
  let hit = 0;
  for (const w of sx) if (sy.has(w)) hit += 1;
  return hit / Math.max(sx.size, sy.size) >= 0.8;
}

export function applyMutations(state, mutations) {
  const next = copyState(state);
  const applied = [];
  const rejected = [];
  /* M9 (B14): one batch that writes anything counts as one turn of the
   * story, marked before any handler asks for it. */
  next.turn = turnOf(next) + 1;

  /* M304: THE SEAT CAME BEFORE THE LEAVING, AND WAS REFUSED. A page that shows
   * someone going somewhere earns two changes — they left, and where they
   * went — and a reader writes them in either order. M257 refuses a seat for
   * anyone standing in the room, so "offscreen.set Kim, presence.leave Kim"
   * lost the seat and kept the leaving: Kim, whose destination the prose had
   * just named, was nowhere. Within one batch the leaving goes first. */
  const list = (() => {
    const raw = Array.isArray(mutations) ? mutations.slice() : [];
    const nameOf = (m) => (m && typeof m === 'object' && typeof m.name === 'string' ? m.name.trim().toLowerCase() : '');
    for (let i = 0; i < raw.length; i += 1) {
      const m = raw[i];
      if (!m || m.type !== 'offscreen.set' || !nameOf(m)) continue;
      const j = raw.findIndex((x, k) => k > i && x && x.type === 'presence.leave' && nameOf(x) === nameOf(m));
      if (j === -1) continue;
      const [leave] = raw.splice(j, 1);
      raw.splice(i, 0, leave);
      i += 1;
    }
    return raw;
  })();
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
    /* M95: a placeholder from the workers' own examples is never a person.
     * A cheap model echoes what it was shown; the writer found the house's
     * example family in his ledger. The names in the prompts are placeholders
     * now, and this is the lock on the door. */
    const echoed = placeholderIn(mutation);
    if (echoed) {
      rejected.push({ mutation, why: '“' + echoed + '” is a placeholder from the house’s own examples, never a person' });
      continue;
    }
    const result = handler(next, mutation);
    if (result && result.words) {
      /* M69: the journal — the mutation as applied, stamped with the page, and
       * tied to its log entry so a take-back drops it from the fold */
      if (!Array.isArray(next.journal)) next.journal = [];
      next.journalSeq = (Number.isInteger(next.journalSeq) ? next.journalSeq : 0) + 1;
      const jid = next.journalSeq;
      next.journal.push({ id: jid, p: Number.isInteger(next.page) ? next.page : -1, b: next.turn, m: JSON.parse(JSON.stringify(mutation)) }); /* M424: the batch it came in */
      if (next.journal.length > JOURNAL_CAP) next.journal = next.journal.slice(next.journal.length - JOURNAL_CAP);
      const logEntry = appendLog(next, result.words, result.undo || null);
      logEntry.jid = jid;
      /* M166: the journal id rides OUT with the applied entry. The
       * housekeeper used to find its own ids by re-reading the ledger and
       * taking the last N log entries — and a worker of the background
       * chain that saved in that window put ITS entries at the tail, so the
       * card's take-back would have reversed the extractor's or the world
       * agent's writes instead of its own. */
      applied.push({ mutation, words: result.words, jid });
    } else {
      /* M259: a change that would change nothing says so (same) — it is not a refusal */
      rejected.push({ mutation, why: (result && result.why) || 'it didn’t hold', ...(result && result.same ? { same: true } : {}) });
    }
  }

  /* M396: NOBODY IS IN TWO PLACES — AS A LAW OF EVERY BATCH, NOT A HOPE OF EACH WRITER. Whoever stands in the scene
   * (under any form of their name — folded letters, a first name, canon's other name for them) holds no elsewhere note:
   * a note that says otherwise is let go here, at the end of every batch, so a ledger that ever held both (older pages,
   * a name spelled two ways) heals on the next change, and a fold replays it the same. */
  if (next.offscreen && typeof next.offscreen === 'object' && Array.isArray(next.present) && next.present.length) {
    const stale = Object.keys(next.offscreen).filter((k) => isHere(next, k));
    if (stale.length) {
      next.offscreen = { ...next.offscreen };
      for (const k of stale) {
        delete next.offscreen[k];
        appendLog(next, k + ' is in the scene — the elsewhere note that said otherwise was let go.', null);
      }
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
      if ('groundWas' in undo) next.groundWas = undo.groundWas ? { ...undo.groundWas } : null; /* M304 */
      if (undo.mcState && next.characters && next.characters[undo.mcState.key] && !next.characters[undo.mcState.key].state) {
        next.characters = { ...next.characters, [undo.mcState.key]: { ...next.characters[undo.mcState.key], state: undo.mcState.state, ...(undo.mcState.nowAt ? { nowAt: undo.mcState.nowAt } : {}) } };
      }
      /* M261: the positions the move let go come back to whoever is still here */
      for (const was of Array.isArray(undo.positions) ? undo.positions : []) {
        const at = (next.present || []).findIndex((p) => p && p.name === was.name);
        if (at === -1 || next.present[at].position) continue;
        /* the entry as it stood, key for key */
        const entry = next.present[at];
        const rebuilt = {};
        for (const k of Array.isArray(was.keys) ? was.keys : []) {
          if (k === 'position') rebuilt.position = was.position;
          else if (k in entry) rebuilt[k] = entry[k];
        }
        for (const k of Object.keys(entry)) if (!(k in rebuilt)) rebuilt[k] = entry[k];
        if (!('position' in rebuilt)) rebuilt.position = was.position;
        next.present[at] = rebuilt;
      }
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
      /* M304: back in the scene, the house's own sighting goes — only while it is still the house's */
      if (undo.seatAdded) {
        const seated = findSeat(next.offscreen, undo.seatAdded);
        if (seated && seated.entry && seated.entry.lastSeen === true) { next.offscreen = { ...next.offscreen }; delete next.offscreen[seated.key]; }
      }
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
      if (undo.moved && undo.moved.name) next.offscreen[undo.moved.name] = { ...undo.moved.entry }; /* M320: the seat that was taken over comes back under its own name */
      ok = true;
    } else if (undo.kind === 'offscreen.rekey') {
      next.offscreen = { ...(next.offscreen || {}) };
      delete next.offscreen[undo.to];
      if (undo.toKey && undo.toEntry) next.offscreen[undo.toKey] = { ...undo.toEntry };
      if (undo.from && undo.fromEntry) next.offscreen[undo.from] = { ...undo.fromEntry };
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
      /* M386: taking back the series' own lock lets that truth go for good; taking back a let-go brings it home */
      const marks = Array.isArray(next.canonLetGo) ? next.canonLetGo : [];
      if (undo.source === 'canon' && undo.key) next.canonLetGo = [...new Set([...marks, letGoMark(undo.name, undo.key)])];
      if (undo.letGo) next.canonLetGo = marks.filter((x) => x !== undo.letGo);
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
    } else if (undo.kind === 'people.renamed') {
      const b = undo.before || {};
      for (const [k, v] of Object.entries(b)) if (v !== null) next[k] = JSON.parse(JSON.stringify(v));
      ok = true;
    } else if (undo.kind === 'people.forgotten') {
      const b = undo.before || {};
      if (b.page) next.characters[b.page.key] = cloneMap({ [b.page.key]: b.page.value })[b.page.key];
      if (b.seat) next.offscreen[b.seat.key] = JSON.parse(JSON.stringify(b.seat.value));
      if (b.rel) next.relationships[b.rel.key] = JSON.parse(JSON.stringify(b.rel.value));
      if (b.know) next.knowledge[b.know.key] = JSON.parse(JSON.stringify(b.know.value));
      if (b.canon) next.canon[b.canon.key] = JSON.parse(JSON.stringify(b.canon.value));
      if (b.body) next.bodies[b.body.key] = JSON.parse(JSON.stringify(b.body.value));
      if (b.present) next.present.splice(Math.min(b.present.at, next.present.length), 0, { ...b.present.value });
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
