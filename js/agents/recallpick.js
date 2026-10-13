/* Cozy Tavern — agents/recallpick.js (M510-50)
 * SMART RECALL — his word: "recall matches words; 'uncle' won't bring back a line that only says 'attendant'. Can the AI
 * smartly think: Bruce probably means this from the record, so I should inject it — smart, yet careful?"
 * The word-match recall (M344) stands. Beside it, before each page whose request does not carry the whole record (a small
 * storyteller's, or a record longer than the context holds), a worker reads HIS move and the last page against what the
 * page already has of the story (the helper's story in short and the record lines the request carries — M750: it was the
 * Essentials, retired) and an index of the older record lines the request does not carry — each by number, its pages and
 * literal source excerpts, including separate detail — and names the lines the next page needs that what it has does not
 * give: who was told what, exact words, a promise, an identity, a plan's detail.
 * Careful, by construction: it only NAMES lines; what rides is the record's own line, word for word — nothing it writes
 * reaches the storyteller. A number that is not in the index is ignored; at most PICK_MAX lines; and it waits at most
 * PICK_TIMEOUT_MS — slower, failing, or unsure, and the page goes with the word-match recall alone, as before. */
import { contextOf } from '../providers/room.js';
import { sceneWordsOf } from '../engine/world.js';
import { recordId, recordPrint } from '../assemble/selection.js';
import { callWorker, workerConnection } from './call.js';
import { measureTransport } from '../providers/measure.js';
import { inputRoom } from '../assemble/budget.js';
import { parseFirstObject } from './jsonutil.js'; /* M608 */

export const PICK_MAX = 4;
export const PICK_TIMEOUT_MS = 8000;
export const PICK_HEAD_CHARS = 220;
/* M750: what the page already has, as the picker reads it — the newest of it when it is long (an index needs the room) */
export const PICK_KNOWN_CHARS = 24000;
export function knownTail(text, cap = PICK_KNOWN_CHARS) {
  const t = String(text == null ? '' : text).trim();
  if (t.length <= cap) return t;
  const cut = t.slice(t.length - cap);
  const at = cut.indexOf('\n- ');
  return '(older lines it has are not shown here)\n' + (at !== -1 && at < cap / 2 ? cut.slice(at + 1) : cut);
}

/* the older lines, numbered from 1, oldest first — each by its pages and opening words */
const cueCache = new Map();
function sourceSentences(n) {
  const key = recordId(n) + ':' + recordPrint(n);
  if (cueCache.has(key)) return cueCache.get(key);
  const parts = [...new Set((n.text + '\n' + (n.detail || '')).split(/(?<=[.!?;])\s+|\n+/).filter(Boolean).flatMap(t => { const chunks = []; let part = ''; for (const word of t.split(/\s+/)) { if (part.length + word.length > 280 && part) { chunks.push(part); part = ''; } part += (part ? ' ' : '') + word; } if (part) chunks.push(part); return chunks; }))];
  if (cueCache.size > 4000) cueCache.clear();
  cueCache.set(key, parts); return parts;
}
export function recallIndex(nodes, { skip = () => false, move = '', lastPage = '', cap = 18000 } = {}) {
  const scene = sceneWordsOf([move,lastPage]);
  const rows = (nodes || []).filter(n => n && !n.empty && !n.correction && n.text?.trim() && Array.isArray(n.span) && !skip(n)).map(n => {
    const parts = sourceSentences(n);
    const score = t => [...sceneWordsOf([t])].filter(w => scene.has(w)).length;
    const ranked = parts.map((text,i) => ({ text,i,score:score(text) })).sort((a,b) => b.score - a.score || a.i - b.i);
    const useful = new Set([0,parts.length - 1,...ranked.slice(0,3).map(p => p.i)]);
    // Literal source cues, labelled excerpts. They select IDs and never become facts.
    const cues = [...useful].sort((a,b) => a-b).map(i => parts[i]?.slice(0,300) || '').join(' | ');
    return { id: recordId(n), from: n.span[0] + 1, to: n.span[1] + 1, head: cues, score: ranked[0]?.score || 0 };
  }).sort((a,b) => b.score - a.score || b.to - a.to);
  const chosen = []; let used = 0;
  for (const r of rows) { const cost = r.head.length + 80; if (used + cost > cap) continue; chosen.push(r); used += cost; }
  return chosen.sort((a,b) => a.from - b.from).map((r,i) => ({ ...r,n:i+1 }));
}

