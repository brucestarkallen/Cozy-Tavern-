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
import { foldName, canonAliasOf, samePersonName, titlesConflict, isTitleWord } from './names.js'; /* M398: one person, one page; M414: one list of titles */
import { firstSentence } from './sentence.js'; /* M292 */
import { storyTurn } from './apply.js';
import { onTheWay } from './world.js'; /* M681 (W5): who is on the way, one answer */
import { seatNowWords, findSeat, setSeatResolver, isDeadSeat } from './offscreen.js'; /* M300: a seat says its age; M304: one wording for every reader; M320: a seat is found the way a page is; M484: the dead */

/* Field caps — the ledger holds brushstrokes, not chapters. */
/* M266: A NOTE IS KEPT WHOLE. These were 300, 240, 240 and 140 — so a "now"
 * line that ran long was saved as "…and privately…", the rest lost for good.
 * They guard against a runaway answer now, nothing more. */
export const CORE_CAP = 4000;
export const STATE_CAP = 4000;
export const ARC_CAP = 4000;
export const THREAD_CAP = 1000;
/* M559 (the audit): A PERSON'S LOOSE ENDS NO LONGER FORGET. M305 found that a cap which lets the OLDEST go is the old seat
 * cap's fault again — a secret pushed out by twelve trifles, a rival's dormant plan deleted by a ninth thread — and fixed it in
 * two books (who-knows-what kept whole; the world's threads 8 → 40). A third book had the same eight: each person's own
 * loose ends ("owes Jovan a favour", page 10) went the moment an eighth newer one came — and the storyteller, the scribe and
 * the auditor then read that person as if it had never been. Forty, as the world's threads: what is shown to each reader was
 * never the whole list (the storyteller reads the newest and what bears on the scene). */
export const THREADS_MAX = 40;
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
  const vast = tokens >= 400000; /* M283: a very large room holds a larger cast whole */
  const budget = Math.max(PEOPLE_BUDGET, Math.min(vast ? 72000 : 48000, Math.floor(tokens * 3 * 0.06)));
  const roomy = budget >= PEOPLE_BUDGET * 4;
  return {
    budget,
    cards: vast ? 16 : roomy ? 12 : PRESENT_CARDS_MAX,
    recall: roomy ? 6 : RECALL_MAX,
    roster: vast ? 60 : roomy ? 40 : ROSTER_MAX,
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

/* How near a near-name may be before the ledger calls it the same person: see nearName, below (M646 — it used to be one
 * letter of slack for a short name and two for a longer, which made Mira into Mina). */

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
  /* M414: and the ledger's one reading of titles (engine/names.js) — two ranks that differ are two people too
   * ("Captain Kuchiki" is not "Lieutenant Kuchiki"); M272's own pairs stay refused exactly as before */
  return Boolean(x && y && x !== y) || titlesConflict(a, b);
}

/* M648 (the ledger audit, part five — a person's page at the ledger's door): WHO SOMEONE IS, IS ADDED TO — NEVER THINNED BY A
 * WORKER. A core is "their stable nature… what never really changes", and the page-keeping worker is told to write it
 * rarely; but whatever it sent REPLACED what stood: "the ferryman's niece; quick, proud, counts every coin; will not be
 * pitied" became "a girl" in one answer, or "gentle and trusting, eager to please" — the drift his craft's Character
 * Gravity forbids, written into the ledger and read back to the storyteller as who she is. A worker's core that keeps
 * less than three-fifths of the telling words of the core that stands AND says less than it does is a thinning: it is
 * not written (the worker's own path drops it and says so). A core that keeps what stood and adds, or a fuller
 * rewrite, is written as before; the writer's own hand, the auditor (who restores a core to the brief) and a rebuild
 * are not held to this. */
