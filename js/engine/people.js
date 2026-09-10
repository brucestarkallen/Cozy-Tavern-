/* Cozy Tavern — engine/people.js
 * The character ledger (M12, Summaryception port). Beyond what the scene
 * knows right now, the ledger keeps who each person IS: their core (stable
 * nature, voice, tells), their state (where they are and how they're doing —
 * it leads with WHERE), their arc (how they stand with the main character
 * and WHY it moved), and their threads (the loose ends they left open).
 *
 *   state.characters[name] = { core, state, arc, threads[], updatedAtTurn }
 *
 * The main character's entry is RECORD-ONLY: state and threads are kept, but
 * core and arc are never written and never injected — and that law is
 * enforced HERE, in the merge code, not by asking the worker politely.
 *
 * Two writers touch the ledger:
 *   - the scribe (agents/scribe.js) proposes sparse JSON deltas after each
 *     turn; mergeDeltas() validates them — names resolve against the known
 *     cast (bounded Levenshtein), a delta meant for "you" lands on the main
 *     character's record, and the contamination guard refuses to copy one
 *     person's words into another's entry.
 *   - the writer's own hand, through the people.set mutation
 *     (engine/apply.js) — validated, logged, undoable like everything else.
 *
 * renderPeopleTiers() speaks the ledger to the storyteller in tiers
 * (SPEC.md M12): full cards for whoever is present (cap 6), a compact
 * "also present" line for the overflow, mention-recall cards (up to 3, 500
 * chars each) for off-screen people named in the last three messages —
 * framed as not in the scene — and a rotating off-screen roster (up to 12)
 * that says how long since each was last seen. State labels age: "now"
 * becomes "last noted N turns ago" once twenty turns have passed.
 */

import { isMcAlias, mcName } from './duels.js';

/* Field caps — the ledger holds brushstrokes, not chapters. */
export const CORE_CAP = 300;
export const STATE_CAP = 240;
export const ARC_CAP = 240;
export const THREAD_CAP = 140;
export const THREADS_MAX = 8;
export const RECALL_CARD_CAP = 500;
/* Tier laws (SPEC.md M12). */
export const PRESENT_CARDS_MAX = 6;
export const RECALL_MAX = 3;
export const ROSTER_MAX = 12;
export const FRESH_TURNS = 20;       /* past this, "now" ages into "last noted N turns ago" */
export const PEOPLE_BUDGET = 4800;   /* chars for the whole tiered block (M29: doubled — the people are the world) */

export function emptyPerson() {
  return { core: '', state: '', arc: '', threads: [], updatedAtTurn: 0 };
}

/* ---------- names ---------- */

function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ');
}

/* Bounded Levenshtein: the edit distance between two lowercase names, given
 * up as soon as it passes `bound` (returns bound+1 then — the caller only
 * ever asks "within bound or not?"). */
export function boundedLevenshtein(a, b, bound) {
  const s = String(a || '');
  const t = String(b || '');
  if (Math.abs(s.length - t.length) > bound) return bound + 1;
  let prev = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    const cur = [i];
    let rowMin = cur[0];
    for (let j = 1; j <= t.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)
      );
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > bound) return bound + 1;
    prev = cur;
  }
  return prev[t.length];
}

/* How near a near-name may be before the ledger calls it the same person:
 * short names get one letter of slack, longer ones two. */
function nameBound(name) {
  return String(name || '').length <= 5 ? 1 : 2;
}

/* Resolve a spoken name to a ledger key: exact (case-insensitive) first,
 * then near-names within the bounded edit distance — but only when exactly
 * one key qualifies; an ambiguous near-name matches no one. '' when the
 * name is new to the ledger. Exported for the harness. */
export function findPersonKey(characters, name) {
  const wanted = normalizeName(name).toLowerCase();
  if (!wanted) return '';
  const keys = Object.keys(characters && typeof characters === 'object' ? characters : {});
  const exact = keys.find((k) => k.toLowerCase() === wanted);
  if (exact) return exact;
  const near = keys.filter((k) => {
    const bound = Math.min(nameBound(k), nameBound(wanted)) || 1;
    return boundedLevenshtein(k.toLowerCase(), wanted, bound) <= bound;
  });
  return near.length === 1 ? near[0] : '';
}

/* Every name that means the main character (their story name plus the
 * second-person labels). Deltas addressed to any of these land on the MC
 * record — the persona redirect. */
export function isMc(state, name) {
  return isMcAlias(state, name);
}

/* The MC's ledger key: their story name when the sheet knows it, else the
 * plain label. */
export function mcKey(state) {
  const name = mcName(state);
  return name === 'the player' ? 'the player' : name;
}

