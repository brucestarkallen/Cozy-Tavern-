/* Cozy Tavern — harness laws of M580: the structured prefill (the StructuredPrefill technique, written for the house). */
import './idb-shim.mjs';
import { test, assert, eq, runAll } from './lib.mjs';
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

test('M587 THE PREFILL AUDIT: a helper never goes structured (nor carries a structured template); the connection probes never carry the page\'s schema; "Test the prefill" on a Structured connection asks the structured way and reads the answer (a refusal remembered); a template\'s markers are never sent As written', async () => {
  console.log('step: worker');
  const { workerConnection } = await import('../../js/agents/call.js');
  const w = workerConnection({ id: 'c-w', prefill: '[[line]]\n\nYuhuu', prefillMode: 'structured', prefillBanned: 'ozone', prefillMinChars: 80 });
  assert(!w.prefill && !w.prefillMode && !w.prefillBanned, 'a helper rides plain');
  /* the probes */
  const conn = { ...OR, id: 'c-probe', prefill: '[x ', prefillMode: 'structured' };
  const sent = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { const body = JSON.parse(opts.body); sent.push(body); if (body.stream) return sseRaw(['ready']); return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), clone() { return this; }, json: async () => ({ choices: [{ message: { content: JSON.stringify({ response: '[x the gate stood open at dawn and the bell rang twice across the empty yard below the wall.' }) } }] }) }; };
  try {
    console.log('step: test');
    await createProvider(conn).test().catch(() => {});
    console.log('step: test done');
    assert(sent.length && sent.every((b) => !b.response_format), 'the connection test and its probes carry no schema (' + sent.length + ' asked)');
    sent.length = 0;
    console.log('step: testPrefill');
    const t = await createProvider(conn).testPrefill();
    console.log('step: testPrefill done', t.detail.slice(0,60));
    assert(sent.length === 1 && sent[0].response_format, 'the prefill test asks the structured way');
    assert(t.ok && /Structured works on this model/.test(t.detail), t.detail);
  } finally { globalThis.fetch = prior; }
  console.log('step: refusing');
  const refusing = await db.connections.add({ ...OR, model: 'some/refuser', prefill: '[x ', prefillMode: 'structured' });
  globalThis.fetch = async () => refuse('response_format json_schema is not supported');
  try {
    const t = await createProvider(refusing).testPrefill();
    assert(!t.ok && /would not take a structured prefill/.test(t.detail), t.detail);
    eq(((await db.connections.list()).find((c) => c.id === refusing.id) || {}).structuredDownModel, 'some/refuser', 'remembered');
  } finally { globalThis.fetch = prior; }
  const { prefillPlan } = await import('../../js/providers/effort.js');
  const p = prefillPlan({ type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3', prefill: '<think>nice iron man [[w:10-150]]</think>\n' });
  eq(p.seed, 'nice iron man', 'a template kept after switching back to As written: its seed up to the marker');
  eq(prefillPlan({ type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3', prefill: 'A plain [[weird]] bracket' }).content, 'A plain [[weird]] bracket', 'brackets that are no marker are his words');
});

await runAll();
process.exit(process.exitCode || 0);
