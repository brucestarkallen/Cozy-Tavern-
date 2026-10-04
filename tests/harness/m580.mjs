/* Cozy Tavern — harness laws of M580: the structured prefill (the StructuredPrefill technique, written for the house). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { createProvider } from '../../js/providers/index.js';
import { structuredSchema, templatePattern, readTemplate, makeStructuredDecoder, hiddenMatcher, unwrapStructured, literalPattern } from '../../js/providers/structured.js';

const enc = (t) => new TextEncoder().encode(t);
const sseRaw = (contents) => {
  const t = contents.map((c) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: c } }] }) + '\n\n').join('') + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
  return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: new ReadableStream({ start(c) { c.enqueue(enc(t)); c.close(); } }), clone() { return this; }, json: async () => ({}) };
};
const refuse = (msg) => ({ ok: false, status: 400, headers: new Headers({ 'content-type': 'application/json' }), clone() { return this; }, json: async () => ({ error: { message: msg } }), text: async () => JSON.stringify({ error: { message: msg } }) });
async function tell(conn, answer) {
  const calls = []; const prior = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), body: JSON.parse(opts.body) }); return answer(calls.length); };
  let out = null; const shown = { thinking: '', prose: '' };
  try { out = await createProvider(conn).streamChat({ system: 's', messages: [{ role: 'user', content: 'u' }], onToken: ({ channel, text }) => { if (shown[channel] !== undefined) shown[channel] += text; } }); } finally { globalThis.fetch = prior; }
  return { out, calls, shown };
}
const OR = { type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'openai/gpt-5' };

test('M580-1 THE TEMPLATE AS A PATTERN: his words must open the answer exactly, then at least the minimum more; the slots hold to their shapes; [[keep]] and [[end]] are read', () => {
  const s = structuredSchema('[The Bluebird — ', { minChars: 10 });
  const re = new RegExp(s.properties.response.pattern);
  assert(re.test('[The Bluebird — Friday | 20:40] She looked up.'), 'opens with his words, carries on');
  assert(!re.test('I\u2019m sorry, I can\u2019t continue this.'), 'a refusal cannot match');
  assert(!re.test('[The Bluebird — short'), 'fewer than the minimum after it cannot');
  eq(s.required.join(), 'response'); eq(s.additionalProperties, false);
  const slots = new RegExp('^' + templatePattern('Mood: [[emotion]]. Pick: [[opt:A|B|C]]. Roll [[number:1-6]]. Said: [[w:2-3]]\n') + '$');
  assert(slots.test('Mood: calm. Pick: B. Roll 4. Said: two words\n'), 'each slot in its shape');
  assert(!slots.test('Mood: calm. Pick: D. Roll 4. Said: two words\n'), 'an option not listed fails');
  assert(!slots.test('Mood: calm. Pick: B. Roll 9. Said: two words\n'), 'a number out of range fails');
  assert(!slots.test('Mood: calm. Pick: B. Roll 4. Said: far too many words here\n'), 'too many words fails');
  const t = readTemplate('<plan>[[w:3-9]]</plan>\n[[keep]]Kaelen [[end]]');
  eq(t.hidden, '<plan>[[w:3-9]]</plan>\n'); eq(t.shown, 'Kaelen '); eq(t.mustEnd, true);
  assert(/\\s\*\$$/.test(structuredSchema('Yes. [[end]]').properties.response.pattern), 'ends where the template ends');
  eq(literalPattern('a(b)?\nc'), 'a\\(b\\)\\?\\nc', 'specials escaped, the newline as \\n');
  assert(/\\u2014/.test(structuredSchema('Bluebird — ', { ascii: true }).properties.response.pattern), 'an ASCII-only pattern for Claude routes');
});

test('M580-2 THE ANSWER IS READ AS IT STREAMS: JSON split anywhere (an escape, a \\u, the key itself) gives back exactly its words; an answer that is not JSON is passed through; the hidden part is held back and dropped', () => {
  const pieces = ['  {"res', 'ponse": "[The Blue', 'bird \\u20', '14 Friday]\\n\\nShe said \\"', 'hi\\".', '"}'];
  const d = makeStructuredDecoder();
  let shown = ''; for (const p of pieces) shown += d.feed(p); shown += d.end();
  eq(shown, '[The Bluebird \u2014 Friday]\n\nShe said "hi".');
  eq(unwrapStructured('{"response":"plain words"}'), 'plain words');
  const plain = makeStructuredDecoder(); let p2 = plain.feed('No JSON here, '); p2 += plain.feed('just the page.'); p2 += plain.end();
  eq(p2, 'No JSON here, just the page.', 'a house that ignored the format: its words are still the page');
  const hidden = hiddenMatcher('<plan>[[w:2-6]]</plan>\n[[keep]]Kaelen');
  const h = makeStructuredDecoder({ hidden });
  let out = ''; for (const p of ['{"response":"<plan>he strikes ', 'first</plan>\\nKaelen ', 'lunged."}']) out += h.feed(p); out += h.end();
  eq(out, 'Kaelen lunged.', 'the plan written, never shown');
});

test('M580-3 THROUGH THE REAL PROVIDER: no assistant message is sent, the request carries the schema (OpenRouter told to keep it), the page streams as words, and nothing is put in front of it twice', async () => {
  const { out, calls, shown } = await tell({ ...OR, prefill: '[The Bluebird — ', prefillMode: 'structured', prefillMinChars: 5 }, () => sseRaw(['{"response":"[The Bluebird — ', 'Friday | 20:40]\\n\\nShe looked up.', '"}']));
  const body = calls[0].body;
  eq(body.messages[body.messages.length - 1].role, 'user', 'no assistant prefill on the wire');
  eq(body.response_format.type, 'json_schema');
  assert(new RegExp(body.response_format.json_schema.schema.properties.response.pattern).test('[The Bluebird — Friday | 20:40]\n\nShe looked up.'), 'the pattern holds his words');
  eq(body.provider.require_parameters, true, 'OpenRouter routes only to a provider that keeps the schema');
  eq(out.text, '[The Bluebird — Friday | 20:40]\n\nShe looked up.', 'the page: the words, once');
  eq(shown.prose, out.text, 'as it streamed');
  assert(out.prefill && out.prefill.structured === true, 'the receipt says it went structured');
});

test('M580-4 A HOUSE THAT REFUSES IT says so once: the same turn goes again with the prefill as written, the refusal is kept for this model — and a thinking seed never rides a structured turn', async () => {
  /* on an address that takes a started reply (Moonshot), "as written" is the reply started for it; on a plain OpenRouter model it stays home — which is why the structured way exists */
  const conn = await db.connections.add({ type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'k', model: 'some/model', prefill: '[The Bluebird — ', prefillMode: 'structured' });
  const { out, calls } = await tell(conn, (n) => (n === 1 ? refuse('response_format json_schema is not supported for this model') : sseRaw(['Friday]'])));
  eq(calls.length, 2, 'asked twice');
  assert(!calls[1].body.response_format, 'the second time without the schema');
  eq(calls[1].body.messages[calls[1].body.messages.length - 1].role, 'assistant', 'and with the prefill as written');
  assert(out.notes.some((x) => /would not take a structured prefill/.test(x)), 'said');
  const kept = (await db.connections.list()).find((c) => c.id === conn.id);
  assert(kept.structuredDownAt && kept.structuredDownModel === 'some/model', 'remembered for this model');
  const other = await tell({ ...OR, model: 'some/other', prefill: '[x ', prefillMode: 'structured', structuredDownAt: kept.structuredDownAt, structuredDownModel: 'some/model' }, () => sseRaw(['{"response":"[x yes indeed, a page long enough to pass the minimum of eighty characters set by default here"}']));
  assert(Boolean(other.calls[0].body.response_format), 'another model on the connection is asked again');
  const again = await tell(kept, () => sseRaw(['Friday]']));
  assert(!again.calls[0].body.response_format, 'not asked again for this model');
  const seedOnly = await tell({ ...OR, prefill: '<think>Plan it first.', prefillMode: 'structured' }, () => sseRaw(['A page.']));
  assert(!seedOnly.calls[0].body.response_format, 'a seed alone has no opening to ask for — the turn goes as written');
});
