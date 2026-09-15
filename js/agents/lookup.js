/* Cozy Tavern — agents/lookup.js
 * M259: A WORKER THAT CAN LOOK.
 *
 * The writer asked why the workers are cut off at a fixed number of
 * characters, when the housekeeper can simply ask for what it needs. There
 * is no good answer: a limit decides ahead of time what a reader may never
 * see. So the auditor, the extractor and the world agent are handed a view
 * that fits (the whole ledger, the whole record, the newest pages whole, an
 * index of the rest) and may ASK for anything else — any page whole by its
 * number, every page that holds some words, the writer's whole brief — in
 * the housekeeper's own words (<fetch>[…]</fetch>), served by the
 * housekeeper's own server (agents/housekeeper.js serveFetch). One way to
 * look, for everyone who reads the story.
 */

import { callWorker } from './call.js';
import { db } from '../store.js';
import { loadMemory } from './memory.js';
import { parseFetchRefs, serveFetch } from './housekeeper.js';

export const WORKER_FETCH_ROUNDS = 3;

/* The <fetch> refs in a worker's answer, and whether a block was there at all. */
export function fetchRefsIn(text) {
  const refs = [];
  let blocks = 0;
  for (const m of String(text || '').matchAll(/<fetch>([\s\S]*?)(?:<\/fetch>|$)/gi)) {
    blocks += 1;
    refs.push(...parseFetchRefs(m[1]));
  }
  return { refs, blocks };
}

/* The words every looking worker is given. `when` says when this worker
 * should look; `rounds` how often it may. */
export function fetchLaw({ rounds = WORKER_FETCH_ROUNDS, when = '' } = {}) {
  return [
    'YOU CAN LOOK. What you are shown is not all there is: every page of the story, the writer\'s whole',
    'brief and cast notes, and every page that holds some words can be served to you whole. To ask,',
    'answer with ONLY a fetch block and nothing else:',
    '  <fetch>["12", "find: Caleb", "brief"]</fetch>',
    '  "12" (or a page\'s #code) — that page, first word to last; "find: WORDS" — every page that holds',
    '  those words, newest first, with the numbers to fetch them by; "brief" / "cast" — the writer\'s',
    '  own words, whole.',
    when || 'Look when something you must judge rests on a page or a passage you were not shown whole.',
    'You may look ' + (rounds === 1 ? 'once' : 'up to ' + rounds + ' times') + '; then answer in the form asked for.',
  ].join('\n');
}

/* What the server needs, read only when a look is asked for. */
function lazySource({ storyId = '', messages = null, memory = null, story = null } = {}) {
  let held = null;
  return async () => {
    if (held) return held;
    let msgs = Array.isArray(messages) ? messages : [];
    if (!Array.isArray(messages) && storyId) { try { msgs = await db.messages.list(storyId); } catch (err) { msgs = []; } }
    let mem = memory;
    if (!mem && storyId) { try { mem = await loadMemory(storyId); } catch (err) { mem = null; } }
    let tale = story;
    if (!tale && storyId) { try { tale = await db.stories.get(storyId); } catch (err) { tale = null; } }
    held = { messages: msgs, memory: mem, story: tale };
    return held;
  };
}

/* One worker question, with its looks. `isAnswer(text)` says whether an
 * answer is final (a final answer is never held up by a stray fetch).
 * `leash(size)` the leash each call asks for; `room` how many characters
 * the whole conversation may grow to. Returns the last call's
 * {text, finishReason, …} plus `looked` (every ref served). */
export async function askWithFetch(connection, {
  system, user, maxTokens, signal, renew, leash, isAnswer, source = {},
  rounds = WORKER_FETCH_ROUNDS, room = Infinity, effort, temperature,
} = {}) {
  const convo = [{ role: 'user', content: String(user || '') }];
  const load = lazySource(source);
  const looked = [];
  let served = 0;
  let toldToAnswer = false;
  let toldUnreadable = false;
  for (;;) {
    const size = String(system || '').length + convo.reduce((n, m) => n + String(m.content || '').length, 0);
    if (typeof renew === 'function') renew(typeof leash === 'function' ? leash(size) : undefined);
    const res = await callWorker(connection, { system, messages: convo, maxTokens, signal, effort, temperature });
    const text = String(res.text || '');
    if (toldToAnswer || (typeof isAnswer === 'function' && isAnswer(text))) return { ...res, looked, rounds: served };
    const { refs, blocks } = fetchRefsIn(text);
    if (!blocks) return { ...res, looked, rounds: served };
    convo.push({ role: 'assistant', content: text });
    if (!refs.length) {
      if (toldUnreadable) return { ...res, looked, rounds: served };
      toldUnreadable = true;
      convo.push({ role: 'user', content: 'Your <fetch> block could not be read. It holds page numbers or #codes, "find: WORDS", "brief" or "cast" only — like <fetch>["12", "find: Caleb"]</fetch>. Ask again that way, or answer in the form asked for.' });
      continue;
    }
    const { messages, memory, story } = await load();
    const shown = serveFetch(refs, messages, { memory, story, room: Math.max(4000, (Number.isFinite(room) ? room : Infinity) - size) });
    looked.push(...refs);
    served += 1;
    if (served >= rounds) {
      toldToAnswer = true;
      convo.push({ role: 'user', content: 'What you asked for, whole:\n\n' + shown + '\n\nThat is everything you may look at. Answer now, in the form asked for — no more <fetch>.' });
    } else {
      convo.push({ role: 'user', content: 'What you asked for, whole:\n\n' + shown + '\n\nAnswer now in the form asked for — or <fetch> again if you still need something.' });
    }
  }
}
