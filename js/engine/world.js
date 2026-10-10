/* Cozy Tavern — engine/world.js
 * M29: the world beyond the page — the ledger of what is true out of sight,
 * kept so the storyteller is handed a specific world instead of a rule that
 * says "imagine one".
 *
 * Four books, all pure (fresh copies out, never a mutation of the caller):
 *
 *   threads   — [{title, owner, heat:'hot'|'cold', next, atTurn}]
 *               someone's agenda pushing toward the main character. Two or
 *               three hot at a time is the healthy number; cold ones sleep
 *               until agendas cross again. `next` is what the owner will do.
 *   knowledge — { [name]: [{fact, atTurn}] }
 *               what each person has witnessed or been told. The 3-part
 *               trace becomes a lookup: nobody knows what happened where
 *               they were not, and the storyteller sees who knows what.
 *   factions  — { [name]: {stance, agenda, move, atTurn} }
 *               a faction moves only on cause; its stance and next move.
 *   the brief — {pressure:[], ripe:[], twb:{who, where, changed}|null,
 *               voices:[{icon, speaker, channel, content}], atTurn}
 *               the world agent's word for the next turn: what could reach
 *               this scene and when, what ripened and whom it reached, and
 *               at most one window into the world beyond. Not a ledger
 *               entry — it is judgment, replaced whole each time the agent
 *               reads, never undone. M85: `voices` is the world talking to
 *               itself — the writer's Voices Block, 2-4 lines of people the
 *               main character cannot hear — for the READER, shown under the
 *               page, never sent to the storyteller.
 *
 * Arrivals ride the offscreen ledger (engine/offscreen.js): a seat may carry
 * `stance` and `arrivesAtMinutes` on the story clock; renderArrival speaks
 * "arriving in about 15 minutes" / "due now" / "overdue" against the clock.
 */

import { samePersonName } from './names.js'; /* M420: one answer to "the same person?" for who-knows-what */
import { mcName } from './duels.js'; /* M543: the main character, by the one answer */
import { findSeat, isDeadSeat } from './offscreen.js'; /* M680: no voice from the dead (a cycle with offscreen.js: both are read only when called) */

export const THREAD_HEAT = ['hot', 'cold'];
export const STANCES = ['toward', 'seeking', 'tense', 'busy', 'waiting'];
export const STANCE_WORDS = {
  toward: 'moving toward the main character',
  seeking: 'searching for the main character',
  tense: 'unresolved tension with the main character',
  /* M416: a person living their own life (M366) — never "taken up with someone else", which told the storyteller Byakuya
   * was with somebody while he sat alone with the patrol rosters */
  busy: 'busy with their own affairs',
  waiting: 'holding — the want still stands',
};

/* M305: THE BOOKS FORGOT, AND CALLED IT A CAP. Eight threads and twelve facts a
 * person were sizes for a small prompt; in a long tale they are reached in a
 * few pages, and what fell off the end was the OLDEST — a rival's dormant
 * plan deleted by a ninth small thread, a secret learned on page 30 pushed out
 * by twelve newer trifles, after which the storyteller writes her as if she
 * never knew. A cap is a runaway guard, never a size a real story reaches
 * (M266). The ledger keeps everything; what each READER is shown is the
 * newest plus what bears on the scene (renderKnowledge), so nothing grows on
 * the wire with the length of the tale. */
const THREADS_MAX = 40;
const THREADS_RENDER = 5;
/* Sixty, not six hundred: every snapshot and every version's ledger is a WHOLE
 * copy of this (state.js keeps up to 120), so each fact kept is kept a hundred
 * times over and rides every push of the tale's book. Sixty facts a person is
 * five times the memory at about 5 KB a person a copy; what must outlast that
 * — a secret that defines how someone stands with the main character — is
 * the scribe's to write on their page (arc), which is never aged out. */
/* M579 (the audit): past the guard a person's OLDEST facts are let go — and "what they haven't found out" is read from the
 * facts others hold that they do not: a secret learned at page 10 and let go after sixty newer facts became a secret they
 * "haven't found out", told to the storyteller as such. blindSpots never claims a fact older than what a full list still
 * holds now (that person may well have known it). The guard itself stays: measured, 200 facts a person made the load's
 * own clean-up (dedupeKnowledge, on every read of the ledger) ~121 ms against ~25 ms — on a phone, seconds a page. */
export const KNOWLEDGE_GUARD = 60;    /* a person's facts, kept (was the newest 12) */
const KNOWLEDGE_RENDER = 4;           /* a small room: the newest few */
export const KNOWLEDGE_RECENT = 12;   /* a whole view: the newest shown for each person here */
export const KNOWLEDGE_RECALL = 4;    /* and at most this many OLDER facts that bear on the scene (M508: twelve a person, times twenty in a courtyard, was most of a fourteen-thousand-token block) */
const FACTIONS_RENDER = 4;
const BRIEF_LINES = 4;

function cleanText(value, cap) {
  if (typeof value !== 'string') return '';
  const clean = value.trim().replace(/\s+/g, ' ');
  if (!cap || clean.length <= cap) return clean;
  return clean.slice(0, cap - 1).trimEnd() + '…';
}

function keyOf(value) {
  return cleanText(value).toLowerCase();
}

/* ---------- threads ---------- */

function copyThreads(threads) {
  return Array.isArray(threads)
    ? threads.filter((t) => t && typeof t === 'object' && typeof t.title === 'string').map((t) => ({ ...t }))
    : [];
}

export function findThread(threads, title) {
  const wanted = keyOf(title);
  if (!wanted) return -1;
  const list = Array.isArray(threads) ? threads : [];
  const exact = list.findIndex((t) => t && typeof t.title === 'string' && keyOf(t.title) === wanted);
  if (exact !== -1) return exact;
  /* M259: A THREAD IS FOUND BY SENSE, as a loose end is (M241). A worker
   * closing "Chloe's clip of Jovan" when the ledger holds "Chloe's clip of
   * Jovan at the Wells house" was refused ("no thread called …"), the thread
   * stayed open, and the auditor found it again the next turn — while a
   * thread.set under reworded words opened a SECOND copy. Only when exactly
   * one thread answers; two that both do match neither. */
  const hits = [];
  list.forEach((t, i) => { if (t && typeof t.title === 'string' && sameThreadTitle(t.title, title)) hits.push(i); });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    /* M653: several answer. One that says it in the very same words is the one. Failing that, if they are all each
     * other's twins (copies of one thread made before this was mended), the oldest is the thread — moved, not copied
     * again. Threads that are NOT each other's twins ("…the letter from the bank", "…the letter from Claire") both
     * answering a shorter title match neither, as before. */
    const same = (a, b) => { const x = titleWords(a).all; const y = titleWords(b).all; return x.size === y.size && [...x].every((w) => y.has(w)); };
    const very = hits.filter((i) => same(list[i].title, title));
    if (very.length === 1) return very[0];
    if (hits.every((i) => hits.every((j) => i === j || sameThreadTitle(list[i].title, list[j].title)))) return hits[0];
  }
  return -1;
}

const THREAD_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'his', 'her', 'hers', 'their', 'about', 'into', 'over', 'will', 'what', 'who', 'was', 'are', 'has', 'have', 'had', 'its', 'not', 'but', 'out', 'off', 'onto', 'upon', 'after', 'before', 'him', 'she', 'they', 'them']);
/* The telling words of a title, and which of them are common words (written
 * lower-case) rather than names. */
