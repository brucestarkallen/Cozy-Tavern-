/* Cozy Tavern — agents/scribe.js
 * The scribe (M12). After each finished turn — background only, riding the
 * worker channel behind the extractor — the scribe reads the turn pair
 * (what the writer wrote, what the storyteller answered) and proposes
 * sparse JSON deltas for the character ledger (engine/people.js): who each
 * person is, where they are, how things stand, and which loose ends stay
 * open.
 *
 * The scribe only PROPOSES; the merge code in people.js is the law: names
 * resolve against the known cast (bounded Levenshtein), a note meant for
 * "you" lands on the main character's record, the main character's core
 * and arc are never written, and one person's words are never copied into
 * another's entry.
 *
 * Unlike the never-throw workers, scribeTurn THROWS on transport failure
 * (it rides agents/queue.js, which retries with backoff and keeps the chat
 * path safe — the queue is the boundary that never throws). A response
 * that asks for patience (Retry-After on a 429/503) is honored: the error
 * carries retryAfterMs for the queue's backoff (M28: providers/wire.js).
 */

import { firstBalancedObject } from './jsonutil.js';
import { loadState, saveState, notify } from '../engine/state.js';
import { mergeDeltas, renderPeopleTiers } from '../engine/people.js';
import { withFictionFrame } from './voice.js'; /* M21: the workers never break the fiction */
import { callWorker } from './call.js'; /* M28: the one wire path for workers */
import { retryAfterMs } from '../providers/wire.js'; /* M28: moved to the wire; re-exported for the harness contract */
export { retryAfterMs };

const MAX_TOKENS = 600; /* sparse deltas; thinking is off on the wire (M28) */

/* ---------- the prompt (human-voiced, kept in the code) ---------- */

const SYSTEM_PROMPT = [
  'You keep the character pages of a slow, warm story told between two writers.',
  'After each page is finished, you update — sparsely, only where something truly',
  'shifted — the ledger that remembers who each person is.',
  '',
  'Answer with JSON ONLY, in exactly this shape:',
  '{"deltas":[ ... ]}',
  '',
  'Each delta is {"name":"Mira","field":"state","text":"…"} where field is one of:',
  '  core   — their stable nature: voice, tells, what never really changes.',
  '           Write it rarely, only when the prose truly shows it.',
  '  state  — where they are and how they are doing, RIGHT NOW. Lead with',
  '           the place. Rewrite it when they move or their condition turns.',
  '  arc    — how they stand with the main character, and WHY it moved.',
  '           Only when something on the page moved it, and name the beat.',
  '  thread — one open loose end ("she still owes the ferryman"). Only what',
  '           the page left genuinely open.',
  '  unthread — a loose end that closed, worded as it was written before.',
  '',
  'The law of the desk:',
  '  - Only what the prose explicitly shows. When unsure, omit. Most turns',
  '    change nothing: {"deltas":[]} is a good and honest answer.',
  '  - Never write one person’s doings into another’s page.',
  '  - The main character is record-only: only their state and threads are',
  '    ever written — never their core, never their arc. Notes about "you"',
  '    belong to the main character’s record.',
  '  - Keep each note to a sentence or two. Names keep the spelling the',
  '    prose uses.',
  '',
  'No commentary, no markdown fences: the JSON object only.',
].join('\n');

/* Exported for the harness: the two messages any provider flavor receives. */
export function buildScribeMessages({ state, userText, assistantText }) {
  const ledger = renderPeopleTiers(state, { recentPages: [] });
  const user = [
    'Here is what the character pages currently say:',
    ledger && ledger.text ? ledger.text : 'Nothing is written on the character pages yet.',
    '',
    'The writer just wrote:',
    '"""',
    String(userText || '').slice(0, 4000),
    '"""',
    '',
    'And the storyteller answered:',
    '"""',
    String(assistantText || '').slice(0, 8000),
    '"""',
    '',
    'What shifted on the character pages, if anything? JSON only.',
  ].join('\n');
  return { system: withFictionFrame(SYSTEM_PROMPT), user };
}

/* ---------- the tolerant parser ---------- */

/* Exported for the harness. Fences stripped, first balanced object parsed,
 * deltas kept only if they're objects with a string name, field and text.
 * Any trouble at all resolves to {deltas:[]}. */
export function parseScribeAnswer(raw) {
  try {
    let text = String(raw || '');
    text = text.replace(/```(?:json|JSON)?/g, '');
    const candidate = firstBalancedObject(text);
    if (!candidate) return { deltas: [] };
    const parsed = JSON.parse(candidate);
    const list = parsed && Array.isArray(parsed.deltas) ? parsed.deltas : [];
    const deltas = list.filter(
      (d) => d && typeof d === 'object'
        && typeof d.name === 'string' && d.name.trim()
        && typeof d.field === 'string' && d.field.trim()
        && typeof d.text === 'string' && d.text.trim()
    );
    return { deltas };
  } catch (err) {
    return { deltas: [] };
  }
}

/* ---------- the provider calls (non-streaming, small, cold) ---------- */

/* ---------- the contract ---------- */

/* Read one finished turn and write what shifted onto the character pages.
 * Resolves {changes, dropped} (possibly both empty), or null when there was
 * nothing to read. Throws ONLY on transport failure — the queue retries;
 * a garbled answer is just {deltas:[]} and merges into nothing. `stale`
 * (from the queue) is checked before anything is written: a turn whose
 * story was left behind teaches the ledger nothing. */
export async function scribeTurn({ connection, storyId, userText, assistantText, signal, stale } = {}) {
  if (!connection || typeof connection !== 'object') return null;
  if (!storyId) return null;
  if (!assistantText || !String(assistantText).trim()) return null;

  const before = await loadState(storyId);
  const prompt = buildScribeMessages({ state: before, userText, assistantText });
  /* M28: the one wire path — thinking off per house, temperature 0; a
   * transport failure throws (with retryAfterMs when the house named a wait)
   * and the queue retries. */
  const { text: raw } = await callWorker(connection, {
    system: prompt.system,
    user: prompt.user,
    maxTokens: MAX_TOKENS,
    effort: 'off',
    signal,
  });
  const { deltas } = parseScribeAnswer(raw);
  if (!deltas.length) return { changes: [], dropped: [] };

  if (stale && stale()) return null; /* the writer has moved on — discard */

  /* Re-read at write time — the ledger may have been touched by hand while
   * the scribe was reading. */
  const fresh = await loadState(storyId);
  const { characters, changes, dropped } = mergeDeltas(fresh, fresh.characters, deltas, (fresh.turn || 0) + 1);
  if (!changes.length) return { changes, dropped };
  if (stale && stale()) return null;
  await saveState(storyId, { ...fresh, characters });
  notify(storyId);
  return { changes, dropped };
}
