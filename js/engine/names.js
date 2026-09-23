/* Cozy Tavern — engine/names.js
 * M396: ONE ANSWER TO "IS THIS THE SAME PERSON?", FOR EVERY BOOK OF THE LEDGER.
 *
 * His Bleach story had Rukia and Suì-Fēng watching the duel in "Who's here" — and in "What's happening elsewhere" at
 * the same time, one in her office, one in her compound. The books compared names four different ways: the seat guard
 * by first and last name, the seat finder by near spelling, the state of things, the drawer and the world agent's own
 * "who is here" by EXACT lower case. "Suì-Fēng" (the name canon verification hands the workers) and "Sui-Feng" or
 * "Soi Fon" (the name on the page) were three people; the world agent was told the one standing in the scene had "NO
 * SEAT — seat them", and seated her elsewhere.
 *
 * One matcher now, used by every book that asks: letters folded (Suì-Fēng = Sui-Feng = sui feng), a first or last name
 * or a name cut short (Rukia = Rukia Kuchiki — never Rukia = Byakuya Kuchiki), and the story's own canon knowledge of
 * who answers to which names (Soi Fon = Suì-Fēng), installed by canon verification when it is on. Pure; no imports. */

/* the story's canon alias groups — [[name, alias, …], …] — or none */
let aliasSource = () => [];
/* M427: ONE STORY'S CANON NEVER SPEAKS IN ANOTHER. The bridge lends the names canon knows for the story it last entered —
 * and nothing ever took them back: after his Bleach tale, a tale with canon off still matched people by Bleach's other
 * names. The lent names are the story's own (its id rides with them) and are heard only while that story is the open
 * one (app.js tells the matcher which that is); with no story known — the harness — they are heard as before. */
let aliasStory = null;
let openStoryOf = () => null;
export function setAliasSource(fn, storyId = null) { aliasSource = typeof fn === 'function' ? fn : () => []; aliasStory = storyId || null; }
export function setAliasScope(fn) { openStoryOf = typeof fn === 'function' ? fn : () => null; }

/* a name with its letters folded: accents off, case off, punctuation to spaces */
export function foldName(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function aliased(a, b) {
  if (aliasStory) { let open = null; try { open = openStoryOf(); } catch (err) { open = null; } if (open && open !== aliasStory) return false; }
  let groups = [];
  try { groups = aliasSource() || []; } catch (err) { groups = []; }
  for (const g of Array.isArray(groups) ? groups : []) {
    const folded = (Array.isArray(g) ? g : []).map(foldName).filter(Boolean);
    if (folded.includes(a) && folded.includes(b)) return true;
  }
  return false;
}

/* Do the story's canon names make `a` and `b` one person (not by letters or first names — by canon alone)? */
export function canonAliasOf(a, b) {
  const fa = foldName(a); const fb = foldName(b);
  return Boolean(fa && fb && fa !== fb && aliased(fa, fb));
}

/* M404: a rank or a courtesy is not a name — "Lieutenant Rukia Kuchiki" is Rukia Kuchiki, "Captain Hitsugaya" is
 * Hitsugaya, "Kyōraku-san" is Kyōraku. Stripped from the front (titles) and the back (honorifics), never down to nothing.
 * M414: ONE LIST OF TITLES FOR THE WHOLE LEDGER, AND WHAT A TITLE SAYS. There were three lists (this one, the page
 * finder's and the spoken-name one) and none knew the others' words. And a title is evidence, not noise: M404 threw it
 * away, so "Captain Kuchiki" (Byakuya) and "Lieutenant Kuchiki" (Rukia) both became "Kuchiki" — one person — and so did
 * "Mr." and "Mrs. Sterling", which M272 had already ruled two people. Two titles of the SAME kind that differ (captain /
 * lieutenant, Mr / Mrs, king / prince) are two people; titles of different kinds can be one person's ("Lady Rukia" is
 * "Lieutenant Rukia Kuchiki"). Each title maps to its kind; a spelling of the same title maps to one word. */
const TITLE_KIND = {
  mr: 'civil', mrs: 'civil', ms: 'civil', miss: 'civil', mx: 'civil', madam: 'civil',
  sir: 'noble', dame: 'noble', lady: 'noble', lord: 'noble',
  king: 'royal', queen: 'royal', prince: 'royal', princess: 'royal', emperor: 'royal', empress: 'royal',
  captain: 'rank', lieutenant: 'rank', commander: 'rank', general: 'rank', colonel: 'rank', major: 'rank', sergeant: 'rank',
  officer: 'rank', detective: 'rank', agent: 'rank', head: 'rank', chief: 'rank', admiral: 'rank',
  dr: 'civil', prof: 'civil', /* a doctor is addressed as Dr. in Mr.'s place (M272: Mr. and Dr. Sterling are two) */
  aunt: 'kin', uncle: 'kin', grandma: 'kin', grandpa: 'kin',
  father: 'order', mother: 'order', sister: 'order', brother: 'order',
  coach: 'role', master: 'role', elder: 'role',
};
const TITLE_SAME = { mister: 'mr', missus: 'mrs', madame: 'madam', mme: 'madam', mlle: 'miss', doctor: 'dr', professor: 'prof', auntie: 'aunt', granny: 'grandma' };
/* own keys only: a word like "constructor" is a name, never Object.prototype's */
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);
const titleOf = (w) => { const t = own(TITLE_SAME, w) || w; return own(TITLE_KIND, t) ? t : ''; };
/* a rank said after the name, the way his Bleach pages say it ("Hitsugaya-taichō", "Kuchiki-fukutaichō") */
const TRAILING_RANK = { taicho: ['captain'], fukutaicho: ['lieutenant'], sotaicho: ['head', 'captain'] };
/* words that join a name and name nobody ("the", "of" — "The bartender", "Lord of the Keep") */
const NAME_STOP = new Set(['the', 'and', 'of', 'von', 'der', 'den', 'des', 'du', 'bin', 'ibn']);

