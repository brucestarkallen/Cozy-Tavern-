/* Cozy Tavern — providers/openai.js
 * OpenAI-compatible chat completions (OpenAI, OpenRouter, or a custom
 * address), streamed over SSE.
 * Contract (M2): { test(): Promise<{ok, detail}>,
 *   streamChat({systemBlocks|system, messages, signal, onToken})
 *     : Promise<{text, ttftMs, durationMs}> }
 * ttftMs is the time from fetch start to the first content token;
 * durationMs from fetch start to the end of the stream.
 */

const DEFAULT_BASE = 'https://api.openai.com';
const MAX_TOKENS = 2048;

/* The endpoint is {base}/v1/chat/completions (SPEC.md). Trim trailing
 * slashes, and forgive a pasted address that already ends in /v1. */
function baseOf(connection) {
  return (connection.baseUrl || DEFAULT_BASE)
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
}

function headersOf(connection) {
  const headers = { 'content-type': 'application/json' };
  if (connection.apiKey) headers.authorization = `Bearer ${connection.apiKey}`;
  return headers;
}

function nameOf(connection) {
  const base = connection.baseUrl || '';
  if (base.includes('openrouter.ai')) return 'OpenRouter';
  return 'the storyteller';
}

async function explain(res, name) {
  let detail = '';
  try {
    const body = await res.json();
    detail = (body && body.error && body.error.message) || '';
  } catch (err) { /* not JSON; the status still tells a story */ }
  if (res.status === 401 || res.status === 403) {
    return 'The key wasn’t accepted. It’s worth another look in Settings.';
  }
  if (res.status === 404) {
    return 'That model name didn’t ring a bell. Check it in Settings.';
  }
  if (res.status === 429) {
    return 'They’re busy just now. Give it a breath and try again.';
  }
  if (detail) return `${name} said no (${res.status}): ${detail}`;
  return `The answer was no, without a reason (${res.status}).`;
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
    }
  }
  buf += decoder.decode();
  const last = buf.replace(/\r$/, '');
  if (last.startsWith('data:')) dataLines.push(last.slice(5).replace(/^ /, ''));
  dispatch();
}

export function createOpenAIProvider(connection) {
  const base = baseOf(connection);
  const name = nameOf(connection);

  function payload(extra) {
    return JSON.stringify({
      model: connection.model || 'gpt-4o-mini',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Evening.' }],
      ...extra,
    });
  }

  async function test() {
    try {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: headersOf(connection),
        body: payload(),
      });
      if (!res.ok) return { ok: false, detail: await explain(res, name) };
      return { ok: true, detail: 'They answered — the line is good.' };
    } catch (err) {
      return { ok: false, detail: `Couldn’t reach ${name} — check the connection and try again.` };
    }
  }

  async function streamChat({ systemBlocks: blocks, system, messages, signal, onToken }) {
    /* System mapping (SPEC.md M2): the cache:true blocks concatenate into a
     * single system message. Dynamic slots travel as user messages inside
     * `messages` — never as system — on this mapping. The M1 legacy `system`
     * (string or array of strings) still works, unchanged. */
    let systemText;
    if (Array.isArray(blocks) && blocks.length) {
      systemText = blocks
        .filter((b) => b && b.cache && typeof b.text === 'string' && b.text.length)
        .map((b) => b.text)
        .join('\n\n');
    } else {
      systemText = Array.isArray(system) ? system.join('\n\n') : system;
    }
    const wire = [];
    if (systemText) wire.push({ role: 'system', content: systemText });
    for (const m of messages) wire.push({ role: m.role, content: m.content });

    const startedAt = Date.now();
    let res;
    try {
      res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: headersOf(connection),
        signal,
        body: JSON.stringify({
          model: connection.model || 'gpt-4o-mini',
          max_tokens: MAX_TOKENS,
          messages: wire,
          stream: true,
        }),
      });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new Error(`Couldn’t reach ${name} — check the connection and try again.`);
    }
    if (!res.ok) throw new Error(await explain(res, name));

    let full = '';
    let refusal = '';
    let ttftMs = null;
    await readSSE(res.body, (data) => {
      const piece = data && data.choices && data.choices[0];
      const text = piece && piece.delta && piece.delta.content;
      if (typeof text === 'string' && text) {
        if (ttftMs === null) ttftMs = Date.now() - startedAt;
        full += text;
        if (onToken) onToken(text);
      } else if (data && data.error) {
        refusal = data.error.message || 'The storyteller stumbled mid-sentence.';
      }
    });
    if (refusal && !full) throw new Error(refusal);
    const durationMs = Date.now() - startedAt;
    return { text: full, ttftMs: ttftMs === null ? durationMs : ttftMs, durationMs };
  }

  return { test, streamChat };
}
