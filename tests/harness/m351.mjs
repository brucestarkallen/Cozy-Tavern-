/* M351: "low still doesn't think" — the house can answer that itself. "Test" on a connection now sends exactly what a
 * page sends for the thinking, reads the answer for thinking in any channel and for the thinking tokens it reports, and
 * when nothing came back asks once more at the top, so the writer is told WHICH it is: this level, this address, or a
 * model that thought and had its words kept from him. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { createProvider } from '../../js/providers/index.js';
import { learnedFacts } from '../../js/providers/effort.js';

const reply = ({ thought = '', said = 'ready.', tokens = null } = {}) => ({
  ok: true, status: 200, headers: new Headers(),
  async json() { return { choices: [{ message: { role: 'assistant', content: said, ...(thought ? { reasoning_content: thought } : {}) } }], ...(tokens === null ? {} : { usage: { completion_tokens_details: { reasoning_tokens: tokens } } }) }; },
  async text() { return '{}'; }, clone() { return this; },
});
const refuse = (message) => ({ ok: false, status: 400, headers: new Headers(), async json() { return { error: { message } }; }, async text() { return JSON.stringify({ error: { message } }); }, clone() { return this; } });

async function runTest(conn, house) {
  const asks = [];
  const real = globalThis.fetch;
  /* M373: the test ends with ONE streamed answer, timed for speed — it is not a question about thinking, so it is kept
   * apart: `asks` are the thinking questions (as before), `timed` the speed reading */
  const timed = [];
  globalThis.fetch = async (url, opts) => {
    const b = JSON.parse(opts.body);
    if (b.stream === true) { timed.push(b); return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(ctl) { ctl.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Rain on the glass."}}]}\n\ndata: [DONE]\n\n')); ctl.close(); } }) }; }
    asks.push(b);
    return house(b, asks.length);
  };
  try {
    const stored = (await db.connections.list()).find((c) => c.id === conn.id) || conn;
    return { out: await createProvider(stored).test(), asks, timed };
  } finally { globalThis.fetch = real; }
}
const conn = async (id, effort, extra = {}) => { const c = { id, type: 'openai', baseUrl: 'https://api.brand-new.example/v1', apiKey: 'k', model: 'nova-' + id, reasoning: { effort }, ...extra }; await db.connections.add(c); return c; };

test('M351-1 IT THINKS: the test says at which level, what was sent for it, and how much came back — in one tap', async () => {
  const c = await conn('t-works', 'low');
  const { out, asks } = await runTest(c, () => reply({ thought: 'I weigh it. '.repeat(10) }));
  eq(asks.length, 1, 'one question');
  eq(asks[0].reasoning_effort, 'low', 'sent as a page sends it');
  eq(asks[0].stream, false, 'and answered whole, not streamed');
  eq(out.ok, true);
  assert(/^Asked at “low” \(reasoning_effort: “low”/.test(out.detail), 'it says the level and what was sent for it: ' + out.detail);
  assert(/119 characters of thinking came back\. Thinking works on this connection\./.test(out.detail), 'and how much came back: ' + out.detail);
});

test('M351-2 THIS LEVEL GIVES NONE, NOT THIS ADDRESS: nothing at the level set, so it asks once at the top and says which it is', async () => {
  const c = await conn('t-level', 'low');
  const { out, asks } = await runTest(c, (b) => (b.reasoning_effort === 'max' ? reply({ thought: 'Long thought. '.repeat(20) }) : reply({})));
  eq(asks.length, 2, 'asked again at the top');
  eq(asks[1].reasoning_effort, 'max', 'at the top');
  assert(/NO thinking with it/.test(out.detail) && /Asked again at “max”/.test(out.detail) && /this LEVEL that gives none here/.test(out.detail), out.detail);
});

test('M351-3 THE WORDS ARE KEPT FROM HIM: no thinking text, but the answer reports thinking tokens — the model thought and this address hides it', async () => {
  const c = await conn('t-hidden', 'high');
  const { out, asks } = await runTest(c, () => reply({ tokens: 310 }));
  eq(asks.length, 1, 'no second question needed');
  assert(/It reported 310 thinking tokens, so the model DID think — this address keeps the words to itself/.test(out.detail), out.detail);
});

test('M351-4 NOTHING AT ANY LEVEL is said plainly, and a refusal on the way teaches the house and is asked again', async () => {
  const c = await conn('t-none', 'low');
  const { out } = await runTest(c, () => reply({}));
  assert(/Nor at “max” — this address sends no thinking back at any level/.test(out.detail), out.detail);
  const t = await conn('t-teach', 'medium');
  const { out: taught, asks } = await runTest(t, (b) => (b.reasoning_effort && !['low', 'high', 'max'].includes(b.reasoning_effort)
    ? refuse("Invalid value: '" + b.reasoning_effort + "'. Supported values are: 'low', 'high', and 'max'.")
    : reply({ thought: 'Weighing.' })));
  eq(asks.length, 2, 'refused, then asked again at what it takes');
  eq(asks[1].reasoning_effort, 'low', 'fitted to its own levels');
  assert(/Thinking works/.test(taught.detail), taught.detail);
  const kept = (await db.connections.list()).find((x) => x.id === 't-teach');
  eq(JSON.stringify(learnedFacts(kept).efforts), JSON.stringify(['low', 'high', 'max']), 'and the lesson is kept from the test, as from a page');
});

test('M351-5 AN OFF THAT THINKS ANYWAY IS LEARNED FROM THE TEST TOO', async () => {
  const c = await conn('t-off', 'off');
  const { out } = await runTest(c, () => reply({ thought: 'Still thinking.' }));
  assert(/Asked at “off”/.test(out.detail) && /Thinking works/.test(out.detail), out.detail);
  const kept = (await db.connections.list()).find((x) => x.id === 't-off');
  eq(learnedFacts(kept).offThinks, true, 'noticed');
});
