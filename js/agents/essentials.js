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
/* M510-16: the same room the record's newest lines had (M510-14, about 4,000 tokens) — now spent on the whole story */
export const ESSENTIALS_MAX_CHARS = 16000;   /* about 4,000 tokens — the whole story, streamlined */
export const ESSENTIALS_MAX_TOKENS = 5000;
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

/* M510-21: HIS FORMAT — THE RECORD'S OWN, TOLD SHORTER. He: "make the essentials literally the same format as the original
 * fold, but much more concise — cut what is unimportant (talking to the postman, a crowd saying something), keep the time
 * and the place, because time and place make a story coherent; like human memory: everything still there, much more
 * coherent and efficient; and when something is mentioned, the detailed line comes back." So the essentials are record
 * lines — "[Sept 1, 08:24 · the Wells kitchen] (pages 3–9) Orrin Vale did X → Tamsin Hale did Y; …" — one line standing for a
 * stretch that belongs together, oldest first. (M510-15 wrote four headed sections instead.) */
export function essentialsAsk({ record = '', brief = '', mc = '' } = {}) {
  const system = [
    'You condense the record of a long collaborative story into its essentials: the same record, told again shorter — the way a person remembers a story, with everything that matters still there.',
    'You are given the whole record, oldest first. Each line stands for a stretch of pages: a prefix with its time and place, like "[Sept 1, 08:24 · the Wells kitchen]", then short phrases separated by semicolons.',
    'Write the essentials in THE SAME FORMAT: lines, oldest first, one per line, each opening with its time-and-place prefix and the pages it stands for, then short phrases separated by semicolons — "[Sept 1, 08:24 · the Wells kitchen] (pages 3–9) Orrin Vale did X → Tamsin Hale did Y; …".',
    'One essentials line may stand for several record lines that belong together — one scene, one stretch of days; its prefix is where and when that stretch began, and its pages run from the first to the last.',
    'Cut what nothing later depends on: small talk, errands, passers-by and crowds, weather and atmosphere, repeated reactions.',
    'Keep, always: decisions and what caused them (→), who did what to whom, promises, oaths and threats (their exact words in "double quotes", 15 words at most), debts, secrets and who knows them, wounds, bonds and grudges, first meetings and first times, and every correction — written as the fact now stands.',
    'Names, never pronouns, spelled as the record spells them. Invent nothing the record does not say.',
    'At most 2,000 words — far fewer while the story is young. Answer with the lines only.',
  ].join('\n');
  const user = [
    mc ? 'The main character (the writer plays him): ' + mc : '',
    brief ? 'What this story is about, in the writer\'s words:\n' + brief : '',
    'The record, oldest first:\n' + record,
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

/* the answer, read as lines: no fences, no preface before the first line, clipped at a line's end; too little to be the
 * essentials — or no line at all — is refused */
export function readEssentials(raw) {
  const t = String(raw == null ? '' : raw).replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  if (/^[[{]\s*["{\]]/.test(t)) return '';
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines.findIndex((l) => /^(?:[-*•]\s*)?\[/.test(l) || /^(?:[-*•]\s*)?\(pages?\s/i.test(l));
  if (first === -1) return '';
  const kept = lines.slice(first).map((l) => (/^[-*•]\s*/.test(l) ? '- ' + l.replace(/^[-*•]\s*/, '') : '- ' + l));
  let text = kept.join('\n');
  if (text.length < 80) return '';
  if (text.length > ESSENTIALS_MAX_CHARS) { const cut = text.lastIndexOf('\n', ESSENTIALS_MAX_CHARS); text = text.slice(0, cut > 0 ? cut : ESSENTIALS_MAX_CHARS); }
  return text;
}

export async function loadEssentials(storyId) {
  const kept = await db.settings.get(ESSENTIALS_KEY(storyId));
  return kept && typeof kept === 'object' && typeof kept.text === 'string' && kept.text ? kept : null;
}

/* one reading: when the record has changed since the essentials were made, make them again from the whole record */
export async function runEssentials({ connection, storyId, nodes, brief = '', mc = '', signal, callLLM = callWorker, force = false } = {}) {
  if (!connection || !storyId) return { wrote: false, why: 'no connection' };
  const rec = recordOf(nodes);
  if (!rec.lines.length) return { wrote: false, why: 'no record yet' };
  const kept = await loadEssentials(storyId);
  if (kept && kept.print === rec.print && !force) return { wrote: false, why: 'unchanged' }; /* final audit: made again by hand, whatever the print */
  const ask = essentialsAsk({ record: rec.text, brief, mc });
  let user = ask.user;
  for (let tries = 0; tries < ESSENTIALS_TRIES; tries += 1) {
    const answer = await callLLM(connection, { system: ask.system, user, maxTokens: ESSENTIALS_MAX_TOKENS, signal });
    const text = readEssentials(typeof answer === 'string' ? answer : (answer && answer.text) || '');
    if (text) {
      await db.settings.set(ESSENTIALS_KEY(storyId), { text, print: rec.print, upTo: rec.upTo, at: Date.now() });
      return { wrote: true };
    }
    user = ask.user + '\n\nYour last answer was not the essentials asked for. Answer with the lines only, each opening with its time-and-place prefix.';
  }
  return { wrote: false, why: 'its answer could not be used' };
}
