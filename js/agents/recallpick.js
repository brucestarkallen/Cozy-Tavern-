/* Cozy Tavern — agents/recallpick.js (M510-50)
 * SMART RECALL — his word: "recall matches words; 'uncle' won't bring back a line that only says 'attendant'. Can the AI
 * smartly think: Bruce probably means this from the record, so I should inject it — smart, yet careful?"
 * The word-match recall (M344) stands. Beside it, before each page of a story whose essentials exist, a worker reads HIS
 * move and the last page against the story's timeline (the essentials) and an index of the older record lines — each by
 * number, its pages and its opening words — and names the lines the next page needs that the timeline alone does not
 * give: who was told what, exact words, a promise, an identity, a plan's detail.
 * Careful, by construction: it only NAMES lines; what rides is the record's own line, word for word — nothing it writes
 * reaches the storyteller. A number that is not in the index is ignored; at most PICK_MAX lines; and it waits at most
 * PICK_TIMEOUT_MS — slower, failing, or unsure, and the page goes with the word-match recall alone, as before. */
import { callWorker } from './call.js';
import { parseFirstObject } from './jsonutil.js'; /* M608 */

export const PICK_MAX = 4;
export const PICK_TIMEOUT_MS = 8000;
export const PICK_HEAD_CHARS = 220;

/* the older lines, numbered from 1, oldest first — each by its pages and opening words */
export function recallIndex(nodes, { skip = () => false } = {}) {
  return (Array.isArray(nodes) ? nodes : [])
    .filter((n) => n && !n.empty && !n.correction && typeof n.text === 'string' && n.text.trim() && Array.isArray(n.span) && !skip(n))
    .sort((a, b) => a.span[0] - b.span[0])
    .map((n, i) => {
      const flat = n.text.replace(/\s+/g, ' ').trim();
      return { n: i + 1, id: n.id, from: n.span[0] + 1, to: n.span[1] + 1, head: flat.length > PICK_HEAD_CHARS ? flat.slice(0, PICK_HEAD_CHARS - 1).trimEnd() + '…' : flat };
    });
}

export function pickAsk({ essentials = '', index = [], move = '', lastPage = '', mc = '' } = {}) {
  const who = mc ? mc : 'the main character';
  const system = [
    'You pick the older record lines of a long collaborative story that the NEXT page needs. You write nothing of the story.',
    'You are given the story\'s timeline (its essentials), an index of the older record lines — each by number, its pages and its opening words — the last page, and the writer\'s newest move.',
    'Name the lines whose details the next page needs and the timeline alone does not give: who was told what and by whom, the exact words of a promise or a lie, an identity or a title and who knows it, a debt, a wound, a plan\'s detail. Think about what the move means, not only the words it uses: a question about a family tie may need the line where ' + who + '\'s standing was told; a name said may need the line where that person last dealt with ' + who + '.',
    'Pick none rather than guess. At most ' + PICK_MAX + '.',
    'Answer with ONLY this JSON: {"lines":[numbers]} — for example {"lines":[3,17]} or {"lines":[]}.',
  ].join('\n');
  const user = [
    'THE TIMELINE (the story\'s essentials):', String(essentials || '').trim() || '(none yet)', '',
    'THE OLDER RECORD LINES:', index.map((x) => x.n + '. (pages ' + x.from + '–' + x.to + ') ' + x.head).join('\n') || '(none)', '',
    'THE LAST PAGE:', String(lastPage || '').trim().slice(-4000) || '(none)', '',
    'THE WRITER\'S NEWEST MOVE:', String(move || '').trim() || '(none)',
  ].join('\n');
  return { system, user };
}

/* the numbers it named — only those in the index, each once, at most PICK_MAX; anything unreadable is none */
export function readPick(raw, count) {
  const t = String(raw == null ? '' : raw).replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  let list = null;
  /* M608: read as every helper's answer is — it was parsed strictly from the first brace to the last, so a thought or a
   * stray brace beside {"lines":[…]} lost the pick and the page went without the lines it needed */
  { const j = parseFirstObject(t, (x) => Array.isArray(x.lines)); if (j) list = j.lines; }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= count && !out.includes(n)) out.push(n);
    if (out.length >= PICK_MAX) break;
  }
  return out;
}

/* never throws: { ids, why } — ids of the nodes it named, [] when it could not (slow, failing, unsure) */
export async function pickRecall({ connection, essentials = '', nodes = [], move = '', lastPage = '', mc = '', skip, timeoutMs = PICK_TIMEOUT_MS, callLLM = callWorker } = {}) {
  if (!connection) return { ids: [], why: 'no connection' };
  const index = recallIndex(nodes, { skip });
  if (index.length < 2) return { ids: [], why: 'too few older lines' };
  const ask = pickAsk({ essentials, index, move, lastPage, mc });
  const ctl = new AbortController();
  let timer = null;
  try {
    const answer = await Promise.race([
      callLLM(connection, { system: ask.system, user: ask.user, maxTokens: 200, signal: ctl.signal }),
      new Promise((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve({ timedOut: true }); }, Math.max(500, timeoutMs)); }),
    ]);
    if (answer && answer.timedOut) return { ids: [], why: 'took too long' };
    const text = typeof answer === 'string' ? answer : (answer && answer.text) || '';
    const picked = readPick(text, index.length);
    return { ids: picked.map((n) => index[n - 1].id), why: picked.length ? 'picked' : 'none needed' };
  } catch (err) {
    return { ids: [], why: 'could not ask' };
  } finally {
    clearTimeout(timer);
  }
}
