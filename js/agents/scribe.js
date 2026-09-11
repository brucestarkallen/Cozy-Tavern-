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
import { renderPeopleTiers } from '../engine/people.js';
import { applyMutations } from '../engine/apply.js'; /* M72: the scribe writes through the journal */
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
  '  A real person or a character from an established canon is written from the REAL RECORD —',
  '  their true name, family, role and known history — never a made-up version; invent only',
  '  where the record is silent.',
  '           Only when something on the page moved it, and name the beat.',
  '  thread — one open loose end ("she still owes the ferryman"). Only what',
  '           the page left genuinely open.',
  '  unthread — a loose end that closed, worded as it was written before.',
  '',
  'CHARACTER GRAVITY (M54 — the writer’s own law, for every page you keep):',
  '  - STACK: new feelings ADD to old — humiliation + intrigue + fury coexist; cruel + fascinated',
  '    is MORE dangerous, never nicer. A page that replaces a feeling with its opposite is drift.',
  '  - ROUTE: a feeling is written in THIS person’s native language — a sadist’s respect is',
  '    obsession, never warmth; a proud man’s gratitude is gruff; a paranoid reads a debt as a leash.',
  '  - VELOCITY: one scene, one degree. Real change costs several scenes with proportional cause;',
  '    fascination can begin in one fight and cannot complete in one. An arc that jumps is drift.',
  '  - RECALL: before writing anyone’s page, re-read their core and their last state — "ruthless"',
  '    is still ruthless at turn 40.',
  '  - A PERSON IS NOT THEIR CORE: range inside a character is not drift — the stoic tender about',
  '    one thing, the cruel man with a private code, the warm one who goes flat at a specific line.',
  '    Record the contradiction as theirs; never flatten a person to one adjective.',
  '  - DEFEAT IS NOT REDEMPTION: losing does not ennoble. A public defeat stacks humiliation onto the',
  '    core and routes through it — resentment, excuses, face-recovery, softer targets, "he cheated".',
  '    "Honorable in defeat" or "grudgingly impressed" needs a core that says so; otherwise it festers.',
  '  - GOALS PERSIST: a want survives a setback as a change of tactic, never as deletion. A goal dies',
  '    only when motivation, resources and allies are ALL gone.',
  '',
  'The law of the desk:',
  '  - PASSERS-THROUGH GET NO PAGE: a driver, a clerk, a waiter, a guard at a door, a face in a',
  '    crowd — anyone who served a function once, with no name or a throwaway one, no bond with',
  '    the main character and no want of their own — is scene texture, not a person to keep.',
  '    Write them a page only when the story gives them a want, a bond, or a second scene.',
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
/* The page the applier wrote lands as "<key> — … was noted"; the key is the
 * ledger's own spelling of the name (the persona redirect, a typo mended). */
function nameFromWords(words, fallback) {
  const at = String(words || '').indexOf(' — ');
  return at > 0 ? words.slice(0, at) : String(fallback || '').trim();
}

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
  /* M72: every delta is a journaled write (people.note) — the fold used to
   * lose the scribe's pages because they were merged past the journal. The
   * merge laws are the applier's now (engine/apply.js → mergeDeltas). */
  const { state: next, applied, rejected } = applyMutations(fresh, deltas.map((d) => ({ type: 'people.note', name: d.name, field: d.field, text: d.text })));
  const changes = applied.map((a) => ({ name: nameFromWords(a.words, a.mutation.name), field: a.mutation.field }));
  const dropped = rejected.map((r) => ({ delta: r.mutation, why: r.why }));
  if (!changes.length) return { changes, dropped };
  if (stale && stale()) return null;
  await saveState(storyId, next);
  notify(storyId);
  return { changes, dropped };
}
