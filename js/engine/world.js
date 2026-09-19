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

export const THREAD_HEAT = ['hot', 'cold'];
export const STANCES = ['toward', 'seeking', 'tense', 'busy', 'waiting'];
export const STANCE_WORDS = {
  toward: 'moving toward the main character',
  seeking: 'searching for the main character',
  tense: 'unresolved tension with the main character',
  busy: 'taken up with someone else',
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
export const KNOWLEDGE_GUARD = 60;    /* a person's facts, kept (was the newest 12) */
const KNOWLEDGE_RENDER = 4;           /* a small room: the newest few */
export const KNOWLEDGE_RECENT = 12;   /* a whole view: the newest shown for each person here */
export const KNOWLEDGE_RECALL = 12;   /* and at most this many OLDER facts that bear on the scene */
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
  return hits.length === 1 ? hits[0] : -1;
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
    const w = low.length > 4 && low.endsWith('s') ? low.slice(0, -1) : low;
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

export function setThread(threads, { title, owner, heat, next } = {}, atTurn) {
  const list = copyThreads(threads);
  const name = undoubled(cleanText(title, 300));
  if (!name) return list;
  const at = findThread(list, name);
  const base = at === -1 ? { title: name } : list[at];
  const entry = { ...base };
  if (cleanText(owner)) entry.owner = cleanText(owner, 120);
  if (THREAD_HEAT.includes(heat)) entry.heat = heat;
  if (!entry.heat) entry.heat = 'hot';
  if (cleanText(next)) entry.next = undoubled(cleanText(next, 1000));
  entry.atTurn = Number.isFinite(atTurn) ? atTurn : (entry.atTurn ?? null);
  if (at === -1) list.push(entry); else list[at] = entry;
  while (list.length > THREADS_MAX) {
    let worst = 0;
    for (let i = 1; i < list.length; i += 1) {
      const a = list[worst]; const b = list[i];
      const rank = (t) => (t.heat === 'cold' ? 0 : 1) * 1e9 + (Number.isFinite(t.atTurn) ? t.atTurn : -1);
      if (rank(b) < rank(a)) worst = i;
    }
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

export function renderThreads(threads, top = THREADS_RENDER) {
  const list = copyThreads(threads);
  if (!list.length) return '';
  const rank = (t) => (t.heat === 'cold' ? 1 : 0);
  list.sort((a, b) => rank(a) - rank(b) || (b.atTurn ?? -1) - (a.atTurn ?? -1));
  return list.slice(0, top).map((t) => {
    let line = (t.heat === 'cold' ? '(cold) ' : '') + t.title;
    if (t.owner) line += ' — ' + t.owner;
    if (t.next) line += (t.owner ? ' means to ' : ' — next: ') + t.next.replace(/\.+$/, '');
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
  return nearKey(Object.keys(safe), name);
}

/* Add one fact to one person. The same fact twice (case-insensitive) is a
 * no-op that returns the same copy; the list keeps everything, up to the
 * runaway guard (M305). */
export function addKnowledge(knowledge, name, fact, atTurn) {
  const next = copyKnowledge(knowledge);
  const who = cleanText(name, 120);
  const what = cleanText(fact, 1000);
  if (!who || !what) return next;
  const key = findKnowledgeKey(next, who) || who;
  const list = next[key] || [];
  /* M92: the same fact in different clothes is the same fact — quotes and
   * apostrophes normalized, punctuation gone, one fact wholly inside another
   * (the shorter a prefix or a clipping of the longer) — the longer stays */
  const dup = list.findIndex((k) => sameFact(k.fact, what));
  if (dup !== -1) {
    if (what.length > list[dup].fact.length) list[dup] = { ...list[dup], fact: what };
    next[key] = list;
    return next;
  }
  list.push({ fact: what, atTurn: Number.isFinite(atTurn) ? atTurn : null });
  next[key] = list.slice(-KNOWLEDGE_GUARD);
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

export function factKey(f) {
  return String(f || '').toLowerCase().replace(/[‘’´`]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
}
export function sameFact(a, b) {
  const x = factKey(a); const y = factKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 24 && long.includes(short);
}
/* M92: an existing book of knowledge with its duplicates folded — run on load,
 * so a store that gathered them before this law is clean the next time it is
 * read; no mutation, nothing for an auditor to note. */
export function dedupeKnowledge(knowledge) {
  const safe = copyKnowledge(knowledge);
  for (const [name, list] of Object.entries(safe)) {
    const kept = [];
    for (const k of list) {
      const at = kept.findIndex((x) => sameFact(x.fact, k.fact));
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
export function renderKnowledge(knowledge, present, per = KNOWLEDGE_RENDER, scene = null) {
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
  const lines = [];
  for (const name of names) {
    const key = findKnowledgeKey(safe, name);
    if (!key || !safe[key].length) continue;
    const list = safe[key];
    const newest = list.slice(-recent).reverse().map(aged);
    const older = list.slice(0, Math.max(0, list.length - recent));
    let recalled = [];
    if (older.length && sceneWords && sceneWords.size) {
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
    lines.push(key + ' knows: ' + newest.join('; ') + '.'
      + (recalled.length ? ' From much earlier — each is about ITS OWN moment, not this scene; use one only where it truly fits: ' + recalled.join('; ') + '.' : '')
      + (rest > 0 ? ' (and ' + rest + ' older ' + (rest === 1 ? 'thing' : 'things') + ' they know, kept in the ledger)' : ''));
  }
  return lines.join('\n');
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
  const at = entry.arrivesAtMinutes;
  if (Number.isFinite(at)) {
    if (Number.isFinite(clockMinutes)) {
      const delta = Math.round(at - clockMinutes);
      if (delta > 1) bits.push('arriving in about ' + describeMinutes(delta));
      else if (delta >= -1) bits.push('due now');
      else bits.push('overdue by about ' + describeMinutes(-delta) + ' — likely already here or delayed');
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
  const lines = (v) => (Array.isArray(v) ? v : [])
    .map((s) => cleanText(typeof s === 'string' ? s : (s && (s.text || s.words || s.line)), 1000))
    .filter(Boolean)
    .slice(0, BRIEF_LINES);
  const pressure = lines(raw.pressure);
  const ripe = lines(raw.ripe);
  let twb = null;
  const t = raw.twb;
  if (t && typeof t === 'object' && (cleanText(t.who) || cleanText(t.changed))) {
    twb = { who: cleanText(t.who, 120), where: cleanText(t.where, 500), changed: cleanText(t.changed, 1000) };
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

export function renderWorldBrief(brief, turnNow, pageNow) {
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
  out.push('Meanwhile, beyond this scene' + (age > 1 ? ' (as of ' + age + ' turns ago)' : '') + ' — the world keeps moving while the page looks elsewhere. Let any of this arrive the way the world itself would (someone turns up, news reaches them, a consequence lands), never as something you were told:');
  if (brief.pressure.length) {
    out.push('What could reach this scene, and when:');
    for (const p of brief.pressure) out.push('  - ' + p);
  }
  if (brief.ripe.length) {
    out.push('What has ripened out of sight, and whom it has reached:');
    for (const r of brief.ripe) out.push('  - ' + r);
  }
  if (brief.twb) {
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
export const BLIND_PER_PERSON = 4;
export const BLIND_RECENT_PAGES = 60;
const factWords = (fact, ignore) => {
  const out = new Set();
  for (const w of String(fact || '').toLowerCase().split(/[^\p{L}\p{N}'’-]+/u)) {
    const word = w.replace(/['’]s$/, '').replace(/^['’-]+|['’-]+$/g, '');
    if (word.length >= 4 && !SCENE_STOP.has(word) && !(ignore && ignore.has(word))) out.add(word);
  }
  return out;
};
const overlap = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n += 1; return n / Math.min(a.size, b.size); };
export function blindSpots(knowledge, present, { scenePages = [], turn = null, mc = '', per = BLIND_PER_PERSON } = {}) {
  const safe = copyKnowledge(knowledge);
  const names = (Array.isArray(present) ? present : []).map((p) => (typeof p === 'string' ? p : p && p.name)).filter((n) => typeof n === 'string' && n.trim());
  const mcKey = String(mc || '').trim().toLowerCase();
  const sceneWords = sceneWordsOf(scenePages);
  const out = [];
  for (const name of names) {
    if (name.trim().toLowerCase() === mcKey) continue; /* the main character is the writer's */
    const mineKey = findKnowledgeKey(safe, name);
    const mine = (mineKey ? safe[mineKey] : []).map((k) => ({ fact: k.fact, words: factWords(k.fact) }));
    const selfWords = new Set(name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3));
    const found = [];
    for (const [other, list] of Object.entries(safe)) {
      if (other === mineKey || other.trim().toLowerCase() === name.trim().toLowerCase()) continue;
      for (const k of (Array.isArray(list) ? list : [])) {
        const fact = String(k.fact || '').trim();
        if (!fact) continue;
        const age = Number.isFinite(turn) && Number.isFinite(k.atTurn) ? turn - k.atTurn : null;
        const words = factWords(fact);
        const score = sceneWords.size ? [...words].filter((w) => sceneWords.has(w)).length : 0;
        if (!(score >= 2 || (age != null && age <= BLIND_RECENT_PAGES))) continue;             /* near the scene, or recent */
        if ([...selfWords].some((w) => new RegExp('(^|[^\\p{L}])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}])', 'iu').test(fact))) continue; /* about them: they were there */
        if (mine.some((m) => sameFact(m.fact, fact) || overlap(m.words, words) >= 0.6)) continue; /* they hold it, in these words or others */
        if (found.some((f) => sameFact(f.fact, fact) || overlap(f.words, words) >= 0.6)) continue; /* once is enough */
        found.push({ fact: fact.replace(/\.+$/, ''), from: other, age, score, words });
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
  return list.map((s) => s.name + ' has not been shown learning: ' + s.lacks.map((l) => l.fact + ' (' + l.from + ' knows)').join('; ') + '.').join('\n');
}
