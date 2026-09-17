/* M303 — the Kimi family speaks its own spelling; a refusal is remembered for the spelling refused. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { createProvider } from '../../js/providers/index.js';
import { reasonStyle, effortFor, reasoningIsDown, spokenAs, thinkingHint } from '../../js/providers/effort.js';
import { thinkingHouse, withHouse } from './thinkinghouse.mjs';
import { callWorker } from '../../js/agents/call.js';

const K3 = { type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'k', model: 'kimi-k3' };

/* what really goes out: the real provider, a recording fetch */
async function sentAs(conn, effort) {
  const house = thinkingHouse({ answer: 'x' });
  await withHouse(house, () => callWorker({ ...conn }, { system: 's', user: 'u', effort }).catch(() => null));
  return house.calls[0].body;
}
async function told(conn) {
  const house = thinkingHouse({ answer: 'a page' });
  await withHouse(house, () => createProvider(conn).streamChat({ system: 's', messages: [{ role: 'user', content: 'u' }], onToken() {} }).catch(() => null));
  return house.calls.map((c) => c.body);
}

test('M303-1 Kimi K3 is sent reasoning_effort and nothing else — low, high or max, never off, never medium, never the K2.x thinking block', async () => {
  eq(reasonStyle(K3), 'kimi');
  const want = { off: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' };
  for (const [chosen, said] of Object.entries(want)) {
    const body = await sentAs(K3, chosen);
    eq(body.reasoning_effort, said, chosen + ' is spoken as ' + said);
    assert(!('thinking' in body), chosen + ': no thinking block (K3 "does not support the thinking parameter")');
    assert(!('reasoning' in body) && !('enable_thinking' in body), chosen + ': no other house’s spelling');
  }
  /* the storyteller's own road, with the level kept on the connection */
  const [page] = await told({ ...K3, reasoning: { effort: 'low' } });
  eq(page.reasoning_effort, 'low'); assert(!('thinking' in page));
  /* nothing chosen at all is still said: unsaid, K3 thinks at max */
  const [bare] = await told({ ...K3 });
  eq(bare.reasoning_effort, 'low', 'a connection with no level set is "off" in this house, and off is the least K3 can do');
});

test('M303-2 who is Kimi: K3 by its name on any openai-shaped address; OpenRouter keeps its own map; the K2.x switch only on Moonshot’s address', async () => {
  eq(reasonStyle({ type: 'openai', baseUrl: 'https://api.together.xyz/v1', model: 'moonshotai/Kimi-K3' }), 'kimi', 'K3 behind another address');
  eq(reasonStyle({ type: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3' }), 'kimi');
  eq(reasonStyle({ type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'moonshotai/kimi-k3', preset: 'openrouter' }), 'openrouter', 'OpenRouter maps the ladder itself');
  const or = await sentAs({ type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'moonshotai/kimi-k3', preset: 'openrouter' }, 'low');
  eq(JSON.stringify(or.reasoning), '{"effort":"low"}', 'and its shape is as it was');
  const k26 = { type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'k', model: 'kimi-k2.6' };
  eq(reasonStyle(k26), 'kimi2');
  const off = await sentAs(k26, 'off');
  eq(off.thinking && off.thinking.type, 'disabled'); assert(!('reasoning_effort' in off), 'K2.x: reasoning_effort is "Not supported"');
  const on = await sentAs(k26, 'max');
  eq(on.thinking && on.thinking.type, 'enabled'); assert(!('reasoning_effort' in on));
  const code = await sentAs({ ...k26, model: 'kimi-k2.7-code' }, 'high');
  assert(!('thinking' in code) && !('reasoning_effort' in code), 'k2.7-code always thinks and takes no setting — nothing is sent');
  /* everyone else is as they were */
  eq(reasonStyle({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }), 'deepseek');
  eq(reasonStyle({ type: 'openai', baseUrl: 'https://wafer.example/v1', model: 'some-model' }), 'openai');
  eq(reasonStyle({ type: 'openai', baseUrl: 'https://api.z.ai/v1', model: 'glm-5.2' }), 'zai');
  eq(reasonStyle({ type: 'openai', baseUrl: 'https://wafer.example/v1', model: 'kimi-k2.6' }), 'openai', 'a K2.x name on an unknown address keeps the generic shape');
});

test('M303-3 a refusal is remembered for the spelling refused: a K3 connection silenced under the old generic shape speaks again and the mark is let go; every other mark stands', async () => {
  const pinned = await db.connections.add({ label: 'kimi, pinned to max', ...K3, reasoning: { effort: 'low' } });
  await db.connections.update(pinned.id, { reasoningDownAt: 1700000000000 }); /* made before shapes were kept, under the generic spelling */
  const stored = (await db.connections.list()).find((c) => c.id === pinned.id);
  eq(reasoningIsDown(stored, reasonStyle(stored)), false, 'not held against the new spelling');
  const [body] = await told(stored);
  eq(body.reasoning_effort, 'low', 'the writer’s level goes out again (silence was max)');
  const healed = (await db.connections.list()).find((c) => c.id === pinned.id);
  assert(!healed.reasoningDownAt && !healed.reasoningDownShape, 'and the mark is gone from the store, so Settings and the other browser stop saying "unsent"');

  /* a generic house's old mark still stands — nothing about it changed */
  const other = await db.connections.add({ label: 'a house that refused', type: 'openai', baseUrl: 'https://wafer.example/v1', apiKey: 'k', model: 'some-model', reasoning: { effort: 'high' } });
  await db.connections.update(other.id, { reasoningDownAt: 1700000000000 });
  const otherStored = (await db.connections.list()).find((c) => c.id === other.id);
  eq(reasoningIsDown(otherStored, reasonStyle(otherStored)), true);
  const [quiet] = await told(otherStored);
  assert(!('reasoning_effort' in quiet) && !('thinking' in quiet), 'still unsent, as M22 promised');
  assert((await db.connections.list()).find((c) => c.id === other.id).reasoningDownAt, 'and still marked');

  /* K3 refusing its OWN spelling is remembered as before — with the spelling beside it */
  const refuser = await db.connections.add({ label: 'kimi that says no', ...K3, reasoning: { effort: 'high' } });
  const live = (await db.connections.list()).find((c) => c.id === refuser.id);
  let n = 0;
  const bodies = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const b = JSON.parse(opts.body); bodies.push(b); n += 1;
    if (n === 1) { const text = JSON.stringify({ error: { message: 'invalid reasoning_effort for this account' } }); return { ok: false, status: 400, headers: new Headers(), async json() { return JSON.parse(text); }, async text() { return text; }, clone() { return this; } }; }
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'a page' } }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), clone() { return this; }, async json() { return {}; }, async text() { return sse; } };
  };
  try { await createProvider(live).streamChat({ system: 's', messages: [{ role: 'user', content: 'u' }], onToken() {} }); } finally { globalThis.fetch = prior; }
  eq(bodies.length, 2, 'asked, refused, asked once more without');
  eq(bodies[0].reasoning_effort, 'high'); assert(!('reasoning_effort' in bodies[1]));
  const marked = (await db.connections.list()).find((c) => c.id === refuser.id);
  assert(marked.reasoningDownAt, 'remembered');
  eq(marked.reasoningDownShape, 'kimi', 'for the spelling that was refused');
  eq(reasoningIsDown(marked, 'kimi'), true, 'so it stands');
  for (const c of [pinned, other, refuser]) await db.connections.remove(c.id);
});

