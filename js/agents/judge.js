/* Cozy Tavern — the benchmark's grader (M632).
 *
 * His word: "a benchmark so I can choose the LLM that writes best — score each, compare, keep a rank; easy, no copy-paste".
 * Two readings, both by one judge he chooses (Settings → Storyteller → Benchmark):
 *   - a GRADE of every page as it lands: five things he cares about, 0–10 each, and the judge's overall — against the
 *     moment the page answers (the page before, his move, where things stand), never the page alone;
 *   - a DUEL when one moment has pages from two storytellers (he switched the storyteller and asked for another take — → on the page): the judge reads both
 *     blind, in BOTH orders, and a win counts only when both orders agree — a judge's lean toward the first or the second
 *     page cancels out (a disagreement is a tie).
 * The judge writes nothing of the story; its answers are JSON, read the forgiving way every reader here is (jsonutil). */
import { callWorker } from './call.js';
import { parseFirstObject } from './jsonutil.js';
import { withFictionFrame } from './voice.js'; /* M21: the workers never break the fiction — the judge reads every page, the explicit ones too */

export const AXES = [
  ['prose', 'Prose'],
  ['people', 'People'],
  ['agency', 'Agency'],
  ['continuity', 'Continuity'],
  ['pull', 'Pull'],
];

const STANDARDS = [
  'Grade by these, 0 to 10 each (10 = the best page a gifted novelist could write for this moment; 5 = competent and forgettable; 0 = broken):',
  '- prose: vivid and specific; plain where plain serves; no cliché, no purple, no padding; rhythm that varies; dialogue that sounds like these people.',
  '- people: everyone acts from their own wants, history and nature; knows only what they could know; reacts truly — no one waits politely, no one is warm or cold by default.',
  '- agency: the words, thoughts, feelings and choices of the writer\u2019s character are never written for him; his action gets only its own immediate result; the page ends where he can act.',
  '- continuity: true to where things stand — the place, the hour, who is present, clothes, injuries, what was said; physically real; the world around them alive.',
  '- pull: the writer wants to answer it; tension and momentum; something happened that matters.',
].join('\n');

const clip = (t, n) => { const s = String(t == null ? '' : t); return s.length > n ? s.slice(0, n) + ' …' : s; };

/* M675: HIS MOVE MAY BE ONE OF THE HOUSE'S SHORTCUTS ("#p", "#pp", "#q", a bare "Go on."). What a shortcut asks is in the
 * storyteller's standing words, which the judge is not sent — so it read "#p" as his whole move and held the page's doing
 * exactly what was asked (carrying his character one beat on, skipping ahead, opening the next scene) against it. The
 * shortcut's own line is handed over beside his move (`asks`, benchrun.js judgedMoment), and the judge is told what it is. */
const SHORTCUT_RULE = 'When his move is one of the house\u2019s shortcuts, what that shortcut asks of the storyteller is given after it: judge the page as an answer to THAT, and never hold against the page what the shortcut itself asked for (a shortcut may ask it to carry his character one beat on, to skip ahead, or to open the next scene).';
const asksBlock = (asks) => (asks ? '<what his shortcut asks of the storyteller>\n' + clip(asks, 1500) + '\n</what his shortcut asks of the storyteller>' : '');

export function gradeMessages({ before = '', move = '', asks = '', notes = '', page = '' } = {}) {
  return {
    system: withFictionFrame([
      'You judge one page of a long collaborative story: a storyteller wrote it to answer the writer\u2019s move. You write nothing of the story. Judge the page against the moment it answers — the page before it, his move, and where things stand.',
      STANDARDS,
      SHORTCUT_RULE,
      'overall is your own whole judgment of the page, not the average. Be exacting: most good pages are 6 or 7.',
      'Answer only with JSON: {"prose":n,"people":n,"agency":n,"continuity":n,"pull":n,"overall":n,"why":"one sentence"}',
    ].join('\n\n')),
    user: [
      before ? '<the page before>\n' + clip(before, 5000) + '\n</the page before>' : '',
      '<his move>\n' + clip(move, 2000) + '\n</his move>',
      asksBlock(asks),
      notes ? '<where things stand>\n' + clip(notes, 3500) + '\n</where things stand>' : '',
      '<the page to judge>\n' + clip(page, 14000) + '\n</the page to judge>',
    ].filter(Boolean).join('\n\n'),
  };
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n * 10) / 10)) : null; };

export function parseGrade(raw) {
  const got = parseFirstObject(String(raw || ''), (v) => v && typeof v === 'object' && !Array.isArray(v) && num(v.overall) !== null);
  if (!got) return null;
  const scores = {};
  for (const [k] of AXES) { const n = num(got[k]); if (n !== null) scores[k] = n; }
  return { scores, overall: num(got.overall), why: typeof got.why === 'string' ? got.why.trim().slice(0, 300) : '' };
}

export function duelMessages({ before = '', move = '', asks = '', notes = '', first = '', second = '' } = {}) {
  return {
    system: withFictionFrame([
      'Two storytellers each wrote a page for the SAME moment of a long collaborative story. You write nothing of the story. Decide which page is the better next page here.',
      STANDARDS,
      SHORTCUT_RULE,
      'Judge the pages, not their length. Answer only with JSON: {"better":"A" or "B" or "same","why":"one sentence"}',
    ].join('\n\n')),
    user: [
      before ? '<the page before>\n' + clip(before, 4000) + '\n</the page before>' : '',
      '<his move>\n' + clip(move, 2000) + '\n</his move>',
      asksBlock(asks),
      notes ? '<where things stand>\n' + clip(notes, 3000) + '\n</where things stand>' : '',
      '<page A>\n' + clip(first, 12000) + '\n</page A>',
      '<page B>\n' + clip(second, 12000) + '\n</page B>',
    ].filter(Boolean).join('\n\n'),
  };
}

export function parseDuel(raw) {
  const got = parseFirstObject(String(raw || ''), (v) => v && typeof v === 'object' && typeof v.better === 'string');
  if (!got) return null;
  const b = got.better.trim().toUpperCase();
  return { better: b === 'A' ? 'A' : b === 'B' ? 'B' : 'same', why: typeof got.why === 'string' ? got.why.trim().slice(0, 300) : '' };
}

export async function gradePage({ connection, before, move, asks, notes, page, signal } = {}) {
  if (!connection || !String(page || '').trim()) return null;
  const p = gradeMessages({ before, move, asks, notes, page });
  const { text } = await callWorker(connection, { system: p.system, user: p.user, maxTokens: 1200, signal });
  return parseGrade(text);
}

/* both orders; a win only when they agree — 'x' (the first named), 'y', or 'tie' */
export async function duelPages({ connection, before, move, asks, notes, x, y, signal } = {}) {
  if (!connection || !String(x || '').trim() || !String(y || '').trim()) return null;
  const ask = async (first, second) => {
    const p = duelMessages({ before, move, asks, notes, first, second });
    const { text } = await callWorker(connection, { system: p.system, user: p.user, maxTokens: 800, signal });
    return parseDuel(text);
  };
  const one = await ask(x, y);
  const two = await ask(y, x);
  if (!one || !two) return null;
  const firstSays = one.better === 'A' ? 'x' : one.better === 'B' ? 'y' : 'tie';
  const secondSays = two.better === 'A' ? 'y' : two.better === 'B' ? 'x' : 'tie';
  return { winner: firstSays === secondSays ? firstSays : 'tie', why: one.why || two.why || '' };
}
