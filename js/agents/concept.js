/* Cozy Tavern — the brief from a #story concept (M478).
 *
 * The writer: "if the story starts with #story <concept> … it should automatically be put on the brief, and smartly
 * fix the grammar, because sometimes I just put garbled words." A tale opened on a concept had an empty brief: the
 * founder had nothing to found the world from, the seeder nothing to weigh the main character by, and the concept
 * itself sat only on page 1 — inside the forty-page window, then gone.
 *
 * Now, when a #story carries a concept and the tale's brief is EMPTY, the concept becomes the brief — the raw words
 * first, at once (so the founder and the seeder read it on this very turn), then, in the background, the same words
 * with their spelling and grammar set right by a worker: every name, number, age, power, bond and event kept exactly,
 * nothing added, nothing removed, his blunt register kept, in the third person. A polish that loses a name, or grows
 * or shrinks past reason, is refused and the raw words stand. A brief the writer already wrote is never touched. */
import { callWorker } from './call.js';
import { withFictionFrame } from './voice.js';

const SYSTEM = [
  'You copy-edit a story concept the writer typed fast into the brief of his story.',
  'RULES: fix spelling, grammar, capitalisation and punctuation; keep EVERY name, number, age, power, relationship, place and event exactly as given — never add a fact, never drop one, never soften or embellish, never comment, never ask.',
  'Write in the third person about the main character, in the writer\'s own blunt register, as one or two short paragraphs. Keep "you"/"I" that plainly mean the main character as his name or "he".',
  'Answer with the brief alone — no title, no quotes, no preface, no notes.',
].join('\n');

/* the names to keep: capitalised words that do not open a sentence (a sentence's first word may be lowercased or
 * reworded by an honest polish — "Currently" → "Right now"); a name that opens a sentence is caught by its second
 * word, or by the size rule */
function names(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(?<=[^.!?\n]\s)([A-Z][a-z]{2,})\b/g)) out.add(m[1].toLowerCase());
  return out;
}

export function acceptablePolish(concept, polished) {
  const c = String(concept || '').trim();
  const p = String(polished || '').trim();
  if (!p || /^(i cannot|i can't|as an ai|sorry)/i.test(p)) return false;
  if (p.length < c.length * 0.5 || p.length > c.length * 2.5 + 200) return false;
  const want = names(c);
  const have = new Set([...String(p).matchAll(/\b([A-Z][a-z]{2,})\b/g)].map((m) => m[1].toLowerCase()));
  for (const n of want) if (!have.has(n) && !p.toLowerCase().includes(n)) return false;
  return true;
}

export async function polishConcept({ connection, concept, signal }) {
  const raw = String(concept || '').trim();
  if (!raw) return { text: '', polished: false };
  if (!connection) return { text: raw, polished: false };
  try {
    const { text } = await callWorker(connection, { system: withFictionFrame(SYSTEM), user: raw, maxTokens: 900, signal });
    const out = String(text || '').replace(/^["“'\s]+|["”'\s]+$/g, '').trim();
    if (!acceptablePolish(raw, out)) return { text: raw, polished: false, refused: true };
    return { text: out, polished: out !== raw };
  } catch (err) {
    return { text: raw, polished: false };
  }
}
