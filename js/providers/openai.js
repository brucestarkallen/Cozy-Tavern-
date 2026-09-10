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

import { readSSE } from './sse.js';
/* M22-A/D: the full reasoning ladder (per-house spellings, alias-down,
 * rejection memory) and the storyteller prefill live in effort.js. */
import {
  reasonStyle, effortFor, REASONING_REFUSAL, PREFILL_REFUSAL,
  applyPrefill, markConnectionDown,
} from './effort.js';

const DEFAULT_BASE = 'https://api.openai.com';

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

/* The SSE reader is shared by both providers (M9, B16): providers/sse.js. */

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
 * connection. The thinking voice maps per house (M8.5, full ladder M22-A):
 * OpenRouter takes reasoning:{effort} (or {max_tokens} when a budget was
 * named) — xhigh/max included, mapped down per model on their side;
 * Z.ai takes thinking:{enabled} plus reasoning_effort above low (its
 * ladder skips medium/xhigh — the alias-down in effort.js has already
 * spoken them as high/max); qwen takes enable_thinking; the Hermes agent
 * takes model_options.reasoning; DeepSeek decides for itself; everything
 * else takes reasoning_effort. 'off' sends nothing. A connection the wire
 * has refused (reasoningDownAt) sends nothing until its model changes.
 * M22-C: OpenRouter connections with searchOn ride plugins:[{id:'web'}].
 * M22-D: the prefill joins per the house's profile (effort.js). */
