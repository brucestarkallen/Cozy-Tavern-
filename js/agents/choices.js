/* Cozy Tavern — agents/choices.js (M548)
 * CHOICES MATTER — his ask: "make choice matter like Detroit: Become Human, a switch you can turn on and off — off, everything
 * back to normal: no injection, the persona untouched. And I don't know the outcome: the choices already decided beforehand,
 * so the storyteller can't bias it."
 *
 * Off (as it ships, for every story): nothing here runs, nothing is shown, not one byte of any request changes.
 * On, for a story: after a page that ends at a real turning point for the main character, a helper that cannot know which
 * one he will pick seals two to four choices — each with what follows it (its outcome) and what it leaves behind (its
 * echoes) — and they are kept on the page itself, never shown to him. Above where he types stand only their names. Tapping
 * one sends its move as his; the storyteller is told what follows as settled — in his own voice, the way the referee's
 * ruling is — and the referee does not rule on it. Try again keeps the seal (it is kept on his message); edit the move and
 * the seal is broken (it is his own move then). Typing his own move takes none. What a taken choice left behind rides on
 * every later page as what his choices set in motion. Everything lives on the pages, so a branch, a take-back, an export
 * and the device's books carry it exactly as they carry the pages. */
import { callWorker } from './call.js';
import { writerText, BRIEF_ROOM } from '../engine/whole.js'; /* M566: the brief held to the workers' shared room */
import { parseFirstObject } from './jsonutil.js';

export const CHOICES_MIN = 2;          /* one "choice" is no choice */
export const CHOICES_MAX = 4;
export const LABEL_MAX = 48;           /* characters of a choice's name */
export const MOVE_MAX = 400;
export const OUTCOME_MAX = 700;
export const ECHOES_MAX = 2;
export const ECHO_MAX = 220;
export const ECHO_ROOM = 2400;         /* characters of what his choices set in motion, the newest kept first */
export const CHOICE_MAX_TOKENS = 1600;
export const CHOICE_PAGES = 6;         /* the pages the helper reads before the newest, his moves between them */

export function choicesOn(story) { return Boolean(story && story.choices === true); }

