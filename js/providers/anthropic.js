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
 * M22: the full reasoning ladder (xhigh/max, alias-down) and rejection
 * memory (reasoningDownAt / prefillDownAt) live in providers/effort.js;
 * the result also carries `sources` (the native web search's findings,
 * M22-C) and `notes` (kind words for toasts — a refusal retried, a
 * prefill that stayed home). testPrefill() is the settings form's probe.
 */

import { readSSE } from './sse.js';
import { withImagePart, transportError } from './wire.js';
/* M22-A/D: the full reasoning ladder + rejection memory, and the
 * storyteller prefill — the mechanics live in providers/effort.js. */
import {
  effortFor, EFFORT_BUDGETS, REASONING_REFUSAL, PREFILL_REFUSAL,
  applyPrefill, markConnectionDown,
} from './effort.js';

const DEFAULT_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
/* max_tokens is required by this API; 4096 is the house default when the
 * connection names no response length of its own (M8). */
const MAX_TOKENS = 4096;

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
 * and max_tokens must exceed the thinking budget.
 *
 * M22-A: the effort goes through the full ladder (effort.js) — xhigh and
 * max are real rungs here, spoken as adaptive thinking with an effort
 * level; an explicit "thinking room" budget keeps the older fixed-budget
 * shape for models that want it. A connection the wire has refused
 * (reasoningDownAt) sends nothing until its model changes.
 * M22-C: searchOn bolts the native web_search tool onto the body.
 * M22-D: a prefill joins as a trailing assistant message, natively. */
