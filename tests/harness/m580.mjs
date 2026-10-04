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
  assert(/\[\\t \\r\\n\]\*\$$/.test(structuredSchema('Yes. [[end]]').properties.response.pattern), 'ends where the template ends (whitespace written plainly, M585)');
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
  const conn = await db.connections.add({ type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'moonshotai/some-model', prefill: '[The Bluebird — ', prefillMode: 'structured' }); /* a Moonshot model on OpenRouter: Moonshot's own fields, so "as written" starts the reply */
  const { out, calls } = await tell(conn, (n) => (n === 1 ? refuse('response_format json_schema is not supported for this model') : sseRaw(['Friday]'])));
  eq(calls.length, 2, 'asked twice');
  assert(!calls[1].body.response_format, 'the second time without the schema');
  eq(calls[1].body.messages[calls[1].body.messages.length - 1].role, 'assistant', 'and with the prefill as written');
  assert(out.notes.some((x) => /would not take a structured prefill/.test(x)), 'said');
  const kept = (await db.connections.list()).find((c) => c.id === conn.id);
  assert(kept.structuredDownAt && kept.structuredDownModel === 'moonshotai/some-model', 'remembered for this model');
  const other = await tell({ ...OR, model: 'some/other', prefill: '[x ', prefillMode: 'structured', structuredDownAt: kept.structuredDownAt, structuredDownModel: 'some/model' }, () => sseRaw(['{"response":"[x yes indeed, a page long enough to pass the minimum of eighty characters set by default here"}']));
  assert(Boolean(other.calls[0].body.response_format), 'another model on the connection is asked again');
  const again = await tell(kept, () => sseRaw(['Friday]']));
  assert(!again.calls[0].body.response_format, 'not asked again for this model');
  const seedOnly = await tell({ ...OR, prefill: '<think>Plan it first.', prefillMode: 'structured' }, () => sseRaw(['A page.']));
  assert(!seedOnly.calls[0].body.response_format, 'a seed alone has no opening to ask for — the turn goes as written');
});

test('M581-1 BANNED WORDS, EXACT: the continuation can never carry one — any capitals, inside longer words, after a near miss ("oozone", "otapestry" — what the extension\'s own pattern lets through), self-overlapping words; checked against thousands of random texts', async () => {
  const { bannedPattern } = await import('../../js/providers/structured.js');
  const contains = (t, ws) => ws.some((w) => t.toLowerCase().includes(w));
  for (const ws of [['ozone'], ['ozone', 'tapestry'], ['aab'], ['ab', 'ca', 'bca'], ['—', 'gaze']]) {
    const r = bannedPattern(ws);
    assert(!r.tooBig && r.pattern, JSON.stringify(ws));
    const re = new RegExp('^(?:' + r.pattern + ')$');
    const alpha = [...new Set(ws.join('') + 'xy ')];
    let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 4000; n += 1) {
      let t = ''; const L = 1 + Math.floor(rnd() * 12);
      for (let i = 0; i < L; i += 1) { let c = alpha[Math.floor(rnd() * alpha.length)]; if (rnd() < 0.2) c = c.toUpperCase(); t += c; }
      eq(re.test(t), !contains(t, ws), JSON.stringify(ws) + ' on ' + JSON.stringify(t));
    }
  }
  const one = new RegExp('^(?:' + bannedPattern(['ozone']).pattern + ')$');
  assert(!one.test('oozone') && !one.test('the OZONE layer') && one.test('a zone of ozo'), 'the near misses');
  assert(bannedPattern(['ozone', 'tapestry', 'elara', 'luminous', 'firmament', 'gaze', 'testament', 'whisper']).tooBig, 'a list too long for one exact pattern is refused whole, never cut');
});

