/* Cozy Tavern — agents/extractor.js
 * The extractor: a quiet background worker that reads each finished page —
 * what the writer wrote and what the storyteller answered — and proposes
 * scene-state mutations in the closed v1 vocabulary. It runs AFTER the
 * stream completes, never on the critical path, and it never throws into
 * the chat path: any failure, any garbled answer, resolves {mutations:[]}.
 *
 * Contract (SPEC.md M3):
 *   extractTurn({connection, state, userText, assistantText, signal})
 *     -> {mutations:[...]} | {mutations:[]} on any failure
 *
 * Provider specifics: anthropic gets an assistant prefill of "{" to force
 * JSON; openai gets response_format json_object — but only when the address
 * really is api.openai.com (OpenRouter and custom servers may not know that
 * knob); everywhere else we rely on the prompt plus a tolerant parser.
 * max_tokens ~400, temperature 0.
 *
 * Also living here: the in-flight tracker. chat.js notes each extraction it
 * fires; the send path awaits pendingExtraction(storyId, 5000) before
 * assembling the next request, so state is consistent without prose ever
 * waiting on the workers (the latency law, SPEC.md M3).
 */

import { renderStateFacts } from '../engine/state.js';

const MAX_TOKENS = 400;
const TEMPERATURE = 0;

/* ---------- the in-flight tracker (the send path's courtesy wait) ---------- */

const inFlight = new Map(); // storyId -> Promise

/* Note an extraction just fired. The promise's own fate is swallowed here —
 * the tracker only cares when it settles. */
export function noteExtraction(storyId, promise) {
  if (!storyId || !promise || typeof promise.then !== 'function') return;
  inFlight.set(storyId, promise);
  const settle = () => { if (inFlight.get(storyId) === promise) inFlight.delete(storyId); };
  promise.then(settle, settle);
}

/* Await any extraction in flight for this story — hard timeout, then we
 * simply proceed with last-good state. Never rejects. */
export async function pendingExtraction(storyId, timeoutMs = 5000) {
  const promise = inFlight.get(storyId);
  if (!promise) return false;
  let timer = null;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const done = await Promise.race([
    promise.then(() => 'settled', () => 'settled'),
    timedOut,
  ]);
  clearTimeout(timer);
  return done === 'settled';
}

/* ---------- the prompt (human-voiced, kept in the code) ---------- */

const VOCABULARY = [
  'clock.set {"type":"clock.set","year":2026,"month":3,"day":15,"hour":14,"minute":30} — only when the prose states or clearly fixes the time',
  'clock.advance {"type":"clock.advance","minutes":30,"reason":"the walk to the chapel"} — when time clearly passes; minutes is a number',
  'presence.enter {"type":"presence.enter","name":"Mira","position":"by the fire","attire":"a travel cloak"} — position and attire only if shown',
  'presence.leave {"type":"presence.leave","name":"Samantha"} — when someone clearly leaves the scene',
  'presence.update {"type":"presence.update","name":"Mira","position":"at the window"} — when someone present moves or changes dress',
  'mode.set {"type":"mode.set","flag":"combat","reason":"blades drawn"} — flag is one of: combat, intimate, travel, socialField, isolation, group',
  'mode.clear {"type":"mode.clear","flag":"combat"} — when that mood clearly ends',
].join('\n');

const SYSTEM_PROMPT = [
  'You keep the ledger for a slow, warm story told between two writers. After each',
  'page is finished, you read it and note — in small, exact changes — what shifted',
  'in the scene: the hour, who is present, the mood of the room.',
  '',
  'Answer with JSON ONLY, in exactly this shape:',
  '{"mutations":[ ... ]}',
  '',
  'The only mutations that exist:',
  VOCABULARY,
  '',
  'Be conservative. Write down only what the prose explicitly shows — never what it',
  'merely hints at, never what might be true. Names keep the exact spelling the prose',
  'uses. Time moves only when the prose says it moved. If nothing changed, return',
  '{"mutations":[]} — an empty list is a good and honest answer, and the most common',
  'one. No commentary, no markdown fences, no trailing words: the JSON object only.',
].join('\n');

/* Exported for the harness: the two messages any provider flavor receives. */
export function buildExtractorMessages({ state, userText, assistantText }) {
  const facts = renderStateFacts(state) || 'Nothing is written in the ledger yet.';
  const user = [
    'Here is what the ledger currently says:',
    facts,
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
    'What changed, if anything? JSON only.',
  ].join('\n');
  return { system: SYSTEM_PROMPT, user };
}

/* ---------- the tolerant parser ---------- */

/* Pull the first balanced {...} out of a string, respecting quoted text so a
 * brace inside a sentence doesn't count. Returns '' when none balances. */
function firstBalancedObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

/* Exported for the harness. Fences stripped, first balanced object parsed,
 * mutations kept only if they're objects with a string type — the rest of
 * the validation is the applier's job (engine/apply.js). Any trouble at all
 * resolves to {mutations:[]}. */
export function parseExtractorAnswer(raw) {
  try {
    let text = String(raw || '');
    text = text.replace(/```(?:json|JSON)?/g, '');
    const candidate = firstBalancedObject(text);
    if (!candidate) return { mutations: [] };
    const parsed = JSON.parse(candidate);
    const list = parsed && Array.isArray(parsed.mutations) ? parsed.mutations : [];
    const mutations = list.filter(
      (m) => m && typeof m === 'object' && typeof m.type === 'string' && m.type.trim()
    );
    return { mutations };
  } catch (err) {
    return { mutations: [] };
  }
}

/* ---------- the provider calls (non-streaming, small, cold) ---------- */

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
  if (!res.ok) return '';
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
  if (!res.ok) return '';
  const body = await res.json();
  const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
  const text = choice && choice.message && choice.message.content;
  return typeof text === 'string' ? text : '';
}

/* ---------- the contract ---------- */

/* Read one finished turn and propose mutations. NEVER throws into the chat
 * path — every failure (no connection, network, non-JSON, prose-wrapped
 * JSON) lands as {mutations:[]}. */
export async function extractTurn({ connection, state, userText, assistantText, signal } = {}) {
  try {
    if (!connection || typeof connection !== 'object') return { mutations: [] };
    if (!assistantText || !String(assistantText).trim()) return { mutations: [] };
    const prompt = buildExtractorMessages({ state, userText, assistantText });
    let raw = '';
    if (connection.type === 'anthropic') {
      raw = await callAnthropic(connection, prompt, signal);
    } else if (connection.type === 'openai') {
      raw = await callOpenAI(connection, prompt, signal);
    } else {
      return { mutations: [] };
    }
    return parseExtractorAnswer(raw);
  } catch (err) {
    return { mutations: [] };
  }
}
