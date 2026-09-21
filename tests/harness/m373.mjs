/* M373: the connection test says how fast the connection is — how long before the first words, and how many tokens a
 * second once it writes — from one streamed answer with the connection's own settings. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { measureStream, speedWords, pickOpenAI, pickAnthropic, SPEED_ASK } from '../../js/providers/speed.js';
import { createProvider } from '../../js/providers/index.js';

/* a stream whose events arrive at the clock times given, on a clock the test owns */
function timedStream(events) {
  let clock = 0;
  let i = 0;
  const enc = new TextEncoder();
  const body = { getReader() { return { async read() { if (i >= events.length) return { done: true }; const [at, line] = events[i++]; clock = at; return { value: enc.encode(line + '\n'), done: false }; } }; } };
  return { res: { body }, now: () => clock };
}
const oa = (text, extra = '') => 'data: ' + JSON.stringify({ choices: [{ delta: text }], ...(extra ? JSON.parse(extra) : {}) });

test('M373-1 FIRST WORDS AFTER, AND TOKENS A SECOND ONCE IT WRITES — the wait before the first word never counted in the speed', async () => {
  const { res, now } = timedStream([
    [800, oa({ reasoning_content: 'Rain.' })],          /* thinking counts as the first word */
    [1300, oa({ content: 'The window held the night.' })],
    [2800, 'data: ' + JSON.stringify({ choices: [], usage: { completion_tokens: 60 } })],
    [2800, 'data: [DONE]'],
  ]);
  const m = await measureStream(res, pickOpenAI, { now, startedAt: 0 });
  eq(m.firstMs, 800, 'first words after 0.8 s — thinking or text, whichever came first');
  eq(m.tokens, 60, 'the provider’s own count');
  eq(m.estimated, false);
  eq(Math.round(m.tps), 120, '60 tokens over the 0.5 s from the first word to the last: 120 a second — the 0.8 s wait not counted');
  assert(/^Speed: first words after 0\.80 s · 120 tokens a second \(60 tokens in 2\.8 s\)\.$/.test(speedWords(m)), speedWords(m));
});

test('M373-2 A PROVIDER THAT REPORTS NO COUNT IS ESTIMATED, AND SAYS SO; nothing streamed is said plainly', async () => {
  const { res, now } = timedStream([[500, oa({ content: 'x'.repeat(400) })], [2500, oa({ content: 'y'.repeat(400) })], [2500, 'data: [DONE]']]);
  const m = await measureStream(res, pickOpenAI, { now, startedAt: 0 });
  eq(m.estimated, true, 'no count came');
  eq(m.tokens, 200, 'estimated from 800 characters');
  assert(/about 100 tokens a second \(200 tokens, estimated from its length/.test(speedWords(m)), speedWords(m));
  const empty = timedStream([[900, 'data: [DONE]']]);
  const none = await measureStream(empty.res, pickOpenAI, { now: empty.now, startedAt: 0 });
  assert(/^Speed: nothing streamed back to time/.test(speedWords(none)), speedWords(none));
  const anth = timedStream([[300, 'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Hm.' } })], [1300, 'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Rain.' } })], [1300, 'data: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 50 } })]]);
  const a = await measureStream(anth.res, pickAnthropic, { now: anth.now, startedAt: 0 });
  eq(a.firstMs, 300, 'Claude’s thinking is its first word too');
  eq(Math.round(a.tps), 50, 'its own count over the second it wrote');
});