test('M581-2 THE SCHEMA CARRIES THE BANNED WORDS; the houses the extension never asks (DeepSeek, Moonshot, Z.ai…) are sent as written; a list too long is said and left out', async () => {
  const { structuredPlanFor } = await import('../../js/providers/openai.js');
  const plan = structuredPlanFor({ type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5', prefill: '[The gate — ', prefillMode: 'structured', prefillBanned: 'ozone' });
  const re = new RegExp(plan.schema.properties.response.pattern);
  assert(re.test('[The gate — the bell rang.') && !re.test('[The gate — the ozone hung.'), 'his opening, then never the word');
  eq(structuredPlanFor({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', prefill: '[x ', prefillMode: 'structured' }), null, 'DeepSeek: as written');
  eq(structuredPlanFor({ type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3', prefill: '[x ', prefillMode: 'structured' }), null, 'Moonshot: as written');
  const many = structuredPlanFor({ type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5', prefill: '[x ', prefillMode: 'structured', prefillBanned: 'ozone\ntapestry\nelara\nluminous\nfirmament\ngaze\ntestament\nwhisper' });
  assert(/too many for one exact pattern/.test(many.note) && /\(\?:\.\|\\n\)\{80,\}/.test(many.schema.properties.response.pattern), 'said, and the page goes with the plain minimum');
});

test('M582 A STRUCTURED TEMPLATE THAT GOES AS WRITTEN NEVER SENDS ITS MARKERS: on an address that takes no schema (or a model that refused it) only the plain words that open the shown part start the reply — the hidden part, [[end]] and every slot stay home', async () => {
  const { prefillPlan, prefillLead } = await import('../../js/providers/effort.js');
  const c = { type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3', prefillMode: 'structured' };
  eq(prefillPlan({ ...c, prefill: '[[line]]\n\nYuhuu Hulk is here' }).send, false, 'nothing plain before the first marker: no started reply at all');
  eq(prefillPlan({ ...c, prefill: '<plan>[[w:5-20]]</plan>\n[[keep]]\n[The gate — ' }).content, '[The gate —', 'the hidden plan never sent');
  eq(prefillPlan({ ...c, prefill: '[The gate — [[pg]]' }).content, '[The gate — ', 'up to the marker');
  eq(prefillLead({ ...c, prefill: '[The gate — [[pg]]' }), '[The gate — ', 'and the words put back in front of the page are the same');
  eq(prefillPlan({ ...c, prefillMode: undefined, prefill: 'Yuhuu [[line]]' }).content, 'Yuhuu [[line]]', 'As written: his words exactly as typed');
});

test('M583 THE READY-MADE TEMPLATES: each is written from his words, follows its own rule end to end (the reply matches, the hidden plan never shows, the page starts at its header), and his words can never become a marker', async () => {
  const { STRUCTURED_PRESETS, fillPreset } = await import('../../js/providers/structured.js');
  const { splitAtHeader } = await import('../../js/ui/headergate.js');
  eq(STRUCTURED_PRESETS.map((p) => p.id).join(','), 'line,plan,opener');
  const words = 'Yuhuu Hulk is here Bruce story is good';
  const tail = ' — the shout rolled across the yard, and Kaelen lowered his blade, squinting at the gate where the dust still hung in the air.';
  const replies = { line: '[The yard — Monday | 09:00]\n\n' + words + tail, plan: '<plan>The last page ended with: Kaelen at the gate. This page will: Jovan answers and the captain arrives</plan>\n[The yard — Monday | 09:00]\n\n' + words + tail };
  for (const id of ['line', 'plan']) {
    const pf = fillPreset(id, words).prefill;
    assert(new RegExp(structuredSchema(pf).properties.response.pattern).test(replies[id]), id + ': the reply follows the rule');
    const d = makeStructuredDecoder({ hidden: hiddenMatcher(pf) });
    const raw = JSON.stringify({ response: replies[id] });
    let shown = ''; for (let i = 0; i < raw.length; i += 7) shown += d.feed(raw.slice(i, i + 7)); shown += d.end();
    const cut = splitAtHeader(shown);
    eq(cut.lead, '', id + ': nothing moved into the thinking box');
    assert(cut.page.startsWith('[The yard — Monday | 09:00]\n\n' + words), id + ': the page starts at the header, then his words');
    assert(!/plan/.test(cut.page), id + ': no plan on the page');
  }
  eq(fillPreset('opener', 'ignored').prefill, '[[pg]]');
  assert(/needs your words/.test(fillPreset('line', '  ').error), 'the first one asks for words');
  eq(fillPreset('line', 'a [[w:9]] b]]').prefill, '[[line]]\n\na w:9 b', 'his words never become a marker');
  eq(fillPreset('plan', '').prefill.endsWith('[[keep]]'), true, 'the plan without words: the page is the storyteller\u2019s own');
});

test('M585 A STRUCTURED ANSWER THAT NEVER ENDS IS NEVER WAITED ON: the moment its text closes the stream is let go (a stream that pads with whitespace forever returns at once, the page whole); a text that closed mid-sentence is marked cut short and said; no shorthand classes in any pattern', async () => {
  const conn = { type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'openai/gpt-5', prefill: '[x ', prefillMode: 'structured', prefillMinChars: 5 };
  const endless = (first) => {
    let sent = 0; let pulls = 0;
    const frames = first.map((c) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: c } }] }) + '\n\n');
    const body = new ReadableStream({ pull(c) { pulls += 1; if (sent < frames.length) { c.enqueue(enc(frames[sent])); sent += 1; return; } c.enqueue(enc('data: ' + JSON.stringify({ choices: [{ delta: { content: '   \n' } }] }) + '\n\n')); } });
    return { res: { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body, clone() { return this; }, json: async () => ({}) }, pulls: () => pulls };
  };
  const a = endless(['{"response":"[x Kaelen lunged at the gate', ' and the bell rang.', '"}']);
  const t0 = Date.now();
  const { out } = await tell(conn, () => a.res);
  assert(Date.now() - t0 < 5000, 'returned at once, not at the provider\u2019s end');
  eq(out.text, '[x Kaelen lunged at the gate and the bell rang.');
  eq(out.finishReason, 'stop', 'whole');
  assert(a.pulls() < 20, 'the padding was never read: ' + a.pulls() + ' reads');
  const b = endless(['{"response":"[x Kaelen lunged at the gate and said, ', '"}']);
  const cut = await tell(conn, () => b.res);
  eq(cut.out.finishReason, 'length', 'closed mid-sentence: cut short');
  assert(cut.out.notes.some((x) => /closed in the middle of a sentence/.test(x)), 'and said');
  const pat = structuredSchema('Pick [[opt:a|b]] then [[w:2-4]] [[end]]').properties.response.pattern + structuredSchema('[x ', { ascii: true }).properties.response.pattern + structuredSchema('[x ').properties.response.pattern;
  assert(!/\\[sS]/.test(pat), 'no \\s or \\S anywhere: ' + pat);
});
