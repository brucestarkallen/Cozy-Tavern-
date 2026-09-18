/* M318 — a started reply switches the thinking off on these houses; with thinking ON, the thinking is what is sent. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { createProvider } from '../../js/providers/index.js';
import { prefillSilencesThinking } from '../../js/providers/effort.js';

const enc = (t) => new TextEncoder().encode(t);
const okSSE = (text) => { const t = 'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking… ' } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(enc(t)); c.close(); } }), clone() { return this; }, async json() { return {}; }, async text() { return t; } }; };
const no = (status, message) => { const t = JSON.stringify({ error: { message } }); return { ok: false, status, headers: new Headers(), async json() { return JSON.parse(t); }, async text() { return t; }, clone() { return this; } }; };
async function tell(conn, answer) {
  const calls = []; const prior = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), body: JSON.parse(opts.body) }); return answer(calls.length, String(url)); };
  let out = null;
  try { out = await createProvider(conn).streamChat({ system: 's', messages: [{ role: 'user', content: 'u' }], onToken() {} }); } finally { globalThis.fetch = prior; }
  return { out, calls };
}
const DS = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-v4-pro' };

test('M318-1 THE WRITER’S STORYTELLER STOPPED THINKING AT EVERY LEVEL: with a prefill set, every turn went to DeepSeek as a started reply — and a started reply is answered without thinking. With thinking ON, the thinking is sent and the prefill stays home, said', async () => {
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
    const r = await tell({ ...DS, prefill: '[The Bluebird —', reasoning: { effort: level } }, () => okSSE('[The Wells house — Friday]\n\nShe looked up.'));
    const last = r.calls[0].body.messages.slice(-1)[0];
    eq(last.role, 'user', level + ': no started reply rides');
    eq(r.calls[0].url, 'https://api.deepseek.com/v1/chat/completions', level + ': the ordinary address');
    assert(r.calls[0].body.thinking && r.calls[0].body.thinking.type === 'enabled', level + ': and the thinking is asked for: ' + JSON.stringify(r.calls[0].body.thinking));
    eq(r.out.text, '[The Wells house — Friday]\n\nShe looked up.', 'the page is the model’s own — nothing put in front of it');
    assert(r.out.thinking && (r.out.notes || []).some((n) => /skip its thinking/.test(n)), level + ': it thought, and the writer is told why the prefill stayed home');
  }
  /* thinking Off: the prefill rides, as the writer set it */
  const off = await tell({ ...DS, prefill: '[The Bluebird —', reasoning: { effort: 'off' } }, () => okSSE(' Friday]'));
  eq(off.calls[0].url, 'https://api.deepseek.com/beta/chat/completions'); eq(off.calls[0].body.messages.slice(-1)[0].prefix, true);
  eq(off.out.text, '[The Bluebird — Friday]');
  /* Claude refuses a prefill while it thinks: the same rule */
  assert(prefillSilencesThinking({ type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5', prefill: 'x', reasoning: { effort: 'high' } }));
  assert(!prefillSilencesThinking({ ...DS, prefill: 'x' }), 'nothing said about thinking: the prefill is the writer’s one explicit word, and it rides');
  assert(!prefillSilencesThinking({ type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3', prefill: 'x', reasoning: { effort: 'high' } }), 'Kimi: not known to clash — left as it was');
});

test('M318-2 a no from DeepSeek’s BETA address is never remembered as "this house refuses thinking" — and a mark it left behind is let go', async () => {
  const stored = await db.connections.add({ label: 'ds prefill, thinking off', ...DS, prefill: '[The Bluebird —', reasoning: { effort: 'off' } });
  const live = () => db.connections.list().then((l) => l.find((c) => c.id === stored.id));
  /* the beta address says no, and its words name "thinking" */
  const r = await tell(await live(), (n, url) => (/\/beta\//.test(url) ? no(400, 'the thinking parameter is not supported with prefix completion') : okSSE('She looked up.')));
  eq(r.calls.length, 2); eq(r.calls[1].url, 'https://api.deepseek.com/v1/chat/completions', 'the turn goes again at the ordinary address');
  assert(r.calls[1].body.thinking && r.calls[1].body.thinking.type === 'disabled', 'WITH the writer’s thinking setting still on the wire: ' + JSON.stringify(r.calls[1].body.thinking));
  eq(r.out.text, 'She looked up.');
  assert(!(await live()).reasoningDownAt, 'and nothing is remembered against the connection’s thinking');
  /* a connection m307–m317 already silenced that way */
  await db.connections.update(stored.id, { reasoningDownAt: 1700000000000, reasoningDownShape: 'deepseek', reasoning: { effort: 'high' } });
  const healed = await tell(await live(), () => okSSE('She looked up.'));
  assert(healed.calls[0].body.thinking && healed.calls[0].body.thinking.type === 'enabled', 'thinking is sent again at once: ' + JSON.stringify(healed.calls[0].body.thinking));
  assert(!(await live()).reasoningDownAt, 'the mark is gone from the store');
  await db.connections.remove(stored.id);
});
