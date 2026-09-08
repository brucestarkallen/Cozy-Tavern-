/* Cozy Tavern — providers/anthropic.js
 * Claude's messages API, streamed over SSE, ready for prompt caching.
 * Contract (M2): { test(): Promise<{ok, detail}>,
 *   streamChat({systemBlocks|system, messages, signal, onToken})
 *     : Promise<{text, ttftMs, durationMs}> }
 * ttftMs is the time from fetch start to the first content token;
 * durationMs from fetch start to the end of the stream.
 */

const DEFAULT_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 2048;

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

/* Read an SSE stream body. Handles partial chunks, CRLF, multi-line data,
 * and the [DONE] sentinel. Calls onEvent(parsedJSON) per event. */
async function readSSE(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let dataLines = [];

  const dispatch = () => {
    if (!dataLines.length) return;
    const raw = dataLines.join('\n');
    dataLines = [];
    if (raw === '[DONE]') return;
    try {
      onEvent(JSON.parse(raw));
    } catch (err) {
      /* a keep-alive or partial frame; keep listening */
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') { dispatch(); continue; }
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      /* event:, id:, and comment lines are guidance we don't need */
    }
  }
  buf += decoder.decode();
  const last = buf.replace(/\r$/, '');
  if (last.startsWith('data:')) dataLines.push(last.slice(5).replace(/^ /, ''));
  dispatch();
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

  async function streamChat({ systemBlocks: blocks, system, messages, signal, onToken }) {
    const startedAt = Date.now();
    let res;
    try {
      res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: headersOf(connection),
        signal,
        body: JSON.stringify({
          model: connection.model || 'claude-sonnet-4-5',
          max_tokens: MAX_TOKENS,
          system: systemBlocks(blocks, system),
          messages,
          stream: true,
        }),
      });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new Error('Couldn’t reach Claude — check the connection and try again.');
    }
    if (!res.ok) throw new Error(await explain(res));

    let full = '';
    let refusal = '';
    let ttftMs = null;
    await readSSE(res.body, (data) => {
      if (data.type === 'content_block_delta' && data.delta && data.delta.type === 'text_delta') {
        if (ttftMs === null) ttftMs = Date.now() - startedAt;
        full += data.delta.text;
        if (onToken) onToken(data.delta.text);
      } else if (data.type === 'error' && data.error) {
        refusal = data.error.message || 'Claude stumbled mid-sentence.';
      }
    });
    if (refusal && !full) throw new Error(refusal);
    const durationMs = Date.now() - startedAt;
    return { text: full, ttftMs: ttftMs === null ? durationMs : ttftMs, durationMs };
  }

  return { test, streamChat };
}
