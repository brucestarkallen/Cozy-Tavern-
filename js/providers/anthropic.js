/* Cozy Tavern — providers/anthropic.js
 * Claude's messages API, streamed over SSE, ready for prompt caching.
 * Contract: { test(): Promise<{ok, detail}>,
 *             streamChat({system, messages, signal, onToken}): Promise<string> }
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

/* System prompt as an array of blocks, with cache_control on the last one
 * so the stable frame prefix is cached provider-side and TTFT stays low. */
function systemBlocks(system) {
  const texts = Array.isArray(system) ? system : [system];
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

  async function streamChat({ system, messages, signal, onToken }) {
    let res;
    try {
      res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: headersOf(connection),
        signal,
        body: JSON.stringify({
          model: connection.model || 'claude-sonnet-4-5',
          max_tokens: MAX_TOKENS,
          system: systemBlocks(system),
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
    await readSSE(res.body, (data) => {
      if (data.type === 'content_block_delta' && data.delta && data.delta.type === 'text_delta') {
        full += data.delta.text;
        if (onToken) onToken(data.delta.text);
      } else if (data.type === 'error' && data.error) {
        refusal = data.error.message || 'Claude stumbled mid-sentence.';
      }
    });
    if (refusal && !full) throw new Error(refusal);
    return full;
  }

  return { test, streamChat };
}