export function thinsCore(standing, offered) {
  const old = String(standing || '').trim();
  const neu = String(offered || '').trim();
  if (!old || !neu) return false;
  const telling = (t) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}'’-]+/u).map((w) => w.replace(/['’]s$/, '')).filter((w) => w.length >= 4));
  const was = telling(old);
  if (!was.size) return false;
  const now = telling(neu);
  let kept = 0;
  for (const w of was) if (now.has(w)) kept += 1;
  return kept / was.size < 0.6 && neu.length < old.length;
}
function nearName(a, b) {
  const x = foldName(a).split(' ').filter(Boolean);
  const y = foldName(b).split(' ').filter(Boolean);
  if (!x.length || x.length !== y.length) return false;
  let slips = 0;
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] === y[i]) continue;
    const short = Math.min(x[i].length, y[i].length);
    if (short < 6) return false;
    const bound = short >= 10 ? 2 : 1;
    if (boundedLevenshtein(x[i], y[i], bound) > bound) return false;
    slips += 1;
  }
  return slips === 1;
}
export function findPersonKey(characters, name) {
  const wanted = normalizeName(name).toLowerCase();
  if (!wanted) return '';
  const keys = Object.keys(characters && typeof characters === 'object' ? characters : {});
  const exact = keys.find((k) => k.toLowerCase() === wanted);
  if (exact) return exact;
  /* M398: ONE PERSON, ONE PAGE — THE SAME LETTERS, OR CANON'S OTHER NAME FOR THEM. "Suì-Fēng" (from canon) and
   * "Sui-Feng" (on the page) are one person with folded letters; "Soi Fon" is her too when canon says so. Only a
   * match that is exactly one page, and only by folded letters or canon's names — first names keep their own rule
   * below (two Vanessas are never one). */
  const folded = foldName(name);
  const sameLetters = keys.filter((k) => foldName(k) === folded);
  if (sameLetters.length === 1) return sameLetters[0];
  const byCanon = keys.filter((k) => canonAliasOf(k, name));
  if (byCanon.length === 1) return byCanon[0];
  /* M646 (the ledger audit, part three — twenty-three pairs of names through this door): A SHORT NAME ONE LETTER OFF IS
   * ANOTHER NAME. The near-name slack (one letter for a short name, two for a longer) was meant for a slip of the pen —
   * and it made Mira into Mina, Tom into Tim, Jon into John, Kara into Lara, Rias into Ria, Jovan into Jovana: the first
   * note for the one landed on the other's page, and two people were one from then on (his own DC tale holds a Jon and a
   * John, a Kara and a Lara). A slip is forgiven only inside a word long enough for it to BE a slip (six letters; two
   * letters only from ten), in one word of the name, with every other word the same — "Tom Wells" and "Tim Wells" are
   * brothers, "Hitsugaya" and "Hitsugayo" one man. */
  const near = keys.filter((k) => !titlesDiffer(k, wanted) && nearName(k, wanted)); /* M272: a title tells two people apart */
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
  /* M405: letters folded and brackets set aside — "Rōjūrō Otoribashi (Rose)" answers to "Rose" */
  const partOf = (full, part) => {
    const words = foldName(full).split(' ').filter(Boolean);
    const p = foldName(part);
    return words.length > 1 && (words[0] === p || words[words.length - 1] === p);
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
  /* M414: THE ONE MATCHER, LAST. "Captain Hitsugaya" never found Toshiro Hitsugaya's page (the matcher set the rank
   * aside since M404; this finder did not), and "Kuchiki Rukia" never found Rukia Kuchiki's — so a present person's page
   * was "missing" and a second one was written. Any form the one matcher calls the same person, when exactly one page
   * answers — never two titles that disagree. */
  /* M272 stands: a name with a courtesy title ("Mrs. Sterling") is never whoever was written down as the bare surname */
  const bySame = keys.filter((k) => samePersonName(k, name) && !titlesDiffer(k, wanted) && !(nameTitle(wanted) && keyLower(k).split(' ').length === 1));
  if (bySame.length === 1) return bySame[0];
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
/* M681 — A SHORT LOOSE END IN OTHER CASE OR MARKS IS THE SAME LOOSE END (the people audit's P7, made to happen on m680-001):
 * "Hunting Kim." and "hunting Kim" were two (a loose end of two words had no long words to compare and its text differed by a
 * full stop) — so the reader's close of it found nothing, and it stood answered for good; written twice, it stood twice. The
 * plain words compare (case, accents and marks aside); a short one is the same when its words are the same. */
const LOOSE_FILL = new Set(['a', 'an', 'the', 'to', 'of', 'and']);
const plainLoose = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
export function sameLooseEnd(a, b) {
  const words = (t) => new Set(plainLoose(t).split(' ').filter((w) => w.length > 3));
  const pa = plainLoose(a); const pb = plainLoose(b);
  if (!pa || !pb) return false;
  if (pa === pb) return true;
  const x = words(a); const y = words(b);
  const small = Math.min(x.size, y.size);
  if (small < 3) {
    const all = (t) => new Set(t.split(' ').filter((w) => w && !LOOSE_FILL.has(w)));
    const ax = all(pa); const by = all(pb);
    return ax.size > 0 && ax.size === by.size && [...ax].every((w) => by.has(w));
  }
  let hit = 0;
  for (const w of x) if (y.has(w)) hit += 1;
  return hit / small >= 0.6;
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
    if (!next[key]) { next[key] = emptyPerson(); next[key].firstSeenTurn = atTurn; } /* M284: when they came into the tale */

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
    if (field === 'state') next[key].nowTurn = atTurn; /* M680: the now's own age — a loose end closed is not a fresh now */
    changes.push({ name: key, field });
  }

  return { characters: next, changes, dropped };
}

/* The hand's door (people.set in engine/apply.js): write one field
 * outright. Same validation, same MC law. `threads` takes the whole list,
 * separated by semicolons or newlines. Returns {entry, key} or {why}. */
/* M482: A DESCRIPTOR IS NOT A PERSON. The scribe seated "Jovan's stepsister" beside "Vivi" — two seats, two pages, two
 * sets of loose ends for one person, until the auditor folded them a turn later. A name that is a RELATION to someone
 * ("Jovan's stepsister", "his older sister", "the stepmother", "Kara's cousin", with any adjectives before the
 * relation word) is resolved at the door to the one named person whose page, canon or seat already carries that
 * relation to that someone — exactly one, or nobody (then the descriptor may stand as a page of its own, as an unnamed
 * character does). Every book goes through this door: pages, seats, standings, knowledge, threads. */
const RELATION_WORDS = '(?:step|half|grand|god|foster|great-)?(?:sister|brother|mother|father|mom|dad|mum|son|daughter|wife|husband|aunt|uncle|cousin|niece|nephew|sibling|twin|parent|child|kid|friend|boss|teacher|mentor|butler|maid|driver|guard|bodyguard|assistant|secretary|roommate|neighbou?r|partner|girlfriend|boyfriend|fianc[ée]e?|ex|lover|rival|captain|lieutenant|master|servant|apprentice)(?:-in-law)?';
const DESCRIPTOR_RE = new RegExp('^(?:(the|his|her|their|my|your)\\s+|([A-Z][\\w\'’-]+(?:\\s+[A-Z][\\w\'’-]+)*)(?:\'s|’s)\\s+)((?:[a-z-]+\\s+){0,3})(' + RELATION_WORDS + ')$', 'i');
function relationOf(name) {
  const m = DESCRIPTOR_RE.exec(String(name || '').trim());
  if (!m) return null;
  return { owner: m[2] || null, pronoun: m[1] ? m[1].toLowerCase() : null, adjectives: String(m[3] || '').trim().toLowerCase(), relation: m[4].toLowerCase() };
}
/* M490-3: a descriptor or a role is matched against who someone IS — the opening of their core line — never against
 * what they are doing (state), where they sit, or what canon says of others: "the driver" matched Vivi because her
 * STATE said "her driver is William's spy", and a new person would have been written into her page */
function personTexts(state, key) {
  const c = state.characters && state.characters[key];
  return c && typeof c.core === 'string' ? c.core.slice(0, 140) : '';
}
/* M484: A GROUP IS NOT A PERSON. "the onlookers behind the taped line", "The two police officers at the barricade",
 * "several guards" — a crowd got a person's page, a seat with an agenda and a standing, and rode in the briefing as
 * a character. A group is a faction's business (faction.set), never a page or a seat. */
/* M484/M490-3: a crowd is a DETERMINER + a people-noun that ENDS the phrase ("the onlookers behind the taped line",
 * "several guards", "The rest"), or a bare PLURAL people-noun ("Onmitsukidō runners"). "of" before the noun ("Captain
 * of the guards"), a possessive, or anything but a place/relative phrase after it ("Squad Leader Hayes", "Team Rocket
 * Jessie") is a PERSON — the first version called all of those crowds, and M485 deletes a crowd's page on load. */
const GROUP_PLURAL = '(?:onlookers|bystanders|crowds|people|passers-?by|guards|officers|soldiers|troops|villagers|townsfolk|townspeople|men|women|children|kids|students|runners|attendants|servants|thugs|bandits|goons|others|spectators|reporters|guests|patrons|workers|refugees|civilians)';
const GROUP_COLLECTIVE = '(?:crowd|mob|patrol|squad|unit|team|band|gang|pair|couple|group|handful|dozen|rest)';
const GROUP_AFTER = '(?:\\s+(?:behind|at|by|near|in|on|from|outside|inside|around|along|under|over|beside|across|with|of|who|that|watching|waiting)\\b.*)?';
const GROUP_BEFORE = "(?:(?!of\\b)[\\p{L}-]+\\s+)";
const GROUP_DET = '(?:the|a|an|some|several|a few|many|two|three|four|five|six|seven|eight|nine|ten|\\d+)';
const GROUP_WITH_DET = new RegExp('^' + GROUP_DET + '\\s+' + GROUP_BEFORE + '{0,3}(?:' + GROUP_PLURAL + '|' + GROUP_COLLECTIVE + ')' + GROUP_AFTER + '$', 'iu');
const GROUP_BARE = new RegExp('^' + GROUP_BEFORE + '{0,2}' + GROUP_PLURAL + GROUP_AFTER + '$', 'iu');
export function isGroupName(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n || /['’]s\b/i.test(n)) return false;
  return GROUP_WITH_DET.test(n) || GROUP_BARE.test(n);
}

/* M484: A ROLE IS THE PERSON WHO HOLDS IT. "The news drone operator" walked the ledger beside "Dev Okafor", whose page
 * says "news drone operator; flew the drone over the crater…" — two seats, two threads, two people. A name that is an
 * article and a role ("the news drone operator", "the woman in scrubs") is the one named person whose page carries
 * that very phrase; two pages, or none: nobody. */
function roleOf(name) {
  const m = /^(?:the|a|an)\s+([a-z][a-z' -]{2,60})$/i.exec(String(name || '').trim());
  if (!m) return null;
  const role = m[1].trim().toLowerCase();
  return role.split(/\s+/).length >= 2 || role.length >= 6 ? role : null;
}
function resolveRole(state, name) {
  const role = roleOf(name);
  if (!role || isGroupName(name)) return null;
  const hits = [];
  const esc = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pages = state.characters && typeof state.characters === 'object' ? state.characters : {};
  for (const key of Object.keys(pages)) {
    if (roleOf(key) || relationOf(key) || samePersonName(key, name)) continue;
    const text = personTexts(state, key).toLowerCase().trim();
    /* the role must OPEN the core ("news drone operator; flew…", "the woman in scrubs who…") */
    if (new RegExp('^(?:the |an? )?' + esc + '\\b').test(text)) hits.push(key);
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return null;
  /* M509-2: THE LEDGER NAMES THE ROLE'S OWNER IN APPOSITION. Hachigorō's core said nothing of couriers — "sitting with
   * his back to the wall, a straw hat low over his face" — but a thread said "the courier Hachigorō" and a fact "saw the
   * courier Hachigorō ride in"; still "the courier" walked in as a second man and stood beside him. A named page that
   * the ledger's own words call "the <role> <Name>", "<Name>, the <role>" or "<Name> the <role>" — and no other — is the
   * person. Named pages only; a descriptor is never another descriptor. */
  const named = Object.keys(pages).filter((k) => !roleOf(k) && !relationOf(k) && !samePersonName(k, name));
  if (!named.length) return null;
  const owners = roleOwnersNamed(state, role, named);
  return owners.length === 1 ? owners[0] : null;
}
/* M509-5: the named pages the ledger's own words call "the <role> <Name>" / "<Name>, the <role>" — the join's evidence,
 * kept apart so the light can say why a descriptor stands alone (none named; two named) */
/* M509-6: THE SEARCH IS DONE ONCE PER LEDGER AND ROLE, AND IN ONE PASS. The first cut joined every text of the ledger and
 * ran one regex per named page on every call — and resolveDescriptor is asked for every descriptor on every render of
 * the room (the drawer, the briefing, each reader), so a courtyard with eight descriptors and forty books stalled the
 * drawer for seconds on his phone. Now the ledger's words are joined once per ledger object, one regex per role
 * captures the names that follow or precede the role, the captured names are matched to the pages, and the answer is
 * kept per ledger object and role. Names are compared NFC-normalised (a page key and a fact can spell "ō" two ways). */
const BODY_OF = new WeakMap(); /* state -> the ledger's words, joined once */
const OWNERS_OF = new WeakMap(); /* state -> Map(role -> owners) */
const nfc = (t) => String(t || '').normalize('NFC');
function ledgerWords(state) {
  const hit = BODY_OF.get(state);
  if (hit !== undefined) return hit;
  const pages = state.characters && typeof state.characters === 'object' ? state.characters : {};
  const texts = [];
  for (const k of Object.keys(pages)) { const c = pages[k] || {}; texts.push([c.core, c.state, c.arc, ...(Array.isArray(c.threads) ? c.threads : [])].filter((x) => typeof x === 'string').join(' ')); } /* the whole page, its loose ends too */
  for (const t of (Array.isArray(state.threads) ? state.threads : [])) texts.push([t && t.title, t && t.next, t && t.note].filter((x) => typeof x === 'string').join(' '));
  for (const list of Object.values(state.knowledge && typeof state.knowledge === 'object' ? state.knowledge : {})) for (const f of (Array.isArray(list) ? list : [])) if (f && typeof f.fact === 'string') texts.push(f.fact);
  for (const seat of Object.values(state.offscreen && typeof state.offscreen === 'object' ? state.offscreen : {})) texts.push([seat && seat.location, seat && seat.activity, seat && seat.agenda].filter((x) => typeof x === 'string').join(' '));
  if (typeof state.worldBrief === 'string') texts.push(state.worldBrief);
  const body = nfc(texts.join('\n'));
  if (state && typeof state === 'object') BODY_OF.set(state, body);
  return body;
}
export function roleOwnersNamed(state, role, namedPages = null) {
  const esc = String(role || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!esc || !state || typeof state !== 'object') return [];
  let byRole = OWNERS_OF.get(state);
  if (!byRole) { byRole = new Map(); OWNERS_OF.set(state, byRole); }
  const key = role + '|' + (Array.isArray(namedPages) ? namedPages.join('|') : '*');
  if (byRole.has(key)) return byRole.get(key).slice();
  const pages = state.characters && typeof state.characters === 'object' ? state.characters : {};
  const named = Array.isArray(namedPages) ? namedPages : Object.keys(pages).filter((k) => !roleOf(k) && !relationOf(k));
  const body = ledgerWords(state);
  /* one pass: the capitalised name (one or two words) after "the <role>", and the one before ", the <role>" */
  const NAME = '([\\p{Lu}][\\p{L}\\p{N}\'’.-]*(?:\\s+[\\p{Lu}][\\p{L}\\p{N}\'’.-]*)?)';
  /* no `i` flag: it would make \p{Lu} match any letter and the capture swallow the next word ("Hachigorō ride"); the
   * article and the role are matched in either case by hand */
  const anyCase = (w) => w.replace(/\p{L}/gu, (ch) => { const lo = ch.toLowerCase(); const up = ch.toUpperCase(); return lo === up ? ch : '[' + lo + up + ']'; });
  const article = '(?:[Tt]he|[Aa]n?)';
  const after = new RegExp('(?<![\\p{L}\\p{N}])' + article + '\\s+' + anyCase(esc) + '\\s+' + NAME + '(?![\\p{L}\\p{N}])', 'gu');
  const before = new RegExp('(?<![\\p{L}\\p{N}])' + NAME + ',?\\s+' + article + '\\s+' + anyCase(esc) + '(?![\\p{L}\\p{N}])', 'gu');
  const seen = new Set();
  for (const re of [after, before]) { let m; while ((m = re.exec(body))) { const cand = m[1].trim(); if (cand) seen.add(cand); if (seen.size > 200) break; } }
  const owners = [];
  for (const k of named) {
    const kn = nfc(k); const first = kn.split(/\s+/)[0];
    const forms = [kn, first].filter((w) => w && w.length >= 3 && !/^(?:the|an?)$/i.test(w)).map((w) => w.toLowerCase());
    if (!forms.length) continue;
    let hit = false;
    for (const cand of seen) { const c = cand.toLowerCase(); const cFirst = c.split(/\s+/)[0]; if (forms.includes(c) || forms.includes(cFirst) || c.startsWith(forms[0] + ' ')) { hit = true; break; } }
    if (hit) owners.push(k);
  }
  byRole.set(key, owners.slice());
  return owners;
}
export function roleWordOf(name) { return roleOf(name); } /* M509-5: for the light's word */

export function resolveDescriptor(state, name) {
  const rel = relationOf(name);
  if (!rel) return resolveRole(state, name);
  /* a pronoun owner ("his", "my", "the") is the main character */
  const owner = rel.owner || mcName(state);
  const ownerIsMc = !rel.owner || isMc(state, rel.owner);
  /* the relation with its adjectives when the descriptor gave them ("older sister" — not any sister) */
  const phrase = (rel.adjectives ? rel.adjectives + ' ' : '') + rel.relation;
  /* a plain relation is also answered by its step/half/foster form ("Jovan's sister" is his sister OR his stepsister —
   * two candidates, so nobody) */
  const stepable = !/^(?:step|half|foster)/.test(rel.relation);
  const relRe = new RegExp('\\b' + (rel.adjectives ? phrase : (stepable ? '(?:step|half-?|foster)?' : '') + rel.relation).replace(/[-](?!\?)/g, '\\-').replace(/\s+/g, '\\s+') + 's?\\b', 'i');
  /* the owner by any word of his name three letters or longer ("Jovan" for "Jovan Arden"); for the main character a
   * pronoun stands for him too — for anyone else a pronoun on a page is the page's own subject, never the owner */
  const ownerWords = owner && owner !== 'the player' ? owner.split(/\s+/).filter((w) => w.length >= 3).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : [];
  const nameRe = ownerWords.length ? new RegExp('\\b(?:' + ownerWords.join('|') + ')\\b', 'i') : null;
  const ownerRe = ownerIsMc ? new RegExp('\\b(?:' + (ownerWords.length ? ownerWords.join('|') + '|' : '') + 'his|her|their)\\b', 'i') : nameRe;
  if (!ownerRe) return null;
  const names = new Set([
    ...Object.keys(state.characters && typeof state.characters === 'object' ? state.characters : {}),
    ...Object.keys(state.canon && typeof state.canon === 'object' ? state.canon : {}),
    ...Object.keys(state.offscreen && typeof state.offscreen === 'object' ? state.offscreen : {}),
  ]);
  const hits = [];
  for (const key of names) {
    if (relationOf(key)) continue; /* another descriptor is never the person */
    if (samePersonName(key, name) || (owner && samePersonName(key, owner))) continue;
    const text = personTexts(state, key);
    if (!text) continue;
    const clauses = text.split(/[.;\n]/);
    /* the owner NAMED with the relation in one clause of the identity; or — for the main character only — a pronoun
     * with it in the FIRST clause ("His older sister."), never a later one ("the innkeeper; her sister runs the
     * ferry" is Mara's sister, not his) */
    if ((nameRe && clauses.some((s) => relRe.test(s) && nameRe.test(s))) || (ownerIsMc && relRe.test(clauses[0] || '') && /\b(?:his|her|their)\b/i.test(clauses[0] || ''))) hits.push(key);
  }
  /* M490-3: exactly one, or nobody — a missed merge leaves a duplicate the auditor folds; a wrong one corrupts a page */
  if (hits.length === 1) return hits[0];
  if (!hits.length) return resolveRole(state, name);
  return null;
}


/* M665 — HIS: "can it be done smartly, safely and autonomous or not?" — TWO PEOPLE WRITTEN AS ONE, PARTED ON LOAD. Before
 * M646 a name one letter from another's was taken for a slip of it: what a worker wrote for "Lara" was written on
 * KARA's page — her nature over Kara's, her knowledge in Kara's book, her seat in Kara's place. M646 stopped it; what
 * was already written stayed mixed. THE JOURNAL KEEPS EACH CHANGE AS THE WORKER WROTE IT, name and all (the last 1,500),
 * so the mixing can be read back and undone without a model and without a guess:
 *   - WHO: a name the workers wrote on two pages or more, that today's rule keeps apart from every page, with exactly
 *     ONE page a single letter away from it — and that page's own name written on two pages or more too. Two names the
 *     workers each used again and again are two people, not a slip.
 *   - WHAT MOVES: only what the journal shows was written FOR the second name and still stands on the first's page in
 *     the very same words — a nature, an arc or a now (the first's own latest is put back, or the field left empty for
 *     the scribe, who is asked by name for whoever has none); loose ends; what she knows; what is true of her; a wound;
 *     the seat, when the last whereabouts written was hers. Anything rewritten since is left where it is.
 *   - WHAT DOES NOT: the standing. How far each beat moved it was worked out at the time (the governor, the caps), so the
 *     second person's share cannot be taken back out of the first's number. The second person has none after this and is
 *     asked for by name on the next page she is on (M641); the first keeps the number it has.
 * Pure, like healGhosts: the state it is handed, mended in place; `parted` (on the state, not saved) says who. */
function oneLetterApart(a, b) {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
const WRITTEN_FOR_A_PERSON = /^(?:people\.(?:set|note)|knowledge\.add|canon\.lock|body\.injure|offscreen\.set|rel\.(?:set|shift)|presence\.(?:enter|update))$/;
/* M672: a name's folded words, remembered across loads — folding is the costly part (it was 12 of this repair's 12.5 ms
 * on a long tale), a tale's names are the same from one load to the next, and the fold of a name never changes */
const FOLDED_WORDS = new Map();
function foldedWordsOf(x) {
  let w = FOLDED_WORDS.get(x);
  if (!w) {
    w = foldName(x).split(' ').filter(Boolean);
    if (FOLDED_WORDS.size > 4000) FOLDED_WORDS.clear();
    FOLDED_WORDS.set(x, w);
  }
  return w;
}
export function partLookAlikes(state) {
  const s = state && typeof state === 'object' ? state : {};
  const chars = s.characters && typeof s.characters === 'object' ? s.characters : {};
  const journal = Array.isArray(s.journal) ? s.journal : [];
  if (!journal.length || !Object.keys(chars).length) return s;
  const same = (a, b) => String(a || '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b || '').trim().replace(/\s+/g, ' ').toLowerCase();
  /* M672: THIS RUNS EVERY TIME A LEDGER IS OPENED, AND IT COST 19 ms ON A LONG TALE (100 people, a full journal) — measured; the
   * older repair beside it costs half a millisecond. It compared every name written with every page, folding both names
   * anew for each pair, and asked the whole cast "would today's rule find this name a page?" before anything cheaper.
   * Now each name is folded ONCE (and remembered: a name's fold never changes), the page that bears a name is looked
   * up rather than searched for, the cheap questions come first, and the one costly question is asked last, of a true
   * candidate only. Every condition is the one it was (the laws of M665 are the proof for one look-alike of a page).
   * M675 — ONE THING DID CHANGE, AND IT IS KEPT ON PURPOSE (the audit, old against new on 60,000 made-up ledgers: 40
   * differ, every one with TWO OR MORE names written a letter from the same page and no page of their own — page
   * Kara; "Lara" and "Mara" both written onto it). The pages' names are read once, before the loop, where they used
   * to be read again for each name: so the page made for the first of them (Lara) no longer stands in the way of the
   * second (Mara was then "a letter from two pages", and was left mixed into Kara's for good). Every such name is
   * parted now, each onto a page of its own — that is the repair's whole purpose, and m675's law M675-9 holds it.
   * WHAT IS NOT HERE, AND WHY: my first cut also remembered "this ledger has nothing to part" by its counts and the
   * LENGTHS of its words, and passed such a ledger by. Two ledgers that differ only in whose name a change was written
   * under — Kara's or Lara's — have the same counts and lengths: the second was passed by on the memory of the first
   * and stayed mixed (m588 M672-1, made to happen). A repair looks at the ledger it is handed. */
  const keys = Object.keys(chars);
  const norm = (x) => String(x || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const keyOfNorm = new Map();
  const wordsOf = foldedWordsOf;
  const alikeWords = (a, b) => { /* two names alike but for one letter in one word — on names already folded */
    if (!a.length || a.length !== b.length) return false;
    let apart = 0;
    for (let i = 0; i < a.length; i += 1) { if (a[i] === b[i]) continue; if (!oneLetterApart(a[i], b[i])) return false; apart += 1; }
    return apart === 1;
  };
  /* a name's folded length: two names a letter apart in one word differ by one letter at most, so the rest need no look */
  const keyInfo = keys.map((K) => { const w = wordsOf(K); const n = norm(K); if (!keyOfNorm.has(n)) keyOfNorm.set(n, K); return { K, n, w, l: w.join(' ').length }; });
  const given = new Map();
  /* a name is written many times and a kind of change comes in runs: each is worked out once, not once an entry */
  const ofRawName = new Map(); /* the name as the journal wrote it -> whom it is written for (null: no name at all) */
  let lastType; let lastIsForAPerson = false;
  for (const e of journal) {
    const m = e && e.m;
    if (!m || typeof m.name !== 'string') continue;
    if (m.type !== lastType) { lastType = m.type; lastIsForAPerson = WRITTEN_FOR_A_PERSON.test(String(m.type)); }
    if (!lastIsForAPerson) continue;
    let g = ofRawName.get(m.name);
    if (g === undefined) {
      const name = m.name.trim().replace(/\s+/g, ' ');
      if (!name) g = null;
      else { const k = name.toLowerCase(); g = given.get(k); if (!g) { g = { name, k, pages: new Set(), entries: [] }; given.set(k, g); } }
      ofRawName.set(m.name, g);
    }
    if (!g) continue;
    g.pages.add(e.p); g.entries.push(e);
  }
  const parted = [];
  for (const g of given.values()) {
    const G = g.name;
    if (g.pages.size < 2) continue;
    /* the cheap question first: is any page's name one letter from this one? (almost never) */
    const gw = wordsOf(G);
    const gl = gw.join(' ').length;
    const alike = [];
    for (const info of keyInfo) { if (info.l - gl > 1 || gl - info.l > 1) continue; if (info.n !== g.k && alikeWords(info.w, gw)) alike.push(info.K); }
    if (!alike.length) continue;
    if (isMcAlias(s, G)) continue;
    const own = keyOfNorm.get(norm(G)) || '';
    const near = alike.filter((K) => !findPersonKey({ [K]: emptyPerson() }, G) && !isMcAlias(s, K));
    if (near.length !== 1) continue;
    const K = near[0];
    const kGiven = given.get(K.toLowerCase());
    if (!kGiven || kGiven.pages.size < 2) continue;
    /* what was written for G before G had a page of her own landed on K */
    const since = own && Number.isFinite(chars[own].firstSeenTurn) ? chars[own].firstSeenTurn : Infinity;
    const hers = g.entries.filter((e) => !Number.isFinite(e.b) || e.b < since);
    if (!hers.length) continue;
    /* M672: the one costly question (it asks the whole cast), last: today's rule already finds a page for it — nothing was mixed by a slip */
    if (!own && findPersonKey(chars, G)) continue;
    const his = kGiven.entries;
    const latest = (list, type, field) => { for (let i = list.length - 1; i >= 0; i -= 1) { const m = list[i].m; if (m.type === type && (!field || m.field === field) && typeof m.text === 'string' && m.text.trim()) return m.text.trim(); } return ''; };
    const page = chars[K];
    let moved = 0;
    const mine = own ? chars[own] : emptyPerson();
    for (const field of ['core', 'arc', 'state']) {
      const text = latest(hers, 'people.set', field);
      if (!text || !same(page[field], text)) continue; /* rewritten since: left where it is */
      if (!mine[field]) mine[field] = page[field];
      page[field] = latest(his, 'people.set', field);
      moved += 1;
    }
    const herEnds = hers.filter((e) => e.m.type === 'people.note' && e.m.field === 'thread' && typeof e.m.text === 'string').map((e) => e.m.text.trim());
    const hisEnds = his.filter((e) => e.m.type === 'people.note' && e.m.field === 'thread' && typeof e.m.text === 'string').map((e) => e.m.text.trim());
    if (Array.isArray(page.threads) && herEnds.length) {
      const go = page.threads.filter((t) => herEnds.some((x) => same(x, t)) && !hisEnds.some((x) => same(x, t)));
      if (go.length) { page.threads = page.threads.filter((t) => !go.includes(t)); mine.threads = [...(Array.isArray(mine.threads) ? mine.threads : []), ...go.filter((t) => !(mine.threads || []).some((x) => same(x, t)))].slice(-THREADS_MAX); moved += go.length; }
    }
    const key = own || G;
    /* what she knows */
    const know = s.knowledge && typeof s.knowledge === 'object' ? s.knowledge : (s.knowledge = {});
    const kKnow = Object.keys(know).find((n) => same(n, K));
    if (kKnow && Array.isArray(know[kKnow])) {
      const herFacts = hers.filter((e) => e.m.type === 'knowledge.add' && typeof e.m.fact === 'string').map((e) => e.m.fact);
      const hisFacts = his.filter((e) => e.m.type === 'knowledge.add' && typeof e.m.fact === 'string').map((e) => e.m.fact);
      const go = know[kKnow].filter((line) => line && herFacts.some((f) => same(f, line.fact)) && !hisFacts.some((f) => same(f, line.fact)));
      if (go.length) {
        know[kKnow] = know[kKnow].filter((line) => !go.includes(line));
        if (!know[kKnow].length) delete know[kKnow];
        const gKnow = Object.keys(know).find((n) => same(n, key)) || key;
        know[gKnow] = [...(Array.isArray(know[gKnow]) ? know[gKnow] : []), ...go.filter((line) => !(know[gKnow] || []).some((x) => x && same(x.fact, line.fact)))];
        moved += go.length;
      }
    }
    /* what is true of her */
    const canon = s.canon && typeof s.canon === 'object' ? s.canon : (s.canon = {});
    const kCanon = Object.keys(canon).find((n) => same(n, K));
    if (kCanon && canon[kCanon] && Array.isArray(canon[kCanon].facts)) {
      const herLocks = hers.filter((e) => e.m.type === 'canon.lock').map((e) => e.m);
      const hisLocks = his.filter((e) => e.m.type === 'canon.lock').map((e) => e.m);
      const go = canon[kCanon].facts.filter((f) => f && f.source !== 'canon' && herLocks.some((l) => same(l.key, f.key) && same(l.value, f.value)) && !hisLocks.some((l) => same(l.key, f.key) && same(l.value, f.value)));
      if (go.length) {
        canon[kCanon].facts = canon[kCanon].facts.filter((f) => !go.includes(f));
        if (!canon[kCanon].facts.length) delete canon[kCanon];
        const gCanon = Object.keys(canon).find((n) => same(n, key)) || key;
        if (!canon[gCanon] || !Array.isArray(canon[gCanon].facts)) canon[gCanon] = { facts: [] };
        for (const f of go) if (!canon[gCanon].facts.some((x) => x && same(x.key, f.key))) canon[gCanon].facts.push(f);
        moved += go.length;
      }
    }
    /* a wound */
    const bodies = s.bodies && typeof s.bodies === 'object' ? s.bodies : (s.bodies = {});
    const kBody = Object.keys(bodies).find((n) => same(n, K));
    if (kBody && bodies[kBody] && Array.isArray(bodies[kBody].injuries)) {
      const herWounds = hers.filter((e) => e.m.type === 'body.injure' && typeof e.m.what === 'string').map((e) => e.m.what);
      const hisWounds = his.filter((e) => e.m.type === 'body.injure' && typeof e.m.what === 'string').map((e) => e.m.what);
      const go = bodies[kBody].injuries.filter((i) => i && herWounds.some((w) => same(w, i.what)) && !hisWounds.some((w) => same(w, i.what)));
      if (go.length) {
        bodies[kBody].injuries = bodies[kBody].injuries.filter((i) => !go.includes(i));
        const gBody = Object.keys(bodies).find((n) => same(n, key)) || key;
        if (!bodies[gBody] || typeof bodies[gBody] !== 'object') bodies[gBody] = { injuries: [], strain: [] };
        if (!Array.isArray(bodies[gBody].injuries)) bodies[gBody].injuries = [];
        bodies[gBody].injuries.push(...go);
        moved += go.length;
      }
    }
    /* the seat, when the last whereabouts written was hers and still stands */
    const off = s.offscreen && typeof s.offscreen === 'object' ? s.offscreen : (s.offscreen = {});
    const kSeat = Object.keys(off).find((n) => same(n, K));
    if (kSeat && off[kSeat] && typeof off[kSeat].location === 'string') {
      const seats = [...hers.map((e) => ({ e, hers: true })), ...his.map((e) => ({ e, hers: false }))].filter((x) => x.e.m.type === 'offscreen.set' && typeof x.e.m.location === 'string').sort((a, b) => (a.e.id || 0) - (b.e.id || 0));
      const last = seats[seats.length - 1];
      if (last && last.hers && same(last.e.m.location, off[kSeat].location) && !Object.keys(off).some((n) => same(n, key))) { off[key] = off[kSeat]; delete off[kSeat]; moved += 1; }
    }
    if (!moved) continue;
    if (!own) { mine.firstSeenTurn = hers.reduce((n, e) => (Number.isFinite(e.b) ? Math.min(n, e.b) : n), Infinity); if (!Number.isFinite(mine.firstSeenTurn)) delete mine.firstSeenTurn; mine.updatedAtTurn = storyTurn(s); chars[G] = mine; }
    parted.push({ from: K, to: key, moved });
  }
  if (parted.length) Object.defineProperty(s, 'parted', { value: parted, enumerable: false, configurable: true });
  return s;
}

/* M485: THE GHOSTS ALREADY IN THE LEDGER, FOLDED ON LOAD. Before M482/M484 a relation ("Jovan's stepsister"), a role
 * ("The news drone operator") or a crowd ("the onlookers behind the taped line") could be a page of its own beside the
 * person, or beside nobody. On load: a page whose name resolves to another page is folded into it — its loose ends
 * appended, its seat kept only if the holder has none, its knowledge written in the holder's book, its standing
 * kept only if the holder has none — and let go; a crowd's page and seat go, and a faction of its name stands in its
 * place when there was none (its stance from the page's state, its move from the seat). Pure: a fresh state out. */
export function healGhosts(state) {
  const s = state && typeof state === 'object' ? state : {};
  const characters = s.characters && typeof s.characters === 'object' ? s.characters : {};
  const names = Object.keys(characters);
  if (!names.length) return s;
  const off = s.offscreen && typeof s.offscreen === 'object' ? s.offscreen : {};
  const know = s.knowledge && typeof s.knowledge === 'object' ? s.knowledge : {};
  const rels = s.relationships && typeof s.relationships === 'object' ? s.relationships : {};
  const factions = s.factions && typeof s.factions === 'object' ? s.factions : {};
  let changed = false;
  const canon = s.canon && typeof s.canon === 'object' ? s.canon : {};
  for (const k of names) {
    if (!characters[k]) continue;
    if (canon[k] || isMc(s, k)) continue; /* M490-3: a face canon knows, and the main character, are never folded */
    if (isGroupName(k)) {
      const seat = off[k];
      if (!Object.keys(factions).some((f) => samePersonName(f, k))) {
        factions[k] = { stance: (characters[k].state || characters[k].core || '').slice(0, 300), agenda: seat && seat.agenda ? String(seat.agenda) : '', move: seat && seat.activity ? String(seat.activity) : '', atTurn: Number.isFinite(characters[k].updatedAtTurn) ? characters[k].updatedAtTurn : 0 };
      }
      delete characters[k]; delete off[k]; delete know[k]; delete rels[k];
      changed = true;
      continue;
    }
    const holder = resolveDescriptor(s, k);
    if (!holder || holder === k || !characters[holder]) continue;
    const ghost = characters[k]; const real = characters[holder];
    const ends = [...(Array.isArray(real.threads) ? real.threads : [])];
    for (const t of Array.isArray(ghost.threads) ? ghost.threads : []) if (!ends.some((e) => sameLooseEnd(e, t))) ends.push(t);
    if (ends.length) real.threads = ends.slice(-THREADS_MAX); /* M559: the same room as everywhere else */
    if (!real.state && ghost.state) real.state = ghost.state;
    if (!real.arc && ghost.arc) real.arc = ghost.arc;
    if (off[k] && !off[holder]) off[holder] = off[k];
    if (Array.isArray(know[k])) { const list = Array.isArray(know[holder]) ? know[holder] : []; for (const f of know[k]) if (f && !list.some((g) => g && g.fact === f.fact)) list.push(f); know[holder] = list; }
    if (rels[k] && !rels[holder]) rels[holder] = rels[k];
    delete characters[k]; delete off[k]; delete know[k]; delete rels[k];
    changed = true;
  }
  if (changed) { s.characters = characters; s.offscreen = off; s.knowledge = know; s.relationships = rels; s.factions = factions; }
  return s;
}

const m_open = (clear, text, f) => clear === 'open' && f === 'core' && !String(text || '').trim();
export function setPersonField(state, characters, name, field, text, turn, { clear = false } = {}) {
  const cleanName = normalizeName(name);
  if (!cleanName) return { why: 'no name came with it' };
  const f = typeof field === 'string' ? field.trim().toLowerCase() : '';
  if (!['core', 'state', 'arc', 'threads'].includes(f)) {
    return { why: '“' + (f || '?') + '” isn’t a page of the ledger (core, state, arc, threads)' };
  }
  const forMc = isMc(state, cleanName);
  if (forMc && (f === 'core' || f === 'arc') && clear !== true) { /* M681 (P12): letting one go is always allowed — it should never stand */
    return { why: 'the main character’s ledger is record-only — state and threads, nothing more' };
  }
  if (isGroupName(cleanName)) return { why: '“' + cleanName + '” is a group, not a person — a faction, if anything' }; /* M484 */
  /* The persona redirect holds for the hand as it does for the scribe: a
   * page addressed to "you" is the main character's record. */
  const key = forMc ? mcKey(state) : (findPersonKey(characters, cleanName) || resolveDescriptor(state, cleanName) || cleanName); /* M482 */
  const before = characters[key] ? { ...characters[key], threads: (characters[key].threads || []).slice() } : null;
  const entry = before ? { ...before, threads: before.threads.slice() } : emptyPerson();
  const atTurn = Number.isFinite(turn) ? turn : (Number.isFinite(state && state.turn) ? state.turn : 0);
  if (!before) entry.firstSeenTurn = atTurn; /* M284: when they came into the tale */
  /* M508: A PAGE OPENED WITH NOTHING ON IT. The world agent gave everyone it seated a page (M40) with a core made of the
   * seat — "running forms; wants find Rukia; at the training ground" — a moment's whereabouts standing as who they ARE
   * for the rest of the tale: Renji stood at the rail with his card still saying he was at the Sixth's yard. A seat is
   * the seat's to say (Elsewhere, the card's now); the page is opened empty, and the scribe fills the core when the
   * page shows them. `open` never touches a page that exists. */
  if (m_open(clear, text, f)) {
    if (before) return { why: 'they have a page already', same: true };
    return { entry, key, before: null };
  }
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
  } else if (clear && (f === 'state' || f === 'arc' || f === 'core')) {
    /* M291: let go on purpose — a now that was never a now, a line that was someone else's; M508: a core made of a seat */
    if (!entry[f]) return { why: 'there was nothing written there' };
    entry[f] = '';
    if (f === 'state') delete entry.nowTurn; /* M680 */
  } else {
    const clean = cleanFieldText(text, FIELD_CAPS[f]);
    if (!clean) return { why: 'the note came in empty' };
    entry[f] = clean;
    if (f === 'state') entry.nowTurn = atTurn; /* M680: the now's own age */
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
      .slice(-THREADS_MAX); /* M559: past the room, the newest stand (the add path lets the oldest go — loading did the reverse) */
    person.updatedAtTurn = Number.isFinite(entry.updatedAtTurn) ? Math.floor(entry.updatedAtTurn) : 0;
    out[key] = person;
  }
  return out;
}

/* ---------- speaking the ledger: the tiered injection ---------- */

/* How long since the ledger last heard of them, in plain words. */
/* M541: WHEN SOMEONE WAS LAST SEEN IS WHEN THEY WERE LAST IN THE SCENE. "Last seen 8 pages ago" stood over Aurora, who had
 * stood in the room until that very page — the age counted from when her own page was last rewritten. The later of that and
 * the last time the ledger wrote her in, moved her, or wrote her out (the journal, page by page). */
/* one pass over the journal per ledger (kept while the ledger object lives): each name the room was written with → the latest
 * page it was written on — so a drawer of fifty people reads the journal once, not fifty times */
const seenByLedger = new WeakMap();
function seenPages(state) {
  if (!state || typeof state !== 'object') return new Map();
  const journal = Array.isArray(state.journal) ? state.journal : [];
  const had = seenByLedger.get(state);
  if (had && had.length === journal.length) return had.map;
  const map = new Map();
  for (const j of journal) {
    const m = j && j.m;
    if (!m || typeof m.type !== 'string' || !m.type.startsWith('presence.') || typeof m.name !== 'string' || !Number.isInteger(j.p)) continue;
    map.set(m.name, Math.max(map.get(m.name) || 0, j.p + 1));
  }
  seenByLedger.set(state, { length: journal.length, map });
  return map;
}
/* M544: the latest page someone was written INTO the scene (one pass, kept per ledger, as above) */
const enteredByLedger = new WeakMap();
export function lastEnteredTurn(state, key) {
  if (!state || typeof state !== 'object') return 0;
  const journal = Array.isArray(state.journal) ? state.journal : [];
  let had = enteredByLedger.get(state);
  if (!had || had.length !== journal.length) {
    const map = new Map();
    for (const j of journal) {
      const m = j && j.m;
      if (!m || m.type !== 'presence.enter' || typeof m.name !== 'string' || !Number.isInteger(j.p)) continue;
      map.set(m.name, Math.max(map.get(m.name) || 0, j.p + 1));
    }
    had = { length: journal.length, map };
    enteredByLedger.set(state, had);
  }
  let at = 0;
  for (const [name, turn] of had.map) if (turn > at && samePersonName(name, key)) at = turn;
  return at;
}
export function lastSeenTurn(state, key) {
  const entry = state && state.characters && typeof state.characters === 'object' ? state.characters[key] : null;
  let at = Number.isFinite(entry && entry.updatedAtTurn) ? entry.updatedAtTurn : 0;
  for (const [name, turn] of seenPages(state)) if (turn > at && samePersonName(name, key)) at = turn;
  return at;
}
/* M680 (the people audit): A NOW HAS AN AGE OF ITS OWN. Every write to a person's page refreshed its one stamp — closing a
 * loose end made a fifteen-page-old "now" read as fresh. The now is stamped when it is written (nowTurn); a ledger written
 * before M680 falls back on the page's stamp. */
export function nowTurnOf(entry) {
  if (entry && Number.isFinite(entry.nowTurn)) return entry.nowTurn;
  return Number.isFinite(entry && entry.updatedAtTurn) ? entry.updatedAtTurn : 0;
}
export const NOW_FRESH_PAGES = 2; /* M502's rule, for the storyteller too: a note on someone here older than this is not their now */
function ageWords(entry, turn) {
  return Math.max(0, (Number.isFinite(turn) ? turn : 0) - nowTurnOf(entry));
}

/* The aging law: fresh is simply "now"; past twenty turns the label admits
 * its age. */
export function stateLabel(entry, turn) {
  const ago = ageWords(entry, turn);
  if (ago > FRESH_TURNS) return 'Last noted ' + ago + ' pages ago: '; /* the final audit: pages, as every other part says */
  return 'Now: ';
}

/* M462: WHO THEY ARE, NEVER WHERE THEY ONCE STOOD, AND NEVER TWICE. A core is who someone is to the story. Some cores the
 * world agent wrote before M445 carry a moment ("Captain of the 6th Division; assembled at 1st Division HQ with the
 * available captains" — while he stands in the Tenth's courtyard; Mayuri's is a whole scene), and some still repeat the
 * series' own look that "True of them" carries in the same request (Rukia's "petite, slender, black hair, large violet
 * eyes"). On the card, a clause that is a moment goes, and a look already said by the series goes; what the story made
 * of them stays, and the page itself is never rewritten. */
const MOMENT_CLAUSE = /^(?:(?:assembled|gathered|seated|sitting|kneeling|standing|waiting|walking|gliding|pressed|leaning|pacing|lingering|hovering)\b[^;]*?\b(?:at|in|on|along|by|beside|outside|inside|toward|towards)\b|(?:at|in|on|outside|inside) the (?:corridor|hall|courtyard|gate|rail|door|doorway|room|office|road)\b)/i;
const LOOK_STOP = new Set(['the', 'and', 'with', 'his', 'her', 'their', 'a', 'an', 'of', 'in', 'wears', 'wearing', 'has', 'is']);
export function cardCore(core, lookWords = null) {
  const text = String(core || '').trim();
  if (!text) return '';
  const clauses = text.split(/;\s*/).filter((c) => c && !MOMENT_CLAUSE.test(c.trim()));
  const kept = !lookWords || !lookWords.size ? clauses : clauses.map((c) => c.split(/,\s*/).filter((item) => {
    const w = item.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter((x) => x && !LOOK_STOP.has(x));
    return !(w.length && w.length <= 4 && w.every((x) => lookWords.has(x)));
  }).join(', ')).filter((c) => c.trim());
  return (kept.length ? kept : clauses.length ? clauses : [text]).join('; ');
}
function seriesLookWords(state, name) {
  const out = new Set();
  const canon = state && state.canon && typeof state.canon === 'object' ? state.canon : {};
  for (const [k, e] of Object.entries(canon)) {
    if (!e || !Array.isArray(e.facts) || !(k === name || samePersonName(k, name))) continue;
    for (const f of e.facts) if (f && f.source === 'canon') for (const x of (String(f.key || '') + ' ' + String(f.value || '')).toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/)) if (x) out.add(x);
  }
  return out;
}

/* M524: A STANDING IS THE LEDGER'S NUMBER, NEVER A PAGE'S WORDS. A tracker a storyteller wrote on a page ("<standing>P=-12
 * (the paladin, then the arm…)") was read into the people's pages as "P=-12 (…)", while the ledger held -17 — two numbers for
 * one standing, the stale one riding in the card. A standing written as a number inside a person's page (P=, R=, S= with a
 * signed figure) is left out of what is written and of what the card says; the words beside it stay. */
const STANDING_NUMBER = /(^|[\s(\[;,])[PRS]\s*[=:]\s*[+\u2212-]?\d{1,3}\b[ \t]*/g;
export function withoutStandingNumbers(text) {
  if (text == null || typeof text !== 'string') return text;
  STANDING_NUMBER.lastIndex = 0;
  if (!STANDING_NUMBER.test(text)) return text; /* words with no such number come back exactly as they were */
  STANDING_NUMBER.lastIndex = 0;
  return text.replace(STANDING_NUMBER, '$1').replace(/\(\s*\)/g, '').replace(/[ \t]+([,.;:)])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}
function cardText(name, entry, turn, cap, here = null, lookWords = null) {
  entry = { ...entry, core: withoutStandingNumbers(entry.core), state: withoutStandingNumbers(entry.state), arc: withoutStandingNumbers(entry.arc), threads: Array.isArray(entry.threads) ? entry.threads.map(withoutStandingNumbers).filter(Boolean) : entry.threads }; /* M524 */
  const core = entry.core ? cardCore(entry.core, lookWords) : '';
  const head = name + (core ? ' — ' + core : '');
  /* M408: never a blank now for someone here — what the ledger knows for certain (where they stand in the scene) until
   * a reader writes more */
  /* M544: A NOTE FROM BEFORE THEY CAME IN IS NOT THEIR NOW. A person here whose page's now was written before they last
   * walked into the scene ("at the corner of Mariner's Lane and Larkspur, phone out" — written while she was away) is told
   * by what the ledger knows of them here, not by where they were. */
  const noteFromBefore = Boolean(here && Number.isFinite(here.enteredAt) && here.enteredAt > 0 && nowTurnOf(entry) < here.enteredAt);
  /* M680 (the people audit): ONE RULE FOR THE CARD AND THE DRAWER (M502). Someone here with a place in the room is told by
   * that place; the scribe's note rides only while it is no older than two pages — the storyteller read "Here now: Roska
   * (at the hearth, laughing at his joke)" and, in the same request, her card's "Now: slumped at the corner table, refusing
   * to look at him", fifteen pages old */
  const staleHere = Boolean(here && here.position && ageWords(entry, turn) > NOW_FRESH_PAGES);
  const now = entry.state && !noteFromBefore && !staleHere ? stateLabel(entry, turn) + entry.state : (here ? 'Now: here' + (here.position ? ' — ' + here.position : '') + '.' : '');
  let arc = entry.arc ? 'Between you: ' + entry.arc : '';
  /* M306: THE CARD SHOWED THE THREE OLDEST LOOSE ENDS, NEVER THE NEWEST. The list
   * is kept oldest first (a new one is pushed on the end, and a full list lets
   * the oldest go — M134: "never the newest"), and this took slice(0, 3): with
   * five open, the storyteller was told of the three stalest and never of the
   * two that had just come up. The newest three, newest first; the rest counted. */
  const allEnds = Array.isArray(entry.threads) ? entry.threads : [];
  const threads = allEnds.slice(-3).reverse();
  let ends = threads.length ? 'Loose ends: ' + threads.join('; ') + (allEnds.length > 3 ? ' (and ' + (allEnds.length - 3) + ' older)' : '') : '';
  /* M518: what canon says of them that lasts, kept on their page — its lines as canon's note wrote them, so the note can
   * leave out exactly what this card carries */
  let canon = Array.isArray(entry.canon) && entry.canon.length ? 'From canon:\n' + entry.canon.join('\n') : '';
  const build = () => [head, now, arc, ends, canon].filter(Boolean).join('\n');
  /* M266: WHOLE LINES, NEVER A CUT MID-SENTENCE. The card was chopped at its
   * cap wherever that fell. Now a card past its room lets go of whole lines —
   * the loose ends first, then how things stand between you; who they are and
   * where they are always ride whole. */
  if (cap && build().length > cap) ends = '';
  if (cap && build().length > cap) canon = ''; /* M518: a card past its room lets canon's lines go before how things stand between you — canon's note then keeps them */
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
  let words = whole.split(/\s+/);
  const out = [whole];
  /* M414: the name a person is spoken by is the first word AFTER any title ("Lieutenant Rukia Kuchiki" is "Rukia") —
   * the ledger's one list of titles (engine/names.js), which TITLE_WORD's own list never matched */
  while (words.length > 1 && (TITLE_WORD.test(words[0]) || isTitleWord(words[0]))) words = words.slice(1);
  if (words.length > 1 && words[0].replace(/[^\p{L}]/gu, '').length >= 3 && words.join(' ') !== whole) out.push(words.join(' '));
  if (words.length > 1 && words[0].replace(/[^\p{L}]/gu, '').length >= 3) out.push(words[0]);
  return out;
}
/* M507: one compiled pattern per name, kept — importanceOf asks it for every person on every render, and a fresh
 * RegExp each time was thousands of compilations a send (tests/perf_send.py) */
const WORD_RES = new Map();
const wordRe = (n) => {
  let re = WORD_RES.get(n);
  if (!re) {
    re = new RegExp('(^|[^\\p{L}\\p{N}_])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^\\p{L}\\p{N}_]|$)', 'iu');
    if (WORD_RES.size > 4000) WORD_RES.clear();
    WORD_RES.set(n, re);
  }
  return re;
};
function namedIn(pages, name) {
  const spoken = spokenNames(name);
  const res = spoken.map(wordRe);
  return (pages || []).some((p) => { const t = String(p || ''); const low = t.toLowerCase(); return spoken.some((n, i) => low.includes(n.toLowerCase()) && res[i].test(t)); });
}
/* M304: is this person named in a text — by their whole name or the name they
 * are spoken by ("Rias" for "Rias Gremory"), as a word of its own. One matcher
 * for every law that asks whether the writer's own material names someone. */
export function namedInText(text, name) {
  const hay = String(text || '');
  if (!hay.trim()) return false;
  return spokenNames(name).some((n) => wordRe(n).test(hay));
}

/* M282: WHO MATTERS, WITHOUT A PIN. The writer will not pin anyone, and an
 * absent person who matters was a name on the roster — their page never rode
 * unless spoken in the last three messages. Weighed in code: how strongly they
 * stand toward the main character, the threads they carry, whether the brief
 * or the cast notes name them, a truth locked about them — less a little for
 * every page they have been away. */
/* M283: the scene's own ground, in the words that name it (a family name is
 * a place's too — "the Sterling house" is where the Sterlings are). */
const PLACE_STOP = new Set(['the', 'and', 'with', 'from', 'near', 'into', 'onto', 'over', 'under', 'house', 'room', 'street', 'road', 'lane', 'side', 'front', 'back', 'inside', 'outside', 'upstairs', 'downstairs']);
export function placeWords(state) {
  const name = String((state && state.place && state.place.name) || '');
  /* the main character's own name says nothing of who is near — "Jovan's room"
   * would make everyone whose page mentions him "at the ground" */
  const mc = mcName(state);
  const mine = new Set(mc && mc !== 'the player' ? mc.toLowerCase().split(/\s+/).map((w) => w.replace(/['’]s$/, '')) : []);
  /* only the names in it — "the counter", "the kitchen" name nothing of whose ground it is */
  return [...new Set(name.split(/[^\p{L}\p{N}'’-]+/u)
    .map((w) => w.replace(/['’]s$/i, ''))
    .filter((w) => /^\p{Lu}/u.test(w) && w.replace(/[^\p{L}]/gu, '').length >= 4 && !PLACE_STOP.has(w.toLowerCase()) && !mine.has(w.toLowerCase())))];
}
/* M507: whether the writer's material names a person is asked for every person on every render (renderPeopleTiers, the
 * world agent's roster, the referee's cast) against the same brief — the answer is kept per name for as long as the
 * material is the very same string (a changed brief is a new string, and misses) */
const NAMED_IN = new Map(); /* name -> Map(material -> named): three renders pass three materials (the brief; the brief with the cast notes; …) */
function namedInMaterial(name, material) {
  let byMaterial = NAMED_IN.get(name);
  if (byMaterial && byMaterial.has(material)) return byMaterial.get(material);
  const low = material.toLowerCase(); /* a name not in the text as a substring is not in it as a word: the regex runs only where it can hit */
  const named = spokenNames(name).some((n) => low.includes(n.toLowerCase()) && wordRe(n).test(material));
  if (NAMED_IN.size > 2000) NAMED_IN.clear();
  if (!byMaterial || byMaterial.size > 8) { byMaterial = new Map(); NAMED_IN.set(name, byMaterial); }
  byMaterial.set(material, named);
  return named;
}
/* the same for "named in the latest pages": the pages are the same texts on every render of one send */
const NAMED_LATELY = new Map();
function namedLately(pages, name) {
  const list = Array.isArray(pages) ? pages : [];
  const sig = name + '|' + list.length + '|' + list.map((p) => String(p || '').length).join(',');
  if (NAMED_LATELY.has(sig)) return NAMED_LATELY.get(sig);
  const named = namedIn(list, name);
  if (NAMED_LATELY.size > 4000) NAMED_LATELY.clear();
  NAMED_LATELY.set(sig, named);
  return named;
}
export function importanceOf(state, name, briefText = '', turn = 0, scene = {}) {
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
  let score = rel ? Math.abs(rel.p || 0) + Math.abs(rel.r || 0) + Math.abs(rel.s || 0) : 0; /* what lasts: the bond, the threads, the brief, the locks */
  for (const t of (state && Array.isArray(state.threads) ? state.threads : [])) {
    if (t && same(t.owner)) score += t.heat === 'cold' ? 15 : 40;
  }
  const material = String(briefText || '');
  if (material.trim() && namedInMaterial(name, material)) score += 30;
  if (state && state.canon && typeof state.canon === 'object' && Object.keys(state.canon).some(same)) score += 20;
  const entry = state && state.characters ? state.characters[name] : null;
  /* what lasts wanes a little for every page away — never below nothing */
  const last = entry && Number.isFinite(entry.updatedAtTurn) ? entry.updatedAtTurn : turn;
  score = Math.max(0, score - Math.min(30, Math.max(0, turn - last) * 0.5));
  /* M283: WHERE THE STORY IS NOW. Someone whose page or seat is at the ground
   * the scene stands on is near the story, whatever their bond (the diner's
   * waitress, at the diner); someone the last pages keep naming is too. When
   * the main character moves on, they step back of themselves. */
  const words = Array.isArray(scene.placeWords) ? scene.placeWords : [];
  if (words.length) {
    const seatFound = seatForPerson(state, name); /* M320 */
    const seat = seatFound ? seatFound.entry : null;
    const hay = [entry && entry.core, entry && entry.state, entry && entry.arc, seat && seat.location].filter(Boolean).join(' ');
    if (hay && words.some((w) => wordRe(w).test(hay))) score += 25;
  }
  if (Array.isArray(scene.lately) && scene.lately.length && namedLately(scene.lately, name)) score += 10;
  /* M284: A NEWCOMER IS CARRIED WHILE THE STORY MAKES THEM. Someone the tale
   * has just brought in has no bond, no thread, no lock yet — and ranked last
   * in a crowded room, and was a bare name the page they left. For their first
   * pages they weigh as someone who matters. */
  if (entry && Number.isFinite(entry.firstSeenTurn) && turn - entry.firstSeenTurn <= NEWCOMER_PAGES) score += 30;
  return score; /* the scene's nearness is now, and does not wane with the absence */
}
export const IMPORTANT_AT = 20;       /* the least an absent person weighs to ride as a card */
export const NEWCOMER_PAGES = 10;     /* M284: a person new to the tale is carried this long, bond or none */
export const PRESENT_CARDS_MIN = 3;   /* the present who always keep their card, whatever the room */

/* M284: the first clause of a note, held to a length at a word — a line's
 * reminder of who someone is, never their page. */
function shortClause(text, max) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const first = firstSentence(t).replace(/[.;]$/, ''); /* M292: a title's period does not end it */
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, '') + '\u2026';
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
export function renderPeopleTiers(state, { recentPages = [], rotation = 0, view = null, brief = '', scenePages = [], seatsInState = false } = {}) {
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
  const scene = { placeWords: placeWords(state), lately: Array.isArray(scenePages) && scenePages.length ? scenePages : recentPages };
  const weigh = new Map(keys.map((k) => [k, importanceOf(state, k, brief, turn, scene)]));
  const byWeight = (a, b) => (weigh.get(b) || 0) - (weigh.get(a) || 0);

  /* Who is away, and who of them rides (worked out first: the present's share
   * is what the away do not need). M130: a recalled person who has a seat is
   * where the seat says — the scribe's older 'state' never rides beside the
   * world agent's word. M281: whoever is on their way is recalled too. */
  const offScene = keys.filter((k) => !presentKeys.includes(k) && !isMc(state, k));
  const seatOf = (k) => { const found = seatForPerson(state, k); return found ? found.entry : null; }; /* M320 */
  const named = offScene.filter((k) => namedIn(recentPages, k));
  const coming = offScene.filter((k) => !named.includes(k) && onTheWay(seatOf(k), state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null)); /* M681 (W5): never an approach that lapsed */
  const recalled = named.concat(coming).slice(0, lim.recall);
  /* M292: WHERE THE ABSENT ARE IS SAID ONCE. When the state of things lists every seat (a whole view),
   * a card or a line here does not say it again — it points there. */
  const awayNow = (k) => {
    const seat = seatOf(k);
    if (!seat) return null;
    if (isDeadSeat(seat)) return 'dead'; /* M484 */
    if (seatsInState) return 'away'; /* M416: said plainly — where, is in Elsewhere a few lines on (M292: once) */
    if (![seat.location, seat.activity].filter(Boolean).length) return null;
    /* M300: a seat says its age; M304: and a sighting says it is one — the same words every reader gets */
    return seatNowWords(seat, state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null);
  };
  /* M484: A CARD WITH NOTHING ON IT IS NOT A CARD. "Ikkaku — Now: away" told the storyteller nothing but a name; a
   * page with no core, no arc and no loose ends is the name alone on its line. */
  const bareCard = (k) => { const e = characters[k] || {}; return !e.core && !e.arc && !(Array.isArray(e.threads) && e.threads.length); };
  const awayCard = (k) => {
    const now = awayNow(k);
    if (bareCard(k)) return k + (now && now !== 'away' ? ' — ' + now : '');
    const entry = now ? { ...characters[k], state: now, updatedAtTurn: turn } : characters[k];
    return cardText(k, entry, turn, RECALL_CARD_CAP);
  };
  /* M284: with room, the roster says who each one is and where — a bare name told the storyteller nothing */
  const shortLines = lim.budget >= PEOPLE_BUDGET * 4;

  /* M286: THE PRESENT TAKE WHAT THE AWAY DO NOT NEED. They were held to 70% of
   * the room whatever the away needed — twelve in a hall with long pages on a
   * 128k room: five cards, and seven on a line that said only "stands by the
   * fire". Now the away keep what they need (the recalled, the two who matter
   * most, the roster's lines, a line for each present person without a card)
   * and the present take the rest — never less than half. */
  const recallNeed = recalled.reduce((n, k) => n + awayCard(k).length + 2, 0);
  const topAway = offScene.filter((k) => !recalled.includes(k) && (weigh.get(k) || 0) >= IMPORTANT_AT).sort(byWeight).slice(0, 2);
  const otherNeed = recallNeed + topAway.reduce((n, k) => n + awayCard(k).length + 2, 0)
    + (shortLines ? Math.min(14000, 190 * Math.min(offScene.length - recalled.length, lim.roster)) : 1500)
    + 60; /* the headings */
  /* M286: everyone here without a card still says who they are and what they are doing */
  const compactLine = (key) => {
    const e = characters[key] || {};
    const who = shortClause(e.core, 160);
    const now = shortClause(e.state, 140);
    return '- ' + key + (who ? ' \u2014 ' + who : '') + (now ? ' \u00b7 now: ' + now : '');
  };
  const lineSize = new Map(presentKeys.map((k) => [k, compactLine(k).length + 1]));
  let linesLeft = [...lineSize.values()].reduce((a, b) => a + b, 0);
  const cardKeys = [];
  let cardRoom = 0;
  for (const key of presentKeys.slice().sort(byWeight)) {
    if (!keys.includes(key) || cardKeys.length >= lim.cards) continue;
    const size = cardText(key, characters[key], turn).length + 2;
    const linesAfter = linesLeft - (lineSize.get(key) || 0);
    if (cardKeys.length >= PRESENT_CARDS_MIN) {
      /* a small room keeps its old share (what the away would need is shed there anyway); a larger
       * one gives the present every character the away and the others' lines do not need —
       * never less than half of it */
      const fits = shortLines
        ? (cardRoom + size <= lim.budget * 0.5 || cardRoom + size + linesAfter + otherNeed <= lim.budget)
        : cardRoom + size <= lim.budget * 0.7;
      if (!fits) continue;
    }
    cardKeys.push(key);
    cardRoom += size;
    linesLeft = linesAfter;
  }
  /* a page with nothing written yet rides once, as the unwritten, never also as an overflow line */
  const overflow = presentKeys.filter((k) => !cardKeys.includes(k) && keys.includes(k)).sort(byWeight);
  const unwritten = present.filter((name) => {
    const key = findPersonKey(characters, name) || name;
    return !keys.includes(key);
  });
  for (const key of cardKeys) {
    if (!keys.includes(key)) continue;
    /* M408: the scene's own entry for them (their position), for a card with no now yet */
    const hereEntry = (Array.isArray(state && state.present) ? state.present : []).find((p) => p && p.name && (findPersonKey(characters, p.name) || p.name) === key) || null;
    const here = hereEntry ? { ...hereEntry, enteredAt: lastEnteredTurn(state, key) } : null; /* M544 */
    sections.push({ shed: 0, text: cardText(key, characters[key], turn, undefined, here, seriesLookWords(state, key)) }); /* M462 */
    tiers.cards += 1;
  }
  const also = overflow.map(compactLine)
    .concat(unwritten.map((name) => '- ' + name + ' (nothing written of them yet)'));
  if (also.length) {
    sections.push({ shed: 1, text: 'Also here:\n' + also.join('\n') });
    tiers.also = also.length;
  }

  /* Tier 3: mention-recall — off the scene, but their name was spoken in
   * the last three messages (or they are on their way). */
  if (recalled.length) {
    const cards = recalled.map(awayCard);
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
    /* M284: the short lines of everyone without a card keep their room */
    const rest = offScene.filter((k) => !recalled.includes(k)).length;
    const reserve = shortLines ? Math.min(14000, 190 * Math.min(rest, lim.roster)) : 1500;
    let room = lim.budget - used - reserve;
    const pool = offScene.filter((k) => !recalled.includes(k) && (weigh.get(k) || 0) >= IMPORTANT_AT).sort(byWeight);
    const cards = [];
    /* M510-2: a view may cap this tier (a small model's scene view keeps it at none — the absent are the planning
     * helper's to weigh); a view that does not say keeps it as it was */
    const importantMax = Number.isFinite(lim.important) ? lim.important : Infinity;
    for (const k of pool) {
      if (cards.length >= importantMax) break;
      const card = awayCard(k);
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
  /* M283: THE ROSTER BY RELEVANCE, NOT BY A TURNING WHEEL. It stepped round a
   * fixed shelf a place a page — who was named had nothing to do with where the
   * story stood. Now the nearest to the story are named first, and the rest
   * are counted, not hidden. (rotation is kept in the signature, unused.) */
  void rotation;
  const rosterAll = offScene.filter((k) => !recalled.includes(k) && !important.includes(k)).sort(byWeight);
  /* M542: ONCE, NOT TWICE. In the short roster ("Elsewhere in the tale: Aurora Sterling (with us just now), …") a person the
   * world is tracking was named again beside the live line that already says where they are and what they are doing
   * ("Elsewhere: Aurora Sterling — number 10, her bedroom window, …") — the same name twice, under two "Elsewhere" headings.
   * When the seats ride in the ledger's own block, the short roster keeps only those the world is NOT tracking: the ones
   * whose name and how long they have been away are all the storyteller has of them. (The longer roster keeps everyone — its
   * line carries who they are, which the seat does not.) */
  const rosterPool = (!shortLines && seatsInState) ? rosterAll.filter((k) => !awayNow(k)) : rosterAll;
  if (rosterPool.length) {
    const shown = rosterPool.slice(0, lim.roster);
    const agoOf = (k) => {
      const ago = Math.max(0, turn - lastSeenTurn(state, k)); /* M541: last in the scene, not last rewritten */
      return ago > 0 ? 'last seen ' + ago + (ago === 1 ? ' turn' : ' turns') + ' ago' : 'with us just now';
    };
    const more = rosterPool.length - shown.length;
    const moreWords = more > 0 ? 'and ' + more + ' more the ledger knows' : '';
    if (shortLines) {
      const lines = shown.map((k) => {
        const who = shortClause(characters[k].core, 90);
        const seated = awayNow(k);
        const now = seated && isDeadSeat(seatOf(k) || {}) ? 'dead' : seated && seatsInState ? 'away' : shortClause(seated || characters[k].state, 70); /* M416; M484 */
        return '- ' + k + (who ? ' \u2014 ' + who : '') + (now ? ' \u00b7 now: ' + now : '') + ' (' + agoOf(k) + ')';
      });
      sections.push({ shed: 3, text: 'Elsewhere in the tale:\n' + lines.join('\n') + (moreWords ? '\n' + moreWords.charAt(0).toUpperCase() + moreWords.slice(1) + '.' : '') });
    } else {
      const line = shown.map((k) => k + ' (' + agoOf(k) + ')');
      sections.push({ shed: 3, text: 'Elsewhere in the tale: ' + line.join(', ') + (moreWords ? ', ' + moreWords : '') + '.' });
    }
    tiers.roster = shown.length;
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

/* M320: the seats are found by the same rule the pages are */
setSeatResolver((map, name) => findPersonKey(map, name));

/* M320: THIS PERSON'S seat — and nobody else's. A seat under another form of the name counts only when that
 * form answers to exactly this person among the people the ledger knows: with a Vanessa Reynolds and a
 * Vanessa Cole, a seat written as plain "Vanessa" is neither's in particular, and is shown as nobody's. */
export function seatForPerson(state, name) {
  const found = findSeat((state && state.offscreen) || {}, name);
  if (!found) return null;
  if (found.key.trim().toLowerCase() === String(name || '').trim().toLowerCase()) return found;
  const chars = (state && state.characters) || {};
  if (!Object.keys(chars).length) return found;
  const owner = findPersonKey(chars, found.key);
  const asked = findPersonKey(chars, name) || String(name || '').trim();
  return owner && owner.toLowerCase() === asked.toLowerCase() ? found : null;
}