function titleWords(t) {
  const all = new Set();
  const common = new Set();
  const tokens = String(t || '')
    .replace(/[‘’´`]/g, "'")
    .replace(/'s\b/gi, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/);
  for (const raw of tokens) {
    const low = raw.toLowerCase();
    if (low.length <= 2 || THREAD_STOP.has(low)) continue;
    /* M653 (the ledger audit, part ten — one thread sent to the door ten ways): A WORD IS ITS STEM. "Tom's promise to fix
     * the roof" and "Tom promised to fix the roof" were two threads — "promise" is not "promised" letter for letter —
     * and once there were two, every later wording answered to both, "two that both do match neither", and opened
     * another: four open threads for one promise, read to the storyteller as four. */
    let w = low;
    if (w.length > 4) w = w.replace(/(?:ing|ed|es|s)$/, '');
    if (w.length > 4) w = w.replace(/e$/, '');
    all.add(w);
    if (raw[0] === raw[0].toLowerCase()) common.add(w);
  }
  return { all, common };
}
/* Two thread titles that say the same thing: EVERY telling word of the
 * shorter is in the longer, and the shorter has at least two. A share of the
 * words is not enough — "Claire Stone" and "Alaric Stone" share a word, and
 * "Rias and Jovan's dinner" is not "Rias wants Jovan's number". A title of
 * names alone ("Rias and Jovan") says only who — it is the same thread only
 * as the very same names, never every longer thread those two are in. */
export function sameThreadTitle(a, b) {
  const x = titleWords(a); const y = titleWords(b);
  const [short, long] = x.all.size <= y.all.size ? [x, y] : [y, x];
  if (short.all.size < 2) return false;
  for (const w of short.all) if (!long.all.has(w)) return false;
  if (!short.common.size) return short.all.size === long.all.size;
  return true;
}

/* Set (or update) a thread. A title already there is updated in place —
 * fields given replace, fields omitted keep. Hot threads are capped: past
 * THREADS_MAX the coldest, oldest thread is let go. */
/* M261: A THREAD THE STORY STOPPED CARRYING COOLS BY ITSELF. The mutations
 * that cool every hot thread untouched for THREAD_COOL_PAGES pages — never one
 * whose title answers to `spared` (the threads this very page moves). */
export const THREAD_COOL_PAGES = 15;
export function threadHousekeeping(threads, nowTurn, spared = []) {
  const list = Array.isArray(threads) ? threads : [];
  if (!Number.isFinite(nowTurn)) return [];
  const keep = (Array.isArray(spared) ? spared : []).filter((t) => typeof t === 'string' && t.trim());
  const out = [];
  for (const t of list) {
    if (!t || typeof t !== 'object' || typeof t.title !== 'string' || t.heat === 'cold') continue;
    if (!Number.isFinite(t.atTurn) || nowTurn - t.atTurn < THREAD_COOL_PAGES) continue;
    if (keep.some((k) => keyOf(k) === keyOf(t.title) || sameThreadTitle(k, t.title))) continue;
    out.push({ type: 'thread.set', title: t.title, heat: 'cold' });
  }
  return out;
}

/* M368: a thread may run between ANY two people — Caleb and the quarterback's job, two sisters and their mother's house —
 * not only toward the main character. `with` names the other party when there is one. And when the ledger must let a
 * thread go, it lets go of one that does not touch the main character first: a crowd of other people's business never
 * pushes his own threads out. */
export function threadTouches(t, names = []) {
  const said = [t && t.title, t && t.owner, t && t.with, t && t.next].filter(Boolean).join(' ').toLowerCase();
  return names.filter(Boolean).some((n) => {
    const words = String(n).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    return words.some((w) => new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])').test(said));
  });
}
export function setThread(threads, { title, owner, heat, next, with: other } = {}, atTurn, { mc = '' } = {}) {
  const list = copyThreads(threads);
  const name = undoubled(cleanText(title, 300));
  if (!name) return list;
  const at = findThread(list, name);
  const base = at === -1 ? { title: name } : list[at];
  const entry = { ...base };
  if (cleanText(owner)) entry.owner = cleanText(owner, 120);
  if (cleanText(other)) entry.with = cleanText(other, 120); /* M368 */
  if (THREAD_HEAT.includes(heat)) entry.heat = heat;
  if (!entry.heat) entry.heat = 'hot';
  if (cleanText(next)) entry.next = undoubled(cleanText(next, 1000));
  entry.atTurn = Number.isFinite(atTurn) ? atTurn : (entry.atTurn ?? null);
  if (at === -1) list.push(entry); else list[at] = entry;
  while (list.length > THREADS_MAX) {
    let worst = 0;
    /* M368: his own threads are let go last — then cold before hot, then oldest */
    const rank = (t) => (mc && threadTouches(t, [mc]) ? 1 : 0) * 1e12 + (t.heat === 'cold' ? 0 : 1) * 1e9 + (Number.isFinite(t.atTurn) ? t.atTurn : -1);
    for (let i = 1; i < list.length; i += 1) if (rank(list[i]) < rank(list[worst])) worst = i;
    list.splice(worst, 1);
  }
  return list;
}

export function closeThread(threads, title) {
  const list = copyThreads(threads);
  const at = findThread(list, title);
  if (at !== -1) list.splice(at, 1);
  return list;
}

/* M368: the storyteller is shown the threads that touch THIS scene first — someone in it, or the main character — then
 * the hot, then the recent; other people's business away from the page stays in the ledger (the world agent reads all of
 * it) and never crowds the storyteller's few lines. */
/* M416: one wording for someone who has not found something out — the anchor reads the lines by it (assemble/anchor.js) */
export const BLIND_LINE = ' hasn’t found out: ';

/* M416: WHAT THE OWNER WILL DO, SAID THE WAY IT READS. "Rukia Kuchiki means to " + next is right for "corner him before
 * Renji leaves" and broken for "she tests whether Oda deserves it" ("means to she tests…") — a next written as a whole
 * sentence (a subject, a will) is said as what comes next instead. One wording for every reader (whole.js too). */
export function threadNextWords(owner, next) {
  const n = String(next == null ? '' : next).replace(/\s+/g, ' ').trim().replace(/\.+$/, '').replace(/^to\s+/i, '');
  if (!n) return '';
  if (!String(owner || '').trim()) return ' — next: ' + n;
  const first = n.split(' ')[0].toLowerCase().replace(/[^\p{L}']/gu, '');
  const ownWords = String(owner).toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 2);
  const sentence = /^(she|he|they|it|i|we|you|the|a|an|his|her|their|its|our|my|your|this|that|these|those|someone|somebody|nobody|everyone|everybody)$/.test(first)
    || ownWords.includes(first) || /^(will|would|is|are|was|were|has|have|had|plans|wants|intends|hopes)$/.test(first)
    || /\b(will|is going to|are going to)\b/i.test(n.split(' ').slice(0, 4).join(' '));
  /* a plan written as a sentence of its own ("Watch the new captain") reads on after "means to" in small letters */
  return sentence ? ' — next: ' + n : ' means to ' + (/^\p{Lu}\p{Ll}/u.test(n) ? n[0].toLowerCase() + n.slice(1) : n);
}

export function renderThreads(threads, top = THREADS_RENDER, scene = null) {
  const list = copyThreads(threads);
  if (!list.length) return '';
  const names = scene && Array.isArray(scene.names) ? scene.names : [];
  const near = (t) => (names.length && threadTouches(t, names) ? 0 : 1);
  const rank = (t) => (t.heat === 'cold' ? 1 : 0);
  list.sort((a, b) => near(a) - near(b) || rank(a) - rank(b) || (b.atTurn ?? -1) - (a.atTurn ?? -1));
  /* M509: two threads with the very same next move ("take custody of both the paper and the boy" under two titles)
   * ride once — the first by rank; the other still stands in the ledger */
  const seenNext = new Set();
  const once = list.filter((t) => { const key = String(t.next || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); if (!key) return true; if (seenNext.has(key)) return false; seenNext.add(key); return true; });
  return once.slice(0, top).map((t) => {
    let line = (t.heat === 'cold' ? '(cold) ' : '') + t.title;
    if (t.owner) line += ' — ' + t.owner + (t.with ? ' (with ' + t.with + ')' : '');
    if (t.next) line += threadNextWords(t.owner, t.next); /* M416 */
    return line;
  }).join('\n');
}

/* ---------- knowledge ---------- */

function copyKnowledge(knowledge) {
  const safe = knowledge && typeof knowledge === 'object' ? knowledge : {};
  const out = {};
  for (const [name, list] of Object.entries(safe)) {
    if (!Array.isArray(list)) continue;
    out[name] = list.filter((k) => k && typeof k.fact === 'string').map((k) => ({ ...k }));
  }
  return out;
}

/* M239: THE SAME NAME, TWICE, IN THE TWO LEDGERS THAT CAN LEAST AFFORD IT.
 * findKnowledgeKey and findFactionKey matched an EXACT key and nothing else —
 * no spelling tolerance, no short name — while the people ledger had at least
 * near-spelling matching (and, since M238, first and last names). So
 * "Vanessa" and "Vanessa Reynolds" became TWO RECORDS OF WHO KNOWS WHAT: the
 * storyteller told that she does not know the thing she was told on the page
 * before. The same for a faction under two names. Knowledge is the one
 * ledger where a split is invisible AND changes what characters say.
 * The rule is the people ledger's: an exact key, then a near spelling, then a
 * name that is the FIRST or LAST word of exactly one key — and ambiguity
 * matches nothing, because guessing between two is the worse failure. */
export function nearKey(keys, name) {
  const wanted = keyOf(name);
  if (!wanted) return null;
  const list = Array.isArray(keys) ? keys : [];
  const exact = list.find((k) => keyOf(k) === wanted);
  if (exact) return exact;

  const words = String(wanted).split(/\s+/).filter(Boolean);
  const partOf = (k) => {
    const kw = keyOf(k).split(/\s+/).filter(Boolean);
    return kw.length > 1 && (kw[0] === wanted || kw[kw.length - 1] === wanted);
  };
  const byPart = list.filter(partOf);
  if (byPart.length === 1) return byPart[0];

  if (words.length > 1) {
    const byWhole = list.filter((k) => {
      const kk = keyOf(k);
      return kk === words[0] || kk === words[words.length - 1];
    });
    if (byWhole.length === 1) return byWhole[0];
  }

  /* M239: and a name that sits INSIDE a longer one — "Vanderbilt" in "the
   * Vanderbilt family", which no first-or-last rule reaches. A whole word,
   * never a fragment, and still only when exactly one key answers to it: "the
   * Wells family" beside "the Wells council" matches neither. */
  const anyWord = list.filter((k) => keyOf(k).split(/\s+/).filter(Boolean).includes(wanted));
  if (anyWord.length === 1) return anyWord[0];
  if (words.length > 1) {
    const mine = new Set(words);
    const shared = list.filter((k) => keyOf(k).split(/\s+/).filter(Boolean).some((w) => w.length > 3 && mine.has(w)));
    if (shared.length === 1) return shared[0];
  }
  return null;
}

export function findKnowledgeKey(knowledge, name) {
  const wanted = keyOf(name);
  if (!wanted) return null;
  const safe = knowledge && typeof knowledge === 'object' ? knowledge : {};
  const near = nearKey(Object.keys(safe), name);
  /* M459: A LOOSE MATCH IS HELD TO THE ONE MATCHER. nearKey's last rule takes any shared word — so "Byakuya Kuchiki", with
   * no book of his own, was found in RUKIA's: his facts written into hers, and her whole block drawn a second time for
   * him in Who knows what. Two given names are two people. */
  const given = (n) => keyOf(n).replace(/^the\s+/, '').split(/\s+/).filter(Boolean);
  const wantWords = given(name);
  const nearWords = near ? given(near) : [];
  const twoPeople = wantWords.length > 1 && nearWords.length > 1 && wantWords[0] !== nearWords[0] && !samePersonName(near, name);
  if (near && !twoPeople) return near;
  /* M420: AND THE ONE MATCHER (engine/names.js). With "Suì-Fēng" in the scene and her knowledge under "Sui-Feng", her
   * own facts were missing from Who knows what — and the notes told the storyteller she "hasn’t found out" her own
   * secret ("Sui-Feng knows"), as if they were two people. Folded letters, a rank, canon's other name — when exactly
   * one entry answers. */
  const same = Object.keys(safe).filter((k) => samePersonName(k, name));
  return same.length === 1 ? same[0] : null;
}

/* Add one fact to one person. The same fact twice (case-insensitive) is a
 * no-op that returns the same copy; the list keeps everything, up to the
 * runaway guard (M305). */
/* M681 — A FULL BOOK KEEPS ITS SECRETS (the books audit's B9, made to happen on m680-001): past the guard a person's OLDEST
 * fact was let go, whatever it was — a secret only she held, learned on page 10, went to make room for the sixtieth
 * trifle the whole room had seen, and nobody in the ledger knew it any more. What someone else also holds is let go first
 * (the oldest of those); a fact nobody else holds goes only when the book holds nothing else. blindSpots reads its horizon
 * the same way (it claims nothing older than the oldest fact a full book still SHARES). Never the newest. */
export function trimmedBook(list, all, key, cap = KNOWLEDGE_GUARD) {
  const book = Array.isArray(list) ? list : [];
  if (book.length <= cap) return book;
  const others = Object.entries(all && typeof all === 'object' ? all : {}).filter(([o, l]) => o !== key && Array.isArray(l));
  const heldElsewhere = (k) => Boolean(k && typeof k.fact === 'string') && others.some(([, l]) => l.some((x) => x && typeof x.fact === 'string' && sameFact(x.fact, k.fact)));
  const out = book.slice();
  for (let i = 0; out.length > cap && i < out.length - 1;) { if (heldElsewhere(out[i])) out.splice(i, 1); else i += 1; }
  return out.length > cap ? out.slice(-cap) : out;
}
export function addKnowledge(knowledge, name, fact, atTurn) {
  const next = copyKnowledge(knowledge);
  const who = cleanText(name, 120);
  const what = cleanText(fact, 1000);
  if (!who || !what) return next;
  const key = findKnowledgeKey(next, who) || who;
  const list = next[key] || [];
  /* M484: ONE WORDING FOR ONE FACT, HOUSE-WIDE. A fact someone else already holds is written for this person in
   * THOSE words — so the briefing can say "Everyone here but X knows: …" once instead of the same moment nine times
   * in nine paraphrases. */
  /* the same moment: learned on the same page or the one beside it — a paraphrase is one moment in other words */
  const near = (t) => Number.isFinite(t) && Number.isFinite(atTurn) && Math.abs(t - atTurn) <= 1;
  let canon = what;
  for (const [other, theirs] of Object.entries(next)) {
    if (other === key || !Array.isArray(theirs)) continue;
    const held = theirs.find((k) => k && (sameFact(k.fact, what) || (near(k.atTurn) && sameFact(k.fact, what, { fuzzy: true }))));
    /* M522: THE LONGER STAYS, HOUSE-WIDE TOO. A wording someone else holds is taken only when it says at least as much —
     * never to shrink a fuller line back to an older, shorter one. The auditor setting a shared line right ("…a place at his
     * side" → "…a place at his side if they kneel and give up the paladin") had its correction turned back into the old
     * words for each person in turn, because the others still held them; the whole party kept the wrong line. */
    if (held && !(factKey(what).length > factKey(held.fact).length && factKey(what).includes(factKey(held.fact)))) { canon = held.fact; break; }
  }
  /* M92: the same fact in different clothes is the same fact — quotes and
   * apostrophes normalized, punctuation gone, one fact wholly inside another
   * (the shorter a prefix or a clipping of the longer) — the longer stays */
  /* within one person: the paraphrase fold only for a line from the page BESIDE this one — two lines the reader wrote
   * for one person on one page are two facts on purpose */
  const dup = list.findIndex((k) => sameFact(k.fact, canon) || (Number.isFinite(k.atTurn) && Number.isFinite(atTurn) && Math.abs(k.atTurn - atTurn) === 1 && sameFact(k.fact, canon, { fuzzy: true })));
  if (dup !== -1) {
    if (canon === what && what.length > list[dup].fact.length) list[dup] = { ...list[dup], fact: what };
    next[key] = list;
    return next;
  }
  list.push({ fact: canon, atTurn: Number.isFinite(atTurn) ? atTurn : null });
  next[key] = trimmedBook(list, next, key); /* M681: a full book lets go of what others also know first */
  return next;
}

/* M272: a line the model broke off mid-phrase. Only endings no finished
 * clause has: an article, a joining word, or an infinitive with no verb
 * ("means to"). A sentence may end on "to", "in" or "with" ("the party she
 * wants to go to", "whether to move in") — those stand. */
const BROKEN_OFF = /\b(?:the|a|an|and|or|but|because|whose|than|(?:means|meant|wants|wanted|plans|planned|going|has|have|had|tries|tried|needs|hopes|intends|about|is|are|was|were|am) to)\s*[,;:—–-]?\s*$/i;
export function brokenOff(text) {
  return BROKEN_OFF.test(String(text || '').trim());
}
/* M272: a name written twice running is written once — "Alexia Alexia's
 * rematch", "Alexia Vanderbilt Alexia Vanderbilt plans". A single word said
 * twice with no possessive after it is left alone ("Bora Bora"). */
export function undoubled(text) {
  let out = String(text || '');
  for (let pass = 0; pass < 3; pass += 1) {
    const next = out
      .replace(/\b([A-Z][\p{L}-]*)\s+\1(?=['’]s\b)/gu, '$1')
      .replace(/\b([A-Z][\p{L}-]*(?:\s+[A-Z][\p{L}-]*){1,2})\s+\1\b/gu, '$1');
    if (next === out) break;
    out = next;
  }
  return out;
}

/* M507: a fact's key and its words are remembered by the fact's own text — sameFact asks for them thousands of times a
 * render (every fact against every fact of every person in the room) */
const FACT_KEYS = new Map();
export function factKey(f) {
  const text = String(f || '');
  const hit = FACT_KEYS.get(text);
  if (hit !== undefined) return hit;
  const out = text.toLowerCase().replace(/[‘’´`]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= 600) { if (FACT_KEYS.size > 20000) FACT_KEYS.clear(); FACT_KEYS.set(text, out); }
  return out;
}
/* M490-3: the paraphrase fold is OPT-IN ({ fuzzy: true }) and only for the same moment. As the default it merged
 * "…told Jovan about the cult…" with "…about the owls…" (a fact lost), and knowledge.forget — which asks sameFact what
 * to erase — would have erased the other fact too. M92's rule (the same words, or one inside the other) is the default. */