function requestBody(connection, wireMessages, opts = {}) {
  const pf = opts.suppressPrefill
    ? { messages: wireMessages, applied: false }
    : applyPrefill(wireMessages, connection);
  const body = {
    model: connection.model || 'gpt-4o-mini',
    messages: pf.messages,
    stream: true,
  };
  if (typeof connection.temperature === 'number') body.temperature = connection.temperature;
  if (typeof connection.topP === 'number') body.top_p = connection.topP;
  if (typeof connection.maxTokens === 'number' && connection.maxTokens > 0) {
    body.max_tokens = Math.round(connection.maxTokens);
  }
  const style = reasonStyle(connection);
  const r = (connection && connection.reasoning) || {};
  const wanted = r && typeof r.effort === 'string' ? r.effort : 'off';
  const suppressed = opts.suppressReasoning || Boolean(connection && connection.reasoningDownAt);
  const effort = suppressed ? 'off' : effortFor(style, wanted);
  if (style === 'none') {
    /* the model decides on its own — nothing extra is ever sent */
  } else if (suppressed) {
    /* the wire refused these params once — nothing is spent on them again */
  } else if (style === 'openrouter') {
    const budget = typeof r.budgetTokens === 'number' && r.budgetTokens > 0
      ? Math.round(r.budgetTokens)
      : 0;
    body.reasoning = effort === 'off'
      ? { enabled: false }
      : (budget ? { max_tokens: budget } : { effort });
  } else if (style === 'zai') {
    body.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' };
    if (effort !== 'off' && effort !== 'low') body.reasoning_effort = effort;
  } else if (style === 'qwen') {
    body.enable_thinking = effort !== 'off';
  } else if (style === 'hermes') {
    if (effort !== 'off') {
      body.model_options = { ...(body.model_options || {}), reasoning: { enabled: true, effort } };
    }
  } else if (effort !== 'off') {
    body.reasoning_effort = effort;
  }
  /* M22-C: "let it look things up" — OpenRouter's web plugin. Only the
   * openrouter host shape carries it; other openai-compatible addresses
   * hide the control in the form. */
  if (connection && connection.searchOn && style === 'openrouter') {
    body.plugins = [{ id: 'web' }];
  }
  return { body, prefill: pf };
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
    /* System mapping (SPEC.md M2, widened M9 for A4): the cache:true blocks
     * concatenate into a single LEADING system message — the stable prefix
     * that provider-side caching keys on. Blocks marked cache:false (M9:
     * the brief and Who's here, which drift with the scene) follow as
     * separate system messages, in order, never merged into the stable
     * prefix. The M1 legacy `system` (string or array of strings) still
     * works, unchanged. */
    const wire = [];
    if (Array.isArray(blocks) && blocks.length) {
      const stable = blocks
        .filter((b) => b && b.cache && typeof b.text === 'string' && b.text.length)
        .map((b) => b.text)
        .join('\n\n');
      if (stable) wire.push({ role: 'system', content: stable });
      for (const b of blocks) {
        if (b && !b.cache && typeof b.text === 'string' && b.text.length) {
          wire.push({ role: 'system', content: b.text });
        }
      }
    } else {
      const systemText = Array.isArray(system) ? system.join('\n\n') : system;
      if (systemText) wire.push({ role: 'system', content: systemText });
    }
    for (const m of messages) wire.push({ role: m.role, content: m.content });

    const startedAt = Date.now();
    const notes = [];
    /* M22: the rejection memory — a 400-style no citing the reasoning
     * params or the prefill marks the connection, and the turn goes out
     * ONE more time without them; then never again until the model field
     * changes. */
    let res = null;
    let opts = {};
    for (let attempt = 0; attempt < 2 && !res; attempt += 1) {
      const { body, prefill } = requestBody(connection, wire, opts);
      let out;
      try {
        out = await fetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: headersOf(connection),
          signal,
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        throw new Error(`Couldn’t reach ${name} — check the connection and try again.`);
      }
      if (out.ok) {
        if (prefill.note) notes.push(prefill.note);
        res = out;
        break;
      }
      let detail = '';
      try {
        const j = await out.clone().json();
        detail = (j && j.error && j.error.message) || '';
      } catch (err) { /* not JSON — the status still tells a story */ }
      const fourHundred = out.status === 400 || out.status === 422;
      const sentReasoning = Boolean(
        body.reasoning_effort || body.reasoning || body.thinking
        || 'enable_thinking' in body || (body.model_options && body.model_options.reasoning)
      );
      if (fourHundred && !opts.suppressReasoning && sentReasoning && REASONING_REFUSAL.test(detail)) {
        await markConnectionDown(connection, 'reasoningDownAt');
        notes.push('The thinking settings weren’t accepted, so this turn went without them — it won’t be asked again until the model changes.');
        opts = { ...opts, suppressReasoning: true };
        continue;
      }
      if (fourHundred && !opts.suppressPrefill && prefill.applied && PREFILL_REFUSAL.test(detail)) {
        await markConnectionDown(connection, 'prefillDownAt');
        notes.push('A reply that starts before the storyteller wasn’t accepted — the prefill is off for this connection until the model changes.');
        opts = { ...opts, suppressPrefill: true };
        continue;
      }
      throw new Error(await explain(out, name));
    }
    if (!res) throw new Error(`The answer was no, without a reason (400).`);

    let full = '';
    let thinking = '';
    let refusal = '';
    let finishReason = null;
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
      /* M9 (B9): why it stopped, when the stream says — 'length' means the
       * page ran out of room and the chat view will say so. */
      if (piece && typeof piece.finish_reason === 'string' && piece.finish_reason) {
        finishReason = piece.finish_reason;
      }
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
      finishReason,
      notes,
      sources: [],
      ttftMs: ttftMs === null ? durationMs : ttftMs,
      tfftMs,
      durationMs,
    };
  }

  /* M22-D: "Test it" — a tiny non-streamed probe carrying the prefill per
   * this house's profile, reporting plainly. A refusal marks the
   * connection's memory. */
  async function testPrefill() {
    const prefill = String(connection.prefill || '').trim();
    if (!prefill) return { ok: false, detail: 'There’s no prefill to try — write one first.' };
    const { body } = requestBody(connection, [
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'B' },
      { role: 'user', content: 'C' },
    ]);
    body.stream = false;
    body.max_tokens = 8;
    delete body.reasoning;
    delete body.reasoning_effort;
    delete body.thinking;
    delete body.enable_thinking;
    delete body.model_options;
    delete body.plugins;
    if (!body.messages.length || body.messages[body.messages.length - 1].role !== 'assistant') {
      return { ok: false, detail: 'This address has no known way to start the reply for it — nothing was sent.' };
    }
    let res;
    try {
      res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: headersOf(connection),
        body: JSON.stringify(body),
      });
    } catch (err) {
      return { ok: false, detail: `Couldn’t reach ${name} — check the connection and try again.` };
    }
    if (res.ok) return { ok: true, detail: 'Took it — the reply picked up where the prefill left off.' };
    let detail = '';
    try {
      const j = await res.json();
      detail = (j && j.error && j.error.message) || '';
    } catch (err) { /* the status speaks for itself */ }
    if ((res.status === 400 || res.status === 422) && PREFILL_REFUSAL.test(detail)) {
      await markConnectionDown(connection, 'prefillDownAt');
      return { ok: false, detail: 'Won’t take a prefill — sent without it from here on, until the model changes.' };
    }
    return { ok: false, detail: await explain(res, name) };
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

  return { test, listModels, streamChat, testPrefill };
}
