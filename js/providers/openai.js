/* Cozy Tavern — providers/openai.js
 * OpenAI-compatible chat completions (OpenAI, OpenRouter, or a custom
 * address), streamed over SSE.
 * Contract (M8.5): { test(): Promise<{ok, detail}>,
 *   listModels(): Promise<[{id, label}]>  (throws kindly on failure),
 *   streamChat({systemBlocks|system, messages, signal, onToken})
 *     : Promise<{text, thinking, ttftMs, tfftMs, durationMs}> }
 * onToken receives {channel:'thinking'|'prose', text}. The reasoning
 * channel (M8.5) arrives as delta.reasoning_content / delta.reasoning;
 * when no native channel speaks but the PROSE opens with a literal
 * <think>…</think> span (the V176 way), a small state machine splits it
 * out — even when the tags themselves are split across chunks.
 * ttftMs = first PROSE token; tfftMs = first THOUGHT (null when quiet);
 * durationMs = fetch start to stream end.
 */

const DEFAULT_BASE = 'https://api.openai.com';

/* The thinking voice (M8.5): effort names are passed through as-is; an
 * explicit token budget is an OpenRouter-only refinement. */
const EFFORTS = ['low', 'medium', 'high'];

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

/* The V176 interop splitter (M8.5). Some storytellers have no native
 * reasoning channel but open their answer with a literal <think>…</think>
 * span. This machine feeds on prose deltas and re-routes that leading span
 * onto the thinking channel, holding back partial tags that straddle chunk
 * boundaries. Everything after the closing tag (or everything, when no
 * opening tag ever comes) is plain prose. */
function makeThinkSplitter(emit) {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let state = 'open'; // 'open' | 'thinking' | 'prose'
  let buf = '';

  function feed(text) {
    buf += text;
    for (;;) {
      if (state === 'open') {
        const trimmed = buf.replace(/^\s+/, '');
        if (trimmed.length < OPEN.length && OPEN.startsWith(trimmed)) return; // could still become the tag
        if (trimmed.startsWith(OPEN)) {
          const lead = buf.length - trimmed.length;
          if (lead) emit('prose', buf.slice(0, lead));
          buf = trimmed.slice(OPEN.length);
          state = 'thinking';
          continue;
        }
        emit('prose', buf);
        buf = '';
        state = 'prose';
        return;
      }
      if (state === 'thinking') {
        const at = buf.indexOf(CLOSE);
        if (at !== -1) {
          if (at) emit('thinking', buf.slice(0, at));
          buf = buf.slice(at + CLOSE.length);
          state = 'prose';
          continue;
        }
        /* No closing tag yet — but the tail might be the start of one,
         * cut in two by the chunk boundary. Hold back the longest suffix
         * that could still grow into it. */
        let hold = 0;
        const maxHold = Math.min(CLOSE.length - 1, buf.length);
        for (let k = maxHold; k > 0; k--) {
          if (CLOSE.startsWith(buf.slice(-k))) { hold = k; break; }
        }
        const out = buf.slice(0, buf.length - hold);
        if (out) emit('thinking', out);
        buf = buf.slice(buf.length - hold);
        return;
      }
      emit('prose', buf);
      buf = '';
      return;
    }
  }

  function end() {
    if (!buf) return;
    /* The stream closed mid-span: an unfinished opening tag was never
     * really a thought, so it goes home to the prose; an unclosed thought
     * stays a thought. */
    emit(state === 'thinking' ? 'thinking' : 'prose', buf);
    buf = '';
  }

  return { feed, end };
}

/* The request body, built pure. Sampling dials ride only when set on the
 * connection; the thinking voice maps per house (M8.5): OpenRouter takes
 * reasoning:{effort} (or {max_tokens} when a budget was named), everything
 * else on this API takes reasoning_effort. 'off' sends nothing. */
function requestBody(connection, wireMessages) {
  const body = {
    model: connection.model || 'gpt-4o-mini',
    messages: wireMessages,
    stream: true,
  };
  if (typeof connection.temperature === 'number') body.temperature = connection.temperature;
  if (typeof connection.topP === 'number') body.top_p = connection.topP;
  if (typeof connection.maxTokens === 'number' && connection.maxTokens > 0) {
    body.max_tokens = Math.round(connection.maxTokens);
  }
  const r = connection && connection.reasoning;
  const effort = r && typeof r.effort === 'string' ? r.effort : 'off';
  if (EFFORTS.includes(effort)) {
    const budget = typeof r.budgetTokens === 'number' && r.budgetTokens > 0
      ? Math.round(r.budgetTokens)
      : 0;
    if ((connection.baseUrl || '').includes('openrouter.ai')) {
      body.reasoning = budget ? { max_tokens: budget } : { effort };
    } else {
      body.reasoning_effort = effort;
    }
  }
  return body;
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
        body: JSON.stringify(requestBody(connection, wire)),
      });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new Error(`Couldn’t reach ${name} — check the connection and try again.`);
    }
    if (!res.ok) throw new Error(await explain(res, name));

    let full = '';
    let thinking = '';
    let refusal = '';
    let ttftMs = null;
    let tfftMs = null;
    let nativeThoughts = false;
    const emit = (channel, text) => {
      if (!text) return;
      if (channel === 'thinking') {
        if (tfftMs === null) tfftMs = Date.now() - startedAt;
        thinking += text;
      } else {
        if (ttftMs === null) ttftMs = Date.now() - startedAt;
        full += text;
      }
      if (onToken) onToken({ channel, text });
    };
    /* The tag splitter only listens while no native reasoning channel has
     * spoken (SPEC.md M8.5: V176 interop is the fallback, never the rule). */
    const splitter = makeThinkSplitter(emit);
    await readSSE(res.body, (data) => {
      const piece = data && data.choices && data.choices[0];
      const delta = piece && piece.delta;
      if (delta) {
        const thought = delta.reasoning_content ?? delta.reasoning;
        if (typeof thought === 'string' && thought) {
          nativeThoughts = true;
          emit('thinking', thought);
        }
        const text = delta.content;
        if (typeof text === 'string' && text) {
          if (nativeThoughts) emit('prose', text);
          else splitter.feed(text);
        }
      }
      if (data && data.error) {
        refusal = data.error.message || 'The storyteller stumbled mid-sentence.';
      }
    });
    splitter.end();
    if (refusal && !full) throw new Error(refusal);
    const durationMs = Date.now() - startedAt;
    return {
      text: full,
      thinking,
      ttftMs: ttftMs === null ? durationMs : ttftMs,
      tfftMs,
      durationMs,
    };
  }

  /* "Fetch what's on offer" (M8): GET {base}/v1/models. Throws with human
   * words on failure — the editor keeps the hand-typed field either way. */
  async function listModels() {
    let res;
    try {
      res = await fetch(`${base}/v1/models`, { headers: headersOf(connection) });
    } catch (err) {
      throw new Error(`Couldn’t reach ${name} — check the connection and try again.`);
    }
    if (!res.ok) throw new Error(await explain(res, name));
    const body = await res.json();
    const rows = body && Array.isArray(body.data) ? body.data : [];
    return rows
      .map((m) => (m && typeof m.id === 'string' ? m.id : ''))
      .filter(Boolean)
      .map((id) => ({ id, label: id }));
  }

  return { test, listModels, streamChat };
}
