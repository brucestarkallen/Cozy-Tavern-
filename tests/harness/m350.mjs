/* M350: "why can't the house learn the thinking from the provider, so a new model needs no update?" — it learns it from
 * the model's own answers. These laws run the real provider against houses that behave like models the house has never
 * heard of: one that refuses a level and names the ones it takes, one that refuses a field, one whose Off does not stop
 * it, one that sends its thinking under a new name. Each is learned once, kept on the connection, and used. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { createProvider } from '../../js/providers/index.js';
import { lessonFrom, learnedFacts, LEARN_FOR_MS } from '../../js/providers/effort.js';

const sse = (frames) => {
  const text = frames.map((f) => 'data: ' + JSON.stringify(f) + '\n\n').join('') + 'data: [DONE]\n\n';
  return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), async json() { return {}; }, async text() { return text; }, clone() { return this; } };
};
const refuse = (message) => ({ ok: false, status: 400, headers: new Headers(), async json() { return { error: { message } }; }, async text() { return JSON.stringify({ error: { message } }); }, clone() { return this; } });
const thoughtAndPage = [{ choices: [{ delta: { reasoning_content: 'I weigh the scene.' } }] }, { choices: [{ delta: { content: 'The page.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }];

async function turn(conn, effort, house) {
  const bodies = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { const b = JSON.parse(opts.body); bodies.push(b); return house(b); };
  try {
    const stored = (await db.connections.list()).find((c) => c.id === conn.id) || conn;
    const res = await createProvider({ ...stored, reasoning: { effort } }).streamChat({ systemBlocks: [{ text: 's' }], messages: [{ role: 'user', content: 'u' }], onToken() {} });
    return { res, bodies };
  } finally { globalThis.fetch = real; }
}
const fresh = async (id, model) => { const c = { id, type: 'openai', baseUrl: 'https://api.brand-new.example/v1', apiKey: 'k', model }; await db.connections.add(c); return c; };

test('M350-1 A REFUSAL IS READ: the values it offers instead (never the one it refused), or the one field it does not take — and nothing is made up from a refusal that says neither', () => {
  eq(JSON.stringify(lessonFrom("Invalid value: 'medium'. Supported values are: 'low', 'high', and 'max'.", { reasoning_effort: 'medium' })), JSON.stringify({ allowed: ['low', 'high', 'max'], badField: null }), 'the OpenAI shape');
  eq(JSON.stringify(lessonFrom("1 validation error for ChatRequest reasoning_effort Input should be 'low', 'medium' or 'high' [type=literal_error, input_value='max']", { reasoning_effort: 'max' }).allowed), JSON.stringify(['low', 'medium', 'high']), 'the vLLM / pydantic shape');
  eq(JSON.stringify(lessonFrom('reasoning_effort must be one of [none, high, max], got medium', { reasoning_effort: 'medium' }).allowed), JSON.stringify(['none', 'high', 'max']), 'a list with the refused value after it');
  eq(lessonFrom('Unrecognized request argument supplied: thinking', { thinking: {}, reasoning_effort: 'low' }).badField, 'thinking', 'a field it does not take');
  eq(lessonFrom('thinking: Extra inputs are not permitted', { thinking: {} }).badField, 'thinking', 'the pydantic way of saying it');
  eq(lessonFrom('enable_thinking is not supported for this model', { enable_thinking: true }).badField, 'enable_thinking', 'another field');
  const none = lessonFrom('reasoning_effort is invalid', { reasoning_effort: 'medium' });
  eq(JSON.stringify(none), JSON.stringify({ allowed: null, badField: null }), 'a refusal that says neither teaches nothing');
  eq(lessonFrom("thinking.type must be one of 'enabled', 'disabled'", { thinking: { type: 'x' } }).allowed, null, 'a switch’s values are not thinking levels');
});

test('M350-2 A MODEL THE HOUSE HAS NEVER HEARD OF, THAT TAKES ONLY low/high/max: asked for Medium, it refuses and says so — the SAME turn goes again at "low" and thinks (it used to go without thinking for a day); from then on only its own levels are sent, first time', async () => {
  const conn = await fresh('c-nova', 'nova-9');
  const house = (b) => (b.reasoning_effort && !['low', 'high', 'max'].includes(b.reasoning_effort) ? refuse("Invalid value: '" + b.reasoning_effort + "'. Supported values are: 'low', 'high', and 'max'.") : sse(thoughtAndPage));
  const t1 = await turn(conn, 'medium', house);
  eq(t1.bodies.length, 2, 'refused once, then taken');
  eq(t1.bodies[1].reasoning_effort, 'low', 'again at once, at the nearest it takes');
  eq(t1.res.thinking, 'I weigh the scene.', 'and the page came with its thinking');
  assert(t1.res.notes.some((n) => /said which thinking levels it takes \(low, high, max\)/.test(n)), 'the page says what was learned');
  const kept = (await db.connections.list()).find((c) => c.id === 'c-nova');
  eq(JSON.stringify(kept.learnedEfforts), JSON.stringify(['low', 'high', 'max']), 'kept on the connection');
  assert(!kept.reasoningDownAt, 'and the thinking was NOT silenced');
  for (const [asked, sent] of [['medium', 'low'], ['xhigh', 'high'], ['max', 'max'], ['low', 'low']]) {
    const t = await turn(conn, asked, house);
    eq(t.bodies.length, 1, asked + ': one request');
    eq(t.bodies[0].reasoning_effort, sent, asked + ' is sent as its own "' + sent + '"');
  }
});

test('M350-3 AN ADDRESS THAT DOES NOT TAKE THE `thinking` SWITCH: the same turn goes again without it and STILL asks for thinking; from then on it is left out, first time', async () => {
  const conn = await fresh('c-strict', 'aurora-2');
  const house = (b) => ('thinking' in b ? refuse('Unrecognized request argument supplied: thinking') : sse(thoughtAndPage));
  const t1 = await turn(conn, 'high', house);
  eq(t1.bodies.length, 2, 'refused once, then taken');
  assert(!('thinking' in t1.bodies[1]) && t1.bodies[1].reasoning_effort === 'high', 'again without the switch, with the level: ' + JSON.stringify(t1.bodies[1]));
  eq(t1.res.thinking, 'I weigh the scene.', 'and it thought');
  const kept = (await db.connections.list()).find((c) => c.id === 'c-strict');
  eq(JSON.stringify(kept.learnedDrop), JSON.stringify(['thinking']), 'kept');
  assert(!kept.reasoningDownAt, 'not silenced');
  const t2 = await turn(conn, 'high', house);
  eq(t2.bodies.length, 1, 'next turn: one request');
  assert(!('thinking' in t2.bodies[0]) && t2.bodies[0].reasoning_effort === 'high', 'left out, the level kept');
});

test('M350-4 AN OFF THAT DOES NOT STOP THE THINKING IS NOTICED: from then on Off asks for the least the model takes, never its own default; a model already known to always think is not “taught” again', async () => {
  const conn = await fresh('c-stubborn', 'orbit-5');
  const always = () => sse(thoughtAndPage);
  const t1 = await turn(conn, 'off', always);
  eq(JSON.stringify(t1.bodies[0].thinking), JSON.stringify({ type: 'disabled' }), 'asked to be off');
  assert(t1.res.notes.some((n) => /Off did not stop this model thinking/.test(n)), 'noticed, and said');
  const t2 = await turn(conn, 'off', always);
  eq(t2.bodies[0].reasoning_effort, 'low', 'Off now asks for the least');
  eq(JSON.stringify(t2.bodies[0].thinking), JSON.stringify({ type: 'enabled' }), 'and does not contradict itself');
  const k3 = await fresh('c-k3', 'kimi-k3');
  const t3 = await turn(k3, 'off', always);
  assert(!t3.res.notes.some((n) => /Off did not stop/.test(n)), 'K3 is already known to think always');
});

test('M350-5 THINKING UNDER A NAME NO PROVIDER USED BEFORE IS STILL THINKING', async () => {
  const conn = await fresh('c-newname', 'zephyr-1');
  const t = await turn(conn, 'high', () => sse([{ choices: [{ delta: { thought_text: 'A new channel.' } }] }, { choices: [{ delta: { content: 'Page.' } }] }]));
  eq(t.res.thinking, 'A new channel.', 'read as thinking');
  eq(t.res.text, 'Page.', 'the page is the page');
});

test('M350-6 WHAT WAS LEARNED BELONGS TO THAT MODEL AT THAT ADDRESS, FOR THIRTY DAYS', async () => {
  const kept = (await db.connections.list()).find((c) => c.id === 'c-nova');
  assert(learnedFacts(kept), 'known');
  eq(learnedFacts({ ...kept, model: 'nova-10' }), null, 'another model: not its lessons');
  eq(learnedFacts({ ...kept, baseUrl: 'https://elsewhere.example/v1' }), null, 'another address: not its lessons');
  eq(learnedFacts(kept, Date.now() + LEARN_FOR_MS + 1), null, 'thirty days on: learned again');
});
