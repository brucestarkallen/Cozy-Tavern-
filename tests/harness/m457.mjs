/* M457: what every call to a model cost — metered on the one road (relay.js houseFetch), kept a day at a time, summed
 * over a day, a week and a month, averaged, and priced from each connection's own prices. Runs the real road with a
 * stubbed wire, the real book and the real sums. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { houseFetch } from '../../js/providers/relay.js';
import { noteUsage } from '../../js/providers/meter.js';
import { summarize, dayKey, USAGE_PREFIX, addToDay } from '../../js/engine/usage.js';

const sse = (events) => events.map((e) => 'data: ' + (typeof e === 'string' ? e : JSON.stringify(e)) + '\n\n').join('');
const wire = (text, type = 'text/event-stream') => async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { status: 200, headers: { 'content-type': type } });
const readAll = async (res) => { const r = res.body.getReader(); const d = new TextDecoder(); let t = ''; for (;;) { const { value, done } = await r.read(); if (done) break; t += d.decode(value, { stream: true }); } return t; };
const book = async () => (await db.settings.get(USAGE_PREFIX + dayKey(Date.now()))) || {};

test('M457-1 A STREAMED CALL IS METERED AS THE PROVIDER REPORTS IT — the caller reads every byte it would have; DeepSeek-style usage lands on its connection and model', async () => {
  const before = await book();
  const body = sse([{ choices: [{ delta: { content: 'Rukia bowed.' } }] }, { choices: [{ delta: {} , finish_reason: 'stop' }], usage: { prompt_tokens: 12000, completion_tokens: 850 } }, '[DONE]']);
  const was = globalThis.fetch;
  globalThis.fetch = wire(body);
  try {
    const res = await houseFetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'deepseek-chat', stream: true, messages: [{ role: 'user', content: 'hi' }] }) }, { id: 'c-ds', label: 'DeepSeek' });
    eq(await readAll(res), body, 'the caller’s stream is untouched');
  } finally { globalThis.fetch = was; }
  await noteUsage.length; await new Promise((r) => setTimeout(r, 50));
  const row = (await book())['c-ds|deepseek-chat'];
  const old = before['c-ds|deepseek-chat'] || { in: 0, out: 0, calls: 0 };
  eq(row.in - old.in, 12000, 'input as reported');
  eq(row.out - old.out, 850, 'output as reported');
  eq(row.calls - old.calls, 1, 'one call');
});

test('M457-2 CLAUDE’S STREAM (input at the start, output at the end, the cache counted in), A JSON ANSWER, AND A PROVIDER THAT REPORTS NOTHING (estimated)', async () => {
  const was = globalThis.fetch;
  try {
    globalThis.fetch = wire('event: message_start\n' + sse([{ type: 'message_start', message: { usage: { input_tokens: 900, cache_read_input_tokens: 100, output_tokens: 1 } } }]) + 'event: content_block_delta\n' + sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }]) + 'event: message_delta\n' + sse([{ type: 'message_delta', usage: { output_tokens: 321 } }]));
    await readAll(await houseFetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'claude-opus-5-5', stream: true, messages: [{ role: 'user', content: 'hi' }] }) }, { id: 'c-cl', label: 'Claude' }));
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"mutations":[]}' } }], usage: { prompt_tokens: 5000, completion_tokens: 40 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    await (await houseFetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'read the page' }] }) }, { id: 'c-w', label: 'Worker' })).json();
    globalThis.fetch = wire(sse([{ choices: [{ delta: { content: 'x'.repeat(400) } }] }, '[DONE]']));
    await readAll(await houseFetch('https://example.org/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'local', stream: true, messages: [{ role: 'user', content: 'y'.repeat(4000) }] }) }, { id: 'c-loc', label: 'Local' }));
    globalThis.fetch = async () => new Response('{"data":[]}', { status: 200 });
    await (await houseFetch('https://api.deepseek.com/v1/models', { method: 'GET' }, { id: 'c-w' })).json();
  } finally { globalThis.fetch = was; }
  await new Promise((r) => setTimeout(r, 80));
  const b = await book();
  eq(b['c-cl|claude-opus-5-5'].in, 1000, 'Claude: input plus the cache read');
  eq(b['c-cl|claude-opus-5-5'].out, 321, 'Claude: the final output count');
  eq(b['c-w|deepseek-chat'].in, 5000, 'a JSON answer’s usage');
  const loc = b['c-loc|local'];
  assert(loc && loc.estimated === 1 && loc.out === 100 && loc.in > 1000, 'estimated at four characters a token: ' + JSON.stringify(loc));
  assert(!Object.keys(b).some((k) => k.includes('models')), 'a model list is not a call to a model');
});

test('M457-3 THE SUMS AND THE MONEY — today, 7 days, 30 days; per day over the days used; a week and a month at that rate; priced per connection, unpriced said', () => {
  const now = new Date(2026, 8, 24, 15, 0).getTime();
  const day = (offset) => dayKey(now - offset * 86400000);
  let books = {};
  books[day(0)] = addToDay({}, { connId: 'a', connName: 'Claude', model: 'opus', inTok: 1_000_000, outTok: 100_000 });
  books[day(0)] = addToDay(books[day(0)], { connId: 'b', connName: 'DeepSeek', model: 'chat', inTok: 4_000_000, outTok: 200_000 });
  books[day(3)] = addToDay({}, { connId: 'a', connName: 'Claude', model: 'opus', inTok: 2_000_000, outTok: 200_000 });
  books[day(9)] = addToDay({}, { connId: 'b', connName: 'DeepSeek', model: 'chat', inTok: 3_000_000, outTok: 0 });
  books[day(40)] = addToDay({}, { connId: 'a', connName: 'Claude', model: 'opus', inTok: 9_000_000, outTok: 0 });
  const conns = [{ id: 'a', label: 'Claude', priceIn: 5, priceOut: 25 }, { id: 'b', label: 'DeepSeek', priceIn: 0.28, priceOut: 0.42 }];
  const s = summarize(books, conns, now);
  eq(s.today.total.in, 5_000_000, 'today in');
  eq(Math.round(s.today.total.cost * 100) / 100, 5 + 2.5 + 1.12 + 0.084 > 0 ? Math.round((5 + 2.5 + 1.12 + 0.084) * 100) / 100 : 0, 'today’s money: Claude 1M in ×$5 + 0.1M out ×$25, DeepSeek 4M ×$0.28 + 0.2M ×$0.42');
  eq(s.week.total.in, 7_000_000, 'seven days (day 9 and day 40 outside)');
  eq(s.month.total.in, 10_000_000, 'thirty days (day 40 outside)');
  eq(s.days, 10, 'averaged over the ten days from the first used day to today');
  eq(s.perDay.in, 1_000_000, 'per day');
  eq(s.perMonth.in, 30_000_000, 'a month at that rate');
  eq(s.month.rows[0].name, 'DeepSeek', 'rows by the most tokens first');
  const unpriced = summarize(books, [{ id: 'a', label: 'Claude' }], now);
  assert(unpriced.today.total.unpriced === true && unpriced.today.rows.every((r) => r.cost === null), 'no price set: said, never guessed');
});
