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

const THREADS_MAX = 8;
const THREADS_RENDER = 5;
const KNOWLEDGE_PER_NAME = 12;
const KNOWLEDGE_RENDER = 4;
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
  const name = cleanText(title, 120);
  if (!name) return list;
  const at = findThread(list, name);
  const base = at === -1 ? { title: name } : list[at];
  const entry = { ...base };
  if (cleanText(owner)) entry.owner = cleanText(owner, 60);
  if (THREAD_HEAT.includes(heat)) entry.heat = heat;
  if (!entry.heat) entry.heat = 'hot';
  if (cleanText(next)) entry.next = cleanText(next, 200);
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

export function renderThreads(threads) {
  const list = copyThreads(threads);
  if (!list.length) return '';
  const rank = (t) => (t.heat === 'cold' ? 1 : 0);
  list.sort((a, b) => rank(a) - rank(b) || (b.atTurn ?? -1) - (a.atTurn ?? -1));
  return list.slice(0, THREADS_RENDER).map((t) => {
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
 * no-op that returns the same copy; the list keeps its newest
 * KNOWLEDGE_PER_NAME. */
export function addKnowledge(knowledge, name, fact, atTurn) {
  const next = copyKnowledge(knowledge);
  const who = cleanText(name, 60);
  const what = cleanText(fact, 200);
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
  next[key] = list.slice(-KNOWLEDGE_PER_NAME);
  return next;
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
export function renderKnowledge(knowledge, present) {
  const safe = copyKnowledge(knowledge);
  const names = (Array.isArray(present) ? present : [])
    .map((p) => (typeof p === 'string' ? p : p && p.name))
    .filter((n) => typeof n === 'string' && n.trim());
  const lines = [];
  for (const name of names) {
    const key = findKnowledgeKey(safe, name);
    if (!key || !safe[key].length) continue;
    const facts = safe[key].slice(-KNOWLEDGE_RENDER).reverse().map((k) => k.fact.replace(/\.+$/, ''));
    lines.push(key + ' knows: ' + facts.join('; ') + '.');
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
  const who = cleanText(name, 80);
  if (!who) return next;
  const key = findFactionKey(next, who) || who;
  const entry = { ...(next[key] || {}) };
  if (cleanText(stance)) entry.stance = cleanText(stance, 140);
  if (cleanText(agenda)) entry.agenda = cleanText(agenda, 140);
  if (cleanText(move)) entry.move = cleanText(move, 200);
  entry.atTurn = Number.isFinite(atTurn) ? atTurn : (entry.atTurn ?? null);
  next[key] = entry;
  return next;
}

export function renderFactions(factions) {
  const safe = copyFactions(factions);
  const rows = Object.entries(safe)
    .map(([name, f]) => ({ name, f, at: Number.isFinite(f.atTurn) ? f.atTurn : -1 }))
    .sort((a, b) => b.at - a.at)
    .slice(0, FACTIONS_RENDER);
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
    .map((s) => cleanText(typeof s === 'string' ? s : (s && (s.text || s.words || s.line)), 240))
    .filter(Boolean)
    .slice(0, BRIEF_LINES);
  const pressure = lines(raw.pressure);
  const ripe = lines(raw.ripe);
  let twb = null;
  const t = raw.twb;
  if (t && typeof t === 'object' && (cleanText(t.who) || cleanText(t.changed))) {
    twb = { who: cleanText(t.who, 60), where: cleanText(t.where, 120), changed: cleanText(t.changed, 300) };
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
    const content = cleanText(v.content || v.text || v.line, 280);
    const speaker = cleanText(v.speaker || v.who, 60);
    if (!content || !speaker) continue;
    const iconRaw = cleanText(v.icon, 8);
    const icon = iconRaw || '💬';
    const channel = cleanText(v.channel || v.where, 90);
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
  out.push('The house\'s word on the world beyond this page' + (age > 1 ? ' (written ' + age + ' turns ago)' : '') + ' — render as world, never as instruction; nothing here names itself on the page:');
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