function requestBody(connection, blocks, legacySystem, messages, opts = {}) {
  const r = connection && connection.reasoning;
  const wanted = r && typeof r.effort === 'string' ? r.effort : 'off';
  const effort = opts.suppressReasoning || (connection && connection.reasoningDownAt)
    ? 'off'
    : effortFor('anthropic', wanted);
  const thinkingOn = effort !== 'off';
  const budget = thinkingOn && typeof r.budgetTokens === 'number' && r.budgetTokens > 0
    ? Math.round(r.budgetTokens)
    : 0;
  /* M22-D: the prefill runs on the finished list, and nowhere else. */
  const pf = opts.suppressPrefill
    ? { messages, applied: false }
    : applyPrefill(messages, connection);
  const body = {
    model: connection.model || 'claude-sonnet-4-5',
    max_tokens: typeof connection.maxTokens === 'number' && connection.maxTokens > 0
      ? Math.round(connection.maxTokens)
      : MAX_TOKENS,
    system: systemBlocks(blocks, legacySystem),
    messages: pf.messages.map((m) => withImagePart(m, 'anthropic')),
    stream: true,
  };
  if (typeof connection.temperature === 'number') body.temperature = connection.temperature;
  if (typeof connection.topP === 'number') body.top_p = connection.topP;
  /* M22-C: "let it look things up" — the native web_search tool, with the
   * per-connection ceiling on uses. */
  if (connection && connection.searchOn) {
    const maxUses = Number.isFinite(connection.searchMaxUses) && connection.searchMaxUses > 0
      ? Math.round(connection.searchMaxUses)
      : 5;
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }];
  }
  /* M37: a DeepSeek house behind the Anthropic shape takes reasoning:
   * {effort: none|low|high|max} — none disables — instead of the thinking
   * block (the writer's provider notes, verbatim). */
  const deepseekShaped = /deepseek/i.test(String((connection && connection.baseUrl) || '') + ' ' + String((connection && connection.model) || ''));
  if (deepseekShaped) {
    const ladder = { off: 'none', low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' };
    body.reasoning = { effort: ladder[effort] || 'none' };
    if (thinkingOn) { body.temperature = 1; delete body.top_p; }
    return { body, prefill: pf };
  }
  if (thinkingOn) {
    if (budget) {
      /* The fixed-budget shape (Claude 4.6 and older). */
      body.thinking = { type: 'enabled', budget_tokens: budget };
      if (body.max_tokens <= budget) body.max_tokens = budget + MAX_TOKENS;
    } else {
      /* Adaptive thinking with an effort level — the full ladder. */
      body.thinking = { type: 'adaptive' };
      body.output_config = { effort };
    }
    body.temperature = 1;
    delete body.top_p;
  }
  return { body, prefill: pf };
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
    if (!res.ok) throw transportError(res, await explain(res));
    const body = await res.json();
    const rows = body && Array.isArray(body.data) ? body.data : [];
    return rows
      .filter((m) => m && typeof m.id === 'string')
      .map((m) => ({ id: m.id, label: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.id }));
  }

  /* One POST of the finished body, with the M22 rejection memory: a
   * 400-style no that cites the reasoning params (or the prefill) marks
   * the connection and the turn goes out ONE more time without them —
   * then never again until the model field changes. Returns {res, notes}
   * or throws the kind error. */
  async function sendOnce({ blocks, system, messages, signal, notes }) {
    let opts = {};
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { body, prefill } = requestBody(connection, blocks, system, messages, opts);
      let res;
      try {
        res = await fetch(`${base}/v1/messages`, {
          method: 'POST',
          headers: headersOf(connection),
          signal,
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        throw new Error('Couldn’t reach Claude — check the connection and try again.');
      }
      if (res.ok) {
        if (prefill.note) notes.push(prefill.note);
        return res;
      }
      /* Read the refusal's own words before deciding. */
      let detail = '';
      try {
        const j = await res.clone().json();
        detail = (j && j.error && j.error.message) || '';
      } catch (err) { /* not JSON — the status still tells a story */ }
      const fourHundred = res.status === 400 || res.status === 422;
      const sentReasoning = Boolean(body.thinking || body.output_config);
      const sentPrefill = prefill.applied;
      if (fourHundred && !opts.suppressReasoning && sentReasoning && REASONING_REFUSAL.test(detail)) {
        await markConnectionDown(connection, 'reasoningDownAt');
        notes.push('Claude wouldn’t take the thinking settings, so this turn went without them — it won’t be asked again until the model changes.');
        opts = { ...opts, suppressReasoning: true };
        continue;
      }
      if (fourHundred && !opts.suppressPrefill && sentPrefill && PREFILL_REFUSAL.test(detail)) {
        await markConnectionDown(connection, 'prefillDownAt');
        notes.push('Claude wouldn’t take a reply that starts before it — the prefill is off for this connection until the model changes.');
        opts = { ...opts, suppressPrefill: true };
        continue;
      }
      throw transportError(res, await explain(res));
    }
    throw new Error('Claude said no, and didn’t say why (400).');
  }

  async function streamChat({ systemBlocks: blocks, system, messages, signal, onToken }) {
    const startedAt = Date.now();
    const notes = [];
    const res = await sendOnce({ blocks, system, messages, signal, notes });

    let full = '';
    let thinking = '';
    let refusal = '';
    let finishReason = null;
    let ttftMs = null;
    let tfftMs = null;
    const sources = [];
    await readSSE(res.body, (data) => {
      if (data.type === 'message_delta' && data.delta && typeof data.delta.stop_reason === 'string') {
        /* M9 (B9): why it stopped — 'max_tokens' means the page ran out
         * of room. */
        finishReason = data.delta.stop_reason;
      } else if (data.type === 'content_block_start' && data.content_block) {
        /* M22-C: the native search speaking. The tool call itself is a
         * note ("Searching the web…"); the result block folds into the
         * sources list under the message. */
        if (data.content_block.type === 'server_tool_use') {
          if (onToken) onToken({ channel: 'note', text: 'Searching the web…' });
        } else if (data.content_block.type === 'web_search_tool_result') {
          /* On failure this is an error object, not a list — iterating it
           * threw and turned the whole reply into an error. */
          const rs = Array.isArray(data.content_block.content) ? data.content_block.content : [];
          for (const r of rs) {
            if (r && r.url) sources.push({ title: typeof r.title === 'string' && r.title ? r.title : r.url, url: r.url });
          }
        }
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
      sources,
      notes,
      ttftMs: ttftMs === null ? durationMs : ttftMs,
      tfftMs,
      durationMs,
    };
  }

  /* M22-D: "Test it" — a tiny probe carrying the prefill, reporting
   * plainly. A refusal marks the connection (the memory is the probe's
   * whole job: finding out whether a refusal still holds is the one
   * caller not bound by the last one). */
  async function testPrefill() {
    const prefill = String(connection.prefill || '').trim();
    if (!prefill) return { ok: false, detail: 'There’s no prefill to try — write one first.' };
    const probe = {
      model: connection.model || 'claude-sonnet-4-5',
      max_tokens: 8,
      stream: false,
      messages: [
        { role: 'user', content: 'A' },
        { role: 'assistant', content: 'B' },
        { role: 'user', content: 'C' },
        { role: 'assistant', content: prefill.replace(/\s+$/, '') },
      ],
    };
    let res;
    try {
      res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: headersOf(connection),
        body: JSON.stringify(probe),
      });
    } catch (err) {
      return { ok: false, detail: 'Couldn’t reach Claude — check the connection and try again.' };
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
    return { ok: false, detail: await explain(res) };
  }

  return { test, listModels, streamChat, testPrefill };
}
