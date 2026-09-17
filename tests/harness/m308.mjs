/* M308 — the thinking room is sent only where a house can hear it; everywhere else the writer's level is. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { createProvider } from '../../js/providers/index.js';
import { budgetFor, effectiveReasoningOf, thinkingHint } from '../../js/providers/effort.js';

const ok = () => { const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'x' } }] }) + '\n\ndata: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), clone() { return this; }, async json() { return {}; }, async text() { return sse; } }; };
async function sent(conn) {
  let body = null; const prior = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { body = JSON.parse(opts.body); return ok(); };
  try { await createProvider(conn).streamChat({ system: 's', messages: [{ role: 'user', content: 'u' }], onToken() {} }).catch(() => null); } finally { globalThis.fetch = prior; }
  return body;
}
const room = (effort, budgetTokens) => ({ reasoning: { effort, budgetTokens } });

test('M308-1 a thinking room of 512 on Kimi or DeepSeek is not something those houses can hear: the LEVEL is sent, and the house says the number is not', async () => {
  const kimi = { type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'k', model: 'kimi-k3', ...room('low', 512) };
  const k = await sent(kimi);
  eq(k.reasoning_effort, 'low'); assert(!JSON.stringify(k).includes('512'), 'no 512 anywhere on the wire: ' + JSON.stringify(k).slice(0, 160));
  eq(budgetFor(kimi).sent, false); assert(/never sent/.test(budgetFor(kimi).words), 'and it is said');
  const ds = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-v4-pro', ...room('high', 512) };
  const d = await sent(ds);
  eq(d.reasoning_effort, 'high'); assert(!JSON.stringify(d).includes('512'));
  eq(budgetFor(ds).sent, false);
});

test('M308-2 through OpenRouter the room no longer throws the writer’s level away: only Claude and Gemini models are sent a room; for every other model the level he chose is what is sent', async () => {
  const or = (model, r) => ({ type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model, preset: 'openrouter', ...r });
  eq(JSON.stringify((await sent(or('moonshotai/kimi-k3', room('low', 512)))).reasoning), '{"effort":"low"}', 'Kimi: his level (it was {"max_tokens":512}, which OpenRouter turns into a level of its own choosing)');
  eq(JSON.stringify((await sent(or('deepseek/deepseek-v4-pro', room('max', 512)))).reasoning), '{"effort":"max"}');
  eq(JSON.stringify((await sent(or('anthropic/claude-sonnet-4.5', room('high', 4000)))).reasoning), '{"max_tokens":4000}', 'Claude takes a real room');
  eq(JSON.stringify((await sent(or('google/gemini-3-pro', room('high', 4000)))).reasoning), '{"max_tokens":4000}', 'and Gemini');
  eq(JSON.stringify((await sent(or('anthropic/claude-sonnet-4.5', { reasoning: { effort: 'high' } }))).reasoning), '{"effort":"high"}', 'no room set: the level');
});

test('M308-3 Claude is never sent a room under its own floor — 512 would be a 400 that names budget_tokens, and the refusal memory would switch the thinking off', async () => {
  const claude = { type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'claude-sonnet-4-5', ...room('high', 512) };
  const b = await sent(claude);
  eq(b.thinking.budget_tokens, 1024);
  assert(b.max_tokens > 1024, 'and the reply keeps room of its own beyond it: ' + b.max_tokens);
  eq((await sent({ ...claude, ...room('high', 6000) })).thinking.budget_tokens, 6000, 'a room above the floor is sent as written');
});

test('M308-4 a story with its own level keeps the connection’s thinking room; the words for Kimi say what “low” is', () => {
  const conn = { reasoning: { effort: 'high', budgetTokens: 6000 } };
  eq(JSON.stringify(effectiveReasoningOf(conn, { reasoningEffort: 'low' })), '{"budgetTokens":6000,"effort":"low"}', 'the story’s level, the connection’s room (the room used to be dropped)');
  eq(JSON.stringify(effectiveReasoningOf(conn, {})), '{"effort":"high","budgetTokens":6000}');
  eq(JSON.stringify(effectiveReasoningOf({}, {})), '{"effort":"off"}');
  assert(/little or no thinking shown/.test(thinkingHint({ type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3' })), 'K3’s lightest setting is named for what it is');
});
