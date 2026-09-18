/* M328 — the thinking prefill (the writer's SillyTavern extension, Prefill Control 1.5.1, brought into the house). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { createProvider } from '../../js/providers/index.js';
import { splitPrefill, prefillFields, prefillPlan, describePrefill, prefillLead, fieldName } from '../../js/providers/effort.js';
import { callWorker, noteTellerConnection } from '../../js/agents/call.js';

const enc = (t) => new TextEncoder().encode(t);
const sse = (pieces) => { const t = pieces.map((p) => 'data: ' + JSON.stringify(p) + '\n\n').join('') + 'data: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(enc(t)); c.close(); } }), clone() { return this; }, async json() { return {}; }, async text() { return t; } }; };
const thinksThenWrites = () => sse([{ choices: [{ delta: { reasoning_content: 'Bruce just sat down, so' } }] }, { choices: [{ delta: { reasoning_content: ' the scene opens on him.' } }] }, { choices: [{ delta: { content: '[The Bluebird — Friday | 20:40]\n\nShe looked up.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
async function tell(conn, answer = thinksThenWrites) {
  const calls = []; const prior = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), body: JSON.parse(opts.body) }); return answer(calls.length, String(url)); };
  let out = null; const shown = { thinking: '', prose: '' };
  try { out = await createProvider(conn).streamChat({ system: 's', messages: [{ role: 'user', content: 'u' }], onToken: ({ channel, text }) => { if (shown[channel] !== undefined) shown[channel] += text; } }); } finally { globalThis.fetch = prior; }
  return { out, calls, shown, last: calls[0].body.messages[calls[0].body.messages.length - 1] };
}
const SEED = '<think>Right, where were we. Let me look at what Bruce just did —';
const KIMI = { type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'k', model: 'kimi-k3' };
const DS = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-v4-pro' };
const OR = { type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'z-ai/glm-5' };

test('M328-1 THE THINKING PREFILL: a prefill that opens with <think> seeds the scratchpad — the reply left empty, flagged unfinished — on each house in its own fields; and the words the thought was started with are part of the thought', async () => {
  eq(JSON.stringify(splitPrefill(SEED)), JSON.stringify({ seed: 'Right, where were we. Let me look at what Bruce just did —', content: '' }), 'an open tag runs to the end');
  eq(JSON.stringify(splitPrefill('  <think>plan it</think>  [The Bluebird — ')), JSON.stringify({ seed: 'plan it', content: '[The Bluebird —' }), 'a closed one leaves the reply’s first words');
  const k = await tell({ ...KIMI, prefill: SEED });
  eq(JSON.stringify(k.last), JSON.stringify({ role: 'assistant', content: '', reasoning_content: 'Right, where were we. Let me look at what Bruce just did —', partial: true }), 'Moonshot: exactly the message the extension sends');
  assert(k.out.thinking.startsWith('Right, where were we. Let me look at what Bruce just did — Bruce just sat down, so the scene opens on him.'), 'the thinking he reads begins with his own seed: ' + k.out.thinking.slice(0, 80));
  eq(k.shown.thinking, k.out.thinking, 'as it streams, too');
  eq(k.out.text, '[The Bluebird — Friday | 20:40]\n\nShe looked up.', 'and the page is the model’s own — a pure thinking prefill puts nothing in front of it');
  const d = await tell({ ...DS, prefill: SEED, reasoning: { effort: 'high' } });
  eq(d.calls[0].url, 'https://api.deepseek.com/beta/chat/completions', 'DeepSeek: the beta address');
  eq(JSON.stringify(d.last), JSON.stringify({ role: 'assistant', content: '', reasoning_content: 'Right, where were we. Let me look at what Bruce just did —', prefix: true }));
  assert(d.calls[0].body.thinking.type === 'enabled' && d.calls[0].body.reasoning_effort === 'high', 'WITH thinking on — a seed is the thinking; only a started reply switches it off (M318, narrowed)');
  eq(JSON.stringify((await tell({ ...OR, prefill: SEED })).last), JSON.stringify({ role: 'assistant', content: '', reasoning: 'Right, where were we. Let me look at what Bruce just did —' }), 'OpenRouter: "reasoning", no flag');
  eq(JSON.stringify(prefillFields({ ...OR, model: 'moonshotai/kimi-k3' })), JSON.stringify({ flag: 'partial', reasoning: 'reasoning_content', error: '' }), 'OpenRouter handing on a Moonshot model: Moonshot’s fields');
  eq(JSON.stringify((await tell({ type: 'openai', baseUrl: 'https://my.proxy/v1', apiKey: 'k', model: 'x', prefill: SEED })).last), JSON.stringify({ role: 'assistant', content: '', reasoning_content: 'Right, where were we. Let me look at what Bruce just did —' }), 'any other address: reasoning_content, no flag');
});

test('M328-2 a seed AND a started reply: both ride, both are put back; a plain started reply is exactly what it was', async () => {
  const both = await tell({ ...KIMI, prefill: '<think>Keep it quiet.</think>[The Bluebird —' }, () => sse([{ choices: [{ delta: { reasoning_content: 'One beat.' } }] }, { choices: [{ delta: { content: ' Friday | 20:40]\n\nShe looked up.' } }] }]));
  eq(JSON.stringify(both.last), JSON.stringify({ role: 'assistant', content: '[The Bluebird —', reasoning_content: 'Keep it quiet.', partial: true }));
  eq(both.out.text, '[The Bluebird — Friday | 20:40]\n\nShe looked up.'); eq(both.out.thinking, 'Keep it quiet. One beat.');
  eq(prefillLead({ prefill: SEED }), '', 'a pure thinking prefill puts nothing in front of the page');
  const plain = await tell({ ...KIMI, prefill: '[The Bluebird — ' }, () => sse([{ choices: [{ delta: { content: 'Friday]' } }] }]));
  eq(JSON.stringify(plain.last), JSON.stringify({ role: 'assistant', content: '[The Bluebird —', partial: true })); eq(plain.out.text, '[The Bluebird — Friday]');
  const dsOn = await tell({ ...DS, prefill: '[The Bluebird —', reasoning: { effort: 'high' } });
  eq(dsOn.last.role, 'user', 'M318 stands: a started REPLY on DeepSeek stays home while thinking is on');
  assert(dsOn.out.notes.some((n) => /skip its thinking/.test(n) && /open it with <think>/.test(n)), 'and the note now says the way through');
});

test('M328-3 the thinking channel is kept open for a seed — and only for a seed; unticked, the dial is obeyed; a channel that was refused carries no seed', async () => {
  const off = await tell({ ...DS, prefill: SEED, reasoning: { effort: 'off' } });
  assert(off.calls[0].body.thinking.type === 'enabled' && off.calls[0].body.reasoning_effort === 'low', 'thinking Off + a seed: the lightest thinking, for this turn: ' + JSON.stringify(off.calls[0].body.thinking));
  assert(off.out.notes.some((n) => /switched on \(at its lightest\) for this turn/.test(n)), 'said');
  const unticked = await tell({ ...DS, prefill: SEED, reasoning: { effort: 'off' }, prefillKeepThinking: false });
  eq(unticked.calls[0].body.thinking.type, 'disabled', 'unticked: his dial, exactly');
  const noSeed = await tell({ ...DS, prefill: '[The Bluebird —', reasoning: { effort: 'off' } });
  eq(noSeed.calls[0].body.thinking.type, 'disabled', 'a started reply opens nothing');
  /* (reasoningDownRechecked: a refusal that came back after M318's one recheck is a real one) */
  const refused = await tell({ ...DS, prefill: SEED, reasoning: { effort: 'high' }, reasoningDownAt: Date.now(), reasoningDownShape: 'deepseek', reasoningDownRechecked: true });
  eq(refused.last.role, 'user', 'thinking refused by this connection: no seed is sent into a channel that is shut');
  assert(refused.out.notes.some((n) => /thinking seed stayed home/.test(n)));
});