const clip = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
const endStop = (s) => { const t = String(s || '').trim(); return !t || /[.!?…"”’)]$/.test(t) ? t : t + '.'; };
const lowerFirst = (s) => { const t = String(s || '').trim(); return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t; };

/* the version of a page as the thread shows it — the same choice pageText makes (the newest when none is picked) */
export function versionOf(msg) {
  const n = msg && Array.isArray(msg.swipes) ? msg.swipes.length : 0;
  if (!n) return 0;
  return Number.isFinite(msg.swipeIdx) ? Math.min(n - 1, Math.max(0, msg.swipeIdx)) : n - 1;
}

/* the offer kept on a page for the version it stands at — {turning:false} is kept too, so a quiet page is asked once */
export function offerOf(page) {
  const all = page && page.choiceOffer && typeof page.choiceOffer === 'object' ? page.choiceOffer : null;
  const o = all ? all[String(versionOf(page))] : null;
  return o && typeof o === 'object' && Array.isArray(o.options) ? o : null;
}
export function offerPatch(page, offer) {
  const had = page && page.choiceOffer && typeof page.choiceOffer === 'object' ? page.choiceOffer : {};
  return { choiceOffer: { ...had, [String(versionOf(page))]: offer } };
}
/* the choices he can take now: on the newest page of the story (an out-of-character aside in between does not count), sealed
 * for the version it stands at, and no move of his after it */
export function openOffer(messages) {
  const told = (Array.isArray(messages) ? messages : []).filter((m) => m && !m.hidden && !m.ooc);
  const last = told[told.length - 1];
  if (!last || last.role !== 'assistant') return null;
  const offer = offerOf(last);
  return offer && offer.turning === true && offer.options.length >= CHOICES_MIN ? { page: last, offer } : null;
}

/* the helper's question — it reads the story, never the storyteller's request */
export function choiceAsk({ brief = '', essentials = '', facts = '', people = '', pages = [], newest = '', mc = '', echoes = [] } = {}) {
  const who = mc || 'the main character';
  const system = [
    'You keep the turning points of a long collaborative story, the way Detroit: Become Human does. You never write the story itself.',
    'Read the newest page. Decide whether it ends at a real turning point for ' + who + ': a moment where what ' + who + ' does next will change how someone sees him, what happens to someone, or which way the story goes. Most pages are not one — a quiet beat, small talk, a walk, a fight already under way. If it is not, answer {"turning":false}.',
    'If it is, write two to four choices ' + who + ' could take from exactly where the page ends — different in kind, never one choice said four ways. For each:',
    '- "label": two to six words, the way a game shows a choice ("Tell her the truth", "Say nothing", "Walk away").',
    '- "move": what ' + who + ' does, the way he writes his own moves — the first person, one or two sentences ("I tell Tamsin Hale the truth about the attendant.").',
    '- "outcome": what follows, decided now, before he chooses — what the people and the world do in answer, what it costs him or wins him, what can no longer be undone. One to three sentences. Never what ' + who + ' feels, thinks, says or does beyond the move.',
    '- "echoes": up to two things it leaves behind that will matter later — {"who":"a name","what":"what they will remember, or do"}.',
    'Seal every outcome by the people — their natures, what they know, what they want — and by the world\'s own logic, never by what would please him. A kind choice can go badly; a hard one can work. At least one choice costs him something real. No outcome may break what the ledger says.',
    'A choice is a decision, not an attempt: never decide whether a blow lands or a skill succeeds — that is for the dice.',
    'Write every name as the ledger writes it.',
    'Answer with ONLY this JSON: {"turning":true,"choices":[{"label":"","move":"","outcome":"","echoes":[{"who":"","what":""}]}]} — or {"turning":false}.',
  ].join('\n');
  const user = [
    'THE STORY\'S BRIEF:', writerText(String(brief || ''), BRIEF_ROOM, 'brief') || '(none)', '',
    'THE STORY SO FAR, IN BRIEF:', String(essentials || '').trim() || '(not made yet)', '',
    'WHERE THINGS STAND (the ledger):', String(facts || '').trim() || '(nothing yet)', '',
    'THE PEOPLE:', String(people || '').trim() || '(no one written yet)', '',
    ...(Array.isArray(echoes) && echoes.length ? ['WHAT HIS EARLIER CHOICES SET IN MOTION:', echoes.join('\n'), ''] : []),
    'THE PAGES BEFORE (oldest first, his moves between them):', (Array.isArray(pages) ? pages : []).join('\n\n') || '(none)', '',
    'THE NEWEST PAGE:', String(newest || '').trim() || '(none)',
  ].join('\n');
  return { system, user };
}

/* its answer, read strictly — two to four whole choices, each named once; anything less is no answer */
export function readChoices(raw) {
  const j = parseFirstObject(String(raw == null ? '' : raw), (o) => typeof o.turning === 'boolean'); /* the object that answers, past any thinking out loud */
  if (!j || typeof j !== 'object') return null;
  if (j.turning === false) return { turning: false, options: [] };
  if (j.turning !== true || !Array.isArray(j.choices)) return null;
  const seen = new Set();
  const options = [];
  for (const c of j.choices) {
    if (!c || typeof c !== 'object') continue;
    const label = clip(c.label, LABEL_MAX);
    const move = clip(c.move, MOVE_MAX);
    const outcome = clip(c.outcome, OUTCOME_MAX);
    if (!label || !move || !outcome) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const echoes = (Array.isArray(c.echoes) ? c.echoes : [])
      .map((e) => ({ who: clip(e && e.who, 60), what: clip(e && e.what, ECHO_MAX) }))
      .filter((e) => e.who && e.what)
      .slice(0, ECHOES_MAX);
    options.push({ label, move, outcome, echoes });
    if (options.length >= CHOICES_MAX) break;
  }
  if (options.length < CHOICES_MIN) return null;
  return { turning: true, options };
}

/* never throws: the reading, or null when it could not be had */
export async function makeChoices({ connection, ask, signal, callLLM = callWorker } = {}) {
  if (!connection || !ask) return null;
  try {
    const answer = await callLLM(connection, { system: ask.system, user: ask.user, maxTokens: CHOICE_MAX_TOKENS, signal });
    return readChoices(typeof answer === 'string' ? answer : (answer && answer.text) || '');
  } catch (err) { return null; }
}

/* what he took, kept on HIS message — whole, so it needs nothing else to be read again */
export function takenRecord(page, offer, pick) {
  const o = offer && Array.isArray(offer.options) ? offer.options[pick] : null;
  if (!o) return null;
  return {
    pageId: page && page.id, version: versionOf(page), pick, label: o.label, move: o.move, outcome: o.outcome,
    echoes: Array.isArray(o.echoes) ? o.echoes : [], others: offer.options.filter((_, i) => i !== pick).map((x) => x.label),
  };
}
/* the seal stands while his words are the words he sent; changed, the move is his own */
export function takenOf(msg) {
  const c = msg && msg.choiceTaken;
  if (!c || typeof c !== 'object' || typeof c.outcome !== 'string' || !c.outcome.trim()) return null;
  const now = String(msg.text == null ? '' : msg.text).trim();
  return now && now === String(c.words == null ? '' : c.words).trim() ? c : null;
}

/* what the storyteller is told — in the writer's voice, as the referee's ruling is (the caller adds the teller's name) */
export const CHOICE_SETTLED = 'It’s settled — tell it just that way, in the story’s own voice, and keep all of this between us.';
export function outcomeWords(taken, mc) {
  if (!taken || !String(taken.outcome || '').trim()) return '';
  const who = mc || 'the main character';
  const echoes = (Array.isArray(taken.echoes) ? taken.echoes : []).filter((e) => e && e.who && e.what).map((e) => e.who + ' — ' + String(e.what).replace(/[.\s]+$/, ''));
  return 'About the choice ' + who + ' made — ' + lowerFirst(String(taken.label || '').replace(/[.\s]+$/, '')) + ': ' + endStop(taken.outcome)
    + (echoes.length ? ' What it leaves behind: ' + endStop(echoes.join('; ')) : '') + ' ' + CHOICE_SETTLED;
}

/* every taken choice still standing in the thread, with the page it followed (1-based, the storyteller's pages counted) */
export function takenIn(messages) {
  const out = [];
  let page = 0;
  for (const m of (Array.isArray(messages) ? messages : [])) {
    if (!m || m.hidden) continue;
    if (m.role === 'assistant' && !m.ooc) { page += 1; continue; }
    if (m.role !== 'user' || m.ooc) continue;
    const t = takenOf(m);
    if (t) out.push({ page, taken: t, msg: m });
  }
  return out;
}
/* WHAT HIS CHOICES SET IN MOTION — the echoes of every choice still standing, oldest first, within their room (the newest
 * kept when the room is short): the lines ride while the switch is on, nowhere else */
export function echoLines(messages, { room = ECHO_ROOM } = {}) {
  const lines = [];
  for (const { page, taken } of takenIn(messages)) {
    for (const e of taken.echoes || []) if (e && e.who && e.what) lines.push('- (page ' + page + ', when I chose to ' + lowerFirst(String(taken.label || '').replace(/[.\s]+$/, '')) + ') ' + e.who + ' — ' + endStop(e.what));
  }
  const kept = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (kept.length && used + lines[i].length + 1 > room) break;
    kept.unshift(lines[i]);
    used += lines[i].length + 1;
  }
  return kept;
}
export function echoesText(messages, opts) {
  const lines = echoLines(messages, opts);
  return lines.length ? 'What my choices set in motion — each of these still stands and will come back:\n' + lines.join('\n') : '';
}

/* THE FLOWCHART — every turning point in the thread, newest first: the choice he took (and, once taken, what followed), the
 * ones he did not (their outcomes never shown), his own way, or the one waiting for his move */
export function flowOf(messages) {
  const list = (Array.isArray(messages) ? messages : []).filter((m) => m && !m.hidden);
  const out = [];
  let page = 0;
  list.forEach((m, i) => {
    if (m.role !== 'assistant' || m.ooc) return;
    page += 1;
    const offer = offerOf(m);
    if (!offer || offer.turning !== true || offer.options.length < CHOICES_MIN) return;
    const next = list.slice(i + 1).find((x) => x && x.role === 'user' && !x.ooc);
    const taken = next ? takenOf(next) : null;
    /* its own page — by id, or (a branch's copy gives the page a new id) by the very choice it names at that place */
    const mine = taken && (taken.pageId === m.id || (offer.options[taken.pick] && offer.options[taken.pick].label === taken.label));
    const took = mine && taken.version === versionOf(m) ? taken.pick : null;
    out.push({
      page, options: offer.options.map((o) => o.label), took,
      outcome: took != null ? offer.options[took] && offer.options[took].outcome : '',
      echoes: took != null && offer.options[took] ? offer.options[took].echoes || [] : [],
      own: Boolean(next) && took == null, open: !next,
    });
  });
  return out.reverse();
}
