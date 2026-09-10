/* Cozy Tavern — tests/harness/thinkinghouse.mjs
 * A mock of a reasoning-model house (GLM on Z.ai, Kimi, Qwen, DeepSeek-style
 * models behind OpenRouter or a custom address). The law it models, taken
 * from the real wires:
 *
 *   - Unless the request explicitly turns thinking OFF in the house's own
 *     spelling — Z.ai `thinking:{type:'disabled'}`, OpenRouter
 *     `reasoning:{enabled:false}`, Qwen `enable_thinking:false`, Anthropic
 *     no `thinking` block at all — the model THINKS FIRST. The thinking
 *     lands in `reasoning_content` (openai-compatible) or a thinking block
 *     (anthropic), and it spends the token budget before a word of the
 *     answer appears: content comes back empty, finish_reason 'length'.
 *   - With thinking off, the answer is served in `content`.
 *
 * Serves both shapes a caller may ask for: non-streamed JSON (what the old
 * hand-rolled worker calls expected) and SSE (what js/providers/* speak).
 * Records every request body so a test can assert what was actually sent.
 */

function sse(lines) {
  const text = lines.map((l) => (typeof l === 'string' ? l : 'data: ' + JSON.stringify(l) + '\n\n')).join('');
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
  return { ok: true, status: 200, headers: new Headers(), body, async json() { return {}; }, async text() { return text; }, clone() { return this; } };
}

function jsonRes(obj, status = 200, headers = {}) {
  const text = JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    async json() { return obj; },
    async text() { return text; },
    clone() { return this; },
  };
}

/* Is thinking OFF in this request, in the house's own spelling? */
export function thinkingOff(body, anthropic) {
  if (anthropic) return !(body.thinking && body.thinking.type === 'enabled');
  if (body.thinking && body.thinking.type === 'disabled') return true;
  if (body.reasoning && body.reasoning.enabled === false) return true;
  if (body.enable_thinking === false) return true;
  return false;
}

/* Build a fetch() for the mock house. `answer` is what the model says when
 * it can answer; `status`/`headers` force a transport failure instead. */
export function thinkingHouse({ answer = '{"mutations":[]}', status = 200, headers = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const anthropic = String(url).includes('/v1/messages');
    calls.push({ url: String(url), body, anthropic });
    if (status !== 200) return jsonRes({ error: { message: 'busy' } }, status, headers);
    const off = thinkingOff(body, anthropic);
    /* A trailing assistant turn is a prefill: the house continues it, so the
     * answer served is what follows the prefill (never the prefill again). */
    const last = Array.isArray(body.messages) ? body.messages[body.messages.length - 1] : null;
    const prefill = last && last.role === 'assistant' && typeof last.content === 'string' ? last.content : '';
    const served = prefill && answer.startsWith(prefill) ? answer.slice(prefill.length) : answer;
    const thought = 'Let me reason about the page: {"scratch": [1,2,3]} … the writer says Jovan is at McDonald\'s with Liara … '.repeat(6);

    if (anthropic) {
      if (body.stream) {
        const events = [];
        if (!off) {
          events.push({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
          events.push({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: thought } });
          events.push({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } });
        } else {
          events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
          events.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: served } });
          events.push({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
        }
        return sse(events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n'));
      }
      return jsonRes(off
        ? { content: [{ type: 'text', text: served }], stop_reason: 'end_turn' }
        : { content: [{ type: 'thinking', thinking: thought }], stop_reason: 'max_tokens' });
    }

    if (body.stream) {
      const events = [];
      if (!off) {
        events.push({ choices: [{ delta: { reasoning_content: thought } }] });
        events.push({ choices: [{ delta: {}, finish_reason: 'length' }] });
      } else {
        events.push({ choices: [{ delta: { content: served } }] });
        events.push({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      }
      events.push('data: [DONE]\n\n');
      return sse(events);
    }
    return jsonRes(off
      ? { choices: [{ message: { role: 'assistant', content: served }, finish_reason: 'stop' }] }
      : { choices: [{ message: { role: 'assistant', content: '', reasoning_content: thought }, finish_reason: 'length' }] });
  };
  return { calls, fetch: fetchImpl };
}

/* Swap the global fetch for the mock for the length of fn(). */
export async function withHouse(house, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = house.fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

/* The three openai-compatible shapes the user actually runs, plus Claude. */
export const HOUSES = [
  { name: 'Z.ai (GLM)', conn: { type: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', apiKey: 'k', model: 'glm-5.2', preset: 'zai' } },
  { name: 'OpenRouter', conn: { type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'moonshotai/kimi-k3', preset: 'openrouter' } },
  { name: 'custom (Qwen)', conn: { type: 'openai', baseUrl: 'https://custom.example/v1', apiKey: 'k', model: 'qwen3-235b', preset: 'custom' } },
  { name: 'Claude', conn: { type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'claude-sonnet-4-5' } },
];
