/* Cozy Tavern — providers/anthropic.js
 * Claude's messages API, streamed over SSE, ready for prompt caching.
 * Contract (M8.5): { test(): Promise<{ok, detail}>,
 *   listModels(): Promise<[{id, label}]>  (throws kindly on failure),
 *   streamChat({systemBlocks|system, messages, signal, onToken})
 *     : Promise<{text, thinking, ttftMs, tfftMs, durationMs}> }
 * onToken receives {channel:'thinking'|'prose', text} — the reasoning
 * channel arrived in M8.5; before that, thinking was silently dropped.
 * ttftMs is the time from fetch start to the first PROSE token; tfftMs to
 * the first THOUGHT (null when the voice stayed quiet); durationMs from
 * fetch start to the end of the stream.
 * M9: the result also carries `finishReason` (stop_reason — 'end_turn',
 * 'max_tokens', …) when the stream says why it stopped; 'max_tokens' means
 * the page ran out of room and the chat view will say so (B9).
 */

import { readSSE } from './sse.js';

const DEFAULT_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
/* max_tokens is required by this API; 4096 is the house default when the
 * connection names no response length of its own (M8). */
const MAX_TOKENS = 4096;

/* The thinking voice (M8.5): how much room each effort gives the
 * storyteller to weigh the page before writing it. */
const EFFORT_BUDGETS = { low: 2048, medium: 8192, high: 24576 };

