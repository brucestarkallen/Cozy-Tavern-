/* Cozy Tavern — agents/essentials.js (M510-15)
 * THE STORY ESSENTIALS — his design: "the AI sees the Summaryception and creates a more streamlined version that's
 * coherent; the small model always sees it; if something is mentioned it uses the more detailed Summaryception".
 *
 * The keeper's record (Summaryception, M34) is the accurate memory: dense lines, only what is new, layered as it grows —
 * and it grows (eleven thousand tokens and more on a long tale). A small model cannot carry all of it, and carrying its
 * newest part hid the story's beginning. So a reader turns the WHOLE record into the story's essentials: who these people
 * are to each other, what happened in order, and what still stands — promises, debts, secrets, wounds, who knows what —
 * leaving out what no later page depends on. It is rebuilt from the record itself whenever the record changes (never
 * from its own last version, so it cannot drift from the record), and a small model reads it on every page; the record's
 * own lines come back word for word when a move names them (anchor.js recall).
 *
 * Only for a tale whose storyteller is a small model. An answer that cannot be used is asked for once more, then the
 * essentials already kept stand. A failure to reach the model throws — the queue's retries are for that. */
import { db } from '../store.js';
import { callWorker } from './call.js';

export const ESSENTIALS_KEY = (storyId) => 'essentials:' + storyId;
export const ESSENTIALS_MAX_CHARS = 10000;   /* about 2,500 tokens — the whole story, streamlined */
export const ESSENTIALS_MAX_TOKENS = 3500;
export const ESSENTIALS_TRIES = 2;

const fp = (t) => { let h = 5381; const s = String(t == null ? '' : t); for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/* the record's lines in its own order (a correction reads last), and a fingerprint of all of them */
export function recordOf(nodes) {
  const lines = (Array.isArray(nodes) ? nodes : [])
    .filter((n) => n && !n.empty && typeof n.text === 'string' && n.text.trim() && Array.isArray(n.span))
    .sort((a, b) => {
      if (Boolean(a.correction) !== Boolean(b.correction)) return a.correction ? 1 : -1;
      if (a.correction && b.correction) return (a.at || 0) - (b.at || 0);
      return (a.span[0] - b.span[0]) || ((b.level || 1) - (a.level || 1)) || ((a.at || 0) - (b.at || 0));
    });
  const upTo = lines.reduce((m, n) => (!n.correction && Number.isFinite(n.span[1]) ? Math.max(m, n.span[1]) : m), -1);
  const text = lines.map((n) => '- ' + (n.correction ? '' : '(pages ' + (n.span[0] + 1) + (n.span[1] !== n.span[0] ? '–' + (n.span[1] + 1) : '') + ') ') + n.text.trim() + (typeof n.detail === 'string' && n.detail.trim() ? ' — ' + n.detail.trim() : '')).join('\n');
  return { lines, text, upTo, print: fp(text) };
}

export function essentialsAsk({ record = '', brief = '', mc = '' } = {}) {
  const system = [
    'You keep the essentials of a long collaborative story. You are given its whole record — dense lines, oldest first, each marked with the pages it covers. Write the story\'s essentials from it: the streamlined, coherent version a storyteller needs in mind on every page.',
    'Write plain sentences under these four lines, exactly as written, each on its own line:',
    'Who they are to each other:',
    'What has happened, in order:',
    'What still stands:',
    'Where things were left:',
    '"What still stands" keeps every promise, debt, secret, wound, grudge, bond and who-knows-what a later page could depend on. Leave out what nothing later depends on.',
    'Use every person\'s name as the record spells it. Invent nothing the record does not say. At most 1,200 words. Answer with the essentials only.',
  ].join('\n');
  const user = [
    mc ? 'The main character (the writer plays him): ' + mc : '',
    brief ? 'What this story is about, in the writer\'s words:\n' + brief : '',
    'The record, oldest first:\n' + record,
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

/* the answer, read as text: no fences, no preface, clipped; too little to be essentials is refused */
export function readEssentials(raw) {
  let t = String(raw == null ? '' : raw).replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  const at = t.indexOf('Who they are to each other');
  if (at > 0) t = t.slice(at);
  if (t.length < 80 || /^[[{]/.test(t)) return '';
  return t.length > ESSENTIALS_MAX_CHARS ? t.slice(0, ESSENTIALS_MAX_CHARS - 1).trimEnd() + '…' : t;
}

export async function loadEssentials(storyId) {
  const kept = await db.settings.get(ESSENTIALS_KEY(storyId));
  return kept && typeof kept === 'object' && typeof kept.text === 'string' && kept.text ? kept : null;
}

/* one reading: when the record has changed since the essentials were made, make them again from the whole record */
export async function runEssentials({ connection, storyId, nodes, brief = '', mc = '', signal, callLLM = callWorker } = {}) {
  if (!connection || !storyId) return { wrote: false, why: 'no connection' };
  const rec = recordOf(nodes);
  if (!rec.lines.length) return { wrote: false, why: 'no record yet' };
  const kept = await loadEssentials(storyId);
  if (kept && kept.print === rec.print) return { wrote: false, why: 'unchanged' };
  const ask = essentialsAsk({ record: rec.text, brief, mc });
  let user = ask.user;
  for (let tries = 0; tries < ESSENTIALS_TRIES; tries += 1) {
    const answer = await callLLM(connection, { system: ask.system, user, maxTokens: ESSENTIALS_MAX_TOKENS, signal });
    const text = readEssentials(typeof answer === 'string' ? answer : (answer && answer.text) || '');
    if (text) {
      await db.settings.set(ESSENTIALS_KEY(storyId), { text, print: rec.print, upTo: rec.upTo, at: Date.now() });
      return { wrote: true };
    }
    user = ask.user + '\n\nYour last answer was not the essentials asked for. Answer with the essentials only, under the four lines.';
  }
  return { wrote: false, why: 'its answer could not be used' };
}
