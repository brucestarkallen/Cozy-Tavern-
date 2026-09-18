/* B9 finish reasons; B16 shared SSE; A4 cache breakpoint on the wire. */
import { test, assert, eq } from './lib.mjs';
import { readSSE } from '../../js/providers/sse.js';
import { createProvider } from '../../js/providers/index.js';

function sseResponse(text) {
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
  return { ok: true, status: 200, body, async json() { return {}; }, async text() { return text; } };
}
function withFetch(fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return fn(url, opts); };
  return { calls, restore() { globalThis.fetch = real; } };
}

test('B16: readSSE handles multi-line data, CRLF, and partial chunks', async () => {
  const events = [];
  const chunks = ['data: {"a":', '1}\r\n\r\ndata: {"b":\n2}\n\r\ndata: [DONE]\n\n'];
  const body = new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } });
  await readSSE(body, (e) => events.push(e));
  eq(events.length, 2, 'two events');
  eq(events[0].a, 1);
});

test('B9: openai-compatible surfaces finish_reason ("length" = cut short)', async () => {
  const { calls, restore } = withFetch(() => sseResponse(
    'data: {"choices":[{"delta":{"content":"Half a"}}]}\n\n'
    + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'
  ));
  const p = createProvider({ type: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm' });
  const r = await p.streamChat({ systemBlocks: [{ text: 's', cache: true }], messages: [{ role: 'user', content: 'hi' }], onToken() {} });
  restore();
  eq(r.text, 'Half a');
  eq(r.finishReason, 'length', 'finish reason surfaces');
  const body = JSON.parse(calls[0].opts.body);
  eq(body.messages[0].role, 'system', 'leading system message');
});

test('A4: openai mapping sends ONE system message, the stable prefix leading it and the scene’s blocks following in order (M321)', async () => {
  const { calls, restore } = withFetch(() => sseResponse('data: [DONE]\n\n'));
  const p = createProvider({ type: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm' });
  await p.streamChat({
    systemBlocks: [{ text: 'frame', cache: true }, { text: 'craft', cache: true }, { text: 'brief', cache: false }, { text: 'whos here', cache: false }],
    messages: [{ role: 'user', content: 'hi' }], onToken() {},
  });
  restore();
  const body = JSON.parse(calls[0].opts.body);
  /* M321: ONE system message — three in a row read to the storyteller as "hints layered on each other". The stable
   * prefix still LEADS it byte for byte, which is all a provider's prefix cache keys on. */
  eq(body.messages[0].content, 'frame\n\ncraft\n\nbrief\n\nwhos here', 'one system message');
  assert(body.messages[0].content.startsWith('frame\n\ncraft'), 'the stable prefix leads it');
  eq(body.messages.filter((m) => m.role === 'system').length, 1, 'and there is only one');
  assert(body.messages[0].content.indexOf('brief') < body.messages[0].content.indexOf('whos here'), 'slots 3 and 4 follow, in order');
});

test('B9 + A4: anthropic surfaces stop_reason and caches only through slot 2', async () => {
  const { calls, restore } = withFetch(() => sseResponse(
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n'
    + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n'
  ));
  const p = createProvider({ type: 'anthropic', baseUrl: 'https://x', apiKey: 'k', model: 'm' });
  const r = await p.streamChat({
    systemBlocks: [{ text: 'frame', cache: true }, { text: 'craft', cache: true }, { text: 'brief', cache: false }],
    messages: [{ role: 'user', content: 'hi' }], onToken() {},
  });
  restore();
  eq(r.finishReason, 'max_tokens', 'stop reason surfaces');
  const body = JSON.parse(calls[0].opts.body);
  const cached = body.system.filter((b) => b.cache_control);
  eq(cached.length, 1, 'exactly one cache breakpoint');
  eq(cached[0].text, 'craft', 'the breakpoint ends slot 2 (The craft)');
});

/* M160: an error frame that arrives after prose has landed used to be
 * dropped — the page was saved as if whole, and the record folded a
 * half-sentence in as the storyteller's finished work. */
test('M160: a wire that breaks mid-page keeps the words, marks the page cut short, and says so', async () => {
  for (const type of ['openai', 'anthropic']) {
    const frames = type === 'openai'
      ? 'data: {"choices":[{"delta":{"content":"The lantern swung, and then"}}]}\n\ndata: {"error":{"message":"upstream closed"}}\n\n'
      : 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"The lantern swung, and then"}}\n\ndata: {"type":"error","error":{"message":"upstream closed"}}\n\n';
    const f = withFetch(async () => sseResponse(frames));
    try {
      const provider = createProvider({ type, baseUrl: 'https://example.test', apiKey: 'k', model: 'm' });
      const out = await provider.streamChat({ system: '', messages: [{ role: 'user', content: 'go' }], onToken() {} });
      assert(/lantern swung/.test(out.text), type + ': the words before the break are kept');
      assert(/max_tokens|length/i.test(String(out.finishReason || '')), type + ': the page is marked cut short (was ' + out.finishReason + ')');
      assert(out.notes.some((n) => /wire broke mid-page/.test(n)), type + ': the break is said out loud');
    } finally { f.restore(); }
  }
});

test('M160: an error frame with NO prose still throws, as it always did', async () => {
  const f = withFetch(async () => sseResponse('data: {"error":{"message":"upstream closed"}}\n\n'));
  try {
    const provider = createProvider({ type: 'openai', baseUrl: 'https://example.test', apiKey: 'k', model: 'm' });
    let threw = '';
    try { await provider.streamChat({ system: '', messages: [{ role: 'user', content: 'go' }], onToken() {} }); }
    catch (err) { threw = err.message; }
    assert(/upstream closed/.test(threw), 'a break before the first word is still a failure (' + threw + ')');
  } finally { f.restore(); }
});
