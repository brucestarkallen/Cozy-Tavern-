/* Cozy Tavern — agents/call.js
 * M28: the ONE way a worker speaks to a model.
 *
 * Until M28 every ledger worker (extractor, scribe, keeper, second reader,
 * referee) carried its own pair of hand-rolled fetches — six wire paths in
 * the house, five of them ignorant of the reasoning ladder in
 * providers/effort.js. So a worker on a thinking model (GLM on Z.ai, Kimi
 * behind OpenRouter, Qwen on a custom address) was never told to stop
 * thinking: it thought first, spent its whole token budget on
 * reasoning_content, and answered with nothing. The parser saw '' and the
 * ledger sat empty — "its answer could not be used", turn after turn.
 * Raising max_tokens (M26, 600 → 2000) only moved the cliff.
 *
 * The root fix: workers ride the same providers the storyteller rides.
 * createProvider() already spells "no thinking" per house — Z.ai
 * thinking:{type:'disabled'}, OpenRouter reasoning:{enabled:false}, Qwen
 * enable_thinking:false, Anthropic no thinking block, DeepSeek nothing —
 * and already routes any thinking that arrives anyway onto its own channel,
 * so the answer text is the answer text. Rejection memory, address
 * normalization, image parts, kind error words: all of it, once.
 *
 *   callWorker(connection, {system, user | messages, maxTokens, effort,
 *                           temperature, signal})
 *     -> { text, thinking, finishReason, notes }
 *
 * Throws on transport failure (the queue retries with backoff, honoring
 * err.retryAfterMs — see providers/wire.js transportError). Never throws
 * for an empty answer: that is the caller's to judge.
 *
 * Effort defaults to 'off' — a ledger worker is a clerk, not a thinker. A
 * worker that genuinely earns a little thought (the world agent, later)
 * passes its own level; the ladder still decides what the house can say.
 */

import { createProvider } from '../providers/index.js';

export const WORKER_MAX_TOKENS = 1200;

/* The connection as a worker holds it: the writer's key, address, model and
 * refusal memory — never the storyteller's dials. The prefill and the web
 * search are the storyteller's; a worker gets none of either. */
export function workerConnection(connection, { maxTokens, effort, temperature } = {}) {
  const c = { ...connection };
  delete c.prefill;
  delete c.searchOn;
  delete c.topP;
  c.temperature = Number.isFinite(temperature) ? temperature : 0;
  c.maxTokens = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.round(maxTokens) : WORKER_MAX_TOKENS;
  c.reasoning = { effort: typeof effort === 'string' && effort ? effort : 'off' };
  return c;
}

export async function callWorker(connection, { system, user, messages, maxTokens, effort, temperature, signal } = {}) {
  if (!connection || typeof connection !== 'object') throw new Error('no connection');
  const conn = workerConnection(connection, { maxTokens, effort, temperature });
  const provider = createProvider(conn);
  const list = Array.isArray(messages) && messages.length
    ? messages
    : [{ role: 'user', content: String(user || '') }];
  const result = await provider.streamChat({
    system: String(system || ''),
    messages: list,
    signal,
    onToken() { /* a worker's words are read whole, never streamed to a page */ },
  });
  return {
    text: typeof result.text === 'string' ? result.text : '',
    thinking: typeof result.thinking === 'string' ? result.thinking : '',
    finishReason: result.finishReason || null,
    notes: Array.isArray(result.notes) ? result.notes : [],
  };
}