export function pickAsk({ known = '', index = [], move = '', lastPage = '', mc = '' } = {}) {
  const who = mc ? mc : 'the main character';
  const system = [
    'You pick the older record lines of a long collaborative story that the NEXT page needs. You write nothing of the story.',
    'You are given what the next page already has of the story (the story in short and the record lines it carries word for word), an index of the older record lines it does not have — each by number, its pages and literal source excerpts, including separate detail — the last page, and the writer\'s newest move.',
    'Name the older lines whose details the next page needs and what it already has does not give: who was told what and by whom, the exact words of a promise or a lie, an identity or a title and who knows it, a debt, a wound, a plan\'s detail. Think about what the move means, not only the words it uses: a question about a family tie may need the line where ' + who + '\'s standing was told; a name said may need the line where that person last dealt with ' + who + '.',
    'Pick none rather than guess. At most ' + PICK_MAX + '.',
    'Answer with ONLY this JSON: {"lines":[numbers]} — for example {"lines":[3,17]} or {"lines":[]}.',
  ].join('\n');
  const user = [
    'WHAT THE NEXT PAGE ALREADY HAS:', knownTail(known) || '(nothing yet)', '',
    'THE OLDER RECORD LINES IT DOES NOT HAVE:', index.map((x) => x.n + '. (pages ' + x.from + '–' + x.to + ') ' + x.head).join('\n') || '(none)', '',
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
export async function pickRecall({ connection, known = '', nodes = [], move = '', lastPage = '', mc = '', skip, signal, timeoutMs = PICK_TIMEOUT_MS, callLLM = callWorker } = {}) {
  if (!connection) return { ids: [], why: 'no connection' };
  if (signal?.aborted) return { ids: [], why: 'cancelled' };
  const helper = workerConnection(connection,{maxTokens:200});
  const shell = pickAsk({known,move,lastPage,mc});
  const measure = measureTransport(helper,{system:shell.system,messages:[{role:'user',content:shell.user}]});
  const helperRoom = Math.max(0,Math.floor((inputRoom({budgetTokens:contextOf(helper),answerTokens:measure.answerTokens}) - measure.inputTokens)*3) - 600);
  const index = recallIndex(nodes, { skip, move, lastPage, cap: Math.min(24000, helperRoom) });
  if (index.length < 2) return { ids: [], why: 'too few older lines' };
  const ask = pickAsk({ known, index, move, lastPage, mc });
  const ctl = new AbortController();
  let timer = null;
  let cancelResolve;
  const cancelled = new Promise(resolve => { cancelResolve = resolve; });
  const cancel = () => {ctl.abort(); cancelResolve({cancelled:true});};
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const answer = await Promise.race([
      cancelled,
      callLLM(connection, { system: ask.system, user: ask.user, maxTokens: 200, signal: ctl.signal }),
      new Promise((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve({ timedOut: true }); }, Math.max(500, timeoutMs)); }),
    ]);
    if (answer?.cancelled) return {ids:[],why:'cancelled',calls:1,inputChars:ask.system.length+ask.user.length};
    if (answer && answer.timedOut) return { ids: [], why: 'took too long',calls:1,inputChars:ask.system.length+ask.user.length };
    const text = typeof answer === 'string' ? answer : (answer && answer.text) || '';
    const picked = readPick(text, index.length);
    return { ids: picked.map((n) => index[n - 1].id), why: picked.length ? 'picked' : 'no usable selection', indexed: index.length, inputChars: ask.system.length + ask.user.length, outputChars: text.length, calls: 1 };
  } catch (err) {
    return { ids: [], why: 'could not ask' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