test('M373-3 THE TEST ITSELF: after it finds the line good, it times one streamed answer with the connection’s own settings — and a provider that refuses the count request is asked once more without it', async () => {
  const sent = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    sent.push(body);
    if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: 'ready' } }], usage: { completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (body.stream_options) return new Response(JSON.stringify({ error: { message: 'unknown field stream_options' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    const sse = ['data: ' + JSON.stringify({ choices: [{ delta: { content: 'Rain on the glass. '.repeat(20) } }] }), 'data: [DONE]', ''].join('\n');
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const conn = { type: 'openai', baseUrl: 'https://speed.example', model: 'm', apiKey: 'k', temperature: 0.7 };
    const out = await createProvider(conn).test();
    assert(out.ok, 'the line is good');
    assert(/Speed: first words after/.test(out.detail), 'and the test says how fast: ' + out.detail.slice(-160));
    const streamed = sent.filter((b) => b.stream);
    eq(streamed.length, 2, 'one streamed ask with the count request, refused, and one without it');
    eq(streamed[1].temperature, 0.7, 'his own temperature rode it');
    eq(streamed[1].messages[streamed[1].messages.length - 1].content, SPEED_ASK, 'on the test’s fixed ask, never a story');
    assert(!('stream_options' in streamed[1]), 'the second without the count request');
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('M374-1 THE CLOCK STARTS ON THE FIRST REAL WORD: a stream that opens with a bare space before the model has written anything no longer counts the wait as writing time (his “3 tokens a second” on a model that writes at 40)', async () => {
  const { res, now } = timedStream([
    [100, oa({ role: 'assistant', content: ' ' })],       /* the provider opens the stream at once, with nothing in it */
    [4000, oa({ content: 'The window held the night, ' })], /* the model's first real word, four seconds later */
    [7000, oa({ content: 'and the rain kept on.' })],
    [7000, 'data: ' + JSON.stringify({ choices: [], usage: { completion_tokens: 120 } })],
  ]);
  const m = await measureStream(res, pickOpenAI, { now, startedAt: 0 });
  eq(m.firstMs, 4000, 'first words after 4 s — the real ones, not the space at 0.1 s');
  eq(Math.round(m.tps), 40, '120 tokens over the 3 s it wrote: 40 a second — timed from the space it would have read 17');
});

test('M374-2 THINKING THAT WAS COUNTED BUT NEVER STREAMED IS NOT WRITING WE WATCHED: a model that thinks silently is timed on the text it wrote, not credited with its hidden thinking', async () => {
  const { res, now } = timedStream([
    [6000, oa({ content: 'Rain. '.repeat(20) })],
    [8000, oa({ content: 'More rain.' })],
    [8000, 'data: ' + JSON.stringify({ choices: [], usage: { completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 800 } } })],
  ]);
  const m = await measureStream(res, pickOpenAI, { now, startedAt: 0 });
  eq(m.tokens, 100, 'the 100 tokens it wrote where we could see, not the 900 it counted');
  eq(Math.round(m.tps), 50, 'over the 2 s it wrote them — the 800 silent ones would have read 450 a second');
  const shown = timedStream([
    [500, oa({ reasoning_content: 'Hm. '.repeat(50) })],
    [3000, oa({ content: 'Rain.' })],
    [3000, 'data: ' + JSON.stringify({ choices: [], usage: { completion_tokens: 250, completion_tokens_details: { reasoning_tokens: 200 } } })],
  ]);
  const t = await measureStream(shown.res, pickOpenAI, { now: shown.now, startedAt: 0 });
  eq(t.tokens, 250, 'thinking we watched stream is writing, and counts');
  eq(Math.round(t.tps), 100, 'over the 2.5 s from its first thought to its last word');
});

test('M374-3 THE TIMED ANSWER IS LONG ENOUGH TO TRUST — three hundred words, not one hundred', () => {
  assert(/three hundred words/.test(SPEED_ASK), SPEED_ASK);
});

test('M375-1 THE PHRASE IS SEEDED ONLY WHERE THE PROVIDER TRULY CONTINUES A STARTED THOUGHT — elsewhere the seed was an empty extra turn the model read and reasoned about', async () => {
  const { seedContinues } = await import('../../js/providers/effort.js');
  eq(seedContinues({ type: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-reasoner' }), true, 'DeepSeek continues (prefix)');
  eq(seedContinues({ type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2' }), true, 'Moonshot continues (partial)');
  eq(seedContinues({ type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'moonshotai/kimi-k2' }), true, 'a Moonshot model on OpenRouter continues');
  eq(seedContinues({ type: 'openai', baseUrl: 'https://api.synthetic.new/openai/v1', model: 'syn:large:vision' }), false, 'Synthetic has no continuation flag: no seed');
  eq(seedContinues({ type: 'openai', baseUrl: 'https://hemmingway.io', model: 'hemmingway-27b' }), false, 'nor Hemmingway');
  eq(seedContinues({ type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude' }), false, 'Claude takes no thinking seed');
  eq(seedContinues({ type: 'openai', baseUrl: 'https://x.example', model: 'm', prefillFlagField: 'partial' }), true, 'a continuation flag he typed himself counts');
});
