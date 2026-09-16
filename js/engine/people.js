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
import { storyTurn } from './apply.js';

/* Field caps — the ledger holds brushstrokes, not chapters. */
/* M266: A NOTE IS KEPT WHOLE. These were 300, 240, 240 and 140 — so a "now"
 * line that ran long was saved as "…and privately…", the rest lost for good.
 * They guard against a runaway answer now, nothing more. */
export const CORE_CAP = 4000;
export const STATE_CAP = 4000;
export const ARC_CAP = 4000;
export const THREAD_CAP = 1000;
export const THREADS_MAX = 8;
export const RECALL_CARD_CAP = 2000;
/* Tier laws (SPEC.md M12). */
export const PRESENT_CARDS_MAX = 6;
export const RECALL_MAX = 3;
export const ROSTER_MAX = 12;
export const FRESH_TURNS = 20;       /* past this, "now" ages into "last noted N turns ago" */
export const PEOPLE_BUDGET = 4800;   /* chars for the whole tiered block (M29: doubled — the people are the world) */

/* M281: THE PEOPLE FOLLOW THE ROOM. The block held to 4,800 characters and six
 * cards on any context; once a card kept its notes whole (M266), six present
 * cards filled it alone, and the people the writer had just named, and the
 * roster of everyone else, were shed on most pages. With room, every present
 * person keeps a card (to twelve), six are recalled, and the whole roster
 * rides without rotating (to forty); a small context keeps the old tiers. */
export function peopleView(budgetTokens) {
  const tokens = Number.isFinite(budgetTokens) && budgetTokens > 0 ? budgetTokens : 0;
  const budget = Math.max(PEOPLE_BUDGET, Math.min(48000, Math.floor(tokens * 3 * 0.06)));
  const roomy = budget >= PEOPLE_BUDGET * 4;
  return {
    budget,
    cards: roomy ? 12 : PRESENT_CARDS_MAX,
    recall: roomy ? 6 : RECALL_MAX,
    roster: roomy ? 40 : ROSTER_MAX,
  };
}

export function emptyPerson() {
  return { core: '', state: '', arc: '', threads: [], updatedAtTurn: 0 };
}

/* ---------- names ---------- */

/* M166: the magic keys are not names — see engine/apply.js. The scribe's
 * own door needs the same guard: a delta for "__proto__" would have been
 * counted as a change while the ledger kept nothing. */