/* M414: an apostrophe inside a word is part of the word — "O'Brien" is obrien, and "Jovan's mother" is "jovans
 * mother", never "jovan s mother": foldName (for searching TEXT) turns the apostrophe into a space, and the first-name
 * rule then read "Jovan's mother" as Jovan — while he stood in the scene she could never walk in, her elsewhere note
 * was let go after every batch, and a leave meant for her could take HIM out. For comparing NAMES only. */
function nameFold(name) {
  return foldName(String(name || '').replace(/([\p{L}\p{M}])['’‘ʼ](?=\p{L})/gu, '$1'));
}
/* a name taken apart: its words (titles and honorifics set aside, never down to nothing) and its titles.
 * M414: a courtesy or a rank AFTER the name is one only when it is joined to it the Japanese way — "Kyōraku-san",
 * "Hitsugaya-taichō". Standing on its own it is a name: Jackie Chan is not "Jackie", Li Kun is not "Li". */
const TRAILING = /[-‐‑–]\s*(san|sama|kun|chan|dono|sensei|senpai|taich[oō]u?|fukutaich[oō]u?|s[oō]taich[oō]u?)\s*$/iu;
function parseName(name) {
  let raw = String(name || '').trim();
  const titles = new Set();
  for (let m = TRAILING.exec(raw); m && raw.slice(0, m.index).trim(); m = TRAILING.exec(raw)) {
    const w = foldName(m[1]).replace(/u$/, '');
    for (const t of own(TRAILING_RANK, w) || []) titles.add(t);
    raw = raw.slice(0, m.index).trim();
  }
  let words = nameFold(raw).split(' ').filter(Boolean);
  while (words.length > 1 && titleOf(words[0])) { titles.add(titleOf(words[0])); words = words.slice(1); }
  return { words, bare: words.join(' '), titles };
}

/* Two sets of titles that say two different people: some kind of title both carry, with no title of that kind in
 * common ("Head Captain" and "Captain" share one; "Captain" and "Lieutenant" share none). */
export function titlesConflict(a, b) {
  const ta = a instanceof Set ? a : parseName(a).titles;
  const tb = b instanceof Set ? b : parseName(b).titles;
  if (!ta.size || !tb.size) return false;
  const kinds = (set) => { const m = new Map(); for (const t of set) { const k = own(TITLE_KIND, t); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(t); } return m; };
  const ka = kinds(ta);
  const kb = kinds(tb);
  for (const [kind, va] of ka) { const vb = kb.get(kind); if (vb && ![...va].some((t) => vb.has(t))) return true; }
  return false;
}
/* M418: the name itself, a rank or a courtesy set aside ("Lieutenant Rukia Kuchiki" → "rukia kuchiki"), and whether a name
 * carries one — for deciding which of one person's two pages is the fuller NAME */
export function nameCore(name) { return parseName(name).bare; }
export function hasTitle(name) { return parseName(name).titles.size > 0; }

/* is this word a title that opens a name (so never the name a person is spoken by)? */
export function isTitleWord(word) {
  return Boolean(titleOf(foldName(word)));
}

/* Is `a` the same person as `b`? The same name (folded, a rank or courtesy set aside), a first or last name of the
 * other, one cut short of the other, the same names in another order ("Kuchiki Rukia"), or two names the story's
 * canon knows as one person. Never a near miss: seating is a hard fact. Never two titles that disagree (M414). */
export function samePersonName(a, b) {
  const A = parseName(a);
  const B = parseName(b);
  const fa = A.bare;
  const fb = B.bare;
  if (!fa || !fb) return false;
  if (titlesConflict(A.titles, B.titles)) return false; /* M414: Captain Kuchiki is not Lieutenant Kuchiki */
  if (fa === fb) return true;
  const wa = A.words;
  const wb = B.words;
  if (wa.length === 1 && wb.length > 1 && (wb[0] === wa[0] || wb[wb.length - 1] === wa[0])) return true;
  if (wb.length === 1 && wa.length > 1 && (wa[0] === wb[0] || wa[wa.length - 1] === wb[0])) return true;
  if (wa.length >= 2 && wa.length === wb.length && [...wa].sort().join(' ') === [...wb].sort().join(' ')) return true; /* M404: family name first */
  if (wa.length >= 2 && wb.length >= 2) {
    /* one cut short: "Vanessa Rey" is Vanessa Reynolds (M257) */
    const [shortOne, longOne] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
    if (longOne.startsWith(shortOne) && longOne.length > shortOne.length) return true;
  }
  return aliased(foldName(a), foldName(b)) || aliased(foldName(fa), foldName(fb));
}

/* M414: IS THIS PERSON NAMED IN THIS TEXT? One answer for the four readers that ask it (the world agent's quiet ones,
 * the page reader's and the auditor's "silence is not leaving", the scribe's "one writer per now"). Each had its own
 * copy — any word of three letters or more — so a title or "the" counted as the name: "Lieutenant Rukia Kuchiki" was
 * on every page that mentioned any lieutenant (never quiet, never simulated), "The bartender" on every page there is,
 * and "Ed" or "Al" on none (no word long enough — never allowed to leave). Now: the whole name, or any word of it that
 * names someone — never a title, a courtesy, a joining word, or the owner in "Jovan's mother" (that is Jovan's word).
 * A word two people share (a family name) still counts for both: a maybe is safer than a miss here. */
export function nameOnPage(text, name) {
  const raw = String(name || '');
  const loose = ' ' + foldName(text) + ' ';                 /* "Jovan's sword" still names Jovan */
  const tight = ' ' + nameFold(text) + ' ';                 /* "O'Brien said" names O'Brien */
  if (!loose.trim()) return false;
  const has = (w) => Boolean(w) && (loose.includes(' ' + w + ' ') || tight.includes(' ' + w + ' '));
  const P = parseName(raw);
  if (has(P.bare) || has(foldName(raw))) return true;
  /* the owner's word in a possessive is not this person's name */
  const owners = new Set([...raw.matchAll(/([\p{L}\p{M}\p{N}'’‘ʼ-]+)['’‘ʼ]s(?![\p{L}])/gu)].map((m) => nameFold(m[1] + 's')));
  /* the words left once parseName has set a leading title and a courtesy aside — "mother" in "Jovan's mother" is
   * her name, the "Lieutenant" in front of Rukia's is not */
  const words = P.words.filter((w) => !owners.has(w) && !NAME_STOP.has(w));
  let distinct = words.filter((w) => w.length >= 3);
  if (!distinct.length) distinct = words.filter((w) => w.length >= 2);
  return distinct.some(has);
}

/* Every name the ledger knows a person by — pages, the scene, the seats. */
function knownNames(state) {
  const s = state && typeof state === 'object' ? state : {};
  return [
    ...Object.keys(s.characters && typeof s.characters === 'object' ? s.characters : {}),
    ...(Array.isArray(s.present) ? s.present : []).map((p) => (typeof p === 'string' ? p : p && p.name)),
    ...Object.keys(s.offscreen && typeof s.offscreen === 'object' ? s.offscreen : {}),
  ].filter((n) => typeof n === 'string' && n.trim());
}

/* Does this name mean ONE person in the whole ledger? Every name the ledger knows that answers to it must be the same
 * person — two Vanessas (or a Rukia and a Byakuya Kuchiki, for "Kuchiki") make it nobody's to decide by (M320). */
export function oneMeaning(state, name) {
  const cands = knownNames(state).filter((k) => samePersonName(k, name));
  for (let i = 0; i < cands.length; i += 1) for (let j = i + 1; j < cands.length; j += 1) if (!samePersonName(cands[i], cands[j])) return false;
  return true;
}

/* Is the person this name means standing in the scene? The same letters decide at once; any other form of the name
 * decides only when it can mean ONE person — two Vanessas in the ledger and a note under "Vanessa" is nobody's to
 * clear when one of them walks in (M320). */
export function isHere(state, name) {
  const present = (Array.isArray(state && state.present) ? state.present : []).map((p) => (typeof p === 'string' ? p : p && p.name)).filter(Boolean);
  if (!present.length || !foldName(name)) return false;
  const f = foldName(name);
  if (present.some((p) => foldName(p) === f)) return true;
  if (!oneMeaning(state, name)) return false;
  return present.some((p) => samePersonName(p, name));
}

/* Is this person among `names` (plain strings or {name})? */
export function amongNames(names, name) {
  return (Array.isArray(names) ? names : []).some((p) => samePersonName(typeof p === 'string' ? p : p && p.name, name));
}