function baseOf(connection) {
  return (connection.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
}

function headersOf(connection) {
  return {
    'content-type': 'application/json',
    'x-api-key': connection.apiKey || '',
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/* Turn an HTTP no into a sentence a person can act on. */
async function explain(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = (body && body.error && body.error.message) || '';
  } catch (err) { /* the body wasn't JSON; the status still tells a story */ }
  if (res.status === 401 || res.status === 403) {
    return 'The key wasn’t accepted. It’s worth another look in Settings.';
  }
  if (res.status === 404) {
    return 'That model name didn’t ring a bell. Check it in Settings.';
  }
  if (res.status === 429) {
    return 'Claude is busy just now. Give it a breath and try again.';
  }
  if (detail) return `Claude said no (${res.status}): ${detail}`;
  return `Claude said no, and didn’t say why (${res.status}).`;
}

/* System prompt, two shapes:
 * - M2 `systemBlocks`: [{text, cache:true|false}] from the assembler. Each
 *   becomes a text block; the LAST block marked cache:true carries
 *   cache_control ephemeral, so the stable frame prefix is cached
 *   provider-side and TTFT stays low.
 * - M1 legacy `system`: a plain string (or array of strings). Kept working;
 *   the last block gets cache_control as before. */
function systemBlocks(systemBlocksArg, legacySystem) {
  if (Array.isArray(systemBlocksArg) && systemBlocksArg.length) {
    const blocks = systemBlocksArg
      .filter((b) => b && typeof b.text === 'string' && b.text.length)
      .map((b) => ({ type: 'text', text: b.text, cache: Boolean(b.cache) }));
    let lastCached = -1;
    blocks.forEach((b, i) => { if (b.cache) lastCached = i; });
    return blocks.map((b, i) => {
      const wire = { type: 'text', text: b.text };
      if (i === lastCached) wire.cache_control = { type: 'ephemeral' };
      return wire;
    });
  }
  const texts = Array.isArray(legacySystem) ? legacySystem : [legacySystem];
  const blocks = texts
    .filter((t) => typeof t === 'string' && t.length)
    .map((t) => ({ type: 'text', text: t }));
  if (blocks.length) {
    blocks[blocks.length - 1].cache_control = { type: 'ephemeral' };
  }
  return blocks;
}

/* The SSE reader is shared by both providers (M9, B16): providers/sse.js. */

/* The request body, built pure so it can be read (and tested) without a
 * wire. Sampling dials ride only when set on the connection; when the
 * thinking voice is on, this API insists on temperature 1 and no top_p,
 * and max_tokens must exceed the thinking budget. */
function requestBody(connection, blocks, legacySystem, messages) {
  const r = connection && connection.reasoning;
  const effort = r && typeof r.effort === 'string' ? r.effort : 'off';
  const thinkingOn = effort === 'low' || effort === 'medium' || effort === 'high';
  let budget = 0;
  if (thinkingOn) {
    budget = typeof r.budgetTokens === 'number' && r.budgetTokens > 0
      ? Math.round(r.budgetTokens)
      : EFFORT_BUDGETS[effort];
  }
  const body = {
    model: connection.model || 'claude-sonnet-4-5',
    max_tokens: typeof connection.maxTokens === 'number' && connection.maxTokens > 0
      ? Math.round(connection.maxTokens)
      : MAX_TOKENS,
    system: systemBlocks(blocks, legacySystem),
    messages,
    stream: true,
  };
  if (typeof connection.temperature === 'number') body.temperature = connection.temperature;
  if (typeof connection.topP === 'number') body.top_p = connection.topP;
  if (thinkingOn) {
    body.thinking = { type: 'enabled', budget_tokens: budget };
    body.temperature = 1;
    delete body.top_p;
    if (body.max_tokens <= budget) body.max_tokens = budget + MAX_TOKENS;
  }
  return body;
}

export function createAnthropicProvider(connection) {
  const base = baseOf(connection);

  async function test() {
    try {
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: headersOf(connection),
        body: JSON.stringify({
          model: connection.model || 'claude-sonnet-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Evening.' }],
        }),
      });
      if (!res.ok) return { ok: false, detail: await explain(res) };
      return { ok: true, detail: 'Claude answered — the line is good.' };
    } catch (err) {
      return { ok: false, detail: 'Couldn’t reach Claude — check the connection and try again.' };
    }
  }

  /* "Fetch what's on offer" (M8): GET /v1/models, same credentials as the
   * chat call. Throws with human words on failure — the editor keeps the
   * hand-typed field either way. */
  async function listModels() {
    let res;
    try {
      res = await fetch(`${base}/v1/models`, { headers: headersOf(connection) });
    } catch (err) {
      throw new Error('Couldn’t reach Claude — check the connection and try again.');
    }
    if (!res.ok) throw new Error(await explain(res));
    const body = await res.json();
    const rows = body && Array.isArray(body.data) ? body.data : [];
    return rows
      .filter((m) => m && typeof m.id === 'string')
      .map((m) => ({ id: m.id, label: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.id }));
  }

  async function streamChat({ systemBlocks: blocks, system, messages, signal, onToken }) {
    const startedAt = Date.now();
    let res;
    try {
      res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: headersOf(connection),
        signal,
        body: JSON.stringify(requestBody(connection, blocks, system, messages)),
      });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new Error('Couldn’t reach Claude — check the connection and try again.');
    }
    if (!res.ok) throw new Error(await explain(res));

    let full = '';
    let thinking = '';
    let refusal = '';
    let finishReason = null;
    let ttftMs = null;
    let tfftMs = null;
    await readSSE(res.body, (data) => {
      if (data.type === 'message_delta' && data.delta && typeof data.delta.stop_reason === 'string') {
        /* M9 (B9): why it stopped — 'max_tokens' means the page ran out
         * of room. */
        finishReason = data.delta.stop_reason;
      } else if (data.type === 'content_block_delta' && data.delta) {
        if (data.delta.type === 'text_delta' && typeof data.delta.text === 'string') {
          if (ttftMs === null) ttftMs = Date.now() - startedAt;
          full += data.delta.text;
          if (onToken) onToken({ channel: 'prose', text: data.delta.text });
        } else if (data.delta.type === 'thinking_delta' && typeof data.delta.thinking === 'string') {
          /* M8.5: the reasoning channel — what the storyteller weighed,
           * streamed on its own track beside the prose. */
          if (tfftMs === null) tfftMs = Date.now() - startedAt;
          thinking += data.delta.thinking;
          if (onToken) onToken({ channel: 'thinking', text: data.delta.thinking });
        }
        /* signature_delta and friends are bookkeeping we don't need. */
      } else if (data.type === 'error' && data.error) {
        refusal = data.error.message || 'Claude stumbled mid-sentence.';
      }
    });
    if (refusal && !full) throw new Error(refusal);
    const durationMs = Date.now() - startedAt;
    return {
      text: full,
      thinking,
      finishReason,
      ttftMs: ttftMs === null ? durationMs : ttftMs,
      tfftMs,
      durationMs,
    };
  }

  return { test, listModels, streamChat };
}
