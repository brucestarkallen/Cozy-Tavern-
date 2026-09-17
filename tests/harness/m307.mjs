/* M307 — the words a reply was started with are part of the reply; DeepSeek takes a started reply at its beta address. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { createProvider } from '../../js/providers/index.js';
import { callWorker } from '../../js/agents/call.js';
import { prefillLead, deepseekBetaBase } from '../../js/providers/effort.js';

const enc = (s) => new TextEncoder().encode(s);
const okStream = (text) => ({ ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(enc(text)); c.close(); } }), clone() { return this; }, async json() { return {}; }, async text() { return text; } });
const openaiSSE = (pieces) => okStream(pieces.map((p) => 'data: ' + JSON.stringify({ choices: [{ delta: p }] }) + '\n\n').join('') + 'data: [DONE]\n\n');
const claudeSSE = (texts) => okStream(['event: content_block_start\ndata: ' + JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + '\n\n',
  ...texts.map((t) => 'event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }) + '\n\n'),
  'event: message_delta\ndata: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + '\n\n'].join(''));
const no = (status, message) => { const t = JSON.stringify({ error: { message } }); return { ok: false, status, headers: new Headers(), async json() { return JSON.parse(t); }, async text() { return t; }, clone() { return this; } }; };
async function tell(conn, answer) {
  const calls = []; const tokens = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), body: JSON.parse(opts.body) }); return answer(calls.length, String(url)); };
  let out = null;
  try { out = await createProvider(conn).streamChat({ system: 's', messages: [{ role: 'user', content: 'u' }], onToken: (t) => tokens.push(t.channel + ':' + t.text) }); } finally { globalThis.fetch = prior; }
  return { out, calls, tokens };
}
const KIMI = { type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'k', model: 'kimi-k3' };
const DS = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-v4-pro' };

test('M307-1 the page begins with the words it was started with — put back at the reply’s first word, after the thinking, never doubled, never a page of their own', async () => {
  const a = await tell({ ...KIMI, prefill: '[The Bluebird — ' }, () => openaiSSE([{ reasoning_content: 'Where are they? ' }, { content: 'Friday | 20:00]\n\nShe looked up.' }]));
  eq(a.out.text, '[The Bluebird — Friday | 20:00]\n\nShe looked up.', 'what was sent, the space the writer ended it with (the wire trims it; the continuation brought none), and what came after');
  eq(a.calls[0].body.messages.slice(-1)[0].content, '[The Bluebird —', 'on the wire the trailing space is trimmed, as before');
  assert(a.out.text.startsWith('[The Bluebird —'), 'the header line is whole again: ' + a.out.text.slice(0, 40));
  eq(a.tokens.join(' | '), 'thinking:Where are they?  | prose:[The Bluebird —  | prose:Friday | 20:00]\n\nShe looked up.', 'on the page as it streams, and only once the thinking is done');
  eq(a.calls[0].body.messages.slice(-1)[0].partial, true, 'Kimi’s own flag');
  /* a continuation that brings its own space is not given a second */
  const a2 = await tell({ ...KIMI, prefill: '[The Bluebird — ' }, () => openaiSSE([{ content: ' Friday]' }]));
  eq(a2.out.text, '[The Bluebird — Friday]');
  /* a leading <think> span is thinking, never the page */
  const b = await tell({ ...KIMI, prefill: '<think>Keep it short.</think>[The Bluebird —' }, () => openaiSSE([{ content: ' Friday]' }]));
  eq(b.out.text, '[The Bluebird — Friday]');
  eq(prefillLead({ prefill: '<think>x</think>  Liara ' }), 'Liara');
  /* a house that echoes the prefill itself is not doubled */
  const c = await tell({ ...KIMI, prefill: '[The Bluebird —' }, () => openaiSSE([{ content: '[The Bluebird — Friday]' }]));
  eq(c.out.text, '[The Bluebird — Friday]');
  /* no word of prose came: no page is made of the prefill alone */
  const d = await tell({ ...KIMI, prefill: '[The Bluebird —' }, () => openaiSSE([{ reasoning_content: 'thinking only' }]));
  eq(d.out.text, '', 'nothing is nothing');
  /* Claude, in its own stream */
  const e = await tell({ type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'claude-sonnet-4-5', prefill: '[The Bluebird —' }, () => claudeSSE([' Friday]', '\n\nShe looked up.']));
  eq(e.out.text, '[The Bluebird — Friday]\n\nShe looked up.');
  /* and with no prefill, nothing is added */
  const f = await tell({ ...KIMI }, () => openaiSSE([{ content: 'She looked up.' }]));
  eq(f.out.text, 'She looked up.');
});