const UNSAFE_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
function normalizeName(name) {
  if (typeof name !== 'string') return '';
  const clean = name.trim().replace(/\s+/g, ' ');
  return UNSAFE_NAMES.has(clean.toLowerCase()) ? '' : clean;
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
const keyLower = (k) => String(k || '').trim().toLowerCase().replace(/\s+/g, ' ');

/* M272: A TITLE TELLS TWO PEOPLE APART. "Mrs. Sterling" is one letter from
 * "Mr. Sterling", inside the near-name slack — so her lines were written on
 * her husband's page, and she had none of her own. Two names whose titles
 * differ are never the same person; the same title with or without its dot is. */
const TITLE_RE = /^(mr|mrs|ms|miss|mx|mister|missus|madam|madame|mme|mlle|dr|doctor|prof|professor|sir|dame|lady|lord|master|aunt|auntie|uncle|grandma|grandpa|granny|nana)\.?\s+(?=\S)/i;
const TITLE_SAME = { mister: 'mr', missus: 'mrs', doctor: 'dr', professor: 'prof', auntie: 'aunt', madame: 'madam' };
export function nameTitle(name) {
  const m = TITLE_RE.exec(String(name || '').trim());
  if (!m) return '';
  const t = m[1].toLowerCase();
  return TITLE_SAME[t] || t;
}
function titlesDiffer(a, b) {
  const x = nameTitle(a);
  const y = nameTitle(b);
  return Boolean(x && y && x !== y);
}

export function findPersonKey(characters, name) {
  const wanted = normalizeName(name).toLowerCase();
  if (!wanted) return '';
  const keys = Object.keys(characters && typeof characters === 'object' ? characters : {});
  const exact = keys.find((k) => k.toLowerCase() === wanted);
  if (exact) return exact;
  const near = keys.filter((k) => {
    if (titlesDiffer(k, wanted)) return false; /* M272 */
    const bound = Math.min(nameBound(k), nameBound(wanted)) || 1;
    return boundedLevenshtein(k.toLowerCase(), wanted, bound) <= bound;
  });
  if (near.length === 1) return near[0];

  /* M238: A FIRST NAME IS THE SAME PERSON AS THEIR FULL NAME. Spelling
   * distance never bridges "Vanessa" and "Vanessa Reynolds" — nine
   * characters apart — so the moment ONE worker wrote the short name and
   * another the full one, the ledger held TWO PEOPLE, each with half her
   * history, and the storyteller read them as different characters. Nothing
   * announced it. The writer's own ledger has "Vanessa Reynolds" from the
   * scribe and "Vanessa" everywhere in the prose.
   * A name matches a longer one when it is that name's own first or last
   * word — and ONLY when exactly one person answers to it. Two Vanessas in
   * the story means neither is matched, and a new page is the honest
   * outcome. */
  const partOf = (full, part) => {
    const words = full.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length > 1 && (words[0] === part || words[words.length - 1] === part);
  };
  const byPart = keys.filter((k) => partOf(k, wanted));
  if (byPart.length === 1) return byPart[0];

  /* M257: A NAME CUT SHORT IS THE SAME PERSON. The writer's ledger carried
   * "Vanessa Rey" beside "Vanessa Reynolds" — a second page, a second seat,
   * her own duplicate "now" line — because a truncation falls between every
   * rule there was: spelling distance is five characters, too far; and
   * "Vanessa Rey" is not the first or last WORD of "Vanessa Reynolds", it is
   * one and a half of them. A name that shares its whole first word and runs
   * on into the next is that name cut short, not a stranger. Both ways, and
   * only when exactly one person answers — and never for a single word, so
   * Mira and Miranda stay two people. */
  const cutShort = (a, b) => {
    const x = a.split(/\s+/).filter(Boolean);
    const y = b.split(/\s+/).filter(Boolean);
    if (x.length < 2 && y.length < 2) return false;
    const [shortOne, longOne] = a.length <= b.length ? [a, b] : [b, a];
    const sw = shortOne.split(/\s+/).filter(Boolean);
    return sw.length >= 2 && longOne.startsWith(shortOne) && longOne.length > shortOne.length;
  };
  const byCut = keys.filter((k) => !titlesDiffer(k, wanted) && cutShort(keyLower(k), wanted));
  if (byCut.length === 1) return byCut[0];

  /* and the other way: the scribe writes "Vanessa Reynolds" onto a page the
   * extractor opened as "Vanessa" */
  const wantWords = wanted.split(/\s+/).filter(Boolean);
  /* M272: "Mrs. Sterling" is not whoever was written down as plain "Sterling" */
  if (wantWords.length > 1 && !nameTitle(wanted)) {
    const byWhole = keys.filter((k) => {
      const kk = k.toLowerCase();
      return kk === wantWords[0] || kk === wantWords[wantWords.length - 1];
    });
    if (byWhole.length === 1) return byWhole[0];
  }
  return '';
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
  if (clean.length <= cap) return clean;
  /* M236: CUT ON A WORD, NEVER INSIDE ONE. This chopped at the cap exactly,
   * so the writer's own ledger carried a loose end ending "...and Vanessa is
   * still running interference with…" — severed mid-thought, and nothing to
   * say what she was running interference WITH. A cap that lands anywhere is
   * a cap that ruins whatever it lands on. */
  const room = clean.slice(0, cap - 1);
  const at = Math.max(room.lastIndexOf(' '), room.lastIndexOf(', '), room.lastIndexOf('; '));
  return (at > Math.floor(cap / 2) ? room.slice(0, at) : room).trimEnd().replace(/[,;]$/, '') + '…';
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
/* M134: two loose ends are the same when they share most of their content words */
export function sameLooseEnd(a, b) {
  const words = (t) => new Set(String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter((w) => w.length > 3));
  const x = words(a); const y = words(b);
  if (!x.size || !y.size) return false;
  if (String(a).trim().toLowerCase() === String(b).trim().toLowerCase()) return true;
  let hit = 0;
  for (const w of x) if (y.has(w)) hit += 1;
  const small = Math.min(x.size, y.size);
  return small >= 3 && hit / small >= 0.6;
}

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
      /* M134: a loose end closes on the SENSE of the words, not their exact
       * spelling — a cheap model never repeats a line verbatim, so nothing
       * ever closed, the list filled, and every new loose end was dropped:
       * pages stuck twenty turns behind. When the list is full the oldest
       * goes, never the newest. */
      const at = next[key].threads.findIndex((t) => sameLooseEnd(String(t), text));
      if (field === 'thread') {
        if (at !== -1) { why('that loose end is already written down'); continue; }
        if (next[key].threads.length >= THREADS_MAX) next[key].threads.shift();
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
    /* M236: THE WHOLE-LIST PATH NEVER DEDUPED. mergeDeltas has asked
     * sameLooseEnd before adding a thread since M134 — but this setter, which
     * a worker or the housekeeper uses to write the LIST at once, simply took
     * what it was given. So the writer's Vanessa carried "She is hunting for
     * a name and a photo of 'England boy' before Saturday." AND "She is STILL
     * hunting for a name and a photo of 'England boy' before Saturday." — the
     * same loose end twice, read by the storyteller every turn. Two doors,
     * one guarded. */
    const list = [];
    for (const raw of String(text || '').split(/[;\n]/)) {
      const t = cleanFieldText(raw, THREAD_CAP);
      if (!t) continue;
      if (list.some((kept) => sameLooseEnd(kept, t))) continue;
      list.push(t);
      if (list.length >= THREADS_MAX) break;
    }
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
  const head = name + (entry.core ? ' — ' + entry.core : '');
  const now = entry.state ? stateLabel(entry, turn) + entry.state : '';
  let arc = entry.arc ? 'Between you: ' + entry.arc : '';
  const threads = (entry.threads || []).slice(0, 3);
  let ends = threads.length ? 'Loose ends: ' + threads.join('; ') : '';
  const build = () => [head, now, arc, ends].filter(Boolean).join('\n');
  /* M266: WHOLE LINES, NEVER A CUT MID-SENTENCE. The card was chopped at its
   * cap wherever that fell. Now a card past its room lets go of whole lines —
   * the loose ends first, then how things stand between you; who they are and
   * where they are always ride whole. */
  if (cap && build().length > cap) ends = '';
  if (cap && build().length > cap) arc = '';
  return build();
}

/* A name spoken in the latest pages? Case-insensitive, on a word boundary.
 * M282: by the whole name OR the first name — the writer says "Rias", and
 * "Rias Wells" was never recalled; a titled name ("Mr. Sterling") only whole,
 * since a surname is shared by the family. Letters of any script. */
const TITLE_WORD = /^(mr|mrs|ms|miss|mx|dr|prof|professor|sir|lady|lord|aunt|auntie|uncle|grandma|grandpa|father|mother|sister|brother|coach|officer|detective|captain|madam|madame)\.?$/i;
export function spokenNames(name) {
  const whole = String(name || '').trim();
  if (!whole) return [];
  const words = whole.split(/\s+/);
  const out = [whole];
  if (words.length > 1 && !TITLE_WORD.test(words[0]) && words[0].replace(/[^\p{L}]/gu, '').length >= 3) out.push(words[0]);
  return out;
}
const wordRe = (n) => new RegExp('(^|[^\\p{L}\\p{N}_])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^\\p{L}\\p{N}_]|$)', 'iu');
function namedIn(pages, name) {
  const res = spokenNames(name).map(wordRe);
  return (pages || []).some((p) => res.some((re) => re.test(String(p || ''))));
}

/* M282: WHO MATTERS, WITHOUT A PIN. The writer will not pin anyone, and an
 * absent person who matters was a name on the roster — their page never rode
 * unless spoken in the last three messages. Weighed in code: how strongly they
 * stand toward the main character, the threads they carry, whether the brief
 * or the cast notes name them, a truth locked about them — less a little for
 * every page they have been away. */
export function importanceOf(state, name, briefText = '', turn = 0) {
  const k = String(name || '').trim().toLowerCase();
  if (!k) return 0;
  const first = spokenNames(name).slice(1).map((f) => f.toLowerCase());
  const same = (x) => {
    const y = String(x || '').trim().toLowerCase();
    return Boolean(y) && (y === k || first.includes(y));
  };
  const rels = state && state.relationships && typeof state.relationships === 'object' ? state.relationships : {};
  const relKey = Object.keys(rels).find(same);
  const rel = relKey ? rels[relKey] : null;
  let score = rel ? Math.abs(rel.p || 0) + Math.abs(rel.r || 0) + Math.abs(rel.s || 0) : 0;
  for (const t of (state && Array.isArray(state.threads) ? state.threads : [])) {
    if (t && same(t.owner)) score += t.heat === 'cold' ? 15 : 40;
  }
  const material = String(briefText || '');
  if (material.trim() && spokenNames(name).some((n) => wordRe(n).test(material))) score += 30;
  if (state && state.canon && typeof state.canon === 'object' && Object.keys(state.canon).some(same)) score += 20;
  const entry = state && state.characters ? state.characters[name] : null;
  const last = entry && Number.isFinite(entry.updatedAtTurn) ? entry.updatedAtTurn : turn;
  score -= Math.min(30, Math.max(0, turn - last) * 0.5);
  return score;
}
export const IMPORTANT_AT = 20;       /* the least an absent person weighs to ride as a card */
export const PRESENT_CARDS_MIN = 3;   /* the present who always keep their card, whatever the room */

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
export function renderPeopleTiers(state, { recentPages = [], rotation = 0, view = null, brief = '' } = {}) {
  const lim = view && typeof view === 'object' ? view : { budget: PEOPLE_BUDGET, cards: PRESENT_CARDS_MAX, recall: RECALL_MAX, roster: ROSTER_MAX };
  if (!state || typeof state !== 'object') return null;
  const characters = state.characters && typeof state.characters === 'object' ? state.characters : {};
  const keys = Object.keys(characters).filter((k) => {
    const e = characters[k];
    return e && typeof e === 'object' && !e.retired /* M57: passed through — no card, no roster line */
      && (String(e.core || '').trim() || String(e.state || '').trim()
        || String(e.arc || '').trim() || (Array.isArray(e.threads) && e.threads.length));
  });
  if (!keys.length) return null;

  /* M162: pages told, the unit the stamps use — state.turn counts writes,
   * so "last noted 24 turns ago" was really eleven pages. */
  const turn = storyTurn(state);
  const present = (Array.isArray(state.present) ? state.present : [])
    .map((p) => p && p.name).filter(Boolean)
    .filter((name) => !isMc(state, name));
  const presentKeys = [];
  for (const name of present) {
    const key = findPersonKey(characters, name) || name;
    if (characters[key] && !presentKeys.includes(key)) presentKeys.push(key);
  }

  const sections = [];
  const tiers = { cards: 0, also: 0, recall: 0, important: 0, roster: 0 };

  /* Tier 1: full cards for the present, cap 6. Tier 2: whoever is present
   * beyond that (or present with nothing yet written) rides the compact
   * line. */
  /* M282: the most important present first; a card past the room rides the line instead */
  const weigh = new Map(keys.map((k) => [k, importanceOf(state, k, brief, turn)]));
  const byWeight = (a, b) => (weigh.get(b) || 0) - (weigh.get(a) || 0);
  const cardKeys = [];
  let cardRoom = 0;
  for (const key of presentKeys.slice().sort(byWeight)) {
    if (!keys.includes(key) || cardKeys.length >= lim.cards) continue;
    const size = cardText(key, characters[key], turn).length + 2;
    if (cardKeys.length >= PRESENT_CARDS_MIN && cardRoom + size > lim.budget * 0.7) continue;
    cardKeys.push(key);
    cardRoom += size;
  }
  const overflow = presentKeys.filter((k) => !cardKeys.includes(k));
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
  /* M130: a recalled person who has a seat is where the seat says — the
   * scribe's older 'state' never rides beside the world agent's word */
  const seatOf = (k) => { const key = Object.keys(state.offscreen || {}).find((o) => o.toLowerCase() === k.toLowerCase()); return key ? state.offscreen[key] : null; };
  /* M281: and whoever is on their way to the main character is recalled too —
   * the storyteller may bring them in on this very page (named ones first) */
  const named = offScene.filter((k) => namedIn(recentPages, k));
  const coming = offScene.filter((k) => !named.includes(k) && ['toward', 'seeking'].includes(String((seatOf(k) || {}).stance || '')));
  const recalled = named.concat(coming).slice(0, lim.recall);
  if (recalled.length) {
    const cards = recalled.map((k) => {
      const seat = seatOf(k);
      if (!seat) return cardText(k, characters[k], turn, RECALL_CARD_CAP);
      const entry = { ...characters[k], state: [seat.location, seat.activity].filter(Boolean).join(', ') || characters[k].state, updatedAtTurn: turn };
      return cardText(k, entry, turn, RECALL_CARD_CAP);
    });
    sections.push({
      shed: 2,
      text: 'Named, though not in the scene right now:\n' + cards.join('\n\n'),
    });
    tiers.recall = recalled.length;
  }

  /* Tier 3b (M282): the absent who matter most, in the room that is left —
   * most important first, each card to the recall size, seats honoured. */
  const important = [];
  {
    const used = sections.reduce((n, x) => n + x.text.length + 2, 0);
    let room = lim.budget - used - 1500; /* the roster's line keeps its place */
    const pool = offScene.filter((k) => !recalled.includes(k) && (weigh.get(k) || 0) >= IMPORTANT_AT).sort(byWeight);
    const cards = [];
    for (const k of pool) {
      const seat = seatOf(k);
      const entry = seat ? { ...characters[k], state: [seat.location, seat.activity].filter(Boolean).join(', ') || characters[k].state, updatedAtTurn: turn } : characters[k];
      const card = cardText(k, entry, turn, RECALL_CARD_CAP);
      if (card.length + 2 > room) continue;
      cards.push(card);
      important.push(k);
      room -= card.length + 2;
    }
    if (cards.length) {
      sections.push({ shed: 4, text: 'Away, and much on the story\u2019s mind:\n' + cards.join('\n\n') });
      tiers.important = cards.length;
    }
  }

  /* Tier 4: the rotating roster — everyone else the ledger knows, one step
   * around the shelf each turn, each with how long since they were seen. */
  const rosterPool = offScene.filter((k) => !recalled.includes(k) && !important.includes(k));
  if (rosterPool.length) {
    const step = ((Math.floor(rotation) % rosterPool.length) + rosterPool.length) % rosterPool.length;
    const rotated = rosterPool.length <= lim.roster ? rosterPool : rosterPool.slice(step).concat(rosterPool.slice(0, step)).slice(0, lim.roster);
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
  while (join().length > lim.budget && kept.some((s) => s.shed > 0)) {
    let worst = 0;
    for (let i = 1; i < kept.length; i += 1) {
      if (kept[i].shed > kept[worst].shed) worst = i;
    }
    kept.splice(worst, 1);
  }
  /* M281: a tier that was shed is not reported as sent */
  const stayed = new Set(kept.map((s) => s.shed));
  if (!stayed.has(1)) tiers.also = 0;
  if (!stayed.has(2)) tiers.recall = 0;
  if (!stayed.has(3)) tiers.roster = 0;
  if (!stayed.has(4)) tiers.important = 0;
  const text = join();
  return text ? { text, tiers } : null;
}