test('M328-4 a field name typed by hand is checked before anything is sent; Claude takes no seed; and the words for the card say what rides', async () => {
  eq(fieldName(' partial ').name, 'partial', 'trimmed — " partial " is a key no provider reads');
  assert(!fieldName('content').valid && !fieldName('role').valid && !fieldName('my field').valid && fieldName('none').name === '' && fieldName('').auto);
  const bad = await tell({ ...KIMI, prefill: SEED, prefillFlagField: 'content' });
  eq(bad.last.role, 'user', 'a flag named "content" would send content:true — nothing is sent');
  assert(bad.out.notes.some((n) => /part of the message itself/.test(n)));
  assert(/both “reasoning_content”/.test(prefillPlan({ ...KIMI, prefill: SEED, prefillFlagField: 'reasoning_content' }).why), 'the flag would overwrite the seed');
  eq(JSON.stringify((await tell({ ...KIMI, prefill: SEED, prefillFlagField: 'none', prefillReasoningField: 'thoughts' })).last), JSON.stringify({ role: 'assistant', content: '', thoughts: 'Right, where were we. Let me look at what Bruce just did —' }), 'his own names are sent as typed');
  const claude = { type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'claude-sonnet-4-5' };
  assert(!prefillPlan({ ...claude, prefill: SEED }).send && /no thinking seed/.test(prefillPlan({ ...claude, prefill: SEED }).why));
  eq(prefillPlan({ ...claude, prefill: '<think>x</think>[The Bluebird —' }).content, '[The Bluebird —', 'Claude: the words after the seed still start the reply');
  assert(/^Sent as a thinking seed in “reasoning_content” \(\d+ characters\) — the model continues the thought, flagged “partial”\.$/.test(describePrefill({ ...KIMI, prefill: SEED })), describePrefill({ ...KIMI, prefill: SEED }));
  eq(describePrefill({ ...KIMI }), '');
});

test('M328-5 a story’s prefill is not welded onto a worker: riding the STORYTELLER’S connection a worker is sent none; on its own connection its prefill is its own; the tick sends it anyway', async () => {
  const teller = await db.connections.add({ label: 'teller', ...KIMI, prefill: SEED });
  const crew = await db.connections.add({ label: 'crew', ...KIMI, prefill: '{' });
  const ask = async (conn) => { const calls = []; const prior = globalThis.fetch; globalThis.fetch = async (u, o) => { calls.push(JSON.parse(o.body)); return sse([{ choices: [{ delta: { content: '"mutations":[]}' } }] }]); }; try { const r = await callWorker(conn, { system: 's', user: 'u', maxTokens: 400 }); return { r, last: calls[0].messages[calls[0].messages.length - 1] }; } finally { globalThis.fetch = prior; } };
  noteTellerConnection(teller.id);
  eq((await ask(teller)).last.role, 'user', 'the storyteller’s seed never reaches the ledger’s reader');
  const own = await ask(crew);
  eq(JSON.stringify(own.last), JSON.stringify({ role: 'assistant', content: '{', partial: true }), 'a connection made for the workers keeps its "{"…');
  eq(own.r.text, '{"mutations":[]}', '…and its first brace (M307-3)');
  eq((await ask({ ...teller, prefillForWorkers: true })).last.role, 'assistant', 'ticked: it rides');
  noteTellerConnection(null);
  await db.connections.remove(teller.id); await db.connections.remove(crew.id);
});