test('M303-4 the words Settings says: what each level is spoken as, and the standing word for a house that has one', () => {
  eq(effortFor('kimi', 'off'), 'low'); eq(effortFor('kimi', 'medium'), 'high'); eq(effortFor('kimi', 'xhigh'), 'max');
  assert(/“low”/.test(spokenAs(K3, 'off')) && /always thinks/.test(spokenAs(K3, 'off')), 'Off on K3 says what it becomes, and why: ' + spokenAs(K3, 'off'));
  eq(spokenAs(K3, 'max'), '“max”');
  eq(spokenAs({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }, 'medium'), '“high”', 'the other houses read as before');
  assert(/switched on/.test(spokenAs({ ...K3, model: 'kimi-k2.6' }, 'max')), 'a switch is called a switch');
  assert(/cannot be told not to/.test(thinkingHint(K3)) && /temperature/.test(thinkingHint(K3)), 'K3’s standing word names both facts');
  eq(thinkingHint({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }), '', 'a house with nothing to say says nothing');
});

test('M303-5 a worker riding a house that cannot stop thinking is given room to think AND answer; every other house keeps the room it had', async () => {
  const small = await sentAs(K3, 'off');
  assert(small.max_tokens >= 16000, 'K3: the worker’s 1,200 would be thought away — the floor is Moonshot’s own 16,000: ' + small.max_tokens);
  const roomy = await sentAs({ ...K3, maxTokens: 30000 }, 'off');
  eq(roomy.max_tokens, 30000, 'a connection that already says more keeps what it says');
  const ds = await sentAs({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat' }, 'off');
  eq(ds.max_tokens, 1200, 'a house that can be told off keeps the worker’s own room');
});
