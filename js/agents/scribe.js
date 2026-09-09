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
 * carries retryAfterMs for the queue's backoff.
 */

import { firstBalancedObject } from './jsonutil.js';
import { loadState, saveState, notify } from '../engine/state.js';
import { mergeDeltas, renderPeopleTiers } from '../engine/people.js';

const MAX_TOKENS = 600;
const TEMPERATURE = 0;

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
  return { system: SYSTEM_PROMPT, user };
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

/* The Retry-After header, in seconds (or an HTTP date — rounded up). 0
 * when the house didn't ask for anything. */
export function retryAfterMs(headers) {
  try {
    const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null;
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
    const when = Date.parse(raw);
    return Number.isFinite(when) ? Math.max(0, when - Date.now()) : 0;
  } catch (err) {
    return 0;
  }
}

/* A failed call throws — carrying the house's requested wait when it named
 * one — so the queue's retry schedule can do its work. */
function transportError(res) {
  const err = new Error(res.status === 429 ? 'too many asks' : 'the house said no (' + res.status + ')');
  const wait = retryAfterMs(res.headers);
  if (wait > 0) err.retryAfterMs = wait;
  return err;
}

async function callAnthropic(connection, prompt, signal) {
  const base = (connection.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': connection.apiKey || '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: connection.model || 'claude-sonnet-4-5',
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: prompt.system,
      messages: [
        { role: 'user', content: prompt.user },
        /* the prefill: the answer must begin mid-JSON */
        { role: 'assistant', content: '{' },
      ],
    }),
  });
  if (!res.ok) throw transportError(res);
  const body = await res.json();
  const piece = body && Array.isArray(body.content)
    ? body.content.find((b) => b && b.type === 'text' && typeof b.text === 'string')
    : null;
  /* the prefill's "{" belongs back on the front of the answer */
  return piece ? '{' + piece.text : '';
}

async function callOpenAI(connection, prompt, signal) {
  const base = (connection.baseUrl || 'https://api.openai.com')
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
  const headers = { 'content-type': 'application/json' };
  if (connection.apiKey) headers.authorization = `Bearer ${connection.apiKey}`;
  const payload = {
    model: connection.model || 'gpt-4o-mini',
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  };
  /* response_format json_object is an OpenAI-house knob; OpenRouter and
   * custom servers may not know it, so only api.openai.com gets it — the
   * tolerant parser carries the rest. */
  if (base.includes('api.openai.com')) {
    payload.response_format = { type: 'json_object' };
  }
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw transportError(res);
  const body = await res.json();
  const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
  const text = choice && choice.message && choice.message.content;
  return typeof text === 'string' ? text : '';
}

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
  let raw;
  if (connection.type === 'anthropic') {
    raw = await callAnthropic(connection, prompt, signal);
  } else if (connection.type === 'openai') {
    raw = await callOpenAI(connection, prompt, signal);
  } else {
    return null;
  }
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