test('M307-2 DeepSeek is sent a started reply at its beta address — the only one that takes it; everything else goes where it always went; a no from the beta address still brings the page', async () => {
  eq(deepseekBetaBase('https://api.deepseek.com/v1'), 'https://api.deepseek.com/beta');
  eq(deepseekBetaBase('https://api.deepseek.com'), 'https://api.deepseek.com/beta');
  eq(deepseekBetaBase('https://deepseek.proxy.example/v1'), '', 'a proxy keeps its own path');
  const withPrefill = await tell({ ...DS, prefill: '[The Bluebird —' }, () => openaiSSE([{ content: ' Friday]' }]));
  eq(withPrefill.calls[0].url, 'https://api.deepseek.com/beta/chat/completions');
  eq(withPrefill.calls[0].body.messages.slice(-1)[0].prefix, true);
  eq(withPrefill.out.text, '[The Bluebird — Friday]');
  const plain = await tell({ ...DS }, () => openaiSSE([{ content: 'She looked up.' }]));
  eq(plain.calls[0].url, 'https://api.deepseek.com/v1/chat/completions', 'no prefill: the ordinary address');
  const proxy = await tell({ ...DS, baseUrl: 'https://deepseek.proxy.example/v1', prefill: '[The Bluebird —' }, () => openaiSSE([{ content: ' Friday]' }]));
  eq(proxy.calls[0].url, 'https://deepseek.proxy.example/v1/chat/completions');
  /* the beta address says no for a reason of its own: the page still comes, without the prefill, and nothing is held against the connection */
  const stored = await db.connections.add({ label: 'ds', ...DS, prefill: '[The Bluebird —' });
  const live = (await db.connections.list()).find((c) => c.id === stored.id);
  const fell = await tell(live, (n) => (n === 1 ? no(404, 'not found') : openaiSSE([{ content: '[The Wells house — Friday]\n\nShe looked up.' }])));
  eq(fell.calls.length, 2);
  eq(fell.calls[1].url, 'https://api.deepseek.com/v1/chat/completions', 'the second ask goes to the ordinary address');
  assert(fell.calls[1].body.messages.slice(-1)[0].role === 'user', 'without the started reply');
  eq(fell.out.text, '[The Wells house — Friday]\n\nShe looked up.', 'and the page is the model’s own, nothing put in front of it');
  assert((fell.out.notes || []).some((n) => /beta address/.test(n)), 'said once');
  assert(!(await db.connections.list()).find((c) => c.id === stored.id).prefillDownAt, 'and the prefill is not switched off for it');
  await db.connections.remove(stored.id);
});

test('M307-3 a worker begun with "{" answers with JSON that still has its first brace', async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = async () => openaiSSE([{ content: '"mutations":[]}' }]);
  let got = null;
  try { got = await callWorker({ ...KIMI, prefill: '{' }, { system: 'Answer with JSON ONLY', user: 'u' }); } finally { globalThis.fetch = prior; }
  eq(got.text, '{"mutations":[]}');
  eq(JSON.stringify(JSON.parse(got.text)), '{"mutations":[]}', 'and it parses');
});

