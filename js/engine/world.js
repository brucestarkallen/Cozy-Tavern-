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
  return list.findIndex((t) => t && typeof t.title === 'string' && keyOf(t.title) === wanted);
}

/* Set (or update) a thread. A title already there is updated in place —
 * fields given replace, fields omitted keep. Hot threads are capped: past
 * THREADS_MAX the coldest, oldest thread is let go. */
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

export function findKnowledgeKey(knowledge, name) {
  const wanted = keyOf(name);
  if (!wanted) return null;
  const safe = knowledge && typeof knowledge === 'object' ? knowledge : {};
  return Object.keys(safe).find((k) => keyOf(k) === wanted) || null;
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
  /* the same fact with a different full stop is the same fact */
  const factKey = (f) => keyOf(f).replace(/[.!…]+$/, '');
  if (list.some((k) => factKey(k.fact) === factKey(what))) { next[key] = list; return next; }
  list.push({ fact: what, atTurn: Number.isFinite(atTurn) ? atTurn : null });
  next[key] = list.slice(-KNOWLEDGE_PER_NAME);
  return next;
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
  return Object.keys(safe).find((k) => keyOf(k) === wanted) || null;
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

export function normalizeBrief(raw, atTurn) {
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
  if (!pressure.length && !ripe.length && !twb && !voices.length) return { pressure, ripe, twb, voices, atTurn: at, empty: true };
  return { pressure, ripe, twb, voices, atTurn: at };
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

export function renderWorldBrief(brief, turnNow) {
  if (!brief || typeof brief !== 'object') return '';
  if (brief.empty) return '';
  /* M85: the voices are the reader's, never the storyteller's — a brief
   * that holds only voices says nothing to the wire. */
  if (!(brief.pressure && brief.pressure.length) && !(brief.ripe && brief.ripe.length) && !brief.twb) return '';
  const age = Number.isFinite(turnNow) && Number.isFinite(brief.atTurn) ? Math.max(0, turnNow - brief.atTurn) : 0;
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