export function sameFact(a, b, { fuzzy = false } = {}) {
  const x = factKey(a); const y = factKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 24 && long.includes(short)) return true;
  if (!fuzzy) return false;
  /* M484: THE SAME FACT IN OTHER WORDS. The page reader wrote "Jovan's red-glowing punch drove Zaraki three yards
   * through the sand" one page and "observed the force of Jovan's red punch leave Zaraki's body and the skid furrows
   * run three yards" the next, and both stood, and the storyteller read one moment three times. Two facts sharing
   * most of their content words are one fact: six of ten of the shorter one's words in the longer, or five words
   * shared and half; the longer wording stays. Two facts that merely share a subject ("Jovan", "the courtyard") do
   * not reach it. */
  const ws = keyWords(x); const wl = keyWords(y); /* M509-6: remembered per key */
  if (ws.size < 4 || wl.size < 4) return false;
  /* what tells two near facts apart — a number, a name (a capitalised word inside the sentence) — must agree: "told
   * Vivi" is not "told Claire", "fact 1" is not "fact 2" */
  const nums = factNums; const names = factNames; /* M509-6: remembered per text */
  const na = nums(a); const nb = nums(b);
  for (const n of na) if (!nb.has(n)) return false;
  for (const n of nb) if (!na.has(n)) return false;
  /* the names one carries must all be in the other ("her" against "Rukia Kuchiki" is the same girl; "Vivi" against
   * "Claire" is two) */
  const pa = names(a); const pb = names(b);
  const within = (s, t) => [...s].every((n) => t.has(n));
  if (!within(pa, pb) && !within(pb, pa)) return false;
  let hit = 0;
  for (const s of ws) if (wl.has(s)) hit += 1;
  const small = Math.min(ws.size, wl.size);
  return hit / small >= 0.6 || (hit >= 5 && hit / small >= 0.5);
}
/* M92: an existing book of knowledge with its duplicates folded — run on load,
 * so a store that gathered them before this law is clean the next time it is
 * read; no mutation, nothing for an auditor to note. */