/* ---------- the merge (the scribe's door) ---------- */

function cleanFieldText(text, cap) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  return clean.length > cap ? clean.slice(0, cap - 1).trimEnd() + '…' : clean;
}

/* The contamination guard: one person's words must never be written into
 * another's entry. Two telltales — the text is verbatim what a DIFFERENT
 * person's same-kind field already says, or it opens with another known
 * person's name as its subject ("Samantha kept the ledger…" landing on
 * Mira's card). */
export function contaminated(characters, targetKey, text) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!clean) return false;
  for (const [key, entry] of Object.entries(characters || {})) {
    if (key === targetKey || !entry || typeof entry !== 'object') continue;
    for (const field of ['core', 'state', 'arc']) {
      const have = String(entry[field] || '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (have && have === clean) return true;
    }
    const lower = key.toLowerCase();
    if (clean === lower || clean.startsWith(lower + ' —') || clean.startsWith(lower + ' -')
      || clean.startsWith(lower + ' is ') || clean.startsWith(lower + ' was ')
      || clean.startsWith(lower + ' has ') || clean.startsWith(lower + ' had ')
      || clean.startsWith(lower + ' keeps ') || clean.startsWith(lower + ' kept ')) {
      return true;
    }
  }
  return false;
}

const DELTA_FIELDS = ['core', 'state', 'arc', 'thread', 'unthread'];
const FIELD_CAPS = { core: CORE_CAP, state: STATE_CAP, arc: ARC_CAP, thread: THREAD_CAP, unthread: THREAD_CAP };

/* Merge the scribe's sparse deltas into the character ledger.
 *   mergeDeltas(state, characters, deltas)
 *     -> { characters, changes:[{name, field}], dropped:[{delta, why}] }
 * `characters` is copied, never mutated in place. Every drop is recorded
 * with its plain-words why. */
export function mergeDeltas(state, characters, deltas, turn) {
  const next = {};
  const src = characters && typeof characters === 'object' ? characters : {};
  for (const [key, entry] of Object.entries(src)) {
    if (!entry || typeof entry !== 'object') continue;
    next[key] = {
      ...entry,
      threads: Array.isArray(entry.threads) ? entry.threads.slice() : [],
    };
  }
  const atTurn = Number.isFinite(turn) ? turn : (Number.isFinite(state && state.turn) ? state.turn : 0);
  const changes = [];
  const dropped = [];

  for (const delta of Array.isArray(deltas) ? deltas : []) {
    const why = (words) => { dropped.push({ delta, why: words }); };
    if (!delta || typeof delta !== 'object') { why('it isn’t shaped like a note at all'); continue; }
    let name = normalizeName(delta.name);
    if (!name) { why('no name came with it'); continue; }
    const field = typeof delta.field === 'string' ? delta.field.trim().toLowerCase() : '';
    if (!DELTA_FIELDS.includes(field)) {
      why('“' + (field || '?') + '” isn’t a page of the ledger (only core, state, arc, thread)');
      continue;
    }

    /* The persona redirect: a note addressed to "you" belongs to the main
     * character's record. */
    const forMc = isMc(state, name);
    if (forMc) name = mcKey(state);

    /* The MC record-only law, enforced here in the merge code: the main
     * character keeps a state and threads — never a core, never an arc. */
    if (forMc && (field === 'core' || field === 'arc')) {
      why('the main character’s ledger is record-only — where they are and their loose ends, nothing more');
      continue;
    }

    const text = cleanFieldText(delta.text, FIELD_CAPS[field]);
    if (!text) { why('the note came in empty'); continue; }

    let key = findPersonKey(next, name);
    if (!key) key = name;
    if (!next[key]) next[key] = emptyPerson();

    if (field === 'thread' || field === 'unthread') {
      const wanted = text.toLowerCase();
      const at = next[key].threads.findIndex((t) => String(t).toLowerCase() === wanted);
      if (field === 'thread') {
        if (at !== -1) { why('that loose end is already written down'); continue; }
        if (next[key].threads.length >= THREADS_MAX) { why('their loose ends are full — something must close first'); continue; }
        next[key].threads.push(text);
      } else {
        if (at === -1) { why('no such loose end is written for them'); continue; }
        next[key].threads.splice(at, 1);
      }
      next[key].updatedAtTurn = atTurn;
      changes.push({ name: key, field });
      continue;
    }

    /* The contamination guard: never copy one person's words into
     * another's entry. */
    if (contaminated(next, key, text)) {
      why('those words belong to someone else’s page — not copied across');
      continue;
    }
    next[key][field] = text;
    next[key].updatedAtTurn = atTurn;
    changes.push({ name: key, field });
  }

  return { characters: next, changes, dropped };
}