test('M307-4 the form’s “Test it” asks the address the turn will ask; a refusal remembered from DeepSeek’s ordinary address — which never takes a started reply — is not held against the connection', async () => {
  const asked = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (url) => { asked.push(String(url)); const t = JSON.stringify({ choices: [{ message: { role: 'assistant', content: ' Friday]' } }] }); return { ok: true, status: 200, headers: new Headers(), async json() { return JSON.parse(t); }, async text() { return t; }, clone() { return this; } }; };
  let verdict = null;
  try { verdict = await createProvider({ ...DS, prefill: '[The Bluebird —' }).testPrefill(); } finally { globalThis.fetch = prior; }
  eq(asked[0], 'https://api.deepseek.com/beta/chat/completions', 'it used to ask /v1, hear no, and switch the prefill off');
  eq(verdict.ok, true);
  /* a connection already switched off by that old no */
  const stored = await db.connections.add({ label: 'ds, switched off', ...DS, prefill: '[The Bluebird —' });
  await db.connections.update(stored.id, { prefillDownAt: 1700000000000 });
  const live = (await db.connections.list()).find((c) => c.id === stored.id);
  const told = await tell(live, () => openaiSSE([{ content: ' Friday]' }]));
  eq(told.calls[0].body.messages.slice(-1)[0].prefix, true, 'the prefill rides again');
  eq(told.out.text, '[The Bluebird — Friday]');
  assert(!(await db.connections.list()).find((c) => c.id === stored.id).prefillDownAt, 'and the old mark is gone from the store');
  /* a no from the BETA address is remembered, as any house’s is */
  const refused = await tell((await db.connections.list()).find((c) => c.id === stored.id), (n) => (n === 1 ? no(400, 'prefix is not supported for this model') : openaiSSE([{ content: 'She looked up.' }])));
  eq(refused.calls.length, 2);
  const marked = (await db.connections.list()).find((c) => c.id === stored.id);
  assert(marked.prefillDownAt && marked.prefillDownShape === 'deepseek-beta', 'remembered, with the address that said it');
  const after = await tell(marked, () => openaiSSE([{ content: 'She looked up.' }]));
  assert(after.calls[0].body.messages.slice(-1)[0].role === 'user', 'and honoured: no started reply is sent again');
  eq(after.calls[0].url, 'https://api.deepseek.com/v1/chat/completions', 'at the ordinary address');
  /* another house’s mark stands exactly as before */
  const kimi = await db.connections.add({ label: 'kimi, refused', ...KIMI, prefill: '[x' });
  await db.connections.update(kimi.id, { prefillDownAt: 1700000000000 });
  const k = await tell((await db.connections.list()).find((c) => c.id === kimi.id), () => openaiSSE([{ content: 'She looked up.' }]));
  assert(k.calls[0].body.messages.slice(-1)[0].role === 'user', 'still unsent, as M22 promised');
  /* DeepSeek's Anthropic-shaped address is never sent to /beta — its no is a real no and stays remembered
   * (found re-reading my own diff: the stale-mark rule matched it by host alone, and would have asked twice every turn) */
  const dsa = await db.connections.add({ label: 'deepseek, anthropic shape', type: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'k', model: 'deepseek-v4-pro', prefill: '[x' });
  await db.connections.update(dsa.id, { prefillDownAt: 1700000000000 });
  const a = await tell((await db.connections.list()).find((c) => c.id === dsa.id), () => claudeSSE(['She looked up.']));
  eq(a.calls.length, 1, 'one ask');
  assert(a.calls[0].body.messages.slice(-1)[0].role === 'user', 'no started reply is sent: the mark is honoured');
  assert(/api\.deepseek\.com\/anthropic\/v1\/messages$/.test(a.calls[0].url), 'at its own address: ' + a.calls[0].url);
  assert((await db.connections.list()).find((c) => c.id === dsa.id).prefillDownAt, 'and the mark stands');
  await db.connections.remove(stored.id); await db.connections.remove(kimi.id); await db.connections.remove(dsa.id);
});
