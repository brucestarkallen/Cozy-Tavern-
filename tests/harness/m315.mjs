/* M315 — a worker that thinks has room to answer, on every house; the keeper folds a gap instead of going quiet for ever. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { callWorker } from '../../js/agents/call.js';
import { maybeSummarize, loadMemory, keeperTrouble } from '../../js/agents/memory.js';

/* a house whose model THINKS inside the reply's room: under 16,000 tokens the thinking eats it all and no word of the answer comes */
function thinkingHouse(answer) {
  const asked = [];
  const f = async (url, opts) => {
    const body = JSON.parse(opts.body); asked.push(body);
    const room = body.max_tokens || body.max_completion_tokens || 0;
    const pieces = room < 16000
      ? [{ choices: [{ delta: { reasoning_content: 'Let me think about these pages at length… ' } }] }, { choices: [{ delta: {}, finish_reason: 'length' }] }]
      : [{ choices: [{ delta: { reasoning_content: 'Briefly. ' } }] }, { choices: [{ delta: { content: answer } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }];
    const sse = pieces.map((p) => 'data: ' + JSON.stringify(p) + '\n\n').join('') + 'data: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), clone() { return this; }, async json() { return {}; }, async text() { return sse; } };
  };
  return { asked, f };
}
const DS = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-v4-pro' };

test('M315-1 a model that thinks without being asked: the empty, all-thinking answer is asked again ONCE with room to answer — and a connection that answers is never given more than it asked for', async () => {
  const h = thinkingHouse('Jovan came home; Liara found the unread letter.');
  const prior = globalThis.fetch; globalThis.fetch = h.f;
  let got = null;
  try { got = await callWorker({ ...DS }, { system: 's', user: 'u', maxTokens: 1600 }); } finally { globalThis.fetch = prior; }
  eq(h.asked.length, 2, 'asked twice');
  eq(h.asked[0].max_tokens, 1600, 'first exactly as the worker asked'); eq(h.asked[1].max_tokens, 16000, 'then with room to think AND answer');
  eq(got.text, 'Jovan came home; Liara found the unread letter.');
  assert(got.notes.some((n) => /all thinking and no words/.test(n)), 'and it is said');
  /* a house that simply answers */
  const plain = []; globalThis.fetch = async (url, opts) => { plain.push(JSON.parse(opts.body)); const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'A line.' } }] }) + '\n\ndata: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), clone() { return this; }, async json() { return {}; }, async text() { return sse; } }; };
  try { await callWorker({ ...DS }, { system: 's', user: 'u', maxTokens: 1600 }); } finally { globalThis.fetch = prior; }
  eq(plain.length, 1); eq(plain[0].max_tokens, 1600, 'one ask, the room it asked for');
});

test('M315-2 a connection the writer SET to think gives its worker the room from the first ask — one call, not two', async () => {
  const h = thinkingHouse('A line.');
  const prior = globalThis.fetch; globalThis.fetch = h.f;
  try { await callWorker({ ...DS, reasoning: { effort: 'high' } }, { system: 's', user: 'u', maxTokens: 1600 }); } finally { globalThis.fetch = prior; }
  eq(h.asked.length, 1); eq(h.asked[0].max_tokens, 16000);
  eq(h.asked[0].reasoning_effort, 'high', 'and his level is sent as he set it');
  const off = thinkingHouse('A line.'); globalThis.fetch = async (u, o) => { const b = JSON.parse(o.body); off.asked.push(b); const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'A line.' } }] }) + '\n\ndata: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), clone() { return this; }, async json() { return {}; }, async text() { return sse; } }; };
  try { await callWorker({ ...DS, reasoning: { effort: 'off' } }, { system: 's', user: 'u', maxTokens: 1600 }); } finally { globalThis.fetch = prior; }
  eq(off.asked[0].max_tokens, 1600, 'thinking off: the answer’s own room, untouched');
});

test('M315-3 THE WRITER’S YELLOW LIGHT: a keeper riding a thinking model folds the gap — it used to read the empty answer as "the worker went quiet" after every page, for ever', async () => {
  const story = await db.stories.create({ title: 'a gap in the record' });
  for (let i = 0; i < 16; i += 1) await db.messages.append(story.id, { role: i % 2 ? 'assistant' : 'user', text: (i % 2 ? 'Page ' : 'Turn ') + i + ': Jovan and Liara talked on the porch about the letter and the fair. ' + 'The street went quiet. '.repeat(6) });
  await db.settings.set('memoryWindow', 4); await db.settings.set('memoryBatch', 6);
  const h = thinkingHouse('Jovan and Liara talked on the porch about the letter and the fair; the street went quiet; Liara asked him to stay for the fair.');
  const prior = globalThis.fetch; globalThis.fetch = h.f;
  try { await maybeSummarize({ connection: { ...DS }, storyId: story.id, stale: () => false, renew: () => true }); } finally { globalThis.fetch = prior; }
  const mem = await loadMemory(story.id);
  assert(mem.nodes.length >= 1 && /porch/.test(mem.nodes[0].text), 'a line landed: ' + JSON.stringify(mem.nodes.map((n) => n.span)));
  eq(mem.nodes[0].span[0], 0, 'from the oldest uncovered page');
  /* and when a run still folds nothing, it says why */
  const quiet = async () => { const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking…' } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] }) + '\n\ndata: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), clone() { return this; }, async json() { return {}; }, async text() { return sse; } }; };
  const other = await db.stories.create({ title: 'a model that never answers' });
  for (let i = 0; i < 16; i += 1) await db.messages.append(other.id, { role: i % 2 ? 'assistant' : 'user', text: 'Page ' + i + ': words enough to fold, the river rose another hand and the ferry did not run.' });
  globalThis.fetch = quiet;
  try { await maybeSummarize({ connection: { ...DS }, storyId: other.id, stale: () => false, renew: () => true }); } finally { globalThis.fetch = prior; }
  eq((await loadMemory(other.id)).nodes.length, 0);
  assert(/spent its whole answer on thinking/.test(keeperTrouble()), 'the reason is said: ' + keeperTrouble());
  await db.settings.delete('memoryWindow'); await db.settings.delete('memoryBatch');
});