/* The hand's door (people.set in engine/apply.js): write one field
 * outright. Same validation, same MC law. `threads` takes the whole list,
 * separated by semicolons or newlines. Returns {entry, key} or {why}. */
export function setPersonField(state, characters, name, field, text, turn) {
  const cleanName = normalizeName(name);
  if (!cleanName) return { why: 'no name came with it' };
  const f = typeof field === 'string' ? field.trim().toLowerCase() : '';
  if (!['core', 'state', 'arc', 'threads'].includes(f)) {
    return { why: '“' + (f || '?') + '” isn’t a page of the ledger (core, state, arc, threads)' };
  }
  const forMc = isMc(state, cleanName);
  if (forMc && (f === 'core' || f === 'arc')) {
    return { why: 'the main character’s ledger is record-only — state and threads, nothing more' };
  }
  /* The persona redirect holds for the hand as it does for the scribe: a
   * page addressed to "you" is the main character's record. */
  const key = forMc ? mcKey(state) : (findPersonKey(characters, cleanName) || cleanName);
  const before = characters[key] ? { ...characters[key], threads: (characters[key].threads || []).slice() } : null;
  const entry = before ? { ...before, threads: before.threads.slice() } : emptyPerson();
  const atTurn = Number.isFinite(turn) ? turn : (Number.isFinite(state && state.turn) ? state.turn : 0);
  if (f === 'threads') {
    const list = String(text || '')
      .split(/[;\n]/)
      .map((t) => cleanFieldText(t, THREAD_CAP))
      .filter(Boolean)
      .slice(0, THREADS_MAX);
    entry.threads = list;
  } else {
    const clean = cleanFieldText(text, FIELD_CAPS[f]);
    if (!clean) return { why: 'the note came in empty' };
    entry[f] = clean;
  }
  entry.updatedAtTurn = atTurn;
  return { entry, key, before };
}

/* ---------- migration ---------- */

/* loadState's coercion for the ledger: every readable entry is kept, the
 * shape is coerced, unknown extra fields ride along — nothing is lost. */
export function migrateCharacters(characters) {
  if (!characters || typeof characters !== 'object') return {};
  const out = {};
  for (const [rawKey, entry] of Object.entries(characters)) {
    const key = normalizeName(rawKey);
    if (!key || !entry || typeof entry !== 'object') continue;
    const person = { ...entry };
    person.core = typeof entry.core === 'string' ? entry.core : '';
    person.state = typeof entry.state === 'string' ? entry.state : '';
    person.arc = typeof entry.arc === 'string' ? entry.arc : '';
    person.threads = (Array.isArray(entry.threads) ? entry.threads : [])
      .filter((t) => typeof t === 'string' && t.trim())
      .map((t) => t.trim())
      .slice(0, THREADS_MAX);
    person.updatedAtTurn = Number.isFinite(entry.updatedAtTurn) ? Math.floor(entry.updatedAtTurn) : 0;
    out[key] = person;
  }
  return out;
}

/* ---------- speaking the ledger: the tiered injection ---------- */

/* How long since the ledger last heard of them, in plain words. */
function ageWords(entry, turn) {
  const at = Number.isFinite(entry && entry.updatedAtTurn) ? entry.updatedAtTurn : 0;
  const ago = Math.max(0, (Number.isFinite(turn) ? turn : 0) - at);
  return ago;
}

/* The aging law: fresh is simply "now"; past twenty turns the label admits
 * its age. */
export function stateLabel(entry, turn) {
  const ago = ageWords(entry, turn);
  if (ago > FRESH_TURNS) return 'Last noted ' + ago + ' turns ago: ';
  return 'Now: ';
}

function cardText(name, entry, turn, cap) {
  const lines = [name + (entry.core ? ' — ' + entry.core : '')];
  if (entry.state) lines.push(stateLabel(entry, turn) + entry.state);
  if (entry.arc) lines.push('Between you: ' + entry.arc);
  const threads = (entry.threads || []).slice(0, 3);
  if (threads.length) lines.push('Loose ends: ' + threads.join('; '));
  let text = lines.join('\n');
  if (cap && text.length > cap) text = text.slice(0, cap - 1).trimEnd() + '…';
  return text;
}

/* A name spoken in the latest pages? Case-insensitive, on a word boundary. */
function namedIn(pages, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(^|[^\\w])' + esc + '([^\\w]|$)', 'i');
  return (pages || []).some((p) => re.test(String(p || '')));
}