export function dedupeKnowledge(knowledge) {
  const safe = copyKnowledge(knowledge);
  for (const [name, list] of Object.entries(safe)) {
    const kept = [];
    for (const k of list) {
      const at = kept.findIndex((x) => sameFact(x.fact, k.fact) || (Number.isFinite(x.atTurn) && Number.isFinite(k.atTurn) && Math.abs(x.atTurn - k.atTurn) === 1 && sameFact(x.fact, k.fact, { fuzzy: true })));
      if (at === -1) kept.push({ ...k });
      else if (k.fact.length > kept[at].fact.length) kept[at] = { ...kept[at], fact: k.fact };
    }
    safe[name] = kept;
  }
  return safe;
}

/* What the present know — newest facts first, a few each. `present` is
 * state.present ([{name}] — plain strings tolerated). Omit anyone with
 * nothing written. */
/* M305: the words of the scene — what the last pages are about — for calling
 * back an OLDER fact that bears on them. Content words only; `ignore` holds
 * names that are in every fact (the main character's, the knower's own). */
const SCENE_STOP = new Set(('about above after again against almost along already also although always among another around because been before behind being below between both could does doing down during each either else enough even ever every from further have having here herself himself into itself just more most much must myself never next none nothing once only other ours over same shall should since some such than that their theirs them then there these they this those though through thus together under until upon very were what when where which while whom whose will with within without would your yours yourself said says like back still went come came them looked look looks took take takes made make makes knew know knows thing things something anything where').split(' '));
export function sceneWordsOf(pages) {
  const out = new Set();
  for (const p of (Array.isArray(pages) ? pages : [])) {
    for (const w of String(p || '').toLowerCase().split(/[^\p{L}\p{N}'’-]+/u)) {
      const word = w.replace(/['’]s$/, '').replace(/^['’-]+|['’-]+$/g, '');
      if (word.length >= 4 && !SCENE_STOP.has(word)) out.add(word);
    }
  }
  return out;
}
function factScore(fact, sceneWords, ignore) {
  let score = 0;
  const seen = new Set();
  for (const w of String(fact || '').toLowerCase().split(/[^\p{L}\p{N}'’-]+/u)) {
    const word = w.replace(/['’]s$/, '').replace(/^['’-]+|['’-]+$/g, '');
    if (word.length < 4 || seen.has(word) || ignore.has(word) || SCENE_STOP.has(word)) continue;
    seen.add(word);
    if (sceneWords.has(word)) score += 1;
  }
  return score;
}

/* M305: the newest `per` for each person here, and — since the ledger now keeps
 * what it used to forget — the OLDER facts that bear on the scene the last
 * pages are telling (two content words in common, the main character's and
 * the knower's own names aside), the most telling first; what is left is
 * COUNTED, never silently dropped. `scene` = { pages, ignore:[names] }. */
export const KNOWLEDGE_OLD_AFTER = 6; /* pages: older than this, a fact says its age */
export const KNOWLEDGE_MC = 4;        /* M508: the main character's newest few */
export function renderKnowledge(knowledge, present, per = KNOWLEDGE_RENDER, scene = null, out = null) {
  const safe = copyKnowledge(knowledge);
  const names = (Array.isArray(present) ? present : [])
    .map((p) => (typeof p === 'string' ? p : p && p.name))
    .filter((n) => typeof n === 'string' && n.trim());
  const recent = Number.isFinite(per) ? per : KNOWLEDGE_RECENT;
  const recallMax = Number.isFinite(per) ? Math.min(2, per) : KNOWLEDGE_RECALL;
  const sceneWords = scene && Array.isArray(scene.pages) && scene.pages.length ? sceneWordsOf(scene.pages) : null;
  /* M336: A FACT SAYS WHEN IT WAS LEARNED. The writer's teller read "Rias called the twelve-minute walk a six-to-ten-minute
   * intercept window and said the town would ambush him if he walked" — true, and ten scenes old, about ANOTHER
   * walk — under M305's own words "From earlier, bearing on this:", and built the present scene on it ("she offered
   * to drive him to Aurora's… maybe jokingly"): something that never happened. A match of two words is not
   * "bearing on this", and a fact with no date reads as now. Every fact older than a few pages says how old it is,
   * and what is called back from long ago is handed over as what it is: about its own moment. */
  const nowTurn = scene && Number.isFinite(scene.turn) ? scene.turn : null;
  const aged = (k) => {
    const fact = k.fact.replace(/\.+$/, '');
    const age = nowTurn != null && Number.isFinite(k.atTurn) ? nowTurn - k.atTurn : 0;
    return age >= KNOWLEDGE_OLD_AFTER ? fact + ' (learned about ' + age + ' pages ago)' : fact;
  };
  const ignoreBase = new Set();
  for (const n of (scene && Array.isArray(scene.ignore) ? scene.ignore : [])) for (const w of String(n || '').toLowerCase().split(/\s+/)) if (w) ignoreBase.add(w.replace(/['’]s$/, ''));
  /* M509: A WORD IN MOST FACTS TELLS NOTHING. In a courtyard fifty pages long, "courtyard", "captain", "Tenth" and
   * "Zaraki" are in nearly every fact and every page — on them a 46-page-old report was "bearing on the scene". A word
   * found in more than a quarter of the books' facts is set aside for the recall (M336's two telling words stand). */
  const df = new Map(); let factCount = 0;
  for (const list of Object.values(safe)) for (const k of (Array.isArray(list) ? list : [])) {
    factCount += 1;
    const seen = new Set();
    for (const w of String(k && k.fact || '').toLowerCase().split(/[^\p{L}\p{N}'’-]+/u)) { const word = w.replace(/['’]s$/, '').replace(/^['’-]+|['’-]+$/g, ''); if (word.length >= 4 && !seen.has(word)) { seen.add(word); df.set(word, (df.get(word) || 0) + 1); } }
  }
  if (factCount >= 20) for (const [w, n] of df) if (n > factCount * 0.25) ignoreBase.add(w);
  const lines = [];
  const drawn = new Set(); /* M459: a book is drawn once, whoever else answers to it */
  const picked = [];
  /* M508: THE MAIN CHARACTER'S BOOK IS THE WRITER'S. His list was the longest on the page (the reader writes what he
   * is told), and when the reader left a public moment out of it he stood in every "Everyone here but Jovan …" as
   * someone who had not seen what happened in front of him. His newest few ride, nothing older is called back, and
   * his book never counts in what is shared or what he is "but". */
  const mc = scene && typeof scene.mc === 'string' && scene.mc.trim() ? scene.mc.trim() : (scene && Array.isArray(scene.ignore) && typeof scene.ignore[0] === 'string' ? scene.ignore[0].trim() : ''); /* the main character: named, or the first name every fact is asked to ignore */
  const isMcKey = (key) => Boolean(mc) && (key.trim().toLowerCase() === mc.toLowerCase() || samePersonName(key, mc));
  for (const name of names) {
    const key = findKnowledgeKey(safe, name);
    if (!key || !safe[key].length || drawn.has(key)) continue;
    drawn.add(key);
    /* M509-2: NEWEST BY THE PAGE IT WAS LEARNED ON. The list is in order of writing, and a 46-page-old fact written into a
     * book late (the auditor's hand, a merge) sat among the "newest" while it carried its true age. Facts with a page
     * stamp order by it; those without keep their place at the front. */
    const list = sameFactsOnce(safe[key]).map((k, i) => ({ k, i })).sort((a, b) => ((Number.isFinite(a.k.atTurn) ? a.k.atTurn : -1) - (Number.isFinite(b.k.atTurn) ? b.k.atTurn : -1)) || (a.i - b.i)).map((x) => x.k);
    const mine = isMcKey(key);
    const take = mine ? Math.min(recent, KNOWLEDGE_MC) : recent;
    const newest = list.slice(-take).reverse().map(aged);
    const older = list.slice(0, Math.max(0, list.length - take));
    let recalled = [];
    if (!mine && older.length && sceneWords && sceneWords.size) {
      const ignore = new Set(ignoreBase);
      for (const w of key.toLowerCase().split(/\s+/)) if (w) ignore.add(w);
      recalled = older
        .map((k, i) => ({ k, i, score: factScore(k.fact, sceneWords, ignore) }))
        .filter((x) => x.score >= 2)
        .sort((a, b) => (b.score - a.score) || (b.i - a.i))
        .slice(0, recallMax)
        .map((x) => aged(x.k));
    }
    const rest = older.length - recalled.length;
    const turns = new Map(); /* M509-15: the page each rendered line was learned on */
    for (const k of list) { const line = aged(k); if (!turns.has(line) && Number.isFinite(k.atTurn)) turns.set(line, k.atTurn); }
    picked.push({ key, newest, recalled, rest, mc: mine, turns });
  }
  /* M459: WHAT MANY HERE KNOW IS SAID ONCE. One sword stopped an inch from Zaraki's face in front of the whole courtyard,
   * and the notes said so thirteen times, a line for each witness. A fact three or more people here share rides once,
   * with who knows it; each person's line keeps what is theirs. */
  const norm = (f) => f.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const holders = new Map();
  const others = picked.filter((p) => !p.mc); /* M508: the sharing is among everyone here but the main character */
  for (const p of others) for (const f of [...p.newest, ...p.recalled]) { const k = norm(f); if (!holders.has(k)) holders.set(k, { text: f, who: [], atTurn: p.turns && p.turns.get(f) != null ? p.turns.get(f) : null }); if (!holders.get(k).who.includes(p.key)) holders.get(k).who.push(p.key); }
  /* M509-15: a public moment counts everyone who was in the room among its knowers — the reader wrote it into one book,
   * the whole courtyard saw it — so it is a shared line, not one witness's, and nobody's blind spot who was there */
  const roster = [];
  for (const name of names) {
    if (isMcKey(name)) continue;
    const key = findKnowledgeKey(safe, name) || name;
    if (!roster.some((r) => r === key || samePersonName(r, key))) roster.push(key);
  }
  const wasThere = scene && typeof scene.wasThere === 'function' ? scene.wasThere : null;
  if (wasThere) for (const h of holders.values()) { if (!publicMoment(h.text)) continue; for (const r of roster) if (!h.who.includes(r) && wasThere(r, h.atTurn)) h.who.push(r); }
  const shared = [...holders.values()].filter((h) => h.who.length >= 3);
  const sharedKeys = new Set(shared.map((h) => norm(h.text)));
  if (out && typeof out === 'object') out.shared = new Set(shared.map((h) => norm(h.text.replace(/ \(learned about \d+ pages ago\)$/, '')))); /* M509: the blind spots need not say them again */
  /* M509: "EVERYONE HERE" IS EVERYONE HERE. A person with no book yet was not counted — "Everyone here knows" stood over a
   * room where eight had learned nothing. The roster is everyone present but the main character, under the key their
   * book is filed by; someone without a book is named among the "but". */
  const bySet = new Map();
  for (const h of shared) { const everyone = h.who.length >= roster.length; const sig = everyone ? '*' : h.who.join('|'); if (!bySet.has(sig)) bySet.set(sig, { everyone, who: h.who, facts: [] }); bySet.get(sig).facts.push(h.text); }
  for (const g of [...bySet.values()].sort((a, b) => (b.everyone - a.everyone) || (b.who.length - a.who.length))) {
    const but = roster.filter((k) => !g.who.includes(k));
    /* M509: the SHORTER list names the line — "Everyone here but" eight names beats "Known to" twelve */
    lines.push((g.everyone ? 'Everyone here knows' : but.length < g.who.length ? 'Everyone here but ' + but.join(', ') + ' knows' : 'Known to ' + g.who.join(', ')) + ': ' + g.facts.join('; ') + '.');
  }
  for (const p of picked) {
    const own = p.newest.filter((f) => !sharedKeys.has(norm(f)));
    const ownOld = p.recalled.filter((f) => !sharedKeys.has(norm(f)));
    if (!own.length && !ownOld.length && p.rest <= 0) continue;
    /* the final audit: a belief written as one (M510-48: "believes X — untrue: Y") reads as one, not "knows: believes" */
    const isBelief = (f) => /^believes\b/i.test(f);
    const beliefs = own.filter(isBelief).map((f) => f.replace(/^believes\s+/i, '').replace(/ \(learned about (\d+) pages ago\)$/, ' (since about $1 pages ago)')); /* a belief is held since, not learned */
    const knownOwn = own.filter((f) => !isBelief(f));
    lines.push(p.key + (knownOwn.length || !beliefs.length ? ' knows' + (knownOwn.length ? ': ' + knownOwn.join('; ') + '.' : ' what is shared above.') : '')
      + (beliefs.length ? (knownOwn.length || !beliefs.length ? ' ' + p.key.split(/\s+/)[0] : '') + ' believes: ' + beliefs.join('; ') + '.' : '')
      + (ownOld.length ? ' From much earlier — each is about ITS OWN moment, not this scene; use one only where it truly fits: ' + ownOld.join('; ') + '.' : '')
      + (p.rest > 0 ? ' (and ' + p.rest + ' older ' + (p.rest === 1 ? 'thing' : 'things') + ' they know, kept in the ledger)' : ''));
  }
  return lines.join('\n');
}

/* M459: THE SAME FACT IN NEW WORDS IS ONE FACT. The page reader writes what a person learned on every page, and over
 * twenty pages "Shunsui accepted Jovan through his own office and named him captain of the 13th" gathered five
 * wordings in each witness's book. When two facts share nearly all their words, the newer wording stands for both. */
/* M509-6: THE WORDS OF A FACT ARE CUT ONCE. sameFactsOnce compares every fact of a book with every other on every render
 * of the room, and cut both into words each time — with forty facts a person and twenty people in a courtyard, two
 * thirds of a render went to cutting the same strings again (tests: 10 renders 2,892 → ~600 ms). Every helper below
 * remembers its answer by the text, bounded. */
const ONCE_WORDS = new Map(); const ONCE_NUMS = new Map(); const KEY_WORDS = new Map(); const FACT_NUMS = new Map(); const FACT_NAMES = new Map();
const remember = (map, key, make) => { if (map.has(key)) return map.get(key); const v = make(); if (map.size > 20000) map.clear(); map.set(key, v); return v; };
const onceWords = (f) => remember(ONCE_WORDS, String(f || ''), () => new Set(String(f || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 2 || /\d/.test(w))));
const onceNumbers = (set) => remember(ONCE_NUMS, set, () => [...set].filter((w) => /\d/.test(w)).sort().join(' '));
const keyWords = (t) => remember(KEY_WORDS, String(t), () => new Set(String(t).split(' ').filter((s) => s.length > 3 || /\d/.test(s))));
const factNums = (t) => remember(FACT_NUMS, String(t || ''), () => new Set(String(t || '').match(/\b\d+\b/g) || []));
const factNames = (t) => remember(FACT_NAMES, String(t || ''), () => new Set((String(t || '').match(/(?<=[^.!?]\s)[A-Z][\p{L}-]+/gu) || []).map((m) => m.toLowerCase())));
function sameFactsOnce(list) {
  const words = onceWords;
  const numbers = onceNumbers;
  const out = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const k = list[i];
    const a = words(k && k.fact);
    const at = out.findIndex((o) => {
      const b = words(o.fact);
      if (numbers(a) !== numbers(b)) return false; /* page 43 and page 44, 150 years and 160: never the same fact */
      let both = 0;
      for (const w of a) if (b.has(w)) both += 1;
      const small = Math.min(a.size, b.size);
      return small >= 4 && both / small >= 0.8;
    });
    if (at === -1) out.push(k);
    /* the richer wording stands (the one that says more), dated as the newer — nothing a wording adds is lost */
    else if (a.size > words(out[at].fact).size) out[at] = { ...k, atTurn: Math.max(Number(k.atTurn) || 0, Number(out[at].atTurn) || 0) };
  }
  return out.reverse();
}

/* ---------- factions ---------- */

function copyFactions(factions) {
  const safe = factions && typeof factions === 'object' ? factions : {};
  const out = {};
  for (const [name, f] of Object.entries(safe)) {
    if (!f || typeof f !== 'object') continue;
    out[name] = { ...f };
  }
  return out;
}

export function findFactionKey(factions, name) {
  const wanted = keyOf(name);
  if (!wanted) return null;
  const safe = factions && typeof factions === 'object' ? factions : {};
  return nearKey(Object.keys(safe), name);
}

export function setFaction(factions, name, { stance, agenda, move } = {}, atTurn) {
  const next = copyFactions(factions);
  const who = cleanText(name, 200);
  if (!who) return next;
  const key = findFactionKey(next, who) || who;
  const entry = { ...(next[key] || {}) };
  if (cleanText(stance)) entry.stance = cleanText(stance, 500);
  if (cleanText(agenda)) entry.agenda = cleanText(agenda, 1000);
  if (cleanText(move)) entry.move = cleanText(move, 1000);
  entry.atTurn = Number.isFinite(atTurn) ? atTurn : (entry.atTurn ?? null);
  next[key] = entry;
  return next;
}

export function renderFactions(factions, top = FACTIONS_RENDER) {
  const safe = copyFactions(factions);
  const rows = Object.entries(safe)
    .map(([name, f]) => ({ name, f, at: Number.isFinite(f.atTurn) ? f.atTurn : -1 }))
    .sort((a, b) => b.at - a.at)
    .slice(0, top);
  return rows.map(({ name, f }) => {
    const bits = [];
    if (f.stance) bits.push(f.stance);
    if (f.agenda) bits.push('wants ' + f.agenda.replace(/\.+$/, ''));
    if (f.move) bits.push('last move: ' + f.move.replace(/\.+$/, ''));
    return name + ' — ' + (bits.join('; ') || 'stands unchanged');
  }).join('\n');
}

/* ---------- arrivals ---------- */

/* Speak a seat's approach against the clock. `entry` is an offscreen seat;
 * `clockMinutes` the story clock (null when unset). '' when the seat
 * carries no stance and no arrival. */
export function renderArrival(entry, clockMinutes) {
  if (!entry || typeof entry !== 'object') return '';
  const bits = [];
  if (STANCES.includes(entry.stance)) bits.push(STANCE_WORDS[entry.stance]);
  /* M396: an arrival is never said of someone whose stance stays put — never "taken up with someone else, due now" */
  /* M456: nor of "tense" — tension with him is not a road to him; a seat stored with one ("unresolved tension …, due now")
   * is read right */
  if (entry.stance === 'busy' || entry.stance === 'waiting' || entry.stance === 'tense') return bits.join(', ');
  const at = entry.arrivesAtMinutes;
  if (Number.isFinite(at)) {
    if (Number.isFinite(clockMinutes)) {
      const delta = Math.round(at - clockMinutes);
      if (delta > 1) bits.push('arriving in about ' + describeMinutes(delta));
      else if (delta >= -1) bits.push('due now');
      /* M645: AN APPROACH THAT NEVER LANDED IS NOT SAID FOR EVER. "Moving toward the main character, overdue by about 3
       * days — likely already here or delayed" rode the storyteller's list of who is elsewhere, page after page, for as
       * long as nobody moved that person on. Three hours past its hour the approach is stale: nothing is said of it
       * (the seat's own age says the rest: "as of 3 days ago; likely elsewhere by now"). */
      else if (-delta <= 180) bits.push('overdue by about ' + describeMinutes(-delta) + ' — likely already here or delayed');
      else return '';
    } else if (Number.isFinite(entry.etaMinutes)) {
      bits.push('about ' + describeMinutes(entry.etaMinutes) + ' away');
    }
  } else if (Number.isFinite(entry.etaMinutes)) {
    bits.push('about ' + describeMinutes(entry.etaMinutes) + ' away');
  }
  return bits.join(', ');
}

function describeMinutes(m) {
  const n = Math.max(1, Math.round(m));
  if (n < 60) return n + (n === 1 ? ' minute' : ' minutes');
  const h = Math.round((n / 60) * 2) / 2;
  if (h < 24) return h + (h === 1 ? ' hour' : ' hours');
  const d = Math.round(n / (60 * 24));
  return d + (d === 1 ? ' day' : ' days');
}

/* ---------- the brief ---------- */

export function normalizeBrief(raw, atTurn, atPage) {
  if (!raw || typeof raw !== 'object') return null;
  /* M648 (the ledger audit, part five — eight kinds of world note through this door): ONLY WHAT IS A LINE IS KEPT AS ONE.
   * A pressure given as one string instead of a list of one was thrown away whole (the world "stood still" on a page
   * it had something to say about); "nothing new", "none", "N/A", "…" were kept as pressures and read to the
   * storyteller as the state of the world; the same line twice was kept twice; and a line still carrying the prompt's
   * own placeholders ("NAME wants OTHER NAME gone") was kept as if it named someone. */
  const NOTHING = /^(?:none|nothing(?: new| changed| to (?:add|report|note))?|no (?:change|changes|new (?:pressure|developments?)|updates?)|n\/?a|nil|null|unchanged|same(?: as before)?|todo|tbd)\.?$/i;
  const PLACEHOLDER = /\b(?:OTHER NAME|NEW NAME|NAME SURNAME|MAIN CHARACTER|QUIET NAME)\b|(?:^|\s)NAME(?:\s|['’]s|$)/;
  const lines = (v) => {
    const out = [];
    for (const item of (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])) {
      const text = cleanText(typeof item === 'string' ? item : (item && (item.text || item.words || item.line)), 1000);
      if (!text || !/\p{L}/u.test(text) || NOTHING.test(text) || PLACEHOLDER.test(text)) continue;
      const key = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (out.some((o) => o.key === key)) continue;
      out.push({ key, text });
    }
    return out.slice(0, BRIEF_LINES).map((o) => o.text);
  };
  const pressure = lines(raw.pressure);
  const ripe = lines(raw.ripe);
  let twb = null;
  const t = raw.twb;
  if (t && typeof t === 'object' && (cleanText(t.who) || cleanText(t.changed))) {
    twb = { who: cleanText(t.who, 120), where: cleanText(t.where, 500), changed: cleanText(t.changed, 1000) };
    /* M648: a window that is a placeholder, "nothing", or the worker excusing itself is no window */
    if (PLACEHOLDER.test(twb.who + ' ' + twb.changed) || NOTHING.test(twb.changed) || (!twb.changed && NOTHING.test(twb.who)) || /^(?:i['’]?m sorry|i am sorry|sorry,|i can(?:['’]?t|not)\b|as an ai\b)/i.test(twb.changed)) twb = null;
  }
  const voices = normalizeVoices(raw.voices);
  const at = Number.isFinite(atTurn) ? atTurn : null;
  /* M162: THE BRIEF IS AGED BY PAGES, NOT BY WRITES. state.turn counts
   * mutation BATCHES — the extractor's, the world's, the scribe's, and five
   * more on any turn the auditor runs — so a brief four "turns" old could be
   * two seconds old and one page old. Measured: after a single audit the
   * brief was dropped before the storyteller ever saw it, and the living
   * world went silent on every audit turn. The page stamp is what a reader
   * means by "a turn ago". */
  const page = Number.isFinite(atPage) ? atPage : null;
  if (!pressure.length && !ripe.length && !twb && !voices.length) return { pressure, ripe, twb, voices, atTurn: at, atPage: page, empty: true };
  return { pressure, ripe, twb, voices, atTurn: at, atPage: page };
}

/* M85: the voices — the world's trending conversation, people the main
 * character cannot hear. Four fields, the preset's shape: icon | speaker |
 * channel · timing | content. A reply thread is a speaker written "-> Name".
 * 2-4 lines; a fifth is noise. */
export const VOICES_MAX = 4;
export const VOICE_ICONS = ['📸', '💬', '👥', '📋', '👤', '🍺', '🏪', '🔥', '📜', '⚠️'];
export function normalizeVoices(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const content = cleanText(v.content || v.text || v.line, 1000);
    const speaker = cleanText(v.speaker || v.who, 120);
    if (!content || !speaker) continue;
    const iconRaw = cleanText(v.icon, 8);
    const icon = iconRaw || '💬';
    const channel = cleanText(v.channel || v.where, 200);
    out.push({ icon, speaker, channel, content });
    if (out.length >= VOICES_MAX) break;
  }
  return out;
}

/* The block as the writer's SillyTavern styles expect it: {VOICES} … {/VOICES}
 * with one [VOICE: icon | Speaker | Channel · timing | content] per line. The
 * thread dresses this text with the 🎨 pack (display rules) so the reader
 * sees the same fold they saw in SillyTavern. */
export function renderVoicesBlock(voices) {
  const list = normalizeVoices(voices);
  if (!list.length) return '';
  /* a reply thread ("-> Name") stands on three fields — the preset's own
   * reply form; a standalone voice carries its channel as the third */
  const lines = list.map((v) => (v.channel && !/^->/.test(v.speaker)
    ? '[VOICE: ' + v.icon + ' | ' + v.speaker + ' | ' + v.channel + ' | ' + v.content + ']'
    : '[VOICE: ' + v.icon + ' | ' + v.speaker + ' | ' + v.content + ']'));
  return '{VOICES}\n' + lines.join('\n') + '\n{/VOICES}';
}

/* The storyteller's word from the world agent. `turnNow` (state.turn) lets
 * an old brief say its age; a brief older than STALE_TURNS is not spoken.
 * The lead line tells the storyteller what this is, so it works with any
 * craft — the house's own record, rendered as world, never as instruction
 * that leaks onto the page. */
export const BRIEF_STALE_TURNS = 4;

/* M543: THE WINDOW BEYOND THE PAGE IS ON SOMEONE BEYOND THE PAGE. His storyteller wrote a "World Beyond" window on a person
 * standing in the same scene as his main character, on the same page: the world agent may name anyone for its window (twb),
 * and it is kept until its next reading — someone it chose while away can walk in before the page is asked for. A window on
 * someone the ledger has here now (or on the main character) is no window: the house does not open it, and the storyteller
 * is not told of it. */
export function windowOnSomeoneHere(brief, state) {
  const t = brief && brief.twb;
  const who = t && typeof t.who === 'string' ? t.who.trim() : '';
  if (!who || !state || typeof state !== 'object') return false;
  const present = Array.isArray(state.present) ? state.present : [];
  if (present.some((p) => p && typeof p.name === 'string' && samePersonName(p.name, who))) return true;
  const mc = mcName(state);
  return Boolean(mc && mc !== 'the player' && samePersonName(mc, who));
}
/* M544: THE VOICES ARE PEOPLE HE CANNOT HEAR. The same fault as the window (M543): the world agent's voices — "people the main
 * character cannot currently hear" — were kept as they came, so a line from someone standing in the room with him could sit
 * under the page as if overheard from elsewhere. A voice whose speaker is here (or is the main character) is not kept. */
export function voicesBeyondTheRoom(voices, state) {
  const list = Array.isArray(voices) ? voices : [];
  if (!state || typeof state !== 'object') return list;
  const present = Array.isArray(state.present) ? state.present : [];
  const mc = mcName(state);
  return list.filter((v) => {
    const who = String((v && v.speaker) || '').replace(/^->\s*/, '').trim();
    if (!who) return true;
    if (present.some((p) => p && typeof p.name === 'string' && samePersonName(p.name, who))) return false;
    /* M680: and never from the dead (offscreen.js isDeadSeat) */
    const grave = findSeat(state.offscreen || {}, who);
    if (grave && isDeadSeat(grave.entry)) return false;
    return !(mc && mc !== 'the player' && samePersonName(mc, who));
  });
}
export function renderWorldBrief(brief, turnNow, pageNow, state = null) {
  if (!brief || typeof brief !== 'object') return '';
  if (brief.empty) return '';
  /* M85: the voices are the reader's, never the storyteller's — a brief
   * that holds only voices says nothing to the wire. */
  if (!(brief.pressure && brief.pressure.length) && !(brief.ripe && brief.ripe.length) && !brief.twb) return '';
  /* M162: pages when both stamps are there (see normalizeBrief); a brief
   * written before this law still ages the old way, so nothing is lost. */
  const age = Number.isFinite(pageNow) && Number.isFinite(brief.atPage)
    ? Math.max(0, pageNow - brief.atPage)
    : (Number.isFinite(turnNow) && Number.isFinite(brief.atTurn) ? Math.max(0, turnNow - brief.atTurn) : 0);
  if (age > BRIEF_STALE_TURNS) return '';
  const out = [];
  /* M321: said as one person briefing another — it read like an order to a renderer */
  out.push('Meanwhile, beyond this scene' + (age > 1 ? ' (as of ' + age + ' pages ago)' : '') + ' — the world keeps moving while the page looks elsewhere. Let any of this arrive the way the world itself would (someone turns up, news reaches them, a consequence lands), never as something you were told:');
  if (brief.pressure.length) {
    out.push('What could reach this scene, and when:');
    for (const p of brief.pressure) out.push('  - ' + p);
  }
  if (brief.ripe.length) {
    out.push('What has ripened out of sight, and whom it has reached:');
    for (const r of brief.ripe) out.push('  - ' + r);
  }
  if (brief.twb && !windowOnSomeoneHere(brief, state)) { /* M543 */
    const t = brief.twb;
    out.push('A window into the world beyond is open this turn, if the scene has room for it — ' + [t.who, t.where].filter(Boolean).join(', ') + ': ' + t.changed + ' (write it only if it does something; enter late, leave early; nobody in the scene learns from it).');
  }
  return out.join('\n');
}


/* M338: WHO COULD KNOW THIS? — the blind spots of the people in the scene.
 * The writer: Jovan asks Claire how she found them, and Claire answers "You gave me the schedule yesterday… in the hallway
 * after the audit" — a meeting that never happened; the four o'clock was set between Jovan and Aurora, by text. "Design
 * something sophisticated, autonomous and smart: each latest page, an analysis of what the people in the current scene
 * DON'T know — to stop every NPC knowing what MC did privately."
 * The ledger already holds what each person HAS learned, line by line, with the page. So what a person has NOT been
 * shown learning is computable, with no model: every fact somebody ELSE holds that this person has no line for — not
 * the same fact in other words, not a fact about themselves (their own name in it: they were there). Those nearest
 * the scene (its words, then the newest) are put in front of the storyteller BEFORE it writes, as what they are: not
 * "she cannot know" (a ledger can miss a line) but "no page shows her learning it — if she speaks of it, the page
 * must show how she came to know". The second reader holds the finished page to the same list (agents/continuity.js). */
export const BLIND_PER_PERSON = 3;    /* M508: was 4 */
export const BLIND_CLIP = 160;        /* M508: a blind spot names the fact in its first words; the whole fact stands under its knower */
export const BLIND_RECENT_PAGES = 16; /* M508: was 60 — a fact from forty pages back that a warden has not found out is not a blind spot the scene turns on; what bears on the scene is still called back by its words */
const FACT_WORDS = new Map();
const factWords = (fact, ignore) => {
  const text = String(fact || '');
  if (!ignore && FACT_WORDS.has(text)) return new Set(FACT_WORDS.get(text));
  const out = new Set();
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}'’-]+/u)) {
    const word = w.replace(/['’]s$/, '').replace(/^['’-]+|['’-]+$/g, '');
    if (word.length >= 4 && !SCENE_STOP.has(word) && !(ignore && ignore.has(word))) out.add(word);
  }
  if (!ignore && text.length <= 600) { if (FACT_WORDS.size > 20000) FACT_WORDS.clear(); FACT_WORDS.set(text, new Set(out)); }
  return out;
};
const overlap = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n += 1; return n / Math.min(a.size, b.size); };
/* M509-15: A MOMENT THE WHOLE ROOM SAW IS NOBODY'S BLIND SPOT WHO WAS IN THE ROOM. The reader writes a public moment
 * into one witness's book ("watched Jovan bow… whisper to Rukia" — Shunsui alone), and the blind spots then told the
 * storyteller that thirteen people standing in the same courtyard had not found it out. A fact is PUBLIC when it is
 * something seen ("saw", "watched", "witnessed") or said before all ("in front of the whole courtyard", "aloud",
 * "shouted", "before the assembly", "in open court"), and carries no mark of privacy ("whisper", "close", "quietly",
 * "aside", "under his breath", "in his ear", "privately", "only he", "alone"). A whisper stays a whisper. */
const PUBLIC_MARK = /\b(?:in front of (?:the )?(?:whole |entire |full )?(?:courtyard|room|hall|crowd|assembly|table|court|company|everyone|them all)|aloud|out loud|shouted|bellowed|roared|announced|declared|proclaimed|before the (?:whole )?(?:assembly|court|crowd|room|hall|table)|in open (?:court|courtyard|assembly)|to the (?:whole )?(?:room|courtyard|crowd|hall)|for all to hear|everyone (?:heard|saw)|the whole (?:room|courtyard|hall|crowd) (?:heard|saw))\b/i;
const SEEN_START = /^(?:saw|watched|witnessed|observed|looked on as|was there when)\b/i;
const PRIVATE_MARK = /\b(?:whisper(?:ed|s|ing)?|close|quietly|softly|low(?:ered)?|under (?:his|her|their) breath|in (?:his|her|their) ear|privately|in private|aside|alone|only (?:he|she|they)|so (?:only|no one else)|out of earshot|behind (?:closed doors|the door)|between (?:them|the two)|in confidence|told (?:him|her) alone|when no one|no one else (?:heard|saw)|nobody else)\b/i;
/* M520: A HIDDEN ACT IS NOT THE ROOM'S. "Watched the assassin slip a vial into the paladin's cup when no one was looking" was
 * public by its first word ("watched") and went into every book in the room — the paladin's own among them, blind to the
 * poison he just drank. What one witness caught done in secret stays that witness's. (A whisper SEEN is still seen: the
 * room saw him lean in — M509-15.) */
const COVERT_MARK = /\b(?:secret(?:ly)?|covert(?:ly)?|furtive(?:ly)?|stealth(?:ily)?|surreptitious(?:ly)?|discreet(?:ly)?|slip(?:s|ped|ping)?|palm(?:s|ed|ing)?|pocket(?:s|ed|ing)?|hid(?:e|es|den|ing)?|conceal(?:s|ed|ing)?|sleight|unnoticed|unseen|undetected|when no one (?:was )?looking|while no one (?:was )?looking|behind (?:his|her|their|its) back|under the table|out of sight|no one else (?:saw|noticed))\b/i;
export function publicMoment(fact) {
  const t = String(fact || '').trim();
  if (!t) return false;
  /* what was SEEN was seen by the room — "watched him whisper to her" tells the room he whispered, not what; what was
   * HEARD is public only when the fact says it was said before all, and never when it carries a mark of privacy */
  if (SEEN_START.test(t)) return !COVERT_MARK.test(t); /* M520: a hidden act one pair of eyes caught is not the room's */
  return PUBLIC_MARK.test(t) && !PRIVATE_MARK.test(t);
}
export function blindSpots(knowledge, present, { scenePages = [], turn = null, mc = '', per = BLIND_PER_PERSON, wasThere = null } = {}) {
  const safe = copyKnowledge(knowledge);
  const names = (Array.isArray(present) ? present : []).map((p) => (typeof p === 'string' ? p : p && p.name)).filter((n) => typeof n === 'string' && n.trim());
  const mcKey = String(mc || '').trim().toLowerCase();
  const sceneWords = sceneWordsOf(scenePages);
  const out = [];
  /* M509-2: as in the recall (renderKnowledge), a word in more than a quarter of the books' facts says nothing about
   * nearness — "courtyard", "captain", "Tenth" made a 46-page-old report "near the scene" for a warden */
  const df = new Map(); let factCount = 0;
  for (const list of Object.values(safe)) for (const k of (Array.isArray(list) ? list : [])) {
    factCount += 1;
    for (const w of factWords(k && k.fact)) df.set(w, (df.get(w) || 0) + 1);
  }
  const common = new Set(); if (factCount >= 20) for (const [w, n] of df) if (n > factCount * 0.25) common.add(w);
  /* M507: each fact's words, age and nearness to the scene are read ONCE, not once per person in the room; a name's own
   * word patterns are compiled once per name, not once per fact (tests/perf_send.py: thousands of compilations a send) */
  /* M681: who holds each fact, by its plain key — for a full book's horizon (below) */
  const ownersOf = new Map();
  for (const [other, list] of Object.entries(safe)) for (const k of (Array.isArray(list) ? list : [])) { if (!k || typeof k.fact !== 'string') continue; const fk = factKey(k.fact); if (!ownersOf.has(fk)) ownersOf.set(fk, new Set()); ownersOf.get(fk).add(other); }
  const books = Object.entries(safe).map(([other, list]) => [other, (Array.isArray(list) ? list : []).map((k) => {
    const fact = String(k.fact || '').trim();
    /* the final audit: a belief is no one else's blind spot; and a fact the knower was told is SHOWN, for someone who has
     * not found it out, as the fact itself ("was told Jovan serves…" read as if Rukia had been told) — the tests below
     * still read it as it was written (a telling is private, not a public moment) */
    if (!fact || /^believes\b/i.test(fact)) return null;
    const shown = fact.replace(/^(?:was told|were told|learned|learnt|found out)\s+(?:that\s+)?(?=\p{Lu})/u, ''); /* only a telling whose news follows as a sentence ("was told Jovan serves…"); "heard X say…" and "saw X do…" keep their verb — without it the sentence breaks */
    const age = Number.isFinite(turn) && Number.isFinite(k.atTurn) ? turn - k.atTurn : null;
    const atTurn = Number.isFinite(k.atTurn) ? k.atTurn : null;
    const words = factWords(fact);
    const score = sceneWords.size ? [...words].filter((w) => sceneWords.has(w) && !common.has(w)).length : 0;
    return { fact, shown, age, words, score, atTurn };
  }).filter((f) => f && (f.score >= 2 || (f.age != null && f.age <= BLIND_RECENT_PAGES)))]); /* near the scene, or recent */
  for (const name of names) {
    if (name.trim().toLowerCase() === mcKey || (mc && samePersonName(name, mc))) continue; /* the main character is the writer's — under any form of his name (M449: "Oda" in the scene is Jovan Oda) */
    const mineKey = findKnowledgeKey(safe, name);
    const mineList = mineKey ? safe[mineKey] : [];
    const mine = mineList.map((k) => ({ fact: k.fact, words: factWords(k.fact) }));
    /* M579: a list at the guard may have let older facts go — nothing older than its oldest kept fact is claimed unknown */
    /* M681: …the oldest fact it still SHARES with someone — a full book lets shared facts go first (trimmedBook), so an older
     * secret kept says nothing of what was let go after it; a full book that shares nothing claims nothing */
    const sharedWithOthers = (k) => { const o = ownersOf.get(factKey(k.fact)); return Boolean(o) && [...o].some((x) => x !== mineKey); };
    const sharedTurns = mineList.length >= KNOWLEDGE_GUARD ? mineList.filter((k) => k && typeof k.fact === 'string' && Number.isFinite(k.atTurn) && sharedWithOthers(k)).map((k) => k.atTurn) : [];
    const horizon = mineList.length >= KNOWLEDGE_GUARD ? (sharedTurns.length ? Math.min(...sharedTurns) : Infinity) : -Infinity;
    const selfRes = [...new Set(name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3))].map((w) => new RegExp('(^|[^\\p{L}])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}])', 'iu'));
    const found = [];
    for (const [other, list] of books) {
      if (other === mineKey || other.trim().toLowerCase() === name.trim().toLowerCase() || samePersonName(other, name)) continue; /* M449: their own lines under another form of their name are theirs — never "Rukia hasn't found out (Rukia knows)" */
      for (const { fact, shown, age, words, score, atTurn } of list) {
        if (horizon > -Infinity && !(Number.isFinite(atTurn) && atTurn >= horizon)) continue; /* M579: older than what their full list still holds */
        if (selfRes.some((re) => re.test(fact))) continue; /* about them: they were there */
        if (typeof wasThere === 'function' && publicMoment(fact) && wasThere(name, atTurn)) continue; /* M509-15: the whole room saw it, and they were in the room */
        if (mine.some((m) => sameFact(m.fact, fact) || overlap(m.words, words) >= 0.6)) continue; /* they hold it, in these words or others */
        if (found.some((f) => sameFact(f.fact, fact) || overlap(f.words, words) >= 0.6)) continue; /* once is enough */
        found.push({ fact: (shown || fact).replace(/\.+$/, ''), from: other, age, score, words });
      }
    }
    found.sort((a, b) => (b.score - a.score) || ((a.age == null ? 1e9 : a.age) - (b.age == null ? 1e9 : b.age)));
    if (found.length) out.push({ name, lacks: found.slice(0, per).map(({ fact, from, age }) => ({ fact, from, age })) });
  }
  return out;
}
export function renderBlindSpots(spots) {
  const list = (Array.isArray(spots) ? spots : []).filter((s) => s && Array.isArray(s.lacks) && s.lacks.length);
  if (!list.length) return '';
  /* M460: A FACT THEY LACK IS SAID ONCE, WITH EVERYONE WHO LACKS IT. The same four facts rode under sixteen names, the
   * whole fact each time; now each fact is said once, after the names of all who have not found it out — the same marker
   * (" hasn’t found out: "), the same names, the same knower. Facts lacked by the very same people share a line. */
  const byFact = new Map();
  for (const s of list) for (const l of s.lacks) {
    const k = String(l.fact) + '\u0000' + String(l.from);
    if (!byFact.has(k)) byFact.set(k, { fact: l.fact, from: l.from, who: [] });
    if (!byFact.get(k).who.includes(s.name)) byFact.get(k).who.push(s.name);
  }
  const bySet = new Map();
  /* M508: a long fact is clipped here — the whole of it stands above, under whoever knows it */
  const clip = (t) => { const s = String(t); if (s.length <= BLIND_CLIP) return s; const cut = s.slice(0, BLIND_CLIP); const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(','), cut.lastIndexOf(';')); return cut.slice(0, at > BLIND_CLIP / 2 ? at : BLIND_CLIP).replace(/[,;\s]+$/, '') + '…'; };
  for (const f of byFact.values()) { const sig = f.who.join('|'); if (!bySet.has(sig)) bySet.set(sig, { who: f.who, facts: [] }); bySet.get(sig).facts.push(clip(f.fact) + ' (' + f.from + ' knows)'); }
  return [...bySet.values()].map((g) => g.who.join(', ') + BLIND_LINE + g.facts.join('; ') + '.').join('\n'); /* M416 */
}
