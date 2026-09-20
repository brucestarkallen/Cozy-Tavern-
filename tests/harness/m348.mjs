/* M348: Kimi K3 behind Synthetic's alias ("syn:large:vision") was read as a generic model: the house sent it the
 * generic thinking shape — a `thinking` switch Moonshot says K3 must not be sent, "off" as a switch-off plus NO effort
 * (K3 cannot stop thinking, and unsaid means max), and levels K3 does not have. The provider's own listing says what
 * the model is (hugging_face_id) and which levels it takes (reasoning_parameters.efforts); the house now learns both
 * and speaks Moonshot's documented K3 request. These laws run the provider, the learning and the request itself. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { createProvider } from '../../js/providers/index.js';
import { learnContext } from '../../js/providers/detect.js';
import { reasonStyle, spokenAs, thinkingHint } from '../../js/providers/effort.js';
import { finalizeReceipt } from '../../js/assemble/receipt.js';

/* the writer's own listing, as he pasted it */
const SYN_K3 = { provider: 'synthetic', always_on: true, id: 'syn:large:vision', hugging_face_id: 'moonshotai/Kimi-K3', name: 'syn:large:vision', reasoning_parameters: { efforts: ['low', 'high', 'max'] }, quantization: 'mxfp4', context_length: 1048576 };
const LISTING = [SYN_K3, { id: 'syn:glm', hugging_face_id: 'zai-org/GLM-5.2' }, { id: 'syn:ds', hugging_face_id: 'deepseek-ai/DeepSeek-V4' }];

function withHouse(fn, seen) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (/\/models$/.test(u)) { seen.lists.push(u); return new Response(JSON.stringify({ data: LISTING }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    seen.bodies.push(JSON.parse(opts.body));
    const text = 'data: {"choices":[{"delta":{"content":"The page."}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), async json() { return {}; }, async text() { return text; } };
  };
  return fn().finally(() => { globalThis.fetch = real; });
}
const LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
const thinkingOf = (b) => JSON.stringify({ reasoning_effort: b.reasoning_effort, thinking: b.thinking });

test('M348-1 THE LISTING SAYS WHAT THE MODEL IS: Synthetic’s alias carries Kimi K3’s weights and its three levels', async () => {
  const seen = { lists: [], bodies: [] };
  const got = await withHouse(() => createProvider({ type: 'openai', baseUrl: 'https://api.synthetic.new/openai/v1', apiKey: 'k', model: 'syn:large:vision' }).listModels(), seen);
  const k3 = got.find((m) => m.id === 'syn:large:vision');
  eq(k3.hf, 'moonshotai/Kimi-K3', 'the weights behind the alias');
  eq(JSON.stringify(k3.efforts), JSON.stringify(['low', 'high', 'max']), 'the levels it takes');
  eq(k3.context, 1048576, 'and its room, as before');
});

test('M348-2 KIMI K3 BEHIND “syn:large:vision” IS SENT MOONSHOT’S OWN K3 REQUEST AT EVERY LEVEL — measured before and after the house learns what it is', async () => {
  const seen = { lists: [], bodies: [] };
  const conn = { id: 'c-syn', type: 'openai', baseUrl: 'https://api.synthetic.new/openai/v1', apiKey: 'k', model: 'syn:large:vision', contextSize: 1000000 };
  await db.connections.add(conn);
  const send = async (c, effort) => { await createProvider({ ...c, reasoning: { effort } }).streamChat({ systemBlocks: [{ text: 'You are Iron Man.' }], messages: [{ role: 'user', content: 'Hello.' }], onToken() {} }); return seen.bodies[seen.bodies.length - 1]; };
  const before = {};
  await withHouse(async () => { for (const l of LEVELS) before[l] = thinkingOf(await send(conn, l)); }, seen);
  eq(reasonStyle(conn), 'openai', 'unlearned, the alias reads as a generic model');
  eq(before.low, JSON.stringify({ reasoning_effort: 'low', thinking: { type: 'enabled' } }), 'BEFORE — low: the effort, and a thinking switch K3 must not be sent');
  eq(before.off, JSON.stringify({ thinking: { type: 'disabled' } }), 'BEFORE — off: a switch-off and no effort (K3 cannot stop; unsaid is max)');
  eq(before.medium, JSON.stringify({ reasoning_effort: 'medium', thinking: { type: 'enabled' } }), 'BEFORE — medium: a level K3 does not have');
  const learned = await withHouse(() => learnContext(conn), seen);
  eq(seen.lists.length, 1, 'one question, though his room was set by hand');
  eq(learned.modelHf, 'moonshotai/Kimi-K3', 'learned');
  const kept = (await db.connections.list()).find((c) => c.id === 'c-syn');
  eq(kept.modelHf, 'moonshotai/Kimi-K3', 'and kept on the connection');
  eq(reasonStyle(kept), 'kimi', 'read as Kimi K3 now');
  const after = {};
  await withHouse(async () => { for (const l of LEVELS) after[l] = thinkingOf(await send(kept, l)); }, seen);
  const want = { off: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' };
  for (const l of LEVELS) eq(after[l], JSON.stringify({ reasoning_effort: want[l] }), 'AFTER — ' + l + ': reasoning_effort "' + want[l] + '" and nothing else, as Moonshot documents K3');
  await withHouse(() => learnContext(kept), seen);
  eq(seen.lists.length, 1, 'known: not asked again');
  assert(/Kimi K3 always thinks/.test(spokenAs(kept, 'off')), 'the card says what off means for it: ' + spokenAs(kept, 'off'));
  assert(/Kimi K3/.test(thinkingHint(kept)), 'and the form’s hint names it');
  process.env.SHOW_M348 && console.log('BEFORE', JSON.stringify(before), '\nAFTER', JSON.stringify(after));
});

test('M348-3 THE WHOLE CLASS: any family behind an alias is read by the weights its provider names — GLM and DeepSeek too; an alias learned for one model is not taken for another', () => {
  const at = 'https://api.synthetic.new/openai/v1';
  const known = (model, hf) => ({ type: 'openai', baseUrl: at, model, identFor: model + '@' + at, modelHf: hf });
  eq(reasonStyle(known('syn:glm', 'zai-org/GLM-5.2')), 'zai', 'GLM behind an alias');
  eq(reasonStyle(known('syn:ds', 'deepseek-ai/DeepSeek-V4')), 'deepseek', 'DeepSeek behind an alias');
  eq(reasonStyle({ ...known('syn:large:vision', 'moonshotai/Kimi-K3'), model: 'syn:other' }), 'openai', 'facts learned for another model are not this one’s');
});

test('M348-4 “DID IT THINK?” IS NEVER A GUESS: a page that asked for thinking and got none says so on its receipt', () => {
  eq(finalizeReceipt({ slots: [] }, { effort: 'low', noThought: true }).noThought, true, 'said');
  assert(!('noThought' in finalizeReceipt({ slots: [] }, { effort: 'low', noThought: false })), 'not said when it thought');
});