/* The tiered cast injection (SPEC.md M12, slot 5 area):
 *   1. full ledger cards for whoever is present (cap 6)
 *   2. a compact "also present" line for the overflow
 *   3. mention-recall — up to 3 cards of 500 chars for off-screen people
 *      named in the last three messages, framed as not in the scene
 *   4. a rotating off-screen roster (up to 12, one step per turn), each
 *      with "last seen N turns ago"
 * The main character's record is never injected (record-only). The whole
 * block holds to PEOPLE_BUDGET; the roster sheds first, then recall, then
 * the also-present line — the present keep their cards.
 *
 *   renderPeopleTiers(state, { recentPages, rotation })
 *     -> { text, tiers:{cards, also, recall, roster} } | null */
export function renderPeopleTiers(state, { recentPages = [], rotation = 0 } = {}) {
  if (!state || typeof state !== 'object') return null;
  const characters = state.characters && typeof state.characters === 'object' ? state.characters : {};
  const keys = Object.keys(characters).filter((k) => {
    const e = characters[k];
    return e && typeof e === 'object' && !e.retired /* M57: passed through — no card, no roster line */
      && (String(e.core || '').trim() || String(e.state || '').trim()
        || String(e.arc || '').trim() || (Array.isArray(e.threads) && e.threads.length));
  });
  if (!keys.length) return null;

  const turn = Number.isFinite(state.turn) ? state.turn : 0;
  const present = (Array.isArray(state.present) ? state.present : [])
    .map((p) => p && p.name).filter(Boolean)
    .filter((name) => !isMc(state, name));
  const presentKeys = [];
  for (const name of present) {
    const key = findPersonKey(characters, name) || name;
    if (characters[key] && !presentKeys.includes(key)) presentKeys.push(key);
  }

  const sections = [];
  const tiers = { cards: 0, also: 0, recall: 0, roster: 0 };

  /* Tier 1: full cards for the present, cap 6. Tier 2: whoever is present
   * beyond that (or present with nothing yet written) rides the compact
   * line. */
  const cardKeys = presentKeys.slice(0, PRESENT_CARDS_MAX);
  const overflow = presentKeys.slice(PRESENT_CARDS_MAX);
  const unwritten = present.filter((name) => {
    const key = findPersonKey(characters, name) || name;
    return !keys.includes(key);
  });
  for (const key of cardKeys) {
    if (!keys.includes(key)) continue;
    sections.push({ shed: 0, text: cardText(key, characters[key], turn) });
    tiers.cards += 1;
  }
  const also = overflow
    .map((key) => {
      const e = characters[key];
      const where = e && e.state ? ' — ' + e.state.split(/[.!?]/)[0] : '';
      return key + where;
    })
    .concat(unwritten);
  if (also.length) {
    sections.push({ shed: 1, text: 'Also here: ' + also.join(', ') + '.' });
    tiers.also = also.length;
  }

  /* Tier 3: mention-recall — off the scene, but their name was spoken in
   * the last three messages. */
  const offScene = keys.filter((k) => !presentKeys.includes(k) && !isMc(state, k));
  const recalled = offScene.filter((k) => namedIn(recentPages, k)).slice(0, RECALL_MAX);
  if (recalled.length) {
    const cards = recalled.map((k) => cardText(k, characters[k], turn, RECALL_CARD_CAP));
    sections.push({
      shed: 2,
      text: 'Named, though not in the scene right now:\n' + cards.join('\n\n'),
    });
    tiers.recall = recalled.length;
  }

  /* Tier 4: the rotating roster — everyone else the ledger knows, one step
   * around the shelf each turn, each with how long since they were seen. */
  const rosterPool = offScene.filter((k) => !recalled.includes(k));
  if (rosterPool.length) {
    const step = ((Math.floor(rotation) % rosterPool.length) + rosterPool.length) % rosterPool.length;
    const rotated = rosterPool.slice(step).concat(rosterPool.slice(0, step)).slice(0, ROSTER_MAX);
    const line = rotated.map((k) => {
      const ago = ageWords(characters[k], turn);
      return k + (ago > 0 ? ' (last seen ' + ago + (ago === 1 ? ' turn' : ' turns') + ' ago)' : ' (with us just now)');
    });
    sections.push({ shed: 3, text: 'Elsewhere in the tale: ' + line.join(', ') + '.' });
    tiers.roster = line.length;
  }

  /* The budget: shed the least vital until it fits; the present cards
   * always stay. */
  const kept = sections.slice();
  const join = () => kept.map((s) => s.text).join('\n\n');
  while (join().length > PEOPLE_BUDGET && kept.some((s) => s.shed > 0)) {
    let worst = 0;
    for (let i = 1; i < kept.length; i += 1) {
      if (kept[i].shed > kept[worst].shed) worst = i;
    }
    kept.splice(worst, 1);
  }
  const text = join();
  return text ? { text, tiers } : null;
}
